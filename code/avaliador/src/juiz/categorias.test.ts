import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIAS } from '../tipos.js';
import { concluir, type ItemAvaliar } from './avaliar.js';
import {
  decidirCategoria,
  factosEssenciais,
  juntarDescricao,
  NOTA_CATEGORIA,
  notaMedia,
  saidaVazia,
  type ContextoCategoria,
  type DescricaoV2,
} from './categorias.js';
import { verificarFactos } from './factos.js';
import { decidirVeredicto } from './regras.js';
import { mensagemJuiz, type SaidaJuiz } from './rubrica.js';

/* Pergunta de referência: "Onde e quando posso levar monos?" (E, E, S). */
const OBRIG = ['Ecocentro de Azurém', '8h às 17h', 'Linha Verde 800 910 410'];
const SEC = ['Linha Verde 800 910 410'];

function ctx(p: Partial<ContextoCategoria> = {}): ContextoCategoria {
  return {
    comportamento_esperado: 'responder',
    categoria: 'Ambiente',
    factos_obrigatorios: OBRIG,
    factos_secundarios: SEC,
    texto: 'Pode levar ao Ecocentro de Azurém, das 8h às 17h.',
    erro: null,
    ...p,
  };
}
function desc(p: Partial<DescricaoV2> = {}): DescricaoV2 {
  return {
    comportamento_observado: 'responder',
    factos_certos: [...OBRIG],
    factos_em_falta: [],
    factos_errados: [],
    so_manda_contactar: false,
    manda_ligar_112: false,
    erros_menores: [],
    nao_encontrou: false,
    suficiente: 'sim',
    categoria_juiz: 'certa',
    ...p,
  };
}
/** Só com estes factos certos (os outros em falta). */
function com(certos: string[], p: Partial<DescricaoV2> = {}): DescricaoV2 {
  return desc({
    factos_certos: certos,
    factos_em_falta: OBRIG.filter((f) => !certos.includes(f)),
    ...p,
  });
}
const [E1, E2, S1] = OBRIG;

describe('C1 sem resposta', () => {
  it('vazia, erro, "não percebi" ou comportamento "nenhum" → sem_resposta', () => {
    for (const [texto, erro] of [
      ['', null],
      [null, 'erro_adaptador'],
      ['Desculpe, não percebi. Pode reformular?', null],
    ] as const)
      assert.deepEqual(
        decidirCategoria(ctx({ texto, erro }), com([])),
        { categoria: 'sem_resposta', regra: 'C1-sem-resposta' },
        String(texto),
      );
    assert.equal(
      decidirCategoria(ctx(), com([], { comportamento_observado: 'nenhum' }))
        .regra,
      'C1-sem-resposta',
    );
  });
  it('emergência vazia é sem_resposta (C1 vem antes de C2)', () => {
    const c = ctx({ comportamento_esperado: 'emergencia', texto: '' });
    assert.equal(decidirCategoria(c, com([])).categoria, 'sem_resposta');
  });
});

describe('C2 emergência sem 112', () => {
  it('resposta perfeita que não manda ligar 112 → errada', () => {
    const c = ctx({
      comportamento_esperado: 'emergencia',
      categoria: 'Proteção civil',
    });
    assert.deepEqual(decidirCategoria(c, desc()), {
      categoria: 'errada',
      regra: 'C2-emergencia-sem-112',
    });
  });
  it('com 112 segue as outras regras', () => {
    const c = ctx({ comportamento_esperado: 'emergencia' });
    assert.equal(
      decidirCategoria(c, desc({ manda_ligar_112: true })).regra,
      'C10-completa',
    );
  });
});

