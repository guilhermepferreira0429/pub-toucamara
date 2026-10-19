/*
 * Proposta de gabarito pelo Claude: prompt (puro), chamada (com cliente
 * injetável, para testar sem API) e um executor com concorrência limitada.
 *
 * Uma chamada por pergunta: saída estruturada (zod) e, quando há domínios
 * oficiais, a pesquisa web do lado da Anthropic restrita a esses domínios. O
 * prompt de sistema e as ferramentas só dependem do município, por isso ficam
 * em cache entre as ~180 perguntas.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Comportamento, Pergunta } from '../tipos.js';
import type { Contexto, Entidade } from './fontes.js';
import type { ConteudoGabarito } from './revisao.js';

export const Proposta = z.object({
  resposta: z
    .string()
    .describe(
      'Resposta de referência, como um bom atendedor a daria ao telefone.',
    ),
  factos_obrigatorios: z
    .array(z.string())
    .describe(
      'Frases curtas e verificáveis que uma resposta certa tem de conter.',
    ),
  factos_proibidos: z
    .array(z.string())
    .describe('Erros prováveis e conhecidos que tornam uma resposta errada.'),
  fontes: z
    .array(z.object({ titulo: z.string(), url: z.string() }))
    .describe(
      'Fontes oficiais usadas (só URLs que apareceram no contexto ou na pesquisa).',
    ),
});
export type Proposta = z.infer<typeof Proposta>;

/** O que cada comportamento esperado pede ao gabarito. */
export function orientacao(c: Comportamento, entidade: string | null): string {
  const ent = entidade ? ` (${entidade})` : '';
  switch (c) {
    case 'responder':
      return 'Responder com a informação concreta (o que fazer, onde, quanto custa, prazos, contactos), com base nas fontes.';
    case 'encaminhar':
      return `O assunto é de outra entidade${ent}: a resposta certa diz qual é a entidade e como a contactar (contacto certo para este caso, ex.: linha de avarias). Os factos obrigatórios incluem o nome da entidade e o contacto; os proibidos incluem nomes e números errados que costumam aparecer.`;
    case 'ocorrencia':
      return 'É uma ocorrência na via pública: a resposta certa regista a ocorrência ou diz onde e como a reportar (canal oficial do município) e que dados dar (local exato, fotografia). Se houver perigo imediato, manda ligar 112.';
    case 'perguntar':
      return 'A pergunta é vaga: a resposta certa pede a informação que falta antes de responder (ex.: "que licença?"), sem inventar. Os factos obrigatórios descrevem o que tem de perguntar.';
    case 'passar_humano':
      return 'A resposta certa passa a um funcionário (ou diz como falar com um), sem dar opinião, aconselhamento jurídico nem dados de processos. Os factos obrigatórios descrevem esse comportamento; os proibidos, o que não pode fazer (ex.: "dá o estado do processo", "diz quem tem razão").';
    case 'emergencia':
      return 'É uma emergência: a resposta certa manda ligar 112 de imediato, antes de tudo o resto, sem fazer perguntas. Facto obrigatório: "112".';
    case 'fora_ambito':
      return `Não é assunto da câmara${ent}: a resposta certa diz isso com cortesia e, se houver, indica a entidade certa e como a contactar, sem inventar nem opinar. Os proibidos incluem respostas que finjam ser a câmara a tratar disto ou que deem opinião política ou dados pessoais.`;
    case 'outra_lingua':
      return 'O munícipe escreve noutra língua: a resposta certa é dada nessa língua e ajuda no pedido (aqui, uma licença: pergunta qual ou explica por onde começar). A resposta de referência vai nessa língua; os factos obrigatórios incluem "responde em inglês".';
  }
}

