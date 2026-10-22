"use client";

import { ExternalLink, FileText, FlaskConical, MessageSquareText, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  dia,
  Estado,
  euros,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useDados,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Filtro } from "@/components/painel/filtro";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Pagamentos e taxas. As guias que o agente emite (Multibanco ou
 * MB WAY), com o estado de cada uma, e a tabela de taxas em vigor de onde
 * saem os valores (com a fonte e a data em que foi lida).
 */

type EstadoPag = "pendente" | "pago" | "expirado" | "cancelado";
type MetodoPag = "multibanco" | "mbway" | "cartao";
type Unidade = "fixo" | "m2" | "dia" | "pagina" | "fogo" | "mesa";

interface Pagamento {
  id: string;
  processo_id: string | null;
  requerimento_id: string | null;
  guia_numero: string | null;
  valor_cent: number;
  detalhe: { codigo: string; descricao: string; quantidade: number; valor_cent: number }[] | null;
  metodo: MetodoPag | null;
  mb_entidade: string | null;
  mb_referencia: string | null;
  pagar_ate: string | null;
  estado: EstadoPag;
  modo_teste: boolean;
  pago_em: string | null;
  criado_em: string;
  conversa_id: string | null;
  processo_numero: string | null;
  tipo_processo: string | null;
  municipe_nome: string | null;
  mbway: { estado: string; expira_em: string; pedidos_feitos: number } | null;
}

interface TabelaTaxas {
  id: string;
  ano: number;
  vigor_desde: string;
  vigor_ate: string | null;
  fonte: { titulo: string; url: string | null; lida_em: string } | null;
  taxas: {
    codigo: string;
    descricao: string;
    unidade: Unidade;
    valor_cent: number;
    tipo_processo_codigo: string | null;
  }[];
}

const ESTADOS: Record<EstadoPag, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }> = {
  pendente: { rotulo: "por pagar", tom: "ambar" },
  pago: { rotulo: "pago", tom: "verde" },
  expirado: { rotulo: "expirado", tom: "terracota" },
  cancelado: { rotulo: "cancelado", tom: "neutro" },
};

const METODOS: Record<MetodoPag, string> = {
  multibanco: "Multibanco",
  mbway: "MB WAY",
  cartao: "Cartão",
};

const MBWAY: Record<string, string> = {
  por_aceitar: "pedido MB WAY por aceitar",
  expirado: "pedido MB WAY expirou",
  pago: "MB WAY aceite",
  cancelado: "pedido MB WAY recusado",
};

const UNIDADES: Record<Unidade, string> = {
  fixo: "valor fixo",
  m2: "por m²",
  dia: "por dia",
  pagina: "por página",
  fogo: "por fogo",
  mesa: "por mesa",
};

/** '123456789' → '123 456 789'. */
function referencia(r: string | null): string {
  if (!r) return "—";
  return r.replace(/(\d{3})(?=\d)/g, "$1 ");
}

