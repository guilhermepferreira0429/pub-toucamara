"use client";

import { Smile } from "lucide-react";
import Link from "next/link";
import { useFuso } from "./dados";
import { decimal, numero, pct, quando } from "./formatos";
import { Cartao, ErroBloco, Esqueleto, Vazio } from "./ui";

/** GET /v1/painel/satisfacao (peça 7). */
export interface Satisfacao {
  periodo: { de: string; ate: string };
  media: number | null;
  respostas: number;
  /** Conversas com link do resumo no período (quem podia responder). */
  elegiveis: number;
  taxa_resposta_pct: number | null;
  satisfeitos_pct: number | null;
  distribuicao: { nota: number; respostas: number }[];
  /** null: o perfil não vê conversas (os comentários podem ter dados pessoais). */
  comentarios:
    { conversa_id: string; nota: number; comentario: string; respondida_em: string }[] | null;
}

/**
 * Cartão "Satisfação" da Visão geral: a nota média do "Ficou resolvido?"
 * (página do resumo), a taxa de resposta e os últimos comentários.
 */
export function CartaoSatisfacao({
  dados,
  erro,
  tentar,
}: {
  dados?: Satisfacao;
  erro?: string;
  tentar: () => void;
}) {
  const fuso = useFuso();
  const maximo = Math.max(1, ...(dados?.distribuicao.map((d) => d.respostas) ?? []));

  return (
    <Cartao
      id="satisfacao"
      titulo="Satisfação"
      sub="“Ficou resolvido?”, de 1 a 5, na página do resumo que segue por SMS"
      className="flex-1"
    >
      {erro && <ErroBloco mensagem={erro} tentar={tentar} />}
      {!dados && !erro && <Esqueleto className="h-40" />}
      {dados && dados.respostas === 0 && (
        <Vazio icone={Smile} titulo="Ainda sem respostas neste período.">
          {dados.elegiveis > 0
            ? `${numero(dados.elegiveis)} ${dados.elegiveis === 1 ? "pessoa recebeu" : "pessoas receberam"} o link do resumo.`
            : "A pergunta aparece no link do resumo enviado no fim da chamada."}
        </Vazio>
      )}
      {dados && dados.respostas > 0 && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex shrink-0 flex-col gap-4 lg:w-[260px]">
            <div className="flex items-end gap-2.5">
              <span className="font-display text-[56px] leading-none font-bold tracking-[-2px] text-tinta">
                {decimal(dados.media)}
              </span>
              <span className="pb-1 text-xs leading-[1.4] text-tinta-2">
                de 5, em {numero(dados.respostas)}{" "}
                {dados.respostas === 1 ? "resposta" : "respostas"}
                <br />
                {pct(dados.taxa_resposta_pct)} responderam
              </span>
            </div>
            <ul className="flex flex-col gap-1.5" aria-label="Respostas por nota">
              {[...dados.distribuicao].reverse().map((d) => (
                <li key={d.nota} className="flex items-center gap-2 text-xs text-tinta-2">
                  <span className="w-3 text-right font-semibold text-tinta">{d.nota}</span>
                  <span className="relative h-2 flex-1 rounded bg-creme-2" aria-hidden>
                    <span
                      className={`absolute inset-y-0 left-0 rounded ${d.nota >= 4 ? "bg-verde" : d.nota === 3 ? "bg-ambar" : "bg-terracota"}`}
                      style={{ width: `${(d.respostas / maximo) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right">
                    {numero(d.respostas)}
                    <span className="sr-only"> com nota {d.nota}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {dados.comentarios !== null && (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h3 className="text-sm font-bold text-tinta">Últimos comentários</h3>
              {dados.comentarios.length === 0 ? (
                <p className="text-[13px] text-tinta-2">Ninguém deixou comentário neste período.</p>
              ) : (
                <ul className="flex flex-col">
                  {dados.comentarios.map((c) => (
                    <li key={c.conversa_id} className="border-t border-linha first:border-t-0">
                      <Link
                        href={`/painel/conversas/${c.conversa_id}`}
                        className="flex items-start gap-3 py-2.5 hover:text-terracota-escuro"
                      >
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${c.nota >= 4 ? "bg-verde" : c.nota === 3 ? "bg-ambar" : "bg-terracota"}`}
                        >
                          {c.nota}
                          <span className="sr-only"> de 5</span>
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="line-clamp-2 text-[13px] leading-[1.4] text-tinta">
                            “{c.comentario}”
                          </span>
                          <span className="text-xs text-tinta-3">
                            {quando(c.respondida_em, fuso)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}
