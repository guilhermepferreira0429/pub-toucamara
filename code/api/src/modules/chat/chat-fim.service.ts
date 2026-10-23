import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { FILA_RESUMIR } from '../conversas/fim-chamada.service.js';

export const FILA_FECHAR_CHATS = 'fechar_chats';
/** Sem atividade há este tempo, a conversa (chat, chamada, SMS, WhatsApp) dá-se por terminada. */
export const INATIVIDADE_CHAT_MIN = 30;
/** Por volta do job: as conversas antigas fecham em poucas voltas, sem picos. */
const LOTE = 200;

/**
 * O chat não tem "desligar", e numa chamada o fim pode não chegar (webhook do
 * fim da chamada perdido, ligação que cai): sem isto ficavam "Em curso" e sem
 * resumo no painel. A cada 5 minutos, as conversas de chat, telefone, SMS e
 * WhatsApp sem atividade há 30 minutos (última mensagem, ou o início se não
 * houver registo de atividade) passam a terminadas (a essa hora),
 * com o resultado por omissão (resolvida se o munícipe escreveu, caiu se
 * não), e vão para o mesmo resumo das chamadas, que afina o resultado.
 *
 * As conversas abertas pelo avaliador (sessões em avaliacao.respostas) ficam
 * escondidas do painel e não gastam resumo.
 */
@Injectable()
export class ChatFimService implements OnModuleInit {
  private readonly logger = new Logger(ChatFimService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar(FILA_FECHAR_CHATS, async () => {
      await this.fechar();
    });
    this.jobs.agendar(FILA_FECHAR_CHATS, '*/5 * * * *');
  }

  async fechar(): Promise<{ fechadas: number; resumos: number }> {
    const linhas = await this.db.query<{ id: string; resumir: boolean }>(
      `WITH abertas AS (
         SELECT c.id,
                coalesce(c.ultima_atividade_em, c.iniciada_em) AS fim,
                EXISTS (SELECT 1 FROM conversa_turnos t
                        WHERE t.conversa_id = c.id AND t.papel = 'municipe') AS falou,
                EXISTS (SELECT 1 FROM avaliacao.respostas r
                        WHERE r.bruto ->> 'sessao' = c.provider_id) AS avaliador
         FROM conversas c
         WHERE c.canal IN ('chat', 'telefone', 'sms', 'whatsapp') AND c.terminada_em IS NULL
           AND coalesce(c.ultima_atividade_em, c.iniciada_em) < now() - make_interval(mins => $1)
         ORDER BY coalesce(c.ultima_atividade_em, c.iniciada_em)
         LIMIT $2
         FOR UPDATE OF c SKIP LOCKED
       )
       UPDATE conversas c SET
         terminada_em = a.fim,
         duracao_s = coalesce(c.duracao_s, greatest(0, extract(epoch FROM a.fim - c.iniciada_em))::integer),
         resultado = CASE WHEN c.resultado = 'em_curso'
                          THEN (CASE WHEN a.falou THEN 'resolvida' ELSE 'caiu' END)::resultado_conv
                          ELSE c.resultado END,
         oculto_em = CASE WHEN a.avaliador THEN coalesce(c.oculto_em, now()) ELSE c.oculto_em END
       FROM abertas a
       WHERE c.id = a.id
       RETURNING c.id, (a.falou AND NOT a.avaliador AND c.oculto_em IS NULL) AS resumir`,
      [INATIVIDADE_CHAT_MIN, LOTE],
    );
    let resumos = 0;
    for (const l of linhas) {
      if (!l.resumir) continue;
      await this.jobs.enviar(
        FILA_RESUMIR,
        { conversaId: l.id },
        { singletonKey: l.id },
      );
      resumos++;
    }
    if (linhas.length) {
      this.logger.log(
        `Conversas fechadas por inatividade: ${linhas.length} (${resumos} para resumo).`,
      );
    }
    return { fechadas: linhas.length, resumos };
  }
}
