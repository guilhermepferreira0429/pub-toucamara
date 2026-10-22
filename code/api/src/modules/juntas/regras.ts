/*
 * Regras puras dos atestados da junta (sem BD): reconhecer a freguesia da
 * morada e a junta que a serve, os tipos de atestado e o texto que vai
 * para o PDF.
 *
 * Base legal (a confirmar com a junta): as juntas passam atestados nos
 * termos da lei (Lei n.º 75/2013, de 12 de setembro, art. 16.º); o
 * Decreto-Lei n.º 135/99, art. 34.º, diz que os atestados de residência,
 * vida e situação económica se emitem quando um eleito tem conhecimento
 * direto, com o testemunho de dois eleitores da freguesia ou mediante
 * declaração do próprio. O agente recolhe a declaração do próprio, lê-a de
 * volta e a pessoa confirma; o funcionário decide e emite.
 *
 * Os documentos a apresentar e o prazo são valores de demonstração: cada
 * junta tem os seus (e a sua tabela de taxas, que aqui não se inventa).
 */

export const TIPOS_ATESTADO = [
  'residencia',
  'agregado_familiar',
  'situacao_economica',
  'prova_vida',
] as const;
export type TipoAtestado = (typeof TIPOS_ATESTADO)[number];

export interface DefAtestado {
  titulo: string;
  /** Para as frases: "o atestado de residência". */
  curto: string;
  /** O que levar ou ter à mão (demonstração). */
  requisitos: string[];
  /** Dias úteis para emitir (demonstração). */
  prazoDiasUteis: number;
}

export const DEFS_ATESTADO: Record<TipoAtestado, DefAtestado> = {
  residencia: {
    titulo: 'Atestado de residência',
    curto: 'atestado de residência',
    requisitos: [
      'Documento de identificação (cartão de cidadão) no levantamento',
      'Estar recenseado na freguesia ou apresentar um comprovativo de morada',
    ],
    prazoDiasUteis: 2,
  },
  agregado_familiar: {
    titulo: 'Atestado de composição do agregado familiar',
    curto: 'atestado de agregado familiar',
    requisitos: [
      'Documento de identificação de quem pede',
      'Nome e parentesco de cada pessoa que vive na casa',
    ],
    prazoDiasUteis: 3,
  },
  situacao_economica: {
    titulo: 'Atestado de situação económica',
    curto: 'atestado de situação económica',
    requisitos: [
      'Documento de identificação',
      'Última declaração de IRS ou comprovativo de rendimentos (pensão, subsídio)',
    ],
    prazoDiasUteis: 5,
  },
  prova_vida: {
    titulo: 'Prova de vida',
    curto: 'prova de vida',
    requisitos: [
      'Vir à junta com o documento de identificação (ou pedir a visita a casa, se não puder sair)',
      'O formulário da entidade que paga a pensão, se o tiver',
    ],
    prazoDiasUteis: 2,
  },
};

/** Para comparar nomes de freguesias: sem acentos, minúsculas, sem "união das freguesias de". */
export function normalizarFreguesia(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(
      /^(junta de freguesia (de |da |do |das |dos )?|uniao (das )?freguesias (de |da |do |das |dos )?|freguesia (de |da |do |das |dos )?)/,
      '',
    )
    .trim();
}

export interface JuntaConhecida {
  id: string;
  nome: string;
  freguesias: string[];
}

export interface FreguesiaResolvida {
  /** A freguesia como está nos dados (com acentos). */
  freguesia: string;
  /** A junta no sistema que serve esta freguesia (null = não está no Tou, Câmara?). */
  junta: JuntaConhecida | null;
}

/** A freguesia (normalizada) aparece na morada como palavras inteiras? */
function naMorada(moradaNorm: string, freguesiaNorm: string): boolean {
  if (freguesiaNorm.length < 3) return false;
  return ` ${moradaNorm} `.includes(` ${freguesiaNorm} `);
}

/**
 * A freguesia do pedido e a junta que a serve: primeiro a que a pessoa
 * disse, depois a que vem escrita na morada; primeiro as juntas do
 * sistema, depois as freguesias que a câmara já conhece. Sem nada: null.
 */
