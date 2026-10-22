import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { ConversasService } from '../conversas/conversas.service.js';
import type { LinguagemSimplesService } from '../linguagem-simples/linguagem-simples.service.js';
import { ConhecimentoService } from './conhecimento.service.js';

export function ferramentasConhecimento(
  conhecimento: ConhecimentoService,
  conversas: ConversasService,
  simples?: LinguagemSimplesService,
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
        limite: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Máximo de resultados (5).'),
        em_data: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD')
          .optional()
          .describe(
            'Só para a regra numa data passada (AAAA-MM-DD). mudou_desde: true → diz que entretanto mudou.',
          ),
      }),
      async executar(ctx, { pergunta, limite, em_data }) {
        const r = em_data
          ? await conhecimento.procurarEm(
              ctx.municipio.id,
              pergunta,
              em_data,
              limite,
            )
          : await conhecimento.procurar(ctx.municipio.id, pergunta, limite);
        if (r.sem_fonte) return r;
        await conversas.momento(ctx.conversaId, 'resposta_com_fonte', {
          pergunta,
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
