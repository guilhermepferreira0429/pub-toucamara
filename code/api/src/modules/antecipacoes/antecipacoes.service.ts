import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { somarDiasUteis, type Feriados } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ChamadasSaidaService } from '../chamadas-saida/chamadas-saida.service.js';
import { local, TEXTO_SEM_CHAMADA } from '../chamadas-saida/regras.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { demoAtiva } from '../demo/demo.regras.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { DEFS, TipoLicenca } from '../licencas/tipos.js';
import { NotificacoesService } from '../notificacoes/notificacoes.service.js';
import {
  avaliar,
  CANAIS_CONFIG,
  canalPreferido,
  Candidato,
  configDe,
  ConfigTipo,
  DEF_TIPO,
  diaDito,
  GRAVIDADES,
  MESES_CADUCIDADE_OMISSAO,
  Momento,
  textos,
  TIPOS_MOMENTO,
  TIPOS_OBRA,
  TipoMomento,
} from './regras.js';

type Q = Pick<Tx, 'query'>;
type Config = ReturnType<typeof configDe>;

/** Os tipos que o job contacta (as licenças têm o seu job de avisos). */
const CONTACTA: readonly TipoMomento[] = TIPOS_MOMENTO.filter(
  (t) => t !== 'licenca_expira',
);

/**
 * Até onde se procuram situações: a maior antecedência (60 dias úteis)
 * cabe sempre em 100 dias de calendário.
 */
const HORIZONTE_DIAS = 100;

export const esquemaConfig = z.object({
  tipos: z
    .array(
      z.object({
        tipo: z.enum(
          TIPOS_MOMENTO.filter((t) => DEF_TIPO[t].configuravel) as [
            TipoMomento,
            ...TipoMomento[],
          ],
        ),
        ativo: z.boolean(),
        antecedencia_dias_uteis: z.number().int().min(0).max(60),
        canal: z.enum(CANAIS_CONFIG),
      }),
    )
    .min(1)
    .max(TIPOS_MOMENTO.length),
});

export const esquemaLista = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(14),
});

export const esquemaAudiencia = z.object({
  fundamento: z.string().trim().min(5).max(1000),
  dias_uteis: z.number().int().min(10).max(30).default(10),
});

export const entradaExplicar = z.object({
  numero: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe('O número do processo, se tiver mais de um.'),
});

export interface ResultadoCorrida {
  municipios: number;
  devidos: number;
  contactos: number;
  por_canal: Record<string, number>;
  alertas: number;
}

/**
 * "A câmara liga-lhe antes de o problema existir". Encontra os momentos
 * (regras.ts) nos processos, pedidos, pagamentos e licenças; o job diário
 * cria o contacto (chamada do agente ou push/SMS) uma só vez por momento;
 * o painel mostra os próximos dias, os contactos e os alertas internos.
 *
 * Não duplica avisos que já existem:
 * - Pedido de elementos: partilha a marca `lembrete_enviado_em` com o
 *   lembrete de prazo (processos-avisos). O primeiro a avisar marca-a; o
 *   outro regista "já avisado".
 * - Licença a expirar: o aviso é o do job `licencas_avisos`; aqui só se
 *   mostra (com o aviso que já foi).
 */
@Injectable()
export class AntecipacoesService {
  private readonly logger = new Logger(AntecipacoesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly chamadas: ChamadasSaidaService,
    private readonly notificacoes: NotificacoesService,
    private readonly links: LinksCurtosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  demoAtiva(): boolean {
    return demoAtiva(
      this.config.get<string>('app.ambiente') ?? 'development',
      process.env.DEMO_ATIVA,
    );
  }

  // ------------------------------------------------------------------
  // Configuração
  // ------------------------------------------------------------------

  async configDoMunicipio(q: Q, municipioId: string): Promise<Config> {
    const linhas = await q.query<ConfigTipo & { tipo: string }>(
      `SELECT tipo, ativo, antecedencia_dias_uteis, canal
       FROM antecipacao_config WHERE municipio_id = $1`,
      [municipioId],
    );
    return configDe(Object.fromEntries(linhas.map((l) => [l.tipo, l])));
  }

  async obterConfig(m: Municipio) {
    const cfg = await this.configDoMunicipio(this.db, m.id);
    const [ultima] = await this.db.query<{
      atualizado_em: Date;
      nome: string | null;
    }>(
      `SELECT c.atualizado_em, u.nome FROM antecipacao_config c
       LEFT JOIN utilizadores u ON u.id = c.atualizado_por
       WHERE c.municipio_id = $1 ORDER BY c.atualizado_em DESC LIMIT 1`,
      [m.id],
    );
    return {
      tipos: TIPOS_MOMENTO.map((t) => ({
        tipo: t,
        ...DEF_TIPO[t],
        ...cfg[t],
      })),
      meses_caducidade: MESES_CADUCIDADE_OMISSAO,
      meses_caducidade_demonstracao: true,
      atualizado: ultima
        ? { em: ultima.atualizado_em, por: ultima.nome }
        : null,
      nota: 'Os valores por omissão são de demonstração. As consequências legais marcadas "a confirmar" têm de ser revistas pelo jurista da câmara.',
    };
  }

  async guardarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    b: z.output<typeof esquemaConfig>,
  ) {
    const antes = await this.configDoMunicipio(this.db, m.id);
    await this.db.transaction(async (tx) => {
      for (const t of b.tipos) {
        await tx.query(
          `INSERT INTO antecipacao_config (municipio_id, tipo, ativo, antecedencia_dias_uteis,
             canal, atualizado_por, atualizado_em)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (municipio_id, tipo) DO UPDATE SET ativo = EXCLUDED.ativo,
             antecedencia_dias_uteis = EXCLUDED.antecedencia_dias_uteis,
             canal = EXCLUDED.canal, atualizado_por = EXCLUDED.atualizado_por,
             atualizado_em = now()`,
          [
            m.id,
            t.tipo,
            t.ativo,
            t.antecedencia_dias_uteis,
            t.canal,
            u.municipioId ? u.id : null,
          ],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'configurar_antecipacoes',
          objetoTipo: 'antecipacao_config',
          objetoId: m.id,
          dados: {
            antes: Object.fromEntries(
              b.tipos.map((t) => [t.tipo, antes[t.tipo]]),
            ),
            depois: Object.fromEntries(b.tipos.map((t) => [t.tipo, t])),
          },
        },
        tx,
      );
    });
    return this.obterConfig(m);
  }

