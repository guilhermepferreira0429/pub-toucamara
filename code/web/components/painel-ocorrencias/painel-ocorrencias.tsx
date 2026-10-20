"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { diaHora } from "@/components/processos/formatos";
import {
  ACarregar,
  Chip,
  ErroEmLinha,
  paraErro,
  Segmentado,
  usePedido,
} from "@/components/processos/ui";
import { useSessao } from "@/lib/sessao";
import { DetalheOcorrencia, IconeCategoria } from "./detalhe-ocorrencia";
import {
  ESTADO_COR,
  ESTADO_ROTULO,
  num,
  type CategoriaOcorrencia,
  type OcorrenciaLista,
  type Pin,
  type ResumoOcorrencias,
} from "./tipos";

/*
 * Painel · Ocorrências (frame jOnYQ): mapa com os pins por estado (pedidos
 * pela caixa visível ao mexer no mapa), lista lateral por estado e o
 * detalhe com as ações.
 */

const CANAL_ROTULO: Record<string, string> = {
  telefone: "por telefone",
  chat: "pelo chat",
  sms: "por SMS",
  email: "por email",
  balcao: "ao balcão",
  whatsapp: "por WhatsApp",
};

const Mapa = dynamic(() => import("./mapa-ocorrencias"), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center bg-creme-2 text-sm text-tinta-3">
      A carregar o mapa…
    </div>
  ),
});

type Separador = "nova" | "com_equipa" | "resolvida";
const LIMITE = 30;

interface PaginaOcorrencias {
  itens: OcorrenciaLista[];
  proximo_cursor: string | null;
}

