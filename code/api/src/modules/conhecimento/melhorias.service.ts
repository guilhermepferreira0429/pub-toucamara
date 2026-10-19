import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConhecimentoService } from './conhecimento.service.js';
import {
  emailMelhoria,
  EstadoMelhoria,
  Grupo,
  limparGrupos,
  PerguntaAberta,
  protegerValores,
  refPergunta,
  resolverRef,
  transicaoPermitida,
} from './melhorias.js';

export const JOB_MELHORIAS = 'propor_melhorias';

export interface DadosMelhorias {
  municipio_id?: string;
}

/** Perguntas mandadas à IA por execução (as mais frequentes). */
export const MAX_PERGUNTAS = 60;
/** Melhorias propostas no máximo por execução (custo e atenção da câmara). */
export const MAX_GRUPOS = 8;
/** Frases reais por pergunta (no painel e no pedido à IA). */
const EXEMPLOS = 3;
/** Páginas do portal que a IA vê para escolher onde pôr. */
const MAX_PAGINAS = 80;

/** Perguntas que ainda contam como abertas. */
const PSR_ABERTA = `p.estado IN ('nova', 'com_equipa', 'espera_camara')`;
/** A pergunta já está numa melhoria ativa. */
const EM_MELHORIA_ATIVA = `EXISTS (
  SELECT 1 FROM melhoria_perguntas mp JOIN melhorias_portal mm ON mm.id = mp.melhoria_id
  WHERE mp.psr_id = p.id AND mm.estado IN ('proposta', 'enviada'))`;
/**
 * Rejeitada e sem perguntas novas desde então: não se volta a propor (se a
 * pergunta voltar a aparecer depois da rejeição, volta a contar).
 */
const REJEITADA_SEM_NOVIDADES = `EXISTS (
  SELECT 1 FROM melhoria_perguntas mp JOIN melhorias_portal mm ON mm.id = mp.melhoria_id
  WHERE mp.psr_id = p.id AND mm.estado = 'rejeitada' AND mm.rejeitada_em >= p.ultima_em)`;

const esquemaGrupos = z.object({
  grupos: z.array(
    z.object({
      tema: z
        .string()
        .describe('Curto, ex.: "Ecocentro · horário ao fim de semana".'),
      perguntas: z
        .array(z.string())
        .describe('Referências das perguntas do grupo, ex.: ["P1", "P7"].'),
    }),
  ),
});

const esquemaProposta = z.object({
  titulo: z
    .string()
    .describe('Curto, ex.: "Horário do ecocentro ao fim de semana".'),
  o_que_falta: z
    .string()
    .describe(
      'Uma ou duas frases: o que os munícipes procuram e o portal não diz (ou não deixa encontrar).',
    ),
  ja_existe: z
    .boolean()
    .describe(
      'true se as fontes oficiais já respondem: a melhoria é tornar a informação visível/encontrável.',
    ),
  fonte_existente: z
    .string()
    .describe('Se ja_existe, o trecho onde está (ex.: "T2"); senão "".'),
  sugestao: z
    .string()
    .describe(
      'Texto proposto para o portal, em linguagem simples, com "[a confirmar pela câmara: …]" no que não está nas fontes.',
    ),
  onde_pagina: z
    .string()
    .describe('Página do portal onde pôr (ex.: "F3"); "" se nenhuma serve.'),
  onde_texto: z
    .string()
    .describe(
      'Se nenhuma página serve, a secção sugerida em texto livre (ex.: "Ambiente › Ecocentros"); senão "".',
    ),
  entidade: z
    .string()
    .describe(
      'A entidade dona da informação (ex.: "E2"); "" se não se percebe.',
    ),
});

const SISTEMA_AGRUPAR = `Agrupas perguntas que munícipes fizeram ao serviço de atendimento de uma câmara municipal portuguesa (telefone e chat) e a que o agente não soube responder por falta de informação publicada.
Põe no mesmo grupo as perguntas que uma mesma informação no portal resolveria: o mesmo assunto concreto (ex.: horário do ecocentro ao fim de semana; documentos para a licença de ruído). Não juntes assuntos diferentes só por serem da mesma área. Uma pergunta sozinha pode ser um grupo.
Cada pergunta (P1, P2...) vai no máximo num grupo. Deixa de fora as que não são sobre serviços públicos do concelho (conversa de circunstância, testes, insultos).
Temas em português de Portugal.`;

