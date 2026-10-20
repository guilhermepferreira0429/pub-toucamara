import { Suspense } from "react";
import { ApoioTecnico } from "@/components/processos/apoio-tecnico";
import { ACarregar } from "@/components/processos/ui";

export default function PaginaApoioTecnico() {
  return (
    <Suspense fallback={<ACarregar className="px-10 pt-10" />}>
      <ApoioTecnico />
    </Suspense>
  );
}
