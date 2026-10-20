"use client";

import { ArrowUp, Check, ChevronDown, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ErroApi, sse } from "@/lib/api";
import { municipioEscolhido, useSessao } from "@/lib/sessao";
import { useDados } from "./dados";
import { decimal, mensagemErro, numero } from "./formatos";
import type { ConsultaPublica, RespostaPergunta, Valor } from "./tipos";

/* "Pergunte ao painel": perguntas da chefia em linguagem normal (SSE). */

const CONSULTAS: Record<string, string> = {
  indicadores_periodo: "indicadores do atendimento",
  conversas: "conversas",
  temas_mais_perguntados: "temas mais perguntados",
  perguntas_sem_resposta: "perguntas sem resposta",
  sms_enviados: "SMS enviados",
  melhorias_portal: "melhorias ao portal",
  contar_ocorrencias: "contagem de ocorrências",
  listar_ocorrencias: "lista de ocorrências",
  pagamentos: "pagamentos",
  marcacoes: "marcações",
  contar_processos: "contagem de processos",
  listar_processos: "lista de processos",
  tempos_processos: "tempos dos processos",
  carga_tecnicos: "carga dos técnicos",
};

const rotuloConsulta = (f: string) => CONSULTAS[f] ?? f.replace(/_/g, " ");

function valor(v: Valor, unidade?: string | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") {
    const n = Number.isInteger(v) ? numero(v) : decimal(v, 1);
    if (!unidade) return n;
    return unidade === "%" ? `${n}%` : unidade === "€" ? `${n} €` : `${n} ${unidade}`;
  }
  return v;
}

interface ConsultaViva {
  id: string;
  ferramenta: string;
  feita: boolean;
  erro?: string | null;
}

type Estado =
  | { fase: "parado" }
  | { fase: "a_pensar"; pergunta: string; consultas: ConsultaViva[]; texto?: string }
  | { fase: "feito"; resposta: RespostaPergunta }
  | { fase: "erro"; pergunta: string; mensagem: string };

