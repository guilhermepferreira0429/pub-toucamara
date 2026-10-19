import PDFDocument from 'pdfkit';
import type { CampoComValor } from '../processos/formulario.js';

export interface DadosPdfRequerimento {
  municipio: string;
  tipo: { codigo: string; nome: string };
  numeroProcesso: string | null;
  criadoEm: Date;
  requerente: {
    nome: string | null;
    nif: string | null;
    telefone: string | null;
    email: string | null;
  };
  campos: CampoComValor[];
  documentos: { tem: string[]; faltam: string[] };
  assinatura: { tipo: string | null; em: Date | null };
}

function dataHora(d: Date): string {
  return d.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * O requerimento em PDF (sai sempre em português, seja qual for a língua da
 * chamada). A assinatura simulada vai escrita no próprio documento: o PDF
 * pode circular sem o painel ao lado.
 */
export function gerarPdfRequerimento(d: DadosPdfRequerimento): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: {
        Title: `Requerimento · ${d.tipo.nome}`,
        Author: d.municipio,
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const titulo = (t: string) => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).text(t);
      doc.moveDown(0.3).font('Helvetica').fontSize(10);
    };
    const linha = (rotulo: string, valor: string | null) => {
      doc
        .font('Helvetica-Bold')
        .text(`${rotulo}: `, { continued: true })
        .font('Helvetica')
        .text(valor ?? '—');
    };

    doc.font('Helvetica').fontSize(10).fillColor('#555').text(d.municipio);
    doc
      .moveDown(0.4)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(`Requerimento · ${d.tipo.nome}`);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        `Tipo ${d.tipo.codigo} · criado a ${dataHora(d.criadoEm)}` +
          (d.numeroProcesso ? ` · processo ${d.numeroProcesso}` : ''),
      );

    titulo('Requerente');
    linha('Nome', d.requerente.nome);
    linha('NIF', d.requerente.nif);
    linha('Telefone', d.requerente.telefone);
    linha('Email', d.requerente.email);

    titulo('Dados do pedido');
    for (const c of d.campos) {
      if (c.tipo === 'nif') continue; // já está em Requerente
      linha(c.rotulo, c.valor);
    }

    titulo('Documentos');
    linha(
      'Entregues',
      d.documentos.tem.length ? d.documentos.tem.join('; ') : 'nenhum',
    );
    linha(
      'Em falta',
      d.documentos.faltam.length ? d.documentos.faltam.join('; ') : 'nenhum',
    );

    titulo('Assinatura');
    if (!d.assinatura.em) {
      doc.text('Por assinar.');
    } else if (d.assinatura.tipo === 'simulada') {
      doc.text(`Assinado a ${dataHora(d.assinatura.em)}.`);
      doc
        .moveDown(0.3)
        .font('Helvetica-Bold')
        .fillColor('#b00')
        .text(
          'ASSINATURA SIMULADA: documento de demonstração, sem valor legal.',
        )
        .fillColor('#000')
        .font('Helvetica');
    } else {
      doc.text(
        `Assinado a ${dataHora(d.assinatura.em)} (${d.assinatura.tipo}).`,
      );
    }

    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor('#777')
      .text(
        'Preenchido durante o atendimento com o agente Tou, Câmara? e confirmado pelo requerente.',
      );
    doc.end();
  });
}
