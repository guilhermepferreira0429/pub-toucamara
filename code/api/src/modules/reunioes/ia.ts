import { z } from 'zod';
import { RESULTADOS } from './tipos.js';
import type { DadosReuniao } from './regras.js';

/** O que se pede à IA (`ClaudeService.extrair`): um objeto por ponto. */
export const esquemaAtaIa = z.object({
  antes_da_ordem_do_dia: z
    .string()
    .describe(
      'Resumo do período antes da ordem do dia (informações, intervenções do público). Vazio se não houve.',
    ),
  pontos: z.array(
    z.object({
      numero: z.number().int().describe('O número do ponto na ordem do dia.'),
      resumo_discussao: z
        .string()
        .describe('Resumo objetivo da discussão, na terceira pessoa.'),
      intervencoes: z
        .array(
          z.object({
            membro: z.string(),
            forca_politica: z.string().nullable(),
            resumo: z.string(),
          }),
        )
        .describe('Só as intervenções relevantes, uma por membro.'),
      proposta: z.string().describe('A proposta que foi a votação.'),
      votacao: z
        .array(
          z.object({
            forca_politica: z.string(),
            a_favor: z.number().int(),
            contra: z.number().int(),
            abstencoes: z.number().int(),
          }),
        )
        .describe(
          'Votos por força política. Vazio se não houve votação ou se não se percebe pela transcrição.',
        ),
      resultado: z.enum(RESULTADOS),
      deliberacao: z
        .string()
        .describe(
          'O que foi deliberado, numa ou duas frases ("A Câmara deliberou aprovar ..."). Vazio se não houve deliberação.',
        ),
      declaracoes_voto: z.array(
        z.object({
          membro: z.string(),
          forca_politica: z.string().nullable(),
          texto: z.string(),
        }),
      ),
    }),
  ),
});

export const SISTEMA_ATA = [
  'És quem secretaria as reuniões de um órgão autárquico português (câmara municipal ou assembleia municipal).',
  'Recebes a ordem do dia, a lista de presenças (com cargo e força política) e a transcrição da reunião.',
  'Escreves o rascunho da ata em português de Portugal, formal e objetivo, como manda a Lei n.º 75/2013 (Anexo I, art. 57.º): um resumo do essencial, os assuntos apreciados, as deliberações e a forma e o resultado das votações; as declarações de voto (art. 58.º) vão à parte.',
  'Regras:',
  '- Um objeto por ponto da ordem do dia, com o mesmo número. Não inventes pontos.',
  '- Só escreves o que está na transcrição. Se não se percebe a votação de um ponto, deixa a votação vazia e o resultado "por_preencher". Nunca inventes números de votos.',
  '- Votos por força política, como na lista de presenças. O total de votos de uma força não passa o número de membros presentes dessa força.',
  '- "sem_votacao" para pontos só de informação; "retirada" ou "adiada" se o ponto saiu da ordem do dia ou ficou para outra reunião.',
  '- Na deliberação usa a forma habitual: "A Câmara Municipal deliberou, por unanimidade, aprovar ..." ou "A Assembleia Municipal deliberou ...".',
  '- Nas intervenções, o nome do membro como está na lista de presenças; resumo curto, sem citações longas.',
  '- Sem dados pessoais de munícipes além do que for necessário para identificar o assunto.',
].join('\n');

/** Uma transcrição muito longa corta-se aqui (o rascunho avisa). */
export const MAX_TRANSCRICAO_IA = 400_000;

export function conteudoAta(r: DadosReuniao, transcricao: string): string {
  return JSON.stringify(
    {
      orgao: r.orgao,
      tipo: r.tipo,
      data: r.data,
      local: r.local,
      ordem_do_dia: r.ordem_do_dia,
      presencas: r.presencas.map((m) => ({
        nome: m.nome,
        cargo: m.cargo,
        forca_politica: m.forca_politica,
        presente: m.presente,
      })),
      transcricao: transcricao.slice(0, MAX_TRANSCRICAO_IA),
    },
    null,
    1,
  );
}
