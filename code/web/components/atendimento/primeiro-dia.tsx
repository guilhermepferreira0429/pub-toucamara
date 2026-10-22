"use client";

import { BookOpen, Check, Phone } from "lucide-react";
import Link from "next/link";
import { useSessao } from "@/lib/sessao";
import { useDados } from "./dados";
import { numero } from "./formatos";
import type { Qualidade } from "./tipos";
import { AvatarAgente } from "./ui";

interface Mapa {
  resumo: { respostas_no_ar: number; fontes: number; fontes_com_erro: number };
}

type Estado = "feito" | "por_fazer" | "falhou";

/** Painel · Primeiro dia (frame j6Zytv): ainda não houve nenhuma conversa. */
export function PrimeiroDia({ qualidade }: { qualidade?: Qualidade }) {
  const { pode } = useSessao();
  const mapa = useDados<Mapa>(
    pode("conhecimento_ver") ? "/v1/painel/conhecimento/mapa" : null,
  );

  const r = mapa.dados?.resumo;
  const u = qualidade?.ultima;
  const passos: { titulo: string; detalhe: string; estado: Estado; acao?: React.ReactNode }[] = [
    {
      titulo: r?.respostas_no_ar ? "Base de conhecimento carregada" : "Base de conhecimento",
      detalhe: r
        ? r.respostas_no_ar
          ? `${numero(r.respostas_no_ar)} respostas no ar, de ${numero(r.fontes)} ${r.fontes === 1 ? "fonte oficial" : "fontes oficiais"}`
          : "Ainda sem respostas publicadas"
        : "As respostas que o agente dá, sempre com fonte oficial",
      estado: r ? (r.respostas_no_ar ? "feito" : "por_fazer") : "por_fazer",
    },
    {
      titulo: u ? (u.passou ? "Teste de qualidade passou" : "Teste de qualidade abaixo do mínimo") : "Teste de qualidade",
      detalhe: u
        ? `${u.taxa === null ? "—" : Math.round(u.taxa)}% nas ${numero(u.perguntas)} perguntas, ${u.passou ? "acima" : "abaixo"} do mínimo de ${qualidade?.limiar ?? 80}%`
        : "Ainda não correu",
      estado: u ? (u.passou ? "feito" : "falhou") : "por_fazer",
    },
    {
      titulo: "Linha telefónica e chat no portal",
      detalhe: "O número e o código do chat estão na configuração do agente",
      estado: "por_fazer",
      acao: pode("agente") ? (
        <Link
          href="/painel/agente"
          className="shrink-0 text-[13px] font-bold text-terracota-escuro hover:underline"
        >
          Ver configuração
        </Link>
      ) : undefined,
    },
  ];

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 sm:px-10 py-8">
      <div className="flex w-full max-w-[680px] flex-col items-center gap-7 text-center">
        <AvatarAgente tamanho={88} />
        <div className="flex flex-col gap-2.5">
          <h1 className="font-display text-4xl font-bold tracking-[-1px] text-tinta">
            Está tudo pronto. Falta só a primeira chamada.
          </h1>
          <p className="text-base text-tinta-2">
            As conversas aparecem aqui, resumidas, assim que alguém ligar ou escrever.
          </p>
        </div>

        <ol className="flex w-full flex-col rounded-[20px] border border-linha bg-papel px-6 py-2 text-left">
          {passos.map((p, i) => (
            <li
              key={p.titulo}
              className={`flex items-center gap-3.5 py-3.5 ${i ? "border-t border-linha" : ""}`}
            >
              {p.estado === "feito" ? (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-verde">
                  <Check className="size-[15px] text-white" aria-label="Feito" />
                </span>
              ) : p.estado === "falhou" ? (
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ambar-suave text-sm font-bold text-ambar"
                  aria-label="A rever"
                >
                  !
                </span>
              ) : (
                <span
                  className="size-7 shrink-0 rounded-full border-[1.5px] border-tinta-3 bg-creme"
                  aria-label="Por fazer"
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-tinta">{p.titulo}</span>
                <span className="text-[13px] text-tinta-2">{p.detalhe}</span>
              </span>
              {p.acao}
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap justify-center gap-3">
          {pode("agente") && (
            <Link
              href="/painel/agente"
              className="flex h-12 items-center gap-2 rounded-3xl bg-terracota px-[22px] text-[15px] font-semibold text-white hover:bg-terracota-escuro"
            >
              <Phone className="size-[17px]" aria-hidden />
              Ligar para testar
            </Link>
          )}
          {pode("conhecimento_ver") && (
            <Link
              href="/painel/conhecimento"
              className="flex h-12 items-center gap-2 rounded-3xl border-[1.5px] border-tinta px-[22px] text-[15px] font-semibold text-tinta hover:bg-tinta/5"
            >
              <BookOpen className="size-[17px]" aria-hidden />
              Ver o que o agente sabe
            </Link>
          )}
        </div>

        <p className="flex items-center gap-2.5 rounded-[14px] bg-creme-2 px-3.5 py-2.5 text-left text-[13px] text-tinta-2">
          <AvatarAgente tamanho={32} />
          Dúvidas no arranque? A sua pessoa de contacto na Tou, Câmara? responde
          em 1 hora.
        </p>
      </div>
    </div>
  );
}
