"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, FileClock, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { membrosDe, type ServicosEquipa } from "@/components/atendimento/equipa";
import { BotaoExportar } from "@/components/painel/botao-exportar";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { FiltrosRecolhiveis } from "@/components/painel/telemovel";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { diaCurto, textoDiasUteis } from "./formatos";
import { BarrasFase, passoDaFase, SeparadoresProcessos } from "./navegacao";
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
import { BotaoProcessoDemonstracao } from "./verificacoes";

// Os filtros ficam lado a lado: o campo base tem w-full, que o w-auto não
// anula (as duas classes ao mesmo tempo dependem da ordem do CSS).
const FILTRO = `${CAMPO.replace("w-full", "w-auto")} font-medium`;

/*
 * Painel · Processos (frames KbzvJ e Px9e4): separadores "Os meus / Todos /
 * Atrasados", filtros (texto, fase, técnico, à espera do munícipe) e a
 * tabela ordenada pelo prazo, paginada com "Ver mais".
 */

type Vista = "meus" | "todos" | "atrasados";
type Ordem = "prazo" | "numero" | "fase";
const LIMITE = 25;

const ROTULO_ORDEM: Record<Ordem, string> = { prazo: "pelo prazo", numero: "pelo número", fase: "pela fase" };

function fechado(p: ProcessoResumo): boolean {
  return p.fase === "notificado" || p.fase === "arquivado";
}

/** "2 de 4 · Apreciação": em que passo vai (os decididos só com o nome da fase). */
function faseTexto(p: ProcessoResumo): string {
  return fechado(p) ? p.fase_rotulo : `${Math.min(passoDaFase(p.fase), 3) + 1} de 4 · ${p.fase_rotulo}`;
}

