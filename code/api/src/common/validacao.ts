import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from './erros.js';

/** Valida o corpo de um pedido com Zod; erros como 400 `pedido_invalido`. */
export function validar<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const campos = r.error.issues.map((i) => ({
      campo: i.path.join('.') || 'corpo',
      mensagem: i.message,
    }));
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      'pedido_invalido',
      campos.map((c) => `${c.campo}: ${c.mensagem}`).join('; '),
      { campos },
    );
  }
  return r.data;
}
