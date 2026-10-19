import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { pagina, Pagina } from '../../common/paginacao.js';
import { somarDiasUteis } from '../../common/dias-uteis.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  ENTIDADE_TESTE,
  formatarReferencia,
  gerarReferencia,
} from './multibanco.js';
import {
  calcularTaxas,
  eurosPorExtenso,
  formatarEuros,
  LinhaTaxa,
  PedidoSimulacao,
  ResultadoSimulacao,
  Taxa,
} from './taxas.js';

/**
 * Prazo para pagar a referência: 10 dias úteis (o prazo supletivo do CPA),
 * contados no calendário do município. Com fornecedor real passa a ser o
 * que ele devolver.
 */
export const PRAZO_PAGAMENTO_DIAS_UTEIS = 10;

/** Série da numeração das guias: '2026/44120'. */
const SERIE_GUIA = 'GUIA';

export interface FonteTabela {
  titulo: string;
  url: string;
  lida_em: string;
}

export interface TabelaEmVigor {
  id: string;
  ano: number;
  vigor_desde: string;
  vigor_ate: string | null;
  fonte: FonteTabela | null;
  taxas: (Taxa & { tipo_processo_codigo: string | null })[];
}

export interface EntradaSimulacao {
  tipo_processo?: string;
  taxas?: { codigo: string; quantidade?: number }[];
  quantidades?: PedidoSimulacao['quantidades'];
}

export interface Simulacao extends ResultadoSimulacao {
  completa: boolean;
  total_por_extenso: string;
  total_texto: string;
  tabela: { ano: number; vigor_desde: string };
  fonte: FonteTabela | null;
}

export interface ResultadoPagamento {
  estado: 'pendente' | 'pago' | 'expirado' | 'cancelado';
  valor_cent: number;
  provider_ref?: string;
  mb_referencia?: string;
  mb_entidade?: string;
}

interface LinhaPagamento {
  id: string;
  municipio_id: string;
  processo_id: string | null;
  requerimento_id: string | null;
  guia_numero: string | null;
  valor_cent: number;
  detalhe: LinhaTaxa[];
  metodo: string | null;
  mb_entidade: string | null;
  mb_referencia: string | null;
  pagar_ate: string | null;
  estado: ResultadoPagamento['estado'];
  modo_teste: boolean;
  pago_em: Date | null;
  criado_em: Date;
}

const COLUNAS = `p.id, p.municipio_id, p.processo_id, p.requerimento_id, p.guia_numero,
  p.valor_cent, p.detalhe, p.metodo, p.mb_entidade, p.mb_referencia,
  to_char(p.pagar_ate, 'YYYY-MM-DD') AS pagar_ate, p.estado, p.modo_teste,
  p.pago_em, p.criado_em`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hojeEm(fuso: string): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: fuso });
}

