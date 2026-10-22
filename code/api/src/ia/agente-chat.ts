import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { ErroApi } from '../common/erros.js';
import { dadosExternos, REGRA_DADOS_EXTERNOS } from './nao-confiavel.js';

type Mensagem = Anthropic.Beta.BetaMessage;
type BlocoResposta = Anthropic.Beta.BetaContentBlock;
type BlocoPedido = Anthropic.Beta.BetaContentBlockParam;
type MensagemPedido = Anthropic.Beta.BetaMessageParam;
type ResultadoFerramenta = Anthropic.Beta.BetaToolResultBlockParam;
type ParamsFluxo = BetaMessageStreamParams;
type EventoFluxo = Anthropic.Beta.BetaRawMessageStreamEvent;

/** O que o `client.beta.messages.stream()` devolve, só no que se usa (e simula nos testes). */
export interface FluxoMensagem extends AsyncIterable<EventoFluxo> {
  finalMessage(): Promise<Mensagem>;
}

export type AbrirFluxo = (
  params: ParamsFluxo,
  sinal: AbortSignal,
) => FluxoMensagem;

/** O que o turno vai mostrando a quem conversa. */
export type EventoAgente =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'ferramenta'; nome: string }
  | {
      tipo: 'resultado';
      nome: string;
      entrada: unknown;
      resultado: unknown;
      erro: boolean;
    };

export type FimTurno =
  | 'concluido' // end_turn
  | 'cortado' // max_tokens numa resposta de texto
  | 'recusa' // refusal (já depois do modelo de recurso)
  | 'limite' // demasiadas voltas de ferramentas
  | 'interrompido'; // o browser fechou a ligação

export interface ResultadoTurno {
  /** O texto final do agente (todos os blocos de texto do turno). */
  texto: string;
  fim: FimTurno;
}

export interface OpcoesTurno {
  abrir: AbrirFluxo;
  modelo: string;
  sistema: Anthropic.Beta.BetaTextBlockParam[];
  ferramentas: Anthropic.Beta.BetaToolUnion[];
  /** Histórico + a mensagem nova do munícipe (a última é `user`). */
  mensagens: MensagemPedido[];
  /** Corre uma ferramenta. Um `ErroApi` volta ao modelo com `is_error`. */
  executar(nome: string, entrada: unknown): Promise<unknown>;
  emitir(e: EventoAgente): void;
  sinal: AbortSignal;
  maxIteracoes?: number;
  esforco?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  /** Cada volta terminada (tokens para o registo de uso e o custo). */
  aoUsar?: (mensagem: Mensagem) => void;
}

export const MAX_ITERACOES = 8;

// Se o modelo recusar por política, a API tenta o modelo de recurso do servidor.
const RECURSO = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} as const;

const SEPARADOR = '\n\n';

/**
 * Um turno do agente por texto: streaming com loop manual de ferramentas.
 *
 * - stop_reason `tool_use`: corre todas as ferramentas pedidas nessa volta e
 *   devolve todos os `tool_result` numa só mensagem `user`;
 * - `pause_turn`: volta a mandar o turno do assistente para continuar;
 * - `refusal` / `max_tokens`: acaba (nunca corre ferramentas de uma volta
 *   cortada);
 * - no máximo `maxIteracoes` pedidos ao modelo por turno.
 *
 * Não grava nada: quem chama trata do histórico, cartões e citações.
 */
