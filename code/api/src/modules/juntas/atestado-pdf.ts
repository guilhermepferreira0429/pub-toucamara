import PDFDocument from 'pdfkit';
import { gerarQr } from '../../common/qr.js';

export interface DadosPdfAtestado {
  junta: string;
  concelho: string | null;
  numero: string;
  titulo: string;
  paragrafos: string[];
  emitido: { por: string; em: Date };
  urlVerificacao: string;
  codigo: string;
}

function dataHora(d: Date): string {
  return d.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * O atestado em PDF (modelo de demonstração), com o QR da página de
 * verificação. Diz no próprio documento que é de demonstração.
 */
export function gerarPdfAtestado(d: DadosPdfAtestado): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `${d.titulo} ${d.numero}`, Author: d.junta },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(13).text(d.junta, { width: 360 });
    if (d.concelho) {
      doc
        .moveDown(0.2)
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#555')
        .text(`Concelho de ${d.concelho}`);
    }
    doc
      .moveDown(0.2)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555')
      .text(`N.º ${d.numero}`)
      .fillColor('#000');

    const qr = gerarQr(d.urlVerificacao);
    const lado = 100;
    const modulo = lado / (qr.length + 8);
    const x0 = doc.page.width - 56 - lado;
    const y0 = 56;
    doc.rect(x0, y0, lado, lado).fill('#fff');
    qr.forEach((linha, y) =>
      linha.forEach((escuro, x) => {
        if (escuro) {
          doc
            .rect(x0 + (x + 4) * modulo, y0 + (y + 4) * modulo, modulo, modulo)
            .fill('#1b2a3a');
        }
      }),
    );
    doc
      .fillColor('#555')
      .fontSize(7)
      .text(`Verificar: ${d.codigo}`, x0, y0 + lado + 2, {
        width: lado,
        align: 'center',
      })
      .fillColor('#000');

    doc.x = 56;
    doc.y = 180;
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(d.titulo.toUpperCase(), { align: 'center' });
    doc.moveDown(1.5).font('Helvetica').fontSize(11);
    for (const p of d.paragrafos) {
      doc.text(p, { align: 'justify', lineGap: 3 });
      doc.moveDown(0.8);
    }

    doc.moveDown(2).fontSize(10).text('O(A) Presidente da Junta', {
      align: 'center',
    });
    doc.moveDown(2).text('______________________________', { align: 'center' });

    doc
      .moveDown(2)
      .fontSize(8.5)
      .fillColor('#555')
      .text(`Emitido por ${d.emitido.por} a ${dataHora(d.emitido.em)}.`)
      .fillColor('#000');
    doc
      .moveDown(0.8)
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#b00')
      .text(
        'MODELO DE DEMONSTRAÇÃO: assinatura simulada, sem valor legal. O texto e os requisitos estão por confirmar com a junta.',
      )
      .fillColor('#000')
      .font('Helvetica');
    doc.end();
  });
}
