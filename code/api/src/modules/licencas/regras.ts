/*
 * As regras da licença especial de ruído, em código: o que o agente
 * verifica durante a chamada. Sem BD, para testar à parte e para a câmara
 * ver (e mudar) os mesmos números no painel.
 *
 * Os valores por omissão são de DEMONSTRAÇÃO: cada câmara põe os do seu
 * regulamento municipal (o Regulamento Geral do Ruído, DL 9/2007, prevê a
 * licença especial de ruído para atividades ruidosas temporárias).
 */
import { z } from 'zod';
import { diasUteisEntre, Feriados } from '../../common/dias-uteis.js';

const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM.');

export const esquemaConfigRuido = z.object({
  /** Mais cedo que se pode começar. */
  hora_inicio_min: hora,
  /** Até que horas, de domingo a quinta. */
  hora_fim_max_semana: hora,
  /** Até que horas à sexta, ao sábado e na véspera de feriado. */
  hora_fim_max_fds: hora,
  /** Música amplificada no exterior só até esta hora (depois: condição). */
  musica_exterior_ate: hora,
  antecedencia_min_dias_uteis: z.number().int().min(0).max(30),
  antecedencia_max_dias: z.number().int().min(1).max(365),
  duracao_max_horas: z.number().int().min(1).max(24),
  pessoas_max: z.number().int().min(1).max(10_000),
  taxa_cent: z.number().int().min(0).max(100_000),
  /** 'funcionario': alguém aprova com um clique; 'automatica': emite logo depois de pago. */
  aprovacao: z.enum(['funcionario', 'automatica']),
  fonte: z.object({
    titulo: z.string().trim().min(3).max(200),
    url: z.url().nullable(),
  }),
  /** Valores por confirmar com o regulamento do município. */
  demonstracao: z.boolean(),
});
export type ConfigRuido = z.output<typeof esquemaConfigRuido>;

export const CONFIG_RUIDO_OMISSAO: ConfigRuido = {
  hora_inicio_min: '09:00',
  hora_fim_max_semana: '00:00',
  hora_fim_max_fds: '02:00',
  musica_exterior_ate: '00:00',
  antecedencia_min_dias_uteis: 2,
  antecedencia_max_dias: 90,
  duracao_max_horas: 10,
  pessoas_max: 150,
  taxa_cent: 2500,
  aprovacao: 'funcionario',
  fonte: {
    titulo:
      'Regulamento Geral do Ruído (DL 9/2007), art. 15.º · licença especial de ruído',
    url: null,
  },
  demonstracao: true,
};

export function lerConfigRuido(v: unknown): ConfigRuido {
  const r = esquemaConfigRuido.safeParse(v);
  return r.success ? r.data : CONFIG_RUIDO_OMISSAO;
}

export const ATIVIDADES = {
  festa_privada: 'Festa privada (aniversário, casamento, batizado)',
  evento: 'Evento aberto ao público (arraial, concerto, festa da rua)',
  obra: 'Obra ruidosa fora de horas',
} as const;
export type Atividade = keyof typeof ATIVIDADES;

export interface PedidoRuido {
  atividade: Atividade;
  data: string; // AAAA-MM-DD
  hora_inicio: string; // HH:MM
  hora_fim: string; // HH:MM (pode passar da meia-noite)
  pessoas?: number;
  musica_amplificada?: boolean;
}

export interface RegraAvaliada {
  id: string;
  ok: boolean;
  texto: string;
}

export interface Avaliacao {
  regras: RegraAvaliada[];
  proposta: 'aprovar' | 'tecnico';
  condicoes: string[];
  /** Hora limite que se aplica nesse dia. */
  hora_fim_max: string;
}

function minutos(h: string): number {
  const [a, b] = h.split(':').map(Number);
  return a * 60 + b;
}

function diaDaSemana(dia: string): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Fim no "relógio do dia do evento": 01:30 depois das 20:00 conta como 25:30. */
function fimEmMinutos(inicio: string, fim: string): number {
  const i = minutos(inicio);
  const f = minutos(fim);
  return f <= i ? f + 24 * 60 : f;
}

/** 00:00 e 02:00 como limites de fim: depois da meia-noite contam no dia seguinte. */
function limiteEmMinutos(h: string): number {
  const m = minutos(h);
  return m < 12 * 60 ? m + 24 * 60 : m;
}

function horaFalada(h: string): string {
  const [a, b] = h.split(':').map(Number);
  const hh = a === 0 ? 'meia-noite' : a === 1 ? '1h' : `${a}h`;
  return b ? `${hh}${String(b).padStart(2, '0')}` : hh;
}

