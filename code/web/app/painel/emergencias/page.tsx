import { Suspense } from "react";
import { PaginaEmergencias } from "@/components/emergencias/emergencias";

export const metadata = { title: "Emergências" };

export default function Pagina() {
  return (
    <Suspense>
      <PaginaEmergencias />
    </Suspense>
  );
}
