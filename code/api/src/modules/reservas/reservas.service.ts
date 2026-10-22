import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  diaLocal,
  diasSeguintes,
  type Horario,
  horaLocal,
  instanteLocal,
  type Intervalo,
} from '../marcacoes/vagas.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import { formatarEuros } from '../pagamentos/taxas.js';
import { EQUIPAMENTOS_DEMO, SESSOES_DEMO } from './demonstracao.js';
import {
  avaliarBilhetes,
  avaliarReserva,
  escolher,
  estadoDepoisDeAprovar,
  estadoInicial,
  type EstadoReserva,
  faixasLivres,
  horasLivres,
  NOMES_TIPO,
  podeCancelar,
  REGRAS_RESERVAS,
  type TipoEquipamento,
} from './regras.js';

// ---------------------------------------------------------------------------
// Entradas das ações do catálogo
// ---------------------------------------------------------------------------

const confirmado = z
  .boolean()
  .optional()
  .describe('Só depois de a pessoa dizer que sim ao resumo.');
const metodo = z
  .enum(['mbway', 'multibanco'])
  .optional()
  .describe(
    'Se houver preço: MB WAY ou referência Multibanco (por omissão MB WAY no telemóvel).',
  );
const nome = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .describe('Nome de quem reserva.');

export const entradaDisponibilidade = z.object({
  equipamento: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Que equipamento (pavilhão, piscina, auditório, sala, campo…).'),
  dia: z.iso.date().optional().describe('Para que dia, AAAA-MM-DD.'),
});

export const entradaReservar = z.object({
  equipamento: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .describe('Que equipamento quer reservar.'),
  dia: z.iso.date().describe('O dia, AAAA-MM-DD.'),
  hora_inicio: z
    .string()
    .trim()
    .min(1)
    .max(5)
    .describe('A que horas começa, HH:MM.'),
  duracao_horas: z
    .number()
    .min(0.5)
    .max(12)
    .optional()
    .describe('Quantas horas (por omissão 1).'),
  finalidade: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      'Para quê (ex.: jogo de futsal entre amigos, reunião da associação).',
    ),
  nome,
  metodo,
  confirmado,
});

export const entradaCancelar = z.object({
  codigo: z
    .string()
    .trim()
    .max(20)
    .optional()
    .describe(
      'O código da reserva ou do bilhete (vem no SMS); sem ele, a última da pessoa.',
    ),
  confirmado,
});

export const entradaEventos = z.object({
  evento: z
    .string()
    .trim()
    .max(140)
    .optional()
    .describe('Que evento (nome ou parte).'),
});

export const entradaBilhete = z.object({
  evento: z.string().trim().min(3).max(140).describe('Para que evento.'),
  quantidade: z.number().int().min(1).max(50).describe('Quantos bilhetes.'),
  nome,
  metodo,
  confirmado,
});

export const entradaMinhas = z.object({});

const hora = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/,
    'Faixa como 09:00-13:00.',
  );
export const esquemaHorario = z
  .object({
    seg: z.array(hora).max(4),
    ter: z.array(hora).max(4),
    qua: z.array(hora).max(4),
    qui: z.array(hora).max(4),
    sex: z.array(hora).max(4),
    sab: z.array(hora).max(4),
    dom: z.array(hora).max(4),
  })
  .partial();

export const esquemaEquipamento = z.object({
  nome: z.string().trim().min(3).max(140),
  tipo: z.enum(['pavilhao', 'piscina', 'auditorio', 'sala', 'campo']),
  morada: z.string().trim().min(3).max(300),
  descricao: z.string().trim().max(1000).nullable().optional(),
  lotacao: z.number().int().min(1).max(100_000).nullable().optional(),
  horario: esquemaHorario,
  duracao_slot_min: z
    .union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)])
    .default(60),
  duracao_max_horas: z.number().int().min(1).max(12).default(3),
  antecedencia_horas: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(24),
  preco_hora_cent: z.number().int().min(0).max(1_000_000).default(0),
  entrada_cent: z.number().int().min(0).max(100_000).nullable().optional(),
  notas: z.string().trim().max(1000).nullable().optional(),
  aprovacao: z.enum(['automatica', 'funcionario']).default('automatica'),
  ativo: z.boolean().default(true),
});

export const esquemaRecusarReserva = z.object({
  motivo: z.string().trim().min(5).max(500),
});

export const esquemaFiltroReservas = z.object({
  equipamento_id: z.uuid().optional(),
  estado: z
    .enum(['por_aprovar', 'por_pagar', 'confirmada', 'recusada', 'cancelada'])
    .optional(),
  de: z.iso.date().optional(),
  ate: z.iso.date().optional(),
});

// ---------------------------------------------------------------------------

export interface Equipamento {
  id: string;
  municipio_id: string;
  chave: string | null;
  nome: string;
  tipo: TipoEquipamento;
  morada: string;
  descricao: string | null;
  lotacao: number | null;
  horario: Horario;
  duracao_slot_min: number;
  duracao_max_horas: number;
  antecedencia_horas: number;
  preco_hora_cent: number;
  entrada_cent: number | null;
  notas: string | null;
  aprovacao: 'automatica' | 'funcionario';
  ativo: boolean;
  demonstracao: boolean;
}

const COLUNAS_EQUIP = `id, municipio_id, chave, nome, tipo, morada, descricao, lotacao, horario,
  duracao_slot_min, duracao_max_horas, antecedencia_horas, preco_hora_cent, entrada_cent, notas,
  aprovacao, ativo, demonstracao`;

interface Sessao {
  id: string;
  titulo: string;
  local: string;
  inicio: Date;
  fim: Date | null;
  lotacao: number;
  preco_cent: number;
  max_por_pessoa: number;
  ativo: boolean;
  demonstracao: boolean;
  evento_id: string | null;
  ocupados: number;
}

const SELECT_SESSOES = `SELECT s.id, s.titulo, s.local, s.inicio, s.fim, s.lotacao, s.preco_cent,
    s.max_por_pessoa, s.ativo, s.demonstracao, s.evento_id,
    coalesce((SELECT sum(r.quantidade) FROM reservas r WHERE r.sessao_id = s.id
      AND r.estado IN ('por_aprovar','por_pagar','confirmada')), 0)::int AS ocupados
  FROM reserva_sessoes s`;

interface Reserva {
  id: string;
  municipio_id: string;
  tipo: 'equipamento' | 'bilhete';
  codigo: string;
  equipamento_id: string | null;
  sessao_id: string | null;
  inicio: Date;
  fim: Date | null;
  quantidade: number;
  finalidade: string | null;
  nome: string | null;
  telefone: string | null;
  municipe_id: string | null;
  conversa_id: string | null;
  canal: string;
  valor_cent: number;
  estado: EstadoReserva;
  processo_id: string | null;
  motivo_recusa: string | null;
  decidida_por_nome: string | null;
  decidida_em: Date | null;
  criada_em: Date;
  demonstracao: boolean;
  titulo: string;
  local: string;
  pagamento: {
    id: string;
    estado: string;
    metodo: string | null;
    valor_cent: number;
    modo_teste: boolean;
    mb_entidade: string | null;
    mb_referencia: string | null;
    pagar_ate: string | null;
    link: string | null;
  } | null;
}