const SISTEMA_PROPOR = `Propões melhorias ao portal (site) de uma câmara municipal portuguesa a partir de perguntas que os munícipes fizeram ao atendimento e ficaram sem resposta.
Recebes o assunto, as perguntas (forma canónica, quantas vezes e frases reais), as entidades do concelho (E1, E2...), as páginas do portal (F1, F2...), o que as fontes oficiais já dizem sobre o assunto (T1, T2...) e as respostas curadas que o agente já usa (R1, R2...).

Regras:
- Se as fontes já respondem às perguntas, ja_existe=true, fonte_existente é o trecho e a melhoria é tornar a informação visível e fácil de encontrar (onde pôr, que título ou ligação usar); a sugestão pode reaproveitar o texto das fontes.
- Se não respondem, escreve o texto que falta no portal: curto, claro, frases simples, com o que o munícipe precisa de saber para resolver (o que é, quem trata, como pedir, documentos, custos, prazos, contactos).
- Nunca inventes valores, prazos, horários, montantes, documentos, moradas, telefones, emails ou endereços. O que não estiver nos trechos fica como "[a confirmar pela câmara: o que falta saber]", ex.: "O ecocentro abre ao sábado [a confirmar pela câmara: horário de sábado]."
- onde_pagina: a página do portal onde o texto encaixa melhor (da mesma entidade, de preferência); se nenhuma serve, deixa "" e sugere a secção em onde_texto.
- entidade: quem presta o serviço e publica a informação (ex.: a empresa municipal da água para avarias e faturas da água), não necessariamente a câmara.
- Português de Portugal, sem emojis, sem markdown além de listas simples com "-".`;

interface MelhoriaLinha {
  id: string;
  titulo: string;
  o_que_falta: string;
  sugestao: string;
  tipo: 'nova_informacao' | 'tornar_visivel';
  onde: string | null;
  onde_fonte_id: string | null;
  onde_url: string | null;
  fonte_existente_id: string | null;
  fonte_existente: string | null;
  fonte_existente_url: string | null;
  entidade_id: string | null;
  entidade: string | null;
  servico_id: string | null;
  servico: string | null;
  estado: EstadoMelhoria;
  criada_em: Date;
  atualizada_em: Date;
  enviada_em: Date | null;
  enviada_para: string | null;
  publicada_em: Date | null;
  rejeitada_em: Date | null;
  notas: string | null;
  vezes: number;
}

interface PerguntaLigada {
  id: string;
  texto: string;
  vezes: number;
  estado: string;
  primeira_em: Date;
  ultima_em: Date;
}

interface Responsavel {
  entidade_id: string | null;
  entidade: string | null;
  servico_email: string | null;
  entidade_email: string | null;
}

/**
 * "Perguntas sem resposta viram melhorias ao portal".
 *
 * Job `propor_melhorias` (segunda 07:00, antes do relatório semanal, e
 * manual no painel): por município, as perguntas sem resposta abertas mais
 * frequentes (até `MAX_PERGUNTAS`, fora as que já estão numa melhoria ativa)
 * são agrupadas por assunto pela IA; para cada grupo (até `MAX_GRUPOS`) vê o
 * que as fontes já dizem (`ConhecimentoService.procurar`) e propõe o texto em
 * falta. Os valores que não vêm das fontes ficam marcados para a câmara
 * confirmar (`protegerValores`).
 *
 * Painel: listar, ver, mudar estado, enviar ao responsável, resumo.
 */
@Injectable()
export class MelhoriasService {
  private readonly logger = new Logger(MelhoriasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly conhecimento: ConhecimentoService,
    private readonly jobs: JobsService,
    private readonly auditoria: AuditoriaService,
    private readonly mensagens: MensagensService,
  ) {}

  // -------------------------------------------------------------------------
  // Job
  // -------------------------------------------------------------------------

  async correr(d: DadosMelhorias = {}): Promise<void> {
    if (!this.claude.disponivel) {
      this.logger.warn('Sem IA: melhorias ao portal por propor.');
      return;
    }
    const municipios = d.municipio_id
      ? [d.municipio_id]
      : (
          await this.db.query<{ municipio_id: string }>(
            `SELECT DISTINCT p.municipio_id FROM perguntas_sem_resposta p WHERE ${PSR_ABERTA}`,
          )
        ).map((m) => m.municipio_id);
    for (const m of municipios) await this.correrMunicipio(m);
  }

