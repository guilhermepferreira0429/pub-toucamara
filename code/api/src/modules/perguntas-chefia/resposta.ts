import { z } from 'zod';
import { diasNoPeriodo } from '../painel/periodos.js';
import type { Coluna, Objeto, ResultadoConsulta, Valor } from './consulta.js';
import { MAX_LINHAS } from './consulta.js';

/*
 * A resposta final. O modelo escreve o texto curto e escolhe o que mostrar
 * referindo-se às consultas guardadas no servidor ("c1", campo "total"); os
 * números e a tabela vêm daí, nunca do texto do modelo. Puro (sem BD).
 */

export const RESPONDER = 'responder';

export const esquemaResponder = z
  .object({
    resposta: z
      .string()
      .trim()
      .min(1)
      .max(700)
      .describe(
        'A resposta em 1 ou 2 frases curtas. Os números dos dados vão como marcadores {1}, {2}... (o n.º de ordem em numeros_chave); nunca escrevas tu os números. Ex.: "Há {1} processos de obras atrasados, {2} deles na fase de apreciação."',
      ),
    numeros_chave: z
      .array(
        z
          .object({
            rotulo: z
              .string()
              .trim()
              .min(1)
              .max(80)
              .describe(
                'O que é o número, em poucas palavras (ex.: "Atrasados").',
              ),
            consulta: z
              .string()
              .describe('O id da consulta de onde vem (ex.: "c1").'),
            campo: z
              .string()
              .describe(
                'A chave em "valores" dessa consulta (ex.: "total"); com linha, a coluna dessa linha.',
              ),
            linha: z
              .number()
              .int()
              .min(0)
              .nullable()
              .describe(
                'Índice (a partir de 0) da linha em "linhas"; null = vem de "valores".',
              ),
          })
          .strict(),
      )
      .max(4)
      .describe('Até 4 números mais importantes, por ordem.'),
    tabela: z
      .object({
        consulta: z.string().describe('O id da consulta cujas linhas mostrar.'),
        colunas: z
          .array(z.string())
          .nullable()
          .describe('As colunas a mostrar, pela chave. null = todas.'),
      })
      .strict()
      .nullable()
      .describe(
        'Uma tabela com as linhas de uma consulta, quando pedem uma lista ou ajuda a perceber. null = sem tabela.',
      ),
    sugestoes: z
      .array(z.string().trim().min(3).max(150))
      .max(3)
      .describe(
        '2 ou 3 perguntas de seguimento que estas consultas respondem.',
      ),
    sem_dados: z
      .boolean()
      .describe(
        'true quando a pergunta não se responde com as consultas disponíveis (diz isso na resposta).',
      ),
  })
  .strict();

export type EntradaResponder = z.output<typeof esquemaResponder>;

/** Uma consulta corrida neste pedido, como fica guardada no servidor. */
export interface ConsultaGuardada {
  id: string;
  ferramenta: string;
  parametros: unknown;
  resultado: ResultadoConsulta | null;
  erro: { codigo: string; mensagem: string; detalhes?: unknown } | null;
  ms: number;
}

/** "Como foi calculado": uma linha por consulta. */
export interface ConsultaPublica {
  id: string;
  ferramenta: string;
  parametros: unknown;
  linhas_devolvidas: number;
  filtros: Record<string, unknown> | null;
  fonte: string | null;
  notas: string[];
  erro: string | null;
}

export interface NumeroChave {
  rotulo: string;
  valor: Valor;
  unidade: string | null;
  consulta: string;
}

export interface Tabela {
  consulta: string;
  colunas: Coluna[];
  linhas: Record<string, Valor>[];
  /** Para o painel abrir cada linha pelo `id`. */
  objeto: Objeto | null;
  total_linhas: number;
}

export interface RespostaFinal {
  resposta: string;
  numeros_chave: NumeroChave[];
  tabela: Tabela | null;
  consultas: ConsultaPublica[];
  sugestoes: string[];
  sem_dados: boolean;
  /** false: o texto do modelo trazia números que não vêm das consultas e foi trocado. */
  texto_verificado: boolean;
}

