import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { ChamadasSaidaService } from '../chamadas-saida/chamadas-saida.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  avisoDevido,
  diasDeAviso,
  porSemana,
  proximoAviso,
} from './avisos-validade.js';
import { dataPorExtenso, diasEntre, somarDias } from './comum.js';
import { LicencasService } from './licencas.service.js';
import { avisosDe, DEFS, ENTRADAS, TIPOS, TipoLicenca } from './tipos.js';

/** Os tipos com validade, que se avisam e renovam. */
export const RENOVAVEIS = TIPOS.filter((t) => DEFS[t].renovavel);

/** O que a pessoa pode mudar ao renovar (o resto fica igual). */
export const entradaRenovar = z.object({
  numero: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe(
      'O número da licença a renovar (ex.: "ESP 3/2026"), se a pessoa tiver mais de uma a expirar.',
    ),
  confirmar: z
    .boolean()
    .optional()
    .describe(
      'Sem isto (ou false): só procura as licenças a expirar e mostra os dados. true: cria o pedido de renovação, depois de a pessoa confirmar os dados.',
    ),
  alteracoes: z
    .object({
      meses: z.number().int().min(1).max(36).optional(),
      dias: z.number().int().min(1).max(365).optional(),
      area_m2: z.number().positive().max(10_000).optional(),
      mesas: z.number().int().min(1).max(1000).optional(),
      passeio_livre_m: z.number().min(0).max(20).optional(),
      largura_m: z.number().positive().max(100).optional(),
      altura_m: z.number().positive().max(100).optional(),
      iluminado: z.boolean().optional(),
      matricula: z.string().trim().min(4).max(12).optional(),
      nome: z.string().trim().max(120).optional(),
    })
    .optional()
    .describe(
      'Só o que mudou desde a licença anterior (ex.: { "meses": 12 } ou { "mesas": 6 }). Vazio = tudo igual.',
    ),
  metodo: z
    .enum(['mbway', 'multibanco'])
    .optional()
    .describe('Como quer pagar a taxa; por omissão MB WAY.'),
});

interface Candidata {
  id: string;
  municipio_id: string;
  tipo: TipoLicenca;
  municipe_id: string | null;
  processo_id: string;
  numero: string;
  codigo_verificacao: string;
  valida_ate: string;
  emitida_em: string;
  telefone: string | null;
  titular: string | null;
  renovada: boolean;
  renovacao: { numero: string; estado: string } | null;
  avisos_enviados: number[];
  avisos: { dias: number; canal: string; em: string }[];
  dados: Record<string, unknown>;
  config_usada: unknown;
}

const SELECT = `
  SELECT l.id, l.municipio_id, l.tipo, l.municipe_id, l.processo_id, p.numero, l.codigo_verificacao,
         to_char(l.valida_ate, 'YYYY-MM-DD') AS valida_ate,
         to_char((l.decidida_em AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS emitida_em,
         mu.telefone_e164 AS telefone, coalesce(l.dados->>'nome', mu.nome) AS titular,
         r.numero IS NOT NULL AS renovada,
         CASE WHEN r.numero IS NULL THEN NULL
              ELSE jsonb_build_object('numero', r.numero, 'estado', r.estado) END AS renovacao,
         coalesce((SELECT array_agg(a.dias ORDER BY a.dias DESC) FROM licenca_avisos a
                   WHERE a.licenca_id = l.id), '{}') AS avisos_enviados,
         coalesce((SELECT jsonb_agg(jsonb_build_object('dias', a.dias, 'canal', a.canal,
                     'em', a.criado_em) ORDER BY a.dias DESC)
                   FROM licenca_avisos a WHERE a.licenca_id = l.id), '[]') AS avisos,
         l.dados, l.config_usada
  FROM licencas l
  JOIN processos p ON p.id = l.processo_id
  LEFT JOIN municipes mu ON mu.id = l.municipe_id
  LEFT JOIN LATERAL (
    SELECT rp.numero, rl.estado FROM licencas rl JOIN processos rp ON rp.id = rl.processo_id
    WHERE rl.renova_licenca_id = l.id AND rl.estado <> 'recusada'
    ORDER BY rl.criada_em DESC LIMIT 1) r ON true
  WHERE l.estado = 'emitida' AND l.tipo = ANY($1) AND l.valida_ate IS NOT NULL`;

