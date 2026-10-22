/*
 * Projetos de DEMONSTRAÇÃO para avaliar a leitura da IA (V4 #2) nos tipos de
 * operação que ainda não tinham projeto: moradia nova, fachada, demolição e
 * mudança de uso. Tudo fictício (moradas, técnicos, valores) e marcado em
 * cada página. Os números estão escritos nos desenhos de propósito: são o
 * gabarito do comando `npm run verificar-projetos` (ver
 * `avaliacao-projetos.ts`). Na fachada a cércea NÃO está cotada, para ver
 * se a IA inventa um número (não pode).
 */
import {
  AZUL,
  Carimbo,
  CINZA,
  MARCA,
  novoPdf,
  paginaPdf,
  terminarPdf,
  TINTA,
  tituloFolhaPdf,
} from './pdf-demonstracao.js';

export type ChaveProjetoAvaliacao =
  'construcao_nova' | 'fachada' | 'demolicao' | 'mudanca_uso';

interface TecnicoDemo {
  nome: string;
  titulo: string;
  ordem: 'OA' | 'OE';
  ordem_nome: string;
  numero: string;
  feminino: boolean;
}

export interface ProjetoAvaliacao {
  chave: ChaveProjetoAvaliacao;
  assunto: string;
  morada: string;
  freguesia: string;
  requerente: string;
  descricao: string;
  tecnico: TecnicoDemo;
  /** Dia do projeto e do termo, por extenso. */
  dia: string;
}

const OA = 'Ordem dos Arquitectos';
const OE = 'Ordem dos Engenheiros';

export const PROJETOS_AVALIACAO: Record<
  ChaveProjetoAvaliacao,
  ProjetoAvaliacao
> = {
  construcao_nova: {
    chave: 'construcao_nova',
    assunto: 'Construção de moradia unifamiliar',
    morada: 'Rua da Boavista, lote 7',
    freguesia: 'Silvares',
    requerente: 'Helena Barbosa',
    descricao:
      'Construção de uma moradia unifamiliar de dois pisos, com garagem para dois carros, num lote de 600 m².',
    tecnico: {
      nome: 'Sofia Almeida',
      titulo: 'arquiteta',
      ordem: 'OA',
      ordem_nome: OA,
      numero: '56789',
      feminino: true,
    },
    dia: '9 de outubro de 2026',
  },
  fachada: {
    chave: 'fachada',
    assunto: 'Substituição de caixilharia e pintura da fachada',
    morada: 'Rua de Santa Maria, 21',
    freguesia: 'Oliveira, São Paio e São Sebastião',
    requerente: 'Luís Teixeira',
    descricao:
      'Substituição das janelas de alumínio por madeira e pintura da fachada principal.',
    tecnico: {
      nome: 'Tiago Martins',
      titulo: 'arquiteto',
      ordem: 'OA',
      ordem_nome: OA,
      numero: '67890',
      feminino: false,
    },
    dia: '12 de outubro de 2026',
  },
  demolicao: {
    chave: 'demolicao',
    assunto: 'Demolição de armazém',
    morada: 'Rua do Moinho, 5',
    freguesia: 'Ponte',
    requerente: 'Construções Rio Ave, Lda.',
    descricao:
      'Demolição total de um armazém de um piso, com 120 m², para limpeza do terreno.',
    tecnico: {
      nome: 'Carla Nunes',
      titulo: 'engenheira civil',
      ordem: 'OE',
      ordem_nome: OE,
      numero: '78901',
      feminino: true,
    },
    dia: '13 de outubro de 2026',
  },
  mudanca_uso: {
    chave: 'mudanca_uso',
    assunto: 'Alteração de uso de habitação para comércio',
    morada: 'Rua Paio Galvão, 14, rés-do-chão',
    freguesia: 'Azurém',
    requerente: 'Beatriz Correia',
    descricao:
      'Mudança de uso do rés-do-chão de habitação para comércio (loja de artesanato), com 85 m².',
    tecnico: {
      nome: 'Ricardo Lopes',
      titulo: 'arquiteto',
      ordem: 'OA',
      ordem_nome: OA,
      numero: '89012',
      feminino: false,
    },
    dia: '14 de outubro de 2026',
  },
};

