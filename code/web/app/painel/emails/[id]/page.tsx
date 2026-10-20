import { Suspense } from "react";
import { Emails } from "@/components/atendimento/emails";
import { ACarregar } from "@/components/atendimento/ui";

/** Painel · Email geral com um email aberto (o id só se sabe no pedido). */
export default function PaginaEmail() {
  return (
    <Suspense fallback={<ACarregar />}>
      <Emails />
    </Suspense>
  );
}