/** O que falta fazer a seguir, em palavras de quem trabalha o processo. */
function proximoPasso(p: ProcessoResumo): string {
  if (fechado(p)) return "—";
  const docs = p.documentos;
  if (p.aguarda_municipe) {
    return docs && docs.exigidos > docs.entregues
      ? `Munícipe entrega documentos (${docs.entregues} de ${docs.exigidos})`
      : "Esperar pela resposta do munícipe";
  }
  if (!p.tecnico) return "Atribuir a um técnico";
  switch (p.fase) {
    case "entrada":
      return "Verificar a entrada";
    case "documentos":
      return "Verificar os documentos entregues";
    case "apreciacao":
      return "Apreciar o projeto";
    case "pareceres_externos":
      return "Esperar pelos pareceres externos";
    case "decisao":
      return "Decidir e notificar";
    default:
      return "—";
  }
}

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
  // Os decididos vêm sempre no fim; dentro dos abertos, a coluna escolhida.
  const [ordem, setOrdem] = useState<Ordem>("prazo");
  const [sentido, setSentido] = useState<"asc" | "desc">("asc");
  const ordenar = (o: Ordem) => {
    if (o === ordem) setSentido((s) => (s === "asc" ? "desc" : "asc"));
    else {
      setOrdem(o);
      setSentido("asc");
    }
  };

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
    if (ordem !== "prazo") p.set("ordem", ordem);
    if (sentido !== "asc") p.set("sentido", sentido);
    return p.toString();
  }, [vista, tecnico, servico, fase, aguarda, tipo, freguesia, aTerminar, textoAplicado, ordem, sentido]);

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
        migalhas={["Processos"]}
        titulo="Processos"
        descricao={descricao}
        acoes={
          <>
            <SeparadoresProcessos atual="/painel/processos" />
            {/* Os mesmos filtros da lista (a API ignora o limite). */}
            <BotaoExportar caminho={`/v1/painel/processos/exportar.csv?${qs}`} base="processos" />
          </>
        }
      />

      <div className="flex flex-col gap-5 px-4 sm:px-10">
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
          <div className="relative w-full sm:w-[320px] sm:max-w-full">
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
          <FiltrosRecolhiveis
            ativos={
              [fase, tecnico, servico, aguarda, tipo, freguesia, aTerminar].filter(Boolean)
                .length
            }
          >
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
          </FiltrosRecolhiveis>
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
          <BotaoProcessoDemonstracao />
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
            {/* Telemóvel: um cartão por processo, a linha inteira é o link. */}
            <ul className="divide-y divide-linha md:hidden" aria-label="Processos">
              {itens.map((p) => {
                const prazo = prazoDe(p);
                return (
                  <li key={p.id} className={p.atrasado ? "bg-terracota-suave/20" : ""}>
                    <Link
                      href={`/painel/processos/${p.id}`}
                      className="flex flex-col gap-1.5 px-4 py-3.5 hover:bg-creme"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-bold text-tinta">{p.numero}</span>
                        <span className={`text-right text-xs font-semibold ${prazo.cor}`}>
                          {prazo.texto}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-tinta">
                        {p.assunto}
                      </span>
                      {p.morada && (
                        <span className="truncate text-xs text-tinta-3">{p.morada}</span>
                      )}
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
                        <span className="flex items-center gap-2">
                          <BarrasFase fase={p.fase} />
                          <span className="text-xs font-medium text-tinta">{faseTexto(p)}</span>
                        </span>
                        {p.aguarda_municipe ? (
                          <Chip tom="ambar" pequeno icone={FileClock}>
                            à espera do munícipe
                          </Chip>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-tinta-2">
                            <UserRound className="size-3.5 text-tinta-3" aria-hidden />
                            {p.tecnico?.nome ?? "por atribuir"}
                          </span>
                        )}
                        {!fechado(p) && (
                          <span className="text-xs font-semibold text-tinta">→ {proximoPasso(p)}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <table className="hidden w-full table-fixed border-collapse text-left md:table">
              <caption className="sr-only">
                Processos, ordenados {ROTULO_ORDEM[ordem]} ({sentido === "asc" ? "crescente" : "decrescente"}); os
                decididos no fim
              </caption>
              <thead>
                <tr className="h-[42px] border-b border-linha bg-creme">
                  {(
                    [
                      ["N.º", "w-[132px] pl-5", "numero"],
                      ["Assunto", "", null],
                      ["Fase", "w-[180px]", "fase"],
                      ["Próximo passo", "w-[230px]", null],
                      ["Situação", "w-[150px]", null],
                      ["Prazo", "w-[180px] pr-5", "prazo"],
                    ] as [string, string, Ordem | null][]
                  ).map(([t, c, o]) => (
                    <th
                      key={t}
                      scope="col"
                      aria-sort={o && o === ordem ? (sentido === "asc" ? "ascending" : "descending") : undefined}
                      className={`px-2 text-[10px] font-bold uppercase tracking-[0.6px] text-tinta-3 ${c}`}
                    >
                      {o ? (
                        <button
                          type="button"
                          onClick={() => ordenar(o)}
                          className={`inline-flex items-center gap-1 uppercase hover:text-tinta ${o === ordem ? "text-tinta" : ""}`}
                        >
                          {t}
                          {o !== ordem ? (
                            <ArrowUpDown className="size-3" aria-hidden />
                          ) : sentido === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden />
                          )}
                        </button>
                      ) : (
                        t
                      )}
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
                      className={`relative h-[62px] border-b border-linha last:border-b-0 hover:bg-creme focus-within:bg-creme ${
                        p.atrasado ? "bg-terracota-suave/20" : ""
                      }`}
                    >
                      <td className="pl-5 pr-2">
                        {/* O link cobre a linha inteira (abre num separador novo, partilha-se). */}
                        <Link
                          href={href}
                          className="text-[13px] font-bold text-tinta after:absolute after:inset-0 after:content-[''] hover:underline"
                        >
                          {p.numero}
                        </Link>
                      </td>
                      <td className="px-2">
                        <p className="truncate text-sm font-semibold text-tinta">
                          {p.assunto}
                        </p>
                        <p className="truncate text-xs text-tinta-3">
                          {[p.tipo.nome, p.morada].filter(Boolean).join(" · ")}
                        </p>
                      </td>
                      <td className="px-2">
                        <span className="flex flex-col gap-[5px]">
                          <BarrasFase fase={p.fase} />
                          <span className="text-xs font-medium text-tinta">{faseTexto(p)}</span>
                        </span>
                      </td>
                      <td className={`px-2 text-[13px] ${fechado(p) ? "text-tinta-3" : "font-semibold text-tinta"}`}>
                        {proximoPasso(p)}
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
                            por atribuir
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
            <div className="flex items-center justify-between gap-4 border-t border-linha px-4 py-3.5 md:px-5">
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
