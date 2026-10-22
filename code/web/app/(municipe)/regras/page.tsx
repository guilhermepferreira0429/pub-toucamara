import type { Metadata } from "next";
import { PaginaRegras } from "@/components/regras/regras-publicas";

// Ao contrário dos links do SMS, as regras são para toda a gente encontrar.
export const metadata: Metadata = {
  title: "Regras públicas",
  description: "As regras que a câmara usa para decidir cada licença e cada obra, com o histórico e um verificador.",
  robots: { index: true, follow: true },
};

/** As regras em vigor de cada licença e de cada zona do PDM (sem login). */
export default function Pagina() {
  return <PaginaRegras />;
}
