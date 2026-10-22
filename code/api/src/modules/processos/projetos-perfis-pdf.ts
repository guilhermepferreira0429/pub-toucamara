/*
 * Processos de DEMONSTRAÇÃO da análise por tipo de operação (V4 #2): uma
 * ampliação que excede o índice de implantação da zona, uma piscina
 * desenhada a 1,5 m da extrema (a regra de demonstração pede 3 m) e um muro
 * de vedação em ordem. Tudo fictício: requerentes, moradas, técnicos e
 * projetos. Cada processo traz os seus PDF (gerados aqui, sempre iguais) e a
 * leitura que a IA deve fazer deles (para os testes e as capturas sem IA).
 *
 * Os ficheiros não precisam de armazenamento: a chave começa por
 * `demonstracao/` e o PDF gera-se quando se pede.
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
import type { LeituraProjeto } from './verificacoes.js';

const PREFIXO = 'demonstracao/';

export type ChaveProcessoPerfil = 'ampliacao' | 'piscina' | 'muro';

interface Tecnico {
  nome: string;
  titulo: string;
  ordem: 'OA' | 'OE';
  ordem_nome: string;
  numero: string;
  feminino: boolean;
}

/** Um documento do processo de demonstração (pela ordem de entrega). */
export interface DocumentoDemo {
  /** Nome que aparece (e que as verificações reconhecem). */
  nome: string;
  /** Liga ao tipo de documento do tipo de processo, se houver um com este nome. */
  tipo: RegExp | null;
  ficheiro: string;
  /** A verificação já feita do documento (o termo e a certidão). */
  verificacao: { regra: string; ok: boolean; detalhe: string }[] | null;
  emitido: string;
}

export interface ProcessoDemoPerfil {
  chave: ChaveProcessoPerfil;
  numero: number;
  assunto: string;
  morada: string;
  freguesia: string;
  /** Dentro do "Espaço residencial consolidado" de demonstração, fora do centro histórico. */
  lat: number;
  lng: number;
  requerente: string;
  descricao: string;
  /** O que o requerimento declara (a operação e os números). */
  dados: Record<string, unknown>;
  tecnico: Tecnico;
  documentos: DocumentoDemo[];
  /** O que se espera ver (para o ecrã e os testes). */
  resultado: string;
}

const chave = (pasta: string, f: string) => `${PREFIXO}${pasta}/${f}.pdf`;

const CERTIDAO = /certid[aã]o/i;
const TERMO = /termo\s+de\s+responsabilidade/i;

function docsBase(pasta: string, emitido: string): DocumentoDemo[] {
  return [
    {
      nome: 'Certidão do registo predial',
      tipo: CERTIDAO,
      ficheiro: chave(pasta, 'certidao'),
      verificacao: [
        { regra: 'validade', ok: true, detalhe: 'Emitida há menos de 6 meses' },
      ],
      emitido: '2026-10-01',
    },
    {
      nome: 'Termo de responsabilidade',
      tipo: TERMO,
      ficheiro: chave(pasta, 'termo'),
      verificacao: [
        { regra: 'assinatura', ok: true, detalhe: 'Assinatura visível' },
      ],
      emitido,
    },
    {
      nome: 'Projeto de arquitetura',
      tipo: null,
      ficheiro: chave(pasta, 'projeto'),
      verificacao: null,
      emitido,
    },
    {
      nome: 'Planta de localização',
      tipo: null,
      ficheiro: chave(pasta, 'localizacao'),
      verificacao: null,
      emitido,
    },
  ];
}

function peca(
  pasta: string,
  nome: string,
  ficheiro: string,
  emitido: string,
): DocumentoDemo {
  return {
    nome,
    tipo: null,
    ficheiro: chave(pasta, ficheiro),
    verificacao: null,
    emitido,
  };
}

