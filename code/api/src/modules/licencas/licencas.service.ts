import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { validar } from '../../common/validacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import { formatarEuros, LinhaTaxa } from '../pagamentos/taxas.js';
import { AvaliacaoLicenca, diaCurto, diaPorExtenso } from './comum.js';
import { gerarHistoricoDemonstracao } from './historico-demonstracao.js';
import { gerarPdfLicenca } from './licenca-pdf.js';
import {
  ATIVIDADES,
  Atividade,
  ConfigRuido,
  esquemaConfigRuido,
} from './regras.js';
import { PedidoAntigo, simular } from './simulacao.js';
import { decisaoDita, DEFS, TipoLicenca, TIPOS } from './tipos.js';

const hora = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3])[:h]([0-5]\d)?$/, 'Hora como 20:00.')
  .transform((h) => {
    const [a, b] = h.split(/[:h]/);
    return `${a.padStart(2, '0')}:${(b || '00').padStart(2, '0')}`;
  });

export const entradaPedirRuido = z.object({
  atividade: z
    .enum(Object.keys(ATIVIDADES) as [Atividade, ...Atividade[]])
    .describe(
      'festa_privada (aniversário, casamento…), evento (aberto ao público) ou obra (ruidosa, fora de horas).',
    ),
  descricao: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      'O que vai acontecer, numa frase (ex.: "festa de anos no quintal, com música").',
    ),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Onde: rua, número e freguesia.'),
  data: z.iso
    .date()
    .describe('O dia, AAAA-MM-DD (ex.: sábado 31 de outubro → 2026-10-31).'),
  hora_inicio: hora.describe('Hora a que começa, HH:MM.'),
  hora_fim: hora.describe(
    'Hora a que acaba, HH:MM (pode passar da meia-noite, ex.: 01:00).',
  ),
  pessoas: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .optional()
    .describe('Quantas pessoas, mais ou menos.'),
  musica_amplificada: z
    .boolean()
    .optional()
    .describe('Se vai haver colunas ou música alta.'),
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Nome do titular, para a licença.'),
  metodo: z
    .enum(['mbway', 'multibanco'])
    .optional()
    .describe(
      'Como quer pagar a taxa; por omissão MB WAY para o telemóvel de onde liga.',
    ),
});

export const esquemaRecusar = z.object({
  motivo: z.string().trim().min(5).max(500),
});

export type EstadoLicenca =
  'a_pagar' | 'por_aprovar' | 'para_tecnico' | 'emitida' | 'recusada';

/** O que todas as configurações têm (o resto depende do tipo). */
export interface ConfigComum {
  aprovacao: 'funcionario' | 'automatica';
  fonte: { titulo: string; url: string | null };
  demonstracao: boolean;
  /** Só na do ruído (a taxa fixa das licenças antigas, sem `avaliacao.taxa`). */
  taxa_cent?: number;
}

/** Dados comuns às entradas de todas as ferramentas. */
export interface DadosComuns {
  morada: string;
  nome?: string;
  metodo?: 'mbway' | 'multibanco';
  [k: string]: unknown;
}

export interface Linha {
  id: string;
  municipio_id: string;
  processo_id: string;
  numero: string;
  tipo: TipoLicenca;
  municipe_id: string | null;
  conversa_id: string | null;
  dados: DadosComuns;
  /** As licenças de ruído antigas não têm `taxa` (era a fixa da config). */
  avaliacao: Omit<AvaliacaoLicenca, 'taxa'> & {
    taxa?: AvaliacaoLicenca['taxa'];
  };
  config_usada: ConfigComum;
  proposta: 'aprovar' | 'tecnico';
  estado: EstadoLicenca;
  taxa_cent: number;
  codigo_verificacao: string;
  decidida_por: string | null;
  decidida_por_nome: string | null;
  decidida_em: Date | null;
  motivo_recusa: string | null;
  criada_em: Date;
  telefone: string | null;
  titular: string | null;
  pagamento: {
    id: string;
    estado: string;
    metodo: string | null;
    valor_cent: number;
    pago_em: string | null;
    modo_teste: boolean;
  } | null;
}

