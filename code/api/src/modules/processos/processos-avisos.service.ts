import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { textoSemLink } from '../app-municipe/fcm.js';
import { PushService } from '../app-municipe/push.service.js';
import { ChamadasSaidaService } from '../chamadas-saida/chamadas-saida.service.js';
import type { MotivoChamada } from '../chamadas-saida/regras.js';
import {
  MensagensService,
  MotivoMensagem,
} from '../comunicacao/mensagens.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  Aviso,
  avisoFase,
  avisoLembrete,
  CanalAviso,
  escolherCanal,
  FASES_AVISADAS,
  precisaLembrete,
} from './avisos.js';
import { ProcessosService } from './processos.service.js';
import { Fase, FASE_ROTULO } from './regras.js';

type Q = Pick<Tx, 'query'>;

export interface NovoAviso {
  municipioId: string;
  municipeId: string | null;
  aviso: Aviso;
  motivo: MotivoMensagem;
  /** Chave idempotente do SMS (o email não passa por `mensagens_saida`). */
  chave: string;
  relacionado: Record<string, string>;
  /**
   * Pode ir por chamada do agente (chamadas-saida), com este motivo. Sem
   * isto, um aviso com `pedido_id` conta como 'pedido_documento' (o pedido
   * vem do painel); os outros só por escrito.
   */
  chamada?: { motivo: MotivoChamada; oQueMudou?: string };
}

/** Por onde foi o aviso; 'chamada' = agendada, o SMS fica de recurso. */
export type CanalUsado = CanalAviso | 'chamada';

const ROTULO_CANAL: Record<CanalUsado, string> = {
  sms: 'SMS',
  email: 'email',
  chamada: 'chamada do agente (SMS se não atender)',
};

/*
 * Lembretes de prazo (job `lembretes_prazos`, a cada 15 min): pedidos ao
 * munícipe por responder cujo prazo acaba daqui a LEMBRETE_DIAS_UTEIS dias
 * úteis ou menos, ainda sem lembrete. Só entre as 9h e as 21h locais.
 * Duas guardas contra duplicados, como nos lembretes das marcações: a
 * coluna `lembrete_enviado_em` (lida com FOR UPDATE) e a chave do SMS.
 */
const JANELA_ENVIO = `extract(hour FROM now() AT TIME ZONE mun.fuso) BETWEEN 9 AND 20`;
const HOJE_LOCAL = `(now() AT TIME ZONE mun.fuso)::date`;

/** Por corrida; o resto fica para a seguinte. */
const LOTE = 200;

/**
 * Avisos ao munícipe sobre o processo: mudança de fase, pedido de documento
 * e lembrete do prazo. Vão por email se o munícipe o preferir (e o tiver),
 * senão por SMS. Só o SMS fica em `mensagens_saida` (a tabela só aceita
 * SMS na prática: o email vai direto por `MensagensService.email`); o rasto
 * do email é o evento do processo.
 */
@Injectable()
export class ProcessosAvisosService {
  private readonly logger = new Logger(ProcessosAvisosService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly processos: ProcessosService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    // Opcional: os testes que constroem o serviço à mão não o passam.
    @Optional() private readonly chamadas?: ChamadasSaidaService,
    @Optional() private readonly push?: PushService,
  ) {}

