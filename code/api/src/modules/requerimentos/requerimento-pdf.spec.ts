import { gerarPdfRequerimento } from './requerimento-pdf.js';

describe('gerarPdfRequerimento', () => {
  it('gera um PDF com acentos e assinatura simulada', async () => {
    const pdf = await gerarPdfRequerimento({
      municipio: 'Município de Teste',
      tipo: { codigo: 'CP', nome: 'Comunicação prévia · obras de alteração' },
      numeroProcesso: 'CP 412/2026',
      criadoEm: new Date('2026-10-21T10:00:00Z'),
      requerente: {
        nome: 'Conceição Araújo',
        nif: '123456789',
        telefone: '+351912345214',
        email: null,
      },
      campos: [
        {
          chave: 'morada_obra',
          rotulo: 'Morada da obra',
          tipo: 'morada',
          obrigatorio: true,
          valor: 'Rua de São Dâmaso, 12',
        },
        {
          chave: 'nif',
          rotulo: 'NIF',
          tipo: 'nif',
          obrigatorio: true,
          valor: 'Registado (não se mostra)',
        },
      ],
      documentos: {
        tem: ['Caderneta predial'],
        faltam: ['Termo de responsabilidade'],
      },
      assinatura: { tipo: 'simulada', em: new Date('2026-10-21T10:05:00Z') },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
