/*
 * Balcão para empresas (FUN §4): a partir do perfil da empresa (o que faz e
 * o que vai ter), a lista do que precisa, com o porquê, onde se trata, o
 * prazo e a taxa estimada; e o calendário de obrigações (renovações das
 * licenças que já tem, taxas e prazos). Puro, sem BD, para testar à parte.
 *
 * As taxas estimadas reutilizam as contas das licenças (licencas/regras-*)
 * com as regras em vigor da câmara, e o simulador da tabela de taxas
 * (pagamentos/taxas.ts) para os tipos de processo (ex.: obras, 'CP').
 */
import { z } from 'zod';
import { eDiaUtil, type Feriados } from '../../common/dias-uteis.js';
import {
  dataPorExtenso,
  num,
  somarDias,
  somarMeses,
} from '../licencas/comum.js';
import {
  type ConfigEsplanada,
  type PedidoEsplanada,
  taxaEsplanada,
} from '../licencas/regras-esplanada.js';
import type { ConfigOcupacao } from '../licencas/regras-ocupacao.js';
import {
  type ConfigPublicidade,
  isentaPublicidade,
  type PedidoPublicidade,
  taxaPublicidade,
} from '../licencas/regras-publicidade.js';
import type { ConfigRecinto } from '../licencas/regras-recinto.js';
import type { ConfigRuido } from '../licencas/regras.js';
import { DEFS, TIPOS, type TipoLicenca } from '../licencas/tipos.js';
import {
  calcularTaxas,
  formatarEuros,
  type Taxa,
} from '../pagamentos/taxas.js';

// ---------------------------------------------------------------------
// Perfil da empresa
// ---------------------------------------------------------------------

export const ATIVIDADES = {
  restauracao: 'Restaurante, café ou bar',
  comercio: 'Loja (comércio a retalho)',
  cabeleireiro_estetica: 'Cabeleireiro, barbearia ou estética',
  alojamento_local: 'Alojamento local',
  oficina: 'Oficina de automóveis ou motas',
  servicos: 'Escritório ou serviços',
  eventos: 'Espetáculos e eventos',
} as const;
export type Atividade = keyof typeof ATIVIDADES;
export const CHAVES_ATIVIDADE = Object.keys(ATIVIDADES) as [
  Atividade,
  ...Atividade[],
];

/** "um restaurante, café ou bar" (no meio de uma frase). */
const ATIVIDADE_FRASE: Record<Atividade, string> = {
  restauracao: 'um restaurante, café ou bar',
  comercio: 'uma loja',
  cabeleireiro_estetica: 'um cabeleireiro ou estética',
  alojamento_local: 'um alojamento local',
  oficina: 'uma oficina',
  servicos: 'um escritório ou serviços',
  eventos: 'espetáculos e eventos',
};

/** As respostas sim/não do perfil. */
export const FLAGS = [
  'esplanada',
  'publicidade',
  'obras',
  'musica',
  'eventos_rua',
  'ocupacao_via',
  'horario_alargado',
  'vende_alimentos',
  'atendimento_publico',
  'centro_historico',
] as const;
export type Flag = (typeof FLAGS)[number];

export const ROTULOS_FLAG: Record<Flag, string> = {
  esplanada: 'Esplanada no passeio',
  publicidade: 'Placa, letreiro, reclamo ou toldo',
  obras: 'Obras no espaço',
  musica: 'Música ao vivo, DJ ou som alto',
  eventos_rua: 'Eventos ao ar livre',
  ocupacao_via: 'Ocupar a rua (cargas, estaleiro, contentor)',
  horario_alargado: 'Horário alargado',
  vende_alimentos: 'Vende alimentos ou bebidas',
  atendimento_publico: 'Recebe clientes no espaço',
  centro_historico: 'Fica no centro histórico',
};

