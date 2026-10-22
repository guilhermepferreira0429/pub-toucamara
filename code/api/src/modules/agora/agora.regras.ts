/*
 * "O que se passa no concelho, perto de mim": regras puras (sem BD nem rede),
 * testadas em agora.regras.spec.ts.
 *
 * - Normalização: cada fonte (licenças, avisos por zona, emergências,
 *   ocorrências, comunicados, eventos, consultas públicas) → um item igual
 *   para todos: {id, tipo, titulo, resumo, inicio, fim, lat, lng,
 *   raio_m|poligono, freguesia, rua, gravidade, link, fonte}.
 * - Privacidade: nenhum item leva quem reportou ou pediu. Moradas só com a
 *   rua (sem número de porta). Coordenadas das ocorrências arredondadas a
 *   ~100 m; as das licenças são do centro da rua (o job geocodifica só a rua).
 *   Festas privadas (licença de ruído) não aparecem; nos eventos com licença
 *   o titular só aparece se for uma entidade (associação, empresa, junta).
 * - Zona: distância (haversine) a círculos e polígonos; freguesias pelo nome.
 * - Ordem por relevância: proximidade + atualidade + gravidade.
 * - Subscrições "avise-me": que item novo bate em que subscrição.
 */
import { z } from 'zod';
import { transliterar, infoSms } from '../comunicacao/sms.js';
import { deduzirFreguesia } from '../consultas-publicas/regras.js';
import {
  dentroDaJanela,
  juntarComE,
  pontoNoPoligono,
  ruaDaMorada,
  type Ponto,
} from '../avisos-zona/avisos-zona.regras.js';
import { freguesiaNaLista } from '../emergencias/emergencias.regras.js';
import { somarDias } from '../licencas/comum.js';
import { EQUIPAMENTOS, type Equipamento } from '../licencas/regras-ocupacao.js';
import { diaLocal, horaLocal, instanteLocal } from '../marcacoes/vagas.js';
import { distanciaMetros } from '../ocorrencias/ocorrencias.regras.js';

export type { Ponto };

// ---------------------------------------------------------------------
// Tipos e parâmetros
// ---------------------------------------------------------------------

export const TIPOS_ITEM = [
  'obras',
  'incidentes',
  'avisos',
  'eventos',
  'consultas',
] as const;
export type TipoItem = (typeof TIPOS_ITEM)[number];

/** O que se pode subscrever ("avise-me"): as consultas não. */
export const TIPOS_SUBSCRICAO = [
  'obras',
  'incidentes',
  'eventos',
  'avisos',
] as const;
export type TipoSubscricao = (typeof TIPOS_SUBSCRICAO)[number];

export const FONTES_ITEM = [
  'licenca',
  'aviso_zona',
  'emergencia',
  'ocorrencia',
  'comunicado',
  'evento',
  'consulta_publica',
] as const;
export type FonteItem = (typeof FONTES_ITEM)[number];

export type Gravidade = 'aviso' | 'alerta' | 'emergencia';

export const ROTULOS_TIPO: Record<TipoItem, string> = {
  obras: 'obras e cortes',
  incidentes: 'incidentes',
  avisos: 'avisos e comunicados',
  eventos: 'eventos',
  consultas: 'consultas públicas',
};

/**
 * Parâmetros do feed. São escolhas de produto, não vêm de nenhuma regra
 * oficial: VALORES DE DEMONSTRAÇÃO, a afinar com cada câmara.
 */
export const PARAMETROS = {
  /** Raio "perto de mim" por omissão. */
  raio_omissao_m: 1_000,
  /** Raio de uma subscrição pela rua. */
  raio_subscricao_m: 300,
  /** Um aviso por zona fica no feed estes dias depois de enviado. */
  aviso_visivel_dias: 7,
  /** Ocorrências resolvidas ficam no feed estes dias. */
  ocorrencia_resolvida_dias: 7,
  /** Comunicados e notícias ficam no feed estes dias. */
  comunicado_visivel_dias: 30,
  /** Período por omissão: o que acabou há menos disto... */
  janela_passado_dias: 7,
  /** ...e o que começa antes disto. */
  janela_futuro_dias: 60,
  /** Um item conta como "novo" para as subscrições durante estas horas. */
  novos_horas: 48,
  /** No máximo isto de avisos por pessoa em cada corrida do job. */
  max_avisos_por_corrida: 3,
  demonstracao: true,
  nota: 'Valores de demonstração (raios, quanto tempo cada coisa fica no feed): escolhas do serviço, a confirmar com a câmara.',
} as const;

export interface Circulo extends Ponto {
  raio_m: number;
}

export interface ZonaItem {
  circulos: Circulo[];
  poligono: Ponto[] | null;
}

/** O item do feed, igual para todas as fontes. */
export interface ItemAgora {
  /** O id na fonte (uuid). */
  id: string;
  tipo: TipoItem;
  fonte: FonteItem;
  /** Rótulo curto para a app ("Ocupação da via", "Notícia"...). */
  etiqueta: string;
  titulo: string;
  resumo: string;
  inicio: string | null;
  fim: string | null;
  /** Quando apareceu (para as subscrições e a atualidade). */
  publicado_em: string;
  lat: number | null;
  lng: number | null;
  raio_m: number | null;
  poligono: Ponto[] | null;
  /** As freguesias juntas ("Azurém e Creixomil"), ou null. */
  freguesia: string | null;
  freguesias: string[] | null;
  /** Para todo o concelho (comunicados gerais, consultas de todo o concelho). */
  todo_concelho: boolean;
  /** Só a rua, nunca o número de porta. */
  rua: string | null;
  gravidade: Gravidade | null;
  link: string;
  imagem: string | null;
}

