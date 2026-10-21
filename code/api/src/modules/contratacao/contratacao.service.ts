import { randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { pode } from '../auth/permissoes.js';
import { nifValido } from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  AVISO_RASCUNHO,
  ConfigContratacao,
  configDe,
  CONFIG_DEMONSTRACAO,
  NOMES_PROCEDIMENTO,
  Procedimento,
  PROCEDIMENTOS,
  PROCEDIMENTOS_REGISTO,
  TIPOS_CONTRATO,
} from './config.js';
import { lerContratosBase } from './csv.js';
import {
  avaliarProcedimento,
  ContratoAnterior,
  ResultadoAvaliacao,
} from './motor.js';
import { gerarPdfPeca } from './pecas-pdf.js';
import {
  camposAPreencher,
  conteudoPecasIa,
  DadosPecas,
  esquemaPecasIa,
  esquemaSecoes,
  pecasDaIa,
  pecasModelo,
  RascunhoPeca,
  SISTEMA_PECAS,
  TipoPeca,
} from './pecas.js';
import { lerPerguntaContratacao, respostaContratacao } from './pergunta.js';

const esquemaNif = z
  .string()
  .trim()
  .transform((n) => n.replace(/\s/g, '').replace(/^PT/i, ''))
  .refine(nifValido, 'NIF inválido.');

const esquemaCpv = z
  .string()
  .trim()
  .regex(/^\d{8}(-\d)?$/, 'CPV no formato 12345678-9.');

const esquemaData = z.iso.date();

const cent = z.number().int().min(0).max(100_000_000_000);

export const esquemaAvaliar = z.object({
  tipo: z.enum(TIPOS_CONTRATO),
  valor_estimado_cent: cent,
  entidade_adjudicataria: esquemaNif.nullable().optional(),
  objeto: z.string().trim().min(3).max(2000),
  cpv: esquemaCpv.nullable().optional(),
  prazo_meses: z.number().int().min(1).max(240),
});
export type EntradaAvaliar = z.output<typeof esquemaAvaliar>;

export const esquemaCriarProcedimento = esquemaAvaliar.extend({
  servico_requerente: z.string().trim().min(2).max(200),
  servico_id: z.uuid().nullable().optional(),
  fundamentacao: z.string().trim().max(4000).nullable().optional(),
  entidade_nome: z.string().trim().max(300).nullable().optional(),
  /** Sem isto fica o recomendado pelo motor. */
  procedimento: z.enum(PROCEDIMENTOS).optional(),
  /** false = modelos fixos mesmo com IA disponível. */
  usar_ia: z.boolean().default(true),
});

export const esquemaContrato = z.object({
  adjudicante: z.string().trim().max(300).nullable().optional(),
  adjudicatario_nif: esquemaNif,
  adjudicatario_nome: z.string().trim().max(300).nullable().optional(),
  objeto: z.string().trim().min(3).max(2000),
  cpv: esquemaCpv.nullable().optional(),
  tipo: z.enum(TIPOS_CONTRATO),
  preco_contratual_cent: cent,
  data_contrato: esquemaData,
  procedimento: z.enum(PROCEDIMENTOS_REGISTO),
  base_numero: z.string().trim().max(60).nullable().optional(),
});

export const esquemaImportar = z.object({
  csv: z.string().min(1).max(20_000_000),
  separador: z.enum([';', ',', '\t']).optional(),
});

export const esquemaListarContratos = esquemaPaginacao.extend({
  nif: z
    .string()
    .trim()
    .regex(/^\d{9}$/)
    .optional(),
  ano: z.coerce.number().int().min(1990).max(2100).optional(),
  q: z.string().trim().max(200).optional(),
});

export const ESTADOS = [
  'rascunho',
  'em_revisao',
  'aprovado',
  'publicado',
] as const;
type Estado = (typeof ESTADOS)[number];

export const esquemaListarProcedimentos = esquemaPaginacao.extend({
  estado: z.enum(ESTADOS).optional(),
});

export const esquemaMudarEstado = z.object({
  estado: z.enum(['rascunho', 'em_revisao', 'aprovado']),
  nota: z.string().trim().max(2000).nullable().optional(),
});

