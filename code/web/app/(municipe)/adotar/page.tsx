import { PaginaAdotar } from "@/components/municipe/adotar";

export const metadata = {
  title: "Adotar um animal",
  description: "Os cães e gatos do canil municipal à espera de casa.",
};

/** /adotar: os animais do canil municipal (a câmara deste site). */
export default function Pagina() {
  return <PaginaAdotar slug={process.env.NEXT_PUBLIC_MUNICIPIO ?? "guimaraes"} />;
}
