import Anthropic from '@anthropic-ai/sdk';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import { iaConfig } from '../../config/configuration.js';
import { DatabaseService } from '../../database/database.service.js';
import { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { AbrirFluxo, correrTurno, EventoAgente } from '../../ia/agente-chat.js';
import { segredoIgual } from '../agent-tools/agente.guard.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { quandoFalado } from '../conversas/retomar.js';
import { RetomarService } from '../conversas/retomar.service.js';
import {
  mascararTelefone,
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { Cartao, cartaoDe, trechosDe } from './chat.cartoes.js';
import { mensagensDoHistorico, TurnoGuardado } from './chat.historico.js';
import {
  blocoMunicipio,
  contextoSessao,
  SAUDACAO_OMISSAO,
  SISTEMA_CHAT,
  TEXTO_LIMITE,
  TEXTO_RECUSA,
} from './chat.prompt.js';
import { LimitePedidos } from './limite.js';

/** Uma sessão de chat aberta (a conversa canal 'chat' do token). */
export interface Sessao {
  conversaId: string;
  municipio: Municipio;
  municipeId: string | null;
  telefone: string | null;
  iniciadaEm: Date;
}

/** O que o turno manda para o browser (eventos SSE). */
export type SaidaChat =
  | { evento: 'texto'; dados: { texto: string } }
  | { evento: 'ferramenta'; dados: { nome: string } }
  | { evento: 'cartao'; dados: Cartao }
  | { evento: 'fim'; dados: { turno_id: string | null } }
  | { evento: 'erro'; dados: { codigo: string; mensagem: string } };

interface ConfigAgenteLinha {
  nome: string;
  saudacao: string;
  trata_por: string;
  idiomas: string[];
  versao: string;
}

const VALIDADE_SESSAO_H = 24;
const VALIDADE_CODIGO_MIN = 10;
const MAX_TENTATIVAS = 5;

/**
 * O mesmo agente por texto: sessões anónimas, mensagens com o Claude em
 * streaming e as ferramentas do RegistoFerramentas, identificação por SMS.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly cliente: Anthropic | null;
  private readonly modelo: string;
  private ferramentasApi: Anthropic.Beta.BetaToolUnion[] | null = null;

  // 30 mensagens / 10 min por sessão; 20 sessões / 10 min por IP;
  // 3 SMS de código / 10 min por sessão e 5 / hora por número.
  private readonly limiteMensagens = new LimitePedidos(30, 10 * 60_000);
  private readonly limiteSessoes = new LimitePedidos(20, 10 * 60_000);
  private readonly limiteSmsSessao = new LimitePedidos(3, 10 * 60_000);
  private readonly limiteSmsNumero = new LimitePedidos(5, 60 * 60_000);
  /** Sessões com um turno a decorrer (um de cada vez). */
  private readonly ocupadas = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly registo: RegistoFerramentas,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly conversas: ConversasService,
    private readonly mensagens: MensagensService,
    private readonly retomar: RetomarService,
  ) {
    const cfg = config.getOrThrow<ConfigType<typeof iaConfig>>('ia');
    this.modelo = cfg.modelo;
    this.cliente = cfg.apiKey ? new Anthropic({ apiKey: cfg.apiKey }) : null;
  }

  // ------------------------------------------------------------------
  // Sessões
  // ------------------------------------------------------------------

  /** Pedido com o segredo do agente (o avaliador). Sem segredo configurado, nunca. */
  eAvaliador(segredo: string | undefined): boolean {
    const esperado = this.config.get<string>('agente.segredo') ?? '';
    return !!segredo && !!esperado && segredoIgual(segredo, esperado);
  }

  async criarSessao(args: {
    municipio: string;
    idioma?: string;
    ip?: string;
    /** Token da sessão anterior guardado no browser (retomar). */
    sessaoAnterior?: string;
  }): Promise<{
    sessao: string;
    saudacao: string;
    agente: string;
    retomada: boolean;
    municipio: { slug: string; nome: string };
  }> {
    if (args.ip && !this.limiteSessoes.permitir(args.ip)) {
      throw demasiados('Demasiadas sessões novas. Tente daqui a pouco.');
    }
    const municipio = await this.municipios.porSlug(args.municipio);
    const cfg = await this.configAgente(municipio.id);
    const token = randomBytes(24).toString('base64url');
    const { conversaId } = await this.conversas.garantir({
      municipioId: municipio.id,
      canal: 'chat',
      providerId: token,
    });
    const saudacao = cfg?.saudacao ?? SAUDACAO_OMISSAO;
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE conversas SET idioma = coalesce($2, idioma), agente_versao = $3
         WHERE id = $1`,
        [conversaId, args.idioma ?? null, cfg?.versao ?? null],
      );
      await tx.query(
        `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto)
         VALUES ($1, 0, 'agente', $2)`,
        [conversaId, saudacao],
      );
    });
    const retomada = args.sessaoAnterior
      ? await this.retomar.continuarChat(
          conversaId,
          municipio.id,
          args.sessaoAnterior,
        )
      : false;
    return {
      sessao: token,
      saudacao,
      agente: cfg?.nome ?? 'Tou, Câmara?',
      retomada,
      municipio: { slug: municipio.slug, nome: municipio.nome },
    };
  }

  /** A sessão do token. 404 se não existe; 410 se já expirou. */
  async sessao(token: string): Promise<Sessao> {
    const [c] = await this.db.query<{
      id: string;
      municipio_id: string;
      municipe_id: string | null;
      telefone_e164: string | null;
      iniciada_em: Date;
      terminada_em: Date | null;
    }>(
      `SELECT c.id, c.municipio_id, c.municipe_id, m.telefone_e164,
              c.iniciada_em, c.terminada_em
       FROM conversas c
       LEFT JOIN municipes m ON m.id = c.municipe_id
       WHERE c.provider_id = $1 AND c.canal = 'chat'`,
      [token],
    );
    if (!c) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sessao_desconhecida',
        'Sessão de chat não existe. Comece uma nova.',
      );
    }
    const limite = Date.now() - VALIDADE_SESSAO_H * 3_600_000;
    if (c.terminada_em || c.iniciada_em.getTime() < limite) {
      throw new ErroApi(
        HttpStatus.GONE,
        'sessao_expirada',
        'Esta sessão de chat terminou. Comece uma nova.',
      );
    }
    return {
      conversaId: c.id,
      municipio: await this.municipios.porId(c.municipio_id),
      municipeId: c.municipe_id,
      telefone: c.telefone_e164,
      iniciadaEm: c.iniciada_em,
    };
  }

  // ------------------------------------------------------------------
  // Mensagens
  // ------------------------------------------------------------------

  /**
   * Tudo o que pode falhar antes de abrir o SSE (sessão, limite, IA, turno
   * em curso): os erros saem como resposta JSON normal. Depois de chamar,
   * é obrigatório chamar `responder` (liberta a sessão).
   */
  async preparar(token: string): Promise<Sessao> {
    const sessao = await this.sessao(token);
    if (!this.cliente) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'O chat está indisponível de momento.',
      );
    }
    if (!this.limiteMensagens.permitir(sessao.conversaId)) {
      throw demasiados('Demasiadas mensagens seguidas. Aguarde um pouco.');
    }
    if (this.ocupadas.has(sessao.conversaId)) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sessao_ocupada',
        'Ainda estou a responder à mensagem anterior.',
      );
    }
    this.ocupadas.add(sessao.conversaId);
    return sessao;
  }

  /** Um turno: grava a mensagem, corre o agente e grava a resposta. */
  async responder(
    sessao: Sessao,
    texto: string,
    emitir: (s: SaidaChat) => void,
    sinal: AbortSignal,
  ): Promise<void> {
    try {
      await this.inserirTurno(sessao.conversaId, 'municipe', texto);
      const [cfg, turnos, anterior] = await Promise.all([
        this.configAgente(sessao.municipio.id),
        this.db.query<TurnoGuardado>(
          `SELECT papel, texto FROM conversa_turnos
           WHERE conversa_id = $1 ORDER BY ordem`,
          [sessao.conversaId],
        ),
        this.retomar.anteriorParaContexto(sessao.conversaId),
      ]);
      // A data falada conta a partir do início da sessão: o contexto não
      // muda de pedido para pedido (cache).
      const contexto = contextoSessao(
        dataLocal(sessao.iniciadaEm, sessao.municipio.fuso),
        anterior && {
          quando: quandoFalado(
            anterior.iniciada_em,
            sessao.iniciadaEm,
            sessao.municipio.fuso,
          ),
          resumo: anterior.resumo,
          proximos_passos: anterior.proximos_passos,
        },
      );
      const ctx: ContextoFerramenta = {
        municipio: sessao.municipio,
        canal: 'chat',
        conversaId: sessao.conversaId,
        municipeId: sessao.municipeId,
        telefone: sessao.telefone,
      };
      const trechos = new Set<string>();

      const r = await correrTurno({
        abrir: this.abrir(),
        modelo: this.modelo,
        sistema: [
          {
            type: 'text',
            text: SISTEMA_CHAT,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: blocoMunicipio({
              municipio: sessao.municipio.nome,
              nome: cfg?.nome ?? 'Tou, Câmara?',
              trata_por: cfg?.trata_por ?? 'você',
              idiomas: cfg?.idiomas ?? ['pt-PT'],
            }),
            cache_control: { type: 'ephemeral' },
          },
        ],
        ferramentas: this.ferramentas(),
        mensagens: mensagensDoHistorico(turnos, contexto),
        executar: (nome, entrada) => this.registo.executar(nome, ctx, entrada),
        emitir: (e: EventoAgente) => {
          if (e.tipo === 'texto') {
            emitir({ evento: 'texto', dados: { texto: e.texto } });
          } else if (e.tipo === 'ferramenta') {
            emitir({ evento: 'ferramenta', dados: { nome: e.nome } });
          } else {
            if (e.nome === 'procurar_conhecimento' && !e.erro) {
              trechosDe(e.resultado).forEach((t) => trechos.add(t));
            }
            const cartao = cartaoDe(e.nome, e.resultado, e.erro);
            if (cartao) emitir({ evento: 'cartao', dados: cartao });
          }
        },
        sinal,
        esforco: 'low',
      });

      if (r.fim === 'recusa') {
        emitir({
          evento: 'erro',
          dados: { codigo: 'ia_recusou', mensagem: TEXTO_RECUSA },
        });
        return;
      }
      let final = r.texto;
      if (r.fim === 'limite') {
        final = final ? `${final}\n\n${TEXTO_LIMITE}` : TEXTO_LIMITE;
        emitir({
          evento: 'texto',
          dados: { texto: r.texto ? `\n\n${TEXTO_LIMITE}` : TEXTO_LIMITE },
        });
      }
      // Interrompido sem texto: não fica turno do agente (o próximo pedido
      // segue com duas mensagens do munícipe seguidas, o que a API aceita).
      if (!final) {
        if (r.fim !== 'interrompido')
          emitir({ evento: 'fim', dados: { turno_id: null } });
        return;
      }
      const turnoId = await this.inserirTurno(
        sessao.conversaId,
        'agente',
        final,
      );
      if (trechos.size > 0) {
        await this.db.query(
          `INSERT INTO citacoes (turno_id, trecho_id)
           SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [turnoId, [...trechos]],
        );
      }
      emitir({ evento: 'fim', dados: { turno_id: turnoId } });
    } catch (e) {
      if (sinal.aborted) return;
      emitir({ evento: 'erro', dados: erroParaEvento(e, this.logger) });
    } finally {
      this.ocupadas.delete(sessao.conversaId);
    }
  }

  // ------------------------------------------------------------------
  // Identificação por SMS
  // ------------------------------------------------------------------

  /**
   * Manda um código de 6 dígitos por SMS (motivo 'identificacao'). Guarda só o hash; os códigos anteriores da sessão
   * deixam de valer.
   */
  async identificar(token: string, telefoneBruto: string) {
    const sessao = await this.sessao(token);
    const telefone = normalizarTelefone(telefoneBruto);
    if (!telefone) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'Número de telemóvel inválido.',
      );
    }
    if (
      !this.limiteSmsSessao.permitir(sessao.conversaId) ||
      !this.limiteSmsNumero.permitir(telefone)
    ) {
      throw demasiados('Já pediu vários códigos. Tente daqui a pouco.');
    }
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE chat_codigos SET expira_em = least(expira_em, now())
         WHERE conversa_id = $1 AND usado_em IS NULL`,
        [sessao.conversaId],
      );
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO chat_codigos (conversa_id, telefone_e164, codigo_hash, expira_em)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          sessao.conversaId,
          telefone,
          this.hashCodigo(sessao.conversaId, codigo),
          expiraEm,
        ],
      );
      await this.mensagens.sms(
        {
          municipioId: sessao.municipio.id,
          destino: telefone,
          motivo: 'identificacao',
          corpo: `${sessao.municipio.nome}: o seu código para o chat é ${codigo}. Válido ${VALIDADE_CODIGO_MIN} minutos. Não o partilhe.`,
          relacionado: { conversa_id: sessao.conversaId },
          chave: `chat_codigo:${c.id}`,
        },
        tx,
      );
    });
    return {
      enviado: true,
      telefone: mascararTelefone(telefone),
      expira_em: expiraEm.toISOString(),
    };
  }

  /** Confere o código e liga o munícipe (pelo número) à conversa. */
  async confirmar(token: string, codigo: string) {
    const sessao = await this.sessao(token);
    const r = await this.db.transaction(async (tx) => {
      const [c] = await tx.query<{
        id: string;
        telefone_e164: string;
        codigo_hash: Buffer;
        tentativas: number;
      }>(
        `SELECT id, telefone_e164, codigo_hash, tentativas FROM chat_codigos
         WHERE conversa_id = $1 AND usado_em IS NULL AND expira_em > now()
         ORDER BY criado_em DESC LIMIT 1
         FOR UPDATE`,
        [sessao.conversaId],
      );
      if (!c) return { estado: 'sem_codigo' as const };
      if (c.tentativas >= MAX_TENTATIVAS) {
        return { estado: 'esgotado' as const };
      }
      const certo = timingSafeEqual(
        c.codigo_hash,
        this.hashCodigo(sessao.conversaId, codigo),
      );
      if (!certo) {
        await tx.query(
          'UPDATE chat_codigos SET tentativas = tentativas + 1 WHERE id = $1',
          [c.id],
        );
        return {
          estado: 'errado' as const,
          restantes: MAX_TENTATIVAS - c.tentativas - 1,
        };
      }
      await tx.query('UPDATE chat_codigos SET usado_em = now() WHERE id = $1', [
        c.id,
      ]);
      const municipe = await this.municipes.porTelefone(
        sessao.municipio.id,
        c.telefone_e164,
        tx,
      );
      if (!municipe) return { estado: 'sem_codigo' as const };
      await this.conversas.ligarMunicipe(sessao.conversaId, municipe.id, tx);
      // Retomar: a última conversa deste munícipe (telefone ou chat) passa
      // a ir no contexto da primeira mensagem.
      await this.retomar.ligarUltimaDoMunicipe(sessao.conversaId, tx);
      return { estado: 'ok' as const, telefone: c.telefone_e164 };
    });

    // Os erros saem depois do COMMIT, para a tentativa falhada contar.
    if (r.estado === 'sem_codigo') {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'codigo_expirado',
        'Não há código válido. Peça um novo.',
      );
    }
    if (r.estado === 'esgotado') {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiadas_tentativas',
        'Código errado demasiadas vezes. Peça um novo.',
      );
    }
    if (r.estado === 'errado') {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'codigo_errado',
        'Código errado.',
        { tentativas_restantes: r.restantes },
      );
    }
    return { identificado: true, telefone: mascararTelefone(r.telefone) };
  }

  // ------------------------------------------------------------------

  private abrir(): AbrirFluxo {
    const cliente = this.cliente;
    if (!cliente) throw new Error('Sem cliente de IA.');
    return (params, sinal) =>
      cliente.beta.messages.stream(params, { signal: sinal });
  }

  /**
   * Todas as ferramentas do registo, já ordenadas (definições estáveis para
   * a cache). Calculadas uma vez, depois de os módulos as registarem.
   */
  private ferramentas(): Anthropic.Beta.BetaToolUnion[] {
    if (!this.ferramentasApi) {
      this.ferramentasApi = this.registo.catalogo().map((f) => {
        // O "$schema" do zod não faz falta à API.
        const esquema = { ...f.entrada };
        delete esquema.$schema;
        return {
          name: f.nome,
          description: f.descricao,
          input_schema: esquema as Anthropic.Beta.BetaTool.InputSchema,
          eager_input_streaming: true,
        };
      });
    }
    return this.ferramentasApi;
  }

  private async configAgente(
    municipioId: string,
  ): Promise<ConfigAgenteLinha | null> {
    const [c] = await this.db.query<ConfigAgenteLinha>(
      `SELECT nome, saudacao, trata_por, idiomas, versao
       FROM agente_config WHERE municipio_id = $1`,
      [municipioId],
    );
    return c ?? null;
  }

  private async inserirTurno(
    conversaId: string,
    papel: 'municipe' | 'agente',
    texto: string,
  ): Promise<string> {
    const [t] = await this.db.query<{ id: string }>(
      `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto)
       SELECT $1, coalesce(max(ordem) + 1, 0), $2, $3
       FROM conversa_turnos WHERE conversa_id = $1
       RETURNING id`,
      [conversaId, papel, texto],
    );
    return String(t.id);
  }

  private hashCodigo(conversaId: string, codigo: string): Buffer {
    const segredo =
      this.config.get<string>('app.dadosChave') || 'dev-codigos-chat';
    return createHmac('sha256', segredo)
      .update(`${conversaId}:${codigo}`)
      .digest();
  }
}

function demasiados(mensagem: string): ErroApi {
  return new ErroApi(
    HttpStatus.TOO_MANY_REQUESTS,
    'demasiados_pedidos',
    mensagem,
  );
}

/** 'segunda-feira, 19 de outubro de 2026, 10:30' no fuso do município. */
export function dataLocal(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: fuso,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(d);
}

/** Erros a meio do SSE: já não há estado HTTP, vai um evento `erro`. */
export function erroParaEvento(
  e: unknown,
  logger?: Logger,
): { codigo: string; mensagem: string } {
  if (e instanceof ErroApi) return { codigo: e.codigo, mensagem: e.message };
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.InternalServerError ||
    e instanceof Anthropic.APIConnectionError
  ) {
    logger?.warn(`IA indisponível no chat: ${e.message}`);
    return {
      codigo: 'ia_indisponivel',
      mensagem: 'O assistente está indisponível. Tente daqui a pouco.',
    };
  }
  if (e instanceof Anthropic.APIError) {
    logger?.error(`IA ${e.status} no chat: ${e.message}`);
    return { codigo: 'ia_erro', mensagem: 'Não foi possível responder agora.' };
  }
  logger?.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  return { codigo: 'erro_interno', mensagem: 'Erro interno.' };
}