  /**
   * Envia pelo canal do munícipe. Devolve o canal usado, ou null se não há
   * como o contactar. Se o email falhar e houver telefone, vai por SMS.
   */
  async enviar(tx: Tx, a: NovoAviso): Promise<CanalUsado | null> {
    if (!a.municipeId) return null;
    const [m] = await tx.query<{
      telefone: string | null;
      email: string | null;
      preferido: string | null;
    }>(
      `SELECT telefone_e164 AS telefone, email::text AS email, canal_preferido AS preferido
       FROM municipes WHERE id = $1 AND anonimizado_em IS NULL`,
      [a.municipeId],
    );
    if (!m) return null;
    const escolha = escolherCanal(m);
    if (!escolha) return null;

    // Chamada do agente em vez do envio, se a câmara e o munícipe o
    // permitirem (regras em chamadas-saida/regras.ts); o SMS fica de recurso.
    const chamada =
      a.chamada ??
      (a.relacionado.pedido_id
        ? { motivo: 'pedido_documento' as const }
        : null);
    if (chamada && this.chamadas && m.telefone) {
      const r = await this.chamadas.agendar(tx, {
        municipioId: a.municipioId,
        municipeId: a.municipeId,
        motivo: chamada.motivo,
        processoId: a.relacionado.processo_id ?? null,
        pedidoId: a.relacionado.pedido_id ?? null,
        oQueMudou: chamada.oQueMudou ?? null,
        recurso: {
          corpo: a.aviso.texto,
          chave: a.chave,
          motivo: a.motivo,
          relacionado: a.relacionado,
        },
        chave: a.chave,
      });
      if (r.agendada) return 'chamada';
    }

    if (escolha.canal === 'email') {
      try {
        await this.mensagens.email({
          para: escolha.destino,
          assunto: a.aviso.assunto,
          texto: a.aviso.texto,
        });
        return 'email';
      } catch (e) {
        this.logger.warn(
          `Email do aviso ${a.chave} falhou: ${(e as Error).message}`,
        );
        if (!m.telefone) return null;
      }
    }
    await this.mensagens.sms(
      {
        municipioId: a.municipioId,
        municipeId: a.municipeId,
        destino: m.telefone!,
        motivo: a.motivo,
        corpo: a.aviso.texto,
        relacionado: a.relacionado,
        chave: a.chave,
      },
      tx,
    );
    return 'sms';
  }

  /**
   * Avisa o munícipe de que o processo entrou numa fase que ele percebe
   * (FASES_AVISADAS). Uma vez por (processo, fase): o evento 'avisado' com
   * essa fase é a guarda (lido com o processo bloqueado) e a chave do SMS a
   * segunda. Corre depois do COMMIT da mudança de fase; se a fase já mudou
   * outra vez entretanto, não avisa.
   */
  async avisarFase(
    municipio: { id: string; nome: string },
    processoId: string,
    para: Fase,
  ): Promise<CanalUsado | null> {
    if (!FASES_AVISADAS.includes(para)) return null;
    const r = await this.db.transaction(async (tx) => {
      const [p] = await tx.query<{
        id: string;
        numero: string;
        fase: Fase;
        municipe_id: string | null;
        tipo_processo_id: string;
        prazo_fim: string | null;
        avisado: boolean;
      }>(
        `SELECT p.id, p.numero, p.fase, p.municipe_id, p.tipo_processo_id,
                to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim,
                EXISTS (SELECT 1 FROM processo_eventos e
                        WHERE e.processo_id = p.id AND e.tipo = 'avisado'
                          AND e.dados->>'fase' = $3) AS avisado
         FROM processos p
         WHERE p.id = $1 AND p.municipio_id = $2
         FOR UPDATE OF p`,
        [processoId, municipio.id, para],
      );
      if (!p || p.fase !== para || p.avisado) return { canal: null };

      const [docs, link] = await Promise.all([
        this.processos.emFalta(p, tx),
        this.processos.linkProcesso(municipio.id, p.id, tx),
      ]);
      const aviso = avisoFase(para, {
        municipio: municipio.nome,
        numero: p.numero,
        link,
        prazoFim: p.prazo_fim,
        faltam: docs.faltam,
      });
      if (!aviso) return { canal: null };
      const canal = await this.enviar(tx, {
        municipioId: municipio.id,
        municipeId: p.municipe_id,
        aviso,
        motivo: 'processo',
        chave: `processo_fase:${p.id}:${para}`,
        relacionado: { processo_id: p.id },
        chamada: { motivo: 'processo_fase' },
      });
      if (canal) {
        await this.evento(
          tx,
          p.id,
          'avisado',
          `Avisado por ${ROTULO_CANAL[canal]}: ${FASE_ROTULO[para]}.`,
          false,
          { fase: para, canal },
        );
      }
      return {
        canal,
        push: p.municipe_id
          ? {
              municipeId: p.municipe_id,
              processoId: p.id,
              numero: p.numero,
              texto: aviso.texto,
            }
          : null,
      };
    });
    // Depois do COMMIT: o mesmo aviso por push, se a pessoa tiver a app.
    if ('push' in r && r.push && this.push) {
      await this.push.enfileirar([r.push.municipeId], {
        tipo: 'processos',
        titulo: `Processo ${r.push.numero}: ${FASE_ROTULO[para]}`,
        corpo: textoSemLink(r.push.texto),
        link: `/processos/${r.push.processoId}`,
        id: r.push.processoId,
        origem: 'processo_fase',
        chave: `processo_fase:${r.push.processoId}:${para}`,
      });
    }
    return r.canal;
  }

