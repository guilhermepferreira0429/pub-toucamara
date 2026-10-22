"use client";

import {
  CalendarDays,
  ChevronDown,
  ExternalLink,
  Info,
  MapPin,
  MessageCircle,
  QrCode,
  RotateCcw,
  Siren,
  Star,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chat } from "@/components/chat/chat";
import { Nota, Rotulo, TituloSecao, Topo } from "@/components/municipe/moldura";
import { usePublico } from "@/components/municipe/use-publico";
import { Botao } from "@/components/ui/botao";
import type { MarcaMapa } from "./mapa-visitar";
import { CODIGO_LINGUA, LINGUAS, NOME_LINGUA, TEXTOS, type Lingua, type Textos } from "./textos";

/*
 * "Visitar" (/visitar/[municipio]): a entrada própria para turistas, em
 * português, inglês, espanhol e francês. O conteúdo vem das fontes de turismo
 * da câmara (Conhecimento › Fontes, editáveis no painel) na língua escolhida;
 * os eventos vêm do /agora. Mobile-first, na coluna das páginas do munícipe.
 * O mapa tem alternativa nas listas (pontos, roteiros e eventos).
 */

const Mapa = dynamic(() => import("./mapa-visitar"), {
  ssr: false,
  loading: () => <div className="h-[380px] w-full animate-pulse rounded-2xl bg-creme-2" />,
});

type Acesso = "boa" | "parcial" | "dificil";

interface PontoApi {
  chave: string;
  nome: string;
  categoria: "monumento" | "museu" | "natureza" | "transporte";
  lat: number;
  lng: number;
  minutos: number;
  acessibilidade: Acesso;
  destaque?: boolean;
  fora_do_centro?: boolean;
  descricao: string | null;
  mapa: string;
}

interface ParagemApi {
  chave: string;
  nome: string;
  minutos: number;
  chegada_min: number;
  acessibilidade: Acesso;
  fora_do_centro: boolean;
  lat: number;
  lng: number;
}

interface RoteiroApi {
  paragens: ParagemApi[];
  minutos_total: number;
  sobra_min: number;
  excluidos_mobilidade: string[];
}

interface EventoApi {
  id: string;
  titulo: string;
  resumo: string;
  inicio: string | null;
  lat: number | null;
  lng: number | null;
  rua: string | null;
  link: string;
}

interface TemaApi {
  tema: string;
  titulo: string;
  lingua: string;
  url: string;
  entidade: string;
  demonstracao: boolean;
  seccoes: { titulo: string | null; texto: string; ponto: string | null }[];
}

interface RespostaTurismo {
  municipio: { slug: string; nome: string };
  lingua: Lingua;
  linguas_disponiveis: string[];
  demonstracao: boolean;
  temas: TemaApi[];
  pontos: PontoApi[];
  eventos: EventoApi[];
  roteiros: (RoteiroApi & { chave: string })[];
}

export interface PedidoInicial {
  minutos?: number;
  interesses?: string;
  mobilidade?: boolean;
}

/** "Turismo · Museus" → "Museus". */
function semPrefixo(titulo: string): string {
  const i = titulo.indexOf("·");
  return i >= 0 ? titulo.slice(i + 1).trim() : titulo;
}

const ACESSO_TOM: Record<Acesso, string> = {
  boa: "bg-verde-suave text-verde",
  parcial: "bg-ambar-suave text-ambar",
  dificil: "bg-terracota-suave text-terracota-escuro",
};

