import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { erroPublicacao } from './avaliacao.js';
import { AvaliacaoService } from './avaliacao.service.js';
import {
  diffFactos,
  interno,
  origemDe,
  precisaDe,
  Revisao,
  textoDaVersao,
} from './edicao.js';
import { EdicaoService } from './edicao.service.js';
import { IndexacaoService } from './indexacao.service.js';
import { IngestaoService, JOB_INGESTAO } from './ingestao.service.js';
import { EM_VIGOR, FONTE_JSON, INICIO_VIGOR, VERSAO_EM } from './sql.js';

export const JOB_REINDEXAR = 'reindexar_embeddings';

/** Quantas frases reais de uma pergunta sem resposta entram na resposta nova. */
const FRASES_REAIS = 20;

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

/** Uma resposta nova a partir de uma pergunta sem resposta. */
export interface RespostaAPergunta {
  pergunta_tipo?: string;
  tema_id?: string | null;
  texto_voz: string;
  texto_sms?: string | null;
  passa_a_pessoa_quando: string[];
  trechos: string[];
}

/**
 * Só a equipa interna: forçar a publicação, rever versões da câmara, ligar a
 * edição pela câmara, reindexar. (Escrever e publicar respostas: ver
 * `EdicaoService.exigirEdicao`.)
 */
