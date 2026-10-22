/*
 * Cemitérios (V4 #8): regras puras, sem BD. Taxas de demonstração, estado
 * da concessão, como dizer o horário e a localização de uma sepultura, e
 * como ler "talhão 3, número 120" do que a pessoa diz.
 */
import { lerHorario, type Horario } from '../atendimento/horario.js';
import {
  dataDita,
  diasEntre,
  eurosDitos,
} from '../servicos-municipais/comum.js';

// ---------------------------------------------------------------------------
// Taxas
// ---------------------------------------------------------------------------

export const SERVICOS_TAXA = [
  'inumacao',
  'exumacao',
  'trasladacao',
  'concessao',
  'renovacao',
  'averbamento',
  'conservacao',
  'segunda_via_alvara',
] as const;
export type ServicoTaxa = (typeof SERVICOS_TAXA)[number];

export interface Taxa {
  servico: ServicoTaxa;
  descricao: string;
  valor_cent: number;
  /** "por ano", "por metro quadrado"… */
  unidade?: string;
}

/**
 * VALORES DE DEMONSTRAÇÃO: não são os da tabela de taxas de Guimarães. O
 * enquadramento legal é o Decreto-Lei n.º 411/98, de 30 de dezembro
 * (inumação, exumação e trasladação); os valores vêm do regulamento de
 * cemitérios e da tabela de taxas de cada município, que a câmara tem de
 * confirmar.
 */
export const TAXAS_DEMONSTRACAO: readonly Taxa[] = [
  {
    servico: 'inumacao',
    descricao: 'Inumação em sepultura temporária',
    valor_cent: 6000,
  },
  { servico: 'inumacao', descricao: 'Inumação em jazigo', valor_cent: 4500 },
  {
    servico: 'exumacao',
    descricao: 'Exumação (por ossada)',
    valor_cent: 5000,
  },
  {
    servico: 'trasladacao',
    descricao: 'Trasladação dentro do concelho',
    valor_cent: 4000,
  },
  {
    servico: 'concessao',
    descricao: 'Concessão perpétua de sepultura',
    valor_cent: 120000,
  },
  {
    servico: 'concessao',
    descricao: 'Concessão de terreno para jazigo',
    valor_cent: 90000,
    unidade: 'por metro quadrado',
  },
  {
    servico: 'concessao',
    descricao: 'Concessão de gavetão ou ossário',
    valor_cent: 35000,
  },
  {
    servico: 'renovacao',
    descricao: 'Renovação de concessão temporária (5 anos)',
    valor_cent: 10000,
  },
  {
    servico: 'averbamento',
    descricao: 'Averbamento (mudança de titular da concessão)',
    valor_cent: 3000,
  },
  {
    servico: 'conservacao',
    descricao: 'Taxa de conservação de sepultura ou jazigo',
    valor_cent: 1500,
    unidade: 'por ano',
  },
  {
    servico: 'segunda_via_alvara',
    descricao: '2.ª via do alvará de concessão',
    valor_cent: 1500,
  },
];

export const FONTE_TAXAS = {
  titulo:
    'Decreto-Lei n.º 411/98, de 30 de dezembro (enquadramento); valores do regulamento e da tabela de taxas municipais, por confirmar',
  demonstracao: true,
} as const;

export function taxasDe(servico?: ServicoTaxa): Taxa[] {
  return TAXAS_DEMONSTRACAO.filter((t) => !servico || t.servico === servico);
}

export function fraseTaxa(t: Taxa): string {
  return `${t.descricao}: ${eurosDitos(t.valor_cent)}${t.unidade ? ` ${t.unidade}` : ''}`;
}

// ---------------------------------------------------------------------------
// Concessões
// ---------------------------------------------------------------------------

/** Dias antes do fim em que a concessão está "a terminar". */
export const DIAS_A_TERMINAR = 180;

export type EstadoConcessao =
  'perpetua' | 'valida' | 'a_terminar' | 'terminada';

export function estadoConcessao(
  s: { concessao: 'temporaria' | 'perpetua'; concessao_fim: string | null },
  hoje: string,
): EstadoConcessao {
  if (s.concessao === 'perpetua' || !s.concessao_fim) return 'perpetua';
  const faltam = diasEntre(hoje, s.concessao_fim);
  if (faltam < 0) return 'terminada';
  if (faltam <= DIAS_A_TERMINAR) return 'a_terminar';
  return 'valida';
}

