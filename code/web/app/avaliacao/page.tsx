import type { Metadata } from "next";
import { PaginaAvaliacao } from "@/components/apresentacao/avaliacao";

export const metadata: Metadata = {
  title: "Avaliação",
  description:
    "As perguntas de teste, a resposta do assistente, a resposta certa com a fonte e o veredicto do juiz, uma a uma.",
};

/** A avaliação à vista de todos (sem login). */
export default function Pagina() {
  return <PaginaAvaliacao />;
}