export const PROCESSOS_PERFIS: ProcessoDemoPerfil[] = [
  {
    chave: 'ampliacao',
    numero: 413,
    assunto: 'Ampliação de moradia',
    morada: 'Rua do Carvalhal, 47',
    freguesia: 'Urgezes',
    lat: 41.436,
    lng: -8.308,
    requerente: 'Rui Fernandes',
    descricao:
      'Ampliação da moradia unifamiliar no alçado posterior, com uma cozinha nova e um quarto no rés-do-chão (45 m²).',
    dados: {
      operacao: 'ampliacao',
      area_lote_m2: 300,
      area_obra_m2: 45,
      area_implantacao_m2: 165,
      area_construcao_m2: 230,
      pisos: 2,
      cercea_m: 6.8,
      afastamento_extremas_m: 3.5,
    },
    tecnico: {
      nome: 'Pedro Sousa',
      titulo: 'arquiteto',
      ordem: 'OA',
      ordem_nome: 'Ordem dos Arquitectos',
      numero: '23456',
      feminino: false,
    },
    documentos: [
      ...docsBase('cp-ampliacao', '2026-10-06'),
      peca(
        'cp-ampliacao',
        'Levantamento topográfico',
        'levantamento',
        '2026-09-20',
      ),
      peca(
        'cp-ampliacao',
        'Projeto de estabilidade',
        'estabilidade',
        '2026-10-06',
      ),
      peca(
        'cp-ampliacao',
        'Fotografias do existente',
        'fotografias',
        '2026-09-20',
      ),
    ],
    resultado:
      'Falha: a área de implantação total (165 m²) excede o máximo da zona (0,5 × 300 m² = 150 m²).',
  },
  {
    chave: 'piscina',
    numero: 414,
    assunto: 'Piscina no logradouro',
    morada: 'Travessa da Ramada, 12',
    freguesia: 'Azurém',
    lat: 41.452,
    lng: -8.306,
    requerente: 'Marta Ribeiro',
    descricao:
      'Construção de uma piscina enterrada de 8 × 4 m no logradouro da moradia, com casa das máquinas enterrada.',
    dados: {
      operacao: 'piscina',
      area_lote_m2: 450,
      area_obra_m2: 32,
      afastamento_extremas_m: 3,
    },
    tecnico: {
      nome: 'Inês Carvalho',
      titulo: 'arquiteta',
      ordem: 'OA',
      ordem_nome: 'Ordem dos Arquitectos',
      numero: '34567',
      feminino: true,
    },
    documentos: [
      ...docsBase('cp-piscina', '2026-10-07'),
      peca(
        'cp-piscina',
        'Projeto de estabilidade',
        'estabilidade',
        '2026-10-07',
      ),
    ],
    resultado:
      'Falha a confirmar: a planta cota 1,5 m entre a piscina e a extrema; a regra de demonstração pede 3 m (o requerimento declara 3 m).',
  },
  {
    chave: 'muro',
    numero: 415,
    assunto: 'Muro de vedação à face da rua',
    morada: 'Rua do Paço, 33',
    freguesia: 'Urgezes',
    lat: 41.434,
    lng: -8.285,
    requerente: 'António Pereira',
    descricao:
      'Construção de um muro de vedação com 18 m de frente, confinante com a via pública, com 1,50 m de altura.',
    dados: {
      operacao: 'muro',
      altura_muro_m: 1.5,
      confronta_via: 'sim',
    },
    tecnico: {
      nome: 'Miguel Costa',
      titulo: 'engenheiro civil',
      ordem: 'OE',
      ordem_nome: 'Ordem dos Engenheiros',
      numero: '45678',
      feminino: false,
    },
    documentos: docsBase('cp-muro', '2026-10-08'),
    resultado:
      'Tudo verificado: altura de 1,5 m no máximo de 1,5 m para muros à face da via; pronto para decisão.',
  },
];

// ---------------------------------------------------------------------------
// A leitura que a IA deve fazer (para os testes e as capturas)
// ---------------------------------------------------------------------------

/**
 * Os documentos que vão à IA, pela ordem: as peças do projeto (nome com
 * "projeto", "planta"...) e o termo no fim. As referências são por número.
 */
export function documentosLidosDemo(p: ProcessoDemoPerfil): string[] {
  const re =
    /projeto|arquitetura|arquitectura|planta|al[cç]ado|corte|mem[oó]ria|desenho|pe[cç]as/i;
  const pecas = p.documentos
    .filter((d) => re.test(d.nome) && !TERMO.test(d.nome))
    .map((d) => d.nome);
  return [...pecas, 'Termo de responsabilidade'].slice(0, 5);
}

const ref = (
  documento: number,
  pagina: number | null,
  folha: string | null,
) => ({
  documento,
  pagina,
  folha,
});

