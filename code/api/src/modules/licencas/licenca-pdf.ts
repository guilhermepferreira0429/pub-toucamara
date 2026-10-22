import PDFDocument from 'pdfkit';
import { gerarQr } from '../../common/qr.js';

export interface DadosPdfLicenca {
  municipio: string;
  numero: string;
  titulo: string;
  titular: string | null;
  atividade: string;
  morada: string;
  /** "Dia", "Período" ou "Validade". */
  rotuloDia?: string;
  /** 'sábado, 31 de outubro de 2026'. */
  dia: string;
  horario?: string | null;
  /** Outras linhas do tipo (área, matrícula, mesas...). */
  detalhes?: { rotulo: string; valor: string }[];
  condicoes: string[];
  fonte: string;
  emitida: { por: string; em: Date };
  urlVerificacao: string;
  codigo: string;
  modoTeste: boolean;
  regrasDemonstracao: boolean;
}

function dataHora(d: Date): string {
  return d.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * A licença em PDF, com o QR que abre a página de verificação. O que é de
 * demonstração (pagamento de teste, assinatura simulada, regras por
 * confirmar) vai escrito no próprio documento.
 */
export function gerarPdfLicenca(d: DadosPdfLicenca): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `${d.titulo} ${d.numero}`, Author: d.municipio },
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
      .text(`Licença n.º ${d.numero}`)
      .fillColor('#000');

    // QR no canto: a página pública diz se a licença é válida.
    const qr = gerarQr(d.urlVerificacao);
    const lado = 110;
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
    doc.y = 140;
    doc.font('Helvetica-Bold').fontSize(18).text(d.titulo, { width: 360 });
    doc.moveDown(1).fontSize(10.5);
    const linha = (rotulo: string, valor: string) => {
      doc.font('Helvetica-Bold').text(`${rotulo}: `, { continued: true });
      doc.font('Helvetica').text(valor);
      doc.moveDown(0.3);
    };
    if (d.titular) linha('Titular', d.titular);
    linha('Atividade', d.atividade);
    linha('Local', d.morada);
    linha(d.rotuloDia ?? 'Dia', d.dia);
    if (d.horario) linha('Horário', d.horario);
    for (const x of d.detalhes ?? []) linha(x.rotulo, x.valor);

    doc.moveDown(0.8).font('Helvetica-Bold').text('Condições');
    doc.moveDown(0.3).font('Helvetica');
    for (const c of d.condicoes) {
      doc.text(`•  ${c}`, { lineGap: 2 });
      doc.moveDown(0.2);
    }

    doc.moveDown(1).fontSize(9).fillColor('#555').text(`Base: ${d.fonte}.`);
    doc
      .moveDown(0.3)
      .text(
        `Verificada pelas regras em código durante o pedido e aprovada por ${d.emitida.por} a ${dataHora(d.emitida.em)}.`,
      )
      .fillColor('#000');

    const avisos = [
      d.modoTeste ? 'PAGAMENTO EM MODO DE TESTE: nada foi cobrado.' : null,
      'ASSINATURA SIMULADA: documento de demonstração, sem valor legal.',
      d.regrasDemonstracao
        ? 'Regras com valores de demonstração, por confirmar com o regulamento municipal.'
        : null,
    ].filter(Boolean) as string[];
    doc.moveDown(1).font('Helvetica-Bold').fontSize(9).fillColor('#b00');
    for (const a of avisos) doc.text(a);
    doc.fillColor('#000').font('Helvetica');
    doc.end();
  });
}
