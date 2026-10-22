/*
 * Estacionamento (V4 #5): regras puras, sem BD. Matrículas e números de
 * auto, o estado de uma multa (pagar, defender, prazos), os parques perto
 * de uma zona, o custo de umas horas e se o parque está aberto (ou se a zona
 * é paga) a uma hora.
 *
 * Os prazos e valores que não vêm de uma fonte da câmara são valores de
 * demonstração (`demonstracao: true`) e o agente diz que estão por confirmar.
 */
import {
  diaDaSemana,
  diaLocal,
  horaLocal,
  type Horario,
} from '../marcacoes/vagas.js';

/**
 * Prazo de pagamento voluntário e de defesa: 15 dias úteis a contar da
 * notificação (Código da Estrada, art. 172.º e 175.º, para as
 * contraordenações rodoviárias). Fica como valor de demonstração até a
 * câmara confirmar o regulamento municipal de estacionamento que aplica.
 */
export const REGRAS_MULTAS = {
  prazo_dias_uteis: 15,
  /** Quanto tempo o serviço leva a responder a uma defesa (indicativo). */
  resposta_defesa_dias_uteis: 30,
  fonte: 'Código da Estrada, art. 172.º e 175.º (prazos de 15 dias úteis)',
  demonstracao: true,
} as const;

/** Pedidos de lugar reservado: prazo indicativo de resposta. */
export const REGRAS_LUGAR_DEFICIENCIA = {
  resposta_dias_uteis: 20,
  documentos: [
    'Cartão de estacionamento para pessoas com deficiência (emitido pelo IMT)',
    'Comprovativo de morada',
    'Documento único (ou livrete) da viatura',
  ],
  fonte:
    'Decreto-Lei n.º 307/2003 (cartão de estacionamento) e regulamento municipal de trânsito',
  demonstracao: true,
} as const;

/** Sem acentos, minúsculas, só letras, números e espaços. */
export function semAcentos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matrícula portuguesa em qualquer escrita ("aa 00 bb", "AA-00-BB",
 * "00aa00") → 'AA-00-BB'. Três pares de 2 caracteres, cada par só letras
 * ou só números, com pelo menos um par de letras e um de números.
 * Outra coisa → null.
 */
export function normalizarMatricula(s: string): string | null {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 6) return null;
  const pares = [c.slice(0, 2), c.slice(2, 4), c.slice(4, 6)];
  const letras = pares.filter((p) => /^[A-Z]{2}$/.test(p)).length;
  const numeros = pares.filter((p) => /^\d{2}$/.test(p)).length;
  if (letras + numeros !== 3 || !letras || !numeros) return null;
  return pares.join('-');
}

