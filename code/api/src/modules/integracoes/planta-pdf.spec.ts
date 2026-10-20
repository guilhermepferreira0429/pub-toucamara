import { crc32, deflateSync } from 'zlib';
import { grelhaMosaicos } from './mapa.js';
import {
  ATRIBUICAO_OSM,
  escalaPlanta,
  gerarPdfPlanta,
  textosPlanta,
} from './planta-pdf.js';

/**
 * PNG 256×256 com paleta de 1 bit, como os mosaicos do OSM em zonas vazias
 * (confirmado num pedido real: "PNG image data, 256 x 256, 1-bit colormap").
 */
function pngPaleta(): Buffer {
  const bloco = (tipo: string, dados: Buffer) => {
    const t = Buffer.from(tipo, 'ascii');
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0);
  ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 1; // bits
  ihdr[9] = 3; // paleta
  // Cada linha: filtro 0 + 32 bytes (256 px a 1 bit), em xadrez.
  const linhas = Buffer.alloc(256 * 33);
  for (let y = 0; y < 256; y++) {
    linhas.fill(y % 2 ? 0xaa : 0x55, y * 33 + 1, (y + 1) * 33);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('PLTE', Buffer.from([0xf2, 0xef, 0xe9, 0x11, 0x0a, 0x2f])),
    bloco('IDAT', deflateSync(linhas)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

const grelha = grelhaMosaicos(41.4479, -8.2902, 17);
const dados = {
  municipio: 'Município de Teste',
  numeroProcesso: 'CP 412/2026',
  assunto: 'Porta na fachada',
  morada: 'Rua de Santa Maria, 12',
  freguesia: 'Oliveira',
  lat: 41.4479,
  lng: -8.2902,
  geocodificada: true,
  data: '2026-10-20',
  grelha,
};

describe('textosPlanta', () => {
  it('cabeçalho com processo, morada, coordenadas, escala e data', () => {
    const { cabecalho } = textosPlanta(dados);
    expect(cabecalho).toEqual([
      'Processo n.º CP 412/2026 · Porta na fachada',
      'Morada: Rua de Santa Maria, 12 · Freguesia: Oliveira',
      'Coordenadas (WGS84): 41,447900° N, 8,290200° O',
      expect.stringMatching(/^Escala aproximada 1:2 [0-9]00 \(impressa em A4/),
      'Data: 20/10/2026',
    ]);
  });

  it('atribuição do OpenStreetMap sempre; aviso da geocodificação só quando houve', () => {
    const com = textosPlanta(dados).rodape;
    expect(com[0]).toContain(ATRIBUICAO_OSM);
    expect(com.join(' ')).toContain('confirmar no local');
    const sem = textosPlanta({ ...dados, geocodificada: false }).rodape;
    expect(sem[0]).toContain(ATRIBUICAO_OSM);
    expect(sem.join(' ')).not.toContain('confirmar no local');
  });

  it('sem morada diz que não há', () => {
    expect(
      textosPlanta({ ...dados, morada: null, freguesia: null }).cabecalho[1],
    ).toBe('Morada: sem morada no processo');
  });
});

describe('escalaPlanta', () => {
  it('janela de 512 px na largura útil do A4 (~1 pt por pixel)', () => {
    const e = escalaPlanta(dados);
    expect(e.janela.lado).toBe(512);
    expect(e.pontosPorPixel).toBeCloseTo(515.28 / 512, 6);
    // Zoom 17 em Guimarães: ~0,89 m por pixel → ~1:2 500.
    expect(e.denominador).toBeGreaterThanOrEqual(2400);
    expect(e.denominador).toBeLessThanOrEqual(2600);
    expect(e.barra.pontos).toBeLessThanOrEqual(515.28 / 4);
    expect(e.barra.rotulo).toBe('100 m');
  });
});

describe('gerarPdfPlanta', () => {
  it('gera um PDF de uma página com os 9 mosaicos (PNG de paleta, como os do OSM)', async () => {
    const png = pngPaleta();
    const pdf = await gerarPdfPlanta({
      ...dados,
      mosaicos: grelha.mosaicos.map(() => png),
    });
    const texto = pdf.toString('latin1');
    expect(texto.startsWith('%PDF-')).toBe(true);
    expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(texto.match(/\/Type \/Page\b/g)).toHaveLength(1);
    // O mesmo PNG nove vezes: o pdfkit embute-o uma vez por chamada.
    expect(texto.match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('falha (rejeita) se um mosaico não for uma imagem', async () => {
    await expect(
      gerarPdfPlanta({
        ...dados,
        mosaicos: grelha.mosaicos.map(() => Buffer.from('não é png')),
      }),
    ).rejects.toThrow();
  });
});