/** Com a geometria toda (vários círculos), que não sai na resposta. */
export interface ItemInterno extends ItemAgora {
  zona: ZonaItem;
}

export interface ContextoNormalizar {
  webUrl: string;
  slug: string;
  fuso: string;
  /** As freguesias que a câmara conhece (para as deduzir das moradas). */
  freguesias: readonly string[];
}

export function chaveItem(i: Pick<ItemAgora, 'fonte' | 'id'>): string {
  return `${i.fonte}:${i.id}`;
}

export function linkItem(
  c: ContextoNormalizar,
  tipo: TipoItem,
  id: string,
): string {
  return `${c.webUrl}/agora/${c.slug}/${tipo}/${id}`;
}

export function linkFeed(
  c: Pick<ContextoNormalizar, 'webUrl' | 'slug'>,
  freguesia?: string | null,
): string {
  const base = `${c.webUrl}/agora/${c.slug}`;
  return freguesia
    ? `${base}?freguesia=${encodeURIComponent(freguesia)}`
    : base;
}

// ---------------------------------------------------------------------
// Moradas sem dados pessoais
// ---------------------------------------------------------------------

/** "Rua 25 de Abril" fica; "Rua Direita 45" → "Rua Direita". */
const NUMERO_SOLTO =
  /(^|\s)\d+[a-z]?(?:[-/]\d+[a-z]?)?(?=\s|$)(?!\s+(de|do|da)\s)/gi;

const TIPO_DE_VIA =
  /(^|\s)(rua|r\.|avenida|av\.?|travessa|tv\.|largo|lg\.|pra[çc]a|estrada|alameda|beco|cal[çc]ada|rotunda|urbaniza[çc][ãa]o|bairro|caminho|viela)(?=\s)/i;

/**
 * Só a rua: 'Rua Direita, 45, 2.º Esq.' → 'Rua Direita'; "em frente ao n.º
 * 45 da Rua Direita" → 'Rua Direita'; tira também números soltos ("Rua
 * Direita 45"), mas não os do nome ("Rua 25 de Abril").
 */
export function semNumeroDePorta(
  morada: string | null | undefined,
): string | null {
  if (!morada?.trim()) return null;
  let t = morada.split(/[,(;\n]/)[0] ?? '';
  const via = TIPO_DE_VIA.exec(t);
  if (via && via.index + via[1].length > 0)
    t = t.slice(via.index + via[1].length);
  t = ruaDaMorada(t)
    .replace(/\bn\.?\s*[º°o]\.?\s*\d+\w*/gi, '')
    .replace(NUMERO_SOLTO, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–,.]+$/, '')
    .trim();
  return t.length >= 3 ? t : null;
}

/**
 * A morada para geocodificar sem número de porta: 'Rua Direita, 45, Azurém'
 * → 'Rua Direita, Azurém' (a freguesia ajuda a não cair noutra rua igual).
 */
export function moradaSemPorta(morada: string): string {
  const partes = morada.split(/[,;\n]/).map((p) => p.trim());
  const rua = semNumeroDePorta(partes[0] ?? '') ?? (partes[0] ?? '').trim();
  const resto = partes
    .slice(1)
    .filter(
      (p) =>
        p.length >= 3 &&
        !/\d/.test(p) &&
        !/^(r\/?c|cave|esq|dto|dir|frente|tr[aá]s)\b/i.test(p),
    );
  return [rua, ...resto].filter(Boolean).join(', ');
}

/** A freguesia de uma morada (e do que a geocodificação encontrou). */
export function freguesiaDaMorada(
  morada: string | null | undefined,
  candidatas: readonly string[],
  encontrada?: string | null,
): string | null {
  const texto = `${morada ?? ''} ${encontrada ?? ''}`.trim();
  if (!texto || !candidatas.length) return null;
  return deduzirFreguesia(texto, [...candidatas]);
}

const ENTIDADE =
  /\b(associa[çc][ãa]o|assoc\.|junta|c[âa]mara|clube|grupo|rancho|banda|comiss[ãa]o|confraria|irmandade|par[óo]quia|f[áa]brica da igreja|centro|escola|agrupamento|funda[çc][ãa]o|cooperativa|sociedade|uni[ãa]o|federa[çc][ãa]o|academia|col[ée]gio|universidade|instituto|santa casa|bombeiros|lda\.?|limitada|s\.?\s?a\.?|unipessoal|empresa|restaurante|caf[ée]|bar)\b/i;

/**
 * O titular é uma entidade (associação, empresa, junta...)? Só esses
 * aparecem no feed; uma pessoa singular nunca.
 */
export function pessoaColetiva(nome: string | null | undefined): boolean {
  return !!nome?.trim() && ENTIDADE.test(nome);
}

function arredondar(
  v: number | null | undefined,
  casas: number,
): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
}

