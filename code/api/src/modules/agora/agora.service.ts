import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { resolverFreguesia } from '../consultas-publicas/regras.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import {
  MunicipiosService,
  type Municipio,
} from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { instanteLocal } from '../marcacoes/vagas.js';
import {
  ContextoNormalizar,
  cursorAgora,
  filtrarEOrdenar,
  fraseItem,
  freguesiaDaMorada,
  ItemComRelevancia,
  ItemInterno,
  lerCursorAgora,
  linhaSms,
  linkFeed,
  LinhaAvisoZona,
  LinhaComunicado,
  LinhaConsulta,
  LinhaEmergencia,
  LinhaEvento,
  LinhaLicenca,
  LinhaOcorrencia,
  moradaSemPorta,
  normalizarAvisoZona,
  normalizarComunicado,
  normalizarConsulta,
  normalizarEmergencia,
  normalizarEvento,
  normalizarLicenca,
  normalizarOcorrencia,
  PARAMETROS,
  paraResposta,
  PedidoFeed,
  periodoDoQuando,
  QUANDO,
  quandoDito,
  ROTULOS_TIPO,
  semNumeroDePorta,
  TIPOS_ITEM,
  TIPOS_SUBSCRICAO,
  type Ponto,
  type TipoSubscricao,
} from './agora.regras.js';

/** Onde a pessoa está (ou de que sítio fala). */
export interface LocalAgora {
  /** Só a rua (sem número), para dizer e guardar. */
  rua: string | null;
  freguesia: string | null;
  ponto: Ponto | null;
  /** "Rua Direita" / "freguesia de Azurém". */
  descricao: string;
  origem: 'dita' | 'guardada' | 'processo' | 'requerimento' | 'ocorrencia';
}

export const entradaOQueSePassa = z.object({
  tipos: z
    .array(z.enum(TIPOS_ITEM))
    .max(5)
    .optional()
    .describe(
      'O que a pessoa quer saber: obras (obras, ruas cortadas ou condicionadas, andaimes, contentores), incidentes (buracos, avarias, problemas reportados), avisos (avisos da câmara, cortes de água, emergências, comunicados e notícias), eventos (festas, arraiais, feiras, concertos), consultas (consultas públicas abertas). Vazio = tudo.',
    ),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .optional()
    .describe(
      'A rua (e a freguesia, se a disser) de que a pessoa fala, ex.: "Rua Direita, Azurém". Sem número de porta. Vazio = a morada que já conhecemos.',
    ),
  freguesia: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .optional()
    .describe('A freguesia, se a pessoa falar de uma freguesia inteira.'),
  quando: z
    .enum(QUANDO)
    .optional()
    .describe(
      'agora, hoje, amanha, fim_de_semana, esta_semana ou proximos_dias. Vazio = o que está a decorrer e o que vem aí.',
    ),
  de: z.iso.date().optional().describe('Desde que dia, AAAA-MM-DD.'),
  ate: z.iso.date().optional().describe('Até que dia, AAAA-MM-DD.'),
  todo_concelho: z
    .boolean()
    .optional()
    .describe(
      'true se a pessoa quer saber do concelho todo (ou não quer dizer onde mora).',
    ),
  limite: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Quantos itens, 3 a 5 (por omissão 5).'),
});

export const entradaAvisarMe = z.object({
  tipos: z
    .array(z.enum(TIPOS_SUBSCRICAO))
    .min(1)
    .max(4)
    .describe(
      'De que quer ser avisada: obras (obras, ruas cortadas), incidentes, eventos, avisos (avisos da câmara e emergências).',
    ),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .optional()
    .describe(
      'A rua (e a freguesia), sem número de porta. Vazio = a morada que já conhecemos.',
    ),
  freguesia: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .optional()
    .describe('A freguesia, se quiser ser avisada da freguesia toda.'),
  raio_m: z
    .number()
    .int()
    .min(100)
    .max(2_000)
    .optional()
    .describe('Quantos metros à volta da rua (por omissão 300).'),
});

/** Freguesias conhecidas em cache (mudam pouco). */
const VALIDADE_FREGUESIAS_MS = 5 * 60_000;
/** Quantas moradas o job geocodifica de cada vez (o Nominatim pede 1/s). */
const GEOCODIFICAR_POR_CORRIDA = 20;
/** Sem resultado, tenta outra vez passados estes dias. */
const TENTAR_DE_NOVO_DIAS = 7;
/** No máximo isto de cada fonte (o feed é de uma zona; chega). */
const MAX_POR_FONTE = 300;

