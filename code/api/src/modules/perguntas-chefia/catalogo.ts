import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Consulta } from './consulta.js';
import {
  conversas,
  indicadoresPeriodo,
  melhoriasPortal,
  perguntasSemResposta,
  smsEnviados,
  temasMaisPerguntados,
} from './consultas-atendimento.js';
import {
  contarOcorrencias,
  listarOcorrencias,
  marcacoes,
  pagamentos,
} from './consultas-operacao.js';
import {
  cargaTecnicos,
  contarProcessos,
  listarProcessos,
  temposProcessos,
} from './consultas-processos.js';
import { esquemaResponder, RESPONDER } from './resposta.js';

/** O conjunto fechado de consultas. A ordem é fixa (cache do prompt). */
export const CONSULTAS: readonly Consulta[] = [
  indicadoresPeriodo,
  conversas,
  temasMaisPerguntados,
  perguntasSemResposta,
  contarProcessos,
  listarProcessos,
  temposProcessos,
  cargaTecnicos,
  contarOcorrencias,
  listarOcorrencias,
  pagamentos,
  marcacoes,
  smsEnviados,
  melhoriasPortal,
];

export const POR_NOME: ReadonlyMap<string, Consulta> = new Map(
  CONSULTAS.map((c) => [c.nome, c]),
);

/** O que a API de structured outputs não aceita: o zod valida do nosso lado. */
const NAO_SUPORTADO = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
]);

function limpar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(limpar);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !NAO_SUPORTADO.has(k))
        .map(([k, x]) => [k, limpar(x)]),
    );
  }
  return v;
}

/** JSON Schema para `strict: true` (todos os campos obrigatórios, sem extras). */
export function esquemaApi(
  entrada: z.ZodObject,
): Anthropic.Beta.BetaTool.InputSchema {
  return limpar(
    z.toJSONSchema(entrada, { io: 'input' }),
  ) as Anthropic.Beta.BetaTool.InputSchema;
}

const DESCRICAO_RESPONDER =
  'Dá a resposta final à pessoa. Chama-a sempre uma vez no fim, depois das consultas (ou logo, se a pergunta não se responde com elas, com sem_dados = true). Os números e a tabela são tirados das consultas pelo id e pelo campo: o texto só leva marcadores {1}, {2}.';

let cache: Anthropic.Beta.BetaToolUnion[] | null = null;

/** As ferramentas para a API: as consultas e, no fim, `responder`. */
export function ferramentasApi(): Anthropic.Beta.BetaToolUnion[] {
  cache ??= [
    // Sem `strict` nas consultas: a API recusa esquemas estritos com mais de 16 parâmetros com uniões (as
    // consultas têm dezenas de filtros opcionais/nullable). Os parâmetros são validados à mesma pelo zod de cada
    // consulta, e um erro volta ao modelo como is_error para ele corrigir.
    ...CONSULTAS.map((c) => ({
      name: c.nome,
      description: c.descricao,
      input_schema: esquemaApi(c.entrada),
    })),
    {
      name: RESPONDER,
      description: DESCRICAO_RESPONDER,
      input_schema: esquemaApi(esquemaResponder),
      strict: true,
    },
  ];
  return cache;
}
