import {
  descodificarBytes,
  descodificarEntidades,
  ePdf,
  diffLinhas,
  hashTexto,
  htmlParaTexto,
  partirEmTrechos,
  resumoDiff,
} from './texto.js';

describe('htmlParaTexto', () => {
  it('tira script, style, nav e rodapé e mantém títulos e parágrafos', () => {
    const html = `<html><head><title>X</title><style>p{color:red}</style></head>
      <body><nav><a href="/">Início</a></nav>
      <script>var x = "<p>não</p>";</script>
      <h1>Licenças de obras</h1>
      <p>Obras no <b>interior</b> da habita&ccedil;&atilde;o&nbsp;n&atilde;o precisam de licen&ccedil;a.</p>
      <p>Contacte o balc&#227;o.<br>Seg-Sex.</p>
      <footer>© Câmara</footer></body></html>`;
    expect(htmlParaTexto(html)).toBe(
      [
        '## Licenças de obras',
        '',
        'Obras no interior da habitação não precisam de licença.',
        '',
        'Contacte o balcão.',
        'Seg-Sex.',
      ].join('\n'),
    );
  });

  it('usa só o <main> quando existe', () => {
    const html =
      '<body><div>Menu lateral</div><main><p>Conteúdo</p></main><div>Outro</div></body>';
    expect(htmlParaTexto(html)).toBe('Conteúdo');
  });

  it('listas com "- " e tabelas com " · "', () => {
    const html =
      '<ul><li>Um</li><li>Dois</li></ul><table><tr><td>Taxa</td><td>10 €</td></tr></table>';
    expect(htmlParaTexto(html)).toBe('- Um\n- Dois\n\nTaxa · 10 €');
  });

  it('descodifica entidades numéricas e com nome', () => {
    expect(descodificarEntidades('&#x41;&#66;&amp;&euro;&desconhecida;')).toBe(
      'AB&€&desconhecida;',
    );
  });
});

describe('descodificarBytes e ePdf', () => {
  it('usa o charset do Content-Type ou do <meta>', () => {
    const latin1 = Buffer.from(
      '<meta charset="iso-8859-1"><p>licença</p>',
      'latin1',
    );
    expect(descodificarBytes(latin1)).toContain('licença');
    expect(
      descodificarBytes(
        Buffer.from('ação', 'latin1'),
        'text/html; charset=ISO-8859-1',
      ),
    ).toBe('ação');
    expect(descodificarBytes(Buffer.from('ação'))).toBe('ação');
  });

  it('reconhece PDF pelo tipo, URL ou assinatura', () => {
    expect(ePdf(Buffer.from('%PDF-1.7'))).toBe(true);
    expect(ePdf(Buffer.from('<html>'), 'application/pdf')).toBe(true);
    expect(ePdf(Buffer.from(''), '', 'https://x.pt/reg.pdf?v=2')).toBe(true);
    expect(ePdf(Buffer.from('<html>'), 'text/html', 'https://x.pt/')).toBe(
      false,
    );
  });
});

