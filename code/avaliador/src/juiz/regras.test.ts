import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verificarFactos } from './factos.js';
import {
  decidirVeredicto,
  descricaoVazia,
  ehDificil,
  juntarFactos,
  regraDaJustificacao,
  justificacaoComRegra,
  semResposta,
  type ContextoVeredicto,
  type Descricao,
} from './regras.js';
import type { SaidaJuiz } from './rubrica.js';

function ctx(p: Partial<ContextoVeredicto> = {}): ContextoVeredicto {
  return {
    comportamento_esperado: 'responder',
    categoria: 'Ambiente',
    factos_obrigatorios: ['8h às 17h'],
    texto: 'O ecocentro abre das 8h às 17h.',
    erro: null,
    ...p,
  };
}
function desc(p: Partial<Descricao> = {}): Descricao {
  return {
    comportamento_observado: 'responder',
    factos_certos: ['8h às 17h'],
    factos_em_falta: [],
    factos_errados: [],
    so_manda_contactar: false,
    manda_ligar_112: false,
    ...p,
  };
}
function saida(p: Partial<SaidaJuiz> = {}): SaidaJuiz {
  return { ...desc(), justificacao: '', ...p } as SaidaJuiz;
}

describe('R1 emergência', () => {
  const c = ctx({
    comportamento_esperado: 'emergencia',
    categoria: 'Proteção civil',
    factos_obrigatorios: ['112'],
    texto: 'Vou registar a sua ocorrência sobre o incêndio.',
  });
  it('emergência sem mandar ligar 112 → errada, mesmo que o resto pareça bem', () => {
    const d = desc({
      comportamento_observado: 'ocorrencia',
      factos_certos: [],
    });
    assert.deepEqual(decidirVeredicto(c, d), {
      veredicto: 'errada',
      regra: 'R1-emergencia-sem-112',
    });
  });
  it('emergência vazia também é errada (R1 vem antes de R3)', () => {
    assert.equal(
      decidirVeredicto({ ...c, texto: '' }, descricaoVazia()).regra,
      'R1-emergencia-sem-112',
    );
  });
  it('o "112" no texto conta mesmo que o juiz não o veja', () => {
    const texto = 'Ligue já para o 112 e afaste-se do local.';
    const g = { factos_obrigatorios: ['112'], factos_proibidos: [] };
    const d = juntarFactos(
      saida({ comportamento_observado: 'emergencia', factos_certos: [] }),
      verificarFactos(texto, g),
      g,
    );
    assert.equal(d.manda_ligar_112, true);
    assert.equal(decidirVeredicto({ ...c, texto }, d).veredicto, 'certa');
  });
});

describe('R2 factos errados', () => {
  const g = {
    factos_obrigatorios: ['Vimágua', '253 439 100'],
    factos_proibidos: ['Águas de Guimarães', '253 514 400'],
  };
  const c = ctx({
    comportamento_esperado: 'encaminhar',
    categoria: 'Água',
    factos_obrigatorios: g.factos_obrigatorios,
  });
  it('"Águas de Guimarães" e "253 514 400" → errada mesmo que o juiz não veja', () => {
    const texto =
      'A água é com a Aguas de Guimaraes, ligue 253-514-400 ou a Vimágua.';
    const d = juntarFactos(
      saida({
        comportamento_observado: 'encaminhar',
        factos_certos: ['Vimágua'],
        factos_em_falta: ['253 439 100'],
      }),
      verificarFactos(texto, g),
      g,
    );
    assert.deepEqual(d.factos_errados, ['Águas de Guimarães', '253 514 400']);
    assert.deepEqual(decidirVeredicto({ ...c, texto }, d), {
      veredicto: 'errada',
      regra: 'R2-facto-errado',
    });
  });
  it('contradição descrita pelo juiz também conta', () => {
    const d = desc({
      factos_errados: ['diz que abre às 9h; o gabarito diz 8h'],
    });
    assert.equal(decidirVeredicto(ctx(), d).regra, 'R2-facto-errado');
  });
  it('resposta certa com o número bem escrito de outra forma → certa', () => {
    const texto = 'Isso é com a Vimágua: 253439100.';
    const d = juntarFactos(
      saida({
        comportamento_observado: 'encaminhar',
        factos_certos: [],
        factos_em_falta: ['Vimágua', '253 439 100'],
      }),
      verificarFactos(texto, g),
      g,
    );
    assert.deepEqual(d.factos_em_falta, []);
    assert.equal(decidirVeredicto({ ...c, texto }, d).veredicto, 'certa');
  });
});