/** '2026-10-31' → '31/10'. */
export function diaCurto(dia: string): string {
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** '2026-10-31' → '31 de outubro'. */
export function diaDito(dia: string): string {
  const [, m, d] = dia.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

function periodoCurto(de: string, ate: string): string {
  return de === ate ? diaCurto(de) : `De ${diaCurto(de)} a ${diaCurto(ate)}`;
}

function fimDoDia(dia: string, fuso: string): Date {
  return new Date(instanteLocal(dia, '23:59', fuso).getTime() + 59_000);
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cortar(t: string, max: number): string {
  const s = t.trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ---------------------------------------------------------------------
// Zona
// ---------------------------------------------------------------------

const SEM_ZONA: ZonaItem = { circulos: [], poligono: null };

function zonaDePonto(
  lat: number | null,
  lng: number | null,
  raio = 0,
): ZonaItem {
  return lat === null || lng === null
    ? SEM_ZONA
    : { circulos: [{ lat, lng, raio_m: raio }], poligono: null };
}

/** O resumo da zona para a resposta: o primeiro círculo, ou o polígono. */
function camposDaZona(
  z: ZonaItem,
): Pick<ItemAgora, 'lat' | 'lng' | 'raio_m' | 'poligono'> {
  if (z.circulos.length) {
    const c = z.circulos[0];
    return { lat: c.lat, lng: c.lng, raio_m: c.raio_m || null, poligono: null };
  }
  if (z.poligono?.length) {
    const n = z.poligono.length;
    return {
      lat: arredondar(z.poligono.reduce((s, p) => s + p.lat, 0) / n, 6),
      lng: arredondar(z.poligono.reduce((s, p) => s + p.lng, 0) / n, 6),
      raio_m: null,
      poligono: z.poligono,
    };
  }
  return { lat: null, lng: null, raio_m: null, poligono: null };
}

/**
 * Distância (m) de um ponto à zona do item: 0 dentro de um círculo ou do
 * polígono; senão até à borda mais perto (para o polígono, até ao vértice
 * mais perto: chega à escala de uma rua). null = o item não tem geometria.
 */
export function distanciaAZona(p: Ponto, z: ZonaItem): number | null {
  const ds: number[] = z.circulos.map((c) =>
    Math.max(0, distanciaMetros(p, c) - c.raio_m),
  );
  if (z.poligono && z.poligono.length >= 3) {
    ds.push(
      pontoNoPoligono(p, z.poligono)
        ? 0
        : Math.min(...z.poligono.map((v) => distanciaMetros(p, v))),
    );
  }
  return ds.length ? Math.round(Math.min(...ds)) : null;
}

// ---------------------------------------------------------------------
// Normalização: uma função por fonte
// ---------------------------------------------------------------------

function base(
  c: ContextoNormalizar,
  x: {
    id: string;
    tipo: TipoItem;
    fonte: FonteItem;
    etiqueta: string;
    titulo: string;
    resumo: string;
    inicio: Date | string | null;
    fim: Date | string | null;
    publicado_em: Date | string | null;
    zona: ZonaItem;
    freguesias: string[] | null;
    todo_concelho?: boolean;
    rua: string | null;
    gravidade?: Gravidade | null;
    link?: string | null;
    imagem?: string | null;
  },
): ItemInterno {
  const fregs = x.freguesias?.filter((f) => f?.trim()) ?? null;
  return {
    id: x.id,
    tipo: x.tipo,
    fonte: x.fonte,
    etiqueta: x.etiqueta,
    titulo: cortar(x.titulo, 140),
    resumo: cortar(x.resumo, 400),
    inicio: iso(x.inicio),
    fim: iso(x.fim),
    publicado_em:
      iso(x.publicado_em) ?? iso(x.inicio) ?? new Date(0).toISOString(),
    ...camposDaZona(x.zona),
    freguesia: fregs?.length ? juntarComE(fregs) : null,
    freguesias: fregs?.length ? fregs : null,
    todo_concelho: x.todo_concelho ?? false,
    rua: x.rua,
    gravidade: x.gravidade ?? null,
    link: x.link || linkItem(c, x.tipo, x.id),
    imagem: x.imagem ?? null,
    zona: x.zona,
  };
}

export interface LinhaLicenca {
  id: string;
  tipo: string;
  dados: Record<string, unknown>;
  decidida_em: Date | null;
  /** Nome do titular (dados.nome ou o munícipe): só sai se for entidade. */
  titular: string | null;
  local_lat: number | null;
  local_lng: number | null;
  local_freguesia: string | null;
}

/**
 * Licenças emitidas: ocupação da via (andaime, contentor...) → obras;
 * recinto improvisado e ruído de evento → eventos; ruído de obra → obras.
 * Festas privadas e as outras licenças (esplanada, dístico, publicidade)
 * não entram.
 */
export function normalizarLicenca(
  l: LinhaLicenca,
  c: ContextoNormalizar,
): ItemInterno | null {
  const d = l.dados;
  const morada = texto(d.morada);
  const rua = semNumeroDePorta(morada);
  const freguesia =
    l.local_freguesia ?? freguesiaDaMorada(morada, c.freguesias);
  const zona = zonaDePonto(l.local_lat, l.local_lng);
  const organizador =
    pessoaColetiva(l.titular) && l.titular
      ? ` Organização: ${cortar(l.titular, 80)}.`
      : '';
  const comum = {
    id: l.id,
    fonte: 'licenca' as const,
    publicado_em: l.decidida_em,
    zona,
    freguesias: freguesia ? [freguesia] : null,
    rua,
  };

  if (l.tipo === 'ocupacao_via') {
    const inicio = texto(d.data_inicio);
    const dias = numero(d.dias) ?? 1;
    if (!inicio) return null;
    const fim = somarDias(inicio, Math.max(1, dias) - 1);
    const eq = EQUIPAMENTOS[d.equipamento as Equipamento] ?? 'Ocupação';
    const passeio = numero(d.passeio_livre_m);
    const partes = [
      periodoCurto(inicio, fim),
      d.ocupa_estrada === true ? 'ocupa parte da estrada' : null,
      passeio !== null
        ? `passeio livre: ${String(passeio).replace('.', ',')} m`
        : null,
    ].filter(Boolean);
    return base(c, {
      ...comum,
      tipo: 'obras',
      etiqueta: 'Ocupação da via',
      titulo: `${eq} na via pública`,
      resumo: `${partes.join('; ')}.`,
      inicio: instanteLocal(inicio, '00:00', c.fuso),
      fim: fimDoDia(fim, c.fuso),
    });
  }

  if (l.tipo === 'recinto_improvisado') {
    const inicio = texto(d.data_inicio);
    const dias = numero(d.dias) ?? 1;
    if (!inicio) return null;
    const fim = somarDias(inicio, Math.max(1, dias) - 1);
    const lotacao = numero(d.lotacao);
    const partes = [
      periodoCurto(inicio, fim),
      lotacao ? `até ${lotacao} pessoas` : null,
      d.musica === true ? 'com música' : null,
    ].filter(Boolean);
    return base(c, {
      ...comum,
      tipo: 'eventos',
      etiqueta: 'Evento',
      titulo: 'Arraial ou festa ao ar livre',
      resumo: `${partes.join('; ')}.${organizador}`,
      inicio: instanteLocal(inicio, '00:00', c.fuso),
      fim: fimDoDia(fim, c.fuso),
    });
  }

  if (l.tipo === 'ruido') {
    const atividade = texto(d.atividade);
    const dia = texto(d.data);
    const hi = texto(d.hora_inicio) ?? '00:00';
    const hf = texto(d.hora_fim) ?? '23:59';
    if (!dia || (atividade !== 'evento' && atividade !== 'obra')) return null;
    const diaFim = hf <= hi ? somarDias(dia, 1) : dia;
    const horas = `${diaCurto(dia)}, das ${hi} às ${hf}`;
    return base(c, {
      ...comum,
      tipo: atividade === 'obra' ? 'obras' : 'eventos',
      etiqueta: atividade === 'obra' ? 'Obra com ruído' : 'Evento',
      titulo:
        atividade === 'obra'
          ? 'Obra com ruído fora de horas'
          : d.musica_amplificada === true
            ? 'Evento com música'
            : 'Evento aberto ao público',
      resumo: `${horas}.${atividade === 'evento' ? organizador : ''}`,
      inicio: instanteLocal(dia, hi, c.fuso),
      fim: instanteLocal(diaFim, hf, c.fuso),
    });
  }
  return null;
}

export interface LinhaAvisoZona {
  id: string;
  titulo: string;
  mensagem: string;
  tipo: string;
  zona: { tipo?: string; ruas?: string[] } | null;
  geometria: { circulos?: Circulo[]; poligono?: Ponto[] | null } | null;
  zona_descricao: string;
  agendado_para: Date | null;
  confirmado_em: Date | null;
}

const TIPO_AVISO: Record<string, { tipo: TipoItem; etiqueta: string }> = {
  obras: { tipo: 'obras', etiqueta: 'Obras' },
  transito: { tipo: 'obras', etiqueta: 'Trânsito condicionado' },
  agua: { tipo: 'avisos', etiqueta: 'Água' },
  residuos: { tipo: 'avisos', etiqueta: 'Recolha do lixo' },
  emergencia: { tipo: 'avisos', etiqueta: 'Emergência' },
  outro: { tipo: 'avisos', etiqueta: 'Aviso' },
};

/** Avisos por zona enviados: visíveis uns dias depois do envio. */
export function normalizarAvisoZona(
  a: LinhaAvisoZona,
  c: ContextoNormalizar,
): ItemInterno {
  const t = TIPO_AVISO[a.tipo] ?? TIPO_AVISO.outro;
  const inicio = a.agendado_para ?? a.confirmado_em ?? new Date();
  const zona: ZonaItem = {
    circulos: a.geometria?.circulos ?? [],
    poligono: a.geometria?.poligono?.length ? a.geometria.poligono : null,
  };
  return base(c, {
    id: a.id,
    tipo: t.tipo,
    fonte: 'aviso_zona',
    etiqueta: t.etiqueta,
    titulo: a.titulo,
    resumo: a.mensagem,
    inicio,
    fim: new Date(
      inicio.getTime() + PARAMETROS.aviso_visivel_dias * 86_400_000,
    ),
    publicado_em: inicio,
    zona,
    freguesias: null,
    rua: a.zona?.tipo === 'ruas' ? a.zona_descricao : null,
    gravidade: a.tipo === 'emergencia' ? 'emergencia' : null,
  });
}

export interface LinhaEmergencia {
  id: string;
  tipo: string;
  gravidade: Gravidade;
  titulo: string;
  mensagem_sms: string;
  instrucoes: string;
  geometria: {
    geo: { circulos?: Circulo[]; poligono?: Ponto[] | null } | null;
    freguesias: string[] | null;
  } | null;
  zona_descricao: string;
  enviada_em: Date | null;
  valida_ate: Date;
}

/** Emergências ativas: aparecem sempre, à frente de tudo. */
export function normalizarEmergencia(
  e: LinhaEmergencia,
  c: ContextoNormalizar,
): ItemInterno {
  const geo = e.geometria?.geo ?? null;
  const zona: ZonaItem = {
    circulos: geo?.circulos ?? [],
    poligono: geo?.poligono?.length ? geo.poligono : null,
  };
  const freguesias = e.geometria?.freguesias ?? null;
  return base(c, {
    id: e.id,
    tipo: 'avisos',
    fonte: 'emergencia',
    etiqueta: 'Emergência',
    titulo: e.titulo,
    resumo: `${e.instrucoes} Em perigo, ligue 112.`,
    inicio: e.enviada_em,
    fim: e.valida_ate,
    publicado_em: e.enviada_em,
    zona,
    freguesias,
    todo_concelho:
      !zona.circulos.length && !zona.poligono && !freguesias?.length,
    rua: e.zona_descricao,
    gravidade: e.gravidade,
  });
}

export interface LinhaOcorrencia {
  id: string;
  categoria: string;
  estado: string;
  morada: string;
  lat: number | null;
  lng: number | null;
  criada_em: Date;
  resolvida_em: Date | null;
  prevista_para: string | null;
  local_lat: number | null;
  local_lng: number | null;
  local_freguesia: string | null;
}

/**
 * Ocorrências abertas e resolvidas há pouco. Sem quem reportou, sem a
 * descrição (texto livre de quem ligou) e sem número de porta; as
 * coordenadas arredondadas a 3 casas (~100 m).
 */
export function normalizarOcorrencia(
  o: LinhaOcorrencia,
  c: ContextoNormalizar,
): ItemInterno {
  const lat = arredondar(o.lat ?? o.local_lat, 3);
  const lng = arredondar(o.lng ?? o.local_lng, 3);
  const freguesia =
    o.local_freguesia ?? freguesiaDaMorada(o.morada, c.freguesias);
  const resolvida = o.estado === 'resolvida';
  const resumo = resolvida
    ? `Resolvida${o.resolvida_em ? ` a ${diaCurto(diaLocal(o.resolvida_em, c.fuso))}` : ''}.`
    : o.estado === 'com_equipa'
      ? o.prevista_para
        ? `Com a equipa da câmara; intervenção prevista para ${diaCurto(o.prevista_para)}.`
        : 'Com a equipa da câmara.'
      : 'Registada; à espera da equipa da câmara.';
  return base(c, {
    id: o.id,
    tipo: 'incidentes',
    fonte: 'ocorrencia',
    etiqueta: resolvida ? 'Resolvido' : 'Incidente',
    titulo: o.categoria,
    resumo,
    inicio: o.criada_em,
    fim: o.resolvida_em,
    publicado_em: o.criada_em,
    zona: zonaDePonto(lat, lng),
    freguesias: freguesia ? [freguesia] : null,
    rua: semNumeroDePorta(o.morada),
  });
}

export interface LinhaComunicado {
  id: string;
  tipo: 'comunicado' | 'noticia';
  titulo: string;
  texto: string;
  imagem_url: string | null;
  freguesias: string[] | null;
  publicado_em: Date;
}

export function normalizarComunicado(
  m: LinhaComunicado,
  c: ContextoNormalizar,
): ItemInterno {
  return base(c, {
    id: m.id,
    tipo: 'avisos',
    fonte: 'comunicado',
    etiqueta: m.tipo === 'noticia' ? 'Notícia' : 'Comunicado',
    titulo: m.titulo,
    resumo: cortar(m.texto, 280),
    inicio: m.publicado_em,
    fim: null,
    publicado_em: m.publicado_em,
    zona: SEM_ZONA,
    freguesias: m.freguesias,
    todo_concelho: !m.freguesias?.length,
    rua: null,
    imagem: m.imagem_url,
  });
}

export interface LinhaEvento {
  id: string;
  titulo: string;
  descricao: string;
  local: string;
  lat: number | null;
  lng: number | null;
  inicio: Date;
  fim: Date | null;
  freguesia: string | null;
  link: string | null;
  publicado_em: Date;
}

export function normalizarEvento(
  e: LinhaEvento,
  c: ContextoNormalizar,
): ItemInterno {
  return base(c, {
    id: e.id,
    tipo: 'eventos',
    fonte: 'evento',
    etiqueta: 'Evento',
    titulo: e.titulo,
    resumo: cortar(e.descricao, 280),
    inicio: e.inicio,
    fim: e.fim,
    publicado_em: e.publicado_em,
    zona: zonaDePonto(e.lat, e.lng),
    freguesias: e.freguesia ? [e.freguesia] : null,
    todo_concelho: !e.freguesia && e.lat === null,
    rua: e.local,
    link: e.link,
  });
}

export interface LinhaConsulta {
  id: string;
  codigo: string;
  titulo: string;
  resumo: string;
  freguesias: string[] | null;
  /** 'AAAA-MM-DD' */
  abre_em: string;
  fecha_em: string;
  aberta_em: Date | null;
}

export function normalizarConsulta(
  q: LinhaConsulta,
  c: ContextoNormalizar,
): ItemInterno {
  return base(c, {
    id: q.id,
    tipo: 'consultas',
    fonte: 'consulta_publica',
    etiqueta: 'Consulta pública',
    titulo: q.titulo,
    resumo: `${cortar(q.resumo, 240)} Pode dar a sua opinião até ${diaDito(q.fecha_em)}.`,
    inicio: instanteLocal(q.abre_em, '00:00', c.fuso),
    fim: fimDoDia(q.fecha_em, c.fuso),
    publicado_em: q.aberta_em ?? instanteLocal(q.abre_em, '00:00', c.fuso),
    zona: SEM_ZONA,
    freguesias: q.freguesias,
    todo_concelho: !q.freguesias?.length,
    rua: null,
    link: `${c.webUrl}/consulta/${q.codigo}`,
  });
}

// ---------------------------------------------------------------------
// Filtro e ordem
// ---------------------------------------------------------------------

export interface Filtro {
  ponto?: Ponto | null;
  raio_m?: number;
  freguesia?: string | null;
  tipos?: readonly TipoItem[] | null;
  de?: Date | null;
  ate?: Date | null;
  agora: Date;
}

/** O período por omissão: o que acabou há pouco até ao que começa em breve. */
export function periodoOmissao(agora: Date): { de: Date; ate: Date } {
  return {
    de: new Date(agora.getTime() - PARAMETROS.janela_passado_dias * 86_400_000),
    ate: new Date(agora.getTime() + PARAMETROS.janela_futuro_dias * 86_400_000),
  };
}

/** O item acontece (ou está em vigor) algures em [de, ate]? Sem fim = a decorrer. */
export function noPeriodo(
  i: Pick<ItemAgora, 'inicio' | 'fim'>,
  de: Date,
  ate: Date,
): boolean {
  const ini = i.inicio ? Date.parse(i.inicio) : -Infinity;
  const fim = i.fim ? Date.parse(i.fim) : Infinity;
  return ini <= ate.getTime() && fim >= de.getTime();
}

/** As emergências aparecem com qualquer filtro de tipos. */
export function doTipo(
  i: ItemAgora,
  tipos?: readonly TipoItem[] | null,
): boolean {
  return !tipos?.length || tipos.includes(i.tipo) || i.fonte === 'emergencia';
}

/** A freguesia pedida bate nas do item? */
export function daFreguesia(i: ItemAgora, freguesia: string): boolean {
  return !!i.freguesias?.length && freguesiaNaLista(freguesia, i.freguesias);
}

/**
 * O item cai na zona pedida? Sem ponto nem freguesia: tudo. O que é de todo
 * o concelho entra sempre. Com ponto: a distância à zona do item até ao
 * raio. Com freguesia: a freguesia do item. Os dois: basta um.
 */
export function naZona(
  i: ItemInterno,
  f: Pick<Filtro, 'ponto' | 'raio_m' | 'freguesia'>,
): { inclui: boolean; distancia_m: number | null } {
  const distancia = f.ponto ? distanciaAZona(f.ponto, i.zona) : null;
  if (!f.ponto && !f.freguesia) return { inclui: true, distancia_m: null };
  if (i.todo_concelho) return { inclui: true, distancia_m: distancia };
  const raio = f.raio_m ?? PARAMETROS.raio_omissao_m;
  const pelaDistancia = distancia !== null && distancia <= raio;
  const pelaFreguesia = !!f.freguesia && daFreguesia(i, f.freguesia);
  return { inclui: pelaDistancia || pelaFreguesia, distancia_m: distancia };
}

const PESO_GRAVIDADE: Record<Gravidade, number> = {
  emergencia: 1,
  alerta: 0.7,
  aviso: 0.4,
};

/** A decorrer agora? */
export function aDecorrer(
  i: Pick<ItemAgora, 'inicio' | 'fim'>,
  agora: Date,
): boolean {
  const t = agora.getTime();
  return (
    (!i.inicio || Date.parse(i.inicio) <= t) &&
    (!i.fim || Date.parse(i.fim) >= t)
  );
}

/**
 * Relevância de 0 a ~2: 45 % proximidade (1 em cima, metade a ~550 m), 35 %
 * atualidade (a decorrer = 1; a começar desce em 14 dias; já acabado vale
 * pouco), 20 % gravidade, e mais 1 para uma emergência a decorrer (fica
 * sempre à frente).
 */
export function relevancia(
  i: ItemAgora,
  distancia_m: number | null,
  agora: Date,
): number {
  const prox =
    distancia_m !== null
      ? Math.exp(-distancia_m / 800)
      : i.todo_concelho
        ? 0.25
        : 0.15;
  const dia = 86_400_000;
  const t = agora.getTime();
  let atual: number;
  if (aDecorrer(i, agora)) {
    atual = 1;
  } else if (i.inicio && Date.parse(i.inicio) > t) {
    atual = 0.9 * Math.max(0, 1 - (Date.parse(i.inicio) - t) / (14 * dia));
  } else {
    const desde = i.fim ? (t - Date.parse(i.fim)) / dia : 14;
    atual = Math.max(0, 0.5 - desde / 14);
  }
  if (t - Date.parse(i.publicado_em) < 2 * dia)
    atual = Math.min(1, atual + 0.1);
  const grav = i.gravidade ? PESO_GRAVIDADE[i.gravidade] : 0;
  const urgente = i.gravidade === 'emergencia' && aDecorrer(i, agora) ? 1 : 0;
  return (
    Math.round((0.45 * prox + 0.35 * atual + 0.2 * grav + urgente) * 1000) /
    1000
  );
}

export interface ItemComRelevancia extends ItemInterno {
  distancia_m: number | null;
  relevancia: number;
}

/** Filtra (tipo, zona, período) e ordena por relevância. */
export function filtrarEOrdenar(
  itens: readonly ItemInterno[],
  f: Filtro,
): ItemComRelevancia[] {
  const omissao = periodoOmissao(f.agora);
  const de = f.de ?? omissao.de;
  const ate = f.ate ?? omissao.ate;
  const vistos = new Set<string>();
  const r: ItemComRelevancia[] = [];
  for (const i of itens) {
    const k = chaveItem(i);
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (!doTipo(i, f.tipos) || !noPeriodo(i, de, ate)) continue;
    const z = naZona(i, f);
    if (!z.inclui) continue;
    r.push({
      ...i,
      distancia_m: z.distancia_m,
      relevancia: relevancia(i, z.distancia_m, f.agora),
    });
  }
  return ordenar(r);
}

export function ordenar<T extends ItemComRelevancia>(itens: T[]): T[] {
  return [...itens].sort(
    (a, b) =>
      b.relevancia - a.relevancia ||
      (b.inicio ?? '').localeCompare(a.inicio ?? '') ||
      a.id.localeCompare(b.id),
  );
}

/** O item como sai na API (sem a geometria interna). */
export function paraResposta(
  i: ItemInterno &
    Partial<Pick<ItemComRelevancia, 'distancia_m' | 'relevancia'>>,
): ItemAgora & { distancia_m?: number | null; relevancia?: number } {
  const { zona: _zona, ...resto } = i;
  void _zona;
  return resto;
}

// Paginação por posição (a ordem é calculada; o feed é pequeno).
export function lerCursorAgora(c: string | undefined | null): number {
  if (!c) return 0;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString()) as {
      o?: unknown;
    };
    if (typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0)
      return v.o;
  } catch {
    // cai abaixo
  }
  return -1;
}

export function cursorAgora(posicao: number): string {
  return Buffer.from(JSON.stringify({ o: posicao })).toString('base64url');
}

// ---------------------------------------------------------------------
// "Quando" (ferramenta e app)
// ---------------------------------------------------------------------

export const QUANDO = [
  'agora',
  'hoje',
  'amanha',
  'fim_de_semana',
  'esta_semana',
  'proximos_dias',
] as const;
export type Quando = (typeof QUANDO)[number];

/** "hoje", "fim de semana"... → [de, ate] no fuso do município. */
export function periodoDoQuando(
  q: Quando,
  agora: Date,
  fuso: string,
): { de: Date; ate: Date; dito: string } {
  const hoje = diaLocal(agora, fuso);
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const inicioDe = (dia: string) => instanteLocal(dia, '00:00', fuso);
  switch (q) {
    case 'agora':
      return { de: agora, ate: agora, dito: 'neste momento' };
    case 'hoje':
      return { de: inicioDe(hoje), ate: fimDoDia(hoje, fuso), dito: 'hoje' };
    case 'amanha': {
      const d = somarDias(hoje, 1);
      return { de: inicioDe(d), ate: fimDoDia(d, fuso), dito: 'amanhã' };
    }
    case 'fim_de_semana': {
      const sabado = dow === 0 ? somarDias(hoje, -1) : somarDias(hoje, 6 - dow);
      const domingo = somarDias(sabado, 1);
      return {
        de: dow === 0 || dow === 6 ? agora : inicioDe(sabado),
        ate: fimDoDia(domingo, fuso),
        dito: 'este fim de semana',
      };
    }
    case 'esta_semana': {
      const domingo = dow === 0 ? hoje : somarDias(hoje, 7 - dow);
      return { de: agora, ate: fimDoDia(domingo, fuso), dito: 'esta semana' };
    }
    case 'proximos_dias':
      return {
        de: agora,
        ate: fimDoDia(somarDias(hoje, 7), fuso),
        dito: 'nos próximos dias',
      };
  }
}

/** "a decorrer, até 30 de outubro" / "a 31 de outubro, às 21:00" / "desde 20 de outubro". */
export function quandoDito(i: ItemAgora, agora: Date, fuso: string): string {
  const ini = i.inicio ? new Date(i.inicio) : null;
  const fim = i.fim ? new Date(i.fim) : null;
  if (aDecorrer(i, agora)) {
    if (i.fonte === 'ocorrencia' || i.fonte === 'comunicado') {
      return ini ? `desde ${diaDito(diaLocal(ini, fuso))}` : '';
    }
    return fim ? `até ${diaDito(diaLocal(fim, fuso))}` : 'a decorrer';
  }
  if (ini && ini.getTime() > agora.getTime()) {
    const hora = horaLocal(ini, fuso);
    return `a ${diaDito(diaLocal(ini, fuso))}${hora !== '00:00' ? `, às ${hora}` : ''}`;
  }
  return fim ? `terminou a ${diaDito(diaLocal(fim, fuso))}` : '';
}

/** Uma frase para o agente dizer: "Andaime na via pública na Rua Direita, até 30 de outubro". */
export function fraseItem(i: ItemAgora, agora: Date, fuso: string): string {
  const onde = i.rua ? ` (${i.rua})` : i.freguesia ? ` (${i.freguesia})` : '';
  const quando = quandoDito(i, agora, fuso);
  return `${i.titulo}${onde}${quando ? `, ${quando}` : ''}`;
}

// ---------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------

/** "até 30/10", "31/10 21:00", "desde 20/10". */
export function quandoCurto(i: ItemAgora, agora: Date, fuso: string): string {
  const ini = i.inicio ? new Date(i.inicio) : null;
  const fim = i.fim ? new Date(i.fim) : null;
  if (aDecorrer(i, agora)) {
    if (i.fonte === 'ocorrencia' || i.fonte === 'comunicado') {
      return ini ? `desde ${diaCurto(diaLocal(ini, fuso))}` : '';
    }
    return fim ? `ate ${diaCurto(diaLocal(fim, fuso))}` : '';
  }
  if (ini && ini.getTime() > agora.getTime()) {
    const hora = horaLocal(ini, fuso);
    return `${diaCurto(diaLocal(ini, fuso))}${hora !== '00:00' ? ` ${hora}` : ''}`;
  }
  return '';
}

/** Uma linha curta de SMS: "Andaime na via publica, Rua Direita, ate 30/10". */
export function linhaSms(
  i: ItemAgora,
  agora: Date,
  fuso: string,
  max = 90,
): string {
  const partes = [i.titulo, i.rua ?? i.freguesia, quandoCurto(i, agora, fuso)]
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/[.;]+$/, ''));
  const t = transliterar(partes.join(', '));
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;
}

