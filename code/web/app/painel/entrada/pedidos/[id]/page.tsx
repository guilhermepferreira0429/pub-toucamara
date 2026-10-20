import { Suspense } from "react";
import { Entrada } from "@/components/atendimento/entrada";
import { ACarregar } from "@/components/atendimento/ui";

/** Pedido de balcão aberto na Entrada (o link_painel dos pedidos). */
export default function PaginaPedido() {
  return (
    <Suspense fallback={<ACarregar />}>
      <Entrada />
    </Suspense>
  );
}
