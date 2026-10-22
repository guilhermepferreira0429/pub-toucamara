"use client";

/*
 * Recolha das fontes no painel: a hora diária de leitura, editar e arquivar
 * uma fonte, o histórico das leituras e os sites (páginas descobertas pelo
 * sitemap ou pelos links).
 */

import { Archive, Clock, Globe, History, Plus, Save, Search } from "lucide-react";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  Campo,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Interruptor,
  numero,
  Pilula,
  quando,
  useAcao,
  useDados,
} from "./comum";
import type { Entidade, Fonte, LeituraFonte, Recolha, SiteFontes } from "./tipos";

const HORA = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" });
const DIA = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" });

/** "Todos os dias", "De 6 em 6 horas", "Todas as semanas"… */
export function periodicidade(horas: number): string {
  if (horas === 24) return "Todos os dias";
  if (horas === 168) return "Todas as semanas";
  if (horas === 720) return "Todos os meses";
  if (horas < 24) return horas === 1 ? "De hora a hora" : `De ${horas} em ${horas} horas`;
  if (horas % 24 === 0) return `De ${horas / 24} em ${horas / 24} dias`;
  return `De ${horas} em ${horas} horas`;
}

/** "hoje às 05:30", "amanhã às 05:30" ou "12 out. às 05:30". */
export function proximaVez(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  const hoje = new Date();
  const amanha = new Date(hoje);
  amanha.setDate(hoje.getDate() + 1);
  const h = HORA.format(d);
  if (d.getTime() <= hoje.getTime()) return "dentro de minutos";
  if (d.toDateString() === hoje.toDateString()) return `hoje às ${h}`;
  if (d.toDateString() === amanha.toDateString()) return `amanhã às ${h}`;
  return `${DIA.format(d)} às ${h}`;
}

const PERIODOS = [
  { horas: 6, rotulo: "De 6 em 6 horas" },
  { horas: 12, rotulo: "De 12 em 12 horas" },
  { horas: 24, rotulo: "Todos os dias" },
  { horas: 168, rotulo: "Todas as semanas" },
  { horas: 720, rotulo: "Todos os meses" },
];