/** No máximo 2 SMS (GSM-7): 306 caracteres. */
export const MAX_SMS = 306;

/**
 * O SMS do aviso de uma subscrição: "CM Guimaraes: Obras perto de si -
 * Andaime na via publica, Rua Direita, ate 30/10. Ver: <link> Parar: PARAR".
 * Em GSM-7 (sem acentos) e no máximo em 2 partes.
 */
export function textoAvisoSubscricao(e: {
  municipio: string;
  item: ItemAgora;
  link: string;
  agora: Date;
  fuso: string;
}): string {
  const urgente = e.item.gravidade === 'emergencia' ? 'URGENTE - ' : '';
  const cabeca = transliterar(
    `${urgente}CM ${e.municipio}: ${e.item.etiqueta} perto de si - `,
  );
  const cauda = ` Ver: ${e.link} Deixar de receber: responda PARAR`;
  const espaco = Math.max(40, MAX_SMS - cabeca.length - cauda.length - 1);
  const corpo = `${linhaSms(e.item, e.agora, e.fuso, espaco)}.`.replace(
    /\.\.$/,
    '.',
  );
  return `${cabeca}${corpo}${cauda}`;
}

export function cabeNoSms(t: string, partes = 2): boolean {
  const info = infoSms(t);
  return info.codificacao === 'gsm7' && info.segmentos <= partes;
}

