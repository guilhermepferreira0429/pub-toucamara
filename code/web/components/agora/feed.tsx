"use client";

import {
  BellRing,
  ChevronRight,
  Clock,
  List,
  LoaderCircle,
  LocateFixed,
  LocateOff,
  Map as IconeMapa,
  MapPin,
  MessageCircle,
  Phone,
  RotateCcw,
  Siren,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/botao";
import {
  Cabecalho,
  ModoTeste,
  Nota,
  ROTA_CHAT,
  Rotulo,
  TituloSecao,
  Topo,
} from "@/components/municipe/moldura";
import { mensagemDe } from "@/components/municipe/use-publico";
import { api } from "@/lib/api";
import {
  caminhoDetalhe,
  eEmergencia,
  eNovo,
  ESTILO_EMERGENCIA,
  ESTILO_TIPO,
  estiloDe,
  ondeDito,
  PERIODOS,
  periodoParaApi,
  quandoDito,
  RAIOS,
  raioDito,
  TIPOS_ITEM,
  type ItemAgora,
  type Periodo,
  type RespostaFeed,
  type TipoItem,
} from "./tipos";

/*
 * "O que se passa perto de mim" (/agora/[municipio]): o feed público de
 * obras, incidentes, avisos, emergências, eventos e consultas. A lista é a
 * vista principal (e a alternativa acessível ao mapa). A localização do
 * browser só vai no pedido à API: não se guarda em lado nenhum.
 */

// O mapa a ecrã inteiro (e o motor do mapa) só se descarrega quando se abre.
const EcraMapa = dynamic(() => import("./ecra-mapa").then((m) => m.EcraMapaAgora), { ssr: false });

const LIMITE = 20;

type EstadoGeo = "inativo" | "a_pedir" | "ok" | "recusado" | "indisponivel";

interface Lista {
  /** O pedido a que estes dados respondem (outro = está a carregar). */
  chave: string | null;
  estado: "ok" | "erro";
  resposta: RespostaFeed | null;
  itens: ItemAgora[];
  cursor: string | null;
  mensagem?: string;
}

function lerTipos(v: string | null | undefined): TipoItem[] {
  if (!v) return [];
  return v
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is TipoItem => (TIPOS_ITEM as readonly string[]).includes(x));
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** O cartão de cada item: tudo é um link para o detalhe. */
export function CartaoItem({ item, slug, novoHoras }: { item: ItemAgora; slug: string; novoHoras: number }) {
  const e = estiloDe(item);
  const Icone = e.icone;
  const quando = quandoDito(item);
  const onde = ondeDito(item);
  const novo = eNovo(item, novoHoras);
  const distancia = item.distancia_m;
  return (
    <li>
      <Link
        href={caminhoDetalhe(slug, item)}
        className="flex w-full gap-3 rounded-2xl border border-linha bg-papel p-4 transition-colors hover:bg-creme-2"
      >
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-[16px_16px_16px_5px] text-white"
          style={{ background: e.cor }}
        >
          <Icone className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-bold tracking-[0.8px] text-tinta-3 uppercase">
              <span className="sr-only">{e.singular}: </span>
              {item.etiqueta}
            </span>
            {novo && (
              <span className="rounded-full bg-terracota px-2 py-0.5 text-[11px] font-bold text-white">
                Novo
              </span>
            )}
          </span>
          <span className="font-display text-[18px] leading-tight font-bold text-tinta">{item.titulo}</span>
          <span className="line-clamp-3 text-[15px] leading-[1.45] text-tinta-2">{item.resumo}</span>
          {quando && (
            <span className="flex items-start gap-1.5 text-[14px] text-tinta">
              <Clock className="mt-0.5 size-4 shrink-0 text-tinta-3" aria-hidden />
              {quando}
            </span>
          )}
          {(onde || (distancia !== undefined && distancia !== null)) && (
            <span className="flex items-start gap-1.5 text-[14px] text-tinta">
              <MapPin className="mt-0.5 size-4 shrink-0 text-tinta-3" aria-hidden />
              <span>
                {onde}
                {distancia !== undefined && distancia !== null && (
                  <span className="text-tinta-3">
                    {onde ? " · " : ""}
                    {distancia === 0 ? "onde está" : `a ${raioDito(Math.max(50, Math.round(distancia / 50) * 50))}`}
                  </span>
                )}
              </span>
            </span>
          )}
        </span>
        <ChevronRight className="mt-3 size-5 shrink-0 text-tinta-3" aria-hidden />
      </Link>
    </li>
  );
}

/** Botão que liga e desliga (chips de tipos, período, modo). */
function Alternar({
  ativo,
  onClick,
  children,
  cor,
  refBotao,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  cor?: string;
  refBotao?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={refBotao}
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-[15px] font-semibold transition-colors ${
        ativo ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta hover:bg-creme-2"
      }`}
    >
      {cor && (
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-full border border-white/70"
          style={{ background: cor }}
        />
      )}
      {children}
    </button>
  );
}

/** "Receber avisos": por SMS (AVISAR OBRAS) ou pedindo ao assistente. */
function ReceberAvisos({ telefone }: { telefone: string | null }) {
  const numero = telefone?.replace(/\s/g, "") ?? null;
  return (
    <section
      aria-labelledby="receber-avisos"
      className="flex w-full flex-col gap-3 rounded-2xl bg-creme-2 p-5"
    >
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-[20px_20px_20px_6px] bg-terracota text-white"
      >
        <BellRing className="size-5" />
      </span>
      <TituloSecao id="receber-avisos">Receber avisos no telemóvel</TituloSecao>
      <p className="text-[16px] leading-[1.5] text-tinta">
        Quando houver uma obra, um corte ou um evento novo perto da sua rua, mandamos-lhe um SMS.
      </p>
      <ol className="flex flex-col gap-2 text-[16px] leading-[1.5] text-tinta">
        <li>
          <span className="font-semibold">Por SMS:</span> envie <strong className="font-mono">AVISAR OBRAS</strong>{" "}
          ou <strong className="font-mono">AVISAR EVENTOS</strong>{" "}
          {numero ? (
            <>
              para o <strong className="whitespace-nowrap">{telefone}</strong>
            </>
          ) : (
            "para o número de SMS da câmara (é o das mensagens que recebe da câmara)"
          )}
          . Depois responda com o nome da sua rua ou freguesia.
        </li>
        <li>
          <span className="font-semibold">Ou peça ao assistente</span>, no chat ou numa chamada: «quero ser avisado
          das obras na minha rua».
        </li>
      </ol>
      <div className="flex flex-col gap-2.5 pt-1">
        {numero && (
          <BotaoLink
            href={`sms:${numero}?body=${encodeURIComponent("AVISAR OBRAS")}`}
            tamanho="grande"
            icone={BellRing}
            className="w-full"
          >
            Enviar AVISAR OBRAS
          </BotaoLink>
        )}
        <BotaoLink
          href={ROTA_CHAT}
          tamanho="grande"
          variante={numero ? "secundario" : "principal"}
          icone={MessageCircle}
          className="w-full"
        >
          Pedir no chat
        </BotaoLink>
        <BotaoLink href="/ligar" tamanho="grande" variante="secundario" icone={Phone} className="w-full">
          Pedir numa chamada
        </BotaoLink>
      </div>
      <p className="text-[14px] leading-[1.45] text-tinta-2">
        Para deixar de receber, envie <strong className="font-mono">PARAR</strong>.
      </p>
    </section>
  );
}

export function FeedAgora({
  slug,
  inicial,
}: {
  slug: string;
  inicial: { freguesia?: string; tipos?: string; ver?: string };
}) {
  const [tipos, setTipos] = useState<TipoItem[]>(() => lerTipos(inicial.tipos));
  const [freguesia, setFreguesia] = useState<string>(inicial.freguesia ?? "");
  const [periodo, setPeriodo] = useState<{ id: Periodo; de?: string; ate?: string }>({ id: "tudo" });
  const [geo, setGeo] = useState<EstadoGeo>("inativo");
  const [perto, setPerto] = useState<{ lat: number; lng: number } | null>(null);
  const [raio, setRaio] = useState<number>(1000);
  const [modo, setModo] = useState<"lista" | "mapa">(inicial.ver === "mapa" ? "mapa" : "lista");
  const refBotaoMapa = useRef<HTMLButtonElement>(null);
  const [lista, setLista] = useState<Lista>({ chave: null, estado: "ok", resposta: null, itens: [], cursor: null });
  const [aCarregarMais, setACarregarMais] = useState(false);
  const [erroMais, setErroMais] = useState<string | null>(null);
  const [emergencias, setEmergencias] = useState<ItemAgora[]>([]);
  const [freguesias, setFreguesias] = useState<string[]>([]);
  const [telefoneSms, setTelefoneSms] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const refFreguesia = useRef<HTMLSelectElement>(null);
  const refLista = useRef<HTMLUListElement>(null);

  const consulta = useMemo(() => {
    const q = new URLSearchParams();
    if (perto) {
      q.set("lat", perto.lat.toFixed(5));
      q.set("lng", perto.lng.toFixed(5));
      q.set("raio_m", String(raio));
    }
    if (freguesia) q.set("freguesia", freguesia);
    if (tipos.length && tipos.length < TIPOS_ITEM.length) q.set("tipos", tipos.join(","));
    if (periodo.de) q.set("de", periodo.de);
    if (periodo.ate) q.set("ate", periodo.ate);
    q.set("limite", String(LIMITE));
    return q.toString();
  }, [perto, raio, freguesia, tipos, periodo]);

  const caminho = `/v1/public/agora/${encodeURIComponent(slug)}`;

  // O feed: de novo a cada filtro (a página seguinte vem com "ver mais").
  useEffect(() => {
    const ctrl = new AbortController();
    const chave = `${consulta}#${tentativa}`;
    api<RespostaFeed>(`${caminho}?${consulta}`, { sinal: ctrl.signal })
      .then((r) => {
        setErroMais(null);
        setLista({ chave, estado: "ok", resposta: r, itens: r.itens, cursor: r.proximo_cursor });
        if (r.freguesias?.length) setFreguesias((f) => (f.length ? f : r.freguesias ?? []));
        if (r.municipio.telefone_sms !== undefined) setTelefoneSms(r.municipio.telefone_sms ?? null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLista((l) => ({ ...l, chave, estado: "erro", mensagem: mensagemDe(e) }));
      });
    return () => ctrl.abort();
  }, [caminho, consulta, tentativa]);

  // As emergências ativas do concelho, sempre no topo (com qualquer filtro).
  useEffect(() => {
    const ctrl = new AbortController();
    api<RespostaFeed>(`${caminho}?tipos=avisos&limite=100`, { sinal: ctrl.signal })
      .then((r) => {
        const agora = Date.now();
        setEmergencias(
          r.itens.filter(
            (i) =>
              eEmergencia(i) &&
              (!i.inicio || Date.parse(i.inicio) <= agora) &&
              (!i.fim || Date.parse(i.fim) >= agora),
          ),
        );
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [caminho]);

  // O endereço guarda os filtros (para partilhar), nunca a localização.
  useEffect(() => {
    const q = new URLSearchParams();
    if (freguesia) q.set("freguesia", freguesia);
    if (tipos.length && tipos.length < TIPOS_ITEM.length) q.set("tipos", tipos.join(","));
    if (modo === "mapa") q.set("ver", "mapa");
    const s = q.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, [freguesia, tipos, modo]);

  const verMais = useCallback(async () => {
    if (!lista.cursor) return;
    setACarregarMais(true);
    setErroMais(null);
    const antes = lista.itens.length;
    try {
      const r = await api<RespostaFeed>(`${caminho}?${consulta}&cursor=${encodeURIComponent(lista.cursor)}`);
      setLista((l) => ({ ...l, itens: [...l.itens, ...r.itens], cursor: r.proximo_cursor }));
      // O foco vai para o primeiro item novo (quem usa teclado não volta ao início).
      requestAnimationFrame(() => {
        const a = refLista.current?.querySelectorAll<HTMLAnchorElement>("li > a")[antes];
        a?.focus();
      });
    } catch (e) {
      setErroMais(mensagemDe(e));
    } finally {
      setACarregarMais(false);
    }
  }, [caminho, consulta, lista.cursor, lista.itens.length]);

  function pedirLocalizacao() {
    if (!("geolocation" in navigator)) {
      setGeo("indisponivel");
      refFreguesia.current?.focus();
      return;
    }
    setGeo("a_pedir");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPerto({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGeo("ok");
      },
      (e) => {
        setGeo(e.code === e.PERMISSION_DENIED ? "recusado" : "indisponivel");
        setPerto(null);
        requestAnimationFrame(() => refFreguesia.current?.focus());
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  }

  function deixarLocalizacao() {
    setPerto(null);
    setGeo("inativo");
  }

  function alternarTipo(t: TipoItem) {
    setTipos((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  }

  function escolherPeriodo(id: Periodo) {
    setPeriodo({ id, ...periodoParaApi(id) });
    if (id === "eventos") setTipos(["eventos"]);
  }

  function limparFiltros() {
    setTipos([]);
    setFreguesia("");
    setPeriodo({ id: "tudo" });
    deixarLocalizacao();
  }

  const aCarregar = lista.chave !== `${consulta}#${tentativa}`;
  const r = lista.resposta;
  const nome = r?.municipio.nome;
  const parametros = r?.parametros;
  const idsEmergencia = new Set(emergencias.map((e) => e.id));
  const itensLista = lista.itens.filter((i) => !idsEmergencia.has(i.id));
  const total = r?.total ?? 0;
  const filtrado = !!(perto || freguesia || tipos.length || periodo.id !== "tudo");

  const anuncio =
    aCarregar
      ? "A procurar…"
      : lista.estado === "erro"
        ? ""
        : total === 0
          ? "Nada encontrado com estes filtros."
          : `${plural(total, "resultado", "resultados")}${filtrado ? " com estes filtros" : ""}.`;

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="O que se passa" />
      <Cabecalho
        meta={nome ? `Câmara Municipal de ${nome}` : "A sua câmara"}
        titulo="O que se passa perto de si"
        sub="Obras e cortes, incidentes, avisos, eventos e consultas públicas no concelho."
      />

      {emergencias.length > 0 && (
        <section
          aria-labelledby="emergencias"
          className="flex w-full flex-col gap-3 rounded-[24px_24px_24px_6px] p-5 text-white"
          style={{ background: ESTILO_EMERGENCIA.cor }}
        >
          <p id="emergencias" className="flex items-center gap-2 text-[13px] font-bold tracking-[1px] uppercase">
            <Siren className="size-5" aria-hidden />
            {emergencias.length === 1 ? "Emergência em curso" : `${emergencias.length} emergências em curso`}
          </p>
          <ul className="flex flex-col gap-3">
            {emergencias.map((e) => (
              <li key={e.id}>
                <Link
                  href={caminhoDetalhe(slug, e)}
                  className="flex flex-col gap-1 rounded-xl bg-white/10 p-3 hover:bg-white/20"
                >
                  <span className="font-display text-[20px] leading-tight font-bold">{e.titulo}</span>
                  <span className="text-[15px] leading-[1.45] text-white">{e.resumo}</span>
                  {ondeDito(e) && <span className="text-[14px] text-white">{ondeDito(e)}</span>}
                  <span className="inline-flex min-h-8 items-center gap-1 text-[15px] font-semibold underline">
                    Ver o que fazer
                    <ChevronRight className="size-4" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <a
            href="tel:112"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 text-[17px] font-bold"
            style={{ color: ESTILO_EMERGENCIA.cor }}
          >
            <Phone className="size-5" aria-hidden />
            Em perigo? Ligue 112
          </a>
        </section>
      )}

      {/* Perto de mim */}
      <section aria-labelledby="perto" className="flex w-full flex-col gap-3 rounded-2xl border border-linha bg-papel p-4">
        <h2 id="perto" className="font-display text-[19px] font-bold text-tinta">
          Perto de mim
        </h2>
        {geo === "ok" && perto ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="raio" className="text-[15px] font-semibold text-tinta">
                Até que distância?
              </label>
              <select
                id="raio"
                value={raio}
                onChange={(e) => setRaio(Number(e.target.value))}
                className="min-h-12 w-full rounded-xl border-[1.5px] border-linha bg-white px-3 text-[16px] text-tinta"
              >
                {RAIOS.map((m) => (
                  <option key={m} value={m}>
                    {raioDito(m)} de onde estou
                  </option>
                ))}
              </select>
            </div>
            <Botao variante="secundario" tamanho="grande" icone={LocateOff} onClick={deixarLocalizacao} className="w-full">
              Deixar de usar a localização
            </Botao>
          </>
        ) : (
          <Botao
            variante="secundario"
            tamanho="grande"
            icone={geo === "a_pedir" ? LoaderCircle : LocateFixed}
            onClick={pedirLocalizacao}
            disabled={geo === "a_pedir"}
            className="w-full"
          >
            {geo === "a_pedir" ? "A saber onde está…" : "Usar a minha localização"}
          </Botao>
        )}
        {(geo === "recusado" || geo === "indisponivel") && (
          <Nota icone={MapPin} tom="ambar" papel="status">
            {geo === "recusado"
              ? "O browser não nos deixa usar a localização. Pode autorizá-la nas definições do site (o cadeado ao lado do endereço) ou escolher a sua freguesia aqui em baixo."
              : "O telemóvel não nos deu a localização. Confirme que a localização está ligada (nas definições rápidas, puxando o ecrã de cima para baixo) e carregue outra vez em «Usar a minha localização», ou escolha a sua freguesia aqui em baixo."}
          </Nota>
        )}
        <p className="text-[13px] leading-[1.45] text-tinta-3">
          A sua localização só serve para esta pesquisa: não fica guardada.
        </p>
      </section>

      {/* Filtros */}
      <section aria-labelledby="filtros" className="flex w-full flex-col gap-4">
        <h2 id="filtros" className="sr-only">
          Filtros
        </h2>
        <div className="flex flex-col gap-2" role="group" aria-labelledby="rot-tipos">
          <Rotulo id="rot-tipos">O que quer ver</Rotulo>
          <div className="flex flex-wrap gap-2">
            {TIPOS_ITEM.map((t) => (
              <Alternar key={t} ativo={tipos.includes(t)} onClick={() => alternarTipo(t)} cor={ESTILO_TIPO[t].cor}>
                {ESTILO_TIPO[t].nome}
              </Alternar>
            ))}
          </div>
          <p className="text-[13px] text-tinta-3">Sem nenhum escolhido, mostramos tudo. As emergências aparecem sempre.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="freguesia" className="text-[11px] font-bold tracking-[1px] text-tinta-3 uppercase">
            Freguesia
          </label>
          <select
            id="freguesia"
            ref={refFreguesia}
            value={freguesia}
            onChange={(e) => setFreguesia(e.target.value)}
            className="min-h-12 w-full rounded-xl border-[1.5px] border-linha bg-white px-3 text-[16px] text-tinta"
          >
            <option value="">Todo o concelho</option>
            {freguesia && !freguesias.includes(freguesia) && <option value={freguesia}>{freguesia}</option>}
            {freguesias.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2" role="group" aria-labelledby="rot-quando">
          <Rotulo id="rot-quando">Quando</Rotulo>
          <div className="flex flex-wrap gap-2">
            {PERIODOS.map((p) => (
              <Alternar key={p.id} ativo={periodo.id === p.id} onClick={() => escolherPeriodo(p.id)}>
                {p.nome}
              </Alternar>
            ))}
          </div>
        </div>
      </section>

      {/* Lista / Mapa */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div role="group" aria-label="Ver em" className="flex gap-2">
            <Alternar ativo={modo === "lista"} onClick={() => setModo("lista")}>
              <List className="size-4" aria-hidden />
              Lista
            </Alternar>
            <Alternar ativo={modo === "mapa"} onClick={() => setModo("mapa")} refBotao={refBotaoMapa}>
              <IconeMapa className="size-4" aria-hidden />
              Mapa
            </Alternar>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-[15px] font-semibold text-tinta">
            {anuncio}
          </p>
          {parametros?.demonstracao && <ModoTeste texto="valores de demonstração" />}
        </div>
      </div>

      {!aCarregar && lista.estado === "erro" && (
        <div role="alert" className="flex flex-col gap-3">
          <Nota icone={RotateCcw} tom="terracota">
            Não conseguimos abrir a lista. {lista.mensagem}
          </Nota>
          <Botao tamanho="grande" icone={RotateCcw} onClick={() => setTentativa((n) => n + 1)} className="w-full">
            Tentar outra vez
          </Botao>
        </div>
      )}

      {aCarregar && !lista.resposta && (
        <div className="flex flex-col items-center gap-3 py-10 text-tinta-2">
          <LoaderCircle className="size-8 animate-spin text-terracota" aria-hidden />
          <p className="text-[16px]">A procurar o que se passa…</p>
        </div>
      )}

      {lista.resposta && (aCarregar || lista.estado !== "erro") && (
        <div className={`flex flex-col gap-4 ${aCarregar ? "opacity-60" : ""}`}>
          {total === 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-linha p-5">
              <p className="text-[16px] text-tinta">
                {filtrado
                  ? "Não há nada com estes filtros. Experimente alargar a distância ou escolher outro período."
                  : "Neste momento não há nada a assinalar no concelho."}
              </p>
              {filtrado && (
                <Botao variante="secundario" tamanho="grande" onClick={limparFiltros} className="w-full">
                  Limpar os filtros
                </Botao>
              )}
            </div>
          )}

          {itensLista.length > 0 && (
            <ul ref={refLista} aria-label="O que se passa" className="flex flex-col gap-3">
              {itensLista.map((i) => (
                <CartaoItem key={`${i.fonte}-${i.id}`} item={i} slug={slug} novoHoras={parametros?.novos_horas ?? 48} />
              ))}
            </ul>
          )}

          {lista.cursor && (
            <div className="flex flex-col gap-2">
              <Botao
                variante="secundario"
                tamanho="grande"
                icone={aCarregarMais ? LoaderCircle : undefined}
                onClick={() => void verMais()}
                disabled={aCarregarMais}
                className="w-full"
              >
                {aCarregarMais ? "A carregar…" : `Ver mais (${total - lista.itens.length} por ver)`}
              </Botao>
              {erroMais && (
                <p role="alert" className="text-[14px] text-terracota-escuro">
                  {erroMais}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {modo === "mapa" && (
        <EcraMapa
          slug={slug}
          nomeMunicipio={nome}
          base={{ freguesia: freguesia || undefined, de: periodo.de, ate: periodo.ate }}
          emergencias={emergencias}
          pertoInicial={perto ? { ...perto, raio_m: raio } : null}
          aoFechar={() => {
            setModo("lista");
            requestAnimationFrame(() => refBotaoMapa.current?.focus());
          }}
        />
      )}

      <ReceberAvisos telefone={telefoneSms} />

      {parametros?.demonstracao && (
        <p className="text-[13px] leading-[1.45] text-tinta-3">{parametros.nota}</p>
      )}
      <p className="text-[13px] leading-[1.45] text-tinta-3">
        Sem dados pessoais: os incidentes aparecem sem quem os comunicou e sem o número da porta.
      </p>
    </div>
  );
}
