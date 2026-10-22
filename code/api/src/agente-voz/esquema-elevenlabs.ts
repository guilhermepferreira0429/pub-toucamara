/*
 * Do zod das ferramentas para o esquema dos parâmetros das webhook tools do
 * ElevenLabs Agents (`api_schema.request_body_schema`).
 *
 * Formato confirmado no SDK oficial @elevenlabs/elevenlabs-js 2.74.0
 * (out. 2026; a documentação web não estava acessível daqui):
 * - literal: { type: 'string'|'number'|'integer'|'boolean', description?,
 *   enum? (só strings), dynamic_variable?, constant_value?, is_omitted? }.
 *   Cada literal tem de ter UMA fonte de valor: description (o modelo
 *   preenche), dynamic_variable ou constant_value.
 * - objeto: { type: 'object', description?, properties, required? }
 * - lista: { type: 'array', description?, items }
 * Não há nullable, uniões, mínimos/máximos, padrões nem formatos: perdem-se
 * (a API valida na mesma com o zod e devolve o erro ao modelo).
 */
import { z } from 'zod';

export type TipoLiteral = 'string' | 'number' | 'integer' | 'boolean';

export interface LiteralEl {
  type: TipoLiteral;
  description?: string;
  enum?: string[];
  dynamic_variable?: string;
}

export interface ObjetoEl {
  type: 'object';
  description?: string;
  properties: Record<string, PropriedadeEl>;
  required?: string[];
}

export interface ListaEl {
  type: 'array';
  description?: string;
  items: PropriedadeEl;
}

export type PropriedadeEl = LiteralEl | ObjetoEl | ListaEl;

export interface Aviso {
  ferramenta: string;
  /** Ex.: `campos` ou `taxas[].quantidade`. */
  caminho: string;
  /** 'perda': o ElevenLabs não consegue exprimir isto; 'nota': ajustado. */
  nivel: 'perda' | 'nota';
  mensagem: string;
}

type Js = Record<string, unknown>;

const LITERAIS = new Set<string>(['string', 'number', 'integer', 'boolean']);

/**
 * Parâmetros que o sistema preenche: a descrição da ferramenta diz
 * "Preenchido pelo sistema ({{system__call_sid}})". Vão como
 * `dynamic_variable` e o modelo nem os vê.
 */
const VARIAVEL_DO_SISTEMA = /preenchido pelo sistema\s*\(\{\{(\w+)\}\}\)/i;

const DICAS_FORMATO: Record<string, string> = {
  date: 'Data no formato AAAA-MM-DD.',
  'date-time': 'Data e hora em ISO 8601 (ex.: 2026-10-26T15:30:00+01:00).',
  time: 'Hora no formato HH:MM.',
  email: 'Endereço de email.',
};

function humano(nome: string): string {
  return nome.replace(/_/g, ' ').replace(/\[\]$/, '');
}

function comDica(descricao: string | undefined, formato: unknown): string {
  const d = (descricao ?? '').trim();
  const dica = typeof formato === 'string' ? DICAS_FORMATO[formato] : undefined;
  if (!dica) return d;
  // Não repetir o que a descrição já diz.
  if (/AAAA|aaaa|ISO|HH:MM|dia\/mês/i.test(d)) return d;
  return d ? `${d} ${dica}` : dica;
}

/** Tira o `null` das uniões (opcional/nullable → o ElevenLabs só tem opcional). */
function semNulo(s: Js): Js {
  const uniao = (s.anyOf ?? s.oneOf) as Js[] | undefined;
  if (Array.isArray(uniao)) {
    const resto = uniao.filter((r) => r.type !== 'null');
    if (resto.length === 1) {
      const { anyOf: _a, oneOf: _o, ...fora } = s;
      void _a;
      void _o;
      return {
        ...resto[0],
        ...fora,
        description: s.description ?? resto[0].description,
      };
    }
    if (resto.length !== uniao.length) {
      return { ...s, anyOf: resto, oneOf: undefined };
    }
  }
  if (Array.isArray(s.type)) {
    const tipos = (s.type as string[]).filter((t) => t !== 'null');
    if (tipos.length === 1) return { ...s, type: tipos[0] };
    return { ...s, type: tipos };
  }
  return s;
}

