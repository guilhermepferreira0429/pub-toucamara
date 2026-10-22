import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/marca";

/** O cabeçalho das páginas de apresentação (/ e /avaliacao): logótipo, ligações e o painel. */
export function TopoApresentacao({ links }: { links: { href: string; nome: string }[] }) {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-tinta focus:px-4 focus:py-2 focus:text-papel"
      >
        Saltar para o conteúdo
      </a>
      <header className="sticky top-0 z-40 border-b border-linha/80 bg-creme/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" aria-label="Tou, Câmara?, início" className="flex min-h-11 items-center">
            <Logo tamanho={22} />
          </Link>
          <nav aria-label="Secções" className="hidden items-center gap-6 lg:flex">
            {links.map((s) => (
              <a key={s.href} href={s.href} className="text-[14px] font-medium text-tinta-2 hover:text-tinta">
                {s.nome}
              </a>
            ))}
          </nav>
          <Link
            href="/entrar"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-tinta px-4 text-[14px] font-semibold text-tinta transition-colors hover:bg-tinta hover:text-papel"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            <span className="hidden sm:inline">Painel da câmara</span>
            <span className="sm:hidden">Painel</span>
          </Link>
        </div>
      </header>
    </>
  );
}