function carimbo(p: ProjetoAvaliacao): Carimbo {
  const t = p.tecnico;
  return {
    local: `${p.morada} · ${p.freguesia}`,
    autor: `${t.feminino ? 'Autora' : 'Autor'}: ${t.ordem === 'OA' ? 'Arq.' : 'Eng.'} ${t.nome}`,
  };
}

function escrita(doc: PDFKit.PDFDocument) {
  const p = (t: string) =>
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(TINTA)
      .text(t, { width: 480, align: 'justify' })
      .moveDown(0.6);
  const s = (t: string) =>
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(TINTA)
      .text(t)
      .moveDown(0.3);
  return { p, s };
}

function assinatura(doc: PDFKit.PDFDocument, p: ProjetoAvaliacao) {
  const t = p.tecnico;
  doc
    .moveDown(1)
    .font('Helvetica')
    .fontSize(10)
    .fillColor(TINTA)
    .text(`Guimarães, ${p.dia}`)
    .text(
      `${t.feminino ? 'A autora' : 'O autor'} do projeto: ${t.nome}, ${t.titulo} (${t.ordem_nome}, n.º ${t.numero})`,
    );
}

/** Linha de cota com traços nas pontas e o valor ao lado. */
function cota(
  doc: PDFKit.PDFDocument,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  valor: string,
) {
  const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
  doc.save().lineWidth(0.8).strokeColor(MARCA);
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  const t = 4;
  if (vertical) {
    doc
      .moveTo(x1 - t, y1)
      .lineTo(x1 + t, y1)
      .stroke();
    doc
      .moveTo(x2 - t, y2)
      .lineTo(x2 + t, y2)
      .stroke();
  } else {
    doc
      .moveTo(x1, y1 - t)
      .lineTo(x1, y1 + t)
      .stroke();
    doc
      .moveTo(x2, y2 - t)
      .lineTo(x2, y2 + t)
      .stroke();
  }
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(MARCA)
    .text(
      valor,
      vertical ? x1 - 66 : (x1 + x2) / 2 - 30,
      vertical ? (y1 + y2) / 2 - 5 : y1 - 13,
      { width: 60, lineBreak: false, align: vertical ? 'right' : 'center' },
    );
}

function quadro(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  titulo: string,
  linhas: [string, string][],
) {
  const w = 240;
  const h = 18 + linhas.length * 14;
  doc
    .save()
    .lineWidth(0.8)
    .strokeColor(TINTA)
    .rect(x, y, w, h)
    .stroke()
    .restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(TINTA)
    .text(titulo, x + 6, y + 5, { width: w - 12, lineBreak: false });
  linhas.forEach(([a, b], i) => {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(TINTA)
      .text(a, x + 6, y + 20 + i * 14, { width: 160, lineBreak: false })
      .font('Helvetica-Bold')
      .text(b, x + 160, y + 20 + i * 14, {
        width: w - 166,
        align: 'right',
        lineBreak: false,
      });
  });
}

function memoria(
  doc: PDFKit.PDFDocument,
  p: ProjetoAvaliacao,
  subtitulo: string,
  seccoes: [string, string][],
) {
  paginaPdf(
    doc,
    'portrait',
    '1',
    'Memória descritiva e justificativa',
    carimbo(p),
  );
  tituloFolhaPdf(doc, 'Memória descritiva e justificativa', subtitulo);
  const { p: par, s } = escrita(doc);
  for (const [t, texto] of seccoes) {
    s(t);
    par(texto);
  }
  assinatura(doc, p);
}

