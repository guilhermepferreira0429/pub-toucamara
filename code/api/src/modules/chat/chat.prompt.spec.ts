import { contextoSessao } from './chat.prompt.js';

describe('contextoSessao (chat)', () => {
  it('sem anterior, só a data', () => {
    expect(contextoSessao('segunda-feira')).toBe(
      '<contexto>Conversa iniciada em segunda-feira, hora local do município. Usa esta data para "hoje" e para prazos.</contexto>',
    );
  });

  it('com anterior, o resumo e os próximos passos', () => {
    const c = contextoSessao('segunda-feira', {
      quando: 'ontem à tarde',
      resumo: 'Pediu licença.',
      proximos_passos: ['Assinar o requerimento', 'Enviar a planta'],
    });
    expect(c).toContain('já falou com a câmara ontem à tarde');
    expect(c).toContain('Resumo dessa conversa: Pediu licença.');
    expect(c).toContain(
      'Próximos passos combinados: Assinar o requerimento; Enviar a planta.',
    );
  });
});
