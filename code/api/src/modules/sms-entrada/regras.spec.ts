import {
  intencao,
  MAX_RESPOSTA,
  pareceMorada,
  respostaAgora,
  respostaAjuda,
  respostaAvisar,
  respostaEstado,
  respostaPedirMorada,
  tiposAvisar,
} from './regras';

describe('SMS de entrada', () => {
  it('percebe o que a pessoa quer', () => {
    expect(intencao('PARAR')).toBe('parar');
    expect(intencao(' stop. ')).toBe('parar');
    expect(intencao('CP 12/2026')).toBe('estado');
    expect(intencao('qual o estado do meu processo?')).toBe('estado');
    expect(intencao('412')).toBe('estado');
    expect(intencao('olá, bom dia')).toBe('ajuda');
    expect(intencao('quero parar as obras do vizinho')).toBe('ajuda');
  });

  it('responde ao estado sem revelar nada a quem não é dono', () => {
    expect(respostaEstado({ precisa_identificacao: true }, '253 000 000')).toBe(
      'Por SMS só damos o estado dos processos associados a este número. Ligue para 253 000 000.',
    );
    expect(
      respostaEstado(
        {
          encontrado: false,
          mensagem: 'Não há nenhum processo "CP 9" em nome desta pessoa.',
          processos_da_pessoa: ['CP 12/2026'],
        },
        null,
      ),
    ).toContain('Os seus processos: CP 12/2026.');
    expect(
      respostaEstado(
        {
          encontrado: true,
          processos: [{ resumo: 'A. ' }, { resumo: 'B.' }, { resumo: 'C.' }],
        },
        '253',
      ),
    ).not.toContain('C.');
  });

  it('ajuda curta, com as palavras novas', () => {
    const a = respostaAjuda('Guimarães', null);
    expect(a).toMatch(/envie PARAR\.$/);
    expect(a).toContain('OBRAS, AVISOS, EVENTOS ou INCIDENTES');
    expect(a).toContain('AVISAR OBRAS');
  });

  it('o que se passa: palavras simples, com ou sem barra', () => {
    expect(intencao('OBRAS')).toBe('obras');
    expect(intencao('obras')).toBe('obras');
    expect(intencao('/obras')).toBe('obras');
    expect(intencao(' Obra. ')).toBe('obras');
    expect(intencao('AVISOS')).toBe('avisos');
    expect(intencao('/avisos')).toBe('avisos');
    expect(intencao('EVENTOS')).toBe('eventos');
    expect(intencao('/eventos')).toBe('eventos');
    expect(intencao('INCIDENTES')).toBe('incidentes');
    expect(intencao('/incidentes')).toBe('incidentes');
    expect(intencao('/Incidentes!')).toBe('incidentes');
    // Os de antes continuam.
    expect(intencao('/parar')).toBe('parar');
    expect(intencao('PARAR')).toBe('parar');
    expect(intencao('AJUDA')).toBe('ajuda');
    expect(intencao('/ajuda')).toBe('ajuda');
    expect(intencao('estado CP 12/2026')).toBe('estado');
    // Numa frase não é palavra-chave.
    expect(intencao('há obras na minha rua?')).toBe('ajuda');
  });

  it('AVISAR com os tipos (nenhum = todos)', () => {
    expect(intencao('AVISAR OBRAS')).toBe('avisar');
    expect(intencao('/avisar eventos')).toBe('avisar');
    expect(intencao('avise-me')).toBe('avisar');
    expect(tiposAvisar('AVISAR OBRAS')).toEqual(['obras']);
    expect(tiposAvisar('/avisar eventos e obras')).toEqual([
      'eventos',
      'obras',
    ]);
    expect(tiposAvisar('avisar')).toEqual([
      'obras',
      'avisos',
      'eventos',
      'incidentes',
    ]);
  });

  it('a resposta com a rua parece uma morada', () => {
    expect(pareceMorada('Rua Direita')).toBe(true);
    expect(pareceMorada('Rua 25 de Abril')).toBe(true);
    expect(pareceMorada('Azurém')).toBe(true);
    expect(pareceMorada('CP 12/2026')).toBe(false);
    expect(pareceMorada('ok')).toBe(false);
  });

  it('a resposta do feed cabe em 2 SMS, sem acentos', () => {
    const longo =
      'Andaime na via publica, Rua de Santo Antonio das Necessidades, ate 30/10';
    const r = respostaAgora('Guimarães', 'obras', {
      itens: [{ sms: longo }, { sms: longo }, { sms: longo }, { sms: longo }],
      local: { descricao: 'Rua Direita' },
      link: 'https://toucamara.pt/agora/guimaraes',
    });
    expect(r.length).toBeLessThanOrEqual(MAX_RESPOSTA);
    expect(r).toMatch(
      /^CM Guimaraes - obras e cortes perto de Rua Direita: 1\) Andaime/,
    );
    expect(r).toContain('Tudo: https://toucamara.pt/agora/guimaraes');
    expect(r).not.toContain('4)');
    expect(
      respostaAgora('Guimarães', 'eventos', {
        itens: [],
        link: 'https://x.pt/agora/g',
      }),
    ).toBe(
      'CM Guimaraes: nao ha eventos registados. Tudo: https://x.pt/agora/g',
    );
    expect(respostaPedirMorada('Guimarães')).toContain(
      'responda com o nome da sua rua ou freguesia',
    );
    expect(
      respostaAvisar('Guimarães', {
        subscrito: true,
        tipos: ['obras'],
        zona: 'Rua Direita (300 m à volta)',
      }),
    ).toContain(
      'quando houver obras e cortes novos em Rua Direita (300 m à volta)',
    );
  });
});
