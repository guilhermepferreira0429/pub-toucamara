import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../config.js';
import type { Pergunta } from '../tipos.js';
import { comandos } from './comandos.js';
import { dominiosOficiais } from './fontes.js';
import {
  emParalelo,
  limparProposta,
  mensagemPergunta,
  promptSistema,
  proporGabarito,
  type ClienteIA,
} from './propor.js';

const pergunta: Pergunta = {
  id: 'p1',
  conjunto_id: 'c1',
  ordem: 69,
  categoria: 'Água e saneamento',
  texto: 'Estou sem água em casa, para onde ligo?',
  idioma: 'pt-PT',
  comportamento: 'encaminhar',
  entidade_esperada: 'Vimágua',
  nota: null,
};

const proposta = {
  resposta: ' Ligue para a Vimágua, avarias 800 910 410. ',
  factos_obrigatorios: ['Vimágua', ' vimágua ', '800 910 410', ''],
  factos_proibidos: ['Águas de Guimarães'],
  fontes: [
    { titulo: 'Vimágua', url: 'https://www.vimagua.pt/contactos' },
    { titulo: 'repetida', url: 'https://www.vimagua.pt/contactos' },
    { titulo: 'sem url', url: 'vimagua.pt' },
  ],
};

type Resposta = {
  stop_reason: string;
  parsed_output: unknown;
  content: unknown[];
  stop_details?: { category: string } | null;
  usage: Record<string, unknown>;
};

/** Cliente simulado: devolve as respostas pela ordem e guarda os pedidos. */
function simulado(respostas: Resposta[]) {
  const pedidos: Record<string, unknown>[] = [];
  const cliente = {
    beta: {
      messages: {
        parse: async (p: Record<string, unknown>) => {
          // Cópia: o código continua a mexer no array de mensagens depois.
          pedidos.push({ ...p, messages: [...(p.messages as unknown[])] });
          const r = respostas.shift();
          if (!r) throw new Error('sem mais respostas simuladas');
          return r;
        },
      },
    },
  } as unknown as ClienteIA;
  return { cliente, pedidos };
}

const uso = (entrada: number, saida: number, pesquisas = 0) => ({
  input_tokens: entrada,
  output_tokens: saida,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  server_tool_use: { web_search_requests: pesquisas },
});

const pedido = {
  modelo: 'claude-sonnet-5-5',
  sistema: 'sistema',
  mensagem: 'pergunta',
  dominios: ['vimagua.pt', 'cm-guimaraes.pt'],
};

test('proporGabarito: retoma pause_turn, soma tokens e limpa a proposta', async () => {
  const pausa = [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} },
  ];
  const { cliente, pedidos } = simulado([
    {
      stop_reason: 'pause_turn',
      parsed_output: null,
      content: pausa,
      usage: uso(100, 10, 1),
    },
    {
      stop_reason: 'end_turn',
      parsed_output: proposta,
      content: [],
      usage: uso(200, 50, 2),
    },
  ]);
  const r = await proporGabarito(cliente, pedido);
  assert.deepEqual(r.conteudo, {
    resposta: 'Ligue para a Vimágua, avarias 800 910 410.',
    factos_obrigatorios: ['vimágua', '800 910 410'],
    factos_proibidos: ['Águas de Guimarães'],
    fontes: [{ titulo: 'repetida', url: 'https://www.vimagua.pt/contactos' }],
  });
  assert.deepEqual(
    [r.tokens_entrada, r.tokens_saida, r.pesquisas],
    [300, 60, 3],
  );

  assert.equal(pedidos.length, 2);
  const [p1, p2] = pedidos as {
    model: string;
    tools: { type: string; allowed_domains: string[] }[];
    messages: { role: string; content: unknown }[];
    system: { cache_control: unknown }[];
  }[];
  assert.equal(p1.model, 'claude-sonnet-5-5');
  assert.equal(p1.tools[0].type, 'web_search_20260209');
  assert.deepEqual(p1.tools[0].allowed_domains, [
    'vimagua.pt',
    'cm-guimaraes.pt',
  ]);
  assert.deepEqual(p1.system[0].cache_control, { type: 'ephemeral' });
  // A segunda volta leva a volta pausada como mensagem do assistente, sem "continua".
  assert.deepEqual(
    p2.messages.map((m) => m.role),
    ['user', 'assistant'],
  );
  assert.deepEqual(p2.messages[1].content, pausa);
});

test('proporGabarito: sem domínios não manda a pesquisa web', async () => {
  const { cliente, pedidos } = simulado([
    {
      stop_reason: 'end_turn',
      parsed_output: proposta,
      content: [],
      usage: uso(1, 1),
    },
  ]);
  await proporGabarito(cliente, { ...pedido, dominios: [] });
  assert.equal((pedidos[0] as { tools?: unknown }).tools, undefined);
});

