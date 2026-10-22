import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assinaturaValida } from '../../common/twilio.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import {
  eIntencaoAgora,
  intencao,
  MAXIMO_POR_HORA,
  numeroNoSms,
  pareceMorada,
  respostaAgora,
  respostaAjuda,
  respostaAvisar,
  respostaEstado,
  respostaMoradaNaoEncontrada,
  respostaPedirMorada,
  tiposAvisar,
  type Intencao,
  type IntencaoAgora,
  type ResultadoAgora,
  type ResultadoAvisar,
  type ResultadoEstado,
} from './regras.js';

/** O que se grava em `sms_recebidos.intencao`. */
export type IntencaoSms = Intencao | 'morada';

/** Quanto tempo esperamos pela rua/freguesia depois de a pedir. */
const ESPERA_MORADA_HORAS = 24;

interface ResultadoFerramentaAgora extends ResultadoAgora, ResultadoAvisar {
  precisa_morada?: boolean;
  morada_nao_encontrada?: boolean;
  precisa_identificacao?: boolean;
}

export interface MunicipioSms {
  id: string;
  slug: string;
  nome: string;
  fuso: string;
  telefone_linha: string | null;
}

/**
 * SMS que as pessoas mandam para o número da câmara (webhook de entrada do
 * Twilio). Usa as mesmas ferramentas do agente: `estado_processo` (só os
 * processos associados ao número que manda) e `nao_quero_avisos`. A
 * resposta sai pela fila normal dos SMS (fica no histórico da pessoa).
 */
@Injectable()
export class SmsEntradaService {
  private readonly logger = new Logger(SmsEntradaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly registo: RegistoFerramentas,
    private readonly mensagens: MensagensService,
    private readonly municipes: MunicipesService,
  ) {}

  urlWebhook(): string {
    return `${this.config.get<string>('app.apiUrl') ?? ''}/v1/webhooks/sms/entrada`;
  }

  assinaturaValida(p: Record<string, string>, assinatura?: string): boolean {
    const token =
      this.config.get<{ authToken: string }>('comunicacao.twilio')?.authToken ??
      '';
    return assinaturaValida(token, this.urlWebhook(), p, assinatura);
  }

