"use client";

import {
  BadgeCheck,
  Check,
  ChevronDown,
  FileDiff,
  Pencil,
  Rocket,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  numero,
  Pilula,
  quando,
  Rotulo,
  useAcao,
  useDados,
} from "./comum";
import { FormularioResposta, linhas, usePodeEditarRespostas } from "./formulario-resposta";
import { Diferencas, eErroDeAvaliacao, ErroPublicacao, PrecisaDe } from "./publicacao";
import type { EstadoVersao, Historico, Resposta, VersaoHistorico } from "./tipos";

const ESTADO_VERSAO: Record<EstadoVersao, { rotulo: string; tom: "verde" | "neutro" | "terracota" | "ambar" }> = {
  no_ar: { rotulo: "no ar", tom: "verde" },
  publicada: { rotulo: "publicada antes", tom: "neutro" },
  rejeitada: { rotulo: "rejeitada", tom: "terracota" },
  em_revisao: { rotulo: "em revisão", tom: "ambar" },
  rascunho: { rotulo: "rascunho", tom: "neutro" },
};

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function Avatar({ v }: { v: VersaoHistorico }) {
  if (v.origem === "equipa" || !v.criada_por)
    return (
      <span
        className="flex size-[26px] shrink-0 items-center justify-center rounded-[13px_13px_13px_4px] bg-terracota font-display text-sm font-extrabold text-white"
        aria-hidden
      >
        ?
      </span>
    );
  return (
    <span
      className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-tinta text-[10px] font-extrabold text-white"
      aria-hidden
    >
      {iniciais(v.criada_por.nome)}
    </span>
  );
}

function descricaoVersao(v: VersaoHistorico): string {
  const quem =
    v.origem === "equipa"
      ? `Equipa Tou, Câmara?${v.criada_por ? ` (${v.criada_por.nome})` : ""}`
      : (v.criada_por?.nome ?? "Câmara");
  if (v.reverte_de_numero) return `${quem} · repôs a v${v.reverte_de_numero}`;
  if (v.diff.anterior_numero === null) return `${quem} · primeira versão`;
  return `${quem}${v.muda_factos ? " · muda números, prazos ou contactos" : ""}`;
}

