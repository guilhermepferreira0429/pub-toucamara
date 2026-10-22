/*
 * Ler e atualizar o agente de voz no ElevenLabs (API REST, header
 * `xi-api-key`). Rotas e campos confirmados no SDK oficial
 * @elevenlabs/elevenlabs-js 2.74.0 (out. 2026):
 *
 * - GET    /v1/convai/tools?page_size=100&cursor=…  → { tools, has_more, next_cursor }
 * - POST   /v1/convai/tools            { tool_config }  → { id, tool_config, … }
 * - PATCH  /v1/convai/tools/{id}       { tool_config }
 * - GET    /v1/convai/agents/{id}      → { agent_id, conversation_config, platform_settings, … }
 * - PATCH  /v1/convai/agents/{id}      { conversation_config, platform_settings }
 * - GET    /v1/convai/secrets          → { secrets: [{ secret_id, name }], next_cursor? }
 * - POST   /v1/convai/secrets          { type: 'new', name, value }
 *
 * As ferramentas são do workspace; o agente aponta para elas em
 * conversation_config.agent.prompt.tool_ids. "Nossas" são as webhook tools
 * cujo URL acaba em /v1/agent/tools/{nome} (o mesmo nome): só essas se criam
 * ou atualizam. Nunca se apaga nenhuma ferramenta: as nossas que deixaram de
 * existir na API saem só da lista do agente; as alheias ficam como estão.
 */
import { CAMINHO_FERRAMENTAS, FerramentaEl } from './configuracao.js';

export const URL_ELEVENLABS = 'https://api.elevenlabs.io';

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

type Obj = Record<string, unknown>;

export interface FerramentaRemota {
  id: string;
  tool_config: Obj & { type?: string; name?: string };
}

export interface AgenteRemoto {
  agent_id: string;
  name?: string;
  conversation_config?: Obj;
  platform_settings?: Obj;
}

export class ErroElevenLabs extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export class ClienteElevenLabs {
  constructor(
    private readonly apiKey: string,
    private readonly buscar: Buscar = fetch,
    private readonly base = URL_ELEVENLABS,
  ) {}

