import { Suspense } from "react";
import { PaginaEntregas } from "@/components/entregas/entregas-painel";

export const metadata = { title: "Entregas em nome" };

export default function Pagina() {
  return (
    <Suspense>
      <PaginaEntregas />
    </Suspense>
  );
}
