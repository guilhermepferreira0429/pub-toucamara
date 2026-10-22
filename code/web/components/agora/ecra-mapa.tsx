"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Layers,
  List,
  LoaderCircle,
  LocateFixed,
  Map as IconeMapa,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ROTA_CHAT } from "@/components/municipe/moldura";
import { mensagemDe } from "@/components/municipe/use-publico";
import { MapaCidade } from "@/components/mapa/mapa-cidade";
import { pedirLocalizacao } from "@/components/mapa/geometria";
import type { ApiMapa, FormaMapa, LatLng, MarcadorMapa } from "@/components/mapa/tipos";
import { BotaoVidro, ChipVidro, PainelVidro } from "@/components/mapa/vidro";
import { api } from "@/lib/api";
import { chaveItem, formaDeItem, marcadorDeItem, nomeAcessivel } from "./marcadores";
import {
  caminhoDetalhe,
  eEmergencia,
  ESTILO_EMERGENCIA,
  ESTILO_TIPO,
  estiloDe,
  ondeDito,
  quandoDito,
  raioDito,
  TIPOS_ITEM,
  type ItemAgora,
  type RespostaFeed,
  type TipoItem,
} from "./tipos";

/*
 * O mapa a ecrã inteiro do "o que se passa" (/agora/[municipio]?ver=mapa):
 * a cidade em 3D oblíquo (Mapbox) com chips em vidro por tipo (com
 * contagem), bolhas por item, emergências a pulsar, "perto de mim" e o
 * detalhe numa folha em baixo (telemóvel) ou num painel ao lado (ecrã
 * largo). Sem token do Mapbox, o mesmo ecrã em 2D (OpenStreetMap).
 *
 * Acessibilidade: é um diálogo (o resto da página fica inerte), Escape fecha
 * o detalhe e depois o mapa, os marcadores são botões com nome, e a lista
 * ("Lista", em baixo) continua a ser a alternativa com tudo.
 */

const LIMITE_MAPA = 100;
const RAIO_PERTO = 1000;
/** Acima disto (e com o mapa afastado) os marcadores ficam só com o ícone. */
const MAX_BOLHAS = 6;

type Filtro = "todos" | "emergencias" | TipoItem;

function useLargo(): boolean {
  const [largo, setLargo] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const mudar = () => setLargo(mq.matches);
    mudar();
    mq.addEventListener("change", mudar);
    return () => mq.removeEventListener("change", mudar);
  }, []);
  return largo;
}

function Partilhar({ item, slug }: { item: ItemAgora; slug: string }) {
  const [estado, setEstado] = useState<"nada" | "copiado" | "falhou">("nada");
  async function partilhar() {
    const url = new URL(caminhoDetalhe(slug, item), window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: item.titulo, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setEstado("copiado");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setEstado("falhou");
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => void partilhar()}
        className="inline-flex h-14 items-center justify-center gap-2 rounded-full border-[1.5px] border-tinta px-5 text-[17px] font-semibold text-tinta hover:bg-tinta/5"
      >
        {estado === "copiado" ? <Check className="size-5" aria-hidden /> : <Share2 className="size-5" aria-hidden />}
        Partilhar
      </button>
      <p role="status" className="sr-only">
        {estado === "copiado" ? "Link copiado." : estado === "falhou" ? "Não foi possível partilhar." : ""}
      </p>
    </>
  );
}