  /** Devolve quantas melhorias criou. */
  async correrMunicipio(municipioId: string): Promise<number> {
    const perguntas = await this.db.query<PerguntaAberta>(
      `SELECT p.id, p.texto, p.vezes FROM perguntas_sem_resposta p
       WHERE p.municipio_id = $1 AND ${PSR_ABERTA}
         AND NOT ${EM_MELHORIA_ATIVA} AND NOT ${REJEITADA_SEM_NOVIDADES}
       ORDER BY p.vezes DESC, p.ultima_em DESC, p.id
       LIMIT $2`,
      [municipioId, MAX_PERGUNTAS],
    );
    if (!perguntas.length) return 0;

    const { grupos } = await this.claude.extrair(esquemaGrupos, {
      sistema: SISTEMA_AGRUPAR,
      esforco: 'low',
      maxTokens: 8000,
      conteudo: perguntas
        .map((p, i) => `${refPergunta(i)} (${p.vezes}×): ${p.texto}`)
        .join('\n'),
    });
    const escolhidos = limparGrupos(grupos, perguntas).slice(0, MAX_GRUPOS);
    if (!escolhidos.length) return 0;

    const contexto = await this.contexto(municipioId);
    let criadas = 0;
    let falhas = 0;
    let ultimoErro: unknown = null;
    for (const g of escolhidos) {
      try {
        if (await this.propor(municipioId, g, contexto)) criadas++;
      } catch (e) {
        falhas++;
        ultimoErro = e;
        this.logger.warn(
          `Melhoria "${g.tema}" falhou: ${(e as Error).message}`,
        );
      }
    }
    // Tudo falhou (IA em baixo): o job repete mais tarde.
    if (falhas === escolhidos.length) throw ultimoErro;
    return criadas;
  }

  private async contexto(municipioId: string) {
    const [[municipio], entidades, paginas] = await Promise.all([
      this.db.query<{ nome: string }>(
        `SELECT nome FROM municipios WHERE id = $1`,
        [municipioId],
      ),
      this.db.query<{
        id: string;
        nome: string;
        tipo: string;
        descricao: string | null;
      }>(
        `SELECT id, nome, tipo, descricao FROM entidades
         WHERE municipio_id = $1 AND ativo ORDER BY nome`,
        [municipioId],
      ),
      this.db.query<{
        id: string;
        titulo: string;
        url: string;
        entidade_id: string;
        entidade: string;
      }>(
        `SELECT fo.id, fo.titulo, fo.url, fo.entidade_id, e.nome AS entidade
         FROM fontes fo JOIN entidades e ON e.id = fo.entidade_id
         WHERE fo.municipio_id = $1 AND fo.tipo = 'pagina'
         ORDER BY e.nome, fo.titulo LIMIT $2`,
        [municipioId, MAX_PAGINAS],
      ),
    ]);
    return { municipio: municipio?.nome ?? '', entidades, paginas };
  }

