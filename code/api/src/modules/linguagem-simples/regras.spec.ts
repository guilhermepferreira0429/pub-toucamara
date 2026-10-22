import { partirEmTrechos } from '../conhecimento/texto.js';
import {
  desatualizada,
  detetarTermos,
  estadoDocumento,
  ligarTrechos,
  limparPartes,
  normalizar,
  primeirasFrases,
  procurarTermo,
  rascunhoExtrativo,
  seccoesDoOriginal,
  seccoesInvalidas,
  TERMOS_DEMONSTRACAO,
} from './regras.js';

const REGULAMENTO = [
  'Regulamento das Esplanadas',
  'Artigo 1.º Objeto',
  'O presente regulamento estabelece as regras de instalação de esplanadas abertas na via pública.',
  'Artigo 2.º Licença',
  '1 - A instalação de esplanada está sujeita a comunicação prévia no Balcão do Empreendedor.',
  '2 - A comunicação é feita com 20 dias úteis de antecedência.',
  'Artigo 3.º Taxas',
  'A ocupação paga uma taxa de 5 euros por metro quadrado e por mês.',
].join('\n');

describe('seccoesDoOriginal', () => {
  it('parte por artigos, com o texto todo uma vez e ids estáveis', () => {
    const s = seccoesDoOriginal(REGULAMENTO);
    expect(s.map((x) => x.referencia)).toEqual([
      null,
      'art. 1.º',
      'art. 2.º',
      'art. 3.º',
    ]);
    expect(s.map((x) => x.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(s[2].texto).toContain('20 dias úteis');
    expect(seccoesDoOriginal(REGULAMENTO)).toEqual(s);
  });

  it('sem artigos nem títulos, por parágrafos', () => {
    const s = seccoesDoOriginal(
      'Edital n.º 12/2026\nTorna-se público que a feira muda de sítio.\nA feira passa para o Largo.',
    );
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.referencia === null)).toBe(true);
  });
});

describe('ligarTrechos', () => {
  it('liga os trechos do conhecimento às secções (pela referência ou pelo texto)', () => {
    const seccoes = seccoesDoOriginal(REGULAMENTO);
    const trechos = partirEmTrechos(REGULAMENTO, {
      alvo: 60,
      sobreposicao: 30,
    }).map((t, i) => ({ id: `t${i + 1}`, ...t }));
    const mapa = ligarTrechos(seccoes, trechos);
    // Todos os trechos caem numa secção.
    expect([...mapa.values()].flat().sort()).toEqual(
      trechos.map((t) => t.id).sort(),
    );
    // O artigo 2.º partido em n.º 1 e n.º 2: os dois trechos vão para s3.
    const doArt2 = trechos
      .filter((t) => t.referencia?.startsWith('art. 2.º'))
      .map((t) => t.id);
    expect(doArt2.length).toBeGreaterThan(0);
    expect(mapa.get('s3')).toEqual(expect.arrayContaining(doArt2));
    // Sem referência: pelo início do texto (o título do documento).
    const semRef = ligarTrechos(seccoes, [
      { id: 'x', referencia: null, texto: 'Regulamento das Esplanadas' },
    ]);
    expect(semRef.get('s1')).toEqual(['x']);
  });
});

describe('limparPartes', () => {
  const seccoes = seccoesDoOriginal(REGULAMENTO);
  const porSeccao = new Map([
    ['s3', ['t3', 't4']],
    ['s4', ['t5']],
  ]);

  it('só secções que existem, com os trechos delas; sem origem sai', () => {
    const partes = limparPartes(
      [
        {
          chave: 'quanto_custa',
          titulo: 'Quanto custa',
          texto: 'Paga 5 euros por metro quadrado, por mês.',
          seccoes: ['s4', 's99', 's4'],
        },
        {
          chave: 'o_que_tem_de_fazer',
          titulo: 'O que tem de fazer',
          texto: 'Faz uma comunicação prévia 20 dias úteis antes.',
          seccoes: ['s3'],
        },
        {
          chave: 'outro',
          titulo: 'Inventado',
          texto: 'Isto não vem de lado nenhum.',
          seccoes: ['s42'],
        },
      ],
      seccoes,
      porSeccao,
    );
    expect(partes.map((p) => p.chave)).toEqual([
      'o_que_tem_de_fazer',
      'quanto_custa',
    ]);
    expect(partes[1]).toMatchObject({ seccoes: ['s4'], trechos: ['t5'] });
    expect(partes[0].trechos).toEqual(['t3', 't4']);
  });

  it('secções inválidas ao gravar', () => {
    expect(
      seccoesInvalidas(
        [{ chave: 'outro', titulo: 'x', texto: 'y', seccoes: ['s1', 's9'] }],
        seccoes,
      ),
    ).toEqual(['s9']);
  });
});

