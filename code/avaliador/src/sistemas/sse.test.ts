import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { juntarEventos, lerSse, ParserSse, type EventoSse } from './sse.js';

const FIXTURES = new URL('../../test/fixtures/', import.meta.url);
const gravado = readFileSync(new URL('chat-sse.txt', FIXTURES), 'utf8');

function porPedacos(texto: string, tamanho: number): EventoSse[] {
  const p = new ParserSse();
  const ev: EventoSse[] = [];
  for (let i = 0; i < texto.length; i += tamanho)
    ev.push(...p.alimentar(texto.slice(i, i + tamanho)));
  ev.push(...p.terminar());
  return ev;
}

test('ParserSse: o stream gravado dá os mesmos eventos qualquer que seja o corte', () => {
  const inteiro = porPedacos(gravado, gravado.length);
  assert.equal(inteiro.length, 10);
  assert.deepEqual(
    inteiro.map((e) => e.evento),
    [
      'ferramenta',
      'cartao',
      'texto',
      'texto',
      'ferramenta',
      'cartao',
      'ferramenta',
      'cartao',
      'texto',
      'fim',
    ],
  );
  for (const n of [1, 3, 7, 64])
    assert.deepEqual(porPedacos(gravado, n), inteiro);
});

test('ParserSse: CRLF, comentários, data em várias linhas e evento sem linha final', () => {
  const p = new ParserSse();
  const ev = p.alimentar(
    ': vivo\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\nevent: fim\ndata: {"turno_id":null}',
  );
  assert.deepEqual(ev, [{ evento: 'x', dados: 'a\nb' }]);
  assert.deepEqual(p.terminar(), [
    { evento: 'fim', dados: { turno_id: null } },
  ]);
});

test('juntarEventos: texto, ferramentas (sem repetir) e fontes únicas dos cartões fonte', () => {
  const r = juntarEventos(porPedacos(gravado, 5));
  assert.equal(r.terminou, true);
  assert.equal(r.erro, null);
  assert.equal(r.turnoId, '6f1d2c3b-0000-4000-8000-000000000001');
  assert.deepEqual(r.ferramentas, ['procurar_conhecimento', 'encaminhar']);
  assert.deepEqual(r.fontes, [
    {
      titulo: 'Licenciamento de obras',
      url: 'https://www.cm-guimaraes.pt/servicos/obras',
    },
    {
      titulo: 'Regulamento Municipal de Urbanização e Edificação',
      url: 'https://www.cm-guimaraes.pt/regulamentos/rmue.pdf',
    },
  ]);
  assert.match(r.texto, /^Obras só no interior/);
  assert.match(
    r.texto,
    /comunicação prévia\. A Divisão de Urbanismo atende pelo 253 421 200\.$/,
  );
});

test('juntarEventos: evento erro', () => {
  const erro = readFileSync(new URL('chat-sse-erro.txt', FIXTURES), 'utf8');
  const r = juntarEventos(porPedacos(erro, 11));
  assert.equal(r.terminou, false);
  assert.deepEqual(r.erro, {
    codigo: 'ia_indisponivel',
    mensagem: 'O chat está indisponível de momento.',
  });
});

test('lerSse: lê um corpo em bytes cortado a meio de um carácter UTF-8', async () => {
  const bytes = new TextEncoder().encode(gravado);
  async function* corpo() {
    for (let i = 0; i < bytes.length; i += 13) yield bytes.slice(i, i + 13);
  }
  const ev: EventoSse[] = [];
  for await (const e of lerSse(corpo())) ev.push(e);
  assert.deepEqual(ev, porPedacos(gravado, gravado.length));
});
