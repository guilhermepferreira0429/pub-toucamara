import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { emailEReclamacao, pareceReclamacao } from '../relatorios/diario.js';
import {
  calcularPrazo,
  CanalReclamacao,
  CANAIS,
  ConfigReclamacoes,
  conteudoResposta,
  dataPorExtenso,
  diaParaDizer,
  EstadoReclamacao,
  ESTADOS,
  indicadores,
  lerConfig,
  NOMES_CANAL,
  NOMES_ESTADO,
  precisaAviso,
  rascunhoSemIa,
  SISTEMA_RESPOSTA,
  situacaoPrazo,
  smsRegisto,
  smsResposta,
  textoLerDeVolta,
} from './regras.js';

// ------------------------------------------------------------------
// Entradas
// ------------------------------------------------------------------

export const entradaRegistar = z.object({
  nome: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .describe('Nome completo (obrigatório na formal).'),
  servico_visado: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('O serviço, balcão ou funcionário.'),
  descricao: z
    .string()
    .trim()
    .min(10)
    .max(4000)
    .describe('O quê, quando e onde, com as palavras da pessoa.'),
  pedido: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe('O que pede à câmara.'),
  resposta_por: z
    .enum(['sms', 'email'])
    .optional()
    .describe('Por omissão SMS.'),
  email: z.email().optional().describe('Se quer a resposta por email.'),
  confirmado: z
    .boolean()
    .default(false)
    .describe('true só depois de a pessoa confirmar ler_a_pessoa.'),
});

const data = z.iso.date();

export const esquemaNova = z.object({
  canal: z.enum(CANAIS),
  nome: z.string().trim().min(2).max(120),
  telefone: z.string().trim().max(30).optional(),
  email: z.email().optional(),
  resposta_por: z.enum(['sms', 'email', 'carta']).optional(),
  servico_visado: z.string().trim().max(200).optional(),
  servico_id: z.guid().optional(),
  descricao: z.string().trim().min(10).max(8000),
  pedido: z.string().trim().max(2000).optional(),
  /** O dia em que entrou (folha do Livro Amarelo: o dia escrito na folha). */
  recebida_em: data.optional(),
});

export const esquemaConverterEmail = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  servico_id: z.guid().optional(),
});

export const esquemaAtribuir = z
  .object({
    servico_id: z.guid().nullable().optional(),
    utilizador_id: z.guid().nullable().optional(),
  })
  .refine((x) => x.servico_id !== undefined || x.utilizador_id !== undefined, {
    message: 'Indique o serviço ou o funcionário.',
  });

export const esquemaRascunho = z.object({
  notas: z.string().trim().max(4000).optional(),
});

export const esquemaResponder = z.object({
  texto: z.string().trim().min(20).max(10000),
});

export const esquemaEncerrar = z.object({
  nota: z.string().trim().min(3).max(2000).optional(),
});

export const esquemaAnexo = z.object({
  nome: z.string().trim().min(1).max(200),
  mime: z
    .string()
    .trim()
    .regex(
      /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/i,
      'Só imagens (JPEG, PNG, WebP, HEIC) ou PDF.',
    ),
});

export const esquemaFiltro = z.object({
  estado: z.enum([...ESTADOS, 'abertas']).optional(),
  servico_id: z.guid().optional(),
});

// ------------------------------------------------------------------

interface Linha {
  id: string;
  municipio_id: string;
  numero: string;
  codigo_publico: string;
  municipe_id: string | null;
  conversa_id: string | null;
  email_id: string | null;
  canal: CanalReclamacao;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  resposta_por: 'sms' | 'email' | 'carta';
  servico_visado: string | null;
  servico_id: string | null;
  servico: string | null;
  atribuida_a: string | null;
  atribuida_a_nome: string | null;
  descricao: string;
  pedido: string | null;
  estado: EstadoReclamacao;
  recebida_em: string;
  prazo_dias_uteis: number;
  responder_ate: string;
  config_usada: ConfigReclamacoes;
  resposta: string | null;
  respondida_em: Date | null;
  respondida_dia: string | null;
  respondida_por_nome: string | null;
  encerrada_em: Date | null;
  nota_encerramento: string | null;
  criada_em: Date;
}

const SELECT = `
  SELECT r.id, r.municipio_id, r.numero, r.codigo_publico, r.municipe_id, r.conversa_id,
         r.email_id, r.canal, r.nome, r.telefone, r.email::text AS email, r.resposta_por,
         r.servico_visado, r.servico_id, s.nome AS servico, r.atribuida_a,
         ua.nome AS atribuida_a_nome, r.descricao, r.pedido, r.estado,
         to_char(r.recebida_em, 'YYYY-MM-DD') AS recebida_em, r.prazo_dias_uteis,
         to_char(r.responder_ate, 'YYYY-MM-DD') AS responder_ate, r.config_usada,
         r.resposta, r.respondida_em,
         to_char((r.respondida_em AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS respondida_dia,
         ur.nome AS respondida_por_nome, r.encerrada_em, r.nota_encerramento, r.criada_em
  FROM reclamacoes r
  LEFT JOIN servicos s ON s.id = r.servico_id
  LEFT JOIN utilizadores ua ON ua.id = r.atribuida_a
  LEFT JOIN utilizadores ur ON ur.id = r.respondida_por`;

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface NovaReclamacao {
  canal: CanalReclamacao;
  nome: string;
  telefone: string | null;
  email: string | null;
  resposta_por: 'sms' | 'email' | 'carta';
  servico_visado: string | null;
  servico_id: string | null;
  descricao: string;
  pedido: string | null;
  recebida_em: string;
  municipe_id: string | null;
  conversa_id: string | null;
  email_id: string | null;
  anexos: { nome: string; mime: string }[];
  ator: { tipo: 'agente' | 'utilizador'; id: string | null };
}