  /** O trabalho do job `lembretes_prazos`. */
  async lembrarPrazos(): Promise<number> {
    const linhas = await this.db.query<{
      id: string;
      processo_id: string;
      descricao: string;
      prazo: string;
      pedido_dia: string;
      hoje: string;
      numero: string;
      municipe_id: string | null;
      municipio_id: string;
      municipio_nome: string;
    }>(
      `SELECT pe.id, pe.processo_id, pe.descricao,
              to_char(pe.prazo, 'YYYY-MM-DD') AS prazo,
              to_char((pe.pedido_em AT TIME ZONE mun.fuso)::date, 'YYYY-MM-DD') AS pedido_dia,
              to_char(${HOJE_LOCAL}, 'YYYY-MM-DD') AS hoje,
              p.numero, p.municipe_id, mun.id AS municipio_id, mun.nome AS municipio_nome
       FROM processo_pedidos_estado pe
       JOIN processos p ON p.id = pe.processo_id
       JOIN municipios mun ON mun.id = p.municipio_id
       WHERE pe.lembrete_enviado_em IS NULL AND pe.respondido_em IS NULL
         AND p.fase NOT IN ('notificado', 'arquivado')
         -- 3 dias úteis cabem sempre em 10 de calendário (fins de semana e feriados).
         AND pe.prazo BETWEEN ${HOJE_LOCAL} AND ${HOJE_LOCAL} + 10
         AND ${JANELA_ENVIO}
       ORDER BY pe.prazo
       LIMIT ${LOTE}`,
    );
    let enviados = 0;
    for (const l of linhas) {
      const feriados = await this.municipios.feriados(l.municipio_id);
      if (
        !precisaLembrete({
          pedidoDia: l.pedido_dia,
          prazo: l.prazo,
          hoje: l.hoje,
          feriados,
        })
      )
        continue;
      await this.db.transaction(async (tx) => {
        const [livre] = await tx.query<{ id: string }>(
          `SELECT id FROM processo_pedidos
           WHERE id = $1 AND lembrete_enviado_em IS NULL FOR UPDATE`,
          [l.id],
        );
        if (!livre) return;
        const link = await this.processos.linkProcesso(
          l.municipio_id,
          l.processo_id,
          tx,
        );
        const canal = await this.enviar(tx, {
          municipioId: l.municipio_id,
          municipeId: l.municipe_id,
          aviso: avisoLembrete({
            municipio: l.municipio_nome,
            numero: l.numero,
            link,
            descricao: l.descricao,
            prazo: l.prazo,
            hoje: l.hoje,
          }),
          motivo: 'prazo',
          chave: `lembrete:pedido:${l.id}`,
          relacionado: { processo_id: l.processo_id, pedido_id: l.id },
          chamada: { motivo: 'lembrete_prazo' },
        });
        // Sem contacto marca-se na mesma, para não voltar a tentar.
        await tx.query(
          'UPDATE processo_pedidos SET lembrete_enviado_em = now() WHERE id = $1',
          [l.id],
        );
        await this.evento(
          tx,
          l.processo_id,
          'lembrete_prazo',
          canal
            ? `Lembrete do prazo (${l.prazo.split('-').reverse().join('/')}) enviado por ${ROTULO_CANAL[canal]}: ${l.descricao}.`
            : `Lembrete do prazo por enviar (sem contacto): ${l.descricao}.`,
          true,
          { pedido_id: l.id, prazo: l.prazo, canal },
        );
      });
      enviados++;
    }
    if (enviados) this.logger.log(`Lembretes de prazo: ${enviados}.`);
    return enviados;
  }

  private async evento(
    q: Q,
    processoId: string,
    tipo: string,
    descricao: string,
    interno: boolean,
    dados: Record<string, unknown>,
  ): Promise<void> {
    await q.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, interno, dados)
       VALUES ($1, $2, $3, 'sistema', $4, $5)`,
      [processoId, tipo, descricao, interno, JSON.stringify(dados)],
    );
  }
}
