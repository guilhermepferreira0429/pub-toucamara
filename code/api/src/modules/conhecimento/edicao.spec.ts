import {
  diffFactos,
  diffFrases,
  dividirFrases,
  estadoVersao,
  extrairFactos,
  origemDe,
  precisaDe,
  textoDaVersao,
  VersaoRevisao,
} from './edicao.js';

describe('extrairFactos', () => {
  it('números, horas, telefones e emails, normalizados', () => {
    expect(
      extrairFactos(
        'Abre às 9h e fecha às 17:30. Taxa de 45,50 € (1.500 m²). Ligue 253 000 000 ou +351 800-111-222, ou escreva para Obras@CM-Teste.pt.',
      ),
    ).toEqual({
      numeros: ['1500', '17h30', '45,50', '9h00'],
      telefones: ['253000000', '800111222'],
      emails: ['obras@cm-teste.pt'],
    });
  });

  it('números por extenso (texto de voz); "um" sozinho é artigo', () => {
    expect(
      extrairFactos(
        'Tem vinte e cinco dias úteis para entregar um documento, às nove da manhã. Custa mil e duzentos euros.',
      ).numeros,
    ).toEqual(['1200', '25', '9']);
    expect(extrairFactos('Precisa de um papel e de uma foto.').numeros).toEqual(
      [],
    );
  });

  it('o mesmo facto escrito de outra forma não conta duas vezes', () => {
    expect(extrairFactos('09:00 e 9h00 e 9h').numeros).toEqual(['9h00']);
    expect(extrairFactos('').numeros).toEqual([]);
    expect(extrairFactos(null)).toEqual({
      numeros: [],
      telefones: [],
      emails: [],
    });
  });
});

describe('diffFactos', () => {
  it('mudar o prazo ou o telefone muda factos', () => {
    const d = diffFactos(
      'O prazo é de 20 dias. Ligue 253 000 000.',
      'O prazo é de 30 dias. Ligue 253 000 001.',
    );
    expect(d).toEqual({
      muda: true,
      adicionados: { numeros: ['30'], telefones: ['253000001'], emails: [] },
      removidos: { numeros: ['20'], telefones: ['253000000'], emails: [] },
    });
  });

  it('reescrever sem mexer em factos não muda', () => {
    expect(
      diffFactos(
        'O prazo é de vinte dias. Ligue 253000000.',
        'Tem 20 dias de prazo; o telefone é o 253 000 000.',
      ).muda,
    ).toBe(false);
  });

  it('extenso ↔ algarismos é o mesmo número; nove → dez muda', () => {
    expect(diffFactos('às nove', 'às 9').muda).toBe(false);
    expect(diffFactos('às nove', 'às dez').muda).toBe(true);
  });

  it('sem base, os factos do texto são todos novos', () => {
    expect(diffFactos(null, 'Ligue 112.')).toMatchObject({
      muda: true,
      adicionados: { numeros: ['112'] },
    });
    expect(diffFactos(null, 'Sem números aqui.').muda).toBe(false);
  });

  it('emails novos contam', () => {
    expect(diffFactos('Escreva-nos.', 'Escreva para a@b.pt.')).toMatchObject({
      muda: true,
      adicionados: { emails: ['a@b.pt'] },
    });
  });
});

describe('textoDaVersao', () => {
  it('junta voz e SMS', () => {
    expect(textoDaVersao({ texto_voz: 'A.', texto_sms: 'B.' })).toBe('A.\nB.');
    expect(textoDaVersao({ texto_voz: 'A.', texto_sms: null })).toBe('A.');
  });
});

