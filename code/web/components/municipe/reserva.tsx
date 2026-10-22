"use client";

import { CalendarDays, Clock, CreditCard, MapPin, Ticket, Users, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { QrSvg } from "@/components/ui/qr-svg";
import { api } from "@/lib/api";
import { euros } from "./formatar";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  ModoTeste,
  Nota,
  Rotulo,
  Topo,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";

/*
 * A reserva de um equipamento ou o bilhete de um evento (link do SMS). O
 * bilhete confirmado mostra o QR para a entrada; por pagar, a referência de
 * teste e o link para pagar; e pode cancelar-se daqui.
 */

type Estado = "por_aprovar" | "por_pagar" | "confirmada" | "recusada" | "cancelada";

interface ReservaPublica {
  codigo: string;
  tipo: "equipamento" | "bilhete";
  estado: Estado;
  municipio: string;
  titulo: string;
  local: string;
  dia: string;
  hora_inicio: string;
  hora_fim: string | null;
  quantidade: number;
  finalidade: string | null;
  nome: string | null;
  valor_cent: number;
  motivo_recusa: string | null;
  pagamento: {
    estado: string;
    modo_teste: boolean;
    entidade: string | null;
    referencia: string | null;
    pagar_ate: string | null;
    pagina: string | null;
  } | null;
  pode_cancelar: boolean;
  cancelar_texto: string;
  qr: boolean;
  demonstracao: boolean;
}

const semSubscricao = () => () => {};

function diaPorExtenso(dia: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dia}T12:00:00Z`));
}

function referenciaLegivel(r: string): string {
  return r.replace(/(\d{3})(?=\d)/g, "$1 ");
}

export function PaginaReserva({ codigo }: { codigo: string }) {
  const base = `/v1/public/reservas/${encodeURIComponent(codigo)}`;
  const { c, definir, tentarOutraVez } = usePublico<ReservaPublica>(base);
  const [confirmar, setConfirmar] = useState(false);
  const [aCancelar, setACancelar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const url = useSyncExternalStore(semSubscricao, () => window.location.href, () => "");

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const r = c.dados;
  const bilhete = r.tipo === "bilhete";
  const cancelar = async () => {
    setACancelar(true);
    setErro(null);
    try {
      definir(await api<ReservaPublica>(`${base}/cancelar`, { metodo: "POST" }));
      setConfirmar(false);
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setACancelar(false);
    }
  };

  const destaque: Record<Estado, { rotulo: string; texto: string; tom: "verde" | "terracota" | "tinta" }> = {
    confirmada: {
      rotulo: "Confirmada",
      texto: bilhete ? `${r.quantidade} ${r.quantidade === 1 ? "bilhete" : "bilhetes"}` : "Reserva confirmada",
      tom: "verde",
    },
    por_pagar: { rotulo: "Falta pagar", texto: `${euros(r.valor_cent)} para confirmar`, tom: "terracota" },
    por_aprovar: { rotulo: "À espera de aprovação", texto: "Um funcionário confirma por SMS", tom: "tinta" },
    recusada: { rotulo: "Não aprovada", texto: "Esta reserva não foi aprovada", tom: "tinta" },
    cancelada: { rotulo: "Cancelada", texto: "Esta reserva foi cancelada", tom: "tinta" },
  };
  const d = destaque[r.estado];

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={r.codigo} mono />
      <Cabecalho
        meta={`Câmara Municipal de ${r.municipio}`}
        titulo={r.titulo}
        sub={bilhete ? "Bilhete para evento municipal" : r.finalidade ?? "Reserva de equipamento municipal"}
      />

      <CartaoDestaque rotulo={d.rotulo} tom={d.tom}>
        <p className="flex items-center gap-2 font-display text-[24px] leading-tight font-bold">
          <Ticket className="size-6" aria-hidden />
          {d.texto}
        </p>
        {r.nome && <p className="text-[15px] text-white/90">Em nome de {r.nome}.</p>}
      </CartaoDestaque>

      {r.estado === "recusada" && r.motivo_recusa && (
        <Nota icone={XCircle} tom="terracota" papel="status">
          {r.motivo_recusa}
        </Nota>
      )}

      <ul className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5 text-[16px] text-tinta">
        <li className="flex gap-3">
          <CalendarDays className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
          <span className="first-letter:uppercase">{diaPorExtenso(r.dia)}</span>
        </li>
        <li className="flex gap-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
          {r.hora_fim ? `Das ${r.hora_inicio} às ${r.hora_fim}` : `Às ${r.hora_inicio}`}
        </li>
        <li className="flex gap-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
          {r.local}
        </li>
        {bilhete && (
          <li className="flex gap-3">
            <Users className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
            {r.quantidade} {r.quantidade === 1 ? "lugar" : "lugares"}
          </li>
        )}
        <li className="flex gap-3">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
          {r.valor_cent ? euros(r.valor_cent) : "Gratuito"}
          {r.pagamento?.estado === "pago" ? " · pago" : ""}
        </li>
      </ul>

      {r.estado === "por_pagar" && r.pagamento && r.pagamento.estado === "pendente" && (
        <section className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5">
          <Rotulo>Pagar por Multibanco</Rotulo>
          {r.pagamento.entidade && r.pagamento.referencia && (
            <p className="font-mono text-[17px] text-tinta">
              Entidade {r.pagamento.entidade} · Ref. {referenciaLegivel(r.pagamento.referencia)}
            </p>
          )}
          {r.pagamento.pagar_ate && (
            <p className="text-[14px] text-tinta-2">Até {diaPorExtenso(r.pagamento.pagar_ate)}.</p>
          )}
          {r.pagamento.pagina && (
            <Link
              href={r.pagamento.pagina}
              className="inline-flex h-12 items-center justify-center rounded-full bg-terracota px-6 text-[16px] font-semibold text-white hover:bg-terracota-escuro"
            >
              Pagar agora (MB WAY ou Multibanco)
            </Link>
          )}
        </section>
      )}

      {r.qr && url && (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-linha bg-papel p-5">
          <Rotulo>{bilhete ? "Mostre este código à entrada" : "Mostre este código se lho pedirem"}</Rotulo>
          <QrSvg texto={url} className="w-56" />
          <span className="font-mono text-[13px] text-tinta-3">{r.codigo}</span>
        </section>
      )}

      {r.pode_cancelar && (
        <section className="flex flex-col gap-3">
          {!confirmar ? (
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              className="inline-flex min-h-12 items-center gap-2 self-start text-[16px] font-semibold text-terracota underline underline-offset-2"
            >
              Cancelar {bilhete ? "os bilhetes" : "a reserva"}
            </button>
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl border border-terracota/40 bg-terracota-suave p-4">
              <p className="text-[15px] text-tinta">{r.cancelar_texto} Quer mesmo cancelar?</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={aCancelar}
                  onClick={cancelar}
                  className="h-12 rounded-full bg-terracota px-5 text-[15px] font-semibold text-white disabled:opacity-60"
                >
                  {aCancelar ? "A cancelar…" : "Sim, cancelar"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmar(false)}
                  className="h-12 rounded-full border border-linha bg-papel px-5 text-[15px] font-semibold text-tinta"
                >
                  Não
                </button>
              </div>
              {erro && (
                <p role="alert" className="text-[14px] text-terracota-escuro">
                  {erro}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {r.pagamento?.modo_teste && <ModoTeste texto="pagamento de teste" />}
        {r.demonstracao && <ModoTeste texto="valores de demonstração" />}
      </div>
    </div>
  );
}
