import { Injectable } from '@nestjs/common';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';

export type Canal =
  'telefone' | 'chat' | 'sms' | 'email' | 'balcao' | 'whatsapp';

export type TipoMomento =
  | 'consentimento'
  | 'pergunta_de_volta'
  | 'resposta_com_fonte'
  | 'requerimento'
  | 'ocorrencia'
  | 'marcacao'
  | 'recolha'
  | 'pagamento'
  | 'sms'
  | 'passagem'
  | 'emergencia'
  | 'idioma';

export interface ConversaGarantida {
  conversaId: string;
  municipeId: string | null;
}

/**
 * Conversas de todos os canais. A primeira ferramenta que o agente chama numa
 * chamada cria a conversa (pelo id do ElevenLabs); o webhook do fim da
 * chamada completa-a com turnos, gravação e resultado.
 */
@Injectable()
export class ConversasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipes: MunicipesService,
  ) {}

  /** A conversa deste provider_id (cria se não existir), ligada ao munícipe do número. */
  async garantir(args: {
    municipioId: string;
    canal: Canal;
    providerId: string;
    telefone?: string | null;
  }): Promise<ConversaGarantida> {
    return this.db.transaction(async (tx) => {
      const municipe = await this.municipes.porTelefone(
        args.municipioId,
        args.telefone,
        tx,
      );
      const [c] = await tx.query<{ id: string; municipe_id: string | null }>(
        `INSERT INTO conversas (municipio_id, municipe_id, canal, provider_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider_id) DO UPDATE
           SET municipe_id = coalesce(conversas.municipe_id, EXCLUDED.municipe_id)
         RETURNING id, municipe_id`,
        [args.municipioId, municipe?.id ?? null, args.canal, args.providerId],
      );
      return { conversaId: c.id, municipeId: c.municipe_id };
    });
  }

  /** Liga um munícipe à conversa (ex.: identificado pelo NIF a meio da chamada). */
  async ligarMunicipe(conversaId: string, municipeId: string, tx?: Tx) {
    await (tx ?? this.db).query(
      'UPDATE conversas SET municipe_id = $2 WHERE id = $1',
      [conversaId, municipeId],
    );
  }

  /** Marcador na linha do tempo e no leitor de áudio da conversa. */
  async momento(
    conversaId: string | null,
    tipo: TipoMomento,
    dados: Record<string, unknown> = {},
    tx?: Tx,
  ): Promise<void> {
    if (!conversaId) return;
    await (tx ?? this.db).query(
      `INSERT INTO conversa_momentos (conversa_id, tipo, dados) VALUES ($1, $2, $3)`,
      [conversaId, tipo, JSON.stringify(dados)],
    );
  }
}
