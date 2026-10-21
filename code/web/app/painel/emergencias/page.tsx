import { Suspense } from "react";
import { PaginaEmergencias } from "@/components/emergencias/emergencias";

export const metadata = { title: "Avisos de emergência" };

export default function Pagina() {
  return (
    <Suspense>
      <PaginaEmergencias />
    </Suspense>
  );
}
