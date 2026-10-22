/* Depuração: um teste de simulação no ElevenLabs para uma pergunta, com o JSON todo. */
import { bd } from '../bd.js';
import { config } from '../config.js';
const API = 'https://api.elevenlabs.io';
const k = config.elevenlabsApiKey;
async function pedir(m: string, c: string, corpo?: unknown) {
  const r = await fetch(API + c, { method: m, headers: { 'xi-api-key': k, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const t = await r.text();
  console.log(`--- ${m} ${c} → ${r.status}\n${t.slice(0, 6000)}`);
  return t ? JSON.parse(t) : null;
}
const [a] = await bd.query<{ id: string }>(`SELECT elevenlabs_agent_id AS id FROM agente_config WHERE elevenlabs_agent_id IS NOT NULL LIMIT 1`);
const agente = a.id;
const pergunta = process.argv[2] ?? 'A que horas abre o balcão de atendimento?';
const teste = await pedir('POST', '/v1/convai/agent-testing/create', {
  name: 'depurar ' + new Date().toISOString(), type: 'simulation',
  simulation_scenario: `És um munícipe que liga para a linha da câmara municipal.\nA tua primeira frase é exatamente: «${pergunta}»\nDepois agradece e despede-te.`,
  simulation_max_turns: 3, success_conditions: ['O agente respondeu à pergunta do munícipe.'],
});
try {
  let inv = await pedir('POST', `/v1/convai/agents/${agente}/run-tests`, { tests: [{ test_id: teste.id }] });
  for (let i = 0; i < 60 && (inv.test_runs?.[0]?.status ?? 'pending') === 'pending'; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`${API}/v1/convai/test-invocations/${inv.id}`, { headers: { 'xi-api-key': k } });
    inv = await r.json();
  }
  console.log('=== FINAL'); console.log(JSON.stringify(inv, null, 1).slice(0, 12000));
} finally {
  await pedir('DELETE', `/v1/convai/agent-testing/${teste.id}`);
  process.exit(0);
}
