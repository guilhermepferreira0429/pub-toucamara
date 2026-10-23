/*
 * Os sistemas avaliados (`avaliacao.sistemas`): criar, listar e preparar os
 * habituais (o nosso agente em chat e voz por município e o assistente do site).
 */
import { bd, type Q } from '../bd.js';
import { configExterno } from '../sistemas/externo-config.js';
import type { Sistema, TipoAdaptador } from '../tipos.js';

export const ADAPTADORES: TipoAdaptador[] = [
  'tou-chat',
  'tou-voz',
  'externo',
  'manual',
];

const COLUNAS = 'id, nome, municipio_id, adaptador, url, config, nosso';

/** Pelo nome exato; senão, por parte do nome se só houver um. */
export async function sistemaPorNome(
  nome: string,
  q: Q = bd,
): Promise<Sistema> {
  const [exato] = await q.query<Sistema>(
    `SELECT ${COLUNAS} FROM avaliacao.sistemas WHERE nome = $1`,
    [nome],
  );
  if (exato) return exato;
  const parecidos = await q.query<Sistema>(
    `SELECT ${COLUNAS} FROM avaliacao.sistemas WHERE nome ILIKE '%' || $1 || '%' ORDER BY nome`,
    [nome],
  );
  if (parecidos.length === 1) return parecidos[0];
  if (parecidos.length > 1) {
    throw new Error(
      `"${nome}" corresponde a vários sistemas: ${parecidos.map((s) => `"${s.nome}"`).join(', ')}.`,
    );
  }
  throw new Error(`Não há sistema "${nome}". Vê \`sistemas listar\`.`);
}

export async function sistemaPorId(id: string, q: Q = bd): Promise<Sistema> {
  const [s] = await q.query<Sistema>(
    `SELECT ${COLUNAS} FROM avaliacao.sistemas WHERE id = $1`,
    [id],
  );
  if (!s) throw new Error(`Sistema ${id} não existe.`);
  return s;
}

async function municipioId(slug: string, q: Q): Promise<string> {
  const [m] = await q.query<{ id: string }>(
    'SELECT id FROM municipios WHERE slug = $1',
    [slug],
  );
  if (!m) throw new Error(`Município "${slug}" não existe.`);
  return m.id;
}

export interface NovoSistema {
  nome: string;
  adaptador: string;
  municipio?: string;
  url?: string;
  /** JSON (texto) ou objeto. */
  config?: string | Record<string, unknown>;
  nosso?: boolean;
}

export async function criarSistema(
  n: NovoSistema,
  q: Q = bd,
): Promise<Sistema> {
  if (!n.nome.trim()) throw new Error('Falta o nome.');
  if (!ADAPTADORES.includes(n.adaptador as TipoAdaptador)) {
    throw new Error(
      `Adaptador "${n.adaptador}" desconhecido (${ADAPTADORES.join(', ')}).`,
    );
  }
  let config: Record<string, unknown> = {};
  if (typeof n.config === 'string') {
    try {
      config = JSON.parse(n.config);
    } catch (e) {
      throw new Error(`--config não é JSON válido: ${(e as Error).message}`);
    }
  } else if (n.config) config = n.config;
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new Error('--config tem de ser um objeto JSON.');
  // Erros de config apanham-se já, não à primeira pergunta.
  if (n.adaptador === 'externo') configExterno(config);
  if (n.adaptador === 'externo' && !n.url)
    throw new Error(
      'Um sistema externo precisa de --url (a página com o widget).',
    );
  const mid = n.municipio ? await municipioId(n.municipio, q) : null;
  const [s] = await q.query<Sistema>(
    `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, url, config, nosso)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (nome) DO NOTHING
     RETURNING ${COLUNAS}`,
    [
      n.nome.trim(),
      mid,
      n.adaptador,
      n.url ?? null,
      JSON.stringify(config),
      n.nosso ?? false,
    ],
  );
  if (!s) throw new Error(`Já existe um sistema "${n.nome}".`);
  return s;
}

