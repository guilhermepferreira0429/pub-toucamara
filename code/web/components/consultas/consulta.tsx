"use client";

import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Lock,
  Pencil,
  PhoneOutgoing,
  Play,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  dia,
  Dialogo,
  ErroLinha,
  Estado,
  numero,
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
import { FormularioConsulta } from "./formulario";
import {
  CANAIS,
  CORES_OPCOES,
  type DetalheConsulta,
  type ListaConsultas,
  type ResultadoPergunta,
  type ResumoOpinioes,
  SITUACOES,
} from "./tipos";

/*
 * Painel · Uma consulta pública: abrir e fechar, o resultado por freguesia,
 * as opiniões livres agrupadas por temas (IA, ou contagens sem IA), o CSV
 * anonimizado e "ligar às pessoas inscritas".
 */
export function DetalheConsultaPublica({ id }: { id: string }) {
  const { pode, pedido, pedidoFicheiro } = useSessao();
  const d = useDados<DetalheConsulta>(pode("indicadores") ? `/v1/painel/consultas/${id}` : null);
  const lista = useDados<ListaConsultas>(pode("agente") ? "/v1/painel/consultas" : null);
  const acao = useAcao();
  const [editar, setEditar] = useState(false);

  if (!pode("indicadores")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Comunidade", "Consultas públicas"]} titulo="Consulta pública" />
        <SemAcesso />
      </div>
    );
  }
  const c = d.dados;
  const executar = async (caminho: string) => {
    const r = await acao.executar(() =>
      pedido<DetalheConsulta>(caminho, { metodo: "POST" }),
    );
    if (r) d.mudar(() => r);
  };
  const exportar = async () => {
    const r = await acao.executar(() =>
      pedidoFicheiro(`/v1/painel/consultas/${id}/participacoes.csv`),
    );
    if (r?.tipo !== "ficheiro") return;
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consulta-${c?.codigo.toLowerCase() ?? id}-participacoes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col pb-12">
      <div className="px-4 sm:px-10 pt-6">
        <Link href="/painel/consultas" className="inline-flex items-center gap-1 text-[13px] font-semibold text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden /> Consultas públicas
        </Link>
      </div>
      {!c ? (
        <Estado aCarregar={d.aCarregar} erro={d.erro} />
      ) : (
        <>
          <CabecalhoPagina
            migalhas={["Comunidade", "Consultas públicas", c.codigo]}
            titulo={c.titulo}
            descricao={
              <span className="flex flex-wrap items-center gap-2">
                <Pilula tom={SITUACOES[c.situacao].tom}>{SITUACOES[c.situacao].rotulo}</Pilula>
                <span>
                  {dia(c.abre_em)} a {dia(c.fecha_em)} · relatório a {dia(c.relatorio_em)} ·{" "}
                  {c.freguesias?.length ? c.freguesias.join(", ") : "todo o concelho"}
                </span>
              </span>
            }
            acoes={
              <>
                {c.estado !== "rascunho" && (
                  <a
                    href={c.link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-tinta-2 hover:bg-creme-2"
                  >
                    <ExternalLink className="size-4" aria-hidden /> Página pública
                  </a>
                )}
                <Botao variante="secundario" icone={Download} onClick={() => void exportar()} disabled={acao.aCorrer}>
                  CSV
                </Botao>
                {pode("agente") && (
                  <Botao variante="secundario" icone={Pencil} onClick={() => setEditar(true)}>
                    Editar
                  </Botao>
                )}
                {pode("agente") && c.estado !== "aberta" && (
                  <Botao icone={Play} disabled={acao.aCorrer} onClick={() => void executar(`/v1/painel/consultas/${id}/abrir`)}>
                    Abrir
                  </Botao>
                )}
                {pode("agente") && c.estado === "aberta" && (
                  <Botao icone={Lock} disabled={acao.aCorrer} onClick={() => void executar(`/v1/painel/consultas/${id}/fechar`)}>
                    Fechar
                  </Botao>
                )}
              </>
            }
          />
          <div className="flex flex-col gap-6 px-4 sm:px-10">
            <ErroLinha erro={acao.erro} />
            <Numeros c={c} />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-6">
                {c.resultados.perguntas.map((p) => (
                  <ResultadoPorFreguesia key={p.id} p={p} />
                ))}
                {c.pergunta_aberta && <Opinioes c={c} onResumo={(r) => d.mudar((x) => ({ ...x, ...r }))} />}
              </div>
              <div className="flex flex-col gap-6">
                <OQueEstaEmCausa c={c} />
                {pode("acao_social") && <Ligar c={c} onLigou={d.recarregar} />}
              </div>
            </div>
          </div>
          <Dialogo titulo="Editar consulta" aberto={editar} onFechar={() => setEditar(false)} largura="max-w-2xl">
            <FormularioConsulta
              consulta={c}
              freguesiasConhecidas={lista.dados?.freguesias_conhecidas ?? []}
              onCancelar={() => setEditar(false)}
              onGuardada={() => {
                setEditar(false);
                d.recarregar();
              }}
            />
          </Dialogo>
        </>
      )}
    </div>
  );
}