  private async propor(
    municipioId: string,
    g: Grupo,
    ctx: Awaited<ReturnType<MelhoriasService['contexto']>>,
  ): Promise<boolean> {
    const consulta = [g.tema, ...g.perguntas.slice(0, 3).map((p) => p.texto)]
      .join(' ')
      .slice(0, 500);
    const [pesquisa, exemplos] = await Promise.all([
      this.conhecimento.procurar(municipioId, consulta, 5),
      this.exemplos(g.perguntas.map((p) => p.id)),
    ]);
    const trechos = pesquisa.trechos;

    const linhas = [
      `Município: ${ctx.municipio}`,
      `Assunto: ${g.tema}`,
      ``,
      `Perguntas dos munícipes:`,
      ...g.perguntas.flatMap((p) => {
        const ex = exemplos.get(p.id) ?? [];
        return [
          `- ${p.texto} (${p.vezes}×)`,
          ...ex.map((f) => `  frase real: "${f}"`),
        ];
      }),
      ``,
      `Entidades do concelho:`,
      ...ctx.entidades.map(
        (e, i) =>
          `E${i + 1} · ${e.nome} (${e.tipo})${e.descricao ? ` · ${e.descricao}` : ''}`,
      ),
      ``,
      `Páginas do portal:`,
      ...(ctx.paginas.length
        ? ctx.paginas.map(
            (f, i) => `F${i + 1} · ${f.titulo} · ${f.url} (${f.entidade})`,
          )
        : ['(nenhuma registada)']),
      ``,
      `O que as fontes oficiais já dizem:`,
      ...(trechos.length
        ? trechos.map(
            (t, i) =>
              `T${i + 1} · ${t.titulo}${t.referencia ? `, ${t.referencia}` : ''} (${t.entidade}, ${t.url})\n${t.texto.slice(0, 1500)}`,
          )
        : ['(nada encontrado)']),
      ``,
      `Respostas curadas que o agente já usa:`,
      ...(pesquisa.respostas.length
        ? pesquisa.respostas.map(
            (r, i) => `R${i + 1} · ${r.pergunta}: ${r.texto}`,
          )
        : ['(nenhuma)']),
    ];

    const p = await this.claude.extrair(esquemaProposta, {
      sistema: SISTEMA_PROPOR,
      esforco: 'medium',
      maxTokens: 8000,
      conteudo: linhas.join('\n'),
    });

    const fontesTexto = [
      ...trechos.map((t) => t.texto),
      ...pesquisa.respostas.map((r) => r.texto),
    ];
    const { texto: sugestao } = protegerValores(p.sugestao.trim(), fontesTexto);
    const pagina = resolverRef(p.onde_pagina, 'F', ctx.paginas);
    const entidade = resolverRef(p.entidade, 'E', ctx.entidades);
    const trecho = p.ja_existe
      ? resolverRef(p.fonte_existente, 'T', trechos)
      : null;
    const [existente] = trecho
      ? await this.db.query<{ fonte_id: string }>(
          `SELECT fv.fonte_id FROM trechos t
           JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id WHERE t.id = $1`,
          [trecho.trecho_id],
        )
      : [];

    const titulo = p.titulo.trim().slice(0, 200) || g.tema;
    const oQueFalta = p.o_que_falta.trim().slice(0, 2000);
    if (!sugestao || !oQueFalta) {
      throw new Error('A IA devolveu uma proposta vazia.');
    }

    return this.db.transaction(async (tx) => {
      // Outra execução pode ter ligado estas perguntas entretanto: trancar as
      // perguntas e só depois ver as ligações (instrução nova, dados novos).
      const ids = g.perguntas.map((x) => x.id);
      await tx.query(
        `SELECT id FROM perguntas_sem_resposta WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [ids],
      );
      const livres = await tx.query<{ id: string }>(
        `SELECT p.id FROM perguntas_sem_resposta p
         WHERE p.id = ANY($1::uuid[]) AND p.municipio_id = $2
           AND ${PSR_ABERTA} AND NOT ${EM_MELHORIA_ATIVA}`,
        [ids, municipioId],
      );
      if (!livres.length) return false;

      const [m] = await tx.query<{ id: string }>(
        `INSERT INTO melhorias_portal (municipio_id, titulo, o_que_falta, sugestao, tipo,
           onde, onde_fonte_id, fonte_existente_id, entidade_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          municipioId,
          titulo,
          oQueFalta,
          sugestao,
          existente ? 'tornar_visivel' : 'nova_informacao',
          pagina?.titulo ?? (p.onde_texto.trim().slice(0, 300) || null),
          pagina?.id ?? null,
          existente?.fonte_id ?? null,
          entidade?.id ?? pagina?.entidade_id ?? null,
        ],
      );
      await tx.query(
        `INSERT INTO melhoria_perguntas (melhoria_id, psr_id)
         SELECT $1, unnest($2::uuid[])`,
        [m.id, livres.map((l) => l.id)],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'sistema',
          acao: 'propor',
          objetoTipo: 'melhoria_portal',
          objetoId: m.id,
          dados: { perguntas: livres.length },
        },
        tx,
      );
      return true;
    });
  }

  /** Frases reais (os turnos onde a pergunta apareceu), das mais recentes. */
  private async exemplos(psrIds: string[]): Promise<Map<string, string[]>> {
    const linhas = await this.db.query<{ psr_id: string; texto: string }>(
      `SELECT x.psr_id, x.texto FROM (
         SELECT o.psr_id, t.texto,
                row_number() OVER (PARTITION BY o.psr_id ORDER BY t.id DESC) AS n
         FROM pergunta_sem_resposta_ocorrencias o
         JOIN conversa_turnos t ON t.id = o.turno_id
         WHERE o.psr_id = ANY($1::uuid[])
       ) x
       WHERE x.n <= $2`,
      [psrIds, EXEMPLOS],
    );
    const m = new Map<string, string[]>();
    for (const l of linhas) {
      const texto = l.texto.replace(/\s+/g, ' ').trim().slice(0, 300);
      m.set(l.psr_id, [...(m.get(l.psr_id) ?? []), texto]);
    }
    return m;
  }

  // -------------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------------

  /** "Gerar agora": sem IA é 503, para o painel o dizer em vez de esperar. */
  async gerar(municipioId: string, u: UtilizadorPainel) {
    if (!this.claude.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'IA não configurada: não é possível propor melhorias.',
      );
    }
    const job = await this.jobs.enviar(
      JOB_MELHORIAS,
      { municipio_id: municipioId },
      { singletonKey: `melhorias:${municipioId}` },
    );
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'gerar_melhorias',
      objetoTipo: 'municipio',
      objetoId: municipioId,
    });
    return { em_fila: job !== null };
  }

  /** Por vezes (soma das perguntas ligadas) desc; o cursor leva-as no `em`. */
  async listar(
    municipioId: string,
    estado: EstadoMelhoria | undefined,
    limite: number,
    cursor: Cursor | null,
  ) {
    const vezes = cursor ? parseInt(cursor.em, 10) : null;
    const linhas = await this.db.query<{ id: string; vezes: number }>(
      `WITH m AS (
         SELECT m.id, m.titulo, m.o_que_falta, m.tipo, m.onde, m.onde_fonte_id,
                m.entidade_id, e.nome AS entidade, m.estado, m.criada_em,
                m.enviada_em, m.enviada_para, m.publicada_em,
                (SELECT count(*) FROM melhoria_perguntas mp WHERE mp.melhoria_id = m.id)::int AS perguntas,
                (SELECT coalesce(sum(p.vezes), 0) FROM melhoria_perguntas mp
                 JOIN perguntas_sem_resposta p ON p.id = mp.psr_id
                 WHERE mp.melhoria_id = m.id)::int AS vezes
         FROM melhorias_portal m
         LEFT JOIN entidades e ON e.id = m.entidade_id
         WHERE m.municipio_id = $1 AND ($2::text IS NULL OR m.estado = $2)
       )
       SELECT * FROM m
       WHERE ($3::int IS NULL OR (vezes, id) < ($3::int, $4::uuid))
       ORDER BY vezes DESC, id DESC
       LIMIT $5`,
      [
        municipioId,
        estado ?? null,
        Number.isFinite(vezes) ? vezes : null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: String(l.vezes), id: l.id }));
  }

  async ver(municipioId: string, id: string) {
    const [m] = await this.db.query<MelhoriaLinha>(
      `SELECT m.id, m.titulo, m.o_que_falta, m.sugestao, m.tipo, m.onde,
              m.onde_fonte_id, fo.url AS onde_url,
              m.fonte_existente_id, fe.titulo AS fonte_existente, fe.url AS fonte_existente_url,
              m.entidade_id, e.nome AS entidade, m.servico_id, s.nome AS servico,
              m.estado, m.criada_em, m.atualizada_em, m.enviada_em, m.enviada_para,
              m.publicada_em, m.rejeitada_em, m.notas,
              (SELECT coalesce(sum(p.vezes), 0) FROM melhoria_perguntas mp
               JOIN perguntas_sem_resposta p ON p.id = mp.psr_id
               WHERE mp.melhoria_id = m.id)::int AS vezes
       FROM melhorias_portal m
       LEFT JOIN fontes fo ON fo.id = m.onde_fonte_id
       LEFT JOIN fontes fe ON fe.id = m.fonte_existente_id
       LEFT JOIN entidades e ON e.id = m.entidade_id
       LEFT JOIN servicos s ON s.id = m.servico_id
       WHERE m.id = $1 AND m.municipio_id = $2`,
      [id, municipioId],
    );
    if (!m) throw naoEncontrada();
    const perguntas = await this.db.query<PerguntaLigada>(
      `SELECT p.id, p.texto, p.vezes, p.estado, p.primeira_em, p.ultima_em
       FROM melhoria_perguntas mp JOIN perguntas_sem_resposta p ON p.id = mp.psr_id
       WHERE mp.melhoria_id = $1
       ORDER BY p.vezes DESC, p.id`,
      [id],
    );
    const exemplos = await this.exemplos(perguntas.map((p) => p.id));
    return {
      ...m,
      perguntas: perguntas.map((p) => ({
        ...p,
        exemplos: exemplos.get(p.id) ?? [],
      })),
    };
  }

  async atualizar(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: {
      estado?: EstadoMelhoria;
      titulo?: string;
      sugestao?: string;
      onde?: string | null;
      entidade_id?: string | null;
      servico_id?: string | null;
      notas?: string | null;
    },
  ) {
    if (d.entidade_id)
      await this.existe('entidades', d.entidade_id, municipioId);
    if (d.servico_id) await this.existe('servicos', d.servico_id, municipioId);

    const resolvidas = await this.db.transaction(async (tx) => {
      const [atual] = await tx.query<{ estado: EstadoMelhoria }>(
        `SELECT estado FROM melhorias_portal WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [id, municipioId],
      );
      if (!atual) throw naoEncontrada();
      const estado = d.estado ?? atual.estado;
      if (!transicaoPermitida(atual.estado, estado)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'transicao_invalida',
          `Uma melhoria ${atual.estado} não pode passar a ${estado}.`,
          { de: atual.estado, para: estado },
        );
      }
      const muda = estado !== atual.estado;
      await tx.query(
        `UPDATE melhorias_portal SET
           estado = $3,
           titulo = coalesce($4, titulo),
           sugestao = coalesce($5, sugestao),
           onde = CASE WHEN $6 THEN $7 ELSE onde END,
           entidade_id = CASE WHEN $8 THEN $9::uuid ELSE entidade_id END,
           servico_id = CASE WHEN $10 THEN $11::uuid ELSE servico_id END,
           notas = CASE WHEN $12 THEN $13 ELSE notas END,
           publicada_em = CASE WHEN $14 AND $3 = 'publicada' THEN now() ELSE publicada_em END,
           rejeitada_em = CASE WHEN $14 AND $3 = 'rejeitada' THEN now() ELSE rejeitada_em END,
           atualizada_em = now()
         WHERE id = $1 AND municipio_id = $2`,
        [
          id,
          municipioId,
          estado,
          d.titulo ?? null,
          d.sugestao ?? null,
          d.onde !== undefined,
          d.onde ?? null,
          d.entidade_id !== undefined,
          d.entidade_id ?? null,
          d.servico_id !== undefined,
          d.servico_id ?? null,
          d.notas !== undefined,
          d.notas ?? null,
          muda,
        ],
      );
      // Publicada: as perguntas abertas ligadas ficam resolvidas.
      let n = 0;
      if (muda && estado === 'publicada') {
        const r = await tx.query(
          `UPDATE perguntas_sem_resposta p SET estado = 'resolvida'
           FROM melhoria_perguntas mp
           WHERE mp.melhoria_id = $1 AND p.id = mp.psr_id AND ${PSR_ABERTA}
           RETURNING p.id`,
          [id],
        );
        n = r.length;
      }
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'atualizar',
          objetoTipo: 'melhoria_portal',
          objetoId: id,
          dados: { ...d, de: atual.estado, perguntas_resolvidas: n },
        },
        tx,
      );
      return n;
    });
    return {
      ...(await this.ver(municipioId, id)),
      perguntas_resolvidas: resolvidas,
    };
  }

  /**
   * Email ao responsável: o do pedido, se vier; senão o do serviço; senão o
   * email da entidade. Passa a 'enviada' (pode reenviar-se).
   */
  async enviar(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    email: string | undefined,
  ) {
    const v = await this.ver(municipioId, id);
    const estado = v.estado;
    if (!transicaoPermitida(estado, 'enviada')) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'transicao_invalida',
        `Uma melhoria ${estado} já não se envia.`,
        { de: estado, para: 'enviada' },
      );
    }
    const [r] = await this.db.query<Responsavel>(
      `SELECT m.entidade_id, e.nome AS entidade, s.email AS servico_email,
              (SELECT c.valor FROM entidade_contactos c
               WHERE c.entidade_id = m.entidade_id AND c.tipo = 'email'
               ORDER BY c.id LIMIT 1) AS entidade_email
       FROM melhorias_portal m
       LEFT JOIN entidades e ON e.id = m.entidade_id
       LEFT JOIN servicos s ON s.id = m.servico_id
       WHERE m.id = $1`,
      [id],
    );
    const para = email ?? r?.servico_email ?? r?.entidade_email ?? null;
    if (!para) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'sem_destinatario',
        'Não há email do serviço nem da entidade: indique o email.',
      );
    }

    const [municipio] = await this.db.query<{ nome: string }>(
      `SELECT nome FROM municipios WHERE id = $1`,
      [municipioId],
    );
    const { assunto, texto } = emailMelhoria({
      municipio: municipio?.nome ?? '',
      titulo: v.titulo,
      o_que_falta: v.o_que_falta,
      sugestao: v.sugestao,
      tipo: v.tipo,
      onde: v.onde,
      onde_url: v.onde_url,
      fonte_existente:
        v.fonte_existente && v.fonte_existente_url
          ? { titulo: v.fonte_existente, url: v.fonte_existente_url }
          : null,
      entidade: r?.entidade ?? null,
      notas: v.notas,
      perguntas: v.perguntas,
    });
    await this.mensagens.email({ para, assunto, texto });

    await this.db.query(
      `UPDATE melhorias_portal SET estado = 'enviada', enviada_em = now(),
         enviada_para = $3, atualizada_em = now()
       WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId, para],
    );
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'enviar',
      objetoTipo: 'melhoria_portal',
      objetoId: id,
      dados: { para, de: estado },
    });
    return this.ver(municipioId, id);
  }

  /**
   * Métrica do PRD ("perguntas sem resposta que levaram a melhorar o
   * portal"), para a visão geral e o relatório mensal. Com `de`/`ate`, cada
   * contagem usa a sua data (criada, enviada, publicada).
   */
  async resumo(municipioId: string, de?: string, ate?: string) {
    const [r] = await this.db.query(
      `WITH m AS (
         SELECT * FROM melhorias_portal WHERE municipio_id = $1
       ),
       dentro AS (
         SELECT $2::date AS de, $3::date AS ate
       ),
       publicadas AS (
         SELECT m.id FROM m, dentro
         WHERE m.estado = 'publicada'
           AND (dentro.de IS NULL OR m.publicada_em >= dentro.de)
           AND (dentro.ate IS NULL OR m.publicada_em < dentro.ate + 1)
       ),
       resolvidas AS (
         SELECT DISTINCT p.id, p.vezes
         FROM publicadas pu
         JOIN melhoria_perguntas mp ON mp.melhoria_id = pu.id
         JOIN perguntas_sem_resposta p ON p.id = mp.psr_id
         WHERE p.estado = 'resolvida'
       )
       SELECT
         (SELECT count(*) FROM m, dentro WHERE m.estado = 'proposta'
            AND (dentro.de IS NULL OR m.criada_em >= dentro.de)
            AND (dentro.ate IS NULL OR m.criada_em < dentro.ate + 1))::int AS propostas,
         (SELECT count(*) FROM m, dentro WHERE m.estado = 'enviada'
            AND (dentro.de IS NULL OR m.enviada_em >= dentro.de)
            AND (dentro.ate IS NULL OR m.enviada_em < dentro.ate + 1))::int AS enviadas,
         (SELECT count(*) FROM publicadas)::int AS publicadas,
         (SELECT count(*) FROM m, dentro WHERE m.estado = 'rejeitada'
            AND (dentro.de IS NULL OR m.rejeitada_em >= dentro.de)
            AND (dentro.ate IS NULL OR m.rejeitada_em < dentro.ate + 1))::int AS rejeitadas,
         (SELECT count(*) FROM resolvidas)::int AS perguntas_resolvidas,
         (SELECT coalesce(sum(vezes), 0) FROM resolvidas)::int AS vezes_resolvidas`,
      [municipioId, de ?? null, ate ?? null],
    );
    return r;
  }

  private async existe(
    tabela: 'entidades' | 'servicos',
    id: string,
    municipioId: string,
  ) {
    const [l] = await this.db.query(
      `SELECT 1 FROM ${tabela} WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        tabela === 'entidades' ? 'entidade_invalida' : 'servico_invalido',
        tabela === 'entidades'
          ? 'Entidade desconhecida.'
          : 'Serviço desconhecido.',
      );
    }
  }
}

function naoEncontrada(): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'nao_encontrada',
    'Melhoria não encontrada.',
  );
}