async function projetoConstrucaoNova(): Promise<Buffer> {
  const p = PROJETOS_AVALIACAO.construcao_nova;
  const c = carimbo(p);
  const doc = novoPdf('Projeto de arquitetura · Moradia nova', 'landscape');
  memoria(doc, p, 'Construção de moradia unifamiliar · licença', [
    [
      '1. Objeto',
      `Construção de uma moradia unifamiliar isolada no lote situado na ${p.morada}, freguesia de ${p.freguesia}, com dois pisos acima do solo e garagem.`,
    ],
    [
      '2. Implantação',
      'A moradia implanta-se recuada da via, com o afastamento mínimo às extremas laterais e de tardoz indicado na planta de implantação (Folha 2). O estacionamento faz-se dentro do lote, na garagem do rés-do-chão.',
    ],
    [
      '3. Quadro de áreas',
      'Ver o quadro de áreas da Folha 2 (área do lote, implantação, construção, pisos, cércea, afastamentos e estacionamento).',
    ],
    [
      '4. Peças do projeto',
      'Folha 1 · Memória descritiva. Folha 2 · Planta de implantação e quadro de áreas. Folha 3 · Alçado principal e corte.',
    ],
  ]);

  paginaPdf(doc, 'landscape', '2', 'Planta de implantação', c);
  tituloFolhaPdf(doc, 'Planta de implantação', 'Escala 1:200 (esquemática)');
  const ox = 90;
  const oy = 95;
  const m = 10;
  doc.save().lineWidth(1).dash(6, { space: 3 }).strokeColor(CINZA);
  doc
    .rect(ox, oy, 20 * m, 30 * m)
    .stroke()
    .undash()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Limite do lote (20 × 30 m)', ox, oy - 12);
  // Moradia 12 × 15 m, a 4 m da extrema poente e a 6 m da via (em baixo).
  doc
    .save()
    .lineWidth(2)
    .strokeColor(TINTA)
    .rect(ox + 4 * m, oy + 9 * m, 12 * m, 15 * m)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA)
    .text('Moradia\n180 m²', ox + 8 * m, oy + 15 * m);
  cota(doc, ox, oy + 12 * m, ox + 4 * m, oy + 12 * m, '4,00');
  cota(doc, ox + 17 * m, oy + 24 * m, ox + 17 * m, oy + 30 * m, '6,00');
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Rua da Boavista (via pública)', ox, oy + 30 * m + 6);
  quadro(doc, 450, 100, 'Quadro de áreas (proposta)', [
    ['Área do lote', '600,00 m²'],
    ['Área de implantação total', '180,00 m²'],
    ['Área de construção total', '290,00 m²'],
    ['Pisos acima do solo', '2'],
    ['Cércea', '6,50 m'],
    ['Afastamento mínimo às extremas', '4,00 m'],
    ['Afastamento à via', '6,00 m'],
    ['Lugares de estacionamento no lote', '2'],
  ]);

  paginaPdf(doc, 'landscape', '3', 'Alçado principal e corte', c);
  tituloFolhaPdf(doc, 'Alçado principal e corte', 'Dois pisos acima do solo');
  const bx = 160;
  const by = 400;
  doc.save().lineWidth(1.5).strokeColor(TINTA);
  doc.rect(bx, by - 6.5 * 30, 360, 6.5 * 30).stroke();
  doc
    .moveTo(bx, by - 3.2 * 30)
    .lineTo(bx + 360, by - 3.2 * 30)
    .stroke();
  doc.rect(bx + 30, by - 2.6 * 30, 110, 2.6 * 30).stroke();
  doc.restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA)
    .text('Garagem (2 lugares)', bx + 36, by - 1.6 * 30)
    .text('Piso 1', bx + 200, by - 5.6 * 30)
    .text('Rés-do-chão', bx + 200, by - 2.4 * 30);
  cota(doc, bx - 30, by, bx - 30, by - 6.5 * 30, '6,50 m');
  doc
    .save()
    .lineWidth(1)
    .strokeColor(TINTA)
    .moveTo(bx - 40, by)
    .lineTo(bx + 400, by)
    .stroke()
    .restore();
  return terminarPdf(doc);
}

