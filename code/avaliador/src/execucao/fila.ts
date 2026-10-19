/*
 * Fila de perguntas com o ritmo do adaptador: `paralelo` trabalhadores, cada
 * um espera `pausa()` antes de pegar na pergunta seguinte (com paralelo 1 é a
 * pausa entre perguntas). Parar (Ctrl+C, erro fatal) não interrompe as
 * perguntas em curso: deixa-as acabar e gravar, e não começa mais nenhuma.
 */

export function dormir(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || sinal?.aborted) return resolve();
    const t = setTimeout(fim, ms);
    function fim() {
      clearTimeout(t);
      sinal?.removeEventListener('abort', fim);
      resolve();
    }
    sinal?.addEventListener('abort', fim, { once: true });
  });
}

export interface OpcoesFila<T> {
  paralelo: number;
  pausa: () => number;
  trabalhar: (item: T) => Promise<void>;
  /** Abortar = não começar mais nenhum (os em curso acabam). */
  sinal?: AbortSignal;
  /** Para testes. */
  dormir?: (ms: number, sinal?: AbortSignal) => Promise<void>;
}

/** Corre a fila. Um erro de `trabalhar` para a fila e é relançado no fim. */
export async function correrFila<T>(
  itens: T[],
  o: OpcoesFila<T>,
): Promise<void> {
  const espera = o.dormir ?? dormir;
  const parar = new AbortController();
  const sinal = o.sinal
    ? AbortSignal.any([o.sinal, parar.signal])
    : parar.signal;
  let proximo = 0;
  let erro: unknown = null;

  async function trabalhador() {
    let primeiro = true;
    while (!sinal.aborted && proximo < itens.length) {
      if (!primeiro) {
        await espera(o.pausa(), sinal);
        if (sinal.aborted || proximo >= itens.length) return;
      }
      primeiro = false;
      const item = itens[proximo++];
      try {
        await o.trabalhar(item);
      } catch (e) {
        erro ??= e;
        parar.abort();
        return;
      }
    }
  }

  const n = Math.max(1, Math.min(o.paralelo, itens.length));
  await Promise.all(Array.from({ length: n }, trabalhador));
  if (erro) throw erro;
}