// ---------------------------------------------------------------------
// Subscrições
// ---------------------------------------------------------------------

export interface SubscricaoAgora {
  id: string;
  municipe_id: string;
  tipos: readonly TipoSubscricao[];
  lat: number | null;
  lng: number | null;
  raio_m: number | null;
  freguesia: string | null;
  criada_em: Date;
}

/**
 * Um item novo bate nesta subscrição? Tem de ser de um tipo subscrito, ter
 * aparecido depois da subscrição e cair na zona (rua com raio, ou
 * freguesia). O que é de todo o concelho (comunicados gerais) não dispara
 * SMS, salvo alertas e emergências; as notícias nunca.
 */
export function correspondeSubscricao(
  i: ItemInterno,
  s: SubscricaoAgora,
): boolean {
  if (!(s.tipos as readonly string[]).includes(i.tipo)) return false;
  if (Date.parse(i.publicado_em) < s.criada_em.getTime()) return false;
  if (i.etiqueta === 'Notícia') return false;
  if (i.todo_concelho)
    return i.gravidade === 'emergencia' || i.gravidade === 'alerta';
  const ponto =
    s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : null;
  return naZona(i, {
    ponto,
    raio_m: s.raio_m ?? PARAMETROS.raio_subscricao_m,
    freguesia: s.freguesia,
  }).inclui;
}

