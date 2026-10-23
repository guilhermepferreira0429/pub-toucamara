/*
 * Factos essenciais e secundários (escala v2). Cada facto obrigatório do
 * gabarito é E (sem ele a pergunta não fica respondida) ou S (ajuda, mas a
 * pergunta fica respondida sem ele). Classifica-se uma vez por pergunta, antes
 * de olhar para as respostas, e é igual para todos os sistemas.
 *
 * Na BD guardam-se só os S (`gabarito.factos_secundarios`): tudo o que lá não
 * está é essencial. Assim, um gabarito nunca classificado, ou um facto
 * acrescentado depois da classificação, conta como E, que é o lado seguro.
 *
 * Ficheiro (docs/avaliacao/escala/essenciais.json):
 *   [{"ordem": 1, "factos": [{"facto": "<texto exato>", "tipo": "E"}, ...]}, ...]
 */
import { z } from 'zod';
import { bd, type Q } from '../bd.js';
import { normalizar } from '../juiz/factos.js';

export const EssenciaisSchema = z.array(
  z.object({
    ordem: z.number().int().positive(),
    factos: z.array(
      z.object({ facto: z.string().min(1), tipo: z.enum(['E', 'S']) }),
    ),
  }),
);
export type ClassificacaoEssenciais = z.infer<typeof EssenciaisSchema>;

/** O gabarito aprovado de uma pergunta, como o import o precisa. */
export interface GabaritoParaClassificar {
  gabarito_id: string;
  ordem: number;
  factos_obrigatorios: string[];
  factos_secundarios: string[];
}

export interface PlanoEssenciais {
  atualizacoes: {
    gabarito_id: string;
    ordem: number;
    secundarios: string[];
    mudou: boolean;
  }[];
  /** Não impedem a pergunta de ser classificada. */
  avisos: string[];
  /** Perguntas que ficam como estavam. */
  erros: string[];
}

/** Lê e valida o JSON (lança com a mensagem do zod se o formato não bate). */
export function lerEssenciais(texto: string): ClassificacaoEssenciais {
  const r = EssenciaisSchema.safeParse(JSON.parse(texto));
  if (!r.success)
    throw new Error(
      `Formato inválido do ficheiro de essenciais: ${r.error.message}`,
    );
  return r.data;
}

const igual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Cruza a classificação com os gabaritos aprovados. Os factos do ficheiro
 * têm de ser os do gabarito (com normalização: pontuação e espaços não
 * contam); os S gravam-se com o texto do gabarito. Erro (a pergunta fica como
 * estava): facto do ficheiro que não está no gabarito, ou nenhum E.
 * Aviso: facto do gabarito que o ficheiro não classifica (conta como E).
 */
export function planearEssenciais(
  classificacao: ClassificacaoEssenciais,
  gabaritos: GabaritoParaClassificar[],
): PlanoEssenciais {
  const plano: PlanoEssenciais = { atualizacoes: [], avisos: [], erros: [] };
  const vistas = new Set<number>();
  for (const item of classificacao) {
    if (vistas.has(item.ordem)) {
      plano.erros.push(
        `#${item.ordem}: aparece mais do que uma vez no ficheiro`,
      );
      continue;
    }
    vistas.add(item.ordem);
    const g = gabaritos.find((x) => x.ordem === item.ordem);
    if (!g) {
      plano.erros.push(`#${item.ordem}: sem gabarito aprovado`);
      continue;
    }
    const doGabarito = (f: string) =>
      g.factos_obrigatorios.find((o) => normalizar(o) === normalizar(f));
    const desconhecidos = item.factos.filter((f) => !doGabarito(f.facto));
    if (desconhecidos.length) {
      plano.erros.push(
        `#${item.ordem}: factos que não estão no gabarito aprovado: ${desconhecidos.map((f) => `"${f.facto}"`).join(', ')}`,
      );
      continue;
    }
    const secundarios = g.factos_obrigatorios.filter((o) =>
      item.factos.some(
        (f) => f.tipo === 'S' && normalizar(f.facto) === normalizar(o),
      ),
    );
    if (
      g.factos_obrigatorios.length &&
      secundarios.length === g.factos_obrigatorios.length
    ) {
      plano.erros.push(
        `#${item.ordem}: nenhum facto E (pelo menos um tem de ser essencial)`,
      );
      continue;
    }
    const semClassificacao = g.factos_obrigatorios.filter(
      (o) => !item.factos.some((f) => normalizar(f.facto) === normalizar(o)),
    );
    if (semClassificacao.length)
      plano.avisos.push(
        `#${item.ordem}: sem classificação, contam como E: ${semClassificacao.map((f) => `"${f}"`).join(', ')}`,
      );
    plano.atualizacoes.push({
      gabarito_id: g.gabarito_id,
      ordem: item.ordem,
      secundarios,
      mudou: !igual(secundarios, g.factos_secundarios),
    });
  }
  const semFicheiro = gabaritos.filter((g) => !vistas.has(g.ordem)).length;
  if (semFicheiro)
    plano.avisos.push(
      `${semFicheiro} perguntas com gabarito aprovado não estão no ficheiro (ficam como estavam; sem classificação, todos os factos contam como E).`,
    );
  return plano;
}

/** Gabaritos aprovados de um conjunto num município, por ordem. */
export function gabaritosParaClassificar(
  conjuntoId: string,
  municipioId: string,
  q: Q = bd,
): Promise<GabaritoParaClassificar[]> {
  return q.query<GabaritoParaClassificar>(
    `SELECT g.id AS gabarito_id, p.ordem, g.factos_obrigatorios, g.factos_secundarios
       FROM avaliacao.gabarito g
       JOIN avaliacao.perguntas p ON p.id = g.pergunta_id
      WHERE p.conjunto_id = $1 AND g.municipio_id = $2 AND g.estado = 'aprovado'
      ORDER BY p.ordem`,
    [conjuntoId, municipioId],
  );
}

/** Grava as classificações numa só transação. Devolve quantas mudaram. */
export function gravarEssenciais(plano: PlanoEssenciais): Promise<number> {
  const mudam = plano.atualizacoes.filter((a) => a.mudou);
  return bd.transacao(async (tx) => {
    for (const a of mudam)
      await tx.query(
        'UPDATE avaliacao.gabarito SET factos_secundarios = $2 WHERE id = $1',
        [a.gabarito_id, a.secundarios],
      );
    return mudam.length;
  });
}
