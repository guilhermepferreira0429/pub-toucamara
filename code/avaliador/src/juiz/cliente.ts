/*
 * Chamadas ao Claude para o juiz. Atrás de uma interface para os testes
 * usarem um cliente simulado (não há chamadas reais nos testes).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';
import type { Uso } from './custo.js';
import {
  PROMPT_SISTEMA,
  SaidaJuizSchema,
  mensagemJuiz,
  type EntradaJuiz,
  type SaidaJuiz,
} from './rubrica.js';

export type ResultadoChamada =
  | { ok: true; saida: SaidaJuiz; uso: Uso }
  | { ok: false; erro: string; uso?: Uso };

export interface ClienteJuiz {
  readonly modelo: string;
  avaliar(entrada: EntradaJuiz): Promise<ResultadoChamada>;
  /** Message Batches API: metade do preço, sem pressa. Chave = id do pedido. */
  avaliarLote(
    pedidos: { id: string; entrada: EntradaJuiz }[],
    aoEsperar?: (estado: string) => void,
  ): Promise<Map<string, ResultadoChamada>>;
}

/*
 * Parâmetros iguais em chamadas diretas e em lote: o mesmo pedido tem de dar
 * a mesma avaliação, venha por onde vier. Sem `fallbacks`: um juiz que muda
 * de modelo a meio deixava de ser o mesmo juiz para todos; uma recusa fica
 * por avaliar e aparece no fim.
 */
export function parametrosJuiz(
  modelo: string,
  entrada: EntradaJuiz,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: modelo,
    max_tokens: 16000,
    // Prompt de sistema fixo, em cache: é igual em todas as avaliações.
    system: [
      {
        type: 'text',
        text: PROMPT_SISTEMA,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(SaidaJuizSchema),
    },
    messages: [{ role: 'user', content: mensagemJuiz(entrada) }],
  };
}

function usoDe(u: Anthropic.Usage): Uso {
  return {
    entrada: u.input_tokens,
    cache_escrita: u.cache_creation_input_tokens ?? 0,
    cache_leitura: u.cache_read_input_tokens ?? 0,
    saida: u.output_tokens,
  };
}

/** Lê a saída estruturada de uma mensagem (direta ou do lote). */
export function lerMensagem(m: Anthropic.Message): ResultadoChamada {
  const uso = usoDe(m.usage);
  if (m.stop_reason === 'refusal')
    return { ok: false, erro: 'o modelo recusou avaliar', uso };
  if (m.stop_reason === 'max_tokens')
    return { ok: false, erro: 'resposta do juiz cortada (max_tokens)', uso };
  const texto = m.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
  try {
    const r = SaidaJuizSchema.safeParse(JSON.parse(texto));
    if (!r.success)
      return { ok: false, erro: `saída inválida: ${r.error.message}`, uso };
    return { ok: true, saida: r.data, uso };
  } catch {
    return { ok: false, erro: 'saída do juiz não é JSON', uso };
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clienteAnthropic(): ClienteJuiz {
  if (!config.ia.apiKey)
    throw new Error(
      'Falta ANTHROPIC_API_KEY no .env do avaliador: sem chave não há juiz. (Executar continua a funcionar; avaliar não.)',
    );
  const client = new Anthropic({ apiKey: config.ia.apiKey });
  const modelo = config.ia.modelo;

  return {
    modelo,
    async avaliar(entrada) {
      try {
        const m = await client.messages.create(parametrosJuiz(modelo, entrada));
        return lerMensagem(m);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError)
          throw new Error('ANTHROPIC_API_KEY inválida.');
        if (e instanceof Anthropic.APIError)
          return { ok: false, erro: `API ${e.status}: ${e.message}` };
        throw e;
      }
    },

    async avaliarLote(pedidos, aoEsperar) {
      const lote = await client.messages.batches.create({
        requests: pedidos.map((p) => ({
          custom_id: p.id,
          params: parametrosJuiz(modelo, p.entrada),
        })),
      });
      aoEsperar?.(`lote ${lote.id} criado (${pedidos.length} pedidos)`);
      let estado = lote;
      while (estado.processing_status !== 'ended') {
        await esperar(30_000);
        estado = await client.messages.batches.retrieve(lote.id);
        const c = estado.request_counts;
        aoEsperar?.(
          `lote ${lote.id}: ${estado.processing_status} · a processar ${c.processing}, feitos ${c.succeeded}, erros ${c.errored}`,
        );
      }
      const res = new Map<string, ResultadoChamada>();
      // Os resultados chegam por qualquer ordem: chave pelo custom_id.
      for await (const r of await client.messages.batches.results(lote.id)) {
        if (r.result.type === 'succeeded')
          res.set(r.custom_id, lerMensagem(r.result.message));
        else
          res.set(r.custom_id, { ok: false, erro: `lote: ${r.result.type}` });
      }
      return res;
    },
  };
}
