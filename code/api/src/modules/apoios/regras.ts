/*
 * "Tem direito a isto e ainda não pediu": as regras dos apoios em código.
 * Sem BD, para testar à parte. A câmara guarda o catálogo (com os critérios
 * estruturados) na tabela `apoios` e muda-os no painel.
 *
 * O avaliador só usa o que a pessoa disse na conversa: não há rendimentos
 * nem idades na BD. Cada critério dá "cumpre", "não cumpre" ou "falta
 * saber"; o apoio fica `tem_direito`, `talvez` (falta saber X) ou `nao`.
 * É uma indicação: a decisão é sempre da câmara, com os documentos.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------

export const esquemaCriterios = z
  .object({
    /** Idade mínima do requerente (anos). */
    idade_min: z.number().int().min(0).max(120).nullable().default(null),
    idade_max: z.number().int().min(0).max(120).nullable().default(null),
    /** Pessoas em casa, no mínimo (contando com a própria). */
    agregado_min: z.number().int().min(1).max(30).nullable().default(null),
    /** Rendimento mensal por pessoa do agregado, no máximo (euros). */
    rendimento_per_capita_max: z
      .number()
      .min(0)
      .max(100_000)
      .nullable()
      .default(null),
    /** Pelo menos um filho a cargo com idade neste intervalo (anos). */
    filho_idade: z
      .object({
        min: z.number().int().min(0).max(30),
        max: z.number().int().min(0).max(30),
      })
      .refine((f) => f.min <= f.max, 'A idade mínima passa a máxima.')
      .nullable()
      .default(null),
    /** Tem de ser inquilino (casa arrendada). */
    inquilino: z.boolean().default(false),
    /** Tem de morar no concelho. */
    residente_concelho: z.boolean().default(true),
  })
  .strict();
export type Criterios = z.output<typeof esquemaCriterios>;

export const esquemaFonte = z.object({
  titulo: z.string().trim().min(3).max(300),
  url: z.url().nullable().default(null),
  /** 'nacional': a regra é da lei (a câmara aplica); 'municipal': do regulamento da câmara. */
  ambito: z.enum(['nacional', 'municipal']),
});
export type Fonte = z.output<typeof esquemaFonte>;

export const esquemaApoio = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,40}$/, 'Só minúsculas, números e _.'),
  nome: z.string().trim().min(3).max(120),
  /** O que é, numa frase que o agente diz. */
  resumo: z.string().trim().min(10).max(400),
  /** O que dá ("até 150 € por mês, durante um ano"). */
  valor: z.string().trim().max(200).nullable().default(null),
  /** Quem pode, em linguagem simples (para a página e o painel). */
  quem_pode: z.string().trim().min(5).max(600),
  criterios: esquemaCriterios,
  documentos: z.array(z.string().trim().min(3).max(200)).max(15).default([]),
  como_pedir: z.string().trim().min(5).max(600),
  fonte: esquemaFonte,
  /** Valores por confirmar com o regulamento do município. */
  demonstracao: z.boolean().default(true),
  ativo: z.boolean().default(true),
});
export type DadosApoio = z.output<typeof esquemaApoio>;

/** Um apoio como o avaliador o vê. */
export interface Apoio {
  codigo: string;
  nome: string;
  criterios: Criterios;
}

// ---------------------------------------------------------------------
// Perfil (o que a pessoa disse)
// ---------------------------------------------------------------------

export interface Perfil {
  idade?: number | null;
  /** Pessoas em casa, contando com a própria. */
  pessoas_agregado?: number | null;
  /** Rendimento mensal aproximado de todo o agregado (euros). */
  rendimento_mensal_agregado?: number | null;
  /** Idades dos filhos a cargo; [] = não tem filhos a cargo. */
  filhos_idades?: number[] | null;
  inquilino?: boolean | null;
  residente_concelho?: boolean | null;
}

export type Campo =
  | 'idade'
  | 'pessoas_agregado'
  | 'rendimento_mensal_agregado'
  | 'filhos_idades'
  | 'inquilino'
  | 'residente_concelho';

