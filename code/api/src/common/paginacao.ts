import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { textoDoPg } from './datas-pg.js';
import { ErroApi } from './erros.js';

/**
 * Paginação por cursor (keyset), sempre por (data DESC, id DESC):
 *
 *   const { limite, cursor } = validar(esquemaPaginacao, query);
 *   const linhas = await db.query(`
 *     SELECT ... WHERE municipio_id = $1
 *       AND ($2::timestamptz IS NULL OR (criada_em, id) < ($2, $3))
 *     ORDER BY criada_em DESC, id DESC LIMIT $4`,
 *     [m.id, cursor?.em ?? null, cursor?.id ?? null, limite + 1]);
 *   return pagina(linhas, limite, (l) => ({ em: l.criada_em, id: l.id }));
 */
export interface Cursor {
  em: string;
  id: string;
}

export interface Pagina<T> {
  itens: T[];
  proximo_cursor: string | null;
}

export const esquemaPaginacao = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z
    .string()
    .optional()
    .transform((c) => (c ? lerCursor(c) : null)),
});

export function lerCursor(c: string): Cursor {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString()) as Cursor;
    if (typeof v.em === 'string' && typeof v.id === 'string') return v;
  } catch {
    // cai no erro abaixo
  }
  throw new ErroApi(
    HttpStatus.BAD_REQUEST,
    'cursor_invalido',
    'Cursor inválido.',
  );
}

/** Recebe `limite + 1` linhas: a sobra diz se há mais. */
export function pagina<T>(
  linhas: T[],
  limite: number,
  chave: (l: T) => { em: Date | string; id: string },
): Pagina<T> {
  const itens = linhas.slice(0, limite);
  const ultima = itens[itens.length - 1];
  if (linhas.length <= limite || !ultima) {
    return { itens, proximo_cursor: null };
  }
  const k = chave(ultima);
  // Com microssegundos quando o Date veio da BD (senão perdiam-se linhas).
  const em =
    k.em instanceof Date ? (textoDoPg(k.em) ?? k.em.toISOString()) : k.em;
  return {
    itens,
    proximo_cursor: Buffer.from(JSON.stringify({ em, id: k.id })).toString(
      'base64url',
    ),
  };
}
