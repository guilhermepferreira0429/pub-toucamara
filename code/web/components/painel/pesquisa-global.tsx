"use client";

import {
  CircleParking,
  Ticket,
  BookOpen,
  FolderOpen,
  Loader2,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  NotebookPen,
  Search,
  User,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SECCOES } from "@/components/painel/barra-lateral";
import { useFocoPreso } from "@/lib/foco";
import { aoAbrirPesquisa, normalizar, useTeclaAtalho } from "@/lib/pesquisa";
import { useSessao } from "@/lib/sessao";

/*
 * Paleta de pesquisa global (⌘K / Ctrl K): os ecrãs do painel que o perfil
 * pode abrir e o que a API encontra (GET /v1/painel/pesquisa), agrupado por
 * tipo. Combobox com lista (padrão da ARIA): o foco fica na caixa e as
 * setas mudam a opção ativa (aria-activedescendant).
 */

type Tipo =
  | "ecra"
  | "municipe"
  | "conversa"
  | "processo"
  | "ocorrencia"
  | "reclamacao"
  | "fonte"
  | "resposta"
  | "multa"
  | "reserva";

interface Opcao {
  tipo: Tipo;
  id: string;
  titulo: string;
  subtitulo: string;
  href: string;
  icone?: LucideIcon;
}

interface Grupo {
  tipo: Tipo;
  rotulo: string;
  itens: Opcao[];
}

const ICONES: Record<Exclude<Tipo, "ecra">, LucideIcon> = {
  municipe: User,
  conversa: MessagesSquare,
  processo: FolderOpen,
  ocorrencia: MapPin,
  reclamacao: NotebookPen,
  fonte: BookOpen,
  resposta: MessageSquareText,
  multa: CircleParking,
  reserva: Ticket,
};

/** Espera entre teclas antes de perguntar à API. */
const ESPERA_MS = 200;
const MIN_LETRAS = 2;

export function PesquisaGlobal() {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setAberto((a) => !a);
      }
    };
    window.addEventListener("keydown", tecla);
    const largar = aoAbrirPesquisa(() => setAberto(true));
    return () => {
      window.removeEventListener("keydown", tecla);
      largar();
    };
  }, []);

  // Desmonta ao fechar: abre sempre limpa.
  return aberto ? <Paleta onFechar={() => setAberto(false)} /> : null;
}