/** Número do auto: só letras e números, em maiúsculas ("est 2026 123" → 'EST2026123'). */
export function chaveAuto(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type EstadoMulta = 'por_pagar' | 'paga' | 'em_defesa' | 'anulada';

export interface MultaParaRegras {
  estado: EstadoMulta;
  prazo_pagamento: string;
  prazo_defesa: string;
  defesa_estado?: 'por_analisar' | 'aceite' | 'recusada' | null;
}

export interface SituacaoMulta {
  pode_pagar: boolean;
  pode_defender: boolean;
  fora_do_prazo_pagamento: boolean;
  fora_do_prazo_defesa: boolean;
  /** Uma frase sobre o que a pessoa pode fazer agora. */
  o_que_fazer: string;
}

/**
 * O que se pode fazer com a multa hoje. Paga ou anulada: nada. Com uma
 * defesa por analisar: espera-se pela decisão (não se paga entretanto).
 * Por pagar: paga-se (mesmo fora do prazo, já sem o valor mínimo garantido)
 * e, dentro do prazo de defesa, pode apresentar-se defesa (uma vez).
 */
export function situacaoMulta(m: MultaParaRegras, hoje: string): SituacaoMulta {
  const foraPag = hoje > m.prazo_pagamento;
  const foraDef = hoje > m.prazo_defesa;
  if (m.estado === 'paga') {
    return {
      pode_pagar: false,
      pode_defender: false,
      fora_do_prazo_pagamento: false,
      fora_do_prazo_defesa: false,
      o_que_fazer: 'Está paga: não há mais nada a fazer.',
    };
  }
  if (m.estado === 'anulada') {
    return {
      pode_pagar: false,
      pode_defender: false,
      fora_do_prazo_pagamento: false,
      fora_do_prazo_defesa: false,
      o_que_fazer: 'Foi anulada: não tem de pagar.',
    };
  }
  if (m.estado === 'em_defesa') {
    return {
      pode_pagar: false,
      pode_defender: false,
      fora_do_prazo_pagamento: foraPag,
      fora_do_prazo_defesa: foraDef,
      o_que_fazer:
        'A defesa está a ser analisada: não precisa de pagar enquanto não houver resposta, que segue por SMS.',
    };
  }
  const jaDefendeu = m.defesa_estado === 'recusada';
  const podeDefender = !foraDef && !jaDefendeu;
  return {
    pode_pagar: true,
    pode_defender: podeDefender,
    fora_do_prazo_pagamento: foraPag,
    fora_do_prazo_defesa: foraDef,
    o_que_fazer: foraPag
      ? 'O prazo de pagamento voluntário já passou: ainda pode pagar, mas o processo pode seguir para o valor da coima decidido pela câmara.'
      : podeDefender
        ? 'Pode pagar já (por referência Multibanco ou MB WAY) ou, se não concorda, apresentar defesa por escrito dentro do prazo.'
        : 'Pode pagar já por referência Multibanco ou MB WAY.',
  };
}

// ---------------------------------------------------------------------------
// Parques
// ---------------------------------------------------------------------------

export interface Tarifa {
  /** Preço da 1.ª hora (cêntimos). */
  primeira_hora_cent: number;
  /** Cada hora a seguir (cêntimos). */
  hora_seguinte_cent: number;
  /** Teto por dia (cêntimos), se houver. */
  maximo_dia_cent?: number | null;
  /** Minutos grátis à entrada, se houver. */
  minutos_gratis?: number | null;
}

export interface ParqueParaRegras {
  nome: string;
  tipo: 'parque' | 'zona_tarifada';
  morada: string;
  zonas: string[];
  horario: Horario;
  tarifa: Tarifa;
}

/**
 * Custo de estacionar `horas` (arredonda à hora acima, depois dos minutos
 * grátis), com o teto diário.
 */
export function custoEstacionar(t: Tarifa, minutos: number): number {
  const pagos = Math.max(0, minutos - (t.minutos_gratis ?? 0));
  if (pagos <= 0) return 0;
  const horas = Math.ceil(pagos / 60);
  const total = t.primeira_hora_cent + (horas - 1) * t.hora_seguinte_cent;
  return t.maximo_dia_cent ? Math.min(total, t.maximo_dia_cent) : total;
}

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Num instante, o parque está aberto (ou a zona é paga)? `horario` com
 * faixas "08:00-19:00"; "00:00-24:00" é o dia todo.
 */
export function dentroDoHorario(
  horario: Horario,
  instante: Date,
  fuso: string,
): boolean {
  const dia = diaLocal(instante, fuso);
  const agora = minutosDe(horaLocal(instante, fuso));
  return (horario[diaDaSemana(dia)] ?? []).some((f) => {
    const [a, b] = f.split('-');
    return agora >= minutosDe(a) && agora < minutosDe(b);
  });
}

const NOMES_DIAS: [keyof Horario, string][] = [
  ['seg', 'segunda'],
  ['ter', 'terça'],
  ['qua', 'quarta'],
  ['qui', 'quinta'],
  ['sex', 'sexta'],
  ['sab', 'sábado'],
  ['dom', 'domingo'],
];

function faixaDita(f: string): string {
  if (f === '00:00-24:00') return '24 horas';
  const [a, b] = f.split('-').map((x) =>
    x
      .replace(/^0(\d)/, '$1')
      .replace(/:00$/, 'h')
      .replace(':', 'h'),
  );
  return `das ${a} às ${b}`;
}

/**
 * O horário em português, juntando os dias iguais seguidos:
 * "segunda a sexta das 8h às 19h; sábado das 8h às 13h".
 */
export function horarioDito(h: Horario): string {
  const grupos: { de: string; ate: string; faixas: string }[] = [];
  for (const [k, nome] of NOMES_DIAS) {
    const faixas = (h[k] ?? []).map(faixaDita).join(' e ');
    if (!faixas) continue;
    const ultimo = grupos[grupos.length - 1];
    const anterior = NOMES_DIAS[NOMES_DIAS.findIndex(([x]) => x === k) - 1];
    if (ultimo && ultimo.faixas === faixas && anterior?.[1] === ultimo.ate) {
      ultimo.ate = nome;
    } else {
      grupos.push({ de: nome, ate: nome, faixas });
    }
  }
  if (!grupos.length) return 'sem horário definido';
  return grupos
    .map((g) =>
      g.de === g.ate ? `${g.de} ${g.faixas}` : `${g.de} a ${g.ate} ${g.faixas}`,
    )
    .join('; ');
}

/** "1,00 € a 1.ª hora, 0,80 € as seguintes, máximo 6,00 € por dia". */
export function tarifaDita(t: Tarifa): string {
  const e = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
  const partes = [
    t.minutos_gratis ? `${t.minutos_gratis} minutos grátis` : null,
    `${e(t.primeira_hora_cent)} a primeira hora`,
    t.hora_seguinte_cent !== t.primeira_hora_cent
      ? `${e(t.hora_seguinte_cent)} cada hora seguinte`
      : null,
    t.maximo_dia_cent ? `máximo de ${e(t.maximo_dia_cent)} por dia` : null,
  ].filter(Boolean);
  return partes.join(', ');
}

/** Palavras que não ajudam a encontrar um sítio. */
const VAZIAS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'e',
  'em',
  'no',
  'na',
  'rua',
  'avenida',
  'av',
  'largo',
  'praca',
  'perto',
  'junto',
  'ao',
  'guimaraes',
  'centro',
  'zona',
  'parque',
  'estacionamento',
  'n',
  'numero',
]);

function palavras(s: string): string[] {
  return semAcentos(s)
    .split(' ')
    .filter((p) => p.length > 1 && !VAZIAS.has(p) && !/^\d+$/.test(p));
}

/**
 * Os parques perto de uma morada ou zona, por palavras em comum com o nome,
 * a morada e as zonas de cada um. "centro" (ou nada) → todos, pela ordem
 * em que vêm. Sem nada em comum → lista vazia e `encontrou: false`.
 */
export function parquesPerto<P extends ParqueParaRegras>(
  parques: P[],
  onde: string | undefined,
): { parques: P[]; encontrou: boolean } {
  const procura = onde ? palavras(onde) : [];
  if (!procura.length) return { parques, encontrou: true };
  const pontuados = parques
    .map((p) => {
      const deles = new Set(palavras([p.nome, p.morada, ...p.zonas].join(' ')));
      const pontos = procura.filter(
        (x) =>
          deles.has(x) ||
          [...deles].some((d) => d.startsWith(x) && x.length >= 4),
      ).length;
      return { p, pontos };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);
  return {
    parques: pontuados.map((x) => x.p),
    encontrou: pontuados.length > 0,
  };
}
