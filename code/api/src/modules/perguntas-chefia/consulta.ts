import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import type { Feriados } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { Tx } from '../../database/database.service.js';
import type { MelhoriasService } from '../conhecimento/melhorias.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import type { PainelDadosService } from '../painel/painel-dados.service.js';
import { lerPeriodo, Periodo } from '../painel/periodos.js';

/*
 * O que é uma consulta da chefia: uma ferramenta do Claude com SQL fixo.
 * O modelo só escolhe os parâmetros (validados com zod, `strict` na API); o
 * município vem sempre do pedido (`ctx.municipio`) e nunca é um parâmetro.
 */

/** Tudo o que uma consulta pode usar. A BD é uma transação só de leitura. */
export interface ContextoConsulta {
  municipio: Municipio;
  /** Hoje no fuso do município, 'YYYY-MM-DD'. */
  hoje: string;
  feriados: Feriados;
  db: Pick<Tx, 'query'>;
  /** As leituras das vistas do painel, na mesma transação. */
  painel: Pick<
    PainelDadosService,
    | 'resultadosPorCanal'
    | 'resultadosPorBalde'
    | 'trabalho'
    | 'temas'
    | 'processosFases'
    | 'ocorrenciasAbertas'
  >;
  melhorias: Pick<MelhoriasService, 'resumo'>;
}

export type Valor = number | string | boolean | null;

export interface Coluna {
  chave: string;
  rotulo: string;
}

/** Para o painel abrir a linha (processo ou ocorrência). */
export type Objeto = 'processo' | 'ocorrencia';

/** O resultado de uma consulta: é daqui (e não do texto do modelo) que saem os números. */
export interface ResultadoConsulta {
  valores: Record<string, Valor>;
  /** Unidade de cada valor ou coluna ('processos', '€', '%', 'dias úteis'). */
  unidades?: Record<string, string>;
  linhas?: Record<string, Valor>[];
  colunas?: Coluna[];
  objeto?: Objeto | null;
  /** Quantas linhas havia antes do limite (listas). */
  total_linhas?: number;
  /** Os filtros como foram entendidos (ex.: os tipos de processo que "obras" apanhou). */
  filtros?: Record<string, unknown>;
  /** De onde vêm os dados, em palavras simples. */
  fonte: string;
  notas?: string[];
}

export interface Consulta<E extends z.ZodObject = z.ZodObject> {
  nome: string;
  /** Para o modelo: quando usar e o que devolve. */
  descricao: string;
  entrada: E;
  executar(ctx: ContextoConsulta, e: z.output<E>): Promise<ResultadoConsulta>;
}

/** Só para inferir o tipo da entrada no `executar`. */
export function consulta<E extends z.ZodObject>(c: Consulta<E>): Consulta {
  return c;
}

export const MAX_LINHAS = 50;

// ----------------------------------------------------------------------
// Parâmetros comuns (todos obrigatórios na API: o "opcional" é null)
// ----------------------------------------------------------------------

export const dia = (descricao: string) =>
  z.iso.date().nullable().describe(descricao);

export const DE = dia(
  'Primeiro dia do período (AAAA-MM-DD), incluído. null = sem início.',
);
export const ATE = dia(
  'Último dia do período (AAAA-MM-DD), incluído. null = até hoje.',
);

export const texto = (descricao: string) =>
  z.string().trim().min(1).max(80).nullable().describe(descricao);

export const limite = (omissao: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(MAX_LINHAS)
    .nullable()
    .describe(
      `Quantas linhas devolver (1 a ${MAX_LINHAS}). null = ${omissao}.`,
    );

/**
 * Período das vistas do painel: as mesmas regras de `?de=&ate=` (máx. 400
 * dias; sem datas, os últimos 7 dias até hoje).
 */
export function periodoVistas(
  ctx: ContextoConsulta,
  e: { de: string | null; ate: string | null },
): Periodo {
  const { de, ate } = lerPeriodo(
    { de: e.de ?? undefined, ate: e.ate ?? undefined },
    ctx.hoje,
  );
  return { de, ate };
}

/** Período livre (tabelas): cada extremo pode faltar; de > ate é erro. */
export function periodoLivre(e: { de: string | null; ate: string | null }): {
  de: string | null;
  ate: string | null;
} {
  if (e.de && e.ate && e.de > e.ate) {
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      'periodo_invalido',
      'A data de início é depois da data de fim.',
    );
  }
  return { de: e.de, ate: e.ate };
}

// ----------------------------------------------------------------------
// Corresponder o que a pessoa escreveu aos nomes da câmara
// ----------------------------------------------------------------------

const PALAVRAS_VAZIAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'na',
  'no',
  'nas',
  'nos',
  'em',
  'com',
  'para',
  'por',
  'e',
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
]);

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function palavras(s: string): string[] {
  return normalizar(s)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 0 && !PALAVRAS_VAZIAS.has(p));
}

/**
 * "buracos" ↔ "buraco", "comunicações" ↔ "comunicação", "luzes" ↔ "luz":
 * as duas palavras partilham o início (5 letras, ou a mais curta inteira).
 */
function mesmaPalavra(a: string, b: string): boolean {
  const n = Math.min(5, a.length, b.length);
  if (n < 3) return a === b;
  return a.slice(0, n) === b.slice(0, n);
}

/** Todas as palavras do termo aparecem no nome (ou o termo é o código). */
export function corresponde(
  nome: string,
  termo: string,
  codigo?: string,
): boolean {
  if (codigo && normalizar(codigo) === normalizar(termo.trim())) return true;
  const doTermo = palavras(termo);
  const doNome = palavras(nome);
  return (
    doTermo.length > 0 &&
    doTermo.every((t) => doNome.some((n) => mesmaPalavra(t, n)))
  );
}

/**
 * Os itens (tipos, categorias, técnicos...) que o termo apanha. Sem nenhum:
 * erro com a lista dos válidos, para o modelo escolher outro ou dizer que
 * não existe.
 */
export function escolher<T extends { nome: string; codigo?: string }>(
  itens: readonly T[],
  termo: string,
  oQue: string,
  codigoErro: string,
): T[] {
  const r = itens.filter((i) => corresponde(i.nome, termo, i.codigo));
  if (r.length === 0) {
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      codigoErro,
      `Nenhum ${oQue} corresponde a "${termo}".`,
      {
        validos: itens.map((i) =>
          i.codigo ? `${i.codigo} · ${i.nome}` : i.nome,
        ),
      },
    );
  }
  return r;
}

// ----------------------------------------------------------------------
// Números
// ----------------------------------------------------------------------

/** Cêntimos → euros (2 casas). */
export function euros(cent: number | string | null): number {
  return Math.round(Number(cent ?? 0)) / 100;
}

/** Uma casa decimal; null fica null. */
export function umaCasa(n: number | string | null): number | null {
  if (n === null || n === undefined) return null;
  return Math.round(Number(n) * 10) / 10;
}

export function media(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return umaCasa(xs.reduce((s, x) => s + x, 0) / xs.length);
}

export function mediana(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return umaCasa(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2);
}
