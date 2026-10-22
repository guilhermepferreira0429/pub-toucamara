/*
 * As regras de como usar o resultado das ferramentas, iguais para todas.
 * Antes estavam repetidas em cada descrição ("diz o dizer", "se vier
 * precisa_identificacao, segue a instrução", "confirma antes"...): agora
 * vão uma vez nos prompts (voz de entrada e de saída, chat e a porta para
 * as IAs) e as descrições ficam com o que é próprio de cada ferramenta.
 */

/** Uma regra por linha, sem o "- " (cada prompt formata à sua maneira). */
export const REGRAS_RESULTADOS: readonly string[] = [
  'Quando o resultado traz "dizer" (ou "o_que_dizer"), diz esse texto, por palavras simples se for preciso, com os números, datas e prazos tal como vêm; não prometas outros prazos.',
  'Se vier "instrucao" (ex.: com precisa_identificacao), segue-a.',
  'Se vier o que falta (perguntar_a_seguir, em_falta, faltam_…, falta_…), pergunta isso, uma ou duas coisas de cada vez, e chama outra vez com as respostas.',
  'Se vier uma escolha (precisa_escolher, escolher, opcoes, categorias), pergunta qual e chama outra vez com o id ou o código escolhido.',
  'Ferramentas com confirmado/confirmar: a primeira chamada vai sem isso e devolve o texto a confirmar (ler_a_pessoa, resumo, dados); só depois do "sim" da pessoa chamas com true.',
  'Se vier encontrado: false, sem_fonte, sem_resultados ou nada, não inventes: diz que não encontraste e procura no conhecimento ou passa a um funcionário.',
  'Valores de demonstração (valores_de_demonstracao, regras_de_demonstracao, demonstracao: true): diz que ainda estão por confirmar pela câmara. Os pagamentos são de teste: diz que nada é cobrado.',
  'Sem ids, as ferramentas usam o que está aberto nesta conversa (o requerimento, o processo, a carta).',
  'Se der erro, nunca digas que ficou feito.',
];

export function regrasEmLista(): string {
  return REGRAS_RESULTADOS.map((r) => `- ${r}`).join('\n');
}
