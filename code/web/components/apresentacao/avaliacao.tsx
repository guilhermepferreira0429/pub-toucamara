"use client";

import { ArrowLeft, ChevronDown, ClipboardCheck, ExternalLink, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MUNICIPIO } from "@/components/chamada/config";
import { api } from "@/lib/api";
import { TopoApresentacao } from "./topo";

/*
 * A avaliação, pergunta a pergunta (GET /v1/public/avaliacao/:municipio):
 * a taxa de acerto, por tema, a comparação com a assistente do site nas
 * mesmas perguntas e cada pergunta com a resposta dada, a resposta certa,
 * a fonte e o veredicto do juiz. Sem resultados, não mostra números.
 */

type Veredicto = "certa" | "passada_bem" | "parcial" | "errada" | "sem_resposta";

interface Resumo {
  terminada_em: string | null;
  total: number;
  certas: number;
  incompletas?: number;
  passadas_bem: number;
  erradas: number;
  sem_resposta: number;
  por_avaliar: number;
  taxa: number | null;
}

interface Pergunta {
  ordem: number;
  categoria: string;
  pergunta: string;
  comportamento: string;
  resposta: string | null;
  veredicto: Veredicto | null;
  justificacao: string | null;
  factos_em_falta: string[];
  factos_errados: string[];
  resposta_certa: string | null;
  fontes: { titulo?: string; url?: string }[];
  outro: { resposta: string | null; veredicto: Veredicto | null; justificacao: string | null } | null;
}

interface Dados {
  municipio: { slug: string; nome: string };
  limiar: number;
  outro_nome: string;
  nosso: (Resumo & { passou: boolean }) | null;
  outro: Resumo | null;
  comparacao: {
    perguntas: number;
    nosso: { acertos: number; taxa: number | null };
    outro: { acertos: number; taxa: number | null };
  } | null;
  categorias: { categoria: string; total: number; taxa: number | null }[];
  perguntas: Pergunta[];
}

const VEREDICTO: Record<Veredicto | "por_avaliar", { nome: string; classe: string }> = {
  certa: { nome: "Certa", classe: "bg-verde-suave text-verde" },
  passada_bem: { nome: "Passada a um funcionário", classe: "bg-verde-suave text-verde" },
  parcial: { nome: "Incompleta", classe: "bg-ambar-suave text-ambar" },
  errada: { nome: "Incorreta", classe: "bg-terracota-suave text-terracota-escuro" },
  sem_resposta: { nome: "Sem resposta", classe: "bg-ambar-suave text-ambar" },
  por_avaliar: { nome: "Por avaliar", classe: "bg-creme-2 text-tinta-2" },
};

const ESPERADO: Record<string, string> = {
  responder: "Responder com a informação oficial",
  encaminhar: "Encaminhar para a entidade certa",
  ocorrencia: "Registar uma ocorrência",
  perguntar: "Perguntar o que falta antes de responder",
  passar_humano: "Passar a um funcionário",
  emergencia: "Mandar ligar para o 112",
  fora_ambito: "Dizer que não é assunto da câmara, sem inventar",
  outra_lingua: "Responder na língua da pessoa",
};

type Filtro = "todas" | "acertos" | "incorretas" | "diferencas";

const FILTROS: { id: Filtro; nome: string }[] = [
  { id: "todas", nome: "Todas" },
  { id: "acertos", nome: "Certas" },
  { id: "incorretas", nome: "Incompletas, incorretas ou sem resposta" },
  { id: "diferencas", nome: "Resultados diferentes" },
];

function acertou(v: Veredicto | null | undefined): boolean {
  return v === "certa" || v === "passada_bem";
}

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${Math.round(n)}%`;
}

function data(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" })
    : "";
}

function Pilula({ v }: { v: Veredicto | null }) {
  const p = VEREDICTO[v ?? "por_avaliar"];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[12px] font-bold ${p.classe}`}>
      {p.nome}
    </span>
  );
}