/**
 * Livro de reclamações: reclamações formais com número (REC n/ano) e prazo
 * legal de resposta em dias úteis (feriados do município). O agente regista
 * pelo telefone ou pelo chat; no painel registam-se as do balcão, do Livro
 * Amarelo em papel e dos emails da triagem, atribuem-se, respondem-se (a
 * resposta vai por SMS ou email e fica na página pública) e encerram-se.
 * Um trabalho diário avisa os responsáveis do que está a terminar ou em
 * atraso.
 */
@Injectable()
export class ReclamacoesService {
  private readonly logger = new Logger(ReclamacoesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly auditoria: AuditoriaService,
    private readonly claude: ClaudeService,
    private readonly armazenamento: ArmazenamentoService,
  ) {}

  // ------------------------------------------------------------------
  // Configuração
  // ------------------------------------------------------------------

  async configDe(municipioId: string): Promise<ConfigReclamacoes> {
    const [r] = await this.db.query<{ c: unknown }>(
      'SELECT reclamacoes_config AS c FROM municipios WHERE id = $1',
      [municipioId],
    );
    return lerConfig(r?.c);
  }

  async guardarConfig(m: Municipio, u: UtilizadorPainel, c: ConfigReclamacoes) {
    await this.db.query(
      'UPDATE municipios SET reclamacoes_config = $2 WHERE id = $1',
      [m.id, JSON.stringify(c)],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_prazo_reclamacoes',
      objetoTipo: 'reclamacoes_config',
      objetoId: m.id,
      dados: {
        prazo_dias_uteis: c.prazo_dias_uteis,
        demonstracao: c.demonstracao,
      },
    });
    return { config: c };
  }

  // ------------------------------------------------------------------
  // Ferramenta do agente
  // ------------------------------------------------------------------

  async registarPeloAgente(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaRegistar>,
  ) {
    const m = ctx.municipio;
    let telefone = normalizarTelefone(ctx.telefone);
    if (!ctx.municipeId && !telefone) {
      return {
        registada: false,
        motivo: 'precisa_identificacao',
        instrucao:
          ctx.canal === 'chat'
            ? 'Para registar uma reclamação formal a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.'
            : 'Não há um número para onde mandar o número da reclamação e a resposta. Pede o número de telemóvel e usa identificar_municipe, ou passa a um funcionário.',
      };
    }
    if (!telefone && ctx.municipeId) {
      const [mu] = await this.db.query<{ t: string | null }>(
        'SELECT telefone_e164 AS t FROM municipes WHERE id = $1',
        [ctx.municipeId],
      );
      telefone = mu?.t ?? null;
    }
    const respostaPor = e.resposta_por === 'email' && e.email ? 'email' : 'sms';
    if (e.resposta_por === 'email' && !e.email) {
      return {
        registada: false,
        motivo: 'falta_email',
        instrucao:
          'A pessoa quer a resposta por email: pergunta o endereço e chama outra vez com email.',
      };
    }
    const config = await this.configDe(m.id);
    const hoje = hojeLisboa();
    const responderAte = calcularPrazo(
      hoje,
      config.prazo_dias_uteis,
      await this.municipios.feriados(m.id),
    );
    const leitura = textoLerDeVolta({
      nome: e.nome,
      servico_visado: e.servico_visado,
      descricao: e.descricao,
      pedido: e.pedido,
      resposta_por: respostaPor,
      email: e.email,
    });
    if (!e.confirmado) {
      return {
        registada: false,
        motivo: 'falta_confirmar',
        ler_a_pessoa: leitura,
        prazo_se_registar: diaParaDizer(responderAte),
        instrucao:
          'Lê este texto à pessoa e pergunta se está correto. Se ela corrigir, ajusta os campos. Depois chama outra vez com confirmado: true.',
      };
    }

    const r = await this.db.transaction(async (tx) => {
      const municipeId =
        ctx.municipeId ??
        (await this.municipes.porTelefone(m.id, telefone, tx))?.id ??
        null;
      if (municipeId) {
        await tx.query(
          'UPDATE municipes SET nome = coalesce(nome, $2), email = coalesce(email, $3) WHERE id = $1',
          [municipeId, e.nome, e.email ?? null],
        );
      }
      const nova = await this.inserir(tx, m, config, {
        canal:
          ctx.canal === 'telefone'
            ? 'telefone'
            : ctx.canal === 'sms'
              ? 'sms'
              : 'chat',
        nome: e.nome,
        telefone,
        email: e.email ?? null,
        resposta_por: respostaPor,
        servico_visado: e.servico_visado ?? null,
        servico_id: null,
        descricao: e.descricao,
        pedido: e.pedido ?? null,
        recebida_em: hoje,
        municipe_id: municipeId,
        conversa_id: ctx.conversaId,
        email_id: null,
        anexos: [],
        ator: { tipo: 'agente', id: null },
      });
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { reclamacao_id: nova.id, numero: nova.numero, tipo: 'reclamacao' },
        tx,
      );
      return nova;
    });
    await this.posRegisto(m.id, r);

    return {
      registada: true,
      numero: r.numero,
      responder_ate: r.responder_ate,
      responder_ate_dito: diaParaDizer(r.responder_ate),
      prazo_dias_uteis: config.prazo_dias_uteis,
      prazo_de_demonstracao: config.demonstracao,
      link: this.url(r.codigo),
      sms_enviado: !!telefone,
      dizer:
        `A sua reclamação ficou registada com o número ${r.numero}. ` +
        `A câmara tem de lhe responder até ${diaParaDizer(r.responder_ate)}. ` +
        (telefone
          ? 'Vai receber um SMS com o número e um link onde pode ver o estado e, depois, a resposta.'
          : 'Guarde o número: com ele pode perguntar pelo estado.'),
    };
  }

  // ------------------------------------------------------------------
  // Registo no painel (balcão, Livro Amarelo, telefone, email)
  // ------------------------------------------------------------------

  async criarNoPainel(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaNova>,
  ) {
    const hoje = hojeLisboa();
    const recebida = d.recebida_em ?? hoje;
    if (recebida > hoje) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'data_invalida',
        'A data de entrada não pode ser no futuro.',
      );
    }
    const telefone = d.telefone ? normalizarTelefone(d.telefone) : null;
    if (d.telefone && !telefone) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'O número de telefone não é válido.',
      );
    }
    const respostaPor =
      d.resposta_por ?? (telefone ? 'sms' : d.email ? 'email' : 'carta');
    if (respostaPor === 'sms' && !telefone) {
      throw erroContacto('Para responder por SMS indique o telemóvel.');
    }
    if (respostaPor === 'email' && !d.email) {
      throw erroContacto('Para responder por email indique o email.');
    }
    if (d.servico_id) await this.servico(m.id, d.servico_id);
    const config = await this.configDe(m.id);
    const r = await this.db.transaction(async (tx) => {
      const municipeId = telefone
        ? ((await this.municipes.porTelefone(m.id, telefone, tx))?.id ?? null)
        : null;
      return this.inserir(tx, m, config, {
        canal: d.canal,
        nome: d.nome,
        telefone,
        email: d.email ?? null,
        resposta_por: respostaPor,
        servico_visado: d.servico_visado ?? null,
        servico_id: d.servico_id ?? null,
        descricao: d.descricao,
        pedido: d.pedido ?? null,
        recebida_em: recebida,
        municipe_id: municipeId,
        conversa_id: null,
        email_id: null,
        anexos: [],
        ator: { tipo: 'utilizador', id: u.id },
      });
    });
    await this.posRegisto(m.id, r);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'criar',
      objetoTipo: 'reclamacao',
      objetoId: r.id,
      dados: { canal: d.canal, numero: r.numero },
    });
    return this.detalhe(m, r.id);
  }

  /** Emails da triagem que parecem reclamações e ainda não o são. */
  async emailsCandidatos(m: Municipio) {
    const linhas = await this.db.query<{
      id: string;
      de: string;
      assunto: string | null;
      excerto: string;
      recebido_em: Date;
      tema: string | null;
      estado: string;
    }>(
      `SELECT ee.id, ee.de, ee.assunto, left(ee.corpo, 400) AS excerto, ee.recebido_em,
              coalesce(t.nome, ee.tema) AS tema, ee.estado
       FROM emails_entrada ee
       LEFT JOIN temas t ON t.id = ee.tema_id
       WHERE ee.municipio_id = $1
         AND ee.estado IN ('nova', 'encaminhada')
         AND ee.recebido_em > now() - interval '90 days'
         AND NOT EXISTS (SELECT 1 FROM reclamacoes r WHERE r.email_id = ee.id)
       ORDER BY ee.recebido_em DESC
       LIMIT 200`,
      [m.id],
    );
    return {
      emails: linhas
        .filter((e) => emailEReclamacao(e) || pareceReclamacao(e.excerto))
        .slice(0, 30)
        .map((e) => ({
          id: e.id,
          de: e.de,
          assunto: e.assunto,
          excerto: e.excerto.slice(0, 200),
          recebido_em: e.recebido_em.toISOString(),
          tema: e.tema,
        })),
    };
  }

  /** "Registar como reclamação formal" num email da triagem. */
  async converterEmail(
    m: Municipio,
    u: UtilizadorPainel,
    emailId: string,
    d: z.output<typeof esquemaConverterEmail>,
  ) {
    const config = await this.configDe(m.id);
    if (d.servico_id) await this.servico(m.id, d.servico_id);
    const r = await this.db.transaction(async (tx) => {
      const [e] = await tx.query<{
        de: string;
        assunto: string | null;
        corpo: string;
        dia: string;
        servico_id: string | null;
        anexos: { nome?: string; mime?: string }[];
      }>(
        `SELECT de, assunto, corpo, servico_id, anexos,
                to_char((recebido_em AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS dia
         FROM emails_entrada WHERE municipio_id = $1 AND id = $2 FOR UPDATE`,
        [m.id, emailId],
      );
      if (!e) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'email_desconhecido',
          'Este email não existe.',
        );
      }
      const [ja] = await tx.query<{ numero: string }>(
        'SELECT numero FROM reclamacoes WHERE email_id = $1',
        [emailId],
      );
      if (ja) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ja_convertido',
          `Este email já é a reclamação ${ja.numero}.`,
        );
      }
      const nome = d.nome ?? nomeDoEmail(e.de);
      const descricao = [e.assunto ? `Assunto: ${e.assunto}` : null, e.corpo]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 8000);
      return this.inserir(tx, m, config, {
        canal: 'email',
        nome,
        telefone: null,
        email: enderecoDoEmail(e.de),
        resposta_por: 'email',
        servico_visado: null,
        servico_id: d.servico_id ?? e.servico_id,
        descricao:
          descricao.length >= 10 ? descricao : `${descricao} (sem texto)`,
        pedido: null,
        recebida_em: e.dia,
        municipe_id: null,
        conversa_id: null,
        email_id: emailId,
        anexos: (Array.isArray(e.anexos) ? e.anexos : []).map((a) => ({
          nome: a.nome ?? 'anexo',
          mime: a.mime ?? 'application/octet-stream',
        })),
        ator: { tipo: 'utilizador', id: u.id },
      });
    });
    await this.posRegisto(m.id, r);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'converter_email_reclamacao',
      objetoTipo: 'reclamacao',
      objetoId: r.id,
      dados: { email_id: emailId, numero: r.numero },
    });
    return this.detalhe(m, r.id);
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async listar(m: Municipio, f: z.output<typeof esquemaFiltro>) {
    const [linhas, todas, config, feriados] = await Promise.all([
      this.db.query<Linha>(
        `${SELECT} WHERE r.municipio_id = $1
           AND ($2::text IS NULL
                OR ($2 = 'abertas' AND r.estado IN ('recebida','em_analise'))
                OR r.estado = $2)
           AND ($3::uuid IS NULL OR r.servico_id = $3)
         ORDER BY (r.estado IN ('recebida','em_analise')) DESC, r.responder_ate, r.criada_em DESC
         LIMIT 200`,
        [m.id, f.estado ?? null, f.servico_id ?? null],
      ),
      this.db.query<{
        estado: EstadoReclamacao;
        recebida_em: string;
        responder_ate: string;
        respondida_em: string | null;
        servico: string | null;
      }>(
        `SELECT r.estado, to_char(r.recebida_em, 'YYYY-MM-DD') AS recebida_em,
                to_char(r.responder_ate, 'YYYY-MM-DD') AS responder_ate,
                to_char((r.respondida_em AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS respondida_em,
                s.nome AS servico
         FROM reclamacoes r LEFT JOIN servicos s ON s.id = r.servico_id
         WHERE r.municipio_id = $1 AND r.recebida_em > now() - interval '1 year'`,
        [m.id],
      ),
      this.configDe(m.id),
      this.municipios.feriados(m.id),
    ]);
    const hoje = hojeLisboa();
    const contagens = Object.fromEntries(
      ESTADOS.map((e) => [e, todas.filter((x) => x.estado === e).length]),
    ) as Record<EstadoReclamacao, number>;
    return {
      reclamacoes: linhas.map((l) => this.paraPainel(l, hoje, feriados)),
      contagens,
      indicadores: indicadores(todas, hoje, feriados),
      config,
    };
  }

  async opcoes(m: Municipio) {
    const [servicos, utilizadores] = await Promise.all([
      this.db.query<{ id: string; nome: string }>(
        'SELECT id, nome FROM servicos WHERE municipio_id = $1 ORDER BY nome',
        [m.id],
      ),
      this.db.query<{ id: string; nome: string; servico_id: string | null }>(
        `SELECT id, nome, servico_id FROM utilizadores
         WHERE municipio_id = $1 AND ativo ORDER BY nome`,
        [m.id],
      ),
    ]);
    return { servicos, utilizadores };
  }

  async detalhe(m: Municipio, id: string) {
    const l = await this.porId(this.db, m.id, id);
    const [eventos, anexos, mensagens, feriados] = await Promise.all([
      this.db.query<{
        tipo: string;
        descricao: string;
        ator_tipo: string;
        ator: string | null;
        criado_em: Date;
      }>(
        `SELECT e.tipo, e.descricao, e.ator_tipo, u.nome AS ator, e.criado_em
         FROM reclamacao_eventos e LEFT JOIN utilizadores u ON u.id = e.ator_id
         WHERE e.reclamacao_id = $1 ORDER BY e.criado_em, e.id`,
        [id],
      ),
      this.db.query<{
        id: string;
        nome: string;
        mime: string;
        ficheiro_key: string | null;
        criado_em: Date;
      }>(
        `SELECT id, nome, mime, ficheiro_key, criado_em FROM reclamacao_anexos
         WHERE reclamacao_id = $1 ORDER BY criado_em`,
        [id],
      ),
      this.db.query<{
        canal: string;
        destino: string;
        corpo: string;
        estado: string;
        enviar_em: Date;
      }>(
        `SELECT canal::text, destino, corpo, estado::text, enviar_em FROM mensagens_saida
         WHERE municipio_id = $1 AND relacionado->>'reclamacao_id' = $2
         ORDER BY enviar_em`,
        [m.id, id],
      ),
      this.municipios.feriados(m.id),
    ]);
    return {
      ...this.paraPainel(l, hojeLisboa(), feriados),
      eventos: eventos.map((e) => ({
        ...e,
        criado_em: e.criado_em.toISOString(),
      })),
      anexos: await Promise.all(
        anexos.map(async (a) => ({
          id: a.id,
          nome: a.nome,
          mime: a.mime,
          criado_em: a.criado_em.toISOString(),
          url:
            a.ficheiro_key && this.armazenamento.disponivel
              ? await this.armazenamento.urlLeitura(a.ficheiro_key, 15)
              : null,
        })),
      ),
      mensagens: mensagens.map((x) => ({
        ...x,
        enviar_em: x.enviar_em.toISOString(),
      })),
      armazenamento: this.armazenamento.disponivel,
    };
  }

  async atribuir(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaAtribuir>,
  ) {
    let servicoId = d.servico_id;
    let nomeUtilizador: string | null = null;
    if (d.utilizador_id) {
      const [x] = await this.db.query<{
        nome: string;
        servico_id: string | null;
      }>(
        'SELECT nome, servico_id FROM utilizadores WHERE id = $1 AND municipio_id = $2 AND ativo',
        [d.utilizador_id, m.id],
      );
      if (!x) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'utilizador_desconhecido',
          'Este funcionário não existe nesta câmara.',
        );
      }
      nomeUtilizador = x.nome;
      if (servicoId === undefined && x.servico_id) servicoId = x.servico_id;
    }
    const servico = servicoId ? await this.servico(m.id, servicoId) : null;
    await this.db.transaction(async (tx) => {
      const l = await this.porId(tx, m.id, id, true);
      if (l.estado === 'encerrada') throw jaEncerrada();
      await tx.query(
        `UPDATE reclamacoes SET
           servico_id = CASE WHEN $2 THEN $3::uuid ELSE servico_id END,
           atribuida_a = CASE WHEN $4 THEN $5::uuid ELSE atribuida_a END,
           estado = CASE WHEN estado = 'recebida' THEN 'em_analise' ELSE estado END,
           atualizada_em = now()
         WHERE id = $1`,
        [
          id,
          servicoId !== undefined,
          servicoId ?? null,
          d.utilizador_id !== undefined,
          d.utilizador_id ?? null,
        ],
      );
      const partes = [
        servico ? `ao serviço ${servico.nome}` : null,
        nomeUtilizador ? `a ${nomeUtilizador}` : null,
      ].filter(Boolean);
      await this.evento(
        tx,
        id,
        'atribuida',
        partes.length
          ? `Atribuída ${partes.join(' e ')}.`
          : 'Atribuição retirada.',
        'utilizador',
        u.id,
      );
    });
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'atribuir_reclamacao',
      objetoTipo: 'reclamacao',
      objetoId: id,
      dados: {
        servico_id: servicoId ?? null,
        utilizador_id: d.utilizador_id ?? null,
      },
    });
    return this.detalhe(m, id);
  }

  /** Rascunho da resposta: IA com as notas do funcionário, ou o modelo fixo. */
  async rascunho(
    m: Municipio,
    id: string,
    d: z.output<typeof esquemaRascunho>,
  ) {
    const l = await this.porId(this.db, m.id, id);
    const base = {
      municipio: m.nome,
      numero: l.numero,
      nome: l.nome,
      recebida_em: l.recebida_em,
      descricao: l.descricao,
      pedido: l.pedido,
    };
    if (this.claude.disponivel) {
      try {
        const texto = await this.claude.escrever({
          tarefa: 'rascunho_reclamacao',
          minimizar: true,
          sistema: SISTEMA_RESPOSTA,
          conteudo: conteudoResposta({
            ...base,
            servico: l.servico ?? l.servico_visado,
            notas: d.notas ?? null,
          }),
          esforco: 'medium',
          maxTokens: 3000,
        });
        if (texto.trim()) return { texto: texto.trim(), origem: 'ia' as const };
      } catch (e) {
        this.logger.warn(
          `Rascunho da reclamação ${l.numero} sem IA: ${(e as Error).message}`,
        );
      }
    }
    return { texto: rascunhoSemIa(base), origem: 'modelo' as const };
  }

  /**
   * A resposta escrita: fica na página pública e vai por SMS (com o link)
   * ou por email (o texto inteiro). Por carta: o funcionário imprime.
   */
  async responder(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaResponder>,
  ) {
    if (/\[[^\]]{2,200}\]/.test(d.texto)) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'rascunho_por_completar',
        'A resposta ainda tem marcadores entre parênteses retos por completar.',
      );
    }
    const enviarEmail = await this.db.transaction(async (tx) => {
      const l = await this.porId(tx, m.id, id, true);
      if (l.estado === 'respondida') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ja_respondida',
          'Esta reclamação já foi respondida.',
        );
      }
      if (l.estado === 'encerrada') throw jaEncerrada();
      await tx.query(
        `UPDATE reclamacoes SET estado = 'respondida', resposta = $2, respondida_em = now(),
           respondida_por = $3, atualizada_em = now()
         WHERE id = $1`,
        [id, d.texto, u.id],
      );
      const url = this.url(l.codigo_publico);
      const via =
        l.resposta_por === 'sms' && l.telefone
          ? 'SMS'
          : l.resposta_por === 'email' && l.email
            ? 'email'
            : 'carta (imprimir)';
      await this.evento(
        tx,
        id,
        'respondida',
        `Resposta enviada por ${via} e publicada na página da reclamação.`,
        'utilizador',
        u.id,
      );
      if (l.resposta_por === 'sms' && l.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: l.municipe_id,
            destino: l.telefone,
            motivo: 'reclamacao',
            corpo: smsResposta(m.nome, l.numero, url),
            relacionado: { reclamacao_id: id },
            chave: `reclamacao_resposta:${id}`,
          },
          tx,
        );
        return null;
      }
      if (l.resposta_por === 'email' && l.email) return l;
      return null;
    });
    if (enviarEmail) {
      await this.enviarEmailMunicipe(
        m,
        enviarEmail,
        `reclamacao_resposta:${id}`,
        `Resposta à sua reclamação ${enviarEmail.numero}`,
        `${d.texto}\n\n---\nReclamação ${enviarEmail.numero}: ${this.url(enviarEmail.codigo_publico)}`,
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'responder',
      objetoTipo: 'reclamacao',
      objetoId: id,
    });
    return this.detalhe(m, id);
  }

  async encerrar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaEncerrar>,
  ) {
    await this.db.transaction(async (tx) => {
      const l = await this.porId(tx, m.id, id, true);
      if (l.estado === 'encerrada') throw jaEncerrada();
      if (l.estado !== 'respondida' && !d.nota) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'falta_nota',
          'Para encerrar sem resposta escrita, diga porquê (ex.: a pessoa desistiu).',
        );
      }
      await tx.query(
        `UPDATE reclamacoes SET estado = 'encerrada', encerrada_em = now(),
           nota_encerramento = $2, atualizada_em = now() WHERE id = $1`,
        [id, d.nota ?? null],
      );
      await this.evento(
        tx,
        id,
        'encerrada',
        d.nota ? `Encerrada: ${d.nota}` : 'Encerrada.',
        'utilizador',
        u.id,
      );
    });
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'encerrar_reclamacao',
      objetoTipo: 'reclamacao',
      objetoId: id,
    });
    return this.detalhe(m, id);
  }

  /** Anexo novo (folha digitalizada, foto): URL assinada para o browser enviar. */
  async pedirEnvioAnexo(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaAnexo>,
  ) {
    await this.porId(this.db, m.id, id);
    if (!this.armazenamento.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'armazenamento_indisponivel',
        'O armazenamento de ficheiros não está configurado nesta instalação.',
      );
    }
    const mime = d.mime.toLowerCase();
    const extensao = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
    const chave = this.armazenamento.chave(m.slug, 'documentos', extensao);
    const url = await this.armazenamento.urlEnvio(chave, mime);
    const [a] = await this.db.query<{ id: string }>(
      `INSERT INTO reclamacao_anexos (municipio_id, reclamacao_id, nome, mime, ficheiro_key, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.id, id, d.nome, mime, chave, u.id],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'acrescentar_anexo_reclamacao',
      objetoTipo: 'reclamacao',
      objetoId: id,
      dados: { anexo_id: a.id, nome: d.nome },
    });
    return { anexo_id: a.id, url_envio: url, mime };
  }

  // ------------------------------------------------------------------
  // Página pública (link do SMS)
  // ------------------------------------------------------------------

  async publico(codigo: string) {
    const c = codigo.trim().toUpperCase();
    const [l] = /^[A-Z0-9]{10}$/.test(c)
      ? await this.db.query<Linha>(`${SELECT} WHERE r.codigo_publico = $1`, [c])
      : [];
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'reclamacao_desconhecida',
        'Não há nenhuma reclamação com este código.',
      );
    }
    const [municipio, feriados] = await Promise.all([
      this.municipios.porId(l.municipio_id),
      this.municipios.feriados(l.municipio_id),
    ]);
    const prazo = situacaoPrazo(
      { ...l, respondida_em: l.respondida_dia },
      hojeLisboa(),
      l.config_usada.aviso_dias_uteis,
      feriados,
    );
    const eventos = await this.db.query<{ tipo: string; criado_em: Date }>(
      `SELECT tipo, criado_em FROM reclamacao_eventos WHERE reclamacao_id = $1
       AND tipo IN ('recebida','atribuida','respondida','encerrada') ORDER BY criado_em`,
      [l.id],
    );
    return {
      numero: l.numero,
      municipio: municipio.nome,
      estado: l.estado,
      estado_nome: NOMES_ESTADO[l.estado],
      canal: NOMES_CANAL[l.canal],
      nome: abreviarNome(l.nome),
      servico: l.servico ?? l.servico_visado,
      descricao: l.descricao,
      pedido: l.pedido,
      recebida_em: l.recebida_em,
      responder_ate: l.responder_ate,
      prazo_dias_uteis: l.prazo_dias_uteis,
      prazo,
      resposta: l.resposta,
      respondida_em: l.respondida_em?.toISOString() ?? null,
      encerrada_em: l.encerrada_em?.toISOString() ?? null,
      passos: {
        recebida: l.criada_em.toISOString(),
        em_analise:
          eventos
            .find((e) => e.tipo === 'atribuida')
            ?.criado_em.toISOString() ?? null,
        respondida: l.respondida_em?.toISOString() ?? null,
        encerrada: l.encerrada_em?.toISOString() ?? null,
      },
      fonte: l.config_usada.fonte.titulo,
      prazo_de_demonstracao: l.config_usada.demonstracao,
    };
  }

  // ------------------------------------------------------------------
  // Avisos internos (trabalho diário)
  // ------------------------------------------------------------------

  /**
   * As reclamações abertas a `aviso_dias_uteis` (ou menos) da data-limite e
   * as em atraso, num email por responsável: quem a tem atribuída (ou o
   * email do serviço), os destinatários da config e, se não houver
   * ninguém, as chefias da câmara. Uma vez por dia (chave de idempotência).
   */
  async avisar(
    agora = new Date(),
  ): Promise<{ emails: number; reclamacoes: number }> {
    const hoje = hojeLisboa(agora);
    const abertas = await this.db.query<
      Linha & {
        atribuida_email: string | null;
        servico_email: string | null;
        municipio_nome: string;
        municipio_cfg: unknown;
      }
    >(
      `SELECT x.*, ua.email::text AS atribuida_email, s.email::text AS servico_email,
              mu.nome AS municipio_nome, mu.reclamacoes_config AS municipio_cfg
       FROM (${SELECT} WHERE r.estado IN ('recebida','em_analise')) x
       JOIN municipios mu ON mu.id = x.municipio_id
       LEFT JOIN utilizadores ua ON ua.id = x.atribuida_a AND ua.ativo
       LEFT JOIN servicos s ON s.id = x.servico_id
       ORDER BY x.responder_ate`,
    );
    let emails = 0;
    let total = 0;
    const porMunicipio = new Map<string, typeof abertas>();
    for (const r of abertas) {
      porMunicipio.set(r.municipio_id, [
        ...(porMunicipio.get(r.municipio_id) ?? []),
        r,
      ]);
    }
    for (const [municipioId, lista] of porMunicipio) {
      const cfg = lerConfig(lista[0].municipio_cfg);
      const feriados = await this.municipios.feriados(municipioId);
      const urgentes = lista
        .map((r) => ({
          r,
          p: situacaoPrazo(
            { ...r, respondida_em: null },
            hoje,
            cfg.aviso_dias_uteis,
            feriados,
          ),
        }))
        .filter((x) => precisaAviso(x.p));
      if (!urgentes.length) continue;
      total += urgentes.length;
      let chefias: { email: string; nome: string }[] | null = null;
      const destinos = new Map<
        string,
        { nome: string; itens: typeof urgentes }
      >();
      const juntar = (email: string, nome: string, x: (typeof urgentes)[0]) => {
        const k = email.toLowerCase();
        const d = destinos.get(k) ?? { nome, itens: [] };
        if (!d.itens.includes(x)) d.itens.push(x);
        destinos.set(k, d);
      };
      for (const x of urgentes) {
        const responsavel = x.r.atribuida_email ?? x.r.servico_email;
        if (responsavel) {
          juntar(responsavel, x.r.atribuida_a_nome ?? x.r.servico ?? '', x);
        }
        for (const d of cfg.destinatarios_avisos) juntar(d.email, d.nome, x);
        if (!responsavel && !cfg.destinatarios_avisos.length) {
          chefias ??= await this.db.query<{ email: string; nome: string }>(
            `SELECT email::text AS email, nome FROM utilizadores
             WHERE municipio_id = $1 AND ativo AND perfil = 'chefe_divisao'`,
            [municipioId],
          );
          for (const c of chefias) juntar(c.email, c.nome, x);
        }
      }
      const web = this.config.get<string>('app.webUrl') ?? '';
      for (const [email, d] of destinos) {
        const atraso = d.itens.filter((x) => x.p.situacao === 'em_atraso');
        const assunto = `Reclamações: ${atraso.length ? `${atraso.length} em atraso` : ''}${atraso.length && d.itens.length > atraso.length ? ' e ' : ''}${d.itens.length > atraso.length ? `${d.itens.length - atraso.length} a terminar o prazo` : ''}`;
        const texto = [
          `Reclamações da Câmara Municipal de ${lista[0].municipio_nome} que precisam de resposta:`,
          '',
          ...d.itens.map(
            (x) =>
              `- ${x.r.numero} (${x.r.nome ?? 'sem nome'}): ${
                x.p.situacao === 'em_atraso'
                  ? `EM ATRASO desde ${dataPorExtenso(x.r.responder_ate)}`
                  : x.p.situacao === 'termina_hoje'
                    ? 'o prazo termina hoje'
                    : `responder até ${dataPorExtenso(x.r.responder_ate)} (${x.p.dias_uteis_restantes} dia${x.p.dias_uteis_restantes === 1 ? '' : 's'} úte${x.p.dias_uteis_restantes === 1 ? 'il' : 'is'})`
              }${x.r.servico ? ` · ${x.r.servico}` : ''}`,
          ),
          '',
          `Responder no painel: ${web}/painel/reclamacoes`,
          cfg.demonstracao
            ? '\nO prazo de resposta é um valor de demonstração, a confirmar com o jurista da câmara.'
            : '',
        ].join('\n');
        const enviado = await this.registarEEnviarEmail(
          municipioId,
          email,
          `reclamacoes_aviso:${municipioId}:${hoje}:${email}`,
          { aviso: 'reclamacoes', dia: hoje },
          assunto,
          `Olá${d.nome ? ` ${d.nome}` : ''},\n\n${texto}`,
        );
        if (enviado) emails++;
      }
    }
    return { emails, reclamacoes: total };
  }

  // ------------------------------------------------------------------

  private async inserir(
    tx: Tx,
    m: Municipio,
    config: ConfigReclamacoes,
    n: NovaReclamacao,
  ) {
    const feriados = await this.municipios.feriados(m.id);
    const responderAte = calcularPrazo(
      n.recebida_em,
      config.prazo_dias_uteis,
      feriados,
    );
    const ano = Number(n.recebida_em.slice(0, 4));
    const numero = `REC ${await proximoNumero(tx, m.id, 'REC', ano)}/${ano}`;
    const codigo = Array.from(
      { length: 10 },
      () => ALFABETO[randomInt(ALFABETO.length)],
    ).join('');
    const [r] = await tx.query<{ id: string }>(
      `INSERT INTO reclamacoes (municipio_id, numero, codigo_publico, municipe_id, conversa_id,
         email_id, canal, nome, telefone, email, resposta_por, servico_visado, servico_id,
         descricao, pedido, estado, recebida_em, prazo_dias_uteis, responder_ate, config_usada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
         CASE WHEN $13::uuid IS NULL THEN 'recebida' ELSE 'em_analise' END,
         $16,$17,$18,$19)
       RETURNING id`,
      [
        m.id,
        numero,
        codigo,
        n.municipe_id,
        n.conversa_id,
        n.email_id,
        n.canal,
        n.nome,
        n.telefone,
        n.email,
        n.resposta_por,
        n.servico_visado,
        n.servico_id,
        n.descricao,
        n.pedido,
        n.recebida_em,
        config.prazo_dias_uteis,
        responderAte,
        JSON.stringify(config),
      ],
    );
    for (const a of n.anexos) {
      await tx.query(
        `INSERT INTO reclamacao_anexos (municipio_id, reclamacao_id, nome, mime, criado_por)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          m.id,
          r.id,
          a.nome,
          a.mime,
          n.ator.tipo === 'utilizador' ? n.ator.id : null,
        ],
      );
    }
    await this.evento(
      tx,
      r.id,
      'recebida',
      `Reclamação recebida por ${NOMES_CANAL[n.canal]}. Prazo de resposta: ${config.prazo_dias_uteis} dias úteis, até ${dataPorExtenso(responderAte)}${config.demonstracao ? ' (prazo de demonstração)' : ''}.`,
      n.ator.tipo,
      n.ator.id,
    );
    if (n.ator.tipo === 'agente') {
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'registar_reclamacao',
          objetoTipo: 'reclamacao',
          objetoId: r.id,
          dados: { numero, canal: n.canal },
        },
        tx,
      );
    }
    const url = this.url(codigo);
    if (n.telefone) {
      await this.mensagens.sms(
        {
          municipioId: m.id,
          municipeId: n.municipe_id,
          destino: n.telefone,
          motivo: 'reclamacao',
          corpo: smsRegisto(m.nome, numero, responderAte, url),
          relacionado: { reclamacao_id: r.id },
          chave: `reclamacao_registo:${r.id}`,
        },
        tx,
      );
    }
    // Sem telemóvel, o aviso vai por email, depois do commit (ver posRegisto).
    const emailRegisto =
      !n.telefone && n.email
        ? {
            para: n.email,
            chave: `reclamacao_registo:${r.id}`,
            assunto: `Reclamação ${numero} registada`,
            texto: `${smsRegisto(m.nome, numero, responderAte, url)}\n\nCâmara Municipal de ${m.nome}`,
          }
        : null;
    return {
      id: r.id,
      numero,
      codigo,
      responder_ate: responderAte,
      emailRegisto,
    };
  }

  /** Depois do commit: o email de registo (quando não há telemóvel). */
  private async posRegisto(
    municipioId: string,
    r: Awaited<ReturnType<ReclamacoesService['inserir']>>,
  ) {
    if (!r.emailRegisto) return;
    const e = r.emailRegisto;
    await this.registarEEnviarEmail(
      municipioId,
      e.para,
      e.chave,
      { reclamacao_id: r.id },
      e.assunto,
      e.texto,
    );
  }

  private async enviarEmailMunicipe(
    m: Municipio,
    l: Linha,
    chave: string,
    assunto: string,
    texto: string,
  ) {
    if (!l.email) return;
    await this.registarEEnviarEmail(
      m.id,
      l.email,
      chave,
      { reclamacao_id: l.id },
      assunto,
      texto,
    );
  }

  /** Grava em mensagens_saida (canal email) e envia, uma vez por chave. */
  private async registarEEnviarEmail(
    municipioId: string,
    para: string,
    chave: string,
    relacionado: Record<string, string>,
    assunto: string,
    texto: string,
  ): Promise<boolean> {
    const [msg] = await this.db.query<{ id: string; estado: string }>(
      `INSERT INTO mensagens_saida (municipio_id, canal, destino, motivo, corpo, relacionado, chave_idempotencia)
       VALUES ($1, 'email', $2, 'reclamacao', $3, $4, $5)
       ON CONFLICT (chave_idempotencia) DO UPDATE SET chave_idempotencia = EXCLUDED.chave_idempotencia
       RETURNING id, estado::text AS estado`,
      [municipioId, para, texto, JSON.stringify(relacionado), chave],
    );
    if (msg.estado === 'enviada' || msg.estado === 'entregue') return false;
    try {
      await this.mensagens.email({ para, assunto, texto });
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'enviada', enviada_em = now(), erro = NULL WHERE id = $1`,
        [msg.id],
      );
      return true;
    } catch (e) {
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'falhou', erro = $2 WHERE id = $1`,
        [msg.id, (e as Error).message],
      );
      this.logger.error(`Email de reclamação falhou: ${(e as Error).message}`);
      return false;
    }
  }

  private async evento(
    tx: Tx,
    reclamacaoId: string,
    tipo: string,
    descricao: string,
    atorTipo: 'agente' | 'utilizador' | 'sistema' | 'municipe',
    atorId: string | null,
  ) {
    await tx.query(
      `INSERT INTO reclamacao_eventos (reclamacao_id, tipo, descricao, ator_tipo, ator_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [reclamacaoId, tipo, descricao, atorTipo, atorId],
    );
  }

  private async servico(municipioId: string, id: string) {
    const [s] = await this.db.query<{ id: string; nome: string }>(
      'SELECT id, nome FROM servicos WHERE municipio_id = $1 AND id = $2',
      [municipioId, id],
    );
    if (!s) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'servico_desconhecido',
        'Este serviço não existe nesta câmara.',
      );
    }
    return s;
  }

  private async porId(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    id: string,
    bloquear = false,
  ): Promise<Linha> {
    if (bloquear) {
      await q.query('SELECT 1 FROM reclamacoes WHERE id = $1 FOR UPDATE', [id]);
    }
    const [l] = await q.query<Linha>(
      `${SELECT} WHERE r.id = $1 AND r.municipio_id = $2`,
      [id, municipioId],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'reclamacao_desconhecida',
        'Esta reclamação não existe.',
      );
    }
    return l;
  }

  private url(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/reclamacao/${codigo}`;
  }

  private paraPainel(l: Linha, hoje: string, feriados: ReadonlySet<string>) {
    return {
      id: l.id,
      numero: l.numero,
      codigo_publico: l.codigo_publico,
      canal: l.canal,
      canal_nome: NOMES_CANAL[l.canal],
      estado: l.estado,
      nome: l.nome,
      telefone: l.telefone,
      email: l.email,
      resposta_por: l.resposta_por,
      servico_visado: l.servico_visado,
      servico_id: l.servico_id,
      servico: l.servico,
      atribuida_a: l.atribuida_a,
      atribuida_a_nome: l.atribuida_a_nome,
      descricao: l.descricao,
      pedido: l.pedido,
      recebida_em: l.recebida_em,
      prazo_dias_uteis: l.prazo_dias_uteis,
      responder_ate: l.responder_ate,
      prazo: situacaoPrazo(
        { ...l, respondida_em: l.respondida_dia },
        hoje,
        l.config_usada.aviso_dias_uteis,
        feriados,
      ),
      prazo_de_demonstracao: l.config_usada.demonstracao,
      resposta: l.resposta,
      respondida_em: l.respondida_em?.toISOString() ?? null,
      respondida_por_nome: l.respondida_por_nome,
      encerrada_em: l.encerrada_em?.toISOString() ?? null,
      nota_encerramento: l.nota_encerramento,
      conversa_id: l.conversa_id,
      email_id: l.email_id,
      criada_em: l.criada_em.toISOString(),
    };
  }
}

function erroContacto(mensagem: string) {
  return new ErroApi(HttpStatus.BAD_REQUEST, 'falta_contacto', mensagem);
}

function jaEncerrada() {
  return new ErroApi(
    HttpStatus.CONFLICT,
    'ja_encerrada',
    'Esta reclamação já está encerrada.',
  );
}

/** "Ana Sousa <ana@x.pt>" → "Ana Sousa"; "ana.sousa@x.pt" → "ana.sousa". */
function nomeDoEmail(de: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(de);
  const nome = (m?.[1] ?? de.split('@')[0]).trim();
  return nome.length >= 2 ? nome.slice(0, 120) : 'Remetente do email';
}

/** "Ana Sousa <ana@x.pt>" → "ana@x.pt". */
function enderecoDoEmail(de: string): string {
  return (/<([^>]+)>/.exec(de)?.[1] ?? de).trim();
}

/** "Maria Silva" → "Maria S." (a página é pública). */
function abreviarNome(nome: string | null): string | null {
  if (!nome) return null;
  const p = nome.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
}