export function PainelOcorrencias() {
  const { pode, pedido } = useSessao();
  const ver = pode("ocorrencias_ver");
  const [separador, setSeparador] = useState<Separador>("nova");
  const [categoria, setCategoria] = useState("");
  const [bbox, setBbox] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const resumo = usePedido<ResumoOcorrencias>(ver ? "/v1/painel/ocorrencias/resumo" : null);
  const categorias = usePedido<CategoriaOcorrencia[]>(ver ? "/v1/painel/ocorrencias/categorias" : null);
  // Primeiro enquadramento do mapa: as ocorrências mais recentes com local.
  const inicio = usePedido<PaginaOcorrencias>(ver ? "/v1/painel/ocorrencias?limite=100" : null);
  const filtroCategoria = categoria ? `&categoria_id=${categoria}` : "";
  const pins = usePedido<{ itens: Pin[]; truncado: boolean }>(
    ver && bbox ? `/v1/painel/ocorrencias?bbox=${bbox}${filtroCategoria}` : null,
  );
  const qsLista = `estado=${separador}&limite=${LIMITE}${filtroCategoria}`;
  const lista = usePedido<PaginaOcorrencias>(ver ? `/v1/painel/ocorrencias?${qsLista}` : null);

  const [mais, setMais] = useState<{ qs: string; itens: OcorrenciaLista[]; cursor: string | null } | null>(null);
  const [aCarregarMais, setACarregarMais] = useState(false);
  const [erroMais, setErroMais] = useState<string | null>(null);
  const extra = mais?.qs === qsLista ? mais : null;
  const itens = [...(lista.dados?.itens ?? []), ...(extra?.itens ?? [])];
  const cursor = extra ? extra.cursor : (lista.dados?.proximo_cursor ?? null);

  const enquadrar = useMemo(
    () =>
      (inicio.dados?.itens ?? [])
        .map((o) => [num(o.lat), num(o.lng)] as const)
        .filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null)
        .map(([a, b]) => [a, b] as [number, number]),
    [inicio.dados],
  );

  async function verMais() {
    if (!cursor) return;
    setACarregarMais(true);
    setErroMais(null);
    try {
      const r = await pedido<PaginaOcorrencias>(
        `/v1/painel/ocorrencias?${qsLista}&cursor=${encodeURIComponent(cursor)}`,
      );
      setMais({ qs: qsLista, itens: [...(extra?.itens ?? []), ...r.itens], cursor: r.proximo_cursor });
    } catch (e) {
      setErroMais(paraErro(e).message);
    } finally {
      setACarregarMais(false);
    }
  }

  if (!ver) {
    return (
      <div className="pt-10">
        <Aviso titulo="Sem acesso às ocorrências.">
          O seu perfil não inclui as ocorrências.
        </Aviso>
      </div>
    );
  }

  const contagem = (e: Separador) =>
    resumo.dados?.por_estado.find((x) => x.estado === e)?.total ?? null;

  return (
    <div className="flex min-h-dvh flex-col pb-8">
      <CabecalhoPagina
        migalhas={["Processos", "Ocorrências"]}
        titulo="Ocorrências"
        descricao="Registadas por telefone e chat, com fotografia e morada confirmada."
        acoes={
          <Segmentado<Separador>
            rotulo="Estado das ocorrências na lista"
            valor={separador}
            onChange={(v) => {
              setSeparador(v);
              setSelecionado(null);
            }}
            opcoes={[
              { valor: "nova", rotulo: "Novas", contagem: contagem("nova") },
              { valor: "com_equipa", rotulo: "Com a equipa", contagem: contagem("com_equipa") },
              { valor: "resolvida", rotulo: "Resolvidas", contagem: contagem("resolvida") },
            ]}
          />
        }
      />

      <div className="grid flex-1 gap-5 px-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section
          aria-label="Mapa das ocorrências (a lista ao lado tem a mesma informação)"
          className="relative isolate h-[min(calc(100dvh-170px),890px)] min-h-[480px] overflow-hidden rounded-[20px] border border-linha"
        >
          <Mapa
            pins={pins.dados?.itens ?? []}
            enquadrar={enquadrar}
            selecionado={selecionado}
            onSelecionar={setSelecionado}
            onBbox={setBbox}
          />
          <div className="pointer-events-none absolute right-4 top-4 z-[500] flex flex-wrap gap-3 rounded-xl bg-[#FFFDF8E6] px-3 py-2">
            {(["nova", "com_equipa", "resolvida"] as const).map((e) => (
              <span key={e} className="flex items-center gap-1.5 text-xs font-semibold text-tinta-2">
                <span className="size-2.5 rounded-full" style={{ background: ESTADO_COR[e] }} aria-hidden />
                {ESTADO_ROTULO[e]}
              </span>
            ))}
          </div>
          {(pins.erro || pins.dados?.truncado) && (
            <p className="absolute bottom-4 left-4 z-[500] rounded-lg bg-papel px-3 py-1.5 text-xs text-tinta-2 shadow">
              {pins.erro ? pins.erro.message : "Há muitas ocorrências nesta zona: aproxime o mapa para as ver todas."}
            </p>
          )}
        </section>

        <aside
          aria-label="Lista de ocorrências"
          className="flex h-[min(calc(100dvh-170px),890px)] min-h-[480px] flex-col overflow-hidden rounded-[20px] border border-linha bg-papel"
        >
          {selecionado ? (
            <DetalheOcorrencia
              id={selecionado}
              categorias={categorias.dados ?? []}
              onVoltar={() => setSelecionado(null)}
              onAbrir={setSelecionado}
              onAlterada={() => {
                lista.recarregar();
                pins.recarregar();
                resumo.recarregar();
                setMais(null);
              }}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-linha px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                  {lista.dados ? `${itens.length}${cursor ? "+" : ""} ` : ""}
                  {ESTADO_ROTULO[separador] === "Nova" ? "novas" : ESTADO_ROTULO[separador].toLowerCase()}
                </p>
                <label className="flex items-center gap-1 text-xs font-semibold text-tinta-2">
                  <span className="sr-only">Categoria</span>
                  <select
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    className="max-w-[170px] rounded-md bg-transparent py-0.5 text-xs font-semibold text-tinta-2"
                  >
                    <option value="">Todas as categorias</option>
                    {(categorias.dados ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex-1 overflow-y-auto" aria-busy={lista.aCarregar}>
                {lista.erro && !lista.dados ? (
                  <div className="p-4">
                    <ErroEmLinha erro={lista.erro} />
                  </div>
                ) : !lista.dados ? (
                  <ACarregar className="p-4" />
                ) : itens.length === 0 ? (
                  <p className="p-4 text-[13px] text-tinta-3">
                    {separador === "nova"
                      ? "Não há ocorrências novas. Tudo tratado."
                      : `Nenhuma ocorrência ${ESTADO_ROTULO[separador].toLowerCase()}.`}
                  </p>
                ) : (
                  <ul>
                    {itens.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setSelecionado(o.id)}
                          className="flex w-full gap-3 border-b border-linha px-4 py-3 text-left hover:bg-creme"
                        >
                          <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-terracota-suave">
                            <IconeCategoria nome={o.icone} className="size-4 text-terracota-escuro" />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-[13px] font-bold text-tinta">{o.categoria}</span>
                            <span className="truncate text-xs text-tinta-2">{o.morada ?? "Sem morada"}</span>
                            <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              <span className="text-[11px] text-tinta-3">
                                {diaHora(o.criada_em)}
                                {o.canal ? ` · ${CANAL_ROTULO[o.canal] ?? o.canal}` : ""}
                                {o.fotos ? ` · ${o.fotos === 1 ? "com foto" : `${o.fotos} fotos`}` : ""}
                                {o.duplicados ? ` · ${o.duplicados + 1} avisos` : ""}
                                {num(o.lat) === null ? " · sem local no mapa" : ""}
                              </span>
                              {o.servico && <Chip tom="neutro" pequeno>{o.servico}</Chip>}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {cursor && (
                  <div className="flex items-center justify-center gap-2 p-3">
                    <ErroEmLinha erro={erroMais} />
                    <button
                      type="button"
                      onClick={verMais}
                      disabled={aCarregarMais}
                      className="text-xs font-bold text-terracota-escuro hover:underline disabled:opacity-50"
                    >
                      {aCarregarMais ? "A carregar…" : "Ver mais"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
