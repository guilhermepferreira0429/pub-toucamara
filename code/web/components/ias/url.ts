import { API_URL } from "@/lib/api";

/**
 * Endereço completo de um caminho da API (`/v1/mcp/...`), para colar no
 * assistente. Com a API atrás do mesmo domínio (`NEXT_PUBLIC_API_URL=/api`)
 * junta-se a origem da página.
 */
export function urlApi(caminho: string): string {
  if (/^https?:\/\//.test(API_URL)) return `${API_URL}${caminho}`;
  const origem = typeof window === "undefined" ? "" : window.location.origin;
  return `${origem}${API_URL}${caminho}`;
}

/** Copia para a área de transferência; false se o browser não deixar. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
