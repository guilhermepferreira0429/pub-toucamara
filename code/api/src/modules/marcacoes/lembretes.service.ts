import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { MarcacoesService } from './marcacoes.service.js';
import { listarItens } from './recolhas.service.js';
import { dizerHora, dizerPeriodo, periodoDe } from './vagas.js';

/*
 * Lembretes de véspera (job `lembretes`, a cada 15 min): marcações e
 * recolhas de amanhã, no fuso de cada município, ainda sem lembrete.
 * Só se manda entre as 9h e as 21h locais (ninguém quer um SMS à meia-noite);
 * o que for marcado para amanhã depois das 21h já levou a confirmação.
 *
 * Duas guardas contra duplicados: a coluna `lembrete_enviado_em` (o job
 * filtra por ela; nas recolhas foi acrescentada na 0014) e a chave
 * idempotente do SMS, se o job morrer entre o SMS e o UPDATE.
 */
const JANELA_ENVIO = `extract(hour FROM now() AT TIME ZONE mun.fuso) BETWEEN 9 AND 20`;
const AMANHA = (col: string) =>
  `${col} > now() AND ${col} < now() + interval '2 days'
   AND (${col} AT TIME ZONE mun.fuso)::date = (now() AT TIME ZONE mun.fuso)::date + 1`;

/** Por corrida; o resto fica para a seguinte (15 min depois). */
const LOTE = 200;

@Injectable()
export class LembretesService {
  private readonly logger = new Logger(LembretesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mensagens: MensagensService,
    private readonly marcacoes: MarcacoesService,
  ) {}

  async correr(): Promise<void> {
    const marcacoes = await this.lembrarMarcacoes();
    const recolhas = await this.lembrarRecolhas();
    if (marcacoes || recolhas) {
      this.logger.log(
        `Lembretes: ${marcacoes} marcações, ${recolhas} recolhas.`,
      );
    }
  }

  private async lembrarMarcacoes(): Promise<number> {
    const linhas = await this.db.query<{
      id: string;
      municipe_id: string;
      telefone: string | null;
      agenda: string;
      local: string | null;
      inicio: Date;
      levar: string[] | null;
      municipio_id: string;
      municipio_nome: string;
      fuso: string;
    }>(
      `SELECT mc.id, mc.municipe_id, mu.telefone_e164 AS telefone, a.nome AS agenda, a.local,
              lower(mc.periodo) AS inicio, mc.levar,
              mun.id AS municipio_id, mun.nome AS municipio_nome, mun.fuso
       FROM marcacoes mc
       JOIN agendas a ON a.id = mc.agenda_id
       JOIN municipios mun ON mun.id = a.municipio_id
       JOIN municipes mu ON mu.id = mc.municipe_id
       WHERE mc.estado = 'marcada' AND mc.lembrete_enviado_em IS NULL
         AND ${AMANHA('lower(mc.periodo)')}
         AND ${JANELA_ENVIO}
       ORDER BY lower(mc.periodo)
       LIMIT ${LOTE}`,
    );
    for (const l of linhas) {
      await this.db.transaction(async (tx) => {
        if (l.telefone) {
          const link = await this.marcacoes.linkDaMarcacao(
            l.municipio_id,
            l.id,
            tx,
          );
          const levar = l.levar?.length ? ` Leve: ${l.levar.join(', ')}.` : '';
          await this.mensagens.sms(
            {
              municipioId: l.municipio_id,
              municipeId: l.municipe_id,
              destino: l.telefone,
              motivo: 'lembrete',
              corpo:
                `${l.municipio_nome}: lembrete, amanhã ${dizerHora(l.inicio, l.fuso)}, ` +
                `${l.agenda}${l.local ? `, ${l.local}` : ''}.${levar} Remarcar ou cancelar: ${link.url}`,
              relacionado: { marcacao_id: l.id },
              chave: `lembrete:marcacao:${l.id}`,
            },
            tx,
          );
        }
        // Sem telefone (anonimizado) marca-se na mesma, para não voltar a tentar.
        await tx.query(
          'UPDATE marcacoes SET lembrete_enviado_em = now() WHERE id = $1 AND lembrete_enviado_em IS NULL',
          [l.id],
        );
      });
    }
    return linhas.length;
  }

  private async lembrarRecolhas(): Promise<number> {
    const linhas = await this.db.query<{
      id: string;
      municipe_id: string;
      telefone: string | null;
      entidade: string;
      morada: string;
      itens: { item: string; qtd: number }[];
      inicio: Date;
      municipio_id: string;
      municipio_nome: string;
      telefone_linha: string | null;
      fuso: string;
    }>(
      `SELECT r.id, r.municipe_id, mu.telefone_e164 AS telefone, e.nome AS entidade,
              r.morada, r.itens, lower(r.janela) AS inicio,
              mun.id AS municipio_id, mun.nome AS municipio_nome, mun.telefone_linha, mun.fuso
       FROM recolhas r
       JOIN entidades e ON e.id = r.entidade_id
       JOIN municipios mun ON mun.id = r.municipio_id
       JOIN municipes mu ON mu.id = r.municipe_id
       WHERE r.estado = 'marcada' AND r.lembrete_enviado_em IS NULL
         AND ${AMANHA('lower(r.janela)')}
         AND ${JANELA_ENVIO}
       ORDER BY lower(r.janela)
       LIMIT ${LOTE}`,
    );
    for (const l of linhas) {
      await this.db.transaction(async (tx) => {
        if (l.telefone) {
          const cancelar = l.telefone_linha
            ? ` Para cancelar, ligue ${l.telefone_linha}.`
            : '';
          await this.mensagens.sms(
            {
              municipioId: l.municipio_id,
              municipeId: l.municipe_id,
              destino: l.telefone,
              motivo: 'lembrete',
              corpo:
                `${l.municipio_nome}: lembrete, amanhã ${dizerPeriodo(periodoDe(l.inicio, l.fuso))} ${l.entidade} ` +
                `recolhe em ${l.morada}: ${listarItens(l.itens)}.${cancelar}`,
              relacionado: { recolha_id: l.id },
              chave: `lembrete:recolha:${l.id}`,
            },
            tx,
          );
        }
        await tx.query(
          'UPDATE recolhas SET lembrete_enviado_em = now() WHERE id = $1 AND lembrete_enviado_em IS NULL',
          [l.id],
        );
      });
    }
    return linhas.length;
  }
}