export function leituraDemo(chave: ChaveProcessoPerfil): LeituraProjeto {
  const p = PROCESSOS_PERFIS.find((x) => x.chave === chave)!;
  const lidos = documentosLidosDemo(p);
  const n = (nome: string) => lidos.indexOf(nome) + 1;
  const tecnico = {
    nome: p.tecnico.nome,
    ordem: p.tecnico.ordem,
    numero_inscricao: p.tecnico.numero,
    termo_assinado: true,
    referencia: ref(n('Termo de responsabilidade'), 1, null),
  };
  switch (chave) {
    case 'ampliacao':
      return {
        legivel: true,
        motivo_ilegivel: null,
        fachada_cobertura: {
          alteracoes: 'sim',
          descricao:
            'O alçado posterior muda com o volume da ampliação, em rés-do-chão, com cobertura plana.',
          referencia: ref(1, 3, '3'),
        },
        paredes: {
          abertura_ou_demolicao: 'sim',
          declarada_nao_estrutural: false,
          descricao:
            'Abertura na parede posterior para ligar a casa à ampliação.',
          referencia: ref(1, 2, '2'),
        },
        planta_estruturas: {
          existe: true,
          referencia: ref(n('Projeto de estabilidade'), 1, 'E1'),
        },
        areas_cerceas: {
          coerentes: 'nao',
          descricao:
            'A área de construção total é 230 m² na memória e 236 m² no quadro da planta.',
          referencia: ref(1, 2, '2'),
        },
        contradicoes: [
          {
            descricao:
              'Área de construção total: 230 m² na memória descritiva (folha 1) e 236 m² no quadro de áreas da planta (folha 2).',
            referencia: ref(1, 2, '2'),
          },
        ],
        medicoes: [
          {
            grandeza: 'area_lote_m2',
            valor: 300,
            unidade: 'm2',
            referencia: ref(1, 2, '2'),
          },
          {
            grandeza: 'area_obra_m2',
            valor: 45,
            unidade: 'm2',
            referencia: ref(1, 2, '2'),
          },
          {
            grandeza: 'area_implantacao_m2',
            valor: 165,
            unidade: 'm2',
            referencia: ref(1, 2, '2'),
          },
          {
            grandeza: 'area_construcao_m2',
            valor: 236,
            unidade: 'm2',
            referencia: ref(1, 2, '2'),
          },
          {
            grandeza: 'pisos',
            valor: 2,
            unidade: 'pisos',
            referencia: ref(1, 3, '3'),
          },
          {
            grandeza: 'cercea_m',
            valor: 6.8,
            unidade: 'm',
            referencia: ref(1, 3, '3'),
          },
          {
            grandeza: 'afastamento_extremas_m',
            valor: 3.5,
            unidade: 'm',
            referencia: ref(1, 2, '2'),
          },
        ],
        elementos: [],
        tecnico_autor: tecnico,
      };
    case 'piscina':
      return {
        legivel: true,
        motivo_ilegivel: null,
        fachada_cobertura: {
          alteracoes: 'nao',
          descricao: 'A moradia não é alterada; a obra é só no logradouro.',
          referencia: ref(1, 1, '1'),
        },
        paredes: {
          abertura_ou_demolicao: 'nao',
          declarada_nao_estrutural: false,
          descricao: 'Sem paredes a abrir.',
          referencia: null,
        },
        planta_estruturas: {
          existe: true,
          referencia: ref(n('Projeto de estabilidade'), 1, 'E1'),
        },
        areas_cerceas: {
          coerentes: 'sim',
          descricao: 'Plano de água de 8 × 4 m (32 m²) na memória e na planta.',
          referencia: ref(1, 2, '2'),
        },
        contradicoes: [
          {
            descricao:
              'A memória diz que a piscina fica a 3,00 m das extremas (folha 1); a planta cota 1,50 m entre a piscina e a extrema nascente (folha 2).',
            referencia: ref(1, 2, '2'),
          },
        ],
        medicoes: [
          {
            grandeza: 'area_obra_m2',
            valor: 32,
            unidade: 'm2',
            referencia: ref(1, 2, '2'),
          },
          {
            grandeza: 'afastamento_extremas_m',
            valor: 1.5,
            unidade: 'm',
            referencia: ref(1, 2, '2'),
          },
        ],
        elementos: [
          {
            elemento: 'casa_maquinas',
            resposta: 'sim',
            descricao:
              'Casa das máquinas enterrada de 2 × 1,5 m junto ao muro norte.',
            referencia: ref(1, 2, '2'),
          },
        ],
        tecnico_autor: tecnico,
      };
    case 'muro':
      return {
        legivel: true,
        motivo_ilegivel: null,
        fachada_cobertura: {
          alteracoes: 'nao',
          descricao: 'A moradia não é alterada; a obra é só o muro.',
          referencia: ref(1, 1, '1'),
        },
        paredes: {
          abertura_ou_demolicao: 'nao',
          declarada_nao_estrutural: false,
          descricao: 'Sem paredes a abrir.',
          referencia: null,
        },
        planta_estruturas: { existe: false, referencia: null },
        areas_cerceas: {
          coerentes: 'sem_dados',
          descricao: '',
          referencia: null,
        },
        contradicoes: [],
        medicoes: [
          {
            grandeza: 'altura_muro_m',
            valor: 1.5,
            unidade: 'm',
            referencia: ref(1, 2, '2'),
          },
        ],
        elementos: [
          {
            elemento: 'confronta_via',
            resposta: 'sim',
            descricao:
              'O muro fica no alinhamento do passeio da Rua do Paço, com 18 m de frente.',
            referencia: ref(1, 2, '2'),
          },
        ],
        tecnico_autor: tecnico,
      };
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function carimbo(p: ProcessoDemoPerfil): Carimbo {
  const t = p.tecnico;
  const abrev = t.ordem === 'OA' ? 'Arq.' : 'Eng.';
  return {
    local: `Moradia · ${p.morada} · ${p.freguesia}`,
    autor: `${t.feminino ? 'Autora' : 'Autor'}: ${abrev} ${t.nome}`,
  };
}

function texto(doc: PDFKit.PDFDocument) {
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

/** Linha de cota com traços nas pontas e o valor no meio. */
function cota(
  doc: PDFKit.PDFDocument,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  valor: string,
  cor = MARCA,
) {
  doc.save().lineWidth(0.8).strokeColor(cor);
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
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
    .fillColor(cor)
    .text(
      valor,
      // Na vertical, o valor fica à esquerda da linha (fora do desenho).
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
  const w = 230;
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
    .text(titulo, x + 6, y + 5, {
      width: w - 12,
      lineBreak: false,
    });
  linhas.forEach(([a, b], i) => {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(TINTA)
      .text(a, x + 6, y + 20 + i * 14, { width: 150, lineBreak: false })
      .font('Helvetica-Bold')
      .text(b, x + 150, y + 20 + i * 14, {
        width: w - 156,
        align: 'right',
        lineBreak: false,
      });
  });
}

function assinatura(
  doc: PDFKit.PDFDocument,
  p: ProcessoDemoPerfil,
  dia: string,
) {
  const t = p.tecnico;
  doc
    .moveDown(1)
    .font('Helvetica')
    .fontSize(10)
    .fillColor(TINTA)
    .text(`Guimarães, ${dia}`)
    .text(
      `${t.feminino ? 'A autora' : 'O autor'} do projeto: ${t.nome}, ${t.titulo} (${t.ordem_nome}, n.º ${t.numero})`,
    );
}

async function projetoAmpliacao(): Promise<Buffer> {
  const p = PROCESSOS_PERFIS[0];
  const c = carimbo(p);
  const doc = novoPdf(
    'Projeto de arquitetura · Ampliação de moradia',
    'landscape',
  );
  const { p: par, s } = texto(doc);

  paginaPdf(doc, 'portrait', '1', 'Memória descritiva e justificativa', c);
  tituloFolhaPdf(
    doc,
    'Memória descritiva e justificativa',
    'Ampliação de moradia unifamiliar · comunicação prévia',
  );
  s('1. Objeto');
  par(
    `A presente memória refere-se à ampliação da moradia unifamiliar situada na ${p.morada}, freguesia de ${p.freguesia}, no alçado posterior, com uma cozinha nova e um quarto no rés-do-chão, num total de 45 m².`,
  );
  s('2. Descrição da intervenção');
  par(
    'O volume novo, em rés-do-chão e com cobertura plana, encosta ao alçado posterior. A ligação à casa faz-se por uma abertura na parede posterior, reforçada conforme o projeto de estabilidade. A moradia existente mantém os dois pisos.',
  );
  s('3. Quadro de áreas');
  par(
    'Área do lote: 300,00 m². Área de implantação existente: 120,00 m². Área a ampliar: 45,00 m². Área de implantação total: 165,00 m². Área de construção total: 230,00 m². Número de pisos acima do solo: 2. Cércea: 6,80 m. Afastamento mínimo às extremas: 3,50 m.',
  );
  s('4. Peças do projeto');
  par(
    'Folha 1 · Memória descritiva. Folha 2 · Planta de implantação e quadro de áreas. Folha 3 · Alçado posterior e corte. O termo de responsabilidade do autor segue em documento próprio.',
  );
  assinatura(doc, p, '6 de outubro de 2026');

  // Folha 2 · Planta de implantação (1 m = 12 pt).
  paginaPdf(doc, 'landscape', '2', 'Planta de implantação', c);
  tituloFolhaPdf(doc, 'Planta de implantação', 'Escala 1:200 (esquemática)');
  const ox = 90;
  const oy = 110;
  const m = 12;
  doc.save().lineWidth(1).dash(6, { space: 3 }).strokeColor(CINZA);
  doc
    .rect(ox, oy, 15 * m, 20 * m)
    .stroke()
    .undash()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Limite do lote (15 × 20 m)', ox, oy - 12);
  // Casa existente (10 × 12 m) e ampliação (7,5 × 6 m) atrás.
  doc
    .save()
    .lineWidth(2)
    .strokeColor(TINTA)
    .rect(ox + 3.5 * m, oy + 2 * m, 10 * m, 12 * m)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA)
    .text('Existente\n120 m²', ox + 6 * m, oy + 7 * m);
  doc.save().lineWidth(2).strokeColor(MARCA).fillColor('#FDE7D9');
  doc
    .rect(ox + 3.5 * m, oy + 14 * m, 7.5 * m, 6 * m)
    .fillAndStroke()
    .restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(MARCA)
    .text('Ampliação\n45 m²', ox + 5 * m, oy + 16 * m);
  cota(doc, ox, oy + 9 * m, ox + 3.5 * m, oy + 9 * m, '3,50');
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Rua do Carvalhal', ox, oy + 20 * m + 8);
  quadro(doc, 470, 110, 'Quadro de áreas (proposta)', [
    ['Área do lote', '300,00 m²'],
    ['Implantação existente', '120,00 m²'],
    ['Ampliação', '45,00 m²'],
    ['Implantação total', '165,00 m²'],
    ['Construção total', '236,00 m²'],
    ['Pisos acima do solo', '2'],
    ['Afastamento mínimo às extremas', '3,50 m'],
  ]);

  // Folha 3 · Alçado posterior e corte.
  paginaPdf(doc, 'landscape', '3', 'Alçado posterior e corte', c);
  tituloFolhaPdf(doc, 'Alçado posterior e corte', 'Dois pisos acima do solo');
  const bx = 120;
  const by = 380;
  doc.save().lineWidth(1.5).strokeColor(TINTA);
  doc.rect(bx, by - 6.8 * 30, 10 * 24, 6.8 * 30).stroke();
  doc
    .moveTo(bx, by - 3.4 * 30)
    .lineTo(bx + 240, by - 3.4 * 30)
    .stroke();
  doc.restore();
  doc
    .save()
    .lineWidth(1.5)
    .strokeColor(MARCA)
    .rect(bx + 240, by - 3 * 30, 150, 3 * 30)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA)
    .text('Piso 1', bx + 10, by - 6.4 * 30)
    .text('Rés-do-chão', bx + 10, by - 3 * 30);
  doc.fillColor(MARCA).text('Ampliação (rés-do-chão)', bx + 250, by - 2.5 * 30);
  cota(doc, bx - 30, by, bx - 30, by - 6.8 * 30, '6,80 m');
  doc
    .save()
    .lineWidth(1)
    .strokeColor(TINTA)
    .moveTo(bx - 40, by)
    .lineTo(bx + 420, by)
    .stroke()
    .restore();
  return terminarPdf(doc);
}

async function projetoPiscina(): Promise<Buffer> {
  const p = PROCESSOS_PERFIS[1];
  const c = carimbo(p);
  const doc = novoPdf('Projeto de arquitetura · Piscina', 'landscape');
  const { p: par, s } = texto(doc);

  paginaPdf(doc, 'portrait', '1', 'Memória descritiva e justificativa', c);
  tituloFolhaPdf(
    doc,
    'Memória descritiva e justificativa',
    'Piscina no logradouro · comunicação prévia',
  );
  s('1. Objeto');
  par(
    `Construção de uma piscina enterrada no logradouro da moradia situada na ${p.morada}, freguesia de ${p.freguesia}. A moradia não é alterada.`,
  );
  s('2. Descrição');
  par(
    'Piscina de betão armado com 8,00 × 4,00 m (plano de água de 32 m²) e profundidade de 1,20 a 1,60 m. A piscina fica afastada 3,00 m das extremas do lote. A casa das máquinas é enterrada, com 2,00 × 1,50 m, junto ao muro norte.',
  );
  s('3. Áreas');
  par(
    'Área do lote: 450,00 m². Plano de água: 32,00 m². Afastamento às extremas: 3,00 m.',
  );
  s('4. Peças do projeto');
  par(
    'Folha 1 · Memória descritiva. Folha 2 · Planta de implantação da piscina. Folha 3 · Corte da piscina.',
  );
  assinatura(doc, p, '7 de outubro de 2026');

  paginaPdf(doc, 'landscape', '2', 'Planta de implantação da piscina', c);
  tituloFolhaPdf(
    doc,
    'Planta de implantação da piscina',
    'Escala 1:200 (esquemática)',
  );
  const ox = 90;
  const oy = 100;
  const m = 11;
  doc.save().lineWidth(1).dash(6, { space: 3 }).strokeColor(CINZA);
  doc
    .rect(ox, oy, 18 * m, 25 * m)
    .stroke()
    .undash()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Limite do lote (18 × 25 m)', ox, oy - 12);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Extrema nascente', ox + 18 * m + 6, oy + 18 * m, { width: 80 });
  doc
    .save()
    .lineWidth(2)
    .strokeColor(TINTA)
    .rect(ox + 3 * m, oy + 2 * m, 10 * m, 9 * m)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA)
    .text('Moradia', ox + 6 * m, oy + 6 * m);
  // Piscina 8 × 4 m a 1,5 m da extrema nascente.
  const px = ox + (18 - 1.5 - 4) * m;
  const py = oy + 13 * m;
  doc
    .save()
    .lineWidth(2)
    .strokeColor(AZUL)
    .fillColor('#DBEAFE')
    .rect(px, py, 4 * m, 8 * m)
    .fillAndStroke()
    .restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(AZUL)
    .text('Piscina\n8 × 4 m\n32 m²', px + 4, py + 30, { width: 4 * m - 6 });
  cota(doc, px + 4 * m, py + 7 * m, ox + 18 * m, py + 7 * m, '1,50');
  // Casa das máquinas.
  doc
    .save()
    .lineWidth(1.2)
    .strokeColor(TINTA)
    .rect(ox + 1 * m, oy + 22 * m, 2 * m, 1.5 * m)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TINTA)
    .text('Casa das máquinas (enterrada)', ox + 1 * m, oy + 23.7 * m, {
      width: 110,
    });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Travessa da Ramada', ox, oy + 25 * m + 16);

  paginaPdf(doc, 'landscape', '3', 'Corte da piscina', c);
  tituloFolhaPdf(doc, 'Corte da piscina', 'Profundidade de 1,20 a 1,60 m');
  doc.save().lineWidth(1.5).strokeColor(TINTA);
  doc
    .moveTo(100, 200)
    .lineTo(180, 200)
    .lineTo(180, 260)
    .lineTo(500, 280)
    .lineTo(500, 200)
    .lineTo(600, 200)
    .stroke();
  doc.restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text('Corte longitudinal · 8,00 m', 260, 300);
  return terminarPdf(doc);
}

