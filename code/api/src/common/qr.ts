// Cópia de code/web/components/chamada/qr.ts (sem dependências): o mesmo gerador serve o QR dos PDFs.
/*
 * Gerador de códigos QR sem dependências (modo byte, correção de erros M,
 * versões 1 a 10: chega para URLs até ~210 caracteres). Segue o algoritmo da
 * norma ISO/IEC 18004, na forma do gerador de referência de Project Nayuki.
 * Devolve a matriz de módulos (true = escuro), sem a margem.
 */

// Correção M, índice = versão (o 0 não se usa).
const ECC_POR_BLOCO = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCOS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const VERSAO_MAX = 10;
const BITS_FORMATO_M = 0;

function modulosDeDados(versao: number): number {
  let r = (16 * versao + 128) * versao + 64;
  if (versao >= 2) {
    const n = Math.floor(versao / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (versao >= 7) r -= 36;
  }
  return r;
}

function codewordsDeDados(versao: number): number {
  return (
    Math.floor(modulosDeDados(versao) / 8) -
    ECC_POR_BLOCO[versao] * BLOCOS[versao]
  );
}

function multiplicar(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisorRs(grau: number): number[] {
  const r = new Array<number>(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplicar(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = multiplicar(raiz, 0x02);
  }
  return r;
}

/** Resto Reed-Solomon (exportado para o teste com o vetor conhecido). */
export function restoRs(dados: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of dados) {
    const fator = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((c, i) => {
      r[i] ^= multiplicar(c, fator);
    });
  }
  return r;
}

export { divisorRs };

function bit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

export function gerarQr(texto: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(texto));

  let versao = 1;
  for (; versao <= VERSAO_MAX; versao++) {
    const bitsContagem = versao <= 9 ? 8 : 16;
    if (4 + bitsContagem + bytes.length * 8 <= codewordsDeDados(versao) * 8)
      break;
  }
  if (versao > VERSAO_MAX) throw new Error('Texto demasiado longo para o QR.');

  // Bits: modo byte, contagem, dados, terminador e enchimento.
  const bits: number[] = [];
  const juntar = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  juntar(0x4, 4);
  juntar(bytes.length, versao <= 9 ? 8 : 16);
  for (const b of bytes) juntar(b, 8);
  const capacidade = codewordsDeDados(versao) * 8;
  juntar(0, Math.min(4, capacidade - bits.length));
  juntar(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < capacidade; p ^= 0xec ^ 0x11) juntar(p, 8);
  const dados: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dados.push(v);
  }

  // Blocos com correção de erros, intercalados.
  const nBlocos = BLOCOS[versao];
  const eccLen = ECC_POR_BLOCO[versao];
  const brutos = Math.floor(modulosDeDados(versao) / 8);
  const nCurtos = nBlocos - (brutos % nBlocos);
  const curto = Math.floor(brutos / nBlocos);
  const divisor = divisorRs(eccLen);
  const blocos: number[][] = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const d = dados.slice(k, k + curto - eccLen + (i < nCurtos ? 0 : 1));
    k += d.length;
    const ecc = restoRs(d, divisor);
    if (i < nCurtos) d.push(0);
    blocos.push(d.concat(ecc));
  }
  const final: number[] = [];
  for (let i = 0; i < blocos[0].length; i++) {
    blocos.forEach((b, j) => {
      if (i !== curto - eccLen || j >= nCurtos) final.push(b[i]);
    });
  }

  const tamanho = versao * 4 + 17;
  const m: boolean[][] = Array.from({ length: tamanho }, () =>
    new Array<boolean>(tamanho).fill(false),
  );
  const funcao: boolean[][] = Array.from({ length: tamanho }, () =>
    new Array<boolean>(tamanho).fill(false),
  );
  const por = (x: number, y: number, escuro: boolean) => {
    m[y][x] = escuro;
    funcao[y][x] = true;
  };

  // Padrões fixos.
  for (let i = 0; i < tamanho; i++) {
    por(6, i, i % 2 === 0);
    por(i, 6, i % 2 === 0);
  }
  const localizador = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < tamanho && yy >= 0 && yy < tamanho)
          por(xx, yy, d !== 2 && d !== 4);
      }
  };
  localizador(3, 3);
  localizador(tamanho - 4, 3);
  localizador(3, tamanho - 4);

  if (versao > 1) {
    const n = Math.floor(versao / 7) + 2;
    const passo = Math.ceil((versao * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = tamanho - 7; pos.length < n; p -= passo) pos.splice(1, 0, p);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === n - 1) ||
          (i === n - 1 && j === 0)
        )
          continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            por(
              pos[i] + dx,
              pos[j] + dy,
              Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
            );
      }
  }

  const formato = (mascara: number) => {
    const d = (BITS_FORMATO_M << 3) | mascara;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) por(8, i, bit(b, i));
    por(8, 7, bit(b, 6));
    por(8, 8, bit(b, 7));
    por(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) por(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) por(tamanho - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) por(8, tamanho - 15 + i, bit(b, i));
    por(8, tamanho - 8, true);
  };
  formato(0);

  if (versao >= 7) {
    let r = versao;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (versao << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = tamanho - 11 + (i % 3);
      const c = Math.floor(i / 3);
      por(a, c, bit(b, i));
      por(c, a, bit(b, i));
    }
  }

  // Dados em ziguezague.
  let i = 0;
  for (let dir = tamanho - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let v = 0; v < tamanho; v++)
      for (let j = 0; j < 2; j++) {
        const x = dir - j;
        const subir = ((dir + 1) & 2) === 0;
        const y = subir ? tamanho - 1 - v : v;
        if (!funcao[y][x] && i < final.length * 8) {
          m[y][x] = bit(final[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
  }

  const inverte = (mascara: number, x: number, y: number) => {
    switch (mascara) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const aplicar = (mascara: number) => {
    for (let y = 0; y < tamanho; y++)
      for (let x = 0; x < tamanho; x++)
        if (!funcao[y][x] && inverte(mascara, x, y)) m[y][x] = !m[y][x];
  };

  // Penalização simplificada (sequências, blocos 2x2 e equilíbrio): qualquer
  // máscara é válida, esta só escolhe a mais fácil de ler.
  const penalizacao = () => {
    let p = 0;
    for (let a = 0; a < tamanho; a++) {
      let corH = false;
      let corV = false;
      let runH = 0;
      let runV = 0;
      for (let b = 0; b < tamanho; b++) {
        if (m[a][b] === corH) runH++;
        else {
          if (runH >= 5) p += runH - 2;
          corH = m[a][b];
          runH = 1;
        }
        if (m[b][a] === corV) runV++;
        else {
          if (runV >= 5) p += runV - 2;
          corV = m[b][a];
          runV = 1;
        }
      }
      if (runH >= 5) p += runH - 2;
      if (runV >= 5) p += runV - 2;
    }
    let escuros = 0;
    for (let y = 0; y < tamanho; y++)
      for (let x = 0; x < tamanho; x++) {
        if (m[y][x]) escuros++;
        if (
          x < tamanho - 1 &&
          y < tamanho - 1 &&
          m[y][x] === m[y][x + 1] &&
          m[y][x] === m[y + 1][x] &&
          m[y][x] === m[y + 1][x + 1]
        )
          p += 3;
      }
    const total = tamanho * tamanho;
    p += (Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1) * 10;
    return p;
  };

  let melhor = 0;
  let menor = Infinity;
  for (let k = 0; k < 8; k++) {
    aplicar(k);
    formato(k);
    const p = penalizacao();
    if (p < menor) {
      menor = p;
      melhor = k;
    }
    aplicar(k); // desfaz (XOR)
  }
  aplicar(melhor);
  formato(melhor);
  return m;
}
