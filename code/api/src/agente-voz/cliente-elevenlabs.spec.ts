/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- o ElevenLabs falso guarda JSON solto (`any`); as asserções verificam a forma. */
import {
  aplicar,
  ClienteElevenLabs,
  Desejado,
  diferencas,
  eNossa,
  FerramentaRemota,
  planear,
  semAlteracoes,
} from './cliente-elevenlabs.js';
import { FerramentaEl, resolver } from './configuracao.js';

const API = 'https://api.toucamara.pt';

function ferramenta(nome: string, descricao = `Faz ${nome}.`): FerramentaEl {
  return {
    type: 'webhook',
    name: nome,
    description: descricao,
    response_timeout_secs: 20,
    tool_error_handling_mode: 'passthrough',
    api_schema: {
      url: `\${API_URL}/v1/agent/tools/${nome}`,
      method: 'POST',
      content_type: 'application/json',
      request_headers: {
        'X-Agente-Segredo': {
          secret_id: '${SEGREDO:toucamara_agente_segredo}',
        },
        'X-Municipio': '${MUNICIPIO}',
      },
      request_body_schema: {
        type: 'object',
        description: `Parâmetros de ${nome}.`,
        properties: { morada: { type: 'string', description: 'A morada.' } },
        required: ['morada'],
      },
    },
  };
}

const resolucao = {
  apiUrl: API,
  municipio: 'guimaraes',
  segredos: new Map([['toucamara_agente_segredo', 'seg_123']]),
};

function desejado(nomes: string[], prompt = 'És o agente.'): Desejado {
  return {
    ferramentas: resolver(
      nomes.map((n) => ferramenta(n)),
      resolucao,
    ),
    prompt,
    agente: {
      conversation_config: { agent: { first_message: 'Olá.', language: 'pt' } },
      platform_settings: {},
    },
  };
}

/** Um ElevenLabs em memória: devolve os valores por omissão que a API real acrescenta. */
class ElevenLabsFalso {
  ferramentas = new Map<string, FerramentaRemota>();
  agente: Record<string, any> = {
    agent_id: 'ag_1',
    conversation_config: {
      agent: {
        first_message: 'Olá antigo.',
        language: 'en',
        prompt: {
          prompt: 'Prompt à mão.',
          llm: 'gemini-2.5-flash',
          tool_ids: [] as string[],
          tools: [],
        },
      },
      tts: { voice_id: 'voz_x' },
    },
    platform_settings: { widget: { variant: 'full' } },
  };
  pedidos: { metodo: string; caminho: string; corpo?: any }[] = [];
  private seq = 0;

  juntar(nome: string, url: string, noAgente = true): string {
    const id = `tool_${++this.seq}`;
    this.ferramentas.set(id, {
      id,
      tool_config: {
        type: 'webhook',
        name: nome,
        description: 'à mão',
        api_schema: { url, method: 'POST' },
      },
    });
    if (noAgente)
      this.agente.conversation_config.agent.prompt.tool_ids.push(id);
    return id;
  }

  private comOmissoes(cfg: any) {
    return {
      ...cfg,
      disable_interruptions: false,
      assignments: [],
      api_schema: {
        ...cfg.api_schema,
        query_params_schema: null,
        request_body_schema: cfg.api_schema.request_body_schema && {
          ...cfg.api_schema.request_body_schema,
          properties: Object.fromEntries(
            Object.entries(cfg.api_schema.request_body_schema.properties).map(
              ([k, v]: [string, any]) => [
                k,
                {
                  ...v,
                  dynamic_variable: '',
                  constant_value: '',
                  is_system_provided: false,
                },
              ],
            ),
          ),
        },
      },
    };
  }

