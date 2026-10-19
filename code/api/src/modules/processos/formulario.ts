import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { nifValido } from '../municipes/municipes.service.js';

/*
 * O formulário de cada tipo de processo (`tipos_processo.formulario`) é
 * jsonb com a lista dos campos que o agente pergunta durante a chamada:
 *
 *   [{ "chave": "morada_obra", "rotulo": "Morada da obra", "tipo": "morada",
 *      "obrigatorio": true, "pergunta_do_agente": "Qual é a morada da obra?" }]
 *
 * Tipos aceites:
 * - texto     texto livre (até 1000 caracteres)
 * - numero    número; aceita vírgula decimal ("12,5")
 * - data      'AAAA-MM-DD' ou 'DD/MM/AAAA'; guarda-se em ISO
 * - sim_nao   true/false ou "sim"/"não"
 * - morada    texto com pelo menos uma palavra e 5 caracteres
 * - nif       NIF do requerente: vai cifrado para o munícipe e no requerimento
 *             fica só `nif_registado: true` (nunca em claro em `dados`)
 * - escolha   uma das `opcoes` (obrigatórias neste tipo)
 */
export const TIPOS_CAMPO = [
  'texto',
  'numero',
  'data',
  'sim_nao',
  'morada',
  'nif',
  'escolha',
] as const;

export type TipoCampo = (typeof TIPOS_CAMPO)[number];

/** Chave reservada em `requerimentos.dados` para o NIF do requerente. */
export const NIF_REGISTADO = 'nif_registado';

export const esquemaCampo = z
  .object({
    chave: z.string().regex(/^[a-z][a-z0-9_]*$/, 'chave em snake_case'),
    rotulo: z.string().trim().min(1),
    tipo: z.enum(TIPOS_CAMPO),
    obrigatorio: z.boolean().default(true),
    pergunta_do_agente: z.string().trim().min(1).optional(),
    opcoes: z.array(z.string().trim().min(1)).min(1).optional(),
  })
  .refine((c) => c.tipo !== 'escolha' || !!c.opcoes, {
    message: 'campo de escolha sem opcoes',
  })
  .refine((c) => c.chave !== NIF_REGISTADO, {
    message: `a chave ${NIF_REGISTADO} é reservada`,
  });

export const esquemaFormulario = z.array(esquemaCampo).superRefine((l, c) => {
  const vistas = new Set<string>();
  for (const campo of l) {
    if (vistas.has(campo.chave)) {
      c.addIssue({ code: 'custom', message: `chave repetida: ${campo.chave}` });
    }
    vistas.add(campo.chave);
  }
});

export type CampoFormulario = z.output<typeof esquemaCampo>;
export type Formulario = CampoFormulario[];

export type Valor = string | number | boolean;
export type Dados = Record<string, Valor | null | undefined>;

/** Valida o jsonb ao ler. Um formulário partido é erro do seed, não do munícipe. */
export function lerFormulario(json: unknown, codigoTipo: string): Formulario {
  const r = esquemaFormulario.safeParse(json);
  if (!r.success) {
    throw new ErroApi(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'formulario_invalido',
      `O formulário do tipo ${codigoTipo} está mal configurado.`,
      { problemas: r.error.issues.map((i) => i.message) },
    );
  }
  return r.data;
}

