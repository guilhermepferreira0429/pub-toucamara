"use client";

import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  EyeOff,
  MapPin,
  Megaphone,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Cartao,
  classeEntrada,
  dia,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  SemAcesso,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { AvisoSms } from "./comum";
import { FormularioComunicado } from "./formulario-comunicado";
import { FormularioEvento } from "./formulario-evento";
import {
  caminhoNoSite,
  juntarComE,
  SITUACOES,
  TIPOS_COMUNICADO,
  type Comunicado,
  type ContextoAgora,
  type Evento,
  type PedidoAbrangidos,
  type Situacao,
} from "./tipos";

/*
 * Painel · Comunicados e eventos: o que a câmara publica à mão no feed
 * público /agora ("o que se passa perto de mim"). Dois separadores (os
 * comunicados e notícias; os eventos), cada um com pesquisa, filtros,
 * criar/editar com pré-visualização, publicar (com o aviso de quem recebe
 * SMS), despublicar e apagar. Ver: visao_geral; escrever: comunicados.
 */

export type Separador = "comunicados" | "eventos";

type Qual = "comunicado" | "evento";
type Linha = Comunicado | Evento;

const SEPARADORES: { id: Separador; rotulo: string; icone: typeof Megaphone }[] = [
  { id: "comunicados", rotulo: "Comunicados e notícias", icone: Megaphone },
  { id: "eventos", rotulo: "Eventos", icone: CalendarDays },
];

function eEvento(x: Linha): x is Evento {
  return "inicio" in x;
}

function ambitoDe(x: Linha): string {
  if (eEvento(x)) {
    const partes = [x.local, x.freguesia, x.lat !== null ? "ponto no mapa" : null].filter(Boolean);
    return partes.join(" · ") || "Todo o concelho";
  }
  return x.freguesias?.length ? juntarComE(x.freguesias) : "Todo o concelho";
}

function pedidoDe(x: Linha): PedidoAbrangidos {
  return eEvento(x)
    ? { fonte: "evento", lat: x.lat, lng: x.lng, freguesia: x.freguesia }
    : { fonte: "comunicado", tipo: x.tipo, freguesias: x.freguesias };
}

/** O que se mostra das datas de cada linha. */
function datasDe(x: Linha): string {
  const partes: string[] = [];
  if (eEvento(x)) partes.push(`${quando(x.inicio)}${x.fim ? ` a ${quando(x.fim)}` : ""}`);
  if (x.situacao === "rascunho") partes.push(`criado ${dia(x.criado_em)}`);
  else if (x.publicado_em) partes.push(`publicado ${dia(x.publicado_em)}`);
  if (x.situacao === "publicado" && x.visivel_ate) partes.push(`na página «O que se passa» até ${dia(x.visivel_ate)}`);
  if (x.situacao === "expirado" && x.visivel_ate) partes.push(`saiu da página «O que se passa» a ${dia(x.visivel_ate)}`);
  return partes.join(" · ");
}

