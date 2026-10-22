"use client";

import {
  BellRing,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Clock,
  ExternalLink,
  FlaskConical,
  Landmark,
  MessageCircle,
  Phone,
  Receipt,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { API_URL } from "@/lib/api";
import {
  antecedenciaDita,
  diaPorExtenso,
  type Calendario,
  type EventoCalendario,
  type ItemLista,
} from "./tipos";

/*
 * A lista do que a empresa precisa e o calendário de obrigações, como a
 * página pública (link do SMS e /empresas) os mostra. Letra grande, um
 * cartão por item, e o que é de demonstração diz que o é.
 */

/** A marca "valores de demonstração" (o que não vem de uma fonte oficial). */
export function MarcaDemonstracao({ texto = "valores de demonstração" }: { texto?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-ambar-suave px-2.5 py-1 text-[12px] font-semibold text-ambar">
      <FlaskConical className="size-3.5" aria-hidden />
      {texto}
    </span>
  );
}

function Onde({ i }: { i: ItemLista }) {
  return i.onde === "camara" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-terracota-suave px-2.5 py-1 text-[12px] font-semibold text-terracota-escuro">
      <Landmark className="size-3.5" aria-hidden />
      Na câmara
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-creme-2 px-2.5 py-1 text-[12px] font-semibold text-tinta-2">
      <Building2 className="size-3.5" aria-hidden />
      Fora da câmara
    </span>
  );
}

/** O botão do que fazer: pedir ao agente, abrir o site certo, ou falar com a câmara. */
function Acao({ i }: { i: ItemLista }) {
  const base =
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[16px] font-semibold transition-colors";
  if (i.como.tipo === "agente") {
    return (
      <div className="flex flex-col gap-2">
        <Link href="/chat" className={`${base} bg-terracota text-white hover:bg-terracota-escuro`}>
          <MessageCircle className="size-5" aria-hidden />
          Pedir já no chat
        </Link>
        <p className="text-[14px] leading-[1.4] text-tinta-2">
          Diga: «{i.como.frase}». O agente verifica as regras na hora. Também pode{" "}
          <Link href="/ligar" className="font-semibold text-tinta underline underline-offset-2">
            ligar
          </Link>
          .
        </p>
      </div>
    );
  }
  if (i.como.tipo === "link") {
    return (
      <a
        href={i.como.url}
        target="_blank"
        rel="noreferrer"
        className={`${base} border-[1.5px] border-tinta text-tinta hover:bg-tinta/5`}
      >
        <ExternalLink className="size-5" aria-hidden />
        Abrir {i.entidade}
        <span className="sr-only"> (abre noutra janela)</span>
      </a>
    );
  }
  if (i.como.tipo === "camara") {
    return (
      <Link href="/chat" className={`${base} border-[1.5px] border-tinta text-tinta hover:bg-tinta/5`}>
        <MessageCircle className="size-5" aria-hidden />
        Falar com a câmara
      </Link>
    );
  }
  return null;
}

function Detalhe({
  icone: Icone,
  rotulo,
  children,
}: {
  icone: typeof Clock;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <Icone className="mt-0.5 size-4 shrink-0 text-tinta-2" aria-hidden />
      <p className="text-[15px] leading-[1.45] text-tinta">
        <span className="font-semibold">{rotulo}: </span>
        {children}
      </p>
    </div>
  );
}

