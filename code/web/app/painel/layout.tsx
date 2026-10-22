"use client";

import { Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SaltarParaConteudo } from "@/components/acessibilidade/saltar";
import { BarraLateral, useContagens } from "@/components/painel/barra-lateral";
import { PesquisaGlobal } from "@/components/painel/pesquisa-global";
import { Logo } from "@/components/ui/marca";
import { useFocoPreso } from "@/lib/foco";
import { SessaoProvider, useSessao } from "@/lib/sessao";

/**
 * Em ecrãs estreitos (telemóvel, zoom a 200 % / 400 %) a barra lateral fica
 * escondida atrás do botão "Menu", para o conteúdo caber sem scroll lateral.
 */
function MenuEstreito({
  contagens,
}: {
  contagens: ReturnType<typeof useContagens>;
}) {
  const [aberto, setAberto] = useState(false);
  const [aberturaEm, setAberturaEm] = useState<string | null>(null);
  const caminho = usePathname();
  const gaveta = useRef<HTMLDivElement>(null);
  const fechar = () => setAberto(false);
  useFocoPreso(gaveta, aberto, fechar);

  // Ao seguir um link do menu, a gaveta fecha-se sozinha.
  if (aberto && aberturaEm !== null && aberturaEm !== caminho) {
    setAberto(false);
  }

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-linha bg-papel px-4 py-2 md:hidden">
        <Logo tamanho={19} />
        <button
          type="button"
          onClick={() => {
            setAberturaEm(caminho);
            setAberto(true);
          }}
          aria-expanded={aberto}
          aria-controls="menu-painel"
          className="flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-tinta hover:bg-creme-2"
        >
          <Menu className="size-5" aria-hidden />
          Menu
        </button>
      </div>
      {aberto && (
        <div
          className="fixed inset-0 z-50 flex bg-tinta/40 md:hidden"
          onMouseDown={(e) => e.target === e.currentTarget && fechar()}
        >
          <div
            ref={gaveta}
            id="menu-painel"
            role="dialog"
            aria-modal="true"
            aria-label="Menu do painel"
            className="relative flex max-w-[85vw]"
          >
            <BarraLateral contagens={contagens} />
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar o menu"
              className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full text-tinta-2 hover:bg-creme-2"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  const { eu, aCarregar } = useSessao();
  const router = useRouter();
  const contagens = useContagens();

  useEffect(() => {
    if (!aCarregar && !eu) router.replace("/entrar");
  }, [aCarregar, eu, router]);

  if (aCarregar || !eu) {
    return (
      <main
        role="status"
        className="flex min-h-dvh items-center justify-center text-sm text-tinta-3"
      >
        A carregar…
      </main>
    );
  }
  return (
    <div className="flex min-h-dvh bg-creme">
      <SaltarParaConteudo />
      <div className="hidden md:flex">
        <BarraLateral contagens={contagens} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <MenuEstreito contagens={contagens} />
        <main
          id="conteudo"
          tabIndex={-1}
          className="min-w-0 flex-1 outline-none"
        >
          {children}
        </main>
      </div>
      {/* Uma só paleta ⌘K para as duas barras (computador e gaveta). */}
      <PesquisaGlobal />
    </div>
  );
}

/** Todas as páginas da câmara: sessão obrigatória e a barra lateral única. */
export default function LayoutPainel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessaoProvider>
      <Moldura>{children}</Moldura>
    </SessaoProvider>
  );
}
