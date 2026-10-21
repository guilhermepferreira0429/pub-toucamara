import { nifValido } from '../municipes/municipes.service.js';
import type { ProcedimentoRegisto, TipoContrato } from './config.js';

/*
 * Importação do registo de contratos a partir de um CSV exportado do portal
 * BASE (ou de uma folha com as mesmas colunas). Puro, para testar à parte.
 *
 * Colunas reconhecidas (sem acentos nem maiúsculas, várias grafias):
 * adjudicante, adjudicatário (nome e NIF juntos, "Empresa, Lda (501234567)",
 * ou em colunas separadas), objeto, CPV, preço contratual, data de
 * celebração (ou de publicação), tipo de procedimento e tipo de contrato
 * (se faltar, deduz-se do CPV: divisão 45 é obra, 50 a 98 serviços, o resto
 * bens).
 */

export interface LinhaContrato {
  adjudicante: string | null;
  adjudicatario_nif: string;
  adjudicatario_nome: string | null;
  objeto: string;
  cpv: string | null;
  tipo: TipoContrato;
  preco_contratual_cent: number;
  data_contrato: string;
  procedimento: ProcedimentoRegisto;
  procedimento_original: string | null;
}

export interface ErroLinha {
  linha: number;
  motivo: string;
}

export interface ResultadoCsv {
  linhas: (LinhaContrato & { linha: number })[];
  erros: ErroLinha[];
  colunas_desconhecidas: string[];
}

type Campo =
  | 'adjudicante'
  | 'adjudicatario'
  | 'adjudicatario_nif'
  | 'adjudicatario_nome'
  | 'objeto'
  | 'cpv'
  | 'preco'
  | 'data_celebracao'
  | 'data_publicacao'
  | 'procedimento'
  | 'tipo';

const ALIASES: Record<Campo, string[]> = {
  adjudicante: [
    'entidade(s) adjudicante(s)',
    'entidades adjudicantes',
    'entidade adjudicante',
    'adjudicante',
    'adjudicantes',
  ],
  adjudicatario: [
    'entidade(s) adjudicataria(s)',
    'entidades adjudicatarias',
    'entidade adjudicataria',
    'adjudicatario',
    'adjudicatarios',
    'adjudicataria',
  ],
  adjudicatario_nif: [
    'nif adjudicatario',
    'nif do adjudicatario',
    'adjudicatario nif',
    'nif',
  ],
  adjudicatario_nome: [
    'nome adjudicatario',
    'nome do adjudicatario',
    'adjudicatario nome',
  ],
  objeto: [
    'objeto do contrato',
    'objecto do contrato',
    'objeto',
    'objecto',
    'descricao',
  ],
  cpv: ['cpv', 'codigo cpv'],
  preco: [
    'preco contratual',
    'preco contratual (eur)',
    'preco',
    'valor',
    'valor contratual',
  ],
  data_celebracao: [
    'data de celebracao do contrato',
    'data de celebracao',
    'data celebracao',
    'data do contrato',
    'data',
  ],
  data_publicacao: ['data de publicacao', 'data publicacao'],
  procedimento: ['tipo de procedimento', 'procedimento', 'tipo procedimento'],
  tipo: [
    'tipo(s) de contrato',
    'tipos de contrato',
    'tipo de contrato',
    'tipo contrato',
  ],
};

export function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/** Escolhe o separador pela primeira linha: ';' (o do BASE), ',' ou tab. */
function separadorDe(texto: string): string {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  let melhor = ';';
  let max = -1;
  for (const s of [';', ',', '\t']) {
    let n = 0;
    let aspas = false;
    for (const ch of primeira) {
      if (ch === '"') aspas = !aspas;
      else if (!aspas && ch === s) n++;
    }
    if (n > max) {
      max = n;
      melhor = s;
    }
  }
  return melhor;
}

/** CSV (RFC 4180): aspas, aspas dobradas e quebras de linha dentro de aspas. */
export function lerCsv(texto: string, separador?: string): string[][] {
  const s = separador ?? separadorDe(texto);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  const t = texto.replace(/^\ufeff/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') {
      aspas = true;
    } else if (ch === s) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += ch;
  }
  if (campo !== '' || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim() !== ''));
}

