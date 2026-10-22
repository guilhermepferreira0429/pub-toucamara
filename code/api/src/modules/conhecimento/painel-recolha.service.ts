import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { JOB_DESCOBRIR } from './descoberta.service.js';
import { proximaLeitura } from './ingestao.service.js';

export interface EdicaoFonte {
  titulo?: string;
  url?: string;
  tipo?: string;
  ler_a_cada_horas?: number;
  leitura_automatica?: boolean;
  seletor?: string | null;
  ignorar_robots?: boolean;
  arquivada?: boolean;
}

export interface NovoSite {
  entidade_id: string;
  titulo: string;
  url_inicial: string;
  sitemap_url?: string | null;
  incluir: string[];
  excluir: string[];
  profundidade: number;
  max_paginas: number;
  tipo_fontes: string;
  ler_a_cada_horas: number;
  descobrir_a_cada_dias: number;
}

export type EdicaoSite = Partial<Omit<NovoSite, 'entidade_id'>> & {
  ativo?: boolean;
};

const SITE_COLUNAS = `s.id, s.titulo, s.url_inicial, s.sitemap_url, s.incluir, s.excluir,
  s.profundidade, s.max_paginas, s.tipo_fontes, s.ativo, s.entidade_id, e.nome AS entidade,
  (extract(epoch FROM s.ler_a_cada) / 3600)::int AS ler_a_cada_horas,
  (extract(epoch FROM s.descobrir_a_cada) / 86400)::int AS descobrir_a_cada_dias,
  s.ultima_descoberta_em, s.proxima_descoberta_em, s.paginas_encontradas, s.erro,
  (SELECT count(*) FROM fontes fo WHERE fo.site_id = s.id AND fo.arquivada_em IS NULL)::int AS fontes`;

/**
 * Painel · Conhecimento · Recolha: a hora diária de leitura do município,
 * editar e arquivar fontes, o histórico das leituras e os sites (descoberta
 * de páginas).
 */
