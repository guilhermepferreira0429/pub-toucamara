"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/*
 * Ditado por voz no browser (Web Speech API, como no chat do munícipe): a
 * fala é transcrita pelo próprio browser e entra no campo de texto, para a
 * pessoa rever antes de enviar. Sem suporte (Firefox, por exemplo), o botão
 * não aparece e responde-se por escrito.
 */

interface ReconhecimentoFala {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type ConstrutorFala = new () => ReconhecimentoFala;

function construtorFala(): ConstrutorFala | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorFala;
    webkitSpeechRecognition?: ConstrutorFala;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscreverNada = () => () => {};

/**
 * `aoTexto(t)` recebe a transcrição desta gravação (vai mudando enquanto se
 * fala); quem chama junta-a ao que já estava escrito. Contínuo: só pára
 * quando se carrega outra vez.
 */
export function useDitado(aoTexto: (t: string) => void) {
  const suportado = useSyncExternalStore(
    subscreverNada,
    () => construtorFala() !== null,
    () => false,
  );
  const [aOuvir, setAOuvir] = useState(false);
  const rec = useRef<ReconhecimentoFala | null>(null);

  const alternar = useCallback(() => {
    if (rec.current) {
      rec.current.stop();
      return;
    }
    const C = construtorFala();
    if (!C) return;
    const r = new C();
    r.lang = "pt-PT";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      aoTexto(t);
    };
    r.onend = r.onerror = () => {
      rec.current = null;
      setAOuvir(false);
    };
    rec.current = r;
    setAOuvir(true);
    r.start();
  }, [aoTexto]);

  useEffect(() => () => rec.current?.stop(), []);
  return { suportado, aOuvir, alternar };
}
