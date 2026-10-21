/*
 * Regras puras dos avisos de emergência em massa (sem BD nem rede): tipos,
 * zona, lista carregada à mão (CSV), junção das fontes, quem é ligado
 * conforme a gravidade, ritmo de envio, tempo e custo estimados, texto do SMS
 * e o resultado de cada pessoa. Testadas em emergencias.regras.spec.ts.
 *
 * Decisões:
 * - O SMS vai a todos os destinatários com telemóvel, sem olhar ao opt-out dos
 *   avisos (`aceita_avisos`) nem ao horário: é segurança.
 * - Chamadas do agente conforme a gravidade: 'aviso' só SMS; 'alerta' liga
 *   aos mais vulneráveis (contactos de cuidado da ação social); 'emergencia'
 *   liga a todos. A câmara pode escolher outra política ao criar.
 * - Um número = uma pessoa: as fontes juntam-se pelo telefone e o
 *   destinatário guarda todas as fontes de onde veio.
 * - O ritmo (SMS e chamadas por minuto) é configurável por município, para
 *   não passar os limites do Twilio. Os valores por omissão, os preços e a
 *   duração média das chamadas são VALORES DE DEMONSTRAÇÃO (não são preços
 *   do Twilio nem do operador; confirmar no contrato da câmara).
 */
import { z } from 'zod';
import {
  Geometria,
  geometriaDaZona,
  mascararNome,
  pontoNaZona,
  Ponto,
  telefoneParaSms,
} from '../avisos-zona/avisos-zona.regras.js';
import { telefoneLigavel } from '../chamadas-saida/regras.js';
import { partesFreguesia } from '../consultas-publicas/regras.js';
import { infoSms, InfoSms, transliterar } from '../comunicacao/sms.js';
import { normalizarTelefone } from '../municipes/municipes.service.js';
import { normalizarTexto } from '../ocorrencias/ocorrencias.regras.js';

export const TIPOS_EMERGENCIA = [
  'cheia',
  'incendio',
  'corte_agua',
  'calor_extremo',
  'outro',
] as const;
export type TipoEmergencia = (typeof TIPOS_EMERGENCIA)[number];

export const GRAVIDADES = ['aviso', 'alerta', 'emergencia'] as const;
export type Gravidade = (typeof GRAVIDADES)[number];

export const POLITICAS_CHAMADAS = ['nenhuma', 'vulneraveis', 'todos'] as const;
export type PoliticaChamadas = (typeof POLITICAS_CHAMADAS)[number];

export const ESTADOS_EMERGENCIA = [
  'rascunho',
  'ativa',
  'encerrada',
  'cancelada',
] as const;
export type EstadoEmergencia = (typeof ESTADOS_EMERGENCIA)[number];

/**
 * As fontes dos números. 'externa' (operadores / cell broadcast / Proteção
 * Civil) está por implementar e devolve "não configurada".
 */
export const FONTES = ['municipes', 'cuidado', 'lista', 'externa'] as const;
export type IdFonte = (typeof FONTES)[number];

export const NOMES_FONTES: Record<IdFonte, string> = {
  municipes: 'Munícipes conhecidos com morada na zona',
  cuidado: 'Contactos de cuidado da ação social na zona',
  lista: 'Lista carregada à mão',
  externa: 'Fonte externa (operadores, cell broadcast, Proteção Civil)',
};

export const AVISO_COBERTURA =
  'Esta lista não é toda a gente da zona: são só os números que a câmara conhece (munícipes que já trataram de alguma coisa com morada na zona, pessoas inscritas na ação social e a lista carregada). Para chegar a toda a gente é preciso uma fonte externa (operadores, cell broadcast ou Proteção Civil), que ainda não está ligada.';

export const MAX_DESTINATARIOS = 20_000;
export const MAX_LISTA = 5_000;
export const MAX_SEGMENTOS = 3;
export const AMOSTRA = 10;

// ---------------------------------------------------------------------
// Valores de demonstração (ritmo, preços, duração)
// ---------------------------------------------------------------------

/**
 * Ritmo por omissão: 60 SMS por minuto (1 por segundo, o débito de um
 * remetente no Twilio sem pedir mais) e 10 chamadas por minuto (o agente de
 * voz atende poucas em simultâneo). Valores de demonstração.
 */