test('proporGabarito: recusa, corte e formato errado dão erro claro', async () => {
  const caso = (r: Partial<Resposta>) =>
    proporGabarito(
      simulado([
        {
          parsed_output: null,
          content: [],
          usage: uso(1, 1),
          stop_reason: 'end_turn',
          ...r,
        },
      ]).cliente,
      pedido,
    );
  await assert.rejects(
    caso({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }),
    /recusou \(cyber\)/,
  );
  await assert.rejects(caso({ stop_reason: 'max_tokens' }), /cortada/);
  await assert.rejects(caso({}), /formato pedido/);
});

test('proporGabarito: desiste se a pesquisa nunca acaba', async () => {
  const pausa = {
    stop_reason: 'pause_turn',
    parsed_output: null,
    content: [],
    usage: uso(1, 1),
  };
  const { cliente } = simulado(
    Array.from({ length: 10 }, () => ({ ...pausa })),
  );
  await assert.rejects(proporGabarito(cliente, pedido), /não terminou/);
});

test('mensagemPergunta leva comportamento, entidade, fontes e contactos', () => {
  const m = mensagemPergunta(pergunta, {
    trechos: [
      {
        titulo: 'Vimágua · Contactos',
        url: 'https://www.vimagua.pt/contactos',
        referencia: null,
        entidade: 'Vimágua',
        texto: 'Avarias 24 horas: 800 910 410',
      },
    ],
    contactos: [
      {
        entidade: 'Vimágua',
        tipo: 'avarias',
        rotulo: 'Avarias, 24 horas',
        valor: '800 910 410',
        horario: { sempre: true },
      },
    ],
  });
  assert.match(m, /Comportamento esperado: encaminhar/);
  assert.match(m, /Entidade esperada: Vimágua/);
  assert.match(m, /<fonte n="1" titulo="Vimágua · Contactos"/);
  assert.match(m, /Vimágua · avarias \(Avarias, 24 horas\): 800 910 410/);
  const vazio = mensagemPergunta(
    { ...pergunta, comportamento: 'emergencia', entidade_esperada: null },
    { trechos: [], contactos: [] },
  );
  assert.match(vazio, /nenhuma encontrada/);
  assert.match(vazio, /112/);
});

test('promptSistema lista as entidades e não depende da pergunta (cache)', () => {
  const s = promptSistema('Guimarães', [
    {
      nome: 'Vimágua',
      tipo: 'empresa_municipal',
      descricao: 'Água e saneamento',
      site_url: 'https://www.vimagua.pt',
    },
  ]);
  assert.match(s, /concelho de Guimarães/);
  assert.match(
    s,
    /- Vimágua \(empresa_municipal\): Água e saneamento · https:\/\/www.vimagua.pt/,
  );
  assert.doesNotMatch(s, /sem água em casa/);
});

test('dominiosOficiais: hostnames sem www, sem repetidos nem lixo', () => {
  assert.deepEqual(
    dominiosOficiais([
      'https://www.cm-guimaraes.pt/servicos',
      'http://cm-guimaraes.pt',
      'vimagua.pt',
      null,
      'http://localhost:3000',
      'http://10.0.0.1',
      'não é url',
    ]),
    ['cm-guimaraes.pt', 'vimagua.pt'],
  );
});

test('limparProposta não inventa fontes nem factos', () => {
  const c = limparProposta({
    resposta: 'x',
    factos_obrigatorios: [],
    factos_proibidos: [],
    fontes: [],
  });
  assert.deepEqual(c, {
    resposta: 'x',
    factos_obrigatorios: [],
    factos_proibidos: [],
    fontes: [],
  });
});

test('emParalelo: nunca passa do limite e corre todos', async () => {
  let ativos = 0;
  let maximo = 0;
  const feitos: number[] = [];
  await emParalelo([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    ativos++;
    maximo = Math.max(maximo, ativos);
    await new Promise((r) => setTimeout(r, 5 + (n % 3) * 3));
    feitos.push(n);
    ativos--;
  });
  assert.equal(maximo, 3);
  assert.deepEqual(feitos.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test('emParalelo: depois de um erro não começa mais nenhum e rejeita', async () => {
  const comecados: number[] = [];
  await assert.rejects(
    emParalelo([1, 2, 3, 4, 5, 6], 2, async (n) => {
      comecados.push(n);
      if (n === 2) throw new Error('chave inválida');
      await new Promise((r) => setTimeout(r, 10));
    }),
    /chave inválida/,
  );
  assert.ok(comecados.length < 6);
});

test(
  'gabarito propor sem ANTHROPIC_API_KEY falha logo com mensagem clara',
  { skip: !!config.ia.apiKey },
  async () => {
    const c = comandos.find((x) => x.nome === 'gabarito propor');
    await assert.rejects(
      c!.correr({ posicionais: [], opcoes: { municipio: 'guimaraes' } }),
      /ANTHROPIC_API_KEY em falta/,
    );
  },
);
