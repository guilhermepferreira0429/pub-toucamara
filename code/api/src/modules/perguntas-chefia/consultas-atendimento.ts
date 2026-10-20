import { z } from 'zod';
import {
  indicadoresDoPeriodo,
  LinhaResultados,
  resumir,
  Resumo,
  resumirProcessos,
  topTemas,
  trabalhoFeito,
} from '../painel/agregados.js';
import {
  baldes,
  diasNoPeriodo,
  Periodo,
  periodoAnterior,
} from '../painel/periodos.js';
import {
  ATE,
  consulta,
  DE,
  escolher,
  euros,
  limite,
  periodoLivre,
  periodoVistas,
  texto,
  Valor,
} from './consulta.js';

/*
 * Atendimento: conversas, temas, perguntas sem resposta, SMS, melhorias ao
 * portal e o resumo da Visão geral. As contagens de conversas vêm das vistas
 * do painel (PainelDadosService + agregados): são os mesmos números que a
 * Visão geral e os Indicadores mostram.
 */

const FONTE_VISTAS =
  'Resumo do painel (Visão geral e Indicadores), atualizado a cada 5 minutos.';

const CANAIS = [
  'telefone',
  'chat',
  'sms',
  'email',
  'balcao',
  'whatsapp',
] as const;

const PERIODO_VISTAS = {
  de: DE.describe(
    'Primeiro dia (AAAA-MM-DD), incluído. null = 6 dias antes de ate. Período máximo: 400 dias.',
  ),
  ate: ATE,
};

const UNIDADES_RESUMO: Record<keyof Resumo, string> = {
  conversas: 'conversas',
  chamadas: 'chamadas',
  escritas: 'conversas escritas',
  resolvidas_sem_humano: 'conversas',
  resolvidas_sem_humano_pct: '%',
  passadas: 'conversas',
  sem_resposta: 'conversas',
  marcacoes: 'conversas',
  emergencias: 'conversas',
  fora_de_horas: 'conversas',
  fora_de_horas_pct: '%',
  duracao_media_s: 'segundos',
};

const COLUNAS_RESUMO = [
  { chave: 'conversas', rotulo: 'Conversas' },
  { chave: 'chamadas', rotulo: 'Chamadas' },
  { chave: 'resolvidas_sem_humano_pct', rotulo: 'Resolvidas sem pessoa (%)' },
  { chave: 'passadas', rotulo: 'Passadas a funcionário' },
  { chave: 'fora_de_horas', rotulo: 'Fora de horas' },
  { chave: 'sem_resposta', rotulo: 'Sem resposta' },
];

function periodoFiltro(p: Periodo) {
  return { periodo: p, dias: diasNoPeriodo(p) };
}

