"use client";

import { AlertTriangle, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErroApi } from "@/lib/api";
import { useFocoPreso } from "@/lib/foco";
import { useSessao } from "@/lib/sessao";

/*
 * Peças comuns das páginas de conhecimento, agente, equipa, relatórios e
 * avisos: carregar dados da API (sem setState síncrono nos efeitos), correr
 * ações, mostrar erros e datas em português de Portugal.
 */

export interface Pagina<T> {
  itens: T[];
  proximo_cursor: string | null;
}

export function comoErro(e: unknown): ErroApi {
  if (e instanceof ErroApi) return e;
  return new ErroApi(0, "erro", "Ocorreu um erro. Tente outra vez.");
}

/** Perfis da equipa Tou, Câmara? (podem tudo, inclusive o que a câmara não pode). */
export function useEquipaInterna(): boolean {
  const { eu } = useSessao();
  const p = eu?.utilizador.perfil;
  return p === "admin" || p === "equipa_toucamara";
}

/**
 * GET autenticado. `caminho` null não pede nada. Ao mudar o caminho (ou
 * `recarregar`) os dados antigos do mesmo caminho ficam visíveis até chegarem
 * os novos.
 */
export function useDados<T>(caminho: string | null) {
  const { pedido } = useSessao();
  const [versao, setVersao] = useState(0);
  const [r, setR] = useState<{
    chave: string;
    caminho: string;
    dados?: T;
    erro?: ErroApi;
  }>({ chave: "", caminho: "" });
  const chave = caminho ? `${caminho}#${versao}` : "";

  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    pedido<T>(caminho).then(
      (dados) => vivo && setR({ chave, caminho, dados }),
      (e: unknown) => vivo && setR({ chave, caminho, erro: comoErro(e) }),
    );
    return () => {
      vivo = false;
    };
  }, [caminho, chave, pedido]);

  const mesmo = r.caminho === caminho;
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const mudar = useCallback(
    (f: (d: T) => T) =>
      setR((x) => (x.dados === undefined ? x : { ...x, dados: f(x.dados) })),
    [],
  );
  return {
    dados: mesmo ? r.dados : undefined,
    erro: mesmo && r.chave === chave ? r.erro : undefined,
    aCarregar: !!caminho && r.chave !== chave,
    recarregar,
    mudar,
  };
}

/** Uma ação (POST/PATCH…) com estado "a correr" e o erro da API. */
export function useAcao() {
  const [aCorrer, setACorrer] = useState(false);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const executar = useCallback(
    async <T,>(f: () => Promise<T>): Promise<T | undefined> => {
      setACorrer(true);
      setErro(null);
      try {
        return await f();
      } catch (e) {
        setErro(comoErro(e));
        return undefined;
      } finally {
        setACorrer(false);
      }
    },
    [],
  );
  const limpar = useCallback(() => setErro(null), []);
  return { aCorrer, erro, executar, limpar };
}

/** Junta a página seguinte de uma lista paginada. */
export function useMais<T>(
  base: string | null,
  lista: { dados?: Pagina<T>; mudar: (f: (d: Pagina<T>) => Pagina<T>) => void },
) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const cursor = lista.dados?.proximo_cursor ?? null;
  const mais = async () => {
    if (!base || !cursor) return;
    const sep = base.includes("?") ? "&" : "?";
    const n = await acao.executar(() =>
      pedido<Pagina<T>>(`${base}${sep}cursor=${encodeURIComponent(cursor)}`),
    );
    if (n) {
      lista.mudar((d) => ({
        itens: [...d.itens, ...n.itens],
        proximo_cursor: n.proximo_cursor,
      }));
    }
  };
  return { haMais: !!cursor, mais, aCorrer: acao.aCorrer, erro: acao.erro };
}

// ---------------------------------------------------------------------------
// Datas e números
// ---------------------------------------------------------------------------

const DIA_MES = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" });
const DIA_MES_ANO = new Intl.DateTimeFormat("pt-PT", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const HORA = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" });

function data(v: string | Date): Date {
  // Dias sem hora (AAAA-MM-DD) contam ao meio-dia, para não mudarem de dia.
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? new Date(`${v}T12:00:00`)
    : new Date(v);
}

/** "12 out." (ou "12 out. 2025" noutro ano). */
export function dia(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = data(v);
  const f = d.getFullYear() === new Date().getFullYear() ? DIA_MES : DIA_MES_ANO;
  return f.format(d);
}

/**
 * "hoje, 10:12", "ontem, 09:00" ou "12 out., 10:12". Sem hora (um dia
 * 'AAAA-MM-DD' ou meia-noite certa) fica só o dia: "hoje", "12 out.".
 */
export function quando(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = data(v);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  const mesmo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const soDia = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const h = HORA.format(d);
  const comHora = soDia || h === "00:00" ? "" : `, ${h}`;
  if (mesmo(d, hoje)) return `hoje${comHora}`;
  if (mesmo(d, ontem)) return `ontem${comHora}`;
  return `${dia(d)}${comHora}`;
}

/** "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias". */
export function haQuanto(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const s = (Date.now() - data(v).getTime()) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

export function numero(n: number | null | undefined, casas = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-PT", { maximumFractionDigits: casas });
}

export function pct(n: number | null | undefined, casas = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${numero(n, casas)}%`;
}

export function euros(cent: number | null | undefined): string {
  if (cent === null || cent === undefined) return "—";
  return (cent / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

/** Cartão branco do painel (papel, linha, raio 16). */
export function Cartao({
  children,
  className = "",
  as: Tag = "section",
  ...resto
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  const raio = /(^|\s)rounded-/.test(className) ? "" : "rounded-2xl";
  return (
    <Tag
      className={`${raio} border border-linha bg-papel ${className}`}
      {...resto}
    >
      {children}
    </Tag>
  );
}

/** Rótulo pequeno em maiúsculas ("AS PESSOAS PERGUNTAM ASSIM"). */
export function Rotulo({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-[11px] font-bold tracking-[0.4px] text-tinta-3 uppercase ${className}`}>
      {children}
    </p>
  );
}