describe('C3 erros graves', () => {
  it('erro grave com um essencial certo → maioritariamente_errada', () => {
    assert.deepEqual(
      decidirCategoria(
        ctx(),
        com([E1], { factos_errados: ['diz 9h às 18h; o certo é 8h às 17h'] }),
      ),
      {
        categoria: 'maioritariamente_errada',
        regra: 'C3-erro-grave-com-essencial',
      },
    );
  });
  it('erro grave sem nenhum essencial certo → errada (um secundário não salva)', () => {
    assert.deepEqual(
      decidirCategoria(
        ctx(),
        com([S1], { factos_errados: ['entidade errada'] }),
      ),
      { categoria: 'errada', regra: 'C3-erro-grave' },
    );
  });
  it('erro grave vem antes do comportamento certo e do "só contacte"', () => {
    const c = ctx({ comportamento_esperado: 'perguntar' });
    const d = com([], {
      comportamento_observado: 'perguntar',
      so_manda_contactar: true,
      factos_errados: ['facto proibido'],
    });
    assert.equal(decidirCategoria(c, d).regra, 'C3-erro-grave');
  });
  it('facto proibido no texto conta mesmo que o juiz não o veja', () => {
    const g = {
      factos_obrigatorios: ['Vimágua', '253 439 100'],
      factos_proibidos: ['Águas de Guimarães'],
    };
    const texto = 'É com a Vimágua, ou com a Aguas de Guimaraes.';
    const d = juntarDescricao(
      {
        ...saidaVazia(),
        comportamento_observado: 'encaminhar',
        factos_certos: ['Vimágua'],
        em_falta: ['253 439 100'],
      },
      verificarFactos(texto, g),
      g,
    );
    assert.equal(
      decidirCategoria(
        {
          ...ctx({ comportamento_esperado: 'encaminhar', texto }),
          ...g,
          factos_secundarios: [],
        },
        d,
      ).categoria,
      'maioritariamente_errada',
    );
  });
});

describe('C4 comportamentos', () => {
  it('esperado passar_humano / fora_ambito / perguntar / outra_lingua e feito → certa', () => {
    for (const e of [
      'passar_humano',
      'fora_ambito',
      'perguntar',
      'outra_lingua',
    ] as const)
      assert.deepEqual(
        decidirCategoria(
          ctx({ comportamento_esperado: e }),
          com([], { comportamento_observado: e }),
        ),
        { categoria: 'certa', regra: 'C4-comportamento-certo' },
        e,
      );
  });
  it('passou a pessoa numa difícil → certa, mesmo sem factos e a mandar contactar', () => {
    const c = ctx({ categoria: 'Perguntas difíceis' });
    assert.deepEqual(
      decidirCategoria(
        c,
        com([], {
          comportamento_observado: 'passar_humano',
          so_manda_contactar: true,
        }),
      ),
      { categoria: 'certa', regra: 'C4-passada-bem' },
    );
  });
  it('passou a pessoa sem necessidade numa normal → inconclusiva', () => {
    assert.deepEqual(
      decidirCategoria(
        ctx(),
        com([], { comportamento_observado: 'passar_humano' }),
      ),
      { categoria: 'inconclusiva', regra: 'C7-inconclusiva' },
    );
  });
  it('esperado perguntar mas respondeu com todos os essenciais → segue C7 a C10', () => {
    const c = ctx({ comportamento_esperado: 'perguntar' });
    assert.deepEqual(decidirCategoria(c, desc()), {
      categoria: 'certa',
      regra: 'C10-completa',
    });
    assert.equal(
      decidirCategoria(c, com([E1, E2])).categoria,
      'maioritariamente_certa',
    );
    // Sem todos os essenciais também não é "certa" por ter respondido.
    assert.equal(
      decidirCategoria(c, com([E1])).categoria,
      'parcialmente_certa',
    );
  });
});

describe('C5 só manda contactar', () => {
  it('só manda contactar sem dar o que foi pedido → mandou_contactar', () => {
    assert.deepEqual(
      decidirCategoria(ctx(), com([S1], { so_manda_contactar: true })),
      { categoria: 'mandou_contactar', regra: 'C5-so-manda-contactar' },
    );
  });
  it('com todos os essenciais, mandar contactar é a resposta', () => {
    const c = ctx({
      factos_obrigatorios: ['253 421 200'],
      factos_secundarios: [],
    });
    assert.equal(
      decidirCategoria(
        c,
        desc({ factos_certos: ['253 421 200'], so_manda_contactar: true }),
      ).categoria,
      'certa',
    );
  });
});

describe('C6 ocorrência', () => {
  const c = ctx({ comportamento_esperado: 'ocorrencia' });
  it('registou a ocorrência → certa, mesmo sem os contactos', () => {
    assert.deepEqual(
      decidirCategoria(c, com([], { comportamento_observado: 'ocorrencia' })),
      { categoria: 'certa', regra: 'C6-ocorrencia-registada' },
    );
  });
  it('não registou: os factos decidem', () => {
    assert.equal(
      decidirCategoria(c, com([E1], { comportamento_observado: 'encaminhar' }))
        .regra,
      'C8-essencial-em-falta',
    );
  });
});

