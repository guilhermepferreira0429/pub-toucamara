"use client";

import { ArrowLeft, Check, CircleHelp, Info, X } from "lucide-react";
import Link from "next/link";
import { BaseLegal } from "@/components/regras/comum";
import type { MotivoExcecao } from "@/components/regras/tipos";
import { dataLonga } from "./formatar";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  ModoTeste,
  Nota,
  TituloSecao,
  Topo,
} from "./moldura";
import { usePublico } from "./use-publico";

/*
 * "Porque foi aprovada": as regras que a câmara aplicou a esta licença, as
 * que estavam em vigor no dia do pedido (não as de hoje), quem decidiu
 * (as regras, ou o cargo de quem aprovou) e a versão das regras.
 */

interface Porque {
  numero: string;
  tipo: string;
  titulo: string;
  feminino: boolean;
  municipio: string;
  estado: "a_pagar" | "por_aprovar" | "para_tecnico" | "emitida" | "recusada";
  pedida_em: string;
  decidida_em: string | null;
  decisao: "automatica" | "excecao" | "funcionario" | null;
  decidida_por: string | null;
  regras: { id: string; rotulo: string; ok: boolean; texto: string }[];
  excecao: MotivoExcecao[];
  condicoes: string[];
  versao: {
    numero: number | null;
    atual: number;
    em_vigor_hoje: boolean;
    vigor_desde: string | null;
    frases: { id: string; texto: string }[];
    valores: { chave: string; rotulo: string; valor: string }[];
    taxas: string[];
    condicoes: string[];
    fonte: { titulo: string; url: string | null };
    demonstracao: boolean;
  };
  modo_teste: boolean;
}

function titulo(p: Porque): string {
  const a = p.feminino ? "a" : "o";
  if (p.estado === "emitida") return `Porque foi ${p.feminino ? "aprovada" : "aprovado"}`;
  if (p.estado === "recusada") return `Porque não foi ${p.feminino ? "concedida" : "concedido"}`;
  return `Como está a ser ${p.feminino ? "decidida" : "decidido"} ${a} ${p.titulo.toLowerCase()}`;
}

export function PaginaPorque({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<Porque>(`/v1/public/licencas/${encodeURIComponent(codigo)}/porque`);
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;
  const p = c.dados;
  const v = p.versao;
  const todasOk = p.regras.every((r) => r.ok);

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={p.numero} mono />
      <Link
        href={`/licenca/${encodeURIComponent(codigo)}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-tinta-2 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar à licença
      </Link>
      <Cabecalho meta={`${p.titulo} · Câmara Municipal de ${p.municipio}`} titulo={titulo(p)} />

      <CartaoDestaque rotulo="Quem decidiu" tom={p.estado === "emitida" ? "verde" : "tinta"}>
        <p className="font-display text-[22px] leading-tight font-bold">
          {p.decidida_por ?? "Ainda não foi decidido"}
        </p>
        <p className="text-[15px] text-white/90">
          {p.estado === "emitida" && p.decisao === "automatica" && !p.excecao.length
            ? "O pedido cumpria todas as regras, por isso foi decidido automaticamente."
            : p.estado === "emitida" && !todasOk
              ? "O pedido não cumpria todas as regras automáticas: um técnico viu o caso e aprovou."
              : p.estado === "emitida"
                ? "O pedido cumpria as regras e uma pessoa da câmara confirmou."
                : `Pedido em ${dataLonga(p.pedida_em)}.`}
        </p>
      </CartaoDestaque>

      <section className="flex flex-col gap-3" aria-labelledby="aplicadas">
        <TituloSecao id="aplicadas">As regras aplicadas</TituloSecao>
        <ul className="flex flex-col gap-2.5">
          {p.regras.map((r) => (
            <li key={r.id} className="flex gap-3 rounded-2xl border border-linha bg-papel p-3.5">
              {r.ok ? (
                <Check className="mt-0.5 size-5 shrink-0 text-verde" aria-hidden />
              ) : (
                <X className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
              )}
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-bold tracking-[0.5px] text-tinta-3 uppercase">{r.rotulo}</span>
                <span className="text-[15px] text-tinta">
                  <span className="sr-only">{r.ok ? "Cumpre: " : "Não cumpre: "}</span>
                  {r.texto}
                </span>
              </span>
            </li>
          ))}
          {p.excecao
            .filter((m) => m.tipo === "dado_em_falta")
            .map((m) => (
              <li key={m.id} className="flex gap-3 rounded-2xl border border-ambar bg-papel p-3.5">
                <CircleHelp className="mt-0.5 size-5 shrink-0 text-ambar" aria-hidden />
                <span className="text-[15px] text-tinta">{m.texto}</span>
              </li>
            ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="versao">
        <TituloSecao id="versao">As regras desse dia</TituloSecao>
        <p className="text-[15px] leading-[1.45] text-tinta-2">
          {v.numero
            ? `Versão ${v.numero} das regras, em vigor desde ${v.vigor_desde ? dataLonga(v.vigor_desde) : "o início"}.`
            : "Regras anteriores ao histórico público."}{" "}
          {v.em_vigor_hoje
            ? "Continuam em vigor hoje."
            : `Entretanto mudaram (hoje vigora a versão ${v.atual}).`}
        </p>
        {!v.em_vigor_hoje && (
          <Nota icone={Info} tom="neutro">
            As licenças decidem-se com as regras do dia do pedido. As de hoje estão em{" "}
            <Link href={`/regras/licencas/${p.tipo}`} className="font-semibold underline underline-offset-2">
              regras públicas
            </Link>
            .
          </Nota>
        )}
        <ul className="flex flex-col gap-2">
          {v.frases.map((f) => (
            <li key={f.id} className="flex gap-2.5 text-[15px] leading-[1.45] text-tinta">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-terracota" />
              {f.texto}
            </li>
          ))}
        </ul>
        <details className="rounded-2xl border border-linha bg-papel p-4">
          <summary className="cursor-pointer text-[15px] font-semibold text-tinta">Os valores usados</summary>
          <dl className="mt-3 flex flex-col divide-y divide-linha text-[15px]">
            {v.valores.map((x) => (
              <div key={x.chave} className="flex justify-between gap-3 py-2">
                <dt className="text-tinta-2">{x.rotulo}</dt>
                <dd className="text-right font-semibold text-tinta">{x.valor}</dd>
              </div>
            ))}
          </dl>
          {v.taxas.length > 0 && <p className="mt-2 text-[14px] text-tinta-2">Taxa: {v.taxas.join(" ")}</p>}
        </details>
        <BaseLegal fonte={v.fonte} demonstracao={v.demonstracao} />
      </section>

      <div className="flex flex-wrap gap-2">{p.modo_teste && <ModoTeste texto="pagamento de teste" />}</div>
      <Link href="/regras" className="text-[15px] font-semibold text-terracota underline underline-offset-2">
        Ver todas as regras públicas da câmara
      </Link>
    </div>
  );
}
