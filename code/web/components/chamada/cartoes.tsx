"use client";

import {
  CalendarCheck,
  Check,
  CircleCheck,
  Clock4,
  ExternalLink,
  FilePenLine,
  FileCheck2,
  MapPinCheck,
  Phone,
  ShieldCheck,
  Siren,
  TriangleAlert,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Cartao } from "./registo";

/*
 * Cartões do que o agente está a fazer durante a chamada (design 07, 11, 13
 * e 19), montados a partir dos resultados das ferramentas da nossa API.
 */

function Moldura({
  cor,
  children,
  rotulo,
}: {
  cor: "terracota" | "verde" | "linha";
  children: ReactNode;
  rotulo: string;
}) {
  const borda = {
    terracota: "border-terracota",
    verde: "border-verde",
    linha: "border-linha",
  }[cor];
  return (
    <section
      aria-label={rotulo}
      className={`flex w-full flex-col overflow-hidden rounded-[20px_20px_20px_6px] border bg-papel ${borda}`}
    >
      {children}
    </section>
  );
}

function Topo({
  icone: Icone,
  cor,
  titulo,
  subtitulo,
  direita,
  mono,
}: {
  icone: LucideIcon;
  cor: "terracota" | "verde";
  titulo: string;
  subtitulo?: string;
  direita?: string | null;
  mono?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 px-3.5 py-3 ${cor === "verde" ? "bg-verde" : "bg-terracota"}`}
    >
      <Icone className="size-[18px] shrink-0 text-white" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-bold text-white">{titulo}</span>
        {subtitulo && (
          <span className="truncate text-[11px] text-white/80">{subtitulo}</span>
        )}
      </span>
      {direita && (
        <span
          className={`shrink-0 font-bold ${mono ? "font-mono text-xs text-white/80" : "text-[13px] text-white"}`}
        >
          {direita}
        </span>
      )}
    </div>
  );
}

function Linha({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col gap-px border-b border-linha px-3.5 py-[9px] last:border-b-0">
      <span className="text-[11px] text-tinta-3">{k}</span>
      <span className="text-sm font-semibold text-tinta">{v}</span>
    </div>
  );
}

/** NIF dito em voz alta: só o primeiro e os três últimos algarismos. */
function esconderNif(texto: string): string {
  const d = texto.replace(/\D/g, "");
  if (d.length < 4) return "•••";
  return `${d[0]}•• ••• ${d.slice(-3)}`;
}

/* 07 Requerimento ao vivo (cq963) */
function Requerimento({ c }: { c: Extract<Cartao, { tipo: "requerimento" }> }) {
  const feitos = new Set(c.preenchidos);
  const atual =
    c.campos.find((x) => c.proxima && x.pergunta === c.proxima) ??
    (c.concluido
      ? undefined
      : c.campos.find((x) => x.obrigatorio && !feitos.has(x.chave)));
  const total = c.campos.filter((x) => x.obrigatorio).length || c.campos.length;
  const contagem = Math.min(
    total,
    c.campos.filter((x) => feitos.has(x.chave) && x.obrigatorio).length,
  );
  // Os últimos preenchidos e o que se está a perguntar (o cartão não cresce).
  const visiveis = c.campos
    .filter((x) => feitos.has(x.chave))
    .slice(atual ? -4 : -5);

  return (
    <Moldura cor={c.concluido ? "verde" : "terracota"} rotulo="Requerimento">
      <Topo
        icone={c.concluido ? FileCheck2 : FilePenLine}
        cor={c.concluido ? "verde" : "terracota"}
        titulo={c.concluido ? "Requerimento pronto" : "A preencher consigo"}
        subtitulo={`Formulário oficial · ${c.nomeTipo.toLowerCase()}`}
        direita={`${contagem} de ${total}`}
      />
      {visiveis.map((x) => {
        const valor = c.valores[x.chave];
        return (
          <div
            key={x.chave}
            className="flex items-center gap-2.5 border-b border-linha px-3.5 py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-[11px] text-tinta-3">{x.rotulo}</span>
              <span className="truncate text-sm font-semibold text-tinta">
                {valor
                  ? /nif/i.test(x.chave)
                    ? esconderNif(valor)
                    : valor
                  : "Gravado"}
              </span>
            </span>
            <CircleCheck
              className="size-[18px] shrink-0 text-verde"
              aria-label="preenchido"
            />
          </div>
        );
      })}
      {atual && (
        <div className="flex items-center gap-2.5 bg-terracota-suave px-3.5 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-[11px] text-tinta-3">{atual.rotulo}</span>
            <span className="text-sm font-semibold text-terracota-escuro">
              a perguntar…
            </span>
          </span>
          <span
            aria-hidden
            className="h-5 w-0.5 bg-terracota motion-safe:animate-pulse"
          />
        </div>
      )}
      {c.concluido && (
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <p className="text-sm text-tinta-2">
            {c.concluido.faltam.length
              ? `Falta enviar: ${c.concluido.faltam.join(", ")}.`
              : "Vai receber um SMS com o link para rever e assinar."}
          </p>
          {c.concluido.link && (
            <a
              href={c.concluido.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-terracota-escuro underline underline-offset-2"
            >
              Rever e assinar
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      )}
    </Moldura>
  );
}

/* 11 Ocorrência por voz (XgBVh) */
function Ocorrencia({ c }: { c: Extract<Cartao, { tipo: "ocorrencia" }> }) {
  return (
    <Moldura cor="verde" rotulo="Ocorrência">
      <Topo
        icone={MapPinCheck}
        cor="verde"
        titulo={c.duplicada ? "Já estava reportada" : "Ocorrência registada"}
        direita={c.numero}
        mono
      />
      <Linha k="O quê" v={c.categoria ?? "Problema na via pública"} />
      <Linha
        k="Onde"
        v={c.noMapa ? "Confirmada no mapa" : "Por confirmar no mapa pela equipa"}
      />
      <Linha
        k="Aviso"
        v={
          c.duplicada
            ? "Juntámos o seu aviso: avisamos quando estiver resolvida"
            : c.sms
              ? "SMS enviado, com link para juntar uma fotografia"
              : "Avisamos quando a equipa resolver"
        }
      />
    </Moldura>
  );
}

/* 13 Estado do processo (YcytO) */
const FASES = ["Entrada", "Documentos", "Técnico", "Decisão"];
function indiceFase(fase: string): number {
  const f = fase.toLowerCase();
  if (f.startsWith("entrada")) return 0;
  if (f.startsWith("documentos")) return 1;
  if (f.startsWith("aprecia") || f.startsWith("pareceres")) return 2;
  if (f.startsWith("decis")) return 3;
  if (f.startsWith("notific") || f.startsWith("arquiv")) return 4;
  return 1;
}

function dataDita(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

function Processo({
  c,
  identificadoNif,
}: {
  c: Extract<Cartao, { tipo: "processo" }>;
  identificadoNif: boolean;
}) {
  const atual = indiceFase(c.fase);
  return (
    <>
      <p className="flex w-fit items-center gap-2 rounded-[10px] bg-verde-suave px-3 py-2 text-xs font-semibold text-verde">
        <ShieldCheck className="size-3.5" aria-hidden />
        {identificadoNif
          ? "Identificada pelo telemóvel e pelo NIF"
          : "Identificada pelo número de telemóvel"}
      </p>
      <section
        aria-label="Estado do processo"
        className="flex w-full flex-col gap-3 rounded-[20px_20px_20px_6px] border border-linha bg-papel p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-bold text-tinta">{c.titulo}</span>
          <span className="shrink-0 font-mono text-xs font-semibold text-tinta-3">
            {c.numero}
          </span>
        </div>
        <ol className="flex gap-1" aria-label={`Fase atual: ${c.fase}`}>
          {FASES.map((f, i) => (
            <li key={f} className="flex flex-1 flex-col gap-[5px]">
              <span
                aria-hidden
                className={`h-1.5 rounded-[3px] ${
                  i < atual ? "bg-verde" : i === atual ? "bg-terracota" : "bg-linha"
                }`}
              />
              <span
                className={`text-[11px] ${
                  i === atual
                    ? "font-bold text-tinta"
                    : i < atual
                      ? "font-medium text-tinta"
                      : "font-medium text-tinta-3"
                }`}
              >
                {f}
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {c.diasUteis != null && (
            <span className="flex items-center gap-[5px] rounded-[11px] bg-creme-2 px-[9px] py-1 text-[11px] font-semibold text-tinta-2">
              <Clock4 className="size-3" aria-hidden />
              Faltam {c.diasUteis} dias úteis
            </span>
          )}
          {c.faltam.length ? (
            c.faltam.map((f) => (
              <span
                key={f.nome}
                className="flex items-center gap-[5px] rounded-[11px] bg-ambar-suave px-[9px] py-1 text-[11px] font-semibold text-ambar"
              >
                <TriangleAlert className="size-3" aria-hidden />
                Falta {f.nome}
                {f.prazo ? ` até ${dataDita(f.prazo)}` : ""}
              </span>
            ))
          ) : (
            <span className="flex items-center gap-[5px] rounded-[11px] bg-verde-suave px-[9px] py-1 text-[11px] font-semibold text-verde">
              <Check className="size-3" aria-hidden />
              Nada em falta da sua parte
            </span>
          )}
        </div>
        {c.outros > 0 && (
          <p className="text-xs text-tinta-3">
            E mais {c.outros} {c.outros === 1 ? "processo" : "processos"} em curso.
          </p>
        )}
      </section>
    </>
  );
}

/* 19 Recolha de monos (R4d2tN) */
function Recolha({ c }: { c: Extract<Cartao, { tipo: "recolha" }> }) {
  const itens = c.itens.map((i) => `${i.qtd} ${i.item}`);
  const ditos =
    itens.length > 1
      ? `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`
      : itens.join("");
  return (
    <Moldura cor="verde" rotulo="Recolha de monos">
      <Topo icone={Truck} cor="verde" titulo="Recolha marcada" />
      <Linha k="Quando" v={c.quando} />
      {c.morada && <Linha k="Onde" v={`À porta · ${c.morada}`} />}
      {ditos && <Linha k="O quê" v={`${ditos} · gratuito`} />}
      {c.entidade && <Linha k="Quem" v={c.entidade} />}
    </Moldura>
  );
}

function Marcacao({ c }: { c: Extract<Cartao, { tipo: "marcacao" }> }) {
  return (
    <Moldura cor="verde" rotulo="Atendimento marcado">
      <Topo icone={CalendarCheck} cor="verde" titulo="Atendimento marcado" />
      <Linha k="Quando" v={c.quando} />
      {c.onde && <Linha k="Onde" v={c.onde} />}
      {c.levar.length > 0 && <Linha k="Levar" v={c.levar.join(", ")} />}
    </Moldura>
  );
}

function Emergencia() {
  return (
    <section
      role="alert"
      className="flex w-full flex-col gap-3 rounded-[20px_20px_20px_6px] border border-terracota bg-terracota-suave p-4"
    >
      <p className="flex items-center gap-2 text-base font-bold text-terracota-escuro">
        <Siren className="size-5" aria-hidden />
        É uma emergência: ligue já para o 112
      </p>
      <a
        href="tel:112"
        className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[#C62F1F] text-[17px] font-semibold text-white"
      >
        <Phone className="size-5" aria-hidden />
        Ligar 112
      </a>
    </section>
  );
}

export function CartaoAoVivo({
  cartao,
  identificadoNif,
}: {
  cartao: Cartao;
  identificadoNif: boolean;
}) {
  switch (cartao.tipo) {
    case "requerimento":
      return <Requerimento c={cartao} />;
    case "ocorrencia":
      return <Ocorrencia c={cartao} />;
    case "processo":
      return <Processo c={cartao} identificadoNif={identificadoNif} />;
    case "recolha":
      return <Recolha c={cartao} />;
    case "marcacao":
      return <Marcacao c={cartao} />;
    case "emergencia":
      return <Emergencia />;
    default:
      return null;
  }
}
