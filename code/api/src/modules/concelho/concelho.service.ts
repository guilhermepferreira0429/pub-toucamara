import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { DatabaseService } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { pode } from '../auth/permissoes.js';
import { LimitePedidos } from '../chat/limite.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { hojeNoFuso, periodoAnterior, somarDias } from '../painel/periodos.js';
import { TEXTO_ANONIMIZADO } from '../painel/retencao.js';
import {
  CitacaoAnalise,
  conteudoIa,
  contar,
  Contagens,
  ConversaLida,
  descreverFiltros,
  ESCALA_IRRITACAO,
  escolherAmostra,
  esquemaAnaliseIa,
  esquemaAnalisar,
  FAIXAS,
  Filtros,
  frasesComparacao,
  interpretarPergunta,
  LinhaConversa,
  LinhaSinal,
  MAX_CONVERSAS_IA,
  MINIMO_PARA_CITAR,
  palavrasDosMunicipes,
  PERGUNTAS_EXEMPLO,
  POUCOS_DADOS,
  prepararLeitura,
  resolverAnaliseIa,
  resolverFiltros,
  ResultadoIa,
  ROTULO_CANAL,
  sinaisDaSemana,
  SISTEMA_CONCELHO,
  TemaConhecido,
} from './concelho.regras.js';

/** A resposta de uma pergunta, tal como se guarda e se devolve. */
export interface AnaliseConcelho {
  id: string;
  pergunta: string;
  filtros: Filtros & { descricao: string; deduzidos: string[] };
  anterior: { de: string; ate: string };
  conversas: {
    total: number;
    lidas: number;
    anterior_total: number;
    variacao: number | null;
  };
  amostragem: string;
  poucos_dados: boolean;
  avisos: string[];
  ia: boolean;
  motivo_sem_ia: string | null;
  escala_irritacao: typeof ESCALA_IRRITACAO;
  analise: ResultadoIa | null;
  /** Sem IA: frases seguras escolhidas por regra (as primeiras de cada conversa). */
  citacoes: CitacaoAnalise[];
  palavras: { palavra: string; n: number }[];
  contagens: Contagens;
  comparacao: string[];
  pode_ver_conversas: boolean;
  titulo: string | null;
  guardada_em: Date | null;
  criada_em: Date;
  ms: number;
}

const esquemaGuardar = z.object({
  titulo: z.string().trim().min(3).max(140),
});

// 20 análises por utilizador por hora (em memória, por instância).
const LIMITE_HORA = 20;
const MAX_LINHAS = 20_000;
const MAX_CITACOES_SEM_IA = 4;

/**
 * "Pergunte ao concelho": o que os munícipes sentem, lido nas conversas.
 * Filtro e amostra em SQL e regras puras; a IA só lê os resumos e excertos
 * anonimizados e devolve referências; os números são contados aqui. Sem IA
 * fica a versão por contagens. Cada pergunta fica guardada e auditada.
 */
