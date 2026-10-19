/*
 * O nosso agente em voz, por simulação de conversa no ElevenLabs: um
 * "munícipe" simulado (outro LLM) faz a pergunta ao agente de voz publicado
 * e guarda-se a transcrição e as métricas por turno.
 *
 * Documentação confirmada a 19 out. 2026:
 * - `POST /v1/convai/agents/{agent_id}/simulate-conversation` (síncrono) está
 *   DEPRECADO e é removido a 31 out. 2026. Fica como modo `simular`, só para
 *   emergências até lá.
 * - O substituto (modo por omissão, `testes`) são os testes do agente do tipo
 *   `simulation`: `POST /v1/convai/agent-testing/create` → `POST
 *   /v1/convai/agents/{agent_id}/run-tests` → `GET
 *   /v1/convai/test-invocations/{id}` até o estado sair de `pending` →
 *   `DELETE /v1/convai/agent-testing/{test_id}` (não deixar lixo na conta).
 *   A transcrição vem em `test_runs[0].agent_responses` (role, message,
 *   time_in_call_secs, tool_calls[].tool_name, conversation_turn_metrics).
 *
 * A simulação é em texto do lado do ElevenLabs (o LLM, as ferramentas e o
 * prompt do agente de voz), não em áudio: apanha o que só falha no agente de
 * voz e a latência do LLM, não a pronúncia.
 */
import { bd } from '../bd.js';
import { config } from '../config.js';
import {
  ErroAdaptador,
  type Adaptador,
  type RespostaSistema,
  type Sistema,
} from '../tipos.js';

const API = 'https://api.elevenlabs.io';

export interface OpcoesTouVoz {
  fetch?: typeof fetch;
  apiKey?: string;
  /** Intervalo entre consultas ao estado do teste. */
  consultaMs?: number;
  /** Tempo máximo por pergunta. */
  timeoutMs?: number;
}

/** Um turno da transcrição do ElevenLabs (só o que usamos). */
export interface TurnoEleven {
  role: 'user' | 'agent' | string;
  message?: string | null;
  time_in_call_secs?: number;
  tool_calls?: { tool_name?: string }[] | null;
  conversation_turn_metrics?: {
    metrics?: Record<string, { elapsed_time?: number }>;
  } | null;
}

/** O cenário do munícipe simulado: dizer a pergunta tal e qual e despedir-se. */
export function cenario(pergunta: string): string {
  return [
    'És um munícipe que liga para a linha da câmara municipal.',
    `A tua primeira frase, quando o assistente te cumprimentar, é exatamente: «${pergunta}»`,
    'Não acrescentes nada à pergunta nem dês dados pessoais.',
    'Depois de ouvires a resposta, agradece numa frase curta e despede-te.',
  ].join('\n');
}

