/*
 * Os campos de um esquema zod em português, para o agente perguntar, e a
 * validação de volta com o que falta ou está mal. É o que campos_da_licenca
 * faz para as licenças, aqui para qualquer esquema (o catálogo de serviços).
 *
 * Os valores chegam do modelo como texto (lista de {campo, valor}: o
 * ElevenLabs não exprime objetos de chaves livres) e convertem-se aqui
 * para o tipo do campo antes de validar.
 */
import { z } from 'zod';

type Js = Record<string, unknown>;

export interface Campo {
  campo: string;
  /** O que perguntar (a descrição do campo no zod). */
  pergunta: string;
  obrigatorio: boolean;
  formato: string;
  valores?: string[];
}

function esquemaJson(e: z.ZodObject): {
  properties: Record<string, Js>;
  required: string[];
} {
  const j = z.toJSONSchema(e, { io: 'input', unrepresentable: 'any' }) as Js;
  return {
    properties: (j.properties ?? {}) as Record<string, Js>,
    required: (j.required ?? []) as string[],
  };
}

/** O primeiro ramo com tipo (z.optional/nullable dão anyOf). */
function simples(p: Js): Js {
  const ramos = (p.anyOf ?? p.oneOf) as Js[] | undefined;
  if (!ramos) return p;
  const r = ramos.find((x) => x.type !== 'null') ?? ramos[0];
  return { ...r, description: p.description ?? r.description };
}

function limites(p: Js): string {
  // O z.int() põe os limites do inteiro seguro: não são limites a dizer.
  const real = (n: unknown) =>
    typeof n === 'number' && Math.abs(n) < Number.MAX_SAFE_INTEGER
      ? n
      : undefined;
  const min = real(p.minimum ?? p.exclusiveMinimum);
  const max = real(p.maximum);
  if (min !== undefined && max !== undefined) return ` (${min} a ${max})`;
  if (max !== undefined) return ` (até ${max})`;
  if (min !== undefined) return ` (a partir de ${min})`;
  return '';
}

function formato(p: Js): string {
  if (p.format === 'date') return 'data AAAA-MM-DD';
  if (typeof p.pattern === 'string' && p.pattern.includes(':'))
    return 'hora HH:MM';
  if (p.type === 'integer') return `número inteiro${limites(p)}`;
  if (p.type === 'number') return `número${limites(p)}`;
  if (p.type === 'boolean') return 'sim ou não';
  if (p.type === 'array') return 'lista separada por vírgulas';
  if (Array.isArray(p.enum)) return 'um dos valores';
  return 'texto';
}

function valoresDe(p: Js): string[] | undefined {
  if (Array.isArray(p.enum)) return p.enum as string[];
  const itens = p.items as Js | undefined;
  if (itens && Array.isArray(itens.enum)) return itens.enum as string[];
  return undefined;
}

/** Os campos a perguntar, pela ordem do esquema. */
export function camposDe(e: z.ZodObject): Campo[] {
  const { properties, required } = esquemaJson(e);
  return Object.entries(properties).map(([campo, bruto]) => {
    const p = simples(bruto);
    const valores = valoresDe(p);
    return {
      campo,
      pergunta:
        typeof p.description === 'string'
          ? p.description
          : campo.replace(/_/g, ' '),
      obrigatorio: required.includes(campo),
      formato: formato(p),
      ...(valores ? { valores } : {}),
    };
  });
}

const SIM = /^(sim|s|true|verdade|yes|1)$/i;
const NAO = /^(n[aã]o|n|false|falso|no|0)$/i;

/** Texto do modelo → o tipo do campo (o zod valida a seguir). */
function converter(valor: unknown, p: Js | undefined): unknown {
  if (typeof valor !== 'string' || !p) return valor;
  const v = valor.trim();
  const s = simples(p);
  if (s.type === 'integer' || s.type === 'number') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : v;
  }
  if (s.type === 'boolean') return SIM.test(v) ? true : NAO.test(v) ? false : v;
  if (s.type === 'array') {
    return v
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return v;
}

export interface ParCampo {
  campo: string;
  valor: string;
}

/** A lista {campo, valor} (ou um objeto) como objeto com os tipos certos. */
export function dadosDe(
  e: z.ZodObject,
  dados: ParCampo[] | Record<string, unknown>,
): Record<string, unknown> {
  const { properties } = esquemaJson(e);
  const pares: [string, unknown][] = Array.isArray(dados)
    ? dados.map((d) => [d.campo.trim(), d.valor])
    : Object.entries(dados);
  return Object.fromEntries(
    pares
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([c, v]) => [c, converter(v, properties[c])]),
  );
}

export type Validacao =
  | { ok: true; dados: Record<string, unknown> }
  | {
      ok: false;
      em_falta: { campo: string; pergunta: string }[];
      invalidos: { campo: string; problema: string }[];
    };

function problema(i: z.core.$ZodIssue, c: Campo | undefined): string {
  switch (i.code) {
    case 'too_small':
      return i.origin === 'string'
        ? 'é curto demais'
        : `tem de ser pelo menos ${String(i.minimum)}`;
    case 'too_big':
      return i.origin === 'string'
        ? 'é longo demais'
        : `tem de ser no máximo ${String(i.maximum)}`;
    case 'invalid_value':
      return `tem de ser um destes: ${(c?.valores ?? i.values.map(String)).join(', ')}`;
    case 'invalid_format':
      return `formato errado (${c?.formato ?? i.format})`;
    case 'invalid_type':
      return `tem de ser ${c?.formato ?? i.expected}`;
    default:
      return i.message || (c ? `não é válido (${c.formato})` : 'não é válido');
  }
}

/** Valida; o que falta e o que está mal vêm em português, campo a campo. */
export function validarDados(
  e: z.ZodObject,
  dados: Record<string, unknown>,
): Validacao {
  const r = e.safeParse(dados);
  if (r.success) return { ok: true, dados: r.data };
  const campos = new Map(camposDe(e).map((c) => [c.campo, c]));
  const em_falta: { campo: string; pergunta: string }[] = [];
  const invalidos: { campo: string; problema: string }[] = [];
  for (const i of r.error.issues) {
    const campo = String(i.path[0] ?? '');
    const c = campos.get(campo);
    if (c && !(campo in dados)) {
      if (!em_falta.some((f) => f.campo === campo))
        em_falta.push({ campo, pergunta: c.pergunta });
    } else {
      invalidos.push({ campo: campo || 'dados', problema: problema(i, c) });
    }
  }
  return { ok: false, em_falta, invalidos };
}