/** Uma hora é singular (à 1h, à meia-noite); as outras são plurais (às 20h). */
function singular(h: string): boolean {
  return [0, 1].includes(Number(h.split(':')[0]));
}

/** "à 1h", "às 23h30". */
function aHora(h: string): string {
  return `${singular(h) ? 'à' : 'às'} ${horaFalada(h)}`;
}

/** "da 1h", "das 9h". */
function daHora(h: string): string {
  return `${singular(h) ? 'da' : 'das'} ${horaFalada(h)}`;
}

/** Sexta, sábado ou véspera de feriado: aplica-se o limite mais tardio. */
export function eNoiteLonga(dia: string, feriados: Feriados): boolean {
  const s = diaDaSemana(dia);
  return s === 5 || s === 6 || feriados.has(diaSeguinte(dia));
}

export function avaliarRuido(
  p: PedidoRuido,
  c: ConfigRuido,
  hoje: string,
  feriados: Feriados,
): Avaliacao {
  const regras: RegraAvaliada[] = [];
  const add = (id: string, ok: boolean, texto: string) =>
    regras.push({ id, ok, texto });

  const longa = eNoiteLonga(p.data, feriados);
  const horaFimMax = longa ? c.hora_fim_max_fds : c.hora_fim_max_semana;

  const diasCorridos = Math.round(
    (Date.parse(`${p.data}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) /
      86_400_000,
  );
  if (diasCorridos < 0) {
    add('data', false, 'A data já passou.');
  } else if (diasCorridos > c.antecedencia_max_dias) {
    add(
      'data',
      false,
      `Só se pede com até ${c.antecedencia_max_dias} dias de antecedência.`,
    );
  } else {
    const uteis = diasUteisEntre(hoje, p.data, feriados);
    add(
      'antecedencia',
      uteis >= c.antecedencia_min_dias_uteis,
      uteis >= c.antecedencia_min_dias_uteis
        ? `Pedido com ${uteis} dias úteis de antecedência (mínimo ${c.antecedencia_min_dias_uteis}).`
        : `Pedido com ${uteis} dias úteis de antecedência: o mínimo é ${c.antecedencia_min_dias_uteis}.`,
    );
  }

  const inicio = minutos(p.hora_inicio);
  add(
    'hora_inicio',
    inicio >= minutos(c.hora_inicio_min),
    `Começa ${aHora(p.hora_inicio)} (não antes ${daHora(c.hora_inicio_min)}).`,
  );

  const fim = fimEmMinutos(p.hora_inicio, p.hora_fim);
  const limite = limiteEmMinutos(horaFimMax);
  add(
    'hora_fim',
    fim <= limite,
    fim <= limite
      ? `Acaba ${aHora(p.hora_fim)}; ${longa ? 'nessa noite' : 'nesse dia'} o limite é ${aHora(horaFimMax)}.`
      : `Acaba ${aHora(p.hora_fim)}, depois do limite ${longa ? 'dessa noite' : 'desse dia'} (${horaFalada(horaFimMax)}).`,
  );

  const duracao = (fim - inicio) / 60;
  add(
    'duracao',
    duracao <= c.duracao_max_horas,
    `Dura ${Number.isInteger(duracao) ? duracao : duracao.toFixed(1).replace('.', ',')} h (máximo ${c.duracao_max_horas} h).`,
  );

  if (p.pessoas !== undefined) {
    add(
      'pessoas',
      p.pessoas <= c.pessoas_max,
      p.pessoas <= c.pessoas_max
        ? `${p.pessoas} pessoas (até ${c.pessoas_max}).`
        : `${p.pessoas} pessoas: acima de ${c.pessoas_max} precisa de análise.`,
    );
  }

  if (p.atividade === 'obra') {
    add(
      'atividade',
      false,
      'Obras fora de horas precisam sempre de um técnico (impacto prolongado nos vizinhos).',
    );
  }

  const condicoes = [
    'Ter a licença à mão (no telemóvel ou impressa) durante o evento.',
  ];
  if (p.musica_amplificada) {
    const exteriorAte = limiteEmMinutos(c.musica_exterior_ate);
    if (fim > exteriorAte) {
      condicoes.push(
        `Música amplificada no exterior só até ${aHora(c.musica_exterior_ate)}; depois, dentro de casa e com as janelas fechadas.`,
      );
    } else {
      condicoes.push(
        'Colunas viradas para dentro do terreno, longe dos vizinhos.',
      );
    }
  }
  condicoes.push('Avisar os vizinhos mais próximos com antecedência.');

  return {
    regras,
    proposta: regras.every((r) => r.ok) ? 'aprovar' : 'tecnico',
    condicoes,
    hora_fim_max: horaFimMax,
  };
}
