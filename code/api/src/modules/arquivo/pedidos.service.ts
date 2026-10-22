import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa, somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  mascararTelefone,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { diaParaDizer } from '../reclamacoes/regras.js';
import { ArquivoService } from './arquivo.service.js';
import {
  comoConsultar,
  ConfigArquivo,
  dataHora,
  ESTADOS_PEDIDO,
  EstadoPedido,
  euros,
  LADA,
  Modalidade,
  MODALIDADES,
  NOMES_ESTADO_PEDIDO,
  NOMES_RESULTADO,
  numeroPedido,
  podeDocumentos,
  Qualidade,
  QUALIDADES,
  Resultado,
  RESULTADOS,
  smsCopia,
  smsEncerrado,
  smsMarcado,
  smsRegisto,
  taxaCopia,
  textoEncontrados,
  textoLada,
  textoLerDeVolta,
} from './regras.js';

// ------------------------------------------------------------------
// Entradas
// ------------------------------------------------------------------

export const entradaPedir = z.object({
  morada: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .optional()
    .describe('A morada do prédio ou da obra.'),
  ano: z.coerce
    .number()
    .int()
    .min(1850)
    .max(2100)
    .optional()
    .describe('O ano, mesmo aproximado.'),
  requerente: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .optional()
    .describe('Quem pediu na altura.'),
  numero_antigo: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .describe('O número antigo, se o souber.'),
  descricao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('O que procura e para quê.'),
  qualidade: z
    .enum(QUALIDADES)
    .optional()
    .describe(
      'titular = quem pediu, dono ou herdeiro; interesse_legitimo = outra pessoa com interesse direto.',
    ),
  interesse: z
    .string()
    .trim()
    .min(5)
    .max(500)
    .optional()
    .describe('Com interesse_legitimo: porque precisa.'),
  modalidade: z
    .enum(MODALIDADES)
    .optional()
    .describe('presencial (com marcação) ou copia_certificada (com taxa).'),
  confirmado: z
    .boolean()
    .default(false)
    .describe('true só depois de a pessoa confirmar ler_a_pessoa.'),
});

export const esquemaFiltroPedidos = z.object({
  estado: z.enum([...ESTADOS_PEDIDO, 'abertos']).optional(),
});

export const esquemaAtender = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('marcar'),
    quando: z.iso.datetime({ offset: true }),
    local: z.string().trim().min(3).max(200).optional(),
    nota: z.string().trim().max(1000).optional(),
  }),
  z.object({
    acao: z.literal('preparar_copia'),
    paginas: z.number().int().min(1).max(5000),
    nota: z.string().trim().max(1000).optional(),
  }),
  z.object({
    acao: z.literal('copia_pronta'),
    paginas: z.number().int().min(1).max(5000).optional(),
    nota: z.string().trim().max(1000).optional(),
  }),
]);

export const esquemaEncerrarPedido = z.object({
  resultado: z.enum(RESULTADOS),
  nota: z.string().trim().max(1000).optional(),
});

// ------------------------------------------------------------------

interface LinhaPedido {
  id: string;
  numero: string;
  municipe_id: string | null;
  conversa_id: string | null;
  canal: string;
  nome: string | null;
  telefone: string | null;
  procura: {
    morada?: string | null;
    ano?: number | null;
    requerente?: string | null;
    numero_antigo?: string | null;
    descricao?: string | null;
  };
  qualidade: Qualidade;
  interesse: string | null;
  modalidade: Modalidade;
  documentos_provaveis: number;
  estado: EstadoPedido;
  responder_ate: string;
  config_usada: ConfigArquivo;
  marcado_para: Date | null;
  local: string | null;
  paginas: number | null;
  taxa_cents: number | null;
  resultado: Resultado | null;
  nota: string | null;
  tratado_por_nome: string | null;
  encerrado_em: Date | null;
  criado_em: Date;
}

const SELECT = `
  SELECT p.id, p.numero, p.municipe_id, p.conversa_id, p.canal, p.nome, p.telefone,
         p.procura, p.qualidade, p.interesse, p.modalidade, p.documentos_provaveis,
         p.estado, to_char(p.responder_ate, 'YYYY-MM-DD') AS responder_ate, p.config_usada,
         p.marcado_para, p.local, p.paginas, p.taxa_cents, p.resultado, p.nota,
         u.nome AS tratado_por_nome, p.encerrado_em, p.criado_em
  FROM arquivo_pedidos p
  LEFT JOIN utilizadores u ON u.id = p.tratado_por`;

