/*
 * Reservas (V4 #4): regras puras, sem BD. Escolher o equipamento ou a sessão
 * pelo que a pessoa diz, ver se um pedido cabe no horário (sem sobreposições,
 * com antecedência e duração máxima), o preço, o estado inicial e os lugares
 * dos bilhetes. Tudo no fuso do município (marcacoes/vagas.ts).
 */
import type { Feriados } from '../../common/dias-uteis.js';
import {
  diaDaSemana,
  gerarSlots,
  type Horario,
  horaLocal,
  instanteLocal,
  type Intervalo,
} from '../marcacoes/vagas.js';

/** Regras gerais de demonstração (a câmara confirma no regulamento de utilização). */
export const REGRAS_RESERVAS = {
  /** Até quantas horas antes se cancela com devolução do que foi pago. */
  cancelar_com_devolucao_horas: 24,
  /** Reservas por pagar ficam guardadas este tempo (indicativo, no SMS). */
  pagar_em_dias: 3,
  demonstracao: true,
} as const;

export type TipoEquipamento =
  'pavilhao' | 'piscina' | 'auditorio' | 'sala' | 'campo';

export const NOMES_TIPO: Record<TipoEquipamento, string> = {
  pavilhao: 'pavilhão',
  piscina: 'piscina',
  auditorio: 'auditório',
  sala: 'sala',
  campo: 'campo',
};

export function semAcentos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VAZIAS = new Set([
  'o',
  'a',
  'os',
  'as',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'e',
  'em',
  'no',
  'na',
  'municipal',
  'municipais',
  'camara',
  'para',
  'um',
  'uma',
  'reservar',
  'reserva',
  'quero',
  'jogo',
  'bilhete',
  'bilhetes',
]);

/** Sinónimos que a pessoa diz → a palavra que está no nome ou no tipo. */
const SINONIMOS: Record<string, string> = {
  pavilhoes: 'pavilhao',
  ginasio: 'pavilhao',
  futsal: 'pavilhao',
  andebol: 'pavilhao',
  basquetebol: 'pavilhao',
  piscinas: 'piscina',
  natacao: 'piscina',
  pista: 'piscina',
  auditorios: 'auditorio',
  sala: 'sala',
  salas: 'sala',
  reuniao: 'sala',
  futebol: 'campo',
  sintetico: 'campo',
  campos: 'campo',
  concerto: 'concerto',
  teatro: 'teatro',
  visita: 'visita',
};

function palavras(s: string): string[] {
  return semAcentos(s)
    .split(' ')
    .filter((p) => p.length > 1 && !VAZIAS.has(p))
    .map((p) => SINONIMOS[p] ?? p);
}

export type Escolha<T> =
  { tipo: 'um'; item: T } | { tipo: 'varios'; itens: T[] } | { tipo: 'nenhum' };

/**
 * O equipamento (ou a sessão) de que a pessoa fala, por palavras em comum
 * com o nome, o tipo e o local. Um com mais pontos que os outros → esse;
 * empatados → a escolher; nada em comum → nenhum.
 */
export function escolher<
  T extends { nome: string; tipo?: string; local?: string },