  // ------------------------------------------------------------------
  // Situações (candidatos) na BD
  // ------------------------------------------------------------------

  private async candidatos(
    q: Q,
    municipioId: string,
    fuso: string,
    hoje: string,
    ate: string,
    f: { processoId?: string | null; municipeId?: string | null } = {},
  ): Promise<(Candidato & { aviso?: unknown })[]> {
    const p = [
      municipioId,
      hoje,
      ate,
      f.processoId ?? null,
      f.municipeId ?? null,
      fuso,
    ];
    const filtroProc = `($4::uuid IS NULL OR p.id = $4) AND ($5::uuid IS NULL OR p.municipe_id = $5)`;
    const procJson = `jsonb_build_object('id', p.id, 'numero', p.numero, 'assunto', p.assunto,
      'tipo_codigo', tp.codigo)`;

    const pedidos = await q.query<Candidato>(
      `SELECT 'prazo_municipe' AS tipo, pe.id::text AS objeto_id, p.municipio_id,
              p.municipe_id, ${procJson} AS processo,
              to_char(pe.prazo, 'YYYY-MM-DD') AS data_alvo,
              to_char((pe.pedido_em AT TIME ZONE $6)::date, 'YYYY-MM-DD') AS inicio,
              pe.descricao, pe.lembrete_enviado_em IS NOT NULL AS ja_avisado, pe.id AS pedido_id
       FROM processo_pedidos_estado pe
       JOIN processos p ON p.id = pe.processo_id
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       WHERE p.municipio_id = $1 AND pe.respondido_em IS NULL
         AND p.fase NOT IN ('notificado', 'arquivado')
         AND pe.prazo BETWEEN $2::date AND $3::date AND ${filtroProc}`,
      p,
    );

    // A última audiência prévia aberta, num processo ainda sem decisão.
    const audiencias = await q.query<Candidato>(
      `SELECT DISTINCT ON (p.id) 'audiencia_previa' AS tipo, p.id::text AS objeto_id,
              p.municipio_id, p.municipe_id, ${procJson} AS processo,
              e.dados->>'prazo' AS data_alvo,
              to_char((e.em AT TIME ZONE $6)::date, 'YYYY-MM-DD') AS inicio,
              e.dados->>'fundamento' AS descricao
       FROM processo_eventos e
       JOIN processos p ON p.id = e.processo_id
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       WHERE p.municipio_id = $1 AND e.tipo = 'audiencia_previa'
         AND p.decisao IS NULL AND p.fase NOT IN ('notificado', 'arquivado')
         AND (e.dados->>'prazo')::date BETWEEN $2::date AND $3::date
         AND NOT EXISTS (SELECT 1 FROM processo_eventos r
                         WHERE r.processo_id = p.id AND r.tipo = 'audiencia_resposta' AND r.em > e.em)
         AND ${filtroProc}
       ORDER BY p.id, e.em DESC`,
      p,
    );

    const prazos = await q.query<Candidato>(
      `SELECT 'prazo_camara' AS tipo, p.id::text AS objeto_id, p.municipio_id, p.municipe_id,
              ${procJson} AS processo, to_char(p.prazo_fim, 'YYYY-MM-DD') AS data_alvo,
              to_char(p.prazo_inicio, 'YYYY-MM-DD') AS inicio, tp.nome AS descricao
       FROM processos p
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       WHERE p.municipio_id = $1 AND p.decisao IS NULL
         AND p.fase IN ('apreciacao', 'pareceres_externos', 'decisao')
         AND p.prazo_fim BETWEEN $2::date AND $3::date AND ${filtroProc}
         AND $6::text IS NOT NULL`,
      p,
    );

    const caducidades = await q.query<Candidato>(
      `SELECT 'caducidade_alvara' AS tipo, p.id::text AS objeto_id, p.municipio_id, p.municipe_id,
              ${procJson} AS processo, x.data_alvo,
              to_char((p.decidido_em AT TIME ZONE $6)::date, 'YYYY-MM-DD') AS inicio,
              tp.nome AS descricao
       FROM processos p
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       CROSS JOIN LATERAL (
         SELECT to_char(((p.decidido_em AT TIME ZONE $6)::date
                 + make_interval(months => $7::int))::date, 'YYYY-MM-DD') AS data_alvo) x
       WHERE p.municipio_id = $1 AND p.decisao = 'admitido' AND p.decidido_em IS NOT NULL
         AND tp.codigo = ANY($8::text[])
         AND x.data_alvo::date BETWEEN $2::date AND $3::date
         AND NOT EXISTS (SELECT 1 FROM processo_eventos o
                         WHERE o.processo_id = p.id AND o.tipo IN ('obra_iniciada', 'prorrogacao'))
         AND ${filtroProc}`,
      [...p, MESES_CADUCIDADE_OMISSAO, TIPOS_OBRA],
    );

    const pagamentos = await q.query<Candidato>(
      `SELECT 'pagamento_a_vencer' AS tipo, pg.id::text AS objeto_id, p.municipio_id, p.municipe_id,
              ${procJson} AS processo, to_char(pg.pagar_ate, 'YYYY-MM-DD') AS data_alvo,
              to_char((pg.criado_em AT TIME ZONE $6)::date, 'YYYY-MM-DD') AS inicio,
              pg.guia_numero AS descricao, pg.valor_cent, pg.id AS pagamento_id
       FROM pagamentos pg
       JOIN processos p ON p.id = pg.processo_id
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       WHERE p.municipio_id = $1 AND pg.estado = 'pendente'
         AND pg.pagar_ate BETWEEN $2::date AND $3::date
         AND NOT EXISTS (SELECT 1 FROM licencas l WHERE l.processo_id = p.id)
         AND ${filtroProc}`,
      p,
    );

    const licencas = await q.query<Candidato & { aviso: unknown }>(
      `SELECT 'licenca_expira' AS tipo, l.id::text AS objeto_id, l.municipio_id, l.municipe_id,
              ${procJson} AS processo, to_char(l.valida_ate, 'YYYY-MM-DD') AS data_alvo,
              to_char((l.decidida_em AT TIME ZONE $6)::date, 'YYYY-MM-DD') AS inicio,
              NULL AS descricao,
              jsonb_build_object('id', l.id, 'numero', p.numero, 'nome', l.tipo) AS licenca,
              a.aviso IS NOT NULL AS ja_avisado, a.aviso
       FROM licencas l
       JOIN processos p ON p.id = l.processo_id
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object('canal', la.canal, 'dias', la.dias, 'em', la.criado_em,
                  'chamada_id', la.chamada_id) AS aviso
         FROM licenca_avisos la WHERE la.licenca_id = l.id
         ORDER BY la.criado_em DESC LIMIT 1) a ON true
       WHERE l.municipio_id = $1 AND l.estado = 'emitida' AND l.valida_ate IS NOT NULL
         AND l.valida_ate BETWEEN $2::date AND $3::date
         AND NOT EXISTS (SELECT 1 FROM licencas r WHERE r.renova_licenca_id = l.id AND r.estado <> 'recusada')
         AND ${filtroProc}`,
      p,
    );

    for (const l of licencas) {
      if (l.licenca) {
        const def = DEFS[l.licenca.nome as TipoLicenca];
        l.licenca.nome = def ? def.nome : l.licenca.nome;
      }
    }
    return [
      ...pedidos,
      ...audiencias,
      ...prazos,
      ...caducidades,
      ...pagamentos,
      ...licencas,
    ];
  }