  buscar = (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const metodo = init.method ?? 'GET';
    const corpo = init.body ? JSON.parse(init.body as string) : undefined;
    this.pedidos.push({ metodo, caminho: u.pathname, corpo });
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(
      'chave',
    );
    const ok = (v: unknown) =>
      Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
    const p = u.pathname;
    if (metodo === 'GET' && p === '/v1/convai/tools') {
      return ok({ tools: [...this.ferramentas.values()], has_more: false });
    }
    if (metodo === 'POST' && p === '/v1/convai/tools') {
      const id = `tool_${++this.seq}`;
      const f = { id, tool_config: this.comOmissoes(corpo.tool_config) };
      this.ferramentas.set(id, f);
      return ok(f);
    }
    const t = p.match(/^\/v1\/convai\/tools\/(.+)$/);
    if (t && metodo === 'PATCH') {
      const f = { id: t[1], tool_config: this.comOmissoes(corpo.tool_config) };
      this.ferramentas.set(t[1], f);
      return ok(f);
    }
    if (p === '/v1/convai/agents/ag_1' && metodo === 'GET')
      return ok(this.agente);
    if (p === '/v1/convai/agents/ag_1' && metodo === 'PATCH') {
      this.agente = { ...this.agente, ...corpo };
      return ok(this.agente);
    }
    if (p === '/v1/convai/secrets' && metodo === 'GET') {
      return ok({
        secrets: [{ secret_id: 'seg_123', name: 'toucamara_agente_segredo' }],
      });
    }
    return Promise.resolve(new Response('não há', { status: 404 }));
  };

  escritas() {
    return this.pedidos.filter((p) => p.metodo !== 'GET');
  }
}

async function correr(el: ElevenLabsFalso, d: Desejado, confirmar: boolean) {
  const c = new ClienteElevenLabs('chave', el.buscar, 'https://el.falso');
  const remotas = await c.ferramentas();
  const agente = await c.agente('ag_1');
  const plano = planear(d, remotas, agente);
  // O script só aplica com --confirmar (ver scripts/agente-voz.ts).
  const r = confirmar
    ? await aplicar(c, plano, d, remotas, 'ag_1', agente)
    : null;
  return { plano, r };
}