describe('R3 sem resposta', () => {
  it('vazia, erro ou "não percebi" → sem_resposta', () => {
    for (const [texto, erro] of [
      ['', null],
      ['   ', null],
      [null, 'erro_adaptador'],
      ['Desculpe, não percebi. Pode reformular?', null],
    ] as const) {
      assert.equal(
        decidirVeredicto(ctx({ texto, erro }), descricaoVazia()).veredicto,
        'sem_resposta',
        String(texto),
      );
    }
  });
  it('comportamento "nenhum" do juiz → sem_resposta', () => {
    assert.equal(
      decidirVeredicto(
        ctx({ texto: 'Hmm.' }),
        desc({ comportamento_observado: 'nenhum' }),
      ).regra,
      'R3-sem-resposta',
    );
  });
  it('"não percebi" seguido de conteúdo longo não é sem_resposta', () => {
    const t =
      'Não percebi bem se pergunta pelo ecocentro de Azurém ou pelo de Silvares, mas ambos abrem das 8h às 17h de segunda a sábado, e ao domingo estão fechados. Leve os resíduos separados.';
    assert.equal(semResposta(t, null), false);
  });
});

describe('R4 comportamentos', () => {
  it('passar a humano esperado e feito → certa', () => {
    const c = ctx({
      comportamento_esperado: 'passar_humano',
      factos_obrigatorios: [],
    });
    assert.deepEqual(
      decidirVeredicto(c, desc({ comportamento_observado: 'passar_humano' })),
      { veredicto: 'certa', regra: 'R4-comportamento-certo' },
    );
  });
  it('fora de âmbito e perguntar, feitos → certa', () => {
    for (const e of ['fora_ambito', 'perguntar'] as const) {
      const c = ctx({ comportamento_esperado: e, factos_obrigatorios: [] });
      assert.equal(
        decidirVeredicto(c, desc({ comportamento_observado: e })).veredicto,
        'certa',
      );
    }
  });
  it('outra língua: na língua certa e com conteúdo → certa; sem conteúdo → errada', () => {
    const c = ctx({ comportamento_esperado: 'outra_lingua' });
    assert.equal(
      decidirVeredicto(c, desc({ comportamento_observado: 'outra_lingua' }))
        .veredicto,
      'certa',
    );
    assert.deepEqual(
      decidirVeredicto(
        c,
        desc({
          comportamento_observado: 'outra_lingua',
          factos_certos: [],
          factos_em_falta: ['8h às 17h'],
        }),
      ),
      { veredicto: 'errada', regra: 'R4-lingua-sem-conteudo' },
    );
  });
  it('outra língua respondida em português → errada', () => {
    const c = ctx({ comportamento_esperado: 'outra_lingua' });
    assert.equal(
      decidirVeredicto(c, desc({ comportamento_observado: 'responder' })).regra,
      'R4-comportamento-errado',
    );
  });
  it('passar a humano numa difícil → passada_bem', () => {
    const c = ctx({
      categoria: 'Perguntas difíceis',
      comportamento_esperado: 'responder',
    });
    assert.deepEqual(
      decidirVeredicto(
        c,
        desc({
          comportamento_observado: 'passar_humano',
          factos_certos: [],
          factos_em_falta: ['8h às 17h'],
          so_manda_contactar: true,
        }),
      ),
      { veredicto: 'passada_bem', regra: 'R4-passada-bem' },
    );
  });
  it('passar a humano numa pergunta normal com resposta concreta → errada', () => {
    assert.equal(
      decidirVeredicto(
        ctx(),
        desc({
          comportamento_observado: 'passar_humano',
          factos_certos: [],
          factos_em_falta: ['8h às 17h'],
        }),
      ).veredicto,
      'errada',
    );
  });
  it('inventar resposta a algo fora do âmbito → errada', () => {
    const c = ctx({
      comportamento_esperado: 'fora_ambito',
      factos_obrigatorios: [],
    });
    assert.equal(
      decidirVeredicto(
        c,
        desc({ comportamento_observado: 'responder', factos_certos: [] }),
      ).regra,
      'R4-comportamento-errado',
    );
  });
  it('perguntar esperado mas respondeu com todos os factos → certa', () => {
    const c = ctx({ comportamento_esperado: 'perguntar' });
    assert.equal(
      decidirVeredicto(c, desc({ comportamento_observado: 'responder' })).regra,
      'R4-respondeu-sem-perguntar',
    );
  });
  it('ehDificil reconhece variações', () => {
    assert.ok(ehDificil('Difíceis'));
    assert.ok(ehDificil('perguntas dificeis'));
    assert.ok(!ehDificil('Água'));
  });
});

