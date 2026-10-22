"use client";

import { useEffect, useState } from "react";

/* Balão agente (o6dli1) e balão pessoa (hjS7r) do design. */

const URL_OU_NEGRITO = /(https?:\/\/[^\s)<>]+|\*\*[^*]+\*\*)/g;

/** Texto do agente: quebras de linha, links clicáveis e **negrito**. */
function TextoRico({ texto }: { texto: string }) {
  const partes = texto.split(URL_OU_NEGRITO);
  return (
    <>
      {partes.map((p, i) => {
        if (/^https?:\/\//.test(p)) {
          const limpo = p.replace(/[.,;:!?]+$/, "");
          const resto = p.slice(limpo.length);
          return (
            <span key={i}>
              <a
                href={limpo}
                target="_blank"
                rel="noreferrer"
                className="break-all font-medium text-terracota-escuro underline"
              >
                {limpo.replace(/^https?:\/\//, "")}
              </a>
              {resto}
            </span>
          );
        }
        if (/^\*\*[^*]+\*\*$/.test(p)) {
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/**
 * Revela o texto em streaming de forma suave: os deltas da API chegam aos
 * bocados; aqui avançam por frames, mais depressa quanto mais atrasados.
 * Com "reduzir movimento", aparece de uma vez.
 */
function useTextoSuave(texto: string, aCorrer: boolean) {
  const [n, setN] = useState(aCorrer ? 0 : texto.length);
  useEffect(() => {
    if (n >= texto.length) return;
    const id = requestAnimationFrame(() => {
      const reduzir = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      setN((v) =>
        reduzir
          ? texto.length
          : Math.min(
              texto.length,
              v + Math.max(2, Math.ceil((texto.length - v) / 6)),
            ),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [n, texto]);
  return texto.slice(0, Math.min(n, texto.length));
}

export function BalaoAgente({
  texto,
  aCorrer = false,
}: {
  texto: string;
  aCorrer?: boolean;
}) {
  const visivel = useTextoSuave(texto, aCorrer);
  return (
    <div className="w-fit max-w-full rounded-[4px_18px_18px_18px] border border-linha bg-papel px-4 py-3">
      <p className="whitespace-pre-line break-words text-[15px] leading-[1.45] text-tinta">
        <TextoRico texto={visivel} />
      </p>
    </div>
  );
}

export function BalaoPessoa({ texto }: { texto: string }) {
  return (
    <div className="w-fit max-w-full rounded-[18px_4px_18px_18px] bg-terracota px-4 py-3">
      <p className="whitespace-pre-line break-words text-[15px] leading-[1.45] text-white">
        {texto}
      </p>
    </div>
  );
}

/** "A escrever…" / "A consultar…": três pontos e o que está a fazer. */
export function IndicadorAEscrever({ rotulo }: { rotulo: string }) {
  return (
    <div className="flex w-fit items-center gap-2.5 rounded-[4px_18px_18px_18px] border border-linha bg-papel px-4 py-3">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-tinta-3 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
      <span className="text-[13px] text-tinta-2">{rotulo}</span>
    </div>
  );
}

/** Respostas rápidas (chips com contorno terracota). */
export function RespostasRapidas({
  opcoes,
  aoEscolher,
  desativado,
  pequeno = false,
}: {
  opcoes: string[];
  aoEscolher: (texto: string) => void;
  desativado?: boolean;
  pequeno?: boolean;
}) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Sugestões">
      {opcoes.map((o) => (
        <li key={o}>
          <button
            type="button"
            disabled={desativado}
            onClick={() => aoEscolher(o)}
            className={`rounded-full border border-terracota font-semibold text-terracota-escuro transition-colors hover:bg-terracota-suave disabled:opacity-50 ${pequeno ? "min-h-9 px-3.5 py-[7px] text-[13px]" : "min-h-11 px-4 py-2 text-[15px]"}`}
          >
            {o}
          </button>
        </li>
      ))}
    </ul>
  );
}
