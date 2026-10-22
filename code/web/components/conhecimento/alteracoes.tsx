"use client";

import {
  Check,
  CheckCheck,
  ExternalLink,
  EyeOff,
  GitCompareArrows,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  Cartao,
  Dialogo,
  dia,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  Rotulo,
  useAcao,
  useDados,
  useEquipaInterna,
  useMais,
  type Pagina,
} from "./comum";
import { eErroDeAvaliacao, ErroPublicacao } from "./publicacao";
import type { Alteracao, AlteracaoResumo, Contradicao } from "./tipos";

function Detalhe({ id, onMudou }: { id: string; onMudou: () => void }) {
  const { pedido, pode } = useSessao();
  const interno = useEquipaInterna();
  const a = useDados<Alteracao>(`/v1/painel/conhecimento/alteracoes/${id}`);
  const [rejeitar, setRejeitar] = useState<string[]>([]);
  const [forcar, setForcar] = useState(false);
  const acao = useAcao();

  if (a.erro || !a.dados) {
    return (
      <Cartao>
        <Estado aCarregar={a.aCarregar} erro={a.erro} />
      </Cartao>
    );
  }
  const d = a.dados;
  const porRever = d.estado === "por_rever";
  const propostas = d.respostas.filter((r) => r.estado === "proposta" && r.proposta_versao_id);
  const aPublicar = propostas.filter((r) => !rejeitar.includes(r.resposta_id));
  const escrever = pode("conhecimento");

  const aprovar = async (comForca = false) => {
    const r = await acao.executar(() =>
      pedido<Alteracao>(`/v1/painel/conhecimento/alteracoes/${id}/aprovar`, {
        corpo: { rejeitar, forcar: comForca },
      }),
    );
    if (r) {
      a.mudar(() => r);
      setForcar(false);
      onMudou();
    }
  };

  return (
    <Cartao className="flex flex-col gap-[18px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-display text-2xl font-bold text-tinta">{d.fonte}</h2>
          <p className="text-[13px] text-tinta-2">
            {d.entidade} · detetada {quando(d.detetada_em)}
            {d.vigor_desde ? ` · em vigor a partir de ${dia(d.vigor_desde)}` : ""}
            {d.vigor_ate ? ` até ${dia(d.vigor_ate)}` : ""}
          </p>
          <a href={d.url} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-xs text-tinta-3 hover:text-tinta">
            Ver a fonte <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
        {porRever && escrever ? (
          <div className="flex flex-wrap gap-2">
            <Botao
              variante="discreto"
              icone={EyeOff}
              disabled={acao.aCorrer}
              onClick={async () => {
                const r = await acao.executar(() =>
                  pedido<Alteracao>(`/v1/painel/conhecimento/alteracoes/${id}/ignorar`, { metodo: "POST" }),
                );
                if (r) {
                  a.mudar(() => r);
                  onMudou();
                }
              }}
            >
              Ignorar
            </Botao>
            {(interno || !aPublicar.length) && (
              <Botao icone={CheckCheck} disabled={acao.aCorrer} onClick={() => aprovar()}>
                {aPublicar.length
                  ? `Aprovar ${aPublicar.length} e publicar`
                  : "Marcar como vista"}
              </Botao>
            )}
          </div>
        ) : (
          <Pilula tom={d.estado === "aprovada" ? "verde" : "neutro"}>
            {d.estado === "aprovada"
              ? `Aprovada${d.aprovada_por ? ` por ${d.aprovada_por}` : ""}`
              : d.estado === "ignorada"
                ? `Ignorada${d.aprovada_por ? ` por ${d.aprovada_por}` : ""}`
                : "Por rever"}
          </Pilula>
        )}
      </div>

      {porRever && escrever && !interno && aPublicar.length > 0 && (
        <p className="rounded-xl bg-creme-2 px-3.5 py-2.5 text-[13px] text-tinta-2">
          Publicar as correções preparadas é com a equipa Tou, Câmara?. Pode marcar as que não
          concorda (“Não publicar”) ou ignorar a alteração.
        </p>
      )}
      <ErroPublicacao erro={acao.erro} interno={interno} />
      {interno && eErroDeAvaliacao(acao.erro) && (
        <Botao variante="secundario" tamanho="pequeno" className="w-fit" onClick={() => setForcar(true)}>
          Publicar sem avaliação…
        </Botao>
      )}

      <section className="flex flex-col gap-2 rounded-xl bg-creme px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Rotulo>O que mudou no texto</Rotulo>
          <span className="text-[11px] text-tinta-3">
            {d.anterior_lida_em ? `lida antes a ${dia(d.anterior_lida_em)} · ` : ""}agora a {dia(d.nova_lida_em)}
          </span>
        </div>
        <p className="text-[13px] font-semibold text-tinta">{d.resumo}</p>
        {d.diff?.blocos.length ? (
          <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
            {d.diff.blocos.map((b, i) => (
              <div key={i} className="flex flex-col gap-1 border-t border-linha pt-2">
                <span className="text-[10px] font-bold text-tinta-3">LINHA {b.linha_depois}</span>
                {b.antes.map((l, j) => (
                  <p key={`a${j}`} className="flex gap-2 rounded-lg bg-terracota-suave/40 px-2.5 py-1 text-[13px] text-tinta-2">
                    <span className="font-bold text-terracota-escuro" aria-label="Saiu">−</span>
                    {l}
                  </p>
                ))}
                {b.depois.map((l, j) => (
                  <p key={`d${j}`} className="flex gap-2 rounded-lg bg-verde-suave px-2.5 py-1 text-[13px] text-tinta">
                    <span className="font-bold text-verde" aria-label="Entrou">+</span>
                    {l}
                  </p>
                ))}
              </div>
            ))}
            {d.diff.truncado && <p className="text-xs text-tinta-3">Há mais diferenças na fonte.</p>}
          </div>
        ) : (
          <p className="text-xs text-tinta-3">Sem diferenças guardadas.</p>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <Rotulo>
          Respostas afetadas{propostas.length ? " · já preparámos a correção" : ""}
        </Rotulo>
        {d.respostas.length ? (
          d.respostas.map((r) => {
            const naoPublicar = rejeitar.includes(r.resposta_id);
            return (
              <article key={r.resposta_id} className="flex flex-col gap-2 rounded-xl border border-linha p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-bold text-tinta">“{r.pergunta_tipo}”</p>
                  {porRever && escrever && r.estado === "proposta" && r.proposta_versao_id ? (
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-terracota-escuro">
                      <input
                        type="checkbox"
                        checked={naoPublicar}
                        onChange={(e) =>
                          setRejeitar((x) =>
                            e.target.checked ? [...x, r.resposta_id] : x.filter((y) => y !== r.resposta_id),
                          )
                        }
                        className="accent-terracota"
                      />
                      Não publicar
                    </label>
                  ) : (
                    <Pilula tom={r.estado === "aprovada" ? "verde" : r.estado === "rejeitada" ? "neutro" : "ambar"}>
                      {r.estado === "aprovada" ? "publicada" : r.estado === "rejeitada" ? "não publicada" : "por corrigir"}
                    </Pilula>
                  )}
                </div>
                {r.texto_atual && (
                  <p className="flex gap-2 rounded-lg bg-terracota-suave/40 px-2.5 py-1.5 text-[13px] text-tinta-2">
                    <span className="font-bold text-terracota-escuro" aria-label="Agora">−</span>
                    {r.texto_atual}
                  </p>
                )}
                {r.texto_proposto ? (
                  <p className={`flex gap-2 rounded-lg bg-verde-suave px-2.5 py-1.5 text-[13px] text-tinta ${naoPublicar ? "opacity-50" : ""}`}>
                    <span className="font-bold text-verde" aria-label="Proposta">+</span>
                    {r.texto_proposto}
                  </p>
                ) : (
                  <p className="text-xs text-ambar">Ainda sem correção proposta: reveja a resposta à mão.</p>
                )}
              </article>
            );
          })
        ) : (
          <p className="text-sm text-tinta-3">Nenhuma resposta do agente cita esta parte da fonte.</p>
        )}
      </section>

      <Dialogo titulo="Publicar sem avaliação" aberto={forcar} onFechar={() => setForcar(false)}>
        <p className="text-sm text-tinta-2">
          As correções vão para o ar sem uma avaliação do agente que passe o mínimo. Fica registado
          na auditoria.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="discreto" onClick={() => setForcar(false)}>
            Cancelar
          </Botao>
          <Botao disabled={acao.aCorrer} onClick={() => aprovar(true)}>
            Publicar na mesma
          </Botao>
        </div>
      </Dialogo>
    </Cartao>
  );
}

function Contradicoes() {
  const { pedido, pode } = useSessao();
  const [estado, setEstado] = useState<"aberta" | "avisada" | "resolvida">("aberta");
  const base = `/v1/painel/conhecimento/contradicoes?limite=20&estado=${estado}`;
  const lista = useDados<Pagina<Contradicao>>(base);
  const mais = useMais(base, lista);
  const acao = useAcao();
  const escrever = pode("conhecimento");

  const mudar = async (c: Contradicao, corpo: Record<string, string>) => {
    const r = await acao.executar(() =>
      pedido<Omit<Contradicao, "a" | "b">>(`/v1/painel/conhecimento/contradicoes/${c.id}`, {
        metodo: "PATCH",
        corpo,
      }),
    );
    if (r) {
      if (r.estado !== estado) lista.recarregar();
      else lista.mudar((d) => ({ ...d, itens: d.itens.map((x) => (x.id === c.id ? { ...x, ...r } : x)) }));
    }
  };

  return (
    <Cartao id="contradicoes" className="flex scroll-mt-6 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="size-5 text-ambar" aria-hidden />
          <h2 className="font-display text-xl font-bold text-tinta">Informação contraditória</h2>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Estado">
          {(["aberta", "avisada", "resolvida"] as const).map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={estado === e}
              onClick={() => setEstado(e)}
              className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
                estado === e ? "border-tinta bg-tinta text-white" : "border-linha bg-creme text-tinta-2"
              }`}
            >
              {e === "aberta" ? "Abertas" : e === "avisada" ? "Avisadas" : "Resolvidas"}
            </button>
          ))}
        </div>
      </div>
      <ErroLinha erro={acao.erro} />
      <Estado
        aCarregar={lista.aCarregar}
        erro={lista.erro}
        vazio={!lista.dados?.itens.length}
        textoVazio="Nenhuma contradição neste estado."
      >
        <ul className="grid gap-4 lg:grid-cols-2">
          {lista.dados?.itens.map((c) => (
            <li key={c.id} className="flex flex-col gap-2.5 rounded-xl border border-linha p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-tinta">{c.assunto}</p>
                <span className="text-[11px] text-tinta-3">{dia(c.detetada_em)}</span>
              </div>
              {(["a", "b"] as const).map((l) => {
                const lado = c[l];
                const usar = c.usar === l;
                return (
                  <div
                    key={l}
                    className={`flex flex-col gap-1 rounded-[10px] px-3 py-2.5 ${usar ? "bg-verde-suave" : c.usar ? "bg-terracota-suave/50" : "bg-creme"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={lado.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-1 text-[11px] font-bold hover:underline ${usar ? "text-verde" : "text-tinta-2"}`}
                      >
                        {usar && <Check className="size-3" aria-hidden />}
                        {lado.entidade} · {lado.fonte}
                        {lado.referencia ? `, ${lado.referencia}` : ""}
                      </a>
                      {escrever && !usar && (
                        <button
                          type="button"
                          disabled={acao.aCorrer}
                          onClick={() => mudar(c, { usar: l })}
                          className="text-[11px] font-semibold text-terracota-escuro hover:underline"
                        >
                          Usar esta
                        </button>
                      )}
                    </div>
                    <p className="text-[13px] text-tinta">{l === "a" ? c.valor_a : c.valor_b}</p>
                  </div>
                );
              })}
              {escrever && c.estado !== "resolvida" && (
                <div className="flex gap-3 text-xs font-semibold">
                  {c.estado === "aberta" && (
                    <button type="button" className="text-tinta-2 hover:underline" onClick={() => mudar(c, { estado: "avisada" })}>
                      Já avisámos quem a publica
                    </button>
                  )}
                  <button type="button" className="text-verde hover:underline" onClick={() => mudar(c, { estado: "resolvida" })}>
                    Resolvida
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {mais.haMais && (
          <Botao variante="discreto" tamanho="pequeno" className="w-fit" onClick={mais.mais} disabled={mais.aCorrer}>
            Ver mais
          </Botao>
        )}
      </Estado>
    </Cartao>
  );
}

export function Alteracoes() {
  const porRever = useDados<Pagina<AlteracaoResumo>>("/v1/painel/conhecimento/alteracoes?estado=por_rever&limite=50");
  const anteriores = useDados<Pagina<AlteracaoResumo>>("/v1/painel/conhecimento/alteracoes?limite=10");
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const abertas = porRever.dados?.itens ?? [];
  const revistas = (anteriores.dados?.itens ?? []).filter((a) => a.estado !== "por_rever");
  const atual = escolhida ?? abertas[0]?.id ?? revistas[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-6 px-4 sm:px-10">
      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-2.5" aria-label="Alterações">
          <Rotulo>Por rever</Rotulo>
          <Estado aCarregar={porRever.aCarregar} erro={porRever.erro} vazio={!abertas.length} textoVazio="Nada por rever: as fontes estão em dia.">
            {abertas.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setEscolhida(a.id)}
                aria-current={a.id === atual ? "true" : undefined}
                className={`flex flex-col gap-2 rounded-[14px] border p-4 text-left ${
                  a.id === atual ? "border-terracota bg-papel" : "border-linha bg-creme hover:bg-papel"
                }`}
              >
                <span className="text-sm font-bold text-tinta">{a.fonte}</span>
                <span className="text-[13px] text-tinta-2">
                  {a.resumo} · {dia(a.detetada_em)}
                </span>
                {a.respostas_afetadas > 0 && (
                  <Pilula tom="ambar" icone={TriangleAlert} className="w-fit">
                    {a.respostas_afetadas} {a.respostas_afetadas === 1 ? "resposta afetada" : "respostas afetadas"}
                  </Pilula>
                )}
              </button>
            ))}
          </Estado>
          {revistas.length > 0 && (
            <>
              <Rotulo className="mt-2">Anteriores</Rotulo>
              {revistas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setEscolhida(a.id)}
                  aria-current={a.id === atual ? "true" : undefined}
                  className={`flex flex-col gap-0.5 rounded-xl px-4 py-2.5 text-left ${a.id === atual ? "bg-papel" : "hover:bg-papel/60"}`}
                >
                  <span className="text-[13px] font-semibold text-tinta-2">{a.fonte}</span>
                  <span className="text-xs text-tinta-3">
                    {dia(a.detetada_em)} · {a.estado === "aprovada" ? "aprovada" : "ignorada"}
                    {a.aprovada_por ? ` por ${a.aprovada_por}` : ""}
                  </span>
                </button>
              ))}
            </>
          )}
        </nav>

        {atual ? (
          <Detalhe
            key={atual}
            id={atual}
            onMudou={() => {
              porRever.recarregar();
              anteriores.recarregar();
            }}
          />
        ) : (
          !porRever.aCarregar && (
            <Cartao className="p-6 text-sm text-tinta-2">
              Quando uma fonte oficial mudar, mostramos aqui o que mudou e as respostas do agente a
              corrigir.
            </Cartao>
          )
        )}
      </div>

      <Contradicoes />
    </div>
  );
}
