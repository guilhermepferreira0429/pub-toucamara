import { LinhaResultados, resumir } from '../painel/agregados.js';
import { somarDias } from '../painel/periodos.js';

/*
 * Resumo diário para o presidente: as últimas 24 horas (das 07:30 de ontem
 * às 07:30 de hoje, no fuso do município). Tudo puro: as linhas vêm do
 * ResumoDiarioService.
 *
 * O que é uma RECLAMAÇÃO aqui (e só isto conta):
 *   - uma conversa da janela cujo tema tem "reclamação" ou "queixa" no nome,
 *     ou cujo resumo (do Claude, no fim da conversa) ou o resumo de uma
 *     passagem a funcionário soa a queixa (`pareceReclamacao`: palavras como
 *     "reclamação", "queixa", "insatisfeito", "ninguém resolve", "continua
 *     sem", "já liguei várias vezes"), ou que teve uma passagem com motivo
 *     'reclamacao'. As passagens com motivo 'outro' contam só se o resumo
 *     soar a queixa: 'outro' sozinho não diz nada;
 *   - um email do email geral recebido na janela classificado com um tema de
 *     reclamação/queixa, ou cujo assunto soa a queixa;
 *   - à parte, as ocorrências repetidas: avisos novos na janela marcados como
 *     duplicados de uma ocorrência já registada ("o mesmo buraco outra vez"),
 *     agrupados por categoria e zona (a rua, sem número de porta).
 * Cada conversa ou email conta uma vez, mesmo com vários sinais.
 */

export const HORA_RESUMO = '07:30';

/** "Subiu muito": mais do dobro da média dos 7 dias anteriores e pelo menos 5 casos. */
export const PICO_FATOR = 2;
export const PICO_MINIMO = 5;

const MAX_CITACAO = 160;

// ----------------------------------------------------------------------
// Janela das 24 horas no fuso do município
// ----------------------------------------------------------------------

/** Minutos que o relógio do fuso está à frente de UTC nesse instante. */
function desvioMinutos(fuso: string, instante: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const local = Date.UTC(
    v('year'),
    v('month') - 1,
    v('day'),
    v('hour'),
    v('minute'),
  );
  return Math.round(
    (local - Math.floor(instante.getTime() / 60_000) * 60_000) / 60_000,
  );
}

/** O instante em que o relógio do fuso marca `hora` ('HH:MM') no `dia`. */
export function instanteLocal(dia: string, hora: string, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const ingenuo = Date.UTC(a, m - 1, d, h, mi);
  // Duas voltas: o desvio pode mudar entre a hora ingénua e a verdadeira (mudança de hora).
  let t = ingenuo - desvioMinutos(fuso, new Date(ingenuo)) * 60_000;
  t = ingenuo - desvioMinutos(fuso, new Date(t)) * 60_000;
  return new Date(t);
}