export function resolverFreguesia(
  dita: string | null | undefined,
  morada: string | null | undefined,
  juntas: readonly JuntaConhecida[],
  conhecidas: readonly string[],
): FreguesiaResolvida | null {
  const candidatas: { nome: string; junta: JuntaConhecida | null }[] = [
    ...juntas.flatMap((j) => j.freguesias.map((f) => ({ nome: f, junta: j }))),
    ...conhecidas.map((f) => ({ nome: f, junta: null })),
  ];
  const ditaN = dita ? normalizarFreguesia(dita) : '';
  if (ditaN) {
    const exata = candidatas.find((c) => normalizarFreguesia(c.nome) === ditaN);
    if (exata) return { freguesia: exata.nome, junta: exata.junta };
  }
  const moradaN = morada ? ` ${normalizarFreguesia(`x ${morada}`)} ` : '';
  // A mais comprida primeiro: "São Torcato" antes de "Torcato".
  const porTamanho = [...candidatas].sort(
    (a, b) => b.nome.length - a.nome.length,
  );
  for (const fonte of [ditaN, moradaN]) {
    if (!fonte) continue;
    const c = porTamanho.find((x) =>
      naMorada(fonte, normalizarFreguesia(x.nome)),
    );
    if (c) return { freguesia: c.nome, junta: c.junta };
  }
  return null;
}

export interface PessoaAgregado {
  nome: string;
  parentesco: string | null;
}

/** "Ana Silva (filha)", "Rui Silva - marido" → { nome, parentesco }. */
export function lerAgregado(lista: readonly string[]): PessoaAgregado[] {
  return lista
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 15)
    .map((x) => {
      const m =
        /^(.+?)\s*\(([^)]+)\)\s*$/.exec(x) ?? /^(.+?)\s+[-–]\s+(.+)$/.exec(x);
      return m
        ? { nome: m[1].trim(), parentesco: m[2].trim().toLowerCase() }
        : { nome: x, parentesco: null };
    });
}

/** 'Maria da Silva Costa' → 'Maria C.' (páginas públicas). */
export function abreviarNome(nome: string): string {
  const p = nome.trim().split(/\s+/);
  if (p.length < 2) return p[0] ?? '';
  return `${p[0]} ${p[p.length - 1][0]}.`;
}

export interface DadosTexto {
  tipo: TipoAtestado;
  nome: string;
  morada: string;
  freguesia: string;
  junta: string;
  finalidade: string | null;
  agregado?: PessoaAgregado[];
  rendimentoMensal?: number | null;
  entidadePensao?: string | null;
  /** Nota do funcionário (ex.: "verificado presencialmente"). */
  nota?: string | null;
  /** 'quinta-feira, 22 de outubro de 2026'. */
  data: string;
}

function euros(n: number): string {
  return `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** O texto do atestado (modelo de demonstração), em parágrafos. */
export function textoAtestado(d: DadosTexto): string[] {
  const fim = d.finalidade
    ? `O presente atestado destina-se a ${d.finalidade.replace(/\.$/, '')}.`
    : 'O presente atestado destina-se aos fins que o requerente entender.';
  const base =
    'Passado com base na declaração do próprio, lida e confirmada no pedido, e nos elementos da junta (Decreto-Lei n.º 135/99, art. 34.º).';
  const partes: string[] = [];
  switch (d.tipo) {
    case 'residencia':
      partes.push(
        `A ${d.junta} atesta, para os devidos efeitos, que ${d.nome} reside em ${d.morada}, na freguesia de ${d.freguesia}.`,
      );
      break;
    case 'agregado_familiar': {
      const membros = (d.agregado ?? [])
        .map((p) => (p.parentesco ? `${p.nome} (${p.parentesco})` : p.nome))
        .join('; ');
      partes.push(
        `A ${d.junta} atesta, para os devidos efeitos, que o agregado familiar de ${d.nome}, residente em ${d.morada}, na freguesia de ${d.freguesia}, é composto por: ${d.nome} (requerente)${membros ? `; ${membros}` : ''}.`,
      );
      break;
    }
    case 'situacao_economica':
      partes.push(
        `A ${d.junta} atesta, para os devidos efeitos, que ${d.nome}, residente em ${d.morada}, na freguesia de ${d.freguesia}, declarou ${
          d.rendimentoMensal != null
            ? `um rendimento mensal do agregado de ${euros(d.rendimentoMensal)}`
            : 'viver com rendimentos insuficientes'
        }, sendo a sua situação económica considerada ${
          d.rendimentoMensal != null ? 'conforme o declarado' : 'carenciada'
        }.`,
      );
      break;
    case 'prova_vida':
      partes.push(
        `A ${d.junta} atesta, para os devidos efeitos, que ${d.nome}, residente em ${d.morada}, na freguesia de ${d.freguesia}, se encontra vivo(a) nesta data${
          d.entidadePensao ? `, para efeitos de ${d.entidadePensao}` : ''
        }.`,
      );
      break;
  }
  partes.push(fim);
  if (d.nota) partes.push(d.nota.replace(/\.?$/, '.'));
  partes.push(base);
  partes.push(`${d.freguesia}, ${d.data}.`);
  return partes;
}
