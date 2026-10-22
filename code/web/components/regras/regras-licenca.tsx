"use client";

import { ArrowLeft, Check, Info, Users } from "lucide-react";
import Link from "next/link";
import { MUNICIPIO } from "@/components/chamada/config";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  LinkInvalido,
  Nota,
  TituloSecao,
  Topo,
} from "@/components/municipe/moldura";
import { usePublico } from "@/components/municipe/use-publico";
import { BaseLegal, EmVigorDesde, Historico } from "./comum";
import type { LicencaDetalhe } from "./tipos";
import { Verificador } from "./verificador";

/*
 * As regras de um tipo de licença: em linguagem simples, com os números,
 * as taxas, a base legal, desde quando vigoram, o histórico e o
 * verificador.
 */

export function Voltar() {
  return (
    <Link
      href="/regras"
      className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-tinta-2 hover:text-tinta"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Todas as regras
    </Link>
  );
}

export function PaginaRegrasLicenca({ tipo, municipio = MUNICIPIO }: { tipo: string; municipio?: string }) {
  const { c, tentarOutraVez } = usePublico<LicencaDetalhe>(
    `/v1/public/regras/${encodeURIComponent(municipio)}/licencas/${encodeURIComponent(tipo)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;
  const l = c.dados;

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="Regras públicas" />
      <Voltar />
      <Cabecalho meta={`Câmara Municipal de ${l.municipio.nome}`} titulo={l.nome} sub={l.aprovacao_dita} />
      <EmVigorDesde versao={l.versao} desde={l.vigor_desde} />

      <section className="flex flex-col gap-3" aria-labelledby="regras">
        <TituloSecao id="regras">As regras</TituloSecao>
        <ul className="flex flex-col gap-2.5">
          {l.regras.map((r) => (
            <li key={r.id} className="flex gap-3 text-[16px] leading-[1.45] text-tinta">
              <Check className="mt-1 size-5 shrink-0 text-verde" aria-hidden />
              {r.texto}
            </li>
          ))}
        </ul>
        {l.dados_necessarios.length > 0 && (
          <Nota icone={Users} tom="neutro">
            Para o pedido se decidir logo, diga também: {l.dados_necessarios.join(", ").toLowerCase()}. Sem isso, um
            funcionário confirma.
          </Nota>
        )}
      </section>

      {l.condicoes.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="condicoes">
          <TituloSecao id="condicoes">Condições da licença</TituloSecao>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] text-tinta">
            {l.condicoes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="taxas">
        <TituloSecao id="taxas">Quanto custa</TituloSecao>
        {l.taxas.map((t) => (
          <p key={t} className="text-[16px] text-tinta">
            {t}
          </p>
        ))}
      </section>

      <details className="rounded-2xl border border-linha bg-papel p-4">
        <summary className="flex min-h-8 cursor-pointer items-center gap-2 text-[15px] font-semibold text-tinta">
          <Info className="size-4 text-terracota" aria-hidden />
          Todos os valores
        </summary>
        <dl className="mt-3 flex flex-col divide-y divide-linha text-[15px]">
          {l.valores.map((v) => (
            <div key={v.chave} className="flex justify-between gap-3 py-2">
              <dt className="text-tinta-2">{v.rotulo}</dt>
              <dd className="text-right font-semibold text-tinta">{v.valor}</dd>
            </div>
          ))}
        </dl>
      </details>

      <BaseLegal fonte={l.fonte} demonstracao={l.demonstracao} />

      <Verificador municipio={l.municipio.slug} tipo={l.tipo} campos={l.verificador} />

      <Historico historico={l.historico} />

      <p className="text-[13px] leading-[1.45] text-tinta-3">
        Fora destas regras o pedido não é recusado: vai a um técnico da câmara, que pode aprovar na mesma. A decisão final é
        sempre da câmara.
      </p>
    </div>
  );
}
