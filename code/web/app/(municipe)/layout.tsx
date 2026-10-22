import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoLgp } from "@/components/acessibilidade/lingua-gestual";
import { OpcoesLeitura } from "@/components/acessibilidade/opcoes-leitura";
import { RodapeMunicipe } from "@/components/acessibilidade/rodape-municipe";
import { SaltarParaConteudo } from "@/components/acessibilidade/saltar";

// Páginas abertas pelos links dos SMS: não aparecem em pesquisas.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Páginas dos links do SMS (munícipe, no telemóvel): fundo creme, uma
 * coluna centrada, sem barra lateral. No computador fica a mesma coluna.
 * Por cima: as opções de leitura (ouvir, letra maior, alto contraste) e o
 * vídeo em Língua Gestual, se a câmara o tiver; por baixo, o rodapé com a
 * declaração de acessibilidade.
 */
export default function LayoutMunicipe({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="zona-municipe flex min-h-dvh w-full justify-center bg-creme">
      <SaltarParaConteudo />
      <div className="flex w-full max-w-[430px] flex-col px-5 pt-4 pb-10">
        <OpcoesLeitura />
        {/* O vídeo depende do caminho (só se sabe no browser). */}
        <Suspense fallback={null}>
          <VideoLgp />
        </Suspense>
        <main id="conteudo" tabIndex={-1} className="flex w-full flex-col outline-none">
          {children}
        </main>
        <RodapeMunicipe />
      </div>
    </div>
  );
}
