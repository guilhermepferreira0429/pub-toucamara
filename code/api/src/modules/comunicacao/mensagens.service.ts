import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { ErroApi } from '../../common/erros.js';
import { comunicacaoConfig } from '../../config/configuration.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { mascararTelefone } from '../municipes/municipes.service.js';
import { infoSms, transliterar } from './sms.js';

export type MotivoMensagem =
  | 'fim_chamada'
  | 'requerimento'
  | 'ocorrencia'
  | 'processo'
  | 'prazo'
  | 'marcacao'
  | 'lembrete'
  | 'recolha'
  | 'pagamento'
  | 'reclamacao'
  | 'relatorio'
  | 'passagem'
  | 'identificacao';

export interface NovoSms {
  municipioId: string;
  municipeId?: string | null;
  /** E.164. */
  destino: string;
  motivo: MotivoMensagem;
  corpo: string;
  /** Ids ligados, para o painel: { conversa_id, processo_id, ... }. */
  relacionado?: Record<string, string>;
  /** Evita o mesmo SMS duas vezes (ex.: `fim_chamada:<conversa_id>`). */
  chave?: string;
  /** Lembretes: quando enviar. Por defeito, já. */
  enviarEm?: Date;
}

export interface NovoEmail {
  para: string;
  assunto: string;
  texto: string;
  html?: string;
  anexos?: { nome: string; conteudo: Buffer; mime: string }[];
}

const FILA_SMS = 'sms_enviar';

/**
 * Tudo o que sai para o munícipe passa por aqui: grava em `mensagens_saida`
 * e põe na fila. O envio é idempotente por `chave` e conta segmentos.
 *
 * Fornecedor de SMS ainda por escolher (decisão em aberto 4): sem
 * SMS_PROVIDER, em dev o SMS é escrito no log e fica `enviada` com
 * provider 'log'; em produção fica `falhou`. Nunca se finge um envio real.
 */
@Injectable()
export class MensagensService implements OnModuleInit {
  private readonly logger = new Logger(MensagensService.name);
  private correio: Transporter | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  private cfg() {
    return this.config.getOrThrow<ConfigType<typeof comunicacaoConfig>>(
      'comunicacao',
    );
  }

  private producao(): boolean {
    return this.config.get<string>('app.ambiente') === 'production';
  }

  onModuleInit() {
    this.jobs.trabalhar<{ mensagemId: string }>(FILA_SMS, ({ mensagemId }) =>
      this.enviarAgora(mensagemId),
    );
    const { smtp } = this.cfg();
    if (smtp.host) {
      this.correio = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      });
    }
  }

  /** Grava e põe na fila. Devolve o id (o existente, se a chave já foi usada). */
  async sms(novo: NovoSms, tx?: Tx): Promise<string> {
    const corpo = this.cfg().smsTransliterar
      ? transliterar(novo.corpo)
      : novo.corpo;
    const info = infoSms(corpo);
    // Sem data é para já: 'pendente'. (Dentro de uma transação o now() é a
    // hora do BEGIN, por isso não se compara com a hora da aplicação.)
    const enviarEm = novo.enviarEm ?? null;
    const q = tx ?? this.db;
    const [criada] = await q.query<{ id: string }>(
      `INSERT INTO mensagens_saida (municipio_id, municipe_id, canal, destino, motivo, corpo,
         codificacao, segmentos, relacionado, enviar_em, estado, chave_idempotencia)
       VALUES ($1, $2, 'sms', $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()),
         CASE WHEN $9::timestamptz > clock_timestamp() THEN 'agendada' ELSE 'pendente' END::estado_msg, $10)
       ON CONFLICT (chave_idempotencia) DO NOTHING
       RETURNING id`,
      [
        novo.municipioId,
        novo.municipeId ?? null,
        novo.destino,
        novo.motivo,
        corpo,
        info.codificacao,
        info.segmentos,
        JSON.stringify(novo.relacionado ?? {}),
        enviarEm,
        novo.chave ?? null,
      ],
    );
    if (!criada) {
      const [existente] = await q.query<{ id: string }>(
        'SELECT id FROM mensagens_saida WHERE chave_idempotencia = $1',
        [novo.chave],
      );
      return existente.id;
    }
    // Dentro de uma transação, o job pode correr antes do COMMIT: o
    // enviarAgora volta a tentar se ainda não vir a linha.
    await this.jobs.enviar(
      FILA_SMS,
      { mensagemId: criada.id },
      { startAfter: enviarEm ?? undefined, singletonKey: criada.id },
    );
    return criada.id;
  }

  /** O trabalho da fila `sms_enviar`. */
  async enviarAgora(mensagemId: string): Promise<void> {
    const [m] = await this.db.query<{
      destino: string;
      corpo: string;
      estado: string;
    }>('SELECT destino, corpo, estado FROM mensagens_saida WHERE id = $1', [
      mensagemId,
    ]);
    if (!m) throw new Error(`Mensagem ${mensagemId} ainda não existe.`);
    if (!['agendada', 'pendente'].includes(m.estado)) return;

    const { smsProvider } = this.cfg();
    if (!smsProvider || smsProvider === 'consola') {
      if (this.producao() && !smsProvider) {
        await this.db.query(
          `UPDATE mensagens_saida SET estado = 'falhou', erro = 'SMS_PROVIDER por configurar' WHERE id = $1`,
          [mensagemId],
        );
        return;
      }
      this.logger.log(`SMS para ${mascararTelefone(m.destino)}:\n${m.corpo}`);
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'enviada', enviada_em = now(), provider_id = 'log' WHERE id = $1`,
        [mensagemId],
      );
      return;
    }
    throw new Error(`SMS_PROVIDER desconhecido: ${smsProvider}`);
  }

  /** Email direto (links mágicos, relatórios). Sem SMTP: dev escreve no log. */
  async email(novo: NovoEmail): Promise<void> {
    if (!this.correio) {
      if (this.producao()) {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'email_indisponivel',
          'SMTP por configurar.',
        );
      }
      this.logger.log(
        `Email para ${novo.para} · ${novo.assunto}\n${novo.texto}`,
      );
      return;
    }
    await this.correio.sendMail({
      from: this.cfg().smtp.from,
      to: novo.para,
      subject: novo.assunto,
      text: novo.texto,
      html: novo.html,
      attachments: novo.anexos?.map((a) => ({
        filename: a.nome,
        content: a.conteudo,
        contentType: a.mime,
      })),
    });
  }
}
