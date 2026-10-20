import { z } from 'zod';
import { diasNoPeriodo } from '../painel/periodos.js';
import {
  ATE,
  consulta,
  ContextoConsulta,
  DE,
  escolher,
  euros,
  limite,
  periodoLivre,
  periodoVistas,
  texto,
  umaCasa,
  Valor,
} from './consulta.js';

/*
 * Ocorrências, pagamentos e marcações: direto às tabelas. As ocorrências
 * contam como no painel: os avisos duplicados ("o mesmo buraco, reportado
 * por cinco pessoas") não contam à parte, somam-se ao original.
 */

// ----------------------------------------------------------------------
// Ocorrências
// ----------------------------------------------------------------------

const ESTADO_ROTULO: Record<string, string> = {
  nova: 'Nova',
  com_equipa: 'Com a equipa',
  resolvida: 'Resolvida',
  rejeitada: 'Rejeitada',
};

const ESTADOS_OCORR = {
  abertas: ['nova', 'com_equipa'],
  nova: ['nova'],
  com_equipa: ['com_equipa'],
  resolvida: ['resolvida'],
  rejeitada: ['rejeitada'],
  todas: null,
} as const;

const filtrosOcorr = {
  categoria: texto(
    'Categoria em palavras (ex.: "buracos", "iluminação", "lixo"). null = todas.',
  ),
  estado: z
    .enum(['abertas', 'nova', 'com_equipa', 'resolvida', 'rejeitada', 'todas'])
    .nullable()
    .describe(
      'abertas = nova + com a equipa. null = automático: com período, todas; sem período, só as abertas.',
    ),
  zona: texto(
    'Freguesia, rua ou lugar: procura no texto da morada. null = todo o concelho.',
  ),
  data: z
    .enum(['registo', 'resolucao'])
    .nullable()
    .describe(
      'A que data se aplica o período: registo (por omissão) ou resolução.',
    ),
  de: DE,
  ate: ATE,
};

const esquemaOcorr = z.object(filtrosOcorr).strict();
type FiltrosOcorr = z.output<typeof esquemaOcorr>;

async function resolverOcorr(ctx: ContextoConsulta, e: FiltrosOcorr) {
  const p = periodoLivre(e);
  const vistos: Record<string, unknown> = {};
  let categorias: string[] | null = null;
  if (e.categoria) {
    const todas = await ctx.db.query<{ id: string; nome: string }>(
      `SELECT id, nome FROM categorias_ocorrencia WHERE municipio_id = $1 ORDER BY nome`,
      [ctx.municipio.id],
    );
    const c = escolher(
      todas,
      e.categoria,
      'categoria de ocorrência',
      'categoria_desconhecida',
    );
    categorias = c.map((x) => x.id);
    vistos.categorias = c.map((x) => x.nome);
  }
  const estado = e.estado ?? (p.de || p.ate ? 'todas' : 'abertas');
  vistos.estado = estado;
  if (e.zona) vistos.zona_na_morada = e.zona;
  if (p.de || p.ate) vistos.periodo_de = e.data ?? 'registo';
  return {
    filtros: vistos,
    params: [
      ctx.municipio.id, // $1
      categorias, // $2
      ESTADOS_OCORR[estado], // $3
      e.zona, // $4
      e.data === 'resolucao', // $5
      p.de, // $6
      p.ate, // $7
      ctx.municipio.fuso, // $8
    ] as unknown[],
  };
}

const DATA_OCORR = `((CASE WHEN $5::boolean THEN o.resolvida_em ELSE o.criada_em END) AT TIME ZONE $8::text)::date`;

