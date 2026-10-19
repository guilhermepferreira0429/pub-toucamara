/*
 * CSV `pergunta;resposta` das respostas recolhidas à mão (sistemas manuais).
 * Puro. Separador `;` (o do Excel em português), campos entre aspas podem ter
 * `;`, quebras de linha e aspas duplicadas (`""`). Aceita BOM e CRLF.
 */

export interface LinhaCsv {
  /** Número da linha (1 = primeira) onde o registo começa, para os erros. */
  linha: number;
  campos: string[];
}

export function lerCsv(texto: string, separador = ';'): LinhaCsv[] {
  const s = texto.replace(/^﻿/, '');
  const linhas: LinhaCsv[] = [];
  let campos: string[] = [];
  let campo = '';
  let aspas = false;
  let linha = 1;
  let inicio = 1;
  let i = 0;

  const fecharRegisto = () => {
    campos.push(campo);
    // Linhas em branco não contam.
    if (campos.length > 1 || campos[0].trim() !== '')
      linhas.push({ linha: inicio, campos });
    campos = [];
    campo = '';
  };

  while (i < s.length) {
    const c = s[i];
    if (aspas) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        aspas = false;
        i++;
        continue;
      }
      if (c === '\n') linha++;
      if (c === '\r' && s[i + 1] === '\n') {
        // CRLF dentro de aspas: guarda-se só \n.
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }
    if (c === '"' && campo.trim() === '') {
      // Aspas só abrem um campo no início dele (espaços antes toleram-se).
      campo = '';
      aspas = true;
      i++;
      continue;
    }
    if (c === separador) {
      campos.push(campo);
      campo = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      fecharRegisto();
      if (c === '\r' && s[i + 1] === '\n') i++;
      i++;
      linha++;
      inicio = linha;
      continue;
    }
    campo += c;
    i++;
  }
  if (aspas)
    throw new Error(`CSV: aspas por fechar no registo da linha ${inicio}.`);
  if (campo !== '' || campos.length > 0) fecharRegisto();
  return linhas;
}

export interface RespostaCsv {
  linha: number;
  /** Nº de ordem da pergunta, ou null se veio pelo texto. */
  ordem: number | null;
  /** Texto da pergunta (quando não veio pelo número). */
  pergunta: string;
  resposta: string;
}

/**
 * Registos → pares pergunta/resposta. A primeira linha é cabeçalho se a
 * primeira coluna disser "pergunta". Mais de duas colunas: o resto junta-se à
 * resposta (um `;` esquecido sem aspas não deve perder texto).
 */
export function respostasDoCsv(texto: string): RespostaCsv[] {
  const registos = lerCsv(texto);
  if (registos[0] && /^\s*pergunta\s*$/i.test(registos[0].campos[0]))
    registos.shift();
  return registos.map(({ linha, campos }) => {
    if (campos.length < 2)
      throw new Error(
        `CSV linha ${linha}: falta a resposta (pergunta;resposta).`,
      );
    const p = campos[0].trim();
    return {
      linha,
      ordem: /^\d+$/.test(p) ? parseInt(p, 10) : null,
      pergunta: p,
      resposta: campos.slice(1).join(';').trim(),
    };
  });
}
