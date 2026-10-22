import PDFDocument from 'pdfkit';

/*
 * Documentos de DEMONSTRAÇÃO do processo "Porta na cozinha" (V2 · Apoio ao
 * técnico): um projeto de arquitetura simples, o termo de responsabilidade e
 * a certidão do registo predial. Tudo fictício e marcado como tal em cada
 * página. O projeto tem a parede a abrir marcada, alçados sem alterações e a
 * memória a dizer "não estrutural", sem planta de estruturas: é o que a
 * leitura da IA deve encontrar (o ⚠ do design).
 *
 * São gerados de novo sempre que se pedem (a chave do ficheiro começa por
 * `demonstracao/`), por isso não precisam de armazenamento.
 */

export const PREFIXO_DEMONSTRACAO = 'demonstracao/';

export const FICHEIROS_DEMONSTRACAO = {
  projeto: `${PREFIXO_DEMONSTRACAO}cp-porta-cozinha/projeto.pdf`,
  termo: `${PREFIXO_DEMONSTRACAO}cp-porta-cozinha/termo.pdf`,
  certidao: `${PREFIXO_DEMONSTRACAO}cp-porta-cozinha/certidao.pdf`,
} as const;

export const TECNICO_DEMONSTRACAO = {
  nome: 'Joana Lima',
  ordem: 'Ordem dos Arquitectos',
  numero: '12345',
};

const AVISO =
  'DEMONSTRAÇÃO · documento fictício gerado pelo Tou, Câmara? · sem valor legal';
const TINTA = '#1F2A37';
const CINZA = '#6B7280';
const MARCA = '#C2410C';
// Data fixa: o mesmo PDF sai sempre igual.
const CRIADO = new Date(Date.UTC(2026, 9, 5, 9, 0, 0));

