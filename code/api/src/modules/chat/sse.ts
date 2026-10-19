import type { Response } from 'express';

export type EventoSse = 'texto' | 'ferramenta' | 'cartao' | 'fim' | 'erro';

export interface CanalSse {
  enviar(evento: EventoSse, dados: unknown): void;
  fechar(): void;
  /** Aborta quando o browser fecha a ligação. */
  sinal: AbortSignal;
}

/** Um evento no formato text/event-stream. */
export function formatarEvento(evento: EventoSse, dados: unknown): string {
  return `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
}

/**
 * Abre a resposta em SSE (o `@Sse` do Nest só serve para GET). Cada evento
 * é escrito e enviado logo; um comentário a cada 15 s mantém a ligação viva
 * enquanto as ferramentas correm.
 */
export function abrirSse(res: Response): CanalSse {
  const controlo = new AbortController();
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: não juntar eventos
  res.flushHeaders();

  const vivo = setInterval(() => escrever(': vivo\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(vivo);
    if (!res.writableEnded) controlo.abort();
  });

  function escrever(s: string) {
    if (res.writableEnded || res.destroyed) return;
    res.write(s);
  }

  return {
    sinal: controlo.signal,
    enviar: (evento, dados) => escrever(formatarEvento(evento, dados)),
    fechar: () => {
      clearInterval(vivo);
      if (!res.writableEnded) res.end();
    },
  };
}
