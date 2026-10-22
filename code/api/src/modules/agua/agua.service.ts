import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { pagina, type Cursor } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service.js';
import {
  canalDe,
  formatarNumero,
  garantirCategoria,
  precisaIdentificacao,
  quemPede,
  type QuemPede,
} from '../servicos-municipais/comum.js';
import {
  INTEGRACAO_VIMAGUA,
  type IntegracaoVimagua,
  TIPOS_PEDIDO_AGUA,
  type TipoPedidoAgua,
} from './integracao-vimagua.js';
import {
  contactoPara,
  eUrgente,
  ENTIDADE_POR_OMISSAO,
  type EntidadeAgua,
  fraseContacto,
  leituraDita,
  MOTIVOS_FATURA,
  TIPOS_AVARIA,
  TIPOS_DITOS,
  vaiParaOcorrencia,
} from './regras.js';

// ---------------------------------------------------------------------------
// Entradas das ações do catálogo
// ---------------------------------------------------------------------------

const morada = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .describe('A morada da casa ou do contador (rua, número e freguesia).');
const numeroCliente = z
  .string()
  .trim()
  .max(30)
  .optional()
  .describe('O número de cliente da Vimágua (vem na fatura), se souber.');

export const entradaLeitura = z.object({
  leitura_m3: z
    .number()
    .min(0)
    .max(9_999_999)
    .describe('A leitura do contador: os números a preto, em metros cúbicos.'),
  morada,
  numero_cliente: numeroCliente,
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('O nome do titular do contrato.'),
});

export const entradaFatura = z.object({
  motivo: z
    .enum(MOTIVOS_FATURA)
    .describe('Quer a segunda_via da fatura ou a explicacao de uma fatura.'),
  morada,
  numero_cliente: numeroCliente,
  descricao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Que fatura (mês) e o que não percebe ou acha errado.'),
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('O nome do titular do contrato.'),
});

export const entradaAvaria = z.object({
  tipo: z
    .enum(TIPOS_AVARIA)
    .describe(
      'Avaria (contador, esgoto), rotura (cano rebentado) ou falta_agua.',
    ),
  morada,
  descricao: z
    .string()
    .trim()
    .min(5)
    .max(500)
    .describe('O que se passa e desde quando.'),
  agua_na_via: z
    .boolean()
    .describe('Há água a correr na rua ou perigo para quem passa?'),
  numero_cliente: numeroCliente,
});

export const entradaContacto = z.object({});

export const esquemaFiltroPedidos = z.object({
  tipo: z.enum(TIPOS_PEDIDO_AGUA).optional(),
  envio: z.enum(['por_enviar', 'enviado', 'falhou']).optional(),
});

/** A categoria das ocorrências de água na via (rotura com perigo). */
export const CATEGORIA_AGUA_VIA = 'Rotura de água na via pública';

/** Reenvios automáticos: no máximo estas tentativas, nos últimos 7 dias. */
export const MAX_TENTATIVAS = 6;

interface LinhaPedido {
  id: string;
  municipio_id: string;
  numero: string;
  tipo: TipoPedidoAgua;
  morada: string;
  numero_cliente: string | null;
  leitura_m3: string | null;
  descricao: string | null;
  urgente: boolean;
  nome: string | null;
  telefone: string | null;
  criado_em: Date;
  envio_estado: 'por_enviar' | 'enviado' | 'falhou';
}

export interface ResultadoEnvio {
  enviado: boolean;
  referencia: string | null;
  simulado: boolean;
  erro: string | null;
}

/**
 * Água e saneamento (V4 #6). A câmara não trata da água (em Guimarães é a
 * Vimágua): o agente recolhe o pedido, regista-o e envia-o à entidade
 * gestora pelo adaptador (hoje SIMULADO), dando sempre o contacto dela.
 * Rotura com água na via → também ocorrência na câmara.
 */
@Injectable()
export class AguaService {
  private readonly logger = new Logger(AguaService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(INTEGRACAO_VIMAGUA) private readonly vimagua: IntegracaoVimagua,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly auditoria: AuditoriaService,
    private readonly ocorrencias: OcorrenciasService,
  ) {}

