"use client";

import { ExternalLink, Landmark, Plus } from "lucide-react";
import { Botao } from "@/components/ui/botao";
import { ErroLinha, numero, Pilula, useAcao, useDados } from "@/components/conhecimento/comum";
import { useSessao } from "@/lib/sessao";

/*
 * Painel › Conhecimento › Fontes: a faixa do turismo. Quantas fontes de
 * turismo há por língua, as perguntas noutras línguas (últimos 30 dias) e o
 * botão para carregar as fontes de demonstração (idempotente). As fontes em
 * si aparecem na lista como as outras e editam-se com "Colar texto".
 */

interface Resumo {
  fontes: { lingua: string; fontes: number; demonstracao: number }[];
  total_fontes: number;
  demonstracao: boolean;
  conversas_30d: { lingua: string; conversas: number; turismo: number }[];
  noutra_lingua_30d: number;
  com_turismo_30d: number;
}

const NOMES: Record<string, string> = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
  de: "Alemão",
  it: "Italiano",
  uk: "Ucraniano",
  zh: "Chinês",
};

export function PainelTurismo({ aoCarregar }: { aoCarregar: () => void }) {
  const { pedido, pode } = useSessao();
  const r = useDados<Resumo>("/v1/painel/turismo");
  const acao = useAcao();
  const d = r.dados;
  if (!d) return null;
  const outras = d.conversas_30d.filter((x) => x.lingua !== "pt");

  return (
    <section aria-labelledby="turismo-fontes" className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-creme">
          <Landmark className="size-4 text-tinta-2" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="turismo-fontes" className="text-[15px] font-bold text-tinta">
            Turismo
          </h2>
          <p className="text-[13px] text-tinta-2">
            {d.total_fontes
              ? `${numero(d.total_fontes)} fontes em ${d.fontes.map((f) => f.lingua.toUpperCase()).join(", ")} · página pública /visitar`
              : "Ainda não há fontes de turismo. Carregue as de demonstração para ver a página /visitar."}
          </p>
        </div>
        {d.demonstracao && <Pilula tom="ambar">valores de demonstração · confirmar com o turismo da câmara</Pilula>}
        <a href="/visitar" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[13px] font-semibold text-terracota-escuro hover:underline">
          Abrir /visitar
          <ExternalLink className="size-3" aria-hidden />
        </a>
        {pode("conhecimento") && (
          <Botao
            icone={Plus}
            variante="secundario"
            disabled={acao.aCorrer}
            onClick={async () => {
              const x = await acao.executar(() => pedido("/v1/painel/turismo/demonstracao", { metodo: "POST" }));
              if (x) {
                r.recarregar();
                aoCarregar();
              }
            }}
          >
            {acao.aCorrer ? "A carregar…" : "Fontes de demonstração"}
          </Botao>
        )}
      </div>
      <p className="text-[13px] text-tinta-2">
        <span className="font-semibold text-tinta">Conversas noutra língua (30 dias): {numero(d.noutra_lingua_30d)}</span>
        {outras.length > 0 && ` — ${outras.map((x) => `${NOMES[x.lingua] ?? x.lingua.toUpperCase()} ${numero(x.conversas)}`).join(" · ")}`}
        {` · com informação turística: ${numero(d.com_turismo_30d)}`}
      </p>
      <ErroLinha erro={acao.erro} />
    </section>
  );
}