/**
 * "O que se passa no concelho, perto de mim": junta as fontes que já
 * existem num feed, para a app (rotas públicas), o agente (o_que_se_passa,
 * avisar_me) e o SMS. Regras em agora.regras.ts.
 */
@Injectable()
export class AgoraService {
  private readonly logger = new Logger(AgoraService.name);
  private readonly cacheFreguesias = new Map<
    string,
    { lista: string[]; ate: number }
  >();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly geo: GeocodificacaoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  /** As freguesias que a câmara já usa (consultas, processos, eventos...). */
  async freguesias(municipioId: string): Promise<string[]> {
    const c = this.cacheFreguesias.get(municipioId);
    if (c && c.ate > Date.now()) return c.lista;
    const linhas = await this.db.query<{ freguesia: string }>(
      `SELECT DISTINCT freguesia FROM (
         SELECT unnest(freguesias) AS freguesia FROM consultas_publicas WHERE municipio_id = $1
         UNION SELECT unnest(freguesias) FROM comunicados WHERE municipio_id = $1
         UNION SELECT freguesia FROM eventos WHERE municipio_id = $1
         UNION SELECT freguesia FROM contactos_cuidado WHERE municipio_id = $1
         UNION SELECT freguesia FROM processos WHERE municipio_id = $1
       ) f WHERE freguesia IS NOT NULL AND length(trim(freguesia)) > 1
       ORDER BY freguesia LIMIT 300`,
      [municipioId],
    );
    const lista = linhas.map((l) => l.freguesia);
    this.cacheFreguesias.set(municipioId, {
      lista,
      ate: Date.now() + VALIDADE_FREGUESIAS_MS,
    });
    return lista;
  }

  async contexto(m: Municipio): Promise<ContextoNormalizar> {
    return {
      webUrl: this.webUrl(),
      slug: m.slug,
      fuso: m.fuso,
      freguesias: await this.freguesias(m.id),
    };
  }

  // -------------------------------------------------------------------
  // Fontes
  // -------------------------------------------------------------------