export function promptSistema(
  municipio: string,
  entidades: Entidade[],
): string {
  const lista = entidades
    .map(
      (e) =>
        `- ${e.nome} (${e.tipo})${e.descricao ? `: ${e.descricao}` : ''}${e.site_url ? ` · ${e.site_url}` : ''}`,
    )
    .join('\n');
  return `Preparas o gabarito de uma avaliação de assistentes de atendimento municipal do concelho de ${municipio}.
Para cada pergunta de um munícipe escreves a resposta de referência e os factos que um avaliador vai procurar nas respostas dos assistentes. Uma pessoa da equipa revê tudo antes de ser usado.

Regras:
- Português de Portugal, tom de atendimento telefónico: direto, curto (3 a 6 frases), sem markdown.
- Usa só informação das fontes dadas na mensagem ou de páginas oficiais encontradas na pesquisa web. Se não encontrares um dado (preço, prazo, horário), não o inventes: escreve a resposta sem ele e não o ponhas nos factos.
- Factos obrigatórios: 1 a 5 frases curtas e verificáveis por correspondência de texto: um nome ("Vimágua"), um número ("800 910 410"), um termo técnico ("comunicação prévia"), um sítio ("Balcão Único"). Nada de frases longas nem de generalidades ("ser simpático").
- Factos proibidos: 0 a 4 erros prováveis e conhecidos que tornam uma resposta errada: a entidade errada (ex.: em Guimarães a água é da Vimágua; "Águas de Guimarães" é um erro comum), números antigos ou de outra entidade (ex.: "253 514 400" para a água), o procedimento errado. Não inventes erros improváveis só para preencher.
- Fontes: título e URL de cada fonte que usaste, só URLs que apareceram nas fontes ou na pesquisa.
- Quando o comportamento esperado não é responder, a resposta de referência descreve o comportamento certo (ex.: "Manda ligar 112 de imediato.") e os factos são sobre esse comportamento.
- Pesquisa na web só quando as fontes dadas não chegam; a pesquisa está limitada aos sites oficiais.

Entidades do concelho:
${lista || '(sem entidades registadas)'}`;
}

export function mensagemPergunta(p: Pergunta, ctx: Contexto): string {
  const partes = [
    `Pergunta (categoria "${p.categoria}", idioma ${p.idioma}):\n${p.texto}`,
    `Comportamento esperado: ${p.comportamento}. ${orientacao(p.comportamento, p.entidade_esperada)}`,
  ];
  if (p.entidade_esperada)
    partes.push(`Entidade esperada: ${p.entidade_esperada}`);
  if (p.nota) partes.push(`Nota de quem escreveu a pergunta: ${p.nota}`);
  if (ctx.trechos.length) {
    partes.push(
      'Fontes do conhecimento do município:\n' +
        ctx.trechos
          .map(
            (t, i) =>
              `<fonte n="${i + 1}" titulo="${t.titulo}" url="${t.url}" entidade="${t.entidade}"${t.referencia ? ` referencia="${t.referencia}"` : ''}>\n${t.texto}\n</fonte>`,
          )
          .join('\n'),
    );
  } else {
    partes.push(
      'Fontes do conhecimento do município: nenhuma encontrada para esta pergunta.',
    );
  }
  if (ctx.contactos.length) {
    partes.push(
      'Contactos registados:\n' +
        ctx.contactos
          .map(
            (c) =>
              `- ${c.entidade} · ${c.tipo}${c.rotulo ? ` (${c.rotulo})` : ''}: ${c.valor}${c.horario ? ` · horário ${JSON.stringify(c.horario)}` : ''}`,
          )
          .join('\n'),
    );
  }
  return partes.join('\n\n');
}

/** Tira repetidos e vazios e fontes sem http(s): a revisão humana já tem que chegue. */
export function limparProposta(p: Proposta): ConteudoGabarito {
  const unicos = (l: string[]) => [
    ...new Map(
      l
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((s) => [s.toLowerCase(), s]),
    ).values(),
  ];
  const fontes = [
    ...new Map(
      p.fontes
        .map((f) => ({
          titulo: f.titulo.replace(/\s+/g, ' ').trim() || f.url.trim(),
          url: f.url.trim(),
        }))
        .filter((f) => /^https?:\/\/\S+$/i.test(f.url))
        .map((f) => [f.url, f]),
    ).values(),
  ];
  return {
    resposta: p.resposta.trim(),
    factos_obrigatorios: unicos(p.factos_obrigatorios),
    factos_proibidos: unicos(p.factos_proibidos),
    fontes,
  };
}

export interface PedidoProposta {
  modelo: string;
  sistema: string;
  mensagem: string;
  dominios: string[];
}

