/*
 * O protocolo MCP (Model Context Protocol) pelo transporte "Streamable HTTP",
 * na forma mais simples que o spec permite: cada POST traz uma mensagem
 * JSON-RPC (ou um lote) e a resposta vai em `application/json`, sem SSE.
 * Chega para `initialize`, `tools/list` e `tools/call`, que é tudo o que a
 * porta para as IAs oferece. Sem estado no servidor: o `Mcp-Session-Id`
 * serve só para juntar os pedidos de uma sessão na mesma conversa.
 */

/** Do mais recente para o mais antigo; respondemos com o do cliente se o soubermos. */
export const VERSOES_MCP = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export const ERRO_PARSE = -32700;
export const ERRO_PEDIDO = -32600;
export const ERRO_METODO = -32601;
export const ERRO_PARAMETROS = -32602;
export const ERRO_INTERNO = -32603;

export type IdJsonRpc = string | number | null;

export interface MensagemJsonRpc {
  jsonrpc: '2.0';
  id?: IdJsonRpc;
  method?: string;
  params?: Record<string, unknown>;
}

export interface RespostaJsonRpc {
  jsonrpc: '2.0';
  id: IdJsonRpc;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Uma ferramenta como o MCP a descreve em `tools/list`. */
export interface FerramentaMcp {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** O resultado de `tools/call`. Erros da ferramenta vão aqui, não em `error`. */
export interface ResultadoChamada {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function versaoAcordada(pedida: unknown): string {
  return typeof pedida === 'string' &&
    (VERSOES_MCP as readonly string[]).includes(pedida)
    ? pedida
    : VERSOES_MCP[0];
}

export function resultado(id: IdJsonRpc, result: unknown): RespostaJsonRpc {
  return { jsonrpc: '2.0', id, result };
}

export function erro(
  id: IdJsonRpc,
  code: number,
  message: string,
  data?: unknown,
): RespostaJsonRpc {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** Pedido (tem id) vs notificação (sem id: não leva resposta). */
export function ePedido(m: MensagemJsonRpc): boolean {
  return m.id !== undefined;
}

/** Valida a forma; devolve a mensagem ou a resposta de erro. */
export function lerMensagem(
  bruto: unknown,
):
  | { ok: true; mensagem: MensagemJsonRpc }
  | { ok: false; resposta: RespostaJsonRpc } {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { ok: false, resposta: erro(null, ERRO_PEDIDO, 'Pedido inválido.') };
  }
  const m = bruto as Record<string, unknown>;
  const id =
    typeof m.id === 'string' || typeof m.id === 'number' || m.id === null
      ? m.id
      : undefined;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    return {
      ok: false,
      resposta: erro(id ?? null, ERRO_PEDIDO, 'Pedido JSON-RPC inválido.'),
    };
  }
  if (
    m.params !== undefined &&
    (typeof m.params !== 'object' ||
      m.params === null ||
      Array.isArray(m.params))
  ) {
    return {
      ok: false,
      resposta: erro(
        id ?? null,
        ERRO_PARAMETROS,
        'params tem de ser um objeto.',
      ),
    };
  }
  return {
    ok: true,
    mensagem: {
      jsonrpc: '2.0',
      ...(id !== undefined ? { id } : {}),
      method: m.method,
      params: (m.params as Record<string, unknown> | undefined) ?? {},
    },
  };
}

/** O texto que o modelo lê: o resultado da ferramenta em JSON legível. */
export function resultadoFerramenta(valor: unknown): ResultadoChamada {
  const estruturado =
    valor && typeof valor === 'object' && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : { resultado: valor ?? null };
  return {
    content: [{ type: 'text', text: JSON.stringify(estruturado, null, 2) }],
    structuredContent: estruturado,
  };
}

export function erroFerramenta(
  codigo: string,
  mensagem: string,
): ResultadoChamada {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ erro: { codigo, mensagem } }) },
    ],
    isError: true,
  };
}