  /** Os momentos de hoje até `ate` (com o que for devido hoje marcado). */
  async momentos(
    q: Q,
    m: Municipio,
    o: {
      hoje: string;
      ate: string;
      processoId?: string | null;
      municipeId?: string | null;
    },
  ): Promise<{ momentos: Momento[]; config: Config; feriados: Feriados }> {
    const [config, feriados, lista] = await Promise.all([
      this.configDoMunicipio(q, m.id),
      this.municipios.feriados(m.id),
      this.candidatos(q, m.id, m.fuso, o.hoje, o.ate, o),
    ]);
    const momentos = lista
      .map((c) => avaliar(c, config[c.tipo], o.hoje, feriados))
      .filter((x): x is Momento => !!x)
      .sort(
        (a, b) =>
          a.data_alvo.localeCompare(b.data_alvo) ||
          GRAVIDADES.indexOf(a.gravidade) - GRAVIDADES.indexOf(b.gravidade),
      );
    return { momentos, config, feriados };
  }

  // ------------------------------------------------------------------
  // O job diário
  // ------------------------------------------------------------------

  /** O trabalho do job `antecipacoes` (todos os municípios). */
  async correr(agora = new Date()): Promise<ResultadoCorrida> {
    const municipios = await this.db.query<{ id: string }>(
      'SELECT id FROM municipios ORDER BY id',
    );
    const total: ResultadoCorrida = {
      municipios: 0,
      devidos: 0,
      contactos: 0,
      por_canal: {},
      alertas: 0,
    };
    for (const { id } of municipios) {
      try {
        const m = await this.municipios.porId(id);
        const r = await this.correrMunicipio(m, agora);
        total.municipios++;
        total.devidos += r.devidos;
        total.contactos += r.contactos;
        total.alertas += r.alertas;
        for (const [k, v] of Object.entries(r.por_canal)) {
          total.por_canal[k] = (total.por_canal[k] ?? 0) + v;
        }
      } catch (e) {
        this.logger.error(`Antecipações (${id}): ${(e as Error).message}`);
      }
    }
    if (total.contactos) {
      this.logger.log(
        `Antecipações: ${total.contactos} contactos, ${total.alertas} alertas.`,
      );
    }
    return total;
  }

