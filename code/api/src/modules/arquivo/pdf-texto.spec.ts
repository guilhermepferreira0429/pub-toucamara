import PDFDocument from 'pdfkit';
import { deflateSync } from 'zlib';
import {
  lerCMap,
  temCamadaTexto,
  textoDoConteudo,
  textoDoPdf,
} from './pdf-texto';

/** Um PDF a sério (pdfkit: Helvetica, WinAnsi, comprimido), uma página por texto. */
function pdfkit(paginas: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const partes: Buffer[] = [];
    doc.on('data', (d: Buffer) => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    paginas.forEach((p, i) => {
      if (i) doc.addPage();
      doc.font('Helvetica').text(p);
    });
    doc.end();
  });
}

/** PDF montado à mão: objetos, um content stream e (opcional) ToUnicode. */
function pdfManual(conteudo: string, cmap?: string): Buffer {
  const stream = deflateSync(Buffer.from(conteudo, 'latin1'));
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F9 5 0 R >> >> >>',
    `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
    cmap
      ? '<< /Type /Font /Subtype /Type0 /BaseFont /Teste /ToUnicode 6 0 R >>'
      : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  objs.forEach((o, i) => {
    partes.push(Buffer.from(`${i + 1} 0 obj\n${o}`, 'latin1'));
    if (i === 3) partes.push(stream, Buffer.from('\nendstream'));
    partes.push(Buffer.from('\nendobj\n'));
  });
  if (cmap) {
    partes.push(
      Buffer.from(
        `6 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n`,
        'latin1',
      ),
    );
  }
  partes.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n'));
  return Buffer.concat(partes);
}

describe('camada de texto do PDF', () => {
  it('lê um PDF do pdfkit, com acentos e travessão (WinAnsi), página a página', async () => {
    const pdf = await pdfkit([
      'Processo n.º 123/1987 — Requerente: José Conceição, residente na Rua de Santo António, 45',
      'Segunda página: licença de construção.',
    ]);
    const r = textoDoPdf(pdf);
    expect(r.paginas).toBe(2);
    expect(r.texto).toContain(
      'Processo n.º 123/1987 — Requerente: José Conceição',
    );
    expect(r.texto.replace(/\s+/g, ' ')).toContain('Rua de Santo António, 45');
    expect(r.texto).toContain('\n\nSegunda página: licença de construção.');
    expect(temCamadaTexto(r.texto)).toBe(true);
  });

  it("operadores Tj, TJ (com espaços pelo kerning), ' e T*, e escapes", () => {
    const t = textoDoConteudo(
      "BT /F1 12 Tf 72 700 Td (Linha \\(um\\)) Tj 0 -14 Td [(Pala) 30 (vra) -400 (solta)] TJ T* (tr\\352s) Tj (quatro) ' ET",
    );
    expect(t.split('\n')).toEqual([
      'Linha (um)',
      'Palavra solta',
      'três',
      'quatro',
    ]);
  });

  it('fontes com ToUnicode (códigos de 2 bytes, bfchar e bfrange)', () => {
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      'begincmap',
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      '1 beginbfchar <0001> <00C7> endbfchar',
      '1 beginbfrange <0010> <0019> <0061> endbfrange',
      'endcmap',
    ].join('\n');
    expect(lerCMap(cmap).bytes).toBe(2);
    // 0x0001 = Ç; 0x10.. = a, b, c...: "Ç" "c" "a" "b"
    const pdf = pdfManual(
      'BT /F9 10 Tf 50 700 Td <0001001200100011> Tj ET',
      cmap,
    );
    expect(textoDoPdf(pdf).texto).toBe('Çcab');
  });

  it('PDF só com imagem (digitalização crua): sem camada de texto', () => {
    const pdf = pdfManual('q 595 0 0 842 0 0 cm /Im1 Do Q');
    const r = textoDoPdf(pdf);
    expect(r.texto).toBe('');
    expect(r.paginas).toBe(1);
    expect(temCamadaTexto(r.texto)).toBe(false);
    expect(temCamadaTexto('Pág. 1')).toBe(false);
  });

  it('lixo não rebenta', () => {
    expect(textoDoPdf(Buffer.from('não é um pdf'))).toEqual({
      texto: '',
      paginas: 0,
    });
  });
});
