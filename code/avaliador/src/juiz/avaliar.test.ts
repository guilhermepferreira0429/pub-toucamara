/*
 * O fluxo do juiz com um cliente simulado (nunca chama a Anthropic) e uma BD
 * falsa: respostas-modelo de veredicto óbvio.
 */
import type Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Q } from '../bd.js';
import { avaliarExecucao, type ItemAvaliar } from './avaliar.js';
import { lerMensagem, parametrosJuiz, type ClienteJuiz } from './cliente.js';
import { custoEstimado } from './custo.js';
import { mensagemJuiz, RUBRICA_VERSAO, type SaidaJuiz } from './rubrica.js';

function item(p: Partial<ItemAvaliar>): ItemAvaliar {
  return {
    resposta_id: 'r',
    texto: 'x',
    erro: null,
    pergunta: 'p',
    idioma: 'pt-PT',
    categoria: 'Geral',
    comportamento: 'responder',
    entidade_esperada: null,
    gabarito_id: 'g',
    gabarito_resposta: 'ref',
    factos_obrigatorios: [],
    factos_proibidos: [],
    ...p,
  };
}

const ITENS: ItemAvaliar[] = [
  item({
    resposta_id: 'emergencia',
    comportamento: 'emergencia',
    pergunta: 'Está a sair fumo de uma casa na minha rua!',
    texto: 'Lamento. Pode registar a situação no portal da câmara.',
    factos_obrigatorios: ['112'],
  }),
  item({
    resposta_id: 'agua',
    comportamento: 'encaminhar',
    categoria: 'Água e saneamento',
    pergunta: 'Estou sem água em casa, a quem ligo?',
    texto: 'Deve contactar a Águas de Guimarães pelo 253 514 400.',
    factos_obrigatorios: ['Vimágua', '253 439 100'],
    factos_proibidos: ['Águas de Guimarães', '253 514 400'],
  }),
  item({
    resposta_id: 'contacte',
    pergunta: 'Até que horas abre o ecocentro?',
    texto: 'Para mais informações contacte-nos pelo 253 421 200.',
    factos_obrigatorios: ['8h às 17h'],
  }),
  item({
    resposta_id: 'dificil',
    categoria: 'Perguntas difíceis',
    pergunta: 'O meu vizinho tem obras ilegais, o que acontece?',
    texto:
      'Vou passar a sua pergunta a um colega da câmara, que responde em breve.',
    factos_obrigatorios: ['fiscalização municipal'],
  }),
  item({ resposta_id: 'vazia', texto: '  ' }),
  item({ resposta_id: 'sem-gabarito', gabarito_id: null }),
];

/** O que um modelo razoável diria de cada resposta-modelo (sem ver os erros óbvios). */
const SAIDAS: Record<string, SaidaJuiz> = {
  emergencia: {
    comportamento_observado: 'responder',
    factos_certos: [],
    em_falta: ['112'],
    erros_graves: [],
    erros_menores: [],
    so_manda_contactar: false,
    nao_encontrou: false,
    manda_112: false,
    suficiente: 'nao',
    categoria_juiz: 'errada',
    nota: 'Não manda ligar 112.',
  },
  // O modelo "falha" o facto proibido: a verificação determinística apanha-o.
  agua: {
    comportamento_observado: 'encaminhar',
    factos_certos: [],
    em_falta: ['Vimágua', '253 439 100'],
    erros_graves: [],
    erros_menores: [],
    so_manda_contactar: false,
    nao_encontrou: false,
    manda_112: false,
    suficiente: 'nao',
    categoria_juiz: 'errada',
    nota: 'Encaminha.',
  },
  contacte: {
    comportamento_observado: 'encaminhar',
    factos_certos: [],
    em_falta: ['8h às 17h'],
    erros_graves: [],
    erros_menores: [],
    so_manda_contactar: true,
    nao_encontrou: false,
    manda_112: false,
    suficiente: 'nao',
    categoria_juiz: 'mandou_contactar',
    nota: 'Só manda contactar.',
  },
  dificil: {
    comportamento_observado: 'passar_humano',
    factos_certos: [],
    em_falta: ['fiscalização municipal'],
    erros_graves: [],
    erros_menores: [],
    so_manda_contactar: false,
    nao_encontrou: false,
    manda_112: false,
    suficiente: 'em_parte',
    categoria_juiz: 'certa',
    nota: 'Passa a humano.',
  },
};

function bdFalsa(itens: ItemAvaliar[]) {
  const inseridas: unknown[][] = [];
  const q: Q = {
    async query<T>(sql: string, params?: unknown[]) {
      if (sql.includes('INSERT INTO avaliacao.avaliacoes')) {
        inseridas.push(params ?? []);
        return [] as T[];
      }
      return itens as T[];
    },
  };
  return { q, inseridas };
}

function clienteSimulado(): ClienteJuiz & {
  chamadas: string[];
  lotes: number;
} {
  const uso = {
    entrada: 100,
    cache_escrita: 0,
    cache_leitura: 2000,
    saida: 300,
  };
  const c = {
    modelo: 'claude-sonnet-5-5',
    chamadas: [] as string[],
    lotes: 0,
    async avaliar(e: { resposta: string }) {
      const id = ITENS.find((i) => i.texto === e.resposta)!.resposta_id;
      c.chamadas.push(id);
      return { ok: true as const, saida: SAIDAS[id], uso };
    },
    async avaliarLote(pedidos: { id: string }[]) {
      c.lotes++;
      return new Map(
        pedidos.map((p) => [
          p.id,
          { ok: true as const, saida: SAIDAS[p.id], uso },
        ]),
      );
    },
  };
  return c;
}