@Injectable()
export class ConcelhoService {
  private readonly logger = new Logger(ConcelhoService.name);
  private readonly limite = new LimitePedidos(LIMITE_HORA, 60 * 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------
  // Opções e sinais
  // -------------------------------------------------------------------

  async opcoes(m: Municipio) {
    const [freguesias, temas] = await Promise.all([
      this.freguesias(m.id),
      this.temas(m.id),
    ]);
    return {
      freguesias,
      temas,
      canais: Object.entries(ROTULO_CANAL).map(([valor, rotulo]) => ({
        valor,
        rotulo,
      })),
      faixas: Object.entries(FAIXAS).map(([valor, f]) => ({ valor, ...f })),
      escala_irritacao: ESCALA_IRRITACAO,
      ia_disponivel: this.claude.disponivel,
      limites: {
        conversas_lidas: MAX_CONVERSAS_IA,
        poucos_dados: POUCOS_DADOS,
      },
    };
  }

  /** Sugestões de pergunta a partir do que subiu nos últimos 7 dias. */
  async sinais(m: Municipio) {
    const hoje = hojeNoFuso(m.fuso);
    const linhas = await this.db.query<LinhaSinal>(
      `WITH base AS (${BASE})
       SELECT b.freguesia, b.tema_id, b.tema,
              count(*) FILTER (WHERE b.dia >= $4::date)::int AS n,
              count(*) FILTER (WHERE b.dia < $4::date)::int AS anterior
       FROM base b
       GROUP BY b.freguesia, b.tema_id, b.tema`,
      [m.id, somarDias(hoje, -13), hoje, somarDias(hoje, -6)],
    );
    return {
      hoje,
      sinais: sinaisDaSemana(linhas, hoje),
      exemplos: PERGUNTAS_EXEMPLO,
    };
  }

  // -------------------------------------------------------------------
  // Analisar
  // -------------------------------------------------------------------

  async analisar(
    m: Municipio,
    u: UtilizadorPainel,
    body: unknown,
    ip?: string | null,
  ) {
    const pedido = validar(esquemaAnalisar, body);
    if (!this.limite.permitir(u.id)) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiados_pedidos',
        `Já fez ${LIMITE_HORA} perguntas na última hora. Tente daqui a pouco.`,
      );
    }
    const inicio = Date.now();
    const hoje = hojeNoFuso(m.fuso);
    const [freguesias, temas] = await Promise.all([
      this.freguesias(m.id),
      this.temas(m.id),
    ]);
    const deduzidos = interpretarPergunta(pedido.pergunta, {
      hoje,
      freguesias,
      temas,
    });
    const filtros = resolverFiltros(pedido.filtros, deduzidos, hoje);
    // Só temas desta câmara (um id de outra não filtra nada, nem dá erro).
    filtros.tema_ids = filtros.tema_ids.filter((id) =>
      temas.some((t) => t.id === id),
    );
    const anterior = periodoAnterior(filtros.periodo);

    const linhas = await this.linhas(m, filtros);
    const contagens = contar(linhas, filtros.periodo);
    const atuais = linhas.filter((l) => l.atual);
    const amostra = escolherAmostra(atuais, MAX_CONVERSAS_IA);
    const detalhes = await this.detalhes(m, amostra);
    const citar = contagens.total >= MINIMO_PARA_CITAR;
    const permitidas = [m.nome, ...freguesias, ...temas.map((t) => t.nome)];
    const lidas = prepararLeitura(detalhes, { permitidas, citar });
    const nomes = [...new Set(detalhes.flatMap((d) => d.nomes))];

    const avisos: string[] = [];
    if (linhas.length >= MAX_LINHAS) {
      avisos.push(
        `Há mais de ${MAX_LINHAS.toLocaleString('pt-PT')} conversas com estes filtros: as contagens usam as primeiras. Escolha um período mais curto.`,
      );
    }
    const poucos = contagens.total < POUCOS_DADOS;
    if (contagens.total === 0) {
      avisos.push('Não há conversas com estes filtros no período.');
    } else if (poucos) {
      avisos.push(
        `Poucos dados: só ${contagens.total} ${contagens.total === 1 ? 'conversa' : 'conversas'} com estes filtros. Tire conclusões com cuidado.`,
      );
    }
    if (!citar && contagens.total > 0) {
      avisos.push(
        'Com tão poucas conversas não se mostram frases, para ninguém ser reconhecido.',
      );
    }
    if (filtros.faixa === 'lista_cuidado')
      avisos.push(FAIXAS.lista_cuidado.explicacao);

