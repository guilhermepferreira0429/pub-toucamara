"use client";

import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  Check,
  FileText,
  FolderOpen,
  MapPin,
  MessageCircle,
  Phone,
  PhoneForwarded,
  Truck,
  UserRound,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Botao, BotaoLink } from "@/components/ui/botao";
import { Ecra, Rotulo, duracaoDita, relogio, telefoneDito } from "./comum";
import type { EstadoChamada, Feito } from "./registo";

const ICONES: Record<Feito["icone"], LucideIcon> = {
  requerimento: FileText,
  ocorrencia: MapPin,
  recolha: Truck,
  marcacao: CalendarCheck,
  passagem: UserRound,
  fonte: BadgeCheck,
  processo: FolderOpen,
};

function Titulo({ children, tamanho }: { children: string; tamanho: 36 | 40 }) {
  return (
    <h1
      className={`font-display font-bold text-tinta ${
        tamanho === 40
          ? "text-[40px] leading-[1.02] tracking-[-1.2px]"
          : "text-4xl leading-[1.05] tracking-[-1px]"
      }`}
    >
      {children}
    </h1>
  );
}

/* ───────────────────── 03d Chamada terminada (W20cB) ─────────────────── */

export function EcraTerminada({
  estado,
  segundos,
  telefone,
  onLigarOutraVez,
}: {
  estado: EstadoChamada;
  segundos: number;
  telefone: string | null;
  onLigarOutraVez: () => void;
}) {
  const feitos = estado.feitos.slice(-4);
  const titulo = estado.smsEnviado
    ? "Enviámos-lhe um SMS."
    : telefone
      ? "Vai receber um SMS."
      : "Obrigado por ligar.";
  const descricao = telefone
    ? `Para o ${telefoneDito(telefone)}, com os documentos, os links e a marcação. Guarde-o para levar ao balcão.`
    : "Se precisar de mais alguma coisa, ligue outra vez ou escreva-nos no chat.";

  return (
    <Ecra className="gap-7">
      <p
        role="status"
        className="flex w-fit items-center gap-2 rounded-full bg-verde-suave px-3 py-1.5 text-[13px] font-semibold text-verde"
      >
        <Check className="size-3.5" aria-hidden />
        Chamada terminada · {duracaoDita(segundos)}
      </p>
      <div className="flex flex-col gap-3">
        <Titulo tamanho={40}>{titulo}</Titulo>
        <p className="text-base leading-normal text-tinta-2">{descricao}</p>
      </div>

      {feitos.length > 0 && (
        <ul
          aria-label="O que ficou tratado"
          className="flex flex-col rounded-[18px] border border-linha bg-papel px-[18px] py-1.5"
        >
          {feitos.map((f) => {
            const Icone = ICONES[f.icone];
            return (
              <li
                key={f.chave}
                className="flex items-center gap-3.5 border-b border-linha py-3 last:border-b-0"
              >
                <Icone className="size-5 shrink-0 text-terracota" aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold text-tinta">
                    {f.titulo}
                  </span>
                  <span className="text-[13px] text-tinta-2">{f.detalhe}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto flex flex-col gap-3">
        {estado.link ? (
          <>
            <a
              href={estado.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-terracota px-6 text-[17px] font-semibold text-white hover:bg-terracota-escuro"
            >
              <ArrowRight className="size-5" aria-hidden />
              Ver o que tem de fazer
            </a>
            <Botao
              tamanho="grande"
              variante="secundario"
              icone={Phone}
              onClick={onLigarOutraVez}
              className="w-full"
            >
              Ligar outra vez
            </Botao>
          </>
        ) : (
          <>
            <Botao
              tamanho="grande"
              icone={Phone}
              onClick={onLigarOutraVez}
              className="w-full"
            >
              Ligar outra vez
            </Botao>
            <BotaoLink
              href="/chat"
              tamanho="grande"
              variante="secundario"
              icone={MessageCircle}
              className="w-full"
            >
              Escrever no chat
            </BotaoLink>
          </>
        )}
      </div>
    </Ecra>
  );
}

/* ─────────────────────── 03e Chamada caiu (sZOiY) ────────────────────── */

export function EcraCaiu({
  estado,
  segundos,
  chegouALigar,
  onLigar,
}: {
  estado: EstadoChamada;
  segundos: number;
  /** false: a chamada nem chegou a começar (rede, agente, permissões). */
  chegouALigar: boolean;
  onLigar: () => void;
}) {
  const ondeFicamos = estado.ultimaAgente;
  return (
    <Ecra className="gap-6">
      <p
        role="alert"
        className="flex w-fit items-center gap-2 rounded-full bg-ambar-suave px-3 py-1.5 text-[13px] font-semibold text-ambar"
      >
        <WifiOff className="size-3.5" aria-hidden />
        {chegouALigar
          ? `A ligação falhou aos ${relogio(segundos).replace(/^0/, "")}`
          : "Não foi possível ligar"}
      </p>
      <div className="flex flex-col gap-3">
        <Titulo tamanho={36}>
          {chegouALigar
            ? "A chamada caiu. Não perdeu nada."
            : "A chamada não chegou a começar."}
        </Titulo>
        <p className="text-base leading-normal text-tinta-2">
          {chegouALigar
            ? "Guardámos a conversa até aqui. Se voltar a ligar, continuamos onde parámos, sem repetir."
            : "Pode ser da rede. Tente outra vez daqui a pouco, ou escreva-nos no chat."}
        </p>
      </div>

      {chegouALigar && ondeFicamos && (
        <section className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-4">
          <Rotulo>Onde ficámos</Rotulo>
          <p className="text-sm leading-normal text-tinta">{ondeFicamos}</p>
        </section>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <Botao
          tamanho="grande"
          icone={chegouALigar ? PhoneForwarded : Phone}
          onClick={onLigar}
          className="w-full"
        >
          {chegouALigar ? "Ligar e continuar" : "Tentar outra vez"}
        </Botao>
        <BotaoLink
          href="/chat"
          tamanho="grande"
          variante="secundario"
          icone={MessageCircle}
          className="w-full"
        >
          Escrever no chat
        </BotaoLink>
        <p className="text-center text-xs text-tinta-3">
          Se a rede estiver fraca, o chat gasta menos dados.
        </p>
      </div>
    </Ecra>
  );
}