export const DE_OCORRENCIAS = `
  FROM ocorrencias o
  JOIN categorias_ocorrencia cat ON cat.id = o.categoria_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n FROM ocorrencias d WHERE d.duplicada_de = o.id
  ) dup ON true
  WHERE o.municipio_id = $1 AND o.duplicada_de IS NULL
    AND ($2::uuid[] IS NULL OR o.categoria_id = ANY($2::uuid[]))
    AND ($3::text[] IS NULL OR o.estado::text = ANY($3::text[]))
    AND ($4::text IS NULL OR position(lower(unaccent($4::text)) IN lower(unaccent(o.morada))) > 0)
    AND ($6::date IS NULL OR ${DATA_OCORR} >= $6::date)
    AND ($7::date IS NULL OR ${DATA_OCORR} <= $7::date)`;

const FONTE_OCORR =
  'Ocorrências registadas no Tou, Câmara?, neste momento (os avisos repetidos contam no original).';

const GRUPOS_OCORR = {
  categoria: `cat.nome`,
  estado: `o.estado::text`,
} as const;

export const contarOcorrencias = consulta({
  nome: 'contar_ocorrencias',
  descricao:
    'Conta ocorrências na via pública (buracos, iluminação, lixo...) por categoria, estado, zona (texto da morada) e período de registo ou de resolução. Devolve total, abertas, resolvidas, avisos repetidos juntos ao original e o tempo médio de resolução (horas e dias). Com agrupar_por, uma linha por categoria ou estado.',
  entrada: esquemaOcorr
    .extend({
      agrupar_por: z
        .enum(['categoria', 'estado'])
        .nullable()
        .describe('Uma linha por categoria ou estado. null = só os totais.'),
    })
    .strict(),
  async executar(ctx, e) {
    const { params, filtros } = await resolverOcorr(ctx, e);
    const contas = `count(*)::int AS total,
      count(*) FILTER (WHERE o.estado IN ('nova','com_equipa'))::int AS abertas,
      count(o.resolvida_em)::int AS resolvidas,
      coalesce(sum(dup.n), 0)::int AS avisos_repetidos,
      avg(extract(epoch FROM o.resolvida_em - o.criada_em) / 3600)::float8 AS horas`;
    const [t] = await ctx.db.query<Totais>(
      `SELECT ${contas} ${DE_OCORRENCIAS}`,
      params,
    );
    const r = {
      valores: totais(t),
      unidades: UNIDADES_OCORR,
      filtros,
      fonte: FONTE_OCORR,
      notas: [
        'A zona procura-se no texto da morada (as ocorrências não têm o campo freguesia).',
      ],
    };
    if (!e.agrupar_por) return r;
    const linhas = await ctx.db.query<Totais & { grupo: string }>(
      `SELECT ${GRUPOS_OCORR[e.agrupar_por]} AS grupo, ${contas}
       ${DE_OCORRENCIAS}
       GROUP BY 1 ORDER BY total DESC, grupo`,
      params,
    );
    return {
      ...r,
      linhas: linhas.map((l) => ({
        grupo:
          e.agrupar_por === 'estado'
            ? (ESTADO_ROTULO[l.grupo] ?? l.grupo)
            : l.grupo,
        ...totais(l),
      })),
      colunas: [
        {
          chave: 'grupo',
          rotulo: e.agrupar_por === 'estado' ? 'Estado' : 'Categoria',
        },
        { chave: 'total', rotulo: 'Ocorrências' },
        { chave: 'abertas', rotulo: 'Abertas' },
        { chave: 'resolvidas', rotulo: 'Resolvidas' },
        {
          chave: 'tempo_medio_resolucao_dias',
          rotulo: 'Resolução (dias, média)',
        },
      ],
    };
  },
});

interface Totais {
  total: number;
  abertas: number;
  resolvidas: number;
  avisos_repetidos: number;
  horas: number | null;
}

function totais(t: Totais): Record<string, Valor> {
  return {
    total: t.total,
    abertas: t.abertas,
    resolvidas: t.resolvidas,
    avisos_repetidos: t.avisos_repetidos,
    tempo_medio_resolucao_h: umaCasa(t.horas),
    tempo_medio_resolucao_dias: t.horas === null ? null : umaCasa(t.horas / 24),
  };
}

