"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface AcaoMenu {
  rotulo: string;
  icone?: LucideIcon;
  /** Ação do botão; com `href` é um link (abre noutro separador se `externo`). */
  onClick?: () => void;
  href?: string;
  externo?: boolean;
  desativado?: boolean;
  tom?: "normal" | "aviso";
}

/**
 * O menu "⋯" de uma linha: as ações ficam escondidas até se pedirem, em vez
 * de uma fila de links pequenos em cada linha. Teclado: setas, Home/End,
 * Escape fecha e devolve o foco ao botão.
 */
export function MenuAcoes({ acoes, rotulo }: { acoes: AcaoMenu[]; rotulo: string }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const itens = () => Array.from(lista.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? []);
    itens()[0]?.focus();
    const fora = (e: MouseEvent) => {
      if (!lista.current?.contains(e.target as Node) && !botao.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      const xs = itens();
      const i = xs.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        xs[(i + 1) % xs.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        xs[(i - 1 + xs.length) % xs.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        xs[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        xs[xs.length - 1]?.focus();
      } else if (e.key === "Tab") {
        setAberto(false);
      }
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  if (!acoes.length) return null;
  const classeItem = (a: AcaoMenu) =>
    `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium outline-none focus:bg-creme hover:bg-creme ${
      a.desativado ? "cursor-not-allowed opacity-50" : ""
    } ${a.tom === "aviso" ? "text-ambar" : "text-tinta"}`;

  return (
    <div className="relative inline-block">
      <button
        ref={botao}
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        aria-label={rotulo}
        onClick={() => setAberto((a) => !a)}
        className="flex size-9 items-center justify-center rounded-full text-tinta-2 hover:bg-creme-2 hover:text-tinta focus-visible:outline-2 focus-visible:outline-terracota"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {aberto && (
        <div
          ref={lista}
          id={id}
          role="menu"
          aria-label={rotulo}
          className="absolute right-0 z-30 mt-1 flex min-w-[200px] flex-col rounded-xl border border-linha bg-papel p-1.5 shadow-[0_12px_32px_-12px_rgba(21,38,59,0.35)]"
        >
          {acoes.map((a) => {
            const Icone = a.icone;
            const conteudo = (
              <>
                {Icone && <Icone className="size-4 shrink-0 text-tinta-3" aria-hidden />}
                {a.rotulo}
              </>
            );
            return a.href ? (
              <a
                key={a.rotulo}
                role="menuitem"
                tabIndex={-1}
                href={a.href}
                target={a.externo ? "_blank" : undefined}
                rel={a.externo ? "noreferrer" : undefined}
                className={classeItem(a)}
                onClick={() => setAberto(false)}
              >
                {conteudo}
              </a>
            ) : (
              <button
                key={a.rotulo}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={a.desativado || undefined}
                className={classeItem(a)}
                onClick={() => {
                  if (a.desativado) return;
                  setAberto(false);
                  a.onClick?.();
                }}
              >
                {conteudo}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