const SELECT_RESERVAS = `
  SELECT r.id, r.municipio_id, r.tipo, r.codigo, r.equipamento_id, r.sessao_id,
         coalesce(lower(r.periodo), s.inicio) AS inicio, coalesce(upper(r.periodo), s.fim) AS fim,
         r.quantidade, r.finalidade, r.nome, r.telefone, r.municipe_id, r.conversa_id, r.canal,
         r.valor_cent, r.estado, r.processo_id, r.motivo_recusa, u.nome AS decidida_por_nome,
         r.decidida_em, r.criada_em, r.demonstracao,
         coalesce(e.nome, s.titulo) AS titulo, coalesce(e.morada, s.local) AS local,
         (SELECT jsonb_build_object('id', pg.id, 'estado', pg.estado, 'metodo', pg.metodo,
                   'valor_cent', pg.valor_cent, 'modo_teste', pg.modo_teste,
                   'mb_entidade', pg.mb_entidade, 'mb_referencia', pg.mb_referencia,
                   'pagar_ate', to_char(pg.pagar_ate, 'YYYY-MM-DD'),
                   'link', (SELECT lc.codigo FROM links_curtos lc
                            WHERE lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
                            ORDER BY lc.expira_em DESC LIMIT 1))
          FROM pagamentos pg WHERE r.processo_id IS NOT NULL AND pg.processo_id = r.processo_id
          ORDER BY (pg.estado = 'pago') DESC, pg.criado_em DESC LIMIT 1) AS pagamento
  FROM reservas r
  LEFT JOIN reserva_equipamentos e ON e.id = r.equipamento_id
  LEFT JOIN reserva_sessoes s ON s.id = r.sessao_id
  LEFT JOIN utilizadores u ON u.id = r.decidida_por`;

const ATIVAS = `('por_aprovar','por_pagar','confirmada')`;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODIGO_PROCESSO = 'RES';

function novoCodigo(): string {
  return Array.from(
    { length: 10 },
    () => ALFABETO[randomInt(ALFABETO.length)],
  ).join('');
}

