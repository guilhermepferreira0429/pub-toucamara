import { z } from 'zod';

/*
 * Inquérito de satisfação (peça 7). Puro: validação da resposta e as contas
 * do cartão "Satisfação" do painel.
 */

/** Tamanho máximo do comentário (o mesmo CHECK da 0093). */
export const MAX_COMENTARIO = 1000;

/** Comentários mostrados no cartão do painel. */
export const ULTIMOS_COMENTARIOS = 5;

/** "Ficou resolvido? 1–5" e, opcional, "O que podia ter corrido melhor?". */
export const esquemaResposta = z.object({
  nota: z.coerce.number().int().min(1).max(5),
  comentario: z
    .string()
    .max(MAX_COMENTARIO * 2)
    .optional()
    .nullable()
    .transform((v) => limparComentario(v)),
});

/** Espaços a mais fora; vazio → null; corta no máximo. */
export function limparComentario(v: string | null | undefined): string | null {
  const t = (v ?? '')
    // eslint-disable-next-line no-control-regex -- caracteres de controlo fora (exceto \n)
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t ? t.slice(0, MAX_COMENTARIO) : null;
}

export interface ContagemSatisfacao {
  /** Respostas no período. */
  respostas: number;
  /** Soma das notas das respostas. */
  soma: number;
  /** Conversas do período com link do resumo (quem podia responder). */
  elegiveis: number;
  /** Respostas por nota: índice 0 = nota 1. */
  por_nota: number[];
}

export interface IndicadoresSatisfacao {
  /** Nota média com uma casa decimal; null sem respostas. */
  media: number | null;
  respostas: number;
  elegiveis: number;
  /** Respostas / conversas com link, em %, uma casa; null sem elegíveis. */
  taxa_resposta_pct: number | null;
  /** Notas 4 e 5, em % das respostas; null sem respostas. */
  satisfeitos_pct: number | null;
  distribuicao: { nota: number; respostas: number }[];
}

const umaCasa = (n: number) => Math.round(n * 10) / 10;

export function indicadoresSatisfacao(
  c: ContagemSatisfacao,
): IndicadoresSatisfacao {
  const porNota = [1, 2, 3, 4, 5].map((n) => c.por_nota[n - 1] ?? 0);
  return {
    media: c.respostas ? umaCasa(c.soma / c.respostas) : null,
    respostas: c.respostas,
    elegiveis: c.elegiveis,
    // Uma resposta de uma conversa fora do período não passa dos 100%.
    taxa_resposta_pct: c.elegiveis
      ? umaCasa(Math.min(100, (c.respostas / c.elegiveis) * 100))
      : null,
    satisfeitos_pct: c.respostas
      ? umaCasa(((porNota[3] + porNota[4]) / c.respostas) * 100)
      : null,
    distribuicao: porNota.map((respostas, i) => ({ nota: i + 1, respostas })),
  };
}
