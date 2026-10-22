import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  CANDIDATURAS_DEMO,
  CONTRATOS_DEMO,
  FOGOS_DEMO,
  REPARACOES_DEMO,
} from './habitacao.conteudo.js';
import {
  avaliarCandidatura,
  CATEGORIAS_REPARACAO,
  CategoriaReparacao,
  classificarReparacao,
  estimarRenda,
  eurosTexto,
  limiteRendimento,
  proximasPrestacoes,
  Regime,
  REGRAS_HABITACAO,
  ROTULO_REGIME,
  SITUACOES,
  Situacao,
} from './regras.js';

// ---------------------------------------------------------------------------
// Entradas das ações do catálogo (área "habitacao")
// ---------------------------------------------------------------------------

const regime = z
  .enum(['apoiado', 'acessivel'])
  .describe(
    'apoiado (habitação social, renda pelo rendimento) ou acessivel (renda acessível).',
  );
const agregado = z
  .number()
  .int()
  .min(1)
  .max(15)
  .describe(
    'Quantas pessoas vivem na casa (o agregado), contando com quem fala.',
  );
const rendimentoAnual = z
  .number()
  .min(0)
  .max(500_000)
  .describe('Rendimento bruto anual de todo o agregado, em euros.');

export const entradaCriterios = z.object({
  regime: regime.optional(),
  agregado: agregado.optional(),
  rendimento_anual: rendimentoAnual.optional(),
});

export const entradaPreCandidatura = z.object({
  regime,
  agregado,
  rendimento_anual: rendimentoAnual,
  situacao: z
    .enum(Object.keys(SITUACOES) as [Situacao, ...Situacao[]])
    .describe(
      'Onde vive agora: sem_casa, despejo, sem_condicoes, sobrelotacao, renda_excessiva ou adequada.',
    ),
  menores: z
    .number()
    .int()
    .min(0)
    .max(12)
    .optional()
    .describe('Quantos menores de 18 anos.'),
  idosos_ou_deficiencia: z
    .number()
    .int()
    .min(0)
    .max(12)
    .optional()
    .describe('Quantas pessoas com 65 anos ou mais ou com deficiência.'),
  anos_residencia: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Há quantos anos vive no concelho.'),
  casa_propria: z
    .boolean()
    .optional()
    .describe('Alguém do agregado tem casa própria?'),
});

export const entradaEstadoCandidatura = z.object({
  codigo: z
    .string()
    .trim()
    .min(4)
    .max(20)
    .optional()
    .describe('Código da candidatura, se tiver.'),
});

export const entradaRenda = z.object({});

export const entradaPedirReparacao = z.object({
  categoria: z
    .enum(
      Object.keys(CATEGORIAS_REPARACAO) as [
        CategoriaReparacao,
        ...CategoriaReparacao[],
      ],
    )
    .describe(
      'Tipo: agua, gas, eletricidade, infiltracoes, humidade, portas_janelas, aquecimento, elevador ou outro.',
    ),
  descricao: z
    .string()
    .trim()
    .min(5)
    .max(600)
    .describe('O que se passa, por palavras da pessoa.'),
  urgente: z
    .boolean()
    .optional()
    .describe('Há perigo ou estragos a aumentar agora?'),
});

export const entradaRevisaoRenda = z.object({
  rendimento_mensal: z
    .number()
    .min(0)
    .max(50_000)
    .describe('Rendimento mensal líquido de todo o agregado agora, em euros.'),
  agregado,
  motivo: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('O que mudou (desemprego, reforma, alguém saiu de casa…).'),
});

export const esquemaMudarCandidatura = z.object({
  estado: z.enum([
    'submetida',
    'em_analise',
    'admitida',
    'excluida',
    'atribuida',
  ]),
  nota: z.string().trim().max(1000).optional(),
});

export const esquemaMudarReparacao = z
  .object({
    estado: z
      .enum(['registada', 'atribuida', 'em_curso', 'concluida'])
      .optional(),
    atribuida_a: z.string().trim().min(2).max(120).optional(),
  })
  .refine((x) => x.estado || x.atribuida_a, {
    message: 'Indique o estado ou a quem fica atribuída.',
  });

