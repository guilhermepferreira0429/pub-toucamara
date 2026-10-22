"use client";

import { ChevronRight, Plus, Vote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Cartao,
  dia,
  Dialogo,
  Estado,
  numero,
  Pilula,
  SemAcesso,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { FormularioConsulta } from "./formulario";
import { type ListaConsultas, SITUACOES } from "./tipos";

/*
 * Painel · Consultas públicas: a câmara pergunta, o agente ouve ao telefone e
 * no chat, e o resultado aparece por freguesia.
 */
export function PaginaConsultas() {
  const { pode } = useSessao();
  const router = useRouter();
  const [criar, setCriar] = useState(false);
  const d = useDados<ListaConsultas>(pode("indicadores") ? "/v1/painel/consultas" : null);

  if (!pode("indicadores")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Comunidade", "Consultas públicas"]} titulo="Consultas públicas" />
        <SemAcesso />
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Comunidade", "Consultas públicas"]}
        titulo="Consultas públicas"
        descricao="A opinião de quem nunca vai a uma sessão pública: o agente explica o que está em causa ao telefone e no chat, regista a resposta e o painel mostra o resultado por freguesia."
        acoes={
          pode("agente") && (
            <Botao icone={Plus} onClick={() => setCriar(true)}>
              Nova consulta
            </Botao>
          )
        }
      />
      <div className="flex flex-col gap-3 px-4 sm:px-10">
        <Cartao>
          <Estado
            aCarregar={d.aCarregar}
            erro={d.erro}
            vazio={d.dados?.consultas.length === 0}
            textoVazio="Ainda não há consultas. Crie uma (por exemplo, uma ciclovia ou um horário novo do mercado) e abra-a: o agente passa a falar dela."
          >
            <ul className="divide-y divide-linha">
              {(d.dados?.consultas ?? []).map((c) => {
                const s = SITUACOES[c.situacao];
                return (
                  <li key={c.id}>
                    <Link
                      href={`/painel/consultas/${c.id}`}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-4 hover:bg-creme/60"
                    >
                      <span className="flex size-9 items-center justify-center rounded-full bg-creme-2" aria-hidden>
                        <Vote className="size-4 text-tinta-2" />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-semibold text-tinta">{c.titulo}</span>
                        <span className="text-xs text-tinta-3">
                          {dia(c.abre_em)} a {dia(c.fecha_em)} · relatório a {dia(c.relatorio_em)} ·{" "}
                          {c.freguesias?.length ? `${c.freguesias.length} freguesias` : "todo o concelho"}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-right">
                          <span className="block font-display text-lg font-bold text-tinta">
                            {numero(c.participacoes)}
                          </span>
                          <span className="block text-[11px] text-tinta-3">participações</span>
                        </span>
                        <Pilula tom={s.tom}>{s.rotulo}</Pilula>
                      </span>
                      <ChevronRight className="size-4 text-tinta-3" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Estado>
        </Cartao>
      </div>
      <Dialogo titulo="Nova consulta pública" aberto={criar} onFechar={() => setCriar(false)} largura="max-w-2xl">
        <FormularioConsulta
          freguesiasConhecidas={d.dados?.freguesias_conhecidas ?? []}
          onCancelar={() => setCriar(false)}
          onGuardada={(id) => router.push(`/painel/consultas/${id}`)}
        />
      </Dialogo>
    </div>
  );
}
