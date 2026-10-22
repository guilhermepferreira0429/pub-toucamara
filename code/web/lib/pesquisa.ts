"use client";

import { useSyncExternalStore } from "react";

/*
 * Pesquisa global do painel (⌘K). A caixa da barra lateral e o atalho abrem
 * a mesma paleta, montada uma vez no layout: a barra aparece duas vezes (no
 * computador e na gaveta do telemóvel) e assim não há dois diálogos.
 */

const EVENTO = "painel:pesquisa";

export function abrirPesquisa() {
  window.dispatchEvent(new Event(EVENTO));
}

export function aoAbrirPesquisa(fn: () => void): () => void {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}

function eMac(): boolean {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const plataforma = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad/i.test(plataforma);
}

const nada = () => () => undefined;

/**
 * O atalho como se escreve neste computador: "⌘K" no Mac, "Ctrl K" no resto.
 * No servidor não se sabe: "Ctrl K", e o browser corrige depois de hidratar.
 */
export function useTeclaAtalho(): string {
  return useSyncExternalStore(
    nada,
    () => (eMac() ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

/** Igual à normalização da API (termos.ts): sem acentos nem maiúsculas. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