    let analise: ResultadoIa | null = null;
    let motivo: string | null = null;
    if (contagens.total === 0) {
      motivo = 'Sem conversas para ler.';
    } else if (!this.claude.disponivel) {
      motivo =
        'A análise por IA está indisponível (não configurada): mostram-se as contagens, as palavras mais repetidas e algumas frases.';
    } else {
      try {
        const bruto: unknown = await this.claude.extrair(esquemaAnaliseIa, {
          sistema: SISTEMA_CONCELHO,
          conteudo: conteudoIa(
            pedido.pergunta,
            { descricao: descreverFiltros(filtros, temas) },
            lidas,
          ),
          esforco: 'medium',
          maxTokens: 12_000,
        });
        analise = resolverAnaliseIa(bruto, lidas, {
          nomes,
          verConversas: true,
          citar,
        });
        if (!analise) {
          motivo =
            'A resposta da IA não veio no formato pedido: mostram-se as contagens. Tente outra vez.';
        }
      } catch (e) {
        this.logger.warn(
          `Pergunte ao concelho: ${e instanceof Error ? e.message : String(e)}`,
        );
        motivo =
          e instanceof ErroApi && e.codigo === 'ia_indisponivel'
            ? 'A análise por IA está indisponível agora: mostram-se as contagens. Tente daqui a pouco.'
            : 'Não foi possível fazer a análise por IA agora: mostram-se as contagens.';
      }
    }

    const ms = Date.now() - inicio;
    const resultado: Omit<
      AnaliseConcelho,
      'id' | 'criada_em' | 'pode_ver_conversas' | 'titulo' | 'guardada_em'
    > = {
      pergunta: pedido.pergunta,
      filtros: {
        ...filtros,
        descricao: descreverFiltros(filtros, temas),
        deduzidos: Object.keys(deduzidos).filter((k) => {
          const f = pedido.filtros ?? {};
          return k === 'periodo' ? !f.de && !f.ate : !(k in f);
        }),
      },
      anterior,
      conversas: {
        total: contagens.total,
        lidas: lidas.length,
        anterior_total: contagens.anterior_total,
        variacao: contagens.variacao,
      },
      amostragem:
        lidas.length < contagens.total
          ? `Lidas ${lidas.length} de ${contagens.total} conversas: uma amostra fixa (sempre a mesma para os mesmos filtros), repartida pelos temas. As contagens usam todas.`
          : `Lidas todas as ${contagens.total} conversas.`,
      poucos_dados: poucos,
      avisos,
      ia: !!analise,
      motivo_sem_ia: analise ? null : motivo,
      escala_irritacao: ESCALA_IRRITACAO,
      analise,
      citacoes: analise ? [] : citacoesPorRegra(lidas, citar),
      palavras: palavrasDosMunicipes(
        detalhes.flatMap((d) =>
          d.frases.map((texto) => ({ texto, nomes: d.nomes })),
        ),
      ),
      contagens,
      comparacao:
        contagens.total || contagens.anterior_total
          ? frasesComparacao(contagens)
          : [],
      ms,
    };

