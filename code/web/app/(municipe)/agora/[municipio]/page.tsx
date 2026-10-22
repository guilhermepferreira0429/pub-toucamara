import { Suspense } from "react";
import { FeedAgora } from "@/components/agora/feed";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "O que se passa perto de mim" };

type Params = Promise<{ municipio: string }>;
type Pesquisa = Promise<Record<string, string | string[] | undefined>>;

function um(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function Conteudo({ params, searchParams }: { params: Params; searchParams: Pesquisa }) {
  const [{ municipio }, q] = await Promise.all([params, searchParams]);
  return (
    <FeedAgora
      key={municipio}
      slug={decodeURIComponent(municipio)}
      inicial={{ freguesia: um(q.freguesia), tipos: um(q.tipos) }}
    />
  );
}

/** "O que se passa perto de mim": obras, incidentes, avisos, eventos e consultas (link dos SMS). */
export default function Pagina({ params, searchParams }: { params: Params; searchParams: Pesquisa }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} searchParams={searchParams} />
    </Suspense>
  );
}
