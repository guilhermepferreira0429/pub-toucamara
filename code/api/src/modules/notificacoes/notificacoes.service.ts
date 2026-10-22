import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { telefoneParaSms } from '../avisos-zona/avisos-zona.regras.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';

/*
 * Notificações ao munícipe: um só ponto para "avisar esta pessoa", seja por
 * SMS, seja por push na app. Quem avisa (as subscrições "avise-me" do feed,
 * e o que vier) chama `NotificacoesService.notificar(municipeId, {...})` e
 * não sabe por onde sai.
 *
 * PONTO DE EXTENSÃO (push com Firebase): criar uma classe que implemente
 * `CanalNotificacao` (nome 'push'; devolve `{ enviada: false }` quando a
 * pessoa não tem a app/token) e pô-la ANTES do SMS na lista do provider
 * `CANAIS_NOTIFICACAO` em notificacoes.module.ts. O serviço tenta os canais
 * por ordem e pára no primeiro que enviar: com a app vai por push, sem app
 * por SMS. Hoje só há o SMS.
 */

/** O que se diz à pessoa (o canal decide o formato). */
export interface Notificacao {
  /** Curto: o título da notificação push ("Obras perto de si"). */
  titulo: string;
  /**
   * O texto. No SMS é o corpo todo (já curto, com o link se couber); no
   * push é a linha por baixo do título.
   */
  corpo: string;
  /** Para onde abre (página ou deep link da app); null se não houver. */
  link: string | null;
  /** O assunto, para a app agrupar e para as estatísticas ('agora:obras'...). */
  tipo: string;
}

export interface OpcoesNotificacao {
  /** Idempotência: a mesma chave não sai duas vezes (em cada canal). */
  chave?: string;
  /** Ids ligados, para o painel. */
  relacionado?: Record<string, string>;
  /** Emergência: ignora o "não quero avisos" (quem chama decide a hora). */
  urgente?: boolean;
  tx?: Tx;
}

/** A pessoa, como os canais a veem. */
export interface DestinatarioNotificacao {
  municipeId: string;
  municipioId: string;
  telefone: string | null;
  aceitaAvisos: boolean;
}

export interface ResultadoCanal {
  enviada: boolean;
  /** Id da mensagem (mensagens_saida) ou da notificação no fornecedor. */
  id?: string | null;
  motivo?: string;
}

export interface CanalNotificacao {
  readonly nome: string;
  enviar(
    d: DestinatarioNotificacao,
    n: Notificacao,
    o: OpcoesNotificacao,
  ): Promise<ResultadoCanal>;
}

export interface ResultadoNotificacao {
  enviada: boolean;
  canal: string | null;
  id: string | null;
  /** Porque não saiu (quando não saiu por nenhum canal). */
  motivo?: string;
}

/** Os canais, por ordem de preferência (ver notificacoes.module.ts). */
export const CANAIS_NOTIFICACAO = Symbol('CANAIS_NOTIFICACAO');

/** SMS (motivo 'aviso'): respeita o "não quero avisos" salvo urgência. */
@Injectable()
export class CanalSms implements CanalNotificacao {
  readonly nome = 'sms';

  constructor(private readonly mensagens: MensagensService) {}

  async enviar(
    d: DestinatarioNotificacao,
    n: Notificacao,
    o: OpcoesNotificacao,
  ): Promise<ResultadoCanal> {
    if (!telefoneParaSms(d.telefone)) {
      return { enviada: false, motivo: 'sem_telemovel' };
    }
    if (!d.aceitaAvisos && !o.urgente) {
      return { enviada: false, motivo: 'recusou_avisos' };
    }
    const id = await this.mensagens.sms(
      {
        municipioId: d.municipioId,
        municipeId: d.municipeId,
        destino: d.telefone as string,
        motivo: 'aviso',
        corpo: n.corpo,
        relacionado: { notificacao: n.tipo, ...(o.relacionado ?? {}) },
        chave: o.chave ? `notificacao:sms:${o.chave}` : undefined,
      },
      o.tx,
    );
    return { enviada: true, id };
  }
}

@Injectable()
export class NotificacoesService {
  private readonly logger = new Logger(NotificacoesService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(CANAIS_NOTIFICACAO) private readonly canais: CanalNotificacao[],
  ) {}

  /** Os nomes dos canais, por ordem (para o painel e os testes). */
  nomesDosCanais(): string[] {
    return this.canais.map((c) => c.nome);
  }

  /**
   * Avisa a pessoa pelo primeiro canal que conseguir. Munícipe anonimizado
   * ou inexistente: não sai nada.
   */
  async notificar(
    municipeId: string,
    n: Notificacao,
    o: OpcoesNotificacao = {},
  ): Promise<ResultadoNotificacao> {
    const [m] = await (o.tx ?? this.db).query<{
      municipio_id: string;
      telefone_e164: string | null;
      aceita_avisos: boolean;
      anonimizado: boolean;
    }>(
      `SELECT municipio_id, telefone_e164, aceita_avisos,
              anonimizado_em IS NOT NULL AS anonimizado
       FROM municipes WHERE id = $1`,
      [municipeId],
    );
    if (!m || m.anonimizado) {
      return { enviada: false, canal: null, id: null, motivo: 'sem_municipe' };
    }
    const d: DestinatarioNotificacao = {
      municipeId,
      municipioId: m.municipio_id,
      telefone: m.telefone_e164,
      aceitaAvisos: m.aceita_avisos,
    };
    const motivos: string[] = [];
    for (const canal of this.canais) {
      try {
        const r = await canal.enviar(d, n, o);
        if (r.enviada)
          return { enviada: true, canal: canal.nome, id: r.id ?? null };
        motivos.push(`${canal.nome}: ${r.motivo ?? 'não enviou'}`);
      } catch (e) {
        // Dentro de uma transação o erro tem de subir (a transação já falhou).
        if (o.tx) throw e;
        this.logger.warn(`Canal ${canal.nome} falhou: ${(e as Error).message}`);
        motivos.push(`${canal.nome}: erro`);
      }
    }
    return {
      enviada: false,
      canal: null,
      id: null,
      motivo: motivos.join('; '),
    };
  }
}
