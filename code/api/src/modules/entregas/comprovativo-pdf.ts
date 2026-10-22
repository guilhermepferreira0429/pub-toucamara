import PDFDocument from 'pdfkit';
import type { Comprovativo } from './submissao-balcao.js';
import type { ResumoPedido } from './regras.js';

export interface DadosComprovativo {
  municipio: string;
  comprovativo: Comprovativo;
  resumo: ResumoPedido;
  autorizacao: {
    em: Date;
    fornecedor: string;
    nivel_garantia: string;
    consentimento_em: Date | null;
  };
  confirmacao: { em: Date; canal: string };
  processoNumero: string | null;
}

export const MARCA_SIMULACAO = 'SIMULAÇÃO — SEM VALIDADE LEGAL';

function dataHora(d: Date | string): string {
  return new Date(d).toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

const FORNECEDOR: Record<string, string> = {
  simulacao: 'Chave Móvel Digital (simulada)',
  'autenticacao.gov': 'autenticacao.gov (Chave Móvel Digital)',
};

/**
 * O comprovativo da entrega em PDF. Na simulação leva a marca de água
 * diagonal em todas as páginas e o aviso no topo: o PDF circula sem o
 * painel ao lado e não pode passar por um documento com validade legal.
 */
export function gerarPdfComprovativo(d: DadosComprovativo): Promise<Buffer> {
  const simulado = d.comprovativo.simulado;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: {
        Title: `${simulado ? '[SIMULAÇÃO] ' : ''}Comprovativo de entrega ${d.comprovativo.numero_entrada}`,
        Author: d.municipio,
        Subject: simulado ? MARCA_SIMULACAO : 'Comprovativo de entrega',
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const marcaDeAgua = () => {
      if (!simulado) return;
      const { width, height } = doc.page;
      // Escrever a marca mexe no cursor: o conteúdo continua onde estava.
      const { x, y } = doc;
      doc.save();
      doc.rotate(-35, { origin: [width / 2, height / 2] });
      doc
        .font('Helvetica-Bold')
        .fontSize(30)
        .fillColor('#c0392b')
        .fillOpacity(0.14)
        .text(MARCA_SIMULACAO, -width * 0.25, height / 2 - 18, {
          width: width * 1.5,
          align: 'center',
          lineBreak: false,
        });
      doc.restore();
      doc.fillOpacity(1).fillColor('#000');
      doc.x = x;
      doc.y = y;
    };
    marcaDeAgua();
    doc.on('pageAdded', marcaDeAgua);

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

    if (simulado) {
      const y = doc.y;
      doc.rect(56, y, doc.page.width - 112, 44).fill('#fdecea');
      doc
        .fillColor('#b00')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(MARCA_SIMULACAO, 66, y + 8, { width: doc.page.width - 132 });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .text(
          'Demonstração: a autenticação e a submissão foram simuladas. Não houve entrega real na câmara.',
          66,
          y + 26,
          { width: doc.page.width - 132 },
        );
      doc.fillColor('#000').moveDown(1.2);
      doc.x = 56;
    }

    doc.font('Helvetica').fontSize(10).fillColor('#555').text(d.municipio);
    doc
      .moveDown(0.4)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('Comprovativo de entrega');
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        `Entregue em nome do requerente no ${d.comprovativo.destino.toLowerCase()}.`,
      );

    titulo('Entrada');
    linha('Número de entrada', d.comprovativo.numero_entrada);
    linha('Data e hora', dataHora(d.comprovativo.recebido_em));
    linha('Pedido', `${d.resumo.tipo.nome} (${d.resumo.tipo.codigo})`);
    if (d.processoNumero) linha('Processo na câmara', d.processoNumero);

    titulo('Requerente');
    linha('Nome', d.comprovativo.requerente.nome);
    linha('NIF', d.comprovativo.requerente.nif_mascarado);

    titulo('Autorização');
    linha(
      'Confirmou o resumo ao agente',
      `${dataHora(d.confirmacao.em)} (${d.confirmacao.canal})`,
    );
    if (d.autorizacao.consentimento_em)
      linha('Consentiu a entrega', dataHora(d.autorizacao.consentimento_em));
    linha(
      'Autenticou-se',
      `${dataHora(d.autorizacao.em)} · ${FORNECEDOR[d.autorizacao.fornecedor] ?? d.autorizacao.fornecedor}`,
    );
    linha(
      'Nível de garantia',
      d.autorizacao.nivel_garantia === 'simulado'
        ? 'simulado (sem validade legal)'
        : d.autorizacao.nivel_garantia,
    );

    titulo('Dados do pedido');
    for (const c of d.resumo.campos) linha(c.rotulo, c.valor);

    titulo('Documentos entregues');
    for (const n of d.comprovativo.documentos) doc.text(`• ${n}`);
    if (d.resumo.documentos.em_falta.length) {
      doc.moveDown(0.3);
      linha('Ainda em falta', d.resumo.documentos.em_falta.join('; '));
    }

    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor('#777')
      .text(
        simulado
          ? 'Gerado pelo agente Tou, Câmara? em modo de demonstração. Entregar documentos com validade legal em nome do munícipe só depois da autenticação real com a Chave Móvel Digital (credenciação na AMA).'
          : 'Gerado pelo agente Tou, Câmara? depois da autenticação do requerente.',
      );
    doc.end();
  });
}