function normal(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Da transcrição para a resposta: as falas do agente depois da pergunta (a
 * primeira fala do munícipe que a contém, senão a primeira fala do munícipe)
 * até à fala seguinte do munícipe. A saudação inicial do agente não conta.
 *
 * Latência: por turno do agente, a soma das métricas `*_ttfb` (LLM e TTS,
 * quando há) da primeira resposta; sem métricas, a diferença de
 * `time_in_call_secs` entre a pergunta e a resposta.
 */
export function mapearTranscricao(
  turnos: TurnoEleven[],
  pergunta: string,
): Omit<RespostaSistema, 'bruto'> & { encontrada: boolean } {
  const alvo = normal(pergunta);
  const doUtilizador = turnos
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.role === 'user' && (t.message ?? '').trim());
  const exata = doUtilizador.find(({ t }) => {
    const m = normal(t.message ?? '');
    return m.includes(alvo) || (m.length > 10 && alvo.includes(m));
  });
  const inicio = (exata ?? doUtilizador[0])?.i;
  if (inicio === undefined) {
    return { texto: '', latencia_ms: 0, ferramentas: [], encontrada: false };
  }
  const resposta: TurnoEleven[] = [];
  for (let i = inicio + 1; i < turnos.length; i++) {
    const t = turnos[i];
    if (t.role === 'user' && (t.message ?? '').trim()) break;
    if (t.role === 'agent') resposta.push(t);
  }
  const texto = resposta
    .map((t) => (t.message ?? '').trim())
    .filter(Boolean)
    .join('\n');
  const ferramentas: string[] = [];
  for (const t of resposta)
    for (const c of t.tool_calls ?? [])
      if (c.tool_name && !ferramentas.includes(c.tool_name))
        ferramentas.push(c.tool_name);

  let latencia_ms = 0;
  const primeira = resposta.find((t) => (t.message ?? '').trim());
  const metricas = primeira?.conversation_turn_metrics?.metrics ?? {};
  const ttfb = Object.entries(metricas)
    .filter(([k]) => k.endsWith('_ttfb'))
    .map(([, v]) => v.elapsed_time ?? 0);
  if (ttfb.length)
    latencia_ms = Math.round(ttfb.reduce((a, b) => a + b) * 1000);
  else if (primeira && typeof primeira.time_in_call_secs === 'number') {
    const t0 = turnos[inicio].time_in_call_secs ?? primeira.time_in_call_secs;
    latencia_ms = Math.max(0, (primeira.time_in_call_secs - t0) * 1000);
  }
  return { texto, latencia_ms, ferramentas, encontrada: !!exata };
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AdaptadorTouVoz implements Adaptador {
  readonly paralelo = 1;
  private agente: Promise<string> | null = null;
  private readonly f: typeof fetch;
  private readonly apiKey: string;

  constructor(
    private readonly sistema: Sistema,
    private readonly opcoes: OpcoesTouVoz = {},
  ) {
    this.f = opcoes.fetch ?? fetch;
    this.apiKey = opcoes.apiKey ?? config.elevenlabsApiKey;
  }

  pausa(): number {
    return 0;
  }

  /** `config.agent_id` do sistema, senão `agente_config.elevenlabs_agent_id` do município. */
  private async agentId(): Promise<string> {
    const c = this.sistema.config.agent_id;
    if (typeof c === 'string' && c.trim()) return c.trim();
    const slug = this.sistema.config.slug;
    const [r] = await bd.query<{ elevenlabs_agent_id: string | null }>(
      `SELECT a.elevenlabs_agent_id FROM agente_config a
       JOIN municipios m ON m.id = a.municipio_id
       WHERE m.id = $1 OR m.slug = $2
       LIMIT 1`,
      [this.sistema.municipio_id, typeof slug === 'string' ? slug : null],
    );
    if (!r?.elevenlabs_agent_id) {
      throw new ErroAdaptador(
        `"${this.sistema.nome}": sem agente do ElevenLabs (config.agent_id ou agente_config.elevenlabs_agent_id).`,
        true,
      );
    }
    return r.elevenlabs_agent_id;
  }

  async perguntar(p: {
    texto: string;
    idioma: string;
  }): Promise<RespostaSistema> {
    if (!this.apiKey) {
      throw new ErroAdaptador(
        'Falta ELEVENLABS_API_KEY no .env do avaliador (necessária para o tou-voz).',
        true,
      );
    }
    this.agente ??= this.agentId();
    const agente = await this.agente;
    const t0 = Date.now();
    const modo = this.sistema.config.api === 'simular' ? 'simular' : 'testes';
    const { turnos, bruto } =
      modo === 'simular'
        ? await this.simular(agente, p)
        : await this.testar(agente, p);
    const r = mapearTranscricao(turnos, p.texto);
    if (!r.texto) {
      throw new ErroAdaptador(
        'A simulação não trouxe resposta do agente à pergunta.',
      );
    }
    return {
      texto: r.texto,
      latencia_ms: r.latencia_ms || Date.now() - t0,
      ferramentas: r.ferramentas,
      bruto: { modo, agente, pergunta_encontrada: r.encontrada, ...bruto },
    };
  }

  private async pedir<T>(
    metodo: string,
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.f(`${API}${caminho}`, {
        method: metodo,
        headers: {
          'xi-api-key': this.apiKey,
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new ErroAdaptador(
        `ElevenLabs inacessível: ${(e as Error).message}`,
      );
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      // Chave inválida ou sem permissões: as seguintes falhariam igual.
      throw new ErroAdaptador(
        `ElevenLabs ${metodo} ${caminho}: HTTP ${res.status} ${txt.slice(0, 300)}`,
        res.status === 401 || res.status === 403,
      );
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  /** Modo por omissão: teste `simulation` criado, corrido e apagado. */
  private async testar(
    agente: string,
    p: { texto: string; idioma: string },
  ): Promise<{ turnos: TurnoEleven[]; bruto: Record<string, unknown> }> {
    const turnosMax = Number(this.sistema.config.turnos_max) || 3;
    const teste = await this.pedir<{ id: string }>(
      'POST',
      '/v1/convai/agent-testing/create',
      {
        name: `avaliador ${new Date().toISOString()}`,
        type: 'simulation',
        simulation_scenario: cenario(p.texto),
        simulation_max_turns: turnosMax,
        // Obrigatório pela API; o veredicto é do nosso juiz, não deste.
        success_conditions: ['O agente respondeu à pergunta do munícipe.'],
      },
    );
    try {
      let inv = await this.pedir<Invocacao>(
        'POST',
        `/v1/convai/agents/${encodeURIComponent(agente)}/run-tests`,
        { tests: [{ test_id: teste.id }] },
      );
      const limite = Date.now() + (this.opcoes.timeoutMs ?? 180_000);
      while ((inv.test_runs?.[0]?.status ?? 'pending') === 'pending') {
        if (Date.now() > limite) {
          throw new ErroAdaptador(
            'A simulação no ElevenLabs não terminou a tempo.',
          );
        }
        await dormir(this.opcoes.consultaMs ?? 3_000);
        inv = await this.pedir<Invocacao>(
          'GET',
          `/v1/convai/test-invocations/${encodeURIComponent(inv.id)}`,
        );
      }
      const run = inv.test_runs[0];
      if (run.status === 'cancelled') {
        throw new ErroAdaptador('A simulação foi cancelada no ElevenLabs.');
      }
      return {
        turnos: run.agent_responses ?? [],
        bruto: {
          test_invocation_id: inv.id,
          test_run_id: run.test_run_id,
          estado: run.status,
          transcricao: run.agent_responses ?? [],
        },
      };
    } finally {
      await this.pedir(
        'DELETE',
        `/v1/convai/agent-testing/${encodeURIComponent(teste.id)}`,
      ).catch(() => undefined);
    }
  }

  /** Modo `simular` (deprecado, removido a 31 out. 2026). */
  private async simular(
    agente: string,
    p: { texto: string; idioma: string },
  ): Promise<{ turnos: TurnoEleven[]; bruto: Record<string, unknown> }> {
    const r = await this.pedir<{
      simulated_conversation: TurnoEleven[];
      analysis?: unknown;
    }>(
      'POST',
      `/v1/convai/agents/${encodeURIComponent(agente)}/simulate-conversation`,
      {
        simulation_specification: {
          simulated_user_config: {
            first_message: p.texto,
            language: p.idioma.slice(0, 2) || 'pt',
            prompt: { prompt: cenario(p.texto) },
          },
        },
        new_turns_limit: Number(this.sistema.config.turnos_max) || 4,
      },
    );
    return {
      turnos: r.simulated_conversation ?? [],
      bruto: { transcricao: r.simulated_conversation, analise: r.analysis },
    };
  }
}

interface Invocacao {
  id: string;
  test_runs: {
    test_run_id: string;
    status: 'pending' | 'passed' | 'failed' | 'cancelled';
    agent_responses?: TurnoEleven[] | null;
  }[];
}
