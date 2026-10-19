/*
 * O que se dá ao Claude para propor um gabarito: as entidades do concelho, os
 * trechos das fontes em vigor e os contactos que batem com a pergunta.
 *
 * A pesquisa imita a do agente (code/api/src/modules/conhecimento): texto
 * completo em português sem acentos, OU de lexemas, só versões atuais das
 * fontes em vigor. Não usa vetores: o avaliador não tem embeddings e, para
 * propor gabarito, o Claude ainda pode ir aos sites oficiais. O SQL está
 * copiado (e não importado) porque o avaliador não depende do código da API.
 */
import { bd, type Q } from '../bd.js';

export interface Entidade {
  nome: string;
  tipo: string;
  descricao: string | null;
  site_url: string | null;
}

export interface TrechoContexto {
  titulo: string;
  url: string;
  referencia: string | null;
  entidade: string;
  texto: string;
}

export interface ContactoContexto {
  entidade: string;
  tipo: string;
  rotulo: string | null;
  valor: string;
  horario: unknown;
}

export interface Contexto {
  trechos: TrechoContexto[];
  contactos: ContactoContexto[];
}

/** Trechos e contactos no máximo por pergunta (o prompt não deve crescer sem fim). */
const MAX_TRECHOS = 6;
const MAX_CONTACTOS = 12;
/** Caracteres por trecho: os trechos já vêm partidos pela ingestão; isto é só um travão. */
const MAX_TEXTO_TRECHO = 2000;

const CONSULTA_OU = (n: number) => `
  SELECT string_agg(DISTINCT quote_literal(lexeme), ' | ')::tsquery AS q
  FROM unnest(to_tsvector('pt_unaccent', $${n}))`;

const EM_VIGOR = (a: string) =>
  `(${a}.vigor_desde IS NULL OR ${a}.vigor_desde <= current_date)
   AND (${a}.vigor_ate IS NULL OR ${a}.vigor_ate >= current_date)`;

const VERSAO_ATUAL = `fv.id = (
  SELECT v.id FROM fonte_versoes v
  WHERE v.fonte_id = fo.id AND ${EM_VIGOR('v')}
  ORDER BY v.lida_em DESC LIMIT 1)`;

export function entidadesDoMunicipio(
  municipioId: string,
  q: Q = bd,
): Promise<Entidade[]> {
  return q.query<Entidade>(
    `SELECT nome, tipo, descricao, site_url FROM entidades
     WHERE municipio_id = $1 AND ativo ORDER BY tipo, nome`,
    [municipioId],
  );
}

/**
 * Domínios para restringir a pesquisa web: os `site_url` das entidades, sem
 * `www.` (o `allowed_domains` já cobre os subdomínios). A API aceita no
 * máximo 64.
 */
export function dominiosOficiais(urls: (string | null)[]): string[] {
  const vistos = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    try {
      const host = new URL(
        /^https?:\/\//i.test(u) ? u : `https://${u}`,
      ).hostname
        .toLowerCase()
        .replace(/^www\./, '');
      // Só nomes com ponto: a API rejeita IPs, TLDs soltos e 'localhost'.
      if (host.includes('.') && !/^[\d.]+$/.test(host)) vistos.add(host);
    } catch {
      // URL mal escrito na BD: fica de fora em vez de partir tudo.
    }
  }
  return [...vistos].slice(0, 64);
}

export async function procurarContexto(
  municipioId: string,
  pergunta: string,
  q: Q = bd,
): Promise<Contexto> {
  const [trechos, contactos] = await Promise.all([
    q.query<TrechoContexto>(
      `WITH c AS (${CONSULTA_OU(2)})
       SELECT fo.titulo, fo.url, t.referencia, e.nome AS entidade,
              left(t.texto, ${MAX_TEXTO_TRECHO}) AS texto
       FROM c, trechos t
       JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
       JOIN fontes fo ON fo.id = fv.fonte_id
       JOIN entidades e ON e.id = fo.entidade_id
       WHERE fo.municipio_id = $1 AND e.ativo
         AND t.tsv @@ c.q
         AND ${EM_VIGOR('t')} AND ${VERSAO_ATUAL}
       ORDER BY ts_rank_cd(t.tsv, c.q, 32) DESC
       LIMIT ${MAX_TRECHOS}`,
      [municipioId, pergunta],
    ),
    // Os contactos não têm tsv: o vetor faz-se aqui, com o nome e a
    // descrição da entidade (é por aí que "água" chega à Vimágua).
    q.query<ContactoContexto>(
      `WITH c AS (${CONSULTA_OU(2)}),
       ct AS (
         SELECT e.nome AS entidade, ec.tipo, ec.rotulo, ec.valor, ec.horario,
                to_tsvector('pt_unaccent', e.nome || ' ' || coalesce(e.descricao, '') || ' ' ||
                  coalesce(ec.rotulo, '') || ' ' || ec.tipo) AS tsv
         FROM entidade_contactos ec
         JOIN entidades e ON e.id = ec.entidade_id
         WHERE e.municipio_id = $1 AND e.ativo
       )
       SELECT entidade, tipo, rotulo, valor, horario
       FROM ct, c
       WHERE ct.tsv @@ c.q
       ORDER BY ts_rank_cd(ct.tsv, c.q, 32) DESC, entidade
       LIMIT ${MAX_CONTACTOS}`,
      [municipioId, pergunta],
    ),
  ]);
  return { trechos, contactos };
}