/** O detalhe do item escolhido (folha em baixo ou painel ao lado). */
function Detalhe({
  item,
  slug,
  largo,
  aoFechar,
  refFechar,
}: {
  item: ItemAgora;
  slug: string;
  largo: boolean;
  aoFechar: () => void;
  refFechar: React.RefObject<HTMLButtonElement | null>;
}) {
  const e = estiloDe(item);
  const Icone = e.icone;
  const quando = quandoDito(item);
  const onde = ondeDito(item);
  const emergencia = eEmergencia(item);
  return (
    <PainelVidro
      role="region"
      aria-labelledby="mapa-detalhe-titulo"
      className={
        largo
          ? "absolute top-3 right-3 bottom-3 z-10 flex w-[400px] flex-col gap-4 overflow-y-auto p-6"
          : "absolute inset-x-2 bottom-[84px] z-10 flex max-h-[min(58dvh,520px)] flex-col gap-3 overflow-y-auto rounded-[28px] p-5"
      }
    >
      {!largo && <span aria-hidden className="mx-auto -mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-tinta/20" />}
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mapa-bolha-icone shrink-0"
          style={{ "--cor": e.cor, width: 48, height: 48, borderRadius: 16 } as CSSProperties}
        >
          <Icone className="size-6" color="#fff" strokeWidth={2.25} />
        </span>
        <p className="flex min-w-0 flex-1 flex-col pt-0.5">
          <span className="text-[12px] font-bold tracking-[0.8px] text-tinta-2 uppercase">{e.singular}</span>
          <span className="text-[14px] font-semibold text-tinta">{item.etiqueta}</span>
        </p>
        <button
          ref={refFechar}
          type="button"
          onClick={aoFechar}
          aria-label="Fechar o detalhe"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tinta/8 text-tinta hover:bg-tinta/15"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      {largo && item.imagem && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imagem} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover" />
      )}
      <h3
        id="mapa-detalhe-titulo"
        className={`font-display leading-[1.1] font-bold text-tinta ${largo ? "text-[30px]" : "text-[24px]"}`}
      >
        {item.titulo}
      </h3>
      {(quando || onde) && (
        <div className="flex flex-col gap-1.5 text-[15px] text-tinta">
          {quando && (
            <span className="flex items-start gap-2">
              <Clock className="mt-0.5 size-4 shrink-0 text-tinta-2" aria-hidden />
              {quando}
            </span>
          )}
          {onde && (
            <span className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-tinta-2" aria-hidden />
              {onde}
            </span>
          )}
        </div>
      )}
      <p className={`text-[16px] leading-[1.5] text-tinta ${largo ? "" : "line-clamp-4"}`}>{item.resumo}</p>
      <div className="mt-auto flex flex-col gap-2.5 pt-1">
        {emergencia && (
          <a
            href="tel:112"
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full px-5 text-[17px] font-bold text-white"
            style={{ background: ESTILO_EMERGENCIA.cor }}
          >
            <Phone className="size-5" aria-hidden />
            Em perigo? Ligue 112
          </a>
        )}
        <Link
          href={caminhoDetalhe(slug, item)}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-terracota px-5 text-[17px] font-semibold text-white hover:bg-terracota-escuro"
        >
          {emergencia ? "Ver o que fazer" : "Ver tudo sobre isto"}
          <ArrowRight className="size-5" aria-hidden />
        </Link>
        <Partilhar item={item} slug={slug} />
      </div>
    </PainelVidro>
  );
}

