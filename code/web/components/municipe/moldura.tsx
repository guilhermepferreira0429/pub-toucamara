/*
 * Peças comuns das páginas dos links do SMS (munícipe, telemóvel): topo com
 * o logótipo, cabeçalho, cartão de destaque, linha "em que ponto está",
 * ajuda, estados de carregar/erro e o ecrã de link inválido.
 * Letra grande, contraste alto e um passo de cada vez (PRD: "fala como gente").
 */
import type { LucideIcon } from "lucide-react";
import {
  Check,
  ChevronRight,
  FlaskConical,
  LoaderCircle,
  MessageCircle,
  Phone,
  RotateCcw,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { Botao, BotaoLink } from "@/components/ui/botao";
import { Logo } from "@/components/ui/marca";

/** Página do chat no site (feita noutro ecrã). */
export const ROTA_CHAT = "/chat";

export function Topo({
  direita,
  mono = false,
}: {
  direita?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <header className="flex w-full items-center justify-between gap-3">
      <Logo tamanho={20} />
      {direita && (
        <span
          className={`text-right text-[13px] font-medium text-tinta-3 ${mono ? "font-mono font-semibold" : ""}`}
        >
          {direita}
        </span>
      )}
    </header>
  );
}

export function Cabecalho({
  meta,
  titulo,
  sub,
  grande = false,
}: {
  meta?: React.ReactNode;
  titulo: React.ReactNode;
  sub?: React.ReactNode;
  grande?: boolean;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {meta && (
        <p className="text-[12px] font-bold tracking-[1.2px] text-terracota uppercase">
          {meta}
        </p>
      )}
      <h1
        className={`font-display font-bold text-tinta ${grande ? "text-[36px] leading-[1.02] tracking-[-1px]" : "text-[30px] leading-[1.06] tracking-[-0.8px]"}`}
      >
        {titulo}
      </h1>
      {sub && <p className="text-[16px] leading-[1.45] text-tinta-2">{sub}</p>}
    </div>
  );
}

const TONS_DESTAQUE = {
  terracota: "bg-terracota",
  verde: "bg-verde",
  tinta: "bg-tinta",
} as const;

/** O cartão de cor com o canto de balão de fala (resposta curta, falta, valor). */
export function CartaoDestaque({
  rotulo,
  tom = "terracota",
  children,
  className,
}: {
  rotulo?: string;
  tom?: keyof typeof TONS_DESTAQUE;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex w-full flex-col gap-3 rounded-[24px_24px_24px_6px] p-5 text-white ${TONS_DESTAQUE[tom]} ${className ?? ""}`}
    >
      {rotulo && (
        <p className="text-[11px] font-bold tracking-[1px] text-white/90 uppercase">
          {rotulo}
        </p>
      )}
      {children}
    </section>
  );
}

export function TituloSecao({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <h2
      id={id}
      className="font-display text-[22px] font-bold tracking-[-0.4px] text-tinta"
    >
      {children}
    </h2>
  );
}

/** Rótulo pequeno em maiúsculas ("O QUE JÁ TEM E O QUE FALTA"). */
export function Rotulo({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <p
      id={id}
      className={`text-[11px] font-bold tracking-[1px] text-tinta-3 uppercase ${className ?? ""}`}
    >
      {children}
    </p>
  );
}

/** "modo de teste": tudo o que é simulado diz que o é. */
export function ModoTeste({ texto = "modo de teste" }: { texto?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ambar-suave px-2.5 py-1 text-[12px] font-semibold text-ambar">
      <FlaskConical className="size-3.5" aria-hidden />
      {texto}
    </span>
  );
}

const TONS_AVISO = {
  ambar: { caixa: "border-ambar bg-papel", icone: "text-ambar" },
  verde: { caixa: "border-verde/40 bg-verde-suave", icone: "text-verde" },
  neutro: { caixa: "border-linha bg-papel", icone: "text-tinta-2" },
  terracota: {
    caixa: "border-terracota/40 bg-terracota-suave",
    icone: "text-terracota-escuro",
  },
} as const;

/** Caixa de nota (simulação, aviso, erro de uma ação). */
export function Nota({
  icone: Icone,
  tom = "ambar",
  children,
  papel,
}: {
  icone: LucideIcon;
  tom?: keyof typeof TONS_AVISO;
  children: React.ReactNode;
  papel?: "alert" | "status";
}) {
  const t = TONS_AVISO[tom];
  return (
    <div
      role={papel}
      className={`flex w-full gap-2.5 rounded-xl border p-3 ${t.caixa}`}
    >
      <Icone className={`mt-0.5 size-4 shrink-0 ${t.icone}`} aria-hidden />
      <div className="text-[14px] leading-[1.45] text-tinta">{children}</div>
    </div>
  );
}

export type EstadoPasso = "feito" | "atual" | "por_fazer";

export interface Passo {
  titulo: string;
  detalhe?: React.ReactNode;
  estado: EstadoPasso;
  /** Detalhe em destaque (ex.: "Falta o termo de responsabilidade"). */
  alerta?: boolean;
}

/** "Em que ponto está": a linha vertical com marcas. */
export function Trilho({ passos }: { passos: Passo[] }) {
  return (
    <ol className="flex w-full flex-col">
      {passos.map((p, i) => {
        const ultimo = i === passos.length - 1;
        return (
          <li key={p.titulo} className="flex w-full gap-3.5">
            <div className="flex w-6 shrink-0 flex-col items-center">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                  p.estado === "feito"
                    ? "bg-verde"
                    : p.estado === "atual"
                      ? "bg-terracota"
                      : "border border-linha bg-papel"
                }`}
                aria-hidden
              >
                {p.estado === "feito" && (
                  <Check className="size-[13px] text-white" strokeWidth={3} />
                )}
                {p.estado === "atual" && (
                  <span className="size-2 rounded-full bg-white" />
                )}
              </span>
              {!ultimo && (
                <span
                  className={`min-h-[34px] w-0.5 flex-1 ${p.estado === "feito" ? "bg-verde" : "bg-linha"}`}
                  aria-hidden
                />
              )}
            </div>
            <div className={`flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5 ${ultimo ? "" : "pb-3"}`}>
              <p
                className={`text-[16px] ${p.estado === "por_fazer" ? "font-medium text-tinta-3" : "font-bold text-tinta"}`}
              >
                {p.titulo}
                <span className="sr-only">
                  {p.estado === "feito"
                    ? " (feito)"
                    : p.estado === "atual"
                      ? " (é aqui que está)"
                      : " (ainda não)"}
                </span>
              </p>
              {p.detalhe && (
                <p
                  className={`text-[14px] leading-[1.4] ${p.alerta ? "text-terracota-escuro" : "text-tinta-3"}`}
                >
                  {p.detalhe}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** "Dúvidas sobre o processo?": cartão que abre o chat. */
export function CartaoAjuda({
  titulo,
  detalhe = "Ligue ou escreva. Já sabemos qual é o seu caso.",
}: {
  titulo: string;
  detalhe?: string;
}) {
  return (
    <Link
      href={ROTA_CHAT}
      className="flex w-full items-center gap-3 rounded-2xl bg-creme-2 p-4 transition-colors hover:bg-linha/60"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-[18px_18px_18px_5px] bg-terracota font-display text-[19px] font-extrabold text-white"
      >
        ?
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold text-tinta">{titulo}</span>
        <span className="text-[14px] text-tinta-2">{detalhe}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-tinta-2" aria-hidden />
    </Link>
  );
}

/** "Ficou alguma dúvida?": ligar (se soubermos o número) e chat. */
export function MaisDuvidas({
  telefone,
  titulo = "Ficou alguma dúvida?",
  nota = "Esta página é informativa. A decisão final é sempre da câmara.",
}: {
  telefone?: string | null;
  titulo?: string;
  nota?: string | null;
}) {
  return (
    <section className="flex w-full flex-col gap-3 pt-2" aria-labelledby="duvidas">
      <TituloSecao id="duvidas">{titulo}</TituloSecao>
      {telefone && (
        <BotaoLink
          href={`tel:${telefone.replace(/\s/g, "")}`}
          tamanho="grande"
          icone={Phone}
          className="w-full"
        >
          Ligar outra vez
        </BotaoLink>
      )}
      <BotaoLink
        href={ROTA_CHAT}
        tamanho="grande"
        variante={telefone ? "secundario" : "principal"}
        icone={MessageCircle}
        className="w-full"
      >
        Escrever no chat
      </BotaoLink>
      {nota && (
        <p className="text-[13px] leading-[1.45] text-tinta-3">{nota}</p>
      )}
    </section>
  );
}

export function ACarregar({ texto = "A abrir…" }: { texto?: string }) {
  return (
    <div className="flex w-full flex-col gap-8">
      <Topo />
      <div
        role="status"
        className="flex flex-col items-center gap-3 py-16 text-tinta-2"
      >
        <LoaderCircle className="size-8 animate-spin text-terracota" aria-hidden />
        <p className="text-[16px]">{texto}</p>
      </div>
    </div>
  );
}

export function ErroCarregar({
  mensagem,
  onTentar,
}: {
  mensagem: string;
  onTentar: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-8">
      <Topo />
      <div role="alert" className="flex flex-col gap-4">
        <Cabecalho
          titulo="Não conseguimos abrir esta página."
          sub={mensagem}
        />
        <Botao
          tamanho="grande"
          icone={RotateCcw}
          onClick={onTentar}
          className="w-full"
        >
          Tentar outra vez
        </Botao>
      </div>
      <MaisDuvidas titulo="Precisa de ajuda?" nota={null} />
    </div>
  );
}

/** Ecrã do link que já não serve (também em /expirado). */
export function LinkInvalido() {
  return (
    <div className="flex w-full flex-col gap-8">
      <Topo />
      <div className="flex flex-col gap-5">
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-[28px_28px_28px_8px] bg-terracota-suave"
        >
          <Unlink className="size-7 text-terracota-escuro" />
        </span>
        <Cabecalho
          titulo="Este link já não é válido."
          sub="Por segurança, os links das mensagens só funcionam durante algum tempo. O seu pedido não se perdeu: continua guardado na câmara."
        />
      </div>
      <section className="flex flex-col gap-4" aria-labelledby="o-que-fazer">
        <TituloSecao id="o-que-fazer">O que pode fazer</TituloSecao>
        <ol className="flex flex-col gap-4">
          {[
            {
              t: "Ligue para a câmara",
              d: "O número está na mensagem que recebeu. Diga que o link já não abre.",
            },
            {
              t: "Ou escreva no chat",
              d: "Conte o que precisa. Mandamos um link novo, se for preciso.",
            },
            {
              t: "Ou vá ao balcão",
              d: "No horário de atendimento da câmara.",
            },
          ].map((p, i) => (
            <li key={p.t} className="flex gap-3.5">
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tinta text-[13px] font-bold text-white"
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5 pt-0.5">
                <span className="text-[16px] font-semibold text-tinta">{p.t}</span>
                <span className="text-[15px] leading-[1.45] text-tinta-2">{p.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
      <BotaoLink
        href={ROTA_CHAT}
        tamanho="grande"
        icone={MessageCircle}
        className="w-full"
      >
        Escrever no chat
      </BotaoLink>
    </div>
  );
}
