import { Suspense } from "react";
import { Emails } from "@/components/atendimento/emails";
import { ACarregar } from "@/components/atendimento/ui";

/** Painel · Email geral (lista; o estado vem em ?estado=). */
export default function PaginaEmails() {
  return (
    <Suspense fallback={<ACarregar />}>
      <Emails />
    </Suspense>
  );
}