const UNIDADES_OCORR = {
  total: 'ocorrências',
  abertas: 'ocorrências',
  resolvidas: 'ocorrências',
  avisos_repetidos: 'avisos',
  avisos: 'avisos',
  tempo_medio_resolucao_h: 'horas',
  tempo_medio_resolucao_dias: 'dias',
  dias_aberta: 'dias',
};

export const listarOcorrencias = consulta({
  nome: 'listar_ocorrencias',
  descricao:
    'Lista ocorrências com os mesmos filtros de contar_ocorrencias: número, categoria, morada, estado, data de registo, avisos repetidos e há quantos dias está aberta. Usa quando pedem "quais" ou uma lista.',
  entrada: esquemaOcorr
    .extend({
      ordenar: z
        .enum(['recentes', 'antigas'])
        .nullable()
        .describe('recentes primeiro (por omissão) ou as mais antigas.'),
      limite: limite(20),
    })
    .strict(),
  async executar(ctx, e) {
    const { params, filtros } = await resolverOcorr(ctx, e);
    const linhas = await ctx.db.query<{
      id: string;
      numero: string;
      categoria: string;
      morada: string;
      estado: string;
      registada: string;
      resolvida: string | null;
      avisos: number;
      dias_aberta: number | null;
      total: number;
    }>(
      `SELECT o.id, o.numero, cat.nome AS categoria, o.morada, o.estado::text AS estado,
              to_char(o.criada_em AT TIME ZONE $8::text, 'YYYY-MM-DD') AS registada,
              to_char(o.resolvida_em AT TIME ZONE $8::text, 'YYYY-MM-DD') AS resolvida,
              dup.n AS avisos,
              CASE WHEN o.estado IN ('nova','com_equipa')
                   THEN ($9::date - (o.criada_em AT TIME ZONE $8::text)::date) END AS dias_aberta,
              count(*) OVER ()::int AS total
       ${DE_OCORRENCIAS}
       ORDER BY o.criada_em ${e.ordenar === 'antigas' ? 'ASC' : 'DESC'}, o.numero
       LIMIT $10`,
      [...params, ctx.hoje, e.limite ?? 20],
    );
    const total = linhas[0]?.total ?? 0;
    return {
      valores: { total },
      unidades: UNIDADES_OCORR,
      linhas: linhas.map((l) => ({
        id: l.id,
        numero: l.numero,
        categoria: l.categoria,
        morada: l.morada,
        estado: ESTADO_ROTULO[l.estado] ?? l.estado,
        registada: l.registada,
        resolvida: l.resolvida,
        avisos: l.avisos,
        dias_aberta: l.dias_aberta,
      })),
      colunas: [
        { chave: 'numero', rotulo: 'Ocorrência' },
        { chave: 'categoria', rotulo: 'Categoria' },
        { chave: 'morada', rotulo: 'Morada' },
        { chave: 'estado', rotulo: 'Estado' },
        { chave: 'registada', rotulo: 'Registada' },
        { chave: 'avisos', rotulo: 'Avisos repetidos' },
        { chave: 'dias_aberta', rotulo: 'Dias aberta' },
      ],
      objeto: 'ocorrencia',
      total_linhas: total,
      filtros,
      fonte: FONTE_OCORR,
    };
  },
});

// ----------------------------------------------------------------------
// Pagamentos
// ----------------------------------------------------------------------

const PERIODO = {
  de: DE.describe(
    'Primeiro dia (AAAA-MM-DD), incluído. null = 6 dias antes de ate. Período máximo: 400 dias.',
  ),
  ate: ATE,
};