/**
 * Pedidos de consulta ao arquivo: a ferramenta `pedir_consulta_arquivo` e o
 * painel (lista, marcar a consulta, preparar a cópia certificada, encerrar).
 * O munícipe só fica a saber quantos documentos prováveis há; quem vê o
 * conteúdo é o arquivo, depois de confirmar a legitimidade (LADA).
 */
@Injectable()
export class PedidosArquivoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly arquivo: ArquivoService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Ferramenta do agente
  // ------------------------------------------------------------------

  async pedirPeloAgente(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPedir>,
  ) {
    const m = ctx.municipio;
    if (!e.morada && !e.requerente && !e.numero_antigo) {
      return {
        registado: false,
        motivo: 'falta_procura',
        instrucao:
          'Pergunta o que procura: a morada do prédio, o ano (mesmo aproximado) e o nome de quem fez o pedido na altura. Depois chama outra vez.',
      };
    }
    const procura = {
      morada: e.morada ?? null,
      ano: e.ano ?? null,
      requerente: e.requerente ?? null,
      numero_antigo: e.numero_antigo ?? null,
      descricao: e.descricao ?? null,
    };
    const ids = await this.arquivo.provaveis(m.id, procura);
    const encontrados = {
      documentos_provaveis: ids.length,
      encontrados_dizer: textoEncontrados(ids.length),
    };

    const [mu] = ctx.municipeId
      ? await this.db.query<{
          id: string;
          nome: string | null;
          telefone_e164: string | null;
          tem_nif: boolean;
        }>(
          `SELECT id, nome, telefone_e164, nif_hash IS NOT NULL AS tem_nif
           FROM municipes WHERE id = $1 AND anonimizado_em IS NULL`,
          [ctx.municipeId],
        )
      : [];
    // O pedido fica em nome da pessoa: pelo NIF (como estado_processo). Na
    // porta para as IAs a pessoa já está identificada pela chave pessoal
    // (telemóvel verificado por SMS) e lá não há identificar_municipe.
    const identificado = !!mu && (mu.tem_nif || ctx.canal === 'ia');
    if (!mu || !identificado) {
      return {
        registado: false,
        motivo: 'precisa_identificacao',
        ...encontrados,
        instrucao:
          'Diz quantos documentos encontraste (sem dizer nada sobre eles). Para registar o pedido de consulta é preciso identificar a pessoa: peça o NIF e use identificar_municipe; depois volte a chamar esta ferramenta com os mesmos dados.',
      };
    }
    if (!e.qualidade) {
      return {
        registado: false,
        motivo: 'falta_qualidade',
        ...encontrados,
        lei: textoLada(),
        lei_a_confirmar: LADA.a_confirmar,
        instrucao:
          'Explica por palavras simples o que vem em "lei" e pergunta se é o titular do processo (quem o pediu, o dono ou herdeiro) ou, se não, qual é o interesse (ex.: vai comprar a casa, tem autorização do dono). Depois chama outra vez com qualidade (e interesse, se não for o titular).',
      };
    }
    if (e.qualidade === 'interesse_legitimo' && !e.interesse) {
      return {
        registado: false,
        motivo: 'falta_interesse',
        ...encontrados,
        instrucao:
          'Pergunta porque precisa do documento (o interesse direto e pessoal, ou se tem autorização escrita do titular) e chama outra vez com interesse.',
      };
    }
    const config = await this.arquivo.configDe(m.id);
    const como = comoConsultar(config);
    if (!e.modalidade) {
      return {
        registado: false,
        motivo: 'falta_modalidade',
        ...encontrados,
        opcoes: como,
        valores_de_demonstracao: config.demonstracao,
        instrucao:
          'Explica as duas formas de consultar (presencial ou cópia certificada), com os valores tal como vêm, e pergunta qual prefere. Depois chama outra vez com modalidade.',
      };
    }
    const leitura = textoLerDeVolta({
      nome: mu.nome,
      ...procura,
      qualidade: e.qualidade,
      interesse: e.interesse ?? null,
      modalidade: e.modalidade,
    });
    const hoje = hojeLisboa();
    const responderAte = somarDiasUteis(
      hoje,
      config.prazo_resposta_dias_uteis,
      await this.municipios.feriados(m.id),
    );
    if (!e.confirmado) {
      return {
        registado: false,
        motivo: 'falta_confirmar',
        ...encontrados,
        ler_a_pessoa: leitura,
        instrucao:
          'Lê este texto à pessoa e pergunta se está certo. Se corrigir, ajusta os campos. Depois chama outra vez com confirmado: true.',
      };
    }

    const telefone =
      normalizarTelefone(ctx.telefone) ?? mu.telefone_e164 ?? null;
    const canal = ctx.canal;
    const p = await this.db.transaction(async (tx) => {
      const ano = Number(hoje.slice(0, 4));
      const n = await proximoNumero(tx, m.id, 'ARQ', ano);
      const numero = numeroPedido(n, ano);
      const [novo] = await tx.query<{ id: string }>(
        `INSERT INTO arquivo_pedidos (municipio_id, numero, municipe_id, conversa_id, canal, nome,
           telefone, procura, qualidade, interesse, modalidade, documentos_provaveis,
           responder_ate, config_usada)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          m.id,
          numero,
          mu.id,
          ctx.conversaId,
          canal,
          mu.nome,
          telefone,
          JSON.stringify(procura),
          e.qualidade,
          e.interesse ?? null,
          e.modalidade,
          ids.length,
          responderAte,
          JSON.stringify(config),
        ],
      );
      if (ids.length) {
        await tx.query(
          `INSERT INTO arquivo_pedido_documentos (municipio_id, pedido_id, documento_id)
           SELECT $1, $2, unnest($3::uuid[])`,
          [m.id, novo.id, ids],
        );
      }
      if (telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: mu.id,
            destino: telefone,
            motivo: 'processo',
            corpo: smsRegisto(m.nome, numero, responderAte, e.modalidade!),
            relacionado: { pedido_arquivo_id: novo.id },
            chave: `arquivo_pedido:${novo.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { pedido_arquivo_id: novo.id, numero, tipo: 'consulta_arquivo' },
        tx,
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          atorId: null,
          acao: 'pedir_consulta_arquivo',
          objetoTipo: 'pedido_arquivo',
          objetoId: novo.id,
          dados: {
            numero,
            documentos_provaveis: ids.length,
            qualidade: e.qualidade,
            modalidade: e.modalidade,
          },
        },
        tx,
      );
      return { id: novo.id, numero };
    });

    const modo =
      e.modalidade === 'presencial'
        ? `Até ${diaParaDizer(responderAte)} o arquivo diz-lhe o dia da consulta. ${como.presencial}`
        : `Até ${diaParaDizer(responderAte)} o arquivo diz-lhe o valor certo e quando fica pronta. ${como.copia_certificada}`;
    return {
      registado: true,
      numero: p.numero,
      ...encontrados,
      responder_ate: responderAte,
      responder_ate_dito: diaParaDizer(responderAte),
      prazo_dias_uteis: config.prazo_resposta_dias_uteis,
      valores_de_demonstracao: config.demonstracao,
      lei: `${LADA.lei}, ${LADA.prazo} (a confirmar com o arquivo)`,
      sms_enviado: !!telefone,
      dizer:
        `O seu pedido de consulta ao arquivo ficou registado com o número ${p.numero}. ${modo} ` +
        'O arquivo pode pedir-lhe um documento que prove que é o titular ou o seu interesse; leve o cartão de cidadão. ' +
        (telefone
          ? 'Vai receber um SMS com o número do pedido.'
          : 'Guarde o número do pedido.'),
    };
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async listar(m: Municipio, f: z.output<typeof esquemaFiltroPedidos>) {
    const [linhas, contagens] = await Promise.all([
      this.db.query<LinhaPedido>(
        `${SELECT} WHERE p.municipio_id = $1
           AND ($2::text IS NULL
                OR ($2 = 'abertos' AND p.estado <> 'encerrado')
                OR p.estado = $2)
         ORDER BY (p.estado <> 'encerrado') DESC, p.responder_ate, p.criado_em DESC
         LIMIT 200`,
        [m.id, f.estado ?? null],
      ),
      this.db.query<{ estado: EstadoPedido; n: number }>(
        `SELECT estado, count(*)::int AS n FROM arquivo_pedidos
         WHERE municipio_id = $1 GROUP BY estado`,
        [m.id],
      ),
    ]);
    const hoje = hojeLisboa();
    return {
      pedidos: linhas.map((l) => ({
        ...this.paraPainel(l, hoje),
        telefone: mascararTelefone(l.telefone),
      })),
      contagens: Object.fromEntries(
        ESTADOS_PEDIDO.map((e) => [
          e,
          contagens.find((c) => c.estado === e)?.n ?? 0,
        ]),
      ),
      config: await this.arquivo.configDe(m.id),
    };
  }

  async detalhe(m: Municipio, u: UtilizadorPainel, id: string) {
    const l = await this.porId(m.id, id);
    const [docs, mensagens] = await Promise.all([
      this.db.query<{ documento_id: string }>(
        'SELECT documento_id FROM arquivo_pedido_documentos WHERE pedido_id = $1',
        [id],
      ),
      this.db.query<{
        canal: string;
        corpo: string;
        estado: string;
        enviar_em: Date;
      }>(
        `SELECT canal::text, corpo, estado::text, enviar_em FROM mensagens_saida
         WHERE municipio_id = $1 AND relacionado->>'pedido_arquivo_id' = $2
         ORDER BY enviar_em`,
        [m.id, id],
      ),
    ]);
    const resumos = await this.arquivo.resumosDe(
      m.id,
      docs.map((d) => d.documento_id),
    );
    // Quem só trata pedidos vê que documentos são, não o que dizem.
    const completo = podeDocumentos(u.perfil);
    return {
      ...this.paraPainel(l, hojeLisboa()),
      documentos: resumos.map((r) =>
        completo
          ? r
          : {
              id: r.id,
              nome_ficheiro: r.nome_ficheiro,
              estado: r.estado,
              metadados: {
                numero_antigo: r.metadados.numero_antigo,
                ano: r.metadados.ano,
                tipo: r.metadados.tipo,
              },
            },
      ),
      pode_ver_documentos: completo,
      mensagens: mensagens.map((x) => ({
        ...x,
        enviar_em: x.enviar_em.toISOString(),
      })),
    };
  }

  /** Marcar a consulta presencial, preparar a cópia ou dizer que está pronta. */
  async atender(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    a: z.output<typeof esquemaAtender>,
  ) {
    await this.db.transaction(async (tx) => {
      const [l] = await tx.query<LinhaPedido>(
        `${SELECT} WHERE p.municipio_id = $1 AND p.id = $2 FOR UPDATE OF p`,
        [m.id, id],
      );
      if (!l) throw naoExiste();
      if (l.estado === 'encerrado') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'pedido_encerrado',
          'Este pedido já está encerrado.',
        );
      }
      const config = l.config_usada;
      let sms: string | null = null;
      if (a.acao === 'marcar') {
        const quando = new Date(a.quando);
        if (quando.getTime() < Date.now()) {
          throw new ErroApi(
            HttpStatus.BAD_REQUEST,
            'data_passada',
            'A data da consulta já passou.',
          );
        }
        const local = a.local ?? config.presencial.local;
        await tx.query(
          `UPDATE arquivo_pedidos SET estado = 'agendado', marcado_para = $2, local = $3,
             nota = coalesce($4, nota), tratado_por = $5, atualizado_em = now()
           WHERE id = $1`,
          [id, quando, local, a.nota ?? null, u.id],
        );
        sms = smsMarcado(m.nome, l.numero, quando, local);
      } else {
        const paginas = a.paginas ?? l.paginas ?? 1;
        const taxa = taxaCopia(config, paginas);
        const pronta = a.acao === 'copia_pronta';
        await tx.query(
          `UPDATE arquivo_pedidos SET estado = $2, paginas = $3, taxa_cents = $4,
             nota = coalesce($5, nota), tratado_por = $6, atualizado_em = now()
           WHERE id = $1`,
          [
            id,
            pronta ? 'pronto' : 'em_preparacao',
            paginas,
            taxa,
            a.nota ?? null,
            u.id,
          ],
        );
        sms = smsCopia(m.nome, l.numero, taxa, pronta, config.demonstracao);
      }
      if (l.telefone && sms) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: l.municipe_id,
            destino: l.telefone,
            motivo: 'processo',
            corpo: sms,
            relacionado: { pedido_arquivo_id: id },
            chave: `arquivo_pedido:${id}:${a.acao}:${Date.now()}`,
          },
          tx,
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'atender_pedido_arquivo',
          objetoTipo: 'pedido_arquivo',
          objetoId: id,
          dados: { acao: a.acao, numero: l.numero },
        },
        tx,
      );
    });
    return this.detalhe(m, u, id);
  }

  async encerrar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaEncerrarPedido>,
  ) {
    await this.db.transaction(async (tx) => {
      const [l] = await tx.query<LinhaPedido>(
        `${SELECT} WHERE p.municipio_id = $1 AND p.id = $2 FOR UPDATE OF p`,
        [m.id, id],
      );
      if (!l) throw naoExiste();
      if (l.estado === 'encerrado') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'pedido_encerrado',
          'Este pedido já está encerrado.',
        );
      }
      if (e.resultado === 'recusado' && !e.nota) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'falta_nota',
          'Ao recusar, diga porquê (o que falta provar).',
        );
      }
      await tx.query(
        `UPDATE arquivo_pedidos SET estado = 'encerrado', resultado = $2,
           nota = coalesce($3, nota), tratado_por = $4, encerrado_em = now(), atualizado_em = now()
         WHERE id = $1`,
        [id, e.resultado, e.nota ?? null, u.id],
      );
      const sms = smsEncerrado(m.nome, l.numero, e.resultado, e.nota ?? null);
      if (l.telefone && sms) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: l.municipe_id,
            destino: l.telefone,
            motivo: 'processo',
            corpo: sms,
            relacionado: { pedido_arquivo_id: id },
            chave: `arquivo_pedido:${id}:encerrado`,
          },
          tx,
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'encerrar_pedido_arquivo',
          objetoTipo: 'pedido_arquivo',
          objetoId: id,
          dados: { resultado: e.resultado, numero: l.numero },
        },
        tx,
      );
    });
    return this.detalhe(m, u, id);
  }

  // ------------------------------------------------------------------

  private async porId(municipioId: string, id: string): Promise<LinhaPedido> {
    const [l] = await this.db.query<LinhaPedido>(
      `${SELECT} WHERE p.municipio_id = $1 AND p.id = $2`,
      [municipioId, id],
    );
    if (!l) throw naoExiste();
    return l;
  }

  private paraPainel(l: LinhaPedido, hoje: string) {
    return {
      id: l.id,
      numero: l.numero,
      canal: l.canal,
      nome: l.nome,
      telefone: l.telefone,
      municipe_id: l.municipe_id,
      conversa_id: l.conversa_id,
      procura: l.procura,
      qualidade: l.qualidade,
      interesse: l.interesse,
      modalidade: l.modalidade,
      documentos_provaveis: l.documentos_provaveis,
      estado: l.estado,
      estado_nome: NOMES_ESTADO_PEDIDO[l.estado],
      responder_ate: l.responder_ate,
      em_atraso: l.estado === 'recebido' && l.responder_ate < hoje,
      marcado_para: l.marcado_para?.toISOString() ?? null,
      marcado_para_dito: l.marcado_para ? dataHora(l.marcado_para) : null,
      local: l.local,
      paginas: l.paginas,
      taxa_cents: l.taxa_cents,
      taxa: l.taxa_cents != null ? euros(l.taxa_cents) : null,
      valores_de_demonstracao: l.config_usada.demonstracao,
      resultado: l.resultado,
      resultado_nome: l.resultado ? NOMES_RESULTADO[l.resultado] : null,
      nota: l.nota,
      tratado_por: l.tratado_por_nome,
      encerrado_em: l.encerrado_em?.toISOString() ?? null,
      criado_em: l.criado_em.toISOString(),
      lei: {
        texto: `${LADA.lei}, ${LADA.nominativos}`,
        a_confirmar: LADA.a_confirmar,
      },
    };
  }
}

function naoExiste(): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'pedido_desconhecido',
    'Este pedido de consulta não existe.',
  );
}
