import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  acaoAuditoria,
  FichaMunicipe,
  Politica,
  politicasEfetivas,
  podeAnonimizarMunicipe,
  TEXTO_ANONIMIZADO,
} from './retencao.js';

const LOTE = 1000;

/**
 * RGPD: políticas de retenção (Equipa e acessos · RGPD) e o job
 * `retencao_rgpd` (03:30), município a município, objeto a objeto (um a
 * falhar não impede os outros). Cada objeto deixa uma linha no audit_log
 * (ator 'sistema', objeto_tipo 'retencao') com as contagens, mesmo a zero:
 * é daí que o painel lê o último resultado.
 *
 * Gravações e fotos: apaga-se o ficheiro no armazenamento (Wasabi) e só
 * depois a chave na BD; um ficheiro que falhe a apagar fica para a noite
 * seguinte. Sem armazenamento configurado não há ficheiros: larga-se a chave.
 */
@Injectable()
export class RgpdService {
  private readonly logger = new Logger(RgpdService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly armazenamento: ArmazenamentoService,
  ) {}

  /** Apaga os ficheiros; devolve as chaves que já podem sair da BD. */
  private async apagarFicheiros(chaves: string[]): Promise<string[]> {
    if (!chaves.length || !this.armazenamento.disponivel) return chaves;
    try {
      return await this.armazenamento.apagar(chaves);
    } catch (e) {
      this.logger.error(`Apagar ficheiros falhou: ${(e as Error).message}`);
      return [];
    }
  }

  async politicas(municipioId: string): Promise<Politica[]> {
    const linhas = await this.db.query<{
      objeto: string;
      guardar: string;
      acao: 'apagar' | 'anonimizar';
    }>(
      `SELECT objeto, guardar::text AS guardar, acao
       FROM politicas_retencao WHERE municipio_id = $1`,
      [municipioId],
    );
    return politicasEfetivas(linhas);
  }

  /** GET /painel/rgpd */
  async ver(m: Municipio) {
    const [politicas, ultimas] = await Promise.all([
      this.politicas(m.id),
      this.db.query<{
        objeto: string;
        acao: string;
        dados: Record<string, unknown>;
        em: Date;
      }>(
        `SELECT DISTINCT ON (objeto_id) objeto_id AS objeto, acao, dados, em
         FROM audit_log
         WHERE municipio_id = $1 AND ator_tipo = 'sistema' AND objeto_tipo = 'retencao'
           AND em >= now() - interval '35 days'
         ORDER BY objeto_id, em DESC`,
        [m.id],
      ),
    ]);
    const porObjeto = new Map(ultimas.map((u) => [u.objeto, u]));
    return {
      politicas: politicas.map((p) => ({
        ...p,
        ultima_execucao: porObjeto.get(p.objeto) ?? null,
      })),
      ultima_execucao_em: ultimas.reduce<Date | null>(
        (max, u) => (!max || u.em > max ? u.em : max),
        null,
      ),
    };
  }

  /** O trabalho `retencao_rgpd`. */
  async correr(): Promise<void> {
    const municipios = await this.db.query<Municipio>(
      'SELECT id, slug, nome, fuso FROM municipios ORDER BY slug',
    );
    for (const m of municipios) await this.correrMunicipio(m);
  }

  async correrMunicipio(m: Municipio): Promise<void> {
    for (const p of await this.politicas(m.id)) {
      try {
        const [{ limite }] = await this.db.query<{ limite: Date }>(
          'SELECT now() - $1::interval AS limite',
          [p.guardar],
        );
        const contagens = await this.aplicar(m, p, limite);
        await this.auditoria.registar({
          municipioId: m.id,
          atorTipo: 'sistema',
          acao: acaoAuditoria(p),
          objetoTipo: 'retencao',
          objetoId: p.objeto,
          dados: {
            guardar: p.guardar,
            acao_politica: p.acao,
            origem: p.origem,
            limite: limite.toISOString(),
            ...contagens,
          },
        });
        this.logger.log(
          `${m.slug} · ${p.objeto}: ${JSON.stringify(contagens)}`,
        );
      } catch (e) {
        this.logger.error(
          `${m.slug} · ${p.objeto} falhou: ${(e as Error).message}`,
        );
      }
    }
  }

