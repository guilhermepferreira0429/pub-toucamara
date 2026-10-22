/*
 * As licenças decididas na chamada em duas ferramentas, em vez de uma por
 * tipo: `campos_da_licenca(tipo)` diz o que perguntar e `pedir_licenca(tipo,
 * dados)` valida com o esquema desse tipo e pede (mesma decisão, taxa,
 * pagamento, PDF e SMS de sempre: LicencasService.pedir).
 *
 * Os campos saem dos esquemas zod de cada tipo (regras*.ts e
 * entradaPedirRuido): uma só fonte de verdade. Puro, sem BD.
 */
import { z } from 'zod';
import { entradaPedirRuido } from './licencas.service.js';
import { DEFS, ENTRADAS, TIPOS, TipoLicenca } from './tipos.js';

/** O esquema dos dados de cada tipo (o mesmo que as regras usam). */
export const ESQUEMAS_LICENCA: Record<TipoLicenca, z.ZodObject> = {
  ruido: entradaPedirRuido,
  ...ENTRADAS,
};

/** Para o modelo escolher o tipo (vai na descrição do parâmetro). */
export const TIPOS_DITOS: Record<TipoLicenca, string> = {
  ruido: 'festa, evento ou obra com barulho',
  ocupacao_via: 'andaime, contentor ou materiais na rua por obras',
  esplanada: 'mesas e cadeiras no passeio',
  distico_residente: 'cartão de residente para estacionar',
  publicidade: 'placa, letras, toldo, lona ou anúncio',
  recinto_improvisado:
    'arraial, concerto ou festa ao ar livre com palco ou tendas',
};

/** O que o agente tem de saber de cada tipo além dos campos. */
export const NOTAS_LICENCA: Partial<Record<TipoLicenca, string[]>> = {
  publicidade: [
    'O anúncio pequeno do próprio estabelecimento não precisa de licença: fica uma mera comunicação, sem taxa.',
  ],
  recinto_improvisado: [
    'Se houver música, precisa também da licença especial de ruído: depois desta, pede-a com pedir_licenca tipo ruido (o resultado traz tambem_ruido: true).',
  ],
};

export const descricaoTipo = `ruido (${TIPOS_DITOS.ruido}), ${TIPOS.filter(
  (t) => t !== 'ruido',
)
  .map((t) => `${t} (${TIPOS_DITOS[t]})`)
  .join(', ')}.`;

export const esquemaTipo = z.enum(TIPOS);

// ---------------------------------------------------------------------
// Os campos de um tipo, a partir do zod
// ---------------------------------------------------------------------

type Js = Record<string, unknown>;

export interface CampoLicenca {
  campo: string;
  /** O que perguntar (a descrição do campo no zod). */
  pergunta: string;
  obrigatorio: boolean;
  formato: string;
  valores?: string[];
}

function limites(p: Js): string {
  const min = (p.minimum ?? p.exclusiveMinimum) as number | undefined;
  const max = p.maximum as number | undefined;
  if (min !== undefined && max !== undefined) return ` (${min} a ${max})`;
  if (max !== undefined) return ` (até ${max})`;
  return '';
}

function formato(p: Js): string {
  if (p.format === 'date') return 'data AAAA-MM-DD';
  if (typeof p.pattern === 'string' && p.pattern.includes(':h]'))
    return 'hora HH:MM';
  if (p.type === 'integer') return `número inteiro${limites(p)}`;
  if (p.type === 'number') return `número${limites(p)}`;
  if (p.type === 'boolean') return 'sim ou não';
  if (p.type === 'array') return 'lista (vazia se nenhum)';
  if (Array.isArray(p.enum)) return 'um dos valores';
  return 'texto';
}

function valoresDe(p: Js): string[] | undefined {
  if (Array.isArray(p.enum)) return p.enum as string[];
  const itens = p.items as Js | undefined;
  if (itens && Array.isArray(itens.enum)) return itens.enum as string[];
  return undefined;
}

function jsonSchema(e: z.ZodObject): {
  properties: Record<string, Js>;
  required: string[];
} {
  const j = z.toJSONSchema(e, { io: 'input' }) as Js;
  return {
    properties: (j.properties ?? {}) as Record<string, Js>,
    required: (j.required ?? []) as string[],
  };
}

/** Os campos a perguntar para um tipo, pela ordem do esquema. */
export function camposDaLicenca(tipo: TipoLicenca): CampoLicenca[] {
  const { properties, required } = jsonSchema(ESQUEMAS_LICENCA[tipo]);
  return Object.entries(properties).map(([campo, p]) => {
    const valores = valoresDe(p);
    return {
      campo,
      pergunta: typeof p.description === 'string' ? p.description : campo,
      obrigatorio: required.includes(campo),
      formato: formato(p),
      ...(valores ? { valores } : {}),
    };
  });
}

/** O resultado de `campos_da_licenca`. */
export function respostaCampos(tipo: TipoLicenca) {
  const def = DEFS[tipo];
  const campos = camposDaLicenca(tipo);
  const obrigatorios = campos.filter((c) => c.obrigatorio);
  return {
    tipo,
    licenca: def.nome,
    campos,
    ...(NOTAS_LICENCA[tipo] ? { notas: NOTAS_LICENCA[tipo] } : {}),
    ...(def.renovavel ? { renovavel: true } : {}),
    instrucao: `Pergunta os ${obrigatorios.length} campos obrigatórios, um de cada vez (os outros só se a pessoa souber), lê tudo de volta e, com o sim, chama pedir_licenca com tipo ${tipo} e os dados.`,
  };
}

// ---------------------------------------------------------------------
// O envelope dos dados (todos os campos de todos os tipos, opcionais)
// ---------------------------------------------------------------------

