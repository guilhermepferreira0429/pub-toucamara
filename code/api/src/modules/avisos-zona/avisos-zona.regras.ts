/*
 * Regras puras dos avisos por zona (sem BD nem rede): a zona (círculos,
 * polígono, ruas), a normalização dos nomes das ruas, quem conta como
 * afetado, a janela horária e o texto do SMS. Testadas em
 * avisos-zona.regras.spec.ts.
 *
 * Decisões:
 * - Zona por ruas: cada rua é geocodificada ao centro e conta um raio à volta
 *   (150 m por omissão); e, como as ruas compridas saem do raio, qualquer
 *   morada com o mesmo nome de rua (normalizado) também conta, com ou sem
 *   coordenadas.
 * - Zona por ponto + raio ou por polígono: só moradas com coordenadas.
 * - Afetado: munícipe com pelo menos uma morada na zona, telefone para SMS
 *   (telemóvel português 91/92/93/96 ou estrangeiro válido), não
 *   anonimizado e sem opt-out (`aceita_avisos`). Um SMS por pessoa: junta
 *   por munícipe e por telefone.
 * - Emergência ('emergencia'): ignora o opt-out (é segurança: incêndio,
 *   cheia, corte de água) e vai já, a qualquer hora. Os outros só das 9h às
 *   21h no fuso do município; fora disso, no início do período seguinte.
 */
import { z } from 'zod';
import { instanteLocal, local } from '../chamadas-saida/regras.js';
import { normalizarTelefone } from '../municipes/municipes.service.js';
import { infoSms, InfoSms } from '../comunicacao/sms.js';
import {
  caixaEnvolvente,
  distanciaMetros,
} from '../ocorrencias/ocorrencias.regras.js';

export const TIPOS_AVISO = [
  'obras',
  'agua',
  'residuos',
  'transito',
  'emergencia',
  'outro',
] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

export const ESTADOS_AVISO = [
  'rascunho',
  'agendado',
  'a_enviar',
  'enviado',
  'cancelado',
] as const;
export type EstadoAviso = (typeof ESTADOS_AVISO)[number];

export const ORIGENS = [
  'processo',
  'ocorrencia',
  'recolha',
  'requerimento',
] as const;
export type Origem = (typeof ORIGENS)[number];

export const HORA_INICIO = 9;
export const HORA_FIM = 21;
/** Destinatários por aviso sem perfil interno (admin, equipa_toucamara). */
export const MAX_DESTINATARIOS = 5_000;
export const RAIO_RUA_M = 150;
/** Moradas dos últimos 12 meses, por omissão. */
export const JANELA_MORADAS_DIAS = 365;
export const MAX_SEGMENTOS = 4;
export const VALIDADE_LINK_DIAS = 90;

// ---------------------------------------------------------------------
// Zona
// ---------------------------------------------------------------------

export interface Ponto {
  lat: number;
  lng: number;
}

const esquemaPonto = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const esquemaZona = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('ruas'),
    ruas: z.array(z.string().trim().min(3).max(150)).min(1).max(10),
    raio_m: z.number().int().min(20).max(2_000).default(RAIO_RUA_M),
    descricao: z.string().trim().min(3).max(200).optional(),
  }),
  z.object({
    tipo: z.literal('ponto'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    raio_m: z.number().int().min(10).max(10_000),
    descricao: z.string().trim().min(3).max(200).optional(),
  }),
  z.object({
    tipo: z.literal('poligono'),
    pontos: z.array(esquemaPonto).min(3).max(200),
    descricao: z.string().trim().min(3).max(200).optional(),
  }),
]);
export type Zona = z.output<typeof esquemaZona>;

/** A zona pronta a testar pontos e moradas (o que fica em `geometria`). */
export interface Geometria {
  circulos: (Ponto & { raio_m: number })[];
  poligono: Ponto[] | null;
  /** Nomes normalizados (normalizarRua): moradas com o mesmo nome contam. */
  ruas: string[];
  /** Ruas que a geocodificação não encontrou (só pelo nome). */
  ruas_sem_coordenadas: string[];
}

/**
 * Ponto dentro de um polígono simples (lat/lng como plano: a escala de uma
 * cidade não precisa de mais). Ray casting; a fronteira pode cair de
 * qualquer lado.
 */
export function pontoNoPoligono(p: Ponto, poligono: readonly Ponto[]): boolean {
  if (poligono.length < 3) return false;
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i];
    const b = poligono[j];
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng
    ) {
      dentro = !dentro;
    }
  }
  return dentro;
}

export function dentroDoRaio(p: Ponto, centro: Ponto, raioM: number): boolean {
  return distanciaMetros(p, centro) <= raioM;
}