export function EcraMapaAgora({
  slug,
  nomeMunicipio,
  base,
  emergencias,
  pertoInicial,
  aoFechar,
}: {
  slug: string;
  nomeMunicipio?: string;
  /** Os filtros da lista (freguesia, período), sem os tipos: os chips filtram aqui. */
  base: { freguesia?: string; de?: string; ate?: string };
  emergencias: ItemAgora[];
  pertoInicial: { lat: number; lng: number; raio_m: number } | null;
  aoFechar: () => void;
}) {
  const largo = useLargo();
  const [itens, setItens] = useState<ItemAgora[] | null>(null);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [perto, setPerto] = useState(pertoInicial);
  const [geo, setGeo] = useState<"inativo" | "a_pedir" | "erro">("inativo");
  const [zoom, setZoom] = useState(14);
  const refVoltar = useRef<HTMLButtonElement>(null);
  const refFechar = useRef<HTMLButtonElement>(null);
  const apiMapa = useRef<ApiMapa | null>(null);
  // Só corre no browser (next/dynamic sem SSR).
  const raiz = typeof document === "undefined" ? null : document.body;

  // Portal para o <body> e o resto da página inerte (é um diálogo).
  useEffect(() => {
    const fundo = document.querySelector<HTMLElement>(".zona-municipe");
    fundo?.setAttribute("inert", "");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      fundo?.removeAttribute("inert");
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    if (raiz) refVoltar.current?.focus();
  }, [raiz]);

  // Os itens para o mapa (até 100), com os filtros da lista.
  const consulta = useMemo(() => {
    const q = new URLSearchParams();
    if (perto) {
      q.set("lat", perto.lat.toFixed(5));
      q.set("lng", perto.lng.toFixed(5));
      q.set("raio_m", String(perto.raio_m));
    }
    if (base.freguesia) q.set("freguesia", base.freguesia);
    if (base.de) q.set("de", base.de);
    if (base.ate) q.set("ate", base.ate);
    q.set("limite", String(LIMITE_MAPA));
    return q.toString();
  }, [perto, base.freguesia, base.de, base.ate]);
  useEffect(() => {
    const ctrl = new AbortController();
    api<RespostaFeed>(`/v1/public/agora/${encodeURIComponent(slug)}?${consulta}`, { sinal: ctrl.signal })
      .then((r) => {
        setItens(r.itens);
        setTotal(r.total);
        setErro(null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setErro(mensagemDe(e));
      });
    return () => ctrl.abort();
  }, [slug, consulta]);

  // Todos = os itens + as emergências do concelho (sempre).
  const todos = useMemo(() => {
    const vistos = new Set<string>();
    const lista: ItemAgora[] = [];
    for (const i of [...emergencias, ...(itens ?? [])]) {
      const k = chaveItem(i);
      if (!vistos.has(k)) {
        vistos.add(k);
        lista.push(i);
      }
    }
    return lista;
  }, [itens, emergencias]);
  const comLugar = todos.filter((i) => i.lat !== null && i.lng !== null);
  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: comLugar.length, emergencias: 0 };
    for (const t of TIPOS_ITEM) c[t] = 0;
    for (const i of comLugar) {
      if (eEmergencia(i)) c.emergencias++;
      else c[i.tipo]++;
    }
    return c;
  }, [comLugar]);
  const visiveis = comLugar.filter((i) =>
    filtro === "todos" ? true : filtro === "emergencias" ? eEmergencia(i) : !eEmergencia(i) && i.tipo === filtro,
  );
  const item = todos.find((i) => chaveItem(i) === selecionado) ?? null;

  const compacto = visiveis.length > MAX_BOLHAS && zoom < 15.5;
  const marcadores = visiveis
    .map((i) => marcadorDeItem(i, { selecionado: chaveItem(i) === selecionado, compacto }))
    .filter((m): m is MarcadorMapa => !!m);
  const formas: FormaMapa[] = visiveis
    .map((i) => formaDeItem(i, { selecionado: chaveItem(i) === selecionado }))
    .filter((f): f is FormaMapa => !!f);
  if (perto) {
    formas.push({
      id: "perto",
      tipo: "circulo",
      centro: perto,
      raio_m: perto.raio_m,
      cor: "#15263b",
      preenchimento: 0.05,
      espessura: 2,
      tracejado: true,
    });
  }
  const enquadrar: LatLng[] = visiveis.map((i) => ({ lat: i.lat as number, lng: i.lng as number }));
  if (perto) enquadrar.push(perto);

  const selecionar = useCallback(
    (id: string) => {
      setSelecionado(id);
      const i = todos.find((x) => chaveItem(x) === id);
      if (i && i.lat !== null && i.lng !== null) {
        const p = { lat: i.lat, lng: i.lng };
        // Depois de o mapa saber das margens novas (folha/painel).
        requestAnimationFrame(() => apiMapa.current?.voarPara(p, Math.max(apiMapa.current.zoom(), 15.5)));
      }
      requestAnimationFrame(() => refFechar.current?.focus());
    },
    [todos],
  );
  const fecharDetalhe = useCallback(() => {
    const nome = item ? nomeAcessivel(item) : null;
    setSelecionado(null);
    // O foco volta ao marcador do item (ou ao "voltar à lista").
    requestAnimationFrame(() => {
      const el = nome
        ? document.querySelector<HTMLElement>(`.mapa-marcador[aria-label="${CSS.escape(nome)}"]`)
        : null;
      (el ?? refVoltar.current)?.focus();
    });
  }, [item]);

  useEffect(() => {
    function tecla(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      if (selecionado) fecharDetalhe();
      else aoFechar();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [selecionado, fecharDetalhe, aoFechar]);

  function pertoDeMim() {
    if (perto) {
      setPerto(null);
      return;
    }
    setGeo("a_pedir");
    pedirLocalizacao()
      .then((p) => {
        setGeo("inativo");
        setPerto({ ...p, raio_m: RAIO_PERTO });
      })
      .catch(() => setGeo("erro"));
  }

  const chips: { id: Filtro; nome: string; cor?: string; icone?: typeof Layers }[] = [
    { id: "todos", nome: "Tudo", icone: Layers, cor: "#15263b" },
    ...(contagem.emergencias
      ? [{ id: "emergencias" as Filtro, nome: "Emergências", cor: ESTILO_EMERGENCIA.cor, icone: ESTILO_EMERGENCIA.icone }]
      : []),
    ...TIPOS_ITEM.map((t) => ({ id: t as Filtro, nome: ESTILO_TIPO[t].nome, cor: ESTILO_TIPO[t].cor, icone: ESTILO_TIPO[t].icone })),
  ];

  const resumo =
    itens === null
      ? "A procurar o que se passa…"
      : `${visiveis.length === 1 ? "1 sítio" : `${visiveis.length} sítios`} no mapa${perto ? `, até ${raioDito(perto.raio_m)} de si` : ""}`;

  const margens = largo
    ? { topo: 132, baixo: 24, direita: item ? 416 : 0 }
    : { topo: 136, baixo: item ? 360 : 96 };

  if (!raiz) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mapa-agora-titulo"
      className="zona-municipe-cores fixed inset-0 z-[60] bg-creme-2 font-body text-tinta"
    >
      <MapaCidade
        rotulo="Mapa do que se passa (a lista tem a mesma informação)"
        className="absolute inset-0"
        marcadores={marcadores}
        formas={formas}
        enquadrar={enquadrar}
        zoomMaximo={15.5}
        selecionado={selecionado}
        aoSelecionar={selecionar}
        aoMover={(m) => setZoom(m.zoom)}
        aqui={perto ? { lat: perto.lat, lng: perto.lng } : null}
        vista="3d"
        cooperativo={false}
        rodaRato
        controlos={{ zoom: largo, bussola: true, localizacao: true, vista3d: true, satelite: true, posicao: largo ? "direita-baixo" : "direita" }}
        aoPronto={(a) => {
          apiMapa.current = a;
        }}
        margens={margens}
      />

      {/* Topo: voltar, título e os chips por tipo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2.5 p-3 lg:max-w-[calc(100%-440px)]">
        <div className="pointer-events-auto flex items-center gap-2">
          <BotaoVidro ref={refVoltar} rotulo="Voltar à lista" icone={ArrowLeft} onClick={aoFechar} />
          <PainelVidro className="flex min-h-12 min-w-0 flex-col justify-center rounded-[20px] px-4 py-1.5">
            <h2 id="mapa-agora-titulo" className="font-display text-[17px] leading-tight font-bold">
              O que se passa{nomeMunicipio ? ` em ${nomeMunicipio}` : ""}
            </h2>
            <p role="status" aria-live="polite" className="truncate text-[13px] font-semibold text-tinta-2">
              {erro ? `Não conseguimos abrir o mapa. ${erro}` : resumo}
              {itens !== null && total > LIMITE_MAPA ? ` (os ${LIMITE_MAPA} mais recentes de ${total})` : ""}
            </p>
          </PainelVidro>
        </div>
        <div
          role="group"
          aria-label="Mostrar no mapa"
          className="pointer-events-auto -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]"
        >
          {chips.map((c) => (
            <ChipVidro
              key={c.id}
              ativo={filtro === c.id}
              onClick={() => {
                setFiltro(c.id);
                setSelecionado(null);
              }}
              contagem={contagem[c.id] ?? 0}
              cor={c.cor}
              icone={c.icone}
            >
              {c.nome}
            </ChipVidro>
          ))}
        </div>
      </div>

      {item && (
        <Detalhe item={item} slug={slug} largo={largo} aoFechar={fecharDetalhe} refFechar={refFechar} />
      )}

      {/* Barra de baixo em vidro */}
      <nav
        aria-label="O que se passa"
        className={`mapa-vidro absolute bottom-3 left-1/2 z-10 flex w-[calc(100%-24px)] max-w-[460px] -translate-x-1/2 items-stretch justify-around rounded-full p-1.5 ${largo && item ? "lg:left-[calc(50%-208px)]" : ""}`}
      >
        <button type="button" onClick={aoFechar} className="mapa-nav-item">
          <List className="size-5" aria-hidden />
          Lista
        </button>
        <span aria-current="page" className="mapa-nav-item mapa-nav-atual">
          <IconeMapa className="size-5" aria-hidden />
          Mapa
        </span>
        <button
          type="button"
          onClick={pertoDeMim}
          aria-pressed={!!perto}
          disabled={geo === "a_pedir"}
          className="mapa-nav-item"
        >
          {geo === "a_pedir" ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
          ) : (
            <LocateFixed className="size-5" aria-hidden />
          )}
          Perto de mim
        </button>
        <Link href={ROTA_CHAT} className="mapa-nav-item">
          <MessageCircle className="size-5" aria-hidden />
          Perguntar
        </Link>
      </nav>
      {geo === "erro" && (
        <p role="alert" className="mapa-vidro absolute bottom-[84px] left-1/2 z-10 -translate-x-1/2 rounded-2xl px-4 py-2 text-[14px]">
          Não conseguimos saber onde está.
        </p>
      )}
    </div>,
    raiz,
  );
}