describe('R5 só manda contactar', () => {
  it('"contacte-nos pelo 253 421 200" quando o gabarito tem resposta → errada', () => {
    const c = ctx({
      comportamento_esperado: 'encaminhar',
      factos_obrigatorios: ['Vimágua', '253 439 100'],
      texto: 'Para esse assunto contacte-nos pelo 253 421 200.',
    });
    assert.deepEqual(
      decidirVeredicto(
        c,
        desc({
          comportamento_observado: 'encaminhar',
          factos_certos: [],
          factos_em_falta: ['Vimágua', '253 439 100'],
          so_manda_contactar: true,
        }),
      ),
      { veredicto: 'errada', regra: 'R5-so-manda-contactar' },
    );
  });
  it('se o contacto é tudo o que o gabarito pede, mandar contactar é a resposta', () => {
    const c = ctx({ factos_obrigatorios: ['253 421 200'] });
    assert.equal(
      decidirVeredicto(
        c,
        desc({ factos_certos: ['253 421 200'], so_manda_contactar: true }),
      ).veredicto,
      'certa',
    );
  });
});

describe('R6 ocorrência', () => {
  const c = ctx({
    comportamento_esperado: 'ocorrencia',
    categoria: 'Via pública',
    factos_obrigatorios: ['Linha Verde', '800 910 410'],
  });
  it('registou → certa, mesmo sem os contactos', () => {
    assert.deepEqual(
      decidirVeredicto(
        c,
        desc({
          comportamento_observado: 'ocorrencia',
          factos_certos: [],
          factos_em_falta: ['Linha Verde', '800 910 410'],
        }),
      ),
      { veredicto: 'certa', regra: 'R6-ocorrencia-registada' },
    );
  });
  it('disse onde reportar com o contacto certo ("800910410") → certa', () => {
    const texto = 'Pode reportar o buraco na Linha Verde, 800910410.';
    const g = {
      factos_obrigatorios: c.factos_obrigatorios,
      factos_proibidos: [],
    };
    const d = juntarFactos(
      saida({
        comportamento_observado: 'encaminhar',
        factos_certos: [],
        factos_em_falta: [],
      }),
      verificarFactos(texto, g),
      g,
    );
    assert.equal(
      decidirVeredicto({ ...c, texto }, d).regra,
      'R6-ocorrencia-encaminhada',
    );
  });
  it('encaminhou sem o contacto → errada', () => {
    assert.equal(
      decidirVeredicto(
        c,
        desc({
          comportamento_observado: 'encaminhar',
          factos_certos: ['Linha Verde'],
          factos_em_falta: ['800 910 410'],
        }),
      ).regra,
      'R6-ocorrencia-falhada',
    );
  });
});

describe('R7 factos obrigatórios', () => {
  it('em falta → errada; todos → certa', () => {
    assert.equal(
      decidirVeredicto(
        ctx(),
        desc({ factos_certos: [], factos_em_falta: ['8h às 17h'] }),
      ).regra,
      'R7-factos-em-falta',
    );
    assert.equal(decidirVeredicto(ctx(), desc()).regra, 'R7-factos-completos');
  });
});

describe('juntarFactos', () => {
  const g = {
    factos_obrigatorios: ['Vimágua', '253 439 100'],
    factos_proibidos: ['Águas de Guimarães'],
  };
  it('aceita o identificador e devolve o texto do gabarito', () => {
    const d = juntarFactos(
      saida({
        factos_certos: ['O1'],
        factos_em_falta: ['O2'],
        factos_errados: ['P1'],
      }),
      verificarFactos('', g),
      g,
    );
    assert.deepEqual(d.factos_certos, ['Vimágua']);
    assert.deepEqual(d.factos_em_falta, ['253 439 100']);
    assert.deepEqual(d.factos_errados, ['Águas de Guimarães']);
  });
  it('facto obrigatório que o juiz não menciona conta como em falta', () => {
    const d = juntarFactos(
      saida({ factos_certos: [], factos_em_falta: [] }),
      verificarFactos('', g),
      g,
    );
    assert.deepEqual(d.factos_em_falta, ['Vimágua', '253 439 100']);
  });
  it('regra na justificação vai e volta', () => {
    assert.equal(
      regraDaJustificacao(justificacaoComRegra('R5-so-manda-contactar', 'x')),
      'R5-so-manda-contactar',
    );
  });
});
