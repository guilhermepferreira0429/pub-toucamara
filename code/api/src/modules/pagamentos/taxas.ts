/*
 * Simulação de taxas: lógica pura (sem BD), para testar à parte. O serviço
 * lê a tabela em vigor e passa aqui as taxas e o que o munícipe disse.
 */

export type Unidade = 'fixo' | 'm2' | 'dia' | 'pagina' | 'fogo' | 'mesa';

export interface Taxa {
  codigo: string;
  descricao: string;
  unidade: Unidade;
  valor_cent: number;
  tipo_processo_id: string | null;
}

export interface LinhaTaxa {
  codigo: string;
  descricao: string;
  unidade: Unidade;
  quantidade: number;
  valor_unitario_cent: number;
  valor_cent: number;
}

export interface TaxaEmFalta {
  codigo: string;
  descricao: string;
  unidade: Unidade;
  /** O que o agente pergunta para completar a conta. */
  pergunta: string;
}

export interface PedidoSimulacao {
  /** Todas as taxas deste tipo de processo entram na conta. */
  tipoProcessoId?: string | null;
  /** Taxas pedidas pelo código, com quantidade própria (opcional). */
  taxas?: { codigo: string; quantidade?: number }[];
  /** Quantidades por unidade, para todas as taxas dessa unidade: { m2: 25 }. */
  quantidades?: Partial<Record<Exclude<Unidade, 'fixo'>, number>>;
}

export interface ResultadoSimulacao {
  linhas: LinhaTaxa[];
  total_cent: number;
  em_falta: TaxaEmFalta[];
  /** Códigos pedidos que não existem na tabela em vigor. */
  desconhecidas: string[];
}

const PERGUNTA: Record<Exclude<Unidade, 'fixo'>, string> = {
  m2: 'Quantos metros quadrados?',
  dia: 'Durante quantos dias?',
  pagina: 'Quantas páginas?',
  fogo: 'Quantos fogos (habitações)?',
  mesa: 'Quantas mesas?',
};

/**
 * Linhas e total. Uma taxa por unidade sem quantidade não entra no total:
 * vai para `em_falta` com a pergunta a fazer (não se adivinha m² nem dias).
 */
export function calcularTaxas(
  tabela: Taxa[],
  pedido: PedidoSimulacao,
): ResultadoSimulacao {
  const porCodigo = new Map(tabela.map((t) => [t.codigo.toUpperCase(), t]));
  const escolhidas = new Map<string, { taxa: Taxa; quantidade?: number }>();
  const desconhecidas: string[] = [];

  if (pedido.tipoProcessoId) {
    for (const t of tabela) {
      if (t.tipo_processo_id === pedido.tipoProcessoId) {
        escolhidas.set(t.codigo.toUpperCase(), { taxa: t });
      }
    }
  }
  for (const p of pedido.taxas ?? []) {
    const taxa = porCodigo.get(p.codigo.toUpperCase());
    if (!taxa) {
      desconhecidas.push(p.codigo);
      continue;
    }
    escolhidas.set(taxa.codigo.toUpperCase(), {
      taxa,
      quantidade: p.quantidade,
    });
  }

  const linhas: LinhaTaxa[] = [];
  const emFalta: TaxaEmFalta[] = [];
  for (const { taxa, quantidade: explicita } of escolhidas.values()) {
    const quantidade =
      explicita ??
      (taxa.unidade === 'fixo' ? 1 : pedido.quantidades?.[taxa.unidade]);
    if (quantidade === undefined) {
      emFalta.push({
        codigo: taxa.codigo,
        descricao: taxa.descricao,
        unidade: taxa.unidade,
        pergunta: PERGUNTA[taxa.unidade as Exclude<Unidade, 'fixo'>],
      });
      continue;
    }
    linhas.push({
      codigo: taxa.codigo,
      descricao: taxa.descricao,
      unidade: taxa.unidade,
      quantidade,
      valor_unitario_cent: taxa.valor_cent,
      // m² podem vir com casas decimais; o cêntimo arredonda-se por linha.
      valor_cent: Math.round(taxa.valor_cent * quantidade),
    });
  }

  return {
    linhas,
    total_cent: linhas.reduce((s, l) => s + l.valor_cent, 0),
    em_falta: emFalta,
    desconhecidas,
  };
}

const UNIDADES = [
  '',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quinze',
  'dezasseis',
  'dezassete',
  'dezoito',
  'dezanove',
];
const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function ate999(n: number): string {
  if (n === 100) return 'cem';
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (resto >= 20) {
    partes.push(DEZENAS[Math.floor(resto / 10)]);
    if (resto % 10) partes.push(UNIDADES[resto % 10]);
  } else if (resto) {
    partes.push(UNIDADES[resto]);
  }
  return partes.join(' e ');
}

/**
 * Número inteiro por extenso, em português de Portugal (até 999 999 999).
 * O "e" entre grupos só aparece antes do último quando este é menor que cem
 * ou centenas redondas: "mil e cem", mas "mil cento e vinte".
 */
export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) {
    throw new RangeError(`Fora do intervalo: ${n}`);
  }
  if (n === 0) return 'zero';
  const grupos: { valor: number; texto: string }[] = [];
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  if (milhoes) {
    grupos.push({
      valor: milhoes,
      texto: milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`,
    });
  }
  if (milhares) {
    grupos.push({
      valor: milhares,
      texto: milhares === 1 ? 'mil' : `${ate999(milhares)} mil`,
    });
  }
  if (resto) grupos.push({ valor: resto, texto: ate999(resto) });

  return grupos
    .map((g, i) => {
      if (i === 0) return g.texto;
      const ultimo = i === grupos.length - 1;
      const comE = ultimo && (g.valor < 100 || g.valor % 100 === 0);
      return `${comE ? ' e ' : ' '}${g.texto}`;
    })
    .join('');
}

/** 12340 → "cento e vinte e três euros e quarenta cêntimos" (para dizer em voz alta). */
export function eurosPorExtenso(cent: number): string {
  if (!Number.isInteger(cent) || cent < 0) {
    throw new RangeError(`Valor inválido: ${cent}`);
  }
  const euros = Math.floor(cent / 100);
  const centimos = cent % 100;
  const partes: string[] = [];
  if (euros) {
    // "um milhão de euros", mas "um milhão e cem euros".
    const de = euros % 1_000_000 === 0 ? ' de' : '';
    partes.push(
      `${numeroPorExtenso(euros)}${de} ${euros === 1 ? 'euro' : 'euros'}`,
    );
  }
  if (centimos) {
    partes.push(
      `${numeroPorExtenso(centimos)} ${centimos === 1 ? 'cêntimo' : 'cêntimos'}`,
    );
  }
  return partes.length ? partes.join(' e ') : 'zero euros';
}

/** 12340 → "123,40 €" (para escrever no SMS e na página). */
export function formatarEuros(cent: number): string {
  const euros = Math.floor(cent / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${euros},${String(cent % 100).padStart(2, '0')} €`;
}
