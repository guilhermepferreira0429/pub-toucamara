import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { ErroApi } from '../../common/erros.js';
import { comunicacaoConfig } from '../../config/configuration.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { mascararTelefone } from '../municipes/municipes.service.js';
import { assinaturaValida } from '../../common/twilio.js';
import { destinoSimulado, FORNECEDOR_SIMULADO } from './destino-simulado.js';
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
  | 'identificacao'
  | 'aviso'
  | 'familiar'
  | 'resposta_sms'
  | 'apoio'
  | 'carta'
  | 'atestado';

/**
 * Confirmações que, numa chamada em curso, esperam pelo SMS do fim (que já as
 * resume e cuja página as mostra): um SMS por chamada, não dois.
 */
const RETIDAS_NA_CHAMADA: ReadonlySet<MotivoMensagem> = new Set([
  'recolha',
  'marcacao',
]);

/** Rede de segurança: a retida sai sozinha se o fim da chamada não tratar dela. */
export const RETER_NA_CHAMADA_MIN = 20;

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
  /**
   * 'whatsapp': resposta a quem escreveu por WhatsApp (só dentro das 24 h
   * depois da última mensagem da pessoa; fora disso o WhatsApp exige
   * modelos aprovados e os avisos continuam por SMS).
   */
  canal?: 'sms' | 'whatsapp';
  /**
   * Destino SIMULADO (ex.: número gerado pela fonte simulada dos operadores
   * nos avisos de emergência): pode coincidir com o número de uma pessoa
   * real. Fica gravado e conta como enviado, mas NUNCA sai para o Twilio
   * nem para outro fornecedor, qualquer que seja o SMS_PROVIDER.
   */
  simulado?: boolean;
}

