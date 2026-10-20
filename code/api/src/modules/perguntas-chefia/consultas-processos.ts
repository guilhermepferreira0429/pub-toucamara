import { z } from 'zod';
import { diasUteisEntre, somarDiasUteis } from '../../common/dias-uteis.js';
import { diasNoPeriodo } from '../painel/periodos.js';
import {
  Fase,
  FASE_ROTULO,
  FASES,
  FASES_FECHADAS,
} from '../processos/regras.js';
import {
  ATE,
  consulta,
  ContextoConsulta,
  DE,
  dia,
  escolher,
  limite,
  media,
  mediana,
  periodoLivre,
  texto,
  umaCasa,
  Valor,
} from './consulta.js';

/*
 * Processos (back-office próprio): direto às tabelas, para os números baterem
 * com a lista do painel no mesmo instante. "Atrasado" e "aguarda munícipe"
 * têm a mesma definição da lista dos processos (processos-painel.service).
 */

const FONTE =
  'Processos registados no Tou, Câmara? (back-office próprio), neste momento.';

const filtros = {
  tipo: texto(
    'Tipo de processo em palavras ou pelo código (ex.: "obras", "comunicação prévia", "CP"). Pode apanhar vários tipos. null = todos.',
  ),
  fase: z
    .enum(FASES)
    .nullable()
    .describe(
      'Fase atual: entrada, documentos, apreciacao, pareceres_externos, decisao, notificado (já decidido e comunicado), arquivado. null = todas.',
    ),
  tecnico: texto(
    'Nome (ou parte do nome) do técnico responsável. null = todos.',
  ),
  sem_tecnico: z
    .boolean()
    .nullable()
    .describe('true = só os que ainda não têm técnico atribuído.'),
  zona: texto(
    'Freguesia ou rua: procura no campo freguesia e na morada. null = todo o concelho.',
  ),
  atrasados: z
    .boolean()
    .nullable()
    .describe(
      'true = só os atrasados: o prazo da câmara já passou e ainda não foram notificados nem arquivados.',
    ),
  a_terminar_dias_uteis: z
    .number()
    .int()
    .min(1)
    .max(60)
    .nullable()
    .describe(
      'Só os em curso cujo prazo acaba entre hoje e daqui a N dias úteis (1 a 60; não inclui os já atrasados). null = sem este filtro.',
    ),
  aguarda_municipe: z
    .boolean()
    .nullable()
    .describe(
      'true = só os que estão à espera do munícipe (fase documentos ou um pedido de documentos por responder).',
    ),
  decisao: z
    .enum(['admitido', 'indeferido'])
    .nullable()
    .describe('Só os já decididos com esta decisão. null = qualquer.'),
  data: z
    .enum(['entrada', 'decisao'])
    .nullable()
    .describe(
      'A que data se aplica o período de/ate: entrada (quando o processo deu entrada) ou decisao. null = entrada.',
    ),
  de: DE,
  ate: ATE,
  incluir_fechados: z
    .boolean()
    .nullable()
    .describe(
      'null = automático: sem período, fase nem decisão conta só os em curso (sem notificados nem arquivados); com período, fase ou decisão conta todos. true = todos; false = só em curso.',
    ),
};

const esquemaFiltros = z.object(filtros).strict();
type Filtros = z.output<typeof esquemaFiltros>;

interface ItemNome {
  id: string;
  nome: string;
}

/** Os tipos de processo do município que o termo apanha. */
async function tiposDe(ctx: ContextoConsulta, termo: string) {
  const todos = await ctx.db.query<{
    id: string;
    codigo: string;
    nome: string;
  }>(
    `SELECT id, codigo, nome FROM tipos_processo WHERE municipio_id = $1 ORDER BY codigo`,
    [ctx.municipio.id],
  );
  return escolher(todos, termo, 'tipo de processo', 'tipo_desconhecido');
}

