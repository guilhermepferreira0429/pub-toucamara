import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  Municipe,
  MunicipesService,
  nifValido,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import { formatarNumero } from '../processos/regras.js';
import {
  CANAIS,
  DESTINO,
  escreverCursor,
  lerCursorEntrada,
  linkPainel,
  mascararMunicipe,
  OBJETO_AUDITORIA,
  TIPOS_ITEM,
  TipoItem,
} from './entrada.regras.js';
import {
  Encaminhamento,
  EncaminhamentoAutomaticoService,
} from './encaminhamento-automatico.service.js';

export const FILA_ENCAMINHAR = 'encaminhar_entrada';

const simNao = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const esquemaLista = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z
    .string()
    .optional()
    .transform((c) => (c ? lerCursorEntrada(c) : null)),
  canal: z.enum(CANAIS).optional(),
  tipo: z.enum(TIPOS_ITEM).optional(),
  servico_id: z.uuid().optional(),
  meus: simNao.optional(),
  por_atribuir: simNao.optional(),
});

export const esquemaResumo = z.object({ meus: simNao.optional() });

export const esquemaBalcao = z
  .object({
    telefone: z.string().trim().min(1).max(40).optional(),
    nif: z
      .string()
      .trim()
      .regex(/^\d{9}$/, 'NIF com 9 dígitos.')
      .optional(),
    nome: z.string().trim().min(1).max(200).optional(),
    assunto: z.string().trim().min(1).max(300),
    descricao: z.string().trim().min(1).max(10_000),
    servico_id: z.uuid().optional(),
    urgente: z.boolean().default(false),
    prazo_resposta: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const esquemaConverter = z
  .object({
    tipo_processo_id: z.uuid(),
    assunto: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const esquemaAtribuir = z
  .object({
    servico_id: z.uuid().optional(),
    tecnico_id: z.uuid().optional(),
  })
  .strict()
  .refine((d) => d.servico_id || d.tecnico_id, {
    message: 'Indicar servico_id e/ou tecnico_id.',
    path: ['servico_id'],
  });

export const esquemaConfig = z
  .object({
    ativo: z.boolean().optional(),
    atribuir_tecnico: z.boolean().optional(),
  })
  .strict();

interface LinhaItem {
  tipo: TipoItem;
  id: string;
  canal: string;
  assunto: string;
  resumo: string | null;
  municipe_nome: string | null;
  municipe_telefone: string | null;
  contacto: string | null;
  servico_id: string | null;
  servico_nome: string | null;
  tecnico_id: string | null;
  tecnico_nome: string | null;
  estado: string;
  urgente: boolean;
  prazo_resposta: Date | null;
  criado_em: Date;
  enc_motivo: string | null;
  enc_automatico: boolean | null;
  enc_em: Date | null;
}

function paraItem(l: LinhaItem) {
  return {
    tipo: l.tipo,
    id: l.id,
    canal: l.canal,
    assunto: l.assunto,
    resumo: l.resumo,
    municipe: mascararMunicipe({
      nome: l.municipe_nome,
      telefone: l.municipe_telefone,
      email: l.contacto,
    }),
    servico: l.servico_id ? { id: l.servico_id, nome: l.servico_nome } : null,
    tecnico: l.tecnico_id ? { id: l.tecnico_id, nome: l.tecnico_nome } : null,
    estado: l.estado,
    urgente: l.urgente,
    prazo_resposta: l.prazo_resposta,
    criado_em: l.criado_em,
    link_painel: linkPainel(l.tipo, l.id),
    // A decisão em vigor (para mostrar "encaminhado automaticamente: ...").
    encaminhamento: l.enc_motivo
      ? { motivo: l.enc_motivo, automatico: l.enc_automatico, em: l.enc_em }
      : null,
  };
}

const SELECT_ITENS = `
  SELECT i.tipo, i.id, i.canal, i.assunto, i.resumo,
         mu.nome AS municipe_nome, mu.telefone_e164 AS municipe_telefone, i.contacto,
         i.servico_id, s.nome AS servico_nome, i.tecnico_id, u.nome AS tecnico_nome,
         i.estado, i.urgente, i.prazo_resposta, i.criado_em,
         enc.motivo AS enc_motivo, enc.automatico AS enc_automatico, enc.criado_em AS enc_em
  FROM entrada_itens i
  LEFT JOIN municipes mu ON mu.id = i.municipe_id AND mu.anonimizado_em IS NULL
  LEFT JOIN servicos s ON s.id = i.servico_id
  LEFT JOIN utilizadores u ON u.id = i.tecnico_id
  LEFT JOIN LATERAL (
    SELECT e.motivo, e.automatico, e.criado_em FROM encaminhamentos e
    WHERE e.item_tipo = i.tipo AND e.item_id = i.id AND e.desfeito_em IS NULL
    ORDER BY e.criado_em DESC LIMIT 1) enc ON true`;

// "Meus": atribuídos a mim ou ao meu serviço.
const MEUS = `(i.tecnico_id = $U OR ($S::uuid IS NOT NULL AND i.servico_id = $S::uuid))`;
// Por atribuir: sem serviço, ou de um tipo com técnico e ainda sem ele.
const POR_ATRIBUIR = `(i.servico_id IS NULL OR (i.atribui_tecnico AND i.tecnico_id IS NULL))`;

/**
 * Caixa de entrada única: passagens a humano, email geral, processos novos,
 * ocorrências sem serviço e pedidos de balcão numa lista (vista
 * `entrada_itens`), mais o balcão, a conversão em processo e a
 * (re)atribuição manual.
 */
@Injectable()
export class EntradaService {
  private readonly logger = new Logger(EntradaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly conversas: ConversasService,
    private readonly municipes: MunicipesService,
    private readonly jobs: JobsService,
    private readonly encaminhamento: EncaminhamentoAutomaticoService,
  ) {}

  /** Ordenada por urgência e data (mais recentes primeiro). */
  async listar(
    municipioId: string,
    u: UtilizadorPainel,
    f: z.infer<typeof esquemaLista>,
  ) {
    const params: unknown[] = [municipioId];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const onde = ['i.municipio_id = $1'];
    if (f.canal) onde.push(`i.canal = ${p(f.canal)}`);
    if (f.tipo) onde.push(`i.tipo = ${p(f.tipo)}`);
    if (f.servico_id) onde.push(`i.servico_id = ${p(f.servico_id)}`);
    if (f.meus) {
      onde.push(
        MEUS.replace('$U', p(u.id)).replaceAll('$S', p(u.servicoId ?? null)),
      );
    }
    if (f.por_atribuir === true) onde.push(POR_ATRIBUIR);
    if (f.por_atribuir === false) onde.push(`NOT ${POR_ATRIBUIR}`);
    if (f.cursor) {
      onde.push(
        `(i.urgente, i.criado_em, i.tipo, i.id) < (${p(f.cursor.urgente)}::boolean, ${p(f.cursor.em)}::timestamptz, ${p(f.cursor.tipo)}::text, ${p(f.cursor.id)}::uuid)`,
      );
    }
    const linhas = await this.db.query<LinhaItem>(
      `${SELECT_ITENS}
       WHERE ${onde.join(' AND ')}
       ORDER BY i.urgente DESC, i.criado_em DESC, i.tipo DESC, i.id DESC
       LIMIT ${p(f.limite + 1)}`,
      params,
    );
    const itens = linhas.slice(0, f.limite);
    const ultima = itens[itens.length - 1];
    return {
      itens: itens.map(paraItem),
      proximo_cursor:
        linhas.length > f.limite && ultima ? escreverCursor(ultima) : null,
    };
  }

  /** Contagens para o badge da barra lateral. */
  async resumo(municipioId: string, u: UtilizadorPainel, meus = false) {
    const linhas = await this.db.query<{
      tipo: TipoItem;
      canal: string;
      urgente: boolean;
      por_atribuir: boolean;
      n: number;
    }>(
      `SELECT i.tipo, i.canal, i.urgente, ${POR_ATRIBUIR} AS por_atribuir, count(*)::int AS n
       FROM entrada_itens i
       WHERE i.municipio_id = $1
         AND (NOT $2 OR ${MEUS.replace('$U', '$3').replaceAll('$S', '$4')})
       GROUP BY 1, 2, 3, 4`,
      [municipioId, meus, u.id, u.servicoId ?? null],
    );
    const porTipo = Object.fromEntries(TIPOS_ITEM.map((t) => [t, 0])) as Record<
      TipoItem,
      number
    >;
    const porCanal: Record<string, number> = Object.fromEntries(
      CANAIS.map((c) => [c, 0]),
    );
    let total = 0;
    let urgentes = 0;
    let porAtribuir = 0;
    for (const l of linhas) {
      total += l.n;
      if (l.urgente) urgentes += l.n;
      if (l.por_atribuir) porAtribuir += l.n;
      porTipo[l.tipo] += l.n;
      porCanal[l.canal] = (porCanal[l.canal] ?? 0) + l.n;
    }
    return {
      total,
      urgentes,
      por_atribuir: porAtribuir,
      por_tipo: porTipo,
      por_canal: porCanal,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Balcão                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Atendimento presencial: conversa canal 'balcao' (com o resumo como
   * turno do funcionário) e um pedido na entrada. Depois do commit vai para
   * o encaminhamento automático (job, se estiver ligado).
   */
  async registarBalcao(
    municipioId: string,
    u: UtilizadorPainel,
    d: z.infer<typeof esquemaBalcao>,
    ip: string | null,
  ) {
    if (d.servico_id) await this.servicoValido(municipioId, d.servico_id);
    const municipe = await this.identificar(municipioId, d);

    const { conversaId } = await this.conversas.garantir({
      municipioId,
      canal: 'balcao',
      providerId: `balcao-${randomUUID()}`,
    });

    const id = await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE conversas SET municipe_id = coalesce($2, municipe_id), resumo = $3,
           terminada_em = now(), resultado = 'passada_funcionario'
         WHERE id = $1`,
        [conversaId, municipe?.id ?? null, d.descricao],
      );
      await tx.query(
        `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto)
         VALUES ($1, 0, 'funcionario', $2)`,
        [conversaId, `${d.assunto}\n\n${d.descricao}`],
      );
      const [pe] = await tx.query<{ id: string }>(
        `INSERT INTO pedidos_entrada (municipio_id, tipo, canal, municipe_id, conversa_id,
           assunto, descricao, servico_id, urgente, prazo_resposta, criado_por)
         VALUES ($1, 'balcao', 'balcao', $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          municipioId,
          municipe?.id ?? null,
          conversaId,
          d.assunto,
          d.descricao,
          d.servico_id ?? null,
          d.urgente,
          d.prazo_resposta ?? null,
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar',
          objetoTipo: 'pedido_entrada',
          objetoId: pe.id,
          dados: { canal: 'balcao', conversa_id: conversaId },
          ip,
        },
        tx,
      );
      return pe.id;
    });

    await this.jobs
      .enviar(
        FILA_ENCAMINHAR,
        { municipio_id: municipioId, tipo: 'pedido', id },
        { singletonKey: `pedido:${id}` },
      )
      .catch((e: Error) =>
        this.logger.error(`encaminhar_entrada não enviado: ${e.message}`),
      );
    return this.obterPedido(municipioId, id);
  }

  /** NIF primeiro (é a pessoa); senão o telefone (cria o munícipe). */
  private async identificar(
    municipioId: string,
    d: { telefone?: string; nif?: string; nome?: string },
  ): Promise<Municipe | null> {
    if (d.nif && !nifValido(d.nif)) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'nif_invalido',
        'NIF inválido.',
      );
    }
    const telefone = d.telefone ? normalizarTelefone(d.telefone) : null;
    if (d.telefone && !telefone) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'Número de telefone inválido.',
      );
    }
    let m = d.nif ? await this.municipes.porNif(municipioId, d.nif) : null;
    if (!m && telefone) {
      m = await this.municipes.porTelefone(municipioId, telefone);
      if (m && d.nif && !m.tem_nif) {
        m = await this.municipes.atualizar(m.id, { nif: d.nif });
      }
    }
    if (!m && d.nif)
      m = await this.municipes.criar(municipioId, { nif: d.nif });
    if (m && d.nome && !m.nome) {
      m = await this.municipes.atualizar(m.id, { nome: d.nome });
    }
    return m;
  }

  async obterPedido(municipioId: string, id: string) {
    const [p] = await this.db.query<{
      id: string;
      tipo: string;
      canal: string;
      assunto: string;
      descricao: string;
      estado: string;
      urgente: boolean;
      prazo_resposta: Date | null;
      conversa_id: string | null;
      processo_id: string | null;
      processo_numero: string | null;
      servico_id: string | null;
      servico_nome: string | null;
      tecnico_id: string | null;
      tecnico_nome: string | null;
      municipe_nome: string | null;
      municipe_telefone: string | null;
      criado_por_nome: string | null;
      criado_em: Date;
      fechado_em: Date | null;
    }>(
      `SELECT pe.id, pe.tipo, pe.canal::text AS canal, pe.assunto, pe.descricao, pe.estado,
              pe.urgente, pe.prazo_resposta, pe.conversa_id, pe.processo_id, pr.numero AS processo_numero,
              pe.servico_id, s.nome AS servico_nome, pe.tecnico_id, t.nome AS tecnico_nome,
              mu.nome AS municipe_nome, mu.telefone_e164 AS municipe_telefone,
              c.nome AS criado_por_nome, pe.criado_em, pe.fechado_em
       FROM pedidos_entrada pe
       LEFT JOIN servicos s ON s.id = pe.servico_id
       LEFT JOIN utilizadores t ON t.id = pe.tecnico_id
       LEFT JOIN utilizadores c ON c.id = pe.criado_por
       LEFT JOIN municipes mu ON mu.id = pe.municipe_id AND mu.anonimizado_em IS NULL
       LEFT JOIN processos pr ON pr.id = pe.processo_id
       WHERE pe.id = $1 AND pe.municipio_id = $2`,
      [id, municipioId],
    );
    if (!p) throw this.naoEncontrado();
    const {
      servico_id,
      servico_nome,
      tecnico_id,
      tecnico_nome,
      municipe_nome,
      municipe_telefone,
      ...resto
    } = p;
    return {
      ...resto,
      municipe: mascararMunicipe({
        nome: municipe_nome,
        telefone: municipe_telefone,
        email: null,
      }),
      servico: servico_id ? { id: servico_id, nome: servico_nome } : null,
      tecnico: tecnico_id ? { id: tecnico_id, nome: tecnico_nome } : null,
      link_painel: linkPainel('pedido', p.id),
    };
  }

  /** O pedido foi tratado (sem processo): sai da entrada. */
  async fecharPedido(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    ip: string | null,
  ) {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.query<{ estado: string }>(
        `SELECT estado FROM pedidos_entrada WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [id, municipioId],
      );
      if (!p) throw this.naoEncontrado();
      if (p.estado !== 'aberto') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'pedido_fechado',
          'Este pedido já não está aberto.',
        );
      }
      await tx.query(
        `UPDATE pedidos_entrada SET estado = 'fechado', fechado_em = now() WHERE id = $1`,
        [id],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'fechar',
          objetoTipo: 'pedido_entrada',
          objetoId: id,
          ip,
        },
        tx,
      );
    });
    return this.obterPedido(municipioId, id);
  }

  /* ---------------------------------------------------------------- */
  /* Converter em processo                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Email ou pedido de balcão → processo: número da série do tipo (como no
   * módulo de processos: `proximoNumero` + `formatarNumero`), fase
   * 'entrada' sem prazo (o prazo só conta com o processo completo, depois
   * da verificação inicial), evento 'criado' com a origem, o item ligado
   * ('virou_processo') e o encaminhamento automático.
   */
  async converterEmProcesso(
    municipioId: string,
    u: UtilizadorPainel,
    tipo: TipoItem,
    id: string,
    d: z.infer<typeof esquemaConverter>,
    ip: string | null,
  ) {
    if (tipo !== 'email' && tipo !== 'pedido') {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'tipo_nao_convertivel',
        'Só um email ou um pedido de balcão se convertem em processo.',
      );
    }
    const criado = await this.db.transaction(async (tx) => {
      const [tp] = await tx.query<{ id: string; codigo: string; nome: string }>(
        `SELECT id, codigo, nome FROM tipos_processo
         WHERE id = $1 AND municipio_id = $2 AND ativo`,
        [d.tipo_processo_id, municipioId],
      );
      if (!tp) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'tipo_processo_desconhecido',
          'Esse tipo de processo não existe neste município.',
        );
      }
      const origem = await this.origem(tx, municipioId, tipo, id);
      const ano = Number(hojeLisboa().slice(0, 4));
      const numero = formatarNumero(
        tp.codigo,
        await proximoNumero(tx, municipioId, tp.codigo, ano),
        ano,
      );
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id,
           conversa_origem_id, assunto, fase)
         VALUES ($1, $2, $3, $4, $5, $6, 'entrada')
         RETURNING id`,
        [
          municipioId,
          numero,
          tp.id,
          origem.municipe_id,
          origem.conversa_id,
          (d.assunto ?? origem.assunto)?.slice(0, 300) || tp.nome,
        ],
      );
      const deOnde =
        tipo === 'email' ? 'do email geral' : 'de um atendimento ao balcão';
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados)
         VALUES ($1, 'criado', $2, 'utilizador', $3, $4)`,
        [
          p.id,
          `Processo ${numero} aberto a partir ${deOnde}.`,
          u.id,
          JSON.stringify({
            origem: tipo === 'email' ? 'email' : 'balcao',
            [tipo === 'email' ? 'email_id' : 'pedido_id']: id,
          }),
        ],
      );
      await tx.query(
        tipo === 'email'
          ? `UPDATE emails_entrada SET estado = 'virou_processo', processo_id = $2 WHERE id = $1`
          : `UPDATE pedidos_entrada SET estado = 'virou_processo', processo_id = $2 WHERE id = $1`,
        [id, p.id],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'converter_em_processo',
          objetoTipo: OBJETO_AUDITORIA[tipo],
          objetoId: id,
          dados: { processo_id: p.id, numero },
          ip,
        },
        tx,
      );
      return { processo_id: p.id, numero };
    });

    let encaminhamento: Encaminhamento | null = null;
    try {
      encaminhamento = await this.encaminhamento.encaminharItem(
        municipioId,
        'processo',
        criado.processo_id,
      );
    } catch (e) {
      // O processo existe; o job tenta outra vez daqui a 5 min.
      this.logger.error(
        `Encaminhamento de ${criado.numero} falhou: ${(e as Error).message}`,
      );
    }
    return {
      ...criado,
      fase: 'entrada',
      link_painel: linkPainel('processo', criado.processo_id),
      encaminhamento,
    };
  }

  /** O email ou o pedido a converter (bloqueado até ao fim da transação). */
  private async origem(
    tx: Tx,
    municipioId: string,
    tipo: 'email' | 'pedido',
    id: string,
  ): Promise<{
    municipe_id: string | null;
    conversa_id: string | null;
    assunto: string | null;
  }> {
    if (tipo === 'email') {
      const [e] = await tx.query<{
        estado: string;
        assunto: string | null;
        municipe_id: string | null;
      }>(
        `SELECT ee.estado, ee.assunto,
                (SELECT mu.id FROM municipes mu
                 WHERE mu.municipio_id = ee.municipio_id AND mu.email = ee.de
                   AND mu.anonimizado_em IS NULL
                 ORDER BY mu.criado_em LIMIT 1) AS municipe_id
         FROM emails_entrada ee WHERE ee.id = $1 AND ee.municipio_id = $2
         FOR UPDATE OF ee`,
        [id, municipioId],
      );
      if (!e) throw this.naoEncontrado();
      if (e.estado === 'virou_processo') throw this.jaProcesso();
      return {
        municipe_id: e.municipe_id,
        conversa_id: null,
        assunto: e.assunto,
      };
    }
    const [p] = await tx.query<{
      estado: string;
      assunto: string;
      municipe_id: string | null;
      conversa_id: string | null;
    }>(
      `SELECT estado, assunto, municipe_id, conversa_id FROM pedidos_entrada
       WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
      [id, municipioId],
    );
    if (!p) throw this.naoEncontrado();
    if (p.estado === 'virou_processo') throw this.jaProcesso();
    if (p.estado !== 'aberto') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'pedido_fechado',
        'Este pedido já foi fechado.',
      );
    }
    return p;
  }

  /* ---------------------------------------------------------------- */
  /* Atribuir à mão                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Serviço e/ou técnico escolhidos por uma pessoa. Escreve só na coluna de
   * cada tipo (processos.tecnico_id, passagens_humano.atribuida_a,
   * emails_entrada.servico_id, ocorrencias.servico_id, pedidos_entrada); o
   * serviço da passagem e do processo fica só no registo. A decisão
   * automática em vigor fica desfeita.
   */
  async atribuir(
    municipioId: string,
    u: UtilizadorPainel,
    tipo: TipoItem,
    id: string,
    d: z.infer<typeof esquemaAtribuir>,
    ip: string | null,
  ) {
    if (d.tecnico_id && !DESTINO[tipo].tecnico) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'tecnico_nao_aplicavel',
        'Este tipo de item só se encaminha para um serviço.',
      );
    }
    if (d.servico_id) await this.servicoValido(municipioId, d.servico_id);
    if (d.tecnico_id) await this.tecnicoValido(municipioId, d.tecnico_id);

    return this.db.transaction(async (tx) => {
      const antes = await this.bloquearItem(tx, municipioId, tipo, id);
      if (d.servico_id && DESTINO[tipo].servico) {
        const tabela =
          tipo === 'email'
            ? 'emails_entrada'
            : tipo === 'ocorrencia'
              ? 'ocorrencias'
              : 'pedidos_entrada';
        await tx.query(`UPDATE ${tabela} SET servico_id = $2 WHERE id = $1`, [
          id,
          d.servico_id,
        ]);
      }
      if (d.tecnico_id) {
        await tx.query(
          tipo === 'processo'
            ? `UPDATE processos SET tecnico_id = $2 WHERE id = $1`
            : tipo === 'passagem'
              ? `UPDATE passagens_humano SET atribuida_a = $2 WHERE id = $1`
              : `UPDATE pedidos_entrada SET tecnico_id = $2 WHERE id = $1`,
          [id, d.tecnico_id],
        );
      }
      const desfeitos = await tx.query<{ id: string }>(
        `UPDATE encaminhamentos SET desfeito_em = now(), desfeito_por = $3
         WHERE item_tipo = $1 AND item_id = $2 AND automatico AND desfeito_em IS NULL
         RETURNING id`,
        [tipo, id, u.id],
      );
      // Sem serviço novo, o registo guarda o que o item já tinha.
      const servicoId = d.servico_id ?? antes.servico_id;
      const tecnicoId = d.tecnico_id ?? antes.tecnico_id;
      await tx.query(
        `INSERT INTO encaminhamentos (municipio_id, item_tipo, item_id, servico_id, tecnico_id,
           motivo, automatico, criado_por)
         VALUES ($1, $2, $3, $4, $5, 'atribuição manual', false, $6)`,
        [municipioId, tipo, id, servicoId, tecnicoId, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'reatribuir',
          objetoTipo: OBJETO_AUDITORIA[tipo],
          objetoId: id,
          dados: {
            de: antes,
            para: { servico_id: servicoId, tecnico_id: tecnicoId },
            automatico_desfeito: desfeitos.length > 0,
          },
          ip,
        },
        tx,
      );
      return {
        tipo,
        id,
        servico_id: servicoId,
        tecnico_id: tecnicoId,
        automatico_desfeito: desfeitos.length > 0,
        link_painel: linkPainel(tipo, id),
      };
    });
  }

  /** O serviço e o técnico atuais do item (linha bloqueada). */
  private async bloquearItem(
    tx: Tx,
    municipioId: string,
    tipo: TipoItem,
    id: string,
  ): Promise<{ servico_id: string | null; tecnico_id: string | null }> {
    const sql: Record<TipoItem, string> = {
      passagem: `SELECT NULL::uuid AS servico_id, p.atribuida_a AS tecnico_id
                 FROM passagens_humano p JOIN conversas c ON c.id = p.conversa_id
                 WHERE p.id = $1 AND c.municipio_id = $2 FOR UPDATE OF p`,
      email: `SELECT servico_id, NULL::uuid AS tecnico_id FROM emails_entrada
              WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
      processo: `SELECT NULL::uuid AS servico_id, tecnico_id FROM processos
                 WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
      ocorrencia: `SELECT servico_id, NULL::uuid AS tecnico_id FROM ocorrencias
                   WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
      pedido: `SELECT servico_id, tecnico_id FROM pedidos_entrada
               WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
    };
    const [l] = await tx.query<{
      servico_id: string | null;
      tecnico_id: string | null;
    }>(sql[tipo], [id, municipioId]);
    if (!l) throw this.naoEncontrado();
    // Passagem e processo: o serviço em vigor é o da entrada (vista).
    if (tipo === 'passagem' || tipo === 'processo') {
      const [v] = await tx.query<{ servico_id: string | null }>(
        `SELECT servico_id FROM entrada_itens WHERE tipo = $1 AND id = $2`,
        [tipo, id],
      );
      return { servico_id: v?.servico_id ?? null, tecnico_id: l.tecnico_id };
    }
    return l;
  }

  private async servicoValido(municipioId: string, servicoId: string) {
    const [s] = await this.db.query(
      `SELECT 1 FROM servicos WHERE id = $1 AND municipio_id = $2`,
      [servicoId, municipioId],
    );
    if (!s) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'servico_invalido',
        'Esse serviço não existe neste município.',
      );
    }
  }

  private async tecnicoValido(municipioId: string, utilizadorId: string) {
    const [t] = await this.db.query(
      `SELECT 1 FROM utilizadores WHERE id = $1 AND municipio_id = $2 AND ativo`,
      [utilizadorId, municipioId],
    );
    if (!t) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'utilizador_invalido',
        'Esse utilizador não existe ou não é deste município.',
      );
    }
  }

  private naoEncontrado() {
    return new ErroApi(
      HttpStatus.NOT_FOUND,
      'nao_encontrado',
      'Item não encontrado.',
    );
  }

  private jaProcesso() {
    return new ErroApi(
      HttpStatus.CONFLICT,
      'ja_e_processo',
      'Este item já foi convertido em processo.',
    );
  }
}
