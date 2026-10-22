/*
 * Versão para juntas de freguesia: o menu do painel reduzido. É a mesma
 * lista da API (code/api/src/modules/juntas/funcionalidades.ts), com os
 * caminhos das páginas da web: se mudar lá, muda aqui. A API responde 404
 * (`funcionalidade_indisponivel`) a estas áreas numa junta, por isso
 * esconder aqui é só para o menu ficar limpo.
 */

export type TipoMunicipio = "camara" | "junta";

/** Páginas do painel que só a câmara tem (urbanismo, licenças, PDM…). */
export const PAGINAS_SO_CAMARA: readonly string[] = [
  "/painel/processos",
  "/painel/requerimentos",
  "/painel/licencas",
  "/painel/antecipacoes",
  "/painel/empresas",
  "/painel/pagamentos",
  "/painel/entregas",
  "/painel/cartas",
  "/painel/chamadas",
  "/painel/campanhas",
  "/painel/apoios",
  "/painel/ordenamento",
  "/painel/consultas",
  "/painel/avisos",
  "/painel/emergencias",
  "/painel/fiscalizacao",
  "/painel/contratacao",
  "/painel/arquivo",
  "/painel/transparencia",
  "/painel/turismo",
];

/** Páginas do painel que só a junta tem. */
export const PAGINAS_SO_JUNTA: readonly string[] = ["/painel/atestados"];

function comPrefixo(href: string, lista: readonly string[]): boolean {
  return lista.some((p) => href === p || href.startsWith(`${p}/`));
}

/** Esta página do painel existe para este tipo de município? */
export function paginaDisponivel(
  tipo: TipoMunicipio | undefined,
  href: string,
): boolean {
  if ((tipo ?? "camara") === "junta") return !comPrefixo(href, PAGINAS_SO_CAMARA);
  return !comPrefixo(href, PAGINAS_SO_JUNTA);
}