/** Erro da API em linha (a mensagem já vem em português). */
export function ErroLinha({
  erro,
  className = "",
}: {
  erro: ErroApi | null | undefined;
  className?: string;
}) {
  if (!erro) return null;
  return (
    <p
      role="alert"
      className={`flex items-start gap-2 rounded-[10px] bg-terracota-suave/60 px-3 py-2 text-[13px] text-terracota-escuro ${className}`}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{erro.message}</span>
    </p>
  );
}

/** A carregar / erro / vazio, dentro de um cartão ou de uma lista. */
export function Estado({
  aCarregar,
  erro,
  vazio,
  textoVazio = "Ainda não há nada aqui.",
  children,
}: {
  aCarregar?: boolean;
  erro?: ErroApi | null;
  vazio?: boolean;
  textoVazio?: React.ReactNode;
  children?: React.ReactNode;
}) {
  if (erro) return <ErroLinha erro={erro} className="m-4" />;
  if (aCarregar && vazio !== false)
    return (
      <p className="p-5 text-sm text-tinta-3" aria-live="polite">
        A carregar…
      </p>
    );
  if (vazio) return <p className="p-5 text-sm text-tinta-3">{textoVazio}</p>;
  return <>{children}</>;
}

/** Página sem permissão (o perfil não tem o recurso). */
export function SemAcesso({ texto }: { texto?: string }) {
  return (
    <div className="mx-10 flex items-start gap-3 rounded-2xl border border-linha bg-papel p-5 text-sm text-tinta-2">
      <Lock className="mt-0.5 size-4 shrink-0 text-tinta-3" aria-hidden />
      <div>
        <p className="font-semibold text-tinta">O seu perfil não tem acesso a esta área.</p>
        <p className="mt-1">
          {texto ?? "Peça a quem gere a equipa da câmara para lhe dar acesso."}
        </p>
      </div>
    </div>
  );
}

/** Pílula de estado (verde / âmbar / terracota / neutra). */
export function Pilula({
  tom = "neutro",
  icone: Icone,
  children,
  className = "",
}: {
  tom?: "verde" | "ambar" | "terracota" | "neutro" | "tinta";
  icone?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
  className?: string;
}) {
  const tons = {
    verde: "bg-verde-suave text-verde",
    ambar: "bg-ambar-suave text-ambar",
    terracota: "bg-terracota-suave text-terracota-escuro",
    neutro: "bg-creme-2 text-tinta-2",
    tinta: "bg-tinta text-white",
  } as const;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-[5px] rounded-xl px-2.5 py-1 text-xs font-semibold sm:whitespace-nowrap ${tons[tom]} ${className}`}
    >
      {Icone && <Icone className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

/** Interruptor acessível (role="switch"). */
export function Interruptor({
  ligado,
  onMudar,
  rotulo,
  desativado,
}: {
  ligado: boolean;
  onMudar?: (v: boolean) => void;
  rotulo: string;
  desativado?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desativado}
      onClick={() => onMudar?.(!ligado)}
      className={`flex h-5 w-9 shrink-0 items-center rounded-[10px] p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        ligado ? "bg-verde" : "bg-linha"
      }`}
    >
      <span
        className={`size-4 rounded-full bg-white shadow-sm transition-transform ${
          ligado ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

/** Campo de formulário com rótulo visível. */
export function Campo({
  rotulo,
  ajuda,
  marca,
  children,
  className = "",
}: {
  rotulo: string;
  ajuda?: React.ReactNode;
  /** Junto ao rótulo (ex.: "sugerido, reveja"). */
  marca?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-2 ${className}`}>
      <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-tinta">
        {rotulo}
        {marca}
      </span>
      {children}
      {ajuda && <span className="text-xs text-tinta-3">{ajuda}</span>}
    </label>
  );
}

export const classeEntrada =
  "w-full rounded-[10px] border border-linha bg-creme px-3 py-2.5 text-sm text-tinta outline-none placeholder:text-tinta-3 focus:border-terracota disabled:opacity-60";

/** Janela de diálogo simples (sobreposição + cartão). */
export function Dialogo({
  titulo,
  aberto,
  onFechar,
  children,
  largura = "max-w-lg",
}: {
  titulo: string;
  aberto: boolean;
  onFechar: () => void;
  children: React.ReactNode;
  largura?: string;
}) {
  // Foco preso lá dentro, Esc fecha e o foco volta ao botão que o abriu.
  const caixa = useRef<HTMLDivElement>(null);
  useFocoPreso(caixa, aberto, onFechar);
  if (!aberto) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-tinta/40 p-6 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`w-full ${largura} rounded-2xl border border-linha bg-papel p-6 shadow-xl`}
      >
        <h2 className="font-display text-xl font-bold text-tinta">{titulo}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
