import type { Metadata } from "next";
import { PaginaApresentacao } from "@/components/apresentacao/pagina";

export const metadata: Metadata = {
  title: "Tou, Câmara? · A câmara que atende",
  description:
    "Um assistente que atende os munícipes de Guimarães por telefone, chat, SMS e app, responde só com informação oficial e trata do assunto durante a conversa.",
};

/** A raiz do site: a apresentação do projeto, com os links para experimentar. O portal com o chat está em /portal. */
export default function Pagina() {
  return <PaginaApresentacao />;
}
