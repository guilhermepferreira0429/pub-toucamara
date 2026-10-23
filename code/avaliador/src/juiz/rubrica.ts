/*
 * A rubrica do juiz: prompt de sistema fixo, formato da saída e mensagem por
 * resposta. Qualquer mudança ao prompt, ao esquema ou às regras de veredicto
 * (regras.ts) obriga a subir RUBRICA_VERSAO: a versão fica gravada em cada
 * avaliação e é o que permite dizer "esta taxa foi medida com a rubrica X" e
 * reavaliar com outra sem voltar a perguntar.
 *
 * Versões: 2026-10-19.1 (veredicto binário); 2026-10-23.2 (escala por
 * categorias v2: o veredicto binário continua a sair das mesmas regras, e
 * passa a haver também categoria e "suficiente").
 */
import { z } from 'zod';
import {
  CATEGORIAS,
  COMPORTAMENTOS,
  SUFICIENTE,
  type Comportamento,
} from '../tipos.js';
import { ehSecundario } from './factos.js';

export const RUBRICA_VERSAO = '2026-10-23.2';

export const COMPORTAMENTOS_OBSERVADOS = [...COMPORTAMENTOS, 'nenhum'] as const;
export type ComportamentoObservado = (typeof COMPORTAMENTOS_OBSERVADOS)[number];

/*
 * O que o modelo devolve (structured outputs). Nem o veredicto nem a
 * categoria vêm daqui. Os campos são os mesmos das instruções dos juízes
 * manuais da escala v2 (JUIZ.md), para as duas avaliações se poderem
 * comparar campo a campo. As regras antigas leem os nomes antigos: a
 * tradução (em_falta → factos_em_falta, erros_graves → factos_errados,
 * manda_112 → manda_ligar_112, nota → justificação) está em categorias.ts.
 */
export const SaidaJuizSchema = z.object({
  comportamento_observado: z.enum(COMPORTAMENTOS_OBSERVADOS),
  factos_certos: z.array(z.string()),
  em_falta: z.array(z.string()),
  erros_graves: z.array(z.string()),
  erros_menores: z.array(z.string()),
  so_manda_contactar: z.boolean(),
  nao_encontrou: z.boolean(),
  manda_112: z.boolean(),
  suficiente: z.enum(SUFICIENTE),
  categoria_juiz: z.enum(CATEGORIAS),
  nota: z.string(),
});
export type SaidaJuiz = z.infer<typeof SaidaJuizSchema>;

/*
 * Fixo e sem nada variável (datas, nomes de sistemas), para ficar em cache e
 * para ser igual para todos os sistemas avaliados.
 */