/** A pergunta que o agente faz para cada dado em falta. */
export const PERGUNTAS: Record<Campo, string> = {
  idade: 'Que idade tem?',
  pessoas_agregado: 'Quantas pessoas vivem consigo em casa, contando consigo?',
  rendimento_mensal_agregado:
    'Mais ou menos, quanto entra por mês em casa, somando todas as pessoas?',
  filhos_idades: 'Tem filhos a seu cargo? Que idades têm?',
  inquilino: 'A casa onde vive é arrendada?',
  residente_concelho: 'Mora no concelho?',
};

/** Ordem em que se pergunta (o que decide mais apoios primeiro, em empate). */
const ORDEM_CAMPOS: Campo[] = [
  'residente_concelho',
  'idade',
  'filhos_idades',
  'inquilino',
  'pessoas_agregado',
  'rendimento_mensal_agregado',
];

// ---------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------

export type Resultado = 'tem_direito' | 'talvez' | 'nao';

export interface Verificacao {
  ok: boolean | null; // null = falta saber
  texto: string;
}

export interface AvaliacaoApoio {
  codigo: string;
  nome: string;
  resultado: Resultado;
  /** O porquê, em frases simples (o que cumpre e o que não cumpre). */
  porque: string[];
  /** O que falta saber para decidir. */
  falta: Campo[];
}

export interface Avaliacao {
  tem_direito: AvaliacaoApoio[];
  talvez: AvaliacaoApoio[];
  nao: AvaliacaoApoio[];
  /** O que perguntar a seguir (só o que decide algum apoio ainda em aberto). */
  falta_saber: { campo: Campo; pergunta: string; apoios: number }[];
}

const euros = (n: number) =>
  new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  })
    .format(n)
    .replace(/\s/g, ' ');

const sabido = <T>(v: T | null | undefined): v is T =>
  v !== null && v !== undefined;

/** As verificações de um apoio, critério a critério. */
export function verificar(
  c: Criterios,
  p: Perfil,
): { campos: Campo[]; v: Verificacao }[] {
  const r: { campos: Campo[]; v: Verificacao }[] = [];

  if (c.residente_concelho) {
    const s = p.residente_concelho;
    r.push({
      campos: ['residente_concelho'],
      v: !sabido(s)
        ? { ok: null, texto: 'É preciso morar no concelho.' }
        : s
          ? { ok: true, texto: 'Mora no concelho.' }
          : { ok: false, texto: 'É só para quem mora no concelho.' },
    });
  }

  if (sabido(c.idade_min) || sabido(c.idade_max)) {
    const lim =
      sabido(c.idade_min) && sabido(c.idade_max)
        ? `entre os ${c.idade_min} e os ${c.idade_max} anos`
        : sabido(c.idade_min)
          ? `a partir dos ${c.idade_min} anos`
          : `até aos ${c.idade_max} anos`;
    const i = p.idade;
    const ok = sabido(i)
      ? (!sabido(c.idade_min) || i >= c.idade_min) &&
        (!sabido(c.idade_max) || i <= c.idade_max)
      : null;
    r.push({
      campos: ['idade'],
      v: {
        ok,
        texto:
          ok === null
            ? `É para quem tem idade ${lim}.`
            : ok
              ? `Tem ${i} anos (é ${lim}).`
              : `É ${lim} e tem ${i}.`,
      },
    });
  }

  if (c.filho_idade) {
    const { min, max } = c.filho_idade;
    const lim =
      max === 0
        ? 'um bebé com menos de 1 ano'
        : min === 0
          ? `um filho até aos ${max} anos`
          : `um filho entre os ${min} e os ${max} anos`;
    const f = p.filhos_idades;
    const ok = sabido(f) ? f.some((x) => x >= min && x <= max) : null;
    r.push({
      campos: ['filhos_idades'],
      v: {
        ok,
        texto:
          ok === null
            ? `É para quem tem ${lim}.`
            : ok
              ? `Tem ${lim}.`
              : f!.length === 0
                ? `É para quem tem ${lim}, e não tem filhos a cargo.`
                : `É para quem tem ${lim}.`,
      },
    });
  }

  if (c.inquilino) {
    const s = p.inquilino;
    r.push({
      campos: ['inquilino'],
      v: !sabido(s)
        ? { ok: null, texto: 'É para quem vive em casa arrendada.' }
        : s
          ? { ok: true, texto: 'Vive em casa arrendada.' }
          : { ok: false, texto: 'É só para quem vive em casa arrendada.' },
    });
  }

  if (sabido(c.agregado_min)) {
    const n = p.pessoas_agregado;
    r.push({
      campos: ['pessoas_agregado'],
      v: !sabido(n)
        ? {
            ok: null,
            texto: `É para casas com ${c.agregado_min} ou mais pessoas.`,
          }
        : n >= c.agregado_min
          ? { ok: true, texto: `Vivem ${n} pessoas em casa.` }
          : {
              ok: false,
              texto: `É para casas com ${c.agregado_min} ou mais pessoas.`,
            },
    });
  }

  if (sabido(c.rendimento_per_capita_max)) {
    const max = c.rendimento_per_capita_max;
    const n = p.pessoas_agregado;
    const rend = p.rendimento_mensal_agregado;
    if (!sabido(n) || !sabido(rend) || n < 1) {
      const campos: Campo[] = [];
      if (!sabido(rend)) campos.push('rendimento_mensal_agregado');
      if (!sabido(n) || n < 1) campos.push('pessoas_agregado');
      r.push({
        campos,
        v: {
          ok: null,
          texto: `O rendimento por pessoa da casa tem de ser até ${euros(max)} por mês.`,
        },
      });
    } else {
      const pc = rend / n;
      r.push({
        campos: ['rendimento_mensal_agregado'],
        v:
          pc <= max
            ? {
                ok: true,
                texto: `O rendimento por pessoa da casa está abaixo do limite de ${euros(max)} por mês.`,
              }
            : {
                ok: false,
                texto: `O rendimento por pessoa da casa passa o limite de ${euros(max)} por mês.`,
              },
      });
    }
  }
  return r;
}

