"use client";

import {
  AlertTriangle,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  FlaskConical,
  HelpCircle,
  type LucideIcon,
  RefreshCw,
  UserCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { diaHora } from "./formatos";
import type {
  EstadoAutomatico,
  Evidencia,
  GrupoVerificacao,
  InfoPerfil,
  OrigemVerificacao,
  PerfilVerificacao,
  Verificacao,
  Verificacoes,
} from "./tipos";
import { ACarregar, BotaoPainel, ErroEmLinha, paraErro, RotuloSeccao } from "./ui";

/*
 * V2 · Apoio ao técnico (tjX6g): o bloco "VERIFICAÇÕES AUTOMÁTICAS", antes
 * das regras aplicáveis. Cada linha tem o ícone do estado (✓ ⚠ ✕ ?), o
 * título, o detalhe e a evidência (o documento abre na folha certa), e diz
 * de onde vem: regra, IA a confirmar ou simulado. O estado também vai em
 * texto (sr-only), não só na cor e no ícone.
 *
 * V4 · análise por tipo de operação: o tipo (ampliação, piscina, muro...)
 * com que se verificou, que o técnico pode mudar; as verificações agrupadas
 * (documentos, PDM, desenhos, sempre o técnico) e a tabela lido × declarado
 * × permitido onde há números.
 */

const ESTADO: Record<
  EstadoAutomatico,
  { icone: LucideIcon; fundo: string; texto: string; dito: string }
> = {
  ok: { icone: Check, fundo: "bg-verde-suave text-verde", texto: "text-tinta-2", dito: "Verificado" },
  atencao: {
    icone: AlertTriangle,
    fundo: "bg-ambar-suave text-ambar",
    texto: "text-ambar",
    dito: "Atenção",
  },
  falha: {
    icone: X,
    fundo: "bg-terracota-suave text-terracota-escuro",
    texto: "text-terracota-escuro",
    dito: "Falha",
  },
  nao_verificavel: {
    icone: HelpCircle,
    fundo: "bg-creme-2 text-tinta-2",
    texto: "text-tinta-2",
    dito: "Não verificável",
  },
};

const ORIGEM: Record<OrigemVerificacao, string> = {
  regra: "regra",
  ia: "IA, a confirmar",
  simulado: "simulado",
};

function Etiqueta({ children, tom }: { children: React.ReactNode; tom: "ia" | "simulado" | "demo" }) {
  const tons = {
    ia: "bg-terracota-suave text-terracota-escuro",
    simulado: "bg-creme-2 text-tinta-2",
    demo: "bg-ambar-suave text-ambar",
  } as const;
  return (
    <span className={`inline-flex rounded-md px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${tons[tom]}`}>
      {children}
    </span>
  );
}

/** Abre o ficheiro do documento num separador novo, na página da evidência. */
function useAbrirDocumento(processoId: string) {
  const { pedidoFicheiro } = useSessao();
  const [erro, setErro] = useState<string | null>(null);
  async function abrir(e: Evidencia) {
    if (!e.documento_id) return;
    setErro(null);
    // A janela abre já (no clique), senão o browser bloqueia-a.
    const janela = window.open("", "_blank");
    try {
      const r = await pedidoFicheiro<unknown>(
        `/v1/painel/processos/${processoId}/documentos/${e.documento_id}/ficheiro`,
      );
      if (r.tipo !== "ficheiro") throw new Error("O documento não veio como ficheiro.");
      const url = URL.createObjectURL(r.blob);
      const alvo = e.pagina ? `${url}#page=${e.pagina}` : url;
      if (janela) janela.location.href = alvo;
      else window.location.href = alvo;
    } catch (x) {
      janela?.close();
      setErro(paraErro(x).message);
    }
  }
  return { abrir, erro };
}

function LinkEvidencia({
  e,
  abrir,
  children,
  semIcone = false,
}: {
  e: Evidencia;
  abrir: (e: Evidencia) => void;
  children?: React.ReactNode;
  semIcone?: boolean;
}) {
  const texto = children ?? e.rotulo;
  if (e.tipo === "documento" && e.documento_id) {
    return (
      <button
        type="button"
        onClick={() => abrir(e)}
        className="inline-flex items-center gap-1 text-left underline decoration-linha underline-offset-2 hover:decoration-current"
        aria-label={`Abrir ${e.rotulo}${e.pagina ? ` na página ${e.pagina}` : ""} (nova janela)`}
      >
        {!semIcone && <FileText className="size-3 shrink-0" aria-hidden />}
        {texto}
      </button>
    );
  }
  if (e.url) {
    return (
      <a
        href={e.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 underline decoration-linha underline-offset-2 hover:decoration-current"
      >
        {texto}
        <ExternalLink className="size-3 shrink-0" aria-hidden />
        <span className="sr-only">(nova janela)</span>
      </a>
    );
  }
  return <span>{texto}</span>;
}

function LinhaVerificacao({ v, abrir }: { v: Verificacao; abrir: (e: Evidencia) => void }) {
  const e = ESTADO[v.estado];
  const Icone = e.icone;
  // Quando o detalhe é a própria evidência ("Projeto, folha 3"), o detalhe é o link.
  const detalheEEvidencia = v.evidencias.length > 0 && v.evidencias[0].rotulo === v.detalhe;
  // As regras sem link (a zona do PDM, a lista do tipo) ficam no título da linha.
  const outras = (detalheEEvidencia ? v.evidencias.slice(1) : v.evidencias).filter(
    (x) => x.tipo === "documento" || x.url,
  );
  const fontes = v.evidencias
    .filter((x) => x.tipo === "regra" && !x.url)
    .map((x) => x.rotulo)
    .join("; ");
  return (
    <li className="flex gap-3 py-3" title={fontes ? `Fonte: ${fontes}` : undefined}>
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${e.fundo}`}>
        <Icone className="size-[13px]" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px] font-semibold text-tinta">
          <span className="sr-only">{e.dito}: </span>
          {v.titulo}
        </p>
        <p className={`text-xs ${e.texto}`}>
          {detalheEEvidencia ? <LinkEvidencia e={v.evidencias[0]} abrir={abrir} /> : v.detalhe}
        </p>
        {outras.length > 0 && (
          <p className="flex flex-wrap gap-x-2 text-[11px] text-tinta-3">
            {outras.map((x, i) => (
              <LinkEvidencia key={i} e={x} abrir={abrir} />
            ))}
          </p>
        )}
        {v.notas.length > 0 && v.estado !== "ok" && (
          <p className="text-[11px] text-tinta-3">{v.notas.slice(0, 2).join(" ")}</p>
        )}
        {(v.origem !== "regra" || v.demonstracao) && (
          <p className="mt-0.5 flex flex-wrap gap-1">
            {v.origem === "ia" && v.a_confirmar && <Etiqueta tom="ia">IA · a confirmar</Etiqueta>}
            {v.origem === "simulado" && <Etiqueta tom="simulado">simulado</Etiqueta>}
            {v.demonstracao && v.origem !== "simulado" && (
              <Etiqueta tom="demo">valores de demonstração</Etiqueta>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

export interface EstadoVerificacoes {
  dados: Verificacoes | undefined;
  erro: { message: string } | null;
  aCarregar: boolean;
  aAtualizar: boolean;
  atualizar: () => Promise<void>;
  erroAtualizar: string | null;
  /** O técnico escolhe o tipo de operação (corre as verificações com esse perfil). */
  escolherPerfil?: (perfil: PerfilVerificacao) => Promise<void>;
}

/** O grupo de uma verificação (as antigas não o traziam). */
function grupoDe(v: Verificacao): GrupoVerificacao {
  if (v.grupo) return v.grupo;
  if (["instrucao", "termo", "ordem", "perfil_documentos"].includes(v.codigo)) return "documentos";
  if (v.codigo === "pdm" || v.codigo.startsWith("pdm_")) return "pdm";
  return "desenhos";
}

const GRUPOS: { grupo: GrupoVerificacao; titulo: string }[] = [
  { grupo: "documentos", titulo: "Documentos e técnico" },
  { grupo: "pdm", titulo: "PDM no local" },
  { grupo: "desenhos", titulo: "Desenhos (leitura da IA)" },
];

const ESCOLHIDO_POR: Record<NonNullable<InfoPerfil["escolhido_por"]>, string> = {
  tecnico: "escolhido pelo técnico",
  requerimento: "pelo requerimento",
  tipo: "pelo tipo de processo",
  texto: "pelo assunto e descrição",
};

function numero(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

function comUnidade(n: number, unidade: string): string {
  if (unidade === "pisos") return `${numero(n)} ${n === 1 ? "piso" : "pisos"}`;
  if (unidade === "lugares") return `${numero(n)} ${n === 1 ? "lugar" : "lugares"}`;
  return `${numero(n)} ${unidade}`;
}

/** A tabela lido × declarado × permitido das verificações com números. */
function TabelaValores({ itens, abrir }: { itens: Verificacao[]; abrir: (e: Evidencia) => void }) {
  const demo = itens.some((x) => x.demonstracao);
  const ia = itens.some((x) => x.valor?.lido);
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-left text-[11px]">
          <caption className="sr-only">
            Valores lidos nos desenhos, declarados no requerimento e permitidos pelo PDM
          </caption>
          <thead>
            <tr className="border-b border-linha text-[10px] font-bold uppercase tracking-wide text-tinta-3">
              <th scope="col" className="py-1 pr-2 font-bold">
                Medida
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-bold">
                Desenho
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-bold">
                Declarado
              </th>
              <th scope="col" className="py-1 text-right font-bold">
                Permitido
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((x) => {
              const val = x.valor!;
              const e = ESTADO[x.estado];
              const Icone = e.icone;
              const lido = val.lido;
              return (
                <tr key={x.codigo} className="border-b border-linha align-top last:border-0">
                  <th scope="row" className="py-1.5 pr-2 font-normal">
                    <span className="flex items-start gap-1.5">
                      <span
                        className={`mt-px flex size-4 shrink-0 items-center justify-center rounded-full ${e.fundo}`}
                      >
                        <Icone className="size-[10px]" aria-hidden />
                      </span>
                      <span className="flex flex-col">
                        <span className="font-semibold text-tinta">
                          <span className="sr-only">{e.dito}: </span>
                          {val.rotulo}
                        </span>
                        {x.estado !== "ok" && (
                          <span className={`${e.texto}`}>
                            {x.titulo.replace(`${val.rotulo}: `, "")}
                            {x.a_confirmar ? " (a confirmar)" : ""}
                          </span>
                        )}
                        {x.estado !== "ok" && val.permitido && (
                          <span className="text-[10px] text-tinta-3">{val.permitido.origem}</span>
                        )}
                      </span>
                    </span>
                  </th>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {lido ? (
                      lido.evidencia ? (
                        <span className="flex flex-col items-end">
                          <LinkEvidencia e={lido.evidencia} abrir={abrir} semIcone>
                            {comUnidade(lido.valor, val.unidade)}
                          </LinkEvidencia>
                          {lido.evidencia.folha && (
                            <span className="text-[10px] text-tinta-3">folha {lido.evidencia.folha}</span>
                          )}
                        </span>
                      ) : (
                        comUnidade(lido.valor, val.unidade)
                      )
                    ) : (
                      <span className="text-tinta-3">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {val.declarado !== null ? (
                      comUnidade(val.declarado, val.unidade)
                    ) : (
                      <span className="text-tinta-3">—</span>
                    )}
                  </td>
                  <td
                    className="whitespace-nowrap py-1.5 text-right tabular-nums"
                    title={val.permitido?.origem}
                  >
                    {val.permitido ? (
                      `${val.permitido.sentido === "max" ? "≤" : "≥"} ${comUnidade(val.permitido.valor, val.unidade)}`
                    ) : (
                      <span className="text-tinta-3">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(ia || demo) && (
        <p className="flex flex-wrap gap-1">
          {ia && <Etiqueta tom="ia">desenho: IA · a confirmar</Etiqueta>}
          {demo && <Etiqueta tom="demo">valores de demonstração</Etiqueta>}
        </p>
      )}
    </div>
  );
}

/** O tipo de operação: qual é, porquê, e o técnico pode mudar. */
function LinhaPerfil({
  perfil,
  escolher,
  ocupado,
}: {
  perfil: InfoPerfil;
  escolher?: (p: PerfilVerificacao) => Promise<void>;
  ocupado: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-creme-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-semibold text-tinta">Tipo de operação:</span>
        {escolher ? (
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Tipo de operação</span>
            <select
              className="rounded-md border border-linha bg-white px-1.5 py-0.5 text-xs font-semibold text-tinta"
              value={perfil.codigo ?? ""}
              disabled={ocupado}
              onChange={(e) => {
                if (e.target.value) void escolher(e.target.value as PerfilVerificacao);
              }}
            >
              {!perfil.codigo && <option value="">Escolher…</option>}
              {perfil.opcoes.map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.nome}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="font-semibold text-tinta">{perfil.nome ?? "por escolher"}</span>
        )}
        {perfil.escolhido_por && (
          <span className="text-tinta-3">({ESCOLHIDO_POR[perfil.escolhido_por]})</span>
        )}
      </div>
      {perfil.ambiguo && (
        <p className="text-[11px] text-ambar">
          {perfil.codigo
            ? `O processo pode ser ${perfil.candidatos.map((c) => c.nome.toLowerCase()).join(" ou ")}: confirme o tipo de operação.`
            : "Não se percebeu o tipo de operação: escolha-o para ver as verificações próprias."}
        </p>
      )}
    </div>
  );
}

/** As verificações do processo (o "Gerar outra vez" do cabeçalho também as refaz). */
export function BlocoVerificacoes({
  processoId,
  v,
}: {
  processoId: string;
  v: EstadoVerificacoes;
}) {
  const { abrir, erro: erroAbrir } = useAbrirDocumento(processoId);
  const d = v.dados;
  return (
    <section aria-labelledby="titulo-verificacoes" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <RotuloSeccao>
          <span id="titulo-verificacoes">Verificações automáticas</span>
        </RotuloSeccao>
        {d && (
          <button
            type="button"
            onClick={() => void v.atualizar()}
            disabled={v.aAtualizar}
            className="inline-flex items-center gap-1 text-xs font-semibold text-terracota-escuro hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${v.aAtualizar ? "animate-spin" : ""}`} aria-hidden />
            {v.aAtualizar ? "A verificar…" : "Verificar outra vez"}
          </button>
        )}
      </div>
      {v.erro && !d ? (
        <ErroEmLinha erro={v.erro.message} />
      ) : !d || (v.aAtualizar && !d) ? (
        <ACarregar className="py-3" texto="A verificar o processo (a IA lê o projeto)…" />
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {`${d.contagem.ok} verificadas, ${d.contagem.atencao} com atenção, ${d.contagem.falha} com falha, ${d.contagem.nao_verificavel} por verificar.`}
          </p>
          {d.perfil && (
            <LinhaPerfil perfil={d.perfil} escolher={v.escolherPerfil} ocupado={v.aAtualizar} />
          )}
          {d.pronto_para_decisao && (
            <div className="mt-1 flex items-start gap-2 rounded-lg bg-verde-suave px-3 py-2 text-verde">
              <CheckCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="flex flex-col text-xs">
                <span className="font-bold">Pronto para decisão</span>
                <span>
                  {d.a_confirmar
                    ? `Tudo verificado; ${d.a_confirmar === 1 ? "1 ponto vem" : `${d.a_confirmar} pontos vêm`} da IA e confirma-se na mesma (a IA não aprova).`
                    : "Tudo verificado; o que vem da IA confirma-se na mesma."}
                </span>
              </p>
            </div>
          )}
          <div className={`flex flex-col gap-2 ${v.aAtualizar ? "opacity-50" : ""}`}>
            {GRUPOS.map(({ grupo, titulo }) => {
              const doGrupo = d.itens.filter((x) => grupoDe(x) === grupo);
              if (!doGrupo.length) return null;
              const comValor = doGrupo.filter((x) => x.valor);
              const outros = doGrupo.filter((x) => !x.valor);
              return (
                <div key={grupo} className="flex flex-col">
                  <h3 className="pt-2 text-[10px] font-bold uppercase tracking-wider text-tinta-3">
                    {titulo}
                  </h3>
                  {outros.length > 0 && (
                    <ul className="flex flex-col divide-y divide-linha">
                      {outros.map((x) => (
                        <LinhaVerificacao key={x.codigo} v={x} abrir={abrir} />
                      ))}
                    </ul>
                  )}
                  {comValor.length > 0 && <TabelaValores itens={comValor} abrir={abrir} />}
                </div>
              );
            })}
            {d.perfil && d.perfil.sempre_tecnico.length > 0 && (
              <div className="flex flex-col">
                <h3 className="pt-2 text-[10px] font-bold uppercase tracking-wider text-tinta-3">
                  Sempre o técnico
                </h3>
                <ul className="flex flex-col gap-1.5 py-2">
                  {d.perfil.sempre_tecnico.map((t) => (
                    <li key={t} className="flex gap-2 text-xs text-tinta-2">
                      <UserCheck className="mt-px size-3.5 shrink-0 text-tinta-3" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="pt-1 text-[11px] leading-relaxed text-tinta-3">
            ✓ verificado · ⚠ atenção · ✕ falha · ? não verificável. Origem:{" "}
            {Object.values(ORIGEM).join(" · ")}. O que vem da IA e do simulado
            confirma-se antes de decidir.
          </p>
          <p className="text-[11px] text-tinta-3">
            Verificado a {diaHora(d.gerado_em)}
            {d.gerado_por?.nome ? ` por ${d.gerado_por.nome}` : ""}
            {d.leitura_ia_em && d.leitura_ia_em !== d.gerado_em
              ? ` · projeto lido pela IA a ${diaHora(d.leitura_ia_em)}`
              : ""}
            {d.em_cache ? " · nada mudou desde então" : ""}.
          </p>
        </>
      )}
      <ErroEmLinha erro={v.erroAtualizar ?? erroAbrir} />
    </section>
  );
}

/** Painel · Processos: cria (uma vez) o processo de demonstração do design e abre o apoio. */
export function BotaoProcessoDemonstracao() {
  const { pedido, pode } = useSessao();
  const router = useRouter();
  const [aCriar, setACriar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (!pode("processos")) return null;
  return (
    <span className="ml-auto inline-flex items-center gap-2">
      <ErroEmLinha erro={erro} />
      <BotaoPainel
        pequeno
        icone={FlaskConical}
        disabled={aCriar}
        onClick={async () => {
          setACriar(true);
          setErro(null);
          try {
            const r = await pedido<{ processo_id: string }>("/v1/painel/processos/demonstracao", {
              metodo: "POST",
            });
            router.push(`/painel/processos/${r.processo_id}/apoio`);
          } catch (e) {
            setErro(paraErro(e).message);
            setACriar(false);
          }
        }}
      >
        {aCriar ? "A preparar…" : "Processo de demonstração"}
      </BotaoPainel>
    </span>
  );
}
