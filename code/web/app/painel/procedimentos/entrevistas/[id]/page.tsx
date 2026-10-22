import { Suspense } from "react";
import { PaginaEntrevista } from "@/components/procedimentos/entrevista";

export const metadata = { title: "Entrevista" };

/** Entrevista de quem se vai reformar: perguntas uma a uma, por escrito ou por voz. */
export default function Pagina() {
  return (
    <Suspense>
      <PaginaEntrevista />
    </Suspense>
  );
}
