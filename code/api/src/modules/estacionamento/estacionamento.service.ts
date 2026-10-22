import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { diaLocal, instanteLocal, type Horario } from '../marcacoes/vagas.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import { formatarEuros } from '../pagamentos/taxas.js';
import { MULTAS_DEMO, PARQUES_DEMO } from './demonstracao.js';
import {
  chaveAuto,
  custoEstacionar,
  dentroDoHorario,
  type EstadoMulta,
  horarioDito,
  normalizarMatricula,
  parquesPerto,
  REGRAS_LUGAR_DEFICIENCIA,
  REGRAS_MULTAS,
  situacaoMulta,
  type Tarifa,
  tarifaDita,
} from './regras.js';

// ---------------------------------------------------------------------------
// Entradas das ações do catálogo (cada campo: a pergunta a fazer)
// ---------------------------------------------------------------------------

const auto = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .optional()
  .describe(
    'Número do auto (vem no papel deixado no carro ou na notificação).',
  );
const matricula = z
  .string()
  .trim()
  .min(6)
  .max(12)
  .optional()
  .describe('Matrícula do carro (ex.: AA-12-BC).');
const confirmado = z
  .boolean()
  .optional()
  .describe('Só depois de a pessoa dizer que sim ao resumo.');

export const entradaConsultarMulta = z.object({
  numero_auto: auto,
  matricula,
});

export const entradaPagarMulta = z.object({
  numero_auto: auto,
  matricula,
  metodo: z
    .enum(['mbway', 'multibanco'])
    .optional()
    .describe(
      'MB WAY ou referência Multibanco (por omissão MB WAY no telemóvel).',
    ),
  confirmado,
});

export const entradaDefesa = z.object({
  numero_auto: auto,
  matricula,
  motivo: z
    .string()
    .trim()
    .min(10)
    .max(4000)
    .describe('Porque não concorda com a multa, pelas palavras da pessoa.'),
  nome: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .describe('Nome completo de quem se defende.'),
  confirmado,
});

export const entradaOndeEstacionar = z.object({
  onde: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Perto de que rua, largo ou sítio quer estacionar.'),
  horas: z
    .number()
    .min(0.25)
    .max(24)
    .optional()
    .describe('Quantas horas pensa ficar (para dizer quanto custa).'),
});

export const entradaLugarDeficiencia = z.object({
  morada: z
    .string()
    .trim()
    .min(5)
    .max(300)
    .describe('Morada onde precisa do lugar (rua, número e freguesia).'),
  tem_cartao: z
    .boolean()
    .describe('Tem o cartão de estacionamento para pessoas com deficiência?'),
  matricula: matricula.describe('Matrícula do carro que vai usar o lugar.'),
  nome: z.string().trim().min(3).max(120).describe('Nome completo.'),
  observacoes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe('Alguma coisa importante (ex.: trabalha ali, cadeira de rodas).'),
  confirmado,
});

export const esquemaDecisaoDefesa = z.object({
  decisao: z.enum(['aceite', 'recusada']),
  nota: z.string().trim().min(5).max(1000),
});

export const esquemaDecisaoLugar = z.object({
  decisao: z.enum(['aprovado', 'recusado']),
  nota: z.string().trim().min(5).max(1000),
});

// ---------------------------------------------------------------------------

interface LinhaMulta {
  id: string;
  municipio_id: string;
  numero_auto: string;
  matricula: string;
  infracao: string;
  norma: string | null;
  local: string;
  verificada_em: Date;
  valor_cent: number;
  valor_maximo_cent: number | null;
  prazo_pagamento: string;
  prazo_defesa: string;
  estado: EstadoMulta;
  processo_id: string | null;
  demonstracao: boolean;
  paga_em: Date | null;
  defesa_estado: 'por_analisar' | 'aceite' | 'recusada' | null;
}

const COLUNAS_MULTA = `m.id, m.municipio_id, m.numero_auto, m.matricula, m.infracao, m.norma,
  m.local, m.verificada_em, m.valor_cent, m.valor_maximo_cent,
  to_char(m.prazo_pagamento, 'YYYY-MM-DD') AS prazo_pagamento,
  to_char(m.prazo_defesa, 'YYYY-MM-DD') AS prazo_defesa,
  m.estado, m.processo_id, m.demonstracao, m.paga_em,
  (SELECT d.estado FROM estacionamento_defesas d WHERE d.multa_id = m.id
   ORDER BY d.criada_em DESC LIMIT 1) AS defesa_estado`;

interface LinhaParque {
  id: string;
  chave: string;
  nome: string;
  tipo: 'parque' | 'zona_tarifada';
  morada: string;
  zonas: string[];
  lat: number | null;
  lng: number | null;
  lugares: number | null;
  lugares_deficiencia: number | null;
  horario: Horario;
  tarifa: Tarifa;
  pagamento_telemovel: boolean;
  notas: string | null;
  ativo: boolean;
  demonstracao: boolean;
}

