import PDFDocument from 'pdfkit';

export interface DadosPdfOficio {
  municipio: string;
  /** 'Ofício', 'Pedido de elementos'. */
  titulo: string;
  numeroProcesso: string;
  assuntoProcesso: string;
  /** 'AAAA-MM-DD'. */
  data: string;
  corpo: string;
  aprovacao: { por: string; em: Date; simulada: boolean };
}

function dataHora(d: Date): string {
  return d.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * O ofício (ou pedido de elementos) aprovado pelo técnico, em PDF:
 * cabeçalho do município, n.º do processo, data, corpo e a aprovação. A
 * assinatura simulada vai escrita no próprio documento, como no
 * requerimento: o PDF pode circular sem o painel ao lado.
 */
export function gerarPdfOficio(d: DadosPdfOficio): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: {
        Title: `${d.titulo} · processo ${d.numeroProcesso}`,
        Author: d.municipio,
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(13).text(d.municipio);
    doc
      .moveDown(0.2)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555')
      .text(`Processo n.º ${d.numeroProcesso} · ${d.assuntoProcesso}`)
      .text(`Data: ${d.data.split('-').reverse().join('/')}`)
      .fillColor('#000');
    doc.moveDown(1).font('Helvetica-Bold').fontSize(14).text(`${d.titulo}`);
    doc.moveDown(0.8).font('Helvetica').fontSize(10.5);
    for (const paragrafo of d.corpo.split(/\n{2,}/)) {
      doc.text(paragrafo.trim(), { align: 'left', lineGap: 2 });
      doc.moveDown(0.6);
    }

    doc.moveDown(1).fontSize(10);
    doc.text(`Aprovado por ${d.aprovacao.por} a ${dataHora(d.aprovacao.em)}.`);
    if (d.aprovacao.simulada) {
      doc
        .moveDown(0.3)
        .font('Helvetica-Bold')
        .fillColor('#b00')
        .text(
          'ASSINATURA SIMULADA: documento de demonstração, sem valor legal.',
        )
        .fillColor('#000')
        .font('Helvetica');
    }
    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor('#777')
      .text(
        'Rascunho preparado pelo Tou, Câmara? com base no processo e nos regulamentos; revisto e aprovado pelo técnico.',
      );
    doc.end();
  });
}
