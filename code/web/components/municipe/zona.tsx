"use client";

import { FileText, MapPin, MessageCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { BotaoLink } from "@/components/ui/botao";
import { COR_CATEGORIA, type Ponto } from "@/components/ordenamento/tipos";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  ModoTeste,
  Nota,
  ROTA_CHAT,
  Rotulo,
  TituloSecao,
  Topo,
} from "./moldura";
import { usePublico } from "./use-publico";

/*
 * "O que posso fazer nesta morada" (link do SMS): a planta com a zona do
 * PDM e o ponto da morada, o controlo que a obra precisa e os passos.
 */

const Mapa = dynamic(() => import("@/components/ordenamento/mapa-zonas"), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-2xl bg-creme-2" />,
});

type Controlo = "isento" | "comunicacao_previa" | "licenca" | "nao_permitido";

interface Consulta {
  morada: string;
  lat: number | null;
  lng: number | null;
  obra: string;
  obra_texto: string;
  municipio: string;
  criada_em: string;
  resultado: {
    controlo: Controlo | null;
    controlo_dito: string | null;
    limites: string[];
    notas: string[];
    passos: string[];
  };
  zona: {
    codigo: string;
    nome: string;
    categoria: string;
    descricao: string | null;
    poligono: Ponto[];
    demonstracao: boolean;
    fonte: { titulo: string; artigo: string | null; url: string | null };
  } | null;
}

const DESTAQUE: Record<Controlo, { titulo: string; tom: "verde" | "terracota" | "tinta" }> = {
  isento: { titulo: "Não precisa de pedir nada", tom: "verde" },
  comunicacao_previa: { titulo: "Precisa de uma comunicação prévia", tom: "terracota" },
  licenca: { titulo: "Precisa de licença", tom: "terracota" },
  nao_permitido: { titulo: "Não é permitido nesta zona", tom: "tinta" },
};

export function PaginaZona({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<Consulta>(
    `/v1/public/consultas-pdm/${encodeURIComponent(codigo)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const d = c.dados;
  const r = d.resultado;
  const destaque = r.controlo ? DESTAQUE[r.controlo] : null;
  const ponto: Ponto | null = d.lat !== null && d.lng !== null ? [d.lat, d.lng] : null;

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="O que posso fazer" />
      <Cabecalho meta={`Câmara Municipal de ${d.municipio}`} titulo={d.obra_texto} sub={d.morada} />

      {destaque ? (
        <CartaoDestaque rotulo={d.zona?.nome ?? "Resposta"} tom={destaque.tom}>
          <p className="font-display text-[26px] leading-tight font-bold">{destaque.titulo}</p>
          {d.zona?.descricao && <p className="text-[15px] text-white/90">{d.zona.descricao}</p>}
        </CartaoDestaque>
      ) : (
        <Nota icone={MapPin} tom="ambar">
          Um técnico da câmara tem de ver o seu caso.
        </Nota>
      )}

      {d.zona && (
        <section className="flex flex-col gap-2">
          <Rotulo>A sua morada no plano</Rotulo>
          <div className="overflow-hidden rounded-2xl border border-linha">
            <Mapa
              zonas={[d.zona]}
              pontos={ponto ? [{ id: "morada", lat: ponto[0], lng: ponto[1], cor: "#1b2a3a", rotulo: d.morada }] : []}
              enquadrar={d.zona.poligono}
              className="h-64 w-full"
            />
          </div>
          <p className="flex items-center gap-2 text-[13px] text-tinta-2">
            <span
              aria-hidden
              className="inline-block size-3 rounded-sm"
              style={{ background: COR_CATEGORIA[d.zona.categoria] ?? "#555" }}
            />
            {d.zona.nome}
          </p>
        </section>
      )}

      {r.limites.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="limites">
          <TituloSecao id="limites">Os limites nesta zona</TituloSecao>
          <ul className="flex flex-col gap-1.5">
            {r.limites.map((l) => (
              <li key={l} className="text-[15px] text-tinta">
                {l}
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.passos.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="passos">
          <TituloSecao id="passos">O que fazer a seguir</TituloSecao>
          <ol className="flex flex-col gap-2.5">
            {r.passos.map((p, i) => (
              <li key={p} className="flex items-start gap-3 text-[15px] leading-[1.45] text-tinta">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-terracota text-[13px] font-bold text-white">
                  {i + 1}
                </span>
                {p}
              </li>
            ))}
          </ol>
        </section>
      )}

      {r.notas.length > 0 && (
        <Nota icone={FileText} tom="neutro">
          {r.notas.join(" ")}
        </Nota>
      )}

      {(r.controlo === "comunicacao_previa" || r.controlo === "licenca") && (
        <BotaoLink href={ROTA_CHAT} tamanho="grande" icone={MessageCircle} className="w-full">
          Preencher o pedido com o agente
        </BotaoLink>
      )}

      <div className="flex flex-wrap gap-2">
        {d.zona?.demonstracao && <ModoTeste texto="zonas e regras de demonstração" />}
      </div>
      {d.zona && (
        <p className="text-[13px] leading-[1.45] text-tinta-3">
          Base: {d.zona.fonte.titulo}
          {d.zona.fonte.artigo ? `, ${d.zona.fonte.artigo}` : ""}. Esta página é informativa: a decisão final é
          sempre da câmara.
        </p>
      )}
    </div>
  );
}
