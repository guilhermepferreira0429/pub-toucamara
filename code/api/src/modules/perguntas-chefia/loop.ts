import Anthropic from '@anthropic-ai/sdk';
import { AbrirFluxo, paraEco } from '../../ia/agente-chat.js';
import {
  ConsultaGuardada,
  paraModelo,
  RESPONDER,
  Resolucao,
  RespostaFinal,
} from './resposta.js';

type MensagemPedido = Anthropic.Beta.BetaMessageParam;
type ResultadoFerramenta = Anthropic.Beta.BetaToolResultBlockParam;
type PedidoFerramenta = Anthropic.Beta.BetaToolUseBlockParam;

export type FimPergunta =
  | 'concluido' // o modelo chamou `responder` e a resposta resolveu-se
  | 'limite' // demasiadas voltas
  | 'recusa' // refusal (já depois do modelo de recurso)
  | 'cortado' // max_tokens
  | 'interrompido'; // a ligação fechou

/** O que vai acontecendo, para o SSE. */
export type EventoPergunta =
  | {
      tipo: 'consulta_inicio';
      id: string;
      ferramenta: string;
      parametros: unknown;
    }
  | { tipo: 'consulta_fim'; consulta: ConsultaGuardada };

export interface OpcoesPergunta {
  abrir: AbrirFluxo;
  modelo: string;
  sistema: Anthropic.Beta.BetaTextBlockParam[];
  ferramentas: Anthropic.Beta.BetaToolUnion[];
  /** A mensagem do pedido (hoje + pergunta). */
  mensagem: string;
  /** Corre uma consulta. Não lança: o erro fica guardado na consulta. */
  consultar(
    nome: string,
    entrada: unknown,
    inicio: (id: string) => void,
  ): Promise<ConsultaGuardada>;
  /** Valida e resolve a resposta final contra as consultas guardadas. */
  responder(entrada: unknown): Resolucao;
  emitir(e: EventoPergunta): void;
  sinal: AbortSignal;
  maxIteracoes?: number;
  esforco?: 'low' | 'medium' | 'high';
}

export interface ResultadoPergunta {
  fim: FimPergunta;
  resposta: RespostaFinal | null;
  /** Pedidos feitos ao modelo. */
  voltas: number;
  /** Entrada + saída (com cache), todas as voltas. */
  tokens: number;
}

export const MAX_VOLTAS = 6;

// Se o modelo recusar por política, a API tenta o modelo de recurso do servidor.
const RECURSO = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} as const;

const PEDIR_RESPOSTA =
  'Dá agora a resposta final com a ferramenta responder (sem_dados = true se não tens os dados).';

/**
 * Uma pergunta da chefia: loop manual de ferramentas com streaming. Acaba
 * quando o modelo chama `responder` com referências válidas; as consultas
 * de uma volta correm em paralelo e voltam todas numa só mensagem `user`.
 * Erros (parâmetros inválidos, tipo desconhecido, referências erradas na
 * resposta) voltam ao modelo como `is_error` para ele corrigir. No máximo
 * `maxIteracoes` pedidos ao modelo.
 */
export async function correrPergunta(
  o: OpcoesPergunta,
): Promise<ResultadoPergunta> {
  const mensagens: MensagemPedido[] = [{ role: 'user', content: o.mensagem }];
  const max = o.maxIteracoes ?? MAX_VOLTAS;
  let tokens = 0;
  let voltas = 0;
  const fim = (f: FimPergunta, resposta: RespostaFinal | null = null) => ({
    fim: f,
    resposta,
    voltas,
    tokens,
  });

  while (voltas < max) {
    if (o.sinal.aborted) return fim('interrompido');
    voltas++;
    const fluxo = o.abrir(
      {
        ...RECURSO,
        betas: [...RECURSO.betas],
        model: o.modelo,
        max_tokens: 16000,
        system: o.sistema,
        tools: o.ferramentas,
        tool_choice: { type: 'auto' },
        output_config: { effort: o.esforco ?? 'medium' },
        cache_control: { type: 'ephemeral' },
        messages: mensagens,
      },
      o.sinal,
    );

    let mensagem: Anthropic.Beta.BetaMessage;
    try {
      // Só interessa a mensagem final (o texto do modelo não se mostra: a
      // resposta sai do `responder`, já verificada).
      mensagem = await fluxo.finalMessage();
    } catch (e) {
      if (o.sinal.aborted || e instanceof Anthropic.APIUserAbortError) {
        return fim('interrompido');
      }
      throw e;
    }
    const u = mensagem.usage;
    tokens +=
      (u?.input_tokens ?? 0) +
      (u?.output_tokens ?? 0) +
      (u?.cache_read_input_tokens ?? 0) +
      (u?.cache_creation_input_tokens ?? 0);

    if (mensagem.stop_reason === 'refusal') return fim('recusa');
    const conteudo = paraEco(mensagem.content);
    if (mensagem.stop_reason === 'pause_turn') {
      mensagens.push({ role: 'assistant', content: conteudo });
      continue;
    }
    // Uma entrada cortada pode parecer válida: não se corre nada.
    if (mensagem.stop_reason === 'max_tokens') return fim('cortado');

    const pedidos = conteudo.filter(
      (b): b is PedidoFerramenta => b.type === 'tool_use',
    );
    mensagens.push({ role: 'assistant', content: conteudo });
    if (pedidos.length === 0) {
      // Acabou só com texto: os números têm de vir pela ferramenta.
      mensagens.push({ role: 'user', content: PEDIR_RESPOSTA });
      continue;
    }

    const consultas = pedidos.filter((p) => p.name !== RESPONDER);
    const respostas = pedidos.filter((p) => p.name === RESPONDER);

    const feitas = await Promise.all(
      consultas.map((p) =>
        o
          .consultar(p.name, p.input, (id) =>
            o.emitir({
              tipo: 'consulta_inicio',
              id,
              ferramenta: p.name,
              parametros: p.input,
            }),
          )
          .then((c) => {
            o.emitir({ tipo: 'consulta_fim', consulta: c });
            return c;
          }),
      ),
    );
    const resultados: ResultadoFerramenta[] = feitas.map((c, i) => ({
      type: 'tool_result',
      tool_use_id: consultas[i].id,
      ...(c.erro ? { is_error: true } : {}),
      content: JSON.stringify(paraModelo(c)),
    }));

    let final: RespostaFinal | null = null;
    for (const p of respostas) {
      const r: Resolucao | null = final ? null : o.responder(p.input);
      if (r && r.ok) final = r.resposta;
      const erros = r && !r.ok ? r.erros : null;
      resultados.push({
        type: 'tool_result',
        tool_use_id: p.id,
        ...(erros ? { is_error: true } : {}),
        content: erros ? JSON.stringify({ erros }) : 'ok',
      });
    }
    if (final) return fim('concluido', final);
    mensagens.push({ role: 'user', content: resultados });
  }
  return fim('limite');
}