const SELECT = `
  SELECT l.id, l.municipio_id, l.processo_id, p.numero, l.tipo, l.municipe_id, l.conversa_id,
         l.dados, l.avaliacao, l.config_usada, l.proposta, l.estado, l.taxa_cent,
         l.codigo_verificacao, l.decidida_por, u.nome AS decidida_por_nome, l.decidida_em,
         l.motivo_recusa, l.criada_em, mu.telefone_e164 AS telefone,
         coalesce(l.dados->>'nome', mu.nome) AS titular,
         (SELECT jsonb_build_object('id', pg.id, 'estado', pg.estado, 'metodo', pg.metodo,
                   'valor_cent', pg.valor_cent, 'pago_em', pg.pago_em, 'modo_teste', pg.modo_teste)
          FROM pagamentos pg WHERE pg.processo_id = l.processo_id
          ORDER BY (pg.estado = 'pago') DESC, pg.criado_em DESC LIMIT 1) AS pagamento
  FROM licencas l
  JOIN processos p ON p.id = l.processo_id
  LEFT JOIN municipes mu ON mu.id = l.municipe_id
  LEFT JOIN utilizadores u ON u.id = l.decidida_por`;

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Pedidos dos últimos 5 anos entram na simulação. */
const ANOS_SIMULACAO = 5;

/**
 * Licenças decididas na chamada (ruído, ocupação da via pública, esplanada,
 * dístico de residente): as regras correm em código, a taxa paga-se em modo
 * de teste e um funcionário aprova com um clique (ou a câmara deixa emitir
 * sozinha). A câmara pode testar regras novas contra os pedidos antigos.
 */
