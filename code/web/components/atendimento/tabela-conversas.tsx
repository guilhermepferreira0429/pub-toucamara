"use client";

import Link from "next/link";
import { useFuso } from "./dados";
import { canal, quando } from "./formatos";
import type { ConversaLista } from "./tipos";
import { EstadoResultado } from "./ui";

/**
 * Tabela de conversas (design "Últimas conversas"): quando, canal, resumo,
 * tema e resultado. A linha inteira abre a conversa.
 */
export function TabelaConversas({
  itens,
  mostrarMunicipe,
}: {
  itens: ConversaLista[];
  mostrarMunicipe?: boolean;
}) {
  const fuso = useFuso();
  const th =
    "h-9 px-2 text-left text-[11px] font-bold tracking-[0.8px] text-tinta-3";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-linha">
            <th scope="col" className={`${th} w-[120px]`}>
              QUANDO
            </th>
            <th scope="col" className={`${th} w-[100px]`}>
              CANAL
            </th>
            <th scope="col" className={th}>
              RESUMO
            </th>
            <th scope="col" className={`${th} w-[200px]`}>
              {mostrarMunicipe ? "TEMA · MUNÍCIPE" : "TEMA"}
            </th>
            <th scope="col" className={`${th} w-[180px]`}>
              RESULTADO
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.map((c, i) => {
            const ca = canal(c.canal);
            const Icone = ca.icone;
            return (
              <tr
                key={c.id}
                className={`relative h-16 border-b border-linha transition-colors last:border-b-0 hover:bg-creme focus-within:bg-creme ${
                  i % 2 ? "bg-creme/60" : ""
                }`}
              >
                <td className="px-2 text-[13px] font-medium whitespace-nowrap text-tinta">
                  {quando(c.iniciada_em, fuso)}
                </td>
                <td className="px-2">
                  <span className="flex items-center gap-2 text-[13px] text-tinta-2">
                    <Icone className="size-[15px]" aria-hidden />
                    {ca.rotulo}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <Link
                    href={`/painel/conversas/${c.id}`}
                    className="line-clamp-2 text-[13px] leading-[1.4] text-tinta after:absolute after:inset-0 after:content-['']"
                  >
                    {c.resumo || (
                      <span className="text-tinta-3">
                        {c.resultado === "em_curso"
                          ? "Conversa a decorrer…"
                          : "Ainda sem resumo."}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-2">
                  <span className="flex flex-col gap-0.5 text-xs text-tinta-2">
                    <span className="line-clamp-1">
                      {c.tema?.nome ?? <span className="text-tinta-3">—</span>}
                    </span>
                    {mostrarMunicipe && c.municipe && (
                      <span className="line-clamp-1 text-tinta-3">
                        {c.municipe.nome ?? c.municipe.telefone}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-2">
                  <EstadoResultado valor={c.resultado} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
