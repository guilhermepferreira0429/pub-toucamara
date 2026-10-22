import { analisarPdf } from './analise-pdf';
import { pdfDigitalizado } from './ajudas-leitura.ajuda-spec';
import { gerarProjetoDemonstracao } from './projeto-demonstracao-pdf';

describe('analisarPdf', () => {
  it('projeto com texto: conta as páginas e vê o texto', async () => {
    const a = analisarPdf(await gerarProjetoDemonstracao());
    expect(a).toEqual({
      pdf: true,
      paginas: 3,
      tem_texto: true,
      tem_imagens: false,
      encriptado: false,
    });
  });

  it('digitalizado (só imagens): sem texto', async () => {
    const a = analisarPdf(await pdfDigitalizado(4));
    expect(a).toMatchObject({
      pdf: true,
      paginas: 4,
      tem_texto: false,
      tem_imagens: true,
    });
  });

  it('não é um PDF', () => {
    expect(analisarPdf(Buffer.from('olá'))).toMatchObject({
      pdf: false,
      paginas: null,
    });
  });

  it('protegido: diz que está cifrado', () => {
    const falso = Buffer.from(
      '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 7 /Kids [] >> endobj\ntrailer << /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF',
      'latin1',
    );
    expect(analisarPdf(falso)).toMatchObject({
      encriptado: true,
      paginas: 7,
    });
  });
});
