import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assinaturaValida } from '../../common/twilio.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { normalizarTelefone } from '../municipes/municipes.service.js';
import {
  intencao,
  MAXIMO_POR_HORA,
  numeroNoSms,
  respostaAjuda,
  respostaEstado,
  type Intencao,
  type ResultadoEstado,
} from './regras.js';

interface MunicipioSms {
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
  async receber(p: Record<string, string>): Promise<Intencao | 'ignorado'> {
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
    const qual = intencao(corpo);
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

    const ctx: ContextoFerramenta = {
      municipio: { id: m.id, slug: m.slug, nome: m.nome, fuso: m.fuso },
      canal: 'sms',
      conversaId: null,
      municipeId: municipe?.id ?? null,
      telefone: de,
    };
    let texto: string;
    if (qual === 'parar') {
      const r = (await this.registo.executar('nao_quero_avisos', ctx, {})) as {
        dizer?: string;
      };
      texto =
        r?.dizer ??
        'Este número não está na lista de avisos da câmara: não tem nada para desligar.';
    } else if (qual === 'estado') {
      const r = (await this.registo.executar('estado_processo', ctx, {
        numero: numeroNoSms(corpo),
      })) as ResultadoEstado;
      texto = respostaEstado(r, m.telefone_linha);
    } else {
      texto = respostaAjuda(m.nome, m.telefone_linha);
    }

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
}
