"use client";

import { MessagesSquare, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BotaoExportar } from "@/components/painel/botao-exportar";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { FiltrosRecolhiveis } from "@/components/painel/telemovel";
import { useSessao } from "@/lib/sessao";
import { query, useLista } from "./dados";
import { CANAIS, RESULTADOS, somarDias } from "./formatos";
import { TabelaConversas } from "./tabela-conversas";
import type { ConversaLista } from "./tipos";
import { CarregarMais, ErroBloco, Esqueleto, Vazio } from "./ui";

const FILTROS = ["texto", "canal", "resultado", "revisao", "fora_de_horas", "de", "ate"] as const;

const campo =
  "h-10 rounded-[10px] border border-linha bg-papel px-3 text-[13px] text-tinta";

/** Painel · Conversas: todas, com filtros e paginação por cursor. */
export function ConversasLista() {
  const { pode } = useSessao();
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const f = Object.fromEntries(FILTROS.map((k) => [k, params.get(k) ?? ""])) as Record<
    (typeof FILTROS)[number],
    string
  >;

  // A pesquisa só segue para o URL depois de parar de escrever.
  const [texto, setTexto] = useState(f.texto);
  useEffect(() => {
    const t = setTimeout(() => {
      if (texto.trim() === f.texto) return;
      if (texto.trim().length === 1) return;
      mudar({ texto: texto.trim() });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  function mudar(novos: Partial<typeof f>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(novos)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    router.replace(s ? `${caminho}?${s}` : caminho, { scroll: false });
  }

  const filtros = {
    texto: f.texto,
    canal: f.canal,
    resultado: f.resultado,
    revisao: f.revisao,
    fora_de_horas: f.fora_de_horas,
    de: f.de,
    // `ate` é exclusivo na API: o dia escolhido conta inteiro.
    ate: f.ate ? somarDias(f.ate, 1) : "",
  };
  const base = pode("conversas")
    ? `/v1/painel/conversas${query({ limite: 30, ...filtros })}`
    : null;
  const lista = useLista<ConversaLista>(base);
  const filtrado = FILTROS.some((k) => f[k]);

  if (!pode("conversas")) {
    return (
      <>
        <CabecalhoPagina migalhas={["Atendimento"]} titulo="Conversas" />
        <Aviso titulo="Sem acesso">
          O seu perfil não tem acesso às conversas.
        </Aviso>
      </>
    );
  }

  return (
    <div className="pb-12">
      <CabecalhoPagina
        migalhas={["Atendimento", "Conversas"]}
        titulo="Conversas"
        descricao="Cada conversa resumida, com o que foi respondido e de onde."
        acoes={
          <BotaoExportar
            caminho={`/v1/painel/conversas/exportar.csv${query(filtros)}`}
            base="conversas"
          />
        }
      />
      <div className="flex flex-col gap-4 px-4 sm:px-10">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            mudar({ texto: texto.trim() });
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <label className="flex h-10 min-w-0 flex-1 basis-full items-center sm:min-w-[260px] sm:basis-auto gap-2 rounded-[10px] border border-linha bg-papel px-3 focus-within:outline-2 focus-within:outline-terracota">
            <Search className="size-4 text-tinta-3" aria-hidden />
            <span className="sr-only">Procurar no resumo</span>
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Procurar por tema ou frase"
              className="w-full bg-transparent text-[13px] text-tinta outline-none placeholder:text-tinta-3"
            />
          </label>
          <FiltrosRecolhiveis
            ativos={FILTROS.filter((k) => k !== "texto" && f[k]).length}
            className="flex flex-wrap items-center gap-2 max-md:w-full md:contents"
          >
            <label>
              <span className="sr-only">Canal</span>
              <select
                value={f.canal}
                onChange={(e) => mudar({ canal: e.target.value })}
                className={campo}
              >
                <option value="">Todos os canais</option>
                {Object.entries(CANAIS).map(([k, c]) => (
                  <option key={k} value={k}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Resultado</span>
              <select
                value={f.resultado}
                onChange={(e) => mudar({ resultado: e.target.value })}
                className={campo}
              >
                <option value="">Todos os resultados</option>
                {Object.entries(RESULTADOS).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Revisão</span>
              <select
                value={f.revisao}
                onChange={(e) => mudar({ revisao: e.target.value })}
                className={campo}
              >
                <option value="">Revistas ou não</option>
                <option value="por_rever">Por rever</option>
                <option value="certa">Marcadas certas</option>
                <option value="errada">Marcadas erradas</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-tinta-2">
              De
              <input
                type="date"
                value={f.de}
                max={f.ate || undefined}
                onChange={(e) => mudar({ de: e.target.value })}
                className={campo}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-tinta-2">
              até
              <input
                type="date"
                value={f.ate}
                min={f.de || undefined}
                onChange={(e) => mudar({ ate: e.target.value })}
                className={campo}
              />
            </label>
            <label className="flex h-10 items-center gap-2 rounded-[10px] border border-linha bg-papel px-3 text-[13px] text-tinta">
              <input
                type="checkbox"
                checked={f.fora_de_horas === "true"}
                onChange={(e) => mudar({ fora_de_horas: e.target.checked ? "true" : "" })}
                className="size-4 accent-terracota"
              />
              Fora de horas
            </label>
          </FiltrosRecolhiveis>
          {filtrado && (
            <button
              type="button"
              onClick={() => {
                setTexto("");
                router.replace(caminho, { scroll: false });
              }}
              className="flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme-2"
            >
              <X className="size-4" aria-hidden />
              Limpar filtros
            </button>
          )}
        </form>

        <section
          aria-label="Lista de conversas"
          aria-busy={lista.aCarregar}
          className="rounded-2xl border border-linha bg-papel px-4 pb-2 pt-2 md:px-6 md:pt-4"
        >
          {lista.erro && <ErroBloco mensagem={lista.erro} tentar={lista.recarregar} />}
          {lista.aCarregar && <Esqueleto className="my-2 h-72" />}
          {!lista.aCarregar &&
            !lista.erro &&
            (lista.itens.length ? (
              <TabelaConversas itens={lista.itens} mostrarMunicipe consulta={params.toString()} />
            ) : (
              <Vazio
                icone={MessagesSquare}
                titulo={
                  filtrado
                    ? "Nenhuma conversa com estes filtros."
                    : "Ainda não há conversas."
                }
              >
                {filtrado
                  ? "Experimente outro período ou limpe os filtros."
                  : "As conversas aparecem aqui, resumidas, assim que alguém ligar ou escrever."}
              </Vazio>
            ))}
          <CarregarMais
            ha={!!lista.proximo}
            aCarregar={lista.aCarregarMais}
            erro={lista.maisErro}
            carregar={lista.carregarMais}
          />
        </section>
      </div>
    </div>
  );
}
