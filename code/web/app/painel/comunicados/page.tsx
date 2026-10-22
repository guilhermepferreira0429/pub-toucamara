import { Suspense } from "react";
import { PaginaPublicacoes } from "@/components/publicacoes/publicacoes";

export const metadata = { title: "Comunicados e eventos" };

type Pesquisa = Promise<{ ver?: string | string[] }>;

async function Conteudo({ searchParams }: { searchParams: Pesquisa }) {
  const { ver } = await searchParams;
  return <PaginaPublicacoes inicial={ver === "eventos" ? "eventos" : "comunicados"} />;
}

/** Painel · Comunicados e eventos do feed /agora (?ver=eventos abre os eventos). */
export default function Pagina({ searchParams }: { searchParams: Pesquisa }) {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-tinta-3">A carregar…</p>}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}
