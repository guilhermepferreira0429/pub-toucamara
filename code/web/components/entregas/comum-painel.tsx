"use client";

import { FileText, FlaskConical } from "lucide-react";
import { useCallback } from "react";
import { Pilula, useAcao, ErroLinha } from "@/components/conhecimento/comum";
import { useSessao } from "@/lib/sessao";
import { ESTADO_ROTULO, TOM_ESTADO, type EstadoEntrega } from "./tipos";

/** Pílula do estado da entrega. */
export function PilulaEstado({ estado }: { estado: EstadoEntrega }) {
  return <Pilula tom={TOM_ESTADO[estado]}>{ESTADO_ROTULO[estado]}</Pilula>;
}

/** "simulado": tudo o que é de demonstração diz que o é. */
export function PilulaSimulado({ simulado }: { simulado: boolean }) {
  if (!simulado) return null;
  return (
    <Pilula tom="ambar" icone={FlaskConical}>
      simulado
    </Pilula>
  );
}

/** Abre o comprovativo (PDF autenticado do painel) num separador novo. */
export function BotaoComprovativo({
  entregaId,
  numero,
}: {
  entregaId: string;
  numero: string | null;
}) {
  const { pedidoFicheiro } = useSessao();
  const acao = useAcao();
  const abrir = useCallback(async () => {
    const r = await acao.executar(() =>
      pedidoFicheiro(`/v1/painel/entregas/${entregaId}/comprovativo.pdf`),
    );
    if (r?.tipo !== "ficheiro") return;
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.download = `comprovativo-${(numero ?? entregaId).replace(/[^A-Za-z0-9-]/g, "-")}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [acao, entregaId, numero, pedidoFicheiro]);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={abrir}
        disabled={acao.aCorrer}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-linha bg-papel px-3 text-[13px] font-semibold text-tinta hover:bg-creme-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:opacity-60"
      >
        <FileText className="size-3.5" aria-hidden />
        {acao.aCorrer ? "A abrir…" : "Comprovativo (PDF)"}
      </button>
      <ErroLinha erro={acao.erro} />
    </span>
  );
}

const DATA_HORA = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function dataHora(v: string | null | undefined): string {
  return v ? DATA_HORA.format(new Date(v)) : "—";
}

/** As ações da auditoria em frases curtas (linha do tempo da entrega). */
export const ACAO_ROTULO: Record<string, string> = {
  confirmar_entrega: "Confirmou o resumo ao agente",
  pedir_autorizacao_entrega: "Link de autorização enviado",
  consentir_entrega: "Consentiu a entrega em seu nome",
  autenticacao_recusada: "Autenticação recusada",
  autorizar_entrega: "Autorizou com Chave Móvel Digital",
  entregar_em_nome: "Entregue no balcão online",
  entrega_falhou: "O balcão online não respondeu",
  tentar_entrega_de_novo: "Tentou-se de novo",
  cancelar_entrega: "Cancelada",
  expirar_entrega: "O link expirou",
};
