"use client";

import { Check, ChevronDown, Mic, Play, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  Cartao,
  dia,
  ErroLinha,
  Estado,
  numero,
  pct,
  Pilula,
  quando,
  Rotulo,
  useAcao,
  useDados,
} from "./comum";
import type { Qualidade as TQualidade } from "./tipos";

const CAUSAS: Record<string, string> = {
  sem_execucao: "Ainda não há nenhuma avaliação terminada do agente.",
  outra_versao: "A última avaliação não é da versão atual do agente.",
  por_avaliar: "A última avaliação ainda tem respostas por avaliar.",
  abaixo: "A última avaliação ficou abaixo do mínimo.",
};

function Barra({ valor, limiar }: { valor: number | null; limiar: number }) {
  return (
    <span className="h-2 w-[90px] overflow-hidden rounded bg-creme-2" aria-hidden>
      <span
        className={`block h-full rounded ${valor !== null && valor >= limiar ? "bg-verde" : "bg-ambar"}`}
        style={{ width: `${Math.max(0, Math.min(100, valor ?? 0))}%` }}
      />
    </span>
  );
}

const ESTADO_PEDIDO: Record<string, { rotulo: string; tom: "ambar" | "verde" | "terracota" | "neutro" }> = {
  pendente: { rotulo: "à espera do avaliador", tom: "ambar" },
  a_correr: { rotulo: "a correr", tom: "ambar" },
  terminado: { rotulo: "terminado", tom: "verde" },
  falhou: { rotulo: "falhou", tom: "terracota" },
};
const MOTIVO_PEDIDO: Record<string, string> = {
  manual: "pedido no painel",
  ingestao: "fontes mudaram",
  mudanca_agente: "versão nova do agente",
};

