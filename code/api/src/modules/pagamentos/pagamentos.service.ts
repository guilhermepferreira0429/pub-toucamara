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
  EstadoPedidoGuardado,
  EstadoPedidoMbway,
  estadoPedido,
  mascararTelemovel,
  MBWAY_MAX_PEDIDOS,
  MBWAY_VALIDADE_MIN,
  segundosRestantes,
  telemovelMbway,
} from './mbway.js';
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

export type MetodoPagamento = 'multibanco' | 'mbway';

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
  metodo: MetodoPagamento | 'cartao' | null;
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

/** Um pedido MB WAY (tabela `pedidos_mbway`, migração 0025). */
interface PedidoMbway {
  id: string;
  pagamento_id: string;
  telemovel_e164: string;
  provider_ref: string;
  estado: EstadoPedidoGuardado;
  criado_em: Date;
  expira_em: Date;
}

const COLUNAS_PEDIDO = `id, pagamento_id, telemovel_e164, provider_ref, estado, criado_em, expira_em`;

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
   * manda o SMS. Com `metodo: 'mbway'` faz também o pedido MB WAY de teste
   * ao telemóvel (a referência MB fica como alternativa). Idempotente: se o
   * objeto já tem um pagamento pendente, devolve esse (o agente pode repetir
   * a chamada); se agora for MB WAY, faz-lhe o pedido.
   */
  async criar(
    ctx: ContextoFerramenta,
    entrada: EntradaSimulacao & {
      requerimento_id?: string;
      processo_id?: string;
      metodo?: MetodoPagamento;
      telemovel?: string;
    },
  ) {
    const m = ctx.municipio;
    const objeto = await this.objetoAPagar(ctx, entrada);
    const telemovel =
      entrada.metodo === 'mbway'
        ? this.telemovelPara(entrada.telemovel, ctx.telefone ?? objeto.telefone)
        : null;

    const existente = await this.pendenteDe(objeto);
    if (existente) {
      if (!telemovel) return this.resumoCriado(existente, null, true);
      const r = await this.db.transaction(async (tx) => {
        const { pedido, novo } = await this.pedirMbway(
          tx,
          existente.id,
          telemovel,
        );
        if (!novo) return { pedido, link: null };
        const link = await this.links.criar(m.id, 'pagamento', existente.id, {
          tx,
        });
        await this.smsMbway(tx, m, objeto.municipe_id, existente, pedido, {
          link: link.url,
          conversaId: ctx.conversaId,
        });
        return { pedido, link: link.url };
      });
      return this.resumoCriado(
        { ...existente, metodo: 'mbway' },
        r.link,
        true,
        true,
        r.pedido,
      );
    }

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
      let pedido: PedidoMbway | null = null;
      if (telemovel) {
        // O SMS vai para o telemóvel do MB WAY, que de certeza recebe SMS.
        pedido = (await this.pedirMbway(tx, p.id, telemovel)).pedido;
        p.metodo = 'mbway';
        await this.smsMbway(tx, m, objeto.municipe_id, p, pedido, {
          link: link.url,
          conversaId: ctx.conversaId,
        });
      } else if (telefone) {
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
          metodo: p.metodo,
          modo_teste: true,
        },
        tx,
      );
      return { p, link: link.url, pedido };
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
    return this.resumoCriado(
      r.p,
      r.link,
      false,
      !!(telemovel ?? telefone),
      r.pedido,
    );
  }

  private resumoCriado(
    p: LinhaPagamento,
    link: string | null,
    jaExistia: boolean,
    smsEnviado = true,
    pedido: PedidoMbway | null = null,
  ) {
    const mbway = pedido
      ? {
          telemovel: mascararTelemovel(pedido.telemovel_e164),
          estado: estadoPedido(pedido.estado, pedido.expira_em),
          expira_em: pedido.expira_em,
          validade_minutos: MBWAY_VALIDADE_MIN,
        }
      : null;
    let dizer: string | null = null;
    if (p.modo_teste) {
      dizer = mbway
        ? `Vai receber um pedido MB WAY no ${mbway.telemovel}: é um teste, nada é cobrado. ` +
          'Como é de teste, o pedido não chega à app: aceita-se no link que seguiu por SMS, ' +
          `nos próximos ${MBWAY_VALIDADE_MIN} minutos. Se expirar, pode pedir outro na mesma página ou pagar pela referência Multibanco.`
        : 'É uma referência de teste: o pagamento por aqui ainda está em modo de teste e nada é cobrado.';
    }
    return {
      pagamento_id: p.id,
      ja_existia: jaExistia,
      modo_teste: p.modo_teste,
      metodo: p.metodo,
      mbway,
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
      dizer,
    };
  }

  /**
   * O telemóvel do MB WAY: o que a pessoa disse ou, sem isso, o número de
   * onde liga (ou o do munícipe). Tem de ser móvel português.
   */
  private telemovelPara(dito: string | undefined, contexto: string | null) {
    if (dito) {
      const t = telemovelMbway(dito);
      if (!t) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'telemovel_invalido',
          'Esse número não é um telemóvel português (9 dígitos a começar por 9). Peça o número associado ao MB WAY.',
        );
      }
      return t;
    }
    const t = telemovelMbway(contexto);
    if (!t) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'falta_telemovel',
        'Não há um telemóvel português nesta conversa. Pergunte o número associado ao MB WAY e chame outra vez com telemovel.',
      );
    }
    return t;
  }

  /**
   * Faz o pedido MB WAY de teste (nada é enviado a nenhuma app) e marca o
   * pagamento como MB WAY. Se já houver um pedido por aceitar para o mesmo
   * número, devolve esse (`novo: false`); outro número cancela-o. No máximo
   * MBWAY_MAX_PEDIDOS por pagamento.
   */
  private async pedirMbway(
    tx: Tx,
    pagamentoId: string,
    telemovel: string,
  ): Promise<{ pedido: PedidoMbway; novo: boolean }> {
    // Trinco no pagamento: dois pedidos ao mesmo tempo não passam o limite.
    const [p] = await tx.query<{ estado: string; modo_teste: boolean }>(
      `SELECT estado, modo_teste FROM pagamentos WHERE id = $1 FOR UPDATE`,
      [pagamentoId],
    );
    if (!p || p.estado !== 'pendente') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'pagamento_fechado',
        'Este pagamento já não está por pagar.',
      );
    }
    if (!p.modo_teste) {
      // Sem fornecedor real não se finge um pedido verdadeiro.
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'mbway_indisponivel',
        'O MB WAY ainda só funciona em modo de teste.',
      );
    }
    // clock_timestamp(): o now() de uma transação é a hora do BEGIN.
    await tx.query(
      `UPDATE pedidos_mbway SET estado = 'expirado', fechado_em = clock_timestamp()
       WHERE pagamento_id = $1 AND estado = 'pendente' AND expira_em <= clock_timestamp()`,
      [pagamentoId],
    );
    const [aberto] = await tx.query<PedidoMbway>(
      `SELECT ${COLUNAS_PEDIDO} FROM pedidos_mbway
       WHERE pagamento_id = $1 AND estado = 'pendente'`,
      [pagamentoId],
    );
    if (aberto?.telemovel_e164 === telemovel) {
      return { pedido: aberto, novo: false };
    }
    if (aberto) {
      await tx.query(
        `UPDATE pedidos_mbway SET estado = 'cancelado', fechado_em = clock_timestamp() WHERE id = $1`,
        [aberto.id],
      );
    }
    const [{ n }] = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pedidos_mbway WHERE pagamento_id = $1`,
      [pagamentoId],
    );
    if (n >= MBWAY_MAX_PEDIDOS) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'limite_pedidos_mbway',
        `Já se fizeram ${MBWAY_MAX_PEDIDOS} pedidos MB WAY para este pagamento. Pague pela referência Multibanco.`,
      );
    }
    const [pedido] = await tx.query<PedidoMbway>(
      `INSERT INTO pedidos_mbway (pagamento_id, telemovel_e164, provider_ref, expira_em)
       VALUES ($1, $2, $3, clock_timestamp() + make_interval(mins => $4))
       RETURNING ${COLUNAS_PEDIDO}`,
      [
        pagamentoId,
        telemovel,
        `teste_mbway_${randomUUID()}`,
        MBWAY_VALIDADE_MIN,
      ],
    );
    await tx.query(`UPDATE pagamentos SET metodo = 'mbway' WHERE id = $1`, [
      pagamentoId,
    ]);
    return { pedido, novo: true };
  }

  /** SMS do pedido MB WAY: o link para o aceitar e o Multibanco como alternativa. */
  private async smsMbway(
    tx: Tx,
    m: Municipio,
    municipeId: string | null,
    p: LinhaPagamento,
    pedido: PedidoMbway,
    o: { link: string; conversaId?: string | null },
  ) {
    const mb = p.mb_referencia
      ? ` Ou Multibanco: ent. ${p.mb_entidade}, ref. ${formatarReferencia(p.mb_referencia)}` +
        (p.pagar_ate ? `, até ${dataCurta(p.pagar_ate)}.` : '.')
      : '';
    await this.mensagens.sms(
      {
        municipioId: m.id,
        municipeId,
        destino: pedido.telemovel_e164,
        motivo: 'pagamento',
        corpo:
          `${m.nome}: guia ${p.guia_numero}, ${formatarEuros(p.valor_cent)}. ` +
          `MB WAY (MODO DE TESTE, nada é cobrado): aceite o pedido em ${MBWAY_VALIDADE_MIN} min em ${o.link}.` +
          mb,
        relacionado: this.relacionado(p, o.conversaId),
        chave: `pagamento_mbway:${pedido.id}`,
      },
      tx,
    );
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
   *
   * `provider_ref` pode ser o de um pedido MB WAY: 'pago' paga o pagamento
   * por MB WAY; 'expirado' ou 'cancelado' (recusado na app) só fecham o
   * pedido, e o pagamento continua pendente.
   */
  async registarResultado(
    r: ResultadoPagamento,
    origem: 'webhook' | 'simulacao',
  ) {
    const [pedido] = r.provider_ref
      ? await this.db.query<PedidoMbway>(
          `SELECT ${COLUNAS_PEDIDO} FROM pedidos_mbway WHERE provider_ref = $1`,
          [r.provider_ref],
        )
      : [];
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
       WHERE ($4::uuid IS NOT NULL AND p.id = $4::uuid)
          OR ($4::uuid IS NULL AND (
                ($1::text IS NOT NULL AND p.provider_ref = $1)
             OR ($2::text IS NOT NULL AND p.mb_referencia = $2
                 AND ($3::text IS NULL OR p.mb_entidade = $3))))
       ORDER BY (p.estado = 'pendente') DESC, p.criado_em DESC
       LIMIT 1`,
      [
        r.provider_ref ?? null,
        r.mb_referencia ?? null,
        r.mb_entidade ?? null,
        pedido?.pagamento_id ?? null,
      ],
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

    // Pedido MB WAY que expirou ou foi recusado: o pagamento não muda.
    if (pedido && (r.estado === 'expirado' || r.estado === 'cancelado')) {
      const [fechou] = await this.db.query(
        `UPDATE pedidos_mbway SET estado = $2::estado_pag, fechado_em = now()
         WHERE id = $1 AND estado = 'pendente' RETURNING id`,
        [pedido.id, r.estado],
      );
      return {
        pagamento_id: p.id,
        estado: p.estado,
        pedido_mbway: fechou ? r.estado : pedido.estado,
        ja_processado: !fechou,
      };
    }

    if (r.estado === 'pendente' || r.estado === p.estado) {
      return { pagamento_id: p.id, estado: p.estado, ja_processado: true };
    }

    // O método com que se pagou: o pedido MB WAY ou a referência MB (a única
    // outra forma de pagar enquanto não há fornecedor).
    const metodo: MetodoPagamento = pedido ? 'mbway' : 'multibanco';

    return this.db.transaction(async (tx) => {
      if (pedido && r.estado === 'pago') {
        // A demo só aceita dentro da validade; o fornecedor manda (o dinheiro entrou).
        const [aceite] = await tx.query(
          `UPDATE pedidos_mbway SET estado = 'pago', fechado_em = clock_timestamp()
           WHERE id = $1 AND ($2::boolean OR (estado = 'pendente' AND expira_em > clock_timestamp()))
           RETURNING id`,
          [pedido.id, origem === 'webhook'],
        );
        if (!aceite) {
          throw new ErroApi(
            HttpStatus.CONFLICT,
            'pedido_expirado',
            'Este pedido MB WAY já expirou. Peça outro ou pague por Multibanco.',
          );
        }
      }
      const [mudou] = await tx.query<{ pago_em: Date | null }>(
        `UPDATE pagamentos SET estado = $2::estado_pag,
           pago_em = CASE WHEN $2::estado_pag = 'pago' THEN now() ELSE pago_em END,
           metodo = CASE WHEN $2::estado_pag = 'pago' THEN $3::metodo_pag ELSE metodo END
         WHERE id = $1 AND estado = 'pendente'
         RETURNING pago_em`,
        [p.id, r.estado, metodo],
      );
      if (!mudou) {
        return { pagamento_id: p.id, estado: p.estado, ja_processado: true };
      }
      // Pago, expirado ou cancelado: o pedido MB WAY que estivesse aberto já não serve.
      await tx.query(
        `UPDATE pedidos_mbway SET estado = 'cancelado', fechado_em = clock_timestamp()
         WHERE pagamento_id = $1 AND estado = 'pendente'`,
        [p.id],
      );
      if (r.estado !== 'pago') {
        return { pagamento_id: p.id, estado: r.estado, ja_processado: false };
      }
      const porMetodo = metodo === 'mbway' ? 'MB WAY' : 'Multibanco';
      if (p.processo_efetivo) {
        await tx.query(
          `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados)
           VALUES ($1, 'pagamento', $2, 'sistema', $3)`,
          [
            p.processo_efetivo,
            `Taxa paga por ${porMetodo}: ${formatarEuros(p.valor_cent)} (guia ${p.guia_numero})` +
              (p.modo_teste ? ' · modo de teste' : ''),
            JSON.stringify({
              pagamento_id: p.id,
              valor_cent: p.valor_cent,
              metodo,
              modo_teste: p.modo_teste,
              origem,
            }),
          ],
        );
      }
      // MB WAY: sem telefone do munícipe, vai para o telemóvel do pedido.
      const destino = p.telefone ?? pedido?.telemovel_e164 ?? null;
      if (destino) {
        await this.mensagens.sms(
          {
            municipioId: p.municipio_id,
            municipeId: p.municipe_id,
            destino,
            motivo: 'pagamento',
            corpo:
              `${p.municipio_nome}: recebemos o pagamento da guia ${p.guia_numero}, ` +
              `${formatarEuros(p.valor_cent)}, por ${porMetodo}.` +
              (p.modo_teste ? ' (MODO DE TESTE, nada foi cobrado.)' : ''),
            relacionado: this.relacionado(p),
            chave: `pagamento_pago:${p.id}`,
          },
          tx,
        );
      }
      this.logger.log(`Pagamento ${p.id} pago por ${metodo} (${origem}).`);
      return {
        pagamento_id: p.id,
        estado: 'pago',
        metodo,
        ja_processado: false,
      };
    });
  }

  /** O pagamento do link (pelo código), com o fuso e o nome do município. */
  private async doLink(codigo: string) {
    const { destinoId } = await this.links.resolver(codigo, 'pagamento');
    const [p] = await this.db.query<
      LinhaPagamento & {
        municipio_nome: string;
        fuso: string;
        provider_ref: string | null;
      }
    >(
      `SELECT ${COLUNAS}, p.provider_ref, mun.nome AS municipio_nome, mun.fuso
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
    return { ...p, estado: expirou ? ('expirado' as const) : p.estado };
  }

  /** O pedido MB WAY mais recente do pagamento e quantos já se fizeram. */
  private async ultimoPedido(
    pagamentoId: string,
  ): Promise<{ pedido: PedidoMbway | null; feitos: number }> {
    const [l] = await this.db.query<PedidoMbway & { feitos: number }>(
      `SELECT ${COLUNAS_PEDIDO}, count(*) OVER ()::int AS feitos
       FROM pedidos_mbway WHERE pagamento_id = $1
       ORDER BY criado_em DESC LIMIT 1`,
      [pagamentoId],
    );
    if (!l) return { pedido: null, feitos: 0 };
    const { feitos, ...pedido } = l;
    return { pedido, feitos };
  }

  /**
   * Página do link do SMS. Sem dados pessoais: só valores, referência e o
   * telemóvel do MB WAY mascarado. `mbway.segundos_restantes` é para a
   * contagem decrescente (a página conta a partir daí).
   */
  async publico(codigo: string) {
    const p = await this.doLink(codigo);
    const { pedido, feitos } = await this.ultimoPedido(p.id);
    let mbway: {
      telemovel: string;
      estado: EstadoPedidoMbway;
      expira_em: Date;
      segundos_restantes: number;
      validade_minutos: number;
      pedidos_feitos: number;
      pedidos_restantes: number;
      pode_reenviar: boolean;
    } | null = null;
    if (pedido) {
      const agora = new Date();
      const estado = estadoPedido(pedido.estado, pedido.expira_em, agora);
      const restantes = Math.max(0, MBWAY_MAX_PEDIDOS - feitos);
      mbway = {
        telemovel: mascararTelemovel(pedido.telemovel_e164),
        estado,
        expira_em: pedido.expira_em,
        segundos_restantes:
          estado === 'por_aceitar'
            ? segundosRestantes(pedido.expira_em, agora)
            : 0,
        validade_minutos: MBWAY_VALIDADE_MIN,
        pedidos_feitos: feitos,
        pedidos_restantes: restantes,
        pode_reenviar:
          p.estado === 'pendente' &&
          restantes > 0 &&
          (estado === 'expirado' || estado === 'cancelado'),
      };
    }
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
      estado: p.estado,
      pago_em: p.pago_em,
      modo_teste: p.modo_teste,
      mbway,
    };
  }

  /** Para as ações da página: só pagamentos de teste ainda por pagar. */
  private async abertoDeTeste(codigo: string) {
    const p = await this.doLink(codigo);
    if (!p.modo_teste) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'so_modo_teste',
        'Só os pagamentos em modo de teste se podem simular.',
      );
    }
    if (p.estado === 'expirado') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'referencia_expirada',
        'Esta referência já passou do prazo.',
      );
    }
    if (p.estado !== 'pendente') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'pagamento_fechado',
        p.estado === 'pago'
          ? 'Este pagamento já está pago.'
          : 'Este pagamento foi cancelado.',
      );
    }
    return p;
  }

  /** Demo: "pagar" a referência MB sem banco. Passa pelo mesmo caminho do webhook. */
  async simularPagamentoPublico(codigo: string) {
    const p = await this.abertoDeTeste(codigo);
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

  /** Demo: "aceitar" o pedido MB WAY de teste, dentro da validade. */
  async aceitarMbwayPublico(codigo: string) {
    const p = await this.abertoDeTeste(codigo);
    const { pedido } = await this.ultimoPedido(p.id);
    if (!pedido) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_pedido_mbway',
        'Este pagamento não tem pedido MB WAY.',
      );
    }
    if (estadoPedido(pedido.estado, pedido.expira_em) !== 'por_aceitar') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'pedido_expirado',
        'Este pedido MB WAY já expirou. Peça outro ou pague por Multibanco.',
      );
    }
    await this.registarResultado(
      {
        estado: 'pago',
        valor_cent: p.valor_cent,
        provider_ref: pedido.provider_ref,
      },
      'simulacao',
    );
    return this.publico(codigo);
  }

  /** Novo pedido MB WAY para o mesmo número, se o anterior já não serve. */
  async reenviarMbwayPublico(codigo: string) {
    const p = await this.abertoDeTeste(codigo);
    const { pedido } = await this.ultimoPedido(p.id);
    if (!pedido) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_pedido_mbway',
        'Este pagamento não tem pedido MB WAY: escolha primeiro o MB WAY.',
      );
    }
    if (estadoPedido(pedido.estado, pedido.expira_em) === 'por_aceitar') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'pedido_ainda_valido',
        'O pedido MB WAY ainda está à espera de ser aceite.',
      );
    }
    await this.db.transaction((tx) =>
      this.pedirMbway(tx, p.id, pedido.telemovel_e164),
    );
    return this.publico(codigo);
  }

  /**
   * Troca o método do mesmo pagamento. Para MB WAY faz o pedido ao
   * telemóvel (a referência MB fica como alternativa); para Multibanco
   * cancela o pedido MB WAY aberto.
   */
  async trocarMetodoPublico(
    codigo: string,
    e: { metodo: MetodoPagamento; telemovel?: string },
  ) {
    const p = await this.abertoDeTeste(codigo);
    if (e.metodo === 'mbway') {
      const t = telemovelMbway(e.telemovel);
      if (!t) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'telemovel_invalido',
          'Indique um telemóvel português (9 dígitos a começar por 9) associado ao MB WAY.',
        );
      }
      await this.db.transaction((tx) => this.pedirMbway(tx, p.id, t));
    } else {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE pedidos_mbway SET estado = 'cancelado', fechado_em = clock_timestamp()
           WHERE pagamento_id = $1 AND estado = 'pendente'`,
          [p.id],
        );
        await tx.query(
          `UPDATE pagamentos SET metodo = 'multibanco' WHERE id = $1 AND estado = 'pendente'`,
          [p.id],
        );
      });
    }
    return this.publico(codigo);
  }

  /**
   * Painel: pagamentos do município, mais recentes primeiro, com o método
   * (filtrável) e, se houve MB WAY, o estado do último pedido.
   */
  async listar(
    municipioId: string,
    filtros: {
      estado?: ResultadoPagamento['estado'];
      metodo?: MetodoPagamento | 'cartao';
      limite: number;
      cursor: { em: string; id: string } | null;
    },
  ): Promise<Pagina<Record<string, unknown>>> {
    const linhas = await this.db.query<
      LinhaPagamento & Record<string, unknown>
    >(
      `SELECT ${COLUNAS}, p.conversa_id,
              pr.numero AS processo_numero, tp.nome AS tipo_processo,
              mu.nome AS municipe_nome,
              CASE WHEN mb.id IS NULL THEN NULL ELSE jsonb_build_object(
                'estado', CASE WHEN mb.estado = 'pendente' AND mb.expira_em <= now() THEN 'expirado'
                               WHEN mb.estado = 'pendente' THEN 'por_aceitar'
                               ELSE mb.estado::text END,
                'expira_em', mb.expira_em, 'pedidos_feitos', mb.feitos)
              END AS mbway
       FROM pagamentos p
       LEFT JOIN LATERAL (
         SELECT x.id, x.estado, x.expira_em, count(*) OVER ()::int AS feitos
         FROM pedidos_mbway x WHERE x.pagamento_id = p.id
         ORDER BY x.criado_em DESC LIMIT 1
       ) mb ON true
       LEFT JOIN requerimentos r ON r.id = p.requerimento_id
       LEFT JOIN processos pr ON pr.id = coalesce(p.processo_id, r.processo_id)
       LEFT JOIN tipos_processo tp ON tp.id = coalesce(pr.tipo_processo_id, r.tipo_processo_id)
       LEFT JOIN municipes mu ON mu.id = coalesce(r.municipe_id, pr.municipe_id)
       WHERE p.municipio_id = $1
         AND ($2::estado_pag IS NULL OR p.estado = $2::estado_pag)
         AND ($3::timestamptz IS NULL OR (p.criado_em, p.id) < ($3::timestamptz, $4::uuid))
         AND ($6::metodo_pag IS NULL OR p.metodo = $6::metodo_pag)
       ORDER BY p.criado_em DESC, p.id DESC
       LIMIT $5`,
      [
        municipioId,
        filtros.estado ?? null,
        filtros.cursor?.em ?? null,
        filtros.cursor?.id ?? null,
        filtros.limite + 1,
        filtros.metodo ?? null,
      ],
    );
    return pagina(linhas, filtros.limite, (l) => ({
      em: l.criado_em,
      id: l.id,
    }));
  }
}