export const esquemaPublicar = z.object({
  base_numero: z.string().trim().min(1).max(60),
  preco_contratual_cent: cent.optional(),
  data_contrato: esquemaData.optional(),
  adjudicatario_nif: esquemaNif.optional(),
  adjudicatario_nome: z.string().trim().max(300).nullable().optional(),
});

export const esquemaPeca = z.object({
  titulo: z.string().trim().min(1).max(200).optional(),
  secoes: esquemaSecoes,
});

/** De onde se pode ir para onde (a aprovação é da chefia). */
const TRANSICOES: Record<Estado, Estado[]> = {
  rascunho: ['em_revisao'],
  em_revisao: ['rascunho', 'aprovado'],
  aprovado: ['em_revisao'],
  publicado: [],
};

const COLUNAS_CONTRATO = `id, adjudicante, adjudicatario_nif, adjudicatario_nome, objeto, cpv, tipo,
  preco_contratual_cent::float8 AS preco_contratual_cent, to_char(data_contrato, 'YYYY-MM-DD') AS data_contrato,
  procedimento, procedimento_original, origem, base_numero, procedimento_id, criado_em`;

const COLUNAS_PROCEDIMENTO = `p.id, p.numero, p.servico_requerente, p.servico_id, p.pedido_por, u.nome AS pedido_por_nome,
  p.tipo, p.objeto, p.cpv, p.fundamentacao, p.valor_estimado_cent::float8 AS valor_estimado_cent, p.prazo_meses,
  p.entidade_nif, p.entidade_nome, p.procedimento, p.estado, p.nota, p.aprovado_por, a.nome AS aprovado_por_nome,
  p.aprovado_em, p.base_numero, p.publicado_em, p.criado_em, p.atualizado_em`;

interface LinhaProcedimento {
  id: string;
  numero: string;
  servico_requerente: string;
  tipo: (typeof TIPOS_CONTRATO)[number];
  objeto: string;
  cpv: string | null;
  fundamentacao: string | null;
  valor_estimado_cent: number;
  prazo_meses: number;
  entidade_nif: string | null;
  entidade_nome: string | null;
  procedimento: Procedimento;
  estado: Estado;
  avaliacao: ResultadoAvaliacao;
  config_usada: ConfigContratacao;
  criado_em: string;
}

interface LinhaPeca {
  id: string;
  tipo: TipoPeca;
  titulo: string;
  secoes: { titulo: string; texto: string }[];
  campos_a_preencher: string[];
  modo: 'ia' | 'modelo' | 'editada';
  atualizada_em: string;
}

/** 'AAAA-MM-DD' no fuso do município. */
function hojeEm(fuso: string): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: fuso });
}

/**
 * Contratação pública (interno): o motor de regras com a configuração do
 * município, o registo de contratos (para o acumulado e o fracionamento) e
 * a preparação dos procedimentos com o rascunho das peças.
 */
