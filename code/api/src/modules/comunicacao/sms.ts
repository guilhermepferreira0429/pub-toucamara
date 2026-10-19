/*
 * Codificação dos SMS (secção 9 do plano). Um só carácter fora do alfabeto
 * GSM-7 (ã, õ, ç, á, ó, ú, í, ê, â...) passa a mensagem toda a UCS-2: 70
 * caracteres por parte em vez de 160.
 */

const GSM7_BASICO =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
// Ocupam 2 posições (escape).
const GSM7_EXTENSAO = '^{}\\[~]|€\f';

const BASICO = new Set(GSM7_BASICO);
const EXTENSAO = new Set(GSM7_EXTENSAO);

export type Codificacao = 'gsm7' | 'ucs2';

export interface InfoSms {
  codificacao: Codificacao;
  caracteres: number;
  segmentos: number;
}

export function infoSms(texto: string): InfoSms {
  let unidades = 0;
  for (const c of texto) {
    if (BASICO.has(c)) unidades += 1;
    else if (EXTENSAO.has(c)) unidades += 2;
    else {
      // UCS-2: conta em unidades UTF-16 (emoji = 2).
      const caracteres = texto.length;
      return {
        codificacao: 'ucs2',
        caracteres,
        segmentos: caracteres <= 70 ? 1 : Math.ceil(caracteres / 67),
      };
    }
  }
  return {
    codificacao: 'gsm7',
    caracteres: unidades,
    segmentos: unidades <= 160 ? 1 : Math.ceil(unidades / 153),
  };
}

/** 'Câmara Municipal – não' → 'Camara Municipal - nao' (o que couber em GSM-7). */
export function transliterar(texto: string): string {
  return [...texto.normalize('NFC')]
    .map((c) => {
      if (BASICO.has(c) || EXTENSAO.has(c)) return c;
      const especiais: Record<string, string> = {
        '–': '-',
        '—': '-',
        '‘': "'",
        '’': "'",
        '“': '"',
        '”': '"',
        '…': '...',
        '•': '-',
        º: 'o',
        ª: 'a',
      };
      if (especiais[c]) return especiais[c];
      const base = c.normalize('NFD').replace(/\p{M}/gu, '');
      return [...base].every((b) => BASICO.has(b)) ? base : '?';
    })
    .join('');
}