  /** A entidade da água nos dados do município (contactos), ou o nome e o site. */
  async entidade(municipioId: string): Promise<EntidadeAgua> {
    const [e] = await this.db.query<{
      id: string;
      nome: string;
      site_url: string | null;
    }>(
      `SELECT e.id, e.nome, e.site_url FROM entidades e
       WHERE e.municipio_id = $1 AND e.ativo AND e.tipo <> 'camara'
         AND (unaccent(lower(e.nome)) LIKE '%vimagua%'
              OR unaccent(lower(e.nome || ' ' || coalesce(e.descricao, ''))) ~ '(agua|saneamento)')
       ORDER BY (unaccent(lower(e.nome)) LIKE '%vimagua%') DESC, e.nome
       LIMIT 1`,
      [municipioId],
    );
    if (!e) return ENTIDADE_POR_OMISSAO;
    const contactos = await this.db.query<{
      tipo: string;
      rotulo: string | null;
      valor: string;
    }>(
      `SELECT tipo, rotulo, valor FROM entidade_contactos WHERE entidade_id = $1`,
      [e.id],
    );
    return {
      nome: e.nome,
      site_url: e.site_url,
      contactos,
      por_omissao: false,
    };
  }

  private contactoResposta(e: EntidadeAgua, tipo: TipoPedidoAgua | null) {
    return {
      entidade: e.nome,
      contacto: contactoPara(e, tipo),
      site: e.site_url,
      ...(e.por_omissao ? { contacto_por_omissao: true } : {}),
    };
  }

  // ------------------------------------------------------------------
  // Registar e enviar
  // ------------------------------------------------------------------

