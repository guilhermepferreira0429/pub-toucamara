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
        'Procura a resposta nas fontes oficiais do concelho (câmara, empresas municipais, juntas, leis e regulamentos). ' +
        'Usa sempre antes de responder a uma pergunta sobre regras, prazos, taxas, documentos ou contactos. ' +
        'Responde só com o que vem nos resultados e diz a fonte. Se vier sem_fonte: true, não inventes: passa a um funcionário. ' +
        'Se vier documentos_simples, há uma versão em linguagem simples revista pela câmara: explica com base nela (sem contradizer os trechos oficiais) e manda o link, que tem o resumo e o texto oficial completo.',
      entrada: z.object({
        pergunta: z
          .string()
          .trim()
          .min(2)
          .max(500)
          .describe(
            'A pergunta do munícipe, por palavras dele ou resumida (ex.: "preciso de licença para abrir uma porta na sala?").',
          ),
        limite: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Quantos resultados no máximo (por defeito 5).'),
        em_data: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD')
          .optional()
          .describe(
            'Só quando a pessoa pergunta pela regra numa data passada (ex.: "quando entreguei o pedido, em março de 2025, que regra valia?"). Devolve as versões em vigor nesse dia; se vier mudou_desde: true, diz que a regra entretanto mudou.',
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