const CODIGO_PROCESSO = 'CEST';
const SERIE_LUGAR = 'LRD';

/** '2026-11-03' → '3 de novembro'. */
function diaDito(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-PT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  });
}

function maiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Estacionamento (V4 #5): multas (consultar, pagar em modo de teste,
 * defender por escrito), parques e tarifas, e pedidos de lugar reservado
 * para pessoas com deficiência. O dístico de residente é uma licença
 * (licencas, tipo distico_residente).
 */
@Injectable()
export class EstacionamentoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly pagamentos: PagamentosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private hoje(m: Municipio): string {
    return diaLocal(new Date(), m.fuso);
  }

  /** Quem pede: o munícipe da conversa ou o do número de onde liga. */
  private identificacao(ctx: ContextoFerramenta, acao: string) {
    const telefone = normalizarTelefone(ctx.telefone);
    if (ctx.municipeId || telefone) return null;
    return {
      feito: false,
      motivo: 'precisa_identificacao',
      instrucao:
        ctx.canal === 'chat'
          ? `Para ${acao} a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.`
          : `Não há um número para onde mandar a resposta. Pede o número de telemóvel e usa identificar_municipe, ou passa a um funcionário.`,
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
  // Multas
  // -------------------------------------------------------------------

  /** As multas por auto (uma) ou por matrícula (as que não estão fechadas há muito). */
  private async procurarMultas(
    m: Municipio,
    e: { numero_auto?: string; matricula?: string },
  ): Promise<
    | { ok: true; multas: LinhaMulta[] }
    | { ok: false; resposta: Record<string, unknown> }
  > {
    await this.sincronizar(m.id);
    if (e.numero_auto) {
      const multas = await this.db.query<LinhaMulta>(
        `SELECT ${COLUNAS_MULTA} FROM estacionamento_multas m
         WHERE m.municipio_id = $1
           AND regexp_replace(upper(m.numero_auto), '[^A-Z0-9]', '', 'g') = $2`,
        [m.id, chaveAuto(e.numero_auto)],
      );
      if (multas.length) return { ok: true, multas };
      if (!e.matricula) {
        return {
          ok: false,
          resposta: {
            encontrado: false,
            dizer: `Não encontro nenhuma multa com o auto ${e.numero_auto}. Pode confirmar o número, ou dizer-me a matrícula do carro?`,
          },
        };
      }
    }
    if (e.matricula) {
      const mat = normalizarMatricula(e.matricula);
      if (!mat) {
        return {
          ok: false,
          resposta: {
            feito: false,
            motivo: 'dados_invalidos',
            invalidos: [
              {
                campo: 'matricula',
                problema: 'não parece uma matrícula portuguesa',
              },
            ],
            dizer:
              'Essa matrícula não me parece certa. Pode dizer-ma outra vez, letra a letra?',
          },
        };
      }
      const multas = await this.db.query<LinhaMulta>(
        `SELECT ${COLUNAS_MULTA} FROM estacionamento_multas m
         WHERE m.municipio_id = $1 AND m.matricula = $2
           AND (m.estado IN ('por_pagar','em_defesa') OR m.atualizada_em > now() - interval '90 days')
         ORDER BY m.verificada_em DESC LIMIT 10`,
        [m.id, mat],
      );
      if (multas.length) return { ok: true, multas };
      return {
        ok: false,
        resposta: {
          encontrado: false,
          dizer: `Não há multas de estacionamento da câmara para a matrícula ${mat}. As multas da PSP ou da GNR não passam pela câmara: tratam-se com a ANSR.`,
        },
      };
    }
    return {
      ok: false,
      resposta: {
        feito: false,
        motivo: 'faltam_dados',
        em_falta: [
          { campo: 'numero_auto', pergunta: 'Número do auto' },
          { campo: 'matricula', pergunta: 'Matrícula do carro' },
        ],
        dizer:
          'Diga-me o número do auto, que vem no papel deixado no carro, ou a matrícula.',
      },
    };
  }

  private resumoMulta(x: LinhaMulta, hoje: string) {
    const s = situacaoMulta(x, hoje);
    return {
      numero_auto: x.numero_auto,
      matricula: x.matricula,
      infracao: x.infracao,
      local: x.local,
      dia: diaDito(x.verificada_em.toISOString().slice(0, 10)),
      valor: formatarEuros(x.valor_cent),
      estado: x.estado,
      prazo_pagamento: x.prazo_pagamento,
      prazo_defesa: x.prazo_defesa,
      ...s,
    };
  }

  private fraseMulta(x: LinhaMulta, hoje: string): string {
    const s = situacaoMulta(x, hoje);
    const base = `A multa ${x.numero_auto}, da matrícula ${x.matricula}, é por ${x.infracao.toLowerCase()} (${x.local}).`;
    if (x.estado === 'paga') return `${base} Já está paga.`;
    if (x.estado === 'anulada') return `${base} Foi anulada: não tem de pagar.`;
    if (x.estado === 'em_defesa') return `${base} ${s.o_que_fazer}`;
    return (
      `${base} O valor a pagar é ${formatarEuros(x.valor_cent)}` +
      (s.fora_do_prazo_pagamento
        ? '. '
        : `, até ${diaDito(x.prazo_pagamento)}. `) +
      (s.pode_defender
        ? `Se não concorda, pode apresentar defesa por escrito até ${diaDito(x.prazo_defesa)}. `
        : '') +
      s.o_que_fazer
    );
  }

  async consultarMulta(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaConsultarMulta>,
  ) {
    const r = await this.procurarMultas(ctx.municipio, e);
    if (!r.ok) return r.resposta;
    const hoje = this.hoje(ctx.municipio);
    const abertas = r.multas.filter(
      (x) => x.estado !== 'paga' && x.estado !== 'anulada',
    );
    const lista = (abertas.length ? abertas : r.multas).slice(0, 5);
    return {
      encontrado: true,
      multas: lista.map((x) => this.resumoMulta(x, hoje)),
      prazos_de_demonstracao: REGRAS_MULTAS.demonstracao,
      fonte_prazos: REGRAS_MULTAS.fonte,
      dizer:
        (lista.length > 1 ? `Encontrei ${lista.length} multas. ` : '') +
        lista.map((x) => this.fraseMulta(x, hoje)).join(' '),
    };
  }

  /** Uma só multa (com várias por matrícula, pede o auto). */
  private async umaMulta(
    m: Municipio,
    e: { numero_auto?: string; matricula?: string },
    abertas = true,
  ): Promise<
    | { ok: true; multa: LinhaMulta }
    | { ok: false; resposta: Record<string, unknown> }
  > {
    const r = await this.procurarMultas(m, e);
    if (!r.ok) return r;
    const lista = abertas
      ? r.multas.filter((x) => x.estado === 'por_pagar')
      : r.multas;
    if (lista.length === 1) return { ok: true, multa: lista[0] };
    if (!lista.length) {
      const x = r.multas[0];
      return {
        ok: false,
        resposta: {
          feito: false,
          motivo: 'nada_a_fazer',
          dizer: this.fraseMulta(x, this.hoje(m)),
        },
      };
    }
    return {
      ok: false,
      resposta: {
        feito: false,
        precisa_escolher: true,
        opcoes: lista.map((x) => ({
          numero_auto: x.numero_auto,
          infracao: x.infracao,
          local: x.local,
          valor: formatarEuros(x.valor_cent),
        })),
        dizer: `Há ${lista.length} multas por pagar para esta matrícula: ${lista
          .map(
            (x) =>
              `${x.numero_auto} (${x.local}, ${formatarEuros(x.valor_cent)})`,
          )
          .join('; ')}. Qual delas?`,
      },
    };
  }

  /** O processo da contraordenação (cria-o no primeiro pedido de pagamento). */
  private async processoDaMulta(
    m: Municipio,
    multa: LinhaMulta,
    municipeId: string | null,
    conversaId: string | null,
  ): Promise<string> {
    if (multa.processo_id) return multa.processo_id;
    return this.db.transaction(async (tx) => {
      const [bloq] = await tx.query<{ processo_id: string | null }>(
        'SELECT processo_id FROM estacionamento_multas WHERE id = $1 FOR UPDATE',
        [multa.id],
      );
      if (bloq?.processo_id) return bloq.processo_id;
      const [t] = await tx.query<{ id: string }>(
        `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, formulario, frase_do_agente)
         VALUES ($1, $2, 'Contraordenação de estacionamento', $3, '[]',
           'Consulto a multa pelo auto ou pela matrícula; pode pagar já ou apresentar defesa por escrito.')
         ON CONFLICT (municipio_id, codigo) DO UPDATE SET codigo = EXCLUDED.codigo
         RETURNING id`,
        [m.id, CODIGO_PROCESSO, REGRAS_MULTAS.resposta_defesa_dias_uteis],
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
          municipeId,
          conversaId,
          `Multa ${multa.numero_auto} (${multa.matricula})`,
          multa.local,
          this.hoje(m),
        ],
      );
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados)
         VALUES ($1, 'criado', $2, 'agente', $3)`,
        [
          p.id,
          `Pedido de pagamento da multa de estacionamento ${multa.numero_auto}.`,
          JSON.stringify({ multa_id: multa.id }),
        ],
      );
      await tx.query(
        `UPDATE estacionamento_multas SET processo_id = $2, municipe_id = coalesce(municipe_id, $3),
           atualizada_em = now() WHERE id = $1`,
        [multa.id, p.id, municipeId],
      );
      return p.id;
    });
  }

  async pagarMulta(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPagarMulta>,
  ) {
    const falta = this.identificacao(ctx, 'pagar a multa');
    if (falta) return falta;
    const r = await this.umaMulta(ctx.municipio, e);
    if (!r.ok) return r.resposta;
    const multa = r.multa;
    if (!e.confirmado) {
      return {
        feito: false,
        confirmar: true,
        resumo: {
          numero_auto: multa.numero_auto,
          matricula: multa.matricula,
          valor: formatarEuros(multa.valor_cent),
        },
        ler_a_pessoa: `Vou gerar o pagamento da multa ${multa.numero_auto}, da matrícula ${multa.matricula}, no valor de ${formatarEuros(multa.valor_cent)}. Confirma?`,
      };
    }
    const mu = await this.db.transaction((tx) => this.municipeDe(ctx, tx));
    const processoId = await this.processoDaMulta(
      ctx.municipio,
      multa,
      mu?.id ?? null,
      ctx.conversaId,
    );
    const telefone = normalizarTelefone(ctx.telefone) ?? mu?.telefone ?? null;
    const pagamento = await this.pagamentos.criar(
      ctx,
      {
        processo_id: processoId,
        metodo:
          e.metodo ?? (telefone?.startsWith('+3519') ? 'mbway' : 'multibanco'),
      },
      {
        linhas: [
          {
            codigo: 'COIMA_EST',
            descricao: `Coima · ${multa.infracao} (auto ${multa.numero_auto})`,
            unidade: 'fixo',
            quantidade: 1,
            valor_unitario_cent: multa.valor_cent,
            valor_cent: multa.valor_cent,
          },
        ],
        total_cent: multa.valor_cent,
      },
    );
    return {
      feito: true,
      numero_auto: multa.numero_auto,
      valor: formatarEuros(multa.valor_cent),
      pagamento,
      dizer:
        `Gerei o pagamento de ${formatarEuros(multa.valor_cent)} da multa ${multa.numero_auto}. ${pagamento.dizer ?? ''} Assim que estiver pago, a multa fica fechada.`.trim(),
    };
  }

  async apresentarDefesa(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaDefesa>,
  ) {
    const falta = this.identificacao(ctx, 'apresentar a defesa');
    if (falta) return falta;
    const r = await this.umaMulta(ctx.municipio, e);
    if (!r.ok) return r.resposta;
    const multa = r.multa;
    const hoje = this.hoje(ctx.municipio);
    const s = situacaoMulta(multa, hoje);
    if (!s.pode_defender) {
      return {
        feito: false,
        motivo: s.fora_do_prazo_defesa ? 'fora_do_prazo' : 'ja_defendida',
        dizer: s.fora_do_prazo_defesa
          ? `O prazo para apresentar defesa da multa ${multa.numero_auto} acabou a ${diaDito(multa.prazo_defesa)}. Pode ainda pagar, ou falar com o serviço de fiscalização.`
          : `A multa ${multa.numero_auto} já teve uma defesa analisada. ${s.o_que_fazer}`,
      };
    }
    if (!e.confirmado) {
      return {
        feito: false,
        confirmar: true,
        resumo: {
          numero_auto: multa.numero_auto,
          nome: e.nome,
          motivo: e.motivo,
        },
        ler_a_pessoa: `Vou registar a defesa da multa ${multa.numero_auto} em nome de ${e.nome}, com este motivo: "${e.motivo}". Enquanto é analisada, não precisa de pagar. Confirma?`,
      };
    }
    const m = ctx.municipio;
    const feriados = await this.municipios.feriados(m.id);
    const respostaAte = somarDiasUteis(
      hoje,
      REGRAS_MULTAS.resposta_defesa_dias_uteis,
      feriados,
    );
    const r2 = await this.db.transaction(async (tx) => {
      const mu = await this.municipeDe(ctx, tx);
      const telefone = normalizarTelefone(ctx.telefone) ?? mu?.telefone ?? null;
      const [mudou] = await tx.query<{ id: string }>(
        `UPDATE estacionamento_multas SET estado = 'em_defesa', municipe_id = coalesce(municipe_id, $2),
           atualizada_em = now()
         WHERE id = $1 AND estado = 'por_pagar' RETURNING id`,
        [multa.id, mu?.id ?? null],
      );
      if (!mudou) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'multa_mudou',
          'A multa mudou de estado entretanto. Consulte-a outra vez.',
        );
      }
      const [d] = await tx.query<{ id: string }>(
        `INSERT INTO estacionamento_defesas (municipio_id, multa_id, municipe_id, conversa_id, canal,
           nome, telefone, texto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          m.id,
          multa.id,
          mu?.id ?? null,
          ctx.conversaId,
          ctx.canal,
          e.nome,
          telefone,
          e.motivo,
        ],
      );
      if (mu?.id) {
        await tx.query(
          'UPDATE municipes SET nome = coalesce(nome, $2) WHERE id = $1',
          [mu.id, e.nome],
        );
      }
      if (telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: mu?.id ?? null,
            destino: telefone,
            motivo: 'processo',
            corpo: `${m.nome}: recebemos a sua defesa da multa ${multa.numero_auto} (${multa.matricula}). Não precisa de pagar enquanto é analisada. Respondemos por SMS.`,
            relacionado: {
              defesa_id: d.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `estacionamento_defesa:${d.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { estacionamento_defesa_id: d.id, numero_auto: multa.numero_auto },
        tx,
      );
      return { id: d.id, sms: !!telefone };
    });
    return {
      feito: true,
      numero_auto: multa.numero_auto,
      defesa_id: r2.id,
      resposta_ate: respostaAte,
      prazos_de_demonstracao: REGRAS_MULTAS.demonstracao,
      dizer:
        `Ficou registada a sua defesa da multa ${multa.numero_auto}. Enquanto o serviço a analisa, não precisa de pagar. ` +
        `A resposta segue por SMS, normalmente até ${diaDito(respostaAte)}.` +
        (r2.sms ? ' Já lhe mandei um SMS a confirmar.' : ''),
    };
  }

  // -------------------------------------------------------------------
  // Parques
  // -------------------------------------------------------------------

  private async parques(municipioId: string): Promise<LinhaParque[]> {
    return this.db.query<LinhaParque>(
      `SELECT id, chave, nome, tipo, morada, zonas, lat, lng, lugares, lugares_deficiencia,
              horario, tarifa, pagamento_telemovel, notas, ativo, demonstracao
       FROM estacionamento_parques WHERE municipio_id = $1
       ORDER BY (tipo = 'zona_tarifada') DESC, nome`,
      [municipioId],
    );
  }

  async ondeEstacionar(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaOndeEstacionar>,
  ) {
    const m = ctx.municipio;
    const todos = (await this.parques(m.id)).filter((p) => p.ativo);
    if (!todos.length) {
      return {
        encontrado: false,
        dizer: 'Ainda não tenho a informação dos parques da câmara.',
      };
    }
    const { parques, encontrou } = parquesPerto(todos, e.onde);
    const lista = (encontrou ? parques : todos).slice(0, 3);
    const agora = new Date();
    const minutos = e.horas ? Math.round(e.horas * 60) : null;
    const itens = lista.map((p) => {
      const aberto = dentroDoHorario(p.horario, agora, m.fuso);
      return {
        nome: p.nome,
        tipo: p.tipo,
        morada: p.morada,
        lugares: p.lugares,
        lugares_deficiencia: p.lugares_deficiencia,
        horario: horarioDito(p.horario),
        tarifa: tarifaDita(p.tarifa),
        ...(minutos !== null
          ? { custo: formatarEuros(custoEstacionar(p.tarifa, minutos)) }
          : {}),
        ...(p.tipo === 'zona_tarifada'
          ? { pago_agora: aberto }
          : { aberto_agora: aberto }),
        pagamento_telemovel: p.pagamento_telemovel,
        notas: p.notas,
      };
    });
    const frase = (x: (typeof itens)[number]) =>
      x.tipo === 'zona_tarifada'
        ? `Na ${x.nome.toLowerCase()} paga-se ${x.horario} (${x.tarifa})${x.pagamento_telemovel ? ', também pelo telemóvel' : ''}${x.custo ? `; ${e.horas} h custam ${x.custo}` : ''}.`
        : `${x.nome}, ${x.morada}: ${x.horario}, ${x.tarifa}${x.custo ? `; ${e.horas} h custam ${x.custo}` : ''}.`;
    return {
      encontrado: true,
      perto_de: e.onde ?? null,
      ...(e.onde && !encontrou ? { nao_encontrei_essa_zona: true } : {}),
      parques: itens,
      valores_de_demonstracao: lista.some((p) => p.demonstracao),
      dizer:
        (e.onde && !encontrou
          ? `Não tenho parques registados junto a ${e.onde}; estes são os do centro. `
          : '') + itens.map(frase).join(' '),
    };
  }

  // -------------------------------------------------------------------
  // Lugar reservado para pessoa com deficiência
  // -------------------------------------------------------------------

  async pedirLugar(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaLugarDeficiencia>,
  ) {
    const falta = this.identificacao(ctx, 'fazer o pedido');
    if (falta) return falta;
    const mat = e.matricula ? normalizarMatricula(e.matricula) : null;
    if (e.matricula && !mat) {
      return {
        feito: false,
        motivo: 'dados_invalidos',
        invalidos: [
          {
            campo: 'matricula',
            problema: 'não parece uma matrícula portuguesa',
          },
        ],
        dizer: 'Essa matrícula não me parece certa. Pode dizer-ma outra vez?',
      };
    }
    if (!e.confirmado) {
      return {
        feito: false,
        confirmar: true,
        resumo: {
          morada: e.morada,
          nome: e.nome,
          matricula: mat,
          tem_cartao: e.tem_cartao,
        },
        ler_a_pessoa:
          `Vou registar o pedido de lugar de estacionamento reservado em ${e.morada}, em nome de ${e.nome}` +
          (mat ? `, para o carro ${mat}` : '') +
          `. ${e.tem_cartao ? 'Tem o cartão de estacionamento.' : 'Ainda não tem o cartão de estacionamento.'} Confirma?`,
      };
    }
    const m = ctx.municipio;
    const r = await this.db.transaction(async (tx) => {
      const mu = await this.municipeDe(ctx, tx);
      const telefone = normalizarTelefone(ctx.telefone) ?? mu?.telefone ?? null;
      const ano = new Date().getFullYear();
      const numero = `${SERIE_LUGAR} ${await proximoNumero(tx, m.id, SERIE_LUGAR, ano)}/${ano}`;
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO estacionamento_lugares_pedidos (municipio_id, numero, municipe_id, conversa_id, canal,
           nome, telefone, morada, matricula, tem_cartao, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          m.id,
          numero,
          mu?.id ?? null,
          ctx.conversaId,
          ctx.canal,
          e.nome,
          telefone,
          e.morada,
          mat,
          e.tem_cartao,
          e.observacoes ?? null,
        ],
      );
      if (mu?.id) {
        await tx.query(
          'UPDATE municipes SET nome = coalesce(nome, $2) WHERE id = $1',
          [mu.id, e.nome],
        );
      }
      if (telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: mu?.id ?? null,
            destino: telefone,
            motivo: 'processo',
            corpo: `${m.nome}: recebemos o pedido de lugar reservado ${numero} (${e.morada}). Leve ao balcão o cartão de estacionamento e o comprovativo de morada. Respondemos por SMS.`,
            relacionado: {
              lugar_pedido_id: p.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `estacionamento_lugar:${p.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { estacionamento_lugar_id: p.id, numero },
        tx,
      );
      return { id: p.id, numero };
    });
    const R = REGRAS_LUGAR_DEFICIENCIA;
    return {
      feito: true,
      numero: r.numero,
      pedido_id: r.id,
      documentos: R.documentos,
      resposta_em_dias_uteis: R.resposta_dias_uteis,
      regras_de_demonstracao: R.demonstracao,
      dizer:
        `Ficou registado o pedido ${r.numero}. ` +
        (e.tem_cartao
          ? ''
          : 'Para o lugar ser aprovado vai precisar do cartão de estacionamento para pessoas com deficiência, que se pede no IMT. ') +
        `O serviço de trânsito vai ver o local e responde por SMS, normalmente em ${R.resposta_dias_uteis} dias úteis. ` +
        `Tenha à mão: ${R.documentos.map((d) => d.toLowerCase()).join('; ')}.`,
    };
  }

  /** O dístico de residente é uma licença: o agente segue pelo pedir_licenca. */
  disticoResidente() {
    return Promise.resolve({
      feito: false,
      usar_licenca: 'distico_residente',
      instrucao:
        'O dístico de residente pede-se como licença: chama campos_da_licenca com tipo distico_residente, pergunta os campos e depois pedir_licenca com esse tipo.',
    });
  }

  // -------------------------------------------------------------------
  // Depois do pagamento
  // -------------------------------------------------------------------

  /** Multas com o pagamento feito passam a 'paga'. No job e antes das leituras. */
  async sincronizar(municipioId?: string): Promise<number> {
    const pagas = await this.db.query<{ id: string }>(
      `UPDATE estacionamento_multas m SET estado = 'paga', atualizada_em = now(),
         paga_em = (SELECT max(pg.pago_em) FROM pagamentos pg WHERE pg.processo_id = m.processo_id AND pg.estado = 'pago')
       WHERE m.estado = 'por_pagar' AND m.processo_id IS NOT NULL
         AND ($1::uuid IS NULL OR m.municipio_id = $1)
         AND EXISTS (SELECT 1 FROM pagamentos pg WHERE pg.processo_id = m.processo_id AND pg.estado = 'pago')
       RETURNING m.id, m.processo_id`,
      [municipioId ?? null],
    );
    if (pagas.length) {
      await this.db.query(
        `UPDATE processos SET fase = 'arquivado', decisao = 'admitido', decidido_em = now(), atualizado_em = now()
         WHERE id IN (SELECT processo_id FROM estacionamento_multas WHERE id = ANY($1::uuid[]))`,
        [pagas.map((p) => p.id)],
      );
    }
    return pagas.length;
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  async painel(m: Municipio) {
    await this.sincronizar(m.id);
    const hoje = this.hoje(m);
    const multas = await this.db.query<LinhaMulta>(
      `SELECT ${COLUNAS_MULTA} FROM estacionamento_multas m
       WHERE m.municipio_id = $1
       ORDER BY (m.estado = 'em_defesa') DESC, m.verificada_em DESC LIMIT 200`,
      [m.id],
    );
    const defesas = await this.db.query<{
      id: string;
      multa_id: string;
      numero_auto: string;
      matricula: string;
      infracao: string;
      valor_cent: number;
      nome: string | null;
      telefone: string | null;
      texto: string;
      estado: string;
      nota: string | null;
      decidida_por_nome: string | null;
      decidida_em: Date | null;
      conversa_id: string | null;
      canal: string;
      criada_em: Date;
    }>(
      `SELECT d.id, d.multa_id, m.numero_auto, m.matricula, m.infracao, m.valor_cent, d.nome, d.telefone,
              d.texto, d.estado, d.nota, u.nome AS decidida_por_nome, d.decidida_em, d.conversa_id,
              d.canal, d.criada_em
       FROM estacionamento_defesas d
       JOIN estacionamento_multas m ON m.id = d.multa_id
       LEFT JOIN utilizadores u ON u.id = d.decidida_por
       WHERE d.municipio_id = $1
       ORDER BY (d.estado = 'por_analisar') DESC, d.criada_em DESC LIMIT 100`,
      [m.id],
    );
    const lugares = await this.db.query<
      { estado: string } & Record<string, unknown>
    >(
      `SELECT p.id, p.numero, p.nome, p.telefone, p.morada, p.matricula, p.tem_cartao, p.observacoes,
              p.estado, p.nota, u.nome AS decidido_por_nome, p.decidido_em, p.conversa_id, p.canal, p.criado_em
       FROM estacionamento_lugares_pedidos p
       LEFT JOIN utilizadores u ON u.id = p.decidido_por
       WHERE p.municipio_id = $1
       ORDER BY (p.estado = 'recebido') DESC, p.criado_em DESC LIMIT 100`,
      [m.id],
    );
    const parques = await this.parques(m.id);
    const conta = (l: { estado: unknown }[], e: string) =>
      l.filter((x) => x.estado === e).length;
    return {
      contagens: {
        multas_por_pagar: conta(multas, 'por_pagar'),
        multas_em_defesa: conta(multas, 'em_defesa'),
        multas_pagas: conta(multas, 'paga'),
        defesas_por_analisar: conta(defesas, 'por_analisar'),
        lugares_por_decidir: conta(lugares, 'recebido'),
      },
      multas: multas.map((x) => ({
        id: x.id,
        numero_auto: x.numero_auto,
        matricula: x.matricula,
        infracao: x.infracao,
        local: x.local,
        verificada_em: x.verificada_em,
        valor_cent: x.valor_cent,
        prazo_pagamento: x.prazo_pagamento,
        prazo_defesa: x.prazo_defesa,
        estado: x.estado,
        processo_id: x.processo_id,
        paga_em: x.paga_em,
        demonstracao: x.demonstracao,
        fora_do_prazo: situacaoMulta(x, hoje).fora_do_prazo_pagamento,
      })),
      defesas,
      lugares,
      parques: parques.map((p) => ({
        ...p,
        horario_dito: horarioDito(p.horario),
        tarifa_dita: tarifaDita(p.tarifa),
      })),
      regras: { multas: REGRAS_MULTAS, lugares: REGRAS_LUGAR_DEFICIENCIA },
    };
  }

  async decidirDefesa(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaDecisaoDefesa>,
  ) {
    const feriados = await this.municipios.feriados(m.id);
    const novoPrazo = somarDiasUteis(
      this.hoje(m),
      REGRAS_MULTAS.prazo_dias_uteis,
      feriados,
    );
    await this.db.transaction(async (tx) => {
      const [d] = await tx.query<{
        multa_id: string;
        municipe_id: string | null;
        telefone: string | null;
        numero_auto: string;
        valor_cent: number;
      }>(
        `UPDATE estacionamento_defesas d SET estado = $3, nota = $4, decidida_por = $5, decidida_em = now()
         FROM estacionamento_multas m
         WHERE d.id = $1 AND d.municipio_id = $2 AND d.estado = 'por_analisar' AND m.id = d.multa_id
         RETURNING d.multa_id, d.municipe_id, d.telefone, m.numero_auto, m.valor_cent`,
        [id, m.id, e.decisao, e.nota, u.id],
      );
      if (!d) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'defesa_desconhecida',
          'Esta defesa não existe ou já foi decidida.',
        );
      }
      if (e.decisao === 'aceite') {
        await tx.query(
          `UPDATE estacionamento_multas SET estado = 'anulada', atualizada_em = now() WHERE id = $1`,
          [d.multa_id],
        );
      } else {
        // Recusada: volta a poder pagar-se, com um prazo novo a contar de hoje.
        await tx.query(
          `UPDATE estacionamento_multas SET estado = 'por_pagar', prazo_pagamento = greatest(prazo_pagamento, $2::date),
             atualizada_em = now() WHERE id = $1`,
          [d.multa_id, novoPrazo],
        );
      }
      if (d.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: d.municipe_id,
            destino: d.telefone,
            motivo: 'processo',
            corpo:
              e.decisao === 'aceite'
                ? `${m.nome}: a sua defesa da multa ${d.numero_auto} foi aceite e a multa foi anulada. ${e.nota}`
                : `${m.nome}: a sua defesa da multa ${d.numero_auto} não foi aceite. ${e.nota} Pode pagar ${formatarEuros(d.valor_cent)} até ${diaDito(novoPrazo)}: ligue-nos ou escreva-nos.`,
            relacionado: { defesa_id: id },
            chave: `estacionamento_defesa_decisao:${id}`,
          },
          tx,
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao:
            e.decisao === 'aceite'
              ? 'aceitar_defesa_multa'
              : 'recusar_defesa_multa',
          objetoTipo: 'defesa_multa',
          objetoId: id,
          dados: { numero_auto: d.numero_auto },
        },
        tx,
      );
    });
    return { ok: true };
  }

  async decidirLugar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaDecisaoLugar>,
  ) {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.query<{
        numero: string;
        municipe_id: string | null;
        telefone: string | null;
        morada: string;
      }>(
        `UPDATE estacionamento_lugares_pedidos SET estado = $3, nota = $4, decidido_por = $5, decidido_em = now()
         WHERE id = $1 AND municipio_id = $2 AND estado = 'recebido'
         RETURNING numero, municipe_id, telefone, morada`,
        [id, m.id, e.decisao, e.nota, u.id],
      );
      if (!p) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'pedido_desconhecido',
          'Este pedido não existe ou já foi decidido.',
        );
      }
      if (p.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: p.municipe_id,
            destino: p.telefone,
            motivo: 'processo',
            corpo:
              e.decisao === 'aprovado'
                ? `${m.nome}: o pedido de lugar reservado ${p.numero} (${p.morada}) foi aprovado. ${e.nota}`
                : `${m.nome}: o pedido de lugar reservado ${p.numero} (${p.morada}) não foi aprovado. ${e.nota}`,
            relacionado: { lugar_pedido_id: id },
            chave: `estacionamento_lugar_decisao:${id}`,
          },
          tx,
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao:
            e.decisao === 'aprovado'
              ? 'aprovar_lugar_reservado'
              : 'recusar_lugar_reservado',
          objetoTipo: 'lugar_reservado',
          objetoId: id,
          dados: { numero: p.numero },
        },
        tx,
      );
    });
    return { ok: true };
  }

  /**
   * Parques e multas de demonstração (só os que faltam, pela chave). As
   * datas das multas são relativas a hoje, com os prazos de 15 dias úteis.
   */
  async carregarDemonstracao(m: Municipio, u: UtilizadorPainel | null) {
    const feriados = await this.municipios.feriados(m.id);
    const hoje = this.hoje(m);
    let parques = 0;
    let multas = 0;
    await this.db.transaction(async (tx) => {
      for (const p of PARQUES_DEMO) {
        const r = await tx.query(
          `INSERT INTO estacionamento_parques (municipio_id, chave, nome, tipo, morada, zonas, lat, lng,
             lugares, lugares_deficiencia, horario, tarifa, pagamento_telemovel, notas, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true)
           ON CONFLICT (municipio_id, chave) DO NOTHING RETURNING id`,
          [
            m.id,
            p.chave,
            p.nome,
            p.tipo,
            p.morada,
            p.zonas,
            p.lat,
            p.lng,
            p.lugares,
            p.lugares_deficiencia,
            JSON.stringify(p.horario),
            JSON.stringify(p.tarifa),
            p.pagamento_telemovel,
            p.notas,
          ],
        );
        parques += r.length;
      }
      for (const x of MULTAS_DEMO) {
        const d = new Date(`${hoje}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - x.dias_atras);
        const dia = d.toISOString().slice(0, 10);
        const prazo = somarDiasUteis(
          dia,
          REGRAS_MULTAS.prazo_dias_uteis,
          feriados,
        );
        const r = await tx.query(
          `INSERT INTO estacionamento_multas (municipio_id, numero_auto, matricula, infracao, norma, local,
             verificada_em, valor_cent, valor_maximo_cent, prazo_pagamento, prazo_defesa, estado, paga_em,
             demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11,
             CASE WHEN $11 = 'paga' THEN now() END, true)
           ON CONFLICT (municipio_id, numero_auto) DO NOTHING RETURNING id`,
          [
            m.id,
            x.numero_auto,
            x.matricula,
            x.infracao,
            x.norma,
            x.local,
            instanteLocal(dia, x.hora, m.fuso),
            x.valor_cent,
            x.valor_maximo_cent,
            prazo,
            x.estado,
          ],
        );
        multas += r.length;
      }
      if (u) {
        await this.auditoria.registar(
          {
            municipioId: m.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'carregar_estacionamento_demonstracao',
            objetoTipo: 'estacionamento',
            objetoId: m.id,
            dados: { parques, multas },
          },
          tx,
        );
      }
    });
    return {
      parques,
      multas,
      demonstracao: true,
      dizer: maiuscula(
        `${parques} parques e ${multas} multas de demonstração carregados.`,
      ),
    };
  }
}
