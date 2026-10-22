"use client";

import { Archive, ArrowLeft, Check, History, Mic, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { AvisoInterno, ESTADOS_PROC, type EstadoProc } from "./procedimentos";

/*
 * Um procedimento interno: ler (como um colega novo o lê), editar (cada
 * gravação é uma versão) e, para a chefia, publicar ou arquivar.
 */

export interface Conteudo {
  titulo: string;
  area: string;
  servico_id: string | null;
  resumo: string;
  passos: string[];
  onde_esta: { o_que: string; onde: string }[];
  contactos: { nome: string; papel: string | null; contacto: string | null }[];
  excecoes: string[];
  erros_comuns: string[];
  notas: string;
}

interface Detalhe extends Conteudo {
  id: string;
  estado: EstadoProc;
  versao: number;
  origem: "manual" | "entrevista" | "lacuna";
  entrevista_id: string | null;
  autor_id: string | null;
  autor_nome: string | null;
  servico_nome: string | null;
  publicado_em: string | null;
  publicado_por_nome: string | null;
  atualizado_em: string;
  versoes: { versao: number; estado: string; nota: string | null; alterado_por_nome: string | null; criado_em: string }[];
}

function conteudoDe(d: Detalhe): Conteudo {
  return {
    titulo: d.titulo,
    area: d.area,
    servico_id: d.servico_id,
    resumo: d.resumo,
    passos: d.passos,
    onde_esta: d.onde_esta,
    contactos: d.contactos,
    excecoes: d.excecoes,
    erros_comuns: d.erros_comuns,
    notas: d.notas,
  };
}

export function DetalheProcedimento() {
  const { id } = useParams<{ id: string }>();
  const procura = useSearchParams();
  const { pode, pedido, eu } = useSessao();
  const ver = pode("procedimentos_ver");
  const d = useDados<Detalhe>(ver ? `/v1/painel/procedimentos/${id}` : null);
  const [rascunho, setRascunho] = useState<(Conteudo & { nota: string }) | null>(null);
  const [aEditarPedido, setAEditarPedido] = useState(procura.get("editar") === "1");
  const [versaoAberta, setVersaoAberta] = useState<number | null>(null);
  const acao = useAcao();

  if (!ver) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Gestão", "Procedimentos"]} titulo="Procedimento" />
        <SemAcesso />
      </div>
    );
  }

  const p = d.dados;
  const chefia = pode("procedimentos");
  const podeEditar = !!p && (chefia || (p.estado === "rascunho" && p.autor_id === eu?.utilizador.id));
  // Entra em edição pelo link (?editar=1) quando os dados chegam.
  const edicao = rascunho ?? (aEditarPedido && p && podeEditar ? { ...conteudoDe(p), nota: "" } : null);

  const guardar = async () => {
    if (!edicao) return;
    const r = await acao.executar(() =>
      pedido(`/v1/painel/procedimentos/${id}`, {
        metodo: "PUT",
        corpo: {
          ...edicao,
          // Linhas deixadas em branco não contam.
          onde_esta: edicao.onde_esta.filter((o) => o.o_que.trim()),
          contactos: edicao.contactos.filter((x) => x.nome.trim()),
          nota: edicao.nota || undefined,
        },
      }),
    );
    if (r) {
      setRascunho(null);
      setAEditarPedido(false);
      d.recarregar();
    }
  };

  const mudarEstado = async (acaoEstado: "publicar" | "arquivar") => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/procedimentos/${id}/${acaoEstado}`, { metodo: "POST" }),
    );
    if (r) d.recarregar();
  };

  return (
    <div className="flex flex-col pb-12">
      <div className="px-4 sm:px-10 pt-6">
        <Link href="/painel/procedimentos" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-tinta-2">
          <ArrowLeft className="size-4" aria-hidden /> Procedimentos
        </Link>
      </div>
      <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!p}>
        {p && (
          <>
            <CabecalhoPagina
              migalhas={["Gestão", "Procedimentos", p.area]}
              titulo={p.titulo}
              descricao={
                <span className="flex flex-wrap items-center gap-2">
                  <Pilula tom={ESTADOS_PROC[p.estado].tom}>{ESTADOS_PROC[p.estado].rotulo}</Pilula>
                  <span>
                    Versão {p.versao}
                    {p.autor_nome && ` · escrito por ${p.autor_nome}`}
                    {p.publicado_em && ` · publicado ${quando(p.publicado_em)}`}
                    {p.publicado_por_nome && ` por ${p.publicado_por_nome}`}
                  </span>
                  {p.origem === "entrevista" && p.entrevista_id && (
                    <Link
                      href={`/painel/procedimentos/entrevistas/${p.entrevista_id}`}
                      className="inline-flex items-center gap-1 font-semibold text-terracota underline"
                    >
                      <Mic className="size-3.5" aria-hidden /> ver a entrevista
                    </Link>
                  )}
                </span>
              }
              acoes={
                edicao ? (
                  <>
                    <Botao
                      variante="discreto"
                      icone={X}
                      onClick={() => {
                        setRascunho(null);
                        setAEditarPedido(false);
                        acao.limpar();
                      }}
                    >
                      Cancelar
                    </Botao>
                    <Botao icone={Check} onClick={() => void guardar()} disabled={acao.aCorrer}>
                      Guardar versão
                    </Botao>
                  </>
                ) : (
                  <>
                    {podeEditar && (
                      <Botao variante="secundario" icone={Pencil} onClick={() => setRascunho({ ...conteudoDe(p), nota: "" })}>
                        Editar
                      </Botao>
                    )}
                    {chefia && p.estado !== "arquivado" && (
                      <Botao variante="discreto" icone={Archive} onClick={() => void mudarEstado("arquivar")} disabled={acao.aCorrer}>
                        Arquivar
                      </Botao>
                    )}
                    {chefia && p.estado !== "publicado" && (
                      <Botao icone={Check} onClick={() => void mudarEstado("publicar")} disabled={acao.aCorrer}>
                        Publicar
                      </Botao>
                    )}
                  </>
                )
              }
            />
            <AvisoInterno />
            {p.estado === "rascunho" && !edicao && (
              <p className="mx-4 sm:mx-10 mb-5 rounded-xl bg-ambar-suave px-4 py-2.5 text-[13px] text-ambar">
                Rascunho: ainda não aparece no assistente interno.{" "}
                {chefia ? "Reveja e publique quando estiver certo." : "A chefia de divisão revê e publica."}
              </p>
            )}
            <ErroLinha erro={acao.erro} className="mx-4 sm:mx-10 mb-4" />

            <div className="grid gap-6 px-4 sm:px-10 lg:grid-cols-[1fr_300px]">
              {edicao ? (
                <Editor valor={edicao} mudar={(v) => setRascunho(v)} />
              ) : (
                <Leitura c={p} />
              )}
              <aside className="flex flex-col gap-4">
                <Cartao className="p-5">
                  <Rotulo className="flex items-center gap-1.5">
                    <History className="size-3.5" aria-hidden /> Versões
                  </Rotulo>
                  <ul className="mt-3 flex flex-col gap-1">
                    {p.versoes.map((v) => (
                      <li key={v.versao}>
                        <button
                          type="button"
                          onClick={() => setVersaoAberta(v.versao)}
                          className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-creme"
                        >
                          <span className="font-semibold text-tinta">v{v.versao}</span>{" "}
                          <span className="text-tinta-2">
                            {v.estado} · {v.alterado_por_nome ?? "—"} · {quando(v.criado_em)}
                          </span>
                          {v.nota && <span className="block text-xs text-tinta-3">{v.nota}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Cartao>
              </aside>
            </div>
            {versaoAberta !== null && (
              <VerVersao id={id} versao={versaoAberta} onFechar={() => setVersaoAberta(null)} />
            )}
          </>
        )}
      </Estado>
    </div>
  );
}

function Seccao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-bold text-tinta">{titulo}</h2>
      {children}
    </section>
  );
}

function Leitura({ c }: { c: Conteudo }) {
  const vazio = <p className="text-sm text-tinta-3">Nada escrito ainda.</p>;
  return (
    <Cartao className="flex flex-col gap-6 p-6">
      <Seccao titulo="O que é">{c.resumo ? <p className="whitespace-pre-line text-sm text-tinta-2">{c.resumo}</p> : vazio}</Seccao>
      <Seccao titulo="Passo a passo">
        {c.passos.length ? (
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-tinta">
            {c.passos.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        ) : (
          vazio
        )}
      </Seccao>
      <Seccao titulo="Onde está cada coisa">
        {c.onde_esta.length ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {c.onde_esta.map((o, i) => (
              <div key={i} className="contents">
                <dt className="font-semibold text-tinta">{o.o_que}</dt>
                <dd className="text-tinta-2">{o.onde || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          vazio
        )}
      </Seccao>
      <Seccao titulo="A quem perguntar">
        {c.contactos.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {c.contactos.map((x, i) => (
              <li key={i}>
                <span className="font-semibold text-tinta">{x.nome}</span>
                {x.papel && <span className="text-tinta-2"> · {x.papel}</span>}
                {x.contacto && <span className="text-tinta-2"> · {x.contacto}</span>}
              </li>
            ))}
          </ul>
        ) : (
          vazio
        )}
      </Seccao>
      <Seccao titulo="Exceções">{lista(c.excecoes, vazio)}</Seccao>
      <Seccao titulo="Erros comuns">{lista(c.erros_comuns, vazio)}</Seccao>
      {c.notas && (
        <Seccao titulo="Notas">
          <p className="whitespace-pre-line text-sm text-tinta-2">{c.notas}</p>
        </Seccao>
      )}
    </Cartao>
  );
}

function lista(xs: string[], vazio: React.ReactNode) {
  if (!xs.length) return vazio;
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-tinta">
      {xs.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

/** Uma linha por item. */
function linhas(t: string): string[] {
  return t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function Editor({
  valor,
  mudar,
}: {
  valor: Conteudo & { nota: string };
  mudar: (v: Conteudo & { nota: string }) => void;
}) {
  const campo = <K extends keyof (Conteudo & { nota: string })>(k: K, v: (Conteudo & { nota: string })[K]) =>
    mudar({ ...valor, [k]: v });
  return (
    <Cartao className="flex flex-col gap-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Título">
          <input className={classeEntrada} value={valor.titulo} onChange={(e) => campo("titulo", e.target.value)} />
        </Campo>
        <Campo rotulo="Área ou serviço">
          <input className={classeEntrada} value={valor.area} onChange={(e) => campo("area", e.target.value)} />
        </Campo>
      </div>
      <Campo rotulo="O que é">
        <textarea className={`${classeEntrada} min-h-20`} value={valor.resumo} onChange={(e) => campo("resumo", e.target.value)} />
      </Campo>
      <ListaTexto rotulo="Passo a passo" ajuda="Um passo por linha, pela ordem." valor={valor.passos} mudar={(v) => campo("passos", v)} />

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-tinta">Onde está cada coisa</span>
        {valor.onde_esta.map((o, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label="O quê"
              className={classeEntrada}
              placeholder="O quê (ex.: minutas)"
              value={o.o_que}
              onChange={(e) => campo("onde_esta", valor.onde_esta.map((x, j) => (j === i ? { ...x, o_que: e.target.value } : x)))}
            />
            <input
              aria-label="Onde"
              className={classeEntrada}
              placeholder="Onde (ex.: pasta Obras/Minutas)"
              value={o.onde}
              onChange={(e) => campo("onde_esta", valor.onde_esta.map((x, j) => (j === i ? { ...x, onde: e.target.value } : x)))}
            />
            <Botao
              variante="discreto"
              tamanho="pequeno"
              icone={Trash2}
              aria-label="Tirar"
              onClick={() => campo("onde_esta", valor.onde_esta.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <Botao
          variante="discreto"
          tamanho="pequeno"
          icone={Plus}
          className="self-start"
          onClick={() => campo("onde_esta", [...valor.onde_esta, { o_que: "", onde: "" }])}
        >
          Acrescentar
        </Botao>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-tinta">A quem perguntar (contactos internos)</span>
        {valor.contactos.map((x, i) => (
          <div key={i} className="flex gap-2">
            {(["nome", "papel", "contacto"] as const).map((k) => (
              <input
                key={k}
                aria-label={k}
                className={classeEntrada}
                placeholder={k === "nome" ? "Nome" : k === "papel" ? "Serviço ou papel" : "Extensão ou email"}
                value={x[k] ?? ""}
                onChange={(e) =>
                  campo(
                    "contactos",
                    valor.contactos.map((y, j) => (j === i ? { ...y, [k]: e.target.value || (k === "nome" ? "" : null) } : y)),
                  )
                }
              />
            ))}
            <Botao
              variante="discreto"
              tamanho="pequeno"
              icone={Trash2}
              aria-label="Tirar"
              onClick={() => campo("contactos", valor.contactos.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <Botao
          variante="discreto"
          tamanho="pequeno"
          icone={Plus}
          className="self-start"
          onClick={() => campo("contactos", [...valor.contactos, { nome: "", papel: null, contacto: null }])}
        >
          Acrescentar
        </Botao>
      </div>

      <ListaTexto rotulo="Exceções" ajuda="Um caso por linha." valor={valor.excecoes} mudar={(v) => campo("excecoes", v)} />
      <ListaTexto rotulo="Erros comuns" ajuda="Um por linha." valor={valor.erros_comuns} mudar={(v) => campo("erros_comuns", v)} />
      <Campo rotulo="Notas">
        <textarea className={`${classeEntrada} min-h-20`} value={valor.notas} onChange={(e) => campo("notas", e.target.value)} />
      </Campo>
      <Campo rotulo="O que mudou (opcional)" ajuda="Fica no histórico de versões.">
        <input className={classeEntrada} value={valor.nota} onChange={(e) => campo("nota", e.target.value)} />
      </Campo>
    </Cartao>
  );
}

/** Lista de textos editada como linhas (o texto fica tal como se escreve). */
function ListaTexto({
  rotulo,
  ajuda,
  valor,
  mudar,
}: {
  rotulo: string;
  ajuda: string;
  valor: string[];
  mudar: (v: string[]) => void;
}) {
  const [texto, setTexto] = useState(valor.join("\n"));
  return (
    <Campo rotulo={rotulo} ajuda={ajuda}>
      <textarea
        className={`${classeEntrada} min-h-24`}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          mudar(linhas(e.target.value));
        }}
      />
    </Campo>
  );
}

function VerVersao({ id, versao, onFechar }: { id: string; versao: number; onFechar: () => void }) {
  const v = useDados<{ versao: number; estado: string; conteudo: Conteudo; criado_em: string }>(
    `/v1/painel/procedimentos/${id}/versoes/${versao}`,
  );
  return (
    <Dialogo titulo={`Versão ${versao}`} aberto onFechar={onFechar} largura="max-w-3xl">
      <Estado aCarregar={v.aCarregar} erro={v.erro} vazio={!v.dados}>
        {v.dados && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-tinta-2">
              <span className="font-semibold text-tinta">{v.dados.conteudo.titulo}</span> · {v.dados.estado} ·{" "}
              {quando(v.dados.criado_em)}
            </p>
            <div className="max-h-[60vh] overflow-y-auto">
              <Leitura c={v.dados.conteudo} />
            </div>
          </div>
        )}
      </Estado>
    </Dialogo>
  );
}