/** "A assistente do site…" a meio de uma frase: só a primeira letra muda (os nomes próprios ficam). */
function minusculaInicial(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function Barra({ rotulo, taxa, cor }: { rotulo: string; taxa: number | null; cor: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[160px] shrink-0 text-[14px] text-tinta-2">{rotulo}</span>
      <span className="h-3 flex-1 overflow-hidden rounded-full bg-creme-2" aria-hidden>
        <span
          className={`block h-full rounded-full ${cor}`}
          style={{ width: `${Math.max(0, Math.min(100, taxa ?? 0))}%` }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-[15px] font-bold tabular-nums text-tinta">{pct(taxa)}</span>
    </div>
  );
}

function Bloco({ titulo, children, tom = "" }: { titulo: string; children: React.ReactNode; tom?: string }) {
  return (
    <div className={`flex flex-col gap-2 rounded-2xl p-4 ${tom}`}>
      <span className="text-[12px] font-bold uppercase tracking-[1px] text-tinta-3">{titulo}</span>
      {children}
    </div>
  );
}

function Texto({ t }: { t: string | null }) {
  return t ? (
    <p className="whitespace-pre-line text-[15px] leading-relaxed text-tinta">{t}</p>
  ) : (
    <p className="text-[15px] italic text-tinta-3">Sem texto.</p>
  );
}

function CartaoPergunta({ p, outroNome, comOutro }: { p: Pergunta; outroNome: string; comOutro: boolean }) {
  return (
    <li>
      <details className="group rounded-3xl border border-linha bg-papel open:shadow-[0_12px_32px_-20px_rgba(21,38,59,0.35)]">
        <summary className="flex cursor-pointer list-none items-start gap-4 p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
          <span className="mt-0.5 w-9 shrink-0 font-display text-[15px] font-bold tabular-nums text-tinta-3">
            {p.ordem}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-[16px] font-semibold leading-snug text-tinta">&ldquo;{p.pergunta}&rdquo;</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-tinta-3">{p.categoria}</span>
              <span className="text-tinta-3" aria-hidden>
                ·
              </span>
              <span className="text-[13px] text-tinta-3">Tou, Câmara?</span>
              <Pilula v={p.veredicto} />
              {comOutro && p.outro && (
                <>
                  <span className="text-[13px] text-tinta-3">Assistente do site</span>
                  <Pilula v={p.outro.veredicto} />
                </>
              )}
            </span>
          </span>
          <ChevronDown
            className="mt-1 size-5 shrink-0 text-tinta-3 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="flex flex-col gap-3 border-t border-linha p-5 sm:p-6">
          <p className="text-[14px] text-tinta-2">
            <span className="font-semibold text-tinta">O que se esperava:</span>{" "}
            {ESPERADO[p.comportamento] ?? p.comportamento}
          </p>
          <div className={`grid gap-3 ${comOutro && p.outro ? "lg:grid-cols-2" : ""}`}>
            <Bloco titulo="Resposta do Tou, Câmara?" tom="bg-creme">
              <Texto t={p.resposta} />
              {p.justificacao && (
                <p className="border-t border-linha pt-2 text-[14px] leading-relaxed text-tinta-2">
                  <span className="font-semibold text-tinta">Juiz:</span> {p.justificacao}
                </p>
              )}
              {(p.factos_em_falta.length > 0 || p.factos_errados.length > 0) && (
                <ul className="flex flex-col gap-1 text-[13px] text-tinta-2">
                  {p.factos_em_falta.map((f) => (
                    <li key={`f-${f}`}>Faltou: {f}</li>
                  ))}
                  {p.factos_errados.map((f) => (
                    <li key={`e-${f}`}>Não estava certo: {f}</li>
                  ))}
                </ul>
              )}
            </Bloco>
            {comOutro && p.outro && (
              <Bloco titulo={`Resposta d${minusculaInicial(outroNome)}`} tom="bg-creme-2/70">
                <Texto t={p.outro.resposta} />
                {p.outro.justificacao && (
                  <p className="border-t border-linha pt-2 text-[14px] leading-relaxed text-tinta-2">
                    <span className="font-semibold text-tinta">Juiz:</span> {p.outro.justificacao}
                  </p>
                )}
              </Bloco>
            )}
          </div>
          {(p.resposta_certa || p.fontes.length > 0) && (
            <Bloco titulo="A resposta certa" tom="bg-verde-suave/60">
              {p.resposta_certa && <Texto t={p.resposta_certa} />}
              {p.fontes.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {p.fontes.map((f, i) => (
                    <li key={`${f.url ?? ""}-${i}`} className="text-[14px]">
                      {f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 font-semibold text-verde underline underline-offset-2"
                        >
                          {f.titulo ?? f.url}
                          <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      ) : (
                        <span className="font-semibold text-verde">{f.titulo}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>
          )}
        </div>
      </details>
    </li>
  );
}

export function PaginaAvaliacao() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [tema, setTema] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let ativo = true;
    api<Dados>(`/v1/public/avaliacao/${encodeURIComponent(MUNICIPIO)}`)
      .then((r) => ativo && setD(r))
      .catch(() => ativo && setErro(true));
    return () => {
      ativo = false;
    };
  }, []);

  const comOutro = !!d?.comparacao;
  const visiveis = useMemo(() => {
    if (!d) return [];
    const q = busca.trim().toLowerCase();
    return d.perguntas.filter((p) => {
      if (tema && p.categoria !== tema) return false;
      if (q && !p.pergunta.toLowerCase().includes(q)) return false;
      if (filtro === "acertos") return acertou(p.veredicto);
      if (filtro === "incorretas")
        return p.veredicto === "errada" || p.veredicto === "sem_resposta" || p.veredicto === "parcial";
      if (filtro === "diferencas")
        return !!p.veredicto && !!p.outro?.veredicto && acertou(p.veredicto) !== acertou(p.outro.veredicto);
      return true;
    });
  }, [d, filtro, tema, busca]);

  const temas = useMemo(() => [...new Set(d?.perguntas.map((p) => p.categoria) ?? [])].sort(), [d]);
  const sem = erro || (d !== null && (!d.nosso || d.nosso.total === 0));

  return (
    <div className="flex min-h-dvh flex-col bg-creme font-body text-tinta">
      <TopoApresentacao
        links={[
          { href: "/", nome: "Início" },
          { href: "/ligar", nome: "Ligar" },
          { href: "/chat", nome: "Chat" },
        ]}
      />
      <main id="conteudo" tabIndex={-1} className="outline-none">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-5 py-12 sm:px-8 lg:py-16">
          <div className="flex max-w-[760px] flex-col gap-4">
            <Link
              href="/#avaliacao"
              className="inline-flex items-center gap-1.5 self-start text-[14px] font-semibold text-terracota"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Voltar à apresentação
            </Link>
            <span className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota">Avaliação</span>
            <h1 className="font-display text-[36px] font-extrabold leading-[1.05] tracking-[-1px] text-tinta sm:text-[48px]">
              A avaliação, pergunta a pergunta
            </h1>
            <p className="text-[17px] leading-relaxed text-tinta-2">
              Perguntas que os munícipes fazem no dia a dia. Para cada uma, a resposta certa foi escrita a partir das
              fontes oficiais e revista por uma pessoa. Dois juízes independentes, às cegas, comparam cada resposta com a
              certa; onde discordam, um terceiro verifica nas fontes oficiais. Passar a um funcionário numa pergunta difícil
              conta como certo; inventar conta como errado.
            </p>
          </div>

          {d === null && !erro ? (
            <div className="h-[220px] animate-pulse rounded-3xl bg-papel/70" aria-hidden />
          ) : sem ? (
            <div className="flex flex-col gap-4 rounded-3xl border border-linha bg-papel p-6 sm:p-8">
              <span className="flex size-11 items-center justify-center rounded-full bg-ambar-suave">
                <ClipboardCheck className="size-5 text-ambar" aria-hidden />
              </span>
              <p className="font-display text-[22px] font-bold leading-tight text-tinta">
                Os resultados aparecem aqui assim que a avaliação terminar.
              </p>
              <p className="max-w-[640px] text-[15px] leading-relaxed text-tinta-2">
                Não pomos um número que não tenha sido medido. Quando a avaliação acabar, esta página mostra a taxa de
                acerto, os resultados por tema, a comparação com a assistente do site e cada pergunta com a resposta dada,
                a resposta certa e o veredicto.
              </p>
            </div>
          ) : (
            d && (
              <>
                <section aria-label="Resultado" className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                  <div className="flex flex-col gap-4 rounded-3xl bg-tinta p-6 text-papel sm:p-8">
                    <span className="text-[13px] font-bold uppercase tracking-[1.2px] text-terracota-suave">
                      Tou, Câmara?
                    </span>
                    <span className="font-display text-[72px] font-extrabold leading-none tracking-[-2px]">
                      {pct(d.nosso!.taxa)}
                    </span>
                    <span className="text-[15px] leading-relaxed text-papel/80">
                      de respostas certas ou maioritariamente certas, em {d.nosso!.total} perguntas julgadas por dois juízes, às cegas
                      {d.nosso!.terminada_em ? `, a ${data(d.nosso!.terminada_em)}` : ""}.
                    </span>
                    <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-white/15 pt-4 text-[14px] sm:grid-cols-4">
                      {(
                        [
                          ["Certas", d.nosso!.certas + d.nosso!.passadas_bem],
                          ["Incompletas", d.nosso!.incompletas ?? 0],
                          ["Incorretas", d.nosso!.erradas],
                          ["Sem resposta", d.nosso!.sem_resposta],
                        ] as const
                      ).map(([n, v]) => (
                        <div key={n} className="flex flex-col">
                          <dt className="text-papel/70">{n}</dt>
                          <dd className="font-display text-[22px] font-bold">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="flex flex-col gap-6 rounded-3xl border border-linha bg-papel p-6 sm:p-8">
                    {d.comparacao ? (
                      <div className="flex flex-col gap-3">
                        <p className="text-[15px] font-semibold text-tinta">
                          Nas mesmas {d.comparacao.perguntas} perguntas, com os mesmos juízes, o Tou, Câmara? e{" "}
                          {minusculaInicial(d.outro_nome)}:
                        </p>
                        <Barra rotulo="Tou, Câmara?" taxa={d.comparacao.nosso.taxa} cor="bg-verde" />
                        <Barra rotulo="Assistente do site" taxa={d.comparacao.outro.taxa} cor="bg-tinta-3" />
                      </div>
                    ) : (
                      <p className="text-[15px] leading-relaxed text-tinta-2">
                        A comparação com {minusculaInicial(d.outro_nome)} aparece aqui quando as mesmas perguntas lhe
                        forem feitas.
                      </p>
                    )}
                    {d.categorias.length > 0 && (
                      <div className="flex flex-col gap-3 border-t border-linha pt-5">
                        <p className="text-[15px] font-semibold text-tinta">Por tema</p>
                        {d.categorias.map((c) => (
                          <Barra
                            key={c.categoria}
                            rotulo={`${c.categoria} (${c.total})`}
                            taxa={c.taxa}
                            cor={c.taxa !== null && c.taxa >= d.limiar ? "bg-verde" : "bg-ambar"}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section aria-labelledby="perguntas-titulo" className="flex flex-col gap-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <h2
                      id="perguntas-titulo"
                      className="font-display text-[28px] font-extrabold tracking-[-0.6px] text-tinta"
                    >
                      As perguntas{" "}
                      <span className="text-tinta-3">
                        ({visiveis.length} de {d.perguntas.length})
                      </span>
                    </h2>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <label className="relative flex items-center">
                        <span className="sr-only">Procurar uma pergunta</span>
                        <Search className="pointer-events-none absolute left-3.5 size-4 text-tinta-3" aria-hidden />
                        <input
                          type="search"
                          value={busca}
                          onChange={(e) => setBusca(e.target.value)}
                          placeholder="Procurar uma pergunta"
                          className="min-h-11 w-full rounded-full border border-linha bg-papel pl-10 pr-4 text-[15px] text-tinta placeholder:text-tinta-3 focus:border-terracota focus:outline-none sm:w-[260px]"
                        />
                      </label>
                      <label className="flex">
                        <span className="sr-only">Tema</span>
                        <select
                          value={tema}
                          onChange={(e) => setTema(e.target.value)}
                          className="min-h-11 w-full rounded-full border border-linha bg-papel px-4 text-[15px] text-tinta focus:border-terracota focus:outline-none sm:w-auto"
                        >
                          <option value="">Todos os temas</option>
                          {temas.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Mostrar">
                    {FILTROS.filter((f) => f.id !== "diferencas" || comOutro).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={filtro === f.id}
                        onClick={() => setFiltro(f.id)}
                        className={`min-h-10 rounded-full border px-4 text-[14px] font-semibold transition-colors ${
                          filtro === f.id
                            ? "border-tinta bg-tinta text-papel"
                            : "border-linha bg-papel text-tinta-2 hover:border-tinta"
                        }`}
                      >
                        {f.nome}
                      </button>
                    ))}
                  </div>
                  {visiveis.length === 0 ? (
                    <p className="rounded-3xl border border-dashed border-linha p-6 text-[15px] text-tinta-2">
                      Nenhuma pergunta com estes filtros.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {visiveis.map((p) => (
                        <CartaoPergunta key={p.ordem} p={p} outroNome={d.outro_nome} comOutro={comOutro} />
                      ))}
                    </ul>
                  )}
                </section>

                <p className="max-w-[760px] text-[14px] leading-relaxed text-tinta-3">
                  Como se conta: cada resposta é classificada numa escala de nove categorias, de certa a errada, por dois
                  juízes independentes que não sabem de que assistente é; onde discordam, decide um terceiro que verifica
                  nas fontes oficiais. A taxa é o número de respostas certas ou maioritariamente certas a dividir pelas
                  respostas julgadas. Na comparação contam só as perguntas avaliadas nos dois assistentes. Nas respostas
                  da assistente do site, o nome dela aparece como [nome].
                </p>
              </>
            )
          )}
        </div>
      </main>
    </div>
  );
}
