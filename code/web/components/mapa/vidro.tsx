"use client";

import type { LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

/*
 * Peças em "vidro" (fundo translúcido com blur) para pôr por cima dos mapas:
 * botões redondos, chips de filtro com contagem, painéis e a bolha dos
 * marcadores (ícone grande e colorido + título). Os estilos estão em
 * mapa.css (classes mapa-*). Em alto contraste o vidro fica opaco.
 */

/** Botão redondo em vidro (bússola, localização, 2D/3D, zoom). 48 px. */
export const BotaoVidro = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; icone?: LucideIcon; ativo?: boolean }
>(function BotaoVidro({ rotulo, icone: Icone, ativo, children, className, ...resto }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={rotulo}
      title={rotulo}
      data-ativo={ativo ? "" : undefined}
      className={`mapa-vidro mapa-botao ${className ?? ""}`}
      {...resto}
    >
      {Icone ? <Icone className="size-[22px]" aria-hidden strokeWidth={2.25} /> : null}
      {children}
    </button>
  );
});

/** Chip de filtro em vidro: "Obras 8". `cor` = a bolinha do tipo. */
export function ChipVidro({
  ativo,
  onClick,
  children,
  contagem,
  cor,
  icone: Icone,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
  contagem?: number;
  cor?: string;
  icone?: LucideIcon;
}) {
  return (
    <button type="button" aria-pressed={ativo} onClick={onClick} className="mapa-vidro mapa-chip">
      {Icone ? (
        <span aria-hidden className="mapa-chip-icone" style={{ "--cor": cor ?? "#15263b" } as CSSProperties}>
          <Icone className="size-3.5" strokeWidth={2.5} />
        </span>
      ) : null}
      <span>{children}</span>
      {contagem !== undefined && <span className="mapa-chip-conta">{contagem}</span>}
    </button>
  );
}

/** Painel em vidro (folha inferior, painel lateral, barras). */
export function PainelVidro({
  children,
  className,
  ...resto
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`mapa-vidro mapa-painel ${className ?? ""}`} {...resto}>
      {children}
    </div>
  );
}

/**
 * A bolha dos marcadores: o ícone grande e colorido (com volume) e, ao lado
 * de baixo, uma bolha em vidro com o título e uma linha curta. A ponta em
 * baixo marca o sítio (âncora "baixo"). Só desenho: quem a põe no mapa dá-lhe
 * o nome acessível e o foco.
 */
export function BolhaMarcador({
  icone: Icone,
  cor,
  titulo,
  meta,
  contagem,
  compacta,
  selecionada,
  pulsar,
}: {
  icone: LucideIcon;
  cor: string;
  titulo: string;
  meta?: string | null;
  /** Número no canto do ícone (ex.: avisos juntos). */
  contagem?: number;
  /** Só o ícone (muitos marcadores, zoom afastado). */
  compacta?: boolean;
  selecionada?: boolean;
  /** Emergência: um anel a pulsar (parado com menos movimento). */
  pulsar?: boolean;
}) {
  return (
    <span
      className="mapa-bolha"
      data-selecionada={selecionada ? "" : undefined}
      data-compacta={compacta ? "" : undefined}
      style={{ "--cor": cor } as CSSProperties}
      aria-hidden
    >
      <span className="mapa-bolha-icone">
        {pulsar && <span className="mapa-pulso" />}
        <Icone className="size-[26px]" strokeWidth={2.25} color="#fff" />
        {contagem !== undefined && contagem > 1 && <span className="mapa-bolha-conta">{contagem}</span>}
      </span>
      {/* Compacta: o título só aparece ao passar o rato ou com o foco. */}
      <span className="mapa-vidro mapa-bolha-texto">
        <span className="mapa-bolha-titulo">{titulo}</span>
        {meta && <span className="mapa-bolha-meta">{meta}</span>}
      </span>
      <span className="mapa-bolha-pe" />
    </span>
  );
}

/** O ponto "está aqui" (azul-escuro com halo). */
export function PontoAqui() {
  return (
    <span className="mapa-aqui" aria-hidden>
      <span className="mapa-aqui-halo" />
      <span className="mapa-aqui-ponto" />
    </span>
  );
}

/** Pino simples (escolher um ponto num formulário, ponto de um processo). */
export function Pino({ cor = "#b84a24" }: { cor?: string }) {
  return <span className="mapa-pino" style={{ "--cor": cor } as CSSProperties} aria-hidden />;
}
