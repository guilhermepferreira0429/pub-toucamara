"use client";

import { Map as IconeMapa, MapPin, Pencil, Search, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
  Cartao,
  Dialogo,
  classeEntrada,
  ErroLinha,
  Estado,
  haQuanto,
  numero,
  Pilula,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { EditarRegrasZona, obraCurta } from "./regras-zona";
import { CATEGORIA_ROTULO, COR_CATEGORIA, CONTROLO, type Controlo, type Degrau, type Zona } from "./tipos";

/*
 * Painel · Ordenamento: as zonas do PDM que o agente usa para responder
 * "o que posso fazer nesta morada", as regras de cada obra e o mapa do que
 * as pessoas perguntam e onde (ajuda a ver onde o plano gera dúvidas).
 */

const Mapa = dynamic(() => import("./mapa-zonas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-creme-2" />,
});

interface Dados {
  zonas: Zona[];
  consultas: {
    id: string;
    morada: string;
    lat: number | null;
    lng: number | null;
    obra: string;
    obra_texto: string;
    controlo: Controlo | null;
    zona: string | null;
    criada_em: string;
    demonstracao: boolean;
  }[];
  por_obra: { obra: string; obra_texto: string; controlo: Controlo | null; n: number }[];
  obras: Record<string, string>;
}

/** GET /v1/painel/ordenamento/morada: a zona da morada e o que cada obra precisa. */
interface PorMorada {
  motivo: "sem_pdm" | "morada_nao_encontrada" | "fora_das_zonas" | null;
  encontrada: { texto?: string; lat: number; lng: number } | null;
  zona: { id: string; codigo: string; nome: string; categoria: string; demonstracao: boolean } | null;
  obras: {
    obra: string;
    nome: string;
    controlo: Controlo | null;
    depende_de: ("area_m2" | "altura_m")[];
    limites: string[];
    notas: string[];
  }[];
}

const MEDIDA: Record<string, string> = { area_m2: "da área", altura_m: "da altura" };

/** O campo do topo: escrever a morada e ver a zona e o que cada obra precisa (não grava nada). */
function ConsultarMorada({ r, onResultado }: { r: PorMorada | null; onResultado: (r: PorMorada | null) => void }) {
  const { pedido } = useSessao();
  const [morada, setMorada] = useState("");
  const acao = useAcao();
  return (
    <Cartao className="mx-10 flex flex-col gap-4 p-5">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const x = await acao.executar(() =>
            pedido<PorMorada>(`/v1/painel/ordenamento/morada?morada=${encodeURIComponent(morada.trim())}`),
          );
          onResultado(x ?? null);
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-tinta">Morada</span>
          <input
            className={classeEntrada}
            value={morada}
            onChange={(e) => setMorada(e.target.value)}
            minLength={3}
            maxLength={200}
            required
            placeholder="Ex.: Rua de Santa Maria, 12"
          />
        </label>
        <Botao type="submit" icone={Search} className="sm:mt-[26px]" disabled={acao.aCorrer || morada.trim().length < 3}>
          {acao.aCorrer ? "A procurar…" : "Ver o que se pode fazer"}
        </Botao>
      </form>
      <ErroLinha erro={acao.erro} />
      {r?.motivo === "morada_nao_encontrada" && (
        <p className="text-sm text-tinta-2">
          Não encontrei essa morada no mapa. Experimente a rua e o número, ou uma referência perto (uma igreja, uma escola).
        </p>
      )}
      {r?.motivo === "fora_das_zonas" && (
        <p className="text-sm text-tinta-2">
          A morada fica fora das zonas do plano carregadas: um técnico tem de ver o caso.
        </p>
      )}
      {r?.zona && (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm text-tinta">
            <MapPin className="size-4 text-terracota" aria-hidden />
            Fica em <strong>{r.zona.nome}</strong>
            <span className="text-tinta-3">· {CATEGORIA_ROTULO[r.zona.categoria] ?? r.zona.categoria}</span>
            {r.zona.demonstracao && <Pilula tom="ambar">regras de demonstração</Pilula>}
          </p>
          {r.encontrada?.texto && <p className="text-xs text-tinta-3">Encontrada como: {r.encontrada.texto}</p>}
          <ul className="grid gap-2 md:grid-cols-2">
            {r.obras.map((o) => (
              <li key={o.obra} className="flex flex-col gap-1 rounded-xl bg-creme px-3 py-2.5">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-tinta">{o.nome}</span>
                  {o.controlo ? (
                    <Pilula tom={CONTROLO[o.controlo].tom}>{CONTROLO[o.controlo].rotulo}</Pilula>
                  ) : o.depende_de.length ? (
                    <Pilula tom="neutro">depende {o.depende_de.map((m) => MEDIDA[m] ?? m).join(" e ")}</Pilula>
                  ) : (
                    <Pilula tom="neutro">sem regra: técnico</Pilula>
                  )}
                </span>
                {!o.controlo && o.limites.length > 0 && (
                  <span className="text-xs text-tinta-2">{o.limites.join(" ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Cartao>
  );
}

function regraCurta(r: { degraus: Degrau[]; acima: Controlo } | undefined): string {
  if (!r) return "—";
  const partes = r.degraus.map((d) => {
    const lim = [d.area_max_m2 ? `${d.area_max_m2} m²` : null, d.altura_max_m ? `${d.altura_max_m} m` : null]
      .filter(Boolean)
      .join(", ");
    return `${CONTROLO[d.controlo].rotulo}${lim ? ` até ${lim}` : ""}`;
  });
  partes.push(r.degraus.length ? `acima: ${CONTROLO[r.acima].rotulo}` : CONTROLO[r.acima].rotulo);
  return partes.join(" · ");
}

export function PaginaOrdenamento() {
  const { pode, pedido } = useSessao();
  const d = useDados<Dados>(pode("conhecimento_ver") ? "/v1/painel/ordenamento" : null);
  const carregar = useAcao();
  const [zonaAberta, setZonaAberta] = useState<string | null>(null);
  const [procurada, setProcurada] = useState<PorMorada | null>(null);
  const [editar, setEditar] = useState<string | null>(null);

  if (!pode("conhecimento_ver")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Gestão", "Ordenamento"]} titulo="Ordenamento" />
        <SemAcesso />
      </div>
    );
  }

  const dados = d.dados;
  const demonstracao = dados?.zonas.some((z) => z.demonstracao);
  const aEditar = dados?.zonas.find((z) => z.id === editar) ?? null;
  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Gestão", "Ordenamento"]}
        titulo="O que posso fazer nesta morada"
        descricao="O agente encontra a morada no mapa, vê a zona do plano diretor municipal e diz se a obra é isenta, precisa de comunicação prévia, de licença ou não é permitida. Os pontos são as perguntas que as pessoas fizeram."
        acoes={demonstracao ? <Pilula tom="ambar">zonas de demonstração</Pilula> : undefined}
      />
      <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={false}>
        {dados && dados.zonas.length === 0 ? (
          <Cartao className="mx-10 flex flex-col items-start gap-3 p-6">
            <IconeMapa className="size-6 text-terracota" aria-hidden />
            <p className="font-display text-lg font-bold text-tinta">Ainda não há zonas do PDM carregadas.</p>
            <p className="max-w-2xl text-sm text-tinta-2">
              Sem zonas, o agente não responde a perguntas sobre uma morada concreta: procura nas fontes ou passa a
              um funcionário. Para a demonstração há quatro zonas de Guimarães (centro histórico, residencial,
              agrícola e florestal), com regras de exemplo marcadas como tal.
            </p>
            <ErroLinha erro={carregar.erro} />
            {pode("conhecimento") && (
              <Botao
                icone={Upload}
                disabled={carregar.aCorrer}
                onClick={async () => {
                  const r = await carregar.executar(() =>
                    pedido("/v1/painel/ordenamento/demonstracao", { metodo: "POST" }),
                  );
                  if (r !== undefined) d.recarregar();
                }}
              >
                Carregar zonas de demonstração
              </Botao>
            )}
          </Cartao>
        ) : (
          dados && (
            <div className="flex flex-col gap-6">
            <ConsultarMorada r={procurada} onResultado={setProcurada} />
            <div className="grid gap-6 px-10 xl:grid-cols-[minmax(0,1fr)_420px]">
              {/* isolate: as camadas do Leaflet (z-index 400+) não passam por cima do diálogo. */}
              <Cartao className="isolate h-fit overflow-hidden xl:sticky xl:top-6">
                <Mapa
                  zonas={dados.zonas}
                  destacar={zonaAberta ?? procurada?.zona?.codigo ?? null}
                  pontos={[
                    ...dados.consultas
                      .filter((q) => q.lat !== null && q.lng !== null)
                      .map((q) => ({
                        id: q.id,
                        lat: q.lat!,
                        lng: q.lng!,
                        cor: q.controlo ? CONTROLO[q.controlo].cor : "#888",
                        rotulo: `${q.obra_texto} · ${q.morada} · ${q.controlo ? CONTROLO[q.controlo].rotulo : "para técnico"}`,
                      })),
                    ...(procurada?.encontrada
                      ? [
                          {
                            id: "morada-procurada",
                            lat: procurada.encontrada.lat,
                            lng: procurada.encontrada.lng,
                            cor: "#15263b",
                            rotulo: `A morada procurada${procurada.zona ? ` · ${procurada.zona.nome}` : ""}`,
                          },
                        ]
                      : []),
                  ]}
                  className="h-[560px] w-full"
                />
                <div className="flex flex-wrap gap-4 border-t border-linha px-5 py-3 text-xs text-tinta-2">
                  {Object.entries(CONTROLO).map(([k, v]) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full" style={{ background: v.cor }} aria-hidden />
                      {v.rotulo}
                    </span>
                  ))}
                </div>
              </Cartao>

              <div className="flex min-w-0 flex-col gap-4">
                <Cartao className="p-5">
                  <Rotulo>O que perguntam · 30 dias</Rotulo>
                  {dados.por_obra.length === 0 ? (
                    <p className="mt-2 text-sm text-tinta-3">Ainda ninguém perguntou.</p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-2">
                      {dados.por_obra.map((x) => (
                        <li key={`${x.obra}-${x.controlo}`} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate text-tinta">{x.obra_texto}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            {x.controlo && <Pilula tom={CONTROLO[x.controlo].tom}>{CONTROLO[x.controlo].rotulo}</Pilula>}
                            <span className="font-semibold text-tinta-2">{numero(x.n)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Cartao>

                {dados.zonas.map((z) => (
                  <Cartao
                    key={z.id}
                    className={`p-5 ${zonaAberta === z.codigo ? "border-terracota" : ""}`}
                    onMouseEnter={() => setZonaAberta(z.codigo)}
                    onMouseLeave={() => setZonaAberta(null)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-sm"
                        style={{ background: COR_CATEGORIA[z.categoria] ?? "#555" }}
                        aria-hidden
                      />
                      <span className="font-semibold text-tinta">{z.nome}</span>
                      <span className="font-mono text-xs text-tinta-3">{z.codigo}</span>
                      {pode("conhecimento") && (
                        <Botao
                          tamanho="pequeno"
                          variante="discreto"
                          icone={Pencil}
                          className="ml-auto"
                          onClick={() => setEditar(z.id)}
                        >
                          Mudar regras
                        </Botao>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-tinta-3">
                      {CATEGORIA_ROTULO[z.categoria] ?? z.categoria}
                      {z.descricao ? ` · ${z.descricao}` : ""}
                    </p>
                    <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
                      {Object.entries(dados.obras).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[120px_1fr] gap-2">
                          <dt className="truncate text-tinta-2" title={v}>
                            {obraCurta(v)}
                          </dt>
                          <dd className="text-tinta">{regraCurta(z.regras[k])}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-tinta-3">
                      {z.demonstracao && <Pilula tom="ambar">regras de demonstração</Pilula>}
                      <span>
                        {numero(z.perguntas.total)} perguntas nesta zona
                        {z.perguntas.demonstracao ? ` (${numero(z.perguntas.demonstracao)} de demonstração)` : ""}
                      </span>
                    </div>
                  </Cartao>
                ))}

                {dados.consultas.length > 0 && (
                  <Cartao className="p-5">
                    <Rotulo>Últimas perguntas</Rotulo>
                    <ul className="mt-3 flex flex-col gap-2">
                      {dados.consultas.slice(0, 8).map((q) => (
                        <li key={q.id} className="text-[13px]">
                          <span className="font-semibold text-tinta">{q.obra_texto}</span>
                          <span className="text-tinta-2"> · {q.morada}</span>
                          <span className="block text-xs text-tinta-3">
                            {q.zona ?? "fora das zonas"} ·{" "}
                            {q.controlo ? CONTROLO[q.controlo].rotulo : "para técnico"} · {haQuanto(q.criada_em)}
                            {q.demonstracao ? " · demonstração" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Cartao>
                )}
              </div>
            </div>
            </div>
          )
        )}
      </Estado>
      {dados && aEditar && (
        <Dialogo
          titulo={`Regras · ${aEditar.nome}`}
          aberto
          onFechar={() => setEditar(null)}
          largura="max-w-5xl"
        >
          <EditarRegrasZona
            key={aEditar.id}
            zona={aEditar}
            obras={dados.obras}
            onGuardado={() => {
              setEditar(null);
              d.recarregar();
            }}
            onPerguntas={d.recarregar}
          />
        </Dialogo>
      )}
    </div>
  );
}