  private async registar(
    ctx: ContextoFerramenta,
    quem: QuemPede | null,
    d: {
      tipo: TipoPedidoAgua;
      morada: string;
      numero_cliente?: string;
      leitura_m3?: number;
      descricao?: string | null;
      urgente: boolean;
      perigo_via: boolean;
      ocorrencia_id: string | null;
      nome?: string;
    },
  ) {
    const m = ctx.municipio;
    const ano = new Date().getFullYear();
    return this.db.transaction(async (tx) => {
      const numero = formatarNumero(
        'AG',
        ano,
        await proximoNumero(tx, m.id, 'AG', ano),
      );
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO pedidos_agua (municipio_id, numero, tipo, morada, numero_cliente, leitura_m3,
           descricao, urgente, perigo_via, ocorrencia_id, nome, telefone, municipe_id,
           conversa_id, canal, envio_simulado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          m.id,
          numero,
          d.tipo,
          d.morada,
          d.numero_cliente ?? null,
          d.leitura_m3 ?? null,
          d.descricao ?? null,
          d.urgente,
          d.perigo_via,
          d.ocorrencia_id,
          d.nome ?? null,
          quem?.telefone ?? null,
          quem?.municipeId ?? null,
          ctx.conversaId,
          canalDe(ctx),
          this.vimagua.simulado,
        ],
      );
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { tipo: 'pedido_agua', pedido_agua_id: p.id, numero },
        tx,
      );
      return { id: p.id, numero };
    });
  }

  /** Envia (ou reenvia) um pedido à entidade gestora e grava o resultado. */
  async enviar(pedidoId: string): Promise<ResultadoEnvio> {
    const [p] = await this.db.query<LinhaPedido>(
      `SELECT id, municipio_id, numero, tipo, morada, numero_cliente, leitura_m3::text,
              descricao, urgente, nome, telefone, criado_em, envio_estado
       FROM pedidos_agua WHERE id = $1`,
      [pedidoId],
    );
    if (!p) throw new Error(`Pedido de água ${pedidoId} não existe.`);
    if (p.envio_estado === 'enviado') {
      const [r] = await this.db.query<{ referencia_externa: string | null }>(
        'SELECT referencia_externa FROM pedidos_agua WHERE id = $1',
        [p.id],
      );
      return {
        enviado: true,
        referencia: r?.referencia_externa ?? null,
        simulado: this.vimagua.simulado,
        erro: null,
      };
    }
    try {
      const { referencia } = await this.vimagua.enviar(p.municipio_id, {
        numero: p.numero,
        tipo: p.tipo,
        morada: p.morada,
        numero_cliente: p.numero_cliente,
        leitura_m3: p.leitura_m3 === null ? null : Number(p.leitura_m3),
        descricao: p.descricao,
        urgente: p.urgente,
        nome: p.nome,
        telefone: p.telefone,
        criado_em: p.criado_em.toISOString(),
      });
      await this.db.query(
        `UPDATE pedidos_agua SET envio_estado = 'enviado', enviado_em = now(),
           envio_tentativas = envio_tentativas + 1, referencia_externa = $2,
           envio_erro = NULL, envio_simulado = $3, atualizado_em = now()
         WHERE id = $1`,
        [p.id, referencia, this.vimagua.simulado],
      );
      return {
        enviado: true,
        referencia,
        simulado: this.vimagua.simulado,
        erro: null,
      };
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Envio do pedido ${p.numero} à Vimágua: ${erro}`);
      await this.db.query(
        `UPDATE pedidos_agua SET envio_estado = 'falhou',
           envio_tentativas = envio_tentativas + 1, envio_erro = $2, atualizado_em = now()
         WHERE id = $1`,
        [p.id, erro.slice(0, 500)],
      );
      return {
        enviado: false,
        referencia: null,
        simulado: this.vimagua.simulado,
        erro,
      };
    }
  }

  /** O trabalho periódico: reenvia o que falhou ou ficou por enviar. */
  async reenviarPendentes(): Promise<number> {
    const pendentes = await this.db.query<{ id: string }>(
      `SELECT id FROM pedidos_agua
       WHERE envio_estado <> 'enviado' AND envio_tentativas < $1
         AND criado_em > now() - interval '7 days'
       ORDER BY urgente DESC, criado_em LIMIT 50`,
      [MAX_TENTATIVAS],
    );
    let enviados = 0;
    for (const p of pendentes) {
      if ((await this.enviar(p.id)).enviado) enviados++;
    }
    return enviados;
  }

  /** O que se diz depois de registar, e o SMS com o número e o contacto. */
  private async concluir(
    ctx: ContextoFerramenta,
    quem: QuemPede | null,
    r: { id: string; numero: string },
    tipo: TipoPedidoAgua,
    inicio: string,
    extra: Record<string, unknown> = {},
  ) {
    const m = ctx.municipio;
    const envio = await this.enviar(r.id);
    const ent = await this.entidade(m.id);
    const contacto = fraseContacto(ent, tipo);
    if (quem?.telefone) {
      await this.mensagens.sms({
        municipioId: m.id,
        municipeId: quem.municipeId,
        destino: quem.telefone,
        motivo: 'requerimento',
        corpo: `${m.nome}: o seu pedido de ${TIPOS_DITOS[tipo]} (${r.numero}) ${envio.enviado ? `seguiu para ${ent.nome}${envio.referencia ? `, referência ${envio.referencia}` : ''}` : `vai seguir para ${ent.nome}`}. Contacto: ${contacto}.`,
        relacionado: {
          pedido_agua_id: r.id,
          ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
        },
        chave: `pedido_agua:${r.id}`,
      });
    }
    return {
      feito: true,
      numero: r.numero,
      encaminhado_para: ent.nome,
      enviado: envio.enviado,
      referencia_entidade: envio.referencia,
      // O adaptador é simulado: nada saiu de facto para a Vimágua.
      ...(envio.simulado ? { envio_simulado: true, demonstracao: true } : {}),
      ...this.contactoResposta(ent, tipo),
      sms_enviado: !!quem?.telefone,
      ...extra,
      dizer:
        `${inicio} Fica registado com o número ${r.numero}` +
        (envio.enviado
          ? ` e já seguiu para ${ent.nome}, que é quem trata da água e do saneamento.`
          : `; vamos enviá-lo a ${ent.nome}, que é quem trata da água e do saneamento, assim que possível.`) +
        ` Se precisar de falar com eles, o contacto é ${contacto}.` +
        (envio.simulado
          ? ' Nesta demonstração o envio à entidade é simulado.'
          : ''),
    };
  }

  // ------------------------------------------------------------------
  // Agente
  // ------------------------------------------------------------------

  async leitura(ctx: ContextoFerramenta, e: z.output<typeof entradaLeitura>) {
    const quem = await quemPede(this.db, this.municipes, ctx);
    if (!quem && !e.numero_cliente) {
      return precisaIdentificacao(
        ctx,
        'comunicar a leitura sem o número de cliente',
      );
    }
    const r = await this.registar(ctx, quem, {
      tipo: 'leitura',
      morada: e.morada,
      numero_cliente: e.numero_cliente,
      leitura_m3: e.leitura_m3,
      urgente: false,
      perigo_via: false,
      ocorrencia_id: null,
      nome: e.nome,
    });
    return this.concluir(
      ctx,
      quem,
      r,
      'leitura',
      `Anotei a leitura de ${leituraDita(e.leitura_m3)}.`,
    );
  }

  async fatura(ctx: ContextoFerramenta, e: z.output<typeof entradaFatura>) {
    const quem = await quemPede(this.db, this.municipes, ctx);
    if (!quem) {
      return precisaIdentificacao(
        ctx,
        'a Vimágua lhe responder sobre a fatura',
      );
    }
    const r = await this.registar(ctx, quem, {
      tipo: 'fatura',
      morada: e.morada,
      numero_cliente: e.numero_cliente,
      descricao: `${e.motivo === 'segunda_via' ? '2.ª via da fatura' : 'Explicação da fatura'}${e.descricao ? `: ${e.descricao}` : ''}`,
      urgente: false,
      perigo_via: false,
      ocorrencia_id: null,
      nome: e.nome,
    });
    return this.concluir(
      ctx,
      quem,
      r,
      'fatura',
      e.motivo === 'segunda_via'
        ? 'Pedi a segunda via da fatura.'
        : 'Pedi a explicação da fatura.',
    );
  }

  async avaria(ctx: ContextoFerramenta, e: z.output<typeof entradaAvaria>) {
    const m = ctx.municipio;
    const quem = await quemPede(this.db, this.municipes, ctx);
    const urgente = eUrgente(e.tipo, e.agua_na_via);
    let ocorrencia: { numero: string | null; id: string | null } | null = null;
    if (vaiParaOcorrencia(e.tipo, e.agua_na_via)) {
      const categoria = await garantirCategoria(
        this.db,
        m.id,
        CATEGORIA_AGUA_VIA,
        'droplets',
      );
      const oc = (await this.ocorrencias.registar(ctx, {
        categoria,
        descricao: `URGENTE · Água na via (${TIPOS_DITOS[e.tipo]}), já comunicado à entidade da água: ${e.descricao}`,
        morada: e.morada,
      })) as { registada: boolean; numero?: string };
      let id: string | null = null;
      if (oc.registada && oc.numero) {
        const [o] = await this.db.query<{ id: string }>(
          'SELECT id FROM ocorrencias WHERE municipio_id = $1 AND numero = $2',
          [m.id, oc.numero],
        );
        id = o?.id ?? null;
      }
      ocorrencia = { numero: oc.numero ?? null, id };
    }
    const r = await this.registar(ctx, quem, {
      tipo: e.tipo,
      morada: e.morada,
      numero_cliente: e.numero_cliente,
      descricao: e.descricao,
      urgente,
      perigo_via: e.agua_na_via,
      ocorrencia_id: ocorrencia?.id ?? null,
    });
    const inicio = urgente
      ? `Registei a ${TIPOS_DITOS[e.tipo]} como urgente.`
      : `Registei a ${TIPOS_DITOS[e.tipo]}.`;
    const res = await this.concluir(ctx, quem, r, e.tipo, inicio, {
      urgente,
      ...(ocorrencia ? { ocorrencia_camara: ocorrencia.numero } : {}),
    });
    if (!ocorrencia) return res;
    return {
      ...res,
      dizer: `${res.dizer} Como há água na rua, a câmara também ficou a saber, com a ocorrência ${ocorrencia.numero}, para sinalizar o local. Não se aproxime se houver perigo.`,
    };
  }

  async contacto(ctx: ContextoFerramenta) {
    const ent = await this.entidade(ctx.municipio.id);
    return {
      ...this.contactoResposta(ent, null),
      contacto_avarias: contactoPara(ent, 'avaria'),
      dizer: `A água e o saneamento são tratados pela ${ent.nome}, não pela câmara. O contacto é ${fraseContacto(ent, null)}. Se quiser, eu registo já o seu pedido e envio-o à ${ent.nome}: leitura do contador, fatura ou avaria.`,
    };
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async resumo(m: Municipio) {
    const contagens = await this.db.query<{ envio_estado: string; n: number }>(
      `SELECT envio_estado, count(*)::int AS n FROM pedidos_agua
       WHERE municipio_id = $1 GROUP BY envio_estado`,
      [m.id],
    );
    const porTipo = await this.db.query<{ tipo: string; n: number }>(
      `SELECT tipo, count(*)::int AS n FROM pedidos_agua
       WHERE municipio_id = $1 GROUP BY tipo`,
      [m.id],
    );
    return {
      entidade: await this.entidade(m.id),
      integracao: { nome: this.vimagua.nome, simulado: this.vimagua.simulado },
      envio: Object.fromEntries(contagens.map((c) => [c.envio_estado, c.n])),
      tipos: Object.fromEntries(porTipo.map((c) => [c.tipo, c.n])),
    };
  }

  async pedidos(
    m: Municipio,
    f: z.output<typeof esquemaFiltroPedidos>,
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<{ id: string; criado_em: Date }>(
      `SELECT p.id, p.numero, p.tipo, p.morada, p.numero_cliente, p.leitura_m3::float AS leitura_m3,
              p.descricao, p.urgente, p.perigo_via, o.numero AS ocorrencia_numero, p.nome,
              p.telefone, p.canal, p.conversa_id, p.envio_estado, p.envio_tentativas,
              p.enviado_em, p.referencia_externa, p.envio_erro, p.envio_simulado,
              p.criado_em
       FROM pedidos_agua p
       LEFT JOIN ocorrencias o ON o.id = p.ocorrencia_id
       WHERE p.municipio_id = $1
         AND ($2::text IS NULL OR p.tipo = $2)
         AND ($3::text IS NULL OR p.envio_estado = $3)
         AND ($4::timestamptz IS NULL OR (p.criado_em, p.id) < ($4, $5))
       ORDER BY p.criado_em DESC, p.id DESC LIMIT $6`,
      [
        m.id,
        f.tipo ?? null,
        f.envio ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: l.criado_em, id: l.id }));
  }

  async reenviar(m: Municipio, u: UtilizadorPainel, id: string) {
    const [p] = await this.db.query<{ id: string; numero: string }>(
      'SELECT id, numero FROM pedidos_agua WHERE id = $1 AND municipio_id = $2',
      [id, m.id],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'pedido_nao_encontrado',
        'Este pedido não existe.',
      );
    }
    const r = await this.enviar(p.id);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'reenviar_pedido_agua',
      objetoTipo: 'pedido_agua',
      objetoId: p.id,
      dados: { numero: p.numero, enviado: r.enviado, simulado: r.simulado },
    });
    return r;
  }

  // ------------------------------------------------------------------
  // Demonstração
  // ------------------------------------------------------------------

  /** Três pedidos (só se ainda não houver nenhum): leitura, rotura urgente e uma fatura por enviar. */
  async carregarDemonstracao(m: Municipio): Promise<{ criados: number }> {
    const [{ n }] = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pedidos_agua WHERE municipio_id = $1',
      [m.id],
    );
    if (n > 0) return { criados: 0 };
    const ctx: ContextoFerramenta = {
      municipio: m,
      canal: 'telefone',
      conversaId: null,
      municipeId: null,
      telefone: null,
    };
    const leitura = await this.registar(ctx, null, {
      tipo: 'leitura',
      morada: 'Rua de Santa Maria, 12, Guimarães',
      numero_cliente: '000123 (demonstração)',
      leitura_m3: 1234.5,
      urgente: false,
      perigo_via: false,
      ocorrencia_id: null,
      nome: 'Helena Exemplo Antunes',
    });
    await this.enviar(leitura.id);
    const rotura = await this.registar(ctx, null, {
      tipo: 'rotura',
      morada: 'Rua Dr. Avelino Germano, Guimarães',
      descricao: 'Cano rebentado no passeio desde esta manhã.',
      urgente: true,
      perigo_via: false,
      ocorrencia_id: null,
    });
    await this.enviar(rotura.id);
    const fatura = await this.registar(ctx, null, {
      tipo: 'fatura',
      morada: 'Avenida de Londres, 40, Guimarães',
      descricao:
        'Explicação da fatura: a de setembro veio o dobro do habitual.',
      urgente: false,
      perigo_via: false,
      ocorrencia_id: null,
      nome: 'Rui Fictício Carvalho',
    });
    await this.db.query(
      `UPDATE pedidos_agua SET envio_estado = 'falhou', envio_tentativas = $2,
         envio_erro = 'Vimágua (simulada) não respondeu: falha de demonstração.'
       WHERE id = $1`,
      [fatura.id, MAX_TENTATIVAS],
    );
    return { criados: 3 };
  }
}
