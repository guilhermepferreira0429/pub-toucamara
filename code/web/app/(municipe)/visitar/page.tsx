import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ACarregar } from "@/components/municipe/moldura";

type Pesquisa = Promise<Record<string, string | string[] | undefined>>;

async function Redirecionar({ searchParams }: { searchParams: Pesquisa }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") q.set(k, v);
  }
  const resto = q.toString();
  redirect(`/visitar/${encodeURIComponent(process.env.NEXT_PUBLIC_MUNICIPIO ?? "guimaraes")}${resto ? `?${resto}` : ""}`);
  return null;
}

/** /visitar sem município → a página da câmara deste site (mantém ?lingua=…). */
export default function Pagina({ searchParams }: { searchParams: Pesquisa }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Redirecionar searchParams={searchParams} />
    </Suspense>
  );
}
