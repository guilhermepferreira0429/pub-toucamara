import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { NotificacoesService } from '../notificacoes/notificacoes.service.js';
import {
  chaveItem,
  correspondeSubscricao,
  ItemInterno,
  itemNovo,
  normalizarComunicado,
  normalizarEvento,
  PARAMETROS,
  podeAvisarAgora,
  SubscricaoAgora,
  textoAvisoSubscricao,
} from './agora.regras.js';
import { AgoraService } from './agora.service.js';

const PESO: Record<string, number> = { emergencia: 3, alerta: 2, aviso: 1 };

const freguesia = z.string().trim().min(2).max(120);

/** O que se vai publicar (só o que decide quem é avisado). */
export const esquemaAbrangidos = z.discriminatedUnion('fonte', [
  z.object({
    fonte: z.literal('comunicado'),
    tipo: z.enum(['comunicado', 'noticia']),
    freguesias: z.array(freguesia).max(50).nullable().optional(),
  }),
  z
    .object({
      fonte: z.literal('evento'),
      lat: z.number().min(-90).max(90).nullable().optional(),
      lng: z.number().min(-180).max(180).nullable().optional(),
      freguesia: freguesia.nullable().optional(),
    })
    .refine((e) => (e.lat == null) === (e.lng == null), {
      message: 'lat e lng vêm juntos.',
      path: ['lat'],
    }),
]);

/** Porque é que avisa (ou não): o ecrã explica com isto. */
export type MotivoAbrangidos =
  'noticia' | 'todo_concelho' | 'zona' | 'sem_zona';

export interface Abrangidos {
  /** Subscrições ativas que batem com o item. */
  subscricoes: number;
  /** Pessoas diferentes que receberiam o aviso (aceitam avisos). */
  pessoas: number;
  motivo: MotivoAbrangidos;
  parametros: {
    novos_horas: number;
    raio_subscricao_m: number;
    max_avisos_por_corrida: number;
    demonstracao: boolean;
  };
}

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

  /**
   * Quantas subscrições "avise-me" um comunicado ou evento abrangeria se
   * fosse publicado agora (com as mesmas regras do job: correspondeSubscricao).
   * Não envia nada. Notícias e comunicados de todo o concelho não avisam
   * ninguém (só alertas e emergências, que não se escrevem aqui).
   */
  async abrangidos(
    m: Municipio,
    e: z.output<typeof esquemaAbrangidos>,
    agora = new Date(),
  ): Promise<Abrangidos> {
    const ctx = await this.agora.contexto(m);
    const publicado_em = new Date(agora.getTime() + 1_000);
    const id = '00000000-0000-0000-0000-000000000000';
    let item: ItemInterno;
    if (e.fonte === 'comunicado') {
      item = normalizarComunicado(
        {
          id,
          tipo: e.tipo,
          titulo: '',
          texto: '',
          imagem_url: null,
          freguesias: e.freguesias?.length ? [...new Set(e.freguesias)] : null,
          publicado_em,
        },
        ctx,
      );
    } else {
      item = normalizarEvento(
        {
          id,
          titulo: '',
          descricao: '',
          local: '',
          lat: e.lat ?? null,
          lng: e.lng ?? null,
          inicio: publicado_em,
          fim: null,
          freguesia: e.freguesia ?? null,
          link: null,
          publicado_em,
        },
        ctx,
      );
    }
    const motivo: MotivoAbrangidos =
      item.etiqueta === 'Notícia'
        ? 'noticia'
        : item.todo_concelho
          ? 'todo_concelho'
          : !item.zona.circulos.length && !item.freguesias?.length
            ? 'sem_zona'
            : 'zona';
    const subs = await this.db.query<
      SubscricaoAgora & { aceita_avisos: boolean }
    >(
      `SELECT s.id, s.municipe_id, s.tipos, s.lat, s.lng, s.raio_m, s.freguesia, s.criada_em,
              mu.aceita_avisos
       FROM agora_subscricoes s JOIN municipes mu ON mu.id = s.municipe_id
       WHERE s.municipio_id = $1 AND s.ativa AND mu.anonimizado_em IS NULL`,
      [m.id],
    );
    const batem = subs.filter((s) => correspondeSubscricao(item, s));
    return {
      subscricoes: batem.length,
      pessoas: new Set(
        batem.filter((s) => s.aceita_avisos).map((s) => s.municipe_id),
      ).size,
      motivo,
      parametros: {
        novos_horas: PARAMETROS.novos_horas,
        raio_subscricao_m: PARAMETROS.raio_subscricao_m,
        max_avisos_por_corrida: PARAMETROS.max_avisos_por_corrida,
        demonstracao: PARAMETROS.demonstracao,
      },
    };
  }

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