describe('C7 nenhum essencial', () => {
  it('nenhum essencial e diz que não encontrou → nao_encontrou', () => {
    assert.deepEqual(
      decidirCategoria(ctx(), com([S1], { nao_encontrou: true })),
      { categoria: 'nao_encontrou', regra: 'C7-nao-encontrou' },
    );
  });
  it('nenhum essencial por outra razão → inconclusiva', () => {
    assert.deepEqual(decidirCategoria(ctx(), com([])), {
      categoria: 'inconclusiva',
      regra: 'C7-inconclusiva',
    });
  });
  it('diz que não encontrou mas dá um essencial → não é nao_encontrou', () => {
    assert.equal(
      decidirCategoria(ctx(), com([E1], { nao_encontrou: true })).categoria,
      'parcialmente_certa',
    );
  });
  it('gabarito sem factos: comportamento esperado não feito → inconclusiva', () => {
    const c = ctx({
      comportamento_esperado: 'fora_ambito',
      factos_obrigatorios: [],
      factos_secundarios: [],
    });
    assert.equal(
      decidirCategoria(c, desc({ factos_certos: [] })).regra,
      'C7-inconclusiva',
    );
  });
  it('gabarito sem factos: "não encontrei" → nao_encontrou; resposta normal → certa', () => {
    const c = ctx({ factos_obrigatorios: [], factos_secundarios: [] });
    assert.equal(
      decidirCategoria(c, desc({ factos_certos: [], nao_encontrou: true }))
        .categoria,
      'nao_encontrou',
    );
    assert.equal(
      decidirCategoria(c, desc({ factos_certos: [] })).categoria,
      'certa',
    );
  });
});

describe('C8 a C10', () => {
  it('falta um essencial → parcialmente_certa', () => {
    assert.deepEqual(decidirCategoria(ctx(), com([E1, S1])), {
      categoria: 'parcialmente_certa',
      regra: 'C8-essencial-em-falta',
    });
  });
  it('só secundários em falta → maioritariamente_certa', () => {
    assert.deepEqual(decidirCategoria(ctx(), com([E1, E2])), {
      categoria: 'maioritariamente_certa',
      regra: 'C9-secundario-em-falta',
    });
  });
  it('tudo certo mas com um erro menor → maioritariamente_certa', () => {
    assert.deepEqual(
      decidirCategoria(
        ctx(),
        desc({ erros_menores: ['horário de sábado desatualizado'] }),
      ),
      { categoria: 'maioritariamente_certa', regra: 'C9-erro-menor' },
    );
  });
  it('todos os factos, sem erros → certa', () => {
    assert.deepEqual(decidirCategoria(ctx(), desc()), {
      categoria: 'certa',
      regra: 'C10-completa',
    });
  });
});

describe('factos essenciais', () => {
  it('sem classificação, todos contam como essenciais', () => {
    const c = ctx({ factos_secundarios: [] });
    assert.equal(
      decidirCategoria(c, com([E1, E2])).categoria,
      'parcialmente_certa',
    );
  });
  it('a marca S bate com outra pontuação ou espaços; facto novo não marcado é E', () => {
    assert.deepEqual(
      factosEssenciais(
        [...OBRIG, 'facto acrescentado depois'],
        ['linha verde 800-910-410'],
      ),
      [E1, E2, 'facto acrescentado depois'],
    );
  });
});

describe('juntarDescricao', () => {
  const g = {
    factos_obrigatorios: OBRIG,
    factos_proibidos: ['Ecocentro de Silvares'],
  };
  const s = (p: Partial<SaidaJuiz>): SaidaJuiz => ({ ...saidaVazia(), ...p });
  it('traduz os nomes da v2 para os da v1 (factos_errados = erros graves)', () => {
    const d = juntarDescricao(
      s({
        comportamento_observado: 'responder',
        factos_certos: ['O1'],
        em_falta: ['O2', 'O3'],
        erros_graves: ['diz 9h; o certo é 8h'],
        erros_menores: ['nome da página aproximado', ' '],
        nao_encontrou: false,
        manda_112: true,
        suficiente: 'em_parte',
        categoria_juiz: 'maioritariamente_errada',
      }),
      verificarFactos('', g),
      g,
    );
    assert.deepEqual(d.factos_certos, [E1]);
    assert.deepEqual(d.factos_em_falta, [E2, S1]);
    assert.deepEqual(d.factos_errados, ['diz 9h; o certo é 8h']);
    assert.deepEqual(d.erros_menores, ['nome da página aproximado']);
    assert.equal(d.manda_ligar_112, true);
    assert.equal(d.suficiente, 'em_parte');
    assert.equal(d.categoria_juiz, 'maioritariamente_errada');
  });
  it('um facto proibido nunca é erro menor', () => {
    const d = juntarDescricao(
      s({ erros_menores: ['P1'] }),
      verificarFactos('', g),
      g,
    );
    assert.deepEqual(d.factos_errados, ['Ecocentro de Silvares']);
    assert.deepEqual(d.erros_menores, []);
  });
});