/** 'HH:MM' no fuso. */
export function horaNoFuso(fuso: string, agora = new Date()): string {
  return agora.toLocaleTimeString('en-GB', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export interface Janela {
  /** O dia do resumo (o do envio), 'YYYY-MM-DD'. */
  dia: string;
  de: Date;
  ate: Date;
}

/**
 * A janela do job: das 07:30 de ontem às 07:30 de `dia`, no fuso. Nos dias de
 * mudança de hora tem 23 ou 25 horas (é o que o relógio da câmara diz).
 */
export function janelaDiaria(dia: string, fuso: string): Janela {
  return {
    dia,
    de: instanteLocal(somarDias(dia, -1), HORA_RESUMO, fuso),
    ate: instanteLocal(dia, HORA_RESUMO, fuso),
  };
}

/** Pedido à mão: as 24 horas até `ate`; o dia é o de `ate` no fuso. */
export function janelaAte(ate: Date, fuso: string): Janela {
  return {
    dia: ate.toLocaleDateString('sv-SE', { timeZone: fuso }),
    de: new Date(ate.getTime() - 24 * 3600_000),
    ate,
  };
}

/** O job corre de hora a hora; só gera entre as 07:30 e o meio-dia locais. */
export function horaDeGerar(hora: string): boolean {
  return hora >= HORA_RESUMO && hora < '12:00';
}

// ----------------------------------------------------------------------
// Temas: variação face à média dos 7 dias anteriores e picos
// ----------------------------------------------------------------------

export interface TemaJanela {
  tema_id: string;
  tema: string;
  /** Conversas na janela. */
  total: number;
  /** Conversas nos 7 dias antes da janela. */
  anteriores_7d: number;
}

export interface TemaDiario {
  tema_id: string;
  tema: string;
  total: number;
  /** Média por dia nos 7 dias anteriores, uma casa decimal. */
  media_7d: number;
  /** % face à média; null sem base (média 0). */
  variacao_pct: number | null;
  subiu_muito: boolean;
}

export function variacaoVsMedia(
  total: number,
  anteriores7d: number,
): Pick<TemaDiario, 'media_7d' | 'variacao_pct' | 'subiu_muito'> {
  const media = anteriores7d / 7;
  return {
    media_7d: Math.round(media * 10) / 10,
    variacao_pct: media
      ? Math.round(((total - media) / media) * 1000) / 10
      : null,
    subiu_muito: total >= PICO_MINIMO && total > PICO_FATOR * media,
  };
}

/** Os temas da janela, mais pedidos primeiro (desempate pelo nome). */
export function temasDoDia(linhas: readonly TemaJanela[]): TemaDiario[] {
  return linhas
    .filter((l) => l.total > 0)
    .map((l) => ({
      tema_id: l.tema_id,
      tema: l.tema,
      total: l.total,
      ...variacaoVsMedia(l.total, l.anteriores_7d),
    }))
    .sort((a, b) => b.total - a.total || a.tema.localeCompare(b.tema, 'pt'));
}

/** Picos anormais: os temas que subiram muito, o maior salto primeiro. */
export function picos(temas: readonly TemaDiario[]): TemaDiario[] {
  return temas
    .filter((t) => t.subiu_muito)
    .sort(
      (a, b) =>
        b.total - (b.media_7d || 0) - (a.total - (a.media_7d || 0)) ||
        a.tema.localeCompare(b.tema, 'pt'),
    );
}

// ----------------------------------------------------------------------
// Reclamações
// ----------------------------------------------------------------------

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Tema de reclamação: "Reclamações", "Queixas sobre ruído"... */
export function temaDeReclamacao(tema: string | null | undefined): boolean {
  return !!tema && /\b(reclama|queixa)/.test(normalizar(tema));
}

const SINAIS_RECLAMACAO = [
  /\breclama/,
  /\bqueix/,
  /\binsatisfeit/,
  /\bdescontent/,
  /\bindignad/,
  /\bvergonha\b/,
  /\babsurdo\b/,
  /\binadmissivel\b/,
  /\binaceitavel\b/,
  /\blivro (amarelo|de reclamacoes)\b/,
  /\bmal atendid/,
  /\bninguem (resolve|responde|faz nada|atende)/,
  /\bcontinua(m)? (sem|a nao|por resolver)/,
  /\bainda (nao|sem) (foi|foram|resolv|repar|respond)/,
  /\bja (liguei|reportei|reclamei|pedi|avisei) (varias|tantas|muitas)/,
  /\b(varias|tantas|muitas) vezes\b/,
];

/** O texto (resumo da conversa, da passagem, assunto do email) soa a queixa? */
export function pareceReclamacao(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = normalizar(texto);
  return SINAIS_RECLAMACAO.some((r) => r.test(t));
}

export interface ConversaJanela {
  id: string;
  canal: string;
  tema: string | null;
  resumo: string | null;
  resultado: string;
  passagens: { motivo: string; resumo: string }[];
}

export function conversaEReclamacao(c: ConversaJanela): boolean {
  return (
    temaDeReclamacao(c.tema) ||
    pareceReclamacao(c.resumo) ||
    c.passagens.some(
      (p) => p.motivo === 'reclamacao' || pareceReclamacao(p.resumo),
    )
  );
}

export interface EmailJanela {
  id: string;
  tema: string | null;
  assunto: string | null;
}

export function emailEReclamacao(e: EmailJanela): boolean {
  return temaDeReclamacao(e.tema) || pareceReclamacao(e.assunto);
}

/**
 * A zona de uma morada: a rua, sem número de porta, código postal nem
 * localidade. 'Rua de Santo António, 12, 4800-123 Guimarães' → 'Rua de Santo António'.
 */
export function zonaDaMorada(morada: string): string {
  const primeira = morada.split(',')[0] ?? '';
  const zona = primeira
    .replace(/\d{4}-\d{3}.*$/, '')
    .replace(/\s+(n\.?\s?º|nº|n\.)?\s*\d+[a-z]?$/iu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return zona || 'Sem zona';
}

export interface OcorrenciaRepetida {
  numero: string;
  categoria: string;
  morada: string;
  /** Avisos repetidos chegados na janela. */
  repetidas: number;
}

export interface ZonaRepetida {
  categoria: string;
  zona: string;
  ocorrencias: string[];
  repetidas: number;
}

/** Ocorrências repetidas agrupadas por categoria e zona, as mais repetidas primeiro. */
export function repetidasPorZona(
  linhas: readonly OcorrenciaRepetida[],
): ZonaRepetida[] {
  const grupos = new Map<string, ZonaRepetida>();
  for (const l of linhas) {
    const zona = zonaDaMorada(l.morada);
    const chave = `${l.categoria}|${normalizar(zona)}`;
    const g = grupos.get(chave) ?? {
      categoria: l.categoria,
      zona,
      ocorrencias: [],
      repetidas: 0,
    };
    g.ocorrencias.push(l.numero);
    g.repetidas += l.repetidas;
    grupos.set(chave, g);
  }
  return [...grupos.values()].sort(
    (a, b) => b.repetidas - a.repetidas || a.zona.localeCompare(b.zona, 'pt'),
  );
}

// ----------------------------------------------------------------------
// Citações anónimas
// ----------------------------------------------------------------------

/** Palavras que podem trazer dados pessoais: na dúvida não se cita. */
const PROIBIDAS = [
  /\bnif\b/,
  /\bcontribuinte\b/,
  /\bcartao (de )?cidadao\b/,
  /\bc\.?c\.?\b/,
  /\biban\b/,
  /\bnib\b/,
  /\btelefone\b/,
  /\btelemovel\b/,
  /\bcontacto\b/,
  /\bnumero\b/,
  /\be-?mail\b/,
  /\bmorada\b/,
  /\bmoro\b/,
  /\bvivo (na|no|em|ao|perto)\b/,
  /\b(rua|avenida|av|travessa|largo|praca|beco|estrada|alameda|calcada|bairro|urbanizacao|lote|andar|rc|esq|dto|codigo postal)\b/,
  /\bchamo-me\b/,
  /\b(o )?meu nome\b/,
  /\bsou (o|a) [a-z]/,
  /\b(sr|sra|dr|dra|eng|enga|dona|senhor|senhora)\b\.?/,
  /\b(meu|minha) (marido|mulher|filho|filha|pai|mae|vizinho|vizinha)\b/,
  /\bdata de nascimento\b/,
  /\bmatricula\b/,
  /\bprocesso\b/,
];

/**
 * Uma frase de munícipe que se pode citar no resumo, ou null. Recusa (não
 * corta) tudo o que pode identificar alguém: qualquer algarismo (telefone,
 * NIF, porta, código postal, matrícula), emails e endereços web, palavras de
 * morada, apresentações ("chamo-me", "sou a ..."), tratamentos ("Sr.",
 * "D."), familiares e qualquer palavra com maiúscula a meio da frase (um
 * nome) que não esteja em `permitidas` (ex.: o nome do município).
 */
export function citacaoSegura(
  texto: string,
  permitidas: readonly string[] = [],
): string | null {
  let t = texto.replace(/\s+/g, ' ').replace(/^["'«“\s-]+|["'»”\s]+$/g, '');
  if (!t) return null;
  if (/\d/.test(t)) return null;
  if (/@|www\.|https?:|\.pt\b|\.com\b/i.test(t)) return null;
  const n = normalizar(t);
  if (PROIBIDAS.some((r) => r.test(n))) return null;

  const livres = new Set(
    ['camara', 'municipal', 'junta', 'freguesia', 'tou', 'portugal'].concat(
      permitidas.flatMap((p) => normalizar(p).split(/[^a-z]+/)),
    ),
  );
  const palavras = t.split(' ');
  for (let i = 1; i < palavras.length; i++) {
    const p = palavras[i].replace(/^[("'«“]+/, '');
    const inicioDeFrase = /[.!?…:]["'»”)]*$/.test(palavras[i - 1]);
    if (/^\p{Lu}/u.test(p) && !inicioDeFrase) {
      const limpa = normalizar(p).replace(/[^a-z]/g, '');
      if (!livres.has(limpa)) return null;
    }
  }

  // Curta: até ao fim da frase que passar dos 160 caracteres.
  if (t.length > MAX_CITACAO) {
    const frases = t.match(/[^.!?…]+[.!?…]+/g) ?? [];
    let r = '';
    for (const f of frases) {
      if ((r + f).trim().length > MAX_CITACAO) break;
      r += f;
    }
    if (!r.trim()) return null;
    t = r.trim();
  }
  if (t.length < 20 || t.split(' ').length < 4) return null;
  return t;
}

export interface TurnoCandidato {
  conversa_id: string;
  tema: string | null;
  texto: string;
}

export interface Citacao {
  texto: string;
  tema: string | null;
}

/**
 * 3 a 5 citações (menos se não houver frases seguras): uma por conversa,
 * primeiro das conversas de reclamação, depois dos temas mais pedidos.
 */
export function escolherCitacoes(
  turnos: readonly TurnoCandidato[],
  opcoes: {
    reclamacoes: ReadonlySet<string>;
    temasTop: readonly string[];
    permitidas?: readonly string[];
    maximo?: number;
  },
): Citacao[] {
  const max = opcoes.maximo ?? 5;
  const prioridade = (t: TurnoCandidato) => {
    if (opcoes.reclamacoes.has(t.conversa_id)) return 0;
    const i = t.tema ? opcoes.temasTop.indexOf(t.tema) : -1;
    return i >= 0 ? 1 + i : 100;
  };
  const ordenados = turnos
    .map((t, i) => ({ t, i, p: prioridade(t) }))
    .sort((a, b) => a.p - b.p || a.i - b.i);
  const usadas = new Set<string>();
  const vistos = new Set<string>();
  const r: Citacao[] = [];
  for (const { t } of ordenados) {
    if (r.length >= max) break;
    if (usadas.has(t.conversa_id)) continue;
    const texto = citacaoSegura(t.texto, opcoes.permitidas);
    if (!texto || vistos.has(normalizar(texto))) continue;
    usadas.add(t.conversa_id);
    vistos.add(normalizar(texto));
    r.push({ texto, tema: t.tema });
  }
  return r;
}

// ----------------------------------------------------------------------
// Os dados do resumo (`relatorios.dados`)
// ----------------------------------------------------------------------

export interface OperacaoJanela {
  ocorrencias_novas: number;
  ocorrencias_resolvidas: number;
  requerimentos_novos: number;
  processos_novos: number;
  pagamentos_pagos: number;
  pagos_cent: number;
  pagamentos_modo_teste: number;
  chamadas_saida: number;
  chamadas_saida_atendidas: number;
}

export interface PassagemPorResponder {
  motivo: string;
  tema: string | null;
  responder_ate: string;
  atribuida_a: string | null;
  atrasada: boolean;
}

export interface ProcessoPrazoHoje {
  numero: string;
  tipo: string;
  tecnico: string | null;
}

export interface EntradaDiario {
  municipio: { nome: string; slug: string };
  fuso: string;
  janela: Janela;
  porCanal: LinhaResultados[];
  operacao: OperacaoJanela;
  temas: TemaJanela[];
  conversas: ConversaJanela[];
  emails: EmailJanela[];
  repetidas: OcorrenciaRepetida[];
  emergencias: { iniciada_em: string; canal: string; tema: string | null }[];
  passagens: { total: number; itens: PassagemPorResponder[] };
  processosHoje: { total: number; itens: ProcessoPrazoHoje[] };
  turnos: TurnoCandidato[];
}

const TOP = 5;

/** Contagem por chave, maior primeiro. */
function contar(valores: readonly string[]): { tema: string; total: number }[] {
  const m = new Map<string, number>();
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([tema, total]) => ({ tema, total }))
    .sort((a, b) => b.total - a.total || a.tema.localeCompare(b.tema, 'pt'));
}

/** O que fica em `relatorios.dados` (sem a abertura, que vem a seguir). */
export function montarDiario(e: EntradaDiario) {
  const r = resumir(e.porCanal);
  const porCanal: Record<string, number> = {};
  for (const l of e.porCanal) {
    if (l.canal && l.total) porCanal[l.canal] = l.total;
  }
  const temas = temasDoDia(e.temas);
  const conversasRecl = e.conversas.filter(conversaEReclamacao);
  const emailsRecl = e.emails.filter(emailEReclamacao);
  const temasRecl = contar([
    ...conversasRecl.map((c) => c.tema ?? 'Sem tema'),
    ...emailsRecl.map((x) => x.tema ?? 'Sem tema'),
  ]);
  const top = temas.slice(0, TOP);
  return {
    titulo: 'Resumo diário',
    municipio: e.municipio,
    tipo: 'diario' as const,
    periodo: { de: e.janela.dia, ate: e.janela.dia },
    janela: {
      de: e.janela.de.toISOString(),
      ate: e.janela.ate.toISOString(),
      fuso: e.fuso,
    },
    numeros: {
      conversas: r.conversas,
      por_canal: porCanal,
      chamadas: r.chamadas,
      escritas: r.escritas,
      resolvidas_sem_humano: r.resolvidas_sem_humano,
      resolvidas_sem_humano_pct: r.resolvidas_sem_humano_pct,
      passadas: r.passadas,
      fora_de_horas: r.fora_de_horas,
      emergencias: r.emergencias,
      ocorrencias_novas: e.operacao.ocorrencias_novas,
      ocorrencias_resolvidas: e.operacao.ocorrencias_resolvidas,
      requerimentos_novos: e.operacao.requerimentos_novos,
      processos_novos: e.operacao.processos_novos,
      pagamentos: {
        pagos: e.operacao.pagamentos_pagos,
        valor_cent: e.operacao.pagos_cent,
        modo_teste: e.operacao.pagamentos_modo_teste,
      },
      chamadas_saida: {
        total: e.operacao.chamadas_saida,
        atendidas: e.operacao.chamadas_saida_atendidas,
      },
    },
    mais_pedidos: top,
    reclamacoes: {
      total: conversasRecl.length + emailsRecl.length,
      conversas: conversasRecl.length,
      emails: emailsRecl.length,
      por_tema: temasRecl.slice(0, TOP),
      ocorrencias_repetidas: repetidasPorZona(e.repetidas).slice(0, TOP),
    },
    atencao: {
      emergencias: {
        total: r.emergencias,
        itens: e.emergencias.slice(0, TOP),
      },
      passagens: {
        total: e.passagens.total,
        atrasadas: e.passagens.itens.filter((p) => p.atrasada).length,
        itens: e.passagens.itens.slice(0, TOP),
      },
      processos_prazo_hoje: {
        total: e.processosHoje.total,
        itens: e.processosHoje.itens.slice(0, TOP),
      },
      picos: picos(temas).slice(0, TOP),
    },
    citacoes: escolherCitacoes(e.turnos, {
      reclamacoes: new Set(conversasRecl.map((c) => c.id)),
      temasTop: top.map((t) => t.tema),
      permitidas: [e.municipio.nome],
    }),
  };
}

export type DadosDiarioSemAbertura = ReturnType<typeof montarDiario>;

export interface Abertura {
  texto: string;
  /** 'ia' = escrita pelo Claude; 'modelo' = o texto fixo (sem IA). */
  origem: 'ia' | 'modelo';
}

export type DadosDiario = DadosDiarioSemAbertura & { abertura: Abertura };

// ----------------------------------------------------------------------
// Abertura sem IA (e a verificação da abertura do Claude)
// ----------------------------------------------------------------------

function n(x: number): string {
  return x.toLocaleString('pt-PT');
}

function plural(x: number, um: string, varios: string): string {
  return `${n(x)} ${x === 1 ? um : varios}`;
}

function umaCasa(x: number): string {
  return x.toLocaleString('pt-PT', { maximumFractionDigits: 1 });
}

/** 3 a 4 frases só com os números (o texto quando não há IA ou ela falha). */
export function aberturaSemIa(d: DadosDiarioSemAbertura): string {
  const x = d.numeros;
  const frases: string[] = [];
  if (!x.conversas) {
    frases.push('Nas últimas 24 horas não houve conversas com o agente.');
  } else {
    frases.push(
      `Nas últimas 24 horas houve ${plural(x.conversas, 'conversa', 'conversas')} ` +
        `(${plural(x.chamadas, 'chamada', 'chamadas')} e ${plural(x.escritas, 'escrita', 'escritas')}): ` +
        `${plural(x.resolvidas_sem_humano, 'ficou resolvida', 'ficaram resolvidas')} sem passar a um funcionário ` +
        `e ${plural(x.passadas, 'foi passada', 'foram passadas')} a um funcionário.`,
    );
  }
  const t = d.mais_pedidos[0];
  if (t) {
    const comp = t.subiu_muito
      ? `, bem acima da média de ${umaCasa(t.media_7d)} por dia nos 7 dias anteriores`
      : t.media_7d
        ? `, contra uma média de ${umaCasa(t.media_7d)} por dia nos 7 dias anteriores`
        : '';
    frases.push(
      `O mais pedido foi «${t.tema}», com ${plural(t.total, 'caso', 'casos')}${comp}.`,
    );
  }
  const rc = d.reclamacoes;
  const rep = rc.ocorrencias_repetidas[0];
  if (rc.total) {
    const sobre = rc.por_tema[0]
      ? `, sobretudo sobre «${rc.por_tema[0].tema}»`
      : '';
    frases.push(
      `${rc.total === 1 ? 'Houve 1 reclamação' : `Houve ${n(rc.total)} reclamações`}${sobre}.`,
    );
  } else if (!rep) {
    frases.push('Não houve reclamações.');
  }
  if (rep && frases.length < 3) {
    frases.push(
      `${rep.categoria} em ${rep.zona} voltou a ser reportado ${plural(rep.repetidas, 'vez', 'vezes')}.`,
    );
  }
  const a = d.atencao;
  const hoje: string[] = [];
  if (a.emergencias.total) {
    hoje.push(plural(a.emergencias.total, 'emergência', 'emergências'));
  }
  if (a.passagens.total) {
    hoje.push(
      `${plural(a.passagens.total, 'pedido passado a funcionário', 'pedidos passados a funcionários')} por responder`,
    );
  }
  if (a.processos_prazo_hoje.total) {
    hoje.push(
      `${plural(a.processos_prazo_hoje.total, 'processo', 'processos')} com o prazo a acabar`,
    );
  }
  frases.push(
    hoje.length
      ? `Para hoje: ${juntar(hoje)}.`
      : 'Não há nada com prazo para hoje.',
  );
  return frases.slice(0, 4).join(' ');
}

function juntar(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** Todos os números de um valor JSON (para conferir o texto do Claude). */
function numerosDe(v: unknown, r = new Set<number>()): Set<number> {
  if (typeof v === 'number') r.add(Math.round(v * 10) / 10);
  else if (Array.isArray(v)) v.forEach((x) => numerosDe(x, r));
  else if (v && typeof v === 'object') {
    Object.values(v).forEach((x) => numerosDe(x, r));
  }
  return r;
}

/**
 * A abertura do Claude só passa se cada número que escreve estiver nos dados
 * que recebeu (ou for 24/7 das janelas): nunca inventa. Aceita '1 234',
 * '62,5' e '62,5%'.
 */
export function numerosConferem(texto: string, dados: unknown): boolean {
  const validos = numerosDe(dados);
  [24, 7, 1].forEach((x) => validos.add(x));
  const achados: string[] =
    texto.match(/\d+(?:[\u00a0\u202f .]\d{3})*(?:,\d+)?/g) ?? [];
  return achados.every((s) => {
    const v = Number(s.replace(/[\u00a0\u202f .]/g, '').replace(',', '.'));
    return validos.has(Math.round(v * 10) / 10);
  });
}

/** O que o Claude recebe: só números e nomes de temas (nada de citações). */
export function paraIa(d: DadosDiarioSemAbertura) {
  return {
    municipio: d.municipio.nome,
    numeros: {
      ...d.numeros,
      pagamentos: {
        ...d.numeros.pagamentos,
        valor_euros: Math.round(d.numeros.pagamentos.valor_cent) / 100,
      },
    },
    mais_pedidos: d.mais_pedidos.map((t) => ({
      tema: t.tema,
      total: t.total,
      media_7d: t.media_7d,
      subiu_muito: t.subiu_muito,
    })),
    reclamacoes: {
      total: d.reclamacoes.total,
      por_tema: d.reclamacoes.por_tema,
      ocorrencias_repetidas: d.reclamacoes.ocorrencias_repetidas.map((z) => ({
        categoria: z.categoria,
        zona: z.zona,
        repetidas: z.repetidas,
      })),
    },
    atencao_hoje: {
      emergencias: d.atencao.emergencias.total,
      passagens_por_responder: d.atencao.passagens.total,
      passagens_atrasadas: d.atencao.passagens.atrasadas,
      processos_prazo_hoje: d.atencao.processos_prazo_hoje.total,
      picos: d.atencao.picos.map((t) => t.tema),
    },
  };
}

/** Instruções fixas da abertura (em cache: sem datas nem nomes). */
export const SISTEMA_ABERTURA = `Escreves a abertura do resumo diário que o presidente de uma câmara municipal lê no telemóvel de manhã, sobre o atendimento aos munícipes nas últimas 24 horas.

Recebes os números em JSON. Escreve 3 ou 4 frases em português de Portugal, em texto corrido: sem títulos, listas, markdown nem emojis.

Regras:
- Usa só os números e os factos do JSON. Nunca inventes números, causas, nomes, comparações ou tendências que lá não estejam. Se um número for 0, podes dizê-lo ou omiti-lo.
- Escreve os números como algarismos, tal como vêm no JSON.
- Sem adjetivos de marketing, sem elogios ao serviço ou ao agente, sem conselhos.
- Começa pelo que pede atenção hoje (emergências, pedidos por responder, prazos, picos), se houver; depois o que mais pediram e reclamaram.
- "subiu_muito" quer dizer mais do dobro da média dos 7 dias anteriores.
- Responde só com as frases.`;