export function Perguntar() {
  const { token } = useSessao();
  const sugestoes = useDados<{ sugestoes: string[] }>("/v1/painel/perguntar/sugestoes");
  const [pergunta, setPergunta] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });
  const controlo = useRef<AbortController | null>(null);

  useEffect(() => () => controlo.current?.abort(), []);

  async function perguntar(texto: string) {
    const q = texto.trim();
    if (q.length < 3) return;
    controlo.current?.abort();
    const c = new AbortController();
    controlo.current = c;
    setPergunta(q);
    setEstado({ fase: "a_pensar", pergunta: q, consultas: [] });
    try {
      for await (const ev of sse("/v1/painel/perguntar/stream", {
        corpo: { pergunta: q },
        token,
        municipio: municipioEscolhido(),
        sinal: c.signal,
      })) {
        if (c.signal.aborted) return;
        const d = ev.dados as Record<string, unknown>;
        if (ev.evento === "consulta") {
          setEstado((e) => {
            if (e.fase !== "a_pensar") return e;
            const id = String(d.id);
            const resto = e.consultas.filter((x) => x.id !== id);
            return {
              ...e,
              consultas: [
                ...resto,
                {
                  id,
                  ferramenta: String(d.ferramenta ?? ""),
                  feita: d.estado === "feita",
                  erro: (d.erro as string | null) ?? null,
                },
              ].sort((a, b) => a.id.localeCompare(b.id, "pt", { numeric: true })),
            };
          });
        } else if (ev.evento === "texto") {
          setEstado((e) => (e.fase === "a_pensar" ? { ...e, texto: String(d.texto ?? "") } : e));
        } else if (ev.evento === "fim") {
          setEstado({ fase: "feito", resposta: d as unknown as RespostaPergunta });
        } else if (ev.evento === "erro") {
          setEstado({
            fase: "erro",
            pergunta: q,
            mensagem: String(d.mensagem ?? "Não foi possível responder."),
          });
        }
      }
    } catch (e) {
      if (c.signal.aborted) return;
      setEstado({
        fase: "erro",
        pergunta: q,
        mensagem: e instanceof ErroApi ? e.message : mensagemErro(e),
      });
    }
  }

  const aPensar = estado.fase === "a_pensar";
  const lista = sugestoes.dados?.sugestoes ?? [];

  return (
    <section
      aria-labelledby="perguntar-titulo"
      className="flex flex-col gap-4 rounded-2xl bg-tinta p-6 text-white"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="perguntar-titulo"
          className="flex items-center gap-2 font-display text-xl font-bold tracking-[-0.3px]"
        >
          <Sparkles className="size-[18px] text-[#E07A55]" aria-hidden />
          Pergunte ao painel
        </h2>
        <p className="text-[13px] text-white/70">
          Em linguagem normal. A resposta sai dos dados da câmara, com o cálculo à vista.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          perguntar(pergunta);
        }}
        className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-5 pr-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#E07A55]"
      >
        <label htmlFor="pergunta" className="sr-only">
          A sua pergunta
        </label>
        <input
          id="pergunta"
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          maxLength={500}
          placeholder="Ex.: Quantos processos de obras estão atrasados?"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-tinta outline-none placeholder:text-tinta-3"
        />
        <button
          type="submit"
          disabled={aPensar || pergunta.trim().length < 3}
          aria-label="Perguntar"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-terracota text-white hover:bg-terracota-escuro disabled:opacity-50"
        >
          {aPensar ? (
            <LoaderCircle className="size-[18px] animate-spin" aria-hidden />
          ) : (
            <ArrowUp className="size-[18px]" aria-hidden />
          )}
        </button>
      </form>

      {estado.fase === "parado" && lista.length > 0 && (
        <Sugestoes lista={lista.slice(0, 5)} escolher={perguntar} />
      )}

      <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">
        {estado.fase === "a_pensar" && (
          <div className="flex flex-col gap-2 rounded-xl bg-white/7 p-4">
            <p className="text-[13px] text-white/70">“{estado.pergunta}”</p>
            {estado.consultas.length === 0 && (
              <p className="flex items-center gap-2 text-[13px] text-white/80">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />A perceber a pergunta…
              </p>
            )}
            {estado.consultas.map((c) => (
              <p key={c.id} className="flex items-center gap-2 text-[13px] text-white/80">
                {c.feita ? (
                  c.erro ? (
                    <TriangleAlert className="size-3.5 text-[#F2B49B]" aria-hidden />
                  ) : (
                    <Check className="size-3.5 text-[#9FD3A8]" aria-hidden />
                  )
                ) : (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                )}
                {c.feita ? "Consultei" : "A consultar"}: {rotuloConsulta(c.ferramenta)}
              </p>
            ))}
            {estado.texto && <p className="pt-1 text-[15px] leading-normal">{estado.texto}</p>}
          </div>
        )}

        {estado.fase === "erro" && (
          <div role="alert" className="flex flex-col gap-1 rounded-xl bg-white/7 p-4">
            <p className="text-[13px] text-white/70">“{estado.pergunta}”</p>
            <p className="text-[15px] text-[#F2B49B]">{estado.mensagem}</p>
          </div>
        )}

        {estado.fase === "feito" && (
          <Resposta r={estado.resposta} perguntar={perguntar} />
        )}
      </div>
    </section>
  );
}

