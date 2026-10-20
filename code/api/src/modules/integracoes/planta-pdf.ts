import PDFDocument from 'pdfkit';
import {
  barraEscala,
  denominadorEscala,
  formatarCoordenadas,
  Grelha,
  janelaCentrada,
  metrosPorPixel,
  rotuloEscala,
  TAMANHO_MOSAICO,
} from './mapa.js';

/** A atribuição que a licença do OpenStreetMap (ODbL) obriga a mostrar. */
export const ATRIBUICAO_OSM = '© contribuidores do OpenStreetMap';

export interface DadosPlanta {
  municipio: string;
  numeroProcesso: string;
  assunto: string;
  morada: string | null;
  freguesia: string | null;
  lat: number;
  lng: number;
  /** As coordenadas vieram da morada agora (e não do processo). */
  geocodificada: boolean;
  /** 'AAAA-MM-DD'. */
  data: string;
  grelha: Grelha;
  /** PNG de cada mosaico, pela ordem de `grelha.mosaicos`. */
  mosaicos: Buffer[];
}

const MARGEM = 40;
const LARGURA_A4 = 595.28;
const LADO_MAPA = LARGURA_A4 - 2 * MARGEM;

/** Escala da planta impressa: o mapa ocupa a largura útil do A4. */
export function escalaPlanta(d: Pick<DadosPlanta, 'lat' | 'grelha'>) {
  const janela = janelaCentrada(d.grelha);
  const pontosPorPixel = LADO_MAPA / janela.lado;
  const metrosPorPonto = metrosPorPixel(d.lat, d.grelha.zoom) / pontosPorPixel;
  return {
    janela,
    pontosPorPixel,
    metrosPorPonto,
    denominador: denominadorEscala(metrosPorPonto),
    barra: barraEscala(metrosPorPonto, LADO_MAPA / 4),
  };
}

/** Os textos da planta (cabeçalho e rodapé), à parte para se testarem. */
export function textosPlanta(d: Omit<DadosPlanta, 'mosaicos'>) {
  const { denominador } = escalaPlanta(d);
  const cabecalho = [
    `Processo n.º ${d.numeroProcesso} · ${d.assunto}`,
    `Morada: ${d.morada ?? 'sem morada no processo'}${d.freguesia ? ` · Freguesia: ${d.freguesia}` : ''}`,
    `Coordenadas (WGS84): ${formatarCoordenadas(d.lat, d.lng)}`,
    `Escala aproximada ${rotuloEscala(denominador)} (impressa em A4, sem ajustar à página)`,
    `Data: ${d.data.split('-').reverse().join('/')}`,
  ];
  const rodape = [
    `Mapa: ${ATRIBUICAO_OSM} (openstreetmap.org/copyright), dados disponíveis sob a licença ODbL.`,
    ...(d.geocodificada
      ? [
          'A localização foi obtida a partir da morada (Nominatim, OpenStreetMap): confirmar no local.',
        ]
      : []),
    'Planta gerada automaticamente pelo Tou, Câmara? para identificar o local. Não substitui levantamento topográfico nem cartografia oficial.',
  ];
  return { cabecalho, rodape };
}

/**
 * Planta de localização em A4: cabeçalho do município, n.º do processo,
 * morada, coordenadas, o mapa (3×3 mosaicos, recortado a uma janela com o
 * ponto ao centro) com o marcador, a barra de escala, o norte e a
 * atribuição do OpenStreetMap — no mapa e por baixo dele.
 */
