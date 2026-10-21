import { Suspense } from "react";
import { DetalheCampanha } from "@/components/campanhas/campanha";

export const metadata = { title: "Campanha" };

/** Uma campanha de contacto, ao vivo enquanto há chamadas por fazer. */
export default function Pagina() {
  return (
    <Suspense>
      <DetalheCampanha />
    </Suspense>
  );
}
