/*
 * Cliente da API (code/api). Todos os erros chegam como
 * { erro: { codigo, mensagem, detalhes } }: os ecrãs decidem pelo `codigo`
 * e mostram a `mensagem` (já escrita para pessoas).
 */

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

export class ErroApi extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: unknown,
  ) {
    super(mensagem);
  }
}

export interface OpcoesPedido {
  metodo?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  corpo?: unknown;
  /** JWT do painel (Authorization: Bearer). */
  token?: string | null;
  /** Equipa interna: município escolhido (header X-Municipio). */
  municipio?: string | null;
  sinal?: AbortSignal;
  headers?: Record<string, string>;
}

async function erroDe(res: Response): Promise<ErroApi> {
  try {
    const j = (await res.json()) as {
      erro?: { codigo?: string; mensagem?: string; detalhes?: unknown };
    };
    if (j.erro) {
      return new ErroApi(
        res.status,
        j.erro.codigo ?? "erro",
        j.erro.mensagem ?? "Ocorreu um erro.",
        j.erro.detalhes,
      );
    }
  } catch {
    // corpo não é JSON
  }
  return new ErroApi(res.status, "erro", "Ocorreu um erro. Tente outra vez.");
}

function headersDe(o: OpcoesPedido): Record<string, string> {
  const h: Record<string, string> = { ...o.headers };
  if (o.corpo !== undefined) h["Content-Type"] = "application/json";
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  if (o.municipio) h["X-Municipio"] = o.municipio;
  return h;
}

/** Pedido JSON. `caminho` começa por /v1/... */
export async function api<T>(caminho: string, o: OpcoesPedido = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${caminho}`, {
      method: o.metodo ?? (o.corpo !== undefined ? "POST" : "GET"),
      headers: headersDe(o),
      body: o.corpo !== undefined ? JSON.stringify(o.corpo) : undefined,
      signal: o.sinal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ErroApi(0, "sem_ligacao", "Sem ligação. Verifique a internet.");
  }
  if (!res.ok) throw await erroDe(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Resposta que pode ser JSON ou um ficheiro (PDF, imagem…). */
export type RespostaFicheiro<T> =
  | { tipo: "json"; dados: T }
  | { tipo: "ficheiro"; blob: Blob; contentType: string };

/**
 * Pedido cuja resposta pode ser JSON ou binária: decide pelo Content-Type
 * (JSON → `{ tipo: "json", dados }`; o resto → `{ tipo: "ficheiro", blob }`).
 * Os erros chegam como em `api`.
 */
export async function apiFicheiro<T>(
  caminho: string,
  o: OpcoesPedido = {},
): Promise<RespostaFicheiro<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${caminho}`, {
      method: o.metodo ?? (o.corpo !== undefined ? "POST" : "GET"),
      headers: headersDe(o),
      body: o.corpo !== undefined ? JSON.stringify(o.corpo) : undefined,
      signal: o.sinal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ErroApi(0, "sem_ligacao", "Sem ligação. Verifique a internet.");
  }
  if (!res.ok) throw await erroDe(res);
  const contentType = res.headers.get("Content-Type") ?? "";
  if (res.status === 204) return { tipo: "json", dados: undefined as T };
  if (/json/i.test(contentType)) {
    return { tipo: "json", dados: (await res.json()) as T };
  }
  return { tipo: "ficheiro", blob: await res.blob(), contentType };
}

export interface EventoSse {
  evento: string;
  dados: unknown;
}

/**
 * SSE por fetch (o EventSource do browser não manda Authorization nem faz
 * POST): chat, painel ao vivo, perguntas da chefia. Erros antes do stream
 * chegam em JSON e lançam ErroApi.
 */
export async function* sse(
  caminho: string,
  o: OpcoesPedido = {},
): AsyncGenerator<EventoSse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${caminho}`, {
      method: o.metodo ?? (o.corpo !== undefined ? "POST" : "GET"),
      headers: { ...headersDe(o), Accept: "text/event-stream" },
      body: o.corpo !== undefined ? JSON.stringify(o.corpo) : undefined,
      signal: o.sinal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ErroApi(0, "sem_ligacao", "Sem ligação. Verifique a internet.");
  }
  if (!res.ok || !res.body) throw await erroDe(res);
  const leitor = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += value;
    let fim: number;
    while ((fim = resto.indexOf("\n\n")) >= 0) {
      const bloco = resto.slice(0, fim);
      resto = resto.slice(fim + 2);
      let evento = "message";
      const linhas: string[] = [];
      for (const l of bloco.split("\n")) {
        if (l.startsWith("event:")) evento = l.slice(6).trim();
        else if (l.startsWith("data:")) linhas.push(l.slice(5).trimStart());
      }
      if (!linhas.length) continue;
      const texto = linhas.join("\n");
      let dados: unknown = texto;
      try {
        dados = JSON.parse(texto);
      } catch {
        // texto simples
      }
      yield { evento, dados };
    }
  }
}