export const RITMO_OMISSAO = {
  sms_por_minuto: 60,
  chamadas_por_minuto: 10,
  demonstracao: true,
} as const;

/** Preços e duração para a estimativa: VALORES DE DEMONSTRAÇÃO. */
export const PRECOS_DEMONSTRACAO = {
  moeda: 'EUR',
  sms_por_segmento: 0.05,
  chamada_por_minuto: 0.1,
  minutos_por_chamada: 2,
  demonstracao: true,
  nota: 'Valores de demonstração: não são os preços do Twilio nem do operador da câmara. Confirmar no contrato.',
} as const;

// ---------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------

const esquemaPonto = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Polígono ou ponto + raio (como nos avisos por zona), ou freguesias. */
export const esquemaZona = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('poligono'),
    pontos: z.array(esquemaPonto).min(3).max(200),
    descricao: z.string().trim().min(3).max(200).optional(),
  }),
  z.object({
    tipo: z.literal('ponto'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    raio_m: z.number().int().min(10).max(20_000),
    descricao: z.string().trim().min(3).max(200).optional(),
  }),
  z.object({
    tipo: z.literal('freguesias'),
    freguesias: z.array(z.string().trim().min(2).max(120)).min(1).max(50),
    descricao: z.string().trim().min(3).max(200).optional(),
  }),
]);
export type ZonaEmergencia = z.output<typeof esquemaZona>;

export const esquemaGuiao = z.object({
  dizer: z.string().trim().min(10).max(600),
  perguntas: z.array(z.string().trim().min(3).max(200)).min(1).max(5),
});
export type Guiao = z.output<typeof esquemaGuiao>;

export const esquemaListaManual = z
  .array(
    z.object({
      telefone: z.string().trim().min(6).max(25),
      nome: z.string().trim().max(120).optional(),
    }),
  )
  .max(MAX_LISTA);

// ---------------------------------------------------------------------
// Zona
// ---------------------------------------------------------------------

/** A zona pronta a testar: geometria (polígono, ponto) ou freguesias. */
export interface GeometriaEmergencia {
  geo: Geometria | null;
  freguesias: string[] | null;
}

export function geometriaEmergencia(z: ZonaEmergencia): GeometriaEmergencia {
  if (z.tipo === 'freguesias') {
    return { geo: null, freguesias: [...new Set(z.freguesias)] };
  }
  return { geo: geometriaDaZona(z), freguesias: null };
}

export function descreverZonaEmergencia(z: ZonaEmergencia): string {
  if (z.descricao) return z.descricao;
  switch (z.tipo) {
    case 'freguesias':
      return z.freguesias.length === 1
        ? `Freguesia de ${z.freguesias[0]}`
        : `Freguesias de ${z.freguesias.slice(0, -1).join(', ')} e ${z.freguesias[z.freguesias.length - 1]}`;
    case 'ponto':
      return `Num raio de ${z.raio_m >= 1000 ? `${String(Math.round(z.raio_m / 100) / 10).replace('.', ',')} km` : `${z.raio_m} m`} à volta do local indicado no mapa`;
    case 'poligono':
      return 'Na área marcada no mapa';
  }
}

/**
 * A freguesia escrita está na lista? "Azurém" = "azurem" = "Freguesia de
 * Azurém"; "União das Freguesias de Oliveira, São Paio e São Sebastião"
 * conta para "São Paio" (e vice-versa).
 */
export function freguesiaNaLista(
  freguesia: string | null | undefined,
  lista: readonly string[],
): boolean {
  if (!freguesia?.trim()) return false;
  const limpar = (x: string) =>
    normalizarTexto(x).replace(/^freguesia d[aeo]s? /, '');
  const f = limpar(freguesia);
  const pf = new Set(partesFreguesia(freguesia));
  return lista.some((l) => {
    if (limpar(l) === f) return true;
    return partesFreguesia(l).some((p) => pf.has(p));
  });
}

/** O ponto cai na zona geométrica? (Zona por freguesias: nunca.) */
export function pontoNaZonaEmergencia(
  p: Ponto,
  g: GeometriaEmergencia,
): boolean {
  return g.geo !== null && pontoNaZona(p, g.geo);
}