async function projetoMuro(): Promise<Buffer> {
  const p = PROCESSOS_PERFIS[2];
  const c = carimbo(p);
  const doc = novoPdf('Projeto de arquitetura · Muro de vedação', 'landscape');
  const { p: par, s } = texto(doc);

  paginaPdf(doc, 'portrait', '1', 'Memória descritiva e justificativa', c);
  tituloFolhaPdf(
    doc,
    'Memória descritiva e justificativa',
    'Muro de vedação · comunicação prévia',
  );
  s('1. Objeto');
  par(
    `Construção de um muro de vedação na frente do lote da moradia situada na ${p.morada}, freguesia de ${p.freguesia}, confinante com a via pública. A moradia não é alterada.`,
  );
  s('2. Descrição');
  par(
    'Muro em blocos de betão, rebocado e pintado de branco, com 18,00 m de frente e 1,50 m de altura acima do passeio, sobre o alinhamento do muro existente. Portão de 3,00 m em chapa metálica cinzenta.',
  );
  s('3. Peças do projeto');
  par('Folha 1 · Memória descritiva. Folha 2 · Planta e alçado do muro.');
  assinatura(doc, p, '8 de outubro de 2026');

  paginaPdf(doc, 'landscape', '2', 'Planta e alçado do muro', c);
  tituloFolhaPdf(doc, 'Planta e alçado do muro', 'Escala 1:100 (esquemática)');
  // Planta: a via em baixo, o muro no alinhamento do passeio.
  doc.save().fillColor('#E5E7EB').rect(80, 230, 560, 40).fill().restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text('Rua do Paço (via pública)', 300, 245);
  doc
    .save()
    .lineWidth(4)
    .strokeColor(MARCA)
    .moveTo(100, 226)
    .lineTo(620, 226)
    .stroke()
    .restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(MARCA)
    .text('Muro novo · 18,00 m', 300, 210);
  doc
    .save()
    .lineWidth(1.5)
    .strokeColor(TINTA)
    .rect(260, 110, 160, 90)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA)
    .text('Moradia (sem alterações)', 275, 150);
  // Alçado do muro com a cota da altura.
  const ax = 140;
  const ay = 430;
  doc
    .save()
    .lineWidth(1.5)
    .strokeColor(TINTA)
    .rect(ax, ay - 1.5 * 50, 420, 1.5 * 50)
    .stroke()
    .restore();
  doc
    .save()
    .lineWidth(1)
    .strokeColor(TINTA)
    .moveTo(ax - 40, ay)
    .lineTo(ax + 460, ay)
    .stroke()
    .restore();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Cota do passeio', ax + 430, ay + 4);
  cota(doc, ax - 20, ay, ax - 20, ay - 1.5 * 50, '1,50 m');
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA)
    .text(
      'Alçado do muro (lado da via) · reboco pintado de branco',
      ax + 60,
      ay - 50,
    );
  return terminarPdf(doc);
}