/** Pesquisa com uma pequena espera (não pede a cada tecla). */
function useAtrasado(v: string, ms = 300): string {
  const [a, setA] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setA(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return a;
}

interface Feito {
  texto: string;
  link?: string;
}

function Lista({
  qual,
  contexto,
  escrever,
  onFeito,
  novo,
  onNovoFechado,
}: {
  qual: Qual;
  contexto: ContextoAgora | undefined;
  escrever: boolean;
  onFeito: (f: Feito) => void;
  novo: boolean;
  onNovoFechado: () => void;
}) {
  const { pedido } = useSessao();
  const [texto, setTexto] = useState("");
  const q = useAtrasado(texto.trim());
  const [situacao, setSituacao] = useState<"" | Situacao>("");
  const [tipo, setTipo] = useState<"" | "comunicado" | "noticia">("");
  const [editar, setEditar] = useState<Linha | null>(null);
  const [publicar, setPublicar] = useState<Linha | null>(null);
  const [apagar, setApagar] = useState<Linha | null>(null);
  const acao = useAcao();

  const params = new URLSearchParams({ limite: "30" });
  if (q) params.set("q", q);
  if (situacao) params.set("situacao", situacao);
  if (qual === "comunicado" && tipo) params.set("tipo", tipo);
  const rota = qual === "comunicado" ? "/v1/painel/comunicados" : "/v1/painel/eventos";
  const base = `${rota}?${params.toString()}`;
  const lista = useDados<Pagina<Linha>>(base);
  const mais = useMais(base, lista);

  const slug = contexto?.municipio.slug ?? "";
  const noSite = (x: Linha) => caminhoNoSite(slug, eEvento(x) ? "eventos" : "avisos", x.id);
  const nome = qual === "comunicado" ? "comunicado" : "evento";

  const trocar = (x: Linha) => lista.mudar((d) => ({ ...d, itens: d.itens.map((y) => (y.id === x.id ? x : y)) }));

  const guardado = (x: Linha, publicado: boolean, eraNovo: boolean) => {
    if (eraNovo) lista.recarregar();
    else trocar(x);
    setEditar(null);
    onNovoFechado();
    onFeito(
      publicado
        ? { texto: `«${x.titulo}» foi publicado na página «O que se passa».`, link: noSite(x) }
        : { texto: `«${x.titulo}» foi guardado${x.estado === "publicado" ? "" : " como rascunho"}.` },
    );
  };

  const mudarEstado = async (x: Linha, pub: boolean) => {
    const r = await acao.executar(() =>
      pedido<Linha>(`${rota}/${x.id}/${pub ? "publicar" : "despublicar"}`, { metodo: "POST" }),
    );
    if (!r) return;
    trocar(r);
    setPublicar(null);
    onFeito(
      pub
        ? { texto: `«${r.titulo}» foi publicado na página «O que se passa».`, link: noSite(r) }
        : { texto: `«${r.titulo}» saiu da página «O que se passa» (fica como despublicado; pode voltar a publicar).` },
    );
  };

  const confirmarApagar = async () => {
    if (!apagar) return;
    const x = apagar;
    const r = await acao.executar(() => pedido(`${rota}/${x.id}`, { metodo: "DELETE" }));
    if (!r) return;
    lista.mudar((d) => ({ ...d, itens: d.itens.filter((y) => y.id !== x.id) }));
    setApagar(null);
    onFeito({ texto: `«${x.titulo}» foi apagado.` });
  };

  const itens = lista.dados?.itens ?? [];
  const filtrado = !!(q || situacao || tipo);
  const fecharForm = () => {
    setEditar(null);
    onNovoFechado();
  };
  const formAberto = novo || !!editar;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 pb-4">
        <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
          <label htmlFor={`pesquisa-${qual}`} className="text-[13px] font-semibold text-tinta">
            Pesquisar
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-tinta-3" aria-hidden />
            <input
              id={`pesquisa-${qual}`}
              type="search"
              className={`${classeEntrada} min-h-11 pl-9`}
              placeholder={qual === "comunicado" ? "Título ou texto" : "Nome, descrição ou local"}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`situacao-${qual}`} className="text-[13px] font-semibold text-tinta">
            Estado
          </label>
          <select
            id={`situacao-${qual}`}
            className={`${classeEntrada} min-h-11`}
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as "" | Situacao)}
          >
            <option value="">Todos</option>
            {(Object.keys(SITUACOES) as Situacao[]).map((s) => (
              <option key={s} value={s}>
                {SITUACOES[s].rotulo}
              </option>
            ))}
          </select>
        </div>
        {qual === "comunicado" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tipo-comunicado" className="text-[13px] font-semibold text-tinta">
              Tipo
            </label>
            <select
              id="tipo-comunicado"
              className={`${classeEntrada} min-h-11`}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "" | "comunicado" | "noticia")}
            >
              <option value="">Todos</option>
              <option value="comunicado">Comunicados</option>
              <option value="noticia">Notícias</option>
            </select>
          </div>
        )}
      </div>

      <ErroLinha erro={acao.erro} className="mb-3" />

      <Cartao>
        <Estado
          aCarregar={lista.aCarregar}
          erro={lista.erro}
          vazio={itens.length === 0}
          textoVazio={
            filtrado
              ? "Nada encontrado com estes filtros."
              : qual === "comunicado"
                ? "Ainda não há comunicados. Escreva o primeiro: aparece na página «O que se passa» quando o publicar."
                : "Ainda não há eventos. Crie o primeiro: aparece na página «O que se passa» quando o publicar."
          }
        >
          <ul className="divide-y divide-linha" aria-label={qual === "comunicado" ? "Comunicados e notícias" : "Eventos"}>
            {itens.map((x) => {
              const s = SITUACOES[x.situacao];
              return (
                <li key={x.id} className="flex flex-col gap-2 px-5 py-4 lg:flex-row lg:items-center lg:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!eEvento(x) && (
                        <span className="text-[11px] font-bold tracking-[0.6px] text-tinta-3 uppercase">
                          {TIPOS_COMUNICADO[x.tipo].rotulo}
                        </span>
                      )}
                      <Pilula tom={s.tom}>
                        <span title={s.explicacao}>{s.rotulo}</span>
                      </Pilula>
                    </div>
                    <p className="font-semibold text-tinta">{x.titulo}</p>
                    <p className="flex items-start gap-1 text-xs text-tinta-2">
                      <MapPin className="mt-px size-3.5 shrink-0 text-tinta-3" aria-hidden />
                      {ambitoDe(x)}
                    </p>
                    <p className="text-xs text-tinta-3">{datasDe(x)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {x.situacao === "publicado" && slug && (
                      <a
                        href={noSite(x)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme-2"
                      >
                        <ExternalLink className="size-4" aria-hidden />
                        Ver no site<span className="sr-only">: {x.titulo} (abre noutra janela)</span>
                      </a>
                    )}
                    {escrever && (
                      <>
                        <Botao
                          variante="discreto"
                          tamanho="pequeno"
                          icone={Pencil}
                          className="min-h-11"
                          onClick={() => setEditar(x)}
                          aria-label={`Editar «${x.titulo}»`}
                        >
                          Editar
                        </Botao>
                        {x.estado === "publicado" ? (
                          <Botao
                            variante="discreto"
                            tamanho="pequeno"
                            icone={EyeOff}
                            className="min-h-11"
                            disabled={acao.aCorrer}
                            onClick={() => void mudarEstado(x, false)}
                            aria-label={`Despublicar «${x.titulo}»`}
                          >
                            Despublicar
                          </Botao>
                        ) : (
                          <Botao
                            variante="secundario"
                            tamanho="pequeno"
                            icone={Send}
                            className="min-h-11"
                            onClick={() => setPublicar(x)}
                            aria-label={`Publicar «${x.titulo}»`}
                          >
                            Publicar
                          </Botao>
                        )}
                        <Botao
                          variante="discreto"
                          tamanho="pequeno"
                          icone={Trash2}
                          className="min-h-11 text-terracota-escuro"
                          onClick={() => setApagar(x)}
                          aria-label={`Apagar «${x.titulo}»`}
                        >
                          Apagar
                        </Botao>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {mais.haMais && (
            <div className="border-t border-linha p-3">
              <Botao variante="discreto" className="min-h-11" onClick={mais.mais} disabled={mais.aCorrer}>
                Ver mais
              </Botao>
              <ErroLinha erro={mais.erro} className="mt-2" />
            </div>
          )}
        </Estado>
      </Cartao>

      <Dialogo
        titulo={
          editar
            ? `Editar ${nome}`
            : qual === "comunicado"
              ? "Novo comunicado ou notícia"
              : "Novo evento"
        }
        aberto={formAberto}
        onFechar={fecharForm}
        largura="max-w-5xl"
      >
        {formAberto &&
          (qual === "comunicado" ? (
            <FormularioComunicado
              key={editar?.id ?? "novo"}
              comunicado={editar && !eEvento(editar) ? editar : undefined}
              contexto={contexto}
              onCancelar={fecharForm}
              onGuardado={(c, pub) => guardado(c, pub, !editar)}
            />
          ) : (
            <FormularioEvento
              key={editar?.id ?? "novo"}
              evento={editar && eEvento(editar) ? editar : undefined}
              contexto={contexto}
              onCancelar={fecharForm}
              onGuardado={(e, pub) => guardado(e, pub, !editar)}
            />
          ))}
      </Dialogo>

      <Dialogo titulo={`Publicar «${publicar?.titulo ?? ""}»?`} aberto={!!publicar} onFechar={() => setPublicar(null)}>
        {publicar && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-tinta-2">
              Passa a aparecer na página «O que se passa» ({ambitoDe(publicar)}).
            </p>
            <AvisoSms pedidoAbr={pedidoDe(publicar)} jaPublicado={!!publicar.publicado_em} />
            <ErroLinha erro={acao.erro} />
            <div className="flex justify-end gap-2">
              <Botao variante="discreto" className="min-h-11" onClick={() => setPublicar(null)}>
                Cancelar
              </Botao>
              <Botao icone={Send} className="min-h-11" disabled={acao.aCorrer} onClick={() => void mudarEstado(publicar, true)}>
                Publicar
              </Botao>
            </div>
          </div>
        )}
      </Dialogo>

      <Dialogo titulo={`Apagar «${apagar?.titulo ?? ""}»?`} aberto={!!apagar} onFechar={() => setApagar(null)}>
        {apagar && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-tinta-2">
              {apagar.estado === "publicado"
                ? "Sai da página «O que se passa» e deixa de existir. Não se pode desfazer. Se só o quer tirar do site, despublique-o."
                : "Deixa de existir. Não se pode desfazer."}
            </p>
            <ErroLinha erro={acao.erro} />
            <div className="flex justify-end gap-2">
              <Botao variante="discreto" className="min-h-11" onClick={() => setApagar(null)}>
                Cancelar
              </Botao>
              <Botao icone={Trash2} className="min-h-11" disabled={acao.aCorrer} onClick={() => void confirmarApagar()}>
                Apagar
              </Botao>
            </div>
          </div>
        )}
      </Dialogo>
    </>
  );
}

export function PaginaPublicacoes({ inicial = "comunicados" }: { inicial?: Separador }) {
  const { pode } = useSessao();
  const router = useRouter();
  const ver = pode("visao_geral");
  const escrever = pode("comunicados");
  const [separador, setSeparador] = useState<Separador>(inicial);
  const [novo, setNovo] = useState(false);
  const [feito, setFeito] = useState<Feito | null>(null);
  const contexto = useDados<ContextoAgora>(ver ? "/v1/painel/agora/contexto" : null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  if (!ver) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Gestão", "Comunicados e eventos"]} titulo="Comunicados e eventos" />
        <SemAcesso />
      </div>
    );
  }

  const escolher = (s: Separador, focar = false) => {
    setSeparador(s);
    setNovo(false);
    setFeito(null);
    router.replace(s === "eventos" ? "/painel/comunicados?ver=eventos" : "/painel/comunicados", { scroll: false });
    if (focar) tabs.current[SEPARADORES.findIndex((x) => x.id === s)]?.focus();
  };

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Gestão", "Comunicados e eventos"]}
        titulo="Comunicados e eventos"
        descricao={
          <>
            O que a câmara publica na página <span className="font-semibold">«O que se passa perto de
            mim»</span>, no site da câmara. Quem pediu «avise-me» para a zona recebe um SMS quando publica (as notícias e o que é para todo o
            concelho não enviam SMS).
            {!escrever && " O seu perfil só pode ver."}
          </>
        }
        acoes={
          escrever && (
            <Botao icone={Plus} className="min-h-11" onClick={() => setNovo(true)}>
              {separador === "comunicados" ? "Novo comunicado" : "Novo evento"}
            </Botao>
          )
        }
      />
      <div className="flex flex-col gap-4 px-10">
        <div role="tablist" aria-label="O que publicar" className="flex gap-1 border-b border-linha">
          {SEPARADORES.map((s, i) => {
            const ativo = separador === s.id;
            const Icone = s.icone;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`separador-${s.id}`}
                aria-selected={ativo}
                aria-controls={`painel-${s.id}`}
                tabIndex={ativo ? 0 : -1}
                onClick={() => escolher(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const n = (i + (e.key === "ArrowRight" ? 1 : SEPARADORES.length - 1)) % SEPARADORES.length;
                    escolher(SEPARADORES[n].id, true);
                  }
                }}
                className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold ${
                  ativo ? "border-terracota text-tinta" : "border-transparent text-tinta-3 hover:text-tinta"
                }`}
              >
                <Icone className="size-4" aria-hidden />
                {s.rotulo}
              </button>
            );
          })}
        </div>

        {feito && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-verde/30 bg-verde-suave px-4 py-3 text-sm text-tinta"
          >
            <CheckCircle2 className="size-4 text-verde" aria-hidden />
            <span className="flex-1">{feito.texto}</span>
            {feito.link && (
              <a
                href={feito.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-tinta underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden />
                Ver no site<span className="sr-only"> (abre noutra janela)</span>
              </a>
            )}
          </div>
        )}
        <ErroLinha erro={contexto.erro} />

        <div role="tabpanel" id={`painel-${separador}`} aria-labelledby={`separador-${separador}`}>
          <Lista
            key={separador}
            qual={separador === "comunicados" ? "comunicado" : "evento"}
            contexto={contexto.dados}
            escrever={escrever}
            onFeito={setFeito}
            novo={novo}
            onNovoFechado={() => setNovo(false)}
          />
        </div>
      </div>
    </div>
  );
}