/** "Não" → "nao": para comparar o que vem falado com as opções. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type ResultadoValor =
  { ok: true; valor: Valor } | { ok: false; erro: string };

const SIM = new Set(['sim', 's', 'yes', 'true', '1', 'claro', 'tenho']);
const NAO = new Set(['nao', 'n', 'no', 'false', '0', 'nao tenho']);

function dataIso(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (
    dt.getUTCFullYear() !== a ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

/** Valida e normaliza um valor pelo tipo do campo. As mensagens são para o agente. */
export function validarValor(
  campo: CampoFormulario,
  bruto: unknown,
): ResultadoValor {
  const texto =
    typeof bruto === 'string' || typeof bruto === 'number'
      ? String(bruto).trim()
      : '';
  switch (campo.tipo) {
    case 'texto':
      if (!texto) return { ok: false, erro: 'Vazio.' };
      if (texto.length > 1000) {
        return { ok: false, erro: 'Demasiado longo (máximo 1000).' };
      }
      return { ok: true, valor: texto };

    case 'morada':
      if (texto.length < 5 || !/\p{L}/u.test(texto)) {
        return { ok: false, erro: 'Morada incompleta: peça rua e número.' };
      }
      if (texto.length > 300)
        return { ok: false, erro: 'Morada demasiado longa.' };
      return { ok: true, valor: texto };

    case 'numero': {
      if (typeof bruto === 'number' && Number.isFinite(bruto)) {
        return { ok: true, valor: bruto };
      }
      const limpo = texto.replace(/\s/g, '').replace(',', '.');
      if (!/^-?\d+(\.\d+)?$/.test(limpo)) {
        return { ok: false, erro: 'Não é um número.' };
      }
      return { ok: true, valor: Number(limpo) };
    }

    case 'data': {
      let iso: string | null = null;
      const isoM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
      const ptM = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texto);
      if (isoM) iso = dataIso(+isoM[1], +isoM[2], +isoM[3]);
      else if (ptM) iso = dataIso(+ptM[3], +ptM[2], +ptM[1]);
      if (!iso) return { ok: false, erro: 'Data inválida (dia/mês/ano).' };
      return { ok: true, valor: iso };
    }

    case 'sim_nao': {
      if (typeof bruto === 'boolean') return { ok: true, valor: bruto };
      const n = normalizar(texto);
      if (SIM.has(n)) return { ok: true, valor: true };
      if (NAO.has(n)) return { ok: true, valor: false };
      return { ok: false, erro: 'Responda sim ou não.' };
    }

    case 'nif': {
      const nif = texto.replace(/^pt/i, '').replace(/[\s.-]/g, '');
      if (!nifValido(nif)) {
        return { ok: false, erro: 'NIF inválido: confirme os 9 dígitos.' };
      }
      return { ok: true, valor: nif };
    }

    case 'escolha': {
      const opcoes = campo.opcoes ?? [];
      const n = normalizar(texto);
      if (!n) return { ok: false, erro: `Escolha: ${opcoes.join(', ')}.` };
      const exata = opcoes.find((o) => normalizar(o) === n);
      if (exata) return { ok: true, valor: exata };
      // Dito por outras palavras: "a primeira", não; "alteração" → "Obras de alteração", sim.
      const parecidas = opcoes.filter(
        (o) => normalizar(o).includes(n) || n.includes(normalizar(o)),
      );
      if (parecidas.length === 1) return { ok: true, valor: parecidas[0] };
      return { ok: false, erro: `Escolha uma de: ${opcoes.join(', ')}.` };
    }
  }
}

function preenchido(campo: CampoFormulario, dados: Dados): boolean {
  if (campo.tipo === 'nif') return dados[NIF_REGISTADO] === true;
  const v = dados[campo.chave];
  return v !== undefined && v !== null && v !== '';
}

/** Chaves dos campos obrigatórios por preencher, pela ordem do formulário. */
export function camposEmFalta(formulario: Formulario, dados: Dados): string[] {
  return formulario
    .filter((c) => c.obrigatorio && !preenchido(c, dados))
    .map((c) => c.chave);
}

export function perguntaDe(campo: CampoFormulario): string {
  if (campo.pergunta_do_agente) return campo.pergunta_do_agente;
  return campo.rotulo.endsWith('?') ? campo.rotulo : `${campo.rotulo}?`;
}

/** A pergunta do primeiro campo em falta (ou null se não falta nada). */
export function proximaPergunta(
  formulario: Formulario,
  emFalta: string[],
): { chave: string; pergunta: string } | null {
  const campo = formulario.find((c) => c.chave === emFalta[0]);
  return campo ? { chave: campo.chave, pergunta: perguntaDe(campo) } : null;
}

/** Para mostrar (página pública, PDF, painel): "Sim", "21/10/2026". */
export function formatarValor(
  campo: CampoFormulario,
  dados: Dados,
): string | null {
  if (campo.tipo === 'nif') {
    return dados[NIF_REGISTADO] === true ? 'Registado (não se mostra)' : null;
  }
  const v = dados[campo.chave];
  if (v === undefined || v === null || v === '') return null;
  if (campo.tipo === 'sim_nao') return v === true ? 'Sim' : 'Não';
  if (campo.tipo === 'data' && typeof v === 'string') {
    const [a, m, d] = v.split('-');
    return `${d}/${m}/${a}`;
  }
  if (campo.tipo === 'numero' && typeof v === 'number') {
    return v.toLocaleString('pt-PT');
  }
  return String(v);
}

export interface CampoComValor {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  valor: string | null;
}

/** Os dados com rótulos, pela ordem do formulário (sem NIF em claro). */
export function dadosComRotulos(
  formulario: Formulario,
  dados: Dados,
): CampoComValor[] {
  return formulario.map((c) => ({
    chave: c.chave,
    rotulo: c.rotulo,
    tipo: c.tipo,
    obrigatorio: c.obrigatorio,
    valor: formatarValor(c, dados),
  }));
}

/** Valor do primeiro campo de um tipo (ex.: a morada da obra para o processo). */
export function primeiroDoTipo(
  formulario: Formulario,
  dados: Dados,
  tipo: TipoCampo,
): string | null {
  for (const c of formulario) {
    const v = c.tipo === tipo ? dados[c.chave] : undefined;
    if (typeof v === 'string' && v) return v;
  }
  return null;
}
