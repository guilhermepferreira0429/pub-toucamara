"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, sse } from "@/lib/api";
import { MUNICIPIO } from "./config";

/*
 * Transcrição em direto da chamada web: cada fala (do munícipe e do agente)
 * e cada ferramenta vão para a API em pequenos lotes, ligados à conversa do
 * ElevenLabs (o mesmo conversation_id das ferramentas e dos webhooks). Em
 * troca, a página ouve o que o funcionário (painel) e o familiar (link do
 * SMS) escrevem e injeta no agente (sendContextualUpdate + sendUserMessage).
 * Tudo falha em silêncio: a chamada nunca depende disto.
 */

type Item =
  | { tipo: "fala"; quem: "municipe" | "agente"; texto: string; em: string }
  | {
      tipo: "ferramenta";
      ferramenta: string;
      fase: "pedido" | "resposta";
      erro?: boolean;
      resultado?: string;
      em: string;
    };

interface Sessao {
  sessao_id: string;
  token: string;
}

export interface Injetar {
  seq: number;
  quem: "funcionario" | "familiar";
  texto: string;
  contexto: string;
  gatilho: string;
}

export interface EstadoAoVivo {
  /** Quem acompanha a chamada (familiar), se alguém. */
  familiar: string | null;
  /** Última mensagem do funcionário (para mostrar na chamada). */
  funcionario: string | null;
}

/** A mensagem que nós próprios mandámos ao agente (não é o munícipe a falar). */
export const PREFIXO_GATILHO = "(nota do sistema:";

const LOTE_MS = 400;

function textoResultado(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.slice(0, 8000);
}

export function useTranscricaoAoVivo(opcoes: {
  injetar: (i: Injetar) => void;
}) {
  const sessao = useRef<Sessao | null>(null);
  const fila = useRef<Item[]>([]);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parar = useRef<AbortController | null>(null);
  const injetarRef = useRef(opcoes.injetar);
  const [estado, setEstado] = useState<EstadoAoVivo>({
    familiar: null,
    funcionario: null,
  });

  useEffect(() => {
    injetarRef.current = opcoes.injetar;
  }, [opcoes.injetar]);

  const enviar = useCallback(async () => {
    temporizador.current = null;
    const s = sessao.current;
    while (s && fila.current.length) {
      const itens = fila.current.splice(0, 20);
      try {
        await api(`/v1/public/chamadas-ao-vivo/${s.sessao_id}/falas`, {
          corpo: { itens },
          token: s.token,
        });
      } catch {
        // Sem rede ou chamada terminada: a transcrição oficial chega no fim.
        return;
      }
    }
  }, []);

  const juntar = useCallback(
    (item: Item) => {
      fila.current.push(item);
      if (fila.current.length > 200) fila.current.splice(0, fila.current.length - 200);
      if (!temporizador.current && sessao.current)
        temporizador.current = setTimeout(() => void enviar(), LOTE_MS);
    },
    [enviar],
  );

  const ouvir = useCallback(async (s: Sessao, sinal: AbortSignal) => {
    for (let tentativa = 0; tentativa < 5 && !sinal.aborted; tentativa++) {
      try {
        for await (const ev of sse(
          `/v1/public/chamadas-ao-vivo/${s.sessao_id}/instrucoes`,
          { token: s.token, sinal },
        )) {
          tentativa = 0;
          if (ev.evento === "familiar") {
            const d = ev.dados as { ativo: boolean; quem: string | null };
            setEstado((e) => ({ ...e, familiar: d.ativo ? d.quem : null }));
          } else if (ev.evento === "injetar") {
            const d = ev.dados as Injetar;
            if (d.quem === "funcionario")
              setEstado((e) => ({ ...e, funcionario: d.texto }));
            injetarRef.current(d);
          }
        }
        return; // terminou do lado da API (chamada acabou)
      } catch {
        if (sinal.aborted) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }, []);

  /** onConnect: abre a sessão com o conversation_id do ElevenLabs. */
  const iniciar = useCallback(
    async (conversaRef: string, telefone: string | null) => {
      if (!conversaRef) return;
      try {
        const s = await api<Sessao>("/v1/public/chamadas-ao-vivo", {
          corpo: { municipio: MUNICIPIO, conversa_ref: conversaRef, telefone },
        });
        sessao.current = s;
        const ctrl = new AbortController();
        parar.current = ctrl;
        void ouvir(s, ctrl.signal);
        if (fila.current.length) void enviar();
      } catch {
        // Sem API: a chamada segue sem transcrição em direto.
      }
    },
    [enviar, ouvir],
  );

  const fala = useCallback(
    (quem: "municipe" | "agente", texto: string) => {
      if (quem === "municipe" && texto.startsWith(PREFIXO_GATILHO)) return;
      juntar({ tipo: "fala", quem, texto: texto.slice(0, 2000), em: new Date().toISOString() });
    },
    [juntar],
  );

  const ferramenta = useCallback(
    (nome: string, fase: "pedido" | "resposta", erro?: boolean, resultado?: unknown) => {
      if (!/^[a-z0-9_]{1,80}$/.test(nome)) return;
      juntar({
        tipo: "ferramenta",
        ferramenta: nome,
        fase,
        erro,
        resultado: textoResultado(resultado),
        em: new Date().toISOString(),
      });
    },
    [juntar],
  );

  /** "Deixar de partilhar" com o familiar. */
  const retirarFamiliar = useCallback(async () => {
    const s = sessao.current;
    if (!s) return;
    try {
      await api(`/v1/public/chamadas-ao-vivo/${s.sessao_id}/retirar-familiar`, {
        metodo: "POST",
        token: s.token,
      });
      setEstado((e) => ({ ...e, familiar: null }));
    } catch {
      // tenta-se outra vez com o botão
    }
  }, []);

  const terminar = useCallback(async () => {
    const s = sessao.current;
    parar.current?.abort();
    parar.current = null;
    if (!s) return;
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    await enviar();
    sessao.current = null;
    fila.current = [];
    setEstado({ familiar: null, funcionario: null });
    try {
      await api(`/v1/public/chamadas-ao-vivo/${s.sessao_id}/terminar`, {
        metodo: "POST",
        token: s.token,
      });
    } catch {
      // expira sozinha
    }
  }, [enviar]);

  useEffect(
    () => () => {
      parar.current?.abort();
    },
    [],
  );

  return { estado, iniciar, fala, ferramenta, retirarFamiliar, terminar };
}
