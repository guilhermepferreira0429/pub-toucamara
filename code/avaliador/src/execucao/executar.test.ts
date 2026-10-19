/*
 * Integração com a BD (esquema avaliacao). Só corre com TESTE_BD=1 e nunca
 * contra a BD principal `toucamara`:
 *   DB_NAME=toucamara_mig TESTE_BD=1 npx tsx --test src/execucao/executar.test.ts
 * Cria um município, um conjunto e sistemas próprios e apaga-os no fim.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Adaptador } from '../tipos.js';

const ATIVO =
  process.env.TESTE_BD === '1' &&
  !!process.env.DB_NAME &&
  process.env.DB_NAME !== 'toucamara';

const pasta = mkdtempSync(path.join(tmpdir(), 'avaliador-'));
process.env.PASTA_SAIDA = pasta;

// Importados depois de PASTA_SAIDA (o config lê o .env ao carregar).
const { bd } = await import('../bd.js');
const { ErroAdaptador } = await import('../tipos.js');
const { correrExecucao } = await import('./executar.js');
const { importarRespostas } = await import('./importar.js');
const { criarSistema } = await import('./sistemas.js');

const sufixo = Math.random().toString(36).slice(2, 8);
const SLUG = `teste-${sufixo}`;
let municipioId = '';
let conjuntoId = '';
const perguntas: string[] = [];

before(async () => {
  if (!ATIVO) return;
  [{ id: municipioId }] = await bd.query<{ id: string }>(
    `INSERT INTO municipios (slug, nome) VALUES ($1, 'Teste') RETURNING id`,
    [SLUG],
  );
  [{ id: conjuntoId }] = await bd.query<{ id: string }>(
    `INSERT INTO avaliacao.conjuntos (nome, municipio_id) VALUES ($1, $2) RETURNING id`,
    [`Conjunto ${sufixo}`, municipioId],
  );
  for (const [ordem, categoria] of [
    [1, 'Obras'],
    [2, 'Taxas'],
    [3, 'Perguntas difíceis'],
    [4, 'Obras'],
  ] as const) {
    const [p] = await bd.query<{ id: string }>(
      `INSERT INTO avaliacao.perguntas (conjunto_id, ordem, categoria, texto, comportamento)
       VALUES ($1, $2, $3, $4, 'responder') RETURNING id`,
      [conjuntoId, ordem, categoria, `Pergunta ${ordem}?`],
    );
    perguntas.push(p.id);
  }
  // Gabarito aprovado só para 1, 2 e 3: a 4 fica de fora das execuções.
  for (const id of perguntas.slice(0, 3)) {
    await bd.query(
      `INSERT INTO avaliacao.gabarito (pergunta_id, municipio_id, resposta, estado)
       VALUES ($1, $2, 'ref', 'aprovado')`,
      [id, municipioId],
    );
  }
});

after(async () => {
  if (ATIVO) {
    await bd.query(
      `DELETE FROM avaliacao.execucoes WHERE sistema_id IN
         (SELECT id FROM avaliacao.sistemas WHERE nome LIKE $1)`,
      [`%${sufixo}%`],
    );
    await bd.query('DELETE FROM avaliacao.sistemas WHERE nome LIKE $1', [
      `%${sufixo}%`,
    ]);
    await bd.query('DELETE FROM avaliacao.conjuntos WHERE id = $1', [
      conjuntoId,
    ]);
    await bd.query('DELETE FROM municipios WHERE id = $1', [municipioId]);
  }
  await bd.fechar();
});

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function falso(
  comportamento: (texto: string) => 'ok' | 'erro' | 'fatal',
): Adaptador & { perguntadas: string[] } {
  const perguntadas: string[] = [];
  return {
    paralelo: 2,
    pausa: () => 0,
    perguntadas,
    async perguntar({ texto }) {
      perguntadas.push(texto);
      const c = comportamento(texto);
      if (c === 'erro') throw new ErroAdaptador('falhou');
      if (c === 'fatal')
        throw new ErroAdaptador('Seletor "campo" não encontrado', true);
      return {
        texto: `R: ${texto}`,
        latencia_ms: 12,
        captura: PNG,
        fontes: [{ titulo: 't', url: 'u' }],
      };
    },
  };
}

const silencio = () => {};

async function respostas(execucao: string) {
  return bd.query<{
    ordem: number;
    texto: string | null;
    erro: string | null;
    captura_key: string | null;
  }>(
    `SELECT p.ordem, r.texto, r.erro, r.captura_key FROM avaliacao.respostas r
     JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
     WHERE r.execucao_id = $1 ORDER BY p.ordem`,
    [execucao],
  );
}

test(
  'executar: só perguntas com gabarito; erro numa pergunta segue; repetir-erros; capturas',
  { skip: !ATIVO },
  async () => {
    const s = await criarSistema({
      nome: `Nosso ${sufixo}`,
      adaptador: 'manual',
      municipio: SLUG,
      nosso: true,
    });
    const r = await correrExecucao({
      sistema: s.nome,
      conjunto: `Conjunto ${sufixo}`,
      adaptador: falso((t) => (t === 'Pergunta 2?' ? 'erro' : 'ok')),
      progresso: silencio,
    });
    assert.equal(r.estado, 'terminada');
    assert.equal(r.perguntas, 3);
    assert.equal(r.respondidas, 2);
    assert.equal(r.erros, 1);
    const rs = await respostas(r.execucao_id);
    assert.deepEqual(
      rs.map((x) => [x.ordem, x.erro]),
      [
        [1, null],
        [2, 'erro_adaptador: falhou'],
        [3, null],
      ],
    );
    assert.equal(rs[0].captura_key, `capturas/${r.execucao_id}/1.png`);
    assert.ok(existsSync(path.join(pasta, 'capturas', r.execucao_id, '1.png')));

    const repetir = falso(() => 'ok');
    const r2 = await correrExecucao({
      execucao: r.execucao_id,
      soErros: true,
      adaptador: repetir,
      progresso: silencio,
    });
    assert.deepEqual(repetir.perguntadas, ['Pergunta 2?']);
    assert.equal(r2.estado, 'terminada');
    assert.equal((await respostas(r.execucao_id))[1].texto, 'R: Pergunta 2?');
    assert.equal((await respostas(r.execucao_id))[1].erro, null);
  },
);

test(
  'executar: erro fatal interrompe; retomar salta as respondidas; aviso das 24 h nos externos',
  { skip: !ATIVO },
  async () => {
    const s = await criarSistema({
      nome: `Externo ${sufixo}`,
      adaptador: 'manual',
      municipio: SLUG,
    });
    let n = 0;
    const r = await correrExecucao({
      sistema: s.nome,
      conjunto: `Conjunto ${sufixo}`,
      adaptador: { ...falso(() => (++n === 2 ? 'fatal' : 'ok')), paralelo: 1 },
      progresso: silencio,
    });
    assert.equal(r.estado, 'interrompida');
    assert.match(r.erro ?? '', /Seletor "campo"/);
    const [e] = await bd.query<{ estado: string; erro: string }>(
      'SELECT estado, erro FROM avaliacao.execucoes WHERE id = $1',
      [r.execucao_id],
    );
    assert.equal(e.estado, 'interrompida');

    await assert.rejects(
      correrExecucao({
        sistema: s.nome,
        conjunto: `Conjunto ${sufixo}`,
        adaptador: falso(() => 'ok'),
        progresso: silencio,
      }),
      /--forcar/,
    );

    const retoma = falso(() => 'ok');
    const r2 = await correrExecucao({
      execucao: r.execucao_id,
      adaptador: retoma,
      progresso: silencio,
    });
    assert.deepEqual(retoma.perguntadas.sort(), ['Pergunta 2?', 'Pergunta 3?']);
    assert.equal(r2.estado, 'terminada');
  },
);

test('executar: --amostra e --sem-gabarito', { skip: !ATIVO }, async () => {
  const s = await criarSistema({
    nome: `Amostra ${sufixo}`,
    adaptador: 'manual',
    municipio: SLUG,
    nosso: true,
  });
  const a = falso(() => 'ok');
  const r = await correrExecucao({
    sistema: s.nome,
    conjunto: `Conjunto ${sufixo}`,
    semGabarito: true,
    amostra: true,
    adaptador: a,
    progresso: silencio,
  });
  // Amostra de 1..4: a 1 (Obras), a 2 (Taxas) e a 3 (difícil); a 4 é Obras repetida.
  assert.equal(r.perguntas, 3);
  const [e] = await bd.query<{ amostra: boolean }>(
    'SELECT amostra FROM avaliacao.execucoes WHERE id = $1',
    [r.execucao_id],
  );
  assert.equal(e.amostra, true);
});

test(
  'importar-respostas: CSV por nº e por texto; erros não importam nada',
  { skip: !ATIVO },
  async () => {
    const s = await criarSistema({
      nome: `Manual ${sufixo}`,
      adaptador: 'manual',
      municipio: SLUG,
    });
    const csv = path.join(pasta, 'respostas.csv');
    writeFileSync(
      csv,
      'pergunta;resposta\n1;"Sim; precisa"\nPergunta 4?;Não sei\n',
    );
    const r = await importarRespostas(
      { sistema: s.nome, ficheiro: csv, conjunto: `Conjunto ${sufixo}` },
      silencio,
    );
    assert.equal(r.respostas, 2);
    const rs = await respostas(r.execucao_id);
    assert.deepEqual(
      rs.map((x) => [x.ordem, x.texto]),
      [
        [1, 'Sim; precisa'],
        [4, 'Não sei'],
      ],
    );
    const [e] = await bd.query<{ estado: string }>(
      'SELECT estado FROM avaliacao.execucoes WHERE id = $1',
      [r.execucao_id],
    );
    assert.equal(e.estado, 'terminada');

    writeFileSync(csv, '1;a\n99;b\n1;c\n');
    await assert.rejects(
      importarRespostas(
        { sistema: s.nome, ficheiro: csv, conjunto: `Conjunto ${sufixo}` },
        silencio,
      ),
      /2 erro\(s\).*\n.*linha 2.*\n.*linha 3: a pergunta #1 já veio na linha 1/,
    );
  },
);
