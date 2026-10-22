"use client";

import { type RefObject, useEffect } from "react";

const FOCAVEIS =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focaveis(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
    (el) => !el.hidden && el.getClientRects().length > 0,
  );
}

/**
 * Foco preso num diálogo modal (WCAG 2.1.2 / 2.4.3): ao abrir põe o foco no
 * primeiro elemento (ou no próprio diálogo), Tab e Shift+Tab dão a volta
 * dentro dele, Esc chama `aoFechar`, e ao fechar o foco volta para onde estava.
 */
export function useFocoPreso(
  ref: RefObject<HTMLElement | null>,
  ativo: boolean,
  aoFechar?: () => void,
) {
  useEffect(() => {
    if (!ativo) return;
    const raiz = ref.current;
    if (!raiz) return;
    const antes = document.activeElement as HTMLElement | null;

    // Se nada lá dentro já tem o foco (autoFocus), foca o primeiro elemento.
    if (!raiz.contains(document.activeElement)) {
      const primeiro = focaveis(raiz)[0];
      if (primeiro) primeiro.focus();
      else {
        if (!raiz.hasAttribute("tabindex")) raiz.setAttribute("tabindex", "-1");
        raiz.focus();
      }
    }

    function tecla(e: KeyboardEvent) {
      if (!raiz) return;
      if (e.key === "Escape" && aoFechar) {
        e.stopPropagation();
        aoFechar();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = focaveis(raiz);
      if (!lista.length) {
        e.preventDefault();
        return;
      }
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      const atual = document.activeElement;
      if (e.shiftKey && (atual === primeiro || !raiz.contains(atual))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (atual === ultimo || !raiz.contains(atual))) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      if (antes && document.contains(antes)) antes.focus();
    };
  }, [ref, ativo, aoFechar]);
}
