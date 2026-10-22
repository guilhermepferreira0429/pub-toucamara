import { ChevronLeft, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/* Peças repetidas nos ecrãs da chamada no browser (design 390 px). */

export const VERMELHO = "bg-[#C62F1F]";

/** Coluna de telemóvel: ocupa o ecrã no telemóvel, centrada no computador. */
export function Ecra({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={`mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-5 pb-7 pt-[max(8px,env(safe-area-inset-top))] lg:min-h-[min(860px,calc(100dvh-80px))] lg:px-8 lg:pt-7 ${className ?? ""}`}
    >
      {children}
    </main>
  );
}

export function Navegacao({
  passo,
  onVoltar,
}: {
  passo?: string;
  onVoltar: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-between">
      <button
        type="button"
        onClick={onVoltar}
        aria-label="Voltar"
        className="-ml-2.5 flex size-11 items-center justify-center rounded-full text-tinta hover:bg-creme-2"
      >
        <ChevronLeft className="size-6" aria-hidden />
      </button>
      {passo && (
        <span className="text-[13px] font-medium text-tinta-3">{passo}</span>
      )}
    </div>
  );
}

/** Ícone em balão (64 px), título grande e descrição: topo dos ecrãs 02. */
export function Cabecalho({
  icone: Icone,
  escuro,
  titulo,
  children,
}: {
  icone: LucideIcon;
  escuro?: boolean;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-4 pt-2">
      <span
        aria-hidden
        className={`flex size-16 items-center justify-center rounded-[32px_32px_32px_6px] ${escuro ? "bg-tinta" : "bg-terracota"}`}
      >
        <Icone className="size-7 text-white" />
      </span>
      <h1 className="font-display text-[32px] font-bold leading-[1.08] tracking-[-0.8px] text-tinta">
        {titulo}
      </h1>
      <p className="text-base leading-normal text-tinta-2">{children}</p>
    </div>
  );
}

/** O balão do logótipo com o "?" (avatar do agente). */
export function BalaoAgente({
  tamanho,
  className,
}: {
  tamanho: 44 | 60 | 72 | 120;
  className?: string;
}) {
  const estilos = {
    44: "size-11 rounded-[22px_22px_22px_6px] text-[26px] bg-terracota text-white",
    60: "size-[60px] rounded-[30px_30px_30px_6px] text-[38px] bg-white text-terracota",
    72: "size-[72px] rounded-[36px_36px_36px_9px] text-[40px] bg-terracota text-white",
    120: "size-[120px] rounded-[60px_60px_60px_14px] text-[64px] bg-terracota text-white",
  } as const;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center font-display font-extrabold leading-none ${estilos[tamanho]} ${className ?? ""}`}
    >
      ?
    </span>
  );
}

/** "A gravar · 01:42" */
export function Gravacao({
  segundos,
  compacta,
}: {
  segundos: number;
  compacta?: boolean;
}) {
  const conteudo = (
    <>
      <span
        aria-hidden
        className={`size-[7px] rounded-full ${VERMELHO} motion-safe:animate-pulse`}
      />
      <span className="text-xs font-semibold text-tinta-2">
        A gravar · <span className="tabular-nums">{relogio(segundos)}</span>
      </span>
    </>
  );
  return compacta ? (
    <span className="flex items-center gap-1.5">{conteudo}</span>
  ) : (
    <span className="flex items-center gap-1.5 rounded-full border border-linha bg-papel px-2.5 py-[5px]">
      {conteudo}
    </span>
  );
}

export function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function duracaoDita(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

/** Telefone em grupos de três: 912 345 214. */
export function telefoneDito(digitos: string): string {
  return digitos.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

/** Rótulo pequeno em maiúsculas (LEGENDAS EM DIRETO, ONDE FICÁMOS…). */
export function Rotulo({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[10px] font-bold uppercase leading-none tracking-[0.9px] text-tinta-3 ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

/** Linha de ícone + título + detalhe (listas dos ecrãs 02 e 03d). */
export function LinhaFacto({
  icone: Icone,
  corIcone = "text-tinta-2",
  titulo,
  detalhe,
}: {
  icone: LucideIcon;
  corIcone?: string;
  titulo: string;
  detalhe: string;
}) {
  return (
    <li className="flex w-full items-start gap-3.5 border-b border-linha py-3.5 last:border-b-0">
      <Icone className={`mt-0.5 size-5 shrink-0 ${corIcone}`} aria-hidden />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-tinta">{titulo}</span>
        <span className="text-sm leading-[1.4] text-tinta-2">{detalhe}</span>
      </span>
    </li>
  );
}