export async function correrTurno(o: OpcoesTurno): Promise<ResultadoTurno> {
  const mensagens = [...o.mensagens];
  const max = o.maxIteracoes ?? MAX_ITERACOES;
  const textos: string[] = [];
  let falhasJson = 0;

  for (let i = 0; i < max; i++) {
    if (o.sinal.aborted) return fim(textos, 'interrompido');

    const fluxo = o.abrir(
      {
        ...RECURSO,
        betas: [...RECURSO.betas],
        model: o.modelo,
        max_tokens: o.maxTokens ?? 16000,
        // Os resultados das ferramentas trazem texto das fontes: vão como dados.
        system: [...o.sistema, { type: 'text', text: REGRA_DADOS_EXTERNOS }],
        tools: o.ferramentas,
        tool_choice: { type: 'auto' },
        output_config: { effort: o.esforco ?? 'low' },
        // Cache automática na cauda da conversa; o system tem as suas marcas.
        cache_control: { type: 'ephemeral' },
        messages: mensagens,
      },
      o.sinal,
    );

    let mensagem: Mensagem;
    try {
      let escreveuNestaVolta = false;
      for await (const ev of fluxo) {
        if (
          ev.type === 'content_block_start' &&
          ev.content_block.type === 'tool_use'
        ) {
          o.emitir({ tipo: 'ferramenta', nome: ev.content_block.name });
        } else if (
          ev.type === 'content_block_delta' &&
          ev.delta.type === 'text_delta'
        ) {
          // Entre voltas, separa o texto novo do anterior.
          if (!escreveuNestaVolta && textos.length > 0) {
            o.emitir({ tipo: 'texto', texto: SEPARADOR });
          }
          escreveuNestaVolta = true;
          o.emitir({ tipo: 'texto', texto: ev.delta.text });
        }
      }
      mensagem = await fluxo.finalMessage();
      o.aoUsar?.(mensagem);
      falhasJson = 0;
    } catch (e) {
      if (o.sinal.aborted || e instanceof Anthropic.APIUserAbortError) {
        return fim(textos, 'interrompido');
      }
      // Com eager_input_streaming, uma entrada de ferramenta que nem é JSON
      // rejeita o finalMessage: repete-se a volta (no máximo 2 seguidas).
      if (e instanceof Anthropic.APIError || falhasJson++ >= 2) throw e;
      i--;
      continue;
    }

    const conteudo = paraEco(mensagem.content);
    const texto = textoDe(conteudo);
    if (texto) textos.push(texto);

    if (mensagem.stop_reason === 'refusal') return fim([], 'recusa');
    if (mensagem.stop_reason === 'pause_turn') {
      mensagens.push({ role: 'assistant', content: conteudo });
      continue;
    }

    const pedidos = conteudo.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use',
    );
    if (mensagem.stop_reason === 'max_tokens') {
      // Uma entrada cortada pode parecer válida: não se corre.
      return fim(textos, 'cortado');
    }
    if (mensagem.stop_reason !== 'tool_use' || pedidos.length === 0) {
      return fim(textos, 'concluido');
    }

    mensagens.push({ role: 'assistant', content: conteudo });
    const resultados: ResultadoFerramenta[] = [];
    for (const p of pedidos) {
      if (o.sinal.aborted) return fim(textos, 'interrompido');
      resultados.push(await correrFerramenta(o, p));
    }
    mensagens.push({ role: 'user', content: resultados });
  }
  return fim(textos, 'limite');
}

async function correrFerramenta(
  o: OpcoesTurno,
  p: Anthropic.Beta.BetaToolUseBlockParam,
): Promise<ResultadoFerramenta> {
  try {
    const resultado = await o.executar(p.name, p.input);
    o.emitir({
      tipo: 'resultado',
      nome: p.name,
      entrada: p.input,
      resultado,
      erro: false,
    });
    return {
      type: 'tool_result',
      tool_use_id: p.id,
      content: dadosExternos(
        'ferramenta',
        JSON.stringify(resultado ?? null),
        p.name,
      ),
    };
  } catch (e) {
    const erro = erroParaModelo(e);
    o.emitir({
      tipo: 'resultado',
      nome: p.name,
      entrada: p.input,
      resultado: erro,
      erro: true,
    });
    return {
      type: 'tool_result',
      tool_use_id: p.id,
      is_error: true,
      content: JSON.stringify(erro),
    };
  }
}

/** O erro de uma ferramenta como o modelo o lê: código estável e mensagem. */
export function erroParaModelo(e: unknown): {
  erro: { codigo: string; mensagem: string; detalhes?: unknown };
} {
  if (e instanceof ErroApi) {
    return {
      erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes },
    };
  }
  return {
    erro: {
      codigo: 'erro_interno',
      mensagem: 'A ferramenta falhou. Não tentes outra vez; passa a humano.',
    },
  };
}

/**
 * O conteúdo da resposta tal como volta ao modelo. Depois de um recurso a
 * meio (bloco `fallback`), o que vem antes da última fronteira só passa se for
 * texto: pensamento e pedidos de ferramenta desse troço ficam de fora.
 */
export function paraEco(conteudo: BlocoResposta[]): BlocoPedido[] {
  let fronteira = -1;
  conteudo.forEach((b, i) => {
    if (b.type === 'fallback') fronteira = i;
  });
  return conteudo
    .filter(
      (b, i) =>
        i >= fronteira ||
        !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type),
    )
    .map((b) => b as BlocoPedido);
}

function textoDe(conteudo: BlocoPedido[]): string {
  return conteudo
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim();
}

function fim(textos: string[], f: FimTurno): ResultadoTurno {
  return { texto: textos.join(SEPARADOR), fim: f };
}
