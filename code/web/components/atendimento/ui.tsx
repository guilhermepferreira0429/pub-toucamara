import { RefreshCw, type LucideIcon } from "lucide-react";
import { ROLO_SEPARADORES } from "@/components/painel/rolo";
import { caraDemo } from "@/lib/caras";
import { resultado, TONS, type Tom } from "./formatos";

/* Peças visuais repetidas nos ecrãs de atendimento (design: cartões em papel). */

export function Cartao({
  titulo,
  sub,
  acao,
  escuro,
  className,
  children,
  id,
}: {
  titulo?: React.ReactNode;
  sub?: React.ReactNode;
  acao?: React.ReactNode;
  escuro?: boolean;
  className?: string;
  children?: React.ReactNode;
  id?: string;
}) {
  const tituloId = id ? `${id}-titulo` : undefined;
  return (
    <section
      aria-labelledby={titulo ? tituloId : undefined}
      className={`flex min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-6 ${
        escuro ? "bg-tinta text-white" : "border border-linha bg-papel"
      } ${className ?? ""}`}
    >
      {/* No telemóvel a ação (legenda, ligação) fica numa linha própria. */}
      {(titulo || acao) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {titulo && (
              <h2
                id={tituloId}
                className={`font-display text-xl font-bold tracking-[-0.3px] ${
                  escuro ? "text-white" : "text-tinta"
                }`}
              >
                {titulo}
              </h2>
            )}
            {sub && (
              <p className={`text-[13px] ${escuro ? "text-white/70" : "text-tinta-2"}`}>
                {sub}
              </p>
            )}
          </div>
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

/** Rótulo em maiúsculas (secções dos painéis laterais). */
export function Rotulo({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[11px] font-bold tracking-[1px] text-tinta-3 uppercase ${className ?? ""}`}
    >
      {children}
    </p>
  );
}

export function Pilula({
  tom = "neutro",
  icone: Icone,
  children,
  className,
}: {
  tom?: Tom;
  icone?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-[5px] rounded-xl px-[9px] py-1 text-[11px] font-semibold ${TONS[tom]} ${className ?? ""}`}
    >
      {Icone && <Icone className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

export function EstadoResultado({ valor }: { valor: string }) {
  const r = resultado(valor);
  return (
    <Pilula tom={r.tom} icone={r.icone}>
      {r.rotulo}
    </Pilula>
  );
}

/** O balão do agente ("?" no balão de fala da marca). */
export function AvatarAgente({ tamanho = 30 }: { tamanho?: 30 | 32 | 34 | 88 }) {
  const classes = {
    30: "size-[30px] rounded-[15px_15px_15px_4px] text-base",
    32: "size-8 rounded-[16px_16px_16px_4px] text-[17px]",
    34: "size-[34px] rounded-[17px_17px_17px_4px] text-lg",
    88: "size-[88px] rounded-[44px_44px_44px_10px] text-[52px]",
  } as const;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center bg-terracota font-display font-extrabold text-white ${classes[tamanho]}`}
    >
      ?
    </span>
  );
}

/**
 * A cara de uma pessoa fictícia da demonstração (lib/caras.ts); nada para as
 * outras. Decorativa: o nome está sempre ao lado.
 */
export function Cara({ telefone, tamanho = 32 }: { telefone: string | null | undefined; tamanho?: number }) {
  const src = caraDemo(telefone);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- retrato pequeno e estático da demonstração
    <img
      src={src}
      alt=""
      width={tamanho}
      height={tamanho}
      loading="lazy"
      className="shrink-0 rounded-full border-[1.5px] border-papel bg-creme-2 object-cover"
      style={{ width: tamanho, height: tamanho }}
    />
  );
}

/** Blocos cinzentos enquanto carrega. */
export function Esqueleto({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-creme-2/70 ${className ?? "h-24"}`}
    />
  );
}

export function ACarregar({ texto = "A carregar…" }: { texto?: string }) {
  return (
    <p role="status" className="py-6 text-center text-sm text-tinta-3">
      {texto}
    </p>
  );
}

/** Erro de leitura, com a mensagem da API e "Tentar outra vez". */
export function ErroBloco({
  mensagem,
  tentar,
  className,
}: {
  mensagem: string;
  tentar?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-terracota/30 bg-terracota-suave/40 px-4 py-3 text-sm text-terracota-escuro ${className ?? ""}`}
    >
      <span>{mensagem}</span>
      {tentar && (
        <button
          type="button"
          onClick={tentar}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-semibold hover:bg-terracota-suave"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Tentar outra vez
        </button>
      )}
    </div>
  );
}

/** Estado vazio dentro de um cartão ou lista. */
export function Vazio({
  icone: Icone,
  titulo,
  children,
  className,
}: {
  icone?: LucideIcon;
  titulo: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 px-6 py-10 text-center ${className ?? ""}`}
    >
      {Icone && (
        <span className="flex size-10 items-center justify-center rounded-full bg-creme-2 text-tinta-2">
          <Icone className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-semibold text-tinta">{titulo}</p>
      {children && <div className="max-w-sm text-[13px] text-tinta-2">{children}</div>}
    </div>
  );
}

/** Separadores com contagem e sublinhado terracota (design "Canais"). */
export function Separadores<T extends string>({
  opcoes,
  valor,
  mudar,
  rotulo,
}: {
  opcoes: { valor: T; rotulo: string; n?: number }[];
  valor: T;
  mudar: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div role="tablist" aria-label={rotulo} className={`flex gap-5 overflow-x-auto ${ROLO_SEPARADORES}`}>
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => mudar(o.valor)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 pb-3 text-sm ${
              ativo
                ? "border-terracota font-bold text-tinta"
                : "border-transparent font-medium text-tinta-2 hover:text-tinta"
            }`}
          >
            {o.rotulo}
            {o.n !== undefined && (
              <span className="text-xs font-normal text-tinta-3">{o.n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Linha "Campo · Valor" das fichas. */
export function LinhaFicha({
  campo,
  children,
  largura = "w-[84px]",
}: {
  campo: string;
  children: React.ReactNode;
  largura?: string;
}) {
  return (
    <div className="flex gap-3 border-t border-linha py-[9px]">
      <dt className={`shrink-0 text-xs text-tinta-3 ${largura}`}>{campo}</dt>
      <dd className="min-w-0 flex-1 text-[13px] font-medium leading-[1.4] text-tinta">
        {children}
      </dd>
    </div>
  );
}

/** Botão "carregar mais" das listas por cursor. */
export function CarregarMais({
  ha,
  aCarregar,
  erro,
  carregar,
}: {
  ha: boolean;
  aCarregar: boolean;
  erro: string | null;
  carregar: () => void;
}) {
  if (!ha && !erro) return null;
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      {erro && <p className="text-[13px] text-terracota-escuro">{erro}</p>}
      {ha && (
        <button
          type="button"
          onClick={carregar}
          disabled={aCarregar}
          className="rounded-full border border-linha bg-papel px-4 py-2 text-[13px] font-semibold text-tinta hover:bg-creme disabled:opacity-60"
        >
          {aCarregar ? "A carregar…" : "Carregar mais"}
        </button>
      )}
    </div>
  );
}