/** "12.345,67 €", "12345.67", "12 345,67" → cêntimos. */
export function lerPreco(texto: string): number | null {
  let t = texto.replace(/[€\s]|EUR/gi, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) {
    t =
      t.lastIndexOf(',') > t.lastIndexOf('.')
        ? t.replace(/\./g, '').replace(',', '.')
        : t.replace(/,/g, '');
  } else if (t.includes(',')) {
    t = /^\d{1,3}(,\d{3})+$/.test(t)
      ? t.replace(/,/g, '')
      : t.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Math.round(Number(t) * 100);
  return Number.isFinite(v) ? v : null;
}

/** "31-12-2026", "31/12/2026", "2026-12-31" (com ou sem horas) → '2026-12-31'. */
export function lerData(texto: string): string | null {
  const t = texto.trim();
  let a: string, m: string, d: string;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) [, a, m, d] = r;
  else {
    r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
    if (!r) return null;
    [, d, m, a] = r;
  }
  const iso = `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

/** O NIF dentro do texto do adjudicatário ("Empresa (501234567)", "PT501234567 - Empresa"). */
export function separarAdjudicatario(texto: string): {
  nif: string | null;
  nome: string | null;
} {
  // Consórcios: fica o primeiro (o BASE separa por " | " ou quebra de linha).
  const primeiro = texto.split(/\s*\|\s*|\r?\n/)[0] ?? '';
  const r = /(?:PT)?(\d{9})(?!\d)/i.exec(
    primeiro.replace(/(\d)\s(?=\d)/g, '$1'),
  );
  const nif = r ? r[1] : null;
  const nome = primeiro
    .replace(/\(?\s*(?:PT)?\d{9}\s*\)?/i, '')
    .replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '')
    .trim();
  return { nif, nome: nome || null };
}

export function procedimentoDe(texto: string): ProcedimentoRegisto {
  const t = normalizar(texto).replace(/directo/g, 'direto');
  if (/ajuste direto.*simplificado|simplificado/.test(t))
    return 'ajuste_direto_simplificado';
  if (/ajuste direto/.test(t)) return 'ajuste_direto';
  if (/consulta previa/.test(t)) return 'consulta_previa';
  if (/concurso publico/.test(t)) return 'concurso_publico';
  return 'outro';
}

/** Tipo de contrato pelo texto do BASE, ou pelo CPV. */
export function tipoDe(
  texto: string | null,
  cpv: string | null,
): TipoContrato | null {
  const t = normalizar(texto ?? '');
  if (/empreitada|obras? publicas?/.test(t)) return 'empreitada';
  if (/servico/.test(t)) return 'servicos';
  if (/bens|fornecimento|locacao/.test(t)) return 'bens';
  const d = (cpv ?? '').replace(/\D/g, '');
  if (d.length >= 2) {
    const div = Number(d.slice(0, 2));
    if (div === 45) return 'empreitada';
    if (div >= 50) return 'servicos';
    return 'bens';
  }
  return null;
}

/** "79340000-9, Serviços de publicidade" → "79340000-9". */
function lerCpv(texto: string): string | null {
  const r = /(\d{8})(?:-(\d))?/.exec(texto);
  return r ? (r[2] ? `${r[1]}-${r[2]}` : r[1]) : null;
}

export function lerContratosBase(
  texto: string,
  separador?: string,
): ResultadoCsv {
  const tabela = lerCsv(texto, separador);
  if (!tabela.length) {
    return {
      linhas: [],
      erros: [{ linha: 1, motivo: 'Ficheiro vazio.' }],
      colunas_desconhecidas: [],
    };
  }
  const cabecalho = tabela[0].map(normalizar);
  const indice = new Map<Campo, number>();
  const desconhecidas: string[] = [];
  cabecalho.forEach((c, i) => {
    const campo = (Object.keys(ALIASES) as Campo[]).find(
      (k) => !indice.has(k) && ALIASES[k].includes(c),
    );
    if (campo) indice.set(campo, i);
    else if (c) desconhecidas.push(tabela[0][i].trim());
  });

  const faltam: string[] = [];
  if (!indice.has('adjudicatario') && !indice.has('adjudicatario_nif'))
    faltam.push('adjudicatário');
  if (!indice.has('objeto')) faltam.push('objeto');
  if (!indice.has('preco')) faltam.push('preço contratual');
  if (!indice.has('data_celebracao') && !indice.has('data_publicacao'))
    faltam.push('data');
  if (faltam.length) {
    return {
      linhas: [],
      erros: [{ linha: 1, motivo: `Faltam colunas: ${faltam.join(', ')}.` }],
      colunas_desconhecidas: desconhecidas,
    };
  }

  const linhas: ResultadoCsv['linhas'] = [];
  const erros: ErroLinha[] = [];
  tabela.slice(1).forEach((cels, i) => {
    const n = i + 2;
    const v = (c: Campo) => {
      const k = indice.get(c);
      return k === undefined ? '' : (cels[k] ?? '').trim();
    };
    const sep = separarAdjudicatario(v('adjudicatario'));
    const nifCol = v('adjudicatario_nif').replace(/\D/g, '');
    const nif = nifCol || sep.nif;
    const nome = v('adjudicatario_nome') || sep.nome;
    const objeto = v('objeto');
    const preco = lerPreco(v('preco'));
    const data = lerData(v('data_celebracao')) ?? lerData(v('data_publicacao'));
    const cpv = lerCpv(v('cpv'));
    const tipo = tipoDe(v('tipo'), cpv);
    const problemas = [
      !nif
        ? 'sem NIF do adjudicatário'
        : !nifValido(nif)
          ? `NIF ${nif} inválido`
          : null,
      !objeto ? 'sem objeto' : null,
      preco === null ? 'preço ilegível' : null,
      !data ? 'data ilegível' : null,
      !tipo ? 'sem tipo de contrato nem CPV' : null,
    ].filter(Boolean);
    if (problemas.length || !nif || preco === null || !data || !tipo) {
      erros.push({ linha: n, motivo: `${problemas.join('; ')}.` });
      return;
    }
    const procOriginal = v('procedimento') || null;
    linhas.push({
      linha: n,
      adjudicante: v('adjudicante') || null,
      adjudicatario_nif: nif,
      adjudicatario_nome: nome,
      objeto: objeto.slice(0, 2000),
      cpv,
      tipo,
      preco_contratual_cent: preco,
      data_contrato: data,
      procedimento: procOriginal ? procedimentoDe(procOriginal) : 'outro',
      procedimento_original: procOriginal,
    });
  });
  return { linhas, erros, colunas_desconhecidas: desconhecidas };
}
