import PDFDocument from 'pdfkit';
import { BASE_LEGAL, ConteudoAta, NOME_RESULTADO } from './tipos.js';
import { dataPorExtenso, fraseVotacao, tituloAta } from './regras.js';

export interface DadosPdfAta {
  municipio: string;
  conteudo: ConteudoAta;
  estado: 'rascunho' | 'aprovada' | 'publicada';
  versao: number;
  /** "aprovada em minuta no final da reunião" / "aprovada na reunião de 2 de abril de 2026". */
  aprovacao: string | null;
  /** O endereço público do PDF (atas publicadas). */
  url: string | null;
}

/**
 * A ata em PDF: cabeçalho, presenças, cada ponto (discussão, intervenções,
 * proposta, votação, deliberação, declarações de voto), o sumário das
 * deliberações e a aprovação. O rascunho leva a marca "RASCUNHO".
 */
export function gerarPdfAta(d: DadosPdfAta): Promise<Buffer> {
  const c = d.conteudo;
  const h = c.cabecalho;
  const titulo = `${tituloAta(h.orgao, h.tipo)} de ${d.municipio}`;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      bufferPages: true,
      info: { Title: `${titulo} n.º ${h.numero}`, Author: d.municipio },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    if (d.estado === 'rascunho') {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#b00')
        .text(`RASCUNHO (versão ${d.versao}): não aprovado.`)
        .fillColor('#000')
        .moveDown(0.5);
    }
    doc.font('Helvetica-Bold').fontSize(15).text(titulo);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#555')
      .text(`N.º ${h.numero}`)
      .fillColor('#000')
      .moveDown(0.8);

    const quando = [
      dataPorExtenso(h.data),
      h.hora_inicio ? `às ${h.hora_inicio}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    doc
      .fontSize(10.5)
      .text(
        `No dia ${quando}, ${h.local ? `em ${h.local}, ` : ''}reuniu ${h.orgao === 'camara' ? 'a Câmara Municipal' : 'a Assembleia Municipal'} de ${d.municipio}${h.presidente ? `, sob a presidência de ${h.presidente}` : ''}.`,
        { align: 'justify' },
      );

    const seccao = (t: string) => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11.5).text(t);
      doc.moveDown(0.3).font('Helvetica').fontSize(10.5);
    };
    const pessoa = (p: ConteudoAta['cabecalho']['presentes'][number]) =>
      [p.nome, p.cargo || null, p.forca_politica].filter(Boolean).join(', ');

    seccao('Presenças');
    for (const p of h.presentes) doc.text(`•  ${pessoa(p)}`);
    if (h.ausentes.length) {
      doc.moveDown(0.3).font('Helvetica-Bold').text('Ausentes');
      doc.font('Helvetica');
      for (const p of h.ausentes) {
        doc.text(
          `•  ${pessoa(p)}${p.falta_justificada ? ' (falta justificada)' : ''}`,
        );
      }
    }

    if (c.antes_da_ordem_do_dia.trim()) {
      seccao('Período antes da ordem do dia');
      doc.text(c.antes_da_ordem_do_dia.trim(), { align: 'justify' });
    }

    seccao('Ordem do dia');
    for (const p of c.pontos) {
      doc
        .moveDown(0.5)
        .font('Helvetica-Bold')
        .text(`Ponto ${p.numero}. ${p.titulo}`);
      doc.font('Helvetica');
      if (p.resumo_discussao.trim()) {
        doc.moveDown(0.2).text(p.resumo_discussao.trim(), { align: 'justify' });
      }
      for (const i of p.intervencoes) {
        if (!i.resumo.trim()) continue;
        doc
          .moveDown(0.2)
          .font('Helvetica-Oblique')
          .text(
            `${i.membro}${i.forca_politica ? ` (${i.forca_politica})` : ''}: `,
            { continued: true },
          )
          .font('Helvetica')
          .text(i.resumo.trim());
      }
      if (p.proposta.trim()) {
        doc.moveDown(0.2).font('Helvetica-Bold').text('Proposta: ', {
          continued: true,
        });
        doc.font('Helvetica').text(p.proposta.trim());
      }
      doc.moveDown(0.2).font('Helvetica-Bold').text('Votação: ', {
        continued: true,
      });
      doc.font('Helvetica').text(fraseVotacao(p.votacao, p.resultado));
      if (p.deliberacao.trim()) {
        doc.moveDown(0.2).font('Helvetica-Bold').text('Deliberação: ', {
          continued: true,
        });
        doc.font('Helvetica').text(p.deliberacao.trim());
      }
      for (const v of p.declaracoes_voto) {
        doc
          .moveDown(0.2)
          .font('Helvetica-Bold')
          .text(
            `Declaração de voto de ${v.membro}${v.forca_politica ? ` (${v.forca_politica})` : ''}: `,
            { continued: true },
          )
          .font('Helvetica')
          .text(v.texto.trim());
      }
    }

    seccao('Sumário das deliberações');
    for (const p of c.pontos) {
      doc.text(
        `•  Ponto ${p.numero}. ${p.titulo}: ${NOME_RESULTADO[p.resultado]}.`,
      );
    }

    seccao('Aprovação da ata');
    doc.text(
      d.aprovacao
        ? `A presente ata foi ${d.aprovacao}.`
        : 'A presente ata ainda não foi aprovada.',
    );
    doc.moveDown(1.5);
    doc.text('O Presidente: ______________________________');
    doc.moveDown(1);
    doc.text('Quem secretariou: ______________________________');

    doc.moveDown(1.2).fontSize(8.5).fillColor('#555');
    doc.text(`Formato segundo a ${BASE_LEGAL.fonte}. ${BASE_LEGAL.nota}`);
    doc.text(
      'ASSINATURAS SIMULADAS: documento de demonstração, sem valor legal.',
    );
    if (d.url) doc.text(`Endereço público desta ata: ${d.url}`);
    doc.fillColor('#000');

    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      const fundo = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fontSize(8)
        .fillColor('#777')
        .text(
          `${titulo} n.º ${h.numero} · página ${i + 1} de ${paginas.count}`,
          56,
          doc.page.height - 36,
          { width: doc.page.width - 112, align: 'center', lineBreak: false },
        );
      doc.page.margins.bottom = fundo;
    }
    doc.end();
  });
}
