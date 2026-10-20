import { Suspense } from "react";
import { Respostas } from "@/components/conhecimento/respostas";

export const metadata = { title: "Respostas · Conhecimento" };

/** Lista e detalhe (?id=) das respostas curadas. */
export default function PaginaRespostas() {
  return (
    <Suspense>
      <Respostas />
    </Suspense>
  );
}
