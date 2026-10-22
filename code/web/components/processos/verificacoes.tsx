"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  FlaskConical,
  HelpCircle,
  type LucideIcon,
  RefreshCw,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { diaHora } from "./formatos";
import type {
  EstadoAutomatico,
  Evidencia,
  OrigemVerificacao,
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
}: {
  e: Evidencia;
  abrir: (e: Evidencia) => void;
  children?: React.ReactNode;
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
        <FileText className="size-3 shrink-0" aria-hidden />
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
          <ul className={`flex flex-col divide-y divide-linha ${v.aAtualizar ? "opacity-50" : ""}`}>
            {d.itens.map((x) => (
              <LinhaVerificacao key={x.codigo} v={x} abrir={abrir} />
            ))}
          </ul>
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