export const conversas = consulta({
  nome: 'conversas',
  descricao:
    'Conversas com o agente num período: total, chamadas (canal telefone), escritas, resolvidas sem pessoa (n.º e % das terminadas), passadas a funcionário, sem resposta, marcações, emergências, fora de horas (n.º e %) e duração média. Filtro por canal; agrupar por canal, dia ou semana.',
  entrada: z
    .object({
      ...PERIODO_VISTAS,
      canal: z
        .enum(CANAIS)
        .nullable()
        .describe('Só este canal (telefone = chamadas). null = todos.'),
      agrupar_por: z
        .enum(['canal', 'dia', 'semana'])
        .nullable()
        .describe('Uma linha por canal, dia ou semana. null = só os totais.'),
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoVistas(ctx, e);
    const doCanal = (ls: readonly LinhaResultados[]) =>
      e.canal ? ls.filter((l) => l.canal === e.canal) : ls;
    const porCanal = await ctx.painel.resultadosPorCanal(ctx.municipio.id, p);
    const r = {
      valores: { ...resumir(doCanal(porCanal)) } as Record<string, Valor>,
      unidades: UNIDADES_RESUMO,
      filtros: { ...periodoFiltro(p), canal: e.canal },
      fonte: FONTE_VISTAS,
      notas: [
        'A % de resolvidas sem pessoa é sobre as conversas já terminadas.',
      ],
    };
    if (e.agrupar_por === 'canal') {
      return {
        ...r,
        linhas: doCanal(porCanal).map((l) => ({
          canal: l.canal ?? null,
          ...resumir([l]),
        })),
        colunas: [{ chave: 'canal', rotulo: 'Canal' }, ...COLUNAS_RESUMO],
      };
    }
    if (e.agrupar_por === 'dia' || e.agrupar_por === 'semana') {
      const ag = e.agrupar_por;
      const linhas = doCanal(
        await ctx.painel.resultadosPorBalde(ctx.municipio.id, p, ag),
      );
      return {
        ...r,
        linhas: baldes(p, ag).map((b) => ({
          [ag]: b,
          ...resumir(linhas.filter((l) => l.balde === b)),
        })),
        colunas: [
          { chave: ag, rotulo: ag === 'dia' ? 'Dia' : 'Semana de' },
          ...COLUNAS_RESUMO,
        ],
      };
    }
    return r;
  },
});

export const temasMaisPerguntados = consulta({
  nome: 'temas_mais_perguntados',
  descricao:
    'Os temas sobre que mais perguntam num período (conversas por tema), com a % de cada um e a variação face ao período anterior do mesmo tamanho. Com tema, só esse tema (ex.: "obras", "água").',
  entrada: z
    .object({
      ...PERIODO_VISTAS,
      tema: texto('Só este tema, em palavras. null = todos.'),
      limite: z
        .number()
        .int()
        .min(1)
        .max(20)
        .nullable()
        .describe('Quantos temas devolver (1 a 20). null = 8.'),
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoVistas(ctx, e);
    // Uma ligação por transação: as leituras vão uma a uma.
    const atual = await ctx.painel.temas(ctx.municipio.id, p);
    const anterior = await ctx.painel.temas(
      ctx.municipio.id,
      periodoAnterior(p),
    );
    let todos = topTemas(atual, anterior, Number.MAX_SAFE_INTEGER);
    const vistos: Record<string, unknown> = periodoFiltro(p);
    if (e.tema) {
      const temas = await ctx.db.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM temas WHERE municipio_id = $1 ORDER BY nome`,
        [ctx.municipio.id],
      );
      const escolhidos = escolher(temas, e.tema, 'tema', 'tema_desconhecido');
      vistos.temas = escolhidos.map((t) => t.nome);
      const ids = new Set(escolhidos.map((t) => t.id));
      todos = todos.filter((t) => ids.has(t.tema_id));
      // Um tema sem conversas no período conta 0 (e não "não existe").
      for (const t of escolhidos) {
        if (!todos.some((x) => x.tema_id === t.id)) {
          todos.push({
            tema_id: t.id,
            tema: t.nome,
            total: 0,
            percentagem: 0,
            anterior: 0,
            variacao: null,
            novo: false,
          });
        }
      }
    }
    const linhas = todos.slice(0, e.limite ?? 8).map((t) => ({
      tema: t.tema,
      total: t.total,
      percentagem: t.percentagem,
      anterior: t.anterior,
      variacao: t.variacao,
    }));
    return {
      valores: {
        conversas: todos.reduce((s, t) => s + t.total, 0),
        conversas_com_tema_no_periodo: atual.reduce((s, t) => s + t.total, 0),
        temas: todos.filter((t) => t.total > 0).length,
      },
      unidades: {
        conversas: 'conversas',
        conversas_com_tema_no_periodo: 'conversas',
        temas: 'temas',
        total: 'conversas',
        anterior: 'conversas',
        percentagem: '%',
        variacao: '%',
      },
      linhas,
      colunas: [
        { chave: 'tema', rotulo: 'Tema' },
        { chave: 'total', rotulo: 'Conversas' },
        { chave: 'percentagem', rotulo: '% do total' },
        { chave: 'anterior', rotulo: 'Período anterior' },
        { chave: 'variacao', rotulo: 'Variação (%)' },
      ],
      total_linhas: todos.length,
      filtros: vistos,
      fonte: FONTE_VISTAS,
      notas: [
        'Só contam as conversas a que já foi atribuído um tema. "percentagem" é a parte de cada tema nessas conversas.',
      ],
    };
  },
});

const ESTADOS_PSR = {
  abertas: ['nova', 'com_equipa', 'espera_camara'],
  resolvidas: ['resolvida'],
  fora_ambito: ['fora_ambito'],
  todas: null,
} as const;

export const perguntasSemResposta = consulta({
  nome: 'perguntas_sem_resposta',
  descricao:
    'Perguntas dos munícipes a que o agente não soube responder (agrupadas): quantas, quantas vezes foram feitas e as mais repetidas, com o que falta. O período aplica-se à última vez que foram feitas.',
  entrada: z
    .object({
      estado: z
        .enum(['abertas', 'resolvidas', 'fora_ambito', 'todas'])
        .nullable()
        .describe('abertas = ainda por resolver (por omissão).'),
      de: DE,
      ate: ATE,
      limite: limite(10),
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoLivre(e);
    const estado = e.estado ?? 'abertas';
    const linhas = await ctx.db.query<{
      id: string;
      texto: string;
      vezes: number;
      estado: string;
      o_que_falta: string | null;
      ultima: string;
      total: number;
      vezes_total: number;
    }>(
      `SELECT id, texto, vezes, estado, o_que_falta,
              to_char(ultima_em AT TIME ZONE $5::text, 'YYYY-MM-DD') AS ultima,
              count(*) OVER ()::int AS total,
              (sum(vezes) OVER ())::int AS vezes_total
       FROM perguntas_sem_resposta
       WHERE municipio_id = $1
         AND ($2::text[] IS NULL OR estado = ANY($2::text[]))
         AND ($3::date IS NULL OR (ultima_em AT TIME ZONE $5::text)::date >= $3::date)
         AND ($4::date IS NULL OR (ultima_em AT TIME ZONE $5::text)::date <= $4::date)
       ORDER BY vezes DESC, ultima_em DESC
       LIMIT $6`,
      [
        ctx.municipio.id,
        ESTADOS_PSR[estado],
        p.de,
        p.ate,
        ctx.municipio.fuso,
        e.limite ?? 10,
      ],
    );
    return {
      valores: {
        perguntas: linhas[0]?.total ?? 0,
        vezes: linhas[0]?.vezes_total ?? 0,
      },
      unidades: { perguntas: 'perguntas', vezes: 'vezes', total: 'vezes' },
      linhas: linhas.map((l) => ({
        id: l.id,
        pergunta: l.texto,
        vezes: l.vezes,
        estado: l.estado,
        o_que_falta: l.o_que_falta,
        ultima_vez: l.ultima,
      })),
      colunas: [
        { chave: 'pergunta', rotulo: 'Pergunta' },
        { chave: 'vezes', rotulo: 'Vezes' },
        { chave: 'o_que_falta', rotulo: 'O que falta' },
        { chave: 'ultima_vez', rotulo: 'Última vez' },
      ],
      total_linhas: linhas[0]?.total ?? 0,
      filtros: { estado, ...p },
      fonte: 'Perguntas sem resposta registadas pelo agente, neste momento.',
    };
  },
});

const MOTIVOS_SMS = {
  fim_chamada: 'Resumo do fim da conversa',
  requerimento: 'Requerimento',
  ocorrencia: 'Ocorrência',
  processo: 'Processo',
  prazo: 'Prazo',
  marcacao: 'Marcação',
  lembrete: 'Lembrete',
  recolha: 'Recolha',
  pagamento: 'Pagamento',
  reclamacao: 'Reclamação',
  relatorio: 'Relatório',
  passagem: 'Resposta de um funcionário',
  identificacao: 'Código de identificação',
} as const;

const MOTIVOS = Object.keys(MOTIVOS_SMS) as (keyof typeof MOTIVOS_SMS)[];

export const smsEnviados = consulta({
  nome: 'sms_enviados',
  descricao:
    'SMS enviados aos munícipes num período: quantos, entregues, segmentos, custo em euros e falhados, por motivo (resumo do fim da conversa, processo, prazo, lembrete, pagamento...).',
  entrada: z
    .object({
      ...PERIODO_VISTAS,
      motivo: z
        .enum(MOTIVOS as [string, ...string[]])
        .nullable()
        .describe('Só este motivo. null = todos.'),
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoVistas(ctx, e);
    // "Enviados" com a mesma regra da vista do painel: enviada_em no período e
    // estado enviada/entregue. Os falhados contam pela hora marcada.
    const linhas = await ctx.db.query<{
      motivo: keyof typeof MOTIVOS_SMS;
      enviados: number;
      entregues: number;
      segmentos: number;
      custo_cent: number;
      falhados: number;
    }>(
      `SELECT motivo,
              count(*) FILTER (WHERE estado IN ('enviada','entregue') AND enviada_em IS NOT NULL)::int AS enviados,
              count(*) FILTER (WHERE estado = 'entregue')::int AS entregues,
              coalesce(sum(coalesce(segmentos, 1)) FILTER (WHERE estado IN ('enviada','entregue')), 0)::int AS segmentos,
              coalesce(sum(coalesce(custo_cent, 0)) FILTER (WHERE estado IN ('enviada','entregue')), 0)::int AS custo_cent,
              count(*) FILTER (WHERE estado = 'falhou')::int AS falhados
       FROM mensagens_saida
       WHERE municipio_id = $1 AND canal = 'sms'
         AND ($4::text IS NULL OR motivo = $4::text)
         AND (coalesce(enviada_em, enviar_em) AT TIME ZONE $5::text)::date BETWEEN $2::date AND $3::date
       GROUP BY motivo
       ORDER BY enviados DESC, motivo`,
      [ctx.municipio.id, p.de, p.ate, e.motivo, ctx.municipio.fuso],
    );
    const soma = (k: 'enviados' | 'entregues' | 'segmentos' | 'falhados') =>
      linhas.reduce((s, l) => s + l[k], 0);
    return {
      valores: {
        enviados: soma('enviados'),
        entregues: soma('entregues'),
        segmentos: soma('segmentos'),
        custo_eur: euros(linhas.reduce((s, l) => s + l.custo_cent, 0)),
        falhados: soma('falhados'),
      },
      unidades: {
        enviados: 'SMS',
        entregues: 'SMS',
        segmentos: 'segmentos',
        custo_eur: '€',
        falhados: 'SMS',
      },
      linhas: linhas.map((l) => ({
        motivo: MOTIVOS_SMS[l.motivo] ?? l.motivo,
        enviados: l.enviados,
        entregues: l.entregues,
        segmentos: l.segmentos,
        custo_eur: euros(l.custo_cent),
        falhados: l.falhados,
      })),
      colunas: [
        { chave: 'motivo', rotulo: 'Motivo' },
        { chave: 'enviados', rotulo: 'Enviados' },
        { chave: 'entregues', rotulo: 'Entregues' },
        { chave: 'segmentos', rotulo: 'Segmentos' },
        { chave: 'custo_eur', rotulo: 'Custo (€)' },
        { chave: 'falhados', rotulo: 'Falhados' },
      ],
      filtros: { ...periodoFiltro(p), motivo: e.motivo },
      fonte: 'Mensagens SMS enviadas pelo Tou, Câmara?, neste momento.',
    };
  },
});

export const melhoriasPortal = consulta({
  nome: 'melhorias_portal',
  descricao:
    'Melhorias ao portal da câmara propostas a partir das perguntas sem resposta: quantas propostas, enviadas, publicadas e rejeitadas no período, e quantas perguntas (e vezes) ficaram resolvidas com as publicadas. Lista as mais recentes.',
  entrada: z
    .object({
      de: DE.describe('Primeiro dia (AAAA-MM-DD). null = desde sempre.'),
      ate: ATE,
    })
    .strict(),
  async executar(ctx, e) {
    const p = periodoLivre(e);
    const resumo: unknown = await ctx.melhorias.resumo(
      ctx.municipio.id,
      p.de ?? undefined,
      p.ate ?? undefined,
    );
    const linhas = await ctx.db.query<{
      id: string;
      titulo: string;
      estado: string;
      criada: string;
      vezes: number;
    }>(
      `SELECT m.id, m.titulo, m.estado,
                to_char(m.criada_em AT TIME ZONE $4::text, 'YYYY-MM-DD') AS criada,
                (SELECT coalesce(sum(q.vezes), 0)::int FROM melhoria_perguntas mp
                 JOIN perguntas_sem_resposta q ON q.id = mp.psr_id
                 WHERE mp.melhoria_id = m.id) AS vezes
         FROM melhorias_portal m
         WHERE m.municipio_id = $1 AND m.estado <> 'rejeitada'
           AND ($2::date IS NULL OR (m.criada_em AT TIME ZONE $4::text)::date >= $2::date)
           AND ($3::date IS NULL OR (m.criada_em AT TIME ZONE $4::text)::date <= $3::date)
         ORDER BY m.criada_em DESC
         LIMIT 20`,
      [ctx.municipio.id, p.de, p.ate, ctx.municipio.fuso],
    );
    const valores = Object.fromEntries(
      Object.entries((resumo ?? {}) as Record<string, unknown>).map(
        ([k, v]) => [k, typeof v === 'number' ? v : Number(v ?? 0)],
      ),
    ) as Record<string, Valor>;
    return {
      valores,
      unidades: {
        propostas: 'melhorias',
        enviadas: 'melhorias',
        publicadas: 'melhorias',
        rejeitadas: 'melhorias',
        perguntas_resolvidas: 'perguntas',
        vezes_resolvidas: 'vezes',
        vezes: 'vezes',
      },
      linhas,
      colunas: [
        { chave: 'titulo', rotulo: 'Melhoria' },
        { chave: 'estado', rotulo: 'Estado' },
        { chave: 'criada', rotulo: 'Proposta em' },
        { chave: 'vezes', rotulo: 'Vezes perguntado' },
      ],
      filtros: { de: p.de ?? 'sempre', ate: p.ate ?? ctx.hoje },
      fonte: 'Melhorias ao portal (Conhecimento), neste momento.',
    };
  },
});

/** Unidades dos indicadores da Visão geral (o valor; a variação é à parte). */
const UNIDADES_INDICADORES: Record<string, string> = {
  conversas: 'conversas',
  chamadas: 'chamadas',
  escritas: 'conversas escritas',
  resolvidas_sem_humano_pct: '%',
  passadas: 'conversas',
  sem_resposta: 'conversas',
  marcacoes: 'conversas',
  fora_de_horas_pct: '%',
  duracao_media_s: 'segundos',
};

export const indicadoresPeriodo = consulta({
  nome: 'indicadores_periodo',
  descricao:
    'O resumo da Visão geral para um período, com o anterior do mesmo tamanho: conversas, chamadas, escritas, % resolvidas sem pessoa, passadas, sem resposta, % fora de horas, duração média (cada um com _anterior e _variacao), o que o agente tratou (requerimentos, ocorrências, marcações, referências MB...), pagamentos, SMS e, agora, processos em curso/atrasados e ocorrências abertas. Usa para "como correu a semana/o mês".',
  entrada: z.object({ ...PERIODO_VISTAS }).strict(),
  async executar(ctx, e) {
    const p = periodoVistas(ctx, e);
    const ant = periodoAnterior(p);
    const id = ctx.municipio.id;
    // Uma ligação por transação: as leituras vão uma a uma.
    const atual = await ctx.painel.resultadosPorCanal(id, p);
    const anterior = await ctx.painel.resultadosPorCanal(id, ant);
    const trab = await ctx.painel.trabalho(id, p);
    const fases = await ctx.painel.processosFases(id);
    const abertas = await ctx.painel.ocorrenciasAbertas(id);
    const valores: Record<string, Valor> = {};
    const unidades: Record<string, string> = {};
    const ind = indicadoresDoPeriodo(resumir(atual), resumir(anterior));
    for (const [k, i] of Object.entries(ind)) {
      valores[k] = i.valor;
      valores[`${k}_anterior`] = i.anterior;
      valores[`${k}_variacao`] = i.variacao;
      unidades[k] = UNIDADES_INDICADORES[k] ?? '';
      unidades[`${k}_anterior`] = unidades[k];
      unidades[`${k}_variacao`] =
        i.unidade === 'pct' ? 'pontos percentuais' : '%';
    }
    for (const [k, v] of Object.entries(trabalhoFeito(trab))) {
      valores[`agente_${k}`] = typeof v === 'number' ? v : v.valor;
    }
    const proc = resumirProcessos(fases);
    Object.assign(valores, {
      pagamentos_pagos: trab.pagamentos_pagos,
      pagos_eur: euros(trab.pagos_cent),
      sms_enviados: trab.sms_enviados,
      ocorrencias_registadas: trab.ocorrencias,
      ocorrencias_resolvidas: trab.ocorrencias_resolvidas,
      // Como em contar_processos: em curso = sem notificados nem arquivados
      // (o resumirProcessos do painel soma também os notificados).
      processos_em_curso_agora: proc.por_fase
        .filter((f) => f.fase !== 'notificado')
        .reduce((s, f) => s + f.total, 0),
      processos_atrasados_agora: proc.atrasados,
      ocorrencias_abertas_agora: abertas,
    });
    Object.assign(unidades, {
      agente_requerimentos: 'requerimentos',
      agente_ocorrencias_agente: 'ocorrências',
      agente_consultas_processo: 'consultas',
      agente_referencias_mb: 'referências',
      agente_marcacoes: 'marcações',
      agente_recolhas: 'recolhas',
      agente_passagens: 'passagens',
      pagamentos_pagos: 'pagamentos',
      pagos_eur: '€',
      sms_enviados: 'SMS',
      ocorrencias_registadas: 'ocorrências',
      ocorrencias_resolvidas: 'ocorrências',
      processos_em_curso_agora: 'processos',
      processos_atrasados_agora: 'processos',
      ocorrencias_abertas_agora: 'ocorrências',
    });
    return {
      valores,
      unidades,
      filtros: {
        ...periodoFiltro(p),
        periodo_anterior: ant,
      },
      fonte: FONTE_VISTAS,
      notas: [
        '_variacao: % face ao período anterior; nas percentagens, diferença em pontos. null = sem base para comparar.',
        'agente_*: o que o agente tratou sozinho no período. *_agora: fotografia deste momento.',
      ],
    };
  },
});