@Injectable()
export class PainelRecolhaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async recolha(municipioId: string) {
    const [r] = await this.db.query<{
      hora_recolha: string;
      fuso: string;
      fontes: number;
      vencidas: number;
      com_erro: number;
      proxima_leitura_em: Date | null;
    }>(
      `SELECT to_char(m.hora_recolha, 'HH24:MI') AS hora_recolha, m.fuso,
              count(fo.id) FILTER (WHERE fo.arquivada_em IS NULL)::int AS fontes,
              count(fo.id) FILTER (WHERE fo.leitura_automatica AND fo.arquivada_em IS NULL
                AND coalesce(fo.proxima_leitura_em, '-infinity') <= now())::int AS vencidas,
              count(fo.id) FILTER (WHERE fo.estado = 'erro' AND fo.arquivada_em IS NULL)::int AS com_erro,
              min(fo.proxima_leitura_em) FILTER (WHERE fo.leitura_automatica AND fo.arquivada_em IS NULL)
                AS proxima_leitura_em
       FROM municipios m LEFT JOIN fontes fo ON fo.municipio_id = m.id
       WHERE m.id = $1 GROUP BY m.id`,
      [municipioId],
    );
    return r;
  }

  /**
   * Nova hora diária. As fontes de um dia ou mais passam para a nova hora no
   * mesmo dia em que estavam marcadas.
   */
  async definirHora(municipioId: string, u: UtilizadorPainel, hora: string) {
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE municipios SET hora_recolha = $2 WHERE id = $1`, [
        municipioId,
        hora,
      ]);
      await tx.query(
        `UPDATE fontes fo SET proxima_leitura_em =
           (date_trunc('day', fo.proxima_leitura_em AT TIME ZONE m.fuso) + m.hora_recolha) AT TIME ZONE m.fuso
         FROM municipios m
         WHERE m.id = fo.municipio_id AND fo.municipio_id = $1
           AND fo.ler_a_cada >= interval '1 day' AND fo.proxima_leitura_em IS NOT NULL`,
        [municipioId],
      );
    });
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'atualizar',
      objetoTipo: 'municipio',
      objetoId: municipioId,
      dados: { hora_recolha: hora },
    });
    return this.recolha(municipioId);
  }

  /**
   * Mudar endereço ou seletor lê a fonte no próximo tick (sem pedido
   * condicional); mudar a periodicidade refaz a próxima leitura a partir da
   * última. Arquivar deixa de ler; as versões e os trechos ficam.
   */
  async editarFonte(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: EdicaoFonte,
  ) {
    const [atual] = await this.db.query<{
      url: string;
      seletor: string | null;
    }>(`SELECT url, seletor FROM fontes WHERE id = $1 AND municipio_id = $2`, [
      id,
      municipioId,
    ]);
    if (!atual) throw naoEncontrada('a fonte');
    const relerJa =
      (d.url !== undefined && d.url !== atual.url) ||
      (d.seletor !== undefined && (d.seletor || null) !== atual.seletor) ||
      d.ignorar_robots === true;
    try {
      await this.db.query(
        `UPDATE fontes fo SET
           titulo = coalesce($3, fo.titulo),
           titulo_automatico = fo.titulo_automatico AND $3::text IS NULL,
           url = coalesce($4, fo.url),
           tipo = coalesce($5, fo.tipo),
           ler_a_cada = coalesce(make_interval(hours => $6), fo.ler_a_cada),
           leitura_automatica = coalesce($7, fo.leitura_automatica),
           seletor = CASE WHEN $8 THEN nullif(trim($9), '') ELSE fo.seletor END,
           ignorar_robots = coalesce($10, fo.ignorar_robots),
           arquivada_em = CASE WHEN $11::boolean IS NULL THEN fo.arquivada_em
                               WHEN $11 THEN coalesce(fo.arquivada_em, now()) END,
           etag = CASE WHEN $12 THEN NULL ELSE fo.etag END,
           ultima_modificacao = CASE WHEN $12 THEN NULL ELSE fo.ultima_modificacao END
         WHERE fo.id = $1 AND fo.municipio_id = $2`,
        [
          id,
          municipioId,
          d.titulo ?? null,
          d.url ?? null,
          d.tipo ?? null,
          d.ler_a_cada_horas ?? null,
          d.leitura_automatica ?? null,
          d.seletor !== undefined,
          d.seletor ?? null,
          d.ignorar_robots ?? null,
          d.arquivada ?? null,
          relerJa,
        ],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'fonte_repetida',
          'Já existe uma fonte com este endereço.',
        );
      }
      throw e;
    }
    await this.db.query(
      `UPDATE fontes fo SET proxima_leitura_em = CASE
         WHEN $2 OR fo.ultima_leitura_em IS NULL THEN now()
         ELSE ${proximaLeitura('fo.ultima_leitura_em')} END
       FROM municipios m WHERE m.id = fo.municipio_id AND fo.id = $1
         AND ($2 OR $3)`,
      [id, relerJa, d.ler_a_cada_horas !== undefined],
    );
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: d.arquivada ? 'arquivar' : 'atualizar',
      objetoTipo: 'fonte',
      objetoId: id,
      dados: { ...d },
    });
    const [f] = await this.db.query(
      `SELECT fo.id, fo.titulo, fo.tipo, fo.url, fo.estado, fo.erro, fo.leitura_automatica,
              (extract(epoch FROM fo.ler_a_cada) / 3600)::int AS ler_a_cada_horas,
              fo.proxima_leitura_em, fo.seletor, fo.ignorar_robots, fo.arquivada_em
       FROM fontes fo WHERE fo.id = $1`,
      [id],
    );
    return f;
  }

  /** As últimas 30 leituras de uma fonte. */
  async leituras(municipioId: string, id: string) {
    const [f] = await this.db.query(
      `SELECT 1 FROM fontes WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId],
    );
    if (!f) throw naoEncontrada('a fonte');
    return this.db.query(
      `SELECT id, iniciada_em, duracao_ms, http_estado, bytes, resultado, codigo_erro, erro, aviso
       FROM fonte_leituras WHERE fonte_id = $1
       ORDER BY iniciada_em DESC LIMIT 30`,
      [id],
    );
  }

  // --- Sites -----------------------------------------------------------------

  sites(municipioId: string) {
    return this.db.query(
      `SELECT ${SITE_COLUNAS}
       FROM fonte_sites s JOIN entidades e ON e.id = s.entidade_id
       WHERE s.municipio_id = $1 ORDER BY s.titulo`,
      [municipioId],
    );
  }

  /** Cria o site e descobre as páginas já. */
  async criarSite(municipioId: string, u: UtilizadorPainel, d: NovoSite) {
    const [e] = await this.db.query(
      `SELECT 1 FROM entidades WHERE id = $1 AND municipio_id = $2`,
      [d.entidade_id, municipioId],
    );
    if (!e) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'entidade_invalida',
        'Entidade desconhecida.',
      );
    }
    const [s] = await this.db.query<{ id: string }>(
      `INSERT INTO fonte_sites (municipio_id, entidade_id, titulo, url_inicial, sitemap_url,
         incluir, excluir, profundidade, max_paginas, tipo_fontes, ler_a_cada, descobrir_a_cada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, make_interval(hours => $11),
         make_interval(days => $12))
       ON CONFLICT (municipio_id, url_inicial) DO NOTHING
       RETURNING id`,
      [
        municipioId,
        d.entidade_id,
        d.titulo,
        d.url_inicial,
        d.sitemap_url ?? null,
        d.incluir,
        d.excluir,
        d.profundidade,
        d.max_paginas,
        d.tipo_fontes,
        d.ler_a_cada_horas,
        d.descobrir_a_cada_dias,
      ],
    );
    if (!s) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'site_repetido',
        'Já existe um site com este endereço.',
      );
    }
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'criar',
      objetoTipo: 'fonte_site',
      objetoId: s.id,
    });
    await this.descobrir(municipioId, s.id);
    return this.site(municipioId, s.id);
  }

  async editarSite(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: EdicaoSite,
  ) {
    await this.site(municipioId, id);
    await this.db.query(
      `UPDATE fonte_sites SET
         titulo = coalesce($3, titulo),
         url_inicial = coalesce($4, url_inicial),
         sitemap_url = CASE WHEN $5 THEN nullif(trim($6), '') ELSE sitemap_url END,
         incluir = coalesce($7, incluir),
         excluir = coalesce($8, excluir),
         profundidade = coalesce($9, profundidade),
         max_paginas = coalesce($10, max_paginas),
         tipo_fontes = coalesce($11, tipo_fontes),
         ler_a_cada = coalesce(make_interval(hours => $12), ler_a_cada),
         descobrir_a_cada = coalesce(make_interval(days => $13), descobrir_a_cada),
         ativo = coalesce($14, ativo)
       WHERE id = $1 AND municipio_id = $2`,
      [
        id,
        municipioId,
        d.titulo ?? null,
        d.url_inicial ?? null,
        d.sitemap_url !== undefined,
        d.sitemap_url ?? null,
        d.incluir ?? null,
        d.excluir ?? null,
        d.profundidade ?? null,
        d.max_paginas ?? null,
        d.tipo_fontes ?? null,
        d.ler_a_cada_horas ?? null,
        d.descobrir_a_cada_dias ?? null,
        d.ativo ?? null,
      ],
    );
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'atualizar',
      objetoTipo: 'fonte_site',
      objetoId: id,
      dados: { ...d },
    });
    return this.site(municipioId, id);
  }

  /** "Procurar páginas agora". */
  async descobrir(municipioId: string, id: string) {
    await this.site(municipioId, id);
    const job = await this.jobs.enviar(
      JOB_DESCOBRIR,
      { site_id: id },
      { singletonKey: `descobrir:${id}` },
    );
    return { em_fila: job !== null };
  }

  private async site(municipioId: string, id: string) {
    const [s] = await this.db.query(
      `SELECT ${SITE_COLUNAS}
       FROM fonte_sites s JOIN entidades e ON e.id = s.entidade_id
       WHERE s.id = $1 AND s.municipio_id = $2`,
      [id, municipioId],
    );
    if (!s) throw naoEncontrada('o site');
    return s;
  }
}

function naoEncontrada(o_que: string): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'nao_encontrado',
    `Não encontrei ${o_que}.`,
  );
}
