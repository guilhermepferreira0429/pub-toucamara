import type { Metadata } from "next";
import { PaginaFuncionalidades } from "@/components/apresentacao/funcionalidades";

export const metadata: Metadata = {
  title: "Funcionalidades",
  description:
    "Tudo o que o Tou, Câmara? já faz, por área, com o estado de cada coisa: a funcionar, em modo de teste ou com dados de demonstração.",
};

export default function Pagina() {
  return <PaginaFuncionalidades />;
}
