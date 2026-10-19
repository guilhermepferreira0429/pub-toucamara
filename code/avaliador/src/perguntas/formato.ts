/*
 * Formato do ficheiro de perguntas (perguntas-base.json e os conjuntos por
 * câmara). Lógica pura: validar e resumir, sem BD.
 */
import { z } from 'zod';
import { COMPORTAMENTOS } from '../tipos.js';

export const PerguntaFicheiro = z.object({
  ordem: z.number().int().positive(),
  categoria: z.string().trim().min(1),
  texto: z.string().trim().min(1),
  idioma: z.string().trim().min(2).default('pt-PT'),
  comportamento: z.enum(COMPORTAMENTOS),
  entidade_esperada: z.string().trim().min(1).nullable().default(null),
  nota: z.string().trim().min(1).nullable().default(null),
});
export type PerguntaFicheiro = z.infer<typeof PerguntaFicheiro>;

const Ficheiro = z
  .array(PerguntaFicheiro)
  .min(1, 'o ficheiro não tem perguntas')
  .superRefine((lista, ctx) => {
    // `ordem` é UNIQUE por conjunto na BD: melhor falhar aqui com o número
    // repetido do que a meio da transação com um erro de restrição.
    const vistas = new Set<number>();
    lista.forEach((p, i) => {
      if (vistas.has(p.ordem)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'ordem'],
          message: `ordem ${p.ordem} repetida`,
        });
      }
      vistas.add(p.ordem);
    });
  });

/** Valida o conteúdo (já lido como JSON); erro com o caminho de cada problema. */
export function validarPerguntas(dados: unknown): PerguntaFicheiro[] {
  const r = Ficheiro.safeParse(dados);
  if (!r.success) {
    const linhas = r.error.issues
      .slice(0, 20)
      .map((i) => `  [${i.path.join('.')}] ${i.message}`);
    throw new Error(`Ficheiro de perguntas inválido:\n${linhas.join('\n')}`);
  }
  return [...r.data].sort((a, b) => a.ordem - b.ordem);
}

/** Contagem por categoria, pela ordem em que as categorias aparecem. */
export function contarPorCategoria(
  perguntas: { categoria: string }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of perguntas) m.set(p.categoria, (m.get(p.categoria) ?? 0) + 1);
  return m;
}
