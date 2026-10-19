import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { IndexacaoService } from './indexacao.service.js';
import { IngestaoService, JOB_INGESTAO } from './ingestao.service.js';
import { FONTE_JSON } from './sql.js';

export const JOB_REINDEXAR = 'reindexar_embeddings';

export interface NovaResposta {
  pergunta_tipo: string;
  tema_id?: string | null;
  texto_voz: string;
  texto_sms?: string | null;
  passa_a_pessoa_quando: string[];
  trechos: string[];
  frases: string[];
}

export interface NovaVersao {
  texto_voz: string;
  texto_sms?: string | null;
  passa_a_pessoa_quando?: string[];
  /** Sem `trechos`, a versão nova cita os mesmos da última. */
  trechos?: string[];
  /** Frases novas a juntar às que a resposta já tem. */
  frases?: string[];
}

export interface NovaFonte {
  entidade_id: string;
  titulo: string;
  tipo: string;
  url: string;
  ler_a_cada_horas: number;
  leitura_automatica: boolean;
}

/** Na V1 só a equipa interna escreve e publica respostas curadas. */
export function exigirEquipaInterna(u: UtilizadorPainel): void {
  if (u.perfil !== 'admin' && u.perfil !== 'equipa_toucamara') {
    throw new ErroApi(
      HttpStatus.FORBIDDEN,
      'so_equipa_interna',
      'Nesta versão só a equipa Tou, Câmara? edita e publica respostas.',
    );
  }
}

/**
 * Conhecimento no painel (secção 5.7): mapa, respostas curadas, perguntas
 * sem resposta, fontes, alterações, contradições e qualidade.
 */
