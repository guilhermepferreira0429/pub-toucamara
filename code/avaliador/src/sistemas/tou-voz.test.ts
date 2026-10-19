import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ErroAdaptador, type Sistema } from '../tipos.js';
import { AdaptadorTouVoz, cenario, mapearTranscricao } from './tou-voz.js';

const FIXTURES = new URL('../../test/fixtures/', import.meta.url);
const invocacao = JSON.parse(
  readFileSync(new URL('elevenlabs-invocacao.json', FIXTURES), 'utf8'),
);
const turnos = invocacao.test_runs[0].agent_responses;
const PERGUNTA = 'Quero fazer obras na cozinha, preciso de licença?';

test('mapearTranscricao: falas do agente entre a pergunta e a fala seguinte do munícipe', () => {
  const r = mapearTranscricao(turnos, PERGUNTA);
  assert.equal(r.encontrada, true);
  assert.equal(
    r.texto,
    'Deixe-me ver isso.\nSe for só no interior, sem mexer na estrutura, não precisa de licença. Se mexer em paredes-mestras, precisa de comunicação prévia.',
  );
  assert.deepEqual(r.ferramentas, ['procurar_conhecimento', 'encaminhar']);
  // LLM 0,412 s + TTS 0,188 s da primeira resposta.
  assert.equal(r.latencia_ms, 600);
});

test('mapearTranscricao: sem métricas usa time_in_call_secs; sem munícipe dá vazio', () => {
  const sem = turnos.map((t: Record<string, unknown>) => ({
    ...t,
    conversation_turn_metrics: null,
  }));
  assert.equal(mapearTranscricao(sem, PERGUNTA).latencia_ms, 2000);
  // O munícipe simulado reformulou: usa a primeira fala dele.
  const outra = mapearTranscricao(sem, 'Pergunta que ninguém fez');
  assert.equal(outra.encontrada, false);
  assert.match(outra.texto, /^Deixe-me ver isso/);
  assert.equal(mapearTranscricao([turnos[0]], PERGUNTA).texto, '');
});

const sistema: Sistema = {
  id: 's',
  nome: 'Tou, Câmara? · teste · voz',
  municipio_id: null,
  adaptador: 'tou-voz',
  url: null,
  config: { agent_id: 'agent_01' },
  nosso: true,
};

test('tou-voz: sem ELEVENLABS_API_KEY → erro fatal claro', async () => {
  const a = new AdaptadorTouVoz(sistema, { apiKey: '' });
  await assert.rejects(
    a.perguntar({ texto: PERGUNTA, idioma: 'pt-PT' }),
    (e) => {
      assert.ok(e instanceof ErroAdaptador);
      assert.equal(e.fatal, true);
      assert.match(e.message, /ELEVENLABS_API_KEY/);
      return true;
    },
  );
});

test('tou-voz: cria o teste, corre, consulta até terminar e apaga-o', async () => {
  const chamadas: string[] = [];
  let consultas = 0;
  const falso = (async (url: string, init: RequestInit) => {
    const caminho = new URL(url).pathname;
    chamadas.push(`${init.method} ${caminho}`);
    assert.equal((init.headers as Record<string, string>)['xi-api-key'], 'k');
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200 });
    if (caminho === '/v1/convai/agent-testing/create') {
      const corpo = JSON.parse(String(init.body));
      assert.equal(corpo.type, 'simulation');
      assert.equal(corpo.simulation_scenario, cenario(PERGUNTA));
      return json({ id: 'test_01' });
    }
    if (caminho === '/v1/convai/agents/agent_01/run-tests')
      return json({
        id: 'inv_01',
        test_runs: [{ test_run_id: 'run_01', status: 'pending' }],
      });
    if (caminho === '/v1/convai/test-invocations/inv_01') {
      consultas++;
      return consultas < 2
        ? json({
            id: 'inv_01',
            test_runs: [{ test_run_id: 'run_01', status: 'pending' }],
          })
        : json(invocacao);
    }
    if (caminho === '/v1/convai/agent-testing/test_01')
      return new Response(null, { status: 204 });
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  const a = new AdaptadorTouVoz(sistema, {
    apiKey: 'k',
    fetch: falso,
    consultaMs: 1,
  });
  const r = await a.perguntar({ texto: PERGUNTA, idioma: 'pt-PT' });
  assert.match(r.texto, /comunicação prévia/);
  assert.equal(r.latencia_ms, 600);
  assert.deepEqual(r.ferramentas, ['procurar_conhecimento', 'encaminhar']);
  assert.deepEqual(chamadas, [
    'POST /v1/convai/agent-testing/create',
    'POST /v1/convai/agents/agent_01/run-tests',
    'GET /v1/convai/test-invocations/inv_01',
    'GET /v1/convai/test-invocations/inv_01',
    'DELETE /v1/convai/agent-testing/test_01',
  ]);
});