    const [g] = await this.db.query<{ id: string; criada_em: Date }>(
      `INSERT INTO concelho_analises
         (municipio_id, utilizador_id, pergunta, filtros, resultado, ia, conversas_total, conversas_lidas, ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, criada_em`,
      [
        m.id,
        u.id,
        pedido.pergunta,
        JSON.stringify(resultado.filtros),
        JSON.stringify(resultado),
        resultado.ia,
        contagens.total,
        lidas.length,
        ms,
      ],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'perguntar_concelho',
      objetoTipo: 'analise_concelho',
      objetoId: g.id,
      dados: {
        pergunta: pedido.pergunta,
        filtros: resultado.filtros.descricao,
        conversas_total: contagens.total,
        conversas_lidas: lidas.length,
        ia: resultado.ia,
      },
      ip: ip ?? null,
    });
    return paraUtilizador(
      {
        ...resultado,
        id: g.id,
        criada_em: g.criada_em,
        titulo: null,
        guardada_em: null,
      },
      u,
    );
  }

  // -------------------------------------------------------------------
  // Histórico, abrir, guardar
  // -------------------------------------------------------------------

  /** As minhas perguntas e as análises guardadas (partilhadas) da câmara. */
  async lista(m: Municipio, u: UtilizadorPainel, query: unknown) {
    const q = (query ?? {}) as Record<string, unknown>;
    const guardadas = q.guardadas === 'true' || q.guardadas === '1';
    const { limite, cursor } = validar(esquemaPaginacao, q);
    const linhas = await this.db.query<{
      id: string;
      pergunta: string;
      titulo: string | null;
      ia: boolean;
      conversas_total: number;
      conversas_lidas: number;
      descricao: string | null;
      guardada_em: Date | null;
      guardada_por: string | null;
      criada_em: Date;
      minha: boolean;
    }>(
      `SELECT a.id, a.pergunta, a.titulo, a.ia, a.conversas_total, a.conversas_lidas,
              a.filtros ->> 'descricao' AS descricao, a.guardada_em, g.nome AS guardada_por,
              a.criada_em, a.utilizador_id IS NOT DISTINCT FROM $2 AS minha
       FROM concelho_analises a
       LEFT JOIN utilizadores g ON g.id = a.guardada_por
       WHERE a.municipio_id = $1
         AND (CASE WHEN $3 THEN a.guardada_em IS NOT NULL ELSE a.utilizador_id = $2 END)
         AND ($4::timestamptz IS NULL OR (a.criada_em, a.id) < ($4, $5::uuid))
       ORDER BY a.criada_em DESC, a.id DESC
       LIMIT $6`,
      [
        m.id,
        u.id,
        guardadas,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: l.criada_em, id: l.id }));
  }

  async obter(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
  ): Promise<AnaliseConcelho> {
    const a = await this.porId(m, u, id);
    return paraUtilizador(a, u);
  }

  async guardar(m: Municipio, u: UtilizadorPainel, id: string, body: unknown) {
    const { titulo } = validar(esquemaGuardar, body);
    await this.porId(m, u, id);
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE concelho_analises SET titulo = $3, guardada_em = coalesce(guardada_em, now()), guardada_por = coalesce(guardada_por, $4)
       WHERE municipio_id = $1 AND id = $2 RETURNING id`,
      [m.id, id, titulo, u.id],
    );
    if (!r) throw naoEncontrada();
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'guardar_analise_concelho',
      objetoTipo: 'analise_concelho',
      objetoId: id,
      dados: { titulo },
    });
    return this.obter(m, u, id);
  }

  /** As minhas, ou as guardadas (partilhadas) da câmara. */
  private async porId(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
  ): Promise<Omit<AnaliseConcelho, 'pode_ver_conversas'>> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw naoEncontrada();
    const [l] = await this.db.query<{
      id: string;
      resultado: Omit<
        AnaliseConcelho,
        'id' | 'criada_em' | 'titulo' | 'guardada_em' | 'pode_ver_conversas'
      >;
      titulo: string | null;
      guardada_em: Date | null;
      criada_em: Date;
    }>(
      `SELECT id, resultado, titulo, guardada_em, criada_em FROM concelho_analises
       WHERE municipio_id = $1 AND id = $2
         AND (utilizador_id = $3 OR guardada_em IS NOT NULL)`,
      [m.id, id, u.id],
    );
    if (!l) throw naoEncontrada();
    return {
      ...l.resultado,
      id: l.id,
      titulo: l.titulo,
      guardada_em: l.guardada_em,
      criada_em: l.criada_em,
    };
  }

  // -------------------------------------------------------------------
  // Leituras
  // -------------------------------------------------------------------

  /** As conversas do período e do anterior, com os filtros (sem texto). */
  private async linhas(m: Municipio, f: Filtros): Promise<LinhaConversa[]> {
    const anterior = periodoAnterior(f.periodo);
    const texto = f.texto
      ? `%${f.texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      : null;
    return this.db.query<LinhaConversa>(
      `WITH base AS (${BASE})
       SELECT b.id, to_char(b.dia, 'YYYY-MM-DD') AS dia, b.canal, b.resultado, b.tema_id, b.tema,
              b.freguesia, b.dia >= $4::date AS atual
       FROM base b
       WHERE ($5::text[] IS NULL OR lower(b.freguesia) = ANY($5::text[]))
         AND ($6::text[] IS NULL OR b.canal = ANY($6::text[]))
         AND ($7::uuid[] IS NULL OR b.tema_id = ANY($7::uuid[]))
         AND (NOT $8::boolean OR b.lista_cuidado)
         AND ($9::text IS NULL OR b.resumo ILIKE $9 OR EXISTS (
               SELECT 1 FROM conversa_turnos tu
               WHERE tu.conversa_id = b.id AND tu.papel = 'municipe' AND tu.texto ILIKE $9))
       ORDER BY b.dia, b.id
       LIMIT ${MAX_LINHAS}`,
      [
        m.id,
        anterior.de,
        f.periodo.ate,
        f.periodo.de,
        f.freguesias.length ? f.freguesias.map((x) => x.toLowerCase()) : null,
        f.canais.length ? f.canais : null,
        f.tema_ids.length ? f.tema_ids : null,
        f.faixa === 'lista_cuidado',
        texto,
      ],
    );
  }

  /** Resumo, frases do munícipe e os nomes conhecidos (só para os tirar). */
  private async detalhes(m: Municipio, amostra: LinhaConversa[]) {
    if (!amostra.length) return [];
    const linhas = await this.db.query<{
      id: string;
      resumo: string | null;
      nomes: string[];
      frases: string[];
    }>(
      `SELECT c.id, c.resumo,
              array_remove(ARRAY[mu.nome, cc.nome], NULL) AS nomes,
              coalesce((SELECT array_agg(x.texto ORDER BY x.ordem) FROM (
                 SELECT tu.texto, tu.ordem FROM conversa_turnos tu
                 WHERE tu.conversa_id = c.id AND tu.papel = 'municipe'
                   AND tu.texto <> $3 AND length(tu.texto) BETWEEN 15 AND 600
                 ORDER BY tu.ordem LIMIT 6) x), '{}') AS frases
       FROM conversas c
       LEFT JOIN municipes mu ON mu.id = c.municipe_id
       LEFT JOIN contactos_cuidado cc ON cc.municipio_id = c.municipio_id AND cc.municipe_id = c.municipe_id
       WHERE c.municipio_id = $1 AND c.id = ANY($2::uuid[])`,
      [m.id, amostra.map((a) => a.id), TEXTO_ANONIMIZADO],
    );
    const porId = new Map(linhas.map((l) => [l.id, l]));
    return amostra.flatMap((a) => {
      const d = porId.get(a.id);
      if (!d) return [];
      return [{ ...a, resumo: d.resumo, nomes: d.nomes, frases: d.frases }];
    });
  }

  async freguesias(municipioId: string): Promise<string[]> {
    const linhas = await this.db.query<{ freguesia: string }>(
      `SELECT DISTINCT freguesia FROM (
         SELECT unnest(freguesias) AS freguesia FROM consultas_publicas WHERE municipio_id = $1
         UNION SELECT freguesia FROM contactos_cuidado WHERE municipio_id = $1
         UNION SELECT freguesia FROM processos WHERE municipio_id = $1
         UNION SELECT freguesia FROM conversas WHERE municipio_id = $1 AND freguesia IS NOT NULL
         UNION SELECT morada_freguesia FROM municipes WHERE municipio_id = $1 AND morada_freguesia IS NOT NULL
       ) f WHERE freguesia IS NOT NULL AND length(trim(freguesia)) > 1
       ORDER BY freguesia LIMIT 300`,
      [municipioId],
    );
    return linhas.map((l) => l.freguesia);
  }

  private temas(municipioId: string): Promise<TemaConhecido[]> {
    return this.db.query<TemaConhecido>(
      'SELECT id, nome FROM temas WHERE municipio_id = $1 ORDER BY nome',
      [municipioId],
    );
  }
}