export function gerarPdfPlanta(d: DadosPlanta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGEM,
      info: {
        Title: `Planta de localização · processo ${d.numeroProcesso}`,
        Author: d.municipio,
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const { cabecalho, rodape } = textosPlanta(d);
    const { janela, pontosPorPixel, barra } = escalaPlanta(d);

    doc.font('Helvetica-Bold').fontSize(13).text(d.municipio);
    doc.moveDown(0.2).fontSize(16).text('Planta de localização');
    doc.moveDown(0.3).font('Helvetica').fontSize(9.5).fillColor('#333');
    for (const linha of cabecalho) doc.text(linha);
    doc.fillColor('#000');

    // --- o mapa ---
    const mx = MARGEM;
    const my = doc.y + 12;
    const s = pontosPorPixel;
    const lado = TAMANHO_MOSAICO * s;
    doc.save();
    doc.rect(mx, my, LADO_MAPA, LADO_MAPA).clip();
    d.grelha.mosaicos.forEach((m, i) => {
      doc.image(
        d.mosaicos[i],
        mx + (m.coluna * TAMANHO_MOSAICO - janela.x) * s,
        my + (m.linha * TAMANHO_MOSAICO - janela.y) * s,
        { width: lado, height: lado },
      );
    });
    doc.restore();
    doc.lineWidth(0.8).rect(mx, my, LADO_MAPA, LADO_MAPA).stroke('#333');

    // Marcador: anel, ponto vermelho com contorno branco e centro.
    const px = mx + janela.marcador.x * s;
    const py = my + janela.marcador.y * s;
    doc.lineWidth(1.5).circle(px, py, 16).stroke('#d00000');
    doc.lineWidth(2).circle(px, py, 6).fillAndStroke('#d00000', '#ffffff');
    doc.circle(px, py, 1.6).fill('#ffffff');

    // Norte, no canto superior direito.
    const nx = mx + LADO_MAPA - 34;
    const ny = my + 10;
    doc.rect(nx, ny, 24, 36).fillOpacity(0.85).fill('#ffffff');
    doc.fillOpacity(1);
    doc
      .moveTo(nx + 12, ny + 4)
      .lineTo(nx + 19, ny + 22)
      .lineTo(nx + 12, ny + 18)
      .lineTo(nx + 5, ny + 22)
      .closePath()
      .fill('#000000');
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#000')
      .text('N', nx, ny + 24, { width: 24, align: 'center', lineBreak: false });

    // Barra de escala, no canto inferior esquerdo.
    const bx = mx + 10;
    const by = my + LADO_MAPA - 26;
    doc
      .rect(bx - 4, by - 12, barra.pontos + 8, 26)
      .fillOpacity(0.85)
      .fill('#ffffff');
    doc.fillOpacity(1);
    doc.rect(bx, by + 4, barra.pontos / 2, 5).fill('#000000');
    doc
      .rect(bx + barra.pontos / 2, by + 4, barra.pontos / 2, 5)
      .fill('#ffffff');
    doc
      .lineWidth(0.6)
      .rect(bx, by + 4, barra.pontos, 5)
      .stroke('#000000');
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#000')
      .text('0', bx - 2, by - 9, { lineBreak: false })
      .text(barra.rotulo, bx + barra.pontos - 20, by - 9, {
        width: 40,
        align: 'center',
        lineBreak: false,
      });

    // Atribuição no próprio mapa (canto inferior direito).
    doc.font('Helvetica').fontSize(7);
    const largura = doc.widthOfString(ATRIBUICAO_OSM) + 8;
    const ax = mx + LADO_MAPA - largura;
    const ay = my + LADO_MAPA - 12;
    doc.rect(ax, ay, largura, 12).fillOpacity(0.85).fill('#ffffff');
    doc.fillOpacity(1);
    doc
      .fillColor('#000')
      .text(ATRIBUICAO_OSM, ax + 4, ay + 3, { lineBreak: false });

    // --- rodapé ---
    doc.x = MARGEM;
    doc.y = my + LADO_MAPA + 10;
    doc.font('Helvetica').fontSize(8).fillColor('#555');
    for (const linha of rodape) {
      doc.text(linha, { width: LADO_MAPA });
      doc.moveDown(0.2);
    }
    doc.end();
  });
}