  async correrMunicipio(
    m: Municipio,
    agora = new Date(),
  ): Promise<Omit<ResultadoCorrida, 'municipios'>> {
    const hoje = local(agora, m.fuso).dia;
    const ate = somarDias(hoje, HORIZONTE_DIAS);
    const { momentos, config } = await this.momentos(this.db, m, {
      hoje,
      ate,
    });
    const r = {
      devidos: 0,
      contactos: 0,
      por_canal: {} as Record<string, number>,
      alertas: 0,
    };
    for (const mo of momentos) {
      if (!mo.devido || !CONTACTA.includes(mo.tipo)) continue;
      r.devidos++;
      try {
        const feito = await this.contactar(m, mo, config[mo.tipo], agora);
        if (feito.canal) {
          r.contactos++;
          r.por_canal[feito.canal] = (r.por_canal[feito.canal] ?? 0) + 1;
        }
        if (feito.alerta) r.alertas++;
      } catch (e) {
        this.logger.error(`Antecipação ${mo.chave}: ${(e as Error).message}`);
      }
    }
    return r;
  }

  /**
   * Cria o contacto deste momento, uma só vez (a chave é única). Tudo numa
   * transação: se falhar, o momento volta a estar por fazer.
   */
  private async contactar(
    m: Municipio,
    mo: Momento,
    cfg: ConfigTipo,
    agora: Date,
  ): Promise<{ canal: string | null; alerta: boolean }> {
    return this.db.transaction(async (tx) => {
      const link = mo.processo
        ? await this.linkProcesso(tx, m.id, mo.processo.id)
        : '';
      const t = textos(mo, { municipio: m.nome, link });
      const [temApp] = mo.municipe_id
        ? await tx.query<{ tem: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM app_dispositivos
                            WHERE municipe_id = $1 AND ativo) AS tem`,
            [mo.municipe_id],
          )
        : [{ tem: false }];
      const previsto = canalPreferido({
        gravidade: mo.gravidade,
        canal: cfg.canal,
        temApp: !!temApp?.tem,
      });
      const [novo] = await tx.query<{ id: string }>(
        `INSERT INTO antecipacoes (municipio_id, chave, tipo, gravidade, data_alvo,
           antecedencia_dias_uteis, processo_id, municipe_id, pedido_id, pagamento_id,
           canal_previsto, canal, titulo, texto, dizer, dados, demonstracao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'sem_contacto', $12, $13, $14, $15, $16)
         ON CONFLICT (chave) DO NOTHING RETURNING id`,
        [
          m.id,
          mo.chave,
          mo.tipo,
          mo.gravidade,
          mo.data_alvo,
          cfg.antecedencia_dias_uteis,
          mo.processo?.id ?? null,
          mo.municipe_id,
          mo.pedido_id ?? null,
          mo.pagamento_id ?? null,
          previsto,
          t.titulo,
          t.sms,
          t.dizer,
          JSON.stringify({
            o_que_pode_fazer: t.o_que_pode_fazer,
            fonte_legal: mo.fonte_legal,
            confirmar_jurista: mo.confirmar_jurista,
            descricao: mo.descricao,
            faltam_dias_uteis: mo.faltam_dias_uteis,
          }),
          mo.demonstracao,
        ],
      );
      if (!novo) return { canal: null, alerta: false };

      let alerta = false;
      if (mo.tipo === 'prazo_camara' && t.alerta) {
        alerta = await this.alertaChefia(tx, m, mo, t.alerta);
      }

      const canal = await this.enviar(tx, m, mo, t, previsto, novo.id, agora);
      if (mo.processo) {
        const quando = mo.data_alvo.split('-').reverse().join('/');
        await this.evento(
          tx,
          mo.processo.id,
          'antecipacao',
          canal === 'ja_avisado'
            ? `Antecipação (${DEF_TIPO[mo.tipo].rotulo.toLowerCase()}, ${quando}): o munícipe já tinha sido avisado pelo lembrete.`
            : canal === 'sem_contacto'
              ? `Antecipação por fazer (${DEF_TIPO[mo.tipo].rotulo.toLowerCase()}, ${quando}): sem forma de contactar o munícipe.`
              : `Antecipação (${DEF_TIPO[mo.tipo].rotulo.toLowerCase()}, ${quando}): ${ROTULO_CANAL[canal]}. ${t.dizer}`,
          {
            antecipacao_id: novo.id,
            tipo: mo.tipo,
            data_alvo: mo.data_alvo,
            canal,
          },
        );
      }
      return { canal, alerta };
    });
  }

  private async enviar(
    tx: Tx,
    m: Municipio,
    mo: Momento,
    t: ReturnType<typeof textos>,
    previsto: 'chamada' | 'notificacao',
    id: string,
    agora: Date,
  ): Promise<keyof typeof ROTULO_CANAL | 'ja_avisado' | 'sem_contacto'> {
    const atualizar = (campos: Record<string, unknown>) => {
      const k = Object.keys(campos);
      return tx.query(
        `UPDATE antecipacoes SET ${k.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...k.map((c) => campos[c])],
      );
    };

    // O pedido de elementos partilha a marca com o lembrete de prazo.
    if (mo.tipo === 'prazo_municipe' && mo.pedido_id) {
      const [pp] = await tx.query<{ ja: boolean }>(
        `SELECT lembrete_enviado_em IS NOT NULL AS ja FROM processo_pedidos
         WHERE id = $1 FOR UPDATE`,
        [mo.pedido_id],
      );
      if (pp?.ja) {
        await atualizar({ canal: 'ja_avisado' });
        return 'ja_avisado';
      }
      await tx.query(
        'UPDATE processo_pedidos SET lembrete_enviado_em = now() WHERE id = $1',
        [mo.pedido_id],
      );
    }
    if (!mo.municipe_id) return 'sem_contacto';

    const chave = `antecipacao:${mo.chave}`;
    const relacionado: Record<string, string> = { antecipacao_id: id };
    if (mo.processo) relacionado.processo_id = mo.processo.id;
    if (mo.pedido_id) relacionado.pedido_id = mo.pedido_id;

    if (previsto === 'chamada') {
      const c = await this.chamadas.agendar(
        tx,
        {
          municipioId: m.id,
          municipeId: mo.municipe_id,
          motivo: 'antecipacao',
          processoId: mo.processo?.id ?? null,
          pedidoId: mo.pedido_id ?? null,
          oQueMudou: t.dizer,
          nota: `${t.o_que_pode_fazer} Para mais pormenor usa explicar_momento.`,
          recurso: {
            corpo: t.sms,
            chave,
            motivo: mo.tipo === 'prazo_municipe' ? 'prazo' : 'lembrete',
            relacionado,
          },
          chave,
        },
        agora,
      );
      if (c.agendada) {
        await atualizar({ canal: 'chamada', chamada_id: c.id });
        return 'chamada';
      }
      await atualizar({ motivo_sem_chamada: c.motivo });
    }
    const n = await this.notificacoes.notificar(
      mo.municipe_id,
      {
        titulo: t.titulo,
        corpo: t.sms,
        link: mo.processo ? `/processos/${mo.processo.id}` : null,
        tipo: 'processos',
      },
      { chave, relacionado, tx },
    );
    if (!n.enviada) {
      await atualizar({
        dados: JSON.stringify({ motivo_sem_envio: n.motivo ?? null }),
      });
      return 'sem_contacto';
    }
    const canal = n.canal === 'push' ? 'push' : 'sms';
    await atualizar({
      canal,
      mensagem_id: canal === 'sms' ? n.id : null,
    });
    return canal;
  }

