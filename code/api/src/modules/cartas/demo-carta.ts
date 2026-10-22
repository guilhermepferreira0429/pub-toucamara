import PDFDocument from 'pdfkit';
import type { LeituraCarta } from './regras.js';

/*
 * A carta de demonstração: uma "Notificação para audiência prévia" do
 * processo "Porta na cozinha" (CP 412), gerada aqui em PDF, e a leitura que
 * lhe corresponde. Sem IA (ANTHROPIC_API_KEY vazia), uma carta com a marca
 * MARCA_DEMO nos bytes (este PDF, ou a fotografia simulada da web em
 * /demo/carta-fotografada.jpg) usa esta leitura, marcada como de
 * demonstração. Com IA, lê-se como qualquer outra.
 */

/** Vai nos metadados do PDF e no comentário do JPEG de demonstração. */
export const MARCA_DEMO = 'toucamara-demo-carta-audiencia-previa';

export function temMarcaDemo(b: Buffer): boolean {
  return b.includes(Buffer.from(MARCA_DEMO, 'latin1'));
}

export interface DadosCartaDemo {
  municipio: string;
  numeroProcesso: string;
  assunto: string;
  /** 'AAAA-MM-DD'. */
  data: string;
  destinataria: string;
  morada: string;
}

function dataPt(iso: string): string {
  return iso.split('-').reverse().join('/');
}

export function gerarPdfCartaDemo(d: DadosCartaDemo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 60,
      info: {
        Title: `Notificação para audiência prévia · ${d.numeroProcesso}`,
        Author: `Câmara Municipal de ${d.municipio}`,
        Keywords: MARCA_DEMO,
        Subject: 'Documento de demonstração, sem valor legal',
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(`CÂMARA MUNICIPAL DE ${d.municipio.toUpperCase()}`);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555')
      .text('Departamento de Urbanismo · Divisão de Obras Particulares')
      .fillColor('#000');
    doc.moveDown(1.2).fontSize(10);
    doc.text(`Exma. Senhora`, { align: 'right' });
    doc.text(d.destinataria, { align: 'right' });
    doc.text(d.morada, { align: 'right' });
    doc.moveDown(1);
    doc.fontSize(9).text(`Ofício n.º OP-DEMO/1187 · Data: ${dataPt(d.data)}`);
    doc.text(`Sua referência: Processo n.º ${d.numeroProcesso}`);
    doc.moveDown(0.8);
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(
        `ASSUNTO: Processo n.º ${d.numeroProcesso} — Comunicação prévia · obras de alteração — "${d.assunto}". NOTIFICAÇÃO PARA AUDIÊNCIA PRÉVIA`,
      );
    doc.moveDown(0.8).font('Helvetica').fontSize(10.5);
    const paragrafos = [
      'Fica V. Ex.ª notificada, nos termos e para os efeitos dos artigos 121.º e 122.º do Código do Procedimento Administrativo, de que é intenção desta Câmara Municipal rejeitar a comunicação prévia acima referida, com os seguintes fundamentos:',
      'a) O projeto prevê a abertura de um vão na parede entre a cozinha e a sala sem que tenha sido junta a planta de estruturas, ou declaração do técnico autor que confirme que a parede não tem função estrutural;',
      'b) Sem esse elemento não é possível confirmar que a obra está isenta de alterações à estrutura de estabilidade do edifício.',
      'Pode V. Ex.ª, querendo, pronunciar-se por escrito sobre o sentido provável da decisão, no prazo de 10 (dez) dias úteis a contar da data da receção da presente notificação, podendo juntar os elementos que entenda convenientes, nomeadamente a planta de estruturas ou a declaração do técnico autor.',
      'Findo o prazo sem que se pronuncie, a comunicação prévia será rejeitada, nos termos propostos.',
      'Com os melhores cumprimentos,',
      'O Vereador do Urbanismo (por delegação)',
    ];
    for (const p of paragrafos) {
      doc.text(p, { align: 'justify', lineGap: 2 });
      doc.moveDown(0.6);
    }
    doc
      .moveDown(1.5)
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#b00')
      .text(
        'DOCUMENTO DE DEMONSTRAÇÃO — gerado pelo Tou, Câmara? — SEM VALOR LEGAL.',
      )
      .fillColor('#000');
    doc.end();
  });
}

/** A leitura da carta de demonstração (o que a IA leria dela). */
export function leituraDemo(d: {
  numeroProcesso: string;
  assunto: string;
  data: string;
  municipio: string;
}): LeituraCarta {
  return {
    legivel: true,
    motivo_ilegivel: null,
    entidade_emissora: `Câmara Municipal de ${d.municipio}`,
    tipo_entidade: 'camara',
    tipo: 'audiencia_previa',
    assunto: d.assunto,
    referencia: {
      valor: d.numeroProcesso,
      excerto: `Sua referência: Processo n.º ${d.numeroProcesso}`,
    },
    data_documento: {
      valor: d.data,
      excerto: `Ofício n.º OP-DEMO/1187 · Data: ${dataPt(d.data)}`,
    },
    data_notificacao: { valor: null, excerto: null },
    prazo: {
      dias: 10,
      unidade: 'uteis',
      data_limite_escrita: null,
      a_contar_de: 'notificacao',
      base_legal:
        'artigos 121.º e 122.º do Código do Procedimento Administrativo',
      excerto:
        'no prazo de 10 (dez) dias úteis a contar da data da receção da presente notificação',
    },
    pedido: [
      {
        o_que:
          'Se não concordar, responder por escrito a explicar porquê, e juntar a planta de estruturas ou a declaração do técnico autor a dizer que a parede não tem função estrutural.',
        excerto:
          'podendo juntar os elementos que entenda convenientes, nomeadamente a planta de estruturas ou a declaração do técnico autor',
      },
    ],
    valores: [],
    consequencias: [
      {
        texto:
          'Se não responder até ao fim do prazo, a câmara rejeita o pedido da obra.',
        excerto:
          'Findo o prazo sem que se pronuncie, a comunicação prévia será rejeitada, nos termos propostos.',
      },
    ],
    explicacao:
      'A câmara está a pensar recusar o pedido da obra da porta na cozinha, porque falta um papel que prove que a parede que vai abrir não segura o prédio. Antes de decidir, dá-lhe 10 dias úteis para responder por escrito ou enviar esse papel (a planta de estruturas ou uma declaração do técnico que fez o projeto).',
  };
}
