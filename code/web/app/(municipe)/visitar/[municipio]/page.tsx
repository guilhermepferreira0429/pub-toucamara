import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { ACarregar } from "@/components/municipe/moldura";
import { linguaValida, type Lingua } from "@/components/turismo/textos";
import { Visitar } from "@/components/turismo/visitar";

export const metadata: Metadata = {
  title: "Visitar · Visit · Visiter",
  description: "O que ver, roteiros, mapa e um assistente na sua língua (PT, EN, ES, FR).",
};

type Params = Promise<{ municipio: string }>;
type Pesquisa = Promise<Record<string, string | string[] | undefined>>;

function um(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** A língua da página: ?lingua=, senão a do browser (Accept-Language), senão português. */
function linguaDoPedido(param: string | undefined, aceita: string | null): Lingua {
  const doParam = linguaValida(param);
  if (doParam) return doParam;
  for (const parte of (aceita ?? "").split(",")) {
    const l = linguaValida(parte.split(";")[0]?.trim());
    if (l) return l;
  }
  return "pt";
}

async function Conteudo({ params, searchParams }: { params: Params; searchParams: Pesquisa }) {
  const [{ municipio }, q, h] = await Promise.all([params, searchParams, headers()]);
  const minutos = Number(um(q.minutos));
  return (
    <Visitar
      key={municipio}
      slug={decodeURIComponent(municipio)}
      linguaInicial={linguaDoPedido(um(q.lingua), h.get("accept-language"))}
      pedido={
        Number.isInteger(minutos) && minutos >= 30 && minutos <= 720
          ? { minutos, interesses: um(q.interesses), mobilidade: um(q.mobilidade) === "1" }
          : undefined
      }
    />
  );
}

/** Entrada própria para turistas (link do portal, QR do posto de turismo e do agente). */
export default function Pagina({ params, searchParams }: { params: Params; searchParams: Pesquisa }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} searchParams={searchParams} />
    </Suspense>
  );
}
