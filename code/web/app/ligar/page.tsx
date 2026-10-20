import type { Metadata } from "next";
import { ChamadaNoBrowser } from "@/components/chamada/fluxo-chamada";

export const metadata: Metadata = {
  title: "Ligar à câmara",
  description:
    "Fale com a câmara pelo browser: obras, licenças e documentos, a qualquer hora.",
};

export default function PaginaLigar() {
  return <ChamadaNoBrowser />;
}
