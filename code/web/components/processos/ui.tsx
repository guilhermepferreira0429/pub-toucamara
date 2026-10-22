"use client";

import type { LucideIcon } from "lucide-react";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ROLO_SEPARADORES } from "@/components/painel/rolo";
import { ErroApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

/*
 * Peças pequenas partilhadas pelos ecrãs dos processos e das ocorrências:
 * leitura da API com estado, etiquetas do design, separadores, cartões e
 * diálogo acessível.
 */

export function paraErro(e: unknown): ErroApi {
  if (e instanceof ErroApi) return e;
  return new ErroApi(0, "erro", "Ocorreu um erro. Tente outra vez.");
}

interface Resultado<T> {
  chave: string;
  dados?: T;
  erro?: ErroApi;
}

/**
 * GET autenticado com estado. `caminho` null não pede nada. Ao recarregar
 * mantém os dados anteriores à vista até chegarem os novos.
 */
export function usePedido<T>(caminho: string | null) {
  const { pedido } = useSessao();
  const [versao, setVersao] = useState(0);
  const [r, setR] = useState<Resultado<T> | null>(null);
  const chave = caminho ? `${caminho}#${versao}` : null;

  useEffect(() => {
    if (!caminho || !chave) return;
    const ac = new AbortController();
    pedido<T>(caminho, { sinal: ac.signal }).then(
      (dados) => setR({ chave, dados }),
      (e: unknown) => {
        if ((e as Error)?.name !== "AbortError") {
          setR({ chave, erro: paraErro(e) });
        }
      },
    );
    return () => ac.abort();
  }, [caminho, chave, pedido]);

  const atual = r && r.chave === chave ? r : null;
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const definir = useCallback(
    (dados: T) => {
      if (chave) setR({ chave, dados });
    },
    [chave],
  );
  return {
    dados: atual ? atual.dados : r?.dados,
    erro: atual?.erro ?? null,
    aCarregar: !!chave && !atual,
    recarregar,
    definir,
  };
}

// ---------------------------------------------------------------------------

export type TomChip =
  | "neutro"
  | "tinta"
  | "terracota"
  | "verde"
  | "ambar"
  | "erro"
  | "papel";

const TONS_CHIP: Record<TomChip, string> = {
  neutro: "bg-creme-2 text-tinta-2",
  tinta: "bg-tinta text-white",
  terracota: "bg-terracota-suave text-terracota-escuro",
  verde: "bg-verde-suave text-verde",
  ambar: "bg-ambar-suave text-ambar",
  erro: "bg-[#F8DCD6] text-[#8E2216]",
  papel: "bg-papel text-tinta-2 border border-linha",
};

/** Etiqueta do design (12 px, cantos de 12 px, ícone opcional). */
export function Chip({
  tom = "neutro",
  icone: Icone,
  pequeno,
  children,
  className,
  title,
}: {
  tom?: TomChip;
  icone?: LucideIcon;
  pequeno?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap font-semibold ${
        pequeno
          ? "rounded-[11px] px-[9px] py-[3px] text-[11px]"
          : "rounded-xl px-2.5 py-1 text-xs"
      } ${TONS_CHIP[tom]} ${className ?? ""}`}
    >
      {Icone && (
        <Icone
          className={pequeno ? "size-3" : "size-[13px]"}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/** Rótulo de secção ("LINHA DO TEMPO", "DOCUMENTOS"). */
export function RotuloSeccao({
  children,
  as: Tag = "h2",
  className,
}: {
  children: React.ReactNode;
  as?: "h2" | "h3" | "p";
  className?: string;
}) {
  return (
    <Tag
      className={`text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3 ${className ?? ""}`}
    >
      {children}
    </Tag>
  );
}

export function Cartao({
  children,
  className,
  as: Tag = "section",
  ...resto
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div" | "aside";
} & React.AriaAttributes) {
  return (
    <Tag
      className={`rounded-2xl border border-linha bg-papel ${className ?? ""}`}
      {...resto}
    >
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------

export interface OpcaoSegmento<V extends string> {
  valor: V;
  rotulo: string;
  contagem?: number | null;
}

/** Separadores em cápsula (fundo creme-2, ativo em papel). */
export function Segmentado<V extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
  pequeno,
  fundo = "bg-creme-2",
}: {
  opcoes: OpcaoSegmento<V>[];
  valor: V;
  onChange: (v: V) => void;
  rotulo: string;
  pequeno?: boolean;
  fundo?: string;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={`inline-flex items-center gap-1 ${fundo} ${pequeno ? "rounded-[10px] p-1" : "rounded-xl p-1"}`}
    >
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.valor)}
            className={`inline-flex items-center gap-1.5 transition-colors ${
              pequeno
                ? "rounded-[7px] px-3 py-1.5 text-xs"
                : "rounded-[9px] px-3.5 py-2 text-[13px]"
            } ${
              ativo
                ? "bg-papel font-bold text-tinta shadow-[0_1px_2px_rgba(21,38,59,0.06)]"
                : "font-medium text-tinta-2 hover:text-tinta"
            }`}
          >
            {o.rotulo}
            {o.contagem !== undefined && o.contagem !== null && (
              <span className="text-xs font-normal text-tinta-3">
                {o.contagem}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A mesma cápsula, mas de navegação (links). */
export function SeparadoresLinks({
  itens,
  atual,
  rotulo,
}: {
  itens: { href: string; rotulo: string }[];
  atual: string;
  rotulo: string;
}) {
  return (
    <nav aria-label={rotulo} className="max-w-full">
      <ul
        className={`inline-flex max-w-full items-center gap-1 rounded-xl bg-creme-2 p-1 ${ROLO_SEPARADORES}`}
      >
        {itens.map((i) => {
          const ativo = i.href === atual;
          return (
            <li key={i.href} className="shrink-0">
              <Link
                href={i.href}
                aria-current={ativo ? "page" : undefined}
                className={`inline-flex whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[13px] transition-colors ${
                  ativo
                    ? "bg-papel font-bold text-tinta"
                    : "font-medium text-tinta-2 hover:text-tinta"
                }`}
              >
                {i.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------

/**
 * Botões retangulares do painel dos processos (40 px, cantos de 10 px, como
 * "Pedir documento" e "Abrir apoio ao técnico"); os da base são cápsulas.
 */
export type VarianteBotao = "principal" | "contorno" | "tinta" | "texto";

export function classesBotao(
  v: VarianteBotao = "contorno",
  pequeno = false,
  grande = false,
) {
  const base = `inline-flex shrink-0 items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    grande
      ? "h-[46px] rounded-[23px] px-5 text-sm"
      : pequeno
        ? "h-9 rounded-[10px] px-3 text-xs"
        : "h-10 rounded-[10px] px-4 text-[13px]"
  }`;
  const tons: Record<VarianteBotao, string> = {
    principal: "bg-terracota text-white hover:bg-terracota-escuro",
    contorno: "border border-linha bg-papel text-tinta hover:bg-creme",
    tinta: "bg-tinta text-white hover:bg-tinta/90",
    texto: "text-tinta hover:bg-creme-2",
  };
  return `${base} ${tons[v]}`;
}

export function BotaoPainel({
  variante = "contorno",
  pequeno,
  grande,
  icone: Icone,
  className,
  children,
  ...resto
}: {
  variante?: VarianteBotao;
  pequeno?: boolean;
  grande?: boolean;
  icone?: LucideIcon;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={`${classesBotao(variante, pequeno, grande)} ${className ?? ""}`}
      {...resto}
    >
      {Icone && <Icone className={pequeno ? "size-3.5" : "size-4"} aria-hidden />}
      {children}
    </button>
  );
}

export function LinkPainel({
  variante = "contorno",
  pequeno,
  icone: Icone,
  className,
  children,
  ...resto
}: {
  variante?: VarianteBotao;
  pequeno?: boolean;
  icone?: LucideIcon;
} & React.ComponentProps<typeof Link>) {
  return (
    <Link className={`${classesBotao(variante, pequeno)} ${className ?? ""}`} {...resto}>
      {Icone && <Icone className={pequeno ? "size-3.5" : "size-4"} aria-hidden />}
      {children}
    </Link>
  );
}

/** Classes dos campos do design (40 px, cantos de 10 px). */
export const CAMPO =
  "h-10 w-full rounded-[10px] border border-linha bg-papel px-3 text-[13px] text-tinta placeholder:text-tinta-3 disabled:opacity-60";
export const CAMPO_CREME =
  "h-10 w-full rounded-[10px] border border-transparent bg-creme px-3 text-[13px] font-medium text-tinta disabled:opacity-60";
export const AREA_TEXTO =
  "w-full rounded-[10px] border border-linha bg-papel px-3 py-2.5 text-[13px] text-tinta placeholder:text-tinta-3 disabled:opacity-60";

/** Campo com rótulo visível. */
export function Campo({
  rotulo,
  ajuda,
  children,
  className,
}: {
  rotulo: string;
  ajuda?: string;
  children: (id: string) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="text-xs font-semibold text-tinta-2">
        {rotulo}
      </label>
      {children(id)}
      {ajuda && <p className="text-xs text-tinta-3">{ajuda}</p>}
    </div>
  );
}

export function ErroEmLinha({ erro }: { erro: ErroApi | string | null }) {
  if (!erro) return null;
  return (
    <p role="alert" className="text-[13px] font-medium text-terracota-escuro">
      {typeof erro === "string" ? erro : erro.message}
    </p>
  );
}

export function ACarregar({
  texto = "A carregar…",
  className,
}: {
  texto?: string;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`flex items-center gap-2 text-sm text-tinta-3 ${className ?? ""}`}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {texto}
    </p>
  );
}

/** Mensagem de sucesso/aviso efémera (anunciada a leitores de ecrã). */
export function Nota({
  tom = "verde",
  children,
  onFechar,
}: {
  tom?: "verde" | "ambar" | "erro";
  children: React.ReactNode;
  onFechar?: () => void;
}) {
  const tons = {
    verde: "bg-verde-suave text-verde",
    ambar: "bg-ambar-suave text-ambar",
    erro: "bg-[#F8DCD6] text-[#8E2216]",
  } as const;
  return (
    <div
      role={tom === "erro" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium ${tons[tom]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onFechar && (
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar aviso"
          className="rounded p-0.5 hover:bg-black/5"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Diálogo modal (elemento <dialog>: foco preso, Esc fecha). Fundo tinta a
 * 50 %, cartão em papel com cantos de 20 px, como "Assinar o parecer".
 */
export function Dialogo({
  aberto,
  onFechar,
  titulo,
  descricao,
  children,
  largura = "max-w-[460px]",
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  descricao?: React.ReactNode;
  children: React.ReactNode;
  largura?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const idDescricao = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      aria-describedby={descricao ? idDescricao : undefined}
      onClose={onFechar}
      onCancel={(e) => {
        e.preventDefault();
        onFechar();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onFechar();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${largura} rounded-[20px] bg-papel p-0 text-tinta backdrop:bg-tinta/50`}
    >
      {aberto && (
        <div className="flex flex-col gap-[18px] p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2
                id={idTitulo}
                className="font-display text-[22px] font-bold leading-tight text-tinta"
              >
                {titulo}
              </h2>
              {descricao && (
                <div id={idDescricao} className="text-[13px] text-tinta-2">
                  {descricao}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar"
              className="rounded-full p-1 text-tinta-3 hover:bg-creme-2 hover:text-tinta"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