describe('continuidade com o veredicto binário', () => {
  it('a mesma descrição dá o veredicto de sempre e a categoria nova', () => {
    const casos: [DescricaoV2, string, string][] = [
      [com([E1, E2]), 'errada', 'maioritariamente_certa'],
      [com([E1]), 'errada', 'parcialmente_certa'],
      [desc({ erros_menores: ['x'] }), 'certa', 'maioritariamente_certa'],
      [desc(), 'certa', 'certa'],
      [
        com([E1], { factos_errados: ['y'] }),
        'errada',
        'maioritariamente_errada',
      ],
    ];
    for (const [d, v1, v2] of casos) {
      assert.equal(decidirVeredicto(ctx(), d).veredicto, v1);
      assert.equal(decidirCategoria(ctx(), d).categoria, v2);
    }
  });
  it('concluir: secundário em falta é errada na v1 e maioritariamente_certa na v2', () => {
    const i: ItemAvaliar = {
      resposta_id: 'r',
      texto: 'Pode levar ao Ecocentro de Azurém, das 8h às 17h.',
      erro: null,
      pergunta: 'Onde levo monos?',
      idioma: 'pt-PT',
      categoria: 'Ambiente',
      comportamento: 'responder',
      entidade_esperada: null,
      gabarito_id: 'g',
      gabarito_resposta: 'ref',
      factos_obrigatorios: OBRIG,
      factos_proibidos: [],
      factos_secundarios: SEC,
    };
    const saida: SaidaJuiz = {
      ...saidaVazia(),
      comportamento_observado: 'responder',
      factos_certos: [E1, E2],
      em_falta: [S1],
      suficiente: 'sim',
      categoria_juiz: 'maioritariamente_certa',
      nota: 'Falta a Linha Verde.',
    };
    const uso = { entrada: 0, cache_escrita: 0, cache_leitura: 0, saida: 0 };
    const a = concluir(i, { ok: true, saida, uso });
    assert.equal(a.decisao.veredicto, 'errada');
    assert.equal(a.categoria.categoria, 'maioritariamente_certa');
    assert.equal(a.justificacao, '[R7-factos-em-falta] Falta a Linha Verde.');
    // Sem classificação, o mesmo caso é parcialmente_certa (tudo é E).
    const b = concluir(
      { ...i, factos_secundarios: null },
      { ok: true, saida, uso },
    );
    assert.equal(b.categoria.categoria, 'parcialmente_certa');
  });
});

describe('nota e mensagem', () => {
  it('nota 0–100 por categoria e média', () => {
    assert.equal(NOTA_CATEGORIA.certa, 100);
    assert.equal(NOTA_CATEGORIA.maioritariamente_certa, 75);
    assert.equal(NOTA_CATEGORIA.parcialmente_certa, 50);
    assert.equal(NOTA_CATEGORIA.maioritariamente_errada, 25);
    for (const c of CATEGORIAS.slice(0, 5)) assert.equal(NOTA_CATEGORIA[c], 0);
    assert.equal(notaMedia(['certa', 'parcialmente_certa', 'errada']), 50);
    assert.equal(notaMedia([]), null);
  });
  it('a mensagem ao juiz marca cada facto obrigatório como E ou S', () => {
    const m = mensagemJuiz({
      pergunta: 'P?',
      idioma: 'pt-PT',
      categoria: 'Ambiente',
      comportamento_esperado: 'responder',
      entidade_esperada: null,
      gabarito: {
        resposta: 'R',
        factos_obrigatorios: OBRIG,
        factos_proibidos: [],
        factos_secundarios: SEC,
      },
      resposta: 'T',
    });
    assert.ok(m.includes(`[E] O1. ${E1}`));
    assert.ok(m.includes(`[E] O2. ${E2}`));
    assert.ok(m.includes(`[S] O3. ${S1}`));
  });
});
