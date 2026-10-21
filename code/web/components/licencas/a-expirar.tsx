"use client";

import {
  BellRing,
  CalendarClock,
  ExternalLink,
  FileText,
  Phone,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import {
  Cartao,
  Estado,
  Pilula,
  Rotulo,
  useDados,
} from "@/components/conhecimento/comum";
import type { TipoLicenca } from "@/components/licencas/regras-tipo";

/*
 * Calendário de obrigações: as licenças que expiram nos próximos 60 dias,
 * por semana. Para cada uma, se o aviso já foi (SMS ou chamada do agente),
 * quando vai o próximo e se a pessoa já pediu a renovação.
 */

interface Aviso {
  dias: number;
  canal: "sms" | "chamada" | "sem_contacto";
  em: string;
}

interface AExpirarLinha {
  id: string;
  numero: string;
  tipo: TipoLicenca;
  tipo_nome: string;
  titular: string | null;
  telefone: string | null;
  valida_ate: string;
  faltam_dias: number;
  codigo_verificacao: string;
  processo_id: string;
  avisos: Aviso[];
  proximo_aviso: { dias: number; em: string } | null;
  renovacao: { numero: string; estado: string } | null;
  estado_aviso: "renovada" | "avisado" | "por_avisar" | "sem_aviso";
}

interface Resposta {
  hoje: string;
  dias: number;
  total: number;
  avisos: Partial<Record<TipoLicenca, number[]>>;
  semanas: { inicio: string; fim: string; licencas: AExpirarLinha[] }[];
}

const CANAL: Record<Aviso["canal"], string> = {
  sms: "SMS",
  chamada: "chamada do agente",
  sem_contacto: "sem contacto",
};

function dia(d: string, ano = false): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(ano ? { year: "numeric" } : {}),
  }).format(new Date(`${d}T12:00:00Z`));
}

export function AExpirar({ tipo }: { tipo: TipoLicenca | "todos" }) {
  const d = useDados<Resposta>("/v1/painel/licencas/a-expirar?dias=60");
  const semanas = (d.dados?.semanas ?? [])
    .map((s) => ({
      ...s,
      licencas: s.licencas.filter((l) => tipo === "todos" || l.tipo === tipo),
    }))
    .filter((s) => s.licencas.length > 0);
  const avisos = d.dados?.avisos ?? {};

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Cartao className="flex flex-wrap items-center gap-3 px-5 py-4">
        <CalendarClock className="size-5 text-terracota" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] text-tinta-2">
          Licenças com validade que acabam nos próximos 60 dias. Avisamos o
          titular por SMS
          {Object.entries(avisos).length > 0 &&
            ` (${Object.entries(avisos)
              .filter(([, v]) => v && v.length)
              .map(
                ([t, v]) =>
                  `${NOMES[t as TipoLicenca] ?? t}: ${v!.join(" e ")} dias antes`,
              )
              .join("; ")})`}
          , com o link da licença; para renovar, a pessoa liga ou escreve e o
          assistente trata.
        </p>
        <Pilula tom="ambar">valores de demonstração</Pilula>
      </Cartao>
      <Estado
        aCarregar={d.aCarregar}
        erro={d.erro}
        vazio={semanas.length === 0}
        textoVazio="Nenhuma licença a expirar nos próximos 60 dias."
      >
        {semanas.map((s) => (
          <section
            key={s.inicio}
            className="flex flex-col gap-2"
            aria-label={`Semana de ${dia(s.inicio)}`}
          >
            <Rotulo>
              Semana de {dia(s.inicio)} a {dia(s.fim, true)} ·{" "}
              {s.licencas.length}
            </Rotulo>
            <Cartao>
              <ul className="divide-y divide-linha">
              {s.licencas.map((l) => (
                <LinhaAExpirar key={l.id} l={l} />
              ))}
              </ul>
            </Cartao>
          </section>
        ))}
      </Estado>
    </div>
  );
}

const NOMES: Partial<Record<TipoLicenca, string>> = {
  ocupacao_via: "ocupação da via",
  esplanada: "esplanada",
  distico_residente: "dístico",
  publicidade: "publicidade",
};

function LinhaAExpirar({ l }: { l: AExpirarLinha }) {
  const ultimo = l.avisos[l.avisos.length - 1];
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-5 py-3.5">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-tinta">
            {l.numero}
          </span>
          <Pilula tom="tinta">{l.tipo_nome}</Pilula>
          {l.estado_aviso === "renovada" && (
            <Pilula tom="verde" icone={RefreshCw}>
              renovação pedida{l.renovacao ? ` · ${l.renovacao.numero}` : ""}
            </Pilula>
          )}
          {l.estado_aviso === "avisado" && ultimo && (
            <Pilula
              tom="terracota"
              icone={ultimo.canal === "chamada" ? Phone : BellRing}
            >
              avisado · {CANAL[ultimo.canal]} {ultimo.dias} dias antes
            </Pilula>
          )}
          {l.estado_aviso === "por_avisar" && l.proximo_aviso && (
            <Pilula tom="neutro">aviso a {dia(l.proximo_aviso.em)}</Pilula>
          )}
          {l.estado_aviso === "sem_aviso" && (
            <Pilula tom="neutro">sem aviso por enviar</Pilula>
          )}
        </div>
        <span className="text-[13px] text-tinta-2">
          {l.titular ?? "Sem nome"}
          {l.telefone ? ` · ${l.telefone}` : ""}
        </span>
        {l.avisos.length > 1 && (
          <span className="text-xs text-tinta-3">
            Avisos:{" "}
            {l.avisos
              .map((a) => `${a.dias} dias antes (${CANAL[a.canal]})`)
              .join(", ")}
          </span>
        )}
        <div className="flex flex-wrap gap-3 pt-0.5 text-[13px] font-semibold">
          <Link
            href={`/painel/processos/${l.processo_id}`}
            className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta"
          >
            <FileText className="size-4" aria-hidden /> processo
          </Link>
          <a
            href={`/licenca/${l.codigo_verificacao}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-terracota"
          >
            <ExternalLink className="size-4" aria-hidden /> licença
          </a>
        </div>
      </div>
      <div className="flex flex-col items-end text-right">
        <span className="font-display text-lg font-bold text-tinta">
          {dia(l.valida_ate, true)}
        </span>
        <span
          className={`text-xs ${l.faltam_dias <= 7 ? "font-semibold text-terracota" : "text-tinta-3"}`}
        >
          {l.faltam_dias === 0
            ? "último dia"
            : l.faltam_dias === 1
              ? "falta 1 dia"
              : `faltam ${l.faltam_dias} dias`}
        </span>
      </div>
    </li>
  );
}
