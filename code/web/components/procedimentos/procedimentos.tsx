"use client";

import { ClipboardList, Lock, Mic, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  haQuanto,
  Pilula,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { plural } from "@/lib/plural";

/*
 * Painel · Procedimentos internos: o "como se faz" da câmara, escrito por
 * quem sabe. Só para funcionários. Daqui escreve-se um procedimento à mão
 * ou começa-se a entrevista a quem se vai reformar.
 */

export type EstadoProc = "rascunho" | "publicado" | "arquivado";

export const ESTADOS_PROC: Record<EstadoProc, { rotulo: string; tom: "verde" | "ambar" | "neutro" }> = {
  publicado: { rotulo: "publicado", tom: "verde" },
  rascunho: { rotulo: "rascunho", tom: "ambar" },
  arquivado: { rotulo: "arquivado", tom: "neutro" },
};

interface Item {
  id: string;
  titulo: string;
  area: string;
  estado: EstadoProc;
  versao: number;
  origem?: string;
  autor_nome: string | null;
  passos: number;
  publicado_em: string | null;
  atualizado_em?: string;
  trechos?: { nome_seccao: string; texto: string }[];
}

interface Lista {
  itens: Item[];
  contagens?: Record<EstadoProc, number>;
}

interface Entrevista {
  id: string;
  area: string;
  estado: "em_curso" | "concluida";
  modo: "ia" | "guiao";
  entrevistado_nome: string;
  respondidas: number;
  procedimento_id: string | null;
  criada_em: string;
}

const FILTROS: (EstadoProc | "todos")[] = ["todos", "publicado", "rascunho", "arquivado"];

export function AvisoInterno() {
  return (
    <p className="mx-4 sm:mx-10 mb-5 flex items-center gap-2 rounded-xl border border-linha bg-creme-2/60 px-4 py-2.5 text-[13px] text-tinta-2">
      <Lock className="size-4 shrink-0 text-tinta-3" aria-hidden />
      Só para funcionários: os procedimentos internos nunca aparecem ao munícipe nem entram nas respostas do agente.
    </p>
  );
}

export function PaginaProcedimentos() {
  const { pode, pedido } = useSessao();
  const router = useRouter();
  const [filtro, setFiltro] = useState<EstadoProc | "todos">("todos");
  const [q, setQ] = useState("");
  const [procura, setProcura] = useState("");
  const [novo, setNovo] = useState<"procedimento" | "entrevista" | null>(null);
  const [titulo, setTitulo] = useState("");
  const [area, setArea] = useState("");
  const acao = useAcao();

  const ver = pode("procedimentos_ver");
  const params = new URLSearchParams();
  if (filtro !== "todos") params.set("estado", filtro);
  if (procura) params.set("q", procura);
  const lista = useDados<Lista>(ver ? `/v1/painel/procedimentos${params.size ? `?${params}` : ""}` : null);
  const entrevistas = useDados<{ itens: Entrevista[] }>(ver ? "/v1/painel/procedimentos/entrevistas" : null);

  if (!ver) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Gestão", "Procedimentos"]} titulo="Procedimentos" />
        <SemAcesso />
      </div>
    );
  }

  const criar = async () => {
    if (novo === "entrevista") {
      const r = await acao.executar(() =>
        pedido<{ id: string }>("/v1/painel/procedimentos/entrevistas", { metodo: "POST", corpo: { area } }),
      );
      if (r) router.push(`/painel/procedimentos/entrevistas/${r.id}`);
      return;
    }
    const r = await acao.executar(() =>
      pedido<{ id: string }>("/v1/painel/procedimentos", { metodo: "POST", corpo: { titulo, area } }),
    );
    if (r) router.push(`/painel/procedimentos/${r.id}?editar=1`);
  };

  const emCurso = (entrevistas.dados?.itens ?? []).filter((e) => e.estado === "em_curso");

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Gestão", "Procedimentos"]}
        titulo="Procedimentos"
        descricao="O que só os mais antigos sabiam, escrito para quem chega. Quem se vai reformar pode dar uma entrevista: o assistente faz as perguntas e escreve o rascunho."
        acoes={
          <>
            <Botao variante="secundario" icone={Mic} onClick={() => setNovo("entrevista")}>
              Dar uma entrevista
            </Botao>
            <Botao icone={Plus} onClick={() => setNovo("procedimento")}>
              Novo procedimento
            </Botao>
          </>
        }
      />
      <AvisoInterno />

      <div className="grid gap-6 px-4 sm:px-10 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {FILTROS.map((f) => {
              const n = f === "todos" ? null : lista.dados?.contagens?.[f];
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filtro === f}
                  onClick={() => setFiltro(f)}
                  className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
                    filtro === f ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
                  }`}
                >
                  {f === "todos" ? "Todos" : `${ESTADOS_PROC[f].rotulo[0].toUpperCase()}${ESTADOS_PROC[f].rotulo.slice(1)}s`}
                  {n != null && <span className="ml-1.5 text-tinta-3">{n}</span>}
                </button>
              );
            })}
            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setProcura(q.trim());
              }}
            >
              <label className="sr-only" htmlFor="procurar-proc">
                Procurar procedimentos
              </label>
              <input
                id="procurar-proc"
                className={`${classeEntrada} w-64`}
                placeholder="Procurar (ex.: esplanada, seguro)"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  if (!e.target.value) setProcura("");
                }}
              />
              <Botao type="submit" variante="discreto" tamanho="pequeno" icone={Search}>
                Procurar
              </Botao>
            </form>
          </div>

          <Cartao>
            <Estado
              aCarregar={lista.aCarregar}
              erro={lista.erro}
              vazio={!lista.dados?.itens.length}
              textoVazio={
                procura
                  ? "Nenhum procedimento fala disso. Pode escrevê-lo, ou perguntar a quem sabe para dar uma entrevista."
                  : "Ainda não há procedimentos. Comece por uma entrevista a quem conhece bem um serviço."
              }
            >
              <ul className="divide-y divide-linha">
                {lista.dados?.itens.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/painel/procedimentos/${p.id}`}
                      className="flex flex-col gap-1.5 px-5 py-4 hover:bg-creme/60"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <ClipboardList className="size-4 text-tinta-3" aria-hidden />
                        <span className="font-semibold text-tinta">{p.titulo}</span>
                        <Pilula tom={ESTADOS_PROC[p.estado].tom}>{ESTADOS_PROC[p.estado].rotulo}</Pilula>
                        {p.origem === "entrevista" && <Pilula>da entrevista</Pilula>}
                      </div>
                      <p className="text-[13px] text-tinta-2">
                        {p.area} · {p.passos} {p.passos === 1 ? "passo" : "passos"} · versão {p.versao}
                        {p.autor_nome && ` · por ${p.autor_nome}`}
                        {p.atualizado_em && ` · ${haQuanto(p.atualizado_em)}`}
                      </p>
                      {p.trechos?.[0] && (
                        <p className="text-[13px] text-tinta-3">
                          <span className="font-semibold">{p.trechos[0].nome_seccao}:</span> {p.trechos[0].texto}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Estado>
          </Cartao>
        </div>

        <aside className="flex flex-col gap-4">
          <Cartao className="p-5">
            <Rotulo>Entrevistas em curso</Rotulo>
            {emCurso.length === 0 ? (
              <p className="mt-2 text-sm text-tinta-3">
                Nenhuma. Quem conhece bem um serviço pode dar uma entrevista: perguntas uma a uma, por escrito ou por
                voz.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {emCurso.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/painel/procedimentos/entrevistas/${e.id}`}
                      className="block rounded-xl border border-linha px-3 py-2.5 hover:bg-creme/60"
                    >
                      <p className="text-sm font-semibold text-tinta">{e.area}</p>
                      <p className="text-xs text-tinta-3">
                        {e.entrevistado_nome} · {plural(e.respondidas, "resposta", "respostas")} · {haQuanto(e.criada_em)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
          <Cartao className="p-5">
            <Rotulo>Para quem chega</Rotulo>
            <p className="mt-2 text-sm text-tinta-2">
              No <Link href="/painel/assistente" className="font-semibold text-terracota underline">assistente interno</Link>{" "}
              pergunta-se &quot;como trato um pedido de…?&quot; e a resposta vem destes procedimentos e das regras
              oficiais, sempre com a fonte.
            </p>
          </Cartao>
        </aside>
      </div>

      <Dialogo
        titulo={novo === "entrevista" ? "Dar uma entrevista" : "Novo procedimento"}
        aberto={novo !== null}
        onFechar={() => {
          setNovo(null);
          acao.limpar();
        }}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void criar();
          }}
        >
          {novo === "entrevista" ? (
            <p className="text-sm text-tinta-2">
              O assistente vai fazer-lhe perguntas, uma de cada vez: o que é, passo a passo, onde está cada coisa, a quem
              perguntar, exceções e erros comuns. Pode responder por escrito ou ditar. No fim fica um rascunho para
              rever.
            </p>
          ) : (
            <Campo rotulo="Título">
              <input
                className={classeEntrada}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Como tratar um pedido de ocupação da via pública"
                required
                minLength={3}
              />
            </Campo>
          )}
          <Campo rotulo="Área ou serviço" ajuda="Ex.: Ocupação da via pública, Cemitérios, Água e saneamento.">
            <input
              className={classeEntrada}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              required
              minLength={2}
            />
          </Campo>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" onClick={() => setNovo(null)}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={acao.aCorrer}>
              {novo === "entrevista" ? "Começar a entrevista" : "Criar rascunho"}
            </Botao>
          </div>
        </form>
      </Dialogo>
    </div>
  );
}