/**
 * As conversas do município entre dois dias locais ($2 a $3), sem as
 * escondidas nem as que ainda estão a decorrer, com a freguesia quando se
 * sabe: a da conversa, a da morada preferida do munícipe, a da lista da ação
 * social ou a da ocorrência registada na conversa.
 */
const BASE = `
  SELECT c.id, (c.iniciada_em AT TIME ZONE m.fuso)::date AS dia, c.canal::text AS canal,
         c.resultado::text AS resultado, c.tema_id, t.nome AS tema,
         coalesce(c.freguesia, mu.morada_freguesia, cc.freguesia, oc.freguesia) AS freguesia,
         cc.id IS NOT NULL AS lista_cuidado, c.resumo
  FROM conversas c
  JOIN municipios m ON m.id = c.municipio_id
  LEFT JOIN temas t ON t.id = c.tema_id
  LEFT JOIN municipes mu ON mu.id = c.municipe_id
  LEFT JOIN contactos_cuidado cc
    ON cc.municipio_id = c.municipio_id AND cc.municipe_id = c.municipe_id AND cc.ativo
  LEFT JOIN LATERAL (
    SELECT al.freguesia FROM ocorrencias o
    JOIN agora_locais al ON al.fonte = 'ocorrencia' AND al.fonte_id = o.id
    WHERE o.conversa_id = c.id AND al.freguesia IS NOT NULL
    LIMIT 1) oc ON true
  WHERE c.municipio_id = $1 AND c.oculto_em IS NULL AND c.resultado <> 'em_curso'
    AND c.iniciada_em >= ($2::date::timestamp AT TIME ZONE m.fuso)
    AND c.iniciada_em < (($3::date + 1)::timestamp AT TIME ZONE m.fuso)`;