export const PROMPT_SISTEMA = `És o avaliador de respostas de assistentes de atendimento municipal em Portugal (câmaras municipais). Um munícipe fez uma pergunta e um assistente respondeu. Tens a resposta de referência (gabarito), revista por uma pessoa a partir das fontes oficiais. O teu trabalho é descrever, com rigor e sem simpatia por nenhum assistente, o que a resposta faz. Não sabes qual é o assistente nem quem o fez, e isso não interessa: avalia apenas o texto. Nas chamadas de voz, a resposta é a transcrição do que o assistente disse.

Não decides a categoria final: ela é calculada por regras fixas a partir do que descreves. Por isso descreve com exatidão; não tentes compensar.

Os factos obrigatórios vêm marcados [E] (essencial: sem ele a pergunta não fica respondida) ou [S] (secundário: ajuda, mas a pergunta fica respondida sem ele).

## O que tens de devolver

comportamento_observado — o que a resposta faz, um de:
- responder: dá a informação pedida diretamente.
- encaminhar: diz que o assunto é de outra entidade (ex.: empresa de águas, junta de freguesia, ministério) e indica qual e como a contactar.
- ocorrencia: regista ou diz ter registado uma ocorrência/pedido (ex.: buraco na via, lâmpada fundida), normalmente com número ou confirmação.
- perguntar: só pede um esclarecimento ao munícipe antes de responder (ex.: "em que freguesia?").
- passar_humano: passa a conversa a uma pessoa da equipa / funcionário, ou diz que um funcionário vai responder.
- emergencia: trata a situação como emergência e manda ligar 112 (ou o número de emergência adequado).
- fora_ambito: diz que o assunto não é da câmara nem do atendimento e não inventa resposta.
- outra_lingua: a pergunta não está em português e a resposta está na mesma língua da pergunta.
- nenhum: não responde (vazia, mensagem de erro, "não percebi").
Se a pergunta for noutra língua e a resposta estiver nessa língua, usa outra_lingua mesmo que também responda ou encaminhe. Se estiver em português, usa o comportamento que se aplica. Uma resposta que diz que não encontrou a informação ou não sabe não é "nenhum": usa o comportamento que se aplica e marca nao_encontrou.

factos_certos — dos factos obrigatórios (E e S), os que a resposta contém, mesmo por outras palavras, desde que o sentido e os números sejam os mesmos. Copia o texto do facto exatamente como está no gabarito, sem a marca [E]/[S]. Um contacto oficial correto e equivalente para o mesmo serviço conta.
em_falta — dos factos obrigatórios, os que a resposta não contém. Copia o texto exato. Cada facto obrigatório vai para factos_certos ou para em_falta.
erros_graves — afirmações erradas que levariam o munícipe a fazer a coisa errada: telefone, entidade, preço, prazo, regra ou morada errados no que foi perguntado; um facto proibido (copia o texto exato); uma emergência sem mandar ligar 112. Para contradições escreve uma frase curta: "diz X; o certo é Y". Omissões não são erros: vão para em_falta.
erros_menores — imprecisões num detalhe lateral que não mudam o que o munícipe vai fazer (ex.: um horário secundário desatualizado, um nome de página aproximado). Informação certa que não está no gabarito NÃO é erro. Na dúvida sobre se algo é falso, não é erro.
so_manda_contactar — true se a resposta se limita a mandar contactar a câmara, os serviços ou um balcão, sem dar o que foi pedido (ex.: "contacte-nos pelo 253 000 000", "dirija-se aos serviços"). false se dá informação útil, ou se encaminha para a entidade certa com o contacto.
nao_encontrou — true se a resposta diz que não encontrou a informação / não sabe / as fontes não dizem, para o essencial da pergunta.
manda_112 — true se a resposta diz ao munícipe para ligar 112 (ou o número de emergência).
suficiente — do ponto de vista de um munícipe real com este problema, a resposta chega? sim (sai a saber o que fazer, com informação certa), em_parte (ajuda, mas fica a faltar algo de que vai precisar), nao (não ajuda, só manda contactar, ou engana). Decide pelo caso concreto: há perguntas em que faltar o telefone não faz falta e outras em que o telefone é tudo.
categoria_juiz — a tua leitura global, uma de: certa, maioritariamente_certa, parcialmente_certa, maioritariamente_errada, errada, mandou_contactar, nao_encontrou, inconclusiva, sem_resposta. Serve só para comparar com a categoria calculada.
nota — uma ou duas frases em português de Portugal, factuais, a explicar o essencial.

## Cuidados
- Números de telefone, códigos e horários contam com qualquer formatação (253 514 400 = 253514400).
- Uma resposta que dá a informação certa mas acrescenta um dado errado tem esse dado em erros_graves ou erros_menores, conforme mude ou não o que o munícipe vai fazer.
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
    /** Obrigatórios marcados S; os outros são E (sem classificação, todos E). */
    factos_secundarios?: string[];
  };
  resposta: string;
}

function lista(prefixo: string, factos: string[]): string {
  if (!factos.length) return '(nenhum)';
  return factos.map((f, i) => `${prefixo}${i + 1}. ${f}`).join('\n');
}

/** "[E] O1. facto": a marca vem antes do identificador, fora do texto do facto. */
function listaObrigatorios(factos: string[], secundarios: string[]): string {
  if (!factos.length) return '(nenhum)';
  return factos
    .map(
      (f, i) => `[${ehSecundario(f, secundarios) ? 'S' : 'E'}] O${i + 1}. ${f}`,
    )
    .join('\n');
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
${listaObrigatorios(e.gabarito.factos_obrigatorios, e.gabarito.factos_secundarios ?? [])}
</factos_obrigatorios>
<factos_proibidos>
${lista('P', e.gabarito.factos_proibidos)}
</factos_proibidos>
</gabarito>

<resposta_do_assistente>
${e.resposta}
</resposta_do_assistente>`;
}
