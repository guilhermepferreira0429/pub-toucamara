import { intencao, respostaAjuda, respostaEstado } from './regras';

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

  it('ajuda curta', () => {
    expect(respostaAjuda('Guimarães', null)).toMatch(/envie PARAR\.$/);
  });
});
