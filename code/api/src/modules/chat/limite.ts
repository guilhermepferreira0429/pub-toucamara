/**
 * Limite simples de pedidos em memória (janela deslizante por chave). Chega
 * para uma instância; com várias, cada uma conta os seus.
 */
export class LimitePedidos {
  private readonly marcas = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
  ) {}

  /** Conta o pedido se couber na janela; false se já passou do limite. */
  permitir(chave: string, agora = Date.now()): boolean {
    const desde = agora - this.janelaMs;
    const recentes = (this.marcas.get(chave) ?? []).filter((t) => t > desde);
    if (recentes.length >= this.maximo) {
      this.marcas.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    this.marcas.set(chave, recentes);
    if (this.marcas.size > 10_000) this.limpar(agora);
    return true;
  }

  /** Esquece as chaves sem pedidos na janela. */
  limpar(agora = Date.now()): void {
    const desde = agora - this.janelaMs;
    for (const [chave, ts] of this.marcas) {
      if (!ts.some((t) => t > desde)) this.marcas.delete(chave);
    }
  }
}
