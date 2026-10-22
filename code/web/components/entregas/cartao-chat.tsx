"use client";

import { Check, ExternalLink, FlaskConical, Send } from "lucide-react";

type Dados = Record<string, unknown>;

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/**
 * O cartão do chat da ferramenta `entregar_pedido`: o resumo por confirmar,
 * o link para autorizar ou o número de entrada. Sempre com o aviso de
 * simulação quando o é.
 */
export function CartaoChatEntrega({ dados }: { dados: Dados }) {
  const estado = txt(dados.estado);
  const link = txt(dados.link);
  const numero = txt(dados.numero_entrada);
  const resumo = (dados.resumo ?? null) as {
    tipo?: { nome?: string };
    campos?: { rotulo: string; valor: string }[];
  } | null;
  const simulado = dados.simulado === true;

  return (
    <div className="flex w-full flex-col gap-2.5 rounded-[4px_18px_18px_18px] border border-linha bg-papel p-4">
      <p className="flex items-start gap-2">
        <Send className="mt-0.5 size-4 shrink-0 text-terracota-escuro" aria-hidden />
        <span className="text-[15px] font-semibold text-tinta">
          Entregar o pedido em seu nome
          {resumo?.tipo?.nome ? ` · ${resumo.tipo.nome}` : ""}
        </span>
      </p>
      {estado === "por_confirmar" && resumo?.campos && (
        <dl className="rounded-xl bg-creme px-3 py-2 text-[13px]">
          {resumo.campos.map((c) => (
            <div key={c.rotulo} className="py-0.5">
              <dt className="inline text-tinta-2">{c.rotulo}: </dt>
              <dd className="inline text-tinta">{c.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {estado === "por_confirmar" && (
        <p className="text-xs text-tinta-2">Confirme ao agente se está tudo certo.</p>
      )}
      {estado === "a_espera_autorizacao" && (
        <p className="text-sm text-tinta">
          Falta autorizar com a Chave Móvel Digital{dados.sms_enviado === true ? " (enviámos o link por SMS)" : ""}.
        </p>
      )}
      {estado === "entregue" && numero && (
        <span className="inline-flex items-center gap-[5px] self-start rounded-[11px] bg-verde-suave px-[9px] py-1 text-[12px] font-semibold text-verde">
          <Check className="size-3" aria-hidden />
          Entregue · {numero}
        </span>
      )}
      {simulado && (
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-ambar-suave px-2.5 py-1 text-[12px] font-semibold text-ambar">
          <FlaskConical className="size-3.5" aria-hidden />
          Simulação — sem validade legal
        </span>
      )}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-terracota-escuro underline-offset-4 hover:underline"
        >
          {estado === "entregue" ? "Ver o comprovativo" : "Abrir para autorizar"}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </div>
  );
}