// ---------------------------------------------------------------------
// Lista carregada à mão (CSV)
// ---------------------------------------------------------------------

export interface LinhaLista {
  telefone: string;
  nome?: string;
}

/**
 * CSV de telefones (um por linha; "telefone" ou "telefone;nome" ou
 * "nome,telefone"). Ignora o cabeçalho, linhas vazias e comentários (#).
 * Normaliza para E.164 (Portugal por omissão) e tira repetidos.
 */
export function lerCsvTelefones(texto: string): {
  linhas: LinhaLista[];
  invalidas: { linha: number; texto: string }[];
  repetidas: number;
} {
  const linhas: LinhaLista[] = [];
  const invalidas: { linha: number; texto: string }[] = [];
  const vistos = new Set<string>();
  let repetidas = 0;
  texto.split(/\r?\n/).forEach((bruta, i) => {
    const l = bruta.trim();
    if (!l || l.startsWith('#')) return;
    const campos = l
      .split(/[;,\t]/)
      .map((c) => c.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
    const idx = campos.findIndex((c) => /^[+\d][\d\s().-]{5,}$/.test(c));
    if (idx < 0) {
      // Cabeçalho ("telefone;nome") na primeira linha com texto: ignora.
      if (
        !linhas.length &&
        !invalidas.length &&
        /telefone|n[uú]mero|phone/i.test(l)
      )
        return;
      invalidas.push({ linha: i + 1, texto: l.slice(0, 80) });
      return;
    }
    const e164 = normalizarTelefone(campos[idx]);
    if (!e164) {
      invalidas.push({ linha: i + 1, texto: l.slice(0, 80) });
      return;
    }
    if (vistos.has(e164)) {
      repetidas++;
      return;
    }
    vistos.add(e164);
    const nome = campos.find((c, j) => j !== idx && /\p{L}/u.test(c));
    linhas.push(
      nome ? { telefone: e164, nome: nome.slice(0, 120) } : { telefone: e164 },
    );
  });
  return { linhas, invalidas, repetidas };
}

// ---------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------

/** Um número encontrado por uma fonte. */
export interface Candidato {
  telefone_e164: string;
  municipe_id: string | null;
  nome: string | null;
  /** Contacto de cuidado da ação social: é dos primeiros a ser ligado. */
  vulneravel: boolean;
}

export type EstadoFonte = 'ok' | 'nao_configurada' | 'erro';

export interface ResultadoFonte {
  fonte: IdFonte;
  nome: string;
  estado: EstadoFonte;
  candidatos: Candidato[];
  /** O que se deve saber desta fonte (limites, o que ficou de fora). */
  nota: string | null;
}

export interface Destinatario extends Candidato {
  fontes: IdFonte[];
  /** Pode receber SMS (telemóvel). */
  sms: boolean;
  /** Pode ser ligado (móvel ou fixo, sem tarifa especial). */
  ligavel: boolean;
}

/**
 * Junta o que as fontes encontraram: um destinatário por telefone, com todas
 * as fontes de onde veio; é vulnerável se alguma fonte o disser; fica com o
 * primeiro munícipe e nome conhecidos. Quem não pode receber SMS nem ser
 * ligado fica de fora (contado).
 */
export function juntarFontes(resultados: readonly ResultadoFonte[]): {
  destinatarios: Destinatario[];
  por_fonte: Record<IdFonte, number>;
  em_varias_fontes: number;
  sem_contacto_possivel: number;
} {
  const por = new Map<string, Destinatario>();
  const porFonte = Object.fromEntries(FONTES.map((f) => [f, 0])) as Record<
    IdFonte,
    number
  >;
  for (const r of resultados) {
    if (r.estado !== 'ok') continue;
    const vistosNestaFonte = new Set<string>();
    for (const c of r.candidatos) {
      const tel = normalizarTelefone(c.telefone_e164);
      if (!tel || vistosNestaFonte.has(tel)) continue;
      vistosNestaFonte.add(tel);
      porFonte[r.fonte]++;
      const ja = por.get(tel);
      if (ja) {
        if (!ja.fontes.includes(r.fonte)) ja.fontes.push(r.fonte);
        ja.vulneravel ||= c.vulneravel;
        ja.municipe_id ??= c.municipe_id;
        ja.nome ??= c.nome;
        continue;
      }
      por.set(tel, {
        telefone_e164: tel,
        municipe_id: c.municipe_id,
        nome: c.nome,
        vulneravel: c.vulneravel,
        fontes: [r.fonte],
        sms: telefoneParaSms(tel),
        ligavel: telefoneLigavel(tel),
      });
    }
  }
  const todos = [...por.values()];
  for (const d of todos)
    d.fontes.sort((a, b) => FONTES.indexOf(a) - FONTES.indexOf(b));
  const destinatarios = todos.filter((d) => d.sms || d.ligavel);
  // Primeiro os vulneráveis (são os primeiros avisados e ligados).
  destinatarios.sort((a, b) => Number(b.vulneravel) - Number(a.vulneravel));
  return {
    destinatarios,
    por_fonte: porFonte,
    em_varias_fontes: destinatarios.filter((d) => d.fontes.length > 1).length,
    sem_contacto_possivel: todos.length - destinatarios.length,
  };
}

// ---------------------------------------------------------------------
// Chamadas e ritmo
// ---------------------------------------------------------------------

/** A política de chamadas por omissão para cada gravidade. */
export function politicaPorGravidade(g: Gravidade): PoliticaChamadas {
  return g === 'aviso' ? 'nenhuma' : g === 'alerta' ? 'vulneraveis' : 'todos';
}

/** A quem liga o agente, conforme a política. */
export function aLigar(
  destinatarios: readonly Destinatario[],
  politica: PoliticaChamadas,
): Destinatario[] {
  if (politica === 'nenhuma') return [];
  return destinatarios.filter(
    (d) => d.ligavel && (politica === 'todos' || d.vulneravel),
  );
}

export const esquemaRitmo = z.object({
  sms_por_minuto: z.number().int().min(1).max(6_000),
  chamadas_por_minuto: z.number().int().min(1).max(600),
});
export type Ritmo = z.output<typeof esquemaRitmo>;

/**
 * Quando sai o n-ésimo envio (0, 1, ...) a `porMinuto` por minuto, a começar
 * em `inicio`: os primeiros `porMinuto` já, os seguintes um minuto depois, e
 * assim por diante.
 */
export function instanteDoEnvio(
  n: number,
  porMinuto: number,
  inicio: Date,
): Date {
  const minuto = Math.floor(n / Math.max(1, porMinuto));
  return new Date(inicio.getTime() + minuto * 60_000);
}

/** Minutos para mandar `total` a `porMinuto` (0 se não houver nada). */
export function minutosParaEnviar(total: number, porMinuto: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total / Math.max(1, porMinuto));
}