/** Só o primeiro nome e a inicial do último ("Maria F."): a concessão é pública ao telefone, o titular não. */
export function mascararNome(nome: string | null): string | null {
  if (!nome?.trim()) return null;
  const p = nome.trim().split(/\s+/);
  if (p.length === 1) return p[0];
  return `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}

const TIPOS_DITOS: Record<string, string> = {
  sepultura: 'sepultura',
  jazigo: 'jazigo',
  gavetao: 'gavetão',
  ossario: 'ossário',
};

export function localDito(s: {
  cemiterio: string;
  tipo: string;
  talhao: string;
  numero: string;
}): string {
  return `${s.cemiterio}, talhão ${s.talhao}, ${TIPOS_DITOS[s.tipo] ?? s.tipo} número ${s.numero}`;
}

export function fraseConcessao(
  s: {
    concessao: 'temporaria' | 'perpetua';
    concessao_fim: string | null;
    conservacao_divida_cent: number;
    conservacao_divida_desde: number | null;
  },
  hoje: string,
): string {
  const e = estadoConcessao(s, hoje);
  const validade =
    e === 'perpetua'
      ? 'A concessão é perpétua.'
      : e === 'terminada'
        ? `A concessão terminou a ${dataDita(s.concessao_fim)} e pode ser renovada.`
        : e === 'a_terminar'
          ? `A concessão termina a ${dataDita(s.concessao_fim)}: está na altura de pedir a renovação.`
          : `A concessão é válida até ${dataDita(s.concessao_fim)}.`;
  const divida =
    s.conservacao_divida_cent > 0
      ? ` Há taxas de conservação por pagar: ${eurosDitos(s.conservacao_divida_cent)}${s.conservacao_divida_desde ? `, desde ${s.conservacao_divida_desde}` : ''}.`
      : ' Não há taxas de conservação por pagar.';
  return validade + divida;
}

// ---------------------------------------------------------------------------
// O que a pessoa diz
// ---------------------------------------------------------------------------

export interface ReferenciaSepultura {
  talhao: string | null;
  numero: string | null;
}

/** "talhão 3, número 120" / "talhao B sepultura 45" / "jazigo 12 do talhão A". */
export function lerReferencia(texto: string): ReferenciaSepultura {
  const t = texto.toLowerCase();
  const talhao = /talh[aã]o\s*(?:n\.?º\s*|n[uú]mero\s*)?([a-z0-9]+)/i.exec(t);
  const numero =
    /(?:n[uú]mero|n\.?º|sepultura|jazigo|gavet[aã]o|oss[aá]rio|campa)\s*(?:n[uú]mero\s*|n\.?º\s*)?(\d+[a-z]?)/i.exec(
      t,
    );
  return {
    talhao: talhao ? talhao[1].toUpperCase() : null,
    numero: numero ? numero[1].toUpperCase() : null,
  };
}

// ---------------------------------------------------------------------------
// Horário
// ---------------------------------------------------------------------------

const NOMES_DIAS = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
];

/** "de segunda a sexta, das 8:00 às 17:00; sábado e domingo, das 9:00 às 17:00". */
export function horarioDito(json: unknown): string | null {
  const h: Horario | null = lerHorario(json);
  if (!h) return null;
  if (h.sempre) return 'sempre aberto';
  const hhmm = (m: number) =>
    `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const textoDia = (i: number) =>
    h.semana[i].length
      ? h.semana[i].map(([a, b]) => `das ${hhmm(a)} às ${hhmm(b)}`).join(' e ')
      : 'fechado';
  // Agrupa dias seguidos com o mesmo horário (segunda primeiro).
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const grupos: { dias: number[]; texto: string }[] = [];
  for (const i of ordem) {
    const texto = textoDia(i);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.texto === texto) ultimo.dias.push(i);
    else grupos.push({ dias: [i], texto });
  }
  return grupos
    .map((g) => {
      const a = NOMES_DIAS[g.dias[0]];
      const b = NOMES_DIAS[g.dias[g.dias.length - 1]];
      const dias =
        g.dias.length === 1
          ? a
          : g.dias.length === 2
            ? `${a} e ${b}`
            : `de ${a} a ${b}`;
      return `${dias}, ${g.texto}`;
    })
    .join('; ');
}
