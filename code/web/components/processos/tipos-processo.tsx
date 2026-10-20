"use client";

import {
  BadgeCheck,
  Building2,
  Info,
  Sparkles,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { SeparadoresProcessos } from "./navegacao";
import type { DocumentoTipo, TipoProcesso } from "./tipos";
import { ACarregar, Chip, RotuloSeccao, usePedido } from "./ui";

/*
 * V2 · Processos · Tipos e documentos (mxkWE). Só leitura: a API ainda não
 * tem escrita dos tipos (GET /v1/painel/tipos-processo).
 */

const TIPO_CAMPO: Record<string, string> = {
  texto: "texto",
  numero: "número",
  data: "data",
  sim_nao: "sim / não",
  morada: "morada",
  nif: "NIF",
  escolha: "escolha",
};

function verificacoes(d: DocumentoTipo): string[] {
  const r: string[] = [];
  if (d.gerado_pelo_sistema) r.push("gerado pelo sistema");
  if (Array.isArray(d.verificacoes)) {
    for (const v of d.verificacoes as { tipo?: string; meses?: number; dias?: number }[]) {
      if (v?.tipo === "validade") {
        if (v.meses) r.push(`validade de ${v.meses} ${v.meses === 1 ? "mês" : "meses"}`);
        else if (v.dias) r.push(`validade de ${v.dias} dias`);
      } else if (v?.tipo === "assinatura") r.push("assinado");
      else if (v?.tipo === "nif_requerente") r.push("NIF do requerente");
    }
  }
  return r;
}

function Detalhe({ t }: { t: TipoProcesso }) {
  const docs = [...t.documentos].sort((a, b) => a.ordem - b.ordem);
  return (
    <section
      aria-labelledby="titulo-tipo"
      className="flex min-w-0 flex-1 flex-col gap-[18px] rounded-2xl border border-linha bg-papel p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="titulo-tipo" className="font-display text-[22px] font-bold text-tinta">
          {t.nome}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <Chip tom="neutro" pequeno>
            Código {t.codigo}
          </Chip>
          {t.ativo ? (
            <Chip tom="verde" pequeno icone={BadgeCheck}>
              Ativo
            </Chip>
          ) : (
            <Chip tom="ambar" pequeno>
              Inativo · o agente não o propõe
            </Chip>
          )}
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <dt className="text-xs font-semibold text-tinta-2">Prazo de apreciação</dt>
          <dd className="flex h-10 items-center gap-2 rounded-[10px] bg-creme px-3 text-[13px] font-medium text-tinta">
            <Timer className="size-3.5 text-tinta-3" aria-hidden />
            {t.prazo_dias_uteis} dias úteis
          </dd>
        </div>
        <div className="flex flex-col gap-1.5">
          <dt className="text-xs font-semibold text-tinta-2">Serviço</dt>
          <dd className="flex h-10 items-center gap-2 rounded-[10px] bg-creme px-3 text-[13px] font-medium text-tinta">
            <Building2 className="size-3.5 text-tinta-3" aria-hidden />
            {t.servico ?? "Sem serviço definido"}
          </dd>
        </div>
      </dl>

      <div className="overflow-hidden rounded-xl border border-linha">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Documentos exigidos</caption>
          <thead>
            <tr className="bg-creme">
              <th scope="col" className="px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                Documentos exigidos
              </th>
              <th scope="col" className="px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                Verificamos sozinhos
              </th>
              <th scope="col" className="w-[110px] px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                Obrigatório
              </th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3.5 py-3 text-[13px] text-tinta-3">
                  Este tipo não exige documentos.
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id} className="border-t border-linha">
                  <td className="px-3.5 py-2.5 text-[13px] font-semibold text-tinta">{d.nome}</td>
                  <td className="px-3.5 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      {verificacoes(d).map((v) => (
                        <Chip key={v} tom="verde" pequeno icone={Sparkles}>
                          {v}
                        </Chip>
                      ))}
                      {verificacoes(d).length === 0 && (
                        <span className="text-xs text-tinta-3">só leitura do documento</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    {d.obrigatorio ? (
                      <Chip tom="verde" pequeno>Sim</Chip>
                    ) : (
                      <Chip tom="neutro" pequeno>Não</Chip>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {t.formulario.length > 0 && (
        <div className="flex flex-col gap-2">
          <RotuloSeccao as="h3">Requerimento · o que o agente pergunta</RotuloSeccao>
          <ul className="flex flex-col divide-y divide-linha rounded-xl border border-linha">
            {t.formulario.map((c) => (
              <li key={c.chave} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5">
                <span className="text-[13px] font-semibold text-tinta">{c.rotulo}</span>
                <span className="text-xs text-tinta-3">
                  {TIPO_CAMPO[c.tipo] ?? c.tipo}
                  {c.obrigatorio ? " · obrigatório" : " · opcional"}
                  {c.opcoes?.length ? ` · ${c.opcoes.join(", ")}` : ""}
                </span>
                {c.pergunta_do_agente && (
                  <span className="basis-full text-xs italic text-tinta-2">“{c.pergunta_do_agente}”</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl bg-creme-2 p-3.5">
        <RotuloSeccao as="h3">O que o agente diz ao munícipe</RotuloSeccao>
        <p className="text-[13px] text-tinta">
          {t.frase_do_agente ? `“${t.frase_do_agente}”` : "Sem frase definida: o agente explica a partir dos documentos exigidos."}
        </p>
      </div>
    </section>
  );
}

export function TiposProcesso() {
  const { pode } = useSessao();
  const r = usePedido<{ itens: TipoProcesso[] }>(
    pode("processos") ? "/v1/painel/tipos-processo" : null,
  );
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const itens = r.dados?.itens ?? [];
  const atual = itens.find((t) => t.id === escolhido) ?? itens[0] ?? null;

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Processos", "Tipos de processo"]}
        titulo="Processos"
        descricao="Como a câmara trata cada tipo de pedido."
        acoes={<SeparadoresProcessos atual="/painel/processos/tipos" />}
      />
      {!pode("processos") ? (
        <Aviso titulo="Sem acesso aos processos." />
      ) : r.erro && !r.dados ? (
        <Aviso titulo="Não foi possível carregar os tipos de processo." tom="erro">
          {r.erro.message}
        </Aviso>
      ) : !r.dados ? (
        <ACarregar className="px-10" />
      ) : itens.length === 0 ? (
        <Aviso titulo="Ainda não há tipos de processo.">
          A equipa Tou, Câmara? configura-os com a câmara.
        </Aviso>
      ) : (
        <div className="flex flex-col gap-4 px-10">
          <p className="flex items-center gap-2 text-xs text-tinta-3">
            <Info className="size-3.5" aria-hidden />
            Para mudar prazos, documentos ou o formulário, fale com a equipa
            Tou, Câmara?: a edição aqui ainda não está disponível.
          </p>
          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <nav
              aria-label="Tipos de processo"
              className="w-full shrink-0 overflow-hidden rounded-2xl border border-linha bg-papel lg:w-[340px]"
            >
              <p className="px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                {itens.length} {itens.length === 1 ? "tipo" : "tipos"}
              </p>
              <ul>
                {itens.map((t) => {
                  const ativo = t.id === atual?.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setEscolhido(t.id)}
                        aria-current={ativo ? "true" : undefined}
                        className={`flex w-full flex-col gap-[3px] px-4 py-3 text-left hover:bg-creme ${
                          ativo ? "bg-creme" : ""
                        } ${t.ativo ? "" : "opacity-60"}`}
                      >
                        <span className="text-sm font-semibold text-tinta">
                          {t.codigo} · {t.nome}
                        </span>
                        <span className="text-xs text-tinta-3">
                          {t.documentos.length}{" "}
                          {t.documentos.length === 1 ? "documento" : "documentos"} ·{" "}
                          {t.prazo_dias_uteis} dias úteis
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {atual && <Detalhe t={atual} />}
          </div>
        </div>
      )}
    </div>
  );
}