function veredictos(inseridas: unknown[][]) {
  return Object.fromEntries(
    inseridas.map((p) => [p[0], [p[3], String(p[8]).slice(0, 25)]]),
  );
}

describe('avaliarExecucao (cliente simulado)', () => {
  for (const lote of [false, true]) {
    it(`veredictos óbvios ${lote ? 'em lote' : 'diretos'}`, async () => {
      const { q, inseridas } = bdFalsa(ITENS);
      const cliente = clienteSimulado();
      const r = await avaliarExecucao({
        execucaoId: 'e',
        lote,
        reavaliar: false,
        cliente,
        q,
      });
      assert.equal(r.semGabarito, 1);
      assert.equal(r.semChamar, 1);
      assert.equal(r.avaliadas, 5);
      // A vazia não foi ao juiz.
      assert.ok(!cliente.chamadas.includes('vazia'));
      assert.equal(cliente.lotes, lote ? 1 : 0);
      const v = veredictos(inseridas);
      assert.equal(v.emergencia[0], 'errada');
      assert.match(v.emergencia[1], /R1/);
      assert.equal(v.agua[0], 'errada');
      assert.match(v.agua[1], /R2/);
      assert.equal(v.contacte[0], 'errada');
      assert.match(v.contacte[1], /R5/);
      assert.equal(v.dificil[0], 'passada_bem');
      assert.equal(v.vazia[0], 'sem_resposta');
      // Grava a rubrica e os tokens (entrada inclui a cache).
      const agua = inseridas.find((p) => p[0] === 'agua')!;
      assert.equal(agua[1], RUBRICA_VERSAO);
      assert.deepEqual(agua[7], ['Águas de Guimarães', '253 514 400']);
      assert.equal(agua[9], 2100);
      assert.equal(agua[10], 300);
      // Escala v2 gravada ao lado: categoria, regra, suficiente, erros graves.
      const cat = Object.fromEntries(
        inseridas.map((p) => [p[0], [p[11], p[12]]]),
      );
      assert.deepEqual(cat.emergencia, ['errada', 'C2-emergencia-sem-112']);
      assert.deepEqual(cat.agua, ['errada', 'C3-erro-grave']);
      assert.deepEqual(cat.contacte, [
        'mandou_contactar',
        'C5-so-manda-contactar',
      ]);
      assert.deepEqual(cat.dificil, ['certa', 'C4-passada-bem']);
      assert.deepEqual(cat.vazia, ['sem_resposta', 'C1-sem-resposta']);
      assert.equal(agua[13], 'nao');
      assert.deepEqual(agua[14], agua[7]);
      assert.deepEqual(agua[15], []);
      assert.equal(agua[16], false);
      assert.equal(agua[17], 'errada');
    });
  }

  it('falhas do juiz ficam por avaliar e não gravam nada', async () => {
    const { q, inseridas } = bdFalsa([ITENS[0]]);
    const cliente: ClienteJuiz = {
      modelo: 'm',
      avaliar: async () => ({ ok: false, erro: 'o modelo recusou avaliar' }),
      avaliarLote: async () => new Map(),
    };
    const r = await avaliarExecucao({
      execucaoId: 'e',
      lote: false,
      reavaliar: false,
      cliente,
      q,
    });
    assert.equal(r.falhadas.length, 1);
    assert.equal(inseridas.length, 0);
  });
});

describe('cliente', () => {
  it('a mensagem ao juiz não leva nada do sistema', () => {
    const p = parametrosJuiz('claude-sonnet-5-5', {
      pergunta: 'P?',
      idioma: 'pt-PT',
      categoria: 'Água',
      comportamento_esperado: 'encaminhar',
      entidade_esperada: 'Vimágua',
      gabarito: {
        resposta: 'R',
        factos_obrigatorios: ['a'],
        factos_proibidos: ['b'],
      },
      resposta: 'Texto',
    });
    const tudo = JSON.stringify(p);
    for (const proibido of [
      'Site',
      'externo',
      'nosso',
      'tou-chat',
      'sistema_id',
    ])
      assert.ok(!tudo.includes(proibido), proibido);
    assert.equal(p.output_config?.effort, 'medium');
    assert.ok(
      mensagemJuiz({
        pergunta: 'P?',
        idioma: 'pt-PT',
        categoria: 'Água',
        comportamento_esperado: 'encaminhar',
        entidade_esperada: null,
        gabarito: {
          resposta: 'R',
          factos_obrigatorios: ['a'],
          factos_proibidos: [],
        },
        resposta: 'T',
      }).includes('O1. a'),
    );
  });

  const msg = (texto: string, stop: Anthropic.StopReason = 'end_turn') =>
    ({
      content: [{ type: 'text', text: texto }],
      stop_reason: stop,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }) as unknown as Anthropic.Message;

  it('lê a saída estruturada e rejeita recusas ou JSON inválido', () => {
    const r = lerMensagem(msg(JSON.stringify(SAIDAS.agua)));
    assert.ok(r.ok && r.saida.comportamento_observado === 'encaminhar');
    assert.equal(lerMensagem(msg('{}')).ok, false);
    assert.equal(lerMensagem(msg('não é json')).ok, false);
    assert.equal(lerMensagem(msg('', 'refusal')).ok, false);
  });

  it('custo: Sonnet 5.5, lote é metade', () => {
    const uso = {
      entrada: 1e6,
      cache_escrita: 0,
      cache_leitura: 0,
      saida: 1e6,
    };
    assert.equal(custoEstimado(uso, 'claude-sonnet-5-5'), 12);
    assert.equal(custoEstimado(uso, 'claude-sonnet-5-5', true), 6);
    assert.equal(custoEstimado(uso, 'modelo-desconhecido'), null);
  });
});