/** '2026-11-03' → 'terça-feira, 3 de novembro'. */
function diaDito(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-PT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function horaDita(hhmm: string): string {
  return hhmm.endsWith(':00')
    ? `${Number(hhmm.slice(0, 2))}h`
    : hhmm.replace(':', 'h');
}

const FRASE_ESTADO: Record<EstadoReserva, string> = {
  por_aprovar: 'à espera de aprovação',
  por_pagar: 'à espera do pagamento',
  confirmada: 'confirmada',
  recusada: 'recusada',
  cancelada: 'cancelada',
};

/**
 * Reservas (V4 #4): equipamentos municipais (horários, preços, aprovação),
 * bilhetes para sessões com lugares limitados, pagamento em modo de teste e
 * a página /reserva/{codigo} com QR.
 */
@Injectable()
export class ReservasService {
  private readonly logger = new Logger(ReservasService.name);

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

  url(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/reserva/${codigo}`;
  }

  private identificacao(ctx: ContextoFerramenta, acao: string) {
    if (ctx.municipeId || normalizarTelefone(ctx.telefone)) return null;
    return {
      feito: false,
      motivo: 'precisa_identificacao',
      instrucao:
        ctx.canal === 'chat'
          ? `Para ${acao} a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.`
          : 'Não há um número para onde mandar a confirmação. Pede o número de telemóvel e usa identificar_municipe, ou passa a um funcionário.',
    };
  }

  private async municipeDe(ctx: ContextoFerramenta, tx: Tx) {
    if (ctx.municipeId) {
      const [mu] = await tx.query<{ id: string; telefone: string | null }>(
        'SELECT id, telefone_e164 AS telefone FROM municipes WHERE id = $1',
        [ctx.municipeId],
      );
      if (mu) return mu;
    }
    const mu = await this.municipes.porTelefone(
      ctx.municipio.id,
      ctx.telefone,
      tx,
    );
    return mu
      ? { id: mu.id, telefone: normalizarTelefone(ctx.telefone) }
      : null;
  }

  // -------------------------------------------------------------------
  // Equipamentos e disponibilidade
  // -------------------------------------------------------------------

  private equipamentos(
    municipioId: string,
    soAtivos = true,
  ): Promise<Equipamento[]> {
    return this.db.query<Equipamento>(
      `SELECT ${COLUNAS_EQUIP} FROM reserva_equipamentos
       WHERE municipio_id = $1 AND ($2::boolean IS FALSE OR ativo)
       ORDER BY tipo, nome`,
      [municipioId, soAtivos],
    );
  }

  private async ocupados(
    q: Pick<Tx, 'query'>,
    equipamentoId: string,
    de: Date,
    ate: Date,
  ): Promise<Intervalo[]> {
    return q.query<Intervalo>(
      `SELECT lower(periodo) AS inicio, upper(periodo) AS fim FROM reservas
       WHERE equipamento_id = $1 AND estado IN ${ATIVAS}
         AND periodo && tstzrange($2, $3)`,
      [equipamentoId, de, ate],
    );
  }

  private infoEquipamento(e: Equipamento) {
    return {
      nome: e.nome,
      tipo: NOMES_TIPO[e.tipo],
      morada: e.morada,
      preco_hora: e.preco_hora_cent
        ? formatarEuros(e.preco_hora_cent)
        : 'gratuito',
      ...(e.entrada_cent !== null
        ? { entrada: formatarEuros(e.entrada_cent) }
        : {}),
      aprovacao:
        e.aprovacao === 'funcionario'
          ? 'um funcionário aprova'
          : 'confirmada na hora',
      duracao_maxima_horas: e.duracao_max_horas,
      antecedencia_horas: e.antecedencia_horas,
      ...(e.notas ? { notas: e.notas } : {}),
    };
  }

  private naoEncontrado(
    tipo: 'equipamento' | 'evento',
    lista: { nome: string }[],
    texto?: string,
  ) {
    return {
      encontrado: false,
      opcoes: lista.map((x) => x.nome),
      dizer:
        `Não encontro ${tipo === 'equipamento' ? 'esse equipamento' : 'esse evento'}${texto ? ` (${texto})` : ''}. ${
          lista.length ? `Tenho: ${lista.map((x) => x.nome).join('; ')}.` : ''
        }`.trim(),
    };
  }

  private escolherVarios(lista: { nome: string }[]) {
    return {
      precisa_escolher: true,
      opcoes: lista.map((x) => x.nome),
      dizer: `Qual destes? ${lista.map((x) => x.nome).join('; ')}.`,
    };
  }

  async verDisponibilidade(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaDisponibilidade>,
  ) {
    const m = ctx.municipio;
    const lista = await this.equipamentos(m.id);
    if (!lista.length) {
      return {
        encontrado: false,
        dizer: 'Ainda não há equipamentos para reservar por aqui.',
      };
    }
    const demonstracao = lista.some((x) => x.demonstracao);
    if (!e.equipamento) {
      return {
        encontrado: true,
        equipamentos: lista.map((x) => this.infoEquipamento(x)),
        valores_de_demonstracao: demonstracao,
        dizer: `Pode reservar: ${lista
          .map(
            (x) =>
              `${x.nome} (${x.preco_hora_cent ? `${formatarEuros(x.preco_hora_cent)} por hora` : 'gratuito'})`,
          )
          .join('; ')}. Qual lhe interessa e para que dia?`,
      };
    }
    const esc = escolher(lista, e.equipamento);
    if (esc.tipo === 'nenhum')
      return this.naoEncontrado('equipamento', lista, e.equipamento);
    if (esc.tipo === 'varios') return this.escolherVarios(esc.itens);
    const eq = esc.item;
    const agora = new Date();
    const hoje = diaLocal(agora, m.fuso);
    const feriados = await this.municipios.feriados(m.id);
    const dias = e.dia ? [e.dia] : diasSeguintes(hoje, 10);
    const livres: { dia: string; horas: string[] }[] = [];
    for (const dia of dias) {
      const de = instanteLocal(dia, '00:00', m.fuso);
      const ate = new Date(de.getTime() + 26 * 3_600_000);
      const horas = horasLivres(eq, dia, {
        fuso: m.fuso,
        feriados,
        agora,
        ocupados: await this.ocupados(this.db, eq.id, de, ate),
      });
      if (horas.length) livres.push({ dia, horas });
      if (!e.dia && livres.length >= 3) break;
    }
    const info = this.infoEquipamento(eq);
    const preco = eq.preco_hora_cent
      ? `Custa ${formatarEuros(eq.preco_hora_cent)} por hora`
      : 'É gratuito';
    const extra = [
      eq.entrada_cent !== null
        ? `A entrada custa ${formatarEuros(eq.entrada_cent)}.`
        : '',
      eq.notas ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    let dizer: string;
    if (e.dia && !livres.length) {
      dizer = `O ${eq.nome} não tem horas livres para reservar em ${diaDito(e.dia)}. Quer outro dia?`;
    } else if (!livres.length) {
      dizer = `O ${eq.nome} não tem horas livres nos próximos dias.`;
    } else {
      dizer =
        `${eq.nome}: ` +
        livres
          .map(
            (l) =>
              `${diaDito(l.dia)}, livre ${faixasLivres(l.horas, eq.duracao_slot_min)}`,
          )
          .join('; ') +
        `. ${preco}${eq.aprovacao === 'funcionario' ? ' e a reserva é aprovada por um funcionário' : ''}.`;
    }
    return {
      encontrado: true,
      equipamento: info,
      livres: livres.map((l) => ({ dia: l.dia, horas: l.horas })),
      valores_de_demonstracao: eq.demonstracao,
      dizer: extra ? `${dizer} ${extra}` : dizer,
    };
  }

  // -------------------------------------------------------------------
  // Reservar
  // -------------------------------------------------------------------

  private async processo(
    tx: Tx,
    m: Municipio,
    o: {
      municipeId: string | null;
      conversaId: string | null;
      assunto: string;
      morada: string;
      reservaId: string;
    },
  ): Promise<string> {
    const [t] = await tx.query<{ id: string }>(
      `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, formulario, frase_do_agente)
       VALUES ($1, $2, 'Reserva de equipamento ou bilhete', 5, '[]',
         'Vejo a disponibilidade, reservo e o pagamento (se houver) segue por SMS.')
       ON CONFLICT (municipio_id, codigo) DO UPDATE SET codigo = EXCLUDED.codigo
       RETURNING id`,
      [m.id, CODIGO_PROCESSO],
    );
    const ano = new Date().getFullYear();
    const numero = `${CODIGO_PROCESSO} ${await proximoNumero(tx, m.id, CODIGO_PROCESSO, ano)}/${ano}`;
    const [p] = await tx.query<{ id: string }>(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, conversa_origem_id,
         assunto, morada, fase, prazo_inicio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'decisao', $8) RETURNING id`,
      [
        m.id,
        numero,
        t.id,
        o.municipeId,
        o.conversaId,
        o.assunto,
        o.morada,
        diaLocal(new Date(), m.fuso),
      ],
    );
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados)
       VALUES ($1, 'criado', $2, 'agente', $3)`,
      [p.id, o.assunto, JSON.stringify({ reserva_id: o.reservaId })],
    );
    await tx.query('UPDATE reservas SET processo_id = $2 WHERE id = $1', [
      o.reservaId,
      p.id,
    ]);
    return p.id;
  }

  /** Cria o pagamento de teste (o SMS da referência vai pelo módulo de pagamentos). */
  private async cobrar(
    ctx: ContextoFerramenta,
    processoId: string,
    valorCent: number,
    descricao: string,
    metodoPedido: 'mbway' | 'multibanco' | undefined,
    telefone: string | null,
  ) {
    return this.pagamentos.criar(
      ctx,
      {
        processo_id: processoId,
        metodo:
          metodoPedido ??
          (telefone?.startsWith('+3519') ? 'mbway' : 'multibanco'),
      },
      {
        linhas: [
          {
            codigo: 'RESERVA',
            descricao,
            unidade: 'fixo',
            quantidade: 1,
            valor_unitario_cent: valorCent,
            valor_cent: valorCent,
          },
        ],
        total_cent: valorCent,
      },
    );
  }

  private async smsReserva(
    tx: Tx,
    m: Municipio,
    r: {
      id: string;
      codigo: string;
      municipeId: string | null;
      telefone: string | null;
      conversaId: string | null;
    },
    corpo: string,
    chave: string,
  ) {
    if (!r.telefone) return false;
    await this.mensagens.sms(
      {
        municipioId: m.id,
        municipeId: r.municipeId,
        destino: r.telefone,
        motivo: 'marcacao',
        corpo: `${m.nome}: ${corpo} ${this.url(r.codigo)}`,
        relacionado: {
          reserva_id: r.id,
          ...(r.conversaId ? { conversa_id: r.conversaId } : {}),
        },
        chave,
      },
      tx,
    );
    return true;
  }

  async reservar(ctx: ContextoFerramenta, e: z.output<typeof entradaReservar>) {
    const falta = this.identificacao(ctx, 'reservar');
    if (falta) return falta;
    const m = ctx.municipio;
    const lista = await this.equipamentos(m.id);
    const esc = escolher(lista, e.equipamento);
    if (esc.tipo === 'nenhum')
      return this.naoEncontrado('equipamento', lista, e.equipamento);
    if (esc.tipo === 'varios') return this.escolherVarios(esc.itens);
    const eq = esc.item;
    const feriados = await this.municipios.feriados(m.id);
    const agora = new Date();
    const de = instanteLocal(e.dia, '00:00', m.fuso);
    const ate = new Date(de.getTime() + 26 * 3_600_000);
    const pedido = {
      dia: e.dia,
      hora_inicio: e.hora_inicio,
      duracao_horas: e.duracao_horas ?? 1,
      fuso: m.fuso,
      feriados,
      agora,
    };
    const av = avaliarReserva(eq, {
      ...pedido,
      ocupados: await this.ocupados(this.db, eq.id, de, ate),
    });
    if (!av.ok) {
      const livres = horasLivres(eq, e.dia, {
        fuso: m.fuso,
        feriados,
        agora,
        ocupados: await this.ocupados(this.db, eq.id, de, ate),
      });
      return {
        feito: false,
        motivo: av.motivo,
        ...(livres.length ? { horas_livres_nesse_dia: livres } : {}),
        dizer:
          `${av.texto}` +
          (livres.length
            ? ` Nesse dia o ${eq.nome} está livre ${faixasLivres(livres, eq.duracao_slot_min)}.`
            : ' Quer ver outro dia?'),
      };
    }
    const hIni = horaLocal(av.inicio, m.fuso);
    const hFim = horaLocal(av.fim, m.fuso);
    const estado = estadoInicial(eq.aprovacao, av.valor_cent);
    const preco = av.valor_cent ? formatarEuros(av.valor_cent) : 'gratuito';
    if (!e.confirmado) {
      return {
        feito: false,
        confirmar: true,
        resumo: {
          equipamento: eq.nome,
          dia: e.dia,
          das: hIni,
          as: hFim,
          finalidade: e.finalidade,
          nome: e.nome,
          valor: preco,
          aprovacao: eq.aprovacao,
        },
        valores_de_demonstracao: eq.demonstracao,
        ler_a_pessoa:
          `Reservo o ${eq.nome} para ${diaDito(e.dia)}, das ${horaDita(hIni)} às ${horaDita(hFim)}, em nome de ${e.nome}, para ${e.finalidade}. ` +
          (av.valor_cent ? `Custa ${preco}. ` : 'É gratuito. ') +
          (eq.aprovacao === 'funcionario'
            ? 'Fica a aguardar aprovação de um funcionário. '
            : '') +
          'Confirma?',
      };
    }
    let r: {
      id: string;
      codigo: string;
      telefone: string | null;
      municipeId: string | null;
      processoId: string | null;
      sms: boolean;
    };
    try {
      r = await this.db.transaction(async (tx) => {
        const mu = await this.municipeDe(ctx, tx);
        const telefone =
          normalizarTelefone(ctx.telefone) ?? mu?.telefone ?? null;
        const codigo = novoCodigo();
        const [nova] = await tx.query<{ id: string }>(
          `INSERT INTO reservas (municipio_id, tipo, codigo, equipamento_id, periodo, finalidade, nome,
             telefone, municipe_id, conversa_id, canal, valor_cent, estado, demonstracao)
           VALUES ($1, 'equipamento', $2, $3, tstzrange($4, $5), $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            m.id,
            codigo,
            eq.id,
            av.inicio,
            av.fim,
            e.finalidade,
            e.nome,
            telefone,
            mu?.id ?? null,
            ctx.conversaId,
            ctx.canal,
            av.valor_cent,
            estado,
            eq.demonstracao,
          ],
        );
        if (mu?.id) {
          await tx.query(
            'UPDATE municipes SET nome = coalesce(nome, $2) WHERE id = $1',
            [mu.id, e.nome],
          );
        }
        const processoId =
          estado === 'por_pagar'
            ? await this.processo(tx, m, {
                municipeId: mu?.id ?? null,
                conversaId: ctx.conversaId,
                assunto: `Reserva do ${eq.nome} (${e.dia}, ${hIni}-${hFim})`,
                morada: eq.morada,
                reservaId: nova.id,
              })
            : null;
        const quando = `${diaDito(e.dia)}, ${hIni}-${hFim}`;
        const sms = await this.smsReserva(
          tx,
          m,
          {
            id: nova.id,
            codigo,
            municipeId: mu?.id ?? null,
            telefone,
            conversaId: ctx.conversaId,
          },
          estado === 'confirmada'
            ? `reserva do ${eq.nome} confirmada para ${quando}.`
            : estado === 'por_aprovar'
              ? `pedido de reserva do ${eq.nome} (${quando}) recebido; um funcionário confirma por SMS.`
              : `reserva do ${eq.nome} (${quando}) guardada até ao pagamento de ${preco} (modo de teste).`,
          `reserva:${nova.id}`,
        );
        await this.conversas.momento(
          ctx.conversaId,
          'marcacao',
          { reserva_id: nova.id, codigo, equipamento: eq.nome, estado },
          tx,
        );
        return {
          id: nova.id,
          codigo,
          telefone,
          municipeId: mu?.id ?? null,
          processoId,
          sms,
        };
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23P01') {
        return {
          feito: false,
          motivo: 'ocupado',
          dizer:
            'Essa hora acabou de ser reservada por outra pessoa. Quer outra hora?',
        };
      }
      throw err;
    }
    const pagamento = r.processoId
      ? await this.cobrar(
          ctx,
          r.processoId,
          av.valor_cent,
          `Reserva · ${eq.nome} (${e.dia}, ${hIni}-${hFim})`,
          e.metodo,
          r.telefone,
        )
      : null;
    return {
      feito: true,
      codigo: r.codigo,
      estado,
      equipamento: eq.nome,
      dia: e.dia,
      das: hIni,
      as: hFim,
      valor: preco,
      pagamento,
      link: this.url(r.codigo),
      valores_de_demonstracao: eq.demonstracao,
      dizer:
        (estado === 'confirmada'
          ? `Está reservado: ${eq.nome}, ${diaDito(e.dia)}, das ${horaDita(hIni)} às ${horaDita(hFim)}.`
          : estado === 'por_aprovar'
            ? `Fiz o pedido de reserva do ${eq.nome} para ${diaDito(e.dia)}, das ${horaDita(hIni)} às ${horaDita(hFim)}. Um funcionário aprova e recebe a resposta por SMS${av.valor_cent ? `, com o pagamento de ${preco}` : ''}.`
            : `Guardei o ${eq.nome} para ${diaDito(e.dia)}, das ${horaDita(hIni)} às ${horaDita(hFim)}. Fica confirmado quando pagar ${preco}. ${pagamento?.dizer ?? ''}`) +
        (r.sms ? ' Mandei-lhe um SMS com o link da reserva.' : ''),
    };
  }

  // -------------------------------------------------------------------
  // Bilhetes
  // -------------------------------------------------------------------

  private async sessoes(municipioId: string): Promise<Sessao[]> {
    return this.db.query<Sessao>(
      `${SELECT_SESSOES}
       WHERE s.municipio_id = $1 AND s.ativo AND s.inicio > now()
       ORDER BY s.inicio LIMIT 30`,
      [municipioId],
    );
  }

  private infoSessao(s: Sessao, fuso: string) {
    const livres = Math.max(0, s.lotacao - s.ocupados);
    return {
      nome: s.titulo,
      local: s.local,
      dia: diaLocal(s.inicio, fuso),
      hora: horaLocal(s.inicio, fuso),
      preco: s.preco_cent ? formatarEuros(s.preco_cent) : 'gratuito',
      lugares_livres: livres,
      esgotado: livres === 0,
    };
  }

  async verEventos(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaEventos>,
  ) {
    const m = ctx.municipio;
    const todas = await this.sessoes(m.id);
    if (!todas.length) {
      return {
        encontrado: false,
        dizer:
          'Não há eventos da câmara com bilhete marcados para os próximos tempos.',
      };
    }
    const lista = todas.map((s) => ({ ...s, nome: s.titulo }));
    let escolhidas = lista;
    if (e.evento) {
      const esc = escolher(lista, e.evento);
      if (esc.tipo === 'nenhum')
        return this.naoEncontrado('evento', lista, e.evento);
      escolhidas = esc.tipo === 'um' ? [esc.item] : esc.itens;
    }
    const itens = escolhidas.slice(0, 5).map((s) => this.infoSessao(s, m.fuso));
    return {
      encontrado: true,
      eventos: itens,
      valores_de_demonstracao: escolhidas.some((s) => s.demonstracao),
      dizer:
        itens
          .map(
            (x) =>
              `${x.nome}: ${diaDito(x.dia)} às ${horaDita(x.hora)}, ${x.local}, ${x.preco}` +
              (x.esgotado
                ? ', esgotado'
                : `, ${x.lugares_livres} lugares livres`),
          )
          .join('. ') + '.',
    };
  }

  async comprarBilhete(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaBilhete>,
  ) {
    const falta = this.identificacao(ctx, 'reservar bilhetes');
    if (falta) return falta;
    const m = ctx.municipio;
    const lista = (await this.sessoes(m.id)).map((s) => ({
      ...s,
      nome: s.titulo,
    }));
    const esc = escolher(lista, e.evento);
    if (esc.tipo === 'nenhum')
      return this.naoEncontrado('evento', lista, e.evento);
    if (esc.tipo === 'varios') return this.escolherVarios(esc.itens);
    const s = esc.item;
    const av = avaliarBilhetes(
      s.lotacao,
      s.ocupados,
      e.quantidade,
      s.max_por_pessoa,
    );
    if (!av.ok)
      return {
        feito: false,
        motivo: 'sem_lugares',
        lugares_livres: av.livres,
        dizer: av.texto,
      };
    const valor = s.preco_cent * e.quantidade;
    const preco = valor ? formatarEuros(valor) : 'gratuito';
    const dia = diaLocal(s.inicio, m.fuso);
    const hora = horaLocal(s.inicio, m.fuso);
    if (!e.confirmado) {
      return {
        feito: false,
        confirmar: true,
        resumo: {
          evento: s.titulo,
          dia,
          hora,
          quantidade: e.quantidade,
          nome: e.nome,
          valor: preco,
        },
        valores_de_demonstracao: s.demonstracao,
        ler_a_pessoa: `Reservo ${e.quantidade} ${e.quantidade === 1 ? 'bilhete' : 'bilhetes'} para ${s.titulo}, ${diaDito(dia)} às ${horaDita(hora)}, em nome de ${e.nome}. ${valor ? `Total: ${preco}.` : 'É gratuito.'} Confirma?`,
      };
    }
    const r = await this.db.transaction(async (tx) => {
      // Trinco na sessão: dois pedidos ao mesmo tempo não passam a lotação.
      await tx.query('SELECT 1 FROM reserva_sessoes WHERE id = $1 FOR UPDATE', [
        s.id,
      ]);
      const [{ ocupados }] = await tx.query<{ ocupados: number }>(
        `SELECT coalesce(sum(quantidade), 0)::int AS ocupados FROM reservas
         WHERE sessao_id = $1 AND estado IN ${ATIVAS}`,
        [s.id],
      );
      const de = avaliarBilhetes(
        s.lotacao,
        ocupados,
        e.quantidade,
        s.max_por_pessoa,
      );
      if (!de.ok) return { esgotou: de };
      const mu = await this.municipeDe(ctx, tx);
      const telefone = normalizarTelefone(ctx.telefone) ?? mu?.telefone ?? null;
      const estado = estadoInicial('automatica', valor);
      const codigo = novoCodigo();
      const [nova] = await tx.query<{ id: string }>(
        `INSERT INTO reservas (municipio_id, tipo, codigo, sessao_id, quantidade, nome, telefone,
           municipe_id, conversa_id, canal, valor_cent, estado, confirmada_em, demonstracao)
         VALUES ($1, 'bilhete', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           CASE WHEN $11 = 'confirmada' THEN now() END, $12)
         RETURNING id`,
        [
          m.id,
          codigo,
          s.id,
          e.quantidade,
          e.nome,
          telefone,
          mu?.id ?? null,
          ctx.conversaId,
          ctx.canal,
          valor,
          estado,
          s.demonstracao,
        ],
      );
      const processoId =
        estado === 'por_pagar'
          ? await this.processo(tx, m, {
              municipeId: mu?.id ?? null,
              conversaId: ctx.conversaId,
              assunto: `${e.quantidade} bilhete(s) · ${s.titulo}`,
              morada: s.local,
              reservaId: nova.id,
            })
          : null;
      const sms = await this.smsReserva(
        tx,
        m,
        {
          id: nova.id,
          codigo,
          municipeId: mu?.id ?? null,
          telefone,
          conversaId: ctx.conversaId,
        },
        estado === 'confirmada'
          ? `${e.quantidade} bilhete(s) para ${s.titulo} (${dia}, ${hora}). Mostre o QR à entrada:`
          : `${e.quantidade} bilhete(s) para ${s.titulo} guardados até ao pagamento de ${preco} (modo de teste).`,
        `bilhete:${nova.id}`,
      );
      await this.conversas.momento(
        ctx.conversaId,
        'marcacao',
        { reserva_id: nova.id, codigo, sessao: s.titulo, estado },
        tx,
      );
      return { id: nova.id, codigo, telefone, estado, processoId, sms };
    });
    if ('esgotou' in r && r.esgotou) {
      return {
        feito: false,
        motivo: 'sem_lugares',
        lugares_livres: r.esgotou.livres,
        dizer: r.esgotou.texto,
      };
    }
    const pagamento = r.processoId
      ? await this.cobrar(
          ctx,
          r.processoId,
          valor,
          `${e.quantidade} bilhete(s) · ${s.titulo}`,
          e.metodo,
          r.telefone,
        )
      : null;
    return {
      feito: true,
      codigo: r.codigo,
      estado: r.estado,
      evento: s.titulo,
      quantidade: e.quantidade,
      valor: preco,
      pagamento,
      link: this.url(r.codigo),
      valores_de_demonstracao: s.demonstracao,
      dizer:
        (r.estado === 'confirmada'
          ? `Ficam reservados ${e.quantidade} ${e.quantidade === 1 ? 'bilhete' : 'bilhetes'} para ${s.titulo}, ${diaDito(dia)} às ${horaDita(hora)}.`
          : `Guardei ${e.quantidade} ${e.quantidade === 1 ? 'bilhete' : 'bilhetes'} para ${s.titulo}. Ficam seus quando pagar ${preco}. ${pagamento?.dizer ?? ''}`) +
        (r.sms
          ? ' O SMS leva o link com o código QR para mostrar à entrada.'
          : ''),
    };
  }

  // -------------------------------------------------------------------
  // As minhas reservas e cancelar
  // -------------------------------------------------------------------

  private async daPessoa(ctx: ContextoFerramenta): Promise<Reserva[]> {
    const telefone = normalizarTelefone(ctx.telefone);
    return this.db.query<Reserva>(
      `${SELECT_RESERVAS}
       WHERE r.municipio_id = $1 AND r.estado IN ${ATIVAS}
         AND coalesce(upper(r.periodo), s.inicio) > now()
         AND (r.municipe_id = $2::uuid OR ($3::text IS NOT NULL AND r.telefone = $3))
       ORDER BY inicio LIMIT 10`,
      [ctx.municipio.id, ctx.municipeId, telefone],
    );
  }

  private fraseReserva(r: Reserva, fuso: string): string {
    const dia = diaLocal(r.inicio, fuso);
    const h = horaLocal(r.inicio, fuso);
    return r.tipo === 'bilhete'
      ? `${r.quantidade} bilhete(s) para ${r.titulo}, ${diaDito(dia)} às ${horaDita(h)} (${FRASE_ESTADO[r.estado]}, código ${r.codigo})`
      : `${r.titulo}, ${diaDito(dia)} às ${horaDita(h)} (${FRASE_ESTADO[r.estado]}, código ${r.codigo})`;
  }

  async minhas(ctx: ContextoFerramenta) {
    const falta = this.identificacao(ctx, 'ver as reservas');
    if (falta) return falta;
    const lista = await this.daPessoa(ctx);
    if (!lista.length) {
      return {
        encontrado: false,
        dizer: 'Não tem reservas nem bilhetes para os próximos dias.',
      };
    }
    return {
      encontrado: true,
      reservas: lista.map((r) => ({
        codigo: r.codigo,
        tipo: r.tipo,
        o_que: r.titulo,
        quando: r.inicio,
        estado: r.estado,
        quantidade: r.quantidade,
      })),
      dizer: `Tem: ${lista.map((r) => this.fraseReserva(r, ctx.municipio.fuso)).join('; ')}.`,
    };
  }

  async cancelar(ctx: ContextoFerramenta, e: z.output<typeof entradaCancelar>) {
    const falta = this.identificacao(ctx, 'cancelar');
    if (falta) return falta;
    const m = ctx.municipio;
    let r: Reserva | undefined;
    if (e.codigo) {
      [r] = await this.db.query<Reserva>(
        `${SELECT_RESERVAS} WHERE r.municipio_id = $1 AND r.codigo = $2`,
        [
          m.id,
          e.codigo
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, ''),
        ],
      );
      if (!r) {
        return {
          encontrado: false,
          dizer: `Não encontro a reserva com o código ${e.codigo}.`,
        };
      }
    } else {
      const lista = await this.daPessoa(ctx);
      if (!lista.length) {
        return {
          encontrado: false,
          dizer: 'Não encontro reservas suas por cancelar.',
        };
      }
      if (lista.length > 1) {
        return {
          feito: false,
          precisa_escolher: true,
          opcoes: lista.map((x) => ({
            codigo: x.codigo,
            o_que: this.fraseReserva(x, m.fuso),
          })),
          dizer: `Tem várias: ${lista.map((x) => this.fraseReserva(x, m.fuso)).join('; ')}. Qual quer cancelar?`,
        };
      }
      r = lista[0];
    }
    const pago = r.pagamento?.estado === 'pago';
    const pc = podeCancelar(r.estado, r.inicio, new Date(), pago);
    if (!pc.pode)
      return { feito: false, motivo: 'nao_cancelavel', dizer: pc.texto };
    if (!e.confirmado) {
      return {
        feito: false,
        confirmar: true,
        resumo: { codigo: r.codigo, o_que: r.titulo, devolucao: pc.devolucao },
        regras_de_demonstracao: REGRAS_RESERVAS.demonstracao,
        ler_a_pessoa: `Cancelo ${this.fraseReserva(r, m.fuso)}? ${pc.texto}`,
      };
    }
    await this.fazerCancelar(m, r, {
      ator: 'municipe',
      municipeId: ctx.municipeId,
    });
    return {
      feito: true,
      codigo: r.codigo,
      devolucao: pc.devolucao,
      regras_de_demonstracao: REGRAS_RESERVAS.demonstracao,
      dizer:
        `Está cancelada: ${r.titulo}. ${pc.devolucao ? 'O valor pago é devolvido (pagamento de teste: nada foi cobrado).' : ''}`.trim(),
    };
  }

  private async fazerCancelar(
    m: Municipio,
    r: Reserva,
    o: {
      ator: 'municipe' | 'utilizador';
      municipeId?: string | null;
      utilizadorId?: string;
    },
  ) {
    await this.db.transaction(async (tx) => {
      const [mudou] = await tx.query<{ id: string }>(
        `UPDATE reservas SET estado = 'cancelada', cancelada_em = now()
         WHERE id = $1 AND estado IN ${ATIVAS} RETURNING id`,
        [r.id],
      );
      if (!mudou) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'reserva_fechada',
          'Esta reserva já não está ativa.',
        );
      }
      if (r.processo_id) {
        await tx.query(
          `UPDATE pagamentos SET estado = 'cancelado' WHERE processo_id = $1 AND estado = 'pendente'`,
          [r.processo_id],
        );
        await tx.query(
          `UPDATE processos SET fase = 'arquivado', atualizado_em = now() WHERE id = $1`,
          [r.processo_id],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: o.ator,
          atorId:
            o.ator === 'utilizador' ? o.utilizadorId : (o.municipeId ?? null),
          acao: 'cancelar_reserva',
          objetoTipo: 'reserva',
          objetoId: r.id,
          dados: { codigo: r.codigo },
        },
        tx,
      );
    });
  }

  // -------------------------------------------------------------------
  // Depois do pagamento
  // -------------------------------------------------------------------

  /** Reservas por pagar com o pagamento feito ficam confirmadas (e segue SMS). */
  async sincronizar(municipioId?: string): Promise<number> {
    const pagas = await this.db.query<{ id: string }>(
      `SELECT r.id FROM reservas r
       WHERE r.estado = 'por_pagar' AND r.processo_id IS NOT NULL
         AND ($1::uuid IS NULL OR r.municipio_id = $1)
         AND EXISTS (SELECT 1 FROM pagamentos pg WHERE pg.processo_id = r.processo_id AND pg.estado = 'pago')`,
      [municipioId ?? null],
    );
    for (const { id } of pagas) {
      await this.db.transaction(async (tx) => {
        const [r] = await tx.query<{
          codigo: string;
          municipio_id: string;
          municipe_id: string | null;
          telefone: string | null;
          tipo: string;
          processo_id: string;
          titulo: string;
        }>(
          `UPDATE reservas r SET estado = 'confirmada', confirmada_em = now()
           WHERE r.id = $1 AND r.estado = 'por_pagar'
           RETURNING r.codigo, r.municipio_id, r.municipe_id, r.telefone, r.tipo, r.processo_id,
             (SELECT coalesce(e.nome, s.titulo) FROM reservas x
              LEFT JOIN reserva_equipamentos e ON e.id = x.equipamento_id
              LEFT JOIN reserva_sessoes s ON s.id = x.sessao_id WHERE x.id = r.id) AS titulo`,
          [id],
        );
        if (!r) return;
        await tx.query(
          `UPDATE processos SET fase = 'notificado', decisao = 'admitido', decidido_em = now(), atualizado_em = now()
           WHERE id = $1`,
          [r.processo_id],
        );
        const m = await this.municipios.porId(r.municipio_id);
        await this.smsReserva(
          tx,
          m,
          {
            id,
            codigo: r.codigo,
            municipeId: r.municipe_id,
            telefone: r.telefone,
            conversaId: null,
          },
          r.tipo === 'bilhete'
            ? `pagamento recebido: bilhetes para ${r.titulo} confirmados. QR para a entrada:`
            : `pagamento recebido: reserva do ${r.titulo} confirmada.`,
          `reserva_paga:${id}`,
        );
      });
    }
    return pagas.length;
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  async painel(m: Municipio, f: z.output<typeof esquemaFiltroReservas>) {
    await this.sincronizar(m.id);
    const hoje = diaLocal(new Date(), m.fuso);
    const de = f.de ?? hoje;
    const ate = f.ate ?? diasSeguintes(de, 15)[14];
    const reservas = await this.db.query<Reserva>(
      `${SELECT_RESERVAS}
       WHERE r.municipio_id = $1
         AND ($2::uuid IS NULL OR r.equipamento_id = $2)
         AND ($3::text IS NULL OR r.estado = $3)
         AND (r.estado = 'por_aprovar'
              OR coalesce(lower(r.periodo), s.inicio) BETWEEN $4::timestamptz AND $5::timestamptz)
       ORDER BY (r.estado = 'por_aprovar') DESC, inicio LIMIT 300`,
      [
        m.id,
        f.equipamento_id ?? null,
        f.estado ?? null,
        instanteLocal(de, '00:00', m.fuso),
        instanteLocal(ate, '23:59', m.fuso),
      ],
    );
    const equipamentos = await this.equipamentos(m.id, false);
    const sessoes = await this.db.query<Sessao>(
      `${SELECT_SESSOES} WHERE s.municipio_id = $1 AND s.inicio > now() - interval '1 day'
       ORDER BY s.inicio LIMIT 50`,
      [m.id],
    );
    const [contagens] = await this.db.query<Record<EstadoReserva, number>>(
      `SELECT count(*) FILTER (WHERE estado = 'por_aprovar')::int AS por_aprovar,
              count(*) FILTER (WHERE estado = 'por_pagar')::int AS por_pagar,
              count(*) FILTER (WHERE estado = 'confirmada')::int AS confirmada,
              count(*) FILTER (WHERE estado = 'recusada')::int AS recusada,
              count(*) FILTER (WHERE estado = 'cancelada')::int AS cancelada
       FROM reservas WHERE municipio_id = $1`,
      [m.id],
    );
    return {
      de,
      ate,
      fuso: m.fuso,
      contagens,
      reservas: reservas.map((r) => ({
        ...r,
        dia: diaLocal(r.inicio, m.fuso),
        hora_inicio: horaLocal(r.inicio, m.fuso),
        hora_fim: r.fim ? horaLocal(r.fim, m.fuso) : null,
      })),
      equipamentos,
      sessoes: sessoes.map((s) => ({
        ...s,
        dia: diaLocal(s.inicio, m.fuso),
        hora: horaLocal(s.inicio, m.fuso),
        livres: Math.max(0, s.lotacao - s.ocupados),
      })),
      regras: REGRAS_RESERVAS,
    };
  }

  private async porId(m: Municipio, id: string): Promise<Reserva> {
    const [r] = await this.db.query<Reserva>(
      `${SELECT_RESERVAS} WHERE r.id = $1 AND r.municipio_id = $2`,
      [id, m.id],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'reserva_desconhecida',
        'Esta reserva não existe.',
      );
    }
    return r;
  }

  async aprovar(m: Municipio, u: UtilizadorPainel, id: string) {
    const r = await this.porId(m, id);
    if (r.estado !== 'por_aprovar') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'reserva_nao_por_aprovar',
        'Esta reserva não está à espera de aprovação.',
      );
    }
    const estado = estadoDepoisDeAprovar(r.valor_cent);
    const processoId = await this.db.transaction(async (tx) => {
      const [mudou] = await tx.query<{ id: string }>(
        `UPDATE reservas SET estado = $2, decidida_por = $3, decidida_em = now(),
           confirmada_em = CASE WHEN $2 = 'confirmada' THEN now() END
         WHERE id = $1 AND estado = 'por_aprovar' RETURNING id`,
        [id, estado, u.id],
      );
      if (!mudou) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'reserva_nao_por_aprovar',
          'Esta reserva não está à espera de aprovação.',
        );
      }
      const pid =
        estado === 'por_pagar'
          ? await this.processo(tx, m, {
              municipeId: r.municipe_id,
              conversaId: r.conversa_id,
              assunto: `Reserva do ${r.titulo} (${diaLocal(r.inicio, m.fuso)})`,
              morada: r.local,
              reservaId: r.id,
            })
          : null;
      if (estado === 'confirmada') {
        await this.smsReserva(
          tx,
          m,
          {
            id,
            codigo: r.codigo,
            municipeId: r.municipe_id,
            telefone: r.telefone,
            conversaId: null,
          },
          `a reserva do ${r.titulo} (${diaLocal(r.inicio, m.fuso)}, ${horaLocal(r.inicio, m.fuso)}) foi aprovada.`,
          `reserva_aprovada:${id}`,
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'aprovar_reserva',
          objetoTipo: 'reserva',
          objetoId: id,
          dados: { codigo: r.codigo, estado },
        },
        tx,
      );
      return pid;
    });
    if (processoId) {
      // O pagamento de teste segue por SMS (módulo de pagamentos) para o telefone da reserva.
      const ctx: ContextoFerramenta = {
        municipio: m,
        canal: 'chat',
        conversaId: null,
        municipeId: r.municipe_id,
        telefone: r.telefone,
      };
      await this.cobrar(
        ctx,
        processoId,
        r.valor_cent,
        `Reserva · ${r.titulo}`,
        undefined,
        r.telefone,
      );
    }
    return { ok: true, estado };
  }

  async recusar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaRecusarReserva>,
  ) {
    const r = await this.porId(m, id);
    await this.db.transaction(async (tx) => {
      const [mudou] = await tx.query<{ id: string }>(
        `UPDATE reservas SET estado = 'recusada', motivo_recusa = $2, decidida_por = $3, decidida_em = now()
         WHERE id = $1 AND estado IN ('por_aprovar','por_pagar') RETURNING id`,
        [id, e.motivo, u.id],
      );
      if (!mudou) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'reserva_fechada',
          'Esta reserva já não se pode recusar.',
        );
      }
      if (r.processo_id) {
        await tx.query(
          `UPDATE pagamentos SET estado = 'cancelado' WHERE processo_id = $1 AND estado = 'pendente'`,
          [r.processo_id],
        );
      }
      await this.smsReserva(
        tx,
        m,
        {
          id,
          codigo: r.codigo,
          municipeId: r.municipe_id,
          telefone: r.telefone,
          conversaId: null,
        },
        `a reserva do ${r.titulo} não foi aprovada: ${e.motivo}`,
        `reserva_recusada:${id}`,
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'recusar_reserva',
          objetoTipo: 'reserva',
          objetoId: id,
          dados: { codigo: r.codigo, motivo: e.motivo },
        },
        tx,
      );
    });
    return { ok: true };
  }

  async cancelarPainel(m: Municipio, u: UtilizadorPainel, id: string) {
    const r = await this.porId(m, id);
    await this.fazerCancelar(m, r, { ator: 'utilizador', utilizadorId: u.id });
    return { ok: true };
  }

  async criarEquipamento(
    m: Municipio,
    u: UtilizadorPainel,
    e: z.output<typeof esquemaEquipamento>,
  ) {
    const [n] = await this.db.query<Equipamento>(
      `INSERT INTO reserva_equipamentos (municipio_id, nome, tipo, morada, descricao, lotacao, horario,
         duracao_slot_min, duracao_max_horas, antecedencia_horas, preco_hora_cent, entrada_cent, notas,
         aprovacao, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${COLUNAS_EQUIP}`,
      [
        m.id,
        e.nome,
        e.tipo,
        e.morada,
        e.descricao ?? null,
        e.lotacao ?? null,
        JSON.stringify(e.horario),
        e.duracao_slot_min,
        e.duracao_max_horas,
        e.antecedencia_horas,
        e.preco_hora_cent,
        e.entrada_cent ?? null,
        e.notas ?? null,
        e.aprovacao,
        e.ativo,
      ],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'criar_equipamento',
      objetoTipo: 'equipamento',
      objetoId: n.id,
      dados: { nome: n.nome },
    });
    return n;
  }

  async atualizarEquipamento(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaEquipamento>,
  ) {
    const [n] = await this.db.query<Equipamento>(
      `UPDATE reserva_equipamentos SET nome = $3, tipo = $4, morada = $5, descricao = $6, lotacao = $7,
         horario = $8, duracao_slot_min = $9, duracao_max_horas = $10, antecedencia_horas = $11,
         preco_hora_cent = $12, entrada_cent = $13, notas = $14, aprovacao = $15, ativo = $16,
         atualizado_em = now()
       WHERE id = $1 AND municipio_id = $2
       RETURNING ${COLUNAS_EQUIP}`,
      [
        id,
        m.id,
        e.nome,
        e.tipo,
        e.morada,
        e.descricao ?? null,
        e.lotacao ?? null,
        JSON.stringify(e.horario),
        e.duracao_slot_min,
        e.duracao_max_horas,
        e.antecedencia_horas,
        e.preco_hora_cent,
        e.entrada_cent ?? null,
        e.notas ?? null,
        e.aprovacao,
        e.ativo,
      ],
    );
    if (!n) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'equipamento_desconhecido',
        'Este equipamento não existe.',
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'editar_equipamento',
      objetoTipo: 'equipamento',
      objetoId: id,
      dados: { nome: n.nome },
    });
    return n;
  }

  // -------------------------------------------------------------------
  // Página pública (link do SMS)
  // -------------------------------------------------------------------

  private async porCodigo(codigo: string): Promise<Reserva> {
    const c = codigo.trim().toUpperCase();
    const [r] = /^[A-Z0-9]{10}$/.test(c)
      ? await this.db.query<Reserva>(`${SELECT_RESERVAS} WHERE r.codigo = $1`, [
          c,
        ])
      : [];
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'reserva_desconhecida',
        'Esta reserva não existe.',
      );
    }
    return r;
  }

  async publico(codigo: string) {
    const r0 = await this.porCodigo(codigo);
    if (r0.estado === 'por_pagar') await this.sincronizar(r0.municipio_id);
    const r = r0.estado === 'por_pagar' ? await this.porCodigo(codigo) : r0;
    const m = await this.municipios.porId(r.municipio_id);
    const pago = r.pagamento?.estado === 'pago';
    const pc = podeCancelar(r.estado, r.inicio, new Date(), pago);
    const primeiro = (r.nome ?? '').split(' ')[0] || null;
    return {
      codigo: r.codigo,
      tipo: r.tipo,
      estado: r.estado,
      municipio: m.nome,
      titulo: r.titulo,
      local: r.local,
      dia: diaLocal(r.inicio, m.fuso),
      hora_inicio: horaLocal(r.inicio, m.fuso),
      hora_fim: r.fim ? horaLocal(r.fim, m.fuso) : null,
      quantidade: r.quantidade,
      finalidade: r.finalidade,
      // Só o primeiro nome: o código já é o segredo, mas a página pode ser mostrada à entrada.
      nome: primeiro,
      valor_cent: r.valor_cent,
      motivo_recusa: r.motivo_recusa,
      pagamento: r.pagamento
        ? {
            estado: r.pagamento.estado,
            modo_teste: r.pagamento.modo_teste,
            entidade: r.pagamento.mb_entidade,
            referencia: r.pagamento.mb_referencia,
            pagar_ate: r.pagamento.pagar_ate,
            pagina: r.pagamento.link ? `/pagamento/${r.pagamento.link}` : null,
          }
        : null,
      pode_cancelar: pc.pode,
      cancelar_texto: pc.texto,
      qr: r.estado === 'confirmada',
      demonstracao: r.demonstracao,
    };
  }

  async cancelarPublico(codigo: string) {
    const r = await this.porCodigo(codigo);
    const pc = podeCancelar(
      r.estado,
      r.inicio,
      new Date(),
      r.pagamento?.estado === 'pago',
    );
    if (!pc.pode)
      throw new ErroApi(HttpStatus.CONFLICT, 'nao_cancelavel', pc.texto);
    const m = await this.municipios.porId(r.municipio_id);
    await this.fazerCancelar(m, r, {
      ator: 'municipe',
      municipeId: r.municipe_id,
    });
    return this.publico(codigo);
  }

  // -------------------------------------------------------------------
  // Demonstração
  // -------------------------------------------------------------------

  /**
   * Equipamentos e sessões de demonstração (só os que faltam, pela chave).
   * A visita guiada liga-se ao evento do feed com o mesmo título, se houver.
   */
  async carregarDemonstracao(m: Municipio, u: UtilizadorPainel | null) {
    const hoje = diaLocal(new Date(), m.fuso);
    let equipamentos = 0;
    let sessoes = 0;
    await this.db.transaction(async (tx) => {
      for (const e of EQUIPAMENTOS_DEMO) {
        const r = await tx.query(
          `INSERT INTO reserva_equipamentos (municipio_id, chave, nome, tipo, morada, descricao, lotacao, horario,
             duracao_slot_min, duracao_max_horas, antecedencia_horas, preco_hora_cent, entrada_cent, notas,
             aprovacao, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true)
           ON CONFLICT (municipio_id, chave) DO NOTHING RETURNING id`,
          [
            m.id,
            e.chave,
            e.nome,
            e.tipo,
            e.morada,
            e.descricao,
            e.lotacao,
            JSON.stringify(e.horario),
            e.duracao_slot_min,
            e.duracao_max_horas,
            e.antecedencia_horas,
            e.preco_hora_cent,
            e.entrada_cent,
            e.notas,
            e.aprovacao,
          ],
        );
        equipamentos += r.length;
      }
      for (const s of SESSOES_DEMO) {
        const dia = diasSeguintes(hoje, s.dias + 1)[s.dias];
        const inicio = instanteLocal(dia, s.inicio, m.fuso);
        const [ev] = s.evento_titulo
          ? await tx.query<{ id: string; inicio: Date; fim: Date | null }>(
              `SELECT id, inicio, fim FROM eventos WHERE municipio_id = $1 AND titulo = $2
               ORDER BY inicio DESC LIMIT 1`,
              [m.id, s.evento_titulo],
            )
          : [];
        const r = await tx.query(
          `INSERT INTO reserva_sessoes (municipio_id, chave, evento_id, titulo, local, inicio, fim, lotacao,
             preco_cent, max_por_pessoa, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
           ON CONFLICT (municipio_id, chave) DO NOTHING RETURNING id`,
          [
            m.id,
            s.chave,
            ev?.id ?? null,
            s.titulo,
            s.local,
            ev?.inicio ?? inicio,
            ev ? ev.fim : instanteLocal(dia, s.fim, m.fuso),
            s.lotacao,
            s.preco_cent,
            s.max_por_pessoa,
          ],
        );
        sessoes += r.length;
      }
      if (u) {
        await this.auditoria.registar(
          {
            municipioId: m.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'carregar_reservas_demonstracao',
            objetoTipo: 'reservas',
            objetoId: m.id,
            dados: { equipamentos, sessoes },
          },
          tx,
        );
      }
    });
    this.logger.log(
      `Reservas de demonstração: ${equipamentos} equipamentos, ${sessoes} sessões.`,
    );
    return { equipamentos, sessoes, demonstracao: true };
  }
}