function Sugestoes({ lista, escolher }: { lista: string[]; escolher: (s: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Sugestões">
      {lista.map((s) => (
        <li key={s}>
          <button
            type="button"
            onClick={() => escolher(s)}
            className="rounded-2xl border border-white/20 px-3 py-1.5 text-left text-xs text-white/85 hover:border-white/50 hover:bg-white/5"
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Resposta({ r, perguntar }: { r: RespostaPergunta; perguntar: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-papel p-5 text-tinta">
      <p className="text-[13px] text-tinta-3">“{r.pergunta}”</p>
      <p className="text-base leading-normal whitespace-pre-line">{r.resposta}</p>
      {!r.texto_verificado && (
        <p className="flex items-center gap-1.5 text-xs text-ambar">
          <TriangleAlert className="size-3.5" aria-hidden />O texto foi ajustado para usar só os números
          calculados.
        </p>
      )}

      {r.numeros_chave.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {r.numeros_chave.map((n) => (
            <div
              key={`${n.consulta}-${n.rotulo}`}
              className="flex flex-col-reverse gap-1 rounded-xl border border-linha bg-creme/50 p-3.5"
            >
              <dt className="text-xs leading-[1.35] text-tinta-2">{n.rotulo}</dt>
              <dd className="font-display text-[26px] font-bold tracking-[-0.6px] text-tinta">
                {valor(n.valor, n.unidade)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {r.tabela && r.tabela.linhas.length > 0 && <Tabela t={r.tabela} />}

      {r.consultas.length > 0 && <ComoFoiCalculado consultas={r.consultas} ms={r.ms} />}

      {r.sugestoes.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-linha pt-3">
          <p className="text-[11px] font-bold tracking-[1px] text-tinta-3">PODE PERGUNTAR A SEGUIR</p>
          <ul className="flex flex-wrap gap-2">
            {r.sugestoes.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => perguntar(s)}
                  className="rounded-2xl border border-linha bg-papel px-3 py-1.5 text-left text-xs text-tinta-2 hover:border-tinta hover:text-tinta"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tabela({ t }: { t: NonNullable<RespostaPergunta["tabela"]> }) {
  const base = t.objeto === "processo" ? "/painel/processos/" : t.objeto === "ocorrencia" ? "/painel/ocorrencias/" : null;
  return (
    <div className="overflow-x-auto rounded-xl border border-linha">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-creme/60">
          <tr>
            {t.colunas.map((c) => (
              <th
                key={c.chave}
                scope="col"
                className="px-3 py-2 text-left text-[11px] font-bold tracking-[0.6px] text-tinta-3 uppercase"
              >
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.linhas.map((l, i) => {
            const id = typeof l.id === "string" ? l.id : null;
            return (
              <tr key={id ?? i} className="border-t border-linha">
                {t.colunas.map((c, k) => (
                  <td key={c.chave} className="px-3 py-2 text-tinta">
                    {k === 0 && base && id ? (
                      <Link href={`${base}${id}`} className="font-semibold text-terracota-escuro hover:underline">
                        {valor(l[c.chave])}
                      </Link>
                    ) : (
                      valor(l[c.chave])
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {t.total_linhas > t.linhas.length && (
        <p className="border-t border-linha px-3 py-2 text-xs text-tinta-3">
          A mostrar {numero(t.linhas.length)} de {numero(t.total_linhas)}.
        </p>
      )}
    </div>
  );
}

function ComoFoiCalculado({ consultas, ms }: { consultas: ConsultaPublica[]; ms: number }) {
  return (
    <details className="group rounded-xl border border-linha">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-semibold text-tinta">
        Como foi calculado
        <span className="flex items-center gap-2 text-xs font-normal text-tinta-3">
          {consultas.length} {consultas.length === 1 ? "consulta" : "consultas"} ·{" "}
          {decimal(ms / 1000, 1)} s
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <ol className="flex flex-col gap-3 border-t border-linha px-4 py-3">
        {consultas.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 text-[13px]">
            <p className="font-semibold text-tinta">
              {c.id} · {rotuloConsulta(c.ferramenta)}
              <span className="font-normal text-tinta-3">
                {" "}
                · {numero(c.linhas_devolvidas)} {c.linhas_devolvidas === 1 ? "linha" : "linhas"}
              </span>
            </p>
            {c.fonte && <p className="text-xs text-tinta-2">Fonte: {c.fonte}</p>}
            {c.filtros && Object.keys(c.filtros).length > 0 && (
              <p className="text-xs text-tinta-2">
                Filtros:{" "}
                {Object.entries(c.filtros)
                  .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                  .join(" · ")}
              </p>
            )}
            {c.notas.map((n) => (
              <p key={n} className="text-xs text-tinta-3">
                {n}
              </p>
            ))}
            {c.erro && <p className="text-xs text-terracota-escuro">{c.erro}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}