function Paleta({ onFechar }: { onFechar: () => void }) {
  const { pedido, pode } = useSessao();
  const router = useRouter();
  const caixa = useRef<HTMLDivElement>(null);
  const base = useId();
  const tecla = useTeclaAtalho();
  useFocoPreso(caixa, true, onFechar);

  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<{
    q: string;
    grupos: Grupo[];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(0);

  const q = texto.trim();
  const pesquisavel = q.length >= MIN_LETRAS;
  // A resposta é deste texto? Enquanto não for, está a carregar.
  const aCarregar = pesquisavel && !erro && resultado?.q !== q;

  useEffect(() => {
    if (!pesquisavel) return;
    const controlo = new AbortController();
    const t = setTimeout(() => {
      pedido<{ q: string; grupos: Grupo[] }>(
        `/v1/painel/pesquisa?q=${encodeURIComponent(q)}`,
        { sinal: controlo.signal },
      )
        .then((r) => {
          setErro(null);
          setResultado({ q, grupos: r.grupos });
        })
        .catch(() => {
          if (!controlo.signal.aborted) {
            setErro("Não foi possível pesquisar. Tente outra vez.");
          }
        });
    }, ESPERA_MS);
    return () => {
      clearTimeout(t);
      controlo.abort();
    };
  }, [q, pesquisavel, pedido]);

  // Os ecrãs do painel que o perfil pode abrir, filtrados pelo texto.
  const ecras = useMemo<Grupo | null>(() => {
    const n = normalizar(q);
    const itens = SECCOES.flatMap((s) =>
      s.itens
        .filter((it) => !it.soDemo && pode(it.recurso))
        .map((it) => ({ it, seccao: s.titulo })),
    )
      .filter(({ it, seccao }) =>
        normalizar(`${it.rotulo} ${seccao ?? ""}`).includes(n),
      )
      .slice(0, n ? 5 : 8)
      .map<Opcao>(({ it, seccao }) => ({
        tipo: "ecra",
        id: it.href,
        titulo: it.rotulo,
        subtitulo: seccao
          ? seccao.charAt(0) + seccao.slice(1).toLowerCase()
          : "Painel",
        href: it.href,
        icone: it.icone,
      }));
    return itens.length ? { tipo: "ecra", rotulo: "Ecrãs", itens } : null;
  }, [q, pode]);

  const grupos = useMemo(() => {
    const daApi = pesquisavel && resultado?.q === q ? resultado.grupos : [];
    return [...(ecras ? [ecras] : []), ...daApi];
  }, [ecras, resultado, pesquisavel, q]);
  const opcoes = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);
  // Onde começa cada grupo na lista corrida (o índice de cada opção).
  const inicios = grupos.map((_, k) =>
    grupos.slice(0, k).reduce((s, g) => s + g.itens.length, 0),
  );
  const atual = Math.min(ativo, Math.max(opcoes.length - 1, 0));
  const idOpcao = (i: number) => `${base}-op-${i}`;

  // A opção ativa fica sempre à vista ao andar com as setas.
  useEffect(() => {
    document
      .getElementById(`${base}-op-${atual}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [atual, base]);

  function abrir(o: Opcao) {
    onFechar();
    router.push(o.href);
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!opcoes.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((atual + 1) % opcoes.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((atual - 1 + opcoes.length) % opcoes.length);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setAtivo(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setAtivo(opcoes.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      abrir(opcoes[atual]);
    }
  }

  const nadaEncontrado =
    pesquisavel && !aCarregar && !erro && opcoes.length === 0;
  const estado = aCarregar
    ? "A procurar…"
    : erro
      ? erro
      : nadaEncontrado
        ? `Nada encontrado para «${q}».`
        : pesquisavel
          ? `${opcoes.length} ${opcoes.length === 1 ? "resultado" : "resultados"}.`
          : "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-tinta/40 p-4 pt-[10vh] md:p-6 md:pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label="Pesquisar no painel"
        className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-linha bg-papel shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-linha px-4">
          {aCarregar ? (
            <Loader2
              className="size-4.5 shrink-0 animate-spin text-tinta-3"
              aria-hidden
            />
          ) : (
            <Search className="size-4.5 shrink-0 text-tinta-3" aria-hidden />
          )}
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded={opcoes.length > 0}
            aria-controls={`${base}-lista`}
            aria-autocomplete="list"
            aria-activedescendant={opcoes.length ? idOpcao(atual) : undefined}
            aria-label="Pesquisar munícipes, conversas, processos, ocorrências e ecrãs"
            placeholder="Munícipe, número do processo, morada, ecrã…"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setAtivo(0);
              setErro(null);
            }}
            onKeyDown={teclas}
            className="h-13 min-w-0 flex-1 bg-transparent text-[15px] text-tinta outline-none placeholder:text-tinta-3"
          />
          <kbd className="flex h-6 shrink-0 items-center rounded-md border border-linha bg-creme px-1.5 font-sans text-[11px] font-semibold text-tinta-3">
            Esc
          </kbd>
        </div>

        <div
          id={`${base}-lista`}
          role="listbox"
          aria-label="Resultados"
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {grupos.map((g, k) => (
            <div
              key={g.tipo}
              role="group"
              aria-labelledby={`${base}-g-${g.tipo}`}
              className="pb-1.5"
            >
              <div
                id={`${base}-g-${g.tipo}`}
                className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-tinta-3"
              >
                {g.rotulo}
              </div>
              {g.itens.map((o, j) => {
                const n = inicios[k] + j;
                const escolhida = n === atual;
                const Icone =
                  o.icone ?? (o.tipo === "ecra" ? Search : ICONES[o.tipo]);
                return (
                  <div
                    key={`${o.tipo}-${o.id}`}
                    id={idOpcao(n)}
                    role="option"
                    aria-selected={escolhida}
                    onMouseMove={() => n !== atual && setAtivo(n)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => abrir(o)}
                    className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 ${
                      escolhida ? "bg-creme-2" : ""
                    }`}
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                        escolhida
                          ? "bg-terracota text-papel"
                          : "bg-creme text-tinta-2"
                      }`}
                    >
                      <Icone className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold text-tinta">
                        {o.titulo}
                      </span>
                      {o.subtitulo && (
                        <span className="truncate text-xs text-tinta-3">
                          {o.subtitulo}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          {nadaEncontrado && (
            <p className="px-3 py-8 text-center text-sm text-tinta-3">
              Nada encontrado para «{q}». Experimente o número do processo (CP
              2/2026), da ocorrência (OC-0381) ou parte da morada.
            </p>
          )}
          {erro && (
            <p
              role="alert"
              className="px-3 py-6 text-center text-sm text-terracota"
            >
              {erro}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-linha bg-creme px-4 py-2 text-[11px] text-tinta-3">
          <span>
            <kbd className="font-sans font-semibold">↑↓</kbd> escolher ·{" "}
            <kbd className="font-sans font-semibold">Enter</kbd> abrir ·{" "}
            <kbd className="font-sans font-semibold">Esc</kbd> fechar
          </span>
          <span className="hidden sm:inline">
            <kbd className="font-sans font-semibold">{tecla}</kbd> em qualquer
            ecrã
          </span>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {estado}
        </p>
      </div>
    </div>
  );
}
