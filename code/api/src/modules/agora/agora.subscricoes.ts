import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { NotificacoesService } from '../notificacoes/notificacoes.service.js';
import {
  chaveItem,
  correspondeSubscricao,
  itemNovo,
  PARAMETROS,
  podeAvisarAgora,
  SubscricaoAgora,
  textoAvisoSubscricao,
} from './agora.regras.js';
import { AgoraService } from './agora.service.js';

const PESO: Record<string, number> = { emergencia: 3, alerta: 2, aviso: 1 };

/**
 * O job das subscrições "avise-me": de X em X minutos vê os itens novos do
 * feed e avisa quem subscreveu aquela zona e aquele tipo. Idempotente: cada
 * item × subscrição (e cada item × pessoa) fica em `agora_avisos_enviados`
 * na mesma transação do SMS; uma segunda corrida não repete.
 *
 * Fora das 9h-21h só saem emergências (o resto fica para a corrida seguinte
 * dentro do horário, enquanto o item for novo). O "não quero avisos" (PARAR)
 * corta tudo menos emergências (NotificacoesService / CanalSms).
 */
@Injectable()
export class AgoraSubscricoesService {
  private readonly logger = new Logger(AgoraSubscricoesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly agora: AgoraService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  async processar(agora = new Date()): Promise<{ avisos: number }> {
    const municipios = await this.db.query<Municipio>(
      `SELECT DISTINCT m.id, m.slug, m.nome, m.fuso
       FROM agora_subscricoes s JOIN municipios m ON m.id = s.municipio_id
       WHERE s.ativa`,
    );
    let avisos = 0;
    for (const m of municipios) {
      try {
        avisos += await this.doMunicipio(m, agora);
      } catch (e) {
        this.logger.error(
          `Avisos do feed (${m.slug}): ${(e as Error).message}`,
        );
      }
    }
    return { avisos };
  }

  private async doMunicipio(m: Municipio, agora: Date): Promise<number> {
    const novos = (await this.agora.itens(m))
      .filter((i) => itemNovo(i, agora))
      // Os mais graves e os mais recentes primeiro (há um máximo por corrida).
      .sort(
        (a, b) =>
          (PESO[b.gravidade ?? ''] ?? 0) - (PESO[a.gravidade ?? ''] ?? 0) ||
          b.publicado_em.localeCompare(a.publicado_em),
      );
    if (!novos.length) return 0;
    const subs = await this.db.query<SubscricaoAgora>(
      `SELECT s.id, s.municipe_id, s.tipos, s.lat, s.lng, s.raio_m, s.freguesia, s.criada_em
       FROM agora_subscricoes s JOIN municipes mu ON mu.id = s.municipe_id
       WHERE s.municipio_id = $1 AND s.ativa AND mu.anonimizado_em IS NULL
       ORDER BY s.criada_em`,
      [m.id],
    );
    const porPessoa = new Map<string, number>();
    let enviados = 0;
    for (const s of subs) {
      for (const i of novos) {
        if (
          (porPessoa.get(s.municipe_id) ?? 0) >=
          PARAMETROS.max_avisos_por_corrida
        )
          break;
        if (!correspondeSubscricao(i, s) || !podeAvisarAgora(i, agora, m.fuso))
          continue;
        const chave = chaveItem(i);
        const saiu = await this.db.transaction(async (tx) => {
          const [novo] = await tx.query<{ item: string }>(
            `INSERT INTO agora_avisos_enviados (subscricao_id, municipe_id, item)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING item`,
            [s.id, s.municipe_id, chave],
          );
          if (!novo) return false;
          const r = await this.notificacoes.notificar(
            s.municipe_id,
            {
              titulo: `${i.etiqueta} perto de si`,
              corpo: textoAvisoSubscricao({
                municipio: m.nome,
                item: i,
                link: i.link,
                agora,
                fuso: m.fuso,
              }),
              link: i.link,
              tipo: `agora:${i.tipo}`,
            },
            {
              chave: `agora:${s.municipe_id}:${chave}`,
              urgente: i.gravidade === 'emergencia',
              relacionado: { agora_item: chave, agora_subscricao_id: s.id },
              tx,
            },
          );
          await tx.query(
            `UPDATE agora_avisos_enviados SET canal = $3, mensagem_id = $4
             WHERE subscricao_id = $1 AND item = $2`,
            [s.id, chave, r.canal, r.canal === 'sms' ? r.id : null],
          );
          return r.enviada;
        });
        if (saiu) {
          enviados++;
          porPessoa.set(s.municipe_id, (porPessoa.get(s.municipe_id) ?? 0) + 1);
        }
      }
    }
    return enviados;
  }
}
