import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  Buscar,
  ClienteFcm,
  CredenciaisFcm,
  mensagemFcm,
  Push,
  ResultadoFcm,
  TIPOS_PUSH,
  TipoPush,
} from './fcm.js';

export const FILA_PUSH = 'push_enviar';
/** Munícipes por trabalho da fila (uma emergência grande fica em vários). */
const POR_TRABALHO = 500;

export interface PushParaMunicipe extends Push {
  /**
   * Chave de idempotência do envio (ex.: `emergencia:<id>`): cada
   * dispositivo recebe-o uma vez, mesmo que a fila repita.
   */
  chave?: string | null;
}

export interface ResultadoPush {
  /** Dispositivos ativos da pessoa. */
  dispositivos: number;
  /** Pushes que saíram agora (ou ficaram em modo consola). */
  enviados: number;
  /** Porque não saiu nenhum. */
  motivo?: 'sem_app' | 'desligado_nas_preferencias' | 'ja_enviado' | 'erro';
}

/**
 * O tipo de push para cada tipo de notificação (a interface
 * `NotificacoesService.notificar(municipeId, { tipo })`). Emergências são
 * urgentes; avisos e o "o que se passa" vão em avisos; o resto (processos,
 * pagamentos, marcações, licenças, ocorrências) em processos.
 */
export function tipoPushDe(tipo: string): TipoPush {
  if ((TIPOS_PUSH as readonly string[]).includes(tipo)) return tipo as TipoPush;
  if (/emergenc|urgente|alerta/.test(tipo)) return 'urgente';
  if (/aviso|zona|agora|evento|noticia|obra|transito|agua/.test(tipo))
    return 'avisos';
  return 'processos';
}

interface LinhaDispositivo {
  id: string;
  municipio_id: string;
  fcm_token: string;
  avisos: boolean;
  processos: boolean;
}

