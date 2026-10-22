/*
 * Ajudas dos testes da leitura de projetos (não é um teste: o nome acaba em
 * -spec.ts para ficar fora da compilação da API e fora do jest).
 */
import { crc32, deflateSync } from 'node:zlib';
import type { Esperado } from './avaliacao-projetos';
import { Elemento, GRANDEZAS, Grandeza } from './medidas';
import { novoPdf, terminarPdf } from './pdf-demonstracao';
import type { LeituraProjeto } from './verificacoes';

/** Um PNG cinzento de l × a (sem bibliotecas), para simular uma folha digitalizada. */
export function pngCinzento(l: number, a: number): Buffer {
  const bloco = (tipo: string, dados: Buffer) => {
    const t = Buffer.from(tipo, 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0);
  ihdr.writeUInt32BE(a, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 0; // tons de cinzento
  const linhas = Buffer.alloc((l + 1) * a, 0xcc);
  for (let y = 0; y < a; y++) linhas[y * (l + 1)] = 0; // filtro 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(linhas)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/** Um PDF só com imagens (como sai de um digitalizador), com `n` páginas. */
export async function pdfDigitalizado(n: number): Promise<Buffer> {
  const doc = novoPdf('Digitalizado', 'portrait');
  const png = pngCinzento(40, 56);
  for (let i = 0; i < n; i++) {
    doc.addPage({ size: 'A4', margin: 0 });
    doc.image(png, 0, 0, { width: 595 });
  }
  return terminarPdf(doc);
}

export const REF = { documento: 1, pagina: 1, folha: '1' };

/** A leitura que acerta em tudo o que o gabarito diz. */
export function leituraPerfeita(e: Esperado): LeituraProjeto {
  return {
    legivel: true,
    motivo_ilegivel: null,
    fachada_cobertura: {
      alteracoes: e.fachada ?? 'incerto',
      descricao: 'Alçados.',
      referencia: REF,
    },
    paredes: {
      abertura_ou_demolicao: e.paredes ?? 'nao',
      declarada_nao_estrutural: e.parede_nao_estrutural ?? false,
      descricao: 'Paredes.',
      referencia: REF,
    },
    planta_estruturas: { existe: e.estruturas ?? false, referencia: null },
    areas_cerceas: { coerentes: 'sem_dados', descricao: '', referencia: null },
    contradicoes: [],
    medicoes: (Object.entries(e.medicoes) as [Grandeza, number | null][])
      .filter(([, v]) => v !== null)
      .map(([g, v]) => ({
        grandeza: g,
        valor: v!,
        unidade: GRANDEZAS[g].unidade,
        referencia: REF,
      })),
    elementos: Object.entries(e.elementos).map(([el, r]) => ({
      elemento: el as Elemento,
      resposta: r,
      descricao: 'Visto.',
      referencia: REF,
    })),
    tecnico_autor: e.tecnico
      ? {
          nome: e.tecnico.nome,
          ordem: 'OA',
          numero_inscricao: e.tecnico.numero,
          termo_assinado: e.termo_assinado ?? null,
          referencia: { documento: 2, pagina: 1, folha: null },
        }
      : null,
  };
}
