"use client";

import { useCallback, useEffect, useState } from "react";
import { ErroApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";
import { mensagemErro } from "./formatos";
import type { Pagina } from "./tipos";

/*
 * Leituras do painel: um GET por caminho (null = não pedir), com o estado
 * de carregamento derivado da chave (sem setState síncrono nos efeitos).
 */

interface Estado<T> {
  chave: string | null;
  dados?: T;
  erro?: string;
  codigo?: string;
}

export function useDados<T>(caminho: string | null) {
  const { pedido } = useSessao();
  const [versao, setVersao] = useState(0);
  const [estado, setEstado] = useState<Estado<T>>({ chave: null });
  const chave = caminho ? `${caminho}#${versao}` : null;

  useEffect(() => {
    if (!caminho || !chave) return;
    let vivo = true;
    pedido<T>(caminho).then(
      (dados) => vivo && setEstado({ chave, dados }),
      (e: unknown) =>
        vivo &&
        setEstado({
          chave,
          erro: mensagemErro(e),
          codigo: e instanceof ErroApi ? e.codigo : undefined,
        }),
    );
    return () => {
      vivo = false;
    };
  }, [caminho, chave, pedido]);

  const atual = estado.chave === chave;
  // Mantém os dados enquanto recarrega o mesmo caminho (sem saltos no
  // ecrã); outro caminho (outra conversa) começa vazio.
  const mesmo = !!caminho && !!estado.chave?.startsWith(`${caminho}#`);
  return {
    dados: mesmo ? estado.dados : undefined,
    erro: atual ? estado.erro : undefined,
    codigo: atual ? estado.codigo : undefined,
    aCarregar: !!chave && !atual,
    recarregar: useCallback(() => setVersao((v) => v + 1), []),
    /** Troca os dados localmente (depois de uma ação que devolve o objeto). */
    definir: useCallback(
      (f: (d: T | undefined) => T | undefined) =>
        setEstado((e) => ({ ...e, dados: f(e.dados) })),
      [],
    ),
  };
}

/** Lista paginada por cursor: a primeira página e "carregar mais". */
export function useLista<T>(base: string | null) {
  const { pedido } = useSessao();
  const [versao, setVersao] = useState(0);
  const [estado, setEstado] = useState<{
    chave: string | null;
    itens: T[];
    proximo: string | null;
    erro?: string;
  }>({ chave: null, itens: [], proximo: null });
  const [maisErro, setMaisErro] = useState<string | null>(null);
  const [aCarregarMais, setACarregarMais] = useState(false);
  const chave = base ? `${base}#${versao}` : null;

  useEffect(() => {
    if (!base || !chave) return;
    let vivo = true;
    pedido<Pagina<T>>(base).then(
      (p) =>
        vivo &&
        setEstado({ chave, itens: p.itens, proximo: p.proximo_cursor }),
      (e: unknown) =>
        vivo &&
        setEstado({ chave, itens: [], proximo: null, erro: mensagemErro(e) }),
    );
    return () => {
      vivo = false;
    };
  }, [base, chave, pedido]);

  const carregarMais = useCallback(async () => {
    if (!base || !estado.proximo) return;
    setACarregarMais(true);
    setMaisErro(null);
    try {
      const sep = base.includes("?") ? "&" : "?";
      const p = await pedido<Pagina<T>>(
        `${base}${sep}cursor=${encodeURIComponent(estado.proximo)}`,
      );
      setEstado((e) => ({
        ...e,
        itens: [...e.itens, ...p.itens],
        proximo: p.proximo_cursor,
      }));
    } catch (e) {
      setMaisErro(mensagemErro(e));
    } finally {
      setACarregarMais(false);
    }
  }, [base, estado.proximo, pedido]);

  const atual = estado.chave === chave;
  return {
    itens: atual ? estado.itens : [],
    proximo: atual ? estado.proximo : null,
    erro: atual ? estado.erro : undefined,
    aCarregar: !!chave && !atual,
    aCarregarMais,
    maisErro,
    carregarMais,
    recarregar: useCallback(() => setVersao((v) => v + 1), []),
    /** Atualiza um item localmente (depois de uma ação). */
    mudar: useCallback(
      (f: (itens: T[]) => T[]) => setEstado((e) => ({ ...e, itens: f(e.itens) })),
      [],
    ),
  };
}

/** Query string sem os vazios. */
export function query(p: Record<string, string | number | boolean | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Fuso do município da sessão (para as datas). */
export function useFuso(): string {
  const { eu } = useSessao();
  return eu?.municipio.fuso ?? "Europe/Lisbon";
}
