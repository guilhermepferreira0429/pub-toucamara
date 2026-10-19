import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Veredicto } from '../tipos.js';
import {
  divergencias,
  escolherExemplos,
  oQueMuda,
  perguntasComuns,
  porCategoria,
  soComuns,
  taxa,
  tipoExemplo,
  type ExecucaoRel,
  type RespostaRel,
} from './agregar.js';
import { esc } from './html.js';
import {
  linhaPitch,
  montarAuditoria,
  montarComparacao,
  textoPitch,
} from './montar.js';

let seq = 0;
function resp(
  pergunta_id: string,
  veredicto: Veredicto,
  p: Partial<RespostaRel> = {},
): RespostaRel {
  return {
    resposta_id: `r${++seq}`,
    pergunta_id,
    ordem: Number(pergunta_id.replace(/\D/g, '')) || 0,
    categoria: 'Geral',
    pergunta: `Pergunta ${pergunta_id}?`,
    comportamento: 'responder',
    entidade_esperada: null,
    texto: `Resposta a ${pergunta_id}`,
    captura_key: null,
    respondida_em: new Date('2026-10-19T10:00:00Z'),
    veredicto,
    avaliador: 'juiz',
    rubrica_versao: '2026-10-19.1',
    justificacao: null,
    factos_errados: [],
    factos_em_falta: [],
    gabarito_resposta: 'Referência',
    ...p,
  };
}
function exec(
  sistema: string,
  nosso: boolean,
  respostas: RespostaRel[],
): ExecucaoRel {
  return {
    id: `e-${sistema}`,
    sistema_id: `s-${sistema}`,
    sistema,
    nosso,
    municipio_id: 'm',
    agente_versao: nosso ? 'v7' : null,
    iniciada_em: new Date('2026-10-19T09:00:00Z'),
    terminada_em: new Date('2026-10-19T11:00:00Z'),
    respostas,
    porResponder: 0,
    porAvaliar: 0,
  };
}

const nos = exec('Tou', true, [
  resp('p1', 'certa', {
    comportamento: 'emergencia',
    categoria: 'Proteção civil',
  }),
  resp('p2', 'certa', {
    comportamento: 'encaminhar',
    categoria: 'Água',
    entidade_esperada: 'Vimágua',
  }),
  resp('p3', 'certa'),
  resp('p4', 'errada', { factos_em_falta: ['8h às 17h'] }),
  resp('p5', 'passada_bem', { categoria: 'Perguntas difíceis' }),
  resp('p6', 'certa'), // só nós respondemos a esta
]);
const site = exec('Site', false, [
  resp('p1', 'errada', {
    comportamento: 'emergencia',
    justificacao: '[R1-emergencia-sem-112] não manda 112',
  }),
  resp('p2', 'errada', {
    comportamento: 'encaminhar',
    factos_errados: ['Águas de Guimarães'],
    captura_key: 'c/p2.png',
  }),
  resp('p3', 'errada', {
    justificacao: '[R5-so-manda-contactar] contacte-nos',
  }),
  resp('p4', 'certa'),
  resp('p5', 'sem_resposta'),
]);

describe('taxa', () => {
  it('(certas + passadas bem) / total', () => {
    const t = taxa(nos.respostas);
    assert.equal(t.total, 6);
    assert.equal(t.passadas_bem, 1);
    assert.ok(Math.abs(t.taxa! - 500 / 6) < 1e-9);
    assert.equal(taxa([]).taxa, null);
  });
  it('por categoria', () => {
    const m = porCategoria(nos.respostas);
    assert.equal(m.get('Geral')!.total, 3);
    assert.equal(m.get('Água')!.taxa, 100);
  });
});

describe('perguntas comuns e divergências', () => {
  const comuns = perguntasComuns([nos, site]);
  it('só as perguntas que todos responderam', () => {
    assert.deepEqual([...comuns].sort(), ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal(soComuns(nos, comuns).respostas.length, 5);
  });
  it('as duas listas: nós certo / eles certo', () => {
    const d = divergencias(soComuns(nos, comuns), soComuns(site, comuns));
    assert.deepEqual(
      d.nosGanhamos.map((p) => p.pergunta_id),
      ['p1', 'p2', 'p3', 'p5'],
    );
    assert.deepEqual(
      d.outroGanha.map((p) => p.pergunta_id),
      ['p4'],
    );
  });
});

describe('exemplos', () => {
  const d = divergencias(nos, site);
  it('classifica emergência, entidade e "contacte-nos"', () => {
    const tipos = Object.fromEntries(
      d.nosGanhamos.map((p) => [p.pergunta_id, tipoExemplo(p)]),
    );
    assert.deepEqual(tipos, {
      p1: 'emergencia',
      p2: 'entidade',
      p3: 'contacte',
      p5: 'outro',
    });
  });
  it('ordem: emergência, entidades, contacte-nos, resto; limite por tipo', () => {
    const g = escolherExemplos(d.nosGanhamos, 1);
    assert.deepEqual(
      g.map((x) => x.tipo),
      ['emergencia', 'entidade', 'contacte', 'outro'],
    );
  });
  it('o que muda para o munícipe fala de 112, contacte-nos e é honesto', () => {
    const f = oQueMuda(nos, site, d).join('\n');
    assert.match(f, /112/);
    assert.match(f, /mandar contactar a câmara/);
    assert.match(f, /acertou e nós não/);
  });
});

describe('relatórios', () => {
  const capturas = new Map([['c/p2.png', 'data:image/png;base64,AAAA']]);
  it('comparação: só comuns, as duas listas de divergências, captura embebida', () => {
    const { html, comuns } = montarComparacao([nos, site], {
      capturas,
      calibracao: { n: 30, acordo: 90, kappa: 0.8 },
      geradoEm: new Date('2026-10-19T12:00:00Z'),
    });
    assert.equal(comuns, 5);
    assert.match(html, /Tou acertou e Site não \(4\)/);
    assert.match(html, /Site acertou e Tou não \(1\)/);
    assert.match(html, /data:image\/png;base64,AAAA/);
    assert.match(html, /90,0%/);
    assert.match(html, /2026-10-19\.1/);
    assert.ok(!html.includes('[R5'), 'códigos das regras não aparecem');
    assert.ok(
      !/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')),
      'nada externo',
    );
  });
  it('auditoria precisa do nosso e de um atual', () => {
    assert.throws(() =>
      montarAuditoria([site], {
        municipio: 'Guimarães',
        capturas,
        calibracao: null,
        geradoEm: new Date(),
      }),
    );
    const html = montarAuditoria([nos, site], {
      municipio: 'Guimarães',
      capturas,
      calibracao: null,
      geradoEm: new Date(),
    });
    assert.match(html, /Auditoria ao atendimento · Guimarães/);
    assert.match(html, /Emergências/);
    assert.match(html, /Onde nós falhámos/);
    assert.match(html, /Ainda sem calibração/);
  });
  it('pitch: linha por sistema e aviso quando as perguntas não são as mesmas', () => {
    const l = [
      linhaPitch(nos, { n: 30, acordo: 93.3, kappa: 0.88 }),
      linhaPitch(site, null),
    ];
    assert.equal(l[0].taxa, 83.3);
    assert.equal(l[0].perguntas, 6);
    const t = textoPitch(l, 5);
    assert.match(t.split('\n')[0], /^Tou: 83,3% de 6 perguntas/);
    assert.match(t, /juiz ainda sem calibração/);
    assert.match(t, /não cobrem as mesmas perguntas \(5 comuns\)/);
  });
  it('escapa HTML', () => {
    assert.equal(esc('<b>"x"&</b>'), '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
  });
});