function novo(titulo: string, layout: 'portrait' | 'landscape') {
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

function terminar(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Página com o aviso de demonstração em cima e a legenda da folha em baixo. */
function pagina(
  doc: PDFKit.PDFDocument,
  layout: 'portrait' | 'landscape',
  folha: string | null,
  titulo: string,
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
      .text('Moradia · Rua de Camões, 85 · Creixomil', x + 8, y + 7, {
        width: cw - 16,
        lineBreak: false,
      })
      .font('Helvetica')
      .fontSize(8)
      .text(titulo, x + 8, y + 21, { width: cw - 70, lineBreak: false })
      .text(`Autora: Arq. ${TECNICO_DEMONSTRACAO.nome}`, x + 8, y + 34, {
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

function tituloFolha(doc: PDFKit.PDFDocument, t: string, sub?: string) {
  doc.font('Helvetica-Bold').fontSize(15).fillColor(TINTA).text(t, 48, 40);
  if (sub) {
    doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(sub);
  }
  doc.moveDown(0.8).fillColor(TINTA);
}

/** Planta simples da cozinha e da sala; `proposta` marca o vão a abrir. */
function planta(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  proposta: boolean,
) {
  const w = 300;
  const h = 200;
  doc.save().lineWidth(5).strokeColor(TINTA);
  doc.rect(x, y, w, h).stroke();
  // Parede interior entre a cozinha (esquerda) e a sala (direita).
  const px = x + 130;
  if (proposta) {
    doc
      .moveTo(px, y)
      .lineTo(px, y + 70)
      .stroke();
    doc
      .moveTo(px, y + 125)
      .lineTo(px, y + h)
      .stroke();
    // O troço a demolir, a tracejado e a vermelho.
    doc
      .lineWidth(5)
      .strokeColor(MARCA)
      .dash(5, { space: 4 })
      .moveTo(px, y + 70)
      .lineTo(px, y + 125)
      .stroke()
      .undash();
    doc
      .lineWidth(1)
      .strokeColor(MARCA)
      .moveTo(px + 4, y + 97)
      .lineTo(px + 60, y + 60)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(MARCA)
      .text('Vão a abrir 0,90 × 2,10 m', px + 62, y + 48, { width: 100 })
      .font('Helvetica')
      .text('(parede a demolir, não estrutural)', px + 62, y + 70, {
        width: 100,
      });
  } else {
    doc
      .moveTo(px, y)
      .lineTo(px, y + h)
      .stroke();
  }
  doc.restore();
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(TINTA)
    .text('Cozinha', x + 30, y + 150, { lineBreak: false })
    .text('12,4 m²', x + 30, y + 164, { lineBreak: false })
    .text('Sala', x + 200, y + 150, { lineBreak: false })
    .text('21,8 m²', x + 200, y + 164, { lineBreak: false });
}

/** Alçado simples de uma moradia (porta, janelas, telhado de duas águas). */
function alcado(doc: PDFKit.PDFDocument, x: number, y: number, nome: string) {
  const w = 300;
  const h = 150;
  doc.save().lineWidth(1.5).strokeColor(TINTA);
  doc.rect(x, y, w, h).stroke();
  doc
    .moveTo(x - 10, y)
    .lineTo(x + w / 2, y - 70)
    .lineTo(x + w + 10, y)
    .stroke();
  doc.rect(x + 40, y + 40, 50, 45).stroke();
  doc.rect(x + 210, y + 40, 50, 45).stroke();
  doc.rect(x + 130, y + 60, 40, 90).stroke();
  doc.restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text(`${nome} · existente = proposto`, x, y + h + 8, {
      width: w,
      align: 'center',
    });
}

export function gerarProjetoDemonstracao(): Promise<Buffer> {
  const doc = novo('Projeto de arquitetura · Porta na cozinha', 'landscape');

  // Folha 1 · Memória descritiva e justificativa.
  pagina(doc, 'portrait', '1', 'Memória descritiva e justificativa');
  tituloFolha(
    doc,
    'Memória descritiva e justificativa',
    'Obras de alteração no interior de moradia unifamiliar · comunicação prévia',
  );
  const p = (t: string) =>
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(TINTA)
      .text(t, {
        width: 480,
        align: 'justify',
      })
      .moveDown(0.6);
  const s = (t: string) =>
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(TINTA)
      .text(t)
      .moveDown(0.3);
  s('1. Objeto');
  p(
    'A presente memória refere-se à abertura de um vão de porta (0,90 × 2,10 m) na parede interior que separa a cozinha da sala, no rés-do-chão da moradia unifamiliar situada na Rua de Camões, 85, freguesia de Creixomil, e à remodelação da cozinha (bancadas e revestimentos).',
  );
  s('2. Descrição da intervenção');
  p(
    'A parede a abrir é uma parede interior não estrutural, em alvenaria de tijolo de 11 cm, rebocada nas duas faces. Será demolido o troço assinalado na Folha 2 e colocada uma padieira pré-fabricada sobre o vão.',
  );
  p(
    'Não há alterações na fachada nem na cobertura: os alçados mantêm-se como existem (Folha 3). Não são alterados vãos exteriores, cores ou materiais.',
  );
  s('3. Áreas');
  p(
    'Área de implantação: 96 m² (sem alteração). Área de construção: 142 m² (sem alteração). Cércea: 6,4 m (sem alteração). Cozinha: 12,4 m². Sala: 21,8 m².',
  );
  s('4. Peças do projeto');
  p(
    'Folha 1 · Memória descritiva e justificativa. Folha 2 · Planta do rés-do-chão, existente e proposta. Folha 3 · Alçados principal e posterior. O termo de responsabilidade da autora segue em documento próprio.',
  );
  doc
    .moveDown(1)
    .font('Helvetica')
    .fontSize(10)
    .fillColor(TINTA)
    .text('Guimarães, 5 de outubro de 2026')
    .text(
      `A autora do projeto: ${TECNICO_DEMONSTRACAO.nome}, arquiteta (${TECNICO_DEMONSTRACAO.ordem}, n.º ${TECNICO_DEMONSTRACAO.numero})`,
    );

  // Folha 2 · Plantas.
  pagina(doc, 'landscape', '2', 'Planta do rés-do-chão');
  tituloFolha(
    doc,
    'Planta do rés-do-chão · existente e proposta',
    'Escala 1:50 (esquemática)',
  );
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Existente', 70, 100, { lineBreak: false });
  doc.text('Proposta', 440, 100, { lineBreak: false });
  planta(doc, 70, 125, false);
  planta(doc, 440, 125, true);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text(
      'Legenda: a preto, paredes a manter; a vermelho tracejado, parede a demolir.',
      70,
      360,
    );

  // Folha 3 · Alçados.
  pagina(doc, 'landscape', '3', 'Alçados principal e posterior');
  tituloFolha(doc, 'Alçados principal e posterior', 'Sem alterações');
  alcado(doc, 70, 190, 'Alçado principal');
  alcado(doc, 440, 190, 'Alçado posterior');
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(TINTA)
    .text('Os alçados não são alterados pela intervenção.', 70, 400);

  return terminar(doc);
}

export function gerarTermoDemonstracao(): Promise<Buffer> {
  const doc = novo('Termo de responsabilidade do autor do projeto', 'portrait');
  pagina(doc, 'portrait', null, '');
  doc.moveDown(2);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(TINTA)
    .text('Termo de responsabilidade do autor do projeto de arquitetura', {
      align: 'center',
    })
    .moveDown(1.5);
  doc
    .font('Helvetica')
    .fontSize(11)
    .text(
      `${TECNICO_DEMONSTRACAO.nome}, arquiteta, inscrita na ${TECNICO_DEMONSTRACAO.ordem} com o n.º ${TECNICO_DEMONSTRACAO.numero}, declara, para efeitos do disposto no Regime Jurídico da Urbanização e Edificação, que o projeto de arquitetura de que é autora, relativo à obra de alteração no interior da moradia situada na Rua de Camões, 85, Creixomil, Guimarães, cujo requerente é Sandra Martins, observa as normas legais e regulamentares aplicáveis.`,
      { align: 'justify' },
    )
    .moveDown(2)
    .text('Guimarães, 5 de outubro de 2026')
    .moveDown(3);
  doc
    .font('Helvetica-Oblique')
    .fontSize(18)
    .fillColor('#1E3A8A')
    .text('Joana Lima', { align: 'center' });
  doc
    .moveDown(0.2)
    .font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text('(assinatura · demonstração)', { align: 'center' });
  return terminar(doc);
}

export function gerarCertidaoDemonstracao(): Promise<Buffer> {
  const doc = novo('Certidão do registo predial', 'portrait');
  pagina(doc, 'portrait', null, '');
  doc.moveDown(2);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(TINTA)
    .text('Certidão permanente do registo predial', { align: 'center' })
    .moveDown(1.5)
    .font('Helvetica')
    .fontSize(11)
    .text('Conservatória do Registo Predial de Guimarães (fictícia)')
    .text('Prédio urbano · Rua de Camões, 85 · freguesia de Creixomil')
    .text('Titular: Sandra Martins')
    .text('Composição: moradia de rés-do-chão e andar, com logradouro')
    .moveDown(1)
    .text('Data da certidão: 1 de outubro de 2026 · válida por 6 meses');
  return terminar(doc);
}

/** O ficheiro de demonstração pela chave (null se a chave não é de demonstração). */
export async function ficheiroDemonstracao(
  chave: string,
): Promise<Buffer | null> {
  switch (chave) {
    case FICHEIROS_DEMONSTRACAO.projeto:
      return gerarProjetoDemonstracao();
    case FICHEIROS_DEMONSTRACAO.termo:
      return gerarTermoDemonstracao();
    case FICHEIROS_DEMONSTRACAO.certidao:
      return gerarCertidaoDemonstracao();
    default:
      return null;
  }
}
