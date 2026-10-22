import { deflateSync } from 'zlib';

/*
 * Fotografias das ocorrências de demonstração: ilustrações geradas aqui
 * (PNG, sem dependências), com uma faixa "IMAGEM DE DEMONSTRACAO" escrita
 * por baixo. Não fingem ser fotografias reais.
 */

export type ImagemDemo = 'buraco' | 'candeeiro' | 'contentor';

const LARGURA = 480;
const ALTURA = 320;
const FAIXA = 40;

type Cor = readonly [number, number, number];

/** Letras 5×7 (só as precisas), linha a linha, bit 4 = coluna da esquerda. */
const LETRAS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

/** Pseudo-aleatório determinístico (a mesma imagem sempre). */
function ruido(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function misturar(a: Cor, b: Cor, t: number): Cor {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function pixel(tipo: ImagemDemo, x: number, y: number): Cor {
  const n = ruido(x, y) * 26 - 13;
  const grao = (c: Cor): Cor => [
    Math.max(0, Math.min(255, c[0] + n)),
    Math.max(0, Math.min(255, c[1] + n)),
    Math.max(0, Math.min(255, c[2] + n)),
  ];
  if (tipo === 'buraco') {
    // Alcatrão, uma risca branca tracejada e o buraco (elipse irregular).
    const dx = (x - 250) / 120;
    const dy = (y - 170) / 62;
    const irregular = 1 + 0.12 * Math.sin(Math.atan2(dy, dx) * 5);
    const d = Math.sqrt(dx * dx + dy * dy) / irregular;
    if (d < 0.82) return grao(misturar([38, 34, 32], [70, 64, 58], d));
    if (d < 1) return grao([128, 120, 110]);
    if (y > 58 && y < 70 && x % 90 < 55) return grao([226, 222, 210]);
    return grao([92, 92, 96]);
  }
  if (tipo === 'candeeiro') {
    // Noite, um poste e a lâmpada apagada.
    const ceu = misturar([20, 28, 52], [44, 52, 84], y / ALTURA);
    if (x > 232 && x < 244 && y > 90) return grao([58, 60, 66]);
    if (y > 70 && y < 96 && x > 200 && x < 290) return grao([72, 74, 80]);
    const dl = Math.hypot(x - 245, y - 100);
    if (dl < 16) return grao([96, 92, 80]);
    if (y > 250) return grao([40, 40, 44]);
    return grao(ceu);
  }
  // Contentor verde num passeio.
  if (x > 140 && x < 340 && y > 110 && y < 250) {
    if (y < 130) return grao([24, 92, 54]);
    return grao(x % 40 < 3 ? [30, 100, 60] : [40, 128, 76]);
  }
  if (y > 250) return grao([170, 166, 156]);
  return grao([200, 210, 216]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const t = Buffer.from(tipo, 'ascii');
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([tam, t, dados, crc]);
}

/** A ilustração em PNG (480×320), com a faixa de demonstração. */
export function pngDemonstracao(tipo: ImagemDemo): Buffer {
  const linha = 1 + LARGURA * 3;
  const raw = Buffer.alloc(linha * ALTURA);
  const texto = 'IMAGEM DE DEMONSTRACAO';
  const escala = 3;
  const larguraTexto = texto.length * 6 * escala;
  const x0 = Math.round((LARGURA - larguraTexto) / 2);
  const y0 = ALTURA - FAIXA + Math.round((FAIXA - 7 * escala) / 2);
  for (let y = 0; y < ALTURA; y++) {
    raw[y * linha] = 0; // filtro "nenhum"
    for (let x = 0; x < LARGURA; x++) {
      let c: Cor;
      if (y >= ALTURA - FAIXA) {
        c = [196, 92, 60]; // terracota
        const lx = Math.floor((x - x0) / escala);
        const ly = Math.floor((y - y0) / escala);
        if (lx >= 0 && ly >= 0 && ly < 7 && lx < texto.length * 6) {
          const g = LETRAS[texto[Math.floor(lx / 6)]] ?? LETRAS[' '];
          const col = lx % 6;
          if (col < 5 && g[ly] & (0x10 >> col)) c = [255, 255, 255];
        }
      } else {
        c = pixel(tipo, x, y);
      }
      const i = y * linha + 1 + x * 3;
      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(LARGURA, 0);
  ihdr.writeUInt32BE(ALTURA, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(raw)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}