// ---------------------------------------------------------------------------

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function novoCodigo(): string {
  return `HAB-${Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')}`;
}

const DIA = new Intl.DateTimeFormat('pt-PT', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const porExtenso = (d: string) => DIA.format(new Date(`${d}T12:00:00Z`));

const ESTADO_CANDIDATURA: Record<string, string> = {
  submetida: 'foi recebida e aguarda análise',
  em_analise: 'está em análise',
  admitida: 'foi admitida e está na lista de espera por pontuação',
  excluida: 'foi excluída',
  atribuida: 'teve uma casa atribuída',
};

interface Pessoa {
  id: string;
  nome: string | null;
  telefone: string | null;
}

interface Contrato {
  id: string;
  regime: Regime;
  renda_cent: number;
  dia_vencimento: number;
  em_divida_cent: number;
  agregado: number;
  morada: string;
  fogo_id: string;
}

/**
 * Habitação municipal (V4 #7): candidaturas com pontuação provisória e, para
 * os inquilinos, a renda, as reparações e a revisão da renda. As ações do
 * agente estão no catálogo (área "habitacao").
 */
@Injectable()
export class HabitacaoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly mensagens: MensagensService,
  ) {}

  // -------------------------------------------------------------------
  // Agente
  // -------------------------------------------------------------------

  private async pessoa(ctx: ContextoFerramenta): Promise<Pessoa | null> {
    if (!ctx.municipeId) return null;
    const [mu] = await this.db.query<Pessoa & { tem_nif: boolean }>(
      `SELECT id, nome, telefone_e164 AS telefone, nif_hash IS NOT NULL AS tem_nif
       FROM municipes WHERE id = $1 AND municipio_id = $2 AND anonimizado_em IS NULL`,
      [ctx.municipeId, ctx.municipio.id],
    );
    if (!mu || !(mu.tem_nif || ctx.canal === 'ia')) return null;
    return { id: mu.id, nome: mu.nome, telefone: mu.telefone };
  }

  private semIdentificacao() {
    return {
      feito: false,
      motivo: 'precisa_identificacao',
      instrucao:
        'Isto é em nome da pessoa (rendimentos, contrato): pede o NIF e usa identificar_municipe; depois chama outra vez pedir_servico com os mesmos dados.',
    };
  }

  private async contrato(municipeId: string): Promise<Contrato | null> {
    const [c] = await this.db.query<Contrato>(
      `SELECT c.id, c.regime, c.renda_cent, c.dia_vencimento, c.em_divida_cent, c.agregado,
              f.morada, f.id AS fogo_id
       FROM habitacao_contratos c JOIN habitacao_fogos f ON f.id = c.fogo_id
       WHERE c.municipe_id = $1 AND c.estado = 'ativo'
       ORDER BY c.inicio DESC LIMIT 1`,
      [municipeId],
    );
    return c ?? null;
  }

  private semContrato() {
    return {
      feito: false,
      motivo: 'sem_contrato',
      dizer:
        'Não encontro um contrato de habitação municipal em seu nome. Se é inquilino da câmara, pode ser que o contrato esteja em nome de outra pessoa da casa: passo a um funcionário da habitação.',
    };
  }

  criterios(e: z.output<typeof entradaCriterios>) {
    const regimes: Regime[] = e.regime ? [e.regime] : ['apoiado', 'acessivel'];
    const n = e.agregado ?? 1;
    const limites = regimes.map((r) => ({
      regime: ROTULO_REGIME[r],
      agregado: n,
      limite_anual: eurosTexto(limiteRendimento(r, n)),
      cabe:
        e.rendimento_anual !== undefined
          ? Math.round(e.rendimento_anual * 100) <= limiteRendimento(r, n)
          : undefined,
    }));
    const frases = limites.map(
      (l) =>
        `${l.regime}: rendimento anual bruto até ${l.limite_anual} para ${n} ${n === 1 ? 'pessoa' : 'pessoas'}${
          l.cabe === undefined
            ? ''
            : l.cabe
              ? ' (o seu rendimento cabe)'
              : ' (o seu rendimento passa o limite)'
        }`,
    );
    return {
      limites,
      requisitos: [
        'Viver ou trabalhar no concelho.',
        'Ninguém do agregado ter casa própria adequada.',
        'Rendimento do agregado dentro do limite.',
      ],
      pontuacao: [
        'situação da casa (até 30 pontos)',
        'rendimento por pessoa (até 25)',
        'crianças e jovens (até 15)',
        'idosos ou pessoas com deficiência (até 15)',
        'anos a viver no concelho (até 15)',
      ],
      fontes: REGRAS_HABITACAO.fontes,
      valores_de_demonstracao: true,
      dizer: `${frases.join('. ')}. É preciso viver ou trabalhar no concelho e não ter casa própria. As candidaturas são ordenadas por pontos: situação da casa, rendimento por pessoa, crianças, idosos ou pessoas com deficiência e anos no concelho. Posso fazer já a pré-candidatura e dizer a pontuação provisória. Estes critérios ainda estão por confirmar pela câmara.`,
    };
  }

  async preCandidatura(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPreCandidatura>,
  ) {
    const p = await this.pessoa(ctx);
    if (!p) return this.semIdentificacao();
    const m = ctx.municipio;
    const dados = {
      regime: e.regime,
      agregado: e.agregado,
      rendimento_anual_cent: Math.round(e.rendimento_anual * 100),
      situacao: e.situacao,
      menores: e.menores,
      idosos_ou_deficiencia: e.idosos_ou_deficiencia,
      anos_residencia: e.anos_residencia,
      casa_propria: e.casa_propria,
    };
    const [aberta] = await this.db.query<{ codigo: string; pontuacao: number }>(
      `SELECT codigo, pontuacao FROM habitacao_candidaturas
       WHERE municipe_id = $1 AND regime = $2 AND estado IN ('submetida','em_analise','admitida')`,
      [p.id, e.regime],
    );
    if (aberta) {
      return {
        feito: false,
        motivo: 'ja_existe',
        codigo: aberta.codigo,
        pontuacao: aberta.pontuacao,
        dizer: `Já tem uma candidatura a ${ROTULO_REGIME[e.regime]} (código ${aberta.codigo}, ${aberta.pontuacao} pontos provisórios). Se a situação mudou, um funcionário da habitação atualiza-a.`,
      };
    }
    const av = avaliarCandidatura(dados);
    const codigo = novoCodigo();
    await this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO habitacao_candidaturas (municipio_id, municipe_id, codigo, regime, agregado,
           rendimento_anual_cent, dados, elegivel, pontuacao, criterios, estado, conversa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          m.id,
          p.id,
          codigo,
          e.regime,
          e.agregado,
          dados.rendimento_anual_cent,
          JSON.stringify(dados),
          av.elegivel,
          av.pontuacao,
          JSON.stringify({
            lista: av.criterios,
            exclusoes: av.exclusoes,
            limite_cent: av.limite_cent,
          }),
          av.elegivel ? 'submetida' : 'excluida',
          ctx.conversaId,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'registar_candidatura_habitacao',
          objetoTipo: 'candidatura_habitacao',
          objetoId: c.id,
          dados: { codigo, pontuacao: av.pontuacao, elegivel: av.elegivel },
        },
        tx,
      );
    });
    const pontos = av.criterios
      .filter((c) => c.pontos > 0)
      .map((c) => `${c.criterio.toLowerCase()} ${c.pontos}`)
      .join(', ');
    return {
      feito: true,
      codigo,
      regime: ROTULO_REGIME[e.regime],
      elegivel: av.elegivel,
      exclusoes: av.exclusoes.length ? av.exclusoes : undefined,
      pontuacao_provisoria: av.pontuacao,
      maximo: 100,
      criterios: av.criterios,
      valores_de_demonstracao: true,
      dizer: av.elegivel
        ? `Fiz a pré-candidatura a ${ROTULO_REGIME[e.regime]}, com o código ${codigo}. A pontuação provisória é ${av.pontuacao} em 100${pontos ? ` (${pontos})` : ''}. A câmara confirma os documentos e a pontuação final; as casas são atribuídas por ordem de pontos. Estes critérios ainda estão por confirmar pela câmara.`
        : `Registei a pré-candidatura com o código ${codigo}, mas pelos dados que me deu não cumpre os requisitos: ${av.exclusoes.join(' ')} Um funcionário da habitação pode rever o caso. Estes critérios ainda estão por confirmar pela câmara.`,
    };
  }

  async estadoCandidatura(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaEstadoCandidatura>,
  ) {
    const p = await this.pessoa(ctx);
    if (!p) return this.semIdentificacao();
    const lista = await this.db.query<{
      codigo: string;
      regime: Regime;
      estado: string;
      pontuacao: number;
      nota: string | null;
      criado_em: Date;
    }>(
      `SELECT codigo, regime, estado, pontuacao, nota, criado_em FROM habitacao_candidaturas
       WHERE municipe_id = $1 AND ($2::text IS NULL OR upper(codigo) = upper($2))
       ORDER BY criado_em DESC LIMIT 5`,
      [p.id, e.codigo ?? null],
    );
    if (!lista.length) {
      return {
        encontrado: false,
        dizer: e.codigo
          ? `Não encontro a candidatura ${e.codigo} em seu nome.`
          : 'Não tem nenhuma candidatura a habitação municipal. Quer saber os critérios ou fazer a pré-candidatura?',
      };
    }
    return {
      encontrado: true,
      candidaturas: lista.map((c) => ({
        codigo: c.codigo,
        regime: ROTULO_REGIME[c.regime],
        estado: c.estado,
        pontuacao: c.pontuacao,
      })),
      dizer: lista
        .map(
          (c) =>
            `A candidatura ${c.codigo} a ${ROTULO_REGIME[c.regime]} ${ESTADO_CANDIDATURA[c.estado]}, com ${c.pontuacao} pontos${c.nota ? `. Nota da câmara: ${c.nota}` : ''}.`,
        )
        .join(' '),
    };
  }

  async renda(ctx: ContextoFerramenta) {
    const p = await this.pessoa(ctx);
    if (!p) return this.semIdentificacao();
    const c = await this.contrato(p.id);
    if (!c) return this.semContrato();
    const prestacoes = proximasPrestacoes(
      hojeLisboa(),
      c.dia_vencimento,
      c.renda_cent,
    );
    return {
      encontrado: true,
      casa: c.morada,
      regime: ROTULO_REGIME[c.regime],
      renda: eurosTexto(c.renda_cent),
      vence_ao_dia: c.dia_vencimento,
      proximas: prestacoes.map((x) => ({
        vence: x.vence,
        valor: eurosTexto(x.valor_cent),
      })),
      em_divida: c.em_divida_cent ? eurosTexto(c.em_divida_cent) : undefined,
      dizer: `A sua renda é de ${eurosTexto(c.renda_cent)} por mês e vence ao dia ${c.dia_vencimento}. As próximas: ${prestacoes
        .map((x) => porExtenso(x.vence))
        .join(', ')}.${
        c.em_divida_cent
          ? ` Tem ${eurosTexto(c.em_divida_cent)} em atraso; se precisar, pode pedir um acordo de pagamento à habitação.`
          : ' Não tem rendas em atraso.'
      }`,
    };
  }

  async pedirReparacao(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPedirReparacao>,
  ) {
    const p = await this.pessoa(ctx);
    if (!p) return this.semIdentificacao();
    const c = await this.contrato(p.id);
    if (!c) return this.semContrato();
    const m = ctx.municipio;
    const cl = classificarReparacao(e);
    const codigo = novoCodigo();
    await this.db.transaction(async (tx) => {
      const [r] = await tx.query<{ id: string }>(
        `INSERT INTO habitacao_reparacoes (municipio_id, contrato_id, municipe_id, codigo, categoria,
           descricao, urgencia, conversa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          m.id,
          c.id,
          p.id,
          codigo,
          e.categoria,
          e.descricao,
          cl.urgencia,
          ctx.conversaId,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'pedir_reparacao_habitacao',
          objetoTipo: 'reparacao_habitacao',
          objetoId: r.id,
          dados: { codigo, urgencia: cl.urgencia },
        },
        tx,
      );
    });
    const piquete = REGRAS_HABITACAO.piquete;
    const urgente = cl.urgencia === 'urgente';
    return {
      feito: true,
      codigo,
      urgencia: cl.urgencia,
      perigo: cl.perigo || undefined,
      piquete: urgente ? piquete : undefined,
      instrucao: cl.perigo
        ? 'Há perigo: antes de tudo diz para sair de casa ou afastar-se e ligar 112; depois dá o número do piquete.'
        : urgente
          ? 'Dá o número do piquete para ligar já.'
          : undefined,
      valores_de_demonstracao: urgente || undefined,
      dizer: [
        cl.perigo
          ? 'Se há cheiro a gás, faíscas, fumo ou risco de desabar, saia de casa e ligue já o 112.'
          : '',
        `Registei o pedido de reparação em ${c.morada}, com o código ${codigo}.`,
        urgente
          ? `Como é urgente, ligue também agora para o piquete da habitação: ${piquete}. Este número ainda está por confirmar pela câmara.`
          : 'A equipa de manutenção marca a visita e avisa por SMS.',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  async revisaoRenda(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaRevisaoRenda>,
  ) {
    const p = await this.pessoa(ctx);
    if (!p) return this.semIdentificacao();
    const c = await this.contrato(p.id);
    if (!c) return this.semContrato();
    const m = ctx.municipio;
    const rendimento = Math.round(e.rendimento_mensal * 100);
    const est = estimarRenda({
      regime: c.regime,
      rendimento_mensal_cent: rendimento,
      agregado: e.agregado,
      renda_atual_cent: c.renda_cent,
    });
    const codigo = novoCodigo();
    const aberta = await this.db.transaction(async (tx) => {
      const [ja] = await tx.query<{ codigo: string }>(
        `SELECT codigo FROM habitacao_revisoes_renda
         WHERE contrato_id = $1 AND estado IN ('pedida','em_analise')`,
        [c.id],
      );
      if (ja) return ja.codigo;
      const [r] = await tx.query<{ id: string }>(
        `INSERT INTO habitacao_revisoes_renda (municipio_id, contrato_id, municipe_id, codigo,
           rendimento_mensal_cent, agregado, motivo, renda_atual_cent, renda_estimada_cent, conversa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          m.id,
          c.id,
          p.id,
          codigo,
          rendimento,
          e.agregado,
          e.motivo,
          c.renda_cent,
          est.renda_cent,
          ctx.conversaId,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'pedir_revisao_renda',
          objetoTipo: 'revisao_renda',
          objetoId: r.id,
          dados: { codigo },
        },
        tx,
      );
      return null;
    });
    if (aberta) {
      return {
        feito: false,
        motivo: 'ja_pedida',
        codigo: aberta,
        dizer: `Já tem um pedido de revisão da renda em análise (código ${aberta}).`,
      };
    }
    const desce = est.renda_cent < c.renda_cent;
    return {
      feito: true,
      codigo,
      renda_atual: eurosTexto(c.renda_cent),
      renda_estimada: eurosTexto(est.renda_cent),
      documentos: [
        'Comprovativos de rendimentos de todas as pessoas da casa (últimos 3 meses)',
        'Declaração da Segurança Social ou do centro de emprego, se for o caso',
      ],
      valores_de_demonstracao: true,
      dizer: `Registei o pedido de revisão da renda, com o código ${codigo}. Pelas contas provisórias, a renda passaria de ${eurosTexto(c.renda_cent)} para cerca de ${eurosTexto(est.renda_cent)}${desce ? '' : ' (não desce com estes valores)'}. A câmara vai pedir os comprovativos de rendimentos de todas as pessoas da casa e só depois decide. Estas contas ainda estão por confirmar pela câmara.`,
    };
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  async painel(m: Municipio) {
    const [c] = await this.db.query<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM habitacao_fogos WHERE municipio_id = $1) AS fogos,
         (SELECT count(*)::int FROM habitacao_fogos WHERE municipio_id = $1 AND estado = 'livre') AS fogos_livres,
         (SELECT count(*)::int FROM habitacao_candidaturas WHERE municipio_id = $1
            AND estado IN ('submetida','em_analise')) AS candidaturas_por_analisar,
         (SELECT count(*)::int FROM habitacao_reparacoes WHERE municipio_id = $1
            AND estado <> 'concluida') AS reparacoes_abertas,
         (SELECT count(*)::int FROM habitacao_reparacoes WHERE municipio_id = $1
            AND estado <> 'concluida' AND urgencia = 'urgente') AS reparacoes_urgentes,
         (SELECT count(*)::int FROM habitacao_revisoes_renda WHERE municipio_id = $1
            AND estado IN ('pedida','em_analise')) AS revisoes_abertas`,
      [m.id],
    );
    return {
      contagens: c,
      regras: {
        ...REGRAS_HABITACAO,
        situacoes: SITUACOES,
        limites: {
          apoiado: [1, 2, 3, 4, 5].map((n) => ({
            agregado: n,
            limite_cent: limiteRendimento('apoiado', n),
          })),
          acessivel: [1, 2, 3, 4, 5].map((n) => ({
            agregado: n,
            limite_cent: limiteRendimento('acessivel', n),
          })),
        },
      },
    };
  }

  async candidaturas(m: Municipio, estado?: string) {
    const candidaturas = await this.db.query(
      `SELECT c.id, c.codigo, c.regime, c.agregado, c.rendimento_anual_cent, c.dados, c.elegivel,
              c.pontuacao, c.criterios, c.estado, c.nota, c.demonstracao, c.criado_em, c.atualizado_em,
              mu.nome, mu.telefone_e164 AS telefone
       FROM habitacao_candidaturas c JOIN municipes mu ON mu.id = c.municipe_id
       WHERE c.municipio_id = $1 AND ($2::text IS NULL OR c.estado = $2)
       ORDER BY c.elegivel DESC, c.pontuacao DESC, c.criado_em LIMIT 300`,
      [m.id, estado ?? null],
    );
    return { candidaturas };
  }

  async mudarCandidatura(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaMudarCandidatura>,
  ) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.query<{
        id: string;
        codigo: string;
        estado: string;
      }>(
        `UPDATE habitacao_candidaturas SET estado = $3, nota = coalesce($4, nota), atualizado_em = now()
         WHERE id = $1 AND municipio_id = $2
         RETURNING id, codigo, estado`,
        [id, m.id, d.estado, d.nota ?? null],
      );
      if (!c)
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Candidatura não encontrada.',
        );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'mudar_estado_candidatura_habitacao',
          objetoTipo: 'candidatura_habitacao',
          objetoId: id,
          dados: { codigo: c.codigo, estado: d.estado },
        },
        tx,
      );
      return c;
    });
  }

  async reparacoes(m: Municipio, estado?: string) {
    const reparacoes = await this.db.query(
      `SELECT r.id, r.codigo, r.categoria, r.descricao, r.urgencia, r.estado, r.atribuida_a,
              r.criado_em, r.atualizado_em, f.morada, f.codigo AS fogo, mu.nome AS inquilino,
              mu.telefone_e164 AS telefone
       FROM habitacao_reparacoes r
       JOIN habitacao_contratos c ON c.id = r.contrato_id
       JOIN habitacao_fogos f ON f.id = c.fogo_id
       JOIN municipes mu ON mu.id = r.municipe_id
       WHERE r.municipio_id = $1 AND ($2::text IS NULL OR r.estado = $2)
       ORDER BY (r.estado = 'concluida'), (r.urgencia = 'urgente') DESC, r.criado_em DESC LIMIT 300`,
      [m.id, estado ?? null],
    );
    return { reparacoes, categorias: CATEGORIAS_REPARACAO };
  }

  async mudarReparacao(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaMudarReparacao>,
  ) {
    return this.db.transaction(async (tx) => {
      const [antes] = await tx.query<{
        estado: string;
        codigo: string;
        municipe_id: string;
        telefone: string | null;
      }>(
        `SELECT r.estado, r.codigo, r.municipe_id, mu.telefone_e164 AS telefone
         FROM habitacao_reparacoes r JOIN municipes mu ON mu.id = r.municipe_id
         WHERE r.id = $1 AND r.municipio_id = $2 FOR UPDATE OF r`,
        [id, m.id],
      );
      if (!antes)
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Reparação não encontrada.',
        );
      // Atribuir sem estado passa a "atribuída" (se ainda estava registada).
      const estado =
        d.estado ??
        (d.atribuida_a && antes.estado === 'registada'
          ? 'atribuida'
          : antes.estado);
      const [r] = await tx.query<{
        id: string;
        estado: string;
        atribuida_a: string | null;
      }>(
        `UPDATE habitacao_reparacoes SET estado = $2, atribuida_a = coalesce($3, atribuida_a),
           atualizado_em = now()
         WHERE id = $1 RETURNING id, estado, atribuida_a`,
        [id, estado, d.atribuida_a ?? null],
      );
      let sms = false;
      if (
        estado === 'concluida' &&
        antes.estado !== 'concluida' &&
        antes.telefone
      ) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: antes.municipe_id,
            destino: antes.telefone,
            motivo: 'processo',
            corpo: `${m.nome}: a reparacao ${antes.codigo} na sua casa ficou concluida. Se o problema voltar, ligue para a linha da camara.`,
            relacionado: { reparacao_habitacao_id: id },
            chave: `reparacao_concluida:${id}`,
          },
          tx,
        );
        sms = true;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'atualizar_reparacao_habitacao',
          objetoTipo: 'reparacao_habitacao',
          objetoId: id,
          dados: {
            codigo: antes.codigo,
            estado,
            atribuida_a: d.atribuida_a ?? null,
          },
        },
        tx,
      );
      return { ...r, sms_enviado: sms };
    });
  }

  async fogos(m: Municipio) {
    const fogos = await this.db.query(
      `SELECT f.id, f.codigo, f.morada, f.freguesia, f.tipologia, f.area_m2::float AS area_m2,
              f.estado, f.demonstracao,
              c.id AS contrato_id, c.regime, c.renda_cent, c.dia_vencimento, c.em_divida_cent,
              c.agregado, c.inicio::text AS inicio, mu.nome AS inquilino, mu.telefone_e164 AS telefone,
              (SELECT count(*)::int FROM habitacao_reparacoes r
               WHERE r.contrato_id = c.id AND r.estado <> 'concluida') AS reparacoes_abertas
       FROM habitacao_fogos f
       LEFT JOIN habitacao_contratos c ON c.fogo_id = f.id AND c.estado = 'ativo'
       LEFT JOIN municipes mu ON mu.id = c.municipe_id
       WHERE f.municipio_id = $1 ORDER BY f.codigo`,
      [m.id],
    );
    const revisoes = await this.db.query(
      `SELECT v.id, v.codigo, v.rendimento_mensal_cent, v.agregado, v.motivo, v.renda_atual_cent,
              v.renda_estimada_cent, v.estado, v.criado_em, mu.nome AS inquilino, f.morada
       FROM habitacao_revisoes_renda v
       JOIN habitacao_contratos c ON c.id = v.contrato_id
       JOIN habitacao_fogos f ON f.id = c.fogo_id
       JOIN municipes mu ON mu.id = v.municipe_id
       WHERE v.municipio_id = $1 ORDER BY v.criado_em DESC LIMIT 100`,
      [m.id],
    );
    return { fogos, revisoes };
  }

  // -------------------------------------------------------------------
  // Demonstração
  // -------------------------------------------------------------------

  /**
   * Fogos de demonstração; com pessoas (munícipes da demonstração), também
   * contratos, reparações e candidaturas.
   */
  async carregarDemonstracao(
    m: Municipio,
    u: UtilizadorPainel | null,
    pessoas: string[] = [],
  ) {
    return this.db.transaction(async (tx) => {
      let fogos = 0;
      for (const f of FOGOS_DEMO) {
        const r = await tx.query(
          `INSERT INTO habitacao_fogos (municipio_id, codigo, morada, freguesia, tipologia, area_m2, estado, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           ON CONFLICT (municipio_id, codigo) DO NOTHING RETURNING id`,
          [
            m.id,
            f.codigo,
            f.morada,
            f.freguesia,
            f.tipologia,
            f.area_m2,
            f.estado,
          ],
        );
        fogos += r.length;
      }
      const hoje = hojeLisboa();
      const contratos: (string | null)[] = [];
      for (const c of CONTRATOS_DEMO) {
        const pessoa = pessoas[c.inquilino];
        if (!pessoa) {
          contratos.push(null);
          continue;
        }
        const inicio = `${Number(hoje.slice(0, 4)) - c.inicio_anos}${hoje.slice(4, 8)}01`;
        const [novo] = await tx.query<{ id: string }>(
          `INSERT INTO habitacao_contratos (municipio_id, fogo_id, municipe_id, regime, inicio, renda_cent,
             rendimento_mensal_cent, agregado, em_divida_cent, demonstracao)
           SELECT $1, f.id, $3, $4, $5, $6, $7, $8, $9, true
           FROM habitacao_fogos f WHERE f.municipio_id = $1 AND f.codigo = $2
           ON CONFLICT DO NOTHING RETURNING id`,
          [
            m.id,
            c.fogo,
            pessoa,
            c.regime,
            inicio,
            c.renda_cent,
            c.rendimento_mensal_cent,
            c.agregado,
            c.em_divida_cent,
          ],
        );
        contratos.push(novo?.id ?? null);
      }
      let reparacoes = 0;
      for (const r of REPARACOES_DEMO) {
        const contrato = contratos[r.contrato];
        if (!contrato) continue;
        const cl = classificarReparacao({
          categoria: r.categoria,
          descricao: r.descricao,
        });
        await tx.query(
          `INSERT INTO habitacao_reparacoes (municipio_id, contrato_id, municipe_id, codigo, categoria,
             descricao, urgencia, estado, atribuida_a, criado_em, atualizado_em)
           SELECT $1, c.id, c.municipe_id, $3, $4, $5, $6, $7, $8,
                  now() - make_interval(days => $9), now() - make_interval(days => $9)
           FROM habitacao_contratos c WHERE c.id = $2`,
          [
            m.id,
            contrato,
            novoCodigo(),
            r.categoria,
            r.descricao,
            cl.urgencia,
            r.estado,
            r.atribuida_a ?? null,
            r.dias,
          ],
        );
        reparacoes++;
      }
      let candidaturas = 0;
      for (const c of CANDIDATURAS_DEMO) {
        const pessoa = pessoas[c.pessoa];
        if (!pessoa) continue;
        const [ja] = await tx.query(
          `SELECT 1 FROM habitacao_candidaturas WHERE municipe_id = $1 AND regime = $2`,
          [pessoa, c.regime],
        );
        if (ja) continue;
        const av = avaliarCandidatura(c);
        await tx.query(
          `INSERT INTO habitacao_candidaturas (municipio_id, municipe_id, codigo, regime, agregado,
             rendimento_anual_cent, dados, elegivel, pontuacao, criterios, estado, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
          [
            m.id,
            pessoa,
            novoCodigo(),
            c.regime,
            c.agregado,
            c.rendimento_anual_cent,
            JSON.stringify(c),
            av.elegivel,
            av.pontuacao,
            JSON.stringify({
              lista: av.criterios,
              exclusoes: av.exclusoes,
              limite_cent: av.limite_cent,
            }),
            c.estado,
          ],
        );
        candidaturas++;
      }
      if (u) {
        await this.auditoria.registar(
          {
            municipioId: m.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'carregar_habitacao_demonstracao',
            objetoTipo: 'habitacao',
            objetoId: m.id,
            dados: { fogos, reparacoes, candidaturas },
          },
          tx,
        );
      }
      return {
        fogos,
        contratos: contratos.filter(Boolean).length,
        reparacoes,
        candidaturas,
      };
    });
  }
}