export function ItemEmpresa({ i, n }: { i: ItemLista; n: number }) {
  const antecedencia = antecedenciaDita(i.antecedencia);
  const id = `item-${i.chave}`;
  return (
    <li>
      <article
        aria-labelledby={id}
        className="flex flex-col gap-3 rounded-[20px] border border-linha bg-papel p-4"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tinta text-[13px] font-bold text-white"
          >
            {n}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h3 id={id} className="font-display text-[19px] leading-tight font-bold text-tinta">
              {i.titulo}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <Onde i={i} />
              {i.estado === "confirmar" && (
                <span className="inline-flex items-center rounded-full bg-creme-2 px-2.5 py-1 text-[12px] font-semibold text-tinta-2">
                  Se ainda não tratou
                </span>
              )}
              {i.demonstracao && <MarcaDemonstracao />}
            </div>
          </div>
        </div>
        <p className="text-[15px] leading-[1.45] text-tinta">{i.o_que_e}</p>
        <div className="flex flex-col gap-2 rounded-xl bg-creme px-3 py-3">
          <Detalhe icone={BellRing} rotulo="Porquê">
            {i.porque.join(" ")}
          </Detalhe>
          <Detalhe icone={Landmark} rotulo="Onde">
            {i.entidade}
          </Detalhe>
          <Detalhe icone={Clock} rotulo="Prazo">
            {i.prazo}
            {antecedencia ? ` Pedir ${antecedencia}.` : ""}
          </Detalhe>
          <Detalhe icone={RefreshCw} rotulo="Quando">
            {i.periodicidade_texto}
          </Detalhe>
          {i.taxa && (
            <Detalhe icone={Receipt} rotulo="Taxa estimada">
              {i.taxa.texto}
            </Detalhe>
          )}
        </div>
        <Acao i={i} />
        <p className="text-[13px] leading-[1.45] text-tinta-2">
          Base:{" "}
          {i.fonte.url ? (
            <a href={i.fonte.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {i.fonte.titulo}
            </a>
          ) : (
            i.fonte.titulo
          )}
          {i.taxa?.fonte ? ` · Taxa: ${i.taxa.fonte}` : ""}
        </p>
      </article>
    </li>
  );
}

export function ListaEmpresa({ itens }: { itens: ItemLista[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {itens.map((i, k) => (
        <ItemEmpresa key={i.chave} i={i} n={k + 1} />
      ))}
    </ol>
  );
}

const ICONE_EVENTO: Record<EventoCalendario["tipo"], typeof Clock> = {
  renovar: RefreshCw,
  expira: CalendarCheck,
  evento: CalendarDays,
  tratar: Clock,
  abertura: Building2,
};

/** As datas, os lembretes sem data e o botão "Adicionar ao calendário". */
export function CalendarioEmpresa({
  calendario,
  ics,
}: {
  calendario: Calendario;
  /** Caminho da API do .ics (/v1/public/...), se houver. */
  ics?: string | null;
}) {
  const { eventos, lembretes } = calendario;
  return (
    <div className="flex flex-col gap-4">
      {eventos.length > 0 ? (
        <ol className="flex flex-col gap-2.5">
          {eventos.map((e) => {
            const Icone = ICONE_EVENTO[e.tipo];
            return (
              <li key={e.id} className="flex gap-3 rounded-2xl border border-linha bg-papel p-3.5">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-creme-2"
                >
                  <Icone className="size-[18px] text-tinta" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-[13px] font-bold tracking-[0.3px] text-terracota-escuro">
                    <time dateTime={e.data}>{diaPorExtenso(e.data)}</time>
                  </p>
                  <p className="text-[16px] font-semibold text-tinta">{e.titulo}</p>
                  <p className="text-[14px] leading-[1.45] text-tinta-2">{e.descricao}</p>
                  {e.demonstracao && (
                    <span className="mt-1">
                      <MarcaDemonstracao texto="data estimada" />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-[15px] text-tinta-2">
          Ainda não há datas: diga quando conta abrir, ou peça à câmara o calendário das licenças que já tem.
        </p>
      )}
      {ics && eventos.length > 0 && (
        <a
          href={`${API_URL}${ics}`}
          download
          className="inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-tinta px-6 text-[17px] font-semibold text-white transition-colors hover:bg-tinta/90"
        >
          <CalendarPlus className="size-5" aria-hidden />
          Adicionar ao calendário
          <span className="sr-only"> (ficheiro .ics)</span>
        </a>
      )}
      {lembretes.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="lembretes">
          <h3 id="lembretes" className="text-[16px] font-bold text-tinta">
            Sem data marcada
          </h3>
          <ul className="flex flex-col gap-2">
            {lembretes.map((l) => (
              <li key={l.titulo} className="rounded-xl bg-creme-2 px-3.5 py-3">
                <p className="text-[15px] font-semibold text-tinta">{l.titulo}</p>
                <p className="text-[14px] leading-[1.45] text-tinta-2">{l.texto}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="flex items-center gap-2 text-[13px] text-tinta-2">
        <Phone className="size-3.5 shrink-0" aria-hidden />
        A câmara também avisa por SMS antes de uma licença expirar.
      </p>
    </div>
  );
}
