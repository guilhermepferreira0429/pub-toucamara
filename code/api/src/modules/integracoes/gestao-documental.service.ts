import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  Adaptador,
  ADAPTADORES,
  ConfigGestaoDocumental,
  DocumentoGd,
  esperaAposFalha,
  esquemaConfigGd,
  GestaoDocumental,
  MAX_TENTATIVAS,
  mensagemErro,
  ProcessoGd,
} from './gestao-documental.js';
import { GestaoDocumentalSimulada } from './gestao-documental-simulada.js';

type GdEstado = 'nao_aplicavel' | 'por_sincronizar' | 'sincronizado' | 'erro';

/** Ligar a integração mexe no que a câmara recebe: só a equipa interna. */
function exigirEquipaInterna(u: UtilizadorPainel): void {
  if (u.perfil !== 'admin' && u.perfil !== 'equipa_toucamara') {
    throw new ErroApi(
      HttpStatus.FORBIDDEN,
      'so_equipa_interna',
      'Só a equipa Tou, Câmara? liga ou altera a integração com a gestão documental.',
    );
  }
}

/** Documentos do processo ainda por enviar (ou com outro ficheiro desde o envio). */
const DOCUMENTOS_POR_ENVIAR = `
  SELECT d.id, td.nome, d.ficheiro_key, d.mime, d.tamanho, d.origem, d.recebido_em
  FROM documentos d
  LEFT JOIN tipo_processo_documentos td ON td.id = d.tipo_documento_id
  WHERE d.processo_id = $1
    AND NOT EXISTS (SELECT 1 FROM gd_envios e
                    WHERE e.processo_id = d.processo_id AND e.documento_id = d.id
                      AND e.ficheiro_key = d.ficheiro_key)
  ORDER BY d.recebido_em, d.id`;

/** A última fase que o sistema da câmara conhece. */
const ULTIMA_FASE_ENVIADA = `
  SELECT e.fase::text AS fase FROM gd_envios e
  WHERE e.processo_id = %P AND e.tipo IN ('processo','fase')
  ORDER BY e.id DESC LIMIT 1`;

/**
 * Candidatos do job: os por sincronizar (ou com erro) que já podem voltar a
 * tentar, e — rede de segurança dos triggers — os sincronizados com
 * documentos ou fase por enviar.
 */
const CANDIDATOS = `
  SELECT p.id
  FROM processos p
  JOIN gestao_documental_config c ON c.municipio_id = p.municipio_id AND c.adaptador <> 'nenhum'
  LEFT JOIN gd_sincronizacoes s ON s.processo_id = p.id
  WHERE (p.gd_estado IN ('por_sincronizar','erro')
         AND p.gd_tentativas < $1
         AND (s.proxima_tentativa_em IS NULL OR s.proxima_tentativa_em <= now()))
     OR (p.gd_estado = 'sincronizado' AND p.fase <> 'arquivado' AND (
           EXISTS (SELECT 1 FROM documentos d WHERE d.processo_id = p.id
                     AND NOT EXISTS (SELECT 1 FROM gd_envios e
                                     WHERE e.processo_id = p.id AND e.documento_id = d.id
                                       AND e.ficheiro_key = d.ficheiro_key))
        OR p.fase::text IS DISTINCT FROM (${ULTIMA_FASE_ENVIADA.replace('%P', 'p.id')})))
  ORDER BY s.proxima_tentativa_em NULLS FIRST, p.criado_em
  LIMIT $2`;

interface LinhaProcesso {
  id: string;
  municipio_id: string;
  numero: string;
  assunto: string;
  morada: string | null;
  freguesia: string | null;
  fase: string;
  criado_em: Date;
  gd_id: string | null;
  gd_estado: GdEstado;
  gd_tentativas: number;
  tipo_codigo: string;
  tipo_nome: string;
  requerente: string | null;
  adaptador: Adaptador | null;
  taxa_falha: string | null;
}