export interface LinhaSistema {
  nome: string;
  adaptador: string;
  municipio: string | null;
  url: string | null;
  nosso: boolean;
  execucoes: number;
  ultima: Date | null;
}

export function listarSistemas(q: Q = bd): Promise<LinhaSistema[]> {
  return q.query<LinhaSistema>(
    `SELECT s.nome, s.adaptador, m.slug AS municipio, s.url, s.nosso,
            count(e.id)::int AS execucoes, max(e.iniciada_em) AS ultima
     FROM avaliacao.sistemas s
     LEFT JOIN municipios m ON m.id = s.municipio_id
     LEFT JOIN avaliacao.execucoes e ON e.sistema_id = s.id
     GROUP BY s.id, m.slug
     ORDER BY s.nosso DESC, s.nome`,
  );
}

/** Nomes para quando o município ainda não está na BD. */
const NOMES: Record<string, string> = {
  guimaraes: 'Guimarães',
  matosinhos: 'Matosinhos',
};

/** Os assistentes externos que conhecemos (seletores por omissão em externo-config.ts). */
export const EXTERNOS = [
  {
    nome: 'Assistente do site · Guimarães',
    slug: 'guimaraes',
    url: 'https://www.cm-guimaraes.pt',
  },
  {
    nome: 'Assistente do site · Matosinhos',
    slug: 'matosinhos',
    url: 'https://www.cm-matosinhos.pt',
  },
];

export interface ResultadoPreparar {
  criados: string[];
  existentes: string[];
  avisos: string[];
}

/**
 * Cria, se ainda não existirem: "Tou, Câmara? · <município> · chat" e
 * "… · voz" para cada município pedido, e o assistente do site. O nosso leva
 * `config.slug`, para funcionar mesmo antes de o município existir na BD.
 */
export async function prepararBase(
  slugs: string[] = ['guimaraes', 'matosinhos'],
  q: Q = bd,
): Promise<ResultadoPreparar> {
  const r: ResultadoPreparar = { criados: [], existentes: [], avisos: [] };
  const municipios = new Map<string, { id: string; nome: string } | null>();
  const municipio = async (slug: string) => {
    if (!municipios.has(slug)) {
      const [m] = await q.query<{ id: string; nome: string }>(
        'SELECT id, nome FROM municipios WHERE slug = $1',
        [slug],
      );
      municipios.set(slug, m ?? null);
      if (!m)
        r.avisos.push(
          `Município "${slug}" não existe na BD: sistemas criados sem municipio_id (associa-os depois).`,
        );
    }
    return municipios.get(slug)!;
  };

  const novos: {
    nome: string;
    slug: string;
    adaptador: TipoAdaptador;
    url: string | null;
    config: Record<string, unknown>;
    nosso: boolean;
  }[] = [];
  for (const slug of slugs) {
    const m = await municipio(slug);
    const nomeM = m?.nome ?? NOMES[slug] ?? slug;
    for (const canal of ['chat', 'voz'] as const) {
      novos.push({
        nome: `Tou, Câmara? · ${nomeM} · ${canal}`,
        slug,
        adaptador: canal === 'chat' ? 'tou-chat' : 'tou-voz',
        url: null,
        config: { slug },
        nosso: true,
      });
    }
  }
  for (const e of EXTERNOS) {
    novos.push({
      nome: e.nome,
      slug: e.slug,
      adaptador: 'externo',
      url: e.url,
      config: {},
      nosso: false,
    });
  }

  for (const n of novos) {
    const m = await municipio(n.slug);
    const [s] = await q.query<{ id: string }>(
      `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, url, config, nosso)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (nome) DO NOTHING RETURNING id`,
      [
        n.nome,
        m?.id ?? null,
        n.adaptador,
        n.url,
        JSON.stringify(n.config),
        n.nosso,
      ],
    );
    (s ? r.criados : r.existentes).push(n.nome);
  }
  return r;
}
