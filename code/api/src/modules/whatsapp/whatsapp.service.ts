import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assinaturaValida } from '../../common/twilio.js';
import { DatabaseService } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ChatService } from '../chat/chat.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { normalizarTelefone } from '../municipes/municipes.service.js';
import {
  SmsEntradaService,
  type MunicipioSms,
} from '../sms-entrada/sms-entrada.service.js';

export const FILA_WHATSAPP = 'whatsapp_responder';

/** Por número e por hora (cada resposta passa pelo agente e custa). */
export const MAXIMO_POR_HORA = 30;
/** A Meta só deixa responder livremente nas 24 h a seguir à mensagem da pessoa. */
const JANELA_H = 24;
/** O Twilio corta mensagens de WhatsApp acima disto. */
export const MAXIMO_CARACTERES = 1600;

/** "whatsapp:+351912345678" → "+351912345678". */
export function numeroWhatsapp(v: string | undefined): string | null {
  if (!v) return null;
  return normalizarTelefone(v.replace(/^whatsapp:/i, ''));
}

/** Parte uma resposta longa em mensagens (por parágrafos, depois por frases). */
export function partir(texto: string, max = MAXIMO_CARACTERES): string[] {
  const partes: string[] = [];
  let atual = '';
  for (const bloco of texto.split(/(?<=\n\n)|(?<=[.!?] )/)) {
    if ((atual + bloco).length > max && atual) {
      partes.push(atual.trim());
      atual = '';
    }
    atual += bloco.length > max ? bloco.slice(0, max) : bloco;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

/**
 * WhatsApp: a pessoa escreve para o número da câmara e fala com o mesmo
 * agente do chat (as mesmas ferramentas; o número do WhatsApp identifica-a
 * como o número numa chamada). Uma conversa por número, nova ao fim de 24 h.
 * Sem IA, responde como o SMS (estado do processo, PARAR, ajuda).
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  /** Conversas com uma resposta em curso (uma instância da API). */
  private readonly emCurso = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    private readonly chat: ChatService,
    private readonly conversas: ConversasService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly sms: SmsEntradaService,
  ) {}

  urlWebhook(): string {
    return `${this.config.get<string>('app.apiUrl') ?? ''}/v1/webhooks/whatsapp/entrada`;
  }

  assinaturaValida(p: Record<string, string>, assinatura?: string): boolean {
    const token =
      this.config.get<{ authToken: string }>('comunicacao.twilio')?.authToken ??
      '';
    return assinaturaValida(token, this.urlWebhook(), p, assinatura);
  }

  private async municipioDoNumero(para: string): Promise<MunicipioSms | null> {
    const [m] = await this.db.query<MunicipioSms>(
      `SELECT id, slug, nome, fuso, telefone_linha FROM municipios
       WHERE regexp_replace(coalesce(telefone_whatsapp, ''), '[^0-9+]', '', 'g') = $1
          OR regexp_replace(coalesce(telefone_linha, ''), '[^0-9+]', '', 'g') = $1
       ORDER BY (telefone_whatsapp IS NOT NULL) DESC
       LIMIT 1`,
      [para],
    );
    return m ?? null;
  }

  /** Webhook: grava a mensagem e põe a resposta na fila. */
  async receber(p: Record<string, string>): Promise<'na_fila' | 'ignorada'> {
    const de = numeroWhatsapp(p['From']);
    const para = numeroWhatsapp(p['To']);
    const sid = p['MessageSid'] ?? null;
    let texto = (p['Body'] ?? '').trim().slice(0, 2000);
    const media = Number(p['NumMedia'] ?? 0);
    if (media > 0) {
      // Fotos e áudios ainda não são lidos: o agente fica a saber que vieram.
      texto = `${texto}${texto ? '\n' : ''}[A pessoa enviou ${media === 1 ? 'um anexo' : `${media} anexos`} (foto ou áudio) que ainda não consigo ver.]`;
    }
    if (!de || !para || !texto) return 'ignorada';
    const m = await this.municipioDoNumero(para);
    if (!m) {
      this.logger.warn(`WhatsApp para um número sem município: ${para}`);
      return 'ignorada';
    }

    const [recentes] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM whatsapp_recebidas
       WHERE municipio_id = $1 AND de = $2 AND recebida_em > now() - interval '1 hour'`,
      [m.id, de],
    );
    const excesso = (recentes?.n ?? 0) >= MAXIMO_POR_HORA;

    // A conversa aberta deste número (última mensagem há menos de 24 h).
    const [aberta] = await this.db.query<{ id: string }>(
      `SELECT c.id FROM conversas c
       WHERE c.municipio_id = $1 AND c.canal = 'whatsapp' AND c.terminada_em IS NULL
         AND c.provider_id LIKE $2
         AND coalesce((SELECT max(w.recebida_em) FROM whatsapp_recebidas w WHERE w.conversa_id = c.id),
                      c.iniciada_em) > now() - make_interval(hours => $3)
       ORDER BY c.iniciada_em DESC LIMIT 1`,
      [m.id, `wa:${de}:%`, JANELA_H],
    );
    const conversaId =
      aberta?.id ??
      (
        await this.conversas.garantir({
          municipioId: m.id,
          canal: 'whatsapp',
          providerId: `wa:${de}:${Date.now()}`,
          telefone: de,
        })
      ).conversaId;

    const [nova] = await this.db.query<{ id: string }>(
      `INSERT INTO whatsapp_recebidas (municipio_id, conversa_id, de, texto, provider_id, estado)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider_id) DO NOTHING RETURNING id`,
      [m.id, conversaId, de, texto, sid, excesso ? 'ignorada' : 'pendente'],
    );
    if (!nova || excesso) return 'ignorada';
    // Um job por mensagem: se a conversa estiver a meio de uma resposta, o
    // job tenta outra vez e apanha o que entretanto chegou (ou já não há nada).
    await this.jobs.enviar(
      FILA_WHATSAPP,
      { conversaId },
      { retryLimit: 10, retryDelay: 3 },
    );
    return 'na_fila';
  }

  /**
   * O trabalho da fila: junta as mensagens pendentes da conversa num turno,
   * corre o agente (ou o menu sem IA) e responde por WhatsApp.
   */
  async responder(conversaId: string): Promise<void> {
    // Verificar e marcar sem nenhum await pelo meio: dois jobs da mesma
    // conversa nunca leem as mesmas mensagens.
    if (this.emCurso.has(conversaId)) {
      throw new Error(
        `WhatsApp: conversa ${conversaId} a meio de uma resposta.`,
      );
    }
    this.emCurso.add(conversaId);
    try {
      await this.responderJa(conversaId);
    } finally {
      this.emCurso.delete(conversaId);
    }
  }

  private async responderJa(conversaId: string): Promise<void> {
    const pendentes = await this.db.query<{
      id: string;
      texto: string;
      de: string;
    }>(
      `SELECT id, texto, de FROM whatsapp_recebidas
       WHERE conversa_id = $1 AND estado = 'pendente' ORDER BY recebida_em`,
      [conversaId],
    );
    if (!pendentes.length) return;
    const [c] = await this.db.query<{
      municipio_id: string;
      municipe_id: string | null;
      iniciada_em: Date;
    }>(
      `SELECT municipio_id, municipe_id, iniciada_em FROM conversas WHERE id = $1`,
      [conversaId],
    );
    const de = pendentes[0].de;
    const municipio = await this.municipios.porId(c.municipio_id);
    const texto = pendentes.map((x) => x.texto).join('\n');

    let resposta: string;
    if (this.chat.iaDisponivel) {
      const r = await this.chat.turno(
        {
          conversaId,
          municipio,
          municipeId: c.municipe_id,
          telefone: de,
          iniciadaEm: c.iniciada_em,
        },
        texto,
        'whatsapp',
      );
      resposta =
        r.texto ??
        'Desculpe, não consegui responder agora. Tente daqui a pouco ou ligue para a câmara.';
    } else {
      const [m] = await this.db.query<MunicipioSms>(
        `SELECT id, slug, nome, fuso, telefone_linha FROM municipios WHERE id = $1`,
        [c.municipio_id],
      );
      resposta = await this.sms.respostaSemIa(
        m,
        de,
        c.municipe_id,
        texto,
        'whatsapp',
      );
    }

    // Marca antes de enviar: se o envio falhar, a mensagem fica na fila dos
    // envios (com tentativas), não se volta a correr o agente.
    await this.db.query(
      `UPDATE whatsapp_recebidas SET estado = 'respondida' WHERE id = ANY($1::uuid[])`,
      [pendentes.map((x) => x.id)],
    );
    for (const [i, parte] of partir(resposta).entries()) {
      await this.mensagens.sms({
        canal: 'whatsapp',
        municipioId: c.municipio_id,
        municipeId: c.municipe_id,
        destino: de,
        motivo: 'resposta_sms',
        corpo: parte,
        relacionado: { conversa_id: conversaId },
        chave: `whatsapp:${pendentes[pendentes.length - 1].id}:${i}`,
      });
    }
  }
}