  /** Todos os itens do município (cada fonte já com a sua janela de tempo). */
  async itens(m: Municipio, c?: ContextoNormalizar): Promise<ItemInterno[]> {
    const ctx = c ?? (await this.contexto(m));
    const passado = PARAMETROS.janela_passado_dias;
    const [
      licencas,
      avisos,
      emergencias,
      ocorrencias,
      comunicados,
      eventos,
      consultas,
    ] = await Promise.all([
      this.db.query<LinhaLicenca>(
        `SELECT l.id, l.tipo, l.dados, l.decidida_em,
                  coalesce(l.dados->>'nome', mu.nome) AS titular,
                  al.lat AS local_lat, al.lng AS local_lng, al.freguesia AS local_freguesia
           FROM licencas l
           LEFT JOIN municipes mu ON mu.id = l.municipe_id
           LEFT JOIN agora_locais al ON al.fonte = 'licenca' AND al.fonte_id = l.id
           WHERE l.municipio_id = $1 AND l.estado = 'emitida'
             AND l.tipo IN ('ocupacao_via','recinto_improvisado','ruido')
             AND (l.valida_ate IS NULL OR l.valida_ate >= current_date - $2::int)
           ORDER BY l.decidida_em DESC NULLS LAST LIMIT ${MAX_POR_FONTE}`,
        [m.id, passado],
      ),
      this.db.query<LinhaAvisoZona>(
        `SELECT id, titulo, mensagem, tipo, zona, geometria, zona_descricao,
                  agendado_para, confirmado_em
           FROM avisos_zona
           WHERE municipio_id = $1 AND estado IN ('a_enviar','enviado')
             AND coalesce(agendado_para, confirmado_em) >= now() - make_interval(days => $2)
           ORDER BY coalesce(agendado_para, confirmado_em) DESC LIMIT ${MAX_POR_FONTE}`,
        [m.id, PARAMETROS.aviso_visivel_dias],
      ),
      this.db.query<LinhaEmergencia>(
        `SELECT id, tipo, gravidade, titulo, mensagem_sms, instrucoes, geometria,
                  zona_descricao, enviada_em, valida_ate
           FROM emergencias
           WHERE municipio_id = $1 AND estado = 'ativa' AND valida_ate > now()
           ORDER BY enviada_em DESC NULLS LAST LIMIT 50`,
        [m.id],
      ),
      this.db.query<LinhaOcorrencia>(
        `SELECT o.id, c.nome AS categoria, o.estado::text AS estado, o.morada,
                  o.lat, o.lng, o.criada_em, o.resolvida_em,
                  to_char(o.prevista_para, 'YYYY-MM-DD') AS prevista_para,
                  al.lat AS local_lat, al.lng AS local_lng, al.freguesia AS local_freguesia
           FROM ocorrencias o
           JOIN categorias_ocorrencia c ON c.id = o.categoria_id
           LEFT JOIN agora_locais al ON al.fonte = 'ocorrencia' AND al.fonte_id = o.id
           WHERE o.municipio_id = $1
             AND ((o.estado IN ('nova','com_equipa') AND o.criada_em > now() - interval '180 days')
               OR (o.estado = 'resolvida' AND o.resolvida_em > now() - make_interval(days => $2)))
           ORDER BY o.criada_em DESC LIMIT ${MAX_POR_FONTE}`,
        [m.id, PARAMETROS.ocorrencia_resolvida_dias],
      ),
      this.db.query<LinhaComunicado>(
        `SELECT id, tipo, titulo, texto, imagem_url, freguesias, publicado_em
           FROM comunicados
           WHERE municipio_id = $1 AND estado = 'publicado' AND publicado_em <= now()
             AND publicado_em > now() - make_interval(days => $2)
           ORDER BY publicado_em DESC LIMIT ${MAX_POR_FONTE}`,
        [m.id, PARAMETROS.comunicado_visivel_dias],
      ),
      this.db.query<LinhaEvento>(
        `SELECT id, titulo, descricao, local, lat, lng, inicio, fim, freguesia, link, publicado_em
           FROM eventos
           WHERE municipio_id = $1 AND estado = 'publicado'
             AND coalesce(fim, inicio) >= now() - make_interval(days => $2)
           ORDER BY inicio LIMIT ${MAX_POR_FONTE}`,
        [m.id, passado],
      ),
      this.db.query<LinhaConsulta>(
        `SELECT id, codigo, titulo, resumo, freguesias,
                  to_char(abre_em, 'YYYY-MM-DD') AS abre_em,
                  to_char(fecha_em, 'YYYY-MM-DD') AS fecha_em, aberta_em
           FROM consultas_publicas
           WHERE municipio_id = $1 AND estado = 'aberta'
             AND abre_em <= (now() AT TIME ZONE $2)::date
             AND fecha_em >= (now() AT TIME ZONE $2)::date
           ORDER BY fecha_em LIMIT 50`,
        [m.id, m.fuso],
      ),
    ]);
    const r: ItemInterno[] = [];
    for (const l of licencas) {
      const i = normalizarLicenca(l, ctx);
      if (i) r.push(i);
    }
    for (const a of avisos) r.push(normalizarAvisoZona(a, ctx));
    for (const e of emergencias) r.push(normalizarEmergencia(e, ctx));
    for (const o of ocorrencias) r.push(normalizarOcorrencia(o, ctx));
    for (const x of comunicados) r.push(normalizarComunicado(x, ctx));
    for (const e of eventos) r.push(normalizarEvento(e, ctx));
    for (const q of consultas) r.push(normalizarConsulta(q, ctx));
    return r;
  }

  // -------------------------------------------------------------------
  // Público (app)
  // -------------------------------------------------------------------

