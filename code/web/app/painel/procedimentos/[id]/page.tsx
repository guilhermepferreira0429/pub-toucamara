import { Suspense } from "react";
import { DetalheProcedimento } from "@/components/procedimentos/procedimento";

export const metadata = { title: "Procedimento" };

/** Um procedimento interno: ler, editar (versões) e publicar. */
export default function Pagina() {
  return (
    <Suspense>
      <DetalheProcedimento />
    </Suspense>
  );
}