/**
 * Notificações push para a app do munícipe por Firebase Cloud Messaging
 * (HTTP v1). Sem FIREBASE_* configurado, modo consola: escreve no log e
 * grava o envio como 'enviado_teste' (como os SMS sem fornecedor). Cada
 * envio fica em `push_enviados`; um token que o FCM recuse (UNREGISTERED)
 * desativa o dispositivo.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private cliente: ClienteFcm | null;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
  ) {
    this.cliente = this.criarCliente();
  }

  private criarCliente(buscar?: Buscar): ClienteFcm | null {
    const cred: CredenciaisFcm = {
      projectId: this.config.get<string>('FIREBASE_PROJECT_ID') ?? '',
      clientEmail: this.config.get<string>('FIREBASE_CLIENT_EMAIL') ?? '',
      privateKey: this.config.get<string>('FIREBASE_PRIVATE_KEY') ?? '',
    };
    if (!cred.projectId || !cred.clientEmail || !cred.privateKey) return null;
    return new ClienteFcm(cred, buscar);
  }

  /** 'fcm' com credenciais; 'consola' sem (nada sai para a rede). */
  get modo(): 'fcm' | 'consola' {
    return this.cliente ? 'fcm' : 'consola';
  }

  /** Só para testes: outro cliente (ex.: com um `buscar` falso). */
  usarCliente(cliente: ClienteFcm | null): void {
    this.cliente = cliente;
  }

  /**
   * Manda o push para os telemóveis da pessoa, se tiver a app e as
   * preferências o deixarem (os urgentes vão sempre). Nunca lança: quem
   * chama já mandou o SMS e não pode falhar por causa do push.
   */
  async paraMunicipe(
    municipeId: string,
    p: PushParaMunicipe,
  ): Promise<ResultadoPush> {
    try {
      const dispositivos = await this.db.query<LinhaDispositivo>(
        `SELECT d.id, d.municipio_id, d.fcm_token,
                coalesce(pr.avisos, true) AS avisos,
                coalesce(pr.processos, true) AS processos
         FROM app_dispositivos d
         JOIN municipes m ON m.id = d.municipe_id AND m.anonimizado_em IS NULL
         LEFT JOIN app_preferencias pr ON pr.municipe_id = d.municipe_id
         WHERE d.municipe_id = $1 AND d.ativo
         ORDER BY d.criado_em`,
        [municipeId],
      );
      if (!dispositivos.length)
        return { dispositivos: 0, enviados: 0, motivo: 'sem_app' };
      const pref = dispositivos[0];
      if (
        (p.tipo === 'avisos' && !pref.avisos) ||
        (p.tipo === 'processos' && !pref.processos)
      ) {
        return {
          dispositivos: dispositivos.length,
          enviados: 0,
          motivo: 'desligado_nas_preferencias',
        };
      }
      let enviados = 0;
      for (const d of dispositivos) {
        if (await this.paraDispositivo(municipeId, d, p)) enviados++;
      }
      return {
        dispositivos: dispositivos.length,
        enviados,
        ...(enviados ? {} : { motivo: 'ja_enviado' as const }),
      };
    } catch (e) {
      this.logger.error(
        `Push para ${municipeId} falhou: ${(e as Error).message}`,
      );
      return { dispositivos: 0, enviados: 0, motivo: 'erro' };
    }
  }

  /** Um envio a um dispositivo; false se já tinha sido enviado (chave). */
  private async paraDispositivo(
    municipeId: string,
    d: LinhaDispositivo,
    p: PushParaMunicipe,
  ): Promise<boolean> {
    const mensagem = mensagemFcm(d.fcm_token, p);
    const [linha] = await this.db.query<{ id: string }>(
      `INSERT INTO push_enviados
         (municipio_id, municipe_id, dispositivo_id, tipo, origem, titulo, corpo, dados, chave)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (chave) DO NOTHING
       RETURNING id`,
      [
        d.municipio_id,
        municipeId,
        d.id,
        p.tipo,
        p.origem.slice(0, 60),
        mensagem.notification.title,
        mensagem.notification.body,
        JSON.stringify(mensagem.data),
        p.chave ? `${p.chave}:${d.id}` : null,
      ],
    );
    if (!linha) return false;

    let r: ResultadoFcm | { estado: 'enviado_teste' };
    if (this.cliente) {
      r = await this.cliente.enviar(mensagem);
    } else {
      this.logger.log(
        `[push consola] ${p.tipo} → dispositivo ${d.id}: ${mensagem.notification.title} — ${mensagem.notification.body}`,
      );
      r = { estado: 'enviado_teste' };
    }
    await this.db.query(
      `UPDATE push_enviados SET estado = $2, erro = $3, fcm_id = $4,
         enviado_em = CASE WHEN $2 IN ('enviado','enviado_teste') THEN now() END
       WHERE id = $1`,
      [
        linha.id,
        r.estado,
        'erro' in r ? r.erro : null,
        r.estado === 'enviado' ? r.fcmId : null,
      ],
    );
    if (r.estado === 'token_invalido') {
      await this.db.query(
        `UPDATE app_dispositivos SET ativo = false, desativado_em = now(),
           motivo_desativacao = 'token_invalido', atualizado_em = now()
         WHERE id = $1`,
        [d.id],
      );
      this.logger.warn(`Dispositivo ${d.id} desativado: ${r.erro}`);
      return false;
    }
    if (r.estado === 'falhado') {
      this.logger.warn(`Push ${linha.id} falhou: ${r.erro}`);
      return false;
    }
    await this.db.query(
      'UPDATE app_dispositivos SET ultimo_push_em = now() WHERE id = $1',
      [d.id],
    );
    return true;
  }

  /**
   * Para muitas pessoas (avisos por zona, emergências): vai para a fila
   * `push_enviar` e sai logo a seguir, fora do pedido. Só quem tem a app
   * conta. Nunca lança.
   */
  async enfileirar(
    municipeIds: readonly (string | null | undefined)[],
    p: PushParaMunicipe,
  ): Promise<number> {
    try {
      const unicos = [...new Set(municipeIds.filter((x): x is string => !!x))];
      if (!unicos.length) return 0;
      const comApp = (
        await this.db.query<{ municipe_id: string }>(
          `SELECT DISTINCT municipe_id FROM app_dispositivos
           WHERE municipe_id = ANY($1::uuid[]) AND ativo`,
          [unicos],
        )
      ).map((r) => r.municipe_id);
      for (let i = 0; i < comApp.length; i += POR_TRABALHO) {
        await this.jobs.enviar(FILA_PUSH, {
          municipeIds: comApp.slice(i, i + POR_TRABALHO),
          push: p,
        });
      }
      return comApp.length;
    } catch (e) {
      this.logger.error(`Push em fila falhou: ${(e as Error).message}`);
      return 0;
    }
  }

  /** O trabalho da fila `push_enviar`. */
  async processarFila(dados: {
    municipeIds: string[];
    push: PushParaMunicipe;
  }): Promise<void> {
    for (const id of dados.municipeIds) await this.paraMunicipe(id, dados.push);
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  /** Quantas pessoas têm a app e o que saiu nos últimos 30 dias. */
  async estatisticas(m: Municipio) {
    const [t] = await this.db.query<{
      pessoas: number;
      dispositivos_ativos: number;
      sessoes_ativas: number;
      dispositivos_desativados_30d: number;
    }>(
      `SELECT
         (SELECT count(DISTINCT municipe_id)::int FROM app_dispositivos
          WHERE municipio_id = $1 AND ativo) AS pessoas,
         (SELECT count(*)::int FROM app_dispositivos
          WHERE municipio_id = $1 AND ativo) AS dispositivos_ativos,
         (SELECT count(*)::int FROM app_sessoes
          WHERE municipio_id = $1 AND revogada_em IS NULL) AS sessoes_ativas,
         (SELECT count(*)::int FROM app_dispositivos
          WHERE municipio_id = $1 AND NOT ativo AND desativado_em > now() - interval '30 days')
           AS dispositivos_desativados_30d`,
      [m.id],
    );
    const porTipo = await this.db.query<{
      tipo: TipoPush;
      enviados: number;
      teste: number;
      falhados: number;
      token_invalido: number;
    }>(
      `SELECT tipo,
              count(*) FILTER (WHERE estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE estado = 'enviado_teste')::int AS teste,
              count(*) FILTER (WHERE estado = 'falhado')::int AS falhados,
              count(*) FILTER (WHERE estado = 'token_invalido')::int AS token_invalido
       FROM push_enviados
       WHERE municipio_id = $1 AND criado_em > now() - interval '30 days'
       GROUP BY tipo`,
      [m.id],
    );
    const porOrigem = await this.db.query<{ origem: string; total: number }>(
      `SELECT origem, count(*)::int AS total FROM push_enviados
       WHERE municipio_id = $1 AND criado_em > now() - interval '30 days'
       GROUP BY origem ORDER BY total DESC, origem LIMIT 10`,
      [m.id],
    );
    const vazio = { enviados: 0, teste: 0, falhados: 0, token_invalido: 0 };
    return {
      modo: this.modo,
      pessoas_com_app: t.pessoas,
      dispositivos_ativos: t.dispositivos_ativos,
      sessoes_ativas: t.sessoes_ativas,
      dispositivos_desativados_30d: t.dispositivos_desativados_30d,
      push_30d: Object.fromEntries(
        TIPOS_PUSH.map((tipo) => {
          const l = porTipo.find((x) => x.tipo === tipo);
          return [
            tipo,
            l
              ? {
                  enviados: l.enviados,
                  teste: l.teste,
                  falhados: l.falhados,
                  token_invalido: l.token_invalido,
                }
              : vazio,
          ];
        }),
      ) as Record<TipoPush, typeof vazio>,
      por_origem_30d: porOrigem,
    };
  }
}