interface Envio {
  tipo: 'processo' | 'documento' | 'fase';
  documento_id?: string;
  ficheiro_key?: string;
  fase?: string;
  referencia?: string | null;
}

export interface ResultadoSincronizacao {
  processo_id: string;
  gd_id: string | null;
  gd_estado: GdEstado;
  gd_tentativas: number;
  enviados: { processo: boolean; documentos: number; fase: boolean };
  erro: string | null;
  proxima_tentativa_em: Date | null;
}

/**
 * Integração com a gestão documental da câmara: configuração por município,
 * o envio de cada processo (registo, documentos, fases) com reintentos e o
 * estado para o painel.
 *
 * Escritas fora do módulo, mínimas e só em SQL: as colunas gd_* do processo
 * e o evento interno 'sync_erro' na linha do tempo (`processo_eventos`). Os
 * processos novos ficam 'por_sincronizar' por trigger (migração 0030).
 */
@Injectable()
export class GestaoDocumentalService {
  private readonly logger = new Logger(GestaoDocumentalService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** O adaptador configurado; null com 'nenhum'. */
  adaptador(
    municipioId: string,
    cfg: ConfigGestaoDocumental,
  ): GestaoDocumental | null {
    switch (cfg.adaptador) {
      case 'simulado':
        return new GestaoDocumentalSimulada(
          this.db,
          municipioId,
          cfg.taxa_falha,
        );
      case 'nenhum':
        return null;
    }
  }

  // ------------------------------------------------------------------
  // Configuração
  // ------------------------------------------------------------------

  async config(m: Municipio, tx?: Tx) {
    const [c] = await (tx ?? this.db).query<{
      adaptador: Adaptador;
      taxa_falha: string;
      atualizado_em: Date;
      atualizado_por: string | null;
    }>(
      `SELECT adaptador, taxa_falha, atualizado_em, atualizado_por
       FROM gestao_documental_config WHERE municipio_id = $1`,
      [m.id],
    );
    const adaptador = c?.adaptador ?? 'nenhum';
    return {
      adaptador,
      taxa_falha: c ? Number(c.taxa_falha) : 0,
      simulado: adaptador === 'simulado',
      adaptadores_disponiveis: [...ADAPTADORES],
      atualizado_em: c?.atualizado_em ?? null,
      atualizado_por: c?.atualizado_por ?? null,
    };
  }

  /**
   * Ligar marca como 'por_sincronizar' os processos ainda abertos que nunca
   * foram (os novos ficam marcados pelo trigger); desligar devolve a
   * 'nao_aplicavel' os que estavam à espera. Os já sincronizados guardam o
   * gd_id: ao voltar a ligar só seguem as diferenças.
   */
  async guardarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    body: z.output<typeof esquemaConfigGd>,
  ) {
    exigirEquipaInterna(u);
    const marcados = await this.db.transaction(async (tx) => {
      const antes = await this.config(m, tx);
      const taxa =
        body.taxa_falha ??
        (body.adaptador === antes.adaptador ? antes.taxa_falha : 0);
      await tx.query(
        `INSERT INTO gestao_documental_config (municipio_id, adaptador, taxa_falha, atualizado_por, atualizado_em)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (municipio_id) DO UPDATE
           SET adaptador = EXCLUDED.adaptador, taxa_falha = EXCLUDED.taxa_falha,
               atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
        [m.id, body.adaptador, taxa, u.id],
      );
      let n = 0;
      if (antes.adaptador === 'nenhum' && body.adaptador !== 'nenhum') {
        const r = await tx.query(
          `UPDATE processos SET gd_estado = 'por_sincronizar', gd_tentativas = 0
           WHERE municipio_id = $1 AND gd_estado = 'nao_aplicavel' AND fase <> 'arquivado'
           RETURNING id`,
          [m.id],
        );
        n = r.length;
      } else if (antes.adaptador !== 'nenhum' && body.adaptador === 'nenhum') {
        const r = await tx.query(
          `UPDATE processos SET gd_estado = 'nao_aplicavel', gd_tentativas = 0
           WHERE municipio_id = $1 AND gd_estado IN ('por_sincronizar','erro')
           RETURNING id`,
          [m.id],
        );
        n = r.length;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'configurar_gestao_documental',
          objetoTipo: 'municipio',
          objetoId: m.id,
          dados: {
            antes: { adaptador: antes.adaptador, taxa_falha: antes.taxa_falha },
            depois: { adaptador: body.adaptador, taxa_falha: taxa },
            processos_alterados: n,
          },
        },
        tx,
      );
      return n;
    });
    return { ...(await this.config(m)), processos_alterados: marcados };
  }

  // ------------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------------

  async estado(m: Municipio) {
    const cfg = await this.config(m);
    const [c] = await this.db.query<{
      sincronizados: number;
      por_sincronizar: number;
      com_erro: number;
      sem_mais_tentativas: number;
      ultima_sincronizacao_em: Date | null;
    }>(
      `SELECT count(*) FILTER (WHERE p.gd_estado = 'sincronizado')::int AS sincronizados,
              count(*) FILTER (WHERE p.gd_estado = 'por_sincronizar')::int AS por_sincronizar,
              count(*) FILTER (WHERE p.gd_estado = 'erro')::int AS com_erro,
              count(*) FILTER (WHERE p.gd_estado = 'erro' AND p.gd_tentativas >= $2)::int AS sem_mais_tentativas,
              max(s.sincronizado_em) AS ultima_sincronizacao_em
       FROM processos p LEFT JOIN gd_sincronizacoes s ON s.processo_id = p.id
       WHERE p.municipio_id = $1`,
      [m.id, MAX_TENTATIVAS],
    );
    const [erro] = await this.db.query<{
      processo_id: string;
      numero: string;
      mensagem: string;
      em: Date;
      gd_tentativas: number;
    }>(
      `SELECT p.id AS processo_id, p.numero, s.ultimo_erro AS mensagem, s.ultimo_erro_em AS em, p.gd_tentativas
       FROM gd_sincronizacoes s JOIN processos p ON p.id = s.processo_id
       WHERE p.municipio_id = $1 AND s.ultimo_erro_em IS NOT NULL
       ORDER BY s.ultimo_erro_em DESC LIMIT 1`,
      [m.id],
    );
    return {
      adaptador: cfg.adaptador,
      simulado: cfg.simulado,
      ...c,
      max_tentativas: MAX_TENTATIVAS,
      ultimo_erro: erro ?? null,
    };
  }

  // ------------------------------------------------------------------
  // Sincronização
  // ------------------------------------------------------------------

  /** POST /painel/processos/:id/sincronizar: já, e com as tentativas a zero. */
  async sincronizarJa(m: Municipio, u: UtilizadorPainel, processoId: string) {
    const [p] = await this.db.query<{ id: string }>(
      'SELECT id FROM processos WHERE id = $1 AND municipio_id = $2',
      [processoId, m.id],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Processo não existe.',
      );
    }
    const cfg = await this.config(m);
    if (cfg.adaptador === 'nenhum') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'gestao_documental_desligada',
        'Este município não tem a integração com a gestão documental ligada.',
      );
    }
    const r = await this.sincronizar(processoId, true);
    if (!r) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sincronizacao_em_curso',
        'Este processo está a ser enviado neste momento. Tente daqui a pouco.',
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'sincronizar_gestao_documental',
      objetoTipo: 'processo',
      objetoId: processoId,
      dados: { gd_estado: r.gd_estado, erro: r.erro },
    });
    return r;
  }

  /** O job `sync_gestao_documental` (a cada 15 min). */
  async sincronizarPendentes(limite = 50) {
    const candidatos = await this.db.query<{ id: string }>(CANDIDATOS, [
      MAX_TENTATIVAS,
      limite,
    ]);
    const resumo = { processados: 0, sincronizados: 0, com_erro: 0 };
    for (const { id } of candidatos) {
      try {
        const r = await this.sincronizar(id, false);
        if (!r) continue;
        resumo.processados++;
        if (r.erro) resumo.com_erro++;
        else resumo.sincronizados++;
      } catch (e) {
        // Erro do nosso lado (BD): fica para a próxima volta.
        this.logger.error(
          `Sincronização do processo ${id}: ${(e as Error).message}`,
        );
      }
    }
    if (resumo.processados) {
      this.logger.log(
        `Gestão documental: ${resumo.sincronizados} sincronizados, ${resumo.com_erro} com erro.`,
      );
    }
    return resumo;
  }

  /**
   * Envia o que falta de um processo: o registo (se ainda não tem gd_id), os
   * documentos novos e a fase, por esta ordem. Os envios bem feitos ficam
   * gravados mesmo que um a seguir falhe; o reintento continua dali.
   *
   * null = outro já está a enviar este processo (trinco na linha de
   * gd_sincronizacoes, que se mantém durante as chamadas ao sistema da
   * câmara; a linha do processo só se toca no fim, num instante).
   */
  async sincronizar(
    processoId: string,
    forcar: boolean,
  ): Promise<ResultadoSincronizacao | null> {
    await this.db.query(
      `INSERT INTO gd_sincronizacoes (processo_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [processoId],
    );
    return this.db.transaction(async (tx) => {
      const [s] = await tx.query<{ proxima_tentativa_em: Date | null }>(
        `SELECT proxima_tentativa_em FROM gd_sincronizacoes
         WHERE processo_id = $1 FOR UPDATE SKIP LOCKED`,
        [processoId],
      );
      if (!s) return null;
      const [p] = await tx.query<LinhaProcesso>(
        `SELECT p.id, p.municipio_id, p.numero, p.assunto, p.morada, p.freguesia, p.fase::text AS fase,
                p.criado_em, p.gd_id, p.gd_estado, p.gd_tentativas,
                tp.codigo AS tipo_codigo, tp.nome AS tipo_nome, mu.nome AS requerente,
                c.adaptador, c.taxa_falha
         FROM processos p
         JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
         LEFT JOIN municipes mu ON mu.id = p.municipe_id
         LEFT JOIN gestao_documental_config c ON c.municipio_id = p.municipio_id
         WHERE p.id = $1`,
        [processoId],
      );
      if (!p) return null;
      const gd = this.adaptador(p.municipio_id, {
        adaptador: p.adaptador ?? 'nenhum',
        taxa_falha: Number(p.taxa_falha ?? 0),
      });
      if (!gd) return null;
      if (
        !forcar &&
        p.gd_estado !== 'sincronizado' &&
        (p.gd_tentativas >= MAX_TENTATIVAS ||
          (s.proxima_tentativa_em && s.proxima_tentativa_em > new Date()))
      ) {
        return null;
      }

      // 1) Chamadas ao sistema da câmara.
      let gdId = p.gd_id;
      const envios: Envio[] = [];
      let erro: string | null = null;
      try {
        if (!gdId) {
          const r = await gd.registarProcesso(processoGd(p));
          gdId = r.gd_id;
          envios.push({ tipo: 'processo', fase: p.fase });
        }
        const docs = await tx.query<DocumentoGd & { recebido_em: Date }>(
          DOCUMENTOS_POR_ENVIAR,
          [p.id],
        );
        for (const d of docs) {
          const r = await gd.anexarDocumento(gdId, {
            ...d,
            recebido_em: new Date(d.recebido_em).toISOString(),
          });
          envios.push({
            tipo: 'documento',
            documento_id: d.id,
            ficheiro_key: d.ficheiro_key,
            referencia: r.referencia,
          });
        }
        const [ultima] = await tx.query<{ fase: string }>(
          ULTIMA_FASE_ENVIADA.replace('%P', '$1'),
          [p.id],
        );
        const faseConhecida = envios.some((e) => e.tipo === 'processo')
          ? p.fase
          : ultima?.fase;
        if (faseConhecida !== p.fase) {
          await gd.atualizarEstado(gdId, p.fase);
          envios.push({ tipo: 'fase', fase: p.fase });
        }
      } catch (e) {
        erro = mensagemErro(e);
      }

      // 2) Gravar o que aconteceu.
      for (const e of envios) {
        await tx.query(
          `INSERT INTO gd_envios (processo_id, tipo, gd_id, documento_id, ficheiro_key, fase, referencia)
           VALUES ($1, $2, $3, $4, $5, $6::fase_processo, $7)`,
          [
            p.id,
            e.tipo,
            gdId,
            e.documento_id ?? null,
            e.ficheiro_key ?? null,
            e.fase ?? null,
            e.referencia ?? null,
          ],
        );
      }

      if (!erro) {
        await tx.query(
          `UPDATE processos SET gd_id = $2, gd_estado = 'sincronizado', gd_tentativas = 0 WHERE id = $1`,
          [p.id, gdId],
        );
        await tx.query(
          `UPDATE gd_sincronizacoes
           SET ultima_tentativa_em = now(), sincronizado_em = now(), proxima_tentativa_em = NULL
           WHERE processo_id = $1`,
          [p.id],
        );
        return resultado(p.id, gdId, 'sincronizado', 0, envios, null, null);
      }

      const tentativas = (forcar ? 0 : p.gd_tentativas) + 1;
      const espera = esperaAposFalha(tentativas);
      const proxima = espera === null ? null : new Date(Date.now() + espera);
      await tx.query(
        `UPDATE processos SET gd_id = $2, gd_estado = 'erro', gd_tentativas = $3 WHERE id = $1`,
        [p.id, gdId, tentativas],
      );
      await tx.query(
        `UPDATE gd_sincronizacoes
         SET ultima_tentativa_em = now(), ultimo_erro = $2, ultimo_erro_em = now(), proxima_tentativa_em = $3
         WHERE processo_id = $1`,
        [p.id, erro, proxima],
      );
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, interno, dados)
         VALUES ($1, 'sync_erro', $2, 'sistema', true, $3)`,
        [
          p.id,
          `Gestão documental: o envio falhou (tentativa ${tentativas} de ${MAX_TENTATIVAS}). ${erro}` +
            (proxima
              ? ' Volta a tentar automaticamente.'
              : ' Sem mais tentativas automáticas: use "Sincronizar já".'),
          JSON.stringify({
            tentativa: tentativas,
            erro,
            gd_id: gdId,
            proxima_tentativa_em: proxima,
            forcado: forcar,
          }),
        ],
      );
      return resultado(p.id, gdId, 'erro', tentativas, envios, erro, proxima);
    });
  }
}

function processoGd(p: LinhaProcesso): ProcessoGd {
  return {
    id: p.id,
    numero: p.numero,
    tipo_codigo: p.tipo_codigo,
    tipo_nome: p.tipo_nome,
    assunto: p.assunto,
    morada: p.morada,
    freguesia: p.freguesia,
    fase: p.fase,
    requerente: p.requerente,
    criado_em: new Date(p.criado_em).toISOString(),
  };
}

function resultado(
  processoId: string,
  gdId: string | null,
  estado: GdEstado,
  tentativas: number,
  envios: Envio[],
  erro: string | null,
  proxima: Date | null,
): ResultadoSincronizacao {
  return {
    processo_id: processoId,
    gd_id: gdId,
    gd_estado: estado,
    gd_tentativas: tentativas,
    enviados: {
      processo: envios.some((e) => e.tipo === 'processo'),
      documentos: envios.filter((e) => e.tipo === 'documento').length,
      fase: envios.some((e) => e.tipo === 'fase'),
    },
    erro,
    proxima_tentativa_em: proxima,
  };
}