  async feed(slug: string, f: PedidoFeed) {
    const m = await this.municipios.porSlug(slug);
    const c = await this.contexto(m);
    const posicao = lerCursorAgora(f.cursor);
    if (posicao < 0) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'cursor_invalido',
        'Cursor inválido.',
      );
    }
    const freguesia = f.freguesia
      ? resolverFreguesia(f.freguesia, [...c.freguesias])
      : null;
    const todos = filtrarEOrdenar(await this.itens(m, c), {
      ponto:
        f.lat !== undefined && f.lng !== undefined
          ? { lat: f.lat, lng: f.lng }
          : null,
      raio_m: f.raio_m ?? PARAMETROS.raio_omissao_m,
      freguesia,
      tipos: f.tipos ?? null,
      de: f.de ?? null,
      ate: f.ate ?? null,
      agora: new Date(),
    });
    const pagina = todos.slice(posicao, posicao + f.limite);
    const seguinte = posicao + f.limite;
    // O número de SMS da câmara (para "AVISAR OBRAS") é público.
    const [sms] = await this.db.query<{ telefone_sms: string | null }>(
      'SELECT telefone_sms FROM municipios WHERE id = $1',
      [m.id],
    );
    return {
      municipio: {
        slug: m.slug,
        nome: m.nome,
        telefone_sms: sms?.telefone_sms ?? null,
      },
      /** As freguesias que se podem escolher no filtro. */
      freguesias: c.freguesias,
      filtro: {
        lat: f.lat ?? null,
        lng: f.lng ?? null,
        raio_m:
          f.lat !== undefined ? (f.raio_m ?? PARAMETROS.raio_omissao_m) : null,
        freguesia,
        tipos: f.tipos ?? [...TIPOS_ITEM],
        de: f.de?.toISOString() ?? null,
        ate: f.ate?.toISOString() ?? null,
      },
      total: todos.length,
      itens: pagina.map((i) => paraResposta(i)),
      proximo_cursor: seguinte < todos.length ? cursorAgora(seguinte) : null,
      link: linkFeed(c, freguesia),
      parametros: PARAMETROS,
    };
  }

  async detalhe(slug: string, tipo: string, id: string) {
    const m = await this.municipios.porSlug(slug);
    const naoHa = () =>
      new ErroApi(
        HttpStatus.NOT_FOUND,
        'item_nao_encontrado',
        'Isto já não está no feed (ou nunca esteve).',
      );
    if (
      !(TIPOS_ITEM as readonly string[]).includes(tipo) ||
      !z.uuid().safeParse(id).success
    ) {
      throw naoHa();
    }
    const i = (await this.itens(m)).find((x) => x.tipo === tipo && x.id === id);
    if (!i) throw naoHa();
    let texto: string | null = null;
    if (i.fonte === 'comunicado') {
      const [r] = await this.db.query<{ texto: string }>(
        'SELECT texto FROM comunicados WHERE id = $1',
        [id],
      );
      texto = r?.texto ?? null;
    } else if (i.fonte === 'evento') {
      const [r] = await this.db.query<{ descricao: string }>(
        'SELECT descricao FROM eventos WHERE id = $1',
        [id],
      );
      texto = r?.descricao ?? null;
    }
    return {
      municipio: { slug: m.slug, nome: m.nome },
      item: paraResposta(i),
      texto,
      quando: quandoDito(i, new Date(), m.fuso),
      feed: linkFeed({ webUrl: this.webUrl(), slug: m.slug }),
    };
  }

  // -------------------------------------------------------------------
  // Locais (job): onde ficam as licenças e ocorrências sem coordenadas
  // -------------------------------------------------------------------

  /**
   * Geocodifica a RUA (sem número de porta) das licenças e ocorrências do
   * feed que ainda não têm sítio, uma a uma (o Nominatim pede no máximo um
   * pedido por segundo). Devolve quantas tratou.
   */
  async atualizarLocais(limite = GEOCODIFICAR_POR_CORRIDA): Promise<number> {
    const pendentes = await this.db.query<{
      fonte: 'licenca' | 'ocorrencia';
      id: string;
      municipio_id: string;
      morada: string | null;
      lat: number | null;
      lng: number | null;
      municipio: string;
    }>(
      `SELECT * FROM (
         SELECT 'licenca' AS fonte, l.id, l.municipio_id, l.dados->>'morada' AS morada,
                NULL::float8 AS lat, NULL::float8 AS lng, m.nome AS municipio, l.decidida_em AS em
         FROM licencas l JOIN municipios m ON m.id = l.municipio_id
         WHERE l.estado = 'emitida' AND l.tipo IN ('ocupacao_via','recinto_improvisado','ruido')
           AND (l.valida_ate IS NULL OR l.valida_ate >= current_date - 1)
         UNION ALL
         SELECT 'ocorrencia', o.id, o.municipio_id, o.morada, o.lat, o.lng, m.nome, o.criada_em
         FROM ocorrencias o JOIN municipios m ON m.id = o.municipio_id
         WHERE o.estado IN ('nova','com_equipa','resolvida')
           AND o.criada_em > now() - interval '180 days'
       ) x
       WHERE x.morada IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM agora_locais al WHERE al.fonte = x.fonte AND al.fonte_id = x.id
           AND (al.lat IS NOT NULL OR al.tentado_em > now() - make_interval(days => $2)))
       ORDER BY x.em DESC NULLS LAST
       LIMIT $1`,
      [limite, TENTAR_DE_NOVO_DIAS],
    );
    for (const p of pendentes) {
      const candidatas = await this.freguesias(p.municipio_id);
      // As ocorrências com coordenadas só precisam da freguesia.
      const c =
        p.lat !== null && p.lng !== null
          ? { lat: p.lat, lng: p.lng, encontrada: '' }
          : await this.geo.geocodificar(
              moradaSemPorta(p.morada as string),
              p.municipio,
            );
      const freguesia = freguesiaDaMorada(p.morada, candidatas, c?.encontrada);
      await this.db.query(
        `INSERT INTO agora_locais (fonte, fonte_id, municipio_id, lat, lng, freguesia, tentado_em)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (fonte, fonte_id) DO UPDATE
           SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, freguesia = EXCLUDED.freguesia,
               tentado_em = now()`,
        [
          p.fonte,
          p.id,
          p.municipio_id,
          c?.lat ?? null,
          c?.lng ?? null,
          freguesia,
        ],
      );
    }
    return pendentes.length;
  }

  // -------------------------------------------------------------------
  // Onde está a pessoa
  // -------------------------------------------------------------------

  /**
   * O que a pessoa disse → um sítio: uma freguesia conhecida ("Azurém") ou
   * uma rua geocodificada (sem número de porta). null = não encontrado.
   */
  async resolverLocal(m: Municipio, dito: string): Promise<LocalAgora | null> {
    const candidatas = await this.freguesias(m.id);
    const pareceRua =
      semNumeroDePorta(dito) !== null &&
      /^(rua|r\.|av|travessa|tv\.|largo|lg\.|pra[çc]a|estrada|alameda|beco|cal[çc]ada|rotunda|urbaniza|bairro|caminho|viela)/i.test(
        dito.trim(),
      );
    const freguesia = (): LocalAgora | null => {
      const f = resolverFreguesia(dito, candidatas);
      return candidatas.includes(f)
        ? {
            rua: null,
            freguesia: f,
            ponto: null,
            descricao: `freguesia de ${f}`,
            origem: 'dita',
          }
        : null;
    };
    if (!pareceRua) {
      const f = freguesia();
      if (f) return f;
    }
    const c = await this.geo.geocodificar(moradaSemPorta(dito), m.nome);
    if (c) {
      const rua = semNumeroDePorta(dito);
      return {
        rua,
        freguesia: freguesiaDaMorada(dito, candidatas, c.encontrada),
        ponto: { lat: c.lat, lng: c.lng },
        descricao: rua ?? dito.trim(),
        origem: 'dita',
      };
    }
    return pareceRua ? freguesia() : null;
  }

  /** A morada que já conhecemos da pessoa: a preferida, ou a dos processos. */
  async localDoMunicipe(
    m: Municipio,
    municipeId: string,
  ): Promise<LocalAgora | null> {
    const [mu] = await this.db.query<{
      morada_rua: string | null;
      morada_freguesia: string | null;
      morada_lat: number | null;
      morada_lng: number | null;
    }>(
      `SELECT morada_rua, morada_freguesia, morada_lat, morada_lng
       FROM municipes WHERE id = $1 AND municipio_id = $2 AND anonimizado_em IS NULL`,
      [municipeId, m.id],
    );
    if (!mu) return null;
    if (mu.morada_lat !== null || mu.morada_freguesia) {
      return {
        rua: mu.morada_rua,
        freguesia: mu.morada_freguesia,
        ponto:
          mu.morada_lat !== null && mu.morada_lng !== null
            ? { lat: mu.morada_lat, lng: mu.morada_lng }
            : null,
        descricao:
          mu.morada_rua ??
          (mu.morada_freguesia ? `freguesia de ${mu.morada_freguesia}` : ''),
        origem: 'guardada',
      };
    }
    // Processos e requerimentos (normalmente a casa ou a obra) antes das
    // ocorrências (onde estava o problema).
    const [x] = await this.db.query<{
      origem: 'processo' | 'requerimento' | 'ocorrencia';
      morada: string;
      lat: number | null;
      lng: number | null;
      freguesia: string | null;
    }>(
      `SELECT origem, morada, lat, lng, freguesia FROM (
         SELECT 'processo' AS origem, 1 AS ordem, morada, lat, lng, freguesia, criado_em AS em
         FROM processos WHERE municipe_id = $1 AND morada IS NOT NULL
         UNION ALL
         SELECT 'requerimento', 2, dados->>'morada_obra', NULL, NULL, NULL, criado_em
         FROM requerimentos WHERE municipe_id = $1 AND dados->>'morada_obra' IS NOT NULL
         UNION ALL
         SELECT 'ocorrencia', 3, morada, lat, lng, NULL, criada_em
         FROM ocorrencias WHERE municipe_id = $1
       ) x
       WHERE em > now() - interval '3 years'
       ORDER BY ordem, em DESC LIMIT 1`,
      [municipeId],
    );
    if (!x) return null;
    const candidatas = await this.freguesias(m.id);
    let ponto =
      x.lat !== null && x.lng !== null ? { lat: x.lat, lng: x.lng } : null;
    let encontrada: string | null = null;
    if (!ponto) {
      const c = await this.geo.geocodificar(moradaSemPorta(x.morada), m.nome);
      if (c) {
        ponto = { lat: c.lat, lng: c.lng };
        encontrada = c.encontrada;
      }
    }
    const freguesia =
      x.freguesia ?? freguesiaDaMorada(x.morada, candidatas, encontrada);
    if (!ponto && !freguesia) return null;
    const rua = semNumeroDePorta(x.morada);
    return {
      rua,
      freguesia,
      ponto,
      descricao: rua ?? (freguesia ? `freguesia de ${freguesia}` : ''),
      origem: x.origem,
    };
  }

  /** Guarda a rua (sem número) e/ou a freguesia preferidas da pessoa. */
  async guardarMorada(municipeId: string, l: LocalAgora): Promise<void> {
    await this.db.query(
      `UPDATE municipes SET morada_rua = $2, morada_freguesia = $3,
         morada_lat = $4, morada_lng = $5, morada_atualizada_em = now(),
         sms_espera = NULL, sms_espera_em = NULL
       WHERE id = $1 AND anonimizado_em IS NULL`,
      [
        municipeId,
        l.rua,
        l.freguesia,
        l.ponto?.lat ?? null,
        l.ponto?.lng ?? null,
      ],
    );
  }

  /** O munícipe da conversa (ou do número que liga/escreve). */
  private async municipeId(
    ctx: ContextoFerramenta,
    criar: boolean,
  ): Promise<string | null> {
    if (ctx.municipeId) return ctx.municipeId;
    if (!ctx.telefone) return null;
    if (criar) {
      return (
        (await this.municipes.porTelefone(ctx.municipio.id, ctx.telefone))
          ?.id ?? null
      );
    }
    const [mu] = await this.db.query<{ id: string }>(
      `SELECT id FROM municipes
       WHERE municipio_id = $1 AND telefone_e164 = $2 AND anonimizado_em IS NULL`,
      [ctx.municipio.id, ctx.telefone],
    );
    return mu?.id ?? null;
  }

  /**
   * O sítio para a ferramenta: o que a pessoa disse (e guarda-o), ou o que
   * já conhecemos. `{ precisa }` se não houver nenhum; `{ naoEncontrado }`
   * se o que disse não deu.
   */
  private async localDaConversa(
    ctx: ContextoFerramenta,
    e: { morada?: string; freguesia?: string },
    municipeId: string | null,
  ): Promise<{
    local: LocalAgora | null;
    naoEncontrado?: string;
    guardada?: boolean;
  }> {
    const m = ctx.municipio;
    const dito = e.morada ?? e.freguesia;
    if (dito) {
      const l = await this.resolverLocal(m, dito);
      if (!l) return { local: null, naoEncontrado: dito };
      if (municipeId) await this.guardarMorada(municipeId, l);
      return { local: l, guardada: !!municipeId };
    }
    return {
      local: municipeId ? await this.localDoMunicipe(m, municipeId) : null,
    };
  }

  // -------------------------------------------------------------------
  // Ferramentas do agente
  // -------------------------------------------------------------------

  async oQueSePassa(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaOQueSePassa>,
  ) {
    const m = ctx.municipio;
    const c = await this.contexto(m);
    const municipeId = await this.municipeId(ctx, false);
    let local: LocalAgora | null = null;
    let guardada = false;
    if (!e.todo_concelho) {
      const r = await this.localDaConversa(ctx, e, municipeId);
      if (r.naoEncontrado) {
        return {
          morada_nao_encontrada: true,
          morada: r.naoEncontrado,
          instrucao:
            'Não encontrei essa rua no concelho. Pede o nome da rua de outra forma ou a freguesia, e chama outra vez.',
        };
      }
      if (!r.local) {
        return {
          precisa_morada: true,
          instrucao:
            'Não sei onde a pessoa mora. Pergunta UMA vez o nome da rua ou da freguesia (sem número de porta) e chama outra vez com morada. Se não quiser dizer, chama com todo_concelho: true.',
        };
      }
      local = r.local;
      guardada = !!r.guardada;
    }
    const agora = new Date();
    const periodo = e.quando
      ? periodoDoQuando(e.quando, agora, m.fuso)
      : e.de || e.ate
        ? {
            de: e.de ? instanteLocal(e.de, '00:00', m.fuso) : agora,
            ate: e.ate
              ? new Date(
                  instanteLocal(e.ate, '23:59', m.fuso).getTime() + 59_000,
                )
              : new Date(
                  agora.getTime() + PARAMETROS.janela_futuro_dias * 86_400_000,
                ),
            dito:
              e.de && e.ate
                ? `entre ${e.de} e ${e.ate}`
                : e.de
                  ? `desde ${e.de}`
                  : `até ${e.ate}`,
          }
        : null;
    const lista = filtrarEOrdenar(await this.itens(m, c), {
      ponto: local?.ponto ?? null,
      raio_m: PARAMETROS.raio_omissao_m,
      freguesia: local?.freguesia ?? null,
      tipos: e.tipos ?? null,
      de: periodo?.de ?? null,
      ate: periodo?.ate ?? null,
      agora,
    });
    const limite = e.limite ?? 5;
    const escolhidos = lista.slice(0, limite);
    const link = linkFeed(c, local?.freguesia ?? null);
    const onde = local
      ? local.ponto
        ? `perto de ${local.descricao}`
        : `na ${local.descricao}`
      : 'no concelho';
    const oque = e.tipos?.length
      ? e.tipos.map((t) => ROTULOS_TIPO[t]).join(', ')
      : 'nada a assinalar';
    const quando = periodo ? ` ${periodo.dito}` : '';
    const dizer = escolhidos.length
      ? `${onde[0].toUpperCase()}${onde.slice(1)}${quando}: ${escolhidos
          .map((i) => fraseItem(i, agora, m.fuso))
          .join(
            '; ',
          )}.${lista.length > escolhidos.length ? ` Há mais ${lista.length - escolhidos.length} na lista completa.` : ''}`
      : `Não encontrei ${e.tipos?.length ? oque : 'nada a assinalar'} ${onde}${quando}.`;
    return {
      local: local
        ? {
            descricao: local.descricao,
            freguesia: local.freguesia,
            origem: local.origem,
          }
        : null,
      morada_guardada: guardada || undefined,
      periodo: periodo?.dito ?? null,
      total: lista.length,
      itens: escolhidos.map((i) => this.itemDaFerramenta(i, agora, m.fuso)),
      link,
      dizer,
      instrucao:
        'Diz o "dizer" com as tuas palavras (não leias os links). No chat, mostra o link para ver tudo. ' +
        (local?.origem && local.origem !== 'dita'
          ? `Usei a morada que já conhecemos (${local.descricao}); se a pessoa quiser outra, pergunta e chama outra vez com morada. `
          : '') +
        'Se a pessoa quiser ser avisada quando houver coisas novas, usa avisar_me.',
    };
  }

  private itemDaFerramenta(i: ItemComRelevancia, agora: Date, fuso: string) {
    return {
      tipo: i.tipo,
      etiqueta: i.etiqueta,
      titulo: i.titulo,
      resumo: i.resumo,
      rua: i.rua,
      freguesia: i.freguesia,
      quando: quandoDito(i, agora, fuso),
      gravidade: i.gravidade,
      distancia_m: i.distancia_m,
      link: i.link,
      frase: fraseItem(i, agora, fuso),
      sms: linhaSms(i, agora, fuso),
    };
  }

  async avisarMe(ctx: ContextoFerramenta, e: z.output<typeof entradaAvisarMe>) {
    const m = ctx.municipio;
    const municipeId = await this.municipeId(ctx, true);
    if (!municipeId) {
      return {
        precisa_identificacao: true,
        instrucao:
          'Os avisos vão por SMS: preciso do telemóvel da pessoa. No chat, pede para se identificar com o número de telemóvel; ao telefone, o número não veio.',
      };
    }
    const [mu] = await this.db.query<{
      telefone_e164: string | null;
      aceita_avisos: boolean;
    }>('SELECT telefone_e164, aceita_avisos FROM municipes WHERE id = $1', [
      municipeId,
    ]);
    if (!mu?.telefone_e164) {
      return {
        precisa_identificacao: true,
        instrucao:
          'Não temos um telemóvel desta pessoa para os avisos por SMS. Pede-lhe o número de telemóvel.',
      };
    }
    const r = await this.localDaConversa(ctx, e, municipeId);
    if (r.naoEncontrado) {
      return {
        morada_nao_encontrada: true,
        morada: r.naoEncontrado,
        instrucao:
          'Não encontrei essa rua no concelho. Pede o nome da rua de outra forma ou a freguesia, e chama outra vez.',
      };
    }
    if (!r.local) {
      return {
        precisa_morada: true,
        instrucao:
          'Pergunta UMA vez o nome da rua ou da freguesia (sem número de porta) e chama outra vez com morada.',
      };
    }
    const l = r.local;
    const raio = e.raio_m ?? PARAMETROS.raio_subscricao_m;
    const tipos = [...new Set(e.tipos)] as TipoSubscricao[];
    const porRua = l.ponto !== null;
    const id = await this.db.transaction(async (tx) => {
      // A mesma zona (a mesma freguesia, ou o mesmo sítio a ~10 m) junta os tipos.
      const [existente] = await tx.query<{ id: string; tipos: string[] }>(
        `SELECT id, tipos FROM agora_subscricoes
         WHERE municipe_id = $1 AND ativa
           AND (($2::float8 IS NOT NULL AND round(lat::numeric, 4) = round($2::numeric, 4)
                 AND round(lng::numeric, 4) = round($3::numeric, 4))
             OR ($2::float8 IS NULL AND lat IS NULL AND unaccent(lower(freguesia)) = unaccent(lower($4))))
         ORDER BY criada_em LIMIT 1 FOR UPDATE`,
        [
          municipeId,
          l.ponto?.lat ?? null,
          l.ponto?.lng ?? null,
          l.freguesia ?? '',
        ],
      );
      let subId: string;
      if (existente) {
        await tx.query(
          `UPDATE agora_subscricoes SET tipos = (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(tipos || $2::text[]) t),
             raio_m = CASE WHEN lat IS NULL THEN raio_m ELSE $3 END, atualizada_em = now()
           WHERE id = $1`,
          [existente.id, tipos, raio],
        );
        subId = existente.id;
      } else {
        const [n] = await tx.query<{ id: string }>(
          `INSERT INTO agora_subscricoes (municipio_id, municipe_id, tipos, rua, lat, lng, raio_m, freguesia, canal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            m.id,
            municipeId,
            tipos,
            l.rua,
            l.ponto?.lat ?? null,
            l.ponto?.lng ?? null,
            porRua ? raio : null,
            l.freguesia,
            ctx.canal,
          ],
        );
        subId = n.id;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'municipe',
          atorId: municipeId,
          acao: 'subscrever_agora',
          objetoTipo: 'agora_subscricao',
          objetoId: subId,
          dados: { tipos, por: porRua ? 'rua' : 'freguesia', canal: ctx.canal },
        },
        tx,
      );
      if (!mu.aceita_avisos) {
        // Pedir avisos é dizer que os quer: volta a aceitar (tinha dito PARAR).
        await tx.query(
          'UPDATE municipes SET aceita_avisos = true WHERE id = $1',
          [municipeId],
        );
        await this.auditoria.registar(
          {
            municipioId: m.id,
            atorTipo: 'municipe',
            atorId: municipeId,
            acao: 'aceitar_avisos',
            objetoTipo: 'municipe',
            objetoId: municipeId,
            dados: { via: 'avisar_me', canal: ctx.canal },
          },
          tx,
        );
      }
      return subId;
    });
    const zona = porRua
      ? `${l.descricao} (${raio} m à volta)`
      : l.freguesia
        ? `freguesia de ${l.freguesia}`
        : l.descricao;
    const oque = tipos.map((t) => ROTULOS_TIPO[t]).join(', ');
    return {
      subscrito: true,
      subscricao_id: id,
      tipos,
      zona,
      voltou_a_aceitar_avisos: !mu.aceita_avisos || undefined,
      dizer:
        `Fica combinado: avisamos por SMS quando houver ${oque} novos em ${zona}. ` +
        'Avisos que não sejam de emergência só saem entre as 9h e as 21h. Para deixar de receber, responda PARAR a um desses SMS.',
    };
  }
}
