"use client";

import { Pause, Play, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/*
 * "Ouvir esta página": lê em voz alta o conteúdo principal (#conteudo) com a
 * síntese de voz do próprio browser (Web Speech API), em português de
 * Portugal. Não envia nada para fora do telemóvel. Se o browser não a tiver,
 * o botão não aparece.
 */

type Estado = "parado" | "a_ler" | "em_pausa";

const nada = () => () => {};

function temVoz() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/*
 * A melhor voz portuguesa do aparelho. As vozes "naturais" (Edge: "Microsoft
 * … Online (Natural)"; Chrome: "Google português"; Safari: "Premium"/"Enhanced")
 * soam muito melhor do que as do sistema. Primeiro a variante (pt-PT ganha
 * sempre a pt-BR: é a câmara de Guimarães a falar), depois a mais natural.
 */
const NATURAL = /natural|neural|online|premium|enhanced|melhorad|google/i;

export function pontuarVoz(v: Pick<SpeechSynthesisVoice, "lang" | "name" | "localService">): number {
  const lang = v.lang.toLowerCase().replace("_", "-");
  if (!lang.startsWith("pt")) return -1;
  let p = lang.startsWith("pt-pt") ? 60 : 10;
  if (NATURAL.test(v.name)) p += 30;
  else if (!v.localService) p += 15;
  if (/compact|eloquence|espeak/i.test(v.name)) p -= 15;
  return p;
}

function escolherVoz(): SpeechSynthesisVoice | null {
  let melhor: SpeechSynthesisVoice | null = null;
  let max = -1;
  for (const v of window.speechSynthesis.getVoices()) {
    const p = pontuarVoz(v);
    if (p > max) {
      max = p;
      melhor = v;
    }
  }
  return melhor;
}

/** Texto visível do conteúdo, sem o que está marcado para não ler. */
function textoDaPagina(): string {
  const raiz = document.getElementById("conteudo");
  if (!raiz) return "";
  const copia = raiz.cloneNode(true) as HTMLElement;
  copia
    .querySelectorAll("[data-nao-ler], [aria-hidden='true'], script, style, svg, .sr-only")
    .forEach((n) => n.remove());
  // Separa blocos com ponto final para a voz fazer pausas.
  copia.querySelectorAll("h1,h2,h3,h4,p,li,dt,dd,button,a,label,legend,td,th").forEach((n) => {
    n.append(". ");
  });
  return (copia.textContent ?? "")
    .replace(/\s+/g, " ")
    .replace(/(\.\s*){2,}/g, ". ")
    .trim();
}

/**
 * O Chrome corta frases muito longas (~15 s): parte o texto em pedaços
 * pequenos, por frases, e lê-os em fila.
 */
export function partirTexto(texto: string, max = 200): string[] {
  const frases = texto.match(/[^.!?]+[.!?]*/g) ?? [];
  const pedacos: string[] = [];
  let atual = "";
  for (const f of frases.map((x) => x.trim()).filter(Boolean)) {
    if ((atual + " " + f).length > max && atual) {
      pedacos.push(atual);
      atual = f;
    } else {
      atual = atual ? `${atual} ${f}` : f;
    }
  }
  if (atual) pedacos.push(atual);
  return pedacos;
}

export function OuvirPagina() {
  const suportado = useSyncExternalStore(nada, temVoz, () => false);
  const [estado, setEstado] = useState<Estado>("parado");
  const fila = useRef(0);

  // Ao sair da página, cala-se.
  useEffect(() => {
    if (!suportado) return;
    const parar = () => window.speechSynthesis.cancel();
    // O Chrome só carrega a lista de vozes depois de a pedirem uma vez.
    window.speechSynthesis.getVoices();
    window.addEventListener("pagehide", parar);
    return () => {
      window.removeEventListener("pagehide", parar);
      parar();
    };
  }, [suportado]);

  if (!suportado) return null;

  function ler() {
    const s = window.speechSynthesis;
    s.cancel();
    const pedacos = partirTexto(textoDaPagina());
    if (!pedacos.length) return;
    const voz = escolherVoz();
    const id = ++fila.current;
    pedacos.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = voz?.lang ?? "pt-PT";
      if (voz) u.voice = voz;
      u.rate = 0.95;
      if (i === pedacos.length - 1) {
        u.onend = () => {
          if (fila.current === id) setEstado("parado");
        };
      }
      u.onerror = () => {
        if (fila.current === id) setEstado("parado");
      };
      s.speak(u);
    });
    setEstado("a_ler");
  }

  function pausar() {
    window.speechSynthesis.pause();
    setEstado("em_pausa");
  }

  function continuar() {
    window.speechSynthesis.resume();
    setEstado("a_ler");
  }

  function parar() {
    fila.current++;
    window.speechSynthesis.cancel();
    setEstado("parado");
  }

  const botao =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-[1.5px] border-tinta px-4 text-[15px] font-semibold text-tinta hover:bg-tinta/5";

  return (
    <div className="flex items-center gap-2">
      {estado === "parado" ? (
        <button type="button" onClick={ler} className={botao}>
          <Volume2 className="size-5" aria-hidden />
          Ouvir esta página
        </button>
      ) : (
        <>
          {estado === "a_ler" ? (
            <button type="button" onClick={pausar} className={botao}>
              <Pause className="size-5" aria-hidden />
              Pausa
            </button>
          ) : (
            <button type="button" onClick={continuar} className={botao}>
              <Play className="size-5" aria-hidden />
              Continuar
            </button>
          )}
          <button type="button" onClick={parar} className={botao}>
            <Square className="size-4" aria-hidden />
            Parar
          </button>
        </>
      )}
      <span className="sr-only" role="status">
        {estado === "a_ler" ? "A ler a página em voz alta." : estado === "em_pausa" ? "Leitura em pausa." : ""}
      </span>
    </div>
  );
}