async function projetoFachada(): Promise<Buffer> {
  const p = PROJETOS_AVALIACAO.fachada;
  const c = carimbo(p);
  const doc = novoPdf(
    'Projeto de arquitetura · Caixilharia e fachada',
    'landscape',
  );
  memoria(doc, p, 'Alteração de fachada · comunicação prévia', [
    [
      '1. Objeto',
      `Substituição da caixilharia e pintura da fachada principal do edifício situado na ${p.morada}, no centro histórico.`,
    ],
    [
      '2. Materiais e cores',
      'A caixilharia de alumínio anodizado é substituída por caixilharia de madeira pintada de verde-garrafa, com vidro duplo e a mesma divisão dos vãos. O reboco da fachada é pintado de branco. A cobertura mantém a telha cerâmica de cor natural. As cantarias de granito ficam à vista e são limpas.',
    ],
    [
      '3. Volumetria',
      'Não há alteração da volumetria nem da cércea existente; os vãos mantêm as dimensões.',
    ],
    [
      '4. Peças do projeto',
      'Folha 1 · Memória descritiva. Folha 2 · Alçado principal, existente e proposto.',
    ],
  ]);
  paginaPdf(doc, 'landscape', '2', 'Alçado principal', c);
  tituloFolhaPdf(
    doc,
    'Alçado principal · existente e proposto',
    'Escala 1:100 (esquemática)',
  );
  const alcado = (x: number, proposta: boolean) => {
    doc.save().lineWidth(1.5).strokeColor(TINTA);
    doc.rect(x, 140, 260, 230).stroke();
    doc
      .moveTo(x - 10, 140)
      .lineTo(x + 130, 95)
      .lineTo(x + 270, 140)
      .stroke();
    doc.restore();
    for (const [jx, jy] of [
      [x + 30, 170],
      [x + 160, 170],
      [x + 30, 270],
      [x + 160, 270],
    ]) {
      doc
        .save()
        .lineWidth(proposta ? 2 : 1)
        .strokeColor(proposta ? '#14532D' : CINZA)
        .rect(jx, jy, 70, 70)
        .stroke()
        .restore();
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(TINTA)
      .text(proposta ? 'Proposto' : 'Existente', x, 380, {
        width: 260,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(CINZA)
      .text(
        proposta
          ? 'Caixilharia de madeira verde-garrafa · reboco pintado de branco · telha cerâmica'
          : 'Caixilharia de alumínio anodizado · reboco cinzento',
        x,
        396,
        { width: 260, align: 'center' },
      );
  };
  alcado(80, false);
  alcado(440, true);
  return terminarPdf(doc);
}

async function projetoDemolicao(): Promise<Buffer> {
  const p = PROJETOS_AVALIACAO.demolicao;
  const c = carimbo(p);
  const doc = novoPdf('Plano de demolição · Armazém', 'landscape');
  memoria(doc, p, 'Demolição total · plano de demolição', [
    [
      '1. Objeto',
      `Demolição total do armazém de um piso, com 120 m² de implantação, situado na ${p.morada}, freguesia de ${p.freguesia}.`,
    ],
    [
      '2. Materiais',
      'Paredes em blocos de betão, estrutura metálica e cobertura em chapas onduladas de fibrocimento, que podem conter amianto. As chapas são retiradas antes de tudo, por empresa habilitada para a remoção de amianto, e seguem para destino licenciado.',
    ],
    [
      '3. Faseamento e meios',
      'Fase 1: remoção da cobertura de fibrocimento. Fase 2: desmonte da estrutura metálica. Fase 3: demolição das paredes, de cima para baixo, com mini-giratória. Fase 4: remoção das fundações e limpeza do terreno.',
    ],
    [
      '4. Proteção da via e dos vizinhos',
      'Tapume contínuo de 2,00 m na frente da Rua do Moinho, rede de proteção junto ao muro do vizinho nascente e rega para reduzir as poeiras.',
    ],
    [
      '5. Peças',
      'Folha 1 · Memória e plano de demolição. Folha 2 · Planta de demolição.',
    ],
  ]);
  paginaPdf(doc, 'landscape', '2', 'Planta de demolição', c);
  tituloFolhaPdf(doc, 'Planta de demolição', 'Escala 1:200 (esquemática)');
  doc.save().lineWidth(2).strokeColor(MARCA).dash(6, { space: 4 });
  doc.rect(200, 140, 240, 120).stroke().undash().restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(MARCA)
    .text('Armazém a demolir · 120 m²', 230, 190);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(TINTA)
    .text('Cobertura em fibrocimento (remover na fase 1)', 230, 206);
  doc.save().lineWidth(3).strokeColor(AZUL);
  doc.moveTo(120, 300).lineTo(560, 300).stroke().restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(AZUL)
    .text('Tapume de proteção (2,00 m)', 300, 306);
  doc.save().fillColor('#E5E7EB').rect(100, 320, 480, 40).fill().restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text('Rua do Moinho (via pública)', 280, 335);
  return terminarPdf(doc);
}

async function projetoMudancaUso(): Promise<Buffer> {
  const p = PROJETOS_AVALIACAO.mudanca_uso;
  const c = carimbo(p);
  const doc = novoPdf('Projeto de arquitetura · Mudança de uso', 'landscape');
  memoria(doc, p, 'Alteração de uso · licença', [
    [
      '1. Objeto',
      `Alteração do uso do rés-do-chão do edifício situado na ${p.morada}, freguesia de ${p.freguesia}, de habitação para comércio (loja de artesanato), numa área de 85 m². Não há obras na estrutura nem na fachada: a montra existente mantém-se.`,
    ],
    [
      '2. Acessibilidades',
      'A entrada fica à cota do passeio, sem degraus, com uma rampa interior de inclinação 6%. Há uma instalação sanitária adaptada com 2,20 × 2,20 m, porta de 0,90 m e barras de apoio.',
    ],
    [
      '3. Estacionamento',
      'É afeto à loja 1 lugar de estacionamento na garagem do edifício (lugar n.º 3).',
    ],
    [
      '4. Peças do projeto',
      'Folha 1 · Memória descritiva. Folha 2 · Planta do rés-do-chão proposta.',
    ],
  ]);
  paginaPdf(doc, 'landscape', '2', 'Planta do rés-do-chão', c);
  tituloFolhaPdf(
    doc,
    'Planta do rés-do-chão · proposta',
    'Escala 1:50 (esquemática)',
  );
  doc.save().lineWidth(4).strokeColor(TINTA);
  doc.rect(100, 110, 420, 260).stroke().restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(TINTA)
    .text('Loja · 85 m²', 250, 220);
  doc
    .save()
    .lineWidth(1.5)
    .strokeColor(AZUL)
    .rect(420, 110, 100, 100)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(AZUL)
    .text('I.S. adaptada\n2,20 × 2,20 m', 428, 150);
  doc
    .save()
    .lineWidth(1)
    .strokeColor(MARCA)
    .moveTo(160, 370)
    .lineTo(160, 330)
    .lineTo(240, 330)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MARCA)
    .text('Entrada sem degraus · rampa 6%', 170, 338);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Rua Paio Galvão (passeio)', 100, 380);
  doc
    .save()
    .lineWidth(1)
    .strokeColor(TINTA)
    .rect(580, 260, 70, 110)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(TINTA)
    .text('Garagem\nlugar n.º 3\n(afeto à loja)', 586, 290, { width: 60 });
  return terminarPdf(doc);
}

function termo(p: ProjetoAvaliacao): Promise<Buffer> {
  const t = p.tecnico;
  const doc = novoPdf(
    'Termo de responsabilidade do autor do projeto',
    'portrait',
  );
  paginaPdf(doc, 'portrait', null, '', carimbo(p));
  doc.moveDown(2);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(TINTA)
    .text('Termo de responsabilidade do autor do projeto', { align: 'center' })
    .moveDown(1.5);
  doc
    .font('Helvetica')
    .fontSize(11)
    .text(
      `${t.nome}, ${t.titulo}, ${t.feminino ? 'inscrita' : 'inscrito'} na ${t.ordem_nome} com o n.º ${t.numero}, declara, para efeitos do disposto no Regime Jurídico da Urbanização e Edificação, que o projeto de que é ${t.feminino ? 'autora' : 'autor'}, relativo à obra "${p.assunto.toLowerCase()}" na ${p.morada}, ${p.freguesia}, Guimarães, cujo requerente é ${p.requerente}, observa as normas legais e regulamentares aplicáveis.`,
      { align: 'justify' },
    )
    .moveDown(2)
    .text(`Guimarães, ${p.dia}`)
    .moveDown(3);
  doc
    .font('Helvetica-Oblique')
    .fontSize(18)
    .fillColor(AZUL)
    .text(t.nome, { align: 'center' });
  doc
    .moveDown(0.2)
    .font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text('(assinatura · demonstração)', { align: 'center' });
  return terminarPdf(doc);
}

const PROJETO: Record<ChaveProjetoAvaliacao, () => Promise<Buffer>> = {
  construcao_nova: projetoConstrucaoNova,
  fachada: projetoFachada,
  demolicao: projetoDemolicao,
  mudanca_uso: projetoMudancaUso,
};

/** O projeto (desenhos e memória) de um destes casos. */
export function gerarProjetoAvaliacao(
  chave: ChaveProjetoAvaliacao,
): Promise<Buffer> {
  return PROJETO[chave]();
}

/** O termo de responsabilidade de um destes casos. */
export function gerarTermoAvaliacao(
  chave: ChaveProjetoAvaliacao,
): Promise<Buffer> {
  return termo(PROJETOS_AVALIACAO[chave]);
}
