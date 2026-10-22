import PDFDocument from 'pdfkit';

/*
 * Peças comuns dos PDF de DEMONSTRAÇÃO do apoio ao técnico (projetos,
 * termos, certidões): o aviso "documento fictício" no topo de cada página e
 * a legenda (carimbo) das folhas dos desenhos. Data fixa: o mesmo PDF sai
 * sempre igual.
 */

export const AVISO =
  'DEMONSTRAÇÃO · documento fictício gerado pelo Tou, Câmara? · sem valor legal';
export const TINTA = '#1F2A37';
export const CINZA = '#6B7280';
export const MARCA = '#C2410C';
export const AZUL = '#1E3A8A';
export const CRIADO = new Date(Date.UTC(2026, 9, 5, 9, 0, 0));

export type Orientacao = 'portrait' | 'landscape';

export function novoPdf(titulo: string, layout: Orientacao) {
  return new PDFDocument({
    size: 'A4',
    layout,
    margin: 48,
    autoFirstPage: false,
    info: {
      Title: `${titulo} (demonstração)`,
      Author: 'Tou, Câmara? · demonstração',
      CreationDate: CRIADO,
      ModDate: CRIADO,
    },
  });
}

export function terminarPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

/** O que vai na legenda (carimbo) de cada folha. */
export interface Carimbo {
  /** 'Moradia · Rua de Camões, 85 · Creixomil' */
  local: string;
  /** 'Autora: Arq. Joana Lima' */
  autor: string;
}

/** Página com o aviso de demonstração em cima e a legenda da folha em baixo. */
export function paginaPdf(
  doc: PDFKit.PDFDocument,
  layout: Orientacao,
  folha: string | null,
  titulo: string,
  carimbo: Carimbo,
) {
  // Margem de baixo pequena: o carimbo fica no fundo sem abrir outra página.
  doc.addPage({
    size: 'A4',
    layout,
    margins: { top: 48, left: 48, right: 48, bottom: 12 },
  });
  const w = doc.page.width;
  const h = doc.page.height;
  doc
    .save()
    .rect(0, 0, w, 22)
    .fill('#FDE7D9')
    .fillColor(MARCA)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(AVISO, 0, 7, { width: w, align: 'center', lineBreak: false })
    .restore();
  if (folha) {
    // Legenda (carimbo) no canto inferior direito, como nos desenhos.
    const cw = 230;
    const ch = 58;
    const x = w - cw - 30;
    const y = h - ch - 26;
    doc.save().lineWidth(0.8).strokeColor(TINTA).rect(x, y, cw, ch).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(TINTA)
      .text(carimbo.local, x + 8, y + 7, {
        width: cw - 16,
        lineBreak: false,
      })
      .font('Helvetica')
      .fontSize(8)
      .text(titulo, x + 8, y + 21, { width: cw - 70, lineBreak: false })
      .text(carimbo.autor, x + 8, y + 34, {
        width: cw - 70,
        lineBreak: false,
      })
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(`Folha ${folha}`, x + cw - 70, y + 22, {
        width: 62,
        align: 'right',
        lineBreak: false,
      });
    doc.restore();
  }
  doc.x = 48;
  doc.y = 40;
}

export function tituloFolhaPdf(
  doc: PDFKit.PDFDocument,
  t: string,
  sub?: string,
) {
  doc.font('Helvetica-Bold').fontSize(15).fillColor(TINTA).text(t, 48, 40);
  if (sub) {
    doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(sub);
  }
  doc.moveDown(0.8).fillColor(TINTA);
}