@Injectable()
export class PainelConhecimentoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly auditoria: AuditoriaService,
    private readonly ingestao: IngestaoService,
    private readonly indexacao: IndexacaoService,
  ) {}

  // -------------------------------------------------------------------------
  // Mapa
  // -------------------------------------------------------------------------

  /** Mosaico: temas com conversas dos últimos 30 dias e respostas no ar. */
  async mapa(municipioId: string) {
    const [temas, [resumo]] = await Promise.all([
      this.db.query(
        `SELECT t.id AS tema_id, t.nome, t.pai_id,
                (SELECT count(*) FROM conversas c
                 WHERE c.tema_id = t.id AND c.iniciada_em > now() - interval '30 days')::int AS conversas_30d,
                (SELECT count(*) FROM respostas r
                 WHERE r.tema_id = t.id AND r.estado = 'no_ar')::int AS respostas_no_ar,
                (SELECT count(*) FROM respostas r
                 WHERE r.tema_id = t.id AND r.estado <> 'arquivada')::int AS respostas_total
         FROM temas t
         WHERE t.municipio_id = $1
         ORDER BY conversas_30d DESC, t.nome`,
        [municipioId],
      ),
      this.db.query(
        `SELECT
           (SELECT count(*) FROM respostas WHERE municipio_id = $1 AND estado = 'no_ar')::int AS respostas_no_ar,
           (SELECT count(*) FROM perguntas_sem_resposta
            WHERE municipio_id = $1 AND estado IN ('nova', 'com_equipa', 'espera_camara'))::int AS sem_resposta_abertas,
           (SELECT count(*) FROM fontes WHERE municipio_id = $1)::int AS fontes,
           (SELECT count(*) FROM fontes WHERE municipio_id = $1 AND estado = 'erro')::int AS fontes_com_erro,
           (SELECT count(*) FROM alteracoes a JOIN fontes f ON f.id = a.fonte_id
            WHERE f.municipio_id = $1 AND a.estado = 'por_rever')::int AS alteracoes_por_rever,
           (SELECT count(*) FROM contradicoes WHERE municipio_id = $1 AND estado <> 'resolvida')::int AS contradicoes_abertas`,
        [municipioId],
      ),
    ]);
    return { temas, resumo };
  }

  // -------------------------------------------------------------------------
  // Respostas curadas
  // -------------------------------------------------------------------------

  async respostas(
    municipioId: string,
    f: { estado?: string; tema_id?: string; q?: string },
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<{ id: string; atualizada_em: Date }>(
      `WITH r AS (
         SELECT r.id, r.pergunta_tipo, r.tema_id, tm.nome AS tema, r.estado,
                r.versao_no_ar_id, r.usos_30d,
                coalesce((SELECT max(criada_em) FROM resposta_versoes WHERE resposta_id = r.id),
                         'epoch'::timestamptz) AS atualizada_em,
                (SELECT count(*) FROM resposta_versoes WHERE resposta_id = r.id)::int AS versoes,
                (SELECT count(*) FROM resposta_frases WHERE resposta_id = r.id)::int AS frases,
                EXISTS (SELECT 1 FROM alteracao_respostas ar
                        WHERE ar.resposta_id = r.id AND ar.estado = 'proposta') AS por_rever
         FROM respostas r
         LEFT JOIN temas tm ON tm.id = r.tema_id
         WHERE r.municipio_id = $1
           AND ($2::text IS NULL OR r.estado = $2)
           AND ($3::uuid IS NULL OR r.tema_id = $3)
           AND ($4::text IS NULL OR r.pergunta_tipo ILIKE '%' || $4 || '%')
       )
       SELECT * FROM r
       WHERE ($5::timestamptz IS NULL OR (atualizada_em, id) < ($5::timestamptz, $6::uuid))
       ORDER BY atualizada_em DESC, id DESC
       LIMIT $7`,
      [
        municipioId,
        f.estado ?? null,
        f.tema_id ?? null,
        f.q ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: l.atualizada_em, id: l.id }));
  }

  /** Uma resposta com versões (e fontes de cada uma), frases e usos. */
  async resposta(municipioId: string, id: string) {
    const [r] = await this.db.query<{
      id: string;
      pergunta_tipo: string;
      tema_id: string | null;
      tema: string | null;
      estado: string;
      versao_no_ar_id: string | null;
      usos_30d: number;
    }>(
      `SELECT r.id, r.pergunta_tipo, r.tema_id, tm.nome AS tema, r.estado,
              r.versao_no_ar_id, r.usos_30d
       FROM respostas r LEFT JOIN temas tm ON tm.id = r.tema_id
       WHERE r.id = $1 AND r.municipio_id = $2`,
      [id, municipioId],
    );
    if (!r) throw naoEncontrada('resposta');

    const [versoes, frases, [usos], conversas, alteracoes] = await Promise.all([
      this.db.query(
        `SELECT rv.id, rv.numero, rv.texto_voz, rv.texto_sms, rv.passa_a_pessoa_quando,
                rv.criada_em, rv.publicada_em, rv.eval_execucao_id,
                u.nome AS criada_por,
                coalesce((
                  SELECT jsonb_agg(${FONTE_JSON} || jsonb_build_object(
                           'texto', t.texto,
                           'vigor_ate', coalesce(t.vigor_ate, fv.vigor_ate)) ORDER BY fo.titulo, t.ordem)
                  FROM resposta_fontes rf
                  JOIN trechos t ON t.id = rf.trecho_id
                  JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
                  JOIN fontes fo ON fo.id = fv.fonte_id
                  JOIN entidades e ON e.id = fo.entidade_id
                  WHERE rf.resposta_versao_id = rv.id), '[]') AS fontes
         FROM resposta_versoes rv
         LEFT JOIN utilizadores u ON u.id = rv.criada_por
         WHERE rv.resposta_id = $1
         ORDER BY rv.numero DESC`,
        [id],
      ),
      this.db.query(
        `SELECT id, frase, embedding IS NOT NULL AS com_vetor
         FROM resposta_frases WHERE resposta_id = $1 ORDER BY frase`,
        [id],
      ),
      this.db.query<{ ultimos_30_dias: number }>(
        `SELECT count(*)::int AS ultimos_30_dias
         FROM conversa_momentos m JOIN conversas c ON c.id = m.conversa_id
         WHERE m.tipo = 'resposta_com_fonte' AND m.dados -> 'respostas' ? $1
           AND c.municipio_id = $2 AND c.iniciada_em > now() - interval '30 days'`,
        [id, municipioId],
      ),
      this.db.query(
        `SELECT DISTINCT ON (c.iniciada_em, c.id) c.id AS conversa_id, c.canal,
                c.iniciada_em, c.resultado
         FROM conversa_momentos m JOIN conversas c ON c.id = m.conversa_id
         WHERE m.tipo = 'resposta_com_fonte' AND m.dados -> 'respostas' ? $1
           AND c.municipio_id = $2
         ORDER BY c.iniciada_em DESC, c.id DESC
         LIMIT 10`,
        [id, municipioId],
      ),
      this.db.query(
        `SELECT a.id AS alteracao_id, a.resumo, a.detetada_em, ar.estado,
                ar.proposta_versao_id, fo.titulo AS fonte
         FROM alteracao_respostas ar
         JOIN alteracoes a ON a.id = ar.alteracao_id
         JOIN fontes fo ON fo.id = a.fonte_id
         WHERE ar.resposta_id = $1
         ORDER BY a.detetada_em DESC LIMIT 10`,
        [id],
      ),
    ]);
    return {
      ...r,
      versoes,
      frases,
      usos: { ultimos_30_dias: usos?.ultimos_30_dias ?? 0, conversas },
      alteracoes,
    };
  }

  /**
   * Resposta nova: versão 1 em rascunho, fontes e frases. A própria
   * `pergunta_tipo` entra também como frase (é a forma canónica de perguntar).
   */
  async criarResposta(
    municipioId: string,
    u: UtilizadorPainel,
    d: NovaResposta,
  ) {
    const frases = semRepetidas([d.pergunta_tipo, ...d.frases]);
    const r = await this.db.transaction(async (tx) => {
      if (d.tema_id) await this.verificarTema(tx, municipioId, d.tema_id);
      await this.verificarTrechos(tx, municipioId, d.trechos);
      const [resp] = await tx.query<{ id: string }>(
        `INSERT INTO respostas (municipio_id, pergunta_tipo, tema_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [municipioId, d.pergunta_tipo, d.tema_id ?? null],
      );
      const versaoId = await this.inserirVersao(tx, resp.id, u.id, {
        texto_voz: d.texto_voz,
        texto_sms: d.texto_sms ?? null,
        passa_a_pessoa_quando: d.passa_a_pessoa_quando,
        trechos: d.trechos,
      });
      const ids = await this.inserirFrases(tx, resp.id, frases);
      return { id: resp.id, versao_id: versaoId, frases: ids };
    });
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'criar',
      objetoTipo: 'resposta',
      objetoId: r.id,
    });
    await this.indexacao.tentar(
      () => this.indexacao.vetorizarFrases(r.frases),
      `frases da resposta ${r.id}`,
    );
    return this.resposta(municipioId, r.id);
  }

  async novaVersao(
    municipioId: string,
    u: UtilizadorPainel,
    respostaId: string,
    d: NovaVersao,
  ) {
    const r = await this.db.transaction(async (tx) => {
      const [resp] = await tx.query<{ id: string }>(
        `SELECT id FROM respostas WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [respostaId, municipioId],
      );
      if (!resp) throw naoEncontrada('resposta');
      const [ultima] = await tx.query<{
        id: string;
        passa_a_pessoa_quando: string[];
      }>(
        `SELECT id, passa_a_pessoa_quando FROM resposta_versoes
         WHERE resposta_id = $1 ORDER BY numero DESC LIMIT 1`,
        [respostaId],
      );
      let trechos = d.trechos;
      if (trechos) {
        await this.verificarTrechos(tx, municipioId, trechos);
      } else if (ultima) {
        trechos = (
          await tx.query<{ trecho_id: string }>(
            `SELECT trecho_id FROM resposta_fontes WHERE resposta_versao_id = $1`,
            [ultima.id],
          )
        ).map((x) => x.trecho_id);
      }
      const versaoId = await this.inserirVersao(tx, respostaId, u.id, {
        texto_voz: d.texto_voz,
        texto_sms: d.texto_sms ?? null,
        passa_a_pessoa_quando:
          d.passa_a_pessoa_quando ?? ultima?.passa_a_pessoa_quando ?? [],
        trechos: trechos ?? [],
      });
      const existentes = (
        await tx.query<{ frase: string }>(
          `SELECT frase FROM resposta_frases WHERE resposta_id = $1`,
          [respostaId],
        )
      ).map((x) => x.frase.toLowerCase());
      const ids = await this.inserirFrases(
        tx,
        respostaId,
        semRepetidas(d.frases ?? []).filter(
          (f) => !existentes.includes(f.toLowerCase()),
        ),
      );
      return { versao_id: versaoId, frases: ids };
    });
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'nova_versao',
      objetoTipo: 'resposta',
      objetoId: respostaId,
      dados: { versao_id: r.versao_id },
    });
    await this.indexacao.tentar(
      () => this.indexacao.vetorizarFrases(r.frases),
      `frases da resposta ${respostaId}`,
    );
    return this.resposta(municipioId, respostaId);
  }

  /**
   * Põe uma versão no ar. Sem runner de evals ainda: publica direto (só a
   * equipa interna). Quando houver `correr_evals`, isto passa a criar a
   * execução com motivo 'publicacao' e só publica se `passou`
   * (secção 6.3), guardando `eval_execucao_id` na versão.
   */
  async publicar(
    municipioId: string,
    u: UtilizadorPainel,
    respostaId: string,
    versaoId: string,
  ) {
    await this.db.transaction(async (tx) => {
      const ok = await this.publicarVersao(
        tx,
        municipioId,
        respostaId,
        versaoId,
      );
      if (!ok) throw naoEncontrada('versão');
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'publicar',
          objetoTipo: 'resposta',
          objetoId: respostaId,
          dados: { versao_id: versaoId },
        },
        tx,
      );
    });
    return this.resposta(municipioId, respostaId);
  }

  private async publicarVersao(
    tx: Tx,
    municipioId: string,
    respostaId: string,
    versaoId: string,
  ): Promise<boolean> {
    const [v] = await tx.query<{ id: string }>(
      `UPDATE resposta_versoes rv SET publicada_em = coalesce(rv.publicada_em, now())
       FROM respostas r
       WHERE rv.id = $1 AND rv.resposta_id = $2 AND r.id = rv.resposta_id AND r.municipio_id = $3
       RETURNING rv.id`,
      [versaoId, respostaId, municipioId],
    );
    if (!v) return false;
    await tx.query(
      `UPDATE respostas SET versao_no_ar_id = $2, estado = 'no_ar' WHERE id = $1`,
      [respostaId, versaoId],
    );
    return true;
  }

  private async inserirVersao(
    tx: Tx,
    respostaId: string,
    utilizadorId: string,
    v: {
      texto_voz: string;
      texto_sms: string | null;
      passa_a_pessoa_quando: string[];
      trechos: string[];
    },
  ): Promise<string> {
    const [nova] = await tx.query<{ id: string }>(
      `INSERT INTO resposta_versoes (resposta_id, numero, texto_voz, texto_sms, passa_a_pessoa_quando, criada_por)
       SELECT $1, coalesce(max(numero), 0) + 1, $2, $3, $4, $5
       FROM resposta_versoes WHERE resposta_id = $1
       RETURNING id`,
      [
        respostaId,
        v.texto_voz,
        v.texto_sms,
        v.passa_a_pessoa_quando,
        utilizadorId,
      ],
    );
    if (v.trechos.length) {
      await tx.query(
        `INSERT INTO resposta_fontes (resposta_versao_id, trecho_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [nova.id, v.trechos],
      );
    }
    return nova.id;
  }

  private async inserirFrases(
    tx: Tx,
    respostaId: string,
    frases: string[],
  ): Promise<string[]> {
    if (!frases.length) return [];
    const ids = await tx.query<{ id: string }>(
      `INSERT INTO resposta_frases (resposta_id, frase)
       SELECT $1, unnest($2::text[]) RETURNING id`,
      [respostaId, frases],
    );
    return ids.map((x) => x.id);
  }

  private async verificarTrechos(
    tx: Tx,
    municipioId: string,
    trechos: string[],
  ): Promise<void> {
    if (!trechos.length) return;
    const unicos = [...new Set(trechos)];
    const [{ n }] = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM trechos t
       JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
       JOIN fontes fo ON fo.id = fv.fonte_id
       WHERE t.id = ANY($1::uuid[]) AND fo.municipio_id = $2`,
      [unicos, municipioId],
    );
    if (n !== unicos.length) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'trechos_invalidos',
        'Há trechos que não existem ou não são deste município.',
      );
    }
  }

  private async verificarTema(
    tx: Tx,
    municipioId: string,
    temaId: string,
  ): Promise<void> {
    const [t] = await tx.query(
      `SELECT 1 FROM temas WHERE id = $1 AND municipio_id = $2`,
      [temaId, municipioId],
    );
    if (!t) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'tema_invalido',
        'Tema desconhecido.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Perguntas sem resposta
  // -------------------------------------------------------------------------

  /** Por `vezes` desc; o cursor leva `vezes` no campo `em`. */
  async semResposta(
    municipioId: string,
    estado: string | undefined,
    limite: number,
    cursor: Cursor | null,
  ) {
    const vezes = cursor ? parseInt(cursor.em, 10) : null;
    const linhas = await this.db.query<{ id: string; vezes: number }>(
      `SELECT p.id, p.texto, p.vezes, p.primeira_em, p.ultima_em, p.estado,
              p.o_que_falta, p.resposta_id, r.pergunta_tipo AS resposta
       FROM perguntas_sem_resposta p
       LEFT JOIN respostas r ON r.id = p.resposta_id
       WHERE p.municipio_id = $1
         AND ($2::text IS NULL OR p.estado = $2)
         AND ($3::int IS NULL OR (p.vezes, p.id) < ($3::int, $4::uuid))
       ORDER BY p.vezes DESC, p.id DESC
       LIMIT $5`,
      [
        municipioId,
        estado ?? null,
        Number.isFinite(vezes) ? vezes : null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: String(l.vezes), id: l.id }));
  }

  async atualizarSemResposta(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: {
      estado?: string;
      o_que_falta?: string | null;
      resposta_id?: string | null;
    },
  ) {
    if (d.resposta_id) {
      const [r] = await this.db.query(
        `SELECT 1 FROM respostas WHERE id = $1 AND municipio_id = $2`,
        [d.resposta_id, municipioId],
      );
      if (!r) throw naoEncontrada('resposta');
    }
    const [p] = await this.db.query(
      `UPDATE perguntas_sem_resposta SET
         estado = coalesce($3, estado),
         o_que_falta = CASE WHEN $4 THEN $5 ELSE o_que_falta END,
         resposta_id = CASE WHEN $6 THEN $7::uuid ELSE resposta_id END
       WHERE id = $1 AND municipio_id = $2
       RETURNING id, texto, vezes, primeira_em, ultima_em, estado, o_que_falta, resposta_id`,
      [
        id,
        municipioId,
        d.estado ?? null,
        d.o_que_falta !== undefined,
        d.o_que_falta ?? null,
        d.resposta_id !== undefined,
        d.resposta_id ?? null,
      ],
    );
    if (!p) throw naoEncontrada('pergunta');
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'atualizar',
      objetoTipo: 'pergunta_sem_resposta',
      objetoId: id,
      dados: d,
    });
    return p;
  }

  // -------------------------------------------------------------------------
  // Fontes
  // -------------------------------------------------------------------------

  async fontes(
    municipioId: string,
    f: { estado?: string; entidade_id?: string },
  ) {
    const [itens, [ultima]] = await Promise.all([
      this.db.query(
        `SELECT fo.id, fo.titulo, fo.tipo, fo.url, fo.estado, fo.erro,
                fo.ultima_leitura_em, fo.leitura_automatica,
                (extract(epoch FROM fo.ler_a_cada) / 3600)::int AS ler_a_cada_horas,
                CASE WHEN fo.leitura_automatica
                     THEN coalesce(fo.ultima_leitura_em + fo.ler_a_cada, now()) END AS proxima_leitura_em,
                fo.entidade_id, e.nome AS entidade,
                (SELECT count(*) FROM fonte_versoes v WHERE v.fonte_id = fo.id)::int AS versoes,
                (SELECT count(*) FROM alteracoes a
                 WHERE a.fonte_id = fo.id AND a.estado = 'por_rever')::int AS alteracoes_por_rever
         FROM fontes fo JOIN entidades e ON e.id = fo.entidade_id
         WHERE fo.municipio_id = $1
           AND ($2::text IS NULL OR fo.estado = $2)
           AND ($3::uuid IS NULL OR fo.entidade_id = $3)
         ORDER BY (fo.estado = 'erro') DESC, (fo.estado = 'mudou') DESC, e.nome, fo.titulo
         LIMIT 1000`,
        [municipioId, f.estado ?? null, f.entidade_id ?? null],
      ),
      this.db.query(
        `SELECT id, iniciada_em, terminada_em, fontes_lidas, mudancas, erros, detalhes
         FROM ingestoes WHERE municipio_id = $1 ORDER BY iniciada_em DESC LIMIT 1`,
        [municipioId],
      ),
    ]);
    return { itens, ultima_ingestao: ultima ?? null };
  }

  async criarFonte(municipioId: string, u: UtilizadorPainel, d: NovaFonte) {
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
    const [f] = await this.db.query<{ id: string }>(
      `INSERT INTO fontes (municipio_id, entidade_id, titulo, tipo, url, ler_a_cada, leitura_automatica)
       VALUES ($1, $2, $3, $4, $5, make_interval(hours => $6), $7)
       ON CONFLICT (municipio_id, url) DO NOTHING
       RETURNING id`,
      [
        municipioId,
        d.entidade_id,
        d.titulo,
        d.tipo,
        d.url,
        d.ler_a_cada_horas,
        d.leitura_automatica,
      ],
    );
    if (!f) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'fonte_repetida',
        'Já existe uma fonte com este endereço.',
      );
    }
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'criar',
      objetoTipo: 'fonte',
      objetoId: f.id,
    });
    if (d.leitura_automatica) await this.lerFonte(municipioId, f.id);
    return this.fonte(municipioId, f.id);
  }

  async fonte(municipioId: string, id: string) {
    const [f] = await this.db.query(
      `SELECT fo.id, fo.titulo, fo.tipo, fo.url, fo.estado, fo.erro, fo.ultima_leitura_em,
              fo.leitura_automatica, (extract(epoch FROM fo.ler_a_cada) / 3600)::int AS ler_a_cada_horas,
              fo.entidade_id, e.nome AS entidade
       FROM fontes fo JOIN entidades e ON e.id = fo.entidade_id
       WHERE fo.id = $1 AND fo.municipio_id = $2`,
      [id, municipioId],
    );
    if (!f) throw naoEncontrada('fonte');
    return f;
  }

  /** "Ler agora": põe na fila já, mesmo que não esteja vencida. */
  async lerFonte(municipioId: string, id: string) {
    await this.fonte(municipioId, id);
    const job = await this.jobs.enviar(
      JOB_INGESTAO,
      { municipio_id: municipioId, fonte_id: id, forcar: true },
      { singletonKey: `ler:${id}` },
    );
    return { em_fila: job !== null };
  }

  /** Todas as fontes vencidas do município, já. */
  async lerVencidas(municipioId: string) {
    const job = await this.jobs.enviar(
      JOB_INGESTAO,
      { municipio_id: municipioId },
      { singletonKey: `ingestao:${municipioId}` },
    );
    return { em_fila: job !== null };
  }

  /** Texto colado à mão (PDFs, sites que bloqueiam): o mesmo caminho da leitura. */
  async colarTexto(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: {
      texto: string;
      vigor_desde?: string | null;
      vigor_ate?: string | null;
    },
  ) {
    await this.fonte(municipioId, id);
    const r = await this.ingestao.registarTexto(id, d.texto, {
      vigorDesde: d.vigor_desde ?? null,
      vigorAte: d.vigor_ate ?? null,
    });
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'colar_texto',
      objetoTipo: 'fonte',
      objetoId: id,
      dados: { versao_id: r.versao_id, mudou: r.mudou },
    });
    return r;
  }

  // -------------------------------------------------------------------------
  // Alterações
  // -------------------------------------------------------------------------

  async alteracoes(
    municipioId: string,
    estado: string | undefined,
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<{ id: string; detetada_em: Date }>(
      `SELECT a.id, a.fonte_id, fo.titulo AS fonte, e.nome AS entidade, a.resumo,
              a.detetada_em, a.estado, u.nome AS aprovada_por,
              (SELECT count(*) FROM alteracao_respostas ar WHERE ar.alteracao_id = a.id)::int AS respostas_afetadas,
              (SELECT count(*) FROM alteracao_respostas ar
               WHERE ar.alteracao_id = a.id AND ar.proposta_versao_id IS NOT NULL)::int AS propostas
       FROM alteracoes a
       JOIN fontes fo ON fo.id = a.fonte_id
       JOIN entidades e ON e.id = fo.entidade_id
       LEFT JOIN utilizadores u ON u.id = a.aprovada_por
       WHERE fo.municipio_id = $1
         AND ($2::text IS NULL OR a.estado = $2)
         AND ($3::timestamptz IS NULL OR (a.detetada_em, a.id) < ($3::timestamptz, $4::uuid))
       ORDER BY a.detetada_em DESC, a.id DESC
       LIMIT $5`,
      [
        municipioId,
        estado ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: l.detetada_em, id: l.id }));
  }

  /** Uma alteração com o diff e as respostas afetadas (texto atual e proposto). */
  async alteracao(municipioId: string, id: string) {
    const [a] = await this.db.query(
      `SELECT a.id, a.fonte_id, fo.titulo AS fonte, fo.url, e.nome AS entidade, a.resumo,
              a.diff, a.detetada_em, a.estado, u.nome AS aprovada_por,
              a.versao_anterior_id, va.lida_em AS anterior_lida_em,
              a.versao_nova_id, vn.lida_em AS nova_lida_em,
              vn.vigor_desde, vn.vigor_ate
       FROM alteracoes a
       JOIN fontes fo ON fo.id = a.fonte_id
       JOIN entidades e ON e.id = fo.entidade_id
       JOIN fonte_versoes vn ON vn.id = a.versao_nova_id
       LEFT JOIN fonte_versoes va ON va.id = a.versao_anterior_id
       LEFT JOIN utilizadores u ON u.id = a.aprovada_por
       WHERE a.id = $1 AND fo.municipio_id = $2`,
      [id, municipioId],
    );
    if (!a) throw naoEncontrada('alteração');
    const respostas = await this.db.query(
      `SELECT ar.resposta_id, r.pergunta_tipo, ar.estado,
              atual.texto_voz AS texto_atual, ar.proposta_versao_id,
              p.texto_voz AS texto_proposto, p.texto_sms AS sms_proposto
       FROM alteracao_respostas ar
       JOIN respostas r ON r.id = ar.resposta_id
       LEFT JOIN resposta_versoes atual ON atual.id = r.versao_no_ar_id
       LEFT JOIN resposta_versoes p ON p.id = ar.proposta_versao_id
       WHERE ar.alteracao_id = $1
       ORDER BY r.pergunta_tipo`,
      [id],
    );
    return { ...a, respostas };
  }

  /**
   * Aprovar: a alteração fica vista e as propostas (menos as de `rejeitar`)
   * vão para o ar. Publicar respostas é só da equipa interna (V1); sem
   * propostas prontas basta o recurso 'conhecimento'. Afetadas ainda sem
   * proposta ficam 'proposta' (continuam marcadas para rever na resposta).
   */
  async aprovar(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    rejeitar: string[],
  ) {
    await this.db.transaction(async (tx) => {
      const a = await this.bloquearAlteracao(tx, municipioId, id);
      const propostas = await tx.query<{
        resposta_id: string;
        proposta_versao_id: string | null;
      }>(
        `SELECT resposta_id, proposta_versao_id FROM alteracao_respostas
         WHERE alteracao_id = $1 AND estado = 'proposta'`,
        [id],
      );
      const publicar = propostas.filter(
        (p) => p.proposta_versao_id && !rejeitar.includes(p.resposta_id),
      );
      if (publicar.length) exigirEquipaInterna(u);

      for (const p of publicar) {
        await this.publicarVersao(
          tx,
          municipioId,
          p.resposta_id,
          p.proposta_versao_id!,
        );
      }
      await tx.query(
        `UPDATE alteracao_respostas SET estado = CASE
           WHEN resposta_id = ANY($2::uuid[]) THEN 'rejeitada'
           WHEN proposta_versao_id IS NOT NULL THEN 'aprovada'
           ELSE estado END
         WHERE alteracao_id = $1 AND estado = 'proposta'`,
        [id, rejeitar],
      );
      await tx.query(
        `UPDATE alteracoes SET estado = 'aprovada', aprovada_por = $2 WHERE id = $1`,
        [id, u.id],
      );
      await this.atualizarEstadoFonte(tx, a.fonte_id);
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'aprovar',
          objetoTipo: 'alteracao',
          objetoId: id,
          dados: {
            publicadas: publicar.map((p) => p.proposta_versao_id),
            rejeitadas: rejeitar,
          },
        },
        tx,
      );
    });
    return this.alteracao(municipioId, id);
  }

  async ignorar(municipioId: string, u: UtilizadorPainel, id: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.bloquearAlteracao(tx, municipioId, id);
      await tx.query(
        `UPDATE alteracao_respostas SET estado = 'rejeitada'
         WHERE alteracao_id = $1 AND estado = 'proposta'`,
        [id],
      );
      await tx.query(
        `UPDATE alteracoes SET estado = 'ignorada', aprovada_por = $2 WHERE id = $1`,
        [id, u.id],
      );
      await this.atualizarEstadoFonte(tx, a.fonte_id);
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'ignorar',
          objetoTipo: 'alteracao',
          objetoId: id,
        },
        tx,
      );
    });
    return this.alteracao(municipioId, id);
  }

  private async bloquearAlteracao(tx: Tx, municipioId: string, id: string) {
    const [a] = await tx.query<{ fonte_id: string; estado: string }>(
      `SELECT a.fonte_id, a.estado FROM alteracoes a JOIN fontes fo ON fo.id = a.fonte_id
       WHERE a.id = $1 AND fo.municipio_id = $2 FOR UPDATE OF a`,
      [id, municipioId],
    );
    if (!a) throw naoEncontrada('alteração');
    if (a.estado !== 'por_rever') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'alteracao_ja_revista',
        'Esta alteração já foi revista.',
        { estado: a.estado },
      );
    }
    return a;
  }

  /** 'mudou' enquanto houver alterações por rever; senão 'em_dia' (o erro mantém-se). */
  private async atualizarEstadoFonte(tx: Tx, fonteId: string) {
    await tx.query(
      `UPDATE fontes SET estado = CASE
         WHEN estado = 'erro' THEN 'erro'
         WHEN EXISTS (SELECT 1 FROM alteracoes WHERE fonte_id = $1 AND estado = 'por_rever') THEN 'mudou'
         ELSE 'em_dia' END
       WHERE id = $1`,
      [fonteId],
    );
  }

  // -------------------------------------------------------------------------
  // Contradições e qualidade
  // -------------------------------------------------------------------------

  async contradicoes(
    municipioId: string,
    estado: string | undefined,
    limite: number,
    cursor: Cursor | null,
  ) {
    const lado = (l: string) => `jsonb_build_object(
      'trecho_id', t${l}.id, 'referencia', t${l}.referencia, 'texto', t${l}.texto,
      'fonte', f${l}.titulo, 'url', f${l}.url, 'entidade', e${l}.nome, 'lida_em', v${l}.lida_em)`;
    const juntar = (l: string) => `
      JOIN trechos t${l} ON t${l}.id = c.trecho_${l}_id
      JOIN fonte_versoes v${l} ON v${l}.id = t${l}.fonte_versao_id
      JOIN fontes f${l} ON f${l}.id = v${l}.fonte_id
      JOIN entidades e${l} ON e${l}.id = f${l}.entidade_id`;
    const linhas = await this.db.query<{ id: string; detetada_em: Date }>(
      `SELECT c.id, c.assunto, c.valor_a, c.valor_b, c.usar, c.estado, c.detetada_em,
              ${lado('a')} AS a, ${lado('b')} AS b
       FROM contradicoes c
       ${juntar('a')}
       ${juntar('b')}
       WHERE c.municipio_id = $1
         AND ($2::text IS NULL OR c.estado = $2)
         AND ($3::timestamptz IS NULL OR (c.detetada_em, c.id) < ($3::timestamptz, $4::uuid))
       ORDER BY c.detetada_em DESC, c.id DESC
       LIMIT $5`,
      [
        municipioId,
        estado ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: l.detetada_em, id: l.id }));
  }

  async atualizarContradicao(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: { estado?: string; usar?: string },
  ) {
    const [c] = await this.db.query(
      `UPDATE contradicoes SET estado = coalesce($3, estado), usar = coalesce($4, usar)
       WHERE id = $1 AND municipio_id = $2
       RETURNING id, assunto, valor_a, valor_b, usar, estado, detetada_em`,
      [id, municipioId, d.estado ?? null, d.usar ?? null],
    );
    if (!c) throw naoEncontrada('contradição');
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'atualizar',
      objetoTipo: 'contradicao',
      objetoId: id,
      dados: d,
    });
    return c;
  }

  /** Últimas execuções de evals (vazio enquanto não houver runner). */
  async qualidade(municipioId: string) {
    const execucoes = await this.db.query(
      `SELECT id, agente_versao, motivo, iniciada_em, terminada_em, total, certas,
              passadas_bem, erradas, limiar::float8 AS limiar, taxa::float8 AS taxa, passou
       FROM eval_execucoes WHERE municipio_id = $1
       ORDER BY iniciada_em DESC LIMIT 20`,
      [municipioId],
    );
    return { execucoes };
  }

  async reindexar(municipioId: string, todos: boolean) {
    if (!this.indexacao.disponivel) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'embeddings_desligados',
        'Não há fornecedor de embeddings configurado (EMBEDDINGS_PROVIDER).',
      );
    }
    const job = await this.jobs.enviar(
      JOB_REINDEXAR,
      { municipio_id: municipioId, todos },
      { singletonKey: `reindexar:${municipioId}` },
    );
    return { em_fila: job !== null };
  }
}

function naoEncontrada(o_que: string): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'nao_encontrado',
    `Não encontrei ${o_que}.`,
  );
}

function semRepetidas(frases: string[]): string[] {
  const vistas = new Set<string>();
  return frases
    .map((f) => f.trim())
    .filter((f) => {
      const k = f.toLowerCase();
      if (!f || vistas.has(k)) return false;
      vistas.add(k);
      return true;
    });
}
