import PDFDocument from 'pdfkit';
import {
  type Conclusao,
  type ItemChecklist,
  NOMES_CONCLUSAO,
  NOMES_RESPOSTA,
  type RelatorioEstruturado,
} from './regras.js';

export interface DadosPdfVistoria {
  municipio: string;
  numero: string;
  tipo: string;
  morada: string;
  /** 'quarta-feira, 21 de outubro de 2026'. */
  dia: string;
  fiscal: string | null;
  motivo: string;
  origem: string | null;
  checklist: ItemChecklist[];
  estruturado: RelatorioEstruturado | null;
  conclusao: Conclusao | null;
  prazo: string | null;
  transcricao: string | null;
  fotos: number;
  fechado: boolean;
  valoresDemonstracao: boolean;
}

/**
 * O relatório de vistoria em PDF: o que se verificou, as desconformidades
 * com o artigo (quando o fiscal o disse), as medidas, o prazo e, em anexo,
 * o texto tal como foi ditado.
 */
export function gerarPdfVistoria(d: DadosPdfVistoria): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `Relatório de vistoria ${d.numero}`, Author: d.municipio },
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
      .text(`Fiscalização · ${d.numero}`)
      .fillColor('#000');

    doc
      .moveDown(1)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('Relatório de vistoria');
    doc.moveDown(0.8).fontSize(10.5);
    const linha = (rotulo: string, valor: string) => {
      doc.font('Helvetica-Bold').text(`${rotulo}: `, { continued: true });
      doc.font('Helvetica').text(valor);
      doc.moveDown(0.3);
    };
    linha('Tipo', d.tipo);
    linha('Local', d.morada);
    linha('Dia', d.dia);
    linha('Fiscal', d.fiscal ?? '—');
    linha('Motivo', d.motivo);
    if (d.origem) linha('Origem', d.origem);

    const titulo = (t: string) => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11.5).text(t);
      doc.moveDown(0.3).font('Helvetica').fontSize(10.5);
    };
    const lista = (itens: string[], vazio: string) => {
      if (!itens.length) {
        doc.fillColor('#555').text(vazio).fillColor('#000');
        return;
      }
      for (const i of itens) {
        doc.text(`•  ${i}`, { lineGap: 2 });
        doc.moveDown(0.15);
      }
    };

    titulo('O que se verificou');
    if (!d.checklist.length) {
      doc.fillColor('#555').text('Sem checklist.').fillColor('#000');
    }
    for (const i of d.checklist) {
      const resposta = i.resposta
        ? NOMES_RESPOSTA[i.resposta]
        : 'por responder';
      doc.font('Helvetica').text(`${i.rotulo} `, { continued: true });
      doc.font('Helvetica-Bold').text(resposta);
      if (i.nota) {
        doc
          .font('Helvetica')
          .fillColor('#555')
          .text(`   ${i.nota}`)
          .fillColor('#000');
      }
      doc.moveDown(0.2);
    }

    const e = d.estruturado;
    if (e) {
      titulo('Constatações');
      lista(e.constatacoes, 'Nada a registar.');
      titulo('Desconformidades');
      lista(
        e.infracoes.map((i) =>
          i.artigo ? `${i.descricao} (${i.artigo})` : i.descricao,
        ),
        'Nenhuma.',
      );
      titulo('Medidas');
      lista(e.medidas, 'Nenhuma.');
      if (e.fotos_referidas.length) {
        titulo('Fotografias referidas');
        lista(e.fotos_referidas, '');
      }
    }
    if (d.fotos) {
      doc
        .moveDown(0.4)
        .fillColor('#555')
        .text(`Fotografias anexadas ao processo: ${d.fotos}.`)
        .fillColor('#000');
    }

    titulo('Conclusão');
    doc
      .font('Helvetica-Bold')
      .text(d.conclusao ? NOMES_CONCLUSAO[d.conclusao] : 'Por concluir');
    if (d.prazo) {
      doc.font('Helvetica').text(`Prazo para corrigir: até ${d.prazo}.`);
    }

    if (d.transcricao) {
      titulo(
        e?.livre === false
          ? 'Anexo: texto ditado'
          : 'Relatório livre (texto ditado)',
      );
      doc.fontSize(9.5).text(d.transcricao, { lineGap: 1.5 });
      doc.fontSize(10.5);
    }

    const avisos = [
      d.fechado
        ? null
        : 'RASCUNHO: o relatório ainda não foi fechado pelo fiscal.',
      e && !e.livre
        ? 'Estrutura proposta pela IA a partir do ditado e revista pelo fiscal.'
        : null,
      d.valoresDemonstracao
        ? 'Checklist, durações e prazos com valores de demonstração, por confirmar com o serviço de fiscalização.'
        : null,
      'Documento de demonstração, sem assinatura e sem valor legal.',
    ].filter(Boolean) as string[];
    doc.moveDown(1.2).font('Helvetica-Bold').fontSize(9).fillColor('#b00');
    for (const a of avisos) doc.text(a);
    doc.fillColor('#000').font('Helvetica');
    doc.end();
  });
}
