import {
  emailMelhoria,
  limparGrupos,
  PerguntaAberta,
  protegerValores,
  resolverRef,
  transicaoPermitida,
} from './melhorias.js';

describe('limparGrupos', () => {
  const perguntas: PerguntaAberta[] = [
    { id: 'a', texto: 'Horário do ecocentro ao sábado?', vezes: 3 },
    { id: 'b', texto: 'O ecocentro abre ao domingo?', vezes: 2 },
    { id: 'c', texto: 'Como pedir licença de ruído?', vezes: 7 },
  ];

  it('mapeia referências, soma vezes e ordena por vezes', () => {
    const g = limparGrupos(
      [
        { tema: 'Ecocentro · horário', perguntas: ['P1', 'p2'] },
        { tema: 'Licença de ruído', perguntas: ['P3'] },
      ],
      perguntas,
    );
    expect(g.map((x) => [x.tema, x.vezes])).toEqual([
      ['Licença de ruído', 7],
      ['Ecocentro · horário', 5],
    ]);
    expect(g[1].perguntas.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('ignora referências desconhecidas, repetidas e grupos vazios', () => {
    const g = limparGrupos(
      [
        { tema: 'A', perguntas: ['P1', 'P9'] },
        { tema: 'B', perguntas: ['P1'] },
        { tema: '', perguntas: ['P2'] },
      ],
      perguntas,
    );
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.perguntas[0].id === 'b')?.tema).toBe(
      'O ecocentro abre ao domingo?',
    );
  });
});

describe('resolverRef', () => {
  const lista = ['x', 'y'];
  it('resolve F2 e rejeita o resto', () => {
    expect(resolverRef('F2', 'F', lista)).toBe('y');
    expect(resolverRef(' f1 ', 'F', lista)).toBe('x');
    expect(resolverRef('F3', 'F', lista)).toBeNull();
    expect(resolverRef('E1', 'F', lista)).toBeNull();
    expect(resolverRef('', 'F', lista)).toBeNull();
    expect(resolverRef(null, 'F', lista)).toBeNull();
  });
});

describe('protegerValores', () => {
  const fontes = [
    'O ecocentro funciona de segunda a sexta, das 9h às 17h. Taxa: 15,00 €. Contacto: 253 421 200, ecocentro@cm-exemplo.pt',
  ];

  it('mantém o que está nas fontes', () => {
    const t =
      'Abre às 9h. Custa 15 €. Ligue 253 421 200 ou escreva para ecocentro@cm-exemplo.pt.';
    expect(protegerValores(t, fontes)).toEqual({ texto: t, marcados: [] });
  });

  it('marca valores inventados', () => {
    const r = protegerValores(
      'Ao sábado abre às 10h, custa 20 euros, resposta em 5 dias úteis. Ligue 800 100 200, veja www.exemplo.pt ou geral@outro.pt',
      fontes,
    );
    expect(r.marcados).toEqual([
      'geral@outro.pt',
      'www.exemplo.pt',
      '800 100 200',
      '20 euros',
      '5 dias úteis',
      '10h',
    ]);
    expect(r.texto).toContain('[a confirmar pela câmara: 20 euros]');
    expect(r.texto).toContain('[a confirmar pela câmara: 10h]');
  });

  it('não mexe no que já está marcado', () => {
    const t = 'Abre ao sábado [a confirmar pela câmara: horário, ex. 10h].';
    expect(protegerValores(t, fontes)).toEqual({ texto: t, marcados: [] });
  });

  it('sem fontes marca tudo o que é concreto', () => {
    const r = protegerValores('Prazo de 30 dias.', []);
    expect(r.texto).toBe('Prazo de [a confirmar pela câmara: 30 dias].');
  });
});

describe('transicaoPermitida', () => {
  it('segue o ciclo de vida', () => {
    expect(transicaoPermitida('proposta', 'enviada')).toBe(true);
    expect(transicaoPermitida('enviada', 'publicada')).toBe(true);
    expect(transicaoPermitida('rejeitada', 'proposta')).toBe(true);
    expect(transicaoPermitida('rejeitada', 'publicada')).toBe(false);
    expect(transicaoPermitida('publicada', 'proposta')).toBe(false);
    expect(transicaoPermitida('publicada', 'publicada')).toBe(true);
  });
});

describe('emailMelhoria', () => {
  it('leva a sugestão, o aviso e as perguntas, sem frases reais', () => {
    const e = emailMelhoria({
      municipio: 'Exemplo',
      titulo: 'Horário do ecocentro',
      o_que_falta: 'O portal não diz o horário ao fim de semana.',
      sugestao: 'Ao sábado [a confirmar pela câmara: horário].',
      tipo: 'tornar_visivel',
      onde: 'Ecocentros',
      onde_url: 'https://cm-exemplo.pt/ecocentros',
      fonte_existente: { titulo: 'Regulamento', url: 'https://x/r.pdf' },
      entidade: 'Câmara Municipal',
      notas: null,
      perguntas: [
        { texto: 'Horário ao sábado?', vezes: 3 },
        { texto: 'Abre ao domingo?', vezes: 2 },
      ],
    });
    expect(e.assunto).toBe('Melhoria ao portal: Horário do ecocentro');
    expect(e.texto).toContain('houve 5 perguntas');
    expect(e.texto).toContain('https://cm-exemplo.pt/ecocentros');
    expect(e.texto).toContain('"Regulamento" (https://x/r.pdf)');
    expect(e.texto).toContain('- Horário ao sábado? (3×)');
    expect(e.texto).toContain('[a confirmar pela câmara: …]');
  });
});