export function publica(c: ConsultaGuardada): ConsultaPublica {
  const r = c.resultado;
  return {
    id: c.id,
    ferramenta: c.ferramenta,
    parametros: c.parametros,
    linhas_devolvidas: r ? linhasDevolvidas(r) : 0,
    filtros: r?.filtros ?? null,
    fonte: r?.fonte ?? null,
    notas: r?.notas ?? [],
    erro: c.erro?.mensagem ?? null,
  };
}

/** Listas: as linhas devolvidas; contagens: uma linha (o total). */
export function linhasDevolvidas(r: ResultadoConsulta): number {
  return r.linhas ? r.linhas.length : 1;
}

/** O que o modelo lê de uma consulta: sem ids internos e no máximo 50 linhas. */
export function paraModelo(c: ConsultaGuardada): unknown {
  if (!c.resultado) {
    return { consulta: c.id, erro: c.erro };
  }
  const r = c.resultado;
  return {
    consulta: c.id,
    valores: r.valores,
    unidades: r.unidades,
    ...(r.linhas
      ? {
          colunas: (r.colunas ?? []).map((k) => k.chave),
          linhas: r.linhas.slice(0, MAX_LINHAS).map((l) => semId(l)),
          total_linhas: r.total_linhas ?? r.linhas.length,
        }
      : {}),
    filtros: r.filtros,
    notas: r.notas,
  };
}

function semId(l: Record<string, Valor>): Record<string, Valor> {
  const r = { ...l };
  delete r.id;
  return r;
}

export type Resolucao =
  { ok: true; resposta: RespostaFinal } | { ok: false; erros: string[] };

export interface ContextoResposta {
  pergunta: string;
  hoje: string;
  consultas: readonly ConsultaGuardada[];
}

/**
 * Monta a resposta final a partir do que o modelo escolheu. Referências
 * erradas (consulta ou campo que não existe) voltam ao modelo para corrigir.
 * Um número no texto que não vem das consultas nem da pergunta troca o texto
 * por um neutro feito dos números-chave: nunca se mostra um número inventado.
 */
export function resolverResposta(
  e: EntradaResponder,
  ctx: ContextoResposta,
): Resolucao {
  const erros: string[] = [];
  const porId = new Map(ctx.consultas.map((c) => [c.id, c]));
  const resultado = (id: string): ResultadoConsulta | null => {
    const c = porId.get(id);
    if (!c) {
      erros.push(`A consulta "${id}" não existe.`);
      return null;
    }
    if (!c.resultado) {
      erros.push(`A consulta "${id}" deu erro; não tem dados.`);
      return null;
    }
    return c.resultado;
  };

  const numeros: NumeroChave[] = [];
  for (const n of e.numeros_chave) {
    const r = resultado(n.consulta);
    if (!r) continue;
    let fonte: Record<string, Valor> | undefined = r.valores;
    if (n.linha !== null) {
      fonte = r.linhas?.[n.linha];
      if (!fonte) {
        erros.push(`A consulta "${n.consulta}" não tem a linha ${n.linha}.`);
        continue;
      }
    }
    if (!(n.campo in fonte)) {
      erros.push(
        `A consulta "${n.consulta}" não tem o campo "${n.campo}"${n.linha !== null ? ` na linha ${n.linha}` : ''}. Campos: ${Object.keys(fonte).join(', ')}.`,
      );
      continue;
    }
    numeros.push({
      rotulo: n.rotulo,
      valor: fonte[n.campo],
      unidade: r.unidades?.[n.campo] ?? null,
      consulta: n.consulta,
    });
  }

  let tabela: Tabela | null = null;
  if (e.tabela) {
    const r = resultado(e.tabela.consulta);
    if (r && (!r.linhas || !r.colunas)) {
      erros.push(`A consulta "${e.tabela.consulta}" não tem linhas.`);
    } else if (r?.linhas && r.colunas) {
      const validas = new Map(r.colunas.map((c) => [c.chave, c]));
      const pedidas = e.tabela.colunas ?? r.colunas.map((c) => c.chave);
      const desconhecidas = pedidas.filter((c) => !validas.has(c));
      if (desconhecidas.length) {
        erros.push(
          `Colunas que não existem em "${e.tabela.consulta}": ${desconhecidas.join(', ')}. Colunas: ${[...validas.keys()].join(', ')}.`,
        );
      } else {
        const colunas = pedidas.map((c) => validas.get(c)!);
        tabela = {
          consulta: e.tabela.consulta,
          colunas,
          linhas: r.linhas.slice(0, MAX_LINHAS).map((l) => {
            const linha: Record<string, Valor> = {};
            if (l.id !== undefined) linha.id = l.id;
            for (const c of colunas) linha[c.chave] = l[c.chave] ?? null;
            return linha;
          }),
          objeto: r.objeto ?? null,
          total_linhas: r.total_linhas ?? r.linhas.length,
        };
      }
    }
  }

  // Marcadores {n} no texto têm de existir em numeros_chave.
  const marcadores = [...e.resposta.matchAll(/\{(\d+)\}/g)].map((m) =>
    Number(m[1]),
  );
  const fora = marcadores.filter((n) => n < 1 || n > e.numeros_chave.length);
  if (fora.length) {
    erros.push(
      `O texto usa {${fora.join('}, {')}} mas numeros_chave só tem ${e.numeros_chave.length}.`,
    );
  }
  if (erros.length) return { ok: false, erros };

  const verificado = numerosDoTextoConferem(e.resposta, ctx);
  const texto = verificado
    ? e.resposta.replace(/\{(\d+)\}/g, (_, n: string) =>
        formatar(numeros[Number(n) - 1].valor),
      )
    : textoNeutro(numeros, e.sem_dados);

  return {
    ok: true,
    resposta: {
      resposta: texto,
      numeros_chave: numeros,
      tabela,
      consultas: ctx.consultas.map(publica),
      sugestoes: e.sugestoes,
      sem_dados: e.sem_dados,
      texto_verificado: verificado,
    },
  };
}