/** '2026-11-03' → '03/11/2026'. */
function dataCurta(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** '2026-11-03' → 'terça-feira, 3 de novembro' (para dizer). */
function dataDita(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-PT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Taxas e pagamentos. Tudo em MODO DE TESTE: referências MB fictícias
 * (entidade 99999), `modo_teste = true` e "modo de teste" escrito no SMS e
 * na página. O fornecedor real (decisão em aberto 5) entra pelo mesmo
 * webhook genérico.
 */
@Injectable()
export class PagamentosService {
  private readonly logger = new Logger(PagamentosService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
    private readonly links: LinksCurtosService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
  ) {}

  /** A tabela de taxas em vigor hoje (no fuso do município). */
  async tabelaEmVigor(municipio: Municipio): Promise<TabelaEmVigor> {
    const [t] = await this.db.query<Omit<TabelaEmVigor, 'taxas'>>(
      `SELECT tt.id, tt.ano, to_char(tt.vigor_desde, 'YYYY-MM-DD') AS vigor_desde,
              to_char(tt.vigor_ate, 'YYYY-MM-DD') AS vigor_ate,
              CASE WHEN fo.id IS NULL THEN NULL ELSE
                jsonb_build_object('titulo', fo.titulo, 'url', fo.url, 'lida_em', fv.lida_em)
              END AS fonte
       FROM tabelas_taxas tt
       LEFT JOIN fonte_versoes fv ON fv.id = tt.fonte_versao_id
       LEFT JOIN fontes fo ON fo.id = fv.fonte_id
       WHERE tt.municipio_id = $1
         AND tt.vigor_desde <= $2::date
         AND (tt.vigor_ate IS NULL OR tt.vigor_ate >= $2::date)
       ORDER BY tt.vigor_desde DESC
       LIMIT 1`,
      [municipio.id, hojeEm(municipio.fuso)],
    );
    if (!t) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_tabela_taxas',
        'Não há tabela de taxas em vigor para este município.',
      );
    }
    const taxas = await this.db.query<TabelaEmVigor['taxas'][number]>(
      `SELECT x.codigo, x.descricao, x.unidade, x.valor_cent, x.tipo_processo_id,
              tp.codigo AS tipo_processo_codigo
       FROM taxas x
       LEFT JOIN tipos_processo tp ON tp.id = x.tipo_processo_id
       WHERE x.tabela_id = $1
       ORDER BY tp.codigo NULLS LAST, x.codigo`,
      [t.id],
    );
    return { ...t, taxas };
  }

  /** Código ('CP') ou id do tipo de processo → id. */
  private async tipoProcessoId(
    municipioId: string,
    ref: string,
  ): Promise<string> {
    const [tp] = await this.db.query<{ id: string }>(
      `SELECT id FROM tipos_processo
       WHERE municipio_id = $1 AND (upper(codigo) = upper($2) OR ($3::uuid IS NOT NULL AND id = $3::uuid))`,
      [municipioId, ref.trim(), UUID.test(ref) ? ref : null],
    );
    if (!tp) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'tipo_processo_desconhecido',
        `Não há o tipo de processo "${ref}".`,
      );
    }
    return tp.id;
  }

  async simular(
    municipio: Municipio,
    entrada: EntradaSimulacao,
    tipoProcessoId?: string | null,
  ): Promise<Simulacao> {
    const tipo =
      tipoProcessoId ??
      (entrada.tipo_processo
        ? await this.tipoProcessoId(municipio.id, entrada.tipo_processo)
        : null);
    if (!tipo && !entrada.taxas?.length) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'pedido_invalido',
        'Indique o tipo de processo ou os códigos das taxas.',
      );
    }
    const tabela = await this.tabelaEmVigor(municipio);
    const r = calcularTaxas(tabela.taxas, {
      tipoProcessoId: tipo,
      taxas: entrada.taxas,
      quantidades: entrada.quantidades,
    });
    return {
      ...r,
      completa: r.em_falta.length === 0 && r.desconhecidas.length === 0,
      total_por_extenso: eurosPorExtenso(r.total_cent),
      total_texto: formatarEuros(r.total_cent),
      tabela: { ano: tabela.ano, vigor_desde: tabela.vigor_desde },
      fonte: tabela.fonte,
    };
  }

  /**
   * Cria o pagamento (referência MB de teste) do requerimento ou processo e
   * manda o SMS. Idempotente: se o objeto já tem um pagamento pendente,
   * devolve esse (o agente pode repetir a chamada).
   */
  async criar(
    ctx: ContextoFerramenta,
    entrada: EntradaSimulacao & {
      requerimento_id?: string;
      processo_id?: string;
    },
  ) {
    const m = ctx.municipio;
    const objeto = await this.objetoAPagar(ctx, entrada);

    const existente = await this.pendenteDe(objeto);
    if (existente) return this.resumoCriado(existente, null, true);

    const sim = await this.simular(
      m,
      entrada,
      entrada.taxas?.length ? null : objeto.tipo_processo_id,
    );
    if (!sim.completa) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'faltam_quantidades',
        'Faltam dados para calcular o valor: pergunte ao munícipe e tente outra vez.',
        { em_falta: sim.em_falta, desconhecidas: sim.desconhecidas },
      );
    }
    if (sim.total_cent <= 0) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'sem_valor',
        'Não há taxas a pagar para este pedido.',
      );
    }

    const feriados = await this.municipios.feriados(m.id);
    const pagarAte = somarDiasUteis(
      hojeEm(m.fuso),
      PRAZO_PAGAMENTO_DIAS_UTEIS,
      feriados,
    );
    const telefone = ctx.telefone ?? objeto.telefone;

    const r = await this.db.transaction(async (tx) => {
      const ano = new Date().getFullYear();
      const n = await proximoNumero(tx, m.id, SERIE_GUIA, ano);
      const referencia = await this.referenciaLivre(tx, sim.total_cent);
      const [p] = await tx.query<LinhaPagamento>(
        `INSERT INTO pagamentos AS p (municipio_id, processo_id, requerimento_id, conversa_id,
           guia_numero, valor_cent, detalhe, metodo, mb_entidade, mb_referencia, pagar_ate,
           modo_teste, provider, provider_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'multibanco', $8, $9, $10, true, 'teste', $11)
         ON CONFLICT DO NOTHING
         RETURNING ${COLUNAS}`,
        [
          m.id,
          objeto.processo_id,
          objeto.requerimento_id,
          ctx.conversaId,
          `${ano}/${n}`,
          sim.total_cent,
          JSON.stringify(sim.linhas),
          ENTIDADE_TESTE,
          referencia,
          pagarAte,
          `teste_${randomUUID()}`,
        ],
      );
      if (!p) return null; // corrida com outra chamada igual: devolve-se a dela
      const link = await this.links.criar(m.id, 'pagamento', p.id, { tx });
      if (telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: objeto.municipe_id,
            destino: telefone,
            motivo: 'pagamento',
            corpo:
              `${m.nome}: guia ${p.guia_numero}, ${formatarEuros(p.valor_cent)}. ` +
              `Multibanco (MODO DE TESTE, nada é cobrado): entidade ${p.mb_entidade}, ` +
              `ref. ${formatarReferencia(p.mb_referencia ?? '')}. Pagar até ${dataCurta(pagarAte)}. ${link.url}`,
            relacionado: this.relacionado(p, ctx.conversaId),
            chave: `pagamento:${p.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'pagamento',
        {
          pagamento_id: p.id,
          guia_numero: p.guia_numero,
          valor_cent: p.valor_cent,
          modo_teste: true,
        },
        tx,
      );
      return { p, link: link.url };
    });

    if (!r) {
      const outro = await this.pendenteDe(objeto);
      if (outro) return this.resumoCriado(outro, null, true);
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'conflito',
        'Não foi possível criar a referência. Tente outra vez.',
      );
    }
    return this.resumoCriado(r.p, r.link, false, !!telefone);
  }

  private resumoCriado(
    p: LinhaPagamento,
    link: string | null,
    jaExistia: boolean,
    smsEnviado = true,
  ) {
    return {
      pagamento_id: p.id,
      ja_existia: jaExistia,
      modo_teste: p.modo_teste,
      guia_numero: p.guia_numero,
      valor_cent: p.valor_cent,
      valor_por_extenso: eurosPorExtenso(p.valor_cent),
      entidade: p.mb_entidade,
      referencia: formatarReferencia(p.mb_referencia ?? ''),
      pagar_ate: p.pagar_ate,
      pagar_ate_dito: p.pagar_ate ? dataDita(p.pagar_ate) : null,
      estado: p.estado,
      sms_enviado: smsEnviado,
      link,
      dizer: p.modo_teste
        ? 'É uma referência de teste: o pagamento por aqui ainda está em modo de teste e nada é cobrado.'
        : null,
    };
  }

  /** O requerimento ou processo a pagar (o da conversa, se não vier nenhum). */
  private async objetoAPagar(
    ctx: ContextoFerramenta,
    e: { requerimento_id?: string; processo_id?: string },
  ) {
    type Objeto = {
      requerimento_id: string | null;
      processo_id: string | null;
      tipo_processo_id: string;
      municipe_id: string | null;
      telefone: string | null;
    };
    let o: Objeto | undefined;
    if (e.processo_id) {
      [o] = await this.db.query<Objeto>(
        `SELECT NULL::uuid AS requerimento_id, p.id AS processo_id, p.tipo_processo_id,
                p.municipe_id, mu.telefone_e164 AS telefone
         FROM processos p LEFT JOIN municipes mu ON mu.id = p.municipe_id
         WHERE p.id = $1 AND p.municipio_id = $2`,
        [e.processo_id, ctx.municipio.id],
      );
    } else {
      [o] = await this.db.query<Objeto>(
        `SELECT r.id AS requerimento_id, r.processo_id, r.tipo_processo_id,
                r.municipe_id, mu.telefone_e164 AS telefone
         FROM requerimentos r LEFT JOIN municipes mu ON mu.id = r.municipe_id
         WHERE r.municipio_id = $1
           AND (r.id = $2::uuid OR ($2::uuid IS NULL AND r.conversa_id = $3::uuid))
           AND r.estado <> 'cancelado'
         ORDER BY r.criado_em DESC
         LIMIT 1`,
        [ctx.municipio.id, e.requerimento_id ?? null, ctx.conversaId],
      );
    }
    if (!o) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_objeto_a_pagar',
        e.requerimento_id || e.processo_id
          ? 'Esse requerimento ou processo não existe.'
          : 'Esta conversa ainda não tem requerimento: preencha-o primeiro.',
      );
    }
    return o;
  }

  private async pendenteDe(o: {
    requerimento_id: string | null;
    processo_id: string | null;
  }): Promise<LinhaPagamento | null> {
    const [p] = await this.db.query<LinhaPagamento>(
      `SELECT ${COLUNAS} FROM pagamentos p
       WHERE p.estado = 'pendente'
         AND (p.requerimento_id = $1::uuid OR ($1::uuid IS NULL AND p.processo_id = $2::uuid))
       ORDER BY p.criado_em DESC LIMIT 1`,
      [o.requerimento_id, o.processo_id],
    );
    return p ?? null;
  }

  /** Referência que não esteja pendente noutro pagamento (colisão rara: 1 em 10⁷). */
  private async referenciaLivre(tx: Tx, valorCent: number): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const ref = gerarReferencia(valorCent);
      const [usada] = await tx.query(
        `SELECT 1 FROM pagamentos WHERE mb_entidade = $1 AND mb_referencia = $2 AND estado = 'pendente'`,
        [ENTIDADE_TESTE, ref],
      );
      if (!usada) return ref;
    }
    throw new Error('Não foi possível gerar uma referência livre.');
  }

  private relacionado(
    p: Pick<LinhaPagamento, 'id' | 'processo_id' | 'requerimento_id'>,
    conversaId?: string | null,
  ): Record<string, string> {
    const r: Record<string, string> = { pagamento_id: p.id };
    if (p.processo_id) r.processo_id = p.processo_id;
    if (p.requerimento_id) r.requerimento_id = p.requerimento_id;
    if (conversaId) r.conversa_id = conversaId;
    return r;
  }

  /**
   * O que o fornecedor (webhook) ou a simulação da demo dizem do pagamento.
   * Idempotente: o fornecedor repete; um pagamento já pago não muda nem
   * volta a mandar SMS.
   */
  async registarResultado(
    r: ResultadoPagamento,
    origem: 'webhook' | 'simulacao',
  ) {
    const [p] = await this.db.query<
      LinhaPagamento & {
        municipe_id: string | null;
        telefone: string | null;
        processo_efetivo: string | null;
        municipio_nome: string;
      }
    >(
      `SELECT ${COLUNAS}, coalesce(r.municipe_id, pr.municipe_id) AS municipe_id,
              mu.telefone_e164 AS telefone, mun.nome AS municipio_nome,
              coalesce(p.processo_id, r.processo_id) AS processo_efetivo
       FROM pagamentos p
       JOIN municipios mun ON mun.id = p.municipio_id
       LEFT JOIN requerimentos r ON r.id = p.requerimento_id
       LEFT JOIN processos pr ON pr.id = p.processo_id
       LEFT JOIN municipes mu ON mu.id = coalesce(r.municipe_id, pr.municipe_id)
       WHERE ($1::text IS NOT NULL AND p.provider_ref = $1)
          OR ($2::text IS NOT NULL AND p.mb_referencia = $2
              AND ($3::text IS NULL OR p.mb_entidade = $3))
       ORDER BY (p.estado = 'pendente') DESC, p.criado_em DESC
       LIMIT 1`,
      [r.provider_ref ?? null, r.mb_referencia ?? null, r.mb_entidade ?? null],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'pagamento_desconhecido',
        'Não há pagamento com essa referência.',
      );
    }
    if (origem === 'simulacao' && !p.modo_teste) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'so_modo_teste',
        'Só os pagamentos em modo de teste se podem simular.',
      );
    }
    if (r.valor_cent !== p.valor_cent) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'valor_diferente',
        'O valor recebido não é o da referência.',
        { esperado_cent: p.valor_cent, recebido_cent: r.valor_cent },
      );
    }
    if (r.estado === 'pendente' || r.estado === p.estado) {
      return { pagamento_id: p.id, estado: p.estado, ja_processado: true };
    }

    return this.db.transaction(async (tx) => {
      const [mudou] = await tx.query<{ pago_em: Date | null }>(
        `UPDATE pagamentos SET estado = $2::estado_pag,
           pago_em = CASE WHEN $2::estado_pag = 'pago' THEN now() ELSE pago_em END
         WHERE id = $1 AND estado = 'pendente'
         RETURNING pago_em`,
        [p.id, r.estado],
      );
      if (!mudou) {
        return { pagamento_id: p.id, estado: p.estado, ja_processado: true };
      }
      if (r.estado !== 'pago') {
        return { pagamento_id: p.id, estado: r.estado, ja_processado: false };
      }
      if (p.processo_efetivo) {
        await tx.query(
          `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados)
           VALUES ($1, 'pagamento', $2, 'sistema', $3)`,
          [
            p.processo_efetivo,
            `Taxa paga: ${formatarEuros(p.valor_cent)} (guia ${p.guia_numero})` +
              (p.modo_teste ? ' · modo de teste' : ''),
            JSON.stringify({
              pagamento_id: p.id,
              valor_cent: p.valor_cent,
              modo_teste: p.modo_teste,
              origem,
            }),
          ],
        );
      }
      if (p.telefone) {
        await this.mensagens.sms(
          {
            municipioId: p.municipio_id,
            municipeId: p.municipe_id,
            destino: p.telefone,
            motivo: 'pagamento',
            corpo:
              `${p.municipio_nome}: recebemos o pagamento da guia ${p.guia_numero}, ` +
              `${formatarEuros(p.valor_cent)}.` +
              (p.modo_teste ? ' (MODO DE TESTE, nada foi cobrado.)' : ''),
            relacionado: this.relacionado(p),
            chave: `pagamento_pago:${p.id}`,
          },
          tx,
        );
      }
      this.logger.log(`Pagamento ${p.id} pago (${origem}).`);
      return { pagamento_id: p.id, estado: 'pago', ja_processado: false };
    });
  }

  /** Página do link do SMS. Sem dados pessoais: só valores e referência. */
  async publico(codigo: string) {
    const { destinoId } = await this.links.resolver(codigo, 'pagamento');
    const [p] = await this.db.query<
      LinhaPagamento & { municipio_nome: string; fuso: string }
    >(
      `SELECT ${COLUNAS}, mun.nome AS municipio_nome, mun.fuso
       FROM pagamentos p JOIN municipios mun ON mun.id = p.municipio_id
       WHERE p.id = $1`,
      [destinoId],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe ou já expirou.',
      );
    }
    // Uma referência fora de prazo não se paga, mesmo antes de o fornecedor o dizer.
    const expirou =
      p.estado === 'pendente' &&
      p.pagar_ate !== null &&
      p.pagar_ate < hojeEm(p.fuso);
    return {
      municipio: p.municipio_nome,
      guia_numero: p.guia_numero,
      valor_cent: p.valor_cent,
      valor_texto: formatarEuros(p.valor_cent),
      linhas: p.detalhe,
      metodo: p.metodo,
      mb_entidade: p.mb_entidade,
      mb_referencia: p.mb_referencia
        ? formatarReferencia(p.mb_referencia)
        : null,
      pagar_ate: p.pagar_ate,
      estado: expirou ? 'expirado' : p.estado,
      pago_em: p.pago_em,
      modo_teste: p.modo_teste,
    };
  }

  /** Demo: "pagar" sem banco. Passa pelo mesmo caminho do webhook. */
  async simularPagamentoPublico(codigo: string) {
    const { destinoId } = await this.links.resolver(codigo, 'pagamento');
    const [p] = await this.db.query<{
      provider_ref: string | null;
      mb_referencia: string | null;
      mb_entidade: string | null;
      valor_cent: number;
      modo_teste: boolean;
    }>(
      `SELECT provider_ref, mb_referencia, mb_entidade, valor_cent, modo_teste
       FROM pagamentos WHERE id = $1`,
      [destinoId],
    );
    if (!p?.modo_teste) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'so_modo_teste',
        'Só os pagamentos em modo de teste se podem simular.',
      );
    }
    const pub = await this.publico(codigo);
    if (pub.estado === 'expirado') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'referencia_expirada',
        'Esta referência já passou do prazo.',
      );
    }
    await this.registarResultado(
      {
        estado: 'pago',
        valor_cent: p.valor_cent,
        provider_ref: p.provider_ref ?? undefined,
        mb_referencia: p.mb_referencia ?? undefined,
        mb_entidade: p.mb_entidade ?? undefined,
      },
      'simulacao',
    );
    return this.publico(codigo);
  }

  /** Painel: pagamentos do município, mais recentes primeiro. */
  async listar(
    municipioId: string,
    filtros: {
      estado?: ResultadoPagamento['estado'];
      limite: number;
      cursor: { em: string; id: string } | null;
    },
  ): Promise<Pagina<Record<string, unknown>>> {
    const linhas = await this.db.query<
      LinhaPagamento & Record<string, unknown>
    >(
      `SELECT ${COLUNAS}, p.conversa_id,
              pr.numero AS processo_numero, tp.nome AS tipo_processo,
              mu.nome AS municipe_nome
       FROM pagamentos p
       LEFT JOIN requerimentos r ON r.id = p.requerimento_id
       LEFT JOIN processos pr ON pr.id = coalesce(p.processo_id, r.processo_id)
       LEFT JOIN tipos_processo tp ON tp.id = coalesce(pr.tipo_processo_id, r.tipo_processo_id)
       LEFT JOIN municipes mu ON mu.id = coalesce(r.municipe_id, pr.municipe_id)
       WHERE p.municipio_id = $1
         AND ($2::estado_pag IS NULL OR p.estado = $2::estado_pag)
         AND ($3::timestamptz IS NULL OR (p.criado_em, p.id) < ($3::timestamptz, $4::uuid))
       ORDER BY p.criado_em DESC, p.id DESC
       LIMIT $5`,
      [
        municipioId,
        filtros.estado ?? null,
        filtros.cursor?.em ?? null,
        filtros.cursor?.id ?? null,
        filtros.limite + 1,
      ],
    );
    return pagina(linhas, filtros.limite, (l) => ({
      em: l.criado_em,
      id: l.id,
    }));
  }
}