/** Os filtros já resolvidos, como parâmetros fixos $1..$16 do WHERE. */
async function resolverFiltros(ctx: ContextoConsulta, e: Filtros) {
  const p = periodoLivre(e);
  const vistos: Record<string, unknown> = {};

  const tipos = e.tipo ? await tiposDe(ctx, e.tipo) : null;
  if (tipos) vistos.tipos = tipos.map((t) => `${t.codigo} · ${t.nome}`);
  let tecnicos: ItemNome[] | null = null;
  if (e.tecnico) {
    const todos = await ctx.db.query<ItemNome>(
      `SELECT id, nome FROM utilizadores WHERE municipio_id = $1 ORDER BY nome`,
      [ctx.municipio.id],
    );
    tecnicos = escolher(todos, e.tecnico, 'técnico', 'tecnico_desconhecido');
    vistos.tecnicos = tecnicos.map((t) => t.nome);
  }
  const ateTerminar = e.a_terminar_dias_uteis
    ? somarDiasUteis(ctx.hoje, e.a_terminar_dias_uteis, ctx.feriados)
    : null;
  if (ateTerminar) vistos.prazo_entre = [ctx.hoje, ateTerminar];

  const automatico = !(p.de || p.ate || e.fase || e.decisao);
  const soEmCurso =
    !e.fase && (e.incluir_fechados === null ? automatico : !e.incluir_fechados);
  vistos.so_em_curso = soEmCurso;
  if (p.de || p.ate) vistos.periodo_de = e.data ?? 'entrada';

  const params: unknown[] = [
    ctx.municipio.id, // $1
    tipos?.map((t) => t.id) ?? null, // $2
    e.fase, // $3
    soEmCurso, // $4
    tecnicos?.map((t) => t.id) ?? null, // $5
    e.sem_tecnico ?? false, // $6
    e.zona, // $7
    e.atrasados ?? false, // $8
    ateTerminar, // $9
    e.aguarda_municipe ?? false, // $10
    e.decisao, // $11
    e.data === 'decisao', // $12
    p.de, // $13
    p.ate, // $14
    ctx.hoje, // $15
    ctx.municipio.fuso, // $16
  ];
  return { params, filtros: vistos };
}

const ABERTO = `p.fase NOT IN ('notificado', 'arquivado')`;
const ATRASADO = `(p.prazo_fim < $15::date AND ${ABERTO})`;
const AGUARDA = `(${ABERTO} AND (p.fase = 'documentos' OR EXISTS (
    SELECT 1 FROM processo_pedidos_estado pe
    WHERE pe.processo_id = p.id AND pe.respondido_em IS NULL)))`;
const DATA_PERIODO = `(CASE WHEN $12::boolean THEN (p.decidido_em AT TIME ZONE $16::text)::date
                       ELSE (p.criado_em AT TIME ZONE $16::text)::date END)`;

/** FROM + WHERE fixos; só os parâmetros mudam. */
export const DE_PROCESSOS = `
  FROM processos p
  JOIN tipos_processo t ON t.id = p.tipo_processo_id
  LEFT JOIN utilizadores u ON u.id = p.tecnico_id
  WHERE p.municipio_id = $1
    AND ($2::uuid[] IS NULL OR p.tipo_processo_id = ANY($2::uuid[]))
    AND ($3::fase_processo IS NULL OR p.fase = $3::fase_processo)
    AND (NOT $4::boolean OR ${ABERTO})
    AND ($5::uuid[] IS NULL OR p.tecnico_id = ANY($5::uuid[]))
    AND (NOT $6::boolean OR p.tecnico_id IS NULL)
    AND ($7::text IS NULL OR position(lower(unaccent($7::text)) IN
         lower(unaccent(coalesce(p.freguesia, '') || ' ' || coalesce(p.morada, '')))) > 0)
    AND (NOT $8::boolean OR ${ATRASADO})
    AND ($9::date IS NULL OR (p.prazo_fim BETWEEN $15::date AND $9::date AND ${ABERTO}))
    AND (NOT $10::boolean OR ${AGUARDA})
    AND ($11::text IS NULL OR p.decisao = $11::text)
    AND ($13::date IS NULL OR ${DATA_PERIODO} >= $13::date)
    AND ($14::date IS NULL OR ${DATA_PERIODO} <= $14::date)`;

