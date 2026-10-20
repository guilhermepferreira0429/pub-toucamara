import type { Metadata } from "next";

// Páginas abertas pelos links dos SMS: não aparecem em pesquisas.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Páginas dos links do SMS (munícipe, no telemóvel): fundo creme, uma
 * coluna centrada, sem barra lateral. No computador fica a mesma coluna.
 */
export default function LayoutMunicipe({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full justify-center bg-creme">
      <main className="flex w-full max-w-[430px] flex-col px-5 pt-4 pb-10">
        {children}
      </main>
    </div>
  );
}