/** "Correr teste agora" e os pedidos ao avaliador (o avaliador corre à parte). */
function CorrerTeste({ d, onPedido }: { d: TQualidade; onPedido: () => void }) {
  const { pedido, pode } = useSessao();
  const acao = useAcao();
  const ultimo = d.pedidos[0];
  const emCurso = ultimo && (ultimo.estado === "pendente" || ultimo.estado === "a_correr");
  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Rotulo>Testar agora</Rotulo>
          <p className="text-[13px] text-tinta-2">
            O avaliador faz as perguntas ao agente e o juiz avalia cada resposta. Demora alguns minutos; o resultado
            aparece aqui.
          </p>
        </div>
        {pode("conhecimento") && (
          <Botao
            icone={Play}
            disabled={acao.aCorrer || !!emCurso}
            onClick={async () => {
              const r = await acao.executar(() =>
                pedido("/v1/painel/conhecimento/qualidade/correr", { metodo: "POST", corpo: {} }),
              );
              if (r !== undefined) onPedido();
            }}
          >
            {emCurso ? "Teste pedido" : "Correr teste agora"}
          </Botao>
        )}
      </div>
      <ErroLinha erro={acao.erro} />
      {d.pedidos.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-linha pt-3">
          {d.pedidos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-[13px]">
              <Pilula tom={ESTADO_PEDIDO[p.estado]?.tom ?? "neutro"}>{ESTADO_PEDIDO[p.estado]?.rotulo ?? p.estado}</Pilula>
              <span className="text-tinta">{MOTIVO_PEDIDO[p.motivo] ?? p.motivo}</span>
              {p.amostra && <span className="text-tinta-3">· amostra</span>}
              <span className="text-tinta-3">· {quando(p.criado_em)}</span>
              {p.erro && <span className="w-full text-xs text-terracota-escuro">{p.erro}</span>}
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

/**
 * Valores (€, prazos, horas, telefones, %) que o agente disse no último teste
 * e que não estão na pergunta nem no gabarito escrito a partir das fontes.
 */
function NumerosSemFonte({ n }: { n: NonNullable<TQualidade["numeros"]> }) {
  const zero = n.numeros_sem_fonte === 0;
  return (
    <Cartao className="flex flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${zero ? "bg-verde-suave" : "bg-ambar-suave"}`}
        >
          {zero ? (
            <Check className="size-4 text-verde" aria-hidden />
          ) : (
            <TriangleAlert className="size-4 text-ambar" aria-hidden />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-display text-[19px] font-bold text-tinta">
            {numero(n.numeros_sem_fonte)} {n.numeros_sem_fonte === 1 ? "número inventado" : "números inventados"}
          </h2>
          <p className="text-[13px] text-tinta-2">
            Em {numero(n.respostas)} respostas do último teste, {numero(n.com_numeros)} dão valores (taxas, prazos,
            horários, telefones).{" "}
            {zero
              ? "Todos estão nas fontes oficiais."
              : `${numero(n.com_numeros_sem_fonte)} (${pct(n.percentagem, 1)}) dizem pelo menos um que não está na fonte.`}
          </p>
        </div>
      </div>
      {n.exemplos.length > 0 && (
        <ul className="flex flex-col">
          {n.exemplos.map((e) => (
            <li key={e.resposta_id} className="flex flex-col gap-0.5 border-t border-linha py-2.5">
              <span className="text-[13px] font-semibold text-tinta">“{e.pergunta}”</span>
              <span className="text-xs text-tinta-2">
                Sem fonte: <b className="text-tinta">{e.numeros.join(", ")}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

export function Qualidade() {
  const q = useDados<TQualidade>("/v1/painel/conhecimento/qualidade");
  const [aberta, setAberta] = useState<string | null>(null);

  if (q.erro || !q.dados) {
    return (
      <div className="px-4 sm:px-10">
        <Cartao>
          <Estado aCarregar={q.aCarregar} erro={q.erro} />
        </Cartao>
      </div>
    );
  }
  const d = q.dados;
  const u = d.ultima;
  const evolucao = d.evolucao.slice(-8);
  const bem = u ? (u.certas ?? 0) + (u.passadas_bem ?? 0) : 0;

  return (
    <div className="flex flex-col gap-5 px-4 sm:px-10">
      <div className="flex flex-wrap items-center gap-3.5 rounded-[14px] bg-terracota-suave px-[18px] py-3.5">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[16px_16px_16px_4px] bg-terracota font-display text-[17px] font-extrabold text-white"
          aria-hidden
        >
          ?
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-bold text-terracota-escuro">
            Nada vai para o ar abaixo de {d.limiar}%.
          </p>
          <p className="text-[13px] text-tinta-2">
            Antes de publicar uma resposta, o agente é avaliado
            {u ? ` com ${numero(u.perguntas)} perguntas` : ""}. Se a taxa descer, a alteração fica
            parada.
            {d.versao_atual ? ` Versão atual do agente: ${d.versao_atual}.` : ""}
          </p>
        </div>
        {d.publicacao.pode_publicar ? (
          <Pilula tom="verde" icone={Check}>
            Pode publicar
          </Pilula>
        ) : (
          <Pilula tom="ambar" icone={TriangleAlert}>
            {CAUSAS[d.publicacao.causa ?? ""] ?? "Não pode publicar agora"}
          </Pilula>
        )}
      </div>

      <CorrerTeste d={d} onPedido={q.recarregar} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex flex-col gap-3 rounded-2xl bg-tinta p-6">
          <p className="text-[11px] font-bold tracking-[0.4px] text-white/60 uppercase">
            Teste de qualidade · {u ? quando(u.terminada_em) : "ainda sem teste"}
          </p>
          {u?.demonstracao && (
            <p className="text-xs text-white/70">
              Resultados de demonstração (câmara de demonstração), não a taxa medida do agente.
            </p>
          )}
          <p className="font-display text-[72px] leading-none font-bold text-white">
            {u ? pct(u.taxa, 1) : "—"}
          </p>
          <p className="text-[13px] text-white/80">
            {u
              ? `${numero(bem)} de ${numero(u.total)} perguntas certas ou maioritariamente certas (escala por categorias, dois juízes). Mínimo para ir ao ar: ${d.limiar}%.`
              : "Quando a equipa Tou, Câmara? correr o avaliador, o resultado aparece aqui."}
          </p>
          {u && (
            <span
              className={`flex w-fit items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-bold text-white ${u.passou ? "bg-verde" : "bg-ambar"}`}
            >
              {u.passou ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
              {u.passou ? "Acima do mínimo" : "Abaixo do mínimo"}
            </span>
          )}
          {d.voz && (
            <div className="mt-auto flex items-center gap-2 border-t border-white/15 pt-3 text-xs text-white/80">
              <Mic className="size-3.5" aria-hidden />
              Voz: {pct(d.voz.taxa, 1)}
              {d.voz.latencia_media_ms != null &&
                ` · responde em ${numero(d.voz.latencia_media_ms / 1000, 1)} s`}
              {d.voz.amostra ? " · amostra" : ""}
            </div>
          )}
        </section>

        <Cartao className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[19px] font-bold text-tinta">Evolução</h2>
            <p className="text-[13px] text-tinta-2">
              Cada mudança no agente só vai para o ar se passar os {d.limiar}%.
            </p>
          </div>
          {evolucao.length ? (
            <ol className="flex h-[170px] items-end gap-[18px]" aria-label="Taxa de cada avaliação">
              {evolucao.map((e) => (
                <li key={e.execucao_id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                  <span className={`text-xs font-bold ${e.passou ? "text-tinta" : "text-ambar"}`}>
                    {pct(e.taxa)}
                  </span>
                  <span
                    className={`w-full rounded-t-lg ${e.passou ? "bg-terracota" : "bg-ambar-suave"}`}
                    style={{ height: `${Math.max(4, (e.taxa ?? 0) * 1.1)}px` }}
                    aria-hidden
                  />
                  <span className="text-[11px] text-tinta-3">{dia(e.terminada_em)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-tinta-3">Ainda não há avaliações.</p>
          )}
        </Cartao>
      </div>

      {d.numeros && <NumerosSemFonte n={d.numeros} />}

      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Cartao className="flex flex-col p-6">
          <h2 className="pb-2.5 font-display text-[19px] font-bold text-tinta">Por tema</h2>
          {u?.categorias.length ? (
            <ul>
              {u.categorias.map((c) => (
                <li key={c.categoria} className="flex items-center gap-2.5 border-t border-linha py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-tinta">{c.categoria}</span>
                  <Barra valor={c.taxa} limiar={d.limiar} />
                  <span
                    className={`w-10 text-right text-[13px] font-bold ${c.taxa !== null && c.taxa >= d.limiar ? "text-tinta" : "text-ambar"}`}
                  >
                    {pct(c.taxa)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-tinta-3">Sem resultados por tema.</p>
          )}
        </Cartao>

        <Cartao className="flex flex-col p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
            <h2 className="font-display text-[19px] font-bold text-tinta">Respostas erradas a corrigir</h2>
            <Pilula>{d.erradas.length} no último teste</Pilula>
          </div>
          {d.erradas.length ? (
            <ul>
              {d.erradas.map((e) => {
                const aberto = aberta === e.resposta_id;
                return (
                  <li key={e.resposta_id} className="border-t border-linha py-3">
                    <button
                      type="button"
                      aria-expanded={aberto}
                      onClick={() => setAberta(aberto ? null : e.resposta_id)}
                      className="flex w-full items-start gap-3 text-left"
                    >
                      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-terracota-suave">
                        <X className="size-3.5 text-terracota-escuro" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[13px] font-semibold text-tinta">“{e.pergunta}”</span>
                        <span className="text-xs text-tinta-2">
                          {e.justificacao ?? (e.veredicto === "sem_resposta" ? "Não respondeu." : "Resposta errada.")}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Pilula tom={e.veredicto === "errada" ? "terracota" : "ambar"} className="text-[11px]">
                          {e.veredicto === "errada" ? "Errada" : "Sem resposta"}
                        </Pilula>
                        <span className="flex items-center gap-1 text-[11px] text-tinta-3">
                          {e.categoria ?? "—"}
                          <ChevronDown className={`size-3 ${aberto ? "rotate-180" : ""}`} aria-hidden />
                        </span>
                      </span>
                    </button>
                    {aberto && (
                      <div className="mt-2 ml-[38px] grid gap-2 md:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <Rotulo>O agente disse</Rotulo>
                          <p className="rounded-lg bg-terracota-suave/40 p-2.5 text-[13px] text-tinta">
                            {e.resposta ?? "—"}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Rotulo>Devia dizer (gabarito)</Rotulo>
                          <p className="rounded-lg bg-verde-suave p-2.5 text-[13px] text-tinta">
                            {e.gabarito ?? e.comportamento ?? "—"}
                          </p>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-tinta-3">
              {u ? "Nenhuma resposta errada no último teste." : "Ainda não há testes."}
            </p>
          )}
        </Cartao>
      </div>
    </div>
  );
}