export interface Plano {
  sms: { total: number; segmentos_por_sms: number; segmentos: number };
  chamadas: { total: number; politica: PoliticaChamadas };
  ritmo: Ritmo & { demonstracao: boolean };
  tempo: {
    /** Até ao último SMS sair. */
    minutos_sms: number;
    /** Até à última chamada terminar (ritmo + duração média). */
    minutos_chamadas: number;
    /** Até todos terem pelo menos um aviso (SMS ou chamada). */
    minutos_ate_todos_avisados: number;
  };
  custo: {
    moeda: string;
    sms: number;
    chamadas: number;
    total: number;
    precos: {
      sms_por_segmento: number;
      chamada_por_minuto: number;
      minutos_por_chamada: number;
    };
    demonstracao: true;
    nota: string;
  };
}

const centimos = (x: number) => Math.round(x * 100) / 100;

/**
 * O plano de envio: quantos SMS e chamadas, quanto tempo até todos
 * avisados e quanto custa (valores de demonstração).
 */
export function planear(e: {
  destinatarios: readonly Destinatario[];
  politica: PoliticaChamadas;
  segmentosPorSms: number;
  ritmo: Ritmo;
  ritmoDemonstracao: boolean;
}): Plano {
  const sms = e.destinatarios.filter((d) => d.sms).length;
  const ligar = aLigar(e.destinatarios, e.politica);
  const chamadas = ligar.length;
  const p = PRECOS_DEMONSTRACAO;
  const minutosSms = minutosParaEnviar(sms, e.ritmo.sms_por_minuto);
  const minutosChamadas = chamadas
    ? minutosParaEnviar(chamadas, e.ritmo.chamadas_por_minuto) +
      p.minutos_por_chamada
    : 0;
  // Quem só tem telefone fixo é avisado pela chamada (se for ligado).
  const soChamada = ligar.filter((d) => !d.sms).length;
  const minutosSoChamada = soChamada
    ? minutosParaEnviar(chamadas, e.ritmo.chamadas_por_minuto) +
      p.minutos_por_chamada
    : 0;
  const custoSms = sms * e.segmentosPorSms * p.sms_por_segmento;
  const custoChamadas = chamadas * p.minutos_por_chamada * p.chamada_por_minuto;
  return {
    sms: {
      total: sms,
      segmentos_por_sms: e.segmentosPorSms,
      segmentos: sms * e.segmentosPorSms,
    },
    chamadas: { total: chamadas, politica: e.politica },
    ritmo: { ...e.ritmo, demonstracao: e.ritmoDemonstracao },
    tempo: {
      minutos_sms: minutosSms,
      minutos_chamadas: minutosChamadas,
      minutos_ate_todos_avisados: Math.max(minutosSms, minutosSoChamada),
    },
    custo: {
      moeda: p.moeda,
      sms: centimos(custoSms),
      chamadas: centimos(custoChamadas),
      total: centimos(custoSms + custoChamadas),
      precos: {
        sms_por_segmento: p.sms_por_segmento,
        chamada_por_minuto: p.chamada_por_minuto,
        minutos_por_chamada: p.minutos_por_chamada,
      },
      demonstracao: true,
      nota: p.nota,
    },
  };
}

