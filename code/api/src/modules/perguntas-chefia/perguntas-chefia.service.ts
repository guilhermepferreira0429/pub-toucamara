import Anthropic from '@anthropic-ai/sdk';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { z } from 'zod';
import type { Feriados } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { iaConfig } from '../../config/configuration.js';
import { DatabaseService } from '../../database/database.service.js';
import type { AbrirFluxo } from '../../ia/agente-chat.js';
import { tokensDe } from '../../ia/precos.js';
import { UsoIaService } from '../../ia/uso-ia.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LimitePedidos } from '../chat/limite.js';
import { MelhoriasService } from '../conhecimento/melhorias.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { PainelDadosService } from '../painel/painel-dados.service.js';
import { hojeNoFuso } from '../painel/periodos.js';
import { ferramentasApi, POR_NOME } from './catalogo.js';
import type { ContextoConsulta, ResultadoConsulta } from './consulta.js';
import { correrPergunta, EventoPergunta, FimPergunta } from './loop.js';
import { mensagemPergunta, SISTEMA_PERGUNTAS, TEXTO_FIM } from './prompt.js';
import {
  ConsultaGuardada,
  esquemaResponder,
  publica,
  resolverResposta,
  Resolucao,
  RespostaFinal,
} from './resposta.js';

/** Como acabou, no histórico: o fim do loop, 'sem_dados' ou 'erro'. */
export type FimGuardado = FimPergunta | 'sem_dados' | 'erro';

export interface RespostaPergunta extends RespostaFinal {
  id: string;
  pergunta: string;
  fim: FimGuardado;
  ms: number;
  criada_em: Date;
}

export const esquemaPergunta = z.object({
  pergunta: z.string().trim().min(3).max(500),
});

// 30 perguntas por utilizador por hora (em memória, por instância).
const LIMITE_HORA = 30;

/** Uma consulta não deve demorar mais do que isto (a BD corta). */
const TEMPO_MAXIMO_CONSULTA = '5s';

/**
 * Perguntas da chefia em linguagem normal: o Claude com um conjunto fechado
 * de consultas de SQL fixo (catalogo.ts). O município é sempre o do pedido,
 * cada consulta corre numa transação só de leitura e os números da resposta
 * saem dos resultados guardados aqui, não do texto do modelo.
 */
@Injectable()
export class PerguntasChefiaService {
  private readonly logger = new Logger(PerguntasChefiaService.name);
  private readonly modelo: string;
  /** Abre um pedido ao modelo em streaming; null sem IA (os testes trocam-no). */
  abrirFluxo: AbrirFluxo | null;
  private readonly limite = new LimitePedidos(LIMITE_HORA, 60 * 60_000);

  constructor(
    config: ConfigService,
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
    private readonly auditoria: AuditoriaService,
    private readonly melhorias: MelhoriasService,
    @Optional() private readonly uso?: UsoIaService,
  ) {
    const cfg = config.getOrThrow<ConfigType<typeof iaConfig>>('ia');
    this.modelo = cfg.modelo;
    const cliente = cfg.apiKey ? new Anthropic({ apiKey: cfg.apiKey }) : null;
    this.abrirFluxo = cliente
      ? (params, sinal) => {
          const fluxo = cliente.beta.messages.stream(params, { signal: sinal });
          // Cada volta terminada fica no registo de uso (no município do pedido).
          return {
            [Symbol.asyncIterator]: () => fluxo[Symbol.asyncIterator](),
            finalMessage: async () => {
              const m = await fluxo.finalMessage();
              void this.uso?.registar({
                tarefa: 'perguntas_painel',
                modelo: m.model || this.modelo,
                resultado: m.stop_reason === 'refusal' ? 'recusa' : 'ok',
                tokens: tokensDe(m.usage),
              });
              return m;
            },
          };
        }
      : null;
  }

