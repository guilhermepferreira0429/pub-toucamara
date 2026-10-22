"use client";

import { ChevronRight, Download, FileCheck2, Map as MapaIcone } from "lucide-react";
import Link from "next/link";
import { MUNICIPIO } from "@/components/chamada/config";
import { dataLonga } from "@/components/municipe/formatar";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  LinkInvalido,
  ModoTeste,
  Nota,
  Rotulo,
  TituloSecao,
  Topo,
} from "@/components/municipe/moldura";
import { usePublico } from "@/components/municipe/use-publico";
import { CATEGORIA_ROTULO } from "@/components/ordenamento/tipos";
import { API_URL } from "@/lib/api";
import type { Resumo } from "./tipos";

/*
 * "Regras públicas e verificáveis": as regras em vigor de cada licença e
 * de cada zona do PDM, as mesmas que o assistente aplica. Qualquer
 * munícipe, arquiteto ou empresa sabe a resposta antes de fazer o pedido.
 */

function Linha({ href, titulo, sub, demo }: { href: string; titulo: string; sub: string; demo: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-16 items-center gap-3 rounded-2xl border border-linha bg-papel p-4 transition-colors hover:border-terracota focus-visible:outline-2 focus-visible:outline-terracota"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[16px] font-bold text-tinta">{titulo}</span>
          <span className="text-[13px] text-tinta-3">{sub}</span>
          {demo && (
            <span>
              <ModoTeste texto="valores de demonstração" />
            </span>
          )}
        </span>
        <ChevronRight className="size-5 shrink-0 text-tinta-2" aria-hidden />
      </Link>
    </li>
  );
}

export function PaginaRegras({ municipio = MUNICIPIO }: { municipio?: string }) {
  const { c, tentarOutraVez } = usePublico<Resumo>(`/v1/public/regras/${encodeURIComponent(municipio)}`);
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;
  const d = c.dados;

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="Regras públicas" />
      <Cabecalho
        meta={`Câmara Municipal de ${d.municipio.nome}`}
        titulo="As regras, à vista de todos"
        sub="Estas são as regras que a câmara usa para decidir cada pedido. São as mesmas para todos. Veja-as, e verifique o seu caso antes de pedir."
      />
      <Nota icone={FileCheck2} tom="verde">
        Quando um pedido cumpre todas as regras, a câmara pode decidi-lo logo. Quando não cumpre, vai a uma pessoa, que
        vê o motivo concreto.
      </Nota>

      <section className="flex flex-col gap-3" aria-labelledby="licencas">
        <TituloSecao id="licencas">Licenças</TituloSecao>
        <ul className="flex flex-col gap-2.5">
          {d.licencas.map((l) => (
            <Linha
              key={l.tipo}
              href={`/regras/licencas/${l.tipo}`}
              titulo={l.nome}
              sub={`${l.regras.length} regras · em vigor desde ${dataLonga(l.vigor_desde)}${l.alteracoes ? ` · ${l.alteracoes} ${l.alteracoes === 1 ? "alteração" : "alterações"}` : ""}`}
              demo={l.demonstracao}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="zonas">
        <TituloSecao id="zonas">Obras e o plano diretor municipal</TituloSecao>
        {d.zonas.length === 0 ? (
          <p className="text-[15px] text-tinta-2">Ainda não há zonas do plano diretor municipal publicadas.</p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-[14px] text-tinta-2">
              <MapaIcone className="size-4 text-terracota" aria-hidden />
              O que é preciso para cada obra depende da zona onde fica.
            </p>
            <ul className="flex flex-col gap-2.5">
              {d.zonas.map((z) => (
                <Linha
                  key={z.codigo}
                  href={`/regras/zonas/${z.codigo}`}
                  titulo={z.nome}
                  sub={`${CATEGORIA_ROTULO[z.categoria] ?? z.categoria} · ${z.obras.length} obras · em vigor desde ${dataLonga(z.vigor_desde)}`}
                  demo={z.demonstracao}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="auditar">
        <Rotulo id="auditar">Para quem quer auditar</Rotulo>
        <a
          href={`${API_URL}/v1/public/regras/${encodeURIComponent(d.municipio.slug)}/regras.json`}
          className="inline-flex min-h-12 items-center gap-2 text-[15px] font-semibold text-terracota underline underline-offset-2"
        >
          <Download className="size-4" aria-hidden />
          Descarregar todas as regras e o histórico (JSON)
        </a>
      </section>
      <p className="text-[13px] leading-[1.45] text-tinta-3">{d.nota}</p>
    </div>
  );
}
