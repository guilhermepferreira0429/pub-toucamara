import { z } from 'zod';
import { ferramenta, type ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { ConversasService } from '../conversas/conversas.service.js';
import type { LinguagemSimplesService } from '../linguagem-simples/linguagem-simples.service.js';
import { ConhecimentoService } from './conhecimento.service.js';
import { CANDIDATOS_REORDENAR, ReordenarService } from './reordenar.service.js';

/** Trechos por pesquisa quando o agente não diz quantos. */
export const LIMITE_OMISSAO = 8;

/**
 * Reordenar os trechos pelo modelo? No chat sim (CONHECIMENTO_REORDENAR=false
 * desliga); na voz só com CONHECIMENTO_REORDENAR_VOZ=true, porque junta um ou
 * dois segundos à resposta falada.
 */
export function usarReordenacao(canal: ContextoFerramenta['canal']): boolean {
  if (canal === 'telefone') return process.env.CONHECIMENTO_REORDENAR_VOZ === 'true';
  return process.env.CONHECIMENTO_REORDENAR !== 'false';
}

export function ferramentasConhecimento(
  conhecimento: ConhecimentoService,
  conversas: ConversasService,
  simples?: LinguagemSimplesService,
  reordenar?: ReordenarService,
) {
  return [
    ferramenta({
      nome: 'procurar_conhecimento',
      descricao:
        'Antes de responder sobre regras, prazos, taxas, documentos, horários ou contactos: procura nas fontes oficiais (câmara, empresas municipais, juntas, leis). ' +
        'Se vier documentos_simples, explica com base nesse resumo revisto (sem contradizer os trechos) e manda o link.',
      agentes: ['entrada', 'saida', 'chat'],
      entrada: z.object({
        pergunta: z
          .string()
          .trim()
          .min(2)
          .max(500)
          .describe('A pergunta, por palavras da pessoa ou resumida.'),
        termos: z
          .array(z.string().trim().min(2).max(200))
          .max(3)
          .optional()
          .describe(
            '1 a 3 formulações como as fontes oficiais escreveriam (termos técnicos ou administrativos e a entidade), ex.: "obras de escassa relevância urbanística", "atestado de residência junta de freguesia", "resíduos têxteis Vitrus".',
          ),
        limite: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Máximo de resultados (8).'),
        em_data: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD')
          .optional()
          .describe(
            'Só para a regra numa data passada (AAAA-MM-DD). mudou_desde: true → diz que entretanto mudou.',
          ),
      }),
      async executar(ctx, { pergunta, termos, limite: pedido, em_data }) {
        // 5 trechos deixavam de fora a página certa quando vinha em 6.º ou 7.º
        // (avaliação de 23/10): 8 por omissão.
        const limite = pedido ?? LIMITE_OMISSAO;
        const reordena =
          !em_data && !!reordenar?.disponivel && usarReordenacao(ctx.canal);
        // Com reordenação, a pesquisa traz mais candidatos e o modelo escolhe.
        const quantos = reordena ? CANDIDATOS_REORDENAR : limite;
        let r = em_data
          ? await conhecimento.procurarEm(
              ctx.municipio.id,
              pergunta,
              em_data,
              limite,
            )
          : termos?.length
            ? await conhecimento.procurarVarias(
                ctx.municipio.id,
                [pergunta, ...termos],
                quantos,
              )
            : await conhecimento.procurar(ctx.municipio.id, pergunta, quantos);
        if (reordena && reordenar && !r.sem_fonte) {
          r = {
            ...r,
            trechos: await reordenar.reordenar(
              pergunta,
              termos ?? [],
              r.trechos,
              limite,
              ctx.municipio.id,
            ),
          };
        }
        if (r.sem_fonte) return r;
        await conversas.momento(ctx.conversaId, 'resposta_com_fonte', {
          pergunta,
          ...(termos?.length ? { termos } : {}),
          trechos: r.trechos.map((t) => t.trecho_id),
          respostas: r.respostas.map((x) => x.resposta_id),
        });
        // Versões em linguagem simples publicadas destas fontes (só as de
        // hoje: numa data passada o texto pode já não ser o do resumo).
        if (em_data || !simples) return r;
        const respostas: { fontes: { trecho_id: string }[] }[] = r.respostas;
        const documentos = await simples
          .daPesquisa(ctx.municipio.id, [
            ...r.trechos.map((t) => t.trecho_id),
            ...respostas.flatMap((x) => x.fontes.map((f) => f.trecho_id)),
          ])
          .catch(() => []);
        return documentos.length ? { ...r, documentos_simples: documentos } : r;
      },
    }),
  ];
}