export function PaginaPagamentos() {
  const { pode } = useSessao();
  const permitido = pode("processos");
  const [separador, setSeparador] = useState<"pagamentos" | "taxas">("pagamentos");

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Pagamentos"]} titulo="Pagamentos e taxas" />
        <SemAcesso />
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Pagamentos"]}
        titulo="Pagamentos e taxas"
        descricao="As guias que o agente emite na conversa, por Multibanco ou MB WAY, e a tabela de taxas de onde saem os valores."
      />
      <div className="flex gap-1 px-10 pb-5" role="tablist">
        {(
          [
            ["pagamentos", "Pagamentos"],
            ["taxas", "Tabela de taxas em vigor"],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={separador === k}
            onClick={() => setSeparador(k)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
              separador === k ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="px-10">{separador === "pagamentos" ? <ListaPagamentos /> : <Taxas />}</div>
    </div>
  );
}

function ListaPagamentos() {
  const [estado, setEstado] = useState<EstadoPag | "">("");
  const [metodo, setMetodo] = useState<MetodoPag | "">("");
  const params = new URLSearchParams({ limite: "50" });
  if (estado) params.set("estado", estado);
  if (metodo) params.set("metodo", metodo);
  const base = `/v1/painel/pagamentos?${params.toString()}`;
  const lista = useDados<Pagina<Pagamento>>(base);
  const mais = useMais(base, lista);
  const itens = lista.dados?.itens ?? [];

  const soma = (e: EstadoPag) => itens.filter((p) => p.estado === e).reduce((s, p) => s + p.valor_cent, 0);
  const n = (e: EstadoPag) => itens.filter((p) => p.estado === e).length;
  const teste = itens.some((p) => p.modo_teste);
  // Com todas as guias em teste basta o aviso único; a marca por linha só
  // serve quando há guias reais e de teste misturadas.
  const misturadas = teste && itens.some((p) => !p.modo_teste);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Filtro
          rotulo="Estado"
          valor={estado}
          onMudar={setEstado}
          opcoes={[{ v: "", t: "Todos" }, ...(Object.keys(ESTADOS) as EstadoPag[]).map((e) => ({ v: e, t: ESTADOS[e].rotulo }))]}
        />
        <Filtro
          rotulo="Método"
          valor={metodo}
          onMudar={setMetodo}
          opcoes={[{ v: "", t: "Todos" }, ...(Object.keys(METODOS) as MetodoPag[]).map((m) => ({ v: m, t: METODOS[m] }))]}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Cartao className="flex flex-col gap-1 p-4">
          <Rotulo>Pago (nesta lista)</Rotulo>
          <span className="font-display text-2xl font-bold text-verde">{euros(soma("pago"))}</span>
          <span className="text-xs text-tinta-3">{n("pago")} {n("pago") === 1 ? "guia" : "guias"}</span>
        </Cartao>
        <Cartao className="flex flex-col gap-1 p-4">
          <Rotulo>Por pagar (nesta lista)</Rotulo>
          <span className="font-display text-2xl font-bold text-ambar">{euros(soma("pendente"))}</span>
          <span className="text-xs text-tinta-3">{n("pendente")} {n("pendente") === 1 ? "guia" : "guias"}</span>
        </Cartao>
        <Cartao className="flex flex-col justify-center gap-2 p-4">
          {teste ? (
            <>
              <Pilula tom="ambar" icone={FlaskConical}>
                modo de teste
              </Pilula>
              <span className="text-xs text-tinta-3">
                Referências fictícias, sem banco: nenhum valor foi cobrado de verdade.
              </span>
            </>
          ) : (
            <span className="text-xs text-tinta-3">
              {itens.length} {itens.length === 1 ? "guia" : "guias"} na lista
              {mais.haMais ? " (há mais abaixo)" : ""}.
            </span>
          )}
        </Cartao>
      </div>

      <Cartao className="overflow-x-auto" tabIndex={0}>
        <Estado
          aCarregar={lista.aCarregar}
          erro={lista.erro}
          vazio={itens.length === 0}
          textoVazio="Não há pagamentos com estes filtros."
        >
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-linha text-[11px] font-bold tracking-[0.4px] text-tinta-3 uppercase">
                <th className="px-4 py-3">Guia</th>
                <th className="px-4 py-3">Processo</th>
                <th className="px-4 py-3">Munícipe</th>
                <th className="px-4 py-3">Método</th>
                <th className="px-4 py-3">Referência</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {itens.map((p) => (
                <LinhaPagamento key={p.id} p={p} marcarTeste={misturadas} />
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>
      {mais.haMais && (
        <div className="flex justify-center">
          <Botao variante="secundario" tamanho="pequeno" disabled={mais.aCorrer} onClick={mais.mais}>
            Ver mais
          </Botao>
        </div>
      )}
    </div>
  );
}

function LinhaPagamento({ p, marcarTeste }: { p: Pagamento; marcarTeste: boolean }) {
  const e = ESTADOS[p.estado];
  const descricao = p.detalhe?.map((d) => d.descricao).join(" · ");
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <span className="font-mono text-[13px] font-semibold text-tinta">{p.guia_numero ?? "—"}</span>
        <span className="block text-xs text-tinta-3">{quando(p.criado_em)}</span>
      </td>
      <td className="px-4 py-3">
        {p.processo_id ? (
          <Link
            href={`/painel/processos/${p.processo_id}`}
            className="inline-flex items-center gap-1 font-mono text-[13px] font-semibold text-terracota hover:underline"
          >
            <FileText className="size-3.5" aria-hidden />
            {p.processo_numero ?? "processo"}
          </Link>
        ) : p.requerimento_id ? (
          <Link
            href={`/painel/requerimentos/${p.requerimento_id}`}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-terracota hover:underline"
          >
            <FileText className="size-3.5" aria-hidden />
            {p.processo_numero ?? "requerimento"}
          </Link>
        ) : (
          <span className="text-tinta-3">—</span>
        )}
        {p.tipo_processo && <span className="block text-xs text-tinta-3">{p.tipo_processo}</span>}
        {descricao && (
          <span className="block max-w-[260px] truncate text-xs text-tinta-3" title={descricao}>
            {descricao}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-tinta">{p.municipe_nome ?? "—"}</span>
        {p.conversa_id && (
          <Link
            href={`/painel/conversas/${p.conversa_id}`}
            className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-tinta-2 hover:text-tinta"
          >
            <MessageSquareText className="size-3.5" aria-hidden /> conversa
          </Link>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-tinta">{p.metodo ? METODOS[p.metodo] : "por escolher"}</span>
        {p.mbway && <span className="block text-xs text-tinta-3">{MBWAY[p.mbway.estado] ?? p.mbway.estado}</span>}
      </td>
      <td className="px-4 py-3">
        {p.mb_referencia ? (
          <>
            <span className="font-mono text-[13px] text-tinta">{referencia(p.mb_referencia)}</span>
            <span className="block text-xs text-tinta-3">entidade {p.mb_entidade ?? "—"}</span>
          </>
        ) : (
          <span className="text-tinta-3">—</span>
        )}
        {p.pagar_ate && p.estado === "pendente" && (
          <span className="block text-xs text-tinta-3">pagar até {dia(p.pagar_ate)}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-display text-base font-bold whitespace-nowrap text-tinta">
        {euros(p.valor_cent)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1">
          <Pilula tom={e.tom}>{e.rotulo}</Pilula>
          {marcarTeste && p.modo_teste && (
            <Pilula tom="ambar" icone={FlaskConical}>
              teste
            </Pilula>
          )}
          {p.pago_em && <span className="text-xs text-tinta-3">{quando(p.pago_em)}</span>}
        </div>
      </td>
    </tr>
  );
}

function Taxas() {
  const t = useDados<TabelaTaxas>("/v1/painel/taxas");
  const tabela = t.dados;
  return (
    <Cartao>
      <Estado aCarregar={t.aCarregar} erro={t.erro} vazio={!tabela}>
        {tabela && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-linha px-5 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-display text-lg font-bold text-tinta">
                  <Receipt className="size-5 text-terracota" aria-hidden />
                  Tabela de taxas de {tabela.ano}
                </span>
                <span className="text-[13px] text-tinta-2">
                  Em vigor desde {dia(tabela.vigor_desde)}
                  {tabela.vigor_ate ? ` até ${dia(tabela.vigor_ate)}` : ""}. O agente faz as contas só com estes valores.
                </span>
              </div>
              <div className="flex flex-col items-end gap-1 text-right text-xs text-tinta-3">
                {tabela.fonte ? (
                  <>
                    <span>
                      Fonte:{" "}
                      {tabela.fonte.url ? (
                        <a
                          href={tabela.fonte.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-terracota hover:underline"
                        >
                          {tabela.fonte.titulo} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : (
                        <span className="font-semibold text-tinta-2">{tabela.fonte.titulo}</span>
                      )}
                    </span>
                    <span>lida {quando(tabela.fonte.lida_em)}</span>
                  </>
                ) : (
                  <Pilula tom="ambar">sem fonte ligada · valores de demonstração</Pilula>
                )}
              </div>
            </div>
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-linha text-[11px] font-bold tracking-[0.4px] text-tinta-3 uppercase">
                    <th className="px-5 py-3">Código</th>
                    <th className="px-5 py-3">Taxa</th>
                    <th className="px-5 py-3">Tipo de processo</th>
                    <th className="px-5 py-3">Unidade</th>
                    <th className="px-5 py-3 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {tabela.taxas.map((x) => (
                    <tr key={x.codigo}>
                      <td className="px-5 py-3 font-mono text-[13px] text-tinta-2">{x.codigo}</td>
                      <td className="px-5 py-3 text-tinta">{x.descricao}</td>
                      <td className="px-5 py-3 text-tinta-2">{x.tipo_processo_codigo ?? "todos"}</td>
                      <td className="px-5 py-3 text-tinta-2">{UNIDADES[x.unidade] ?? x.unidade}</td>
                      <td className="px-5 py-3 text-right font-semibold whitespace-nowrap text-tinta">
                        {euros(x.valor_cent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tabela.taxas.length === 0 && <p className="p-5 text-sm text-tinta-3">A tabela não tem taxas.</p>}
          </>
        )}
      </Estado>
    </Cartao>
  );
}
