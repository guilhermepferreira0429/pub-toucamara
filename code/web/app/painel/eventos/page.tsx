import { redirect } from "next/navigation";

/** Os eventos são um separador da página de comunicados. */
export default function Pagina() {
  redirect("/painel/comunicados?ver=eventos");
}
