import { Accessibility } from "lucide-react";
import Link from "next/link";
import { PedirLgp } from "./lingua-gestual";

/** Rodapé das páginas do munícipe: Língua Gestual e a declaração de acessibilidade. */
export function RodapeMunicipe() {
  return (
    <footer
      data-nao-ler
      className="mt-10 flex w-full flex-col gap-5 border-t border-linha pt-6 text-tinta"
    >
      <PedirLgp />
      <Link
        href="/acessibilidade"
        className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-terracota-escuro underline"
      >
        <Accessibility className="size-5" aria-hidden />
        Declaração de acessibilidade
      </Link>
    </footer>
  );
}