/** As coordenadas caem na zona? */
export function pontoNaZona(p: Ponto, g: Geometria): boolean {
  return (
    g.circulos.some((c) => dentroDoRaio(p, c, c.raio_m)) ||
    (g.poligono !== null && pontoNoPoligono(p, g.poligono))
  );
}

/** A morada (texto) é de uma das ruas da zona? */
export function moradaNaZona(morada: string, g: Geometria): boolean {
  if (!g.ruas.length) return false;
  const rua = normalizarRua(morada);
  return rua.length > 0 && g.ruas.includes(rua);
}

/** Caixa que contém a zona toda (filtro do SQL); null = sem coordenadas. */
export function caixaDaZona(
  g: Geometria,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  const caixas = g.circulos.map((c) => caixaEnvolvente(c, c.raio_m));
  if (g.poligono?.length) {
    caixas.push({
      minLat: Math.min(...g.poligono.map((p) => p.lat)),
      maxLat: Math.max(...g.poligono.map((p) => p.lat)),
      minLng: Math.min(...g.poligono.map((p) => p.lng)),
      maxLng: Math.max(...g.poligono.map((p) => p.lng)),
    });
  }
  if (!caixas.length) return null;
  return {
    minLat: Math.min(...caixas.map((c) => c.minLat)),
    maxLat: Math.max(...caixas.map((c) => c.maxLat)),
    minLng: Math.min(...caixas.map((c) => c.minLng)),
    maxLng: Math.max(...caixas.map((c) => c.maxLng)),
  };
}

/** A zona pedida → geometria, com as coordenadas das ruas já procuradas. */
export function geometriaDaZona(
  zona: Zona,
  centrosDasRuas: ReadonlyMap<string, Ponto | null> = new Map(),
): Geometria {
  switch (zona.tipo) {
    case 'ponto':
      return {
        circulos: [{ lat: zona.lat, lng: zona.lng, raio_m: zona.raio_m }],
        poligono: null,
        ruas: [],
        ruas_sem_coordenadas: [],
      };
    case 'poligono':
      return {
        circulos: [],
        poligono: zona.pontos.map((p) => ({ lat: p.lat, lng: p.lng })),
        ruas: [],
        ruas_sem_coordenadas: [],
      };
    case 'ruas': {
      const circulos: Geometria['circulos'] = [];
      const sem: string[] = [];
      for (const rua of zona.ruas) {
        const c = centrosDasRuas.get(rua);
        if (c) circulos.push({ lat: c.lat, lng: c.lng, raio_m: zona.raio_m });
        else sem.push(rua);
      }
      return {
        circulos,
        poligono: null,
        ruas: [
          ...new Set(zona.ruas.map(normalizarRua).filter((r) => r.length)),
        ],
        ruas_sem_coordenadas: sem,
      };
    }
  }
}

/** A zona em palavras, para a página pública e o painel. */
export function descreverZona(zona: Zona): string {
  if (zona.descricao) return zona.descricao;
  switch (zona.tipo) {
    case 'ruas':
      return juntarComE(zona.ruas.map((r) => ruaDaMorada(r) || r));
    case 'ponto':
      return `Num raio de ${formatarMetros(zona.raio_m)} à volta do local indicado no mapa`;
    case 'poligono':
      return 'Na área marcada no mapa';
  }
}

function formatarMetros(m: number): string {
  return m >= 1_000
    ? `${String(Math.round(m / 100) / 10).replace('.', ',')} km`
    : `${m} m`;
}