/** O que fica num envio simulado (`provider_id`). */
export { FORNECEDOR_SIMULADO };

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
 * SMS_PROVIDER=twilio envia pela API REST do Twilio, com o remetente
 * alfanumérico. Sem SMS_PROVIDER, em dev o SMS é escrito no log e fica
 * `enviada` com provider 'log'; em produção fica `falhou`. Nunca se finge um
 * envio real.
 *
 * Barreira dos destinos simulados (`simulado = true`): o envio verifica a
 * marca na própria linha antes de olhar para o fornecedor e fica `enviada`
 * com provider 'simulado', sem pedido nenhum para fora. A BD recusa uma
 * linha simulada com a referência de um fornecedor (migração 0072).
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

  /** Onde o Twilio avisa o estado do SMS (só com a API num endereço público). */
  urlEstadoSms(): string | null {
    const api = this.config.get<string>('app.apiUrl') ?? '';
    return /^https:\/\//.test(api) ? `${api}/v1/webhooks/sms/estado` : null;
  }

  /**
   * StatusCallback do Twilio (assinado): `delivered` → entregue; `failed` e
   * `undelivered` → falhou, com o código do erro. Um SMS entregue não volta
   * atrás (os avisos podem chegar fora de ordem). Devolve false se a
   * assinatura não for válida.
   */
  async estadoTwilio(
    parametros: Record<string, string>,
    assinatura: string | undefined,
  ): Promise<boolean> {
    const url = this.urlEstadoSms();
    const { twilio } = this.cfg();
    if (
      !url ||
      !assinaturaValida(twilio.authToken, url, parametros, assinatura)
    ) {
      return false;
    }
    const sid = parametros['MessageSid'] ?? parametros['SmsSid'];
    const estado = parametros['MessageStatus'] ?? parametros['SmsStatus'];
    if (!sid) return true;
    if (estado === 'delivered') {
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'entregue', entregue_em = now(), erro = NULL
         WHERE provider_id = $1 AND canal IN ('sms', 'whatsapp')`,
        [sid],
      );
    } else if (estado === 'failed' || estado === 'undelivered') {
      const codigo = parametros['ErrorCode'];
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'falhou', erro = $2
         WHERE provider_id = $1 AND canal IN ('sms', 'whatsapp') AND estado <> 'entregue'`,
        [sid, `Twilio: ${estado}${codigo ? ` (${codigo})` : ''}`],
      );
    }
    return true;
  }

  private producao(): boolean {
    return this.config.get<string>('app.ambiente') === 'production';
  }

  onModuleInit() {
    // 4 em paralelo: numa emergência ou numa campanha saem dezenas de SMS
    // seguidos e os outros (códigos, links) não podem ficar à espera.
    this.jobs.trabalhar<{ mensagemId: string }>(
      FILA_SMS,
      ({ mensagemId }) => this.enviarAgora(mensagemId),
      { concorrencia: 4 },
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
    const whatsapp = novo.canal === 'whatsapp';
    // O WhatsApp aceita acentos e mensagens longas: só o SMS se adapta.
    const corpo =
      this.cfg().smsTransliterar && !whatsapp
        ? transliterar(novo.corpo)
        : novo.corpo;
    const info = whatsapp
      ? { codificacao: null, segmentos: null }
      : infoSms(corpo);
    // Sem data é para já: 'pendente'. (Dentro de uma transação o now() é a
    // hora do BEGIN, por isso não se compara com a hora da aplicação.)
    const q = tx ?? this.db;
    const retida = await this.reterNaChamada(novo, q);
    const enviarEm = retida
      ? new Date(Date.now() + RETER_NA_CHAMADA_MIN * 60_000)
      : (novo.enviarEm ?? null);
    const [criada] = await q.query<{ id: string }>(
      `INSERT INTO mensagens_saida (municipio_id, municipe_id, canal, destino, motivo, corpo,
         codificacao, segmentos, relacionado, enviar_em, estado, chave_idempotencia, simulado,
         retida_fim_chamada)
       VALUES ($1, $2, $11, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()),
         CASE WHEN $9::timestamptz > clock_timestamp() THEN 'agendada' ELSE 'pendente' END::estado_msg, $10, $12,
         $13)
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
        whatsapp ? 'whatsapp' : 'sms',
        novo.simulado === true,
        retida,
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

  /**
   * Uma confirmação (RETIDAS_NA_CHAMADA) de uma chamada de voz ainda em
   * curso espera pelo SMS do fim. No WhatsApp e no chat não há SMS do fim:
   * sai logo.
   */
  private async reterNaChamada(novo: NovoSms, q: Tx | DatabaseService) {
    const conversaId = novo.relacionado?.conversa_id;
    if (
      !conversaId ||
      novo.enviarEm ||
      novo.canal === 'whatsapp' ||
      !RETIDAS_NA_CHAMADA.has(novo.motivo)
    ) {
      return false;
    }
    const [c] = await q.query<{ id: string }>(
      `SELECT id FROM conversas
       WHERE id = $1 AND canal = 'telefone' AND resultado = 'em_curso'`,
      [conversaId],
    );
    return !!c;
  }

  /**
   * No fim da chamada: com o SMS do fim enviado, as retidas ficam
   * 'cancelada' (estão no resumo); sem ele, saem já.
   */
  async fecharRetidas(
    conversaId: string,
    fimEnviado: boolean,
    tx?: Tx,
  ): Promise<string[]> {
    const q = tx ?? this.db;
    if (fimEnviado) {
      await q.query(
        `UPDATE mensagens_saida
         SET estado = 'cancelada', erro = 'Incluída no SMS do fim da chamada.'
         WHERE retida_fim_chamada AND estado = 'agendada'
           AND relacionado->>'conversa_id' = $1`,
        [conversaId],
      );
      return [];
    }
    const soltas = await q.query<{ id: string }>(
      `UPDATE mensagens_saida SET estado = 'pendente', enviar_em = now()
       WHERE retida_fim_chamada AND estado = 'agendada'
         AND relacionado->>'conversa_id' = $1
       RETURNING id`,
      [conversaId],
    );
    for (const m of soltas) {
      await this.jobs.enviar(
        FILA_SMS,
        { mensagemId: m.id },
        { singletonKey: `${m.id}:solta` },
      );
    }
    return soltas.map((m) => m.id);
  }

  /** O trabalho da fila `sms_enviar`. */
  async enviarAgora(mensagemId: string): Promise<void> {
    const [m] = await this.db.query<{
      destino: string;
      corpo: string;
      estado: string;
      canal: 'sms' | 'whatsapp' | 'email';
      simulado: boolean;
    }>(
      'SELECT destino, corpo, estado, canal, simulado FROM mensagens_saida WHERE id = $1',
      [mensagemId],
    );
    if (!m) throw new Error(`Mensagem ${mensagemId} ainda não existe.`);
    if (!['agendada', 'pendente'].includes(m.estado)) return;

    // BARREIRA (um só ponto, destinoSimulado): destinos simulados e a gama
    // de teste da demonstração nunca saem, com qualquer fornecedor e em
    // qualquer ambiente; ficam 'enviada' para o painel mostrar.
    const bloqueado = destinoSimulado(m);
    if (bloqueado) {
      this.logger.log(
        `SMS para ${mascararTelefone(m.destino)} (${bloqueado.motivo}): gravado, não enviado.`,
      );
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'enviada', enviada_em = now(), provider_id = $2, erro = NULL
         WHERE id = $1`,
        [mensagemId, bloqueado.fornecedor],
      );
      return;
    }

    const { smsProvider } = this.cfg();
    if (smsProvider === 'twilio') {
      const r = await this.enviarTwilio(
        m.destino,
        m.corpo,
        m.canal === 'whatsapp',
        m,
      );
      if ('sid' in r) {
        await this.db.query(
          `UPDATE mensagens_saida SET estado = 'enviada', enviada_em = now(), provider_id = $2 WHERE id = $1`,
          [mensagemId, r.sid],
        );
      } else {
        this.logger.warn(`SMS ${mensagemId} recusado pelo Twilio: ${r.erro}`);
        await this.db.query(
          `UPDATE mensagens_saida SET estado = 'falhou', erro = $2 WHERE id = $1`,
          [mensagemId, r.erro],
        );
      }
      return;
    }
    if (!smsProvider || smsProvider === 'consola') {
      if (this.producao() && !smsProvider) {
        await this.db.query(
          `UPDATE mensagens_saida SET estado = 'falhou', erro = 'SMS_PROVIDER por configurar' WHERE id = $1`,
          [mensagemId],
        );
        return;
      }
      this.logger.log(
        `${m.canal === 'whatsapp' ? 'WhatsApp' : 'SMS'} para ${mascararTelefone(m.destino)}:\n${m.corpo}`,
      );
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'enviada', enviada_em = now(), provider_id = 'log' WHERE id = $1`,
        [mensagemId],
      );
      return;
    }
    throw new Error(`SMS_PROVIDER desconhecido: ${smsProvider}`);
  }

  /**
   * POST /Messages do Twilio. Recusas definitivas (4xx: número inválido,
   * sem saldo...) devolvem `erro` e a mensagem fica `falhou`; 429, 5xx e
   * falhas de rede lançam, para o pg-boss repetir.
   */
  private async enviarTwilio(
    destino: string,
    corpo: string,
    whatsapp: boolean,
    linha: { destino: string; simulado: boolean },
  ): Promise<{ sid: string } | { erro: string }> {
    // Segunda barreira, mesmo à porta do fornecedor.
    const bloqueado = destinoSimulado(linha);
    if (bloqueado) {
      throw new Error(
        `Destino ${bloqueado.motivo}: nunca se envia para o Twilio.`,
      );
    }
    const { smsRemetente, whatsappRemetente, twilio } = this.cfg();
    if (!twilio.accountSid || !twilio.authToken) {
      return { erro: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN por configurar' };
    }
    if (whatsapp && !whatsappRemetente) {
      return { erro: 'WHATSAPP_REMETENTE por configurar' };
    }
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: whatsapp ? `whatsapp:${destino}` : destino,
          From: whatsapp ? `whatsapp:${whatsappRemetente}` : smsRemetente,
          Body: corpo,
          ...(this.urlEstadoSms()
            ? { StatusCallback: this.urlEstadoSms()! }
            : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const dados = (await resp.json().catch(() => ({}))) as {
      sid?: string;
      code?: number;
      message?: string;
    };
    if (resp.ok && dados.sid) return { sid: dados.sid };
    const erro = `Twilio ${resp.status}${dados.code ? ` (${dados.code})` : ''}: ${dados.message ?? 'sem detalhe'}`;
    if (resp.status === 429 || resp.status >= 500) throw new Error(erro);
    return { erro };
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
