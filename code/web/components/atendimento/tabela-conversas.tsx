"use client";

import Link from "next/link";
import { useFuso } from "./dados";
import { canal, quando } from "./formatos";
import type { ConversaLista } from "./tipos";
import { Cara, EstadoResultado } from "./ui";

/**
 * Tabela de conversas (design "Últimas conversas"): quando, canal, resumo,
 * fonte (a primeira citada; o tema por baixo) e resultado. A linha inteira abre a conversa.
 * Abaixo de `md` a tabela dá lugar a cartões (como na Entrada), um link cada.
 */
export function TabelaConversas({
  itens,
  mostrarMunicipe,
  consulta,
}: {
  itens: ConversaLista[];
  mostrarMunicipe?: boolean;
  /** Os filtros da lista (query string), para o detalhe abrir com os mesmos. */
  consulta?: string;
}) {
  const sufixo = consulta ? `?${consulta}` : "";
  const fuso = useFuso();
  const th =
    "h-9 px-2 text-left text-[11px] font-bold uppercase tracking-[0.8px] text-tinta-3";
  return (
    <>
      <ul className="flex flex-col md:hidden" aria-label="Conversas">
        {itens.map((c) => {
          const ca = canal(c.canal);
          const Icone = ca.icone;
          const fonte = c.fonte
            ? c.fonte.referencia
              ? `${c.fonte.titulo}, ${c.fonte.referencia}`
              : c.fonte.titulo
            : null;
          const quem =
            mostrarMunicipe && c.municipe
              ? (c.municipe.nome ?? c.municipe.telefone)
              : ca.rotulo;
          return (
            <li key={c.id} className="border-b border-linha last:border-b-0">
              <Link
                href={`/painel/conversas/${c.id}${sufixo}`}
                className="flex gap-3 py-3.5 hover:bg-creme/60 focus-visible:bg-creme"
              >
                <span
                  className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-creme-2"
                  title={ca.rotulo}
                >
                  <Icone
                    className="size-4 text-tinta-2"
                    aria-label={ca.rotulo}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-tinta-2">
                      {quem}
                    </span>
                    <span className="shrink-0 text-xs text-tinta-3">
                      {quando(c.iniciada_em, fuso)}
                    </span>
                  </span>
                  <span className="line-clamp-3 text-sm leading-[1.4] text-tinta">
                    {c.resumo || (
                      <span className="text-tinta-3">
                        {c.resultado === "em_curso"
                          ? "Conversa a decorrer…"
                          : "Ainda sem resumo."}
                      </span>
                    )}
                  </span>
                  {(fonte || c.tema?.nome) && (
                    <span className="line-clamp-1 text-xs text-tinta-3">
                      {fonte ? (
                        <span className="font-medium text-tinta-2">
                          {fonte}
                        </span>
                      ) : null}
                      {fonte && c.tema?.nome ? " · " : ""}
                      {c.tema?.nome ? `Tema: ${c.tema.nome}` : ""}
                    </span>
                  )}
                  <span className="flex flex-wrap gap-1.5 pt-0.5">
                    <EstadoResultado valor={c.resultado} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto md:block" tabIndex={0}>
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-linha">
              <th scope="col" className={`${th} w-[120px]`}>
                Quando
              </th>
              <th scope="col" className={`${th} w-[100px]`}>
                Canal
              </th>
              <th scope="col" className={th}>
                Resumo
              </th>
              <th scope="col" className={`${th} w-[200px]`}>
                {mostrarMunicipe ? "Fonte · munícipe" : "Fonte"}
              </th>
              <th scope="col" className={`${th} w-[180px]`}>
                Resultado
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
                      href={`/painel/conversas/${c.id}${sufixo}`}
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
                        {c.fonte ? (
                          <span className="font-medium text-tinta">
                            {c.fonte.referencia
                              ? `${c.fonte.titulo}, ${c.fonte.referencia}`
                              : c.fonte.titulo}
                          </span>
                        ) : c.resultado === "resolvida" ? (
                          // Só se assinala quando o agente resolveu sem citar: nas passadas,
                          // nas marcações ou nas chamadas que caíram não há fonte a citar.
                          <span className="text-tinta-3">Sem fonte citada</span>
                        ) : (
                          <span className="text-tinta-3">—</span>
                        )}
                      </span>
                      {c.tema?.nome && (
                        <span className="line-clamp-1 text-tinta-3">Tema: {c.tema.nome}</span>
                      )}
                      {mostrarMunicipe && c.municipe && (
                        <span className="flex items-center gap-1.5 text-tinta-3">
                          <Cara telefone={c.municipe.telefone} tamanho={20} />
                          <span className="line-clamp-1">{c.municipe.nome ?? c.municipe.telefone}</span>
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
    </>
  );
}
