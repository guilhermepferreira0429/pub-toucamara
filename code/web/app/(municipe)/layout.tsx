import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoLgp } from "@/components/acessibilidade/lingua-gestual";
import { OpcoesLeitura } from "@/components/acessibilidade/opcoes-leitura";
import { RodapeMunicipe } from "@/components/acessibilidade/rodape-municipe";
import { SaltarParaConteudo } from "@/components/acessibilidade/saltar";
import { GrelhaComputador, LateralComputador } from "@/components/municipe/lateral-computador";

// Páginas abertas pelos links dos SMS: não aparecem em pesquisas.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Páginas dos links do SMS e do site (munícipe). No telemóvel: fundo creme,
 * uma coluna, as opções de leitura (ouvir, letra maior, alto contraste) por
 * cima e o rodapé com a declaração de acessibilidade por baixo. No
 * computador: a coluna da câmara à esquerda (com as opções de leitura) e o
 * conteúdo num cartão mais largo, em vez de uma coluna de telemóvel perdida
 * no meio do ecrã.
 */
export default function LayoutMunicipe({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="zona-municipe min-h-dvh w-full bg-creme">
      <SaltarParaConteudo />
      <GrelhaComputador
        lateral={
          <LateralComputador>
            <OpcoesLeitura />
          </LateralComputador>
        }
      >
        <div className="mx-auto flex w-full max-w-[430px] flex-col px-5 pt-4 pb-10 md:max-w-[640px] lg:mx-0 lg:max-w-none lg:px-0 lg:pt-0">
          <div className="lg:hidden">
            <OpcoesLeitura />
          </div>
          {/* O vídeo depende do caminho (só se sabe no browser). */}
          <Suspense fallback={null}>
            <VideoLgp />
          </Suspense>
          <main
            id="conteudo"
            tabIndex={-1}
            className="flex w-full flex-col outline-none lg:rounded-[28px] lg:border lg:border-linha lg:bg-papel lg:px-12 lg:py-10 lg:shadow-[0_30px_60px_-45px_rgba(21,38,59,0.45)]"
          >
            {children}
          </main>
          <RodapeMunicipe />
        </div>
      </GrelhaComputador>
    </div>
  );
}