function humano(campo: string): string {
  return campo.replace(/_/g, ' ');
}

/** Um campo solto: só o tipo (a validação a sério é a do tipo escolhido). */
function campoSolto(campo: string, ps: Js[]): z.ZodType | null {
  const p = ps[0];
  const enumUniao = (lista: (string[] | undefined)[]) => {
    const v = [...new Set(lista.flatMap((x) => x ?? []))];
    return v.length ? z.enum(v as [string, ...string[]]) : null;
  };
  let base: z.ZodType | null = null;
  if (Array.isArray(p.enum)) base = enumUniao(ps.map(valoresDe));
  else if (p.type === 'array') {
    const e = enumUniao(ps.map(valoresDe));
    base = z.array(e ?? z.string());
  } else if (p.type === 'integer') base = z.number().int();
  else if (p.type === 'number') base = z.number();
  else if (p.type === 'boolean') base = z.boolean();
  else if (p.type === 'string') base = z.string();
  if (!base) return null;
  const dica =
    p.format === 'date'
      ? ', AAAA-MM-DD'
      : typeof p.pattern === 'string' && p.pattern.includes(':h]')
        ? ', HH:MM'
        : '';
  return base.optional().describe(`${humano(campo)}${dica}`);
}

function envelope(): z.ZodObject {
  const porCampo = new Map<string, Js[]>();
  for (const t of TIPOS) {
    for (const [campo, p] of Object.entries(
      jsonSchema(ESQUEMAS_LICENCA[t]).properties,
    )) {
      porCampo.set(campo, [...(porCampo.get(campo) ?? []), p]);
    }
  }
  const forma: Record<string, z.ZodType> = {};
  for (const [campo, ps] of porCampo) {
    const s = campoSolto(campo, ps);
    if (s) forma[campo] = s;
  }
  return z.object(forma);
}

export const entradaPedirLicenca = z.object({
  tipo: esquemaTipo.describe('O tipo, como em campos_da_licenca.'),
  dados: envelope().describe(
    'Os campos de campos_da_licenca para este tipo, com esses nomes.',
  ),
});

export const entradaCamposLicenca = z.object({
  tipo: esquemaTipo.describe(descricaoTipo),
});

// ---------------------------------------------------------------------
// Validar os dados com o esquema do tipo, com o que falta em português
// ---------------------------------------------------------------------

export interface FaltaLicenca {
  campo: string;
  pergunta: string;
}

export interface InvalidoLicenca {
  campo: string;
  problema: string;
}

export type ValidacaoLicenca =
  | { ok: true; dados: Record<string, unknown> }
  | { ok: false; em_falta: FaltaLicenca[]; invalidos: InvalidoLicenca[] };

function problema(i: z.core.$ZodIssue, c: CampoLicenca | undefined): string {
  switch (i.code) {
    case 'too_small':
      return i.origin === 'string'
        ? 'é curto demais'
        : i.origin === 'array'
          ? 'tem poucos elementos'
          : `tem de ser pelo menos ${String(i.minimum)}`;
    case 'too_big':
      return i.origin === 'string'
        ? 'é longo demais'
        : i.origin === 'array'
          ? 'tem elementos a mais'
          : `tem de ser no máximo ${String(i.maximum)}`;
    case 'invalid_value':
      return `tem de ser um destes: ${(c?.valores ?? i.values.map(String)).join(', ')}`;
    case 'invalid_format':
      return `formato errado (${c?.formato ?? i.format})`;
    case 'invalid_type':
      return `tem de ser ${c?.formato ?? i.expected}`;
    default:
      return c ? `não é válido (${c.formato})` : 'não é válido';
  }
}

/** Tira os vazios que o modelo às vezes manda nos campos que não sabe. */
function semVazios(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(dados).filter(
      ([, v]) => v !== null && v !== undefined && v !== '',
    ),
  );
}

export function validarLicenca(
  tipo: TipoLicenca,
  dados: Record<string, unknown>,
): ValidacaoLicenca {
  const limpos = semVazios(dados);
  const r = ESQUEMAS_LICENCA[tipo].safeParse(limpos);
  if (r.success) return { ok: true, dados: r.data };
  const campos = new Map(camposDaLicenca(tipo).map((c) => [c.campo, c]));
  const em_falta: FaltaLicenca[] = [];
  const invalidos: InvalidoLicenca[] = [];
  for (const i of r.error.issues) {
    const campo = String(i.path[0] ?? '');
    const c = campos.get(campo);
    if (c && !(campo in limpos)) {
      if (!em_falta.some((f) => f.campo === campo))
        em_falta.push({ campo, pergunta: c.pergunta });
    } else {
      invalidos.push({ campo: campo || 'dados', problema: problema(i, c) });
    }
  }
  return { ok: false, em_falta, invalidos };
}

/** O resultado quando os dados não chegam (o agente pergunta e volta a chamar). */
export function respostaFaltas(
  tipo: TipoLicenca,
  v: Extract<ValidacaoLicenca, { ok: false }>,
) {
  const partes = [
    ...v.em_falta.map((f) => f.pergunta.replace(/\.$/, '').toLowerCase()),
    ...v.invalidos.map((x) => `${humano(x.campo)} ${x.problema}`),
  ];
  return {
    pedida: false,
    motivo: v.em_falta.length ? 'faltam_dados' : 'dados_invalidos',
    tipo,
    ...(v.em_falta.length ? { em_falta: v.em_falta } : {}),
    ...(v.invalidos.length ? { invalidos: v.invalidos } : {}),
    instrucao: `Ainda não se pediu ${DEFS[tipo].feminino ? 'a' : 'o'} ${DEFS[tipo].curto}. Pergunta à pessoa (um de cada vez) e chama outra vez com todos os dados: ${partes.join('; ')}.`,
  };
}
