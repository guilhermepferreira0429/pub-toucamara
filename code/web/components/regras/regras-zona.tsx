"use client";

import { Check, FileText, LoaderCircle, MapPin, ShieldCheck, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { MUNICIPIO } from "@/components/chamada/config";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  Nota,
  TituloSecao,
  Topo,
} from "@/components/municipe/moldura";
import { mensagemDe, usePublico } from "@/components/municipe/use-publico";
import { CATEGORIA_ROTULO, COR_CATEGORIA } from "@/components/ordenamento/tipos";
import { Botao } from "@/components/ui/botao";
import { api } from "@/lib/api";
import { BaseLegal, EmVigorDesde, Historico } from "./comum";
import { Voltar } from "./regras-licenca";
import type { ResultadoZona, ZonaDetalhe } from "./tipos";
import { classeCampo } from "./verificador";

/*
 * As regras de uma zona do PDM: por obra, o que é preciso até cada limite;
 * a planta; o histórico; e o verificador (a mesma resposta que o assistente
 * dá ao telefone).
 */

const Mapa = dynamic(() => import("@/components/ordenamento/mapa-zonas"), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-2xl bg-creme-2" />,
});

export function PaginaRegrasZona({ codigo, municipio = MUNICIPIO }: { codigo: string; municipio?: string }) {
  const { c, tentarOutraVez } = usePublico<ZonaDetalhe>(
    `/v1/public/regras/${encodeURIComponent(municipio)}/zonas/${encodeURIComponent(codigo)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;
  const z = c.dados;

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="Regras públicas" />
      <Voltar />
      <Cabecalho
        meta={`Plano diretor municipal · ${CATEGORIA_ROTULO[z.categoria] ?? z.categoria}`}
        titulo={z.nome}
        sub={z.descricao ?? undefined}
      />
      <EmVigorDesde versao={z.versao} desde={z.vigor_desde} />

      <div className="overflow-hidden rounded-2xl border border-linha" aria-hidden>
        <Mapa zonas={[z]} pontos={[]} enquadrar={z.poligono} className="h-56 w-full" />
      </div>
      <p className="flex items-center gap-2 text-[13px] text-tinta-2">
        <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: COR_CATEGORIA[z.categoria] ?? "#555" }} />
        Área da zona {z.nome}
      </p>

      <section className="flex flex-col gap-3" aria-labelledby="obras">
        <TituloSecao id="obras">O que é preciso, por obra</TituloSecao>
        <ul className="flex flex-col gap-3">
          {z.obras.map((o) => (
            <li key={o.obra} className="flex flex-col gap-1.5 rounded-2xl border border-linha bg-papel p-4">
              <p className="text-[16px] font-bold text-tinta">{o.nome}</p>
              {o.frases.map((f) => (
                <p key={f} className="text-[15px] leading-[1.45] text-tinta">
                  {f}
                </p>
              ))}
              {o.notas.length > 0 && <p className="text-[13px] text-tinta-3">{o.notas.join(" ")}</p>}
            </li>
          ))}
        </ul>
      </section>

      <BaseLegal fonte={z.fonte} demonstracao={z.demonstracao} />

      <VerificadorZona z={z} />

      <Historico historico={z.historico} />
      <p className="text-[13px] leading-[1.45] text-tinta-3">
        Esta página é informativa. A decisão final é sempre da câmara.
      </p>
    </div>
  );
}

function VerificadorZona({ z }: { z: ZonaDetalhe }) {
  const [obra, setObra] = useState(z.obras[0]?.obra ?? "");
  const [area, setArea] = useState("");
  const [altura, setAltura] = useState("");
  const [r, setR] = useState<ResultadoZona | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aCorrer, setACorrer] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const medidas = z.obras.find((o) => o.obra === obra)?.medidas ?? [];
  useEffect(() => {
    if (r) titulo.current?.focus();
  }, [r]);
  if (!z.obras.length) return null;

  const numero = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : undefined);
  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    setACorrer(true);
    setErro(null);
    try {
      setR(
        await api<ResultadoZona>(
          `/v1/public/regras/${encodeURIComponent(z.municipio.slug)}/zonas/${encodeURIComponent(z.codigo)}/verificar`,
          {
            corpo: {
              obra,
              ...(medidas.includes("area_m2") && numero(area) ? { area_m2: numero(area) } : {}),
              ...(medidas.includes("altura_m") && numero(altura) ? { altura_m: numero(altura) } : {}),
            },
          },
        ),
      );
    } catch (x) {
      setErro(mensagemDe(x));
    } finally {
      setACorrer(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="verificar-zona">
      <TituloSecao id="verificar-zona">Verifique a sua obra</TituloSecao>
      <form onSubmit={verificar} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="obra" className="text-[15px] font-semibold text-tinta">
            Que obra
          </label>
          <select
            id="obra"
            className={classeCampo}
            value={obra}
            onChange={(e) => {
              setObra(e.target.value);
              setR(null);
            }}
          >
            {z.obras.map((o) => (
              <option key={o.obra} value={o.obra}>
                {o.nome}
              </option>
            ))}
          </select>
        </div>
        {medidas.includes("area_m2") && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="area" className="text-[15px] font-semibold text-tinta">
              Área (m²)
            </label>
            <input id="area" className={classeCampo} inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
        )}
        {medidas.includes("altura_m") && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="altura" className="text-[15px] font-semibold text-tinta">
              Altura (m)
            </label>
            <input id="altura" className={classeCampo} inputMode="decimal" value={altura} onChange={(e) => setAltura(e.target.value)} />
          </div>
        )}
        <Botao type="submit" tamanho="grande" icone={aCorrer ? LoaderCircle : ShieldCheck} disabled={aCorrer} className="w-full">
          {aCorrer ? "A verificar…" : "Verificar"}
        </Botao>
      </form>
      <div aria-live="polite" className="flex flex-col gap-3">
        {erro && (
          <Nota icone={X} tom="terracota" papel="alert">
            {erro}
          </Nota>
        )}
        {r && (
          <>
            <CartaoDestaque
              rotulo={r.obra_texto}
              tom={r.controlo === "isento" ? "verde" : r.controlo ? "terracota" : "tinta"}
            >
              <h3 ref={titulo} tabIndex={-1} className="font-display text-[22px] leading-tight font-bold outline-none">
                {r.resultado}
              </h3>
            </CartaoDestaque>
            {r.passos.length > 0 && (
              <ol className="flex flex-col gap-2">
                {r.passos.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[15px] text-tinta">
                    <Check className="mt-0.5 size-4 shrink-0 text-verde" aria-hidden />
                    {p}
                  </li>
                ))}
              </ol>
            )}
            {r.notas.length > 0 && (
              <Nota icone={FileText} tom="neutro">
                {r.notas.join(" ")}
              </Nota>
            )}
            {r.em_falta.length > 0 && (
              <Nota icone={MapPin} tom="ambar">
                Ponha a medida que falta para saber a resposta.
              </Nota>
            )}
            <p className="text-[13px] text-tinta-3">{r.nota}</p>
          </>
        )}
      </div>
    </section>
  );
}
