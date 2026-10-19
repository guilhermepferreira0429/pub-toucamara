import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { HorarioService } from '../atendimento/horario.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { ConversasService } from './conversas.service.js';
import {
  consentiuNaAnalise,
  converterTurnos,
  resultadoPorOmissao,
  telefoneDaChamada,
  TurnoNovo,
  WebhookTranscricao,
} from './elevenlabs.js';

export const FILA_RESUMIR = 'resumir_conversa';
export const FILA_SMS_FIM = 'sms_fim_chamada';
/** Repetições do SMS à espera do resumo; na última vai sem ele. */
export const TENTATIVAS_SMS_FIM = 3;

/** O SMS espera um pouco pelo resumo antes da primeira tentativa. */
const ESPERA_SMS_S = 45;

/**
 * Fim da chamada: o webhook do ElevenLabs completa a conversa (turnos,
 * tempos, resultado, consentimento) e põe na fila o resumo e o SMS. Tudo
 * idempotente: o ElevenLabs repete o mesmo payload até 5 vezes.
 */
@Injectable()
export class FimChamadaService {
  private readonly logger = new Logger(FimChamadaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversas: ConversasService,
    private readonly municipios: MunicipiosService,
    private readonly horario: HorarioService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly jobs: JobsService,
  ) {}

