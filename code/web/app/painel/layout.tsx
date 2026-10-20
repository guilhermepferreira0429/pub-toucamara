"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BarraLateral, useContagens } from "@/components/painel/barra-lateral";
import { SessaoProvider, useSessao } from "@/lib/sessao";

function Moldura({ children }: { children: React.ReactNode }) {
  const { eu, aCarregar } = useSessao();
  const router = useRouter();
  const contagens = useContagens();

  useEffect(() => {
    if (!aCarregar && !eu) router.replace("/entrar");
  }, [aCarregar, eu, router]);

  if (aCarregar || !eu) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-tinta-3">
        A carregar…
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh bg-creme">
      <BarraLateral contagens={contagens} />
      <main className="min-w-0 flex-1">{children}</main>
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