/** Uniões só de valores fixos (z.literal('a').or(z.literal('b'))) → os valores. */
function valoresDaUniao(s: Js): unknown[] | null {
  const uniao = (s.anyOf ?? s.oneOf) as Js[] | undefined;
  if (!Array.isArray(uniao)) return null;
  const valores: unknown[] = [];
  for (const r of uniao) {
    if (r.const !== undefined) valores.push(r.const);
    else if (Array.isArray(r.enum)) valores.push(...(r.enum as unknown[]));
    else return null;
  }
  return valores;
}

function tipoDosValores(valores: unknown[]): TipoLiteral {
  if (valores.every((v) => typeof v === 'boolean')) return 'boolean';
  if (valores.every((v) => Number.isInteger(v))) return 'integer';
  if (valores.every((v) => typeof v === 'number')) return 'number';
  return 'string';
}

class Conversor {
  readonly avisos: Aviso[] = [];
  constructor(private readonly ferramenta: string) {}

  private avisar(caminho: string, nivel: Aviso['nivel'], mensagem: string) {
    this.avisos.push({ ferramenta: this.ferramenta, caminho, nivel, mensagem });
  }

  propriedade(bruto: Js, caminho: string, nome: string): PropriedadeEl {
    const s = semNulo(bruto);
    const descricao =
      typeof s.description === 'string' ? s.description : undefined;

    const valores = valoresDaUniao(s);
    if (valores) {
      return this.literal(
        {
          type: tipoDosValores(valores),
          enum: valores,
          description: descricao,
        },
        caminho,
        nome,
      );
    }
    if (s.anyOf || s.oneOf || Array.isArray(s.type)) {
      this.avisar(
        caminho,
        'perda',
        'aceita vários tipos; vai como texto (a API valida o que chegar)',
      );
      return this.literal(
        { type: 'string', description: descricao },
        caminho,
        nome,
      );
    }
    if (s.type === 'object') return this.objeto(s, caminho, nome);
    if (s.type === 'array') {
      const itens = (s.items ?? {}) as Js;
      return {
        type: 'array',
        description: this.descricao(descricao, caminho, nome),
        items: this.propriedade(itens, `${caminho}[]`, `${nome}[]`),
      };
    }
    if (typeof s.type === 'string' && LITERAIS.has(s.type)) {
      return this.literal(s, caminho, nome);
    }
    if (s.const !== undefined || Array.isArray(s.enum)) {
      const v = Array.isArray(s.enum) ? (s.enum as unknown[]) : [s.const];
      return this.literal({ ...s, type: tipoDosValores(v) }, caminho, nome);
    }
    this.avisar(
      caminho,
      'perda',
      `tipo sem equivalente (${JSON.stringify(s.type ?? 'qualquer')}); vai como texto`,
    );
    return this.literal(
      { type: 'string', description: descricao },
      caminho,
      nome,
    );
  }

  private descricao(
    d: string | undefined,
    caminho: string,
    nome: string,
  ): string {
    if (d && d.trim()) return d.trim();
    // Os itens de uma lista não precisam de descrição própria: basta a da lista.
    if (caminho.endsWith('[]')) return `Um elemento de ${humano(nome)}.`;
    this.avisar(
      caminho,
      'nota',
      'sem descrição no zod; usa-se o nome do campo',
    );
    return humano(nome);
  }

  private literal(s: Js, caminho: string, nome: string): LiteralEl {
    const tipo = s.type as TipoLiteral;
    const d = typeof s.description === 'string' ? s.description : undefined;
    const variavel = d?.match(VARIAVEL_DO_SISTEMA)?.[1];
    if (variavel) return { type: tipo, dynamic_variable: variavel };

    const out: LiteralEl = {
      type: tipo,
      description: comDica(this.descricao(d, caminho, nome), s.format),
    };
    let valores: unknown[] | null = null;
    if (Array.isArray(s.enum)) valores = s.enum as unknown[];
    else if (s.const !== undefined) valores = [s.const];
    if (valores) {
      if (valores.every((v) => typeof v === 'string')) {
        out.type = 'string';
        out.enum = valores;
      } else {
        this.avisar(
          caminho,
          'perda',
          'enum que não é de texto: os valores passam para a descrição',
        );
        out.description = `${out.description} Valores possíveis: ${valores.map((v) => JSON.stringify(v)).join(', ')}.`;
      }
    }
    return out;
  }

