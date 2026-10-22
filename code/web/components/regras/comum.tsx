import { History } from "lucide-react";
import { dataLonga } from "@/components/municipe/formatar";
import { ModoTeste, TituloSecao } from "@/components/municipe/moldura";
import type { Fonte, Versao } from "./tipos";

/*
 * Peças comuns das páginas públicas das regras: a base legal, as marcas
 * de demonstração e o histórico de alterações (o que mudou, quando e o
 * cargo de quem mudou na câmara).
 */

export function BaseLegal({ fonte, demonstracao }: { fonte: Fonte; demonstracao: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {demonstracao && (
        <div className="flex flex-wrap gap-2">
          <ModoTeste texto="valores de demonstração" />
        </div>
      )}
      <p className="text-[13px] leading-[1.45] text-tinta-3">
        Base legal:{" "}
        {fonte.url ? (
          <a href={fonte.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
            {fonte.titulo}
          </a>
        ) : (
          fonte.titulo
        )}
        {fonte.artigo ? `, ${fonte.artigo}` : ""}.
        {demonstracao ? " Os números ainda não são os do regulamento municipal: são para demonstração." : ""}
      </p>
    </div>
  );
}

export function EmVigorDesde({ versao, desde }: { versao: number; desde: string }) {
  return (
    <p className="text-[14px] text-tinta-2">
      Em vigor desde {dataLonga(desde)} · versão {versao}
    </p>
  );
}

/** "O que mudou": cada versão, da mais recente para a mais antiga. */
export function Historico({ historico }: { historico: Versao[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="historico">
      <TituloSecao id="historico">O que mudou</TituloSecao>
      <ol className="flex flex-col gap-3">
        {historico.map((v) => (
          <li key={v.versao} className="flex gap-3 rounded-2xl border border-linha bg-papel p-4">
            <History className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-[15px] font-bold text-tinta">
                Versão {v.versao} · {dataLonga(v.vigor_desde)}
              </p>
              <p className="text-[14px] text-tinta-2">
                {v.inicial ? "Valores iniciais." : `Mudado por: ${v.cargo ?? "câmara municipal"}.`}
              </p>
              {v.alteracoes.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {v.alteracoes.map((a) => (
                    <li key={a.campo} className="text-[14px] leading-[1.45] text-tinta">
                      <span className="font-semibold">{a.rotulo}:</span>{" "}
                      <span className="text-tinta-3 line-through decoration-tinta-3/60">{a.antes}</span>
                      <span className="sr-only"> passou a </span>
                      <span aria-hidden> → </span>
                      {a.depois}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