  /** O município: pela conversa já criada pelas ferramentas ou pelo agent_id. */
  private async municipioDe(
    conversationId: string,
    agentId: string,
  ): Promise<string> {
    const [r] = await this.db.query<{ municipio_id: string }>(
      `SELECT municipio_id FROM conversas WHERE provider_id = $1
       UNION ALL
       SELECT municipio_id FROM agente_config WHERE elevenlabs_agent_id = $2
       LIMIT 1`,
      [conversationId, agentId],
    );
    if (!r) {
      this.logger.error(
        `Fim de chamada ${conversationId}: agente ${agentId} sem município (agente_config.elevenlabs_agent_id).`,
      );
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'municipio_desconhecido',
        'Conversa e agente sem município associado.',
        { agent_id: agentId },
      );
    }
    return r.municipio_id;
  }

  async transcricao(d: WebhookTranscricao['data']): Promise<{
    conversa_id: string;
    turnos: number;
  }> {
    const municipioId = await this.municipioDe(d.conversation_id, d.agent_id);
    const { conversaId } = await this.conversas.garantir({
      municipioId,
      canal: 'telefone',
      providerId: d.conversation_id,
      telefone: telefoneDaChamada(d),
    });

    const duracaoS =
      d.metadata?.call_duration_secs != null
        ? Math.round(d.metadata.call_duration_secs)
        : null;
    const turnos = converterTurnos(d.transcript ?? [], duracaoS);
    const inicioS = d.metadata?.start_time_unix_secs;
    const iniciadaEm = inicioS != null ? new Date(inicioS * 1000) : null;
    const foraDeHoras = await this.foraDeHoras(
      municipioId,
      iniciadaEm ?? new Date(),
    );

    await this.db.transaction(async (tx) => {
      await this.gravarTurnos(tx, conversaId, turnos);
      await tx.query(
        `UPDATE conversas SET
           iniciada_em   = coalesce($2::timestamptz, iniciada_em),
           duracao_s     = coalesce($3::integer, duracao_s),
           terminada_em  = coalesce($2::timestamptz + make_interval(secs => $3::integer), terminada_em, now()),
           fora_de_horas = coalesce($4::boolean, fora_de_horas),
           resultado     = CASE WHEN resultado = 'em_curso' THEN $5::resultado_conv ELSE resultado END,
           consentimento_em = coalesce(
             consentimento_em,
             (SELECT min(criado_em) FROM conversa_momentos WHERE conversa_id = $1 AND tipo = 'consentimento'),
             CASE WHEN $6 THEN coalesce($2::timestamptz, iniciada_em) END)
         WHERE id = $1`,
        [
          conversaId,
          iniciadaEm,
          duracaoS,
          foraDeHoras,
          resultadoPorOmissao(duracaoS, turnos),
          consentiuNaAnalise(d),
        ],
      );
      await this.situarMomentos(tx, conversaId);
    });

    await this.jobs.enviar(
      FILA_RESUMIR,
      { conversaId },
      { singletonKey: conversaId },
    );
    await this.jobs.enviar(
      FILA_SMS_FIM,
      { conversaId },
      {
        singletonKey: conversaId,
        startAfter: ESPERA_SMS_S,
        retryLimit: TENTATIVAS_SMS_FIM,
        retryDelay: 30,
      },
    );
    return { conversa_id: conversaId, turnos: turnos.length };
  }

  private async foraDeHoras(
    municipioId: string,
    em: Date,
  ): Promise<boolean | null> {
    try {
      return await this.horario.foraDeHoras(municipioId, em);
    } catch (e) {
      // Sem horário configurado não se perde a transcrição por causa disso.
      this.logger.warn(`fora_de_horas por calcular: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Regrava os turnos por ordem (ON CONFLICT): apagar e voltar a inserir
   * perderia as citações e as ligações das perguntas sem resposta.
   */
  private async gravarTurnos(tx: Tx, conversaId: string, turnos: TurnoNovo[]) {
    if (turnos.length > 0) {
      await tx.query(
        `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto, inicio_ms, fim_ms)
         SELECT $1, t.ordem, t.papel::papel_turno, t.texto, t.inicio_ms, t.fim_ms
         FROM jsonb_to_recordset($2::jsonb)
           AS t(ordem integer, papel text, texto text, inicio_ms integer, fim_ms integer)
         ON CONFLICT (conversa_id, ordem) DO UPDATE SET
           papel = EXCLUDED.papel, texto = EXCLUDED.texto,
           inicio_ms = EXCLUDED.inicio_ms, fim_ms = EXCLUDED.fim_ms`,
        [conversaId, JSON.stringify(turnos)],
      );
    }
    // Turnos a mais de uma versão anterior, se ninguém os referir.
    await tx.query(
      `DELETE FROM conversa_turnos t
       WHERE t.conversa_id = $1 AND t.ordem > $2
         AND NOT EXISTS (SELECT 1 FROM conversa_momentos m WHERE m.turno_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM pergunta_sem_resposta_ocorrencias o WHERE o.turno_id = t.id)`,
      [conversaId, turnos.length],
    );
  }

  /**
   * Os momentos marcados pelas ferramentas não sabem em que ponto da
   * gravação estão: a hora de criação menos o início da chamada dá em_ms, e
   * daí o turno. Uma pesquisa com fonte cita o turno seguinte do agente (é
   * ele que diz a resposta) e grava as citações turno → trecho.
   */
  private async situarMomentos(tx: Tx, conversaId: string) {
    await tx.query(
      `UPDATE conversa_momentos m
       SET em_ms = greatest(0, (extract(epoch FROM m.criado_em - c.iniciada_em) * 1000)::integer)
       FROM conversas c
       WHERE c.id = m.conversa_id AND m.conversa_id = $1 AND m.em_ms IS NULL`,
      [conversaId],
    );
    await tx.query(
      `UPDATE conversa_momentos m SET turno_id = (
         SELECT t.id FROM conversa_turnos t
         WHERE t.conversa_id = m.conversa_id
           AND CASE WHEN m.tipo = 'resposta_com_fonte'
                    THEN t.papel = 'agente' AND t.inicio_ms >= m.em_ms
                    ELSE t.inicio_ms <= m.em_ms END
         ORDER BY CASE WHEN m.tipo = 'resposta_com_fonte' THEN t.inicio_ms ELSE -t.inicio_ms END
         LIMIT 1)
       WHERE m.conversa_id = $1 AND m.turno_id IS NULL AND m.em_ms IS NOT NULL`,
      [conversaId],
    );
    await tx.query(
      `INSERT INTO citacoes (turno_id, trecho_id)
       SELECT DISTINCT m.turno_id, tr.id
       FROM conversa_momentos m
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(m.dados->'trechos') = 'array' THEN m.dados->'trechos' ELSE '[]' END) AS x(id)
       JOIN trechos tr ON tr.id::text = x.id
       WHERE m.conversa_id = $1 AND m.tipo = 'resposta_com_fonte' AND m.turno_id IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [conversaId],
    );
  }

  /**
   * A gravação só se guarda com consentimento. Se a transcrição ainda não
   * chegou (não se sabe do consentimento), 503 para o ElevenLabs repetir.
   */
  async audio(d: {
    conversation_id: string;
    agent_id: string;
    full_audio: string;
  }): Promise<{ guardada: boolean; motivo?: string }> {
    const [c] = await this.db.query<{
      id: string;
      municipio_id: string;
      terminada_em: Date | null;
      consentimento_em: Date | null;
      gravacao_key: string | null;
    }>(
      `SELECT id, municipio_id, terminada_em, consentimento_em, gravacao_key
       FROM conversas WHERE provider_id = $1`,
      [d.conversation_id],
    );
    if (!c || !c.terminada_em) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'transcricao_por_chegar',
        'A transcrição desta conversa ainda não chegou; repetir depois.',
      );
    }
    if (c.gravacao_key) return { guardada: true };
    if (!c.consentimento_em) {
      return { guardada: false, motivo: 'sem_consentimento' };
    }
    if (!this.armazenamento.disponivel) {
      this.logger.warn(
        `Gravação de ${c.id} não guardada: armazenamento por configurar.`,
      );
      return { guardada: false, motivo: 'sem_armazenamento' };
    }
    const municipio = await this.municipios.porId(c.municipio_id);
    const chave = this.armazenamento.chave(municipio.slug, 'gravacoes', 'mp3');
    await this.armazenamento.guardar(
      chave,
      Buffer.from(d.full_audio, 'base64'),
      'audio/mpeg',
    );
    await this.db.query(
      `UPDATE conversas SET gravacao_key = $2 WHERE id = $1 AND gravacao_key IS NULL`,
      [c.id, chave],
    );
    return { guardada: true };
  }
}