function termo(p: ProcessoDemoPerfil, dia: string): Promise<Buffer> {
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
    .text(`Guimarães, ${dia}`)
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

function certidao(p: ProcessoDemoPerfil): Promise<Buffer> {
  const doc = novoPdf('Certidão do registo predial', 'portrait');
  paginaPdf(doc, 'portrait', null, '', carimbo(p));
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
    .text(`Prédio urbano · ${p.morada} · freguesia de ${p.freguesia}`)
    .text(`Titular: ${p.requerente}`)
    .text(
      typeof p.dados.area_lote_m2 === 'number'
        ? `Composição: moradia com logradouro · área total ${String(p.dados.area_lote_m2)} m²`
        : 'Composição: moradia com logradouro',
    )
    .moveDown(1)
    .text('Data da certidão: 1 de outubro de 2026 · válida por 6 meses');
  return terminarPdf(doc);
}

/** Uma peça de uma só folha (planta de localização, levantamento, estabilidade, fotografias). */
function pecaSimples(
  p: ProcessoDemoPerfil,
  titulo: string,
  folha: string,
  linhas: string[],
  desenho: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  const doc = novoPdf(titulo, 'landscape');
  paginaPdf(doc, 'landscape', folha, titulo, carimbo(p));
  tituloFolhaPdf(doc, titulo, linhas[0]);
  for (const l of linhas.slice(1)) {
    doc.font('Helvetica').fontSize(10).fillColor(TINTA).text(l, { width: 520 });
  }
  desenho(doc);
  return terminarPdf(doc);
}

function localizacao(p: ProcessoDemoPerfil) {
  return pecaSimples(
    p,
    'Planta de localização',
    'L1',
    [
      'Extrato da planta de ordenamento do PDM (esquemático)',
      `${p.morada}, ${p.freguesia} · Espaço residencial consolidado`,
    ],
    (doc) => {
      doc.save().lineWidth(0.6).strokeColor(CINZA);
      for (let i = 0; i < 6; i++) doc.rect(100 + i * 90, 160, 70, 60).stroke();
      for (let i = 0; i < 6; i++) doc.rect(100 + i * 90, 290, 70, 60).stroke();
      doc.restore();
      doc.save().fillColor('#E5E7EB').rect(80, 235, 560, 40).fill().restore();
      doc
        .save()
        .lineWidth(2)
        .strokeColor(MARCA)
        .rect(280, 160, 70, 60)
        .stroke()
        .restore();
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(MARCA)
        .text('Local da obra', 282, 140);
    },
  );
}

function levantamento(p: ProcessoDemoPerfil) {
  return pecaSimples(
    p,
    'Levantamento topográfico',
    'T1',
    ['Lote com 300,00 m² (15 × 20 m) · cotas altimétricas esquemáticas'],
    (doc) => {
      doc
        .save()
        .lineWidth(1)
        .strokeColor(TINTA)
        .rect(120, 130, 180, 240)
        .stroke()
        .restore();
      doc.font('Helvetica').fontSize(8).fillColor(CINZA);
      [
        [125, 135, '182,40'],
        [270, 135, '182,55'],
        [125, 355, '181,90'],
        [262, 355, '182,05'],
      ].forEach(([x, y, t]) => doc.text(String(t), Number(x), Number(y)));
    },
  );
}

function estabilidade(p: ProcessoDemoPerfil) {
  const piscina = p.chave === 'piscina';
  return pecaSimples(
    p,
    'Projeto de estabilidade',
    'E1',
    [
      piscina
        ? 'Piscina em betão armado · planta de estruturas (esquemática)'
        : 'Ampliação · planta de fundações e estruturas (esquemática)',
      piscina
        ? 'Laje de fundo e paredes em betão armado C25/30, 0,20 m.'
        : 'Sapatas e vigas de fundação; viga de reforço sobre a abertura na parede posterior.',
    ],
    (doc) => {
      doc
        .save()
        .lineWidth(1.5)
        .strokeColor(TINTA)
        .rect(140, 170, 300, 160)
        .stroke();
      doc.lineWidth(4).moveTo(140, 250).lineTo(440, 250).stroke().restore();
    },
  );
}

function fotografias(p: ProcessoDemoPerfil) {
  return pecaSimples(
    p,
    'Fotografias do existente',
    'F1',
    ['Alçado posterior e logradouro (imagens de demonstração)'],
    (doc) => {
      doc
        .save()
        .fillColor('#E5E7EB')
        .rect(80, 140, 300, 200)
        .fill()
        .rect(420, 140, 300, 200)
        .fill()
        .restore();
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(CINZA)
        .text('Fotografia 1 · alçado posterior', 90, 350)
        .text('Fotografia 2 · logradouro', 430, 350);
    },
  );
}

const GERADORES: Record<string, () => Promise<Buffer>> = {};
for (const p of PROCESSOS_PERFIS) {
  const pasta = p.documentos[0].ficheiro.split('/')[1];
  const dia = p.documentos[1].emitido.split('-').reverse().join('/');
  GERADORES[chave(pasta, 'certidao')] = () => certidao(p);
  GERADORES[chave(pasta, 'termo')] = () => termo(p, dia);
  GERADORES[chave(pasta, 'localizacao')] = () => localizacao(p);
  GERADORES[chave(pasta, 'levantamento')] = () => levantamento(p);
  GERADORES[chave(pasta, 'estabilidade')] = () => estabilidade(p);
  GERADORES[chave(pasta, 'fotografias')] = () => fotografias(p);
}
GERADORES[chave('cp-ampliacao', 'projeto')] = projetoAmpliacao;
GERADORES[chave('cp-piscina', 'projeto')] = projetoPiscina;
GERADORES[chave('cp-muro', 'projeto')] = projetoMuro;

/** O PDF de um destes processos pela chave (null se não é um deles). */
export async function ficheiroProjetoPerfil(
  chaveFicheiro: string,
): Promise<Buffer | null> {
  const g = GERADORES[chaveFicheiro];
  return g ? g() : null;
}