export function EditorResposta({ id, onMudou }: { id: string; onMudou: () => void }) {
  const { pedido } = useSessao();
  const editar = usePodeEditarRespostas();
  const resposta = useDados<Resposta>(`/v1/painel/conhecimento/respostas/${id}`);
  const historico = useDados<Historico>(`/v1/painel/conhecimento/respostas/${id}/versoes`);
  const [aEditar, setAEditar] = useState(false);
  const [todasFrases, setTodasFrases] = useState(false);
  const [diffAberto, setDiffAberto] = useState<string | null>(null);
  const [revisao, setRevisao] = useState<{ versao: VersaoHistorico; decisao: "aprovar" | "rejeitar" } | null>(null);
  const [nota, setNota] = useState("");
  const [forcar, setForcar] = useState<string | null>(null);
  const publicar = useAcao();
  const guardar = useAcao();
  const acao = useAcao();

  if (resposta.erro || (resposta.aCarregar && !resposta.dados)) {
    return (
      <Cartao>
        <Estado aCarregar={resposta.aCarregar} erro={resposta.erro} />
      </Cartao>
    );
  }
  const r = resposta.dados!;
  const atualizar = (nova?: Resposta) => {
    if (nova) resposta.mudar(() => nova);
    else resposta.recarregar();
    historico.recarregar();
    onMudou();
  };

  const noAr = r.versoes.find((v) => v.no_ar);
  const ultima = r.versoes[0];
  const mostrada = noAr ?? ultima;
  const pendente =
    ultima && !ultima.publicada_em && ultima.estado !== "rejeitada" ? ultima : null;
  const frases = todasFrases ? r.frases : r.frases.slice(0, 6);
  const alteracoesAbertas = r.alteracoes.filter((a) => a.estado === "proposta");

  const publicarVersao = async (versaoId: string, comForca = false) => {
    const nova = await publicar.executar(() =>
      pedido<Resposta>(`/v1/painel/conhecimento/respostas/${id}/publicar`, {
        corpo: { versao_id: versaoId, forcar: comForca },
      }),
    );
    if (nova) {
      setForcar(null);
      atualizar(nova);
    }
  };

  return (
    <Cartao className="flex flex-col gap-[18px] p-6" aria-label={r.pergunta_tipo}>
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="font-display text-2xl font-bold text-tinta">{r.pergunta_tipo}</h2>
          <div className="flex flex-wrap gap-1.5">
            <Pilula>Usada {numero(r.usos.ultimos_30_dias)}× nos últimos 30 dias</Pilula>
            {noAr ? (
              <Pilula tom="verde" icone={Check}>
                No ar desde {quando(noAr.publicada_em)}
              </Pilula>
            ) : (
              <Pilula tom="ambar">Ainda não está no ar</Pilula>
            )}
            {r.tema && <Pilula>{r.tema}</Pilula>}
          </div>
        </div>
        {editar.pode && (
          <div className="flex gap-2">
            <Botao variante="secundario" icone={Pencil} onClick={() => setAEditar(true)}>
              Editar
            </Botao>
            {pendente && (
              <Botao
                icone={Rocket}
                disabled={publicar.aCorrer}
                onClick={() => publicarVersao(pendente.id)}
              >
                {publicar.aCorrer ? "A publicar…" : `Publicar v${pendente.numero}`}
              </Botao>
            )}
          </div>
        )}
      </div>

      {pendente && pendente.precisa_de.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-tinta-2">
            A v{pendente.numero} ainda não pode ir para o ar:
          </p>
          <PrecisaDe requisitos={pendente.precisa_de} />
        </div>
      )}
      <ErroPublicacao erro={publicar.erro} interno={editar.interno} />
      {editar.interno && eErroDeAvaliacao(publicar.erro) && pendente && (
        <Botao variante="secundario" tamanho="pequeno" className="w-fit" onClick={() => setForcar(pendente.id)}>
          Publicar sem avaliação…
        </Botao>
      )}

      {alteracoesAbertas.length > 0 && (
        <Link
          href="/painel/conhecimento/alteracoes"
          className="flex items-center gap-2 rounded-xl bg-ambar-suave px-3.5 py-2.5 text-[13px] text-ambar hover:underline"
        >
          <FileDiff className="size-4" aria-hidden />
          A fonte «{alteracoesAbertas[0].fonte}» mudou: {alteracoesAbertas[0].resumo}. Rever a alteração.
        </Link>
      )}

      {/* Frases */}
      <div className="flex flex-col gap-2">
        <Rotulo>As pessoas perguntam assim</Rotulo>
        {r.frases.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {frases.map((f) => (
              <li key={f.id} className="rounded-lg border border-linha bg-creme px-2.5 py-[5px] text-xs text-tinta-2">
                “{f.frase}”
              </li>
            ))}
            {r.frases.length > 6 && (
              <li>
                <button
                  type="button"
                  onClick={() => setTodasFrases((x) => !x)}
                  className="rounded-lg border border-linha bg-creme-2 px-2.5 py-[5px] text-xs text-tinta-2 hover:text-tinta"
                >
                  {todasFrases ? "mostrar menos" : `+ ${r.frases.length - 6}`}
                </button>
              </li>
            )}
          </ul>
        ) : (
          <p className="text-xs text-tinta-3">Ainda sem frases.</p>
        )}
      </div>

      {/* Textos */}
      {mostrada && (
        <>
          <div className="grid gap-4 md:grid-cols-[minmax(0,344fr)_minmax(0,280fr)]">
            <div className="flex flex-col gap-2">
              <Rotulo>Ao telefone e no chat{!noAr ? ` · v${mostrada.numero}` : ""}</Rotulo>
              <p className="rounded-xl border border-linha bg-creme p-3.5 text-sm whitespace-pre-line text-tinta">
                {mostrada.texto_voz}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Rotulo>No SMS</Rotulo>
                {mostrada.texto_sms && (
                  <span
                    className={`text-[11px] font-bold ${mostrada.texto_sms.length > 160 ? "text-ambar" : "text-verde"}`}
                  >
                    {mostrada.texto_sms.length} / 160
                  </span>
                )}
              </div>
              {mostrada.texto_sms ? (
                <p className="rounded-[14px_14px_14px_4px] bg-[#E9E9EB] px-3 py-2.5 text-[13px] text-[#111111]">
                  {mostrada.texto_sms}
                </p>
              ) : (
                <p className="text-xs text-tinta-3">Sem texto próprio para SMS.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Rotulo>Fontes oficiais</Rotulo>
              {mostrada.fontes.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {mostrada.fontes.map((f) => (
                    <li key={f.trecho_id}>
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        title={f.texto ?? f.titulo}
                        className="inline-flex items-center gap-1 rounded-xl bg-verde-suave px-2.5 py-1 text-xs font-semibold text-verde hover:underline"
                      >
                        <BadgeCheck className="size-3.5" aria-hidden />
                        {f.referencia ? `${f.titulo}, ${f.referencia}` : f.titulo}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ambar">Sem fonte oficial citada.</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Rotulo>Passa a um funcionário quando</Rotulo>
              {mostrada.passa_a_pessoa_quando.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {mostrada.passa_a_pessoa_quando.map((p) => (
                    <li
                      key={p}
                      className="inline-flex items-center gap-1 rounded-xl bg-terracota-suave px-2.5 py-1 text-xs font-semibold text-terracota-escuro"
                    >
                      <UserRound className="size-3.5" aria-hidden />
                      {p}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-tinta-3">Nunca: o agente responde sempre.</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Versões */}
      <div className="flex flex-col">
        <Rotulo className="mb-2">Versões</Rotulo>
        <ErroLinha erro={acao.erro} className="mb-2" />
        <Estado aCarregar={historico.aCarregar} erro={historico.erro} vazio={!historico.dados?.versoes.length}>
          <ol>
            {historico.dados?.versoes.map((v) => {
              const est = ESTADO_VERSAO[v.estado];
              const aberto = diffAberto === v.id;
              const podePublicar = editar.pode && !v.publicada_em && v.estado !== "rejeitada";
              return (
                <li key={v.id} className="border-t border-linha py-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar v={v} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13px] font-semibold text-tinta">
                        v{v.numero} · {quando(v.criada_em)}
                      </span>
                      <span className="text-xs text-tinta-3">{descricaoVersao(v)}</span>
                      {v.revisao && (
                        <span className="text-xs text-tinta-3">
                          {v.revisao === "aprovada" ? "Aprovada" : "Rejeitada"} pela equipa
                          {v.revista_por ? ` (${v.revista_por.nome})` : ""}
                          {v.revisao_nota ? `: «${v.revisao_nota}»` : ""}
                        </span>
                      )}
                    </div>
                    <Pilula tom={est.tom}>{est.rotulo}</Pilula>
                    <button
                      type="button"
                      aria-expanded={aberto}
                      onClick={() => setDiffAberto(aberto ? null : v.id)}
                      className="flex items-center gap-1 text-xs font-semibold text-tinta-2 hover:text-tinta"
                    >
                      Diferenças
                      <ChevronDown className={`size-3.5 transition-transform ${aberto ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                    {editar.interno && v.estado === "em_revisao" && (
                      <>
                        <button
                          type="button"
                          className="text-xs font-semibold text-verde hover:underline"
                          onClick={() => {
                            setNota("");
                            setRevisao({ versao: v, decisao: "aprovar" });
                          }}
                        >
                          Aprovar
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-terracota-escuro hover:underline"
                          onClick={() => {
                            setNota("");
                            setRevisao({ versao: v, decisao: "rejeitar" });
                          }}
                        >
                          Rejeitar
                        </button>
                      </>
                    )}
                    {podePublicar && v.id !== pendente?.id && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-terracota-escuro hover:underline"
                        disabled={publicar.aCorrer}
                        onClick={() => publicarVersao(v.id)}
                      >
                        Publicar
                      </button>
                    )}
                    {editar.pode && !v.no_ar && v.publicada_em && (
                      <button
                        type="button"
                        disabled={acao.aCorrer}
                        className="flex items-center gap-1 text-xs font-semibold text-terracota-escuro hover:underline"
                        onClick={async () => {
                          const nova = await acao.executar(() =>
                            pedido<Resposta>(
                              `/v1/painel/conhecimento/respostas/${id}/versoes/${v.id}/reverter`,
                              { metodo: "POST" },
                            ),
                          );
                          if (nova) atualizar(nova);
                        }}
                      >
                        <RotateCcw className="size-3" aria-hidden />
                        Repor
                      </button>
                    )}
                  </div>
                  {!v.publicada_em && v.precisa_de.length > 0 && (
                    <div className="mt-1.5 pl-[38px]">
                      <PrecisaDe requisitos={v.precisa_de} />
                    </div>
                  )}
                  {aberto && (
                    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-creme p-3 pl-[38px]">
                      <div className="flex flex-col gap-1">
                        <Rotulo>
                          Ao telefone e no chat
                          {v.diff.anterior_numero ? ` · face à v${v.diff.anterior_numero}` : ""}
                        </Rotulo>
                        <Diferencas passos={v.diff.texto_voz} />
                      </div>
                      {v.diff.texto_sms.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <Rotulo>No SMS</Rotulo>
                          <Diferencas passos={v.diff.texto_sms} />
                        </div>
                      )}
                      {(v.diff.passa_a_pessoa_quando.adicionados.length > 0 ||
                        v.diff.passa_a_pessoa_quando.removidos.length > 0) && (
                        <div className="flex flex-col gap-1 text-xs">
                          <Rotulo>Passa a um funcionário quando</Rotulo>
                          {v.diff.passa_a_pessoa_quando.removidos.map((x) => (
                            <span key={`r${x}`} className="text-terracota-escuro">− {x}</span>
                          ))}
                          {v.diff.passa_a_pessoa_quando.adicionados.map((x) => (
                            <span key={`a${x}`} className="text-verde">+ {x}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Estado>
      </div>

      {/* Editar: versão nova */}
      <Dialogo titulo="Nova versão" aberto={aEditar} onFechar={() => setAEditar(false)} largura="max-w-2xl">
        {mostrada && (
          <FormularioResposta
            comPergunta={false}
            comTema={false}
            rotuloFrases="Frases novas a juntar (uma por linha)"
            textoGuardar="Guardar versão"
            inicial={{
              pergunta_tipo: r.pergunta_tipo,
              tema_id: r.tema_id,
              texto_voz: (ultima ?? mostrada).texto_voz,
              texto_sms: (ultima ?? mostrada).texto_sms ?? "",
              passa_a_pessoa_quando: (ultima ?? mostrada).passa_a_pessoa_quando.join("\n"),
              frases: "",
            }}
            aCorrer={guardar.aCorrer}
            erro={guardar.erro}
            onCancelar={() => setAEditar(false)}
            onGuardar={async (v) => {
              const nova = await guardar.executar(() =>
                pedido<Resposta>(`/v1/painel/conhecimento/respostas/${id}/versoes`, {
                  corpo: {
                    texto_voz: v.texto_voz.trim(),
                    texto_sms: v.texto_sms.trim() || null,
                    passa_a_pessoa_quando: linhas(v.passa_a_pessoa_quando),
                    frases: linhas(v.frases),
                  },
                }),
              );
              if (nova) {
                setAEditar(false);
                atualizar(nova);
              }
            }}
          />
        )}
        {!editar.interno && (
          <p className="mt-3 text-xs text-tinta-3">
            Se a versão mudar números, prazos ou contactos, precisa da revisão da equipa Tou,
            Câmara? ou de uma avaliação nova do agente antes de ir para o ar.
          </p>
        )}
      </Dialogo>

      {/* Revisão pela equipa interna */}
      <Dialogo
        titulo={revisao?.decisao === "aprovar" ? `Aprovar a v${revisao.versao.numero}` : `Rejeitar a v${revisao?.versao.numero ?? ""}`}
        aberto={!!revisao}
        onFechar={() => setRevisao(null)}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!revisao) return;
            const nova = await acao.executar(() =>
              pedido<Resposta>(
                `/v1/painel/conhecimento/respostas/${id}/versoes/${revisao.versao.id}/rever`,
                { corpo: { decisao: revisao.decisao, nota: nota.trim() || null } },
              ),
            );
            if (nova) {
              setRevisao(null);
              atualizar(nova);
            }
          }}
        >
          <p className="text-sm text-tinta-2">
            {revisao?.decisao === "aprovar"
              ? "A versão deixa de precisar da revisão interna. O gate do avaliador continua a contar."
              : "A câmara não poderá publicar esta versão e terá de escrever outra."}
          </p>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-tinta">
            Nota (opcional)
            <textarea className={`${classeEntrada} min-h-20`} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} />
          </label>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" onClick={() => setRevisao(null)}>
              Cancelar
            </Botao>
            <Botao type="submit" icone={revisao?.decisao === "aprovar" ? Check : X} disabled={acao.aCorrer}>
              {revisao?.decisao === "aprovar" ? "Aprovar" : "Rejeitar"}
            </Botao>
          </div>
        </form>
      </Dialogo>

      {/* Forçar (equipa interna, auditado) */}
      <Dialogo titulo="Publicar sem avaliação" aberto={!!forcar} onFechar={() => setForcar(null)}>
        <p className="text-sm text-tinta-2">
          A versão vai para o ar sem uma avaliação do agente que passe o mínimo. Fica registado na
          auditoria como publicação sem avaliação.
        </p>
        <ErroLinha erro={publicar.erro && !eErroDeAvaliacao(publicar.erro) ? publicar.erro : null} className="mt-3" />
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="discreto" onClick={() => setForcar(null)}>
            Cancelar
          </Botao>
          <Botao icone={Rocket} disabled={publicar.aCorrer} onClick={() => forcar && publicarVersao(forcar, true)}>
            Publicar na mesma
          </Botao>
        </div>
      </Dialogo>
    </Cartao>
  );
}
