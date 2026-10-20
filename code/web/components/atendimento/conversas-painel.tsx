"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { query, useFuso, useLista } from "./dados";
import { canal, duracaoCurta, hojeNoFuso, hora, quando, resultado, somarDias } from "./formatos";
import type { ConversaLista } from "./tipos";
import { CarregarMais, ErroBloco, Esqueleto } from "./ui";

type Filtro = "todas" | "sem_resposta" | "passada_funcionario";

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "sem_resposta", rotulo: "Sem resposta" },
  { valor: "passada_funcionario", rotulo: "Funcionário" },
];

function grupo(iso: string, fuso: string): string {
  const dia = new Date(iso).toLocaleDateString("sv-SE", { timeZone: fuso });
  const hoje = hojeNoFuso(fuso);
  if (dia === hoje) return "HOJE";
  if (dia === somarDias(hoje, -1)) return "ONTEM";
  return quando(iso, fuso, false).toUpperCase();
}

/**
 * Lista lateral do ecrã Painel · Conversa (340 px): pesquisa, filtros e as
 * conversas agrupadas por dia; a aberta fica marcada a terracota.
 */
export function ConversasPainel({ ativa }: { ativa: string }) {
  const fuso = useFuso();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [texto, setTexto] = useState("");
  const [pesquisa, setPesquisa] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const v = texto.trim();
      if (v.length !== 1) setPesquisa(v);
    }, 350);
    return () => clearTimeout(t);
  }, [texto]);

  const lista = useLista<ConversaLista>(
    `/v1/painel/conversas${query({
      limite: 30,
      resultado: filtro === "todas" ? null : filtro,
      texto: pesquisa,
    })}`,
  );

  const grupos: { nome: string; itens: ConversaLista[] }[] = [];
  for (const c of lista.itens) {
    const g = grupo(c.iniciada_em, fuso);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.nome === g) ultimo.itens.push(c);
    else grupos.push({ nome: g, itens: [c] });
  }

  return (
    <aside
      aria-label="Conversas"
      className="hidden h-dvh w-[340px] shrink-0 flex-col overflow-y-auto border-r border-linha bg-papel xl:flex"
    >
      <div className="flex flex-col gap-3.5 border-b border-linha px-5 pb-4 pt-7">
        <Link
          href="/painel/conversas"
          className="w-fit font-display text-2xl font-bold tracking-[-0.5px] text-tinta hover:text-terracota-escuro"
        >
          Conversas
        </Link>
        <label className="flex h-[38px] items-center gap-2 rounded-[10px] border border-linha bg-creme px-3 focus-within:outline-2 focus-within:outline-terracota">
          <Search className="size-4 text-tinta-3" aria-hidden />
          <span className="sr-only">Procurar conversas</span>
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Procurar por tema ou frase"
            className="w-full bg-transparent text-[13px] text-tinta outline-none placeholder:text-tinta-3"
          />
        </label>
        <div className="flex gap-1.5" role="group" aria-label="Filtrar">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
                filtro === f.valor
                  ? "border-tinta bg-tinta text-white"
                  : "border-linha bg-creme text-tinta-2 hover:text-tinta"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      {lista.erro && (
        <ErroBloco className="m-4" mensagem={lista.erro} tentar={lista.recarregar} />
      )}
      {lista.aCarregar && <Esqueleto className="m-4 h-64" />}
      {!lista.aCarregar && !lista.erro && lista.itens.length === 0 && (
        <p className="px-5 py-8 text-center text-[13px] text-tinta-3">
          Nenhuma conversa.
        </p>
      )}

      {grupos.map((g, gi) => (
        <section key={`${g.nome}-${gi}`} aria-label={g.nome}>
          <h2 className="px-5 pb-1.5 pt-4 text-[11px] font-bold tracking-[1px] text-tinta-3">
            {g.nome}
          </h2>
          <ul>
            {g.itens.map((c) => {
              const r = resultado(c.resultado);
              const Canal = canal(c.canal).icone;
              const sel = c.id === ativa;
              const d = duracaoCurta(c.duracao_s);
              return (
                <li key={c.id}>
                  <Link
                    href={`/painel/conversas/${c.id}`}
                    aria-current={sel ? "page" : undefined}
                    className={`flex flex-col gap-1 border-b px-5 py-3.5 ${
                      sel
                        ? "border-b-terracota border-l-[3px] border-l-terracota bg-creme pl-[17px]"
                        : "border-linha hover:bg-creme/60"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`size-[7px] shrink-0 rounded-full ${r.ponto}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-tinta">
                        {c.tema?.nome ?? canal(c.canal).rotulo}
                      </span>
                      <Canal className="size-[13px] shrink-0 text-tinta-3" aria-hidden />
                      <span className="text-xs text-tinta-3">{hora(c.iniciada_em, fuso)}</span>
                    </span>
                    <span className="line-clamp-2 text-[13px] leading-[1.4] text-tinta-2">
                      {c.resumo ?? "Ainda sem resumo."}
                    </span>
                    <span className="flex items-center gap-2 pl-[13px] pt-0.5">
                      <span className="rounded-lg bg-creme-2 px-2 py-0.5 text-[11px] font-semibold text-tinta-2">
                        {r.rotulo}
                      </span>
                      {d && <span className="text-[11px] text-tinta-3">{d}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <CarregarMais
        ha={!!lista.proximo}
        aCarregar={lista.aCarregarMais}
        erro={lista.maisErro}
        carregar={lista.carregarMais}
      />
    </aside>
  );
}