describe('cliente do ElevenLabs', () => {
  it('reconhece as nossas pelo URL /v1/agent/tools/{nome}', () => {
    const f = (name: string, url: string): FerramentaRemota => ({
      id: 'x',
      tool_config: { type: 'webhook', name, api_schema: { url } },
    });
    expect(
      eNossa(f('marcar', 'https://x.ngrok.app/v1/agent/tools/marcar')),
    ).toBe(true);
    expect(eNossa(f('marcar', 'https://outro.pt/marcar'))).toBe(false);
    expect(eNossa(f('marcar', 'https://x.pt/v1/agent/tools/ver_vagas'))).toBe(
      false,
    );
    expect(
      eNossa({ id: 'y', tool_config: { type: 'system', name: 'end_call' } }),
    ).toBe(false);
  });

  it('compara só o que nós definimos, mas não aceita propriedades a mais', () => {
    expect(
      diferencas({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x', d: 2 }, e: 3 }),
    ).toEqual([]);
    expect(
      diferencas({ properties: { a: 1 } }, { properties: { a: 1, b: 2 } }),
    ).toEqual(['properties.b (a mais)']);
    expect(
      diferencas({ required: ['a', 'b'] }, { required: ['b', 'a'] }),
    ).toEqual([]);
    expect(
      diferencas({ description: 'novo' }, { description: 'velho' }),
    ).toEqual(['description']);
  });

  it('diff: em falta, alteradas, conflitos com as alheias e obsoletas', async () => {
    const el = new ElevenLabsFalso();
    el.juntar('marcar', 'https://antigo.ngrok.app/v1/agent/tools/marcar');
    el.juntar('ver_vagas', 'https://outro-sistema.pt/vagas');
    el.juntar('end_call_custom', 'https://outro-sistema.pt/fim');
    el.juntar('ferramenta_velha', `${API}/v1/agent/tools/ferramenta_velha`);
    const { plano } = await correr(
      el,
      desejado(['marcar', 'ver_vagas', 'procurar_conhecimento']),
      false,
    );
    expect(plano.criar.map((f) => f.name)).toEqual(['procurar_conhecimento']);
    expect(plano.atualizar.map((a) => a.ferramenta.name)).toEqual(['marcar']);
    expect(plano.atualizar[0].campos).toContain('description');
    expect(plano.conflitos.map((c) => c.nome)).toEqual(['ver_vagas']);
    expect(plano.obsoletas.map((o) => o.nome)).toEqual(['ferramenta_velha']);
    expect(plano.porDesligar).toEqual(['ferramenta_velha']);
    expect(plano.alheiasNoAgente.map((a) => a.nome).sort()).toEqual([
      'end_call_custom',
      'ver_vagas',
    ]);
    expect(plano.prompt?.igual).toBe(false);
    expect(plano.agente).toEqual([
      'conversation_config.agent.first_message',
      'conversation_config.agent.language',
    ]);
    expect(semAlteracoes(plano)).toBe(false);
  });

  it('sem --confirmar não escreve nada', async () => {
    const el = new ElevenLabsFalso();
    await correr(el, desejado(['marcar']), false);
    expect(el.escritas()).toEqual([]);
  });

  it('sincronizar: cria, atualiza, liga ao agente e não toca nas alheias', async () => {
    const el = new ElevenLabsFalso();
    const marcar = el.juntar(
      'marcar',
      'https://antigo.ngrok.app/v1/agent/tools/marcar',
    );
    const alheia = el.juntar('ver_vagas', 'https://outro-sistema.pt/vagas');
    const velha = el.juntar(
      'ferramenta_velha',
      `${API}/v1/agent/tools/ferramenta_velha`,
    );
    const d = desejado(
      ['marcar', 'ver_vagas', 'procurar_conhecimento'],
      'Prompt novo.',
    );
    const { r } = await correr(el, d, true);
    expect(r!.criadas).toEqual(['procurar_conhecimento']);
    expect(r!.atualizadas).toEqual(['marcar']);

    // Nada apagado; as alheias ficam iguais.
    expect(el.pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);
    expect(el.ferramentas.get(alheia)!.tool_config.description).toBe('à mão');
    expect(el.ferramentas.has(velha)).toBe(true);
    expect(el.escritas().filter((p) => p.caminho.endsWith(alheia))).toEqual([]);

    // A nossa passou a apontar para a API certa, com o segredo por id.
    const api = el.ferramentas.get(marcar)!.tool_config.api_schema as any;
    expect(api.url).toBe(`${API}/v1/agent/tools/marcar`);
    expect(api.request_headers['X-Agente-Segredo']).toEqual({
      secret_id: 'seg_123',
    });
    expect(api.request_headers['X-Municipio']).toBe('guimaraes');

    // O agente: alheia mantida, obsoleta fora, nossas dentro; prompt e o resto preservados.
    const prompt = el.agente.conversation_config.agent.prompt;
    expect(prompt.prompt).toBe('Prompt novo.');
    expect(prompt.llm).toBe('gemini-2.5-flash');
    expect(prompt.tools).toBeUndefined();
    expect(prompt.tool_ids).toContain(alheia);
    expect(prompt.tool_ids).toContain(marcar);
    expect(prompt.tool_ids).not.toContain(velha);
    expect(prompt.tool_ids).toHaveLength(3);
    expect(el.agente.conversation_config.agent.first_message).toBe('Olá.');
    expect(el.agente.conversation_config.tts.voice_id).toBe('voz_x');
    expect(el.agente.platform_settings.widget).toEqual({ variant: 'full' });
  });

  it('é idempotente: a segunda vez não há nada a mudar nem a escrever', async () => {
    const el = new ElevenLabsFalso();
    el.juntar('marcar', 'https://antigo.ngrok.app/v1/agent/tools/marcar');
    el.juntar('end_call_custom', 'https://outro-sistema.pt/fim');
    const d = desejado(['marcar', 'procurar_conhecimento']);
    await correr(el, d, true);
    const n = el.escritas().length;
    const { plano } = await correr(el, d, false);
    expect(semAlteracoes(plano)).toBe(true);
    expect(plano.iguais.sort()).toEqual(['marcar', 'procurar_conhecimento']);
    // Mesmo aplicando outra vez, não cria duplicadas.
    const { r } = await correr(el, d, true);
    expect(r!.criadas).toEqual([]);
    expect(r!.atualizadas).toEqual([]);
    expect(
      [...el.ferramentas.values()].filter(
        (f) => f.tool_config.name === 'procurar_conhecimento',
      ),
    ).toHaveLength(1);
    expect(el.escritas().length).toBe(n + 1); // só o PATCH do agente, igual
  });

  it('resolver troca os marcadores, tira os null e recusa sem o segredo', () => {
    expect(
      resolver(
        {
          url: '${API_URL}/x',
          m: '${MUNICIPIO}',
          s: { secret_id: '${SEGREDO:toucamara_agente_segredo}' },
          n: null,
          _nota: 'x',
        },
        resolucao,
      ),
    ).toEqual({ url: `${API}/x`, m: 'guimaraes', s: { secret_id: 'seg_123' } });
    expect(() => resolver({ s: '${SEGREDO:outro}' }, resolucao)).toThrow(
      /Falta o segredo "outro"/,
    );
  });
});