/** Número como se escreve em Portugal: 1234,5 → "1234,5"; 12345 → "12 345". */
export function formatar(v: Valor): string {
  if (v === null) return 'sem dados';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'string') return v;
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(v);
}

function textoNeutro(numeros: NumeroChave[], semDados: boolean): string {
  if (numeros.length === 0) {
    return semDados
      ? 'Não tenho dados para responder a esta pergunta.'
      : 'Veja abaixo como foi calculado.';
  }
  return numeros
    .map(
      (n) =>
        `${n.rotulo}: ${formatar(n.valor)}${n.unidade ? ` ${n.unidade}` : ''}`,
    )
    .join(' · ');
}

const NUMERO = /\d+(?:[.,]\d+)?/g;

function numerosEm(s: string): number[] {
  return [...s.matchAll(NUMERO)].map((m) => Number(m[0].replace(',', '.')));
}

/** Todos os números que o texto pode citar sem marcador. */
function permitidos(ctx: ContextoResposta): Set<number> {
  const ok = new Set<number>();
  const juntar = (v: unknown): void => {
    if (typeof v === 'number') {
      ok.add(v);
      ok.add(Math.round(v * 10) / 10);
      ok.add(Math.round(v));
    } else if (typeof v === 'string') {
      numerosEm(v).forEach((n) => ok.add(n));
    } else if (Array.isArray(v)) {
      v.forEach(juntar);
    } else if (v && typeof v === 'object') {
      // Os ids (uuid) têm algarismos soltos que deixariam passar números
      // inventados: não contam.
      Object.entries(v).forEach(([k, x]) => {
        if (k !== 'id' && !k.endsWith('_id')) juntar(x);
      });
    }
  };
  juntar(ctx.pergunta);
  juntar(ctx.hoje);
  for (const c of ctx.consultas) {
    juntar(c.parametros);
    const p = c.parametros as { de?: unknown; ate?: unknown } | null;
    if (typeof p?.de === 'string' && typeof p?.ate === 'string') {
      ok.add(diasNoPeriodo({ de: p.de, ate: p.ate }));
    }
    if (c.resultado) {
      juntar(c.resultado.valores);
      juntar(c.resultado.linhas ?? []);
      juntar(c.resultado.filtros ?? {});
      juntar(c.resultado.total_linhas ?? null);
    }
  }
  return ok;
}

export function numerosDoTextoConferem(
  texto: string,
  ctx: ContextoResposta,
): boolean {
  const semMarcadores = texto.replace(/\{\d+\}/g, '');
  const usados = numerosEm(semMarcadores);
  if (usados.length === 0) return true;
  const ok = permitidos(ctx);
  return usados.every((n) => ok.has(n));
}
