import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

type Variante = "principal" | "secundario" | "discreto";
type Tamanho = "grande" | "medio" | "pequeno";

const VARIANTES: Record<Variante, string> = {
  principal:
    "bg-terracota text-white hover:bg-terracota-escuro disabled:bg-terracota/50",
  secundario:
    "border-[1.5px] border-tinta text-tinta hover:bg-tinta/5 disabled:opacity-50",
  discreto: "text-tinta-2 hover:bg-creme-2 disabled:opacity-50",
};

// "grande" é o botão do design (56 px, para o telemóvel); "medio" e
// "pequeno" são os do painel.
const TAMANHOS: Record<Tamanho, string> = {
  grande: "h-14 px-6 text-[17px] gap-2.5 rounded-full",
  medio: "h-10 px-4 text-sm gap-2 rounded-full",
  pequeno: "h-8 px-3 text-[13px] gap-1.5 rounded-full",
};

function classes(v: Variante, t: Tamanho, extra?: string) {
  return `inline-flex items-center justify-center font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTES[v]} ${TAMANHOS[t]} ${extra ?? ""}`;
}

interface Comum {
  variante?: Variante;
  tamanho?: Tamanho;
  icone?: LucideIcon;
}

export function Botao({
  variante = "principal",
  tamanho = "medio",
  icone: Icone,
  className,
  children,
  ...resto
}: Comum & ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={classes(variante, tamanho, className)}
      {...resto}
    >
      {Icone && <Icone className="size-[1.15em]" aria-hidden />}
      {children}
    </button>
  );
}

export function BotaoLink({
  variante = "principal",
  tamanho = "medio",
  icone: Icone,
  className,
  children,
  ...resto
}: Comum & ComponentProps<typeof Link>) {
  return (
    <Link className={classes(variante, tamanho, className)} {...resto}>
      {Icone && <Icone className="size-[1.15em]" aria-hidden />}
      {children}
    </Link>
  );
}

/** Etiqueta pequena (estados, contagens). */
export function Etiqueta({
  tom = "neutro",
  children,
  className,
}: {
  tom?: "neutro" | "terracota" | "verde" | "ambar" | "tinta";
  children: React.ReactNode;
  className?: string;
}) {
  const tons = {
    neutro: "bg-creme-2 text-tinta-2",
    terracota: "bg-terracota-suave text-terracota-escuro",
    verde: "bg-verde-suave text-verde",
    ambar: "bg-ambar-suave text-ambar",
    tinta: "bg-tinta text-white",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tons[tom]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
