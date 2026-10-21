import { Suspense } from "react";
import { PaginaReclamacoes } from "@/components/reclamacoes/reclamacoes";

export const metadata = { title: "Reclamações" };

export default function Pagina() {
  return (
    <Suspense>
      <PaginaReclamacoes />
    </Suspense>
  );
}