// ---------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------

const PREFIXO: Record<Gravidade, string> = {
  aviso: 'AVISO',
  alerta: 'ALERTA',
  emergencia: 'EMERGENCIA',
};

/**
 * O SMS: "EMERGENCIA - CM Guimarães: <mensagem> <instruções> Emergência: 112".
 * Conta as partes como sai (o envio tira os acentos que não cabem em GSM-7).
 */
export function textoSmsEmergencia(e: {
  municipio: string;
  gravidade: Gravidade;
  mensagem: string;
  instrucoes?: string | null;
  numero: string;
}): { texto: string } & InfoSms {
  const limpar = (x: string) => {
    const t = x.trim().replace(/\s+/g, ' ');
    return t && !/[.!?]$/.test(t) ? `${t}.` : t;
  };
  const partes = [
    `${PREFIXO[e.gravidade]} - CM ${e.municipio}:`,
    limpar(e.mensagem),
    e.instrucoes ? limpar(e.instrucoes) : '',
    `Emergencia: ${e.numero}`,
  ].filter(Boolean);
  const texto = partes.join(' ');
  return { texto, ...infoSms(transliterar(texto)) };
}

/** O que o agente diz e pergunta, por tipo (a câmara pode mudar tudo). */
export const GUIOES: Record<TipoEmergencia, Guiao & { instrucoes: string }> = {
  cheia: {
    dizer:
      'Estamos a ligar da câmara por causa do risco de cheia na sua zona. Afaste-se das margens do rio, não atravesse ruas alagadas e suba para um andar alto se a água entrar em casa.',
    perguntas: [
      'Está em segurança neste momento?',
      'Precisa de ajuda para sair de casa?',
      'Há alguém consigo que precise de cuidados?',
    ],
    instrucoes:
      'Afaste-se do rio e das zonas baixas. Não atravesse ruas alagadas.',
  },
  incendio: {
    dizer:
      'Estamos a ligar da câmara por causa de um incêndio perto da sua zona. Feche portas e janelas e esteja pronto para sair se as autoridades o pedirem.',
    perguntas: [
      'Está em segurança neste momento?',
      'Precisa de ajuda para sair de casa?',
      'Há alguém consigo que precise de cuidados?',
    ],
    instrucoes:
      'Feche portas e janelas. Se mandarem sair, siga as indicações da GNR e dos bombeiros.',
  },
  corte_agua: {
    dizer:
      'Estamos a ligar da câmara por causa de um corte prolongado de água na sua zona. Vamos distribuir água a quem precisar.',
    perguntas: [
      'Está tudo bem consigo?',
      'Tem água para beber e para a higiene?',
      'Precisa que lhe levemos água a casa?',
    ],
    instrucoes: 'Há água para levantar nos pontos indicados pela câmara.',
  },
  calor_extremo: {
    dizer:
      'Estamos a ligar da câmara por causa do calor extremo destes dias. Beba água, feche as persianas e evite sair entre as 11h e as 17h.',
    perguntas: [
      'Está em segurança e sente-se bem?',
      'Tem água fresca e consegue manter a casa fresca?',
      'Precisa de ajuda ou de transporte para um espaço climatizado?',
    ],
    instrucoes:
      'Beba água, evite sair entre as 11h e as 17h e procure um espaço fresco.',
  },
  outro: {
    dizer:
      'Estamos a ligar da câmara por causa de uma situação de emergência na sua zona.',
    perguntas: [
      'Está em segurança neste momento?',
      'Precisa de ajuda para sair de casa?',
    ],
    instrucoes: 'Siga as indicações das autoridades.',
  },
};