/** Expressões de agrupamento: escolhidas daqui, nunca do texto do modelo. */
const GRUPOS = {
  tipo: `t.codigo || ' · ' || t.nome`,
  fase: `p.fase::text`,
  tecnico: `coalesce(u.nome, 'Sem técnico')`,
  freguesia: `coalesce(p.freguesia, 'Sem freguesia')`,
} as const;

export const contarProcessos = consulta({
  nome: 'contar_processos',
  descricao:
    'Conta processos (obras, licenças, comunicações prévias...) com filtros: tipo, fase, técnico, zona, atrasados, prazo a terminar, à espera do munícipe, decisão e período de entrada ou decisão. Devolve valores.total e, com agrupar_por, uma linha por grupo (total e atrasados). Usa para "quantos processos...".',
  entrada: esquemaFiltros
    .extend({
      agrupar_por: z
        .enum(['tipo', 'fase', 'tecnico', 'freguesia'])
        .nullable()
        .describe(
          'Uma linha por tipo, fase, técnico ou freguesia. null = só o total.',
        ),
    })
    .strict(),
  async executar(ctx, e) {
    const { params, filtros: vistos } = await resolverFiltros(ctx, e);
    const [t] = await ctx.db.query<{ total: number; atrasados: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE ${ATRASADO})::int AS atrasados
       ${DE_PROCESSOS}`,
      params,
    );
    const r = {
      valores: { total: t.total, atrasados: t.atrasados } as Record<
        string,
        Valor
      >,
      unidades: { total: 'processos', atrasados: 'processos' },
      filtros: vistos,
      fonte: FONTE,
    };
    if (!e.agrupar_por) return r;

    const linhas = await ctx.db.query<{
      grupo: string;
      total: number;
      atrasados: number;
    }>(
      `SELECT ${GRUPOS[e.agrupar_por]} AS grupo, count(*)::int AS total,
              count(*) FILTER (WHERE ${ATRASADO})::int AS atrasados
       ${DE_PROCESSOS}
       GROUP BY 1 ORDER BY total DESC, grupo`,
      params,
    );
    return {
      ...r,
      linhas: linhas.map((l) => ({
        grupo:
          e.agrupar_por === 'fase' ? FASE_ROTULO[l.grupo as Fase] : l.grupo,
        total: l.total,
        atrasados: l.atrasados,
      })),
      colunas: [
        { chave: 'grupo', rotulo: ROTULO_GRUPO[e.agrupar_por] },
        { chave: 'total', rotulo: 'Processos' },
        { chave: 'atrasados', rotulo: 'Atrasados' },
      ],
    };
  },
});

const ROTULO_GRUPO = {
  tipo: 'Tipo',
  fase: 'Fase',
  tecnico: 'Técnico',
  freguesia: 'Freguesia',
} as const;

const ORDENS = {
  prazo: `coalesce(p.prazo_fim, 'infinity'::date), p.numero`,
  entrada_recente: `p.criado_em DESC, p.numero`,
  entrada_antiga: `p.criado_em, p.numero`,
} as const;

export const listarProcessos = consulta({
  nome: 'listar_processos',
  descricao:
    'Lista processos com os mesmos filtros de contar_processos (número, tipo, assunto, freguesia, fase, técnico, prazo, dias úteis restantes, atrasado). Usa quando pedem "quais" ou uma lista. total_linhas diz quantos há no total.',
  entrada: esquemaFiltros
    .extend({
      ordenar: z
        .enum(['prazo', 'entrada_recente', 'entrada_antiga'])
        .nullable()
        .describe('prazo = o mais urgente primeiro (por omissão).'),
      limite: limite(20),
    })
    .strict(),
  async executar(ctx, e) {
    const { params, filtros: vistos } = await resolverFiltros(ctx, e);
    const linhas = await ctx.db.query<{
      id: string;
      numero: string;
      tipo: string;
      assunto: string;
      freguesia: string | null;
      fase: Fase;
      tecnico: string | null;
      prazo_fim: string | null;
      entrada: string;
      total: number;
    }>(
      `SELECT p.id, p.numero, t.codigo AS tipo, p.assunto, p.freguesia, p.fase::text AS fase,
              u.nome AS tecnico, to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim,
              to_char(p.criado_em AT TIME ZONE $16::text, 'YYYY-MM-DD') AS entrada,
              count(*) OVER ()::int AS total
       ${DE_PROCESSOS}
       ORDER BY ${ORDENS[e.ordenar ?? 'prazo']}
       LIMIT $17`,
      [...params, e.limite ?? 20],
    );
    const total = linhas[0]?.total ?? 0;
    return {
      valores: { total },
      unidades: { total: 'processos', dias_uteis_restantes: 'dias úteis' },
      linhas: linhas.map((l) => {
        const aberto = !FASES_FECHADAS.includes(l.fase);
        return {
          id: l.id,
          numero: l.numero,
          tipo: l.tipo,
          assunto: l.assunto,
          freguesia: l.freguesia,
          fase: FASE_ROTULO[l.fase],
          tecnico: l.tecnico,
          entrada: l.entrada,
          prazo_fim: l.prazo_fim,
          dias_uteis_restantes:
            aberto && l.prazo_fim
              ? diasUteisEntre(ctx.hoje, l.prazo_fim, ctx.feriados)
              : null,
          atrasado: aberto && !!l.prazo_fim && l.prazo_fim < ctx.hoje,
        };
      }),
      colunas: [
        { chave: 'numero', rotulo: 'Processo' },
        { chave: 'tipo', rotulo: 'Tipo' },
        { chave: 'assunto', rotulo: 'Assunto' },
        { chave: 'freguesia', rotulo: 'Freguesia' },
        { chave: 'fase', rotulo: 'Fase' },
        { chave: 'tecnico', rotulo: 'Técnico' },
        { chave: 'entrada', rotulo: 'Entrada' },
        { chave: 'prazo_fim', rotulo: 'Prazo' },
        { chave: 'dias_uteis_restantes', rotulo: 'Dias úteis restantes' },
        { chave: 'atrasado', rotulo: 'Atrasado' },
      ],
      objeto: 'processo',
      total_linhas: total,
      filtros: vistos,
      fonte: FONTE,
    };
  },
});

/** Dias de calendário entre duas datas 'YYYY-MM-DD'. */
function diasCorridos(de: string, ate: string): number {
  return Math.round(
    (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 864e5,
  );
}

interface LinhaTempo {
  tipo_id: string;
  codigo: string;
  nome: string;
  prazo_legal: number;
  entrada: string;
  decisao: string | null;
  prazo_fim: string | null;
}

export const temposProcessos = consulta({
  nome: 'tempos_processos',
  descricao:
    'Quanto tempo demoram os processos, da entrada à decisão: média e mediana em dias úteis (e média em dias de calendário), % decididos dentro do prazo da câmara e prazo legal do tipo. Também os em curso e há quantos dias úteis estão abertos, em média. O período (de/ate) aplica-se à data da decisão. Uma linha por tipo.',
  entrada: z
    .object({
      tipo: filtros.tipo,
      de: dia(
        'Decididos a partir deste dia (AAAA-MM-DD). null = desde sempre.',
      ),
      ate: dia('Decididos até este dia (AAAA-MM-DD). null = até hoje.'),
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoLivre(e);
    const vistos: Record<string, unknown> = {};
    const tipos = e.tipo ? await tiposDe(ctx, e.tipo) : null;
    if (tipos) vistos.tipos = tipos.map((t) => `${t.codigo} · ${t.nome}`);
    const tipoIds = tipos?.map((t) => t.id) ?? null;
    const linhas = await ctx.db.query<LinhaTempo>(
      `SELECT t.id AS tipo_id, t.codigo, t.nome, t.prazo_dias_uteis AS prazo_legal,
              to_char(p.criado_em AT TIME ZONE $2::text, 'YYYY-MM-DD') AS entrada,
              to_char(p.decidido_em AT TIME ZONE $2::text, 'YYYY-MM-DD') AS decisao,
              to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim
       FROM processos p
       JOIN tipos_processo t ON t.id = p.tipo_processo_id
       WHERE p.municipio_id = $1
         AND ($3::uuid[] IS NULL OR p.tipo_processo_id = ANY($3::uuid[]))
         AND (
           (p.decidido_em IS NOT NULL
             AND ($4::date IS NULL OR (p.decidido_em AT TIME ZONE $2::text)::date >= $4::date)
             AND ($5::date IS NULL OR (p.decidido_em AT TIME ZONE $2::text)::date <= $5::date))
           OR (p.decidido_em IS NULL AND p.fase NOT IN ('notificado', 'arquivado'))
         )
       ORDER BY t.codigo
       LIMIT 10000`,
      [ctx.municipio.id, ctx.municipio.fuso, tipoIds, p.de, p.ate],
    );

    const contas = (ls: LinhaTempo[]) => {
      const decididos = ls.filter((l) => l.decisao);
      const emCurso = ls.filter((l) => !l.decisao);
      const uteis = decididos.map((l) =>
        diasUteisEntre(l.entrada, l.decisao!, ctx.feriados),
      );
      const comPrazo = decididos.filter((l) => l.prazo_fim);
      const prazos = [...new Set(ls.map((l) => l.prazo_legal))];
      return {
        decididos: decididos.length,
        media_dias_uteis: media(uteis),
        mediana_dias_uteis: mediana(uteis),
        media_dias_corridos: media(
          decididos.map((l) => diasCorridos(l.entrada, l.decisao!)),
        ),
        dentro_do_prazo_pct: comPrazo.length
          ? umaCasa(
              (comPrazo.filter((l) => l.decisao! <= l.prazo_fim!).length /
                comPrazo.length) *
                100,
            )
          : null,
        prazo_legal_dias_uteis: prazos.length === 1 ? prazos[0] : null,
        em_curso: emCurso.length,
        media_dias_uteis_em_curso: media(
          emCurso.map((l) => diasUteisEntre(l.entrada, ctx.hoje, ctx.feriados)),
        ),
      };
    };

    const porTipo = new Map<string, LinhaTempo[]>();
    for (const l of linhas) {
      porTipo.set(l.tipo_id, [...(porTipo.get(l.tipo_id) ?? []), l]);
    }
    const dias = 'dias úteis';
    return {
      valores: contas(linhas),
      unidades: {
        decididos: 'processos',
        em_curso: 'processos',
        media_dias_uteis: dias,
        mediana_dias_uteis: dias,
        media_dias_corridos: 'dias',
        dentro_do_prazo_pct: '%',
        prazo_legal_dias_uteis: dias,
        media_dias_uteis_em_curso: dias,
      },
      linhas: [...porTipo.values()].map((ls) => ({
        tipo: `${ls[0].codigo} · ${ls[0].nome}`,
        ...contas(ls),
      })),
      colunas: [
        { chave: 'tipo', rotulo: 'Tipo' },
        { chave: 'decididos', rotulo: 'Decididos' },
        { chave: 'media_dias_uteis', rotulo: 'Média (dias úteis)' },
        { chave: 'mediana_dias_uteis', rotulo: 'Mediana (dias úteis)' },
        { chave: 'prazo_legal_dias_uteis', rotulo: 'Prazo legal (dias úteis)' },
        { chave: 'dentro_do_prazo_pct', rotulo: 'Dentro do prazo (%)' },
        { chave: 'em_curso', rotulo: 'Em curso' },
      ],
      filtros: {
        ...vistos,
        decididos_entre: [p.de ?? 'sempre', p.ate ?? ctx.hoje],
        ...(p.de && p.ate
          ? { dias: diasNoPeriodo({ de: p.de, ate: p.ate }) }
          : {}),
      },
      fonte: FONTE,
      notas: [
        'Tempo contado da entrada do processo até à decisão (dias úteis sem fins de semana nem feriados). O prazo legal da câmara só começa a contar com o processo completo.',
      ],
    };
  },
});

export const cargaTecnicos = consulta({
  nome: 'carga_tecnicos',
  descricao:
    'Processos em curso por técnico: quantos tem, atrasados, com prazo a terminar nos próximos N dias úteis e à espera do munícipe. Inclui a linha "Sem técnico". Usa para "quem tem mais processos", "carga da equipa".',
  entrada: z
    .object({
      tipo: filtros.tipo,
      dias_uteis: z
        .number()
        .int()
        .min(1)
        .max(30)
        .nullable()
        .describe('Janela do "a terminar", em dias úteis (1 a 30). null = 5.'),
    })
    .strict(),
  async executar(ctx, e) {
    const dias = e.dias_uteis ?? 5;
    const vistos: Record<string, unknown> = { a_terminar_dias_uteis: dias };
    const tipos = e.tipo ? await tiposDe(ctx, e.tipo) : null;
    if (tipos) vistos.tipos = tipos.map((t) => `${t.codigo} · ${t.nome}`);
    const tipoIds = tipos?.map((t) => t.id) ?? null;
    const limiteData = somarDiasUteis(ctx.hoje, dias, ctx.feriados);
    const linhas = await ctx.db.query<{
      tecnico: string;
      em_curso: number;
      atrasados: number;
      a_terminar: number;
      aguarda_municipe: number;
    }>(
      `SELECT coalesce(u.nome, 'Sem técnico') AS tecnico,
              count(*)::int AS em_curso,
              count(*) FILTER (WHERE p.prazo_fim < $2::date)::int AS atrasados,
              count(*) FILTER (WHERE p.prazo_fim BETWEEN $2::date AND $3::date)::int AS a_terminar,
              count(*) FILTER (WHERE p.fase = 'documentos' OR EXISTS (
                SELECT 1 FROM processo_pedidos_estado pe
                WHERE pe.processo_id = p.id AND pe.respondido_em IS NULL))::int AS aguarda_municipe
       FROM processos p
       LEFT JOIN utilizadores u ON u.id = p.tecnico_id
       WHERE p.municipio_id = $1 AND p.fase NOT IN ('notificado', 'arquivado')
         AND ($4::uuid[] IS NULL OR p.tipo_processo_id = ANY($4::uuid[]))
       GROUP BY p.tecnico_id, u.nome
       ORDER BY em_curso DESC, tecnico`,
      [ctx.municipio.id, ctx.hoje, limiteData, tipoIds],
    );
    const soma = (k: 'em_curso' | 'atrasados' | 'a_terminar') =>
      linhas.reduce((s, l) => s + l[k], 0);
    return {
      valores: {
        tecnicos: linhas.filter((l) => l.tecnico !== 'Sem técnico').length,
        em_curso: soma('em_curso'),
        atrasados: soma('atrasados'),
        a_terminar: soma('a_terminar'),
      },
      unidades: {
        tecnicos: 'técnicos',
        em_curso: 'processos',
        atrasados: 'processos',
        a_terminar: 'processos',
        aguarda_municipe: 'processos',
      },
      linhas,
      colunas: [
        { chave: 'tecnico', rotulo: 'Técnico' },
        { chave: 'em_curso', rotulo: 'Em curso' },
        { chave: 'atrasados', rotulo: 'Atrasados' },
        {
          chave: 'a_terminar',
          rotulo: `Prazo nos próximos ${dias} dias úteis`,
        },
        { chave: 'aguarda_municipe', rotulo: 'À espera do munícipe' },
      ],
      filtros: { ...vistos, prazo_entre: [ctx.hoje, limiteData] },
      fonte: FONTE,
    };
  },
});
