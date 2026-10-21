"use client";

/** Grupo de botões de filtro (pílulas), com "Todos" e a opção escolhida em tinta. */
export function Filtro<T extends string>({
  rotulo,
  valor,
  opcoes,
  onMudar,
}: {
  rotulo: string;
  valor: T | "";
  opcoes: { v: T | ""; t: string }[];
  onMudar: (v: T | "") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={rotulo}>
      <span className="mr-1 text-xs font-semibold text-tinta-3">{rotulo}</span>
      {opcoes.map((o) => (
        <button
          key={o.v || "todos"}
          type="button"
          aria-pressed={valor === o.v}
          onClick={() => onMudar(o.v)}
          className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
            valor === o.v ? "border-tinta bg-tinta text-white" : "border-linha bg-creme text-tinta-2"
          }`}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}
