import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gerarRevisao,
  lerRevisao,
  mesmoConteudo,
  type ItemRevisao,
} from './revisao.js';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

const itens: ItemRevisao[] = [
  {
    gabarito_id: ID1,
    ordem: 69,
    categoria: 'Água e saneamento',
    pergunta: 'Estou sem água em casa, para onde ligo?',
    comportamento: 'encaminhar',
    entidade_esperada: 'Vimágua',
    nota: null,
    estado: 'proposto',
    versao: 1,
    resposta:
      'A água em Guimarães é da Vimágua.\n\nPara avarias ligue 800 910 410 (24 horas).\n# não é um título\n\\# já tinha barra',
    factos_obrigatorios: ['Vimágua', '800 910 410'],
    factos_proibidos: ['Águas de Guimarães', '253 514 400'],
    fontes: [
      {
        titulo: 'Vimágua · Contactos',
        url: 'https://www.vimagua.pt/contactos',
      },
      {
        titulo: 'https://www.cm-guimaraes.pt',
        url: 'https://www.cm-guimaraes.pt',
      },
    ],
  },
  {
    gabarito_id: ID2,
    ordem: 177,
    categoria: 'Perguntas difíceis',
    pergunta: 'Está a sair fumo de uma casa na minha rua!',
    comportamento: 'emergencia',
    entidade_esperada: '112',
    nota: 'emergência, mandar ligar 112',
    estado: 'proposto',
    versao: 2,
    resposta: 'Manda ligar 112 de imediato, sem fazer mais perguntas.',
    factos_obrigatorios: ['112'],
    factos_proibidos: [],
    fontes: [],
  },
];

const cab = { municipio: 'Guimarães', estado: 'proposto', data: '2026-10-19' };

test('round-trip: exportar e ler sem mexer dá os mesmos valores e nenhuma decisão', () => {
  const md = gerarRevisao(itens, cab);
  const { itens: lidos, erros } = lerRevisao(md);
  assert.deepEqual(erros, []);
  assert.equal(lidos.length, 2);
  for (const [i, l] of lidos.entries()) {
    const o = itens[i];
    assert.equal(l.gabarito_id, o.gabarito_id);
    assert.equal(l.decisao, null);
    assert.deepEqual(
      {
        resposta: l.resposta,
        factos_obrigatorios: l.factos_obrigatorios,
        factos_proibidos: l.factos_proibidos,
        fontes: l.fontes,
      },
      {
        resposta: o.resposta,
        factos_obrigatorios: o.factos_obrigatorios,
        factos_proibidos: o.factos_proibidos,
        fontes: o.fontes,
      },
    );
    assert.ok(mesmoConteudo(l, o));
  }
});

test('round-trip também com CRLF (ficheiro gravado no Windows)', () => {
  const md = gerarRevisao(itens, cab).replace(/\n/g, '\r\n');
  const { itens: lidos } = lerRevisao(md);
  assert.equal(lidos[0].resposta, itens[0].resposta);
});

test('lê edições e a caixa marcada', () => {
  let md = gerarRevisao(itens, cab);
  md = md
    .replace(
      'Para avarias ligue 800 910 410 (24 horas).',
      'Avarias: 800 910 410.',
    )
    .replace(
      '- 253 514 400\n',
      '- 253 514 400\n* Águas do Norte\nsem marcador\n',
    )
    // Primeira caixa "aprovar" (a da primeira pergunta), com X maiúsculo.
    .replace('- [ ] aprovar', '- [X] aprovar');
  const [a, b] = lerRevisao(md).itens;
  assert.equal(a.decisao, 'aprovar');
  assert.match(a.resposta, /Avarias: 800 910 410\./);
  assert.deepEqual(a.factos_proibidos, [
    'Águas de Guimarães',
    '253 514 400',
    'Águas do Norte',
    'sem marcador',
  ]);
  assert.equal(b.decisao, null);
});

test('rejeitar; e listas esvaziadas ficam vazias', () => {
  const md = gerarRevisao([itens[1]], cab)
    .replace('- 112\n', '')
    .replace('- [ ] rejeitar', '- [x] rejeitar');
  const [a] = lerRevisao(md).itens;
  assert.equal(a.decisao, 'rejeitar');
  assert.deepEqual(a.factos_obrigatorios, []);
});

test('erros por secção: as duas caixas, aprovar sem resposta, fonte sem URL, repetida', () => {
  const um = (o: Partial<ItemRevisao>) =>
    gerarRevisao([{ ...itens[1], ...o }], cab);
  const ambas = um({ gabarito_id: ID1 })
    .replace('- [ ] aprovar', '- [x] aprovar')
    .replace('- [ ] rejeitar', '- [x] rejeitar');
  const semResposta = um({ gabarito_id: ID2, resposta: '' }).replace(
    '- [ ] aprovar',
    '- [x] aprovar',
  );
  const fonteMa = um({ gabarito_id: ID3 }).replace(
    '### Decisão',
    '- só um título\n\n### Decisão',
  );
  const r = lerRevisao(
    [ambas, semResposta, fonteMa, um({ gabarito_id: ID3 })].join('\n'),
  );
  assert.equal(r.itens.length, 0);
  assert.equal(r.erros.length, 4);
  assert.match(r.erros[0], /aprovar e rejeitar/);
  assert.match(r.erros[1], /sem resposta/);
  assert.match(r.erros[2], /fonte sem URL/);
  assert.match(r.erros[3], /mais de uma vez/);
});

test('fonte só com URL e texto antes da primeira marca é ignorado', () => {
  const md = `# Título\n\n### Resposta\n\nlixo\n\n## 1. P\n\n<!-- gabarito: ${ID1} -->\n\n### Resposta\n\nok\n\n### Fontes\n\n- https://x.pt/a\n`;
  const [a] = lerRevisao(md).itens;
  assert.equal(a.resposta, 'ok');
  assert.deepEqual(a.fontes, [
    { titulo: 'https://x.pt/a', url: 'https://x.pt/a' },
  ]);
});

test('mesmoConteudo ignora espaços à volta mas não mudanças reais', () => {
  const base = {
    resposta: 'a',
    factos_obrigatorios: ['x'],
    factos_proibidos: [],
    fontes: [],
  };
  assert.ok(
    mesmoConteudo(base, {
      ...base,
      resposta: ' a\r\n',
      factos_obrigatorios: [' x '],
    }),
  );
  assert.ok(!mesmoConteudo(base, { ...base, factos_obrigatorios: ['y'] }));
});
