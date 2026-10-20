"use client";

import { useEffect, useRef } from "react";

/*
 * Onda e anéis que mexem com o volume (getInputVolume quando a pessoa fala,
 * getOutputVolume quando o agente fala). Atualiza o DOM diretamente num
 * requestAnimationFrame, sem re-render. Com "reduzir movimento" fica parada.
 */

function useNivel(
  obterVolume: () => number,
  aplicar: (nivel: number) => void,
) {
  const obter = useRef(obterVolume);
  const fazer = useRef(aplicar);
  useEffect(() => {
    obter.current = obterVolume;
    fazer.current = aplicar;
  });
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let suave = 0;
    const passo = () => {
      let v = 0;
      try {
        v = obter.current();
      } catch {
        v = 0;
      }
      v = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      suave = suave * 0.7 + v * 0.3;
      fazer.current(suave);
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, []);
}

const GRANDE = [8, 14, 22, 30, 18, 26, 12, 20, 28, 16, 10, 22, 14, 8];
const PEQUENA = [8, 14, 20, 12, 18, 10, 6];

export function Onda({
  obterVolume,
  pequena,
}: {
  obterVolume: () => number;
  pequena?: boolean;
}) {
  const alturas = pequena ? PEQUENA : GRANDE;
  const barras = useRef<(HTMLSpanElement | null)[]>([]);
  useNivel(obterVolume, (nivel) => {
    const t = performance.now() / 180;
    barras.current.forEach((b, i) => {
      if (!b) return;
      const jitter = 0.75 + 0.25 * Math.sin(t + i * 1.7);
      const escala = 0.3 + Math.min(1, nivel * 2.5) * 0.7 * jitter;
      b.style.transform = `scaleY(${escala.toFixed(3)})`;
    });
  });
  return (
    <span
      aria-hidden
      className={`flex items-center ${pequena ? "h-6 gap-[3px]" : "h-8 gap-1"}`}
    >
      {alturas.map((h, i) => (
        <span
          key={i}
          ref={(el) => {
            barras.current[i] = el;
          }}
          style={{ height: h }}
          className={`origin-center rounded-[2px] bg-terracota transition-transform duration-75 ${pequena ? "w-[3px]" : "w-1"}`}
        />
      ))}
    </span>
  );
}

/** Avatar de 200 px com três anéis que respiram com a voz do agente. */
export function AvatarAoVivo({
  obterVolume,
}: {
  obterVolume: () => number;
}) {
  const aneis = useRef<(HTMLSpanElement | null)[]>([]);
  useNivel(obterVolume, (nivel) => {
    aneis.current.forEach((a, i) => {
      if (!a) return;
      const escala = 1 + Math.min(1, nivel * 2) * (0.06 + i * 0.04);
      a.style.transform = `scale(${escala.toFixed(3)})`;
    });
  });
  const classes = [
    "size-[120px] bg-terracota",
    "size-40 bg-terracota/15",
    "size-[200px] bg-terracota/8",
  ];
  return (
    <span aria-hidden className="relative flex size-[200px] items-center justify-center">
      {[2, 1, 0].map((i) => (
        <span
          key={i}
          ref={(el) => {
            aneis.current[i] = el;
          }}
          className={`absolute rounded-full transition-transform duration-100 ${classes[i]}`}
        />
      ))}
      <span className="relative flex size-[60px] items-center justify-center rounded-[30px_30px_30px_6px] bg-white font-display text-[38px] font-extrabold leading-none text-terracota">
        ?
      </span>
    </span>
  );
}