export function avaliarApoio(a: Apoio, p: Perfil): AvaliacaoApoio {
  const vs = verificar(a.criterios, p);
  const falhas = vs.filter((x) => x.v.ok === false);
  const falta = [
    ...new Set(vs.filter((x) => x.v.ok === null).flatMap((x) => x.campos)),
  ];
  const textos = (l: typeof vs) => l.map((x) => x.v.texto);
  if (falhas.length) {
    return {
      codigo: a.codigo,
      nome: a.nome,
      resultado: 'nao',
      porque: textos(falhas),
      falta: [],
    };
  }
  if (falta.length) {
    return {
      codigo: a.codigo,
      nome: a.nome,
      resultado: 'talvez',
      porque: textos(vs),
      falta,
    };
  }
  return {
    codigo: a.codigo,
    nome: a.nome,
    resultado: 'tem_direito',
    porque: vs.length
      ? textos(vs)
      : ['Não há condições a cumprir além de o pedir.'],
    falta: [],
  };
}

/** Avalia todos os apoios do catálogo para o que a pessoa disse. */
export function avaliarApoios(perfil: Perfil, apoios: Apoio[]): Avaliacao {
  const todas = apoios.map((a) => avaliarApoio(a, perfil));
  const contagem = new Map<Campo, number>();
  for (const a of todas)
    for (const c of a.falta) contagem.set(c, (contagem.get(c) ?? 0) + 1);
  const falta_saber = [...contagem.entries()]
    .sort(
      (x, y) =>
        y[1] - x[1] || ORDEM_CAMPOS.indexOf(x[0]) - ORDEM_CAMPOS.indexOf(y[0]),
    )
    .map(([campo, n]) => ({ campo, pergunta: PERGUNTAS[campo], apoios: n }));
  return {
    tem_direito: todas.filter((a) => a.resultado === 'tem_direito'),
    talvez: todas.filter((a) => a.resultado === 'talvez'),
    nao: todas.filter((a) => a.resultado === 'nao'),
    falta_saber,
  };
}

// ---------------------------------------------------------------------
// O que se guarda (o mínimo)
// ---------------------------------------------------------------------

export const ESCALOES = [
  { id: 'ate_300', ate: 300, texto: 'até 300 € por pessoa' },
  { id: '300_500', ate: 500, texto: '300 € a 500 € por pessoa' },
  { id: '500_700', ate: 700, texto: '500 € a 700 € por pessoa' },
  { id: '700_1000', ate: 1000, texto: '700 € a 1000 € por pessoa' },
  { id: 'mais_1000', ate: Infinity, texto: 'mais de 1000 € por pessoa' },
] as const;
export type Escalao = (typeof ESCALOES)[number]['id'];