/** ['A', 'B', 'C'] → 'A, B e C'. */
export function juntarComE(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

// ---------------------------------------------------------------------
// Ruas
// ---------------------------------------------------------------------

const LIGACOES = new Set(['de', 'do', 'da', 'dos', 'das']);
const NUMERO_PORTA = /^\d+[a-z]?([-/]\d*[a-z]?)?$/i;

/**
 * A rua de uma morada, sem número de porta nem o resto: 'Rua Direita, 45,
 * 2.º Esq.' → 'Rua Direita'; 'Rua 25 de Abril 12' → 'Rua 25 de Abril'
 * (um número seguido de "de" é parte do nome). Mantém maiúsculas e acentos:
 * é o que se mostra.
 */
export function ruaDaMorada(morada: string): string {
  let t = morada.split(/[,(;\n]/)[0] ?? '';
  // 'n.º 45', 'nº45', 'n. 45', 'número 45' e o que vem depois.
  t = t.replace(/\s(n\.?\s*[º°o]\.?|n\.|num\.?|n[úu]mero)\s*\d.*$/i, '');
  const partes = t.trim().split(/\s+/);
  for (let i = 1; i < partes.length; i++) {
    const seguinte = (partes[i + 1] ?? '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    if (NUMERO_PORTA.test(partes[i]) && !LIGACOES.has(seguinte)) {
      partes.length = i;
      break;
    }
  }
  return partes
    .join(' ')
    .replace(/[\s\-–,.]+$/, '')
    .trim();
}

/** Abreviaturas do tipo de via (só a primeira palavra). */
const ABREVIATURAS: Record<string, string> = {
  r: 'rua',
  av: 'avenida',
  avd: 'avenida',
  avda: 'avenida',
  tv: 'travessa',
  trav: 'travessa',
  lg: 'largo',
  lgo: 'largo',
  pc: 'praca',
  pca: 'praca',
  pr: 'praca',
  estr: 'estrada',
  est: 'estrada',
  al: 'alameda',
  bc: 'beco',
  cc: 'calcada',
  urb: 'urbanizacao',
  qta: 'quinta',
};

/**
 * Para comparar ruas: 'R. Dr. José Sá, 45' → 'rua dr jose sa'. Sem acentos,
 * minúsculas, sem pontuação, sem número de porta, "R." = "Rua",
 * "Av." = "Avenida" (e outras abreviaturas do tipo de via) e sem "na"/"no"
 * no início ("na Rua Direita").
 */
export function normalizarRua(texto: string): string {
  const palavras = ruaDaMorada(texto)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (palavras.length > 1 && ['na', 'no', 'em'].includes(palavras[0])) {
    palavras.shift();
  }
  if (palavras.length) palavras[0] = ABREVIATURAS[palavras[0]] ?? palavras[0];
  return palavras.join(' ');
}

const TIPOS_DE_VIA = new Set([...Object.values(ABREVIATURAS), 'de', 'do']);

/**
 * A palavra mais distintiva do nome (a mais comprida que não é o tipo de
 * via): o SQL só traz moradas sem coordenadas que a contenham.
 */
export function palavraChave(ruaNormalizada: string): string | null {
  const p = ruaNormalizada
    .split(' ')
    .filter((x) => x.length >= 3 && !TIPOS_DE_VIA.has(x));
  if (!p.length) return null;
  return p.reduce((a, b) => (b.length > a.length ? b : a));
}

// ---------------------------------------------------------------------
// Quem é afetado
// ---------------------------------------------------------------------

/** Telefone para onde se manda SMS: telemóvel português ou estrangeiro válido. */
export function telefoneParaSms(e164: string | null | undefined): boolean {
  if (!e164) return false;
  if (e164.startsWith('+351')) return /^\+3519[1236]\d{7}$/.test(e164);
  return /^\+\d{8,15}$/.test(e164) && normalizarTelefone(e164) === e164;
}

/** Uma morada encontrada (de um processo, ocorrência...) e o seu munícipe. */
export interface MoradaMunicipe {
  origem: Origem;
  municipe_id: string;
  morada: string | null;
  lat: number | null;
  lng: number | null;
  telefone_e164: string | null;
  nome: string | null;
  aceita_avisos: boolean;
  anonimizado: boolean;
}

export interface Afetado {
  municipe_id: string;
  telefone_e164: string;
  nome: string | null;
  origens: Origem[];
  /** Só a rua (sem número), para a amostra do painel. */
  rua: string | null;
}

export interface Excluidos {
  sem_telefone: number;
  recusaram_avisos: number;
  anonimizados: number;
}

/** A morada cai na zona (pelas coordenadas ou pelo nome da rua)? */
export function moradaAfetada(m: MoradaMunicipe, g: Geometria): boolean {
  if (
    m.lat != null &&
    m.lng != null &&
    pontoNaZona({ lat: m.lat, lng: m.lng }, g)
  )
    return true;
  return m.morada != null && moradaNaZona(m.morada, g);
}

/**
 * As moradas na zona → uma linha por pessoa: junta por munícipe e depois
 * por telefone (dois registos com o mesmo número recebem um SMS). Conta
 * quem fica de fora e porquê (cada munícipe uma vez, pela primeira razão).
 */
export function deduplicar(
  moradas: readonly MoradaMunicipe[],
  opcoes: { ignorarRecusa: boolean },
): { afetados: Afetado[]; excluidos: Excluidos } {
  const excluidos: Excluidos = {
    sem_telefone: 0,
    recusaram_avisos: 0,
    anonimizados: 0,
  };
  const vistos = new Set<string>();
  const porTelefone = new Map<string, Afetado>();
  const porMunicipe = new Map<string, Afetado>();
  for (const m of moradas) {
    const ja = porMunicipe.get(m.municipe_id);
    if (ja) {
      if (!ja.origens.includes(m.origem)) ja.origens.push(m.origem);
      continue;
    }
    if (vistos.has(m.municipe_id)) continue;
    vistos.add(m.municipe_id);
    if (m.anonimizado) {
      excluidos.anonimizados++;
      continue;
    }
    if (!telefoneParaSms(m.telefone_e164)) {
      excluidos.sem_telefone++;
      continue;
    }
    if (!m.aceita_avisos && !opcoes.ignorarRecusa) {
      excluidos.recusaram_avisos++;
      continue;
    }
    const tel = m.telefone_e164 as string;
    const outro = porTelefone.get(tel);
    if (outro) {
      if (!outro.origens.includes(m.origem)) outro.origens.push(m.origem);
      porMunicipe.set(m.municipe_id, outro);
      continue;
    }
    const a: Afetado = {
      municipe_id: m.municipe_id,
      telefone_e164: tel,
      nome: m.nome,
      origens: [m.origem],
      rua: m.morada ? ruaDaMorada(m.morada) || null : null,
    };
    porTelefone.set(tel, a);
    porMunicipe.set(m.municipe_id, a);
  }
  const afetados = [...porTelefone.values()];
  for (const a of afetados) a.origens.sort();
  return { afetados, excluidos };
}

/** Quantos afetados têm cada origem (uma pessoa pode contar em várias). */
export function contarPorOrigem(
  afetados: readonly Afetado[],
): Record<Origem, number> {
  const r = Object.fromEntries(ORIGENS.map((o) => [o, 0])) as Record<
    Origem,
    number
  >;
  for (const a of afetados) for (const o of a.origens) r[o]++;
  return r;
}

/** 'Maria da Silva' → 'M. S.' (a amostra do painel nunca leva nomes inteiros). */
export function mascararNome(nome: string | null | undefined): string {
  const p = (nome ?? '')
    .trim()
    .split(/\s+/)
    .filter((x) => x && x !== 'e' && !LIGACOES.has(x.toLowerCase()));
  if (!p.length) return '—';
  const ini = (x: string) => `${x[0].toUpperCase()}.`;
  return p.length === 1 ? ini(p[0]) : `${ini(p[0])} ${ini(p[p.length - 1])}`;
}

// ---------------------------------------------------------------------
// Horário
// ---------------------------------------------------------------------

/** `em` está entre as 9h e as 21h no fuso do município? */
export function dentroDaJanela(em: Date, fuso: string): boolean {
  const l = local(em, fuso);
  return l.hora >= HORA_INICIO && l.hora < HORA_FIM;
}

/** `em`, se já se pode enviar; senão as 9h seguintes (no fuso). */
export function proximaJanela(em: Date, fuso: string): Date {
  if (dentroDaJanela(em, fuso)) return em;
  const l = local(em, fuso);
  let dia = l.dia;
  if (l.hora >= HORA_FIM) {
    const d = new Date(`${dia}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    dia = d.toISOString().slice(0, 10);
  }
  return instanteLocal(dia, HORA_INICIO, fuso);
}

/**
 * Quando sai o aviso: emergência no momento pedido (ou já), a qualquer
 * hora; os outros no pedido (ou já), empurrado para dentro da janela.
 */
export function quandoEnviar(e: {
  tipo: TipoAviso;
  pedido: Date | null;
  agora: Date;
  fuso: string;
}): Date {
  const base =
    e.pedido && e.pedido.getTime() > e.agora.getTime() ? e.pedido : e.agora;
  return e.tipo === 'emergencia' ? base : proximaJanela(base, e.fuso);
}

// ---------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------

/**
 * O texto do SMS: "CM <município>: <título>. <mensagem> Mais info / deixar de
 * receber: <link>". Emergência começa por "URGENTE". O título não se repete
 * se a mensagem já começar por ele.
 */
export function textoSms(e: {
  municipio: string;
  titulo: string;
  mensagem: string;
  url: string;
  tipo: TipoAviso;
}): { texto: string } & InfoSms {
  const titulo = e.titulo.trim().replace(/[.:!]+$/, '');
  const mensagem = e.mensagem.trim().replace(/\s+/g, ' ');
  const comTitulo = mensagem.toLowerCase().startsWith(titulo.toLowerCase())
    ? mensagem
    : `${titulo}. ${mensagem}`;
  const prefixo = e.tipo === 'emergencia' ? 'URGENTE - ' : '';
  const ponto = /[.!?]$/.test(comTitulo) ? '' : '.';
  const texto = `${prefixo}CM ${e.municipio}: ${comTitulo}${ponto} Mais info/deixar de receber: ${e.url}`;
  return { texto, ...infoSms(texto) };
}
