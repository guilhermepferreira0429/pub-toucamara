import type { Metadata } from "next";
import { PaginaVisao } from "@/components/apresentacao/visao";

export const metadata: Metadata = {
  title: "Visão",
  description:
    "Para onde vai o Tou, Câmara?: a câmara que não esquece, do concelho às outras 307 câmaras, e mais serviços. O que já existe está marcado como tal.",
};

export default function Pagina() {
  return <PaginaVisao />;
}
