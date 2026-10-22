import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PARAMETROS } from './agora.regras.js';

const url = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/\S+$/, 'Um endereço que comece por http:// ou https://.');

const freguesias = z
  .array(z.string().trim().min(2).max(120))
  .max(50)
  .nullable()
  .transform((v) => (v?.length ? [...new Set(v)] : null));

export const esquemaComunicado = z.object({
  tipo: z.enum(['comunicado', 'noticia']),
  titulo: z.string().trim().min(3).max(140),
  texto: z.string().trim().min(3).max(5000),
  imagem_url: url.nullable().optional(),
  /** Vazio ou null = todo o concelho. */
  freguesias: freguesias.optional(),
  /** Publicar logo (senão fica em rascunho). */
  publicar: z.boolean().optional(),
});

export const esquemaEditarComunicado = esquemaComunicado
  .omit({ publicar: true })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Nada para mudar.');

const esquemaEventoBase = z.object({
  titulo: z.string().trim().min(3).max(140),
  descricao: z.string().trim().min(3).max(3000),
  local: z.string().trim().min(2).max(200),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  inicio: z.coerce.date(),
  fim: z.coerce.date().nullable().optional(),
  freguesia: z.string().trim().min(2).max(120).nullable().optional(),
  link: url.nullable().optional(),
  publicar: z.boolean().optional(),
});

const coerente = <
  T extends {
    lat?: number | null;
    lng?: number | null;
    inicio?: Date;
    fim?: Date | null;
  },
>(
  s: z.ZodType<T>,
) =>
  s
    .refine((e) => (e.lat == null) === (e.lng == null), {
      message: 'lat e lng vêm juntos.',
      path: ['lat'],
    })
    .refine(
      (e) => !e.inicio || !e.fim || e.fim.getTime() >= e.inicio.getTime(),
      {
        message: 'O fim tem de ser depois do início.',
        path: ['fim'],
      },
    );

export const esquemaEvento = coerente(esquemaEventoBase);
export const esquemaEditarEvento = coerente(
  esquemaEventoBase.omit({ publicar: true }).partial(),
).refine((e) => Object.keys(e).length > 0, 'Nada para mudar.');

/** Como está para o feed (o `estado` da BD só tem rascunho/publicado). */
export const SITUACOES = [
  'rascunho',
  'publicado',
  'despublicado',
  'expirado',
] as const;
export type Situacao = (typeof SITUACOES)[number];

