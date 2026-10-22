"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { Cartao, Estado, useDados } from "@/components/conhecimento/comum";
import { LinhaEntrega } from "./entregas-painel";
import { useSessao } from "@/lib/sessao";
import type { ListaEntregas } from "./tipos";

/**
 * Na ficha do processo (ou do requerimento): a entrega em nome do munícipe,
 * o estado, o comprovativo e a pílula "simulado". Sem entregas, não aparece.
 */
export function CartaoEntregaEmNome({
  processoId,
  requerimentoId,
}: {
  processoId?: string;
  requerimentoId?: string;
}) {
  const filtro = processoId
    ? `processo_id=${processoId}`
    : requerimentoId
      ? `requerimento_id=${requerimentoId}`
      : null;
  const { pode } = useSessao();
  const lista = useDados<ListaEntregas>(
    filtro && pode("processos") ? `/v1/painel/entregas?${filtro}` : null,
  );
  if (!lista.erro && !lista.dados?.itens.length) return null;
  return (
    <Cartao aria-labelledby="entrega-em-nome">
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <h2
          id="entrega-em-nome"
          className="flex items-center gap-2 text-[15px] font-bold text-tinta"
        >
          <Send className="size-4 text-terracota-escuro" aria-hidden />
          Entrega em nome do munícipe
        </h2>
        <Link
          href="/painel/entregas"
          className="text-xs font-semibold text-terracota-escuro hover:underline"
        >
          Ver todas
        </Link>
      </div>
      <Estado aCarregar={lista.aCarregar} erro={lista.erro} vazio={false}>
        <ul className="pt-1">
          {lista.dados?.itens.slice(0, 3).map((e) => (
            <LinhaEntrega
              key={e.id}
              e={e}
              mostrarProcesso={!processoId}
              onAtualizado={lista.recarregar}
            />
          ))}
        </ul>
      </Estado>
    </Cartao>
  );
}
