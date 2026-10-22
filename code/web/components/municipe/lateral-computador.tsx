import { ArrowRight, MapPin, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { MUNICIPIO, MUNICIPIO_NOME } from "@/components/chamada/config";
import { Logo } from "@/components/ui/marca";

/*
 * Coluna da esquerda das páginas do munícipe no computador (lg+): a marca, a
 * câmara, o que pôr no meio (opções de leitura, um QR) e as outras formas de
 * falar com a câmara. No telemóvel não aparece: as páginas ficam numa coluna.
 */

const CANAIS: { href: string; rotulo: string; icone: LucideIcon; chave: string }[] = [
  { href: "/ligar", rotulo: "Ligar à câmara", icone: Phone, chave: "ligar" },
  { href: "/chat", rotulo: "Escrever no chat", icone: MessageCircle, chave: "chat" },
  { href: `/agora/${MUNICIPIO}`, rotulo: "Perto de mim", icone: MapPin, chave: "agora" },
];

export function LateralComputador({
  children,
  sem = [],
}: {
  children?: React.ReactNode;
  /** Canais a não mostrar (o da própria página). */
  sem?: ("ligar" | "chat" | "agora")[];
}) {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <Link href="/" className="w-fit" aria-label="Tou, Câmara?: sobre o projeto">
          <Logo tamanho={26} />
        </Link>
        <p className="text-[12px] font-bold uppercase tracking-[1.2px] text-terracota">
          Câmara Municipal de {MUNICIPIO_NOME}
        </p>
        <p className="text-[15px] leading-[1.55] text-tinta-2">
          Atendimento da câmara a qualquer hora. Responde com a informação oficial e diz sempre de onde
          vem.
        </p>
      </div>

      {children}

      <nav aria-label="Falar com a câmara" className="flex flex-col gap-1 border-t border-linha pt-5">
        {CANAIS.filter((c) => !sem.includes(c.chave as "ligar" | "chat" | "agora")).map((c) => {
          const Icone = c.icone;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-tinta hover:bg-papel"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-terracota-suave text-terracota-escuro">
                <Icone className="size-4" aria-hidden />
              </span>
              <span className="flex-1">{c.rotulo}</span>
              <ArrowRight
                className="size-4 text-tinta-3 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          );
        })}
      </nav>

      <p className="text-[12px] leading-[1.5] text-tinta-2">
        Demonstração do projeto Tou, Câmara? no Hack4Guimarães 2035: não é o serviço oficial da câmara.{" "}
        <Link href="/" className="font-semibold text-terracota-escuro underline underline-offset-2">
          Sobre o projeto
        </Link>
      </p>
    </div>
  );
}

/**
 * Duas colunas no computador (lateral fixa + conteúdo); no telemóvel só o
 * conteúdo, como sempre.
 */
export function GrelhaComputador({
  lateral,
  children,
  className = "",
}: {
  lateral: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-full lg:mx-auto lg:grid lg:max-w-[1160px] lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-14 lg:px-10 lg:py-10 ${className}`}
    >
      <aside aria-label="A câmara" className="hidden lg:sticky lg:top-10 lg:block">
        {lateral}
      </aside>
      {children}
    </div>
  );
}