>(lista: T[], texto: string | undefined): Escolha<T> {
  if (!lista.length) return { tipo: 'nenhum' };
  const procura = texto ? palavras(texto) : [];
  if (!procura.length) {
    return lista.length === 1
      ? { tipo: 'um', item: lista[0] }
      : { tipo: 'varios', itens: lista };
  }
  const pontuados = lista
    .map((item) => {
      const deles = new Set(
        palavras([item.nome, item.tipo ?? '', item.local ?? ''].join(' ')),
      );
      const pontos = procura.filter(
        (p) =>
          deles.has(p) ||
          [...deles].some((d) => p.length >= 4 && d.startsWith(p)),
      ).length;
      return { item, pontos };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);
  if (!pontuados.length) return { tipo: 'nenhum' };
  const melhores = pontuados.filter((x) => x.pontos === pontuados[0].pontos);
  return melhores.length === 1
    ? { tipo: 'um', item: melhores[0].item }
    : { tipo: 'varios', itens: melhores.map((x) => x.item) };
}

export interface EquipamentoParaRegras {
  horario: Horario;
  duracao_slot_min: number;
  duracao_max_horas: number;
  antecedencia_horas: number;
  preco_hora_cent: number;
  aprovacao: 'automatica' | 'funcionario';
}

export interface PedidoReserva {
  dia: string;
  hora_inicio: string;
  /** Em horas (arredonda ao slot acima). */
  duracao_horas: number;
  fuso: string;
  feriados: Feriados;
  agora: Date;
  /** Reservas ativas do equipamento. */
  ocupados: Intervalo[];
}

export type Avaliacao =
  | { ok: true; inicio: Date; fim: Date; minutos: number; valor_cent: number }
  | {
      ok: false;
      motivo:
        | 'hora_invalida'
        | 'duracao'
        | 'fechado'
        | 'fora_do_horario'
        | 'em_cima_da_hora'
        | 'ocupado';
      texto: string;
    };

function minutos(hhmm: string): number | null {
  const m = /^([01]?\d|2[0-4])[:h]?([0-5]\d)?$/.exec(hhmm.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2] ?? 0);
  return v <= 24 * 60 ? v : null;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** "9h", "9:30", "21" → '09:00' / '09:30' / '21:00'; inválida → null. */
export function normalizarHora(h: string): string | null {
  const v = minutos(h);
  return v === null || v >= 24 * 60 ? null : hhmm(v);
}

/** Minutos pedidos arredondados ao slot acima (1,5 h com slots de 60 → 120). */
export function minutosReserva(duracaoHoras: number, slotMin: number): number {
  const pedidos = Math.max(1, Math.round(duracaoHoras * 60));
  return Math.ceil(pedidos / slotMin) * slotMin;
}

/** Preço: por hora, proporcional aos minutos reservados (arredondado ao cêntimo). */
export function precoReserva(
  precoHoraCent: number,
  minutosReservados: number,
): number {
  return Math.round((precoHoraCent * minutosReservados) / 60);
}

/**
 * O pedido cabe? Hora válida, duração até ao máximo, dia aberto (feriado
 * fecha), inteiro dentro de uma faixa do horário, com a antecedência mínima
 * e sem se sobrepor a outra reserva ativa.
 */
export function avaliarReserva(
  e: EquipamentoParaRegras,
  p: PedidoReserva,
): Avaliacao {
  const h = normalizarHora(p.hora_inicio);
  if (!h)
    return {
      ok: false,
      motivo: 'hora_invalida',
      texto: 'A hora não é válida (use, por exemplo, 18:00).',
    };
  const dur = minutosReserva(p.duracao_horas, e.duracao_slot_min);
  if (dur > e.duracao_max_horas * 60) {
    return {
      ok: false,
      motivo: 'duracao',
      texto: `Só se pode reservar até ${e.duracao_max_horas} horas seguidas.`,
    };
  }
  const faixas = p.feriados.has(p.dia)
    ? []
    : (e.horario[diaDaSemana(p.dia)] ?? []);
  if (!faixas.length) {
    return {
      ok: false,
      motivo: 'fechado',
      texto: 'Nesse dia não está aberto para reservas.',
    };
  }
  const a = minutos(h)!;
  const b = a + dur;
  const cabe = faixas.some((f) => {
    const [x, y] = f.split('-').map(minutos);
    return x !== null && y !== null && a >= x && b <= y;
  });
  if (!cabe) {
    return {
      ok: false,
      motivo: 'fora_do_horario',
      texto: `Fora do horário de reservas nesse dia (${faixas.join(' e ')}).`,
    };
  }
  const inicio = instanteLocal(p.dia, h, p.fuso);
  const fim = new Date(inicio.getTime() + dur * 60_000);
  if (inicio.getTime() < p.agora.getTime() + e.antecedencia_horas * 3_600_000) {
    return {
      ok: false,
      motivo: 'em_cima_da_hora',
      texto:
        e.antecedencia_horas > 0
          ? `As reservas fazem-se com pelo menos ${e.antecedencia_horas} horas de antecedência.`
          : 'Essa hora já passou.',
    };
  }
  if (p.ocupados.some((o) => inicio < o.fim && o.inicio < fim)) {
    return {
      ok: false,
      motivo: 'ocupado',
      texto: 'Essa hora já está reservada.',
    };
  }
  return {
    ok: true,
    inicio,
    fim,
    minutos: dur,
    valor_cent: precoReserva(e.preco_hora_cent, dur),
  };
}

/** As horas de início livres (slots) num dia, em hora local ("18:00"). */
export function horasLivres(
  e: EquipamentoParaRegras,
  dia: string,
  o: { fuso: string; feriados: Feriados; agora: Date; ocupados: Intervalo[] },
): string[] {
  return gerarSlots({
    horario: e.horario,
    duracaoMin: e.duracao_slot_min,
    dias: [dia],
    fuso: o.fuso,
    feriados: o.feriados,
    agora: o.agora,
    antecedenciaMin: e.antecedencia_horas * 60,
    ocupados: o.ocupados,
  }).map((s) => horaLocal(s.inicio, o.fuso));
}

/** Horas seguidas juntas em faixas, para dizer: ['18:00','19:00','21:00'] → "das 18h às 20h e das 21h às 22h". */
export function faixasLivres(horas: string[], slotMin: number): string {
  if (!horas.length) return '';
  const mins = horas.map((x) => minutos(x)!).sort((a, b) => a - b);
  const faixas: [number, number][] = [];
  for (const m of mins) {
    const u = faixas[faixas.length - 1];
    if (u && u[1] === m) u[1] = m + slotMin;
    else faixas.push([m, m + slotMin]);
  }
  const dita = (m: number) =>
    m % 60 ? hhmm(m).replace(':', 'h') : `${Math.floor(m / 60)}h`;
  return faixas.map(([a, b]) => `das ${dita(a)} às ${dita(b)}`).join(', ');
}

export type EstadoReserva =
  'por_aprovar' | 'por_pagar' | 'confirmada' | 'recusada' | 'cancelada';

/** Onde começa uma reserva: aprovação de um funcionário, pagamento ou já confirmada. */
export function estadoInicial(
  aprovacao: 'automatica' | 'funcionario',
  valorCent: number,
): EstadoReserva {
  if (aprovacao === 'funcionario') return 'por_aprovar';
  return valorCent > 0 ? 'por_pagar' : 'confirmada';
}

/** Depois de aprovada por um funcionário. */
export function estadoDepoisDeAprovar(valorCent: number): EstadoReserva {
  return valorCent > 0 ? 'por_pagar' : 'confirmada';
}

/** Pode cancelar? Só reservas ativas e antes de começar; devolução com antecedência. */
export function podeCancelar(
  estado: EstadoReserva,
  inicio: Date,
  agora: Date,
  pago: boolean,
): { pode: boolean; devolucao: boolean; texto: string } {
  if (estado === 'cancelada' || estado === 'recusada') {
    return {
      pode: false,
      devolucao: false,
      texto: 'Esta reserva já não está ativa.',
    };
  }
  if (inicio.getTime() <= agora.getTime()) {
    return {
      pode: false,
      devolucao: false,
      texto: 'Já passou a hora: não se pode cancelar.',
    };
  }
  const horas = (inicio.getTime() - agora.getTime()) / 3_600_000;
  const devolucao =
    pago && horas >= REGRAS_RESERVAS.cancelar_com_devolucao_horas;
  return {
    pode: true,
    devolucao,
    texto: !pago
      ? 'Pode cancelar: não há nada a devolver.'
      : devolucao
        ? 'Pode cancelar e o valor pago é devolvido.'
        : `Pode cancelar, mas com menos de ${REGRAS_RESERVAS.cancelar_com_devolucao_horas} horas de antecedência o valor pago não é devolvido.`,
  };
}

/** Bilhetes: quantos lugares ainda há e se o pedido cabe. */
export function avaliarBilhetes(
  lotacao: number,
  ocupados: number,
  quantidade: number,
  maxPorPessoa: number,
): { ok: true; livres: number } | { ok: false; livres: number; texto: string } {
  const livres = Math.max(0, lotacao - ocupados);
  if (quantidade > maxPorPessoa) {
    return {
      ok: false,
      livres,
      texto: `No máximo ${maxPorPessoa} bilhetes por pessoa.`,
    };
  }
  if (livres === 0) return { ok: false, livres, texto: 'Está esgotado.' };
  if (quantidade > livres) {
    return {
      ok: false,
      livres,
      texto: `Só há ${livres} ${livres === 1 ? 'lugar' : 'lugares'}.`,
    };
  }
  return { ok: true, livres };
}