export function exigirEquipaInterna(u: UtilizadorPainel): void {
  if (!interno(u.perfil)) {
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
    private readonly avaliacao: AvaliacaoService,
    private readonly edicao: EdicaoService,
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

    const [versoes, frases, [usos], conversas, alteracoes, gate] =
      await Promise.all([
        this.db.query<{
          id: string;
          numero: number;
          origem: 'equipa' | 'camara';
          muda_factos: boolean;
          revisao: Revisao | null;
          criada_em: Date;
          publicada_em: Date | null;
          no_ar: boolean;
        }>(
          `SELECT rv.id, rv.numero, rv.texto_voz, rv.texto_sms, rv.passa_a_pessoa_quando,
                rv.criada_em, rv.publicada_em, rv.eval_execucao_id,
                u.nome AS criada_por, rv.origem, coalesce(rv.id = $2::uuid, false) AS no_ar,
                rv.muda_factos, rv.factos, rv.reverte_de, rv.revisao, rv.revista_em,
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
          [id, r.versao_no_ar_id],
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
        this.edicao.gate(municipioId),
      ]);
    return {
      ...r,
      versoes: versoes.map((v) => this.edicao.comEstado(v, gate)),
      frases,
      usos: { ultimos_30_dias: usos?.ultimos_30_dias ?? 0, conversas },
      alteracoes,
    };
  }

  /**
   * Resposta nova: versão 1 (rascunho da equipa ou 'em_revisao' da câmara),
   * fontes e frases. A própria `pergunta_tipo` entra também como frase (é a
   * forma canónica de perguntar).
   */
  async criarResposta(
    municipioId: string,
    u: UtilizadorPainel,
    d: NovaResposta,
  ) {
    const r = await this.db.transaction((tx) =>
      this.inserirResposta(tx, municipioId, u, d),
    );
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'criar',
      objetoTipo: 'resposta',
      objetoId: r.id,
      dados: { versao_id: r.versao_id, origem: origemDe(u.perfil) },
    });
    await this.indexacao.tentar(
      () => this.indexacao.vetorizarFrases(r.frases),
      `frases da resposta ${r.id}`,
    );
    return this.resposta(municipioId, r.id);
  }

  private async inserirResposta(
    tx: Tx,
    municipioId: string,
    u: UtilizadorPainel,
    d: NovaResposta,
  ) {
    const frases = semRepetidas([d.pergunta_tipo, ...d.frases]);
    if (d.tema_id) await this.verificarTema(tx, municipioId, d.tema_id);
    await this.verificarTrechos(tx, municipioId, d.trechos);
    const [resp] = await tx.query<{ id: string }>(
      `INSERT INTO respostas (municipio_id, pergunta_tipo, tema_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [municipioId, d.pergunta_tipo, d.tema_id ?? null],
    );
    const versaoId = await this.inserirVersao(tx, resp.id, u, {
      texto_voz: d.texto_voz,
      texto_sms: d.texto_sms ?? null,
      passa_a_pessoa_quando: d.passa_a_pessoa_quando,
      trechos: d.trechos,
    });
    const ids = await this.inserirFrases(tx, resp.id, frases);
    return { id: resp.id, versao_id: versaoId, frases: ids };
  }

  /**
   * "Perguntas sem resposta transformadas em novas respostas": a resposta
   * curada nasce da pergunta (a forma canónica é a `pergunta_tipo`, as frases
   * reais do grupo entram em "as pessoas perguntam assim") e fica ligada a
   * ela. A pergunta só passa a 'resolvida' quando a resposta for para o ar
   * (`publicarVersao`).
   */
  async responderSemResposta(
    municipioId: string,
    u: UtilizadorPainel,
    psrId: string,
    d: RespostaAPergunta,
  ) {
    const r = await this.db.transaction(async (tx) => {
      const [p] = await tx.query<{
        texto: string;
        estado: string;
        resposta_id: string | null;
      }>(
        `SELECT texto, estado, resposta_id FROM perguntas_sem_resposta
         WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [psrId, municipioId],
      );
      if (!p) throw naoEncontrada('pergunta');
      if (p.resposta_id) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'pergunta_ja_tem_resposta',
          'Esta pergunta já está ligada a uma resposta.',
          { resposta_id: p.resposta_id },
        );
      }
      if (p.estado === 'resolvida' || p.estado === 'fora_ambito') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'pergunta_fechada',
          'Esta pergunta já está fechada.',
          { estado: p.estado },
        );
      }
      // Frases reais: os turnos onde a pergunta apareceu, das mais recentes.
      const reais = (
        await tx.query<{ texto: string }>(
          `SELECT t.texto FROM pergunta_sem_resposta_ocorrencias o
           JOIN conversa_turnos t ON t.id = o.turno_id
           WHERE o.psr_id = $1
           ORDER BY t.id DESC LIMIT $2`,
          [psrId, FRASES_REAIS],
        )
      )
        .map((x) => limparFrase(x.texto))
        .filter((x) => x.length >= 2);
      const canonica = limparFrase(p.texto);
      const resp = await this.inserirResposta(tx, municipioId, u, {
        pergunta_tipo: d.pergunta_tipo ?? canonica,
        tema_id: d.tema_id,
        texto_voz: d.texto_voz,
        texto_sms: d.texto_sms,
        passa_a_pessoa_quando: d.passa_a_pessoa_quando,
        trechos: d.trechos,
        frases: [canonica, ...reais],
      });
      await tx.query(
        'UPDATE perguntas_sem_resposta SET resposta_id = $2 WHERE id = $1',
        [psrId, resp.id],
      );
      const ator = {
        municipioId,
        atorTipo: 'utilizador' as const,
        atorId: u.id,
      };
      await this.auditoria.registar(
        {
          ...ator,
          acao: 'criar',
          objetoTipo: 'resposta',
          objetoId: resp.id,
          dados: {
            versao_id: resp.versao_id,
            origem: origemDe(u.perfil),
            pergunta_sem_resposta_id: psrId,
          },
        },
        tx,
      );
      await this.auditoria.registar(
        {
          ...ator,
          acao: 'responder',
          objetoTipo: 'pergunta_sem_resposta',
          objetoId: psrId,
          dados: { resposta_id: resp.id, frases_reais: reais.length },
        },
        tx,
      );
      return resp;
    });
    await this.indexacao.tentar(
      () => this.indexacao.vetorizarFrases(r.frases),
      `frases da resposta ${r.id}`,
    );
    const [pergunta] = await this.db.query(
      `SELECT id, texto, vezes, estado, resposta_id FROM perguntas_sem_resposta WHERE id = $1`,
      [psrId],
    );
    return { pergunta, resposta: await this.resposta(municipioId, r.id) };
  }

  /**
   * Volta a uma versão anterior: cria uma versão nova igual a ela (textos,
   * quando passa a pessoa e fontes), com `reverte_de`. Segue as regras de
   * qualquer versão nova (escrita pela câmara: 'em_revisao').
   */
  async reverter(
    municipioId: string,
    u: UtilizadorPainel,
    respostaId: string,
    versaoId: string,
  ) {
    const novaId = await this.db.transaction(async (tx) => {
      const [resp] = await tx.query(
        `SELECT 1 FROM respostas WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [respostaId, municipioId],
      );
      if (!resp) throw naoEncontrada('resposta');
      const [v] = await tx.query<{
        texto_voz: string;
        texto_sms: string | null;
        passa_a_pessoa_quando: string[];
        trechos: string[];
      }>(
        `SELECT texto_voz, texto_sms, passa_a_pessoa_quando,
                array(SELECT trecho_id FROM resposta_fontes WHERE resposta_versao_id = rv.id) AS trechos
         FROM resposta_versoes rv WHERE id = $1 AND resposta_id = $2`,
        [versaoId, respostaId],
      );
      if (!v) throw naoEncontrada('versão');
      const id = await this.inserirVersao(tx, respostaId, u, {
        ...v,
        reverte_de: versaoId,
      });
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'reverter',
          objetoTipo: 'resposta',
          objetoId: respostaId,
          dados: {
            versao_id: id,
            reverte_de: versaoId,
            origem: origemDe(u.perfil),
          },
        },
        tx,
      );
      return id;
    });
    return {
      ...(await this.resposta(municipioId, respostaId)),
      versao_id: novaId,
    };
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
      const versaoId = await this.inserirVersao(tx, respostaId, u, {
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
      dados: { versao_id: r.versao_id, origem: origemDe(u.perfil) },
    });
    await this.indexacao.tentar(
      () => this.indexacao.vetorizarFrases(r.frases),
      `frases da resposta ${respostaId}`,
    );
    return this.resposta(municipioId, respostaId);
  }

  /**
   * Põe uma versão no ar, se o gate deixar (`exigirAvaliacao`): a versão
   * fica com `eval_execucao_id` da execução que a deixou passar.
   *
   * A câmara (edição ligada no município, nunca `forcar`) só publica quando
   * `precisaDe` está vazio (regras em `edicao.ts`): sem avaliação, o mesmo
   * erro do gate com `detalhes.precisa_de`; com factos mudados por rever,
   * 409 `revisao_interna_em_falta`; versão rejeitada, 409 `versao_rejeitada`.
   * A equipa interna publica como até aqui e, numa versão da câmara ainda
   * sem revisão, publicar conta como a revisão.
   */
  async publicar(
    municipioId: string,
    u: UtilizadorPainel,
    respostaId: string,
    versaoId: string,
    forcar = false,
  ) {
    const daEquipa = interno(u.perfil);
    if (forcar) exigirEquipaInterna(u);
    await this.db.transaction(async (tx) => {
      // 404 antes do gate: não faz sentido pedir uma avaliação para nada.
      const [v] = await tx.query<{
        origem: 'equipa' | 'camara';
        muda_factos: boolean;
        revisao: Revisao | null;
        criada_em: Date;
        factos: unknown;
      }>(
        `SELECT rv.origem, rv.muda_factos, rv.revisao, rv.criada_em, rv.factos
         FROM resposta_versoes rv JOIN respostas r ON r.id = rv.resposta_id
         WHERE rv.id = $1 AND rv.resposta_id = $2 AND r.municipio_id = $3
         FOR UPDATE OF rv`,
        [versaoId, respostaId, municipioId],
      );
      if (!v) throw naoEncontrada('versão');
      if (!daEquipa) {
        await this.edicao.exigirEdicao(municipioId, u, tx);
        await this.exigirRequisitos(tx, municipioId, versaoId, v);
      }
      const execucaoId = await this.exigirAvaliacao(
        tx,
        municipioId,
        u,
        forcar,
        {
          objetoTipo: 'resposta',
          objetoId: respostaId,
          dados: { versao_id: versaoId },
        },
      );
      const ok = await this.publicarVersao(
        tx,
        municipioId,
        respostaId,
        versaoId,
        execucaoId,
      );
      if (!ok) throw naoEncontrada('versão');
      if (daEquipa && v.origem === 'camara' && !v.revisao) {
        await tx.query(
          `UPDATE resposta_versoes SET revisao = 'aprovada', revista_por = $2, revista_em = now(),
                  revisao_nota = 'Publicada pela equipa interna.'
           WHERE id = $1`,
          [versaoId, u.id],
        );
      }
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'publicar',
          objetoTipo: 'resposta',
          objetoId: respostaId,
          dados: daEquipa
            ? { versao_id: versaoId, eval_execucao_id: execucaoId }
            : {
                versao_id: versaoId,
                eval_execucao_id: execucaoId,
                origem: 'camara',
                muda_factos: v.muda_factos,
                revisao: v.revisao,
              },
        },
        tx,
      );
    });
    return this.resposta(municipioId, respostaId);
  }

  /** Publicar pela câmara: tudo o que `precisaDe` pede tem de estar feito. */
  private async exigirRequisitos(
    tx: Tx,
    municipioId: string,
    versaoId: string,
    v: {
      origem: 'equipa' | 'camara';
      muda_factos: boolean;
      revisao: Revisao | null;
      criada_em: Date;
      factos: unknown;
    },
  ): Promise<void> {
    if (v.revisao === 'rejeitada') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'versao_rejeitada',
        'A equipa Tou, Câmara? rejeitou esta versão. Escreva uma versão nova.',
        { versao_id: versaoId },
      );
    }
    const gate = await this.edicao.gate(municipioId, tx);
    const falta = precisaDe(v, gate.atual);
    const d = gate.estado.decisao;
    if (!d.permitir) {
      const e = erroPublicacao(d, gate.estado);
      throw new ErroApi(e.getStatus(), e.codigo, e.message, {
        ...(e.detalhes as object),
        precisa_de: falta,
      });
    }
    if (falta.length) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'revisao_interna_em_falta',
        'Esta versão muda números, prazos ou contactos: precisa da revisão da equipa Tou, Câmara? ou de uma nova avaliação do agente antes de ir para o ar.',
        { versao_id: versaoId, precisa_de: falta, factos: v.factos },
      );
    }
  }

  /**
   * Gate de publicação (spec do avaliador, secção 9). Devolve a execução que
   * deixa publicar; sem ela, 409 `avaliacao_em_falta` ou 422
   * `avaliacao_abaixo_do_limiar`. `forcar` (só equipa interna) publica na
   * mesma, sem execução, e fica na auditoria como 'publicar_sem_avaliacao'.
   */
  private async exigirAvaliacao(
    tx: Tx,
    municipioId: string,
    u: UtilizadorPainel,
    forcar: boolean,
    objeto: {
      objetoTipo: string;
      objetoId: string;
      dados: Record<string, unknown>;
    },
  ): Promise<string | null> {
    const estado = await this.avaliacao.estadoPublicacao(municipioId, tx);
    const d = estado.decisao;
    if (d.permitir) return d.execucao_id;
    if (!forcar) throw erroPublicacao(d, estado);
    exigirEquipaInterna(u);
    await this.auditoria.registar(
      {
        municipioId,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'publicar_sem_avaliacao',
        ...objeto,
        dados: {
          ...objeto.dados,
          motivo: d.motivo,
          causa: d.causa,
          execucao_id: d.execucao_id,
          taxa: d.taxa,
          versao_atual: estado.versao_atual,
        },
      },
      tx,
    );
    return null;
  }

  /**
   * No ar: a versão fica publicada e as perguntas sem resposta abertas
   * ligadas à resposta passam a 'resolvida'.
   */
  private async publicarVersao(
    tx: Tx,
    municipioId: string,
    respostaId: string,
    versaoId: string,
    execucaoId: string | null,
  ): Promise<boolean> {
    const [v] = await tx.query<{ id: string }>(
      `UPDATE resposta_versoes rv SET publicada_em = coalesce(rv.publicada_em, now()),
              eval_execucao_id = $4
       FROM respostas r
       WHERE rv.id = $1 AND rv.resposta_id = $2 AND r.id = rv.resposta_id AND r.municipio_id = $3
       RETURNING rv.id`,
      [versaoId, respostaId, municipioId, execucaoId],
    );
    if (!v) return false;
    await tx.query(
      `UPDATE respostas SET versao_no_ar_id = $2, estado = 'no_ar' WHERE id = $1`,
      [respostaId, versaoId],
    );
    const resolvidas = await tx.query<{ id: string }>(
      `UPDATE perguntas_sem_resposta SET estado = 'resolvida'
       WHERE resposta_id = $1 AND municipio_id = $2
         AND estado IN ('nova', 'com_equipa', 'espera_camara')
       RETURNING id`,
      [respostaId, municipioId],
    );
    for (const p of resolvidas) {
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'sistema',
          acao: 'resolver',
          objetoTipo: 'pergunta_sem_resposta',
          objetoId: p.id,
          dados: { resposta_id: respostaId, versao_id: versaoId },
        },
        tx,
      );
    }
    return true;
  }

  /**
   * Versão nova com quem a escreveu (`origem`) e o diff de factos face à
   * base: a versão no ar, ou a última se nenhuma estiver no ar.
   */
  private async inserirVersao(
    tx: Tx,
    respostaId: string,
    u: UtilizadorPainel,
    v: {
      texto_voz: string;
      texto_sms: string | null;
      passa_a_pessoa_quando: string[];
      trechos: string[];
      reverte_de?: string | null;
    },
  ): Promise<string> {
    const [base] = await tx.query<{
      id: string;
      texto_voz: string;
      texto_sms: string | null;
    }>(
      `SELECT rv.id, rv.texto_voz, rv.texto_sms
       FROM resposta_versoes rv JOIN respostas r ON r.id = rv.resposta_id
       WHERE rv.resposta_id = $1
       ORDER BY (rv.id = r.versao_no_ar_id) IS TRUE DESC, rv.numero DESC
       LIMIT 1`,
      [respostaId],
    );
    const factos = diffFactos(
      base ? textoDaVersao(base) : null,
      textoDaVersao(v),
    );
    const [nova] = await tx.query<{ id: string }>(
      `INSERT INTO resposta_versoes (resposta_id, numero, texto_voz, texto_sms, passa_a_pessoa_quando,
                                     criada_por, origem, base_versao_id, factos, muda_factos, reverte_de)
       SELECT $1, coalesce(max(numero), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       FROM resposta_versoes WHERE resposta_id = $1
       RETURNING id`,
      [
        respostaId,
        v.texto_voz,
        v.texto_sms,
        v.passa_a_pessoa_quando,
        u.id,
        origemDe(u.perfil),
        base?.id ?? null,
        JSON.stringify({
          adicionados: factos.adicionados,
          removidos: factos.removidos,
        }),
        factos.muda,
        v.reverte_de ?? null,
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
    ordem: 'vezes' | 'recentes' = 'vezes',
  ) {
    const colunas = `p.id, p.texto, p.vezes, p.primeira_em, p.ultima_em, p.estado,
              p.o_que_falta, p.resposta_id, r.pergunta_tipo AS resposta`;
    if (ordem === 'recentes') {
      const linhas = await this.db.query<{ id: string; ultima_em: Date }>(
        `SELECT ${colunas}
         FROM perguntas_sem_resposta p
         LEFT JOIN respostas r ON r.id = p.resposta_id
         WHERE p.municipio_id = $1
           AND ($2::text IS NULL OR p.estado = $2)
           AND ($3::timestamptz IS NULL OR (date_trunc('milliseconds', p.ultima_em), p.id) < ($3::timestamptz, $4::uuid))
         ORDER BY date_trunc('milliseconds', p.ultima_em) DESC, p.id DESC
         LIMIT $5`,
        [
          municipioId,
          estado ?? null,
          cursor?.em ?? null,
          cursor?.id ?? null,
          limite + 1,
        ],
      );
      return pagina(linhas, limite, (l) => ({
        em: l.ultima_em.toISOString(),
        id: l.id,
      }));
    }
    const vezes = cursor ? parseInt(cursor.em, 10) : null;
    const linhas = await this.db.query<{ id: string; vezes: number }>(
      `SELECT ${colunas}
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
                (SELECT count(DISTINCT rv.resposta_id) FROM resposta_fontes rf
                 JOIN resposta_versoes rv ON rv.id = rf.resposta_versao_id
                 JOIN trechos t ON t.id = rf.trecho_id
                 JOIN fonte_versoes v ON v.id = t.fonte_versao_id
                 WHERE v.fonte_id = fo.id)::int AS respostas,
                (SELECT count(*) FROM citacoes ci
                 JOIN trechos t ON t.id = ci.trecho_id
                 JOIN fonte_versoes v ON v.id = t.fonte_versao_id
                 WHERE v.fonte_id = fo.id)::int AS citacoes,
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
   * Publicar propostas passa pelo mesmo gate de avaliação que `publicar`.
   */
  async aprovar(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    rejeitar: string[],
    forcar = false,
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
      let execucaoId: string | null = null;
      if (publicar.length) {
        exigirEquipaInterna(u);
        execucaoId = await this.exigirAvaliacao(tx, municipioId, u, forcar, {
          objetoTipo: 'alteracao',
          objetoId: id,
          dados: { versoes: publicar.map((p) => p.proposta_versao_id) },
        });
      }

      for (const p of publicar) {
        await this.publicarVersao(
          tx,
          municipioId,
          p.resposta_id,
          p.proposta_versao_id!,
          execucaoId,
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
            eval_execucao_id: execucaoId,
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

  /** Página "Qualidade": resultados do avaliador para o nosso agente. */
  qualidade(municipioId: string) {
    return this.avaliacao.qualidade(municipioId);
  }

  /** O dia em que o processo entrou (no fuso do município), para "a regra desse dia". */
  async diaDoProcesso(municipioId: string, processoId: string) {
    const [p] = await this.db.query<{ numero: string; dia: string }>(
      `SELECT p.numero,
              to_char((p.criado_em AT TIME ZONE m.fuso)::date, 'YYYY-MM-DD') AS dia
       FROM processos p JOIN municipios m ON m.id = p.municipio_id
       WHERE p.id = $1 AND p.municipio_id = $2`,
      [processoId, municipioId],
    );
    if (!p) throw naoEncontrada('processo');
    return p;
  }

  /** As versões de uma fonte, da mais recente para a mais antiga. */
  async versoesFonte(municipioId: string, fonteId: string) {
    const [fonte] = await this.db.query<{ id: string; titulo: string }>(
      `SELECT id, titulo FROM fontes WHERE id = $1 AND municipio_id = $2`,
      [fonteId, municipioId],
    );
    if (!fonte) throw naoEncontrada('fonte');
    const itens = await this.db.query(
      `SELECT v.id, to_char(${INICIO_VIGOR('v')}, 'YYYY-MM-DD') AS vigor_desde,
              v.vigor_desde IS NOT NULL AS data_legal,
              to_char(v.vigor_ate, 'YYYY-MM-DD') AS vigor_ate,
              v.criada_em, v.lida_em, length(v.texto)::int AS caracteres,
              (SELECT count(*)::int FROM trechos t WHERE t.fonte_versao_id = v.id) AS trechos,
              (v.id = (SELECT x.id FROM fonte_versoes x
                       WHERE x.fonte_id = v.fonte_id AND ${EM_VIGOR('x')}
                       ORDER BY x.lida_em DESC LIMIT 1)) AS atual
       FROM fonte_versoes v WHERE v.fonte_id = $1
       ORDER BY ${INICIO_VIGOR('v')} DESC, v.lida_em DESC`,
      [fonteId],
    );
    return { fonte, itens };
  }

  /** O texto da fonte que valia num dia (404 se a fonte ainda não existia). */
  async fonteEm(municipioId: string, fonteId: string, dia: string) {
    const [v] = await this.db.query(
      `SELECT fo.id AS fonte_id, fo.titulo, fo.url, fv.id AS versao_id,
              to_char(${INICIO_VIGOR('fv')}, 'YYYY-MM-DD') AS vigor_desde,
              to_char(fv.vigor_ate, 'YYYY-MM-DD') AS vigor_ate, fv.texto
       FROM fontes fo JOIN fonte_versoes fv ON ${VERSAO_EM(3)}
       WHERE fo.id = $1 AND fo.municipio_id = $2`,
      [fonteId, municipioId, dia],
    );
    if (!v) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_versao_nessa_data',
        'Não há versão desta fonte em vigor nesse dia (ainda não tinha sido lida ou já estava revogada).',
      );
    }
    return v;
  }

  /** Acerta as datas legais de uma versão (ex.: publicada no DR a 3 de março). */
  async mudarVigencia(
    municipioId: string,
    u: UtilizadorPainel,
    fonteId: string,
    versaoId: string,
    d: { vigor_desde?: string | null; vigor_ate?: string | null },
  ) {
    const [v] = await this.db.query<{ id: string }>(
      `UPDATE fonte_versoes v SET
         vigor_desde = CASE WHEN $4 THEN $5::date ELSE v.vigor_desde END,
         vigor_ate = CASE WHEN $6 THEN $7::date ELSE v.vigor_ate END
       FROM fontes fo
       WHERE v.id = $1 AND v.fonte_id = $2 AND fo.id = v.fonte_id AND fo.municipio_id = $3
       RETURNING v.id`,
      [
        versaoId,
        fonteId,
        municipioId,
        d.vigor_desde !== undefined,
        d.vigor_desde ?? null,
        d.vigor_ate !== undefined,
        d.vigor_ate ?? null,
      ],
    );
    if (!v) throw naoEncontrada('versão');
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_vigencia',
      objetoTipo: 'fonte',
      objetoId: fonteId,
      dados: { versao_id: versaoId, ...d },
    });
    return this.versoesFonte(municipioId, fonteId);
  }

  async pedirAvaliacao(
    municipioId: string,
    u: UtilizadorPainel,
    amostra: boolean,
  ) {
    const p = await this.avaliacao.pedirAvaliacao(municipioId, 'manual', {
      porId: u.id,
      amostra,
    });
    if (!p.ja_havia) {
      await this.auditoria.registar({
        municipioId,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'pedir_avaliacao',
        objetoTipo: 'pedido_avaliacao',
        objetoId: p.id,
        dados: { amostra },
      });
    }
    return p;
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

/** Uma frase dita, numa linha e no máximo com 300 caracteres. */
function limparFrase(t: string): string {
  return t.replace(/\s+/g, ' ').trim().slice(0, 300);
}
