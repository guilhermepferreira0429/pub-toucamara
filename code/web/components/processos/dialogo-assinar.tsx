"use client";

import { PenLine, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import type { Rascunho } from "./tipos";
import { BotaoPainel, Dialogo, ErroEmLinha, paraErro } from "./ui";

/*
 * Apoio ao técnico · Assinar (frame FR3XT). A assinatura é simulada nesta
 * versão: diz-se às claras no diálogo, no documento e na linha do tempo.
 */

const DEPOIS: Record<string, string> = {
  oficio:
    "Depois de assinar, o ofício fica na linha do tempo (visível ao munícipe) e é gerado o PDF.",
  pedido_elementos:
    "Depois de assinar, cada documento passa a pedido com prazo e o munícipe recebe um só aviso (SMS ou email) com a lista e o link.",
  notificacao_sms:
    "Depois de assinar, o SMS segue logo para o munícipe com o link do processo.",
  parecer:
    "Depois de assinar, o parecer fica na linha do tempo e é gerado o PDF.",
};

const ARTIGO: Record<string, string> = {
  oficio: "o ofício",
  pedido_elementos: "o pedido de elementos",
  notificacao_sms: "a notificação",
  parecer: "o parecer",
};

export function DialogoAssinar({
  rascunho,
  numero,
  onFechar,
  onAssinado,
}: {
  rascunho: Rascunho | null;
  numero: string;
  onFechar: () => void;
  onAssinado: (r: Rascunho) => void;
}) {
  const { pedido, eu } = useSessao();
  const [aAssinar, setAAssinar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function assinar() {
    if (!rascunho) return;
    setAAssinar(true);
    setErro(null);
    try {
      const r = await pedido<Rascunho>(
        `/v1/painel/rascunhos/${rascunho.id}/aprovar`,
        { corpo: {} },
      );
      onAssinado(r);
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAAssinar(false);
    }
  }

  const tipo = rascunho?.tipo ?? "oficio";
  return (
    <Dialogo
      aberto={!!rascunho}
      onFechar={() => {
        setErro(null);
        onFechar();
      }}
      titulo={`Assinar ${ARTIGO[tipo] ?? "o documento"}`}
      descricao={
        rascunho
          ? `${numero} · ${rascunho.tipo_rotulo} · versão ${rascunho.versao}`
          : undefined
      }
    >
      <div className="flex flex-col gap-2 rounded-[14px] bg-terracota-suave p-3.5">
        <ShieldCheck className="size-5 text-terracota-escuro" aria-hidden />
        <p className="text-sm font-bold text-terracota-escuro">
          Assinatura simulada
        </p>
        <p className="text-[13px] text-terracota-escuro">
          Nesta demonstração não se usa a Chave Móvel Digital nem o Cartão de
          Cidadão. O documento fica aprovado em nome de{" "}
          <strong>{eu?.utilizador.nome ?? "quem assina"}</strong>, com a
          indicação «assinatura simulada» no PDF e na linha do tempo.
        </p>
      </div>
      <div className="flex items-start gap-2.5 rounded-xl bg-creme-2 p-3">
        <RefreshCw className="mt-0.5 size-[15px] shrink-0 text-tinta-2" aria-hidden />
        <p className="text-xs text-tinta-2">{DEPOIS[tipo]}</p>
      </div>
      <ErroEmLinha erro={erro} />
      <div className="flex gap-2.5">
        <BotaoPainel
          variante="texto"
          grande
          onClick={onFechar}
          className="flex-1"
        >
          Cancelar
        </BotaoPainel>
        <BotaoPainel
          variante="principal"
          icone={PenLine}
          onClick={assinar}
          grande
          disabled={aAssinar}
          className="flex-1"
        >
          {aAssinar ? "A assinar…" : "Assinar (simulado)"}
        </BotaoPainel>
      </div>
    </Dialogo>
  );
}