@Injectable()
export class ContratacaoService {
  private readonly logger = new Logger(ContratacaoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // --- Configuração -----------------------------------------------------------

  async config(municipioId: string): Promise<ConfigContratacao> {
    const [r] = await this.db.query<{ c: unknown }>(
      'SELECT contratacao_config AS c FROM municipios WHERE id = $1',
      [municipioId],
    );
    return configDe(r?.c);
  }

  async verConfig(m: Municipio) {
    const config = await this.config(m.id);
    return {
      config,
      guardada: JSON.stringify(config) !== JSON.stringify(CONFIG_DEMONSTRACAO),
      demonstracao: config.demonstracao,
      fonte: config.fonte,
    };
  }

  async guardarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    config: ConfigContratacao,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        'UPDATE municipios SET contratacao_config = $2 WHERE id = $1',
        [m.id, JSON.stringify(config)],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'mudar_regras_contratacao',
          objetoTipo: 'contratacao_config',
          objetoId: m.id,
          dados: { demonstracao: config.demonstracao },
        },
        tx,
      );
    });
    return { config };
  }

  // --- Motor ------------------------------------------------------------------

  /** Simular: corre o motor com os contratos registados, sem gravar nada. */
  async avaliar(m: Municipio, d: EntradaAvaliar): Promise<ResultadoAvaliacao> {
    const cfg = await this.config(m.id);
    return this.correrMotor(m, d, cfg);
  }

  private async correrMotor(
    m: Municipio,
    d: EntradaAvaliar,
    cfg: ConfigContratacao,
  ): Promise<ResultadoAvaliacao> {
    const hoje = hojeEm(m.fuso);
    const ano = Number(hoje.slice(0, 4));
    const contratos = await this.db.query<ContratoAnterior & { id: string }>(
      `SELECT id, adjudicatario_nif, adjudicatario_nome, objeto, cpv, tipo,
              preco_contratual_cent::float8 AS preco_contratual_cent,
              to_char(data_contrato, 'YYYY-MM-DD') AS data_contrato, procedimento
       FROM contratos_publicos
       WHERE municipio_id = $1
         AND data_contrato BETWEEN make_date($2::int, 1, 1) AND $3::date
         AND (adjudicatario_nif = $4::text OR data_contrato >= make_date($5::int, 1, 1))
       ORDER BY data_contrato, id`,
      [
        m.id,
        ano - cfg.acumulado.anos + 1,
        hoje,
        d.entidade_adjudicataria ?? null,
        ano,
      ],
    );
    return avaliarProcedimento(
      {
        tipo: d.tipo,
        valor_estimado_cent: d.valor_estimado_cent,
        entidade_adjudicataria: d.entidade_adjudicataria ?? null,
        objeto: d.objeto,
        cpv: d.cpv ?? null,
        prazo_meses: d.prazo_meses,
        contratos_anteriores: contratos,
        hoje,
      },
      cfg,
    );
  }

  /**
   * Para o assistente interno: se a pergunta é "cabe no ajuste direto?" com
   * um valor, responde com o motor. Senão devolve null.
   */
  async responderPergunta(m: Municipio, pergunta: string) {
    const p = lerPerguntaContratacao(pergunta);
    if (!p) return null;
    const r = await this.avaliar(m, {
      tipo: p.tipo,
      valor_estimado_cent: p.valor_estimado_cent,
      entidade_adjudicataria: p.entidade_nif,
      objeto: p.objeto,
      cpv: null,
      prazo_meses: p.prazo_meses,
    });
    return {
      resposta: respostaContratacao(p, r),
      contratacao: {
        tipo: p.tipo,
        tipo_assumido: p.tipo_assumido,
        valor_estimado_cent: p.valor_estimado_cent,
        prazo_meses: p.prazo_meses,
        entidade_nif: p.entidade_nif,
        cabe_ajuste_direto: r.cabe_ajuste_direto,
        recomendado: r.recomendado,
        demonstracao: r.demonstracao,
        fonte: r.fonte,
      },
    };
  }

  // --- Registo de contratos ----------------------------------------------------

  async listarContratos(
    m: Municipio,
    f: z.output<typeof esquemaListarContratos>,
  ) {
    const linhas = await this.db.query<{
      id: string;
      data_contrato: string;
      criado_em: string;
    }>(
      `SELECT ${COLUNAS_CONTRATO} FROM contratos_publicos
       WHERE municipio_id = $1
         AND ($2::text IS NULL OR adjudicatario_nif = $2)
         AND ($3::int IS NULL OR extract(year FROM data_contrato) = $3)
         AND ($4::text IS NULL OR objeto ILIKE '%' || $4 || '%' OR adjudicatario_nome ILIKE '%' || $4 || '%')
         AND ($5::timestamptz IS NULL OR (criado_em, id) < ($5, $6))
       ORDER BY criado_em DESC, id DESC LIMIT $7`,
      [
        m.id,
        f.nif ?? null,
        f.ano ?? null,
        f.q || null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    return pagina(linhas, f.limite, (l) => ({ em: l.criado_em, id: l.id }));
  }

  async criarContrato(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaContrato>,
  ) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO contratos_publicos (municipio_id, adjudicante, adjudicatario_nif, adjudicatario_nome, objeto, cpv, tipo,
           preco_contratual_cent, data_contrato, procedimento, origem, base_numero, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', $11, $12)
         ON CONFLICT (municipio_id, adjudicatario_nif, data_contrato, preco_contratual_cent, md5(objeto)) DO NOTHING
         RETURNING id`,
        [
          m.id,
          d.adjudicante ?? m.nome,
          d.adjudicatario_nif,
          d.adjudicatario_nome ?? null,
          d.objeto,
          d.cpv ?? null,
          d.tipo,
          d.preco_contratual_cent,
          d.data_contrato,
          d.procedimento,
          d.base_numero ?? null,
          u.id,
        ],
      );
      if (!c) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'contrato_repetido',
          'Este contrato já está no registo (mesma entidade, data, preço e objeto).',
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar',
          objetoTipo: 'contrato_publico',
          objetoId: c.id,
          dados: {
            nif: d.adjudicatario_nif,
            preco_cent: d.preco_contratual_cent,
          },
        },
        tx,
      );
      return this.contrato(m.id, c.id, tx);
    });
  }

  /** CSV do portal BASE: as linhas válidas entram, as repetidas saltam-se. */
  async importarContratos(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaImportar>,
  ) {
    const lido = lerContratosBase(d.csv, d.separador);
    const importacao = randomUUID();
    let importados = 0;
    await this.db.transaction(async (tx) => {
      for (const l of lido.linhas) {
        const r = await tx.query(
          `INSERT INTO contratos_publicos (municipio_id, adjudicante, adjudicatario_nif, adjudicatario_nome, objeto, cpv, tipo,
             preco_contratual_cent, data_contrato, procedimento, procedimento_original, origem, importacao_id, criado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'csv', $12, $13)
           ON CONFLICT (municipio_id, adjudicatario_nif, data_contrato, preco_contratual_cent, md5(objeto)) DO NOTHING
           RETURNING id`,
          [
            m.id,
            l.adjudicante,
            l.adjudicatario_nif,
            l.adjudicatario_nome,
            l.objeto,
            l.cpv,
            l.tipo,
            l.preco_contratual_cent,
            l.data_contrato,
            l.procedimento,
            l.procedimento_original,
            importacao,
            u.id,
          ],
        );
        if (r.length) importados++;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'importar_contratos_base',
          objetoTipo: 'contratos_publicos',
          objetoId: importacao,
          dados: {
            importados,
            repetidos: lido.linhas.length - importados,
            erros: lido.erros.length,
          },
        },
        tx,
      );
    });
    return {
      importacao_id: importacao,
      lidas: lido.linhas.length + lido.erros.filter((e) => e.linha > 1).length,
      importados,
      repetidos: lido.linhas.length - importados,
      erros: lido.erros,
      colunas_desconhecidas: lido.colunas_desconhecidas,
    };
  }

  private async contrato(
    municipioId: string,
    id: string,
    q: Pick<Tx, 'query'> = this.db,
  ) {
    const [c] = await q.query(
      `SELECT ${COLUNAS_CONTRATO} FROM contratos_publicos WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId],
    );
    return c;
  }

  // --- Procedimentos -------------------------------------------------------------

  async listarProcedimentos(
    m: Municipio,
    f: z.output<typeof esquemaListarProcedimentos>,
  ) {
    const linhas = await this.db.query<{ id: string; criado_em: string }>(
      `SELECT ${COLUNAS_PROCEDIMENTO}
       FROM contratacao_procedimentos p
       LEFT JOIN utilizadores u ON u.id = p.pedido_por
       LEFT JOIN utilizadores a ON a.id = p.aprovado_por
       WHERE p.municipio_id = $1
         AND ($2::text IS NULL OR p.estado = $2)
         AND ($3::timestamptz IS NULL OR (p.criado_em, p.id) < ($3, $4))
       ORDER BY p.criado_em DESC, p.id DESC LIMIT $5`,
      [
        m.id,
        f.estado ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    return pagina(linhas, f.limite, (l) => ({ em: l.criado_em, id: l.id }));
  }

  async criarProcedimento(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaCriarProcedimento>,
  ) {
    const cfg = await this.config(m.id);
    const avaliacao = await this.correrMotor(m, d, cfg);
    const proc = d.procedimento ?? avaliacao.recomendado;
    const escolhido = avaliacao.procedimentos.find(
      (x) => x.procedimento === proc,
    );
    if (!escolhido?.admissivel) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'procedimento_nao_admissivel',
        `Não cabe no ${NOMES_PROCEDIMENTO[proc]}: ${escolhido?.porque.join(' ') ?? ''}`.trim(),
        { recomendado: avaliacao.recomendado, avaliacao },
      );
    }
    if (d.servico_id) {
      const [s] = await this.db.query(
        'SELECT 1 FROM servicos WHERE id = $1 AND municipio_id = $2',
        [d.servico_id, m.id],
      );
      if (!s) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'servico_invalido',
          'Esse serviço não existe.',
        );
      }
    }

    const dados: DadosPecas = {
      municipio: m.nome,
      procedimento: proc,
      tipo: d.tipo,
      objeto: d.objeto,
      valor_estimado_cent: d.valor_estimado_cent,
      prazo_meses: d.prazo_meses,
      servico_requerente: d.servico_requerente,
      fundamentacao: d.fundamentacao ?? null,
      entidade_nome: d.entidade_nome ?? null,
      entidade_nif: d.entidade_adjudicataria ?? null,
      prazo_propostas_dias:
        escolhido.pecas.find((x) => x.codigo === 'convite')?.prazo_dias ?? null,
    };
    const { pecas, motivoSemIa } = await this.rascunhos(dados, d.usar_ia);

    const id = await this.db.transaction(async (tx) => {
      const ano = Number(hojeEm(m.fuso).slice(0, 4));
      const n = await proximoNumero(tx, m.id, 'PCP', ano);
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO contratacao_procedimentos (municipio_id, numero, servico_requerente, servico_id, pedido_por, tipo, objeto, cpv,
           fundamentacao, valor_estimado_cent, prazo_meses, entidade_nif, entidade_nome, procedimento, avaliacao, config_usada)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [
          m.id,
          `PCP ${n}/${ano}`,
          d.servico_requerente,
          d.servico_id ?? null,
          u.id,
          d.tipo,
          d.objeto,
          d.cpv ?? null,
          d.fundamentacao ?? null,
          d.valor_estimado_cent,
          d.prazo_meses,
          d.entidade_adjudicataria ?? null,
          d.entidade_nome ?? null,
          proc,
          JSON.stringify(avaliacao),
          JSON.stringify(cfg),
        ],
      );
      for (const pc of pecas) {
        await tx.query(
          `INSERT INTO contratacao_pecas (municipio_id, procedimento_id, tipo, titulo, secoes, campos_a_preencher, modo)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            m.id,
            p.id,
            pc.tipo,
            pc.titulo,
            JSON.stringify(pc.secoes),
            JSON.stringify(pc.campos_a_preencher),
            pc.modo,
          ],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar',
          objetoTipo: 'procedimento_contratacao',
          objetoId: p.id,
          dados: {
            procedimento: proc,
            valor_estimado_cent: d.valor_estimado_cent,
            pecas: pecas[0]?.modo ?? null,
          },
        },
        tx,
      );
      return p.id;
    });
    return { ...(await this.detalhe(m, id)), motivo_sem_ia: motivoSemIa };
  }

  /** Com IA se der; senão (ou se falhar) os modelos fixos. */
  private async rascunhos(
    dados: DadosPecas,
    usarIa: boolean,
  ): Promise<{ pecas: RascunhoPeca[]; motivoSemIa: string | null }> {
    if (!usarIa) {
      return {
        pecas: pecasModelo(dados),
        motivoSemIa: 'Pedido sem IA: modelos fixos.',
      };
    }
    if (!this.claude.disponivel) {
      return {
        pecas: pecasModelo(dados),
        motivoSemIa:
          'O assistente de IA não está configurado: usaram-se os modelos fixos.',
      };
    }
    try {
      const r = await this.claude.extrair(esquemaPecasIa, {
        sistema: SISTEMA_PECAS,
        conteudo: conteudoPecasIa(dados),
        esforco: 'medium',
        maxTokens: 8000,
      });
      return { pecas: pecasDaIa(dados, r), motivoSemIa: null };
    } catch (e) {
      this.logger.warn(
        `Peças com IA: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        pecas: pecasModelo(dados),
        motivoSemIa:
          'Não foi possível escrever com IA agora: usaram-se os modelos fixos.',
      };
    }
  }

  async detalhe(m: Municipio, id: string) {
    const [p] = await this.db.query<LinhaProcedimento>(
      `SELECT ${COLUNAS_PROCEDIMENTO}, p.avaliacao, p.config_usada
       FROM contratacao_procedimentos p
       LEFT JOIN utilizadores u ON u.id = p.pedido_por
       LEFT JOIN utilizadores a ON a.id = p.aprovado_por
       WHERE p.id = $1 AND p.municipio_id = $2`,
      [id, m.id],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Procedimento não existe.',
      );
    }
    const pecas = await this.db.query<LinhaPeca>(
      `SELECT id, tipo, titulo, secoes, campos_a_preencher, modo, atualizada_em
       FROM contratacao_pecas WHERE procedimento_id = $1 AND municipio_id = $2 ORDER BY tipo DESC`,
      [id, m.id],
    );
    const { config_usada, ...resto } = p;
    return {
      ...resto,
      pecas: pecas.map((x) => ({ ...x, aviso: AVISO_RASCUNHO })),
      demonstracao: config_usada.demonstracao || p.avaliacao.demonstracao,
      fonte: p.avaliacao.fonte,
    };
  }

  async mudarEstado(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaMudarEstado>,
  ) {
    await this.db.transaction(async (tx) => {
      const atual = await this.estadoPara(tx, m.id, id);
      if (!TRANSICOES[atual].includes(d.estado)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          `Não se passa de "${atual}" para "${d.estado}".`,
        );
      }
      if (d.estado === 'aprovado' && !pode(u.perfil, 'agente')) {
        throw new ErroApi(
          HttpStatus.FORBIDDEN,
          'sem_permissao',
          'Só a chefia aprova um procedimento.',
          { recurso: 'agente' },
        );
      }
      const aprovar = d.estado === 'aprovado';
      await tx.query(
        `UPDATE contratacao_procedimentos SET estado = $3, nota = coalesce($4, nota), atualizado_em = now(),
           aprovado_por = CASE WHEN $5 THEN $6::uuid ELSE NULL END,
           aprovado_em = CASE WHEN $5 THEN now() ELSE NULL END
         WHERE id = $1 AND municipio_id = $2`,
        [id, m.id, d.estado, d.nota ?? null, aprovar, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao:
            d.estado === 'aprovado'
              ? 'aprovar'
              : d.estado === 'em_revisao'
                ? 'enviar_revisao_contratacao'
                : 'devolver_contratacao',
          objetoTipo: 'procedimento_contratacao',
          objetoId: id,
          dados: { de: atual, para: d.estado, nota: d.nota ?? null },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  /**
   * Registo manual da publicação no portal BASE (n.º do BASE). O contrato
   * entra no registo do município, para contar no acumulado.
   */
  async publicar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaPublicar>,
  ) {
    await this.db.transaction(async (tx) => {
      const atual = await this.estadoPara(tx, m.id, id);
      if (atual !== 'aprovado') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'Só um procedimento aprovado se regista como publicado.',
        );
      }
      const [p] = await tx.query<{
        tipo: string;
        objeto: string;
        cpv: string | null;
        valor_estimado_cent: number;
        entidade_nif: string | null;
        entidade_nome: string | null;
        procedimento: string;
      }>(
        `SELECT tipo, objeto, cpv, valor_estimado_cent::float8 AS valor_estimado_cent, entidade_nif, entidade_nome, procedimento
         FROM contratacao_procedimentos WHERE id = $1 AND municipio_id = $2`,
        [id, m.id],
      );
      const nif = d.adjudicatario_nif ?? p.entidade_nif;
      if (!nif) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'falta_adjudicatario',
          'Indique o NIF do adjudicatário (adjudicatario_nif).',
        );
      }
      await tx.query(
        `UPDATE contratacao_procedimentos SET estado = 'publicado', base_numero = $3, publicado_por = $4,
           publicado_em = now(), atualizado_em = now()
         WHERE id = $1 AND municipio_id = $2`,
        [id, m.id, d.base_numero, u.id],
      );
      await tx.query(
        `INSERT INTO contratos_publicos (municipio_id, adjudicante, adjudicatario_nif, adjudicatario_nome, objeto, cpv, tipo,
           preco_contratual_cent, data_contrato, procedimento, origem, procedimento_id, base_numero, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'procedimento', $11, $12, $13)
         ON CONFLICT (municipio_id, adjudicatario_nif, data_contrato, preco_contratual_cent, md5(objeto)) DO NOTHING`,
        [
          m.id,
          m.nome,
          nif,
          d.adjudicatario_nome ??
            (nif === p.entidade_nif ? p.entidade_nome : null),
          p.objeto,
          p.cpv,
          p.tipo,
          d.preco_contratual_cent ?? p.valor_estimado_cent,
          d.data_contrato ?? hojeEm(m.fuso),
          p.procedimento,
          id,
          d.base_numero,
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'publicar',
          objetoTipo: 'procedimento_contratacao',
          objetoId: id,
          dados: { base_numero: d.base_numero },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  async guardarPeca(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    tipo: TipoPeca,
    d: z.output<typeof esquemaPeca>,
  ) {
    await this.db.transaction(async (tx) => {
      const atual = await this.estadoPara(tx, m.id, id);
      if (atual !== 'rascunho' && atual !== 'em_revisao') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'As peças só se alteram em rascunho ou em revisão.',
        );
      }
      const r = await tx.query(
        `UPDATE contratacao_pecas SET secoes = $4, campos_a_preencher = $5, titulo = coalesce($6, titulo),
           modo = 'editada', atualizada_por = $7, atualizada_em = now()
         WHERE procedimento_id = $1 AND municipio_id = $2 AND tipo = $3 RETURNING id`,
        [
          id,
          m.id,
          tipo,
          JSON.stringify(d.secoes),
          JSON.stringify(camposAPreencher(d.secoes)),
          d.titulo ?? null,
          u.id,
        ],
      );
      if (!r.length) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Peça não existe.',
        );
      }
      await tx.query(
        'UPDATE contratacao_procedimentos SET atualizado_em = now() WHERE id = $1',
        [id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'alterar_peca_contratacao',
          objetoTipo: 'procedimento_contratacao',
          objetoId: id,
          dados: { peca: tipo },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  async pdf(m: Municipio, id: string, tipo: TipoPeca) {
    const p = await this.detalhe(m, id);
    const peca = p.pecas.find((x) => x.tipo === tipo);
    if (!peca) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Peça não existe.',
      );
    }
    const pdf = await gerarPdfPeca({
      municipio: m.nome,
      numero: p.numero,
      titulo: peca.titulo,
      objeto: p.objeto,
      procedimento: NOMES_PROCEDIMENTO[p.procedimento],
      estado: p.estado.replace('_', ' '),
      secoes: peca.secoes,
      campos_a_preencher: peca.campos_a_preencher,
      modo: peca.modo === 'ia' ? 'ia' : 'modelo',
      demonstracao: p.demonstracao,
      fonte: p.fonte,
      gerado_em: new Date(),
    });
    const nome = `${p.numero.replace(/[^\w]+/g, '-')}-${tipo}.pdf`;
    return { nome, pdf };
  }

  private async estadoPara(
    tx: Tx,
    municipioId: string,
    id: string,
  ): Promise<Estado> {
    const [p] = await tx.query<{ estado: Estado }>(
      'SELECT estado FROM contratacao_procedimentos WHERE id = $1 AND municipio_id = $2 FOR UPDATE',
      [id, municipioId],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Procedimento não existe.',
      );
    }
    return p.estado;
  }
}
