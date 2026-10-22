"use client";

import { BadgeCheck, Clock, Download, ListChecks, ShieldAlert } from "lucide-react";
import { API_URL } from "@/lib/api";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  ModoTeste,
  Nota,
  TituloSecao,
  Topo,
} from "./moldura";
import { usePublico } from "./use-publico";

/*
 * O atestado da junta de freguesia (o link do SMS e o que o QR do PDF
 * abre): em que ponto está o pedido e, quando emitido, o PDF.
 */

interface AtestadoPublico {
  numero: string;
  tipo: string;
  titulo: string;
  junta: string;
  estado: "pedido" | "emitido" | "recusado";
  titular: string;
  freguesia: string;
  pedido_em: string;
  emitido_em: string | null;
  motivo_recusa: string | null;
  prazo_dias_uteis: number;
  requisitos: string[];
  pdf: boolean;
  demonstracao: boolean;
}

function dia(v: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(v));
}

export function PaginaAtestado({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<AtestadoPublico>(
    `/v1/public/atestados/${encodeURIComponent(codigo)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const a = c.dados;
  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={a.numero} mono />
      <Cabecalho
        meta={a.junta}
        titulo={a.titulo}
        sub={`Em nome de ${a.titular.replace(/\.$/, "")}.`}
      />

      {a.estado === "emitido" && (
        <CartaoDestaque rotulo="Passado pela junta" tom="verde">
          <p className="flex items-center gap-2 font-display text-[26px] leading-tight font-bold">
            <BadgeCheck className="size-7" aria-hidden />
            Está pronto
          </p>
          {a.emitido_em && (
            <p className="text-[15px] text-white/90">Emitido a {dia(a.emitido_em)}.</p>
          )}
        </CartaoDestaque>
      )}
      {a.estado === "pedido" && (
        <Nota icone={Clock} tom="ambar" papel="status">
          O pedido foi recebido a {dia(a.pedido_em)}. A junta trata dele em cerca de{" "}
          {a.prazo_dias_uteis} dias úteis e avisa por SMS quando estiver pronto.
        </Nota>
      )}
      {a.estado === "recusado" && (
        <Nota icone={ShieldAlert} tom="terracota" papel="status">
          A junta não pôde passar este atestado. {a.motivo_recusa}
        </Nota>
      )}

      {a.pdf && (
        <a
          href={`${API_URL}/v1/public/atestados/${encodeURIComponent(codigo)}/pdf`}
          className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-terracota px-6 text-[17px] font-semibold text-white hover:bg-terracota-escuro"
        >
          <Download className="size-5" aria-hidden />
          Descarregar o atestado (PDF)
        </a>
      )}

      {a.estado !== "emitido" && (
        <section className="flex flex-col gap-3" aria-labelledby="levar">
          <TituloSecao id="levar">
            <span className="inline-flex items-center gap-2">
              <ListChecks className="size-5 text-terracota" aria-hidden /> O que pode ser preciso
            </span>
          </TituloSecao>
          <ul className="flex flex-col gap-2">
            {a.requisitos.map((x) => (
              <li key={x} className="flex gap-2.5 text-[15px] leading-[1.45] text-tinta">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-terracota" />
                {x}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <ModoTeste texto="assinatura simulada" />
        {a.demonstracao && <ModoTeste texto="valores de demonstração" />}
      </div>
      <p className="text-[13px] leading-[1.45] text-tinta-3">
        Freguesia de {a.freguesia}. Os prazos e os documentos são valores de demonstração, por
        confirmar com a junta.
      </p>
    </div>
  );
}