  objeto(s: Js, caminho: string, nome: string): ObjetoEl {
    const props = (s.properties ?? {}) as Record<string, Js>;
    const out: ObjetoEl = { type: 'object', properties: {} };
    if (caminho)
      out.description = this.descricao(
        s.description as string | undefined,
        caminho,
        nome,
      );
    if (
      Object.keys(props).length === 0 &&
      s.additionalProperties &&
      typeof s.additionalProperties === 'object'
    ) {
      this.avisar(
        caminho || '(raiz)',
        'perda',
        'objeto de chaves livres (z.record): vai como objeto sem propriedades; confirmar numa chamada que o modelo manda as chaves',
      );
    }
    for (const [chave, valor] of Object.entries(props)) {
      out.properties[chave] = this.propriedade(
        valor,
        caminho ? `${caminho}.${chave}` : chave,
        chave,
      );
    }
    const obrigatorios = (
      Array.isArray(s.required) ? (s.required as string[]) : []
    ).filter(
      (r) => r in out.properties && !('dynamic_variable' in out.properties[r]),
    );
    if (obrigatorios.length > 0) out.required = obrigatorios;
    return out;
  }
}

export interface EsquemaConvertido {
  /** null quando a ferramenta não tem parâmetros (vai sem corpo). */
  esquema: ObjetoEl | null;
  avisos: Aviso[];
}

/** Converte o JSON Schema (draft 2020-12, como o zod o gera) de uma ferramenta. */
export function converterJsonSchema(
  ferramenta: string,
  json: Js,
): EsquemaConvertido {
  const c = new Conversor(ferramenta);
  const esquema = c.objeto(json, '', ferramenta);
  if (Object.keys(esquema.properties).length === 0) {
    return { esquema: null, avisos: c.avisos };
  }
  esquema.description = `Parâmetros de ${ferramenta}.`;
  return { esquema, avisos: c.avisos };
}

/** Converte a entrada zod (o que o modelo manda, `io: 'input'`). */
export function converterZod(
  ferramenta: string,
  entrada: z.ZodObject,
): EsquemaConvertido {
  return converterJsonSchema(
    ferramenta,
    z.toJSONSchema(entrada, { io: 'input' }),
  );
}

/** Erros de forma (o que o ElevenLabs recusaria); vazio = válido. */
export function validarElevenLabs(p: PropriedadeEl, caminho = ''): string[] {
  const erros: string[] = [];
  if (p.type === 'object') {
    const o = p;
    for (const r of o.required ?? []) {
      if (!(r in o.properties))
        erros.push(`${caminho}: required "${r}" sem propriedade`);
    }
    for (const [k, v] of Object.entries(o.properties)) {
      erros.push(...validarElevenLabs(v, `${caminho}.${k}`));
    }
    return erros;
  }
  if (p.type === 'array') {
    if (!p.items) erros.push(`${caminho}: lista sem items`);
    else erros.push(...validarElevenLabs(p.items, `${caminho}[]`));
    return erros;
  }
  if (!['string', 'number', 'integer', 'boolean'].includes(p.type)) {
    erros.push(`${caminho}: tipo ${String(p.type)}`);
  }
  const fontes = [p.description, p.dynamic_variable].filter(
    (v) => v !== undefined,
  );
  if (fontes.length !== 1)
    erros.push(`${caminho}: tem de ter uma só fonte de valor`);
  if (
    p.enum &&
    (p.type !== 'string' || p.enum.some((v) => typeof v !== 'string'))
  ) {
    erros.push(`${caminho}: enum fora de texto`);
  }
  const extra = Object.keys(p).filter(
    (k) => !['type', 'description', 'enum', 'dynamic_variable'].includes(k),
  );
  if (extra.length)
    erros.push(`${caminho}: campos sem equivalente (${extra.join(', ')})`);
  return erros;
}