function Numeros({ c }: { c: DetalheConsulta }) {
  const abrangidas = c.resultados.freguesias.filter((f) => f.abrangida && f.participacoes > 0).length;
  const totalAbrangidas = c.freguesias?.length ?? null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Cartao className="p-4">
        <Rotulo>Participações</Rotulo>
        <p className="mt-1 font-display text-3xl font-bold text-tinta">{numero(c.resultados.total)}</p>
        <p className="text-xs text-tinta-3">uma por pessoa (pode mudar até ao fim)</p>
      </Cartao>
      <Cartao className="p-4">
        <Rotulo>Por canal</Rotulo>
        <ul className="mt-2 flex flex-col gap-0.5 text-[13px] text-tinta">
          {Object.keys(c.por_canal).length === 0 && <li className="text-tinta-3">—</li>}
          {Object.entries(c.por_canal).map(([k, n]) => (
            <li key={k} className="flex justify-between">
              <span>{CANAIS[k] ?? k}</span>
              <span className="font-semibold">{numero(n)}</span>
            </li>
          ))}
        </ul>
      </Cartao>
      <Cartao className="p-4">
        <Rotulo>Freguesias com participações</Rotulo>
        <p className="mt-1 font-display text-3xl font-bold text-tinta">
          {numero(abrangidas)}
          {totalAbrangidas ? <span className="text-lg text-tinta-3"> / {totalAbrangidas}</span> : null}
        </p>
        <p className="text-xs text-tinta-3">Sem dados de população: só contagens</p>
      </Cartao>
      <Cartao className="p-4">
        <Rotulo>Opiniões livres</Rotulo>
        <p className="mt-1 font-display text-3xl font-bold text-tinta">{numero(c.total_opinioes)}</p>
        <p className="text-xs text-tinta-3">{c.pergunta_aberta ? "na pergunta aberta" : "sem pergunta aberta"}</p>
      </Cartao>
    </div>
  );
}

