import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Valida o corpo de um pedido com Zod; erros como 400 legível. */
export function validar<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(
      r.error.issues
        .map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`)
        .join('; '),
    );
  }
  return r.data;
}
