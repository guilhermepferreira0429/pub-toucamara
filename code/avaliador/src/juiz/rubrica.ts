/*
 * A rubrica do juiz: prompt de sistema fixo, formato da saída e mensagem por
 * resposta. Qualquer mudança ao prompt, ao esquema ou às regras de veredicto
 * (regras.ts) obriga a subir RUBRICA_VERSAO: a versão fica gravada em cada
 * avaliação e é o que permite dizer "esta taxa foi medida com a rubrica X" e
 * reavaliar com outra sem voltar a perguntar.
 */
import { z } from 'zod';
import { COMPORTAMENTOS, type Comportamento } from '../tipos.js';

export const RUBRICA_VERSAO = '2026-10-19.1';

export const COMPORTAMENTOS_OBSERVADOS = [...COMPORTAMENTOS, 'nenhum'] as const;
export type ComportamentoObservado = (typeof COMPORTAMENTOS_OBSERVADOS)[number];

/** O que o modelo devolve (structured outputs). O veredicto NÃO vem daqui. */
export const SaidaJuizSchema = z.object({
  comportamento_observado: z.enum(COMPORTAMENTOS_OBSERVADOS),
  factos_certos: z.array(z.string()),
  factos_em_falta: z.array(z.string()),
  factos_errados: z.array(z.string()),
  so_manda_contactar: z.boolean(),
  manda_ligar_112: z.boolean(),
  justificacao: z.string(),
});
export type SaidaJuiz = z.infer<typeof SaidaJuizSchema>;

/*
 * Fixo e sem nada variável (datas, nomes de sistemas), para ficar em cache e
 * para ser igual para todos os sistemas avaliados.
 */
export const PROMPT_SISTEMA = `És o avaliador de respostas de assistentes de atendimento municipal em Portugal (câmaras municipais). Um munícipe fez uma pergunta e um assistente respondeu. Tens a resposta de referência (gabarito), revista por uma pessoa a partir das fontes oficiais. O teu trabalho é descrever, com rigor e sem simpatia por nenhum assistente, o que a resposta faz. Não sabes qual é o assistente nem quem o fez, e isso não interessa: avalia apenas o texto.

Não decides o veredicto final: ele é calculado por regras fixas a partir do que descreves. Por isso descreve com exatidão; não tentes compensar.

## O que tens de devolver

comportamento_observado — o que a resposta faz, um de:
- responder: dá a informação pedida diretamente.
- encaminhar: diz que o assunto é de outra entidade (ex.: empresa de águas, junta de freguesia, ministério) e indica qual e como a contactar.
- ocorrencia: regista ou diz ter registado uma ocorrência/pedido (ex.: buraco na via, lâmpada fundida), normalmente com número ou confirmação.
- perguntar: pede um esclarecimento ao munícipe antes de responder (ex.: "em que freguesia?").
- passar_humano: passa a conversa a uma pessoa da equipa / funcionário, ou diz que um funcionário vai responder.
- emergencia: trata a situação como emergência e manda ligar 112 (ou o número de emergência adequado).
- fora_ambito: diz que o assunto não é da câmara nem do atendimento e não inventa resposta.
- outra_lingua: a pergunta não está em português e a resposta está na mesma língua da pergunta.
- nenhum: não responde (vazia, mensagem de erro, "não percebi", "não sei" sem mais nada).
Se a pergunta for noutra língua e a resposta estiver nessa língua, usa outra_lingua mesmo que também responda ou encaminhe. Se estiver em português, usa o comportamento que se aplica.

factos_certos — dos factos obrigatórios do gabarito, os que a resposta contém (mesmo por outras palavras, desde que o sentido e os números sejam os mesmos). Copia o texto do facto exatamente como está no gabarito.
factos_em_falta — dos factos obrigatórios, os que a resposta não contém. Copia o texto exato. Cada facto obrigatório vai para factos_certos ou para factos_em_falta.
factos_errados — os factos proibidos que a resposta contém (copia o texto exato) e qualquer afirmação da resposta que contradiga o gabarito (telefone, horário, preço, prazo, morada, entidade diferentes). Para contradições escreve uma frase curta: "diz X; o gabarito diz Y". Omissões não são erros: vão para factos_em_falta.
so_manda_contactar — true se a resposta se limita a mandar contactar a câmara, os serviços ou um balcão, sem dar a informação pedida (ex.: "contacte-nos pelo 253 000 000", "dirija-se aos serviços"). false se dá a informação, ou se encaminha para a entidade certa que o gabarito indica.
manda_ligar_112 — true se a resposta diz ao munícipe para ligar 112 (ou o número de emergência).
justificacao — uma ou duas frases em português de Portugal, factuais, a explicar o essencial.

## Cuidados
- Números de telefone, códigos e horários contam com qualquer formatação (253 514 400 = 253514400).
- Uma resposta que dá a informação certa mas acrescenta um dado errado tem esse dado em factos_errados.
- Não penalizes estilo, tamanho ou simpatia. Só conteúdo e comportamento.
- Não inventes factos que não estão na resposta.`;

export interface EntradaJuiz {
  pergunta: string;
  idioma: string;
  categoria: string;
  comportamento_esperado: Comportamento;
  entidade_esperada: string | null;
  gabarito: {
    resposta: string;
    factos_obrigatorios: string[];
    factos_proibidos: string[];
  };
  resposta: string;
}

function lista(prefixo: string, factos: string[]): string {
  if (!factos.length) return '(nenhum)';
  return factos.map((f, i) => `${prefixo}${i + 1}. ${f}`).join('\n');
}

/**
 * A mensagem de uma avaliação. Só o que o juiz precisa; NUNCA o nome do
 * sistema, se é nosso, a latência ou as ferramentas usadas (só o nosso as
 * tem, e isso denunciava-o).
 */
export function mensagemJuiz(e: EntradaJuiz): string {
  return `<pergunta idioma="${e.idioma}" categoria="${e.categoria}">
${e.pergunta}
</pergunta>

<comportamento_esperado>${e.comportamento_esperado}</comportamento_esperado>
<entidade_esperada>${e.entidade_esperada ?? '(nenhuma)'}</entidade_esperada>

<gabarito>
<resposta_de_referencia>
${e.gabarito.resposta}
</resposta_de_referencia>
<factos_obrigatorios>
${lista('O', e.gabarito.factos_obrigatorios)}
</factos_obrigatorios>
<factos_proibidos>
${lista('P', e.gabarito.factos_proibidos)}
</factos_proibidos>
</gabarito>

<resposta_do_assistente>
${e.resposta}
</resposta_do_assistente>`;
}
