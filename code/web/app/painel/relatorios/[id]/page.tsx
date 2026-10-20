import { Suspense } from "react";
import { DetalheRelatorio } from "@/components/relatorios/relatorio";

export const metadata = { title: "Relatório" };

/** O relatório como no design (a partir de `dados`), com o PDF. */
export default function PaginaRelatorio() {
  return (
    <Suspense>
      <DetalheRelatorio />
    </Suspense>
  );
}