  /** Trata um SMS recebido. Devolve a intenção (ou 'ignorado'). */
  async receber(p: Record<string, string>): Promise<IntencaoSms | 'ignorado'> {
    const de = normalizarTelefone(p['From']);
    const para = normalizarTelefone(p['To']);
    const corpo = (p['Body'] ?? '').slice(0, 1000);
    const sid = p['MessageSid'] ?? p['SmsSid'] ?? null;
    if (!de || !para) return 'ignorado';

    const [m] = await this.db.query<MunicipioSms>(
      `SELECT id, slug, nome, fuso, telefone_linha FROM municipios
       WHERE regexp_replace(coalesce(telefone_sms, ''), '[^0-9+]', '', 'g') = $1
          OR regexp_replace(coalesce(telefone_linha, ''), '[^0-9+]', '', 'g') = $1
       ORDER BY (telefone_sms IS NOT NULL) DESC
       LIMIT 1`,
      [para],
    );
    if (!m) {
      this.logger.warn(`SMS para um número sem município: ${para}`);
      return 'ignorado';
    }
    const [municipe] = await this.db.query<{ id: string }>(
      `SELECT id FROM municipes
       WHERE municipio_id = $1 AND telefone_e164 = $2 AND anonimizado_em IS NULL`,
      [m.id, de],
    );
    const [recentes] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sms_recebidos
       WHERE municipio_id = $1 AND de = $2 AND recebido_em > now() - interval '1 hour'`,
      [m.id, de],
    );
    const qual = await this.classificar(municipe?.id ?? null, corpo);
    const responder = (recentes?.n ?? 0) < MAXIMO_POR_HORA;

    const [registo] = await this.db.query<{ id: string }>(
      `INSERT INTO sms_recebidos (municipio_id, de, municipe_id, corpo, intencao, provider_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider_id) DO NOTHING
       RETURNING id`,
      [
        m.id,
        de,
        municipe?.id ?? null,
        corpo,
        responder ? qual : 'ignorado',
        sid,
      ],
    );
    // O Twilio repetiu o webhook: já tratado.
    if (!registo) return 'ignorado';
    if (!responder) return 'ignorado';

    const texto = await this.respostaSemIa(
      m,
      de,
      municipe?.id ?? null,
      corpo,
      'sms',
    );

    const resposta = await this.mensagens.sms({
      municipioId: m.id,
      municipeId: municipe?.id ?? null,
      destino: de,
      motivo: 'resposta_sms',
      corpo: texto,
      relacionado: { sms_recebido_id: registo.id },
      chave: `resposta_sms:${registo.id}`,
    });
    await this.db.query(
      `UPDATE sms_recebidos SET resposta_id = $2 WHERE id = $1`,
      [registo.id, resposta],
    );
    return qual;
  }

  /** O que estamos à espera que a pessoa diga ('obras', 'avisar:obras'...). */
  private async espera(municipeId: string | null): Promise<string | null> {
    if (!municipeId) return null;
    const [r] = await this.db.query<{ sms_espera: string | null }>(
      `SELECT sms_espera FROM municipes
       WHERE id = $1 AND sms_espera_em > now() - make_interval(hours => $2)`,
      [municipeId, ESPERA_MORADA_HORAS],
    );
    return r?.sms_espera ?? null;
  }

  /**
   * A intenção, contando com a conversa: depois de "Responda com o nome da
   * sua rua ou freguesia", o que vier (que não seja uma palavra-chave) é a
   * morada.
   */
  async classificar(
    municipeId: string | null,
    corpo: string,
  ): Promise<IntencaoSms> {
    const qual = intencao(corpo);
    if (
      (qual === 'ajuda' || qual === 'estado') &&
      pareceMorada(corpo) &&
      (await this.espera(municipeId))
    ) {
      return 'morada';
    }
    return qual;
  }

  private async esperarMorada(
    municipeId: string,
    espera: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE municipes SET sms_espera = $2, sms_espera_em = now() WHERE id = $1`,
      [municipeId, espera],
    );
  }

  /**
   * OBRAS, AVISOS, EVENTOS, INCIDENTES, AVISAR ... e a resposta com a rua:
   * pelas ferramentas o_que_se_passa e avisar_me (as mesmas do agente).
   */
  private async responderAgora(
    m: MunicipioSms,
    ctx: ContextoFerramenta,
    qual: IntencaoAgora | 'avisar' | 'morada',
    corpo: string,
  ): Promise<string> {
    let espera: string | null = null;
    let morada: string | undefined;
    if (qual === 'morada') {
      espera = await this.espera(ctx.municipeId);
      morada = corpo.trim();
    } else if (qual === 'avisar') {
      espera = `avisar:${tiposAvisar(corpo).join(',')}`;
    } else {
      espera = qual;
    }
    if (!espera) return respostaAjuda(m.nome, m.telefone_linha);

    const avisar = espera.startsWith('avisar:');
    const tipos = (avisar ? espera.slice(7) : espera)
      .split(',')
      .filter(Boolean) as IntencaoAgora[];
    const r = (await this.registo.executar(
      avisar ? 'avisar_me' : 'o_que_se_passa',
      ctx,
      avisar ? { tipos, morada } : { tipos, morada, limite: 3 },
    )) as ResultadoFerramentaAgora;

    if (r?.morada_nao_encontrada && morada) {
      if (ctx.municipeId) await this.esperarMorada(ctx.municipeId, espera);
      return respostaMoradaNaoEncontrada(m.nome, morada);
    }
    if (r?.precisa_morada) {
      // Guardamos o pedido para quando a pessoa responder com a rua.
      const municipeId =
        ctx.municipeId ??
        (await this.municipes.porTelefone(m.id, ctx.telefone))?.id ??
        null;
      if (!municipeId) return respostaAjuda(m.nome, m.telefone_linha);
      await this.esperarMorada(municipeId, espera);
      return respostaPedirMorada(m.nome);
    }
    if (avisar) {
      return r?.subscrito
        ? respostaAvisar(m.nome, r)
        : respostaAjuda(m.nome, m.telefone_linha);
    }
    return respostaAgora(m.nome, tipos[0] ?? 'obras', r ?? {});
  }

  /**
   * A resposta sem IA, pelas ferramentas do agente: estado do processo (só
   * os associados ao número), PARAR (avisos por zona), o que se passa perto
   * (OBRAS, AVISOS, EVENTOS, INCIDENTES, AVISAR ...) ou ajuda. Também a usa
   * o WhatsApp quando não há IA.
   */
  async respostaSemIa(
    m: MunicipioSms,
    de: string,
    municipeId: string | null,
    corpo: string,
    canal: 'sms' | 'whatsapp',
  ): Promise<string> {
    const ctx: ContextoFerramenta = {
      municipio: { id: m.id, slug: m.slug, nome: m.nome, fuso: m.fuso },
      canal,
      conversaId: null,
      municipeId,
      telefone: de,
    };
    const qual = await this.classificar(municipeId, corpo);
    if (qual === 'morada' || qual === 'avisar' || eIntencaoAgora(qual)) {
      return this.responderAgora(m, ctx, qual, corpo);
    }
    if (qual === 'parar') {
      const r = (await this.registo.executar('nao_quero_avisos', ctx, {})) as {
        dizer?: string;
      };
      return (
        r?.dizer ??
        'Este número não está na lista de avisos da câmara: não tem nada para desligar.'
      );
    }
    if (qual === 'estado') {
      const r = (await this.registo.executar('estado_processo', ctx, {
        numero: numeroNoSms(corpo),
      })) as ResultadoEstado;
      return respostaEstado(r, m.telefone_linha);
    }
    return respostaAjuda(m.nome, m.telefone_linha);
  }
}
