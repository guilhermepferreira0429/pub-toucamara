import type { Metadata } from "next";
import { PaginaApresentacao } from "@/components/apresentacao/pagina";

export const metadata: Metadata = {
  title: "Tou, Câmara? · A câmara inteira, numa só plataforma",
  description:
    "Uma porta para o munícipe, um sistema para a câmara: o munícipe trata do assunto numa conversa, a câmara liga primeiro e decide na hora o que é simples.",
};

/** A raiz do site: a apresentação do projeto, com os links para experimentar. */
export default function Pagina() {
  return <PaginaApresentacao />;
}
