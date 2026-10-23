"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/** O menu das ligações do cabeçalho quando não cabem na barra (abaixo de xl). */
export function MenuTopo({ links }: { links: { href: string; nome: string }[] }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const Icone = aberto ? X : Menu;
  return (
    <div ref={raiz} className="xl:hidden">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto((a) => !a)}
        className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[14px] font-semibold text-tinta hover:bg-creme-2"
      >
        <Icone className="size-5" aria-hidden />
        <span className="hidden sm:inline">Menu</span>
        <span className="sr-only sm:hidden">Menu</span>
      </button>
      <nav
        id={id}
        aria-label="Secções"
        hidden={!aberto}
        className="absolute inset-x-0 top-full border-b border-linha bg-creme shadow-[0_12px_24px_-12px_rgba(21,38,59,0.25)]"
      >
        <ul className="mx-auto grid w-full max-w-[1120px] gap-1 px-5 py-4 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
          {links.map((s) => (
            <li key={s.href}>
              <a
                href={s.href}
                onClick={() => setAberto(false)}
                className="flex min-h-11 items-center rounded-xl px-3 text-[16px] font-medium text-tinta hover:bg-creme-2"
              >
                {s.nome}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