export const pagamentos = consulta({
  nome: 'pagamentos',
  descricao:
    'Taxas pagas pelos munícipes (Multibanco, MB WAY, cartão): no período, quantos pagamentos e quanto em euros, quantos emitidos e expirados; e agora, quantos estão por pagar e quanto (e quantos já passaram a data limite). Uma linha por método.',
  entrada: z
    .object({
      ...PERIODO,
      metodo: z
        .enum(['multibanco', 'mbway', 'cartao'])
        .nullable()
        .describe('Só este método. null = todos.'),
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoVistas(ctx, e);
    const contas = `
      count(*) FILTER (WHERE estado = 'pago' AND (pago_em AT TIME ZONE $5::text)::date BETWEEN $2::date AND $3::date)::int AS pagos,
      coalesce(sum(valor_cent) FILTER (WHERE estado = 'pago' AND (pago_em AT TIME ZONE $5::text)::date BETWEEN $2::date AND $3::date), 0)::float8 AS pagos_cent,
      count(*) FILTER (WHERE (criado_em AT TIME ZONE $5::text)::date BETWEEN $2::date AND $3::date)::int AS emitidos,
      count(*) FILTER (WHERE estado = 'expirado' AND (criado_em AT TIME ZONE $5::text)::date BETWEEN $2::date AND $3::date)::int AS expirados,
      count(*) FILTER (WHERE estado = 'pendente')::int AS por_pagar,
      coalesce(sum(valor_cent) FILTER (WHERE estado = 'pendente'), 0)::float8 AS por_pagar_cent,
      count(*) FILTER (WHERE estado = 'pendente' AND pagar_ate < $6::date)::int AS por_pagar_fora_prazo,
      count(*) FILTER (WHERE modo_teste)::int AS em_teste`;
    const de = `FROM pagamentos WHERE municipio_id = $1 AND ($4::metodo_pag IS NULL OR metodo = $4::metodo_pag)`;
    const params = [
      ctx.municipio.id,
      p.de,
      p.ate,
      e.metodo,
      ctx.municipio.fuso,
      ctx.hoje,
    ];
    const [t] = await ctx.db.query<LinhaPag>(`SELECT ${contas} ${de}`, params);
    const linhas = await ctx.db.query<LinhaPag & { metodo: string }>(
      `SELECT coalesce(metodo::text, 'por escolher') AS metodo, ${contas} ${de}
       GROUP BY 1 ORDER BY pagos DESC, metodo`,
      params,
    );
    const notas: string[] = [];
    if (t.em_teste > 0) {
      notas.push(
        'Pagamentos em modo de teste (simulados): não houve dinheiro real. Diz isto na resposta.',
      );
    }
    return {
      valores: valoresPag(t),
      unidades: {
        pagos: 'pagamentos',
        pagos_eur: '€',
        emitidos: 'pagamentos',
        expirados: 'pagamentos',
        por_pagar_agora: 'pagamentos',
        por_pagar_agora_eur: '€',
        por_pagar_fora_prazo: 'pagamentos',
      },
      linhas: linhas.map((l) => ({ metodo: l.metodo, ...valoresPag(l) })),
      colunas: [
        { chave: 'metodo', rotulo: 'Método' },
        { chave: 'pagos', rotulo: 'Pagos' },
        { chave: 'pagos_eur', rotulo: 'Pago (€)' },
        { chave: 'por_pagar_agora', rotulo: 'Por pagar' },
        { chave: 'por_pagar_agora_eur', rotulo: 'Por pagar (€)' },
      ],
      filtros: { periodo: p, dias: diasNoPeriodo(p), metodo: e.metodo },
      fonte:
        'Pagamentos de taxas registados no Tou, Câmara?, neste momento ("por pagar" é a fotografia de agora).',
      notas,
    };
  },
});

interface LinhaPag {
  pagos: number;
  pagos_cent: number;
  emitidos: number;
  expirados: number;
  por_pagar: number;
  por_pagar_cent: number;
  por_pagar_fora_prazo: number;
  em_teste: number;
}

function valoresPag(l: LinhaPag): Record<string, Valor> {
  return {
    pagos: l.pagos,
    pagos_eur: euros(l.pagos_cent),
    emitidos: l.emitidos,
    expirados: l.expirados,
    por_pagar_agora: l.por_pagar,
    por_pagar_agora_eur: euros(l.por_pagar_cent),
    por_pagar_fora_prazo: l.por_pagar_fora_prazo,
    modo_teste: l.em_teste > 0,
  };
}

// ----------------------------------------------------------------------
// Marcações
// ----------------------------------------------------------------------

export const marcacoes = consulta({
  nome: 'marcacoes',
  descricao:
    'Marcações de atendimento presencial (balcão, licenciamento...) pelo dia marcado: total, marcadas, realizadas, faltas, canceladas e quantas foram feitas pelo agente. Pode ser no futuro ("amanhã", "esta semana"). Uma linha por agenda.',
  entrada: z
    .object({
      de: DE.describe(
        'Primeiro dia marcado (AAAA-MM-DD), incluído. null = 6 dias antes de ate. Máximo 400 dias.',
      ),
      ate: ATE.describe(
        'Último dia marcado (AAAA-MM-DD), incluído; pode ser no futuro. null = hoje.',
      ),
      agenda: texto(
        'Agenda ou serviço em palavras (ex.: "licenciamento"). null = todas.',
      ),
      estado: z
        .enum(['marcada', 'realizada', 'faltou', 'cancelada'])
        .nullable()
        .describe('Só este estado. null = todos.'),
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoVistas(ctx, e);
    const vistos: Record<string, unknown> = {
      periodo: p,
      dias: diasNoPeriodo(p),
      estado: e.estado,
    };
    let agendas: string[] | null = null;
    if (e.agenda) {
      const todas = await ctx.db.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM agendas WHERE municipio_id = $1 ORDER BY nome`,
        [ctx.municipio.id],
      );
      const a = escolher(todas, e.agenda, 'agenda', 'agenda_desconhecida');
      agendas = a.map((x) => x.id);
      vistos.agendas = a.map((x) => x.nome);
    }
    const linhas = await ctx.db.query<{
      agenda: string;
      total: number;
      marcadas: number;
      realizadas: number;
      faltou: number;
      canceladas: number;
      pelo_agente: number;
    }>(
      `SELECT a.nome AS agenda, count(*)::int AS total,
              count(*) FILTER (WHERE mc.estado = 'marcada')::int AS marcadas,
              count(*) FILTER (WHERE mc.estado = 'realizada')::int AS realizadas,
              count(*) FILTER (WHERE mc.estado = 'faltou')::int AS faltou,
              count(*) FILTER (WHERE mc.estado = 'cancelada')::int AS canceladas,
              count(mc.conversa_id)::int AS pelo_agente
       FROM marcacoes mc
       JOIN agendas a ON a.id = mc.agenda_id
       WHERE a.municipio_id = $1
         AND (lower(mc.periodo) AT TIME ZONE $4::text)::date BETWEEN $2::date AND $3::date
         AND ($5::uuid[] IS NULL OR mc.agenda_id = ANY($5::uuid[]))
         AND ($6::text IS NULL OR mc.estado = $6::text)
       GROUP BY a.id, a.nome
       ORDER BY total DESC, a.nome`,
      [ctx.municipio.id, p.de, p.ate, ctx.municipio.fuso, agendas, e.estado],
    );
    const campos = [
      'total',
      'marcadas',
      'realizadas',
      'faltou',
      'canceladas',
      'pelo_agente',
    ] as const;
    return {
      valores: Object.fromEntries(
        campos.map((c) => [c, linhas.reduce((s, l) => s + l[c], 0)]),
      ),
      unidades: Object.fromEntries(campos.map((c) => [c, 'marcações'])),
      linhas,
      colunas: [
        { chave: 'agenda', rotulo: 'Agenda' },
        { chave: 'total', rotulo: 'Marcações' },
        { chave: 'realizadas', rotulo: 'Realizadas' },
        { chave: 'faltou', rotulo: 'Faltas' },
        { chave: 'canceladas', rotulo: 'Canceladas' },
        { chave: 'pelo_agente', rotulo: 'Pelo agente' },
      ],
      filtros: vistos,
      fonte: 'Marcações das agendas da câmara, neste momento.',
    };
  },
});
