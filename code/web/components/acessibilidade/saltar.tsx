/**
 * "Saltar para o conteúdo": o primeiro elemento com foco da página; só se vê
 * quando se navega com o teclado (estilo em globals.css).
 */
export function SaltarParaConteudo({ alvo = "conteudo" }: { alvo?: string }) {
  return (
    <nav aria-label="Atalhos">
      <a href={`#${alvo}`} className="saltar-conteudo">
        Saltar para o conteúdo
      </a>
    </nav>
  );
}