export const esquemaListaPublicacoes = esquemaPaginacao.extend({
  estado: z.enum(['rascunho', 'publicado']).optional(),
  tipo: z.enum(['comunicado', 'noticia']).optional(),
  /**
   * rascunho (nunca publicado), publicado (está no feed), despublicado
   * (esteve e foi tirado), expirado (publicado mas já saiu do feed).
   */
  situacao: z.enum(SITUACOES).optional(),
  /** Pesquisa no título e no texto. */
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** Para um ILIKE com o que a pessoa escreveu (sem curingas dela). */
function padrao(q: string | undefined): string | null {
  return q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
}

export interface LinhaComunicado {
  id: string;
  tipo: 'comunicado' | 'noticia';
  titulo: string;
  texto: string;
  imagem_url: string | null;
  freguesias: string[] | null;
  estado: 'rascunho' | 'publicado';
  situacao: Situacao;
  publicado_em: Date | null;
  /** Até quando fica no feed (null: nunca publicado). */
  visivel_ate: Date | null;
  criado_por: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

export interface LinhaEvento {
  id: string;
  titulo: string;
  descricao: string;
  local: string;
  lat: number | null;
  lng: number | null;
  inicio: Date;
  fim: Date | null;
  freguesia: string | null;
  link: string | null;
  estado: 'rascunho' | 'publicado';
  situacao: Situacao;
  publicado_em: Date | null;
  /** Até quando fica no feed (o feed mostra o que acabou há poucos dias). */
  visivel_ate: Date;
  criado_por: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

// O feed (agora.service.ts › itens) mostra os comunicados publicados há
// menos de N dias e os eventos que acabaram há menos de N dias: "expirado" é
// o que já saiu do feed por isso.
const DIAS_COMUNICADO = Number(PARAMETROS.comunicado_visivel_dias);
const DIAS_EVENTO = Number(PARAMETROS.janela_passado_dias);

const SITUACAO = (fimVisivel: string) => `CASE
    WHEN estado = 'publicado' AND ${fimVisivel} <= now() THEN 'expirado'
    WHEN estado = 'publicado' THEN 'publicado'
    WHEN publicado_em IS NOT NULL THEN 'despublicado'
    ELSE 'rascunho' END`;

const VISIVEL_COMUNICADO = `publicado_em + make_interval(days => ${DIAS_COMUNICADO})`;
const VISIVEL_EVENTO = `coalesce(fim, inicio) + make_interval(days => ${DIAS_EVENTO})`;

const COLUNAS_COMUNICADO = `id, tipo, titulo, texto, imagem_url, freguesias, estado,
  ${SITUACAO(VISIVEL_COMUNICADO)} AS situacao, publicado_em,
  CASE WHEN publicado_em IS NOT NULL THEN ${VISIVEL_COMUNICADO} END AS visivel_ate,
  criado_por, criado_em, atualizado_em`;
const COLUNAS_EVENTO = `id, titulo, descricao, local, lat, lng, inicio, fim, freguesia,
  link, estado, ${SITUACAO(VISIVEL_EVENTO)} AS situacao, publicado_em,
  ${VISIVEL_EVENTO} AS visivel_ate, criado_por, criado_em, atualizado_em`;

type Qual = 'comunicado' | 'evento';

/**
 * O que a câmara publica à mão no feed: comunicados e notícias (texto,
 * imagem opcional, freguesias ou o concelho todo) e eventos (local, horas).
 * Rascunho → publicado (aparece no feed e nas subscrições) → despublicado.
 */
@Injectable()
export class AgoraPublicacoesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private auditar(
    m: Municipio,
    u: UtilizadorPainel,
    acao: string,
    qual: Qual,
    id: string,
    dados: Record<string, unknown>,
    tx: Tx,
  ) {
    return this.auditoria.registar(
      {
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: `${acao}_${qual}`,
        objetoTipo: qual,
        objetoId: id,
        dados,
      },
      tx,
    );
  }

  private naoExiste(qual: Qual) {
    return new ErroApi(
      HttpStatus.NOT_FOUND,
      `${qual}_nao_encontrado`,
      qual === 'comunicado'
        ? 'Este comunicado não existe.'
        : 'Este evento não existe.',
    );
  }

  // -------------------------------------------------------------------
  // Comunicados e notícias
  // -------------------------------------------------------------------

  async listarComunicados(
    m: Municipio,
    f: z.output<typeof esquemaListaPublicacoes>,
  ) {
    const linhas = await this.db.query<LinhaComunicado>(
      `SELECT * FROM (
         SELECT ${COLUNAS_COMUNICADO} FROM comunicados
         WHERE municipio_id = $1
           AND ($2::text IS NULL OR estado = $2) AND ($3::text IS NULL OR tipo = $3)
           AND ($4::timestamptz IS NULL OR (criado_em, id) < ($4, $5))
           AND ($7::text IS NULL OR titulo ILIKE $7 OR texto ILIKE $7)
       ) c WHERE ($8::text IS NULL OR situacao = $8)
       ORDER BY criado_em DESC, id DESC LIMIT $6`,
      [
        m.id,
        f.estado ?? null,
        f.tipo ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
        padrao(f.q),
        f.situacao ?? null,
      ],
    );
    return pagina(linhas, f.limite, (l) => ({ em: l.criado_em, id: l.id }));
  }

  async comunicado(
    m: Municipio,
    id: string,
    tx?: Tx,
  ): Promise<LinhaComunicado> {
    const [c] = await (tx ?? this.db).query<LinhaComunicado>(
      `SELECT ${COLUNAS_COMUNICADO} FROM comunicados WHERE id = $1 AND municipio_id = $2
       ${tx ? 'FOR UPDATE' : ''}`,
      [id, m.id],
    );
    if (!c) throw this.naoExiste('comunicado');
    return c;
  }

  async criarComunicado(
    m: Municipio,
    u: UtilizadorPainel,
    e: z.output<typeof esquemaComunicado>,
  ) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO comunicados (municipio_id, tipo, titulo, texto, imagem_url, freguesias,
           estado, publicado_em, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'publicado' THEN now() END, $8)
         RETURNING id`,
        [
          m.id,
          e.tipo,
          e.titulo,
          e.texto,
          e.imagem_url ?? null,
          e.freguesias ?? null,
          e.publicar ? 'publicado' : 'rascunho',
          u.id,
        ],
      );
      await this.auditar(
        m,
        u,
        'criar',
        'comunicado',
        c.id,
        { tipo: e.tipo, publicado: !!e.publicar },
        tx,
      );
      if (e.publicar)
        await this.auditar(m, u, 'publicar', 'comunicado', c.id, {}, tx);
      return this.comunicado(m, c.id, tx);
    });
  }

  async editarComunicado(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaEditarComunicado>,
  ) {
    return this.db.transaction(async (tx) => {
      await this.comunicado(m, id, tx);
      await tx.query(
        `UPDATE comunicados SET
           tipo = coalesce($2, tipo), titulo = coalesce($3, titulo), texto = coalesce($4, texto),
           imagem_url = CASE WHEN $5 THEN $6 ELSE imagem_url END,
           freguesias = CASE WHEN $7 THEN $8::text[] ELSE freguesias END,
           atualizado_em = now()
         WHERE id = $1`,
        [
          id,
          e.tipo ?? null,
          e.titulo ?? null,
          e.texto ?? null,
          e.imagem_url !== undefined,
          e.imagem_url ?? null,
          e.freguesias !== undefined,
          e.freguesias ?? null,
        ],
      );
      await this.auditar(
        m,
        u,
        'editar',
        'comunicado',
        id,
        { campos: Object.keys(e) },
        tx,
      );
      return this.comunicado(m, id, tx);
    });
  }

  async estadoComunicado(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    publicar: boolean,
  ) {
    return this.db.transaction(async (tx) => {
      const c = await this.comunicado(m, id, tx);
      if ((c.estado === 'publicado') === publicar) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          publicar ? 'Já está publicado.' : 'Não está publicado.',
          { estado: c.estado },
        );
      }
      await tx.query(
        `UPDATE comunicados SET estado = $2,
           publicado_em = CASE WHEN $2 = 'publicado' THEN now() ELSE publicado_em END,
           atualizado_em = now()
         WHERE id = $1`,
        [id, publicar ? 'publicado' : 'rascunho'],
      );
      await this.auditar(
        m,
        u,
        publicar ? 'publicar' : 'despublicar',
        'comunicado',
        id,
        {},
        tx,
      );
      return this.comunicado(m, id, tx);
    });
  }

  async apagarComunicado(m: Municipio, u: UtilizadorPainel, id: string) {
    await this.db.transaction(async (tx) => {
      const c = await this.comunicado(m, id, tx);
      await tx.query('DELETE FROM comunicados WHERE id = $1', [id]);
      await this.auditar(
        m,
        u,
        'apagar',
        'comunicado',
        id,
        { titulo: c.titulo, estado: c.estado },
        tx,
      );
    });
    return { apagado: true };
  }

  // -------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------

  async listarEventos(
    m: Municipio,
    f: z.output<typeof esquemaListaPublicacoes>,
  ) {
    const linhas = await this.db.query<LinhaEvento>(
      `SELECT * FROM (
         SELECT ${COLUNAS_EVENTO} FROM eventos
         WHERE municipio_id = $1 AND ($2::text IS NULL OR estado = $2)
           AND ($3::timestamptz IS NULL OR (criado_em, id) < ($3, $4))
           AND ($6::text IS NULL OR titulo ILIKE $6 OR descricao ILIKE $6 OR local ILIKE $6)
       ) e WHERE ($7::text IS NULL OR situacao = $7)
       ORDER BY criado_em DESC, id DESC LIMIT $5`,
      [
        m.id,
        f.estado ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
        padrao(f.q),
        f.situacao ?? null,
      ],
    );
    return pagina(linhas, f.limite, (l) => ({ em: l.criado_em, id: l.id }));
  }

  async evento(m: Municipio, id: string, tx?: Tx): Promise<LinhaEvento> {
    const [e] = await (tx ?? this.db).query<LinhaEvento>(
      `SELECT ${COLUNAS_EVENTO} FROM eventos WHERE id = $1 AND municipio_id = $2
       ${tx ? 'FOR UPDATE' : ''}`,
      [id, m.id],
    );
    if (!e) throw this.naoExiste('evento');
    return e;
  }

  async criarEvento(
    m: Municipio,
    u: UtilizadorPainel,
    e: z.output<typeof esquemaEvento>,
  ) {
    return this.db.transaction(async (tx) => {
      const [n] = await tx.query<{ id: string }>(
        `INSERT INTO eventos (municipio_id, titulo, descricao, local, lat, lng, inicio, fim,
           freguesia, link, estado, publicado_em, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           CASE WHEN $11 = 'publicado' THEN now() END, $12)
         RETURNING id`,
        [
          m.id,
          e.titulo,
          e.descricao,
          e.local,
          e.lat ?? null,
          e.lng ?? null,
          e.inicio,
          e.fim ?? null,
          e.freguesia ?? null,
          e.link ?? null,
          e.publicar ? 'publicado' : 'rascunho',
          u.id,
        ],
      );
      await this.auditar(
        m,
        u,
        'criar',
        'evento',
        n.id,
        { publicado: !!e.publicar },
        tx,
      );
      if (e.publicar)
        await this.auditar(m, u, 'publicar', 'evento', n.id, {}, tx);
      return this.evento(m, n.id, tx);
    });
  }

  async editarEvento(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaEditarEvento>,
  ) {
    return this.db.transaction(async (tx) => {
      const atual = await this.evento(m, id, tx);
      const inicio = e.inicio ?? atual.inicio;
      const fim = e.fim !== undefined ? e.fim : atual.fim;
      if (fim && fim.getTime() < inicio.getTime()) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'pedido_invalido',
          'O fim tem de ser depois do início.',
        );
      }
      const temCoords = e.lat !== undefined || e.lng !== undefined;
      await tx.query(
        `UPDATE eventos SET
           titulo = coalesce($2, titulo), descricao = coalesce($3, descricao),
           local = coalesce($4, local),
           lat = CASE WHEN $5 THEN $6 ELSE lat END, lng = CASE WHEN $5 THEN $7 ELSE lng END,
           inicio = $8, fim = $9,
           freguesia = CASE WHEN $10 THEN $11 ELSE freguesia END,
           link = CASE WHEN $12 THEN $13 ELSE link END,
           atualizado_em = now()
         WHERE id = $1`,
        [
          id,
          e.titulo ?? null,
          e.descricao ?? null,
          e.local ?? null,
          temCoords,
          e.lat ?? null,
          e.lng ?? null,
          inicio,
          fim,
          e.freguesia !== undefined,
          e.freguesia ?? null,
          e.link !== undefined,
          e.link ?? null,
        ],
      );
      await this.auditar(
        m,
        u,
        'editar',
        'evento',
        id,
        { campos: Object.keys(e) },
        tx,
      );
      return this.evento(m, id, tx);
    });
  }

  async estadoEvento(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    publicar: boolean,
  ) {
    return this.db.transaction(async (tx) => {
      const e = await this.evento(m, id, tx);
      if ((e.estado === 'publicado') === publicar) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          publicar ? 'Já está publicado.' : 'Não está publicado.',
          { estado: e.estado },
        );
      }
      await tx.query(
        `UPDATE eventos SET estado = $2,
           publicado_em = CASE WHEN $2 = 'publicado' THEN now() ELSE publicado_em END,
           atualizado_em = now()
         WHERE id = $1`,
        [id, publicar ? 'publicado' : 'rascunho'],
      );
      await this.auditar(
        m,
        u,
        publicar ? 'publicar' : 'despublicar',
        'evento',
        id,
        {},
        tx,
      );
      return this.evento(m, id, tx);
    });
  }

  async apagarEvento(m: Municipio, u: UtilizadorPainel, id: string) {
    await this.db.transaction(async (tx) => {
      const e = await this.evento(m, id, tx);
      await tx.query('DELETE FROM eventos WHERE id = $1', [id]);
      await this.auditar(
        m,
        u,
        'apagar',
        'evento',
        id,
        { titulo: e.titulo, estado: e.estado },
        tx,
      );
    });
    return { apagado: true };
  }
}