  /**
   * O que pode falhar antes de começar (e antes de abrir o SSE): IA ligada e
   * dentro do limite. Conta a pergunta.
   */
  preparar(u: UtilizadorPainel): void {
    if (!this.abrirFluxo) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'As perguntas ao painel precisam de IA, que não está configurada.',
      );
    }
    if (!this.limite.permitir(u.id)) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiados_pedidos',
        `Já fez ${LIMITE_HORA} perguntas na última hora. Tente daqui a pouco.`,
      );
    }
  }

  async perguntar(
    m: Municipio,
    u: UtilizadorPainel,
    pergunta: string,
    o: {
      emitir?: (e: EventoPergunta) => void;
      sinal?: AbortSignal;
      ip?: string | null;
    } = {},
  ): Promise<RespostaPergunta> {
    const inicio = Date.now();
    const hoje = hojeNoFuso(m.fuso);
    const feriados = await this.municipios.feriados(m.id);
    const guardadas: ConsultaGuardada[] = [];

    let resposta: RespostaFinal;
    let fim: FimGuardado;
    let tokens: number | null = null;
    let falha: ErroApi | null = null;
    try {
      const r = await correrPergunta({
        abrir: this.abrir(),
        modelo: this.modelo,
        sistema: [
          {
            type: 'text',
            text: SISTEMA_PERGUNTAS,
            cache_control: { type: 'ephemeral' },
          },
        ],
        ferramentas: ferramentasApi(),
        mensagem: mensagemPergunta({
          pergunta,
          hoje,
          municipio: m.nome,
          fuso: m.fuso,
        }),
        consultar: (nome, entrada, aComecar) =>
          this.consultar(m, hoje, feriados, guardadas, nome, entrada, aComecar),
        responder: (entrada) =>
          this.responder(entrada, { pergunta, hoje, consultas: guardadas }),
        emitir: o.emitir ?? (() => undefined),
        sinal: o.sinal ?? new AbortController().signal,
        esforco: 'medium',
      });
      tokens = r.tokens;
      resposta = r.resposta ?? semResposta(r.fim, guardadas);
      fim = r.fim === 'concluido' && resposta.sem_dados ? 'sem_dados' : r.fim;
    } catch (e) {
      falha = erroIa(e, this.logger);
      resposta = semResposta('limite', guardadas);
      resposta.resposta = falha.message;
      fim = 'erro';
    }

    const ms = Date.now() - inicio;
    const guardada = await this.gravar(
      m,
      u,
      pergunta,
      resposta,
      fim,
      tokens,
      ms,
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'perguntar',
      objetoTipo: 'pergunta_chefia',
      objetoId: guardada.id,
      dados: {
        pergunta,
        fim,
        consultas: resposta.consultas.map((c) => c.ferramenta),
      },
      ip: o.ip ?? null,
    });
    if (falha) throw falha;
    return {
      id: guardada.id,
      pergunta,
      ...resposta,
      fim,
      ms,
      criada_em: guardada.criada_em,
    };
  }

  async historico(m: Municipio, u: UtilizadorPainel, query: unknown) {
    const { limite, cursor } = validar(esquemaPaginacao, query ?? {});
    const linhas = await this.db.query<{
      id: string;
      pergunta: string;
      resposta: Omit<RespostaFinal, 'consultas'>;
      consultas: RespostaFinal['consultas'];
      fim: FimGuardado;
      ms: number | null;
      criada_em: Date;
    }>(
      `SELECT id, pergunta, resposta, consultas, fim, ms, criada_em
       FROM perguntas_chefia
       WHERE municipio_id = $1 AND utilizador_id = $2
         AND ($3::timestamptz IS NULL OR (criada_em, id) < ($3, $4::uuid))
       ORDER BY criada_em DESC, id DESC
       LIMIT $5`,
      [m.id, u.id, cursor?.em ?? null, cursor?.id ?? null, limite + 1],
    );
    const r = pagina(linhas, limite, (l) => ({ em: l.criada_em, id: l.id }));
    return {
      itens: r.itens.map((l) => ({
        id: l.id,
        pergunta: l.pergunta,
        ...l.resposta,
        consultas: l.consultas,
        fim: l.fim,
        ms: l.ms,
        criada_em: l.criada_em,
      })),
      proximo_cursor: r.proximo_cursor,
    };
  }

  // ------------------------------------------------------------------

  /**
   * Corre uma consulta e guarda-a (por ordem de início: c1, c2...). Não
   * lança: o erro fica na consulta e volta ao modelo para corrigir.
   */
  private async consultar(
    m: Municipio,
    hoje: string,
    feriados: Feriados,
    guardadas: ConsultaGuardada[],
    nome: string,
    entrada: unknown,
    aComecar: (id: string) => void,
  ): Promise<ConsultaGuardada> {
    const c: ConsultaGuardada = {
      id: `c${guardadas.length + 1}`,
      ferramenta: nome,
      parametros: entrada,
      resultado: null,
      erro: null,
      ms: 0,
    };
    guardadas.push(c);
    aComecar(c.id);
    const t0 = Date.now();
    try {
      c.resultado = await this.executar(m, hoje, feriados, nome, entrada);
    } catch (e) {
      if (e instanceof ErroApi) {
        c.erro = {
          codigo: e.codigo,
          mensagem: e.message,
          ...(e.detalhes !== undefined ? { detalhes: e.detalhes } : {}),
        };
      } else {
        this.logger.error(`Consulta ${nome} falhou: ${(e as Error).message}`);
        c.erro = {
          codigo: 'erro_interno',
          mensagem:
            'A consulta falhou. Não tentes outra vez; diz que este número não está disponível agora.',
        };
      }
    }
    c.ms = Date.now() - t0;
    return c;
  }

  /**
   * Valida os parâmetros e corre a consulta numa transação só de leitura,
   * com tempo máximo. O município é sempre `m`: as consultas não têm
   * parâmetro de município e o `.strict()` recusa chaves a mais.
   */
  async executar(
    m: Municipio,
    hoje: string,
    feriados: Feriados,
    nome: string,
    entrada: unknown,
  ): Promise<ResultadoConsulta> {
    const consulta = POR_NOME.get(nome);
    if (!consulta) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'consulta_desconhecida',
        `Não existe a consulta "${nome}".`,
      );
    }
    const v = consulta.entrada.safeParse(entrada);
    if (!v.success) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'parametros_invalidos',
        v.error.issues
          .map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`)
          .join('; '),
      );
    }
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      await tx.query(
        `SET LOCAL statement_timeout = '${TEMPO_MAXIMO_CONSULTA}'`,
      );
      const ctx: ContextoConsulta = {
        municipio: m,
        hoje,
        feriados,
        db: tx,
        // As leituras das vistas do painel, mas dentro desta transação.
        painel: new PainelDadosService(tx as unknown as DatabaseService),
        melhorias: this.melhorias,
      };
      return consulta.executar(ctx, v.data);
    });
  }

  private responder(
    entrada: unknown,
    ctx: { pergunta: string; hoje: string; consultas: ConsultaGuardada[] },
  ): Resolucao {
    const v = esquemaResponder.safeParse(entrada);
    if (!v.success) {
      return {
        ok: false,
        erros: v.error.issues.map(
          (i) => `${i.path.join('.') || 'entrada'}: ${i.message}`,
        ),
      };
    }
    const r = resolverResposta(v.data, ctx);
    if (r.ok && !r.resposta.texto_verificado) {
      this.logger.warn(
        `Texto com números fora das consultas, trocado: "${v.data.resposta}"`,
      );
    }
    return r;
  }

  private async gravar(
    m: Municipio,
    u: UtilizadorPainel,
    pergunta: string,
    resposta: RespostaFinal,
    fim: FimGuardado,
    tokens: number | null,
    ms: number,
  ) {
    const { consultas, ...resto } = resposta;
    const [l] = await this.db.query<{ id: string; criada_em: Date }>(
      `INSERT INTO perguntas_chefia
         (municipio_id, utilizador_id, pergunta, resposta, consultas, fim, tokens, ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, criada_em`,
      [
        m.id,
        u.id,
        pergunta,
        JSON.stringify(resto),
        JSON.stringify(consultas),
        fim,
        tokens,
        ms,
      ],
    );
    return l;
  }

  private abrir(): AbrirFluxo {
    if (!this.abrirFluxo) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'As perguntas ao painel precisam de IA, que não está configurada.',
      );
    }
    return this.abrirFluxo;
  }
}

/** Sem resposta do modelo: o texto do fim e as consultas que chegaram a correr. */
export function semResposta(
  fim: FimPergunta,
  consultas: readonly ConsultaGuardada[],
): RespostaFinal {
  return {
    resposta: fim === 'concluido' ? TEXTO_FIM.limite : TEXTO_FIM[fim],
    numeros_chave: [],
    tabela: null,
    consultas: consultas.map(publica),
    sugestoes: [],
    sem_dados: false,
    texto_verificado: true,
  };
}

/** Erros do fornecedor: 503 (tentar depois) ou 502 (o nosso pedido). */
export function erroIa(e: unknown, logger?: Logger): ErroApi {
  if (e instanceof ErroApi) return e;
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.InternalServerError ||
    e instanceof Anthropic.APIConnectionError
  ) {
    logger?.warn(`IA indisponível: ${e.message}`);
    return new ErroApi(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ia_indisponivel',
      'A IA está indisponível. Tente daqui a pouco.',
    );
  }
  if (e instanceof Anthropic.APIError) {
    logger?.error(`IA ${e.status}: ${e.message}`);
    return new ErroApi(
      HttpStatus.BAD_GATEWAY,
      'ia_erro',
      'O pedido à IA falhou.',
    );
  }
  logger?.error(`Pergunta falhou: ${(e as Error).message}`);
  return new ErroApi(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'erro_interno',
    'Não foi possível responder à pergunta.',
  );
}