/** "ESP 3/2026" e "esp3/2026" são o mesmo. */
const normalizar = (n: string) => n.toUpperCase().replace(/\s+/g, '');

/**
 * Calendário de obrigações: avisa antes de uma licença expirar (SMS, ou
 * chamada do agente a quem prefere telefone), mostra no painel o que
 * expira nas próximas semanas e renova pelo agente com os mesmos dados.
 */
@Injectable()
export class LicencasAvisosService {
  private readonly logger = new Logger(LicencasAvisosService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly licencas: LicencasService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly chamadas: ChamadasSaidaService,
  ) {}

  /** As emitidas antes de haver `valida_ate`: as mesmas contas da página. */
  async preencherValidade(municipioId?: string): Promise<number> {
    const sem = await this.db.query<{
      id: string;
      tipo: TipoLicenca;
      dados: unknown;
      config_usada: unknown;
      decidida_em: Date;
    }>(
      `SELECT id, tipo, dados, config_usada, decidida_em FROM licencas
       WHERE estado = 'emitida' AND valida_ate IS NULL AND decidida_em IS NOT NULL
         AND tipo = ANY($1) AND ($2::uuid IS NULL OR municipio_id = $2)`,
      [RENOVAVEIS, municipioId ?? null],
    );
    for (const l of sem) {
      const ate = DEFS[l.tipo].resumo(
        l.dados,
        l.config_usada,
        hojeLisboa(l.decidida_em),
      ).valida_ate;
      await this.db.query('UPDATE licencas SET valida_ate = $2 WHERE id = $1', [
        l.id,
        ate,
      ]);
    }
    return sem.length;
  }

  /**
   * O job diário: manda o aviso que estiver devido hoje a cada licença
   * (uma só vez por licença e por aviso). Devolve quantos foram.
   */
  async avisar(hoje = hojeLisboa()): Promise<number> {
    await this.preencherValidade();
    const lista = await this.db.query<Candidata>(
      `${SELECT} AND l.valida_ate BETWEEN $2::date AND $2::date + 366
       ORDER BY l.valida_ate`,
      [RENOVAVEIS, hoje],
    );
    const configs = new Map<string, unknown>();
    let enviados = 0;
    for (const l of lista) {
      const k = `${l.municipio_id}:${l.tipo}`;
      if (!configs.has(k)) {
        configs.set(k, await this.licencas.configDe(l.municipio_id, l.tipo));
      }
      const regra = avisosDe(l.tipo, configs.get(k));
      if (!regra) continue;
      const devido = avisoDevido(l, regra, hoje);
      if (!devido) continue;
      try {
        if (await this.enviarAviso(l, devido.dias, regra.aviso_por_chamada)) {
          enviados++;
        }
      } catch (err) {
        this.logger.error(
          `Aviso da licença ${l.numero} falhou: ${String(err)}`,
        );
      }
    }
    return enviados;
  }

