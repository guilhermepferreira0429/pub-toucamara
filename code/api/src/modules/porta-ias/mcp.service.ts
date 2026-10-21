import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  FERRAMENTAS_PESSOAIS,
  FERRAMENTAS_PUBLICAS,
  instrucoes,
  resumirPedido,
  SO_LEITURA,
  TITULOS,
} from './ferramentas-ia.js';
import {
  ePedido,
  erro,
  ERRO_METODO,
  ERRO_PARAMETROS,
  erroFerramenta,
  FerramentaMcp,
  MensagemJsonRpc,
  RespostaJsonRpc,
  resultado,
  resultadoFerramenta,
  versaoAcordada,
} from './mcp.js';
import { LigacaoIa, PortaIasService } from './porta-ias.service.js';

/** De onde vem o pedido MCP. */
export interface OrigemMcp {
  municipio: Municipio;
  ligacao: LigacaoIa | null;
  /** O header `Mcp-Session-Id`, se o cliente o mandou. */
  sessao: string | null;
  ip: string | null;
}

interface InfoSessao {
  cliente: string | null;
  conversaId: string | null;
  ate: number;
}

const VALIDADE_SESSAO_MS = 12 * 3_600_000;
const MAX_SESSOES = 5_000;

/**
 * A porta para as IAs: as mesmas ferramentas do agente pelo protocolo MCP.
 * Cada sessão MCP vira uma conversa (canal 'ia') e cada ferramenta chamada
 * fica no feed do painel.
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  /** Sessões em memória: só o nome do cliente e a conversa. Perder isto não parte nada. */
  private readonly sessoes = new Map<string, InfoSessao>();

  constructor(
    private readonly db: DatabaseService,
    private readonly registo: RegistoFerramentas,
    private readonly conversas: ConversasService,
    private readonly porta: PortaIasService,
  ) {}

  /** Responde a uma mensagem; null para notificações. Devolve a sessão nova no `initialize`. */
  async processar(
    origem: OrigemMcp,
    m: MensagemJsonRpc,
  ): Promise<{ resposta: RespostaJsonRpc | null; sessaoNova?: string }> {
    const id = m.id ?? null;
    const params = m.params ?? {};
    if (!ePedido(m)) return { resposta: null };

    switch (m.method) {
      case 'initialize': {
        const sessao = randomBytes(18).toString('base64url');
        const cliente = nomeCliente(params.clientInfo);
        this.guardarSessao(sessao, { cliente, conversaId: null });
        const pessoal = !!origem.ligacao;
        return {
          sessaoNova: sessao,
          resposta: resultado(id, {
            protocolVersion: versaoAcordada(params.protocolVersion),
            capabilities: { tools: { listChanged: false } },
            serverInfo: {
              name: `toucamara-${origem.municipio.slug}`,
              title: `Câmara Municipal de ${origem.municipio.nome} · Tou, Câmara?`,
              version: '1.0.0',
            },
            instructions: instrucoes(origem.municipio.nome, pessoal),
          }),
        };
      }
      case 'ping':
        return { resposta: resultado(id, {}) };
      case 'tools/list':
        return { resposta: resultado(id, { tools: this.ferramentas(origem) }) };
      case 'resources/list':
        return { resposta: resultado(id, { resources: [] }) };
      case 'prompts/list':
        return { resposta: resultado(id, { prompts: [] }) };
      case 'tools/call':
        return { resposta: await this.chamar(origem, id, params) };
      default:
        return {
          resposta: erro(id, ERRO_METODO, `Método não suportado: ${m.method}`),
        };
    }
  }

  /** As ferramentas que esta origem pode usar, em formato MCP. */
  ferramentas(origem: Pick<OrigemMcp, 'ligacao'>): FerramentaMcp[] {
    const permitidas = new Set<string>(
      origem.ligacao ? FERRAMENTAS_PESSOAIS : FERRAMENTAS_PUBLICAS,
    );
    return this.registo
      .catalogo()
      .filter((f) => permitidas.has(f.nome))
      .map((f) => {
        const esquema = { ...f.entrada };
        delete esquema.$schema;
        return {
          name: f.nome,
          title: TITULOS[f.nome],
          description: f.descricao,
          inputSchema: esquema,
          annotations: {
            readOnlyHint: SO_LEITURA.has(f.nome),
            destructiveHint: false,
            openWorldHint: false,
          },
        };
      });
  }

  private async chamar(
    origem: OrigemMcp,
    id: RespostaJsonRpc['id'],
    params: Record<string, unknown>,
  ): Promise<RespostaJsonRpc> {
    const nome = typeof params.name === 'string' ? params.name : '';
    const permitidas = new Set<string>(
      origem.ligacao ? FERRAMENTAS_PESSOAIS : FERRAMENTAS_PUBLICAS,
    );
    if (!permitidas.has(nome)) {
      const pessoal = (FERRAMENTAS_PESSOAIS as readonly string[]).includes(
        nome,
      );
      return erro(
        id,
        ERRO_PARAMETROS,
        pessoal
          ? `A ferramenta ${nome} precisa da chave pessoal: a pessoa liga o assistente em /ia no site da câmara.`
          : `Ferramenta desconhecida: ${nome || '(sem nome)'}`,
      );
    }
    const args =
      params.arguments &&
      typeof params.arguments === 'object' &&
      !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    const chaveLimite = origem.ligacao?.id ?? `ip:${origem.ip ?? '?'}`;
    if (!this.porta.limiteMcp.permitir(chaveLimite)) {
      return resultado(
        id,
        erroFerramenta(
          'demasiados_pedidos',
          'Demasiados pedidos seguidos. Aguarde um minuto.',
        ),
      );
    }

    const inicio = Date.now();
    const sessao = this.sessaoDe(origem);
    const conversaId = await this.conversa(origem, sessao);
    const ctx: ContextoFerramenta = {
      municipio: origem.municipio,
      canal: 'ia',
      conversaId,
      municipeId: origem.ligacao?.municipeId ?? null,
      telefone: origem.ligacao?.telefone ?? null,
    };

    let saida: unknown;
    let falha: { codigo: string; mensagem: string } | null = null;
    try {
      saida = await this.registo.executar(nome, ctx, args);
    } catch (e) {
      falha =
        e instanceof ErroApi
          ? { codigo: e.codigo, mensagem: e.message }
          : {
              codigo: 'erro_interno',
              mensagem: 'Erro interno. Tente outra vez daqui a pouco.',
            };
      if (!(e instanceof ErroApi)) {
        this.logger.error(
          e instanceof Error ? (e.stack ?? e.message) : String(e),
        );
      }
    }

    const resumo = falha
      ? `${TITULOS[nome] ?? nome}: ${falha.mensagem}`
      : resumirPedido(nome, args, saida);
    // O registo não pode estragar a resposta ao assistente.
    try {
      await this.porta.registarPedido({
        municipioId: origem.municipio.id,
        ligacaoId: origem.ligacao?.id ?? null,
        conversaId,
        cliente: sessao.info?.cliente ?? null,
        ferramenta: nome,
        ok: !falha,
        erroCodigo: falha?.codigo,
        resumo,
        duracaoMs: Date.now() - inicio,
      });
      if (conversaId)
        await this.turno(conversaId, sessao.info?.cliente ?? null, resumo);
    } catch (e) {
      this.logger.warn(
        `Pedido MCP por registar: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return resultado(
      id,
      falha
        ? erroFerramenta(falha.codigo, falha.mensagem)
        : resultadoFerramenta(saida),
    );
  }

  /** A sessão do header (ou uma por ligação/IP e por dia, para clientes sem sessão). */
  private sessaoDe(origem: OrigemMcp): {
    chave: string;
    info: InfoSessao | null;
  } {
    if (origem.sessao && /^[A-Za-z0-9_-]{8,64}$/.test(origem.sessao)) {
      const info = this.sessoes.get(origem.sessao);
      if (info && info.ate > Date.now()) return { chave: origem.sessao, info };
      return { chave: origem.sessao, info: null };
    }
    const dia = new Date().toISOString().slice(0, 10);
    const quem =
      origem.ligacao?.id ??
      createHash('sha256')
        .update(origem.ip ?? '?')
        .digest('base64url')
        .slice(0, 16);
    return { chave: `${quem}:${dia}`, info: null };
  }

  private async conversa(
    origem: OrigemMcp,
    sessao: { chave: string; info: InfoSessao | null },
  ): Promise<string | null> {
    if (sessao.info?.conversaId) return sessao.info.conversaId;
    const { conversaId } = await this.conversas.garantir({
      municipioId: origem.municipio.id,
      canal: 'ia',
      providerId: `mcp:${sessao.chave}`,
      telefone: origem.ligacao?.telefone ?? null,
    });
    if (sessao.info) sessao.info.conversaId = conversaId;
    else this.guardarSessao(sessao.chave, { cliente: null, conversaId });
    return conversaId;
  }

  /** Uma linha na conversa, para o painel a mostrar como as outras. */
  private async turno(
    conversaId: string,
    cliente: string | null,
    texto: string,
  ) {
    await this.db.query(
      `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto)
       SELECT $1, coalesce(max(ordem) + 1, 0), 'sistema', $2
       FROM conversa_turnos WHERE conversa_id = $1`,
      [
        conversaId,
        `${cliente ? `Assistente (${cliente})` : 'Assistente de IA'}: ${texto}`,
      ],
    );
  }

  private guardarSessao(chave: string, info: Omit<InfoSessao, 'ate'>) {
    if (this.sessoes.size >= MAX_SESSOES) {
      const agora = Date.now();
      for (const [k, v] of this.sessoes)
        if (v.ate < agora) this.sessoes.delete(k);
      if (this.sessoes.size >= MAX_SESSOES) {
        const [primeira] = this.sessoes.keys();
        if (primeira) this.sessoes.delete(primeira);
      }
    }
    this.sessoes.set(chave, { ...info, ate: Date.now() + VALIDADE_SESSAO_MS });
  }
}

function nomeCliente(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null;
  const nome = (info as Record<string, unknown>).name;
  return typeof nome === 'string' && nome.trim()
    ? nome.trim().slice(0, 80)
    : null;
}
