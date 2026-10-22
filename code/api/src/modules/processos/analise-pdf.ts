/*
 * O que se sabe de um PDF antes de o mandar à IA (V4 · análise de projetos):
 * quantas páginas tem, se tem texto (ou é só a imagem das folhas, como num
 * projeto digitalizado) e se está protegido. Sem bibliotecas: lê a estrutura
 * do ficheiro e abre os fluxos comprimidos (FlateDecode).
 *
 * Serve para três coisas: não passar o limite de páginas de um pedido à IA,
 * avisar a IA (e o técnico) de que um documento é digitalizado e não mandar
 * o que a IA não consegue abrir.
 */
import { inflateSync } from 'node:zlib';

export interface AnalisePdf {
  /** Começa por %PDF-. */
  pdf: boolean;
  /** null se não se conseguiu contar. */
  paginas: number | null;
  /** Há texto nas páginas (fontes e operadores de texto). */
  tem_texto: boolean;
  tem_imagens: boolean;
  /** Protegido por palavra-passe ou cifrado: a IA não o abre. */
  encriptado: boolean;
}

/** Limites para não ficar preso num ficheiro malformado ou enorme. */
const MAX_FLUXOS = 5000;
const MAX_INFLADO = 64 * 1024 * 1024;

/** O texto do PDF com os fluxos comprimidos abertos (latin1: 1 byte = 1 carácter). */
function conteudoAberto(buf: Buffer): string {
  const bruto = buf.toString('latin1');
  const partes = [bruto];
  let total = 0;
  let n = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto)) && n < MAX_FLUXOS && total < MAX_INFLADO) {
    const inicio = m.index + m[0].length;
    const fim = bruto.indexOf('endstream', inicio);
    if (fim < 0) break;
    n++;
    // Só os fluxos comprimidos com Flate (o dicionário vem logo antes).
    const dic = bruto.slice(Math.max(0, m.index - 400), m.index);
    if (/\/FlateDecode/.test(dic.slice(dic.lastIndexOf('<<')))) {
      try {
        const aberto = inflateSync(buf.subarray(inicio, fim), {
          maxOutputLength: MAX_INFLADO - total,
        });
        total += aberto.length;
        partes.push(aberto.toString('latin1'));
      } catch {
        // Fluxo de imagem ou corrompido: ignora-se.
      }
    }
    re.lastIndex = fim;
  }
  return partes.join('\n');
}

export function analisarPdf(buf: Buffer): AnalisePdf {
  const cabeca = buf.subarray(0, 1024).toString('latin1');
  if (!cabeca.includes('%PDF-')) {
    return {
      pdf: false,
      paginas: null,
      tem_texto: false,
      tem_imagens: false,
      encriptado: false,
    };
  }
  const tudo = conteudoAberto(buf);
  const paginas = (tudo.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  let contagem: number | null = paginas || null;
  if (!contagem) {
    // Sem objetos /Page à vista: o /Count da árvore de páginas.
    const counts = [...tudo.matchAll(/\/Count\s+(\d+)/g)].map((x) =>
      Number(x[1]),
    );
    contagem = counts.length ? Math.max(...counts) : null;
  }
  const temFonte = /\/Type\s*\/Font\b|\/Font\s*<</.test(tudo);
  const operadoresTexto =
    /\bBT\b[\s\S]{0,4000}?(\bTj\b|\bTJ\b|\s'\s|\s"\s)/.test(tudo);
  return {
    pdf: true,
    paginas: contagem,
    tem_texto: temFonte && operadoresTexto,
    tem_imagens: /\/Subtype\s*\/Image/.test(tudo),
    encriptado: /\/Encrypt\b/.test(tudo),
  };
}