  /** O alerta de gestão do prazo da câmara (uma vez por data alvo). */
  private async alertaChefia(
    tx: Tx,
    m: Municipio,
    mo: Momento,
    alerta: string,
  ): Promise<boolean> {
    const [a] = await tx.query<{ id: string }>(
      `INSERT INTO antecipacoes (municipio_id, chave, tipo, destinatario, gravidade, data_alvo,
         antecedencia_dias_uteis, processo_id, municipe_id, canal_previsto, canal, titulo, texto,
         dados, demonstracao)
       VALUES ($1, $2, 'prazo_camara', 'chefia', 'alta', $3, 0, $4, $5, 'interno', 'interno', $6, $7, $8, $9)
       ON CONFLICT (chave) DO NOTHING RETURNING id`,
      [
        m.id,
        `${mo.chave}:chefia`,
        mo.data_alvo,
        mo.processo?.id ?? null,
        mo.municipe_id,
        `Prazo da câmara: ${mo.processo?.numero ?? ''}`,
        alerta,
        JSON.stringify({
          fonte_legal: mo.fonte_legal,
          confirmar_jurista: mo.confirmar_jurista,
          faltam_dias_uteis: mo.faltam_dias_uteis,
        }),
        mo.demonstracao,
      ],
    );
    if (!a) return false;
    if (mo.processo) {
      await this.evento(
        tx,
        mo.processo.id,
        'alerta_prazo_camara',
        `Alerta à chefia: ${alerta} (a confirmar pelo jurista da câmara)`,
        { antecipacao_id: a.id, data_alvo: mo.data_alvo },
      );
    }
    await this.auditoria.registar(
      {
        municipioId: m.id,
        atorTipo: 'sistema',
        acao: 'alertar_prazo_camara',
        objetoTipo: 'processo',
        objetoId: mo.processo?.id ?? m.id,
        dados: { antecipacao_id: a.id, data_alvo: mo.data_alvo, alerta },
      },
      tx,
    );
    return true;
  }