  private async pedir<T>(
    metodo: string,
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    const r = await this.buscar(`${this.base}${caminho}`, {
      method: metodo,
      headers: {
        'xi-api-key': this.apiKey,
        ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    const texto = await r.text();
    if (!r.ok) {
      throw new ErroElevenLabs(
        r.status,
        `ElevenLabs ${metodo} ${caminho}: HTTP ${r.status} ${texto.slice(0, 500)}`,
      );
    }
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  async ferramentas(): Promise<FerramentaRemota[]> {
    const todas: FerramentaRemota[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const q = new URLSearchParams({ page_size: '100' });
      if (cursor) q.set('cursor', cursor);
      const r = await this.pedir<{
        tools?: FerramentaRemota[];
        has_more?: boolean;
        next_cursor?: string | null;
      }>('GET', `/v1/convai/tools?${q.toString()}`);
      todas.push(...(r.tools ?? []));
      if (!r.has_more || !r.next_cursor) break;
      cursor = r.next_cursor;
    }
    return todas;
  }

  criarFerramenta(tool_config: FerramentaEl): Promise<FerramentaRemota> {
    return this.pedir('POST', '/v1/convai/tools', { tool_config });
  }

  atualizarFerramenta(
    id: string,
    tool_config: FerramentaEl,
  ): Promise<FerramentaRemota> {
    return this.pedir('PATCH', `/v1/convai/tools/${encodeURIComponent(id)}`, {
      tool_config,
    });
  }

  agente(id: string): Promise<AgenteRemoto> {
    return this.pedir('GET', `/v1/convai/agents/${encodeURIComponent(id)}`);
  }

  atualizarAgente(id: string, corpo: Obj): Promise<AgenteRemoto> {
    return this.pedir(
      'PATCH',
      `/v1/convai/agents/${encodeURIComponent(id)}`,
      corpo,
    );
  }

  async segredos(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const r = await this.pedir<{
        secrets?: { secret_id: string; name: string }[];
        next_cursor?: string | null;
      }>('GET', `/v1/convai/secrets${q}`);
      for (const s of r.secrets ?? []) m.set(s.name, s.secret_id);
      if (!r.next_cursor) break;
      cursor = r.next_cursor;
    }
    return m;
  }

  async criarSegredo(nome: string, valor: string): Promise<string> {
    const r = await this.pedir<{ secret_id: string }>(
      'POST',
      '/v1/convai/secrets',
      {
        type: 'new',
        name: nome,
        value: valor,
      },
    );
    return r.secret_id;
  }
}

// ---------------------------------------------------------------------
// Comparar
// ---------------------------------------------------------------------

/** É uma ferramenta nossa? Webhook para /v1/agent/tools/{o mesmo nome}. */
export function eNossa(f: FerramentaRemota): boolean {
  const c = f.tool_config;
  if (c?.type !== 'webhook' || typeof c.name !== 'string') return false;
  const url = (c.api_schema as Obj | undefined)?.url;
  if (typeof url !== 'string') return false;
  try {
    return (
      new URL(url).pathname.replace(/\/$/, '') ===
      `${CAMINHO_FERRAMENTAS}${c.name}`
    );
  } catch {
    return url.endsWith(`${CAMINHO_FERRAMENTAS}${c.name}`);
  }
}

/** Chaves cujo conteúdo tem de bater certo por inteiro (não só o que nós pomos). */
const MAPAS_EXATOS = new Set(['properties', 'request_headers']);

/**
 * Onde é que `remoto` não tem o que `desejado` pede. O ElevenLabs devolve
 * campos a mais (valores por omissão): esses não contam, exceto nos mapas de
 * propriedades e headers, onde uma chave a mais também é diferença.
 */
export function diferencas(
  desejado: unknown,
  remoto: unknown,
  caminho = '',
): string[] {
  if (Array.isArray(desejado)) {
    if (!Array.isArray(remoto)) return [caminho || '(raiz)'];
    const simples = desejado.every((v) => typeof v !== 'object' || v === null);
    if (simples) {
      // Listas de valores (required, enum, client_events): a ordem não conta.
      const a = (desejado as unknown[]).map(String).sort();
      const b = (remoto as unknown[]).map(String).sort();
      return a.length === b.length && a.every((v, i) => v === b[i])
        ? []
        : [caminho];
    }
    if (desejado.length !== remoto.length) return [caminho];
    return desejado.flatMap((v, i) =>
      diferencas(v, remoto[i], `${caminho}[${i}]`),
    );
  }
  if (desejado && typeof desejado === 'object') {
    if (!remoto || typeof remoto !== 'object' || Array.isArray(remoto))
      return [caminho || '(raiz)'];
    const d = desejado as Obj;
    const r = remoto as Obj;
    const out: string[] = [];
    const nome = caminho.split('.').pop() ?? '';
    if (MAPAS_EXATOS.has(nome)) {
      for (const k of Object.keys(r)) {
        if (!(k in d)) out.push(`${caminho}.${k} (a mais)`);
      }
    }
    for (const [k, v] of Object.entries(d)) {
      out.push(...diferencas(v, r[k], caminho ? `${caminho}.${k}` : k));
    }
    return out;
  }
  if (typeof desejado === 'number' && typeof remoto === 'number') {
    return Math.abs(desejado - remoto) < 1e-9 ? [] : [caminho];
  }
  return desejado === remoto ? [] : [caminho];
}

export interface Plano {
  criar: FerramentaEl[];
  atualizar: { id: string; ferramenta: FerramentaEl; campos: string[] }[];
  iguais: string[];
  /** Nome ocupado por uma ferramenta alheia (outro URL): não se cria a nossa. */
  conflitos: { nome: string; id: string; url: string | null }[];
  /** Nossas no workspace que já não existem na API: saem do agente, não se apagam. */
  obsoletas: { nome: string; id: string }[];
  /** Ferramentas do agente que não são nossas: ficam. */
  alheiasNoAgente: { nome: string; id: string }[];
  /** Nossas que existem mas não estavam na lista do agente. */
  porLigar: string[];
  /** A mais no agente (nossas obsoletas que ainda lá estão). */
  porDesligar: string[];
  prompt: {
    igual: boolean;
    linhasNovas: string[];
    linhasSaem: string[];
  } | null;
  agente: string[];
}

export interface Desejado {
  ferramentas: FerramentaEl[];
  prompt: string;
  /** conversation_config e platform_settings já resolvidos (sem null). */
  agente: { conversation_config: Obj; platform_settings: Obj };
}

function idsDoAgente(a: AgenteRemoto | null): string[] {
  const ids = (
    (a?.conversation_config?.agent as Obj | undefined)?.prompt as
      Obj | undefined
  )?.tool_ids;
  return Array.isArray(ids) ? (ids as string[]) : [];
}

function promptDoAgente(a: AgenteRemoto | null): string | null {
  const p = (
    (a?.conversation_config?.agent as Obj | undefined)?.prompt as
      Obj | undefined
  )?.prompt;
  return typeof p === 'string' ? p : null;
}

function difLinhas(novo: string, antigo: string) {
  const a = new Set(antigo.split('\n').map((l) => l.trimEnd()));
  const n = new Set(novo.split('\n').map((l) => l.trimEnd()));
  return {
    linhasNovas: [...n].filter((l) => l && !a.has(l)),
    linhasSaem: [...a].filter((l) => l && !n.has(l)),
  };
}

export function planear(
  desejado: Desejado,
  remotas: FerramentaRemota[],
  agente: AgenteRemoto | null,
): Plano {
  const nossas = new Map<string, FerramentaRemota>();
  const alheiasPorNome = new Map<string, FerramentaRemota>();
  for (const f of remotas) {
    const nome = String(f.tool_config?.name ?? '');
    if (eNossa(f)) {
      // Duplicadas: fica a que o agente usa, senão a primeira.
      const atual = nossas.get(nome);
      if (!atual || idsDoAgente(agente).includes(f.id)) nossas.set(nome, f);
    } else if (nome) {
      alheiasPorNome.set(nome, f);
    }
  }
  const plano: Plano = {
    criar: [],
    atualizar: [],
    iguais: [],
    conflitos: [],
    obsoletas: [],
    alheiasNoAgente: [],
    porLigar: [],
    porDesligar: [],
    prompt: null,
    agente: [],
  };
  const desejadas = new Set(desejado.ferramentas.map((f) => f.name));
  const ids = new Set(idsDoAgente(agente));

  for (const f of desejado.ferramentas) {
    const r = nossas.get(f.name);
    if (r) {
      const campos = diferencas(f, r.tool_config);
      if (campos.length)
        plano.atualizar.push({ id: r.id, ferramenta: f, campos });
      else plano.iguais.push(f.name);
      if (agente && !ids.has(r.id)) plano.porLigar.push(f.name);
      continue;
    }
    const alheia = alheiasPorNome.get(f.name);
    if (alheia) {
      const url = (alheia.tool_config.api_schema as Obj | undefined)?.url;
      plano.conflitos.push({
        nome: f.name,
        id: alheia.id,
        url: typeof url === 'string' ? url : null,
      });
      continue;
    }
    plano.criar.push(f);
    if (agente) plano.porLigar.push(f.name);
  }
  for (const [nome, r] of nossas) {
    if (!desejadas.has(nome)) {
      plano.obsoletas.push({ nome, id: r.id });
      if (ids.has(r.id)) plano.porDesligar.push(nome);
    }
  }
  const nossasIds = new Set([...nossas.values()].map((r) => r.id));
  for (const f of remotas) {
    if (ids.has(f.id) && !nossasIds.has(f.id)) {
      plano.alheiasNoAgente.push({
        nome: String(f.tool_config?.name ?? f.id),
        id: f.id,
      });
    }
  }
  if (agente) {
    const atual = promptDoAgente(agente) ?? '';
    plano.prompt = {
      igual: atual.trim() === desejado.prompt.trim(),
      ...difLinhas(desejado.prompt, atual),
    };
    plano.agente = [
      ...diferencas(
        desejado.agente.conversation_config,
        agente.conversation_config ?? {},
        'conversation_config',
      ),
      ...diferencas(
        desejado.agente.platform_settings,
        agente.platform_settings ?? {},
        'platform_settings',
      ),
    ];
  }
  return plano;
}

export function semAlteracoes(p: Plano): boolean {
  return (
    p.criar.length === 0 &&
    p.atualizar.length === 0 &&
    p.porLigar.length === 0 &&
    p.porDesligar.length === 0 &&
    (p.prompt?.igual ?? true) &&
    p.agente.length === 0
  );
}

// ---------------------------------------------------------------------
// Aplicar
// ---------------------------------------------------------------------

function fundir(base: unknown, por: unknown): unknown {
  if (
    por &&
    typeof por === 'object' &&
    !Array.isArray(por) &&
    base &&
    typeof base === 'object' &&
    !Array.isArray(base)
  ) {
    const out: Obj = { ...(base as Obj) };
    for (const [k, v] of Object.entries(por as Obj))
      out[k] = fundir((base as Obj)[k], v);
    return out;
  }
  return por;
}

export interface Resultado {
  criadas: string[];
  atualizadas: string[];
  agenteAtualizado: boolean;
  toolIds: string[];
}

/**
 * Aplica o plano. Só cria e atualiza as nossas; o agente fica com as alheias
 * que já tinha, mais as nossas desejadas (sem as nossas obsoletas). O PATCH do
 * agente leva a configuração que lá está com a nossa por cima (como o CLI do
 * ElevenLabs faz no push), para não perder nada se o ElevenLabs substituir
 * as secções em vez de as fundir.
 */
export async function aplicar(
  cliente: ClienteElevenLabs,
  plano: Plano,
  desejado: Desejado,
  remotas: FerramentaRemota[],
  agenteId: string | null,
  agente: AgenteRemoto | null,
): Promise<Resultado> {
  const r: Resultado = {
    criadas: [],
    atualizadas: [],
    agenteAtualizado: false,
    toolIds: [],
  };
  const idPorNome = new Map<string, string>();
  for (const f of remotas)
    if (eNossa(f)) idPorNome.set(String(f.tool_config.name), f.id);
  for (const a of plano.atualizar) idPorNome.set(a.ferramenta.name, a.id);

  for (const f of plano.criar) {
    const criada = await cliente.criarFerramenta(f);
    idPorNome.set(f.name, criada.id);
    r.criadas.push(f.name);
  }
  for (const a of plano.atualizar) {
    await cliente.atualizarFerramenta(a.id, a.ferramenta);
    r.atualizadas.push(a.ferramenta.name);
  }
  if (!agenteId || !agente) return r;

  const obsoletas = new Set(plano.obsoletas.map((o) => o.id));
  const nossas = desejado.ferramentas
    .map((f) => idPorNome.get(f.name))
    .filter((id): id is string => !!id);
  const nossasTodas = new Set([...idPorNome.values()]);
  const manter = idsDoAgente(agente).filter(
    (id) => !obsoletas.has(id) && !nossasTodas.has(id),
  );
  r.toolIds = [...manter, ...nossas];

  const cc = agente.conversation_config ?? {};
  const desejadoCc = {
    ...desejado.agente.conversation_config,
    agent: desejado.agente.conversation_config.agent ?? {},
  };
  const conversation_config = fundir(cc, desejadoCc) as Obj;
  const agentePatch = conversation_config.agent as Obj;
  const prompt = { ...((agentePatch.prompt ?? {}) as Obj) };
  // `tools` (as definições completas) está obsoleto e não pode ir com tool_ids.
  delete prompt.tools;
  conversation_config.agent = {
    ...agentePatch,
    prompt: { ...prompt, prompt: desejado.prompt, tool_ids: r.toolIds },
  };
  const platform_settings = fundir(
    agente.platform_settings ?? {},
    desejado.agente.platform_settings,
  ) as Obj;
  await cliente.atualizarAgente(agenteId, {
    conversation_config,
    platform_settings,
  });
  r.agenteAtualizado = true;
  return r;
}