describe('dividirFrases / diffFrases', () => {
  it('divide por pontuação e linhas', () => {
    expect(dividirFrases('Olá.  Tudo bem? Sim!\nFim')).toEqual([
      'Olá.',
      'Tudo bem?',
      'Sim!',
      'Fim',
    ]);
  });

  it('igual, alterada, removida e adicionada', () => {
    expect(
      diffFrases(
        'Abre às nove. Fica no largo. Traga o cartão.',
        'Abre às dez. Fica no largo. Traga o cartão. Não precisa de marcação.',
      ),
    ).toEqual([
      { tipo: 'alterada', antes: 'Abre às nove.', depois: 'Abre às dez.' },
      { tipo: 'igual', frase: 'Fica no largo.' },
      { tipo: 'igual', frase: 'Traga o cartão.' },
      { tipo: 'adicionada', depois: 'Não precisa de marcação.' },
    ]);
    expect(diffFrases('A. B. C.', 'A. C.')).toEqual([
      { tipo: 'igual', frase: 'A.' },
      { tipo: 'removida', antes: 'B.' },
      { tipo: 'igual', frase: 'C.' },
    ]);
  });

  it('sem versão anterior: tudo adicionado', () => {
    expect(diffFrases(null, 'Um. Dois.')).toEqual([
      { tipo: 'adicionada', depois: 'Um.' },
      { tipo: 'adicionada', depois: 'Dois.' },
    ]);
    expect(diffFrases('Só.', null)).toEqual([
      { tipo: 'removida', antes: 'Só.' },
    ]);
  });
});

describe('precisaDe', () => {
  const criada = '2026-10-20T10:00:00Z';
  const v = (o: Partial<VersaoRevisao> = {}): VersaoRevisao => ({
    origem: 'camara',
    muda_factos: false,
    revisao: null,
    criada_em: criada,
    ...o,
  });
  const passa = (iniciada: string | null) => ({
    permitir: true,
    execucao_iniciada_em: iniciada,
  });
  const falha = { permitir: false, execucao_iniciada_em: null };

  it('sem mudar factos: só o gate', () => {
    expect(precisaDe(v(), passa('2026-10-19T10:00:00Z'))).toEqual([]);
    expect(precisaDe(v(), falha)).toEqual(['avaliacao']);
  });

  it('a equipa interna só precisa do gate, mesmo mudando factos', () => {
    const e = v({ origem: 'equipa', muda_factos: true });
    expect(precisaDe(e, passa('2026-10-19T10:00:00Z'))).toEqual([]);
    expect(precisaDe(e, falha)).toEqual(['avaliacao']);
  });

  it('câmara a mudar factos: revisão interna ou avaliação iniciada depois', () => {
    const c = v({ muda_factos: true });
    expect(precisaDe(c, passa('2026-10-20T09:59:59Z'))).toEqual([
      'revisao_interna',
    ]);
    expect(precisaDe(c, passa(criada))).toEqual(['revisao_interna']);
    expect(precisaDe(c, passa('2026-10-20T10:00:01Z'))).toEqual([]);
    expect(precisaDe(c, falha)).toEqual(['avaliacao', 'revisao_interna']);
    expect(
      precisaDe(v({ muda_factos: true, revisao: 'aprovada' }), passa(null)),
    ).toEqual([]);
    expect(
      precisaDe(v({ muda_factos: true, revisao: 'aprovada' }), falha),
    ).toEqual(['avaliacao']);
  });
});

describe('origemDe / estadoVersao', () => {
  it('perfis internos escrevem como equipa', () => {
    expect(origemDe('admin')).toBe('equipa');
    expect(origemDe('equipa_toucamara')).toBe('equipa');
    expect(origemDe('chefe_divisao')).toBe('camara');
  });

  it('estados', () => {
    const base = {
      origem: 'camara' as const,
      revisao: null,
      publicada_em: null,
    };
    expect(estadoVersao(base, false)).toBe('em_revisao');
    expect(estadoVersao({ ...base, origem: 'equipa' }, false)).toBe('rascunho');
    expect(estadoVersao({ ...base, revisao: 'rejeitada' }, false)).toBe(
      'rejeitada',
    );
    expect(estadoVersao({ ...base, publicada_em: 'x' }, false)).toBe(
      'publicada',
    );
    expect(estadoVersao({ ...base, publicada_em: 'x' }, true)).toBe('no_ar');
  });
});