/** A pergunta de cada resposta e o porquê que aparece na lista. */
const PERGUNTA_FLAG: Record<Flag, { pergunta: string; porque: string }> = {
  esplanada: {
    pergunta: 'Vai ter esplanada, com mesas e cadeiras no passeio?',
    porque: 'Vai ter esplanada.',
  },
  publicidade: {
    pergunta:
      'Vai ter placa, letreiro, reclamo ou toldo com o nome na fachada?',
    porque: 'Vai ter placa, letreiro ou toldo na fachada.',
  },
  obras: {
    pergunta: 'Vai fazer obras no espaço (fachada, divisões, instalações)?',
    porque: 'Vai fazer obras no espaço.',
  },
  musica: {
    pergunta: 'Vai ter música ao vivo, DJ ou som alto?',
    porque: 'Vai ter música ou som alto.',
  },
  eventos_rua: {
    pergunta:
      'Vai organizar eventos ao ar livre (arraial, concerto, feira, festa na rua)?',
    porque: 'Vai organizar eventos ao ar livre.',
  },
  ocupacao_via: {
    pergunta:
      'Vai precisar de ocupar a rua (cargas e descargas, estaleiro, contentor, andaime)?',
    porque: 'Vai ocupar a rua (cargas, estaleiro ou contentor).',
  },
  horario_alargado: {
    pergunta:
      'Vai abrir fora do horário normal (de madrugada ou até mais tarde)?',
    porque: 'Quer abrir fora do horário normal.',
  },
  vende_alimentos: {
    pergunta: 'Vende alimentos ou bebidas?',
    porque: 'Vende alimentos ou bebidas.',
  },
  atendimento_publico: {
    pergunta: 'Recebe clientes no espaço (atendimento ao público)?',
    porque: 'Recebe clientes no espaço.',
  },
  centro_historico: {
    pergunta: 'O espaço fica no centro histórico?',
    porque: 'Fica no centro histórico.',
  },
};

/** A que atividades se pergunta cada coisa (as outras não precisam). */
const PERGUNTA_A: Record<Flag, readonly Atividade[] | 'todas'> = {
  esplanada: ['restauracao'],
  publicidade: 'todas',
  obras: 'todas',
  musica: ['restauracao', 'eventos'],
  eventos_rua: ['restauracao', 'comercio', 'eventos'],
  ocupacao_via: ['comercio', 'oficina', 'eventos'],
  horario_alargado: ['restauracao', 'comercio'],
  vende_alimentos: ['comercio'],
  atendimento_publico: ['servicos'],
  centro_historico: 'todas',
};

const boolOpc = (d: string) => z.boolean().optional().describe(d);

export const esquemaPerfil = z.object({
  atividade: z
    .enum(CHAVES_ATIVIDADE)
    .optional()
    .describe(
      'restauracao (restaurante, café, bar), comercio (loja), cabeleireiro_estetica, alojamento_local, oficina, servicos (escritório) ou eventos (espetáculos e eventos).',
    ),
  fase: z
    .enum(['abrir', 'aberta'])
    .optional()
    .describe('abrir: vai abrir agora; aberta: já está a funcionar.'),
  abertura: z.iso
    .date()
    .optional()
    .describe('Quando conta abrir, AAAA-MM-DD (aproximado serve).'),
  esplanada: boolOpc('Se vai ter esplanada no passeio.'),
  publicidade: boolOpc('Se vai ter placa, letreiro, reclamo ou toldo.'),
  obras: boolOpc('Se vai fazer obras no espaço.'),
  musica: boolOpc('Se vai ter música ao vivo, DJ ou som alto.'),
  eventos_rua: boolOpc('Se vai organizar eventos ao ar livre.'),
  ocupacao_via: boolOpc(
    'Se vai ocupar a rua (cargas e descargas, estaleiro, contentor, andaime).',
  ),
  horario_alargado: boolOpc('Se quer abrir fora do horário normal.'),
  vende_alimentos: boolOpc('Se vende alimentos ou bebidas (lojas).'),
  atendimento_publico: boolOpc('Se recebe clientes no espaço (escritórios).'),
  centro_historico: boolOpc('Se o espaço fica no centro histórico.'),
  area_esplanada_m2: z
    .number()
    .positive()
    .max(1000)
    .optional()
    .describe('Área da esplanada em m², se souber (para a taxa).'),
  area_publicidade_m2: z
    .number()
    .positive()
    .max(200)
    .optional()
    .describe('Área do anúncio em m², se souber (para a taxa).'),
  publicidade_iluminada: boolOpc('Se o anúncio é iluminado.'),
  area_obra_m2: z
    .number()
    .positive()
    .max(100_000)
    .optional()
    .describe('Área da obra em m², se souber (para a taxa).'),
});
export type Perfil = z.output<typeof esquemaPerfil>;