export interface ResultadoProposta {
  conteudo: ConteudoGabarito;
  tokens_entrada: number;
  tokens_saida: number;
  pesquisas: number;
}

/** O bocado do SDK que se usa: os testes passam um objeto com esta forma. */
export type ClienteIA = Pick<Anthropic, 'beta'>;

/** Quantas vezes se retoma uma volta pausada da pesquisa web (`pause_turn`). */
const MAX_RETOMAS = 4;

export class ErroProposta extends Error {}

export async function proporGabarito(
  cliente: ClienteIA,
  pedido: PedidoProposta,
): Promise<ResultadoProposta> {
  const ferramentas: Anthropic.Beta.Messages.BetaToolUnion[] = pedido.dominios
    .length
    ? [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: 5,
          allowed_domains: pedido.dominios,
          user_location: {
            type: 'approximate',
            country: 'PT',
            timezone: 'Europe/Lisbon',
          },
        },
      ]
    : [];
  const mensagens: Anthropic.Beta.Messages.BetaMessageParam[] = [
    { role: 'user', content: pedido.mensagem },
  ];
  let entrada = 0;
  let saida = 0;
  let pesquisas = 0;

  for (let volta = 0; volta <= MAX_RETOMAS; volta++) {
    const r = await cliente.beta.messages.parse({
      model: pedido.modelo,
      max_tokens: 16000,
      // Recusas por política: o servidor tenta o modelo de recurso por omissão.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: betaZodOutputFormat(Proposta),
      },
      system: [
        {
          type: 'text',
          text: pedido.sistema,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: ferramentas.length ? ferramentas : undefined,
      messages: mensagens,
    });
    entrada +=
      r.usage.input_tokens +
      (r.usage.cache_read_input_tokens ?? 0) +
      (r.usage.cache_creation_input_tokens ?? 0);
    saida += r.usage.output_tokens;
    pesquisas += r.usage.server_tool_use?.web_search_requests ?? 0;

    if (r.stop_reason === 'pause_turn') {
      // A pesquisa do lado do servidor parou a meio: devolve-se a volta tal
      // como veio e o servidor continua (sem mensagem "continua").
      mensagens.push({ role: 'assistant', content: r.content });
      continue;
    }
    if (r.stop_reason === 'refusal') {
      throw new ErroProposta(
        `o modelo recusou (${r.stop_details?.category ?? 'sem categoria'})`,
      );
    }
    if (r.stop_reason === 'max_tokens') {
      throw new ErroProposta('a resposta foi cortada (max_tokens)');
    }
    if (!r.parsed_output) {
      throw new ErroProposta('a resposta não veio no formato pedido');
    }
    return {
      conteudo: limparProposta(r.parsed_output),
      tokens_entrada: entrada,
      tokens_saida: saida,
      pesquisas,
    };
  }
  throw new ErroProposta(
    `a pesquisa web não terminou em ${MAX_RETOMAS + 1} voltas`,
  );
}

/**
 * Corre `fn` sobre os itens com no máximo `n` em simultâneo. Se `fn` rejeitar,
 * não começa mais nenhum, espera pelos que já correm e rejeita com esse erro
 * (os erros recuperáveis apanham-se dentro de `fn`).
 */
export async function emParalelo<T>(
  itens: T[],
  n: number,
  fn: (item: T, i: number) => Promise<void>,
): Promise<void> {
  let seguinte = 0;
  let falha: { erro: unknown } | null = null;
  const trabalhador = async () => {
    while (!falha && seguinte < itens.length) {
      const i = seguinte++;
      try {
        await fn(itens[i], i);
      } catch (erro) {
        falha ??= { erro };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, itens.length)) }, trabalhador),
  );
  if (falha) throw (falha as { erro: unknown }).erro;
}

/** Erros que não vale a pena repetir pergunta a pergunta (chave, modelo, conta). */
export function erroFatal(e: unknown): boolean {
  return (
    e instanceof Anthropic.AuthenticationError ||
    e instanceof Anthropic.PermissionDeniedError ||
    e instanceof Anthropic.NotFoundError ||
    e instanceof Anthropic.BadRequestError
  );
}
