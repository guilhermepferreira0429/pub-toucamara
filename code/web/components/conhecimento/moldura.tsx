"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { ROLO_SEPARADORES } from "@/components/painel/rolo";
import { useSessao } from "@/lib/sessao";
import { pct, SemAcesso, useDados } from "./comum";
import type { Mapa, Qualidade } from "./tipos";

const SEPARADORES = [
  { rotulo: "Mapa", href: "/painel/conhecimento" },
  { rotulo: "Respostas", href: "/painel/conhecimento/respostas" },
  { rotulo: "Sem resposta", href: "/painel/conhecimento/sem-resposta" },
  { rotulo: "Qualidade", href: "/painel/conhecimento/qualidade" },
  { rotulo: "Fontes", href: "/painel/conhecimento/fontes" },
  { rotulo: "Alterações", href: "/painel/conhecimento/alteracoes" },
  { rotulo: "Linguagem simples", href: "/painel/conhecimento/linguagem-simples" },
  { rotulo: "Glossário", href: "/painel/conhecimento/glossario" },
] as const;

/**
 * Cabeçalho comum do conhecimento: título e os separadores com as
 * contagens (frame "Conhecimento · Mapa", grupo "Separadores").
 */
export function MolduraConhecimento({ children }: { children: React.ReactNode }) {
  const { pode } = useSessao();
  const caminho = usePathname();
  const ver = pode("conhecimento_ver");
  const mapa = useDados<Mapa>(ver ? "/v1/painel/conhecimento/mapa" : null);
  const qualidade = useDados<Qualidade>(ver ? "/v1/painel/conhecimento/qualidade" : null);

  const r = mapa.dados?.resumo;
  const contagens: Record<string, string | undefined> = {
    Respostas: r ? String(r.respostas_no_ar) : undefined,
    "Sem resposta": r ? String(r.sem_resposta_abertas) : undefined,
    Qualidade:
      qualidade.dados?.ultima?.taxa != null ? pct(qualidade.dados.ultima.taxa) : undefined,
    Fontes: r ? String(r.fontes) : undefined,
    Alterações: r ? String(r.alteracoes_por_rever + r.contradicoes_abertas) : undefined,
  };

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Gestão", "Conhecimento"]}
        titulo="Conhecimento"
        descricao="O que o agente sabe responder, de onde vem, e se está a responder bem."
        acoes={
          ver && (
            <nav
              aria-label="Secções do conhecimento"
              className={`flex max-w-full flex-wrap gap-1 rounded-xl bg-creme-2 p-1 ${ROLO_SEPARADORES}`}
            >
              {SEPARADORES.map((s) => {
                const ativo =
                  s.href === "/painel/conhecimento"
                    ? caminho === s.href
                    : caminho.startsWith(s.href);
                const n = contagens[s.rotulo];
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={ativo ? "page" : undefined}
                    className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[13px] ${
                      ativo
                        ? "bg-papel font-bold text-tinta shadow-sm"
                        : "font-medium text-tinta-2 hover:bg-papel/60"
                    }`}
                  >
                    {s.rotulo}
                    {n !== undefined && (
                      <span className="text-xs font-normal text-tinta-3">{n}</span>
                    )}
                  </Link>
                );
              })}
            </nav>
          )
        }
      />
      {ver ? children : <SemAcesso />}
    </div>
  );
}