/** O perfil novo por cima do anterior (só o que veio definido). */
export function juntarPerfis(antes: Perfil, novo: Perfil): Perfil {
  const r: Record<string, unknown> = { ...antes };
  for (const [k, v] of Object.entries(novo)) if (v !== undefined) r[k] = v;
  return r;
}

/** As respostas, com as que se deduzem da atividade. */
export function flagsDe(p: Perfil): Record<Flag, boolean> {
  const f = Object.fromEntries(FLAGS.map((k) => [k, p[k] === true])) as Record<
    Flag,
    boolean
  >;
  if (p.atividade === 'restauracao') f.vende_alimentos = true;
  // Quem não é escritório recebe clientes, salvo se disser que não.
  if (p.atividade && p.atividade !== 'servicos') {
    f.atendimento_publico = p.atendimento_publico !== false;
  }
  return f;
}

export interface Pergunta {
  campo: 'atividade' | 'fase' | 'abertura' | Flag;
  pergunta: string;
}

function perguntaSe(campo: Flag, p: Perfil): boolean {
  if (p[campo] !== undefined || !p.atividade) return false;
  if (campo === 'centro_historico') {
    return !!(p.esplanada || p.publicidade || p.obras);
  }
  // Quem faz obras pode precisar da rua (andaime, contentor).
  if (campo === 'ocupacao_via' && p.obras) return true;
  const a = PERGUNTA_A[campo];
  return a === 'todas' || a.includes(p.atividade);
}

/**
 * O que ainda falta perguntar, pela ordem em que se pergunta. Sem a
 * atividade, só essa (o resto depende dela).
 */
/**
 * As perguntas sim/não para um formulário (a página /empresas): a quem se
 * fazem (atividades; null = todas), "tambem_se" (aparece também se uma
 * destas respostas for sim) e "so_se" (só aparece se uma destas for sim).
 * A mesma lógica de perguntasEmFalta.
 */
export function definicaoPerguntas() {
  const ordem: Flag[] = [
    'vende_alimentos',
    'atendimento_publico',
    'esplanada',
    'publicidade',
    'obras',
    'musica',
    'eventos_rua',
    'ocupacao_via',
    'horario_alargado',
    'centro_historico',
  ];
  return ordem.map((campo) => {
    const a = PERGUNTA_A[campo];
    return {
      campo,
      rotulo: ROTULOS_FLAG[campo],
      pergunta: PERGUNTA_FLAG[campo].pergunta,
      atividades: campo === 'centro_historico' || a === 'todas' ? null : [...a],
      tambem_se: campo === 'ocupacao_via' ? (['obras'] as Flag[]) : [],
      so_se:
        campo === 'centro_historico'
          ? (['esplanada', 'publicidade', 'obras'] as Flag[])
          : [],
    };
  });
}

export function perguntasEmFalta(p: Perfil): Pergunta[] {
  if (!p.atividade) {
    return [
      {
        campo: 'atividade',
        pergunta:
          'Qual é a atividade: restaurante ou café, loja, cabeleireiro ou estética, alojamento local, oficina, escritório, ou espetáculos e eventos?',
      },
    ];
  }
  const r: Pergunta[] = [];
  if (!p.fase) {
    r.push({
      campo: 'fase',
      pergunta: 'Vai abrir agora ou já está a funcionar?',
    });
  }
  const ordem: Flag[] = [
    'vende_alimentos',
    'atendimento_publico',
    'esplanada',
    'publicidade',
    'obras',
    'musica',
    'eventos_rua',
    'ocupacao_via',
    'horario_alargado',
    'centro_historico',
  ];
  for (const k of ordem) {
    if (perguntaSe(k, p)) {
      r.push({ campo: k, pergunta: PERGUNTA_FLAG[k].pergunta });
    }
  }
  if (p.fase === 'abrir' && !p.abertura) {
    r.push({
      campo: 'abertura',
      pergunta:
        'Mais ou menos quando conta abrir? (Serve para lhe dar as datas.)',
    });
  }
  return r;
}

// ---------------------------------------------------------------------
// Catálogo de requisitos (o que a câmara afina no painel)
// ---------------------------------------------------------------------

export const PERIODICIDADES = {
  unica: 'Uma vez',
  anual: 'Todos os anos',
  por_evento: 'Cada vez que precisar',
  continua: 'Sempre (manter em dia)',
} as const;
export type Periodicidade = keyof typeof PERIODICIDADES;

