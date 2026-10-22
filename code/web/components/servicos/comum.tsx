"use client";

import { FlaskConical } from "lucide-react";
import { Pilula } from "@/components/conhecimento/comum";

/*
 * Peças comuns às páginas do painel do catálogo de serviços (cemitérios,
 * animais, água): separadores, filtros em pílulas e a pílula "valores de
 * demonstração".
 */

export function Separadores<T extends string>({
  valor,
  opcoes,
  onMudar,
  rotulo,
}: {
  valor: T;
  opcoes: readonly (readonly [T, string])[];
  onMudar: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto px-4 pb-4 sm:px-10 [&>*]:shrink-0 [&>*]:whitespace-nowrap" role="tablist" aria-label={rotulo}>
      {opcoes.map(([v, texto]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={valor === v}
          onClick={() => onMudar(v)}
          className={`border-b-2 px-3 py-2 text-sm font-semibold ${
            valor === v ? "border-terracota text-tinta" : "border-transparent text-tinta-3 hover:text-tinta-2"
          }`}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

export function Filtros<T extends string>({
  valor,
  opcoes,
  onMudar,
  rotulo,
  contagens,
}: {
  valor: T | "";
  opcoes: readonly (readonly [T | "", string])[];
  onMudar: (v: T | "") => void;
  rotulo: string;
  contagens?: Partial<Record<string, number>>;
}) {
  return (
    <div className="flex flex-wrap gap-2 pb-4" role="group" aria-label={rotulo}>
      {opcoes.map(([v, texto]) => {
        const n = v ? contagens?.[v] : undefined;
        return (
          <button
            key={v || "todos"}
            type="button"
            aria-pressed={valor === v}
            onClick={() => onMudar(v)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
              valor === v ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
            }`}
          >
            {texto}
            {n ? ` · ${n}` : ""}
          </button>
        );
      })}
    </div>
  );
}

export function PilulaDemonstracao({ texto = "valores de demonstração" }: { texto?: string }) {
  return (
    <Pilula tom="ambar" icone={FlaskConical}>
      {texto}
    </Pilula>
  );
}
