import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import type {
  LinhaProcessosFase,
  LinhaResultados,
  LinhaTrabalho,
  TemaContado,
} from './agregados.js';
import type { Agrupar, Periodo } from './periodos.js';

/** Vistas da 0018 e da 0033 (gestão); refrescadas uma a uma (uma a falhar não para as outras). */
export const VISTAS = [
  'mv_conversas_por_hora',
  'mv_temas_periodo',
  'mv_resultados_periodo',
  'mv_trabalho_feito_semana',
  'mv_processos_fases',
  'mv_processos_fases_historia',
] as const;

const SOMA_RESULTADOS = `
  sum(total)::int AS total, sum(terminadas)::int AS terminadas,
  sum(resolvidas_sem_humano)::int AS resolvidas_sem_humano,
  sum(passadas)::int AS passadas, sum(sem_resposta)::int AS sem_resposta,
  sum(marcacoes)::int AS marcacoes, sum(emergencias)::int AS emergencias,
  sum(fora_de_horas)::int AS fora_de_horas,
  sum(duracao_total_s)::float8 AS duracao_total_s, sum(com_duracao)::int AS com_duracao`;

const SOMA_TRABALHO = `
  coalesce(sum(requerimentos), 0)::int AS requerimentos,
  coalesce(sum(ocorrencias_agente), 0)::int AS ocorrencias_agente,
  coalesce(sum(consultas_processo), 0)::int AS consultas_processo,
  coalesce(sum(referencias_mb), 0)::int AS referencias_mb,
  coalesce(sum(pagamentos_pagos), 0)::int AS pagamentos_pagos,
  coalesce(sum(pagos_cent), 0)::float8 AS pagos_cent,
  coalesce(sum(marcacoes), 0)::int AS marcacoes,
  coalesce(sum(recolhas), 0)::int AS recolhas,
  coalesce(sum(passagens), 0)::int AS passagens,
  coalesce(sum(ocorrencias), 0)::int AS ocorrencias,
  coalesce(sum(ocorrencias_resolvidas), 0)::int AS ocorrencias_resolvidas,
  coalesce(sum(horas_resolucao), 0)::float8 AS horas_resolucao,
  coalesce(sum(sms_enviados), 0)::int AS sms_enviados,
  coalesce(sum(sms_segmentos), 0)::float8 AS sms_segmentos,
  coalesce(sum(sms_custo_cent), 0)::float8 AS sms_custo_cent`;

/** Segunda-feira da semana de `dia` (date), em SQL. */
const BALDE = `CASE WHEN $4 = 'semana' THEN dia - (extract(isodow FROM dia)::int - 1) ELSE dia END`;

/**
 * Leituras das vistas materializadas (secção 4.13). Usado pela Visão geral,
 * pelos Indicadores e pelos relatórios. Datas sempre como texto
 * 'YYYY-MM-DD' (o `pg` passaria `date` para meia-noite local).
 */
@Injectable()
export class PainelDadosService {
  private readonly logger = new Logger(PainelDadosService.name);

  constructor(private readonly db: DatabaseService) {}

  /** O trabalho `refrescar_vistas`. */
  async refrescar(): Promise<void> {
    for (const vista of VISTAS) {
      const inicio = Date.now();
      try {
        await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${vista}`);
        this.logger.debug(`${vista} em ${Date.now() - inicio} ms`);
      } catch (e) {
        this.logger.error(`${vista} não refrescou: ${(e as Error).message}`);
      }
    }
  }

  resultadosPorCanal(municipioId: string, p: Periodo) {
    return this.db.query<LinhaResultados>(
      `SELECT canal::text AS canal, ${SOMA_RESULTADOS}
       FROM mv_resultados_periodo
       WHERE municipio_id = $1 AND dia BETWEEN $2::date AND $3::date
       GROUP BY canal`,
      [municipioId, p.de, p.ate],
    );
  }

  resultadosPorBalde(municipioId: string, p: Periodo, agrupar: Agrupar) {
    return this.db.query<LinhaResultados>(
      `SELECT (${BALDE})::text AS balde, canal::text AS canal, ${SOMA_RESULTADOS}
       FROM mv_resultados_periodo
       WHERE municipio_id = $1 AND dia BETWEEN $2::date AND $3::date
       GROUP BY 1, 2`,
      [municipioId, p.de, p.ate, agrupar],
    );
  }

  async trabalho(municipioId: string, p: Periodo): Promise<LinhaTrabalho> {
    const [t] = await this.db.query<LinhaTrabalho>(
      `SELECT ${SOMA_TRABALHO} FROM mv_trabalho_feito_semana
       WHERE municipio_id = $1 AND dia BETWEEN $2::date AND $3::date`,
      [municipioId, p.de, p.ate],
    );
    return t;
  }

  trabalhoPorBalde(municipioId: string, p: Periodo, agrupar: Agrupar) {
    return this.db.query<LinhaTrabalho>(
      `SELECT (${BALDE})::text AS balde, ${SOMA_TRABALHO}
       FROM mv_trabalho_feito_semana
       WHERE municipio_id = $1 AND dia BETWEEN $2::date AND $3::date
       GROUP BY 1`,
      [municipioId, p.de, p.ate, agrupar],
    );
  }

  /** (dia da semana 1..7, hora, total) para o mapa de calor. */
  conversasPorHora(municipioId: string, p: Periodo) {
    return this.db.query<{ dia_semana: number; hora: number; total: number }>(
      `SELECT extract(isodow FROM dia)::int AS dia_semana, hora, sum(total)::int AS total
       FROM mv_conversas_por_hora
       WHERE municipio_id = $1 AND dia BETWEEN $2::date AND $3::date
       GROUP BY 1, 2`,
      [municipioId, p.de, p.ate],
    );
  }

  temas(municipioId: string, p: Periodo) {
    return this.db.query<TemaContado>(
      `SELECT v.tema_id, t.nome AS tema, sum(v.total)::int AS total
       FROM mv_temas_periodo v
       JOIN temas t ON t.id = v.tema_id
       WHERE v.municipio_id = $1 AND v.dia BETWEEN $2::date AND $3::date
       GROUP BY v.tema_id, t.nome`,
      [municipioId, p.de, p.ate],
    );
  }

  processosFases(municipioId: string) {
    return this.db.query<LinhaProcessosFase>(
      `SELECT v.fase::text AS fase, v.tecnico_id, u.nome AS tecnico, v.total, v.atrasados,
              v.dias_medios_na_fase
       FROM mv_processos_fases v
       LEFT JOIN utilizadores u ON u.id = v.tecnico_id
       WHERE v.municipio_id = $1`,
      [municipioId],
    );
  }

  /** Perguntas sem resposta ainda por resolver, as mais repetidas. */
  semResposta(municipioId: string, limite = 5) {
    return this.db.query<{
      id: string;
      texto: string;
      vezes: number;
      estado: string;
      o_que_falta: string | null;
      ultima_em: Date;
    }>(
      `SELECT id, texto, vezes, estado, o_que_falta, ultima_em
       FROM perguntas_sem_resposta
       WHERE municipio_id = $1 AND estado IN ('nova','com_equipa','espera_camara')
       ORDER BY vezes DESC, ultima_em DESC
       LIMIT $2`,
      [municipioId, limite],
    );
  }

  async ocorrenciasAbertas(municipioId: string): Promise<number> {
    const [r] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ocorrencias
       WHERE municipio_id = $1 AND oculto_em IS NULL AND estado IN ('nova','com_equipa')`,
      [municipioId],
    );
    return r.n;
  }
}