  private async enviarAviso(
    l: Candidata,
    dias: number,
    porChamada: boolean,
  ): Promise<boolean> {
    const municipio = await this.municipios.porId(l.municipio_id);
    const def = DEFS[l.tipo];
    const chave = `licenca_aviso:${l.id}:${dias}`;
    const ate = dataPorExtenso(l.valida_ate);
    const url = this.licencas.urlVerificacao(l.codigo_verificacao);
    const corpo =
      `${municipio.nome}: ${def.feminino ? 'a sua' : 'o seu'} ${def.curto} ${l.numero} é ${def.feminino ? 'válida' : 'válido'} até ${ate}. ` +
      `Para renovar, ligue ou escreva-nos e o assistente trata de tudo. ${url}`;
    const relacionado = { processo_id: l.processo_id, licenca_id: l.id };
    return this.db.transaction(async (tx) => {
      const [aviso] = await tx.query<{ id: string }>(
        `INSERT INTO licenca_avisos (municipio_id, licenca_id, dias, valida_ate, canal)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (licenca_id, dias) DO NOTHING RETURNING id`,
        [
          l.municipio_id,
          l.id,
          dias,
          l.valida_ate,
          l.telefone ? 'sms' : 'sem_contacto',
        ],
      );
      if (!aviso || !l.telefone) return !!aviso;
      if (porChamada && l.municipe_id) {
        const c = await this.chamadas.agendar(tx, {
          municipioId: l.municipio_id,
          municipeId: l.municipe_id,
          motivo: 'renovacao_licenca',
          processoId: l.processo_id,
          oQueMudou: `${def.feminino ? 'A' : 'O'} ${def.curto} ${l.numero} é ${def.feminino ? 'válida' : 'válido'} até ${ate}.`,
          nota: 'Se a pessoa quiser renovar, usa renovar_licenca: os dados ficam iguais, pergunta só o que mudou.',
          recurso: { corpo, chave, motivo: 'lembrete', relacionado },
          chave,
        });
        if (c.agendada) {
          await tx.query(
            `UPDATE licenca_avisos SET canal = 'chamada', chamada_id = $2 WHERE id = $1`,
            [aviso.id, c.id],
          );
          return true;
        }
      }
      const mensagemId = await this.mensagens.sms(
        {
          municipioId: l.municipio_id,
          municipeId: l.municipe_id,
          destino: l.telefone,
          motivo: 'lembrete',
          corpo,
          relacionado,
          chave,
        },
        tx,
      );
      await tx.query(
        'UPDATE licenca_avisos SET mensagem_id = $2 WHERE id = $1',
        [aviso.id, mensagemId],
      );
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Painel: "A expirar"
  // ------------------------------------------------------------------

  async aExpirar(m: Municipio, dias = 60) {
    await this.preencherValidade(m.id);
    const hoje = hojeLisboa();
    const lista = await this.db.query<Candidata>(
      `${SELECT} AND l.municipio_id = $3
         AND l.valida_ate BETWEEN $2::date AND $2::date + $4::int
       ORDER BY l.valida_ate, p.numero`,
      [RENOVAVEIS, hoje, m.id, dias],
    );
    const configs = new Map<TipoLicenca, unknown>();
    for (const t of RENOVAVEIS) {
      configs.set(t, await this.licencas.configDe(m.id, t));
    }
    const linhas = lista.map((l) => {
      const regra = avisosDe(l.tipo, configs.get(l.tipo))!;
      const proximo = proximoAviso(l, regra, hoje);
      return {
        id: l.id,
        numero: l.numero,
        tipo: l.tipo,
        tipo_nome: DEFS[l.tipo].nome,
        titular: l.titular,
        telefone: l.telefone,
        valida_ate: l.valida_ate,
        faltam_dias: diasEntre(hoje, l.valida_ate),
        codigo_verificacao: l.codigo_verificacao,
        processo_id: l.processo_id,
        avisos: l.avisos,
        proximo_aviso: proximo,
        renovacao: l.renovacao,
        estado_aviso: l.renovada
          ? ('renovada' as const)
          : l.avisos.length
            ? ('avisado' as const)
            : proximo
              ? ('por_avisar' as const)
              : ('sem_aviso' as const),
      };
    });
    return {
      hoje,
      dias,
      total: linhas.length,
      avisos: Object.fromEntries(
        RENOVAVEIS.map((t) => [t, diasDeAviso(avisosDe(t, configs.get(t))!)]),
      ),
      semanas: porSemana(linhas),
    };
  }

  // ------------------------------------------------------------------
  // Ferramenta: renovar_licenca
  // ------------------------------------------------------------------

  async renovar(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaRenovar>,
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
        encontrada: false,
        motivo: 'precisa_identificacao',
        instrucao:
          ctx.canal === 'chat'
            ? 'Para renovar uma licença a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.'
            : 'Não sei quem é a pessoa. Pede o número de telemóvel e usa identificar_municipe; depois chama outra vez.',
      };
    }
    await this.preencherValidade(m.id);
    const hoje = hojeLisboa();
    const todas = await this.db.query<Candidata>(
      `${SELECT} AND l.municipio_id = $3 AND l.municipe_id = $4
         AND l.valida_ate BETWEEN $2::date - 30 AND $2::date + 90
       ORDER BY l.valida_ate`,
      [RENOVAVEIS, hoje, m.id, municipeId],
    );
    const porRenovar = todas.filter((l) => !l.renovada);
    const descrever = (l: Candidata) => {
      const r = DEFS[l.tipo].resumo(l.dados, l.config_usada, l.emitida_em);
      return {
        numero: l.numero,
        tipo: l.tipo,
        nome: DEFS[l.tipo].nome,
        valida_ate: l.valida_ate,
        expirada: l.valida_ate < hoje,
        o_que_e: `${r.atividade} · ${r.morada}`,
        dados: r.detalhes.map((d) => `${d.rotulo}: ${d.valor}`),
      };
    };
    if (!porRenovar.length) {
      const ja = todas.find((l) => l.renovada);
      return {
        encontrada: false,
        motivo: ja ? 'ja_renovada' : 'sem_licencas',
        dizer: ja
          ? `${DEFS[ja.tipo].feminino ? 'A' : 'O'} ${DEFS[ja.tipo].curto} ${ja.numero} já tem o pedido de renovação ${ja.renovacao?.numero ?? ''}.`
          : 'Não encontrei licenças suas a expirar nos próximos 90 dias. Se quiser, posso pedir uma nova.',
      };
    }
    const escolhida = e.numero
      ? porRenovar.find((l) => normalizar(l.numero) === normalizar(e.numero!))
      : porRenovar.length === 1
        ? porRenovar[0]
        : undefined;
    if (!escolhida) {
      return {
        encontrada: true,
        escolher: true,
        licencas: porRenovar.map(descrever),
        dizer: e.numero
          ? `Não encontrei a licença ${e.numero} entre as suas a expirar. Tem estas: ${porRenovar.map((l) => `${DEFS[l.tipo].curto} ${l.numero}`).join(', ')}. Qual quer renovar?`
          : `Tem ${porRenovar.length} licenças a expirar: ${porRenovar.map((l) => `${DEFS[l.tipo].curto} ${l.numero}, até ${dataPorExtenso(l.valida_ate)}`).join('; ')}. Qual quer renovar?`,
      };
    }
    const def = DEFS[escolhida.tipo];
    if (!e.confirmar) {
      return {
        encontrada: true,
        licenca: descrever(escolhida),
        dizer:
          `${def.feminino ? 'A sua' : 'O seu'} ${def.curto} ${escolhida.numero} é ${def.feminino ? 'válida' : 'válido'} até ${dataPorExtenso(escolhida.valida_ate)}. ` +
          `Renovo com os mesmos dados (${descrever(escolhida).dados.join('; ')})? Mudou alguma coisa?`,
        instrucao:
          'Lê os dados à pessoa, pergunta só o que mudou e chama outra vez com confirmar: true e as alteracoes (se houver).',
      };
    }

    const dados: Record<string, unknown> = { ...escolhida.dados };
    for (const [k, v] of Object.entries(e.alteracoes ?? {})) {
      if (v !== undefined) dados[k] = v;
    }
    if ('data_inicio' in dados) {
      const seguinte = somarDias(escolhida.valida_ate, 1);
      dados.data_inicio = seguinte > hoje ? seguinte : hoje;
    }
    if (e.metodo) dados.metodo = e.metodo;
    const entrada = ENTRADAS[escolhida.tipo as keyof typeof ENTRADAS];
    const v = entrada.safeParse(dados);
    if (!v.success) {
      return {
        pedida: false,
        motivo: 'dados_invalidos',
        erros: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        dizer: 'Há um dado que não está certo. Confirme comigo o que mudou.',
      };
    }
    const r = await this.licencas.pedir(escolhida.tipo, ctx, v.data, {
      renova: { id: escolhida.id, numero: escolhida.numero },
    });
    if (!('dizer' in r)) return r;
    return {
      ...r,
      dizer: `Pedido de renovação ${def.feminino ? 'da' : 'do'} ${def.curto} ${escolhida.numero}. ${r.dizer}`,
    };
  }
}
