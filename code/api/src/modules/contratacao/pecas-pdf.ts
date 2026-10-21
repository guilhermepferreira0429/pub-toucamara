import PDFDocument from 'pdfkit';
import { AVISO_RASCUNHO } from './config.js';
import type { Secao } from './pecas.js';

export interface DadosPdfPeca {
  municipio: string;
  numero: string;
  titulo: string;
  objeto: string;
  procedimento: string;
  estado: string;
  secoes: Secao[];
  campos_a_preencher: string[];
  modo: 'ia' | 'modelo';
  demonstracao: boolean;
  fonte: string;
  gerado_em: Date;
}

/**
 * Uma peça em PDF. É sempre um rascunho para revisão jurídica: o aviso vai
 * no topo e no fim, com os campos por preencher e a fonte dos limiares.
 */
export function gerarPdfPeca(d: DadosPdfPeca): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `${d.titulo} — ${d.numero}`, Author: d.municipio },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const vermelho = () =>
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#b00');
    const normal = () => doc.font('Helvetica').fontSize(10.5).fillColor('#000');

    doc.font('Helvetica-Bold').fontSize(13).text(d.municipio);
    doc
      .moveDown(0.2)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555')
      .text(
        `Procedimento ${d.numero} · ${d.procedimento} · estado: ${d.estado}`,
      )
      .fillColor('#000');
    doc.moveDown(0.6);
    vermelho().text(`RASCUNHO PARA REVISÃO JURÍDICA. ${AVISO_RASCUNHO}`);

    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(18).text(d.titulo);
    doc.moveDown(0.3).font('Helvetica').fontSize(11).text(d.objeto);
    doc.moveDown(0.8);

    for (const s of d.secoes) {
      doc.font('Helvetica-Bold').fontSize(11).text(s.titulo);
      doc.moveDown(0.2);
      normal().text(s.texto || '—', { lineGap: 2 });
      doc.moveDown(0.6);
    }

    if (d.campos_a_preencher.length) {
      doc
        .moveDown(0.4)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Campos por preencher');
      doc.moveDown(0.2).font('Helvetica').fontSize(9.5);
      for (const c of d.campos_a_preencher) doc.text(`•  ${c}`);
    }

    doc
      .moveDown(1)
      .fontSize(8.5)
      .fillColor('#555')
      .text(
        `${d.modo === 'ia' ? 'Rascunho escrito com IA a partir do objeto' : 'Modelo fixo, sem IA'}; gerado a ${d.gerado_em.toLocaleString(
          'pt-PT',
          { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' },
        )}.`,
      )
      .moveDown(0.2)
      .text(`Limiares: ${d.fonte}`);
    doc.moveDown(0.6);
    vermelho().text(
      'RASCUNHO PARA REVISÃO JURÍDICA: sem valor de peça definitiva.',
    );
    if (d.demonstracao) {
      doc.text(
        'Limiares e prazos com valores de demonstração, a confirmar pelo jurista contra o Código dos Contratos Públicos em vigor.',
      );
    }
    doc.end();
  });
}