function SelecionarPeriodo({ valor, onMudar }: { valor: number; onMudar: (h: number) => void }) {
  const conhecido = PERIODOS.some((p) => p.horas === valor);
  return (
    <select className={classeEntrada} value={valor} onChange={(e) => onMudar(Number(e.target.value))}>
      {!conhecido && <option value={valor}>{periodicidade(valor)}</option>}
      {PERIODOS.map((p) => (
        <option key={p.horas} value={p.horas}>
          {p.rotulo}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Hora diária
// ---------------------------------------------------------------------------

/** "Todos os dias às 03:00" no topo das fontes, com edição para quem pode. */
export function HoraRecolha({ escrever, onMudou }: { escrever: boolean; onMudou: () => void }) {
  const { pedido } = useSessao();
  const r = useDados<Recolha>("/v1/painel/conhecimento/recolha");
  const [editar, setEditar] = useState(false);
  const [hora, setHora] = useState("");
  const acao = useAcao();
  const d = r.dados;
  if (!d) return null;

  if (editar) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = await acao.executar(() =>
            pedido<Recolha>("/v1/painel/conhecimento/recolha", { metodo: "PUT", corpo: { hora_recolha: hora } }),
          );
          if (n) {
            r.mudar(() => n);
            setEditar(false);
            onMudou();
          }
        }}
      >
        <label className="sr-only" htmlFor="hora-recolha">
          Hora da leitura diária
        </label>
        <input
          id="hora-recolha"
          type="time"
          required
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          className="h-[34px] rounded-[10px] border border-white/20 bg-white/10 px-2 text-[13px] text-white [color-scheme:dark]"
        />
        <button
          type="submit"
          disabled={acao.aCorrer}
          className="flex h-[34px] items-center gap-1 rounded-[10px] bg-white/15 px-3 text-[13px] font-semibold text-white hover:bg-white/20"
        >
          <Save className="size-3.5" aria-hidden /> Guardar
        </button>
        <button type="button" onClick={() => setEditar(false)} className="text-[13px] text-white/70 hover:text-white">
          Cancelar
        </button>
        {acao.erro && <span className="text-xs text-[#F2B8A2]">{acao.erro.message}</span>}
      </form>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-white/70">
      <Clock className="size-3.5" aria-hidden />
      Leitura diária às <strong className="text-white">{d.hora_recolha}</strong>
      {d.proxima_leitura_em && <> · próxima {proximaVez(d.proxima_leitura_em)}</>}
      {escrever && (
        <button
          type="button"
          onClick={() => {
            setHora(d.hora_recolha);
            setEditar(true);
          }}
          className="font-semibold text-white underline-offset-2 hover:underline"
        >
          Mudar
        </button>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Editar uma fonte
// ---------------------------------------------------------------------------

export function EditarFonte({ fonte, tipos, onFeito }: { fonte: Fonte; tipos: Record<string, { rotulo: string }>; onFeito: (msg: string) => void }) {
  const { pedido } = useSessao();
  const [v, setV] = useState({
    titulo: fonte.titulo,
    url: fonte.url,
    tipo: fonte.tipo,
    ler_a_cada_horas: fonte.ler_a_cada_horas,
    leitura_automatica: fonte.leitura_automatica,
    seletor: fonte.seletor ?? "",
    ignorar_robots: fonte.ignorar_robots ?? false,
  });
  const acao = useAcao();
  const guardar = (corpo: object, msg: string) =>
    acao
      .executar(() => pedido<Fonte>(`/v1/painel/conhecimento/fontes/${fonte.id}`, { metodo: "PATCH", corpo }))
      .then((r) => r && onFeito(msg));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void guardar(
          { ...v, titulo: v.titulo.trim(), url: v.url.trim(), seletor: v.seletor.trim() || null },
          `«${v.titulo.trim()}» atualizada.`,
        );
      }}
    >
      <Campo rotulo="Título">
        <input className={classeEntrada} required maxLength={200} value={v.titulo} onChange={(e) => setV({ ...v, titulo: e.target.value })} />
      </Campo>
      <Campo rotulo="Endereço (https://…)" ajuda="Mudar o endereço lê a fonte outra vez dentro de minutos.">
        <input type="url" className={classeEntrada} required value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <select className={classeEntrada} value={v.tipo} onChange={(e) => setV({ ...v, tipo: e.target.value })}>
            {Object.entries(tipos).map(([k, t]) => (
              <option key={k} value={k}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Ler">
          <SelecionarPeriodo valor={v.ler_a_cada_horas} onMudar={(h) => setV({ ...v, ler_a_cada_horas: h })} />
        </Campo>
      </div>
      <Campo
        rotulo="Só esta parte da página (seletor CSS, opcional)"
        ajuda="Ex.: #conteudo ou .artigo. Se o site mudar e o seletor deixar de encontrar a parte, a fonte fica em erro e avisamos."
      >
        <input className={`${classeEntrada} font-mono text-xs`} maxLength={300} placeholder="main" value={v.seletor} onChange={(e) => setV({ ...v, seletor: e.target.value })} />
      </Campo>
      <div className="flex items-center gap-2.5 text-[13px] text-tinta">
        <Interruptor ligado={v.leitura_automatica} rotulo="Leitura automática" onMudar={(x) => setV({ ...v, leitura_automatica: x })} />
        Ler automaticamente
      </div>
      <div className="flex items-center gap-2.5 text-[13px] text-tinta">
        <Interruptor ligado={v.ignorar_robots} rotulo="Ler apesar do robots.txt" onMudar={(x) => setV({ ...v, ignorar_robots: x })} />
        A câmara autoriza ler esta página mesmo que o robots.txt do site não deixe
      </div>
      <ErroLinha erro={acao.erro} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={acao.aCorrer}
          onClick={() =>
            void guardar(
              { arquivada: !fonte.arquivada_em },
              fonte.arquivada_em ? `«${fonte.titulo}» voltou a ser lida.` : `«${fonte.titulo}» arquivada: deixa de ser lida, as versões ficam.`,
            )
          }
          className="flex items-center gap-1 text-[13px] font-semibold text-terracota-escuro hover:underline"
        >
          <Archive className="size-3.5" aria-hidden />
          {fonte.arquivada_em ? "Desarquivar" : "Arquivar"}
        </button>
        <Botao type="submit" icone={Save} disabled={acao.aCorrer}>
          {acao.aCorrer ? "A guardar…" : "Guardar"}
        </Botao>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Histórico das leituras
// ---------------------------------------------------------------------------

const RESULTADOS: Record<LeituraFonte["resultado"], { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }> = {
  mudou: { rotulo: "Mudou", tom: "ambar" },
  igual: { rotulo: "Igual", tom: "verde" },
  nao_modificado: { rotulo: "Sem alterações (304)", tom: "verde" },
  erro: { rotulo: "Erro", tom: "terracota" },
};

function tamanho(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function HistoricoLeituras({ fonte }: { fonte: Fonte }) {
  const l = useDados<LeituraFonte[]>(`/v1/painel/conhecimento/fontes/${fonte.id}/leituras`);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-tinta-2">
        {periodicidade(fonte.ler_a_cada_horas)}
        {fonte.proxima_leitura_em && <> · próxima leitura {proximaVez(fonte.proxima_leitura_em)}</>}
        {(fonte.falhas_seguidas ?? 0) > 1 && <> · {fonte.falhas_seguidas} erros seguidos</>}
      </p>
      <Estado aCarregar={l.aCarregar} erro={l.erro} vazio={!l.dados?.length} textoVazio="Ainda não foi lida.">
        <ol className="flex flex-col divide-y divide-linha rounded-xl border border-linha bg-papel">
          {l.dados?.map((x) => {
            const r = RESULTADOS[x.resultado];
            return (
              <li key={x.id} className="flex flex-col gap-1 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-tinta">{quando(x.iniciada_em)}</span>
                  <Pilula tom={r.tom}>{r.rotulo}</Pilula>
                </div>
                <p className="text-xs text-tinta-3">
                  {[x.http_estado ? `HTTP ${x.http_estado}` : null, tamanho(x.bytes) || null, `${numero(x.duracao_ms)} ms`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {x.erro && <p className="text-xs text-terracota-escuro">{x.erro}</p>}
                {x.aviso && <p className="text-xs text-ambar">{x.aviso}</p>}
              </li>
            );
          })}
        </ol>
      </Estado>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

/** "/a, /b" ↔ ["/a", "/b"]. */
const lista = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.startsWith("/") ? x : `/${x}`));

function NovoSite({ tipos, onCriado }: { tipos: Record<string, { rotulo: string }>; onCriado: () => void }) {
  const { pedido } = useSessao();
  const entidades = useDados<{ itens: Entidade[] }>("/v1/painel/encaminhamento");
  const [v, setV] = useState({
    entidade_id: "",
    titulo: "",
    url_inicial: "",
    sitemap_url: "",
    incluir: "",
    excluir: "",
    profundidade: 2,
    max_paginas: 100,
    tipo_fontes: "pagina",
    ler_a_cada_horas: 24,
  });
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() =>
          pedido<SiteFontes>("/v1/painel/conhecimento/sites", {
            corpo: {
              ...v,
              titulo: v.titulo.trim(),
              url_inicial: v.url_inicial.trim(),
              sitemap_url: v.sitemap_url.trim() || null,
              incluir: lista(v.incluir),
              excluir: lista(v.excluir),
            },
          }),
        );
        if (r) onCriado();
      }}
    >
      <p className="text-sm text-tinta-2">
        Lemos o sitemap do site (ou, sem ele, seguimos os links a partir do endereço) e cada página passa a ser uma fonte.
        Procuramos páginas novas todas as semanas.
      </p>
      <Campo rotulo="Entidade">
        <select className={classeEntrada} required value={v.entidade_id} onChange={(e) => setV({ ...v, entidade_id: e.target.value })}>
          <option value="">Escolha a entidade</option>
          {entidades.dados?.itens.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Nome">
        <input className={classeEntrada} required maxLength={200} placeholder="Serviços do portal" value={v.titulo} onChange={(e) => setV({ ...v, titulo: e.target.value })} />
      </Campo>
      <Campo rotulo="Endereço inicial (https://…)" ajuda="Só se seguem as páginas desta pasta, a não ser que indique os caminhos abaixo.">
        <input type="url" className={classeEntrada} required value={v.url_inicial} onChange={(e) => setV({ ...v, url_inicial: e.target.value })} />
      </Campo>
      <Campo rotulo="Sitemap (opcional)" ajuda="Vazio: tentamos /sitemap.xml.">
        <input type="url" className={classeEntrada} value={v.sitemap_url} onChange={(e) => setV({ ...v, sitemap_url: e.target.value })} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Só caminhos (opcional)" ajuda="Ex.: /servicos, /regulamentos">
          <input className={classeEntrada} value={v.incluir} onChange={(e) => setV({ ...v, incluir: e.target.value })} />
        </Campo>
        <Campo rotulo="Excluir caminhos (opcional)" ajuda="Ex.: /noticias">
          <input className={classeEntrada} value={v.excluir} onChange={(e) => setV({ ...v, excluir: e.target.value })} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Máx. de páginas">
          <input type="number" min={1} max={2000} className={classeEntrada} value={v.max_paginas} onChange={(e) => setV({ ...v, max_paginas: Number(e.target.value) || 100 })} />
        </Campo>
        <Campo rotulo="Profundidade dos links">
          <input type="number" min={0} max={5} className={classeEntrada} value={v.profundidade} onChange={(e) => setV({ ...v, profundidade: Number(e.target.value) })} />
        </Campo>
        <Campo rotulo="Tipo das fontes">
          <select className={classeEntrada} value={v.tipo_fontes} onChange={(e) => setV({ ...v, tipo_fontes: e.target.value })}>
            {Object.entries(tipos).map(([k, t]) => (
              <option key={k} value={k}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Ler as páginas">
        <SelecionarPeriodo valor={v.ler_a_cada_horas} onMudar={(h) => setV({ ...v, ler_a_cada_horas: h })} />
      </Campo>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={Plus} disabled={acao.aCorrer}>
          {acao.aCorrer ? "A adicionar…" : "Adicionar e procurar páginas"}
        </Botao>
      </div>
    </form>
  );
}

/** Os sites do município e as páginas que deles vieram. */
export function Sites({ escrever, tipos, onMudou }: { escrever: boolean; tipos: Record<string, { rotulo: string }>; onMudou: () => void }) {
  const { pedido } = useSessao();
  const sites = useDados<SiteFontes[]>("/v1/painel/conhecimento/sites");
  const [novo, setNovo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const acao = useAcao();
  const itens = sites.dados ?? [];
  if (!itens.length && !escrever) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="titulo-sites">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="titulo-sites" className="text-[15px] font-bold text-tinta">
            Sites
          </h2>
          <p className="text-[13px] text-tinta-2">Páginas descobertas pelo sitemap ou pelos links: cada uma é uma fonte.</p>
        </div>
        {escrever && (
          <Botao variante="secundario" icone={Globe} onClick={() => setNovo(true)}>
            Adicionar site
          </Botao>
        )}
      </div>
      {aviso && <p className="rounded-xl bg-verde-suave px-3 py-2 text-[13px] text-verde">{aviso}</p>}
      <ErroLinha erro={acao.erro} />
      {itens.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {itens.map((s) => (
            <li key={s.id} className={`flex flex-col gap-2 rounded-2xl border bg-papel p-4 ${s.erro ? "border-terracota/60" : "border-linha"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <p className="text-[15px] font-bold text-tinta">{s.titulo}</p>
                  <a href={s.url_inicial} target="_blank" rel="noreferrer" className="truncate text-xs text-tinta-3 hover:text-tinta">
                    {s.url_inicial}
                  </a>
                </div>
                {!s.ativo && <Pilula tom="neutro">Parado</Pilula>}
              </div>
              <p className={`text-[13px] ${s.erro ? "text-terracota-escuro" : "text-tinta-2"}`}>
                {s.erro ??
                  (s.ultima_descoberta_em
                    ? `${numero(s.fontes)} ${s.fontes === 1 ? "fonte" : "fontes"} · procurado ${quando(s.ultima_descoberta_em)} · ${periodicidade(s.ler_a_cada_horas).toLowerCase()}`
                    : "À procura de páginas…")}
              </p>
              {escrever && (
                <div className="flex flex-wrap gap-3 border-t border-linha pt-2 text-xs font-semibold">
                  <button
                    type="button"
                    disabled={acao.aCorrer}
                    className="flex items-center gap-1 text-terracota-escuro hover:underline"
                    onClick={async () => {
                      const r = await acao.executar(() =>
                        pedido<{ em_fila: boolean }>(`/v1/painel/conhecimento/sites/${s.id}/descobrir`, { metodo: "POST" }),
                      );
                      if (r) setAviso(r.em_fila ? `A procurar páginas novas em «${s.titulo}».` : "Já está a procurar.");
                    }}
                  >
                    <Search className="size-3" aria-hidden /> Procurar páginas agora
                  </button>
                  <button
                    type="button"
                    disabled={acao.aCorrer}
                    className="flex items-center gap-1 text-terracota-escuro hover:underline"
                    onClick={async () => {
                      const r = await acao.executar(() =>
                        pedido<SiteFontes>(`/v1/painel/conhecimento/sites/${s.id}`, { metodo: "PATCH", corpo: { ativo: !s.ativo } }),
                      );
                      if (r) sites.recarregar();
                    }}
                  >
                    <History className="size-3" aria-hidden /> {s.ativo ? "Parar a procura" : "Retomar a procura"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialogo titulo="Adicionar site" aberto={novo} onFechar={() => setNovo(false)} largura="max-w-2xl">
        <NovoSite
          tipos={tipos}
          onCriado={() => {
            setNovo(false);
            setAviso("Site adicionado. As páginas aparecem nas fontes dentro de minutos.");
            sites.recarregar();
            onMudou();
          }}
        />
      </Dialogo>
    </section>
  );
}
