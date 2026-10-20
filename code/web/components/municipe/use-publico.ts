"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ErroApi } from "@/lib/api";

export type Carregamento<T> =
  | { estado: "a_carregar" }
  | { estado: "ok"; dados: T }
  | { estado: "invalido" }
  | { estado: "erro"; mensagem: string };

/**
 * Ao abrir a página: link que não existe, expirou ou foi cancelado (404), ou
 * código com formato errado (400 `pedido_invalido`) → ecrã próprio.
 */
function eLinkInvalido(e: unknown): boolean {
  return (
    e instanceof ErroApi &&
    (e.estado === 404 ||
      e.codigo === "link_invalido" ||
      e.codigo === "pedido_invalido")
  );
}

export function mensagemDe(e: unknown): string {
  return e instanceof ErroApi
    ? e.message
    : "Ocorreu um erro. Tente outra vez.";
}

/**
 * Lê uma página pública da API (GET /v1/public/...). `definir` substitui os
 * dados com a resposta de uma ação (as ações públicas devolvem a página
 * atualizada); `recarregar` volta a pedir sem mostrar "a carregar".
 */
export function usePublico<T>(caminho: string) {
  const [c, setC] = useState<Carregamento<T>>({ estado: "a_carregar" });

  const pedir = useCallback(async () => {
    try {
      const dados = await api<T>(caminho);
      setC({ estado: "ok", dados });
    } catch (e) {
      if (eLinkInvalido(e)) setC({ estado: "invalido" });
      else setC({ estado: "erro", mensagem: mensagemDe(e) });
    }
  }, [caminho]);

  useEffect(() => {
    let ativo = true;
    api<T>(caminho)
      .then((dados) => {
        if (ativo) setC({ estado: "ok", dados });
      })
      .catch((e: unknown) => {
        if (!ativo) return;
        if (eLinkInvalido(e)) setC({ estado: "invalido" });
        else setC({ estado: "erro", mensagem: mensagemDe(e) });
      });
    return () => {
      ativo = false;
    };
  }, [caminho]);

  const definir = useCallback((dados: T) => setC({ estado: "ok", dados }), []);

  const tentarOutraVez = useCallback(() => {
    setC({ estado: "a_carregar" });
    void pedir();
  }, [pedir]);

  return { c, definir, recarregar: pedir, tentarOutraVez };
}