describe('rascunho sem IA (excertos)', () => {
  it('uma parte por secção, as primeiras frases, marcado para reescrever', () => {
    const seccoes = seccoesDoOriginal(REGULAMENTO);
    const r = rascunhoExtrativo('Regulamento das Esplanadas', seccoes);
    expect(r.partes).toHaveLength(seccoes.length);
    expect(r.partes[3]).toMatchObject({
      titulo: 'art. 3.º',
      seccoes: ['s4'],
    });
    expect(r.resumo).toMatch(/por simplificar/);
  });

  it('primeirasFrases corta em frases inteiras', () => {
    const t = 'Primeira frase. Segunda frase mais longa. Terceira.';
    expect(primeirasFrases(t, 30)).toBe('Primeira frase.');
    expect(primeirasFrases('curta')).toBe('curta');
  });
});

describe('desatualização', () => {
  it('a versão simples presa à versão oficial; muda a fonte → desatualizada', () => {
    expect(desatualizada('v1', 'v1')).toBe(false);
    expect(desatualizada('v1', 'v2')).toBe(true);
    expect(desatualizada('v1', null)).toBe(true);
    expect(
      estadoDocumento({
        publicada: { fonte_versao_id: 'v1' },
        rascunho: null,
        versao_atual_id: 'v1',
      }),
    ).toBe('publicada');
    expect(
      estadoDocumento({
        publicada: { fonte_versao_id: 'v1' },
        rascunho: {},
        versao_atual_id: 'v2',
      }),
    ).toBe('desatualizada');
    expect(
      estadoDocumento({ publicada: null, rascunho: {}, versao_atual_id: 'v2' }),
    ).toBe('rascunho');
    expect(
      estadoDocumento({
        publicada: null,
        rascunho: null,
        versao_atual_id: null,
      }),
    ).toBe('sem_versao');
  });
});

describe('glossário: deteção de termos', () => {
  const termos = TERMOS_DEMONSTRACAO.map((t, i) => ({
    id: `g${i}`,
    termo: t.termo,
    variantes: t.variantes,
  }));
  const id = (termo: string) => termos.find((t) => t.termo === termo)!.id;

  it('encontra termos sem acentos nem maiúsculas, palavras inteiras, posições no original', () => {
    const texto =
      'Sem resposta no prazo há Deferimento Tácito. A AUDIENCIA PREVIA dura 10 dias úteis.';
    const marcas = detetarTermos(texto, termos);
    const achados = marcas.map((m) => texto.slice(m.inicio, m.fim));
    expect(achados).toEqual([
      'Deferimento Tácito',
      'AUDIENCIA PREVIA',
      'dias úteis',
    ]);
    expect(marcas[0].termo_id).toBe(id('deferimento tácito'));
  });

  it('a forma mais comprida ganha e não há sobreposições; só a 1.ª vez por defeito', () => {
    const texto =
      'O indeferimento não é deferimento. Houve deferimento tácito e outro deferimento tácito.';
    const marcas = detetarTermos(texto, termos);
    const achados = marcas.map((m) => texto.slice(m.inicio, m.fim));
    expect(achados).toEqual([
      'indeferimento',
      'deferimento',
      'deferimento tácito',
    ]);
    expect(detetarTermos(texto, termos, { todas: true })).toHaveLength(4);
  });

  it('atravessa mudanças de linha e espaços a mais', () => {
    const texto = 'Há lugar a audiência\n  prévia antes de decidir.';
    const [m] = detetarTermos(texto, termos);
    expect(texto.slice(m.inicio, m.fim)).toBe('audiência\n  prévia');
  });

  it('não marca pedaços de palavras', () => {
    expect(detetarTermos('Os editaisx e prealvará', termos)).toEqual([]);
  });

  it('procurarTermo: pela pergunta da pessoa', () => {
    expect(procurarTermo(termos, 'O que é o deferimento tácito?')?.termo).toBe(
      'deferimento tácito',
    );
    expect(procurarTermo(termos, 'o que quer dizer RJUE')?.termo).toBe('RJUE');
    expect(procurarTermo(termos, 'alvarás')?.termo).toBe('alvará');
    expect(
      procurarTermo(termos, 'e a audiencia dos interessados, o que é?')?.termo,
    ).toBe('audiência prévia');
    expect(procurarTermo(termos, 'comunicação')?.termo).toBe(
      'comunicação prévia',
    );
    expect(procurarTermo(termos, 'o que é um bolo de bolacha')).toBeNull();
  });

  it('normalizar', () => {
    expect(normalizar('  Audiência   Prévia ')).toBe('audiencia previa');
  });
});