/** Sem IA: a primeira frase segura de cada conversa lida, até 4. */
function citacoesPorRegra(
  lidas: readonly ConversaLida[],
  citar: boolean,
): CitacaoAnalise[] {
  if (!citar) return [];
  const r: CitacaoAnalise[] = [];
  for (const c of lidas) {
    if (r.length >= MAX_CITACOES_SEM_IA) break;
    const e = c.excertos.find((x) => x.citavel);
    if (!e?.citavel) continue;
    r.push({
      texto: e.citavel,
      tema: c.tema,
      dia: c.dia,
      canal: c.canal,
      freguesia: c.freguesia,
      conversa_id: c.id,
    });
  }
  return r;
}

/** Quem não pode ver conversas vê quantas suportam cada afirmação, mas não quais. */
export function paraUtilizador(
  a: Omit<AnaliseConcelho, 'pode_ver_conversas'>,
  u: Pick<UtilizadorPainel, 'perfil'>,
): AnaliseConcelho {
  const ver = pode(u.perfil, 'conversas');
  if (ver) return { ...a, pode_ver_conversas: true };
  const semIds = <T extends { conversas: string[] | null }>(x: T): T => ({
    ...x,
    conversas: null,
  });
  return {
    ...a,
    pode_ver_conversas: false,
    citacoes: a.citacoes.map((c) => ({ ...c, conversa_id: null })),
    analise: a.analise
      ? {
          ...a.analise,
          temas: a.analise.temas.map((t) => ({
            ...semIds(t),
            causas: t.causas.map(semIds),
          })),
          sugestoes: a.analise.sugestoes.map(semIds),
          citacoes: a.analise.citacoes.map((c) => ({
            ...c,
            conversa_id: null,
          })),
        }
      : null,
  };
}

function naoEncontrada() {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'nao_encontrada',
    'Esta análise não existe ou não é sua.',
  );
}