@Injectable()
export class LicencasService {
  private readonly logger = new Logger(LicencasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly pagamentos: PagamentosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Regras (painel)
  // ------------------------------------------------------------------

  async configDe(municipioId: string, tipo: TipoLicenca): Promise<unknown> {
    const [r] = await this.db.query<{ config: unknown }>(
      `SELECT config FROM licenca_regras WHERE municipio_id = $1 AND tipo = $2`,
      [municipioId, tipo],
    );
    return DEFS[tipo].ler(r?.config);
  }

  async configRuido(municipioId: string): Promise<ConfigRuido> {
    return (await this.configDe(municipioId, 'ruido')) as ConfigRuido;
  }

  /** Valida as regras de um tipo (400 com o que está mal). */
  validarConfig(tipo: TipoLicenca, body: unknown): unknown {
    return validar(DEFS[tipo].esquemaConfig, body);
  }

  async guardarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    c: unknown,
    tipo: TipoLicenca = 'ruido',
  ) {
    await this.db.query(
      `INSERT INTO licenca_regras (municipio_id, tipo, config, atualizado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (municipio_id, tipo) DO UPDATE
         SET config = EXCLUDED.config, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [m.id, tipo, JSON.stringify(c), u.id],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_regras_licenca',
      objetoTipo: 'licenca_regras',
      objetoId: m.id,
      dados: { tipo },
    });
    return { config: c };
  }

  /** Os tipos, com as regras em vigor e os campos que o painel edita. */
  async tipos(m: Municipio) {
    const regras = await this.db.query<{
      tipo: TipoLicenca;
      config: unknown;
      atualizado_em: Date;
    }>(
      `SELECT tipo, config, atualizado_em FROM licenca_regras WHERE municipio_id = $1`,
      [m.id],
    );
    const historico = await this.db.query<{
      tipo: TipoLicenca;
      n: number;
      demo: number;
    }>(
      `SELECT tipo, count(*)::int AS n, count(*) FILTER (WHERE demonstracao)::int AS demo
       FROM licenca_historico WHERE municipio_id = $1 GROUP BY tipo`,
      [m.id],
    );
    const licencas = await this.db.query<{ tipo: TipoLicenca; n: number }>(
      `SELECT tipo, count(*)::int AS n FROM licencas WHERE municipio_id = $1 GROUP BY tipo`,
      [m.id],
    );
    return TIPOS.map((t) => {
      const d = DEFS[t];
      const r = regras.find((x) => x.tipo === t);
      const h = historico.find((x) => x.tipo === t);
      return {
        tipo: t,
        nome: d.nome,
        codigo: d.codigo,
        ferramenta: d.ferramenta,
        config: d.ler(r?.config),
        atualizado_em: r?.atualizado_em.toISOString() ?? null,
        campos: d.campos,
        pedidos: licencas.find((x) => x.tipo === t)?.n ?? 0,
        historico: { pedidos: h?.n ?? 0, demonstracao: h?.demo ?? 0 },
      };
    });
  }

  // ------------------------------------------------------------------
  // Testar regras antes de as aprovar
  // ------------------------------------------------------------------

  /**
   * Corre as regras propostas (sem gravar) contra os pedidos dos últimos
   * anos deste tipo e compara com as regras em vigor.
   */
  async simular(m: Municipio, tipo: TipoLicenca, propostas: unknown) {
    const d = DEFS[tipo];
    const atuais = await this.configDe(m.id, tipo);
    const feriados = await this.municipios.feriados(m.id);
    const pedidos = await this.db.query<PedidoAntigo<unknown>>(
      `SELECT l.id, p.numero AS referencia,
              to_char((l.criada_em AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS pedido_em,
              l.dados, false AS demonstracao
       FROM licencas l JOIN processos p ON p.id = l.processo_id
       WHERE l.municipio_id = $1 AND l.tipo = $2
         AND l.criada_em >= now() - make_interval(years => $3)
       UNION ALL
       SELECT h.id, h.referencia, to_char(h.pedido_em, 'YYYY-MM-DD'), h.dados, h.demonstracao
       FROM licenca_historico h
       WHERE h.municipio_id = $1 AND h.tipo = $2
         AND h.pedido_em >= (now() - make_interval(years => $3))::date
       ORDER BY 3`,
      [m.id, tipo, ANOS_SIMULACAO],
    );
    const resultado = simular(
      atuais,
      propostas,
      pedidos,
      (dados, config, pedidoEm) => {
        const a = d.avaliar(dados, config, pedidoEm, feriados);
        return {
          aprovado: a.proposta === 'aprovar',
          decisao: decisaoDita(a.proposta),
          taxa_cent: a.taxa.total_cent,
          regras: a.regras,
        };
      },
      {
        exemplos: 10,
        resumir: (dados) => {
          const r = d.resumo(dados, propostas, null);
          return `${r.assunto} · ${r.morada}`;
        },
      },
    );
    return {
      tipo,
      nome: d.nome,
      anos: ANOS_SIMULACAO,
      ...resultado,
      // Os textos de cada regra (para o "porquê" agregado).
      nota: 'A receita conta só os pedidos aprovados na hora (dentro das regras). Os que vão a técnico podem ainda ser aprovados e pagar.',
    };
  }

  /**
   * Carrega pedidos antigos de demonstração para este tipo, só se ainda não
   * houver histórico (para a simulação ter com que trabalhar).
   */
  async carregarHistoricoDemonstracao(
    m: Municipio,
    u: UtilizadorPainel,
    tipo: TipoLicenca,
  ) {
    const [ja] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM licenca_historico WHERE municipio_id = $1 AND tipo = $2`,
      [m.id, tipo],
    );
    if (ja.n > 0) return { criados: 0, ja_havia: ja.n };
    const lista = gerarHistoricoDemonstracao(tipo, hojeLisboa());
    await this.db.query(
      `INSERT INTO licenca_historico (municipio_id, tipo, referencia, pedido_em, dados, demonstracao)
       SELECT $1, $2, x.referencia, x.pedido_em::date, x.dados, true
       FROM jsonb_to_recordset($3::jsonb) AS x(referencia text, pedido_em text, dados jsonb)
       ON CONFLICT DO NOTHING`,
      [m.id, tipo, JSON.stringify(lista)],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'carregar_historico_licencas_demonstracao',
      objetoTipo: 'licenca_regras',
      objetoId: m.id,
      dados: { tipo, pedidos: lista.length },
    });
    return { criados: lista.length, ja_havia: 0 };
  }

  // ------------------------------------------------------------------
  // Ferramentas do agente
  // ------------------------------------------------------------------

  pedirRuido(ctx: ContextoFerramenta, e: z.output<typeof entradaPedirRuido>) {
    return this.pedir('ruido', ctx, e);
  }

  async pedir(tipo: TipoLicenca, ctx: ContextoFerramenta, e: DadosComuns) {
    const def = DEFS[tipo];
    const m = ctx.municipio;
    const telefone = normalizarTelefone(ctx.telefone);
    if (!ctx.municipeId && !telefone) {
      return {
        pedida: false,
        motivo: 'precisa_identificacao',
        instrucao:
          ctx.canal === 'chat'
            ? `Para pedir ${def.feminino ? 'a' : 'o'} ${def.curto} a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.`
            : `Não há um número para onde mandar ${def.feminino ? 'a' : 'o'} ${def.curto}. Pede o número de telemóvel e usa identificar_municipe, ou passa a um funcionário.`,
      };
    }
    const config = (await this.configDe(m.id, tipo)) as ConfigComum;
    const feriados = await this.municipios.feriados(m.id);
    const avaliacao = def.avaliar(e, config, hojeLisboa(), feriados);
    const resumo = def.resumo(e, config, null);
    const aprovar = avaliacao.proposta === 'aprovar';
    const taxa = avaliacao.taxa.total_cent;
    const comTaxa = aprovar && taxa > 0;

    const r = await this.db.transaction(async (tx) => {
      const municipeId =
        ctx.municipeId ??
        (await this.municipes.porTelefone(m.id, telefone, tx))?.id ??
        null;
      if (municipeId && e.nome) {
        await tx.query(
          'UPDATE municipes SET nome = coalesce(nome, $2) WHERE id = $1',
          [municipeId, e.nome],
        );
      }
      const tipoId = await this.tipoProcesso(tx, m.id, tipo);
      const ano = new Date().getFullYear();
      const numero = `${def.codigo} ${await proximoNumero(tx, m.id, def.codigo, ano)}/${ano}`;
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, conversa_origem_id,
           assunto, morada, fase, prazo_inicio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'apreciacao', $8) RETURNING id`,
        [
          m.id,
          numero,
          tipoId,
          municipeId,
          ctx.conversaId,
          resumo.assunto,
          e.morada,
          hojeLisboa(),
        ],
      );
      const falhadas = avaliacao.regras.filter((x) => !x.ok);
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados)
         VALUES ($1, 'criado', $2, 'agente', $3)`,
        [
          p.id,
          aprovar
            ? `Pedido de ${def.curto} verificado pelas regras: cumpre todas (${avaliacao.regras.length}). Proposta: aprovar.`
            : `Pedido de ${def.curto} verificado pelas regras: ${falhadas.length} por cumprir. Vai para um técnico.`,
          JSON.stringify({ avaliacao }),
        ],
      );
      const codigo = Array.from(
        { length: 10 },
        () => ALFABETO[randomInt(ALFABETO.length)],
      ).join('');
      const estado: EstadoLicenca = !aprovar
        ? 'para_tecnico'
        : comTaxa
          ? 'a_pagar'
          : 'por_aprovar';
      const [l] = await tx.query<{ id: string }>(
        `INSERT INTO licencas (municipio_id, processo_id, tipo, municipe_id, conversa_id, dados,
           avaliacao, config_usada, proposta, estado, taxa_cent, codigo_verificacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          m.id,
          p.id,
          tipo,
          municipeId,
          ctx.conversaId,
          JSON.stringify(e),
          JSON.stringify(avaliacao),
          JSON.stringify(config),
          avaliacao.proposta,
          estado,
          aprovar ? taxa : 0,
          codigo,
        ],
      );
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { licenca_id: l.id, numero, proposta: avaliacao.proposta, tipo },
        tx,
      );
      if (!aprovar && telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId,
            destino: telefone,
            motivo: 'processo',
            corpo: `${m.nome}: recebemos o pedido de ${def.curto} ${numero}. Precisa de ser visto por um técnico (${falhadas[0]?.texto ?? 'fora das regras'}). Damos resposta por SMS.`,
            relacionado: { processo_id: p.id, licenca_id: l.id },
            chave: `licenca_tecnico:${l.id}`,
          },
          tx,
        );
      }
      return { licencaId: l.id, processoId: p.id, numero };
    });

    let pagamento: Awaited<ReturnType<PagamentosService['criar']>> | null =
      null;
    if (comTaxa) {
      pagamento = await this.pagamentos.criar(
        ctx,
        {
          processo_id: r.processoId,
          metodo:
            e.metodo ??
            (telefone?.startsWith('+3519') ? 'mbway' : 'multibanco'),
        },
        { linhas: avaliacao.taxa.linhas, total_cent: taxa },
      );
    }

    const seguePorSms = `${def.feminino ? 'a' : 'o'} ${def.curto} segue por SMS, com um código QR.`;
    return {
      pedida: true,
      tipo,
      numero: r.numero,
      proposta: avaliacao.proposta,
      regras: avaliacao.regras.map((x) => `${x.ok ? '✓' : '✗'} ${x.texto}`),
      condicoes: avaliacao.condicoes,
      taxa: aprovar ? formatarEuros(taxa) : null,
      pagamento,
      regras_de_demonstracao: config.demonstracao,
      fonte: config.fonte.titulo,
      dizer: aprovar
        ? `Verifiquei as regras e o seu pedido cumpre todas. ` +
          (comTaxa
            ? `A taxa é de ${formatarEuros(taxa)}. ${pagamento?.dizer ?? ''} `
            : '') +
          (config.aprovacao === 'automatica'
            ? `Assim que estiver paga, ${seguePorSms}`
            : `Assim que estiver paga, um funcionário confirma e ${seguePorSms}`)
        : `O pedido ficou registado com o número ${r.numero}, mas não cabe nas regras automáticas: ${avaliacao.regras
            .filter((x) => !x.ok)
            .map((x) => x.texto)
            .join(
              ' ',
            )} Vai ser visto por um técnico e recebe a resposta por SMS.`,
    };
  }

  // ------------------------------------------------------------------
  // Depois do pagamento
  // ------------------------------------------------------------------

  /**
   * Licenças pagas passam a 'por_aprovar'; se a câmara deixou emitir
   * sozinho, ou se um técnico já aprovou antes do pagamento, emite-se.
   * Corre no job (a cada minuto) e antes de cada leitura do painel.
   */
  async sincronizar(municipioId?: string): Promise<number> {
    const pagas = await this.db.query<{
      id: string;
      municipio_id: string;
      automatica: boolean;
      decidida_por: string | null;
    }>(
      `SELECT l.id, l.municipio_id, (l.config_usada->>'aprovacao') = 'automatica' AS automatica,
              l.decidida_por
       FROM licencas l
       WHERE l.estado = 'a_pagar' AND ($1::uuid IS NULL OR l.municipio_id = $1)
         AND EXISTS (SELECT 1 FROM pagamentos pg WHERE pg.processo_id = l.processo_id AND pg.estado = 'pago')`,
      [municipioId ?? null],
    );
    for (const l of pagas) {
      await this.db.transaction(async (tx) => {
        const [mudou] = await tx.query<{ id: string }>(
          `UPDATE licencas SET estado = 'por_aprovar' WHERE id = $1 AND estado = 'a_pagar' RETURNING id`,
          [l.id],
        );
        if (!mudou) return;
        if (l.automatica || l.decidida_por) {
          await this.emitir(
            tx,
            l.id,
            l.decidida_por,
            l.decidida_por ? null : 'regras',
          );
        }
      });
    }
    return pagas.length;
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async listar(
    m: Municipio,
    filtro: { estado?: EstadoLicenca; tipo?: TipoLicenca } = {},
  ) {
    await this.sincronizar(m.id);
    const linhas = await this.db.query<Linha>(
      `${SELECT} WHERE l.municipio_id = $1 AND ($2::text IS NULL OR l.estado = $2)
         AND ($3::text IS NULL OR l.tipo = $3)
       ORDER BY CASE l.estado WHEN 'por_aprovar' THEN 0 WHEN 'para_tecnico' THEN 1
                  WHEN 'a_pagar' THEN 2 ELSE 3 END, l.criada_em DESC
       LIMIT 100`,
      [m.id, filtro.estado ?? null, filtro.tipo ?? null],
    );
    const [contagens] = await this.db.query<Record<EstadoLicenca, number>>(
      `SELECT count(*) FILTER (WHERE estado = 'a_pagar')::int AS a_pagar,
              count(*) FILTER (WHERE estado = 'por_aprovar')::int AS por_aprovar,
              count(*) FILTER (WHERE estado = 'para_tecnico')::int AS para_tecnico,
              count(*) FILTER (WHERE estado = 'emitida')::int AS emitida,
              count(*) FILTER (WHERE estado = 'recusada')::int AS recusada
       FROM licencas WHERE municipio_id = $1 AND ($2::text IS NULL OR tipo = $2)`,
      [m.id, filtro.tipo ?? null],
    );
    return {
      licencas: linhas.map((l) => this.paraPainel(l)),
      contagens,
      config: await this.configRuido(m.id),
      tipos: await this.tipos(m),
    };
  }

  async detalhe(m: Municipio, id: string) {
    await this.sincronizar(m.id);
    return this.paraPainel(await this.porId(this.db, m.id, id));
  }

  /**
   * "Aprovar e emitir": por aprovar → emitida (SMS com a licença). Para
   * técnico → o técnico aprova; se houver taxa, falta pagar e emite-se
   * quando chegar o pagamento.
   */
  async aprovar(m: Municipio, u: UtilizadorPainel, id: string) {
    const r = await this.db.transaction(async (tx) => {
      const l = await this.porId(tx, m.id, id, true);
      if (l.estado === 'por_aprovar') {
        await this.emitir(tx, l.id, u.id, null);
        return { estado: 'emitida' as const, criarPagamento: false, l };
      }
      if (l.estado !== 'para_tecnico') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          l.estado === 'a_pagar'
            ? 'A taxa ainda não está paga.'
            : 'Esta licença já foi decidida.',
        );
      }
      const taxa = taxaDe(l).total_cent;
      await tx.query(
        `UPDATE licencas SET decidida_por = $2, decidida_em = now(), taxa_cent = $3,
           estado = CASE WHEN $3 > 0 THEN 'a_pagar' ELSE estado END
         WHERE id = $1`,
        [l.id, u.id, taxa],
      );
      await this.evento(
        tx,
        l.processo_id,
        u.id,
        'O técnico aprovou o pedido fora das regras automáticas.',
      );
      if (taxa <= 0) {
        await this.emitir(tx, l.id, u.id, null);
        return { estado: 'emitida' as const, criarPagamento: false, l };
      }
      return { estado: 'a_pagar' as const, criarPagamento: true, l };
    });
    if (r.criarPagamento) {
      const ctx: ContextoFerramenta = {
        municipio: m,
        canal: 'telefone',
        conversaId: r.l.conversa_id,
        municipeId: r.l.municipe_id,
        telefone: r.l.telefone,
      };
      await this.pagamentos.criar(
        ctx,
        { processo_id: r.l.processo_id, metodo: 'multibanco' },
        taxaDe(r.l),
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'aprovar_licenca',
      objetoTipo: 'licenca',
      objetoId: id,
    });
    return this.detalhe(m, id);
  }

  async recusar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaRecusar>,
  ) {
    await this.db.transaction(async (tx) => {
      const l = await this.porId(tx, m.id, id, true);
      if (l.estado === 'emitida' || l.estado === 'recusada') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'Esta licença já foi decidida.',
        );
      }
      await tx.query(
        `UPDATE licencas SET estado = 'recusada', decidida_por = $2, decidida_em = now(),
           motivo_recusa = $3 WHERE id = $1`,
        [l.id, u.id, d.motivo],
      );
      await tx.query(
        `UPDATE processos SET fase = 'notificado', decisao = 'indeferido', decidido_em = now(),
           atualizado_em = now() WHERE id = $1`,
        [l.processo_id],
      );
      await tx.query(
        `UPDATE pagamentos SET estado = 'cancelado' WHERE processo_id = $1 AND estado = 'pendente'`,
        [l.processo_id],
      );
      await this.evento(
        tx,
        l.processo_id,
        u.id,
        `Licença recusada: ${d.motivo}`,
      );
      if (l.telefone) {
        const def = DEFS[l.tipo];
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: l.municipe_id,
            destino: l.telefone,
            motivo: 'processo',
            corpo: `${m.nome}: ${def.feminino ? 'a' : 'o'} ${def.curto} ${l.numero} não foi ${def.feminino ? 'concedida' : 'concedido'}. ${d.motivo}`,
            relacionado: { processo_id: l.processo_id, licenca_id: l.id },
            chave: `licenca_recusada:${l.id}`,
          },
          tx,
        );
      }
    });
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'recusar_licenca',
      objetoTipo: 'licenca',
      objetoId: id,
    });
    return this.detalhe(m, id);
  }

  // ------------------------------------------------------------------
  // Público (a página do QR)
  // ------------------------------------------------------------------

  async publico(codigo: string) {
    const l = await this.porCodigo(codigo);
    const municipio = await this.municipios.porId(l.municipio_id);
    const def = DEFS[l.tipo];
    const r = this.resumoDe(l);
    const hoje = hojeLisboa();
    const emitida = l.estado === 'emitida';
    return {
      tipo: l.tipo,
      titulo: def.nome,
      feminino: def.feminino,
      numero: l.numero,
      municipio: municipio.nome,
      estado: l.estado,
      valida: emitida && (r.valida_ate === null || r.valida_ate >= hoje),
      expirada: emitida && r.valida_ate !== null && r.valida_ate < hoje,
      valida_ate: emitida ? r.valida_ate : null,
      titular: abreviarNome(l.titular),
      atividade: r.atividade,
      descricao: r.descricao,
      morada: r.morada,
      rotulo_dia: r.rotulo_dia,
      dia: r.dia,
      horario: r.horario,
      detalhes: r.detalhes,
      condicoes: l.avaliacao.condicoes,
      emitida_em: emitida ? (l.decidida_em?.toISOString() ?? null) : null,
      fonte: l.config_usada.fonte.titulo,
      modo_teste: l.pagamento?.modo_teste ?? true,
      regras_de_demonstracao: l.config_usada.demonstracao,
      pdf: emitida,
    };
  }

  async pdf(codigo: string): Promise<{ nome: string; pdf: Buffer }> {
    const l = await this.porCodigo(codigo);
    if (l.estado !== 'emitida' || !l.decidida_em) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'licenca_por_emitir',
        'Esta licença ainda não foi emitida.',
      );
    }
    const municipio = await this.municipios.porId(l.municipio_id);
    const def = DEFS[l.tipo];
    const r = this.resumoDe(l);
    const pdf = await gerarPdfLicenca({
      municipio: `Câmara Municipal de ${municipio.nome}`,
      numero: l.numero,
      titulo: def.nome,
      titular: l.titular,
      atividade:
        l.tipo === 'ruido' ? `${r.atividade}: ${r.descricao}` : r.atividade,
      morada: r.morada,
      rotuloDia: r.rotulo_dia,
      dia: r.dia,
      horario: r.horario ? `das ${r.horario}` : null,
      detalhes: r.detalhes,
      condicoes: l.avaliacao.condicoes,
      fonte: l.config_usada.fonte.titulo,
      emitida: {
        por: l.decidida_por_nome ?? 'regras automáticas da câmara',
        em: l.decidida_em,
      },
      urlVerificacao: this.urlVerificacao(l.codigo_verificacao),
      codigo: l.codigo_verificacao,
      modoTeste: l.pagamento?.modo_teste ?? true,
      regrasDemonstracao: l.config_usada.demonstracao,
    });
    return { nome: `licenca-${l.numero.replace(/\W+/g, '-')}.pdf`, pdf };
  }

  // ------------------------------------------------------------------

  private resumoDe(l: Linha) {
    const emitida =
      l.estado === 'emitida' && l.decidida_em
        ? hojeLisboa(l.decidida_em)
        : null;
    return DEFS[l.tipo].resumo(l.dados, l.config_usada, emitida);
  }

  private async emitir(
    tx: Tx,
    id: string,
    utilizadorId: string | null,
    origem: 'regras' | null,
  ) {
    const [l] = await tx.query<{
      processo_id: string;
      municipio_id: string;
      municipe_id: string | null;
      codigo_verificacao: string;
      numero: string;
      telefone: string | null;
      tipo: TipoLicenca;
      data: string | null;
    }>(
      `UPDATE licencas l SET estado = 'emitida', decidida_em = coalesce(l.decidida_em, now()),
         decidida_por = coalesce(l.decidida_por, $2)
       FROM processos p
       WHERE l.id = $1 AND p.id = l.processo_id
       RETURNING l.processo_id, l.municipio_id, l.municipe_id, l.codigo_verificacao, p.numero,
         (SELECT telefone_e164 FROM municipes WHERE id = l.municipe_id) AS telefone,
         l.tipo, l.dados->>'data' AS data`,
      [id, utilizadorId],
    );
    await tx.query(
      `UPDATE processos SET fase = 'notificado', decisao = 'admitido', decidido_em = now(),
         atualizado_em = now() WHERE id = $1`,
      [l.processo_id],
    );
    const def = DEFS[l.tipo];
    await this.evento(
      tx,
      l.processo_id,
      utilizadorId,
      origem === 'regras'
        ? `${def.nome} ${def.feminino ? 'emitida' : 'emitido'} automaticamente depois do pagamento (regras da câmara).`
        : `${def.nome} ${def.feminino ? 'aprovada e emitida' : 'aprovado e emitido'}.`,
    );
    if (l.telefone) {
      const municipio = await this.municipios.porId(l.municipio_id);
      const para = l.data ? ` para ${diaCurto(l.data)}` : '';
      await this.mensagens.sms(
        {
          municipioId: l.municipio_id,
          municipeId: l.municipe_id,
          destino: l.telefone,
          motivo: 'processo',
          corpo: `${municipio.nome}: ${def.feminino ? 'a sua' : 'o seu'} ${def.curto} ${l.numero}${para} está ${def.feminino ? 'emitida' : 'emitido'}. Documento e QR: ${this.urlVerificacao(l.codigo_verificacao)}`,
          relacionado: { processo_id: l.processo_id, licenca_id: id },
          chave: `licenca_emitida:${id}`,
        },
        tx,
      );
    }
  }

  private async evento(
    tx: Tx,
    processoId: string,
    utilizadorId: string | null,
    descricao: string,
  ) {
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id)
       VALUES ($1, 'decisao', $2, $3, $4)`,
      [
        processoId,
        descricao,
        utilizadorId ? 'utilizador' : 'sistema',
        utilizadorId,
      ],
    );
  }

  private urlVerificacao(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/licenca/${codigo}`;
  }

  /** O tipo de processo do município para este tipo de licença (cria-o na primeira). */
  private async tipoProcesso(
    tx: Tx,
    municipioId: string,
    tipo: TipoLicenca,
  ): Promise<string> {
    const def = DEFS[tipo];
    const [t] = await tx.query<{ id: string }>(
      `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, formulario, frase_do_agente)
       VALUES ($1, $2, $3, $4, '[]',
         'Verifico as regras durante a chamada; se cumprir, paga a taxa e a licença chega por SMS.')
       ON CONFLICT (municipio_id, codigo) DO UPDATE SET codigo = EXCLUDED.codigo
       RETURNING id`,
      [municipioId, def.codigo, def.nome, def.prazo_dias_uteis],
    );
    return t.id;
  }

  private async porId(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    id: string,
    bloquear = false,
  ): Promise<Linha> {
    if (bloquear) {
      await q.query('SELECT 1 FROM licencas WHERE id = $1 FOR UPDATE', [id]);
    }
    const [l] = await q.query<Linha>(
      `${SELECT} WHERE l.id = $1 AND l.municipio_id = $2`,
      [id, municipioId],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'licenca_desconhecida',
        'Esta licença não existe.',
      );
    }
    return l;
  }

  private async porCodigo(codigo: string): Promise<Linha> {
    const c = codigo.trim().toUpperCase();
    const [l] = /^[A-Z0-9]{10}$/.test(c)
      ? await this.db.query<Linha>(
          `${SELECT} WHERE l.codigo_verificacao = $1`,
          [c],
        )
      : [];
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'licenca_desconhecida',
        'Não há nenhuma licença com este código.',
      );
    }
    return l;
  }

  private paraPainel(l: Linha) {
    const r = this.resumoDe(l);
    return {
      id: l.id,
      numero: l.numero,
      processo_id: l.processo_id,
      tipo: l.tipo,
      tipo_nome: DEFS[l.tipo].nome,
      estado: l.estado,
      proposta: l.proposta,
      dados: {
        ...l.dados,
        // Compatível com o ecrã antigo (ruído).
        atividade_texto:
          l.tipo === 'ruido'
            ? ATIVIDADES[l.dados.atividade as Atividade]
            : r.atividade,
      },
      resumo: r,
      dia: l.tipo === 'ruido' ? diaPorExtenso(l.dados.data as string) : r.dia,
      avaliacao: l.avaliacao,
      config_usada: l.config_usada,
      taxa_cent: l.taxa_cent,
      taxa_se_aprovada_cent: taxaDe(l).total_cent,
      titular: l.titular,
      telefone: l.telefone,
      conversa_id: l.conversa_id,
      pagamento: l.pagamento,
      codigo_verificacao: l.estado === 'emitida' ? l.codigo_verificacao : null,
      decidida_por_nome: l.decidida_por_nome,
      decidida_em: l.decidida_em?.toISOString() ?? null,
      motivo_recusa: l.motivo_recusa,
      criada_em: l.criada_em.toISOString(),
    };
  }
}

export { esquemaConfigRuido };

/** A taxa da licença (as de ruído antigas não guardavam as linhas). */
function taxaDe(l: Linha): { linhas: LinhaTaxa[]; total_cent: number } {
  if (l.avaliacao.taxa) return l.avaliacao.taxa;
  const v = l.config_usada.taxa_cent ?? 0;
  return {
    linhas:
      v > 0
        ? [
            {
              codigo: DEFS[l.tipo].codigo,
              descricao: DEFS[l.tipo].nome,
              unidade: 'fixo',
              quantidade: 1,
              valor_unitario_cent: v,
              valor_cent: v,
            },
          ]
        : [],
    total_cent: v,
  };
}

/** "Maria Silva" → "Maria S." (a página do QR é pública). */
function abreviarNome(nome: string | null): string | null {
  if (!nome) return null;
  const p = nome.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
}