export const esquemaRequisito = z.object({
  chave: z
    .string()
    .regex(/^[a-z0-9_]{2,60}$/, 'Só letras minúsculas, números e _.'),
  titulo: z.string().trim().min(3).max(120),
  o_que_e: z.string().trim().min(3).max(800),
  onde: z.enum(['camara', 'fora']),
  /** Quem trata ("Câmara Municipal", "Portal das Finanças (AT)"...). */
  entidade: z.string().trim().min(2).max(120),
  /** Pedido que o agente faz (tipo de licença existente). */
  tipo_licenca: z.enum(TIPOS).nullable(),
  /** Tipo de processo cuja taxa vem da tabela (ex.: 'CP'). */
  tipo_processo: z.string().trim().min(1).max(20).nullable(),
  url: z.url().max(500).nullable(),
  /** Para que atividades ([] = todas). */
  atividades: z.array(z.enum(CHAVES_ATIVIDADE)).max(7),
  /** Quando se aplica ([] = sempre; senão basta uma das respostas). */
  quando: z.array(z.enum(FLAGS)).max(10),
  prazo: z.string().trim().min(3).max(300),
  /** Antecedência em dias (corridos); null = a do tipo de licença, se houver. */
  antecedencia_dias: z.number().int().min(0).max(365).nullable(),
  periodicidade: z.enum(['unica', 'anual', 'por_evento', 'continua']),
  fonte: z.object({
    titulo: z.string().trim().min(3).max(300),
    url: z.url().max(500).nullable(),
  }),
  /** Valores e regras por confirmar com o regulamento do município. */
  demonstracao: z.boolean(),
  ativo: z.boolean(),
  ordem: z.number().int().min(0).max(999),
});
export type Requisito = z.output<typeof esquemaRequisito>;

/**
 * O catálogo em vigor: o do código, com as alterações da câmara por cima
 * (mesma chave substitui; chave nova acrescenta). Ordenado.
 */
export function juntarCatalogo(
  omissao: Requisito[],
  alterados: Requisito[],
): (Requisito & { alterado: boolean; novo: boolean })[] {
  const porChave = new Map(alterados.map((r) => [r.chave, r]));
  const base = omissao.map((r) => {
    const a = porChave.get(r.chave);
    return a
      ? { ...a, alterado: true, novo: false }
      : { ...r, alterado: false, novo: false };
  });
  const chaves = new Set(omissao.map((r) => r.chave));
  const novos = alterados
    .filter((r) => !chaves.has(r.chave))
    .map((r) => ({ ...r, alterado: true, novo: true }));
  return [...base, ...novos].sort(
    (a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave),
  );
}

// ---------------------------------------------------------------------
// Taxas estimadas
// ---------------------------------------------------------------------

export interface TaxaEstimada {
  /** Total estimado, se der para contar; senão só o texto (preço unitário). */
  total_cent: number | null;
  texto: string;
  demonstracao: boolean;
  fonte: string | null;
}

export interface ContextoTaxas {
  /** As regras em vigor de cada tipo de licença (já lidas). */
  configs: Partial<Record<TipoLicenca, unknown>>;
  /** A tabela de taxas em vigor (null se não houver). */
  tabela: {
    taxas: Taxa[];
    ano: number;
    fonte: string | null;
  } | null;
  /** Código do tipo de processo → id. */
  tiposProcesso: Record<string, string>;
}

interface ConfigComFonte {
  demonstracao: boolean;
  fonte: { titulo: string };
}

function deLicenca(
  c: ConfigComFonte,
  total: number | null,
  texto: string,
): TaxaEstimada {
  return {
    total_cent: total,
    texto,
    demonstracao: c.demonstracao,
    fonte: c.fonte.titulo,
  };
}

