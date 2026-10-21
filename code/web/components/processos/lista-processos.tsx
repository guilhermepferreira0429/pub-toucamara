"use client";

import { FileClock, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { membrosDe, type ServicosEquipa } from "@/components/atendimento/equipa";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { diaCurto, textoDiasUteis } from "./formatos";
import { BarrasFase, SeparadoresProcessos } from "./navegacao";
import {
  FASE_ROTULO,
  FASES,
  type Fase,
  type Pagina,
  type ProcessoResumo,
  type ResumoProcessos,
} from "./tipos";
import {
  ACarregar,
  CAMPO,
  Chip,
  ErroEmLinha,
  paraErro,
  Segmentado,
  usePedido,
} from "./ui";

// Os filtros ficam lado a lado: o campo base tem w-full, que o w-auto não
// anula (as duas classes ao mesmo tempo dependem da ordem do CSS).
const FILTRO = `${CAMPO.replace("w-full", "w-auto")} font-medium`;

/*
 * Painel · Processos (frames KbzvJ e Px9e4): separadores "Os meus / Todos /
 * Atrasados", filtros (texto, fase, técnico, à espera do munícipe) e a
 * tabela ordenada pelo prazo, paginada com "Ver mais".
 */

type Vista = "meus" | "todos" | "atrasados";
const LIMITE = 25;

function prazoDe(p: ProcessoResumo): { texto: string; cor: string } {
  if (p.fase === "notificado" || p.fase === "arquivado") {
    return {
      texto: p.decisao ? `decidido · ${p.decisao}` : p.fase_rotulo.toLowerCase(),
      cor: "text-tinta-3 font-normal",
    };
  }
  if (p.aguarda_municipe && p.dias_uteis_restantes === null) {
    return {
      texto: p.prazo_municipe
        ? `à espera do munícipe até ${diaCurto(p.prazo_municipe)}`
        : "parado à espera do munícipe",
      cor: "text-tinta-3 font-normal",
    };
  }
  const d = p.dias_uteis_restantes;
  if (d === null) {
    return { texto: "prazo ainda não começou", cor: "text-tinta-3 font-normal" };
  }
  if (p.atrasado || d < 0)
    return { texto: textoDiasUteis(d), cor: "text-terracota-escuro" };
  if (d <= 3) return { texto: textoDiasUteis(d), cor: "text-ambar" };
  return { texto: textoDiasUteis(d), cor: "text-tinta-2" };
}

export function ListaProcessos() {
  const { eu, pode, pedido } = useSessao();
  const router = useRouter();
  const sp = useSearchParams();

  const faseInicial = sp.get("fase");
  const [vista, setVista] = useState<Vista>(() =>
    sp.get("atrasados") === "true"
      ? "atrasados"
      : sp.get("meus") === "true" ||
          (eu?.utilizador.perfil === "tecnico" && !sp.get("texto"))
        ? "meus"
        : "todos",
  );
  const [fase, setFase] = useState<Fase | "">(
    FASES.includes(faseInicial as Fase) ? (faseInicial as Fase) : "",
  );
  const [tecnico, setTecnico] = useState("");
  const [servico, setServico] = useState("");
  const [aguarda, setAguarda] = useState(sp.get("aguarda") === "true");
  const [tipo, setTipo] = useState(sp.get("tipo_processo_id") ?? "");
  const [freguesia, setFreguesia] = useState(sp.get("freguesia") ?? "");
  const [aTerminar, setATerminar] = useState(sp.get("a_terminar") === "true");
  const [texto, setTexto] = useState(sp.get("texto") ?? "");
  const [textoAplicado, setTextoAplicado] = useState(texto.trim());

  // Pesquisa com um pequeno atraso (não pede a cada tecla).
  useEffect(() => {
    const t = setTimeout(() => setTextoAplicado(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  // Serviços e técnicos ativos (qualquer perfil do painel).
  const equipa = usePedido<ServicosEquipa>(
    pode("visao_geral") ? "/v1/painel/servicos" : null,
  );
  const tecnicos = membrosDe(equipa.dados, ["tecnico", "chefe_divisao"]);
  const servicos = equipa.dados?.itens ?? [];
  const tiposProcesso = usePedido<{ itens: { id: string; codigo: string; nome: string }[] }>(
    "/v1/painel/tipos-processo",
  );

  // Os filtros que não são separadores: os totais por separador usam-nos.
  const qsFiltros = useMemo(() => {
    const p = new URLSearchParams();
    if (fase) p.set("fase", fase);
    if (servico) p.set("servico_id", servico);
    if (tipo) p.set("tipo_processo_id", tipo);
    if (freguesia) p.set("freguesia", freguesia);
    if (textoAplicado) p.set("texto", textoAplicado.slice(0, 100));
    return p.toString();
  }, [fase, servico, tipo, freguesia, textoAplicado]);
  const totais = usePedido<ResumoProcessos>(
    `/v1/painel/processos/resumo${qsFiltros ? `?${qsFiltros}` : ""}`,
  );

  const qs = useMemo(() => {
    const p = new URLSearchParams({ limite: String(LIMITE) });
    if (vista === "meus") p.set("tecnico_id", "eu");
    else if (tecnico) p.set("tecnico_id", tecnico);
    if (vista === "atrasados") p.set("atrasados", "true");
    if (fase) p.set("fase", fase);
    if (servico) p.set("servico_id", servico);
    if (aguarda) p.set("aguarda_municipe", "true");
    if (tipo) p.set("tipo_processo_id", tipo);
    if (freguesia) p.set("freguesia", freguesia);
    if (aTerminar) p.set("a_terminar", "true");
    if (textoAplicado) p.set("texto", textoAplicado.slice(0, 100));
    return p.toString();
  }, [vista, tecnico, servico, fase, aguarda, tipo, freguesia, aTerminar, textoAplicado]);

  const primeira = usePedido<Pagina<ProcessoResumo>>(
    `/v1/painel/processos?${qs}`,
  );

  // Páginas seguintes ("Ver mais"), presas aos filtros com que foram pedidas.
  const [mais, setMais] = useState<{
    qs: string;
    itens: ProcessoResumo[];
    cursor: string | null;
  } | null>(null);
  const [aCarregarMais, setACarregarMais] = useState(false);
  const [erroMais, setErroMais] = useState<string | null>(null);

  const extra = mais?.qs === qs ? mais : null;
  const itens = [...(primeira.dados?.itens ?? []), ...(extra?.itens ?? [])];
  const cursor = extra ? extra.cursor : (primeira.dados?.proximo_cursor ?? null);

  async function verMais() {
    if (!cursor) return;
    setACarregarMais(true);
    setErroMais(null);
    try {
      const r = await pedido<Pagina<ProcessoResumo>>(
        `/v1/painel/processos?${qs}&cursor=${encodeURIComponent(cursor)}`,
      );
      setMais({
        qs,
        itens: [...(extra?.itens ?? []), ...r.itens],
        cursor: r.proximo_cursor,
      });
    } catch (e) {
      setErroMais(paraErro(e).message);
    } finally {
      setACarregarMais(false);
    }
  }

  const atrasadosNaPagina = itens.filter((p) => p.atrasado).length;
  const descricao = primeira.aCarregar
    ? "A carregar…"
    : `${itens.length}${cursor ? "+" : ""} ${
        vista === "meus" ? "seus" : itens.length === 1 ? "processo" : "processos"
      }${
        atrasadosNaPagina && vista !== "atrasados"
          ? ` · ${atrasadosNaPagina} com o prazo ultrapassado`
          : ""
      }${
        totais.dados?.a_terminar
          ? ` · ${totais.dados.a_terminar} com prazo a terminar esta semana`
          : ""
      }`;

  const filtrosAtivos = !!(
    fase || tecnico || servico || aguarda || tipo || freguesia || aTerminar || textoAplicado
  );
  const tot = totais.dados;

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Processos", "Lista"]}
        titulo="Processos"
        descricao={descricao}
        acoes={<SeparadoresProcessos atual="/painel/processos" />}
      />

      <div className="flex flex-col gap-5 px-10">
        <div className="flex flex-wrap items-center gap-2">
          <Segmentado<Vista>
            rotulo="Que processos mostrar"
            valor={vista}
            onChange={(v) => {
              setVista(v);
              if (v === "meus") setTecnico("");
            }}
            opcoes={[
              { valor: "meus", rotulo: "Os meus", contagem: tot?.meus },
              { valor: "todos", rotulo: "Todos", contagem: tot?.todos },
              { valor: "atrasados", rotulo: "Atrasados", contagem: tot?.atrasados },
            ]}
          />
          <div className="relative w-[320px] max-w-full">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-3"
              aria-hidden
            />
            <label htmlFor="pesquisa-processos" className="sr-only">
              Pesquisar por n.º, morada, assunto ou requerente
            </label>
            <input
              id="pesquisa-processos"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="N.º, morada, assunto ou requerente"
              className={`${CAMPO} pl-9`}
            />
          </div>
          <label className="sr-only" htmlFor="filtro-fase">
            Fase
          </label>
          <select
            id="filtro-fase"
            value={fase}
            onChange={(e) => setFase(e.target.value as Fase | "")}
            className={FILTRO}
          >
            <option value="">Fase: todas</option>
            {FASES.map((f) => (
              <option key={f} value={f}>
                {FASE_ROTULO[f]}
              </option>
            ))}
          </select>
          {(tiposProcesso.dados?.itens.length ?? 0) > 0 && (
            <>
              <label className="sr-only" htmlFor="filtro-tipo">
                Tipo
              </label>
              <select
                id="filtro-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className={FILTRO}
              >
                <option value="">Tipo: todos</option>
                {tiposProcesso.dados!.itens.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.codigo} · {t.nome}
                  </option>
                ))}
              </select>
            </>
          )}
          {(tot?.freguesias.length ?? 0) > 0 && (
            <>
              <label className="sr-only" htmlFor="filtro-freguesia">
                Freguesia
              </label>
              <select
                id="filtro-freguesia"
                value={freguesia}
                onChange={(e) => setFreguesia(e.target.value)}
                className={FILTRO}
              >
                <option value="">Freguesia: todas</option>
                {tot!.freguesias.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </>
          )}
          {servicos.length > 0 && (
            <>
              <label className="sr-only" htmlFor="filtro-servico">
                Serviço
              </label>
              <select
                id="filtro-servico"
                value={servico}
                onChange={(e) => setServico(e.target.value)}
                className={FILTRO}
              >
                <option value="">Serviço: todos</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </>
          )}
          {vista !== "meus" && tecnicos.length > 0 && (
            <>
              <label className="sr-only" htmlFor="filtro-tecnico">
                Técnico
              </label>
              <select
                id="filtro-tecnico"
                value={tecnico}
                onChange={(e) => setTecnico(e.target.value)}
                className={FILTRO}
              >
                <option value="">Técnico: todos</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border border-linha bg-papel px-3 text-[13px] font-medium text-tinta">
            <input
              type="checkbox"
              checked={aguarda}
              onChange={(e) => setAguarda(e.target.checked)}
              className="size-4 accent-terracota"
            />
            À espera do munícipe
            {tot && (
              <span className="rounded-full bg-creme-2 px-1.5 text-[11px] font-bold tabular-nums text-tinta-2">
                {tot.aguarda_municipe}
              </span>
            )}
          </label>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border border-linha bg-papel px-3 text-[13px] font-medium text-tinta">
            <input
              type="checkbox"
              checked={aTerminar}
              onChange={(e) => setATerminar(e.target.checked)}
              className="size-4 accent-terracota"
            />
            Prazo a terminar
            {tot && (
              <span className="rounded-full bg-creme-2 px-1.5 text-[11px] font-bold tabular-nums text-tinta-2">
                {tot.a_terminar}
              </span>
            )}
          </label>
          {filtrosAtivos && (
            <Botao
              variante="discreto"
              tamanho="pequeno"
              onClick={() => {
                setFase("");
                setTecnico("");
                setServico("");
                setAguarda(false);
                setTipo("");
                setFreguesia("");
                setATerminar(false);
                setTexto("");
              }}
            >
              Limpar filtros
            </Botao>
          )}
        </div>

        {primeira.erro ? (
          <Aviso titulo="Não foi possível carregar os processos." tom="erro">
            {primeira.erro.message}{" "}
            <button
              type="button"
              onClick={primeira.recarregar}
              className="font-semibold underline"
            >
              Tentar outra vez
            </button>
          </Aviso>
        ) : !primeira.dados && primeira.aCarregar ? (
          <ACarregar className="px-1" texto="A carregar os processos…" />
        ) : itens.length === 0 ? (
          <div className="rounded-2xl border border-linha bg-papel p-8 text-center">
            <p className="font-semibold text-tinta">
              {filtrosAtivos || vista !== "todos"
                ? "Nenhum processo com estes filtros."
                : "Ainda não há processos."}
            </p>
            <p className="mt-1 text-sm text-tinta-2">
              {vista === "meus"
                ? "Não tem processos atribuídos. Veja todos para escolher um."
                : vista === "atrasados"
                  ? "Nenhum processo passou do prazo."
                  : "Os processos chegam pelos requerimentos assinados (telefone, chat e balcão)."}
            </p>
          </div>
        ) : (
          <div
            className={`overflow-hidden rounded-2xl border border-linha bg-papel ${
              primeira.aCarregar ? "opacity-60" : ""
            }`}
            aria-busy={primeira.aCarregar}
          >
            <table className="w-full table-fixed border-collapse text-left">
              <caption className="sr-only">
                Processos, ordenados pelo prazo mais próximo
              </caption>
              <thead>
                <tr className="h-[42px] border-b border-linha bg-creme">
                  {[
                    ["N.º", "w-[132px] pl-5"],
                    ["Assunto", ""],
                    ["Tipo", "w-[160px]"],
                    ["Fase", "w-[190px]"],
                    ["Documentos", "w-[104px]"],
                    ["Situação", "w-[150px]"],
                    ["Prazo", "w-[190px] pr-5"],
                  ].map(([t, c]) => (
                    <th
                      key={t}
                      scope="col"
                      className={`px-2 text-[10px] font-bold uppercase tracking-[0.6px] text-tinta-3 ${c}`}
                    >
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itens.map((p) => {
                  const prazo = prazoDe(p);
                  const href = `/painel/processos/${p.id}`;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(href)}
                      className={`h-[62px] cursor-pointer border-b border-linha last:border-b-0 hover:bg-creme ${
                        p.atrasado ? "bg-terracota-suave/20" : ""
                      }`}
                    >
                      <td className="pl-5 pr-2">
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[13px] font-bold text-tinta hover:underline"
                        >
                          {p.numero}
                        </Link>
                      </td>
                      <td className="px-2">
                        <p className="truncate text-sm font-semibold text-tinta">
                          {p.assunto}
                        </p>
                        {p.morada && (
                          <p className="truncate text-xs text-tinta-3">
                            {p.morada}
                          </p>
                        )}
                      </td>
                      <td className="truncate px-2 text-[13px] text-tinta-2">
                        {p.tipo.nome}
                      </td>
                      <td className="px-2">
                        <span className="flex flex-col gap-[5px]">
                          <BarrasFase fase={p.fase} />
                          <span className="text-xs font-medium text-tinta">
                            {p.fase_rotulo}
                          </span>
                        </span>
                      </td>
                      <td className="px-2 text-[13px] tabular-nums">
                        {p.documentos && p.documentos.exigidos > 0 ? (
                          <span
                            className={
                              p.documentos.entregues >= p.documentos.exigidos
                                ? "font-semibold text-verde"
                                : "font-semibold text-tinta"
                            }
                            aria-label={`${p.documentos.entregues} de ${p.documentos.exigidos} documentos entregues`}
                          >
                            {p.documentos.entregues}/{p.documentos.exigidos}
                          </span>
                        ) : (
                          <span className="text-tinta-3">—</span>
                        )}
                      </td>
                      <td className="px-2">
                        {p.aguarda_municipe ? (
                          <Chip tom="ambar" pequeno icone={FileClock}>
                            à espera do munícipe
                          </Chip>
                        ) : p.tecnico ? (
                          <span className="inline-flex max-w-full items-center gap-1.5 truncate text-xs text-tinta-2">
                            <UserRound
                              className="size-3.5 shrink-0 text-tinta-3"
                              aria-hidden
                            />
                            <span className="truncate">{p.tecnico.nome}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-tinta-3">
                            sem técnico
                          </span>
                        )}
                      </td>
                      <td className="pl-2 pr-5">
                        <span className={`text-xs font-semibold ${prazo.cor}`}>
                          {prazo.texto}
                        </span>
                        {p.prazo_fim &&
                          p.fase !== "notificado" &&
                          p.fase !== "arquivado" && (
                            <span className="block text-[11px] text-tinta-3">
                              até {diaCurto(p.prazo_fim)}
                            </span>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-4 border-t border-linha px-5 py-3.5">
              <p className="text-xs text-tinta-3" aria-live="polite">
                A mostrar {itens.length}
                {cursor ? " (há mais)" : ""}
              </p>
              <div className="flex items-center gap-3">
                <ErroEmLinha erro={erroMais} />
                {cursor && (
                  <button
                    type="button"
                    onClick={verMais}
                    disabled={aCarregarMais}
                    className="text-xs font-bold text-terracota-escuro hover:underline disabled:opacity-50"
                  >
                    {aCarregarMais ? "A carregar…" : "Ver mais"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