function Barra({ opcoes, total }: { opcoes: { id: string; texto: string; n: number }[]; total: number }) {
  if (total === 0) return <div className="h-3 w-full rounded-full bg-creme-2" aria-hidden />;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-creme-2" aria-hidden>
      {opcoes.map((o, i) =>
        o.n > 0 ? (
          <span key={o.id} className={CORES_OPCOES[i % CORES_OPCOES.length]} style={{ width: `${(o.n / total) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}

function ResultadoPorFreguesia({ p }: { p: ResultadoPergunta }) {
  const total = p.opcoes.reduce((s, o) => s + o.n, 0);
  return (
    <Cartao>
      <div className="flex flex-col gap-3 border-b border-linha px-5 py-4">
        <h2 className="font-display text-lg font-bold text-tinta">{p.texto}</h2>
        <Barra opcoes={p.opcoes} total={total} />
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-tinta">
          {p.opcoes.map((o, i) => (
            <li key={o.id} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-full ${CORES_OPCOES[i % CORES_OPCOES.length]}`} aria-hidden />
              {o.texto}: <strong>{numero(o.n)}</strong> <span className="text-tinta-3">({numero(o.pct, 1)}%)</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="overflow-x-auto" tabIndex={0}>
        <table className="w-full text-[13px]">
          <caption className="sr-only">Resultado por freguesia: {p.texto}</caption>
          <thead>
            <tr className="text-left text-[11px] tracking-[0.4px] text-tinta-3 uppercase">
              <th className="px-5 py-2 font-bold">Freguesia</th>
              <th className="px-2 py-2 text-right font-bold">Total</th>
              <th className="w-1/3 px-2 py-2 font-bold">
                <span className="sr-only">Distribuição</span>
              </th>
              {p.opcoes.map((o) => (
                <th key={o.id} className="px-2 py-2 text-right font-bold">
                  {o.texto}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-linha">
            {p.por_freguesia.map((f) => (
              <tr key={f.freguesia} className={f.abrangida ? "" : "text-tinta-3"}>
                <th scope="row" className="px-5 py-2 text-left font-semibold">
                  {f.freguesia}
                  {!f.abrangida && <span className="ml-1.5 text-[11px] font-normal">(fora da consulta)</span>}
                </th>
                <td className="px-2 py-2 text-right font-semibold">{numero(f.total)}</td>
                <td className="px-2 py-2">
                  <Barra opcoes={p.opcoes.map((o) => ({ ...o, n: f.opcoes[o.id] ?? 0 }))} total={f.total} />
                </td>
                {p.opcoes.map((o) => (
                  <td key={o.id} className="px-2 py-2 text-right tabular-nums">
                    {numero(f.opcoes[o.id] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

const TONS_TEMA = {
  a_favor: { rotulo: "a favor", tom: "verde" },
  contra: { rotulo: "contra", tom: "terracota" },
  misto: { rotulo: "misto", tom: "neutro" },
  duvidas: { rotulo: "dúvidas", tom: "ambar" },
} as const;

function Opinioes({
  c,
  onResumo,
}: {
  c: DetalheConsulta;
  onResumo: (r: { resumo_opinioes: ResumoOpinioes; resumo_gerado_em: string; resumo_desatualizado: boolean }) => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const r = c.resumo_opinioes;
  const gerar = async () => {
    const x = await acao.executar(() =>
      pedido<{ resumo_opinioes: ResumoOpinioes }>(`/v1/painel/consultas/${c.id}/resumo`, { metodo: "POST" }),
    );
    if (x) onResumo({ ...x, resumo_gerado_em: new Date().toISOString(), resumo_desatualizado: false });
  };
  return (
    <Cartao>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-bold text-tinta">Opiniões livres</h2>
          <p className="text-[13px] text-tinta-2">{c.pergunta_aberta}</p>
        </div>
        <Botao
          variante={r && !c.resumo_desatualizado ? "secundario" : "principal"}
          icone={Sparkles}
          disabled={acao.aCorrer || c.total_opinioes === 0}
          onClick={() => void gerar()}
        >
          {acao.aCorrer ? "A agrupar…" : r ? "Atualizar resumo" : c.ia_disponivel ? "Agrupar por temas" : "Contar opiniões"}
        </Botao>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <ErroLinha erro={acao.erro} />
        {r && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-tinta-3">
              {r.ia ? "Agrupado pela IA" : "Sem IA"} · {numero(r.opinioes)} opiniões
              {c.resumo_gerado_em ? ` · ${quando(c.resumo_gerado_em)}` : ""}
              {c.resumo_desatualizado && " · há opiniões novas desde o resumo"}
            </p>
            {r.motivo_sem_ia && <p className="rounded-xl bg-creme p-3 text-[13px] text-tinta-2">{r.motivo_sem_ia}</p>}
            {r.sintese && <p className="text-[15px] leading-[1.5] text-tinta">{r.sintese}</p>}
            {r.temas && r.temas.length > 0 && (
              <ul className="flex flex-col gap-2">
                {r.temas.map((t) => (
                  <li key={t.tema} className="rounded-xl border border-linha p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-tinta">{t.tema}</span>
                      <Pilula tom={TONS_TEMA[t.tom].tom}>{TONS_TEMA[t.tom].rotulo}</Pilula>
                      <span className="text-xs text-tinta-3">{numero(t.opinioes)} opiniões</span>
                    </div>
                    <p className="mt-1 text-[13px] text-tinta-2">{t.descricao}</p>
                    {t.exemplos && t.exemplos.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1">
                        {t.exemplos.map((e) => (
                          <li key={e} className="border-l-2 border-linha pl-2 text-[13px] text-tinta-2 italic">
                            «{e}»
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!r.ia && r.palavras.length > 0 && (
              <div>
                <Rotulo>Palavras que mais se repetem</Rotulo>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.palavras.map((p) => (
                    <Pilula key={p.palavra}>
                      {p.palavra} · {p.n}
                    </Pilula>
                  ))}
                </div>
              </div>
            )}
            {!r.ia && r.por_opcao.length > 0 && (
              <div>
                <Rotulo>Quem deu opinião, pela resposta à primeira pergunta</Rotulo>
                <ul className="mt-2 flex flex-wrap gap-x-4 text-[13px] text-tinta">
                  {r.por_opcao.map((o) => (
                    <li key={o.opcao}>
                      {o.opcao}: <strong>{numero(o.opinioes)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <div>
          <Rotulo>Todas as opiniões ({numero(c.total_opinioes)}) · sem contactos</Rotulo>
          <Estado vazio={c.opinioes.length === 0} textoVazio="Ainda ninguém deixou uma opinião livre.">
            <ul className="mt-2 flex max-h-[480px] flex-col divide-y divide-linha overflow-y-auto">
              {c.opinioes.map((o, i) => (
                <li key={i} className="flex flex-col gap-0.5 py-2.5">
                  <span className="text-[14px] text-tinta">{o.opiniao}</span>
                  <span className="text-xs text-tinta-3">
                    {dia(o.dia)} · {o.freguesia ?? "sem freguesia"} · {CANAIS[o.canal] ?? o.canal}
                    {Object.values(o.respostas).filter(Boolean).length > 0 &&
                      ` · ${Object.values(o.respostas).filter(Boolean).join(" / ")}`}
                  </span>
                </li>
              ))}
            </ul>
          </Estado>
        </div>
      </div>
    </Cartao>
  );
}

function OQueEstaEmCausa({ c }: { c: DetalheConsulta }) {
  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <Rotulo>O que o agente explica</Rotulo>
      <p className="text-[14px] leading-[1.5] text-tinta">{c.resumo}</p>
      {c.documento_url && (
        <a
          href={c.documento_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-terracota hover:underline"
        >
          <FileText className="size-4" aria-hidden /> {c.documento_titulo ?? "Documento em consulta"}
        </a>
      )}
      <Rotulo className="pt-2">Perguntas</Rotulo>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-tinta">
        {c.perguntas.map((p) => (
          <li key={p.id}>
            {p.texto} <span className="text-tinta-3">({p.opcoes.map((o) => o.texto).join(" / ")})</span>
          </li>
        ))}
        {c.pergunta_aberta && <li>{c.pergunta_aberta} <span className="text-tinta-3">(resposta livre)</span></li>}
      </ol>
      <p className="pt-1 text-xs text-tinta-3">
        Criada {quando(c.criada_em)}
        {c.criada_por_nome ? ` por ${c.criada_por_nome}` : ""}
        {c.aberta_em ? ` · aberta ${quando(c.aberta_em)}` : ""}
        {c.fechada_em ? ` · fechada ${quando(c.fechada_em)}` : ""}
      </p>
    </Cartao>
  );
}

interface PreVisualizacao {
  destinatarios: number;
  a_ligar: number;
  sem_telefone: number;
  recusam_chamadas: number;
  minutos_estimados: number;
}

/** "A linha liga a mil munícipes": só a quem se inscreveu e deu autorização. */
function Ligar({ c, onLigou }: { c: DetalheConsulta; onLigou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [pv, setPv] = useState<PreVisualizacao | null>(null);
  const aberta = c.situacao === "aberta";
  const ver = async () => {
    const r = await acao.executar(() =>
      pedido<PreVisualizacao>(`/v1/painel/consultas/${c.id}/pre-visualizar-ligar`, { metodo: "POST" }),
    );
    if (r) setPv(r);
  };
  const ligar = async () => {
    const r = await acao.executar(() => pedido(`/v1/painel/consultas/${c.id}/ligar`, { metodo: "POST" }));
    if (r) {
      setPv(null);
      onLigou();
    }
  };
  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <Rotulo>Ligar às pessoas</Rotulo>
      <p className="text-[13px] leading-[1.45] text-tinta-2">
        O agente liga às pessoas inscritas na ação social que deram autorização para serem contactadas
        {c.freguesias?.length ? " nas freguesias da consulta" : ""}, explica a consulta e regista a opinião. Quem não
        atende recebe SMS com o link da página. Das 9h às 21h.
      </p>
      {pv && (
        <p className="rounded-xl bg-creme p-3 text-[13px] text-tinta">
          {numero(pv.a_ligar)} chamadas (de {numero(pv.destinatarios)} inscritas
          {pv.recusam_chamadas ? `, ${numero(pv.recusam_chamadas)} não querem chamadas` : ""}
          {pv.sem_telefone ? `, ${numero(pv.sem_telefone)} sem telefone` : ""}) · cerca de {numero(pv.minutos_estimados)}{" "}
          min.
        </p>
      )}
      <ErroLinha erro={acao.erro} />
      {!aberta ? (
        <p className="text-xs text-tinta-3">Abra a consulta (dentro do prazo) para poder ligar.</p>
      ) : pv ? (
        <Botao icone={PhoneOutgoing} disabled={acao.aCorrer || pv.a_ligar === 0} onClick={() => void ligar()}>
          Ligar a {numero(pv.a_ligar)} pessoas
        </Botao>
      ) : (
        <Botao variante="secundario" icone={PhoneOutgoing} disabled={acao.aCorrer} onClick={() => void ver()}>
          Ver quantas pessoas
        </Botao>
      )}
      {c.campanhas.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-linha pt-3 text-[13px]">
          {c.campanhas.map((x) => (
            <li key={x.id}>
              <Link href={`/painel/campanhas/${x.id}`} className="font-semibold text-tinta hover:underline">
                {quando(x.criada_em)} · {numero(x.destinatarios)} pessoas
              </Link>{" "}
              <span className="text-tinta-3">({x.estado === "a_ligar" ? "a ligar" : x.estado})</span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}
