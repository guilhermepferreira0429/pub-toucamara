"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { classeEntrada } from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { comErro } from "./comum";

/** Escolher freguesias: as conhecidas numa lista de sugestões, e outras à mão. */
export function EscolherFreguesias({
  id,
  valor,
  onMudar,
  conhecidas,
  erro,
  descricao,
}: {
  id: string;
  valor: string[];
  onMudar: (v: string[]) => void;
  conhecidas: string[];
  erro?: string;
  descricao?: string;
}) {
  const [nova, setNova] = useState("");
  const juntar = () => {
    const f = nova.trim();
    if (f.length >= 2 && !valor.includes(f)) onMudar([...valor, f]);
    setNova("");
  };
  const sugestoes = conhecidas.filter((f) => !valor.includes(f));
  return (
    <div className="flex flex-col gap-2">
      {valor.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Freguesias escolhidas">
          {valor.map((f) => (
            <li key={f} className="inline-flex items-center gap-1 rounded-full bg-creme-2 py-1 pl-3 pr-1 text-[13px] text-tinta">
              {f}
              <button
                type="button"
                aria-label={`Tirar ${f}`}
                className="flex size-11 items-center justify-center rounded-full text-tinta-3 hover:text-terracota"
                onClick={() => onMudar(valor.filter((x) => x !== f))}
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          className={comErro(`${classeEntrada} min-h-11`, erro)}
          list={`${id}-lista`}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              juntar();
            }
          }}
          placeholder="Nome da freguesia"
          aria-invalid={!!erro}
          aria-describedby={descricao}
        />
        <datalist id={`${id}-lista`}>
          {sugestoes.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <Botao variante="secundario" className="min-h-11" onClick={juntar}>
          Juntar
        </Botao>
      </div>
    </div>
  );
}
