import { diaLocal, instanteLocal } from '../marcacoes/vagas.js';

/*
 * Regras puras da demonstração (sem BD): quando está ligada, os telefones e
 * NIF fictícios, e as datas relativas a "agora".
 */

/**
 * A demonstração está ligada? `DEMO_ATIVA=true|false` decide; sem a
 * variável, fica ligada fora de produção e desligada em produção.
 */
export function demoAtiva(
  ambiente: string,
  valor: string | undefined,
): boolean {
  const v = valor?.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return ambiente !== 'production';
}

/**
 * Gama de teste dos telefones fictícios: +351 910 000 000 a 999. Os SMS para
 * estes números nunca saem para o operador (MensagensService).
 */
export const PREFIXO_TELEFONE_DEMO = '+351910000';

export function telefoneDemo(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) {
    throw new Error(`Telefone de demonstração fora da gama: ${n}`);
  }
  return `${PREFIXO_TELEFONE_DEMO}${String(n).padStart(3, '0')}`;
}

export function eTelefoneDemonstracao(
  e164: string | null | undefined,
): boolean {
  return !!e164 && /^\+351910000\d{3}$/.test(e164);
}

/**
 * NIF fictício, válido no algoritmo (dígito de controlo certo): 2999990 +
 * dois dígitos + controlo. Serve para testar o fluxo; não é de ninguém
 * conhecido e está marcado como demonstração onde aparece.
 */
export function nifDemo(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`NIF de demonstração fora da gama: ${n}`);
  }
  const base = `299999${String(n).padStart(2, '0')}`;
  const soma = [...base].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

/**
 * O instante "há `dias` dias, às `hhmm`" no fuso do município. Se cair no
 * futuro (hoje, a uma hora que ainda não chegou), recua para há
 * `minutosSeFuturo` minutos: nunca há conversas no futuro.
 */
export function instanteDemo(
  agora: Date,
  fuso: string,
  dias: number,
  hhmm: string,
  minutosSeFuturo = 30,
): Date {
  const hoje = diaLocal(agora, fuso);
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  const t = instanteLocal(d.toISOString().slice(0, 10), hhmm, fuso);
  if (t.getTime() > agora.getTime() - 60_000) {
    return new Date(agora.getTime() - minutosSeFuturo * 60_000);
  }
  return t;
}

/** O dia local daqui a `dias` dias (negativo = passado), 'AAAA-MM-DD'. */
export function diaDemo(agora: Date, fuso: string, dias: number): string {
  const d = new Date(`${diaLocal(agora, fuso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** O próximo dia da semana (0 = domingo … 6 = sábado) a pelo menos `minDias` dias. */
export function proximoDiaSemana(
  agora: Date,
  fuso: string,
  diaSemana: number,
  minDias: number,
): string {
  let n = minDias;
  for (;;) {
    const dia = diaDemo(agora, fuso, n);
    if (new Date(`${dia}T12:00:00Z`).getUTCDay() === diaSemana) return dia;
    n++;
  }
}

/** O que `escolherResposta` precisa de uma resposta de demonstração. */
export interface RespostaEscolhivel {
  chave: string;
  tema: string;
  estado: string;
  trechos: readonly unknown[];
  palavras?: RegExp;
}

/**
 * A resposta (com fonte) que uma conversa do tema citou: a primeira cujas
 * palavras aparecem na conversa; sem nenhuma, a primeira do tema. Os
 * rascunhos e as respostas sem trechos não contam.
 */
export function escolherResposta<T extends RespostaEscolhivel>(
  respostas: readonly T[],
  tema: string,
  texto: string,
): T | null {
  const doTema = respostas.filter(
    (r) => r.tema === tema && r.estado !== 'rascunho' && r.trechos.length > 0,
  );
  return doTema.find((r) => r.palavras?.test(texto)) ?? doTema[0] ?? null;
}

/**
 * Nomes de teste trocados por nomes plausíveis (e fictícios) nas
 * preparações antigas: [antes, depois], do mais comprido para o mais curto.
 */
export function trocarNomes(
  texto: string,
  trocas: readonly (readonly [string, string])[],
): string {
  return trocas.reduce((t, [a, b]) => t.split(a).join(b), texto);
}

export interface ProcessoNumerado {
  id: string;
  /** 'CP 3/2026', 'CP 412/2026', 'CP DEMO-412/2026'. */
  numero: string;
  /** Dia da entrada, 'AAAA-MM-DD' (dá o ano do número). */
  dia: string;
  /** Criado pela preparação da demo (só estes mudam quando há outros). */
  registado: boolean;
}

/**
 * Os números a mudar para a numeração ficar contínua. Com `todos` (todos os
 * processos da série são de demonstração): 1, 2, 3… por ano de entrada, pela
 * ordem dada (a de entrada). Senão, só os da demonstração com número de
 * design (≥ 400 ou "DEMO-") ou com o ano errado, a numerar com o próximo
 * livre: devolve-se `CP 0/<ano>` e quem chama pede o número.
 */
export function numeracaoContinua(
  processos: readonly ProcessoNumerado[],
  todos: boolean,
): { id: string; numero: string }[] {
  const mudar: { id: string; numero: string }[] = [];
  if (todos) {
    const porAno = new Map<number, number>();
    for (const p of processos) {
      const ano = Number(p.dia.slice(0, 4));
      const n = (porAno.get(ano) ?? 0) + 1;
      porAno.set(ano, n);
      const numero = `CP ${n}/${ano}`;
      if (numero !== p.numero) mudar.push({ id: p.id, numero });
    }
    return mudar;
  }
  for (const p of processos) {
    if (!p.registado) continue;
    const ano = Number(p.dia.slice(0, 4));
    const m = /^CP (DEMO-)?(\d+)\/(\d{4})$/.exec(p.numero);
    const fora = !m || !!m[1] || Number(m[2]) >= 400 || Number(m[3]) !== ano;
    if (fora) mudar.push({ id: p.id, numero: `CP 0/${ano}` });
  }
  return mudar;
}

/** Chaves dos registos de demonstração: minúsculas, dígitos e `_:.-`. */
export function chaveValida(chave: string): boolean {
  return /^[a-z0-9_:.-]{3,80}$/.test(chave);
}