function Acessibilidade({ a, t }: { a: Acesso; t: Textos }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-bold ${ACESSO_TOM[a]}`}>
      {t.acessibilidade[a]}
    </span>
  );
}

function Seletor({ lingua, aoMudar, t }: { lingua: Lingua; aoMudar: (l: Lingua) => void; t: Textos }) {
  return (
    <div role="group" aria-label={t.escolherLingua} className="flex flex-wrap gap-1.5">
      {LINGUAS.map((l) => (
        <button
          key={l}
          type="button"
          lang={CODIGO_LINGUA[l]}
          aria-pressed={lingua === l}
          onClick={() => aoMudar(l)}
          className={`min-h-11 rounded-full border px-3.5 text-[14px] font-semibold transition-colors ${
            lingua === l ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta hover:bg-creme-2"
          }`}
        >
          {NOME_LINGUA[l]}
        </button>
      ))}
    </div>
  );
}

function Paragens({ r, t, pontos }: { r: RoteiroApi; t: Textos; pontos: Map<string, PontoApi> }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[14px] text-tinta-2">{t.duracao(r.minutos_total)}</p>
      <ol className="flex flex-col gap-2">
        {r.paragens.map((p, i) => (
          <li key={p.chave} className="flex gap-3 rounded-2xl border border-linha bg-papel p-3.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-terracota text-[15px] font-bold text-white"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[16px] font-bold text-tinta">{p.nome}</p>
              <p className="text-[13px] text-tinta-2">
                {t.chegada(p.chegada_min)} · {t.minutos(p.minutos)}
                {p.fora_do_centro ? ` · ${t.foraDoCentro}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Acessibilidade a={p.acessibilidade} t={t} />
                {pontos.get(p.chave) && (
                  <a
                    href={pontos.get(p.chave)!.mapa}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-terracota-escuro underline"
                  >
                    {t.abrirMapa}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {r.excluidos_mobilidade.length > 0 && <p className="text-[13px] text-tinta-2">{t.excluidos(r.excluidos_mobilidade.join(", "))}</p>}
    </div>
  );
}

function Tema({ tema, t }: { tema: TemaApi; t: Textos }) {
  return (
    <details className="group rounded-2xl border border-linha bg-papel">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[16px] font-bold text-tinta [&::-webkit-details-marker]:hidden">
        {semPrefixo(tema.titulo)}
        <ChevronDown className="size-5 shrink-0 text-tinta-2 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-4 border-t border-linha px-4 pb-4 pt-3">
        {tema.seccoes
          .filter((s) => s.titulo)
          .map((s, i) => (
            <section key={`${s.titulo}-${i}`} id={s.ponto ? `ponto-${s.ponto}` : undefined} className="flex flex-col gap-1">
              <h3 className="text-[15px] font-bold text-tinta">{s.titulo}</h3>
              {s.texto.split("\n").map((linha, j) => (
                <p key={j} className="text-[15px] leading-[1.5] text-tinta-2">
                  {linha}
                </p>
              ))}
            </section>
          ))}
        <p className="text-[12px] text-tinta-3">
          {t.fonte(tema.titulo, tema.entidade)}
          {tema.demonstracao ? ` · ${t.demonstracao}` : ""}
        </p>
      </div>
    </details>
  );
}

export function Visitar({ slug, linguaInicial, pedido }: { slug: string; linguaInicial: Lingua; pedido?: PedidoInicial }) {
  const [lingua, setLingua] = useState<Lingua>(linguaInicial);
  const t = TEXTOS[lingua];
  const { c, tentarOutraVez } = usePublico<RespostaTurismo>(`/v1/public/turismo/${encodeURIComponent(slug)}?lingua=${lingua}`);

  const caminhoPedido = pedido?.minutos
    ? `/v1/public/turismo/${encodeURIComponent(slug)}/roteiro?lingua=${lingua}&minutos=${pedido.minutos}${
        pedido.interesses ? `&interesses=${encodeURIComponent(pedido.interesses)}` : ""
      }${pedido.mobilidade ? "&mobilidade=1" : ""}`
    : null;
  const proprio = usePublico<RoteiroApi>(caminhoPedido ?? `/v1/public/turismo/${encodeURIComponent(slug)}/roteiro?lingua=${lingua}`);
  const [escolhido, setEscolhido] = useState<string>(caminhoPedido ? "seu" : "duas_horas");
  const [chatAberto, setChatAberto] = useState(false);

  function mudarLingua(l: Lingua) {
    setLingua(l);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("lingua", l);
      window.history.replaceState(null, "", u.toString());
    } catch {
      // sem histórico: fica só no estado
    }
  }

  const dados = c.estado === "ok" ? c.dados : null;
  const pontos = useMemo(() => new Map((dados?.pontos ?? []).map((p) => [p.chave, p])), [dados]);
  const roteiro: RoteiroApi | null =
    escolhido === "seu"
      ? proprio.c.estado === "ok"
        ? proprio.c.dados
        : null
      : (dados?.roteiros.find((r) => r.chave === escolhido) ?? null);

  const marcas: MarcaMapa[] = useMemo(() => {
    if (!dados) return [];
    const ordem = new Map((roteiro?.paragens ?? []).map((p, i) => [p.chave, i + 1]));
    const ms: MarcaMapa[] = dados.pontos.map((p) => ({
      id: `p-${p.chave}`,
      nome: p.nome,
      lat: p.lat,
      lng: p.lng,
      tipo: p.categoria,
      numero: ordem.get(p.chave),
      detalhe: p.descricao?.split("\n")[0] ?? null,
    }));
    for (const e of dados.eventos) {
      if (e.lat === null || e.lng === null) continue;
      ms.push({ id: `e-${e.id}`, nome: e.titulo, lat: e.lat, lng: e.lng, tipo: "evento", detalhe: t.quando(e.inicio) });
    }
    return ms;
  }, [dados, roteiro, t]);

  const linha = roteiro?.paragens.filter((p) => !p.fora_do_centro).map((p) => [p.lat, p.lng] as [number, number]);

  return (
    <div lang={CODIGO_LINGUA[lingua]} className="flex w-full flex-col gap-7">
      <Topo />
      <Seletor lingua={lingua} aoMudar={mudarLingua} t={t} />

      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-bold tracking-[1.2px] text-terracota uppercase">{dados?.municipio.nome ?? ""}</p>
        <h1 className="font-display text-[34px] leading-[1.04] font-bold tracking-[-0.9px] text-tinta">
          {t.titulo(dados?.municipio.nome ?? "")}
        </h1>
        <p className="text-[16px] leading-[1.45] text-tinta-2">{t.subtitulo}</p>
      </div>

      {c.estado === "a_carregar" && (
        <p role="status" className="py-8 text-center text-tinta-2">
          {t.aCarregar}
        </p>
      )}
      {(c.estado === "erro" || c.estado === "invalido") && (
        <div role="alert" className="flex flex-col gap-3">
          <p className="text-[16px] text-tinta">{t.erro}</p>
          <Botao tamanho="grande" icone={RotateCcw} onClick={tentarOutraVez}>
            {t.tentar}
          </Botao>
        </div>
      )}

      {dados && (
        <>
          {dados.demonstracao && (
            <Nota icone={Info}>
              <strong className="font-bold">{t.demonstracao}.</strong> {t.avisoDemo}
            </Nota>
          )}
          {!dados.pontos.length && !dados.temas.length && <p className="text-[16px] text-tinta-2">{t.vazio}</p>}

          {/* O que ver hoje */}
          <section aria-labelledby="hoje" className="flex flex-col gap-3">
            <TituloSecao id="hoje">{t.hoje}</TituloSecao>
            {dados.eventos.length > 0 ? (
              <>
                <Rotulo>{t.eventosProximos}</Rotulo>
                <ul className="flex flex-col gap-2">
                  {dados.eventos.slice(0, 4).map((e) => (
                    <li key={e.id}>
                      <a
                        href={e.link}
                        className="flex gap-3 rounded-2xl border border-linha bg-papel p-3.5 transition-colors hover:bg-creme-2"
                      >
                        <CalendarDays className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-[16px] font-bold text-tinta">{e.titulo}</span>
                          {t.quando(e.inicio) && <span className="text-[14px] text-tinta-2">{t.quando(e.inicio)}</span>}
                          {e.rua && <span className="text-[13px] text-tinta-3">{e.rua}</span>}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[15px] text-tinta-2">{t.hojeVazio}</p>
            )}
            <Rotulo>{t.imperdiveis}</Rotulo>
            <ul className="flex flex-col gap-2">
              {dados.pontos
                .filter((p) => p.destaque)
                .map((p) => (
                  <li key={p.chave} className="flex gap-3 rounded-2xl border border-linha bg-papel p-3.5">
                    <Star className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-[16px] font-bold text-tinta">{p.nome}</p>
                      {p.descricao && <p className="text-[14px] leading-[1.45] text-tinta-2">{p.descricao.split("\n")[0]}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <Acessibilidade a={p.acessibilidade} t={t} />
                        <a href={`#ponto-${p.chave}`} className="inline-flex min-h-11 items-center text-[14px] font-semibold text-terracota-escuro underline">
                          {t.saberMais}
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          </section>

          {/* Roteiros */}
          <section aria-labelledby="roteiro" className="flex scroll-mt-4 flex-col gap-3">
            <TituloSecao id="roteiro">{t.roteiros}</TituloSecao>
            <div role="group" aria-label={t.roteiros} className="flex flex-col gap-1.5">
              {[...(caminhoPedido ? ["seu"] : []), ...dados.roteiros.map((r) => r.chave)].map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={escolhido === k}
                  onClick={() => setEscolhido(k)}
                  className={`min-h-11 rounded-xl border px-3.5 py-2 text-left text-[15px] font-semibold transition-colors ${
                    escolhido === k ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta hover:bg-creme-2"
                  }`}
                >
                  {k === "seu" ? `${t.duracao(pedido?.minutos ?? 0)}${pedido?.mobilidade ? ` · ${t.semDegraus}` : ""}` : (t.roteiro[k] ?? k)}
                </button>
              ))}
            </div>
            {roteiro ? <Paragens r={roteiro} t={t} pontos={pontos} /> : <p className="text-tinta-2">{t.aCarregar}</p>}
          </section>

          {/* Mapa */}
          <section aria-labelledby="mapa" className="flex flex-col gap-2">
            <TituloSecao id="mapa">{t.mapa}</TituloSecao>
            <p className="text-[14px] text-tinta-2">{t.mapaAjuda}</p>
            <Mapa marcas={marcas} linha={linha} rotuloEvento={t.eventosProximos} />
          </section>

          {/* Assistente */}
          <section aria-labelledby="perguntar" className="flex flex-col gap-3">
            <TituloSecao id="perguntar">{t.perguntar}</TituloSecao>
            <p className="text-[15px] leading-[1.45] text-tinta-2">{t.perguntarAjuda}</p>
            {!chatAberto && (
              <Botao tamanho="grande" icone={MessageCircle} onClick={() => setChatAberto(true)} className="w-full">
                {t.abrirChat}
              </Botao>
            )}
            {chatAberto && (
              <div className="h-[600px] max-h-[85dvh] overflow-hidden rounded-3xl border border-linha">
                <Chat
                  key={lingua}
                  variante="janela"
                  municipio={dados.municipio.slug}
                  idioma={CODIGO_LINGUA[lingua]}
                  saudacao={t.saudacao}
                  sugestoes={t.sugestoes}
                  aoFechar={() => setChatAberto(false)}
                />
              </div>
            )}
          </section>

          {/* Informação útil (as fontes) */}
          <section aria-labelledby="temas" className="flex flex-col gap-3">
            <TituloSecao id="temas">{t.temas}</TituloSecao>
            <div className="flex flex-col gap-2">
              {dados.temas.map((tema) => (
                <Tema key={tema.tema} tema={tema} t={t} />
              ))}
            </div>
          </section>

          <nav aria-label={t.temas} className="flex flex-col gap-2 border-t border-linha pt-4">
            <a href="tel:112" className="inline-flex min-h-11 items-center gap-2 text-[15px] font-bold text-terracota-escuro">
              <Siren className="size-4" aria-hidden />
              {t.emergencia}
            </a>
            <Link href={`/agora/${encodeURIComponent(dados.municipio.slug)}`} hrefLang="pt" className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-tinta underline">
              <MapPin className="size-4" aria-hidden />
              {t.oQueSePassa}
            </Link>
            <Link href={`/visitar/qr?lingua=${lingua}`} className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-tinta underline">
              <QrCode className="size-4" aria-hidden />
              {t.qr}
            </Link>
          </nav>
        </>
      )}
    </div>
  );
}