/** Pode sair agora? Emergências a qualquer hora; o resto das 9h às 21h. */
export function podeAvisarAgora(
  i: ItemAgora,
  agora: Date,
  fuso: string,
): boolean {
  return i.gravidade === 'emergencia' || dentroDaJanela(agora, fuso);
}

/** Item novo para as subscrições: apareceu nas últimas horas e ainda não acabou. */
export function itemNovo(i: ItemAgora, agora: Date): boolean {
  const t = agora.getTime();
  return (
    t - Date.parse(i.publicado_em) <= PARAMETROS.novos_horas * 3_600_000 &&
    Date.parse(i.publicado_em) <= t + 60_000 &&
    (!i.fim || Date.parse(i.fim) >= t)
  );
}

// ---------------------------------------------------------------------
// Entradas (ferramentas e rotas)
// ---------------------------------------------------------------------

const lista = <T extends string>(valores: readonly [T, ...T[]]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const partes = (Array.isArray(v) ? v : v.split(','))
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      const maus = partes.filter(
        (p) => !(valores as readonly string[]).includes(p),
      );
      if (maus.length) {
        ctx.addIssue({
          code: 'custom',
          message: `Tipos desconhecidos: ${maus.join(', ')} (válidos: ${valores.join(', ')}).`,
        });
        return z.NEVER;
      }
      return [...new Set(partes)] as T[];
    });

export const esquemaFeed = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    raio_m: z.coerce.number().int().min(50).max(20_000).optional(),
    freguesia: z.string().trim().min(2).max(120).optional(),
    tipos: lista(TIPOS_ITEM),
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    cursor: z.string().max(200).optional(),
    limite: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((f) => (f.lat === undefined) === (f.lng === undefined), {
    message: 'lat e lng vêm juntos.',
    path: ['lat'],
  })
  .refine((f) => !f.de || !f.ate || f.de.getTime() <= f.ate.getTime(), {
    message: '"de" tem de ser antes de "ate".',
    path: ['de'],
  });
export type PedidoFeed = z.output<typeof esquemaFeed>;