  private async evento(
    q: Q,
    processoId: string,
    tipo: string,
    descricao: string,
    dados: Record<string, unknown>,
  ) {
    await q.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, interno, dados)
       VALUES ($1, $2, $3, 'sistema', true, $4)`,
      [processoId, tipo, descricao, JSON.stringify(dados)],
    );
  }

  /** O link do processo (reaproveita um que ainda dure uma semana). */
  private async linkProcesso(
    q: Q,
    municipioId: string,
    processoId: string,
  ): Promise<string> {
    const [l] = await q.query<{ codigo: string }>(
      `SELECT codigo FROM links_curtos
       WHERE destino_tipo = 'processo' AND destino_id = $1 AND expira_em > now() + interval '7 days'
       ORDER BY expira_em DESC LIMIT 1`,
      [processoId],
    );
    if (l)
      return `${this.config.get<string>('app.webUrl') ?? ''}/r/${l.codigo}`;
    return (
      await this.links.criar(municipioId, 'processo', processoId, {
        tx: q,
      })
    ).url;
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  private async contactos(
    q: Q,
    municipioId: string,
    f: { processoId?: string | null; limite?: number } = {},
  ) {
    return q.query<ContactoLinha>(
      `SELECT a.id, a.chave, a.tipo, a.destinatario, a.gravidade,
              to_char(a.data_alvo, 'YYYY-MM-DD') AS data_alvo, a.antecedencia_dias_uteis,
              a.processo_id, p.numero AS processo_numero, a.municipe_id, mu.nome AS municipe_nome,
              a.canal_previsto, a.canal, a.motivo_sem_chamada, a.chamada_id,
              c.estado AS chamada_estado, c.erro AS chamada_erro, c.conversa_id,
              c.agendada_para AS chamada_agendada_para,
              a.mensagem_id, ms.estado::text AS mensagem_estado,
              a.titulo, a.texto, a.dizer, a.dados, a.demonstracao, a.explicado_em, a.criado_em
       FROM antecipacoes a
       LEFT JOIN processos p ON p.id = a.processo_id
       LEFT JOIN municipes mu ON mu.id = a.municipe_id
       LEFT JOIN chamadas_saida c ON c.id = a.chamada_id
       LEFT JOIN mensagens_saida ms ON ms.id = a.mensagem_id
       WHERE a.municipio_id = $1 AND ($2::uuid IS NULL OR a.processo_id = $2)
       ORDER BY a.criado_em DESC, a.id
       LIMIT $3`,
      [municipioId, f.processoId ?? null, f.limite ?? 100],
    );
  }

  /** O ecrã das antecipações: os próximos dias, os contactos e os alertas. */
  async painel(m: Municipio, f: z.output<typeof esquemaLista>) {
    const hoje = local(new Date(), m.fuso).dia;
    const ate = somarDias(hoje, f.dias);
    const [{ momentos, config }, contactos] = await Promise.all([
      this.momentos(this.db, m, { hoje, ate }),
      this.contactos(this.db, m.id),
    ]);
    const porChave = new Map(
      contactos
        .filter((c) => c.destinatario === 'municipe')
        .map((c) => [c.chave, c]),
    );
    const linhas = momentos.map((mo) => this.linhaMomento(m, mo, porChave));
    const resumo = Object.fromEntries(
      TIPOS_MOMENTO.map((t) => [
        t,
        Object.fromEntries(
          GRAVIDADES.map((g) => [
            g,
            linhas.filter((l) => l.tipo === t && l.gravidade === g).length,
          ]),
        ),
      ]),
    );
    return {
      hoje,
      ate,
      dias: f.dias,
      demo_ativa: this.demoAtiva(),
      resumo,
      momentos: linhas,
      contactos: contactos
        .filter((c) => c.destinatario === 'municipe')
        .map((c) => ({ ...c, resultado: resultadoDe(c) })),
      alertas: [
        ...contactos
          .filter((c) => c.destinatario === 'chefia')
          .map((c) => ({
            id: c.id,
            processo_id: c.processo_id,
            processo_numero: c.processo_numero,
            data_alvo: c.data_alvo,
            texto: c.texto,
            em: c.criado_em,
            confirmar_jurista: true,
            demonstracao: c.demonstracao,
          })),
      ],
      // Prazos da câmara que ainda não chegaram à antecedência: a chefia
      // vê-os já (é aqui que se evita o deferimento tácito).
      prazos_camara: linhas
        .filter((l) => l.tipo === 'prazo_camara')
        .map((l) => ({
          processo_id: l.processo?.id ?? null,
          processo_numero: l.processo?.numero ?? null,
          data_alvo: l.data_alvo,
          faltam_dias_uteis: l.faltam_dias_uteis,
          alerta: l.alerta,
        })),
      config: TIPOS_MOMENTO.map((t) => ({
        tipo: t,
        rotulo: DEF_TIPO[t].rotulo,
        ...config[t],
        configuravel: DEF_TIPO[t].configuravel,
        gerido_em: DEF_TIPO[t].gerido_em ?? null,
      })),
    };
  }

  private linhaMomento(
    m: Municipio,
    mo: Momento & { aviso?: unknown },
    porChave: Map<string, ContactoLinha>,
  ) {
    const t = textos(mo, { municipio: m.nome, link: '(link do processo)' });
    const c = porChave.get(mo.chave);
    const avisoLicenca = mo.aviso as {
      canal: string;
      em: string;
      chamada_id: string | null;
    } | null;
    return {
      chave: mo.chave,
      tipo: mo.tipo,
      rotulo: DEF_TIPO[mo.tipo].rotulo,
      gravidade: mo.gravidade,
      data_alvo: mo.data_alvo,
      contactar_em: mo.contactar_em,
      faltam_dias_uteis: mo.faltam_dias_uteis,
      devido: mo.devido,
      processo: mo.processo,
      municipe_id: mo.municipe_id,
      descricao: mo.descricao,
      titulo: t.titulo,
      o_agente_diz: t.dizer,
      o_que_pode_fazer: t.o_que_pode_fazer,
      sms: t.sms,
      alerta: t.alerta ?? null,
      fonte_legal: mo.fonte_legal,
      confirmar_jurista: mo.confirmar_jurista,
      demonstracao: mo.demonstracao,
      gerido_em: DEF_TIPO[mo.tipo].gerido_em ?? null,
      contacto: c
        ? {
            id: c.id,
            canal: c.canal,
            canal_previsto: c.canal_previsto,
            em: c.criado_em,
            chamada_id: c.chamada_id,
            resultado: resultadoDe(c),
          }
        : avisoLicenca
          ? {
              id: null,
              canal: avisoLicenca.canal,
              canal_previsto: 'notificacao',
              em: avisoLicenca.em,
              chamada_id: avisoLicenca.chamada_id,
              resultado:
                'Aviso de validade da licença (job dos avisos das licenças).',
            }
          : null,
    };
  }

  /** Na ficha do processo: o que está previsto e o que já foi feito. */
  async doProcesso(m: Municipio, processoId: string) {
    const [p] = await this.db.query<{ id: string }>(
      'SELECT id FROM processos WHERE id = $1 AND municipio_id = $2',
      [processoId, m.id],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Processo não encontrado.',
      );
    }
    const hoje = local(new Date(), m.fuso).dia;
    const [{ momentos }, contactos] = await Promise.all([
      this.momentos(this.db, m, {
        hoje,
        ate: somarDias(hoje, HORIZONTE_DIAS),
        processoId,
      }),
      this.contactos(this.db, m.id, { processoId, limite: 50 }),
    ]);
    const porChave = new Map(
      contactos
        .filter((c) => c.destinatario === 'municipe')
        .map((c) => [c.chave, c]),
    );
    return {
      hoje,
      previstos: momentos.map((mo) => this.linhaMomento(m, mo, porChave)),
      feitos: contactos.map((c) => ({ ...c, resultado: resultadoDe(c) })),
    };
  }

  /** "Correr agora" (só na demonstração). */
  async correrAgora(m: Municipio, u: UtilizadorPainel) {
    if (!this.demoAtiva()) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'demo_desligada',
        'Correr agora só existe na demonstração.',
      );
    }
    const r = await this.correrMunicipio(m);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'correr_antecipacoes',
      objetoTipo: 'antecipacao_config',
      objetoId: m.id,
      dados: r,
    });
    return r;
  }

  /**
   * Abre a audiência prévia (proposta de indeferimento): fica na linha do
   * tempo com o prazo (por omissão 10 dias úteis, CPA art. 122.º) e o
   * momento passa a contar para as antecipações.
   */
  async abrirAudiencia(
    m: Municipio,
    u: UtilizadorPainel,
    processoId: string,
    b: z.output<typeof esquemaAudiencia>,
  ) {
    const feriados = await this.municipios.feriados(m.id);
    const hoje = local(new Date(), m.fuso).dia;
    const prazo = somarDiasUteis(hoje, b.dias_uteis, feriados);
    await this.db.transaction(async (tx) => {
      const [p] = await tx.query<{ decisao: string | null; fase: string }>(
        `SELECT decisao, fase::text FROM processos WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [processoId, m.id],
      );
      if (!p) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Processo não encontrado.',
        );
      }
      if (p.decisao || ['notificado', 'arquivado'].includes(p.fase)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ja_decidido',
          'O processo já tem decisão.',
        );
      }
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, interno, dados)
         VALUES ($1, 'audiencia_previa', $2, 'utilizador', $3, false, $4)`,
        [
          processoId,
          `Audiência prévia: a câmara propõe indeferir (${b.fundamento.replace(/[.]$/, '')}). Pode pronunciar-se por escrito até ${prazo.split('-').reverse().join('/')}.`,
          u.id,
          JSON.stringify({
            prazo,
            fundamento: b.fundamento,
            dias_uteis: b.dias_uteis,
          }),
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'abrir_audiencia_previa',
          objetoTipo: 'processo',
          objetoId: processoId,
          dados: { prazo, dias_uteis: b.dias_uteis },
        },
        tx,
      );
    });
    return this.doProcesso(m, processoId);
  }

  // ------------------------------------------------------------------
  // Ferramenta: explicar_momento
  // ------------------------------------------------------------------

  async explicar(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaExplicar>,
  ): Promise<Record<string, unknown>> {
    const m = ctx.municipio;
    const telefone = normalizarTelefone(ctx.telefone);
    const municipeId =
      ctx.municipeId ??
      (telefone
        ? ((await this.municipes.porTelefone(m.id, telefone))?.id ?? null)
        : null);
    if (!municipeId) {
      return {
        encontrado: false,
        motivo: 'precisa_identificacao',
        instrucao:
          ctx.canal === 'chat'
            ? 'A pessoa tem de se identificar no chat com o número de telemóvel. Depois chama outra vez.'
            : 'Não sei quem é a pessoa. Pede o número de telemóvel ou o NIF e usa identificar_municipe; depois chama outra vez.',
      };
    }
    const hoje = local(new Date(), m.fuso).dia;
    const { momentos } = await this.momentos(this.db, m, {
      hoje,
      ate: somarDias(hoje, 45),
      municipeId,
    });
    const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');
    const lista = momentos.filter(
      (mo) =>
        !e.numero ||
        (mo.processo && norm(mo.processo.numero) === norm(e.numero)),
    );
    if (!lista.length) {
      return {
        encontrado: false,
        motivo: 'sem_momentos',
        dizer: e.numero
          ? `Não tenho nenhuma data importante a chegar no processo ${e.numero}.`
          : 'Não tem nenhum prazo nem data importante nas próximas semanas. Está tudo em dia.',
      };
    }
    // O mais urgente primeiro (o que se contactou, se houver).
    const contactados = await this.db.query<{ chave: string }>(
      `SELECT chave FROM antecipacoes
       WHERE municipe_id = $1 AND destinatario = 'municipe' AND criado_em > now() - interval '30 days'`,
      [municipeId],
    );
    const ja = new Set(contactados.map((c) => c.chave));
    lista.sort(
      (a, b) =>
        Number(ja.has(b.chave)) - Number(ja.has(a.chave)) ||
        a.data_alvo.localeCompare(b.data_alvo),
    );
    await this.db.query(
      `UPDATE antecipacoes SET explicado_em = now()
       WHERE chave = ANY($1) AND explicado_em IS NULL`,
      [lista.slice(0, 3).map((mo) => mo.chave)],
    );
    const itens = lista.slice(0, 3).map((mo) => {
      const t = textos(mo, { municipio: m.nome, link: '' });
      return {
        o_que_e: DEF_TIPO[mo.tipo].rotulo,
        numero_processo: mo.processo?.numero ?? null,
        data: diaDito(mo.data_alvo),
        faltam_dias_uteis: mo.faltam_dias_uteis,
        dizer: t.dizer,
        o_que_pode_fazer: t.o_que_pode_fazer,
        fonte: mo.fonte_legal,
        confirmar_com_a_camara: mo.confirmar_jurista,
      };
    });
    return {
      encontrado: true,
      momentos: itens,
      dizer: `${itens[0].dizer} ${itens[0].o_que_pode_fazer}`,
      instrucao:
        'Explica com calma, uma coisa de cada vez. Se confirmar_com_a_camara for true, não garantas o que a lei prevê no caso dela: diz que a câmara confirma. Para o que falta entregar usa estado_processo; para renovar uma licença, renovar_licenca; para dúvidas que não sabes, passar_a_humano.',
    };
  }
}

const ROTULO_CANAL = {
  chamada: 'chamada do agente agendada (SMS se não atender)',
  push: 'notificação na app',
  sms: 'SMS',
} as const;

interface ContactoLinha {
  id: string;
  chave: string;
  tipo: TipoMomento;
  destinatario: 'municipe' | 'chefia';
  gravidade: string;
  data_alvo: string;
  processo_id: string | null;
  processo_numero: string | null;
  municipe_id: string | null;
  municipe_nome: string | null;
  canal_previsto: string;
  canal: string;
  motivo_sem_chamada: string | null;
  chamada_id: string | null;
  chamada_estado: string | null;
  chamada_erro: string | null;
  conversa_id: string | null;
  mensagem_id: string | null;
  mensagem_estado: string | null;
  texto: string;
  dizer: string | null;
  demonstracao: boolean;
  explicado_em: Date | null;
  criado_em: Date;
}

/** O resultado do contacto, numa frase para o painel. */
export function resultadoDe(c: {
  canal: string;
  canal_previsto: string;
  motivo_sem_chamada: string | null;
  chamada_estado: string | null;
  chamada_erro: string | null;
  mensagem_estado: string | null;
  explicado_em: Date | string | null;
}): string {
  const explicado = c.explicado_em ? ' O agente explicou-lhe o momento.' : '';
  switch (c.canal) {
    case 'chamada': {
      const e = c.chamada_estado;
      const base =
        e === 'atendida'
          ? 'Chamada atendida.'
          : e === 'agendada'
            ? 'Chamada agendada.'
            : e === 'a_ligar'
              ? 'A ligar.'
              : e === 'nao_atendida'
                ? 'Não atendeu: seguiu SMS.'
                : e === 'cancelada'
                  ? `Chamada cancelada${c.chamada_erro ? ` (${c.chamada_erro})` : ''}.`
                  : e === 'falhou'
                    ? `Chamada falhou${c.chamada_erro ? ` (${c.chamada_erro})` : ''}: seguiu SMS.`
                    : 'Chamada.';
      return base + explicado;
    }
    case 'push':
      return `Notificação na app.${explicado}`;
    case 'sms': {
      const semChamada =
        c.canal_previsto === 'chamada' && c.motivo_sem_chamada
          ? ` O agente ligaria, mas: ${TEXTO_SEM_CHAMADA[c.motivo_sem_chamada as keyof typeof TEXTO_SEM_CHAMADA] ?? c.motivo_sem_chamada}`
          : '';
      return `SMS${c.mensagem_estado ? ` (${c.mensagem_estado})` : ''}.${semChamada}${explicado}`;
    }
    case 'ja_avisado':
      return 'Já tinha sido avisado pelo lembrete do prazo.';
    case 'interno':
      return 'Alerta interno à chefia.';
    default:
      return 'Sem forma de contactar o munícipe (sem telefone, sem app ou recusou avisos).';
  }
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
