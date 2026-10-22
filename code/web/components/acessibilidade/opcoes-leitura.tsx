"use client";

import { ChevronDown, Contrast, Type } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";
import {
  definirPreferencias,
  lerPreferencias,
  type NivelLetra,
  type Preferencias,
  subscreverPreferencias,
} from "@/lib/acessibilidade";
import { OuvirPagina } from "./ouvir";

/*
 * Barra "Opções de leitura" no topo das páginas do munícipe: ouvir a página,
 * letra maior (A, A+, A++) e alto contraste. As escolhas ficam guardadas no
 * telemóvel (localStorage) e aplicam-se a todas as páginas dos links do SMS.
 */

const NIVEIS: { nivel: NivelLetra; rotulo: string; nome: string; classe: string }[] = [
  { nivel: 0, rotulo: "A", nome: "Letra normal", classe: "text-[15px]" },
  { nivel: 1, rotulo: "A+", nome: "Letra maior", classe: "text-[18px]" },
  { nivel: 2, rotulo: "A++", nome: "Letra muito maior", classe: "text-[21px]" },
];

// Cache para o useSyncExternalStore devolver sempre o mesmo objeto.
let ultima: Preferencias | null = null;
function instantaneo(): Preferencias {
  const p = lerPreferencias();
  if (!ultima || ultima.letra !== p.letra || ultima.contraste !== p.contraste) ultima = p;
  return ultima;
}
const NO_SERVIDOR: Preferencias = { letra: 0, contraste: false };

export function OpcoesLeitura() {
  const pref = useSyncExternalStore(subscreverPreferencias, instantaneo, () => NO_SERVIDOR);
  const [aberto, setAberto] = useState(false);
  const painel = useId();

  const opcao =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border-[1.5px] px-3 font-semibold";

  return (
    <section
      aria-label="Opções de leitura"
      data-nao-ler
      className="flex w-full flex-col gap-3 pb-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <OuvirPagina />
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={painel}
          onClick={() => setAberto((a) => !a)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-[1.5px] border-tinta px-4 text-[15px] font-semibold text-tinta hover:bg-tinta/5"
        >
          <Type className="size-5" aria-hidden />
          Letra e contraste
          <ChevronDown
            className={`size-4 transition-transform ${aberto ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </div>

      <div
        id={painel}
        hidden={!aberto}
        className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-4"
      >
        <div role="group" aria-labelledby={`${painel}-letra`} className="flex flex-col gap-2">
          <p id={`${painel}-letra`} className="text-[15px] font-semibold text-tinta">
            Tamanho da letra
          </p>
          <div className="flex gap-2">
            {NIVEIS.map((n) => {
              const escolhido = pref.letra === n.nivel;
              return (
                <button
                  key={n.nivel}
                  type="button"
                  aria-pressed={escolhido}
                  aria-label={n.nome}
                  onClick={() => definirPreferencias({ ...pref, letra: n.nivel })}
                  className={`${opcao} ${n.classe} ${
                    escolhido
                      ? "border-tinta bg-tinta text-white"
                      : "border-tinta text-tinta hover:bg-tinta/5"
                  }`}
                >
                  {n.rotulo}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          aria-pressed={pref.contraste}
          onClick={() => definirPreferencias({ ...pref, contraste: !pref.contraste })}
          className={`${opcao} w-full gap-2 text-[15px] ${
            pref.contraste
              ? "border-tinta bg-tinta text-white"
              : "border-tinta text-tinta hover:bg-tinta/5"
          }`}
        >
          <Contrast className="size-5" aria-hidden />
          Alto contraste
          <span aria-hidden className="font-medium">
            {pref.contraste ? "· ligado" : "· desligado"}
          </span>
        </button>
      </div>
    </section>
  );
}