describe('hashTexto', () => {
  it('sha256 em hex', () => {
    expect(hashTexto('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('partirEmTrechos', () => {
  it('parte por artigos com referência', () => {
    const texto = [
      'Regulamento de Taxas',
      'Artigo 1.º',
      'Objeto',
      'O presente regulamento fixa as taxas.',
      'Art. 2º',
      'Isenções',
      'Estão isentas as IPSS.',
      'ARTIGO 3.º-A',
      'Norma nova.',
    ].join('\n');
    const t = partirEmTrechos(texto);
    expect(t.map((x) => x.referencia)).toEqual([
      null,
      'art. 1.º',
      'art. 2.º',
      'art. 3.º-A',
    ]);
    expect(t[1].texto).toBe(
      'Artigo 1.º\nObjeto\nO presente regulamento fixa as taxas.',
    );
    expect(t.map((x) => x.ordem)).toEqual([1, 2, 3, 4]);
  });

  it('artigo longo: cada pedaço que começa num número leva o n.º', () => {
    const p = (n: number) => `${n} - ${'texto do número '.repeat(30).trim()}.`;
    const texto = ['Artigo 6.º', p(1), p(2), p(3), 'Artigo 7.º', 'Curto.'].join(
      '\n',
    );
    const t = partirEmTrechos(texto, { alvo: 600, sobreposicao: 0 });
    expect(t.map((x) => x.referencia)).toEqual([
      'art. 6.º',
      'art. 6.º, n.º 2',
      'art. 6.º, n.º 3',
      'art. 7.º',
    ]);
  });

  it('sem artigos parte por títulos e respeita o tamanho alvo com sobreposição', () => {
    const par = (i: number) =>
      `Parágrafo ${i} ${'palavra '.repeat(40).trim()}.`;
    const texto = [
      '## Água',
      par(1),
      par(2),
      par(3),
      '## Resíduos',
      par(4),
    ].join('\n');
    const t = partirEmTrechos(texto, { alvo: 500, sobreposicao: 60 });
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t[0].referencia).toBe('Água');
    expect(t[0].texto.startsWith('Água\n')).toBe(true);
    // O segundo trecho da secção repete o fim do primeiro.
    expect(t[1].referencia).toBe('Água');
    expect(t[1].texto.startsWith('… ')).toBe(true);
    // A sobreposição não passa de uma secção para a outra.
    const residuos = t.find((x) => x.referencia === 'Resíduos')!;
    expect(residuos.texto.startsWith('Resíduos\n')).toBe(true);
    for (const x of t) expect(x.texto.length).toBeLessThan(1000);
  });

  it('parte parágrafos enormes por frases', () => {
    const frase = 'Esta é uma frase razoavelmente comprida sobre taxas. ';
    const t = partirEmTrechos(frase.repeat(60), {
      alvo: 400,
      sobreposicao: 0,
    });
    expect(t.length).toBeGreaterThan(4);
    for (const x of t) expect(x.texto.length).toBeLessThanOrEqual(600);
  });

  it('texto vazio não dá trechos', () => {
    expect(partirEmTrechos('  \n\n ')).toEqual([]);
  });
});

describe('diffLinhas', () => {
  it('textos iguais', () => {
    const d = diffLinhas('a\nb', 'a\n\nb');
    expect(d.linhas_mudadas).toBe(0);
    expect(d.blocos).toEqual([]);
    expect(resumoDiff(d)).toBe('Sem diferenças no texto');
  });

  it('linha alterada conta uma vez e fica antes/depois', () => {
    const d = diffLinhas(
      'Taxas 2026\nLicença: 10 €\nVistoria: 5 €\nFim',
      'Taxas 2027\nLicença: 12 €\nVistoria: 5 €\nFim\nNova linha',
    );
    expect(d.blocos).toEqual([
      {
        linha_antes: 1,
        linha_depois: 1,
        antes: ['Taxas 2026', 'Licença: 10 €'],
        depois: ['Taxas 2027', 'Licença: 12 €'],
      },
      { linha_antes: 5, linha_depois: 5, antes: [], depois: ['Nova linha'] },
    ]);
    expect(d.linhas_mudadas).toBe(3);
    expect(d.removidas).toBe(2);
    expect(d.adicionadas).toBe(3);
    expect(resumoDiff(d)).toBe('3 linhas mudaram');
  });

  it('linha removida', () => {
    const d = diffLinhas('a\nb\nc', 'a\nc');
    expect(d.blocos).toEqual([
      { linha_antes: 2, linha_depois: 2, antes: ['b'], depois: [] },
    ]);
    expect(resumoDiff(d)).toBe('1 linha mudou');
  });

  it('trunca os blocos guardados', () => {
    const a = Array.from({ length: 10 }, (_, i) => `l${i}\nfixa${i}`).join(
      '\n',
    );
    const b = Array.from({ length: 10 }, (_, i) => `m${i}\nfixa${i}`).join(
      '\n',
    );
    const d = diffLinhas(a, b, 3);
    expect(d.blocos).toHaveLength(3);
    expect(d.truncado).toBe(true);
    expect(d.linhas_mudadas).toBe(10);
  });
});
