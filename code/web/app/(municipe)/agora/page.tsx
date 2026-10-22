import { redirect } from "next/navigation";

/** /agora sem município → o feed da câmara deste site. */
export default function Pagina() {
  redirect(`/agora/${encodeURIComponent(process.env.NEXT_PUBLIC_MUNICIPIO ?? "guimaraes")}`);
}