/** O escalão do rendimento mensal por pessoa (é isto que se guarda, não o valor). */
export function escalaoRendimento(
  rendimento: number | null | undefined,
  pessoas: number | null | undefined,
): Escalao | null {
  if (!sabido(rendimento) || !sabido(pessoas) || pessoas < 1) return null;
  const pc = rendimento / pessoas;
  return ESCALOES.find((e) => pc <= e.ate)!.id;
}

/** O perfil a guardar: sem o rendimento exato. */
export function perfilGuardado(p: Perfil) {
  return {
    idade: p.idade ?? null,
    pessoas_agregado: p.pessoas_agregado ?? null,
    rendimento_escalao: escalaoRendimento(
      p.rendimento_mensal_agregado,
      p.pessoas_agregado,
    ),
    rendimento_dito: sabido(p.rendimento_mensal_agregado),
    filhos_idades: p.filhos_idades ?? null,
    inquilino: p.inquilino ?? null,
    residente_concelho: p.residente_concelho ?? null,
  };
}

/** Junta o que a pessoa disse agora ao que já tinha dito nesta conversa. */
export function juntarPerfis(antes: Perfil, agora: Perfil): Perfil {
  const r: Perfil = { ...antes };
  for (const [k, v] of Object.entries(agora) as [keyof Perfil, unknown][]) {
    if (v !== undefined && v !== null) (r as Record<string, unknown>)[k] = v;
  }
  return r;
}