  private async aplicar(
    m: Municipio,
    p: Politica,
    limite: Date,
  ): Promise<Record<string, number>> {
    switch (p.objeto) {
      case 'gravacoes': {
        const linhas = await this.db.query<{ chave: string }>(
          `SELECT gravacao_key AS chave FROM conversas
           WHERE municipio_id = $1 AND gravacao_key IS NOT NULL
             AND coalesce(terminada_em, iniciada_em) < $2
           LIMIT ${LOTE}`,
          [m.id, limite],
        );
        const apagadas = await this.apagarFicheiros(linhas.map((l) => l.chave));
        if (apagadas.length) {
          await this.db.query(
            `UPDATE conversas SET gravacao_key = NULL
             WHERE municipio_id = $1 AND gravacao_key = ANY($2::text[])`,
            [m.id, apagadas],
          );
        }
        return {
          gravacoes: apagadas.length,
          por_apagar: linhas.length - apagadas.length,
        };
      }
      case 'transcricoes': {
        // 'apagar' também anonimiza: apagar turnos partia citações e perguntas sem resposta.
        const [r] = await this.db.query<{ turnos: number; conversas: number }>(
          `WITH x AS (
             UPDATE conversa_turnos t SET texto = $3
             FROM conversas c
             WHERE c.id = t.conversa_id AND c.municipio_id = $1
               AND c.iniciada_em < $2 AND t.texto <> $3
             RETURNING t.conversa_id)
           SELECT count(*)::int AS turnos, count(DISTINCT conversa_id)::int AS conversas FROM x`,
          [m.id, limite, TEXTO_ANONIMIZADO],
        );
        // O comentário do inquérito de satisfação é texto livre como a
        // transcrição: sai com ela. A nota (1–5) fica para as estatísticas.
        const [s] = await this.db.query<{ comentarios: number }>(
          `WITH x AS (
             UPDATE satisfacao_respostas s SET comentario = NULL
             FROM conversas c
             WHERE c.id = s.conversa_id AND c.municipio_id = $1
               AND c.iniciada_em < $2 AND s.comentario IS NOT NULL
             RETURNING 1)
           SELECT count(*)::int AS comentarios FROM x`,
          [m.id, limite],
        );
        return {
          turnos: r.turnos,
          conversas: r.conversas,
          comentarios: s.comentarios,
        };
      }
      case 'telefones_sem_processo':
        return { municipes: await this.anonimizarMunicipes(m, limite) };
      case 'fotos_ocorrencias': {
        const linhas = await this.db.query<{ chave: string }>(
          `SELECT f.ficheiro_key AS chave
           FROM ocorrencia_fotos f JOIN ocorrencias o ON o.id = f.ocorrencia_id
           WHERE o.municipio_id = $1 AND o.estado = 'resolvida' AND o.resolvida_em < $2
           LIMIT ${LOTE}`,
          [m.id, limite],
        );
        const apagadas = await this.apagarFicheiros(linhas.map((l) => l.chave));
        if (apagadas.length) {
          await this.db.query(
            `DELETE FROM ocorrencia_fotos f USING ocorrencias o
             WHERE o.id = f.ocorrencia_id AND o.municipio_id = $1
               AND f.ficheiro_key = ANY($2::text[])`,
            [m.id, apagadas],
          );
        }
        return {
          fotos: apagadas.length,
          por_apagar: linhas.length - apagadas.length,
        };
      }
    }
  }

  /** Telefone, nome, email e NIF a NULL; a linha fica (as conversas apontam-lhe). */
  private async anonimizarMunicipes(
    m: Municipio,
    limite: Date,
  ): Promise<number> {
    const fichas = await this.db.query<FichaMunicipe>(
      `SELECT mu.id, mu.criado_em,
         (SELECT count(*) FROM processos p WHERE p.municipe_id = mu.id)::int AS processos,
         (SELECT count(*) FROM requerimentos r WHERE r.municipe_id = mu.id)::int AS requerimentos,
         ((SELECT count(*) FROM marcacoes mc
            WHERE mc.municipe_id = mu.id AND mc.estado = 'marcada' AND upper(mc.periodo) > now())
          + (SELECT count(*) FROM recolhas rc
            WHERE rc.municipe_id = mu.id AND rc.estado = 'marcada' AND upper(rc.janela) > now())
         )::int AS marcacoes_futuras,
         (SELECT count(*) FROM ocorrencias o
           WHERE o.municipe_id = mu.id AND o.estado IN ('nova','com_equipa'))::int AS ocorrencias_abertas,
         (SELECT max(c.iniciada_em) FROM conversas c WHERE c.municipe_id = mu.id) AS ultima_conversa_em
       FROM municipes mu
       WHERE mu.municipio_id = $1 AND mu.anonimizado_em IS NULL AND mu.criado_em < $2`,
      [m.id, limite],
    );
    const ids = fichas
      .filter((f) => podeAnonimizarMunicipe(f, limite))
      .map((f) => f.id);
    let n = 0;
    for (let i = 0; i < ids.length; i += LOTE) {
      // Volta a confirmar o essencial: entre a leitura e aqui pode ter ligado.
      const [r] = await this.db.query<{ n: number }>(
        `WITH x AS (
           UPDATE municipes mu SET anonimizado_em = now(), telefone_e164 = NULL, nome = NULL,
             email = NULL, nif_cifrado = NULL, nif_hash = NULL
           WHERE mu.id = ANY($1::uuid[]) AND mu.anonimizado_em IS NULL
             AND NOT EXISTS (SELECT 1 FROM conversas c
                             WHERE c.municipe_id = mu.id AND c.iniciada_em >= $2)
             AND NOT EXISTS (SELECT 1 FROM requerimentos r WHERE r.municipe_id = mu.id)
           RETURNING 1)
         SELECT count(*)::int AS n FROM x`,
        [ids.slice(i, i + LOTE), limite],
      );
      n += r.n;
    }
    return n;
  }
}