/** A taxa de um requisito, com as regras da câmara (ou null se não tem). */
export function estimarTaxa(
  r: Requisito,
  p: Perfil,
  ctx: ContextoTaxas,
): TaxaEstimada | null {
  const e = formatarEuros;
  if (r.tipo_licenca) {
    const config = ctx.configs[r.tipo_licenca];
    if (!config) return null;
    switch (r.tipo_licenca) {
      case 'esplanada': {
        const c = config as ConfigEsplanada;
        if (p.area_esplanada_m2) {
          const t = taxaEsplanada(
            { area_m2: p.area_esplanada_m2, meses: 12 } as PedidoEsplanada,
            c,
          );
          return deLicenca(
            c,
            t.total_cent,
            `Cerca de ${e(t.total_cent)} por ano (${num(p.area_esplanada_m2)} m² × 12 meses).`,
          );
        }
        return deLicenca(
          c,
          null,
          `${e(c.taxa_m2_mes_cent)} por m² e por mês (mínimo ${e(c.taxa_minima_cent)}).`,
        );
      }
      case 'publicidade': {
        const c = config as ConfigPublicidade;
        if (p.area_publicidade_m2) {
          const pedido = {
            largura_m: p.area_publicidade_m2,
            altura_m: 1,
            iluminado: p.publicidade_iluminada === true,
            no_proprio_estabelecimento: true,
            meses: 12,
          } as PedidoPublicidade;
          if (isentaPublicidade(pedido, c)) {
            return deLicenca(
              c,
              0,
              'Sem taxa: anúncio pequeno no próprio estabelecimento (basta a mera comunicação).',
            );
          }
          const t = taxaPublicidade(pedido, c);
          return deLicenca(
            c,
            t.total_cent,
            `Cerca de ${e(t.total_cent)} por ano (${num(p.area_publicidade_m2)} m² × 12 meses${pedido.iluminado ? ', iluminado' : ''}).`,
          );
        }
        return deLicenca(
          c,
          null,
          `${e(c.taxa_m2_mes_cent)} por m² e por mês; sem taxa até ${num(c.area_isenta_m2)} m² no próprio estabelecimento.`,
        );
      }
      case 'ocupacao_via': {
        const c = config as ConfigOcupacao;
        return deLicenca(
          c,
          null,
          `${e(c.taxa_base_cent)} de apreciação e ${e(c.taxa_m2_dia_cent)} por m² e por dia.`,
        );
      }
      case 'ruido': {
        const c = config as ConfigRuido;
        return deLicenca(
          c,
          c.taxa_cent,
          `${e(c.taxa_cent)} por licença (uma por evento).`,
        );
      }
      case 'recinto_improvisado': {
        const c = config as ConfigRecinto;
        return deLicenca(
          c,
          null,
          `${e(c.taxa_base_cent)} e mais ${e(c.taxa_dia_cent)} por dia de evento.`,
        );
      }
      default:
        return null;
    }
  }
  if (r.tipo_processo && ctx.tabela) {
    const id = ctx.tiposProcesso[r.tipo_processo.toUpperCase()];
    if (!id) return null;
    const taxas = ctx.tabela.taxas.filter((t) => t.tipo_processo_id === id);
    if (taxas.length === 0) return null;
    const s = calcularTaxas(ctx.tabela.taxas, {
      tipoProcessoId: id,
      quantidades: p.area_obra_m2 ? { m2: p.area_obra_m2 } : {},
    });
    const base = {
      demonstracao: false,
      fonte: ctx.tabela.fonte ?? `Tabela de taxas ${ctx.tabela.ano}`,
    };
    if (s.em_falta.length === 0) {
      return {
        ...base,
        total_cent: s.total_cent,
        texto: `Cerca de ${e(s.total_cent)}${p.area_obra_m2 ? ` (${num(p.area_obra_m2)} m²)` : ''}.`,
      };
    }
    const unidade: Record<string, string> = {
      fixo: '',
      m2: ' por m²',
      dia: ' por dia',
      pagina: ' por página',
      fogo: ' por fogo',
      mesa: ' por mesa',
    };
    return {
      ...base,
      total_cent: null,
      texto:
        taxas
          .map(
            (t) =>
              `${e(t.valor_cent)}${unidade[t.unidade] ?? ''} (${t.descricao.toLowerCase()})`,
          )
          .join(' + ') + '.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------
// A lista
// ---------------------------------------------------------------------

export type Como =
  | { tipo: 'agente'; ferramenta: string; frase: string }
  | { tipo: 'link'; url: string }
  | { tipo: 'camara' }
  | { tipo: 'fora' };

export interface ItemLista {
  chave: string;
  titulo: string;
  o_que_e: string;
  porque: string[];
  onde: 'camara' | 'fora';
  entidade: string;
  como: Como;
  url: string | null;
  prazo: string;
  antecedencia: { dias: number; uteis: boolean } | null;
  periodicidade: Periodicidade;
  periodicidade_texto: string;
  /** 'confirmar': já está a funcionar, por isso é ver se já tratou. */
  estado: 'por_tratar' | 'confirmar';
  tipo_licenca: TipoLicenca | null;
  taxa: TaxaEstimada | null;
  fonte: { titulo: string; url: string | null };
  demonstracao: boolean;
}

export interface Lista {
  itens: ItemLista[];
  /** Algum valor (regra, prazo ou taxa) é de demonstração. */
  demonstracao: boolean;
  na_camara: number;
  fora_da_camara: number;
}

function aplica(
  r: Requisito,
  p: Perfil,
  f: Record<Flag, boolean>,
): string[] | null {
  if (!r.ativo || !p.atividade) return null;
  if (r.atividades.length && !r.atividades.includes(p.atividade)) return null;
  const porque: string[] = [];
  if (r.quando.length) {
    const sim = r.quando.filter((k) => f[k]);
    if (sim.length === 0) return null;
    porque.push(...sim.map((k) => PERGUNTA_FLAG[k].porque));
  }
  if (r.atividades.length) {
    porque.unshift(`A atividade é ${ATIVIDADE_FRASE[p.atividade]}.`);
  }
  if (porque.length === 0) porque.push('Todas as empresas precisam.');
  return porque;
}

function antecedenciaDe(
  r: Requisito,
  ctx: ContextoTaxas | null,
): ItemLista['antecedencia'] {
  if (r.antecedencia_dias !== null) {
    return { dias: r.antecedencia_dias, uteis: false };
  }
  const c = r.tipo_licenca
    ? (ctx?.configs[r.tipo_licenca] as
        { antecedencia_min_dias_uteis?: number } | undefined)
    : undefined;
  return typeof c?.antecedencia_min_dias_uteis === 'number'
    ? { dias: c.antecedencia_min_dias_uteis, uteis: true }
    : null;
}

function comoDe(r: Requisito): Como {
  if (r.tipo_licenca) {
    const d = DEFS[r.tipo_licenca];
    return {
      tipo: 'agente',
      ferramenta: d.ferramenta,
      frase: `Quero pedir a ${d.curto}`,
    };
  }
  if (r.url) return { tipo: 'link', url: r.url };
  return r.onde === 'camara' ? { tipo: 'camara' } : { tipo: 'fora' };
}

/** O que a empresa precisa, pela ordem do catálogo. */
export function listaPara(
  p: Perfil,
  catalogo: Requisito[],
  ctx: ContextoTaxas | null = null,
): Lista {
  const f = flagsDe(p);
  const itens: ItemLista[] = [];
  for (const r of [...catalogo].sort((a, b) => a.ordem - b.ordem)) {
    const porque = aplica(r, p, f);
    if (!porque) continue;
    const taxa = ctx ? estimarTaxa(r, p, ctx) : null;
    itens.push({
      chave: r.chave,
      titulo: r.titulo,
      o_que_e: r.o_que_e,
      porque,
      onde: r.onde,
      entidade: r.entidade,
      como: comoDe(r),
      url: r.url,
      prazo: r.prazo,
      antecedencia: antecedenciaDe(r, ctx),
      periodicidade: r.periodicidade,
      periodicidade_texto: PERIODICIDADES[r.periodicidade],
      estado:
        p.fase === 'aberta' && r.periodicidade === 'unica'
          ? 'confirmar'
          : 'por_tratar',
      tipo_licenca: r.tipo_licenca,
      taxa,
      fonte: r.fonte,
      demonstracao: r.demonstracao || (taxa?.demonstracao ?? false),
    });
  }
  return {
    itens,
    demonstracao: itens.some((i) => i.demonstracao),
    na_camara: itens.filter((i) => i.onde === 'camara').length,
    fora_da_camara: itens.filter((i) => i.onde === 'fora').length,
  };
}

/**
 * Os mais importantes para dizer ao telefone (3 a 6): primeiro o que está
 * por tratar, os da câmara com pedido pelo agente à frente.
 */
export function principais(itens: ItemLista[], max = 6): ItemLista[] {
  const peso = (i: ItemLista) =>
    (i.estado === 'por_tratar' ? 0 : 10) +
    (i.como.tipo === 'agente' ? 0 : i.onde === 'camara' ? 1 : 2);
  return itens
    .map((i, k) => ({ i, k }))
    .sort((a, b) => peso(a.i) - peso(b.i) || a.k - b.k)
    .slice(0, max)
    .map((x) => x.i);
}

// ---------------------------------------------------------------------
// Calendário de obrigações
// ---------------------------------------------------------------------

export interface LicencaTitular {
  numero: string;
  tipo: TipoLicenca;
  estado: 'a_pagar' | 'por_aprovar' | 'para_tecnico' | 'emitida' | 'recusada';
  /** AAAA-MM-DD, se já foi emitida e tem validade. */
  valida_ate: string | null;
  taxa_cent: number;
  /** Dias do 1.º aviso antes de expirar (das regras do tipo); null = sem avisos. */
  aviso_dias: number | null;
}

export type TipoEvento =
  'renovar' | 'expira' | 'evento' | 'tratar' | 'abertura';

export interface EventoCalendario {
  id: string;
  data: string;
  tipo: TipoEvento;
  titulo: string;
  descricao: string;
  licenca: string | null;
  taxa_cent: number | null;
  demonstracao: boolean;
}

export interface Lembrete {
  titulo: string;
  texto: string;
  periodicidade: Periodicidade | 'pagar';
}

export interface Calendario {
  eventos: EventoCalendario[];
  lembretes: Lembrete[];
}

/** O dia útil n antes de `dia` (sem contar o próprio). */
export function diasUteisAntes(
  dia: string,
  n: number,
  feriados: Feriados,
): string {
  let d = dia;
  let contados = 0;
  while (contados < n) {
    d = somarDias(d, -1);
    if (eDiaUtil(d, feriados)) contados++;
  }
  return d;
}

function antecedenciaDita(a: ItemLista['antecedencia']): string {
  if (!a || a.dias === 0) return '';
  return ` com ${a.dias} ${a.uteis ? (a.dias === 1 ? 'dia útil' : 'dias úteis') : a.dias === 1 ? 'dia' : 'dias'} de antecedência`;
}

/**
 * As datas: renovações e fim das licenças que a empresa já tem (a validade
 * real), e, se disse quando abre, o que tratar antes de abrir e a primeira
 * renovação anual. O que não tem data (taxas anuais sem licença, pedidos
 * por evento, o que se mantém sempre) vai para os lembretes.
 */
export function calendario(e: {
  hoje: string;
  lista: ItemLista[];
  licencas: LicencaTitular[];
  abertura?: string | null;
  feriados?: Feriados;
  horizonteDias?: number;
}): Calendario {
  const feriados = e.feriados ?? new Set<string>();
  const limite = somarDias(e.hoje, e.horizonteDias ?? 400);
  const eventos: EventoCalendario[] = [];
  const lembretes: Lembrete[] = [];
  const tiposComLicenca = new Set<TipoLicenca>();
  const naoAntesDeHoje = (d: string) => (d < e.hoje ? e.hoje : d);

  for (const l of e.licencas) {
    const def = DEFS[l.tipo];
    if (l.estado === 'recusada') continue;
    if (l.estado === 'a_pagar') {
      lembretes.push({
        titulo: `Pagar a taxa da ${def.curto} ${l.numero}`,
        texto: `O pedido só avança depois de paga a taxa${l.taxa_cent > 0 ? ` (${formatarEuros(l.taxa_cent)})` : ''}.`,
        periodicidade: 'pagar',
      });
      tiposComLicenca.add(l.tipo);
      continue;
    }
    if (l.estado !== 'emitida' || !l.valida_ate) {
      tiposComLicenca.add(l.tipo);
      continue;
    }
    tiposComLicenca.add(l.tipo);
    if (def.renovavel) {
      // As que expiraram há pouco ainda aparecem: renovar quanto antes.
      if (l.valida_ate < somarDias(e.hoje, -60)) continue;
      const taxa =
        l.taxa_cent > 0
          ? ` Da última vez a taxa foi ${formatarEuros(l.taxa_cent)}.`
          : '';
      const aviso = somarDias(l.valida_ate, -(l.aviso_dias || 30));
      eventos.push({
        id: `renovar:${l.numero}:${l.valida_ate}`,
        data: naoAntesDeHoje(aviso),
        tipo: 'renovar',
        titulo: `Renovar a ${def.curto} ${l.numero}`,
        descricao:
          (l.valida_ate < e.hoje
            ? `Expirou a ${dataPorExtenso(l.valida_ate)}: renove quanto antes.`
            : `Vale até ${dataPorExtenso(l.valida_ate)}.`) +
          ` Para renovar, ligue ou escreva à câmara: o agente renova com os mesmos dados.${taxa}`,
        licenca: l.numero,
        taxa_cent: l.taxa_cent || null,
        demonstracao: false,
      });
      if (l.valida_ate >= e.hoje) {
        eventos.push({
          id: `expira:${l.numero}:${l.valida_ate}`,
          data: l.valida_ate,
          tipo: 'expira',
          titulo: `Último dia da ${def.curto} ${l.numero}`,
          descricao: `A ${def.curto} ${l.numero} deixa de valer depois de hoje, se não for renovada.`,
          licenca: l.numero,
          taxa_cent: null,
          demonstracao: false,
        });
      }
    } else if (l.valida_ate >= e.hoje) {
      eventos.push({
        id: `evento:${l.numero}:${l.valida_ate}`,
        data: l.valida_ate,
        tipo: 'evento',
        titulo: `${def.nome} ${l.numero}`,
        descricao: `A ${def.curto} ${l.numero} vale para este dia (último dia do evento).`,
        licenca: l.numero,
        taxa_cent: null,
        demonstracao: false,
      });
    }
  }

  const abertura = e.abertura && e.abertura >= e.hoje ? e.abertura : null;
  if (abertura) {
    eventos.push({
      id: `abertura:${abertura}`,
      data: abertura,
      tipo: 'abertura',
      titulo: 'Abertura prevista',
      descricao: 'O dia em que disse que conta abrir.',
      licenca: null,
      taxa_cent: null,
      demonstracao: false,
    });
  }

  for (const i of e.lista) {
    if (i.tipo_licenca && tiposComLicenca.has(i.tipo_licenca)) continue;
    const taxa = i.taxa ? ` Taxa: ${i.taxa.texto}` : '';
    if (
      abertura &&
      i.estado === 'por_tratar' &&
      (i.periodicidade === 'unica' || i.periodicidade === 'anual')
    ) {
      const a = i.antecedencia;
      const ate = a
        ? a.uteis
          ? diasUteisAntes(abertura, a.dias, feriados)
          : somarDias(abertura, -a.dias)
        : abertura;
      eventos.push({
        id: `tratar:${i.chave}:${abertura}`,
        data: naoAntesDeHoje(ate),
        tipo: 'tratar',
        titulo: `Tratar: ${i.titulo}`,
        descricao: `${i.prazo} Onde: ${i.entidade}.${taxa}`,
        licenca: null,
        taxa_cent: i.taxa?.total_cent ?? null,
        demonstracao: i.demonstracao,
      });
      if (i.periodicidade === 'anual' && i.tipo_licenca) {
        const fim = somarDias(somarMeses(abertura, 12), -1);
        eventos.push({
          id: `renovar:${i.chave}:${fim}`,
          data: somarDias(fim, -30),
          tipo: 'renovar',
          titulo: `Renovar: ${i.titulo}`,
          descricao: `Se pedir para 12 meses a partir da abertura, vale até ${dataPorExtenso(fim)}.${taxa}`,
          licenca: null,
          taxa_cent: i.taxa?.total_cent ?? null,
          demonstracao: true,
        });
      }
      continue;
    }
    if (i.periodicidade === 'anual') {
      lembretes.push({
        titulo: `Todos os anos: ${i.titulo}`,
        texto: `Renovar e pagar a taxa${antecedenciaDita(i.antecedencia)}.${taxa}`,
        periodicidade: 'anual',
      });
    } else if (i.periodicidade === 'por_evento') {
      lembretes.push({
        titulo: `Cada vez: ${i.titulo}`,
        texto: `Pedir antes${antecedenciaDita(i.antecedencia)}.${taxa}`,
        periodicidade: 'por_evento',
      });
    } else if (i.periodicidade === 'continua') {
      lembretes.push({
        titulo: `Sempre: ${i.titulo}`,
        texto: i.prazo,
        periodicidade: 'continua',
      });
    }
  }

  return {
    eventos: eventos
      .filter((x) => x.data <= limite)
      .sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id)),
    lembretes,
  };
}