/** "o cheque bebé e o cartão do idoso" */
export function listaDita(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

// ---------------------------------------------------------------------
// Demonstração
// ---------------------------------------------------------------------

/**
 * Apoios de DEMONSTRAÇÃO (valores plausíveis, mas assumidos: cada câmara põe
 * os do seu regulamento). A tarifa social da água e a ação social escolar
 * são regimes nacionais que a câmara (ou a entidade gestora) aplica; os
 * outros são exemplos de regulamentos municipais comuns.
 */
export const APOIOS_DEMONSTRACAO: DadosApoio[] = [
  {
    codigo: 'tarifa_social_agua',
    nome: 'Tarifa social da água',
    resumo:
      'Desconto na fatura da água, do saneamento e dos resíduos para as famílias com rendimentos baixos.',
    valor: 'Desconto nas tarifas fixas e variáveis da água',
    quem_pode:
      'Quem tem o contrato da água em seu nome, mora no concelho e tem rendimentos baixos (ou recebe certas prestações sociais, como o complemento solidário para idosos ou o rendimento social de inserção).',
    criterios: {
      idade_min: null,
      idade_max: null,
      agregado_min: null,
      rendimento_per_capita_max: 500,
      filho_idade: null,
      inquilino: false,
      residente_concelho: true,
    },
    documentos: [
      'Fatura da água em seu nome',
      'Documento de identificação e NIF',
      'Declaração de IRS ou comprovativo da prestação social que recebe',
    ],
    como_pedir:
      'Pede-se à entidade que fornece a água (em Guimarães, a Vimágua) ou na câmara, que encaminha. Em muitos casos é aplicada sozinha a quem recebe prestações sociais.',
    fonte: {
      titulo:
        'Decreto-Lei n.º 147/2017, de 7 de dezembro (tarifa social de água, saneamento e resíduos)',
      url: null,
      ambito: 'nacional',
    },
    demonstracao: true,
    ativo: true,
  },
  {
    codigo: 'apoio_renda',
    nome: 'Apoio à renda',
    resumo:
      'Uma ajuda mensal para pagar a renda da casa, para famílias com rendimentos baixos que vivem em casa arrendada.',
    valor: 'Até 150 € por mês, durante 12 meses (pode renovar)',
    quem_pode:
      'Quem vive em casa arrendada no concelho, com contrato registado nas Finanças, e com rendimento por pessoa abaixo do limite.',
    criterios: {
      idade_min: 18,
      idade_max: null,
      agregado_min: null,
      rendimento_per_capita_max: 700,
      filho_idade: null,
      inquilino: true,
      residente_concelho: true,
    },
    documentos: [
      'Contrato de arrendamento registado nas Finanças',
      'Recibos da renda dos últimos 3 meses',
      'Declaração de IRS e nota de liquidação de todas as pessoas da casa',
      'Documento de identificação de todas as pessoas da casa',
      'IBAN para receber o apoio',
    ],
    como_pedir:
      'Candidatura na ação social da câmara, com os documentos. A câmara confirma os rendimentos e responde por escrito.',
    fonte: {
      titulo:
        'Regulamento municipal de apoio ao arrendamento (exemplo de demonstração)',
      url: null,
      ambito: 'municipal',
    },
    demonstracao: true,
    ativo: true,
  },
  {
    codigo: 'cheque_bebe',
    nome: 'Cheque bebé',
    resumo:
      'Um apoio da câmara a cada bebé que nasce ou é adotado no concelho, para ajudar nas primeiras despesas.',
    valor: '500 € por bebé, pagos de uma vez',
    quem_pode:
      'Pais com um bebé com menos de 1 ano, que morem no concelho. O pedido faz-se até o bebé fazer 1 ano.',
    criterios: {
      idade_min: null,
      idade_max: null,
      agregado_min: null,
      rendimento_per_capita_max: null,
      filho_idade: { min: 0, max: 0 },
      inquilino: false,
      residente_concelho: true,
    },
    documentos: [
      'Certidão ou cartão de cidadão do bebé',
      'Documento de identificação dos pais',
      'Comprovativo de morada no concelho (atestado da junta)',
      'IBAN para receber o apoio',
    ],
    como_pedir: 'Pedido na câmara, com os documentos, até o bebé fazer 1 ano.',
    fonte: {
      titulo:
        'Regulamento municipal de apoio à natalidade (exemplo de demonstração)',
      url: null,
      ambito: 'municipal',
    },
    demonstracao: true,
    ativo: true,
  },
  {
    codigo: 'cartao_idoso',
    nome: 'Cartão municipal do idoso',
    resumo:
      'Um cartão com descontos nos serviços da câmara: piscinas, transportes, cultura e algumas lojas aderentes.',
    valor:
      'Descontos nas piscinas, nos transportes e nos espetáculos municipais',
    quem_pode: 'Quem tem 65 anos ou mais e mora no concelho.',
    criterios: {
      idade_min: 65,
      idade_max: null,
      agregado_min: null,
      rendimento_per_capita_max: null,
      filho_idade: null,
      inquilino: false,
      residente_concelho: true,
    },
    documentos: [
      'Documento de identificação',
      'Comprovativo de morada no concelho',
      'Uma fotografia tipo passe',
    ],
    como_pedir:
      'Pedido no balcão da câmara ou da junta de freguesia. O cartão chega por correio.',
    fonte: {
      titulo:
        'Regulamento municipal do cartão sénior (exemplo de demonstração)',
      url: null,
      ambito: 'municipal',
    },
    demonstracao: true,
    ativo: true,
  },
  {
    codigo: 'material_escolar',
    nome: 'Apoio ao material escolar',
    resumo:
      'Ajuda para comprar livros de fichas e material escolar das crianças do 1.º ciclo, para famílias com rendimentos baixos.',
    valor: 'Até 50 € por criança, por ano letivo',
    quem_pode:
      'Famílias que moram no concelho, com uma criança entre os 6 e os 10 anos no 1.º ciclo e com o escalão A ou B do abono de família.',
    criterios: {
      idade_min: null,
      idade_max: null,
      agregado_min: null,
      rendimento_per_capita_max: 600,
      filho_idade: { min: 6, max: 10 },
      inquilino: false,
      residente_concelho: true,
    },
    documentos: [
      'Declaração do escalão do abono de família (Segurança Social)',
      'Comprovativo de matrícula no 1.º ciclo',
      'Documento de identificação da criança',
    ],
    como_pedir:
      'Pedido na escola ou na câmara, no início do ano letivo, com a declaração do escalão do abono.',
    fonte: {
      titulo:
        'Decreto-Lei n.º 55/2009, de 2 de março (ação social escolar); o município aplica-o no pré-escolar e no 1.º ciclo',
      url: null,
      ambito: 'nacional',
    },
    demonstracao: true,
    ativo: true,
  },
];