// ---------------------------------------------------------------------
// Resultado de cada pessoa
// ---------------------------------------------------------------------

export const RESULTADOS = [
  'por_avisar',
  'avisado',
  'a_ligar',
  'em_seguranca',
  'precisa_ajuda',
  'nao_atendeu',
  'sem_aviso',
] as const;
export type Resultado = (typeof RESULTADOS)[number];

/**
 * O resultado de uma pessoa a partir da resposta gravada, do estado da
 * chamada (campanha) e do SMS. A resposta ao agente manda sempre.
 */
export function resultadoDe(e: {
  resposta: 'em_seguranca' | 'precisa_ajuda' | null;
  /** Estado em `campanha_destinatarios` (null = não é ligado). */
  chamada: string | null;
  /** Estado do SMS em `mensagens_saida` (null = sem SMS). */
  sms: string | null;
}): Resultado {
  if (e.resposta) return e.resposta;
  if (e.chamada === 'precisa_ajuda') return 'precisa_ajuda';
  if (e.chamada === 'bem') return 'em_seguranca';
  const smsSaiu = e.sms === 'enviada' || e.sms === 'entregue';
  if (e.chamada === 'a_ligar' || e.chamada === 'por_ligar') {
    return smsSaiu ? 'avisado' : 'a_ligar';
  }
  if (
    e.chamada === 'nao_atendeu' ||
    e.chamada === 'sem_ligacao' ||
    e.chamada === 'recusou'
  ) {
    return 'nao_atendeu';
  }
  if (e.chamada === 'atendeu') return 'avisado';
  if (smsSaiu) return 'avisado';
  if (e.sms === 'falhou' && !e.chamada) return 'sem_aviso';
  if (e.chamada === 'cancelado' && !smsSaiu) return 'sem_aviso';
  return 'por_avisar';
}

/** As contagens do painel em tempo real. */
export function contarResultados(
  rs: readonly Resultado[],
): Record<Resultado, number> & { total: number; avisados: number } {
  const c = Object.fromEntries(RESULTADOS.map((r) => [r, 0])) as Record<
    Resultado,
    number
  >;
  for (const r of rs) c[r]++;
  return {
    ...c,
    total: rs.length,
    avisados: c.avisado + c.em_seguranca + c.precisa_ajuda + c.nao_atendeu,
  };
}

export const AJUDAS = [
  'sair_de_casa',
  'transporte',
  'saude',
  'agua',
  'abrigo',
  'medicamentos',
  'outro',
] as const;
export type Ajuda = (typeof AJUDAS)[number];

/** As ajudas da emergência nas necessidades da campanha (módulo campanhas). */
export function necessidadesCampanha(ajudas: readonly Ajuda[]): string[] {
  const m: Record<Ajuda, string> = {
    sair_de_casa: 'transporte',
    transporte: 'transporte',
    saude: 'saude',
    agua: 'agua',
    abrigo: 'outro',
    medicamentos: 'medicamentos',
    outro: 'outro',
  };
  return [...new Set(ajudas.map((a) => m[a]))];
}

/** Para a amostra do painel: nunca nomes nem números inteiros. */
export { mascararNome };
