"use client";

import { BadgeCheck, Bot, Check, CircleHelp, ExternalLink, FileText, MessageSquareText, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  classeEntrada,
  ErroLinha,
  Estado,
  euros,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { AExpirar } from "@/components/licencas/a-expirar";
import { IndicadorExcecoes } from "@/components/licencas/excecoes";
import { InfoTipo, RegrasTipo, TipoLicenca } from "@/components/licencas/regras-tipo";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { FiltrosRecolhiveis } from "@/components/painel/telemovel";
import { Botao } from "@/components/ui/botao";
import { API_URL } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Licenças decididas na chamada (ruído, ocupação da via pública,
 * esplanada, dístico de residente, publicidade, recinto improvisado). O
 * separador "A expirar" é o calendário de obrigações (avisos antes de a
 * licença expirar e renovações). O agente verifica as regras durante a
 * chamada; aqui um funcionário vê o que foi verificado e aprova com um
 * clique. À direita, as regras em código do tipo escolhido, com os números
 * da câmara e o "Simular" contra os pedidos antigos.
 */

type Estado = "a_pagar" | "por_aprovar" | "para_tecnico" | "emitida" | "recusada";

interface Licenca {
  id: string;
  numero: string;
  processo_id: string;
  tipo: TipoLicenca;
  tipo_nome: string;
  estado: Estado;
  proposta: "aprovar" | "tecnico";
  resumo: {
    atividade: string;
    descricao: string;
    morada: string;
    rotulo_dia: string;
    dia: string;
    horario: string | null;
    detalhes: { rotulo: string; valor: string }[];
  };
  avaliacao: { regras: { id: string; ok: boolean; texto: string }[]; condicoes: string[] };
  taxa_cent: number;
  taxa_se_aprovada_cent: number;
  titular: string | null;
  telefone: string | null;
  conversa_id: string | null;
  pagamento: { estado: string; metodo: string | null; valor_cent: number; modo_teste: boolean } | null;
  codigo_verificacao: string | null;
  decidida_por_nome: string | null;
  decidida_em: string | null;
  motivo_recusa: string | null;
  criada_em: string;
  /** Como foi decidida: sozinha, exceção (com motivos) ou funcionário por escolha da câmara. */
  decisao?: "automatica" | "excecao" | "funcionario" | null;
  excecao?: { tipo: "regra" | "dado_em_falta"; id: string; rotulo: string; texto: string }[];
}

interface Lista {
  licencas: Licenca[];
  contagens: Record<Estado, number>;
  tipos: InfoTipo[];
}

const ESTADOS: Record<Estado, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" | "tinta" }> = {
  por_aprovar: { rotulo: "paga · por aprovar", tom: "terracota" },
  para_tecnico: { rotulo: "para técnico", tom: "ambar" },
  a_pagar: { rotulo: "à espera do pagamento", tom: "neutro" },
  emitida: { rotulo: "emitida", tom: "verde" },
  recusada: { rotulo: "recusada", tom: "neutro" },
};

const FILTROS: (Estado | "todas")[] = ["todas", "por_aprovar", "para_tecnico", "a_pagar", "emitida", "recusada"];

export function PaginaLicencas() {
  const { pode } = useSessao();
  const [filtro, setFiltro] = useState<Estado | "todas">("todas");
  const [tipo, setTipo] = useState<TipoLicenca | "todos">("todos");
  const [vista, setVista] = useState<"pedidos" | "a_expirar">("pedidos");
  const params = new URLSearchParams();
  if (filtro !== "todas") params.set("estado", filtro);
  if (tipo !== "todos") params.set("tipo", tipo);
  const caminho = pode("processos") ? `/v1/painel/licencas${params.size ? `?${params}` : ""}` : null;
  const d = useDados<Lista>(caminho);
  const tipos = d.dados?.tipos ?? [];
  const regras = tipos.find((t) => t.tipo === (tipo === "todos" ? "ruido" : tipo));

  if (!pode("processos")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Licenças"]} titulo="Licenças" />
        <SemAcesso />
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Licenças"]}
        titulo="Licenças decididas na chamada"
        descricao="O agente verifica as regras enquanto a pessoa está ao telefone. Dentro das regras, a taxa paga-se logo e aqui só falta um clique. Fora das regras, chega ao técnico já analisado."
      />
      <div className="flex gap-1 overflow-x-auto px-4 pb-4 sm:px-10 [&>*]:shrink-0 [&>*]:whitespace-nowrap" role="tablist" aria-label="Vista">
        {(
          [
            ["pedidos", "Pedidos"],
            ["a_expirar", "A expirar"],
          ] as const
        ).map(([v, rotulo]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={vista === v}
            onClick={() => setVista(v)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold ${
              vista === v ? "border-terracota text-tinta" : "border-transparent text-tinta-3 hover:text-tinta-2"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {/* No telemóvel, os filtros (tipo e estado) ficam atrás do botão "Filtros". */}
      <div className="max-md:px-4 max-md:pb-4 md:contents">
        <FiltrosRecolhiveis
          ativos={(tipo !== "todos" ? 1 : 0) + (filtro !== "todas" ? 1 : 0)}
          className="flex flex-col gap-3 max-md:pt-3 md:contents"
        >
          <div className="flex flex-wrap gap-2 md:px-10 md:pb-3" role="group" aria-label="Tipo de licença">
            {(["todos", ...tipos.map((t) => t.tipo)] as const).map((t) => {
              const info = tipos.find((x) => x.tipo === t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tipo === t}
                  onClick={() => setTipo(t)}
                  className={`rounded-[10px] border px-3.5 py-2 text-[13px] font-semibold ${
                    tipo === t ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta-2"
                  }`}
                >
                  {info ? info.nome : "Todos os tipos"}
                  {info?.pedidos ? ` · ${info.pedidos}` : ""}
                </button>
              );
            })}
          </div>
          <div
            className={`flex flex-wrap gap-2 md:px-10 md:pb-5 ${vista === "a_expirar" ? "hidden" : ""}`}
            role="group"
            aria-label="Estado"
          >
            {FILTROS.map((f) => {
              const n = f === "todas" ? null : d.dados?.contagens[f];
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filtro === f}
                  onClick={() => setFiltro(f)}
                  className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
                    filtro === f ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
                  }`}
                >
                  {f === "todas" ? "Todas" : ESTADOS[f].rotulo}
                  {n ? ` · ${n}` : ""}
                </button>
              );
            })}
          </div>
        </FiltrosRecolhiveis>
      </div>
      <div className="grid grid-cols-1 gap-6 px-4 sm:px-10 xl:grid-cols-[minmax(0,1fr)_380px]">
        {vista === "a_expirar" ? (
          <AExpirar tipo={tipo} />
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <Estado
              aCarregar={d.aCarregar}
              erro={d.erro}
              vazio={d.dados?.licencas.length === 0}
              textoVazio="Ainda não há pedidos. Ligue para a linha e peça uma licença: de ruído para uma festa, um andaime, uma esplanada, o dístico de residente, uma placa publicitária ou um arraial."
            >
              {(d.dados?.licencas ?? []).map((l) => (
                <CartaoLicenca key={l.id} l={l} onMudou={d.recarregar} />
              ))}
            </Estado>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-6">
          <IndicadorExcecoes onMudou={d.recarregar} />
          {regras && <RegrasTipo key={`${regras.tipo}:${regras.atualizado_em}`} info={regras} onMudou={d.recarregar} />}
        </div>
      </div>
    </div>
  );
}

function CartaoLicenca({ l, onMudou }: { l: Licenca; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [recusar, setRecusar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const e = ESTADOS[l.estado];
  const decidir = async (caminho: string, corpo?: object) => {
    const r = await acao.executar(() => pedido(caminho, { metodo: "POST", corpo }));
    if (r !== undefined) {
      setRecusar(false);
      onMudou();
    }
  };

  return (
    <Cartao className={l.estado === "por_aprovar" ? "border-terracota" : ""}>
      <div className="grid grid-cols-1 items-start gap-4 border-b border-linha px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-tinta">{l.numero}</span>
            <Pilula tom="tinta">{l.tipo_nome}</Pilula>
            <Pilula tom={e.tom}>{e.rotulo}</Pilula>
            {l.proposta === "aprovar" ? (
              <Pilula tom="verde" icone={Check}>
                cumpre as regras
              </Pilula>
            ) : (
              <Pilula tom="ambar" icone={X}>
                fora das regras
              </Pilula>
            )}
            {l.decisao === "automatica" && (
              <Pilula tom="verde" icone={Bot}>
                decidida automaticamente
              </Pilula>
            )}
            {l.decisao === "excecao" &&
              (l.estado === "emitida" ? (
                <Pilula tom="neutro" icone={Check}>
                  exceção aprovada{l.decidida_por_nome ? ` por ${l.decidida_por_nome}` : ""}
                </Pilula>
              ) : (
                <Pilula tom="ambar" icone={TriangleAlert}>
                  exceção
                </Pilula>
              ))}
            {l.decisao === "funcionario" && <Pilula tom="neutro">funcionário confirma (escolha da câmara)</Pilula>}
          </div>
          <span className="font-display text-lg font-bold text-tinta">
            {l.tipo === "ruido" ? l.resumo.descricao : l.resumo.atividade}
          </span>
          <span className="text-[13px] text-tinta-2">
            <span className="first-letter:uppercase">{l.resumo.dia}</span>
            {l.resumo.horario ? `, das ${l.resumo.horario}` : ""} · {l.resumo.morada}
          </span>
          {l.resumo.detalhes.length > 0 && (
            <span className="text-[13px] text-tinta-2">
              {l.resumo.detalhes.map((x) => `${x.rotulo}: ${x.valor}`).join(" · ")}
            </span>
          )}
          <span className="text-xs text-tinta-3">
            {l.titular ?? "Sem nome"}
            {l.telefone ? ` · ${l.telefone}` : ""} · pedido {quando(l.criada_em)}
          </span>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end sm:text-right">
          {l.estado === "para_tecnico" ? (
            <span className="text-xs text-tinta-3">
              taxa de {euros(l.taxa_se_aprovada_cent)}
              <br />
              se o técnico aprovar
            </span>
          ) : (
            <span className="font-display text-xl font-bold text-tinta">{euros(l.taxa_cent)}</span>
          )}
          {l.pagamento && (
            <span className="text-xs text-tinta-3">
              {l.pagamento.estado === "pago" ? "pago" : "por pagar"}
              {l.pagamento.metodo ? ` · ${l.pagamento.metodo === "mbway" ? "MB WAY" : "Multibanco"}` : ""}
              {l.pagamento.modo_teste ? " · teste" : ""}
            </span>
          )}
        </div>
      </div>

      {(l.excecao ?? []).length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-linha bg-ambar-suave/40 px-5 py-3">
          <Rotulo>{l.decisao === "excecao" ? "Porque é uma exceção" : "O que falta saber"}</Rotulo>
          <ul className="flex flex-col gap-1">
            {(l.excecao ?? []).map((m) => (
              <li key={`${m.tipo}:${m.id}`} className="flex items-start gap-2 text-[13px] text-tinta">
                {m.tipo === "regra" ? (
                  <X className="mt-0.5 size-4 shrink-0 text-terracota" aria-hidden />
                ) : (
                  <CircleHelp className="mt-0.5 size-4 shrink-0 text-ambar" aria-hidden />
                )}
                <span>
                  <span className="font-semibold">{m.tipo === "regra" ? m.rotulo : `Falta: ${m.rotulo.toLowerCase()}`}</span>
                  {" · "}
                  {m.texto}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:px-5 md:grid-cols-2">
        <div>
          <Rotulo>Verificado pelo agente</Rotulo>
          <ul className="mt-2 flex flex-col gap-1.5">
            {l.avaliacao.regras.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[13px] text-tinta">
                {r.ok ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-verde" aria-label="cumpre" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-terracota" aria-label="não cumpre" />
                )}
                {r.texto}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Rotulo>Condições na licença</Rotulo>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[13px] text-tinta-2">
            {l.avaliacao.condicoes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linha px-5 py-3">
        <div className="flex flex-wrap gap-3 text-[13px] font-semibold">
          <Link href={`/painel/processos/${l.processo_id}`} className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta">
            <FileText className="size-4" aria-hidden /> processo
          </Link>
          {l.conversa_id && (
            <Link href={`/painel/conversas/${l.conversa_id}`} className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta">
              <MessageSquareText className="size-4" aria-hidden /> conversa
            </Link>
          )}
          {l.codigo_verificacao && (
            <>
              <a href={`/licenca/${l.codigo_verificacao}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-terracota">
                <ExternalLink className="size-4" aria-hidden /> licença com QR
              </a>
              <a
                href={`${API_URL}/v1/public/licencas/${l.codigo_verificacao}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta"
              >
                PDF
              </a>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {l.estado === "emitida" && (
            <span className="text-xs text-tinta-3">
              Emitida {quando(l.decidida_em)}
              {l.decidida_por_nome ? ` · ${l.decidida_por_nome}` : " · automática"}
            </span>
          )}
          {l.estado === "recusada" && <span className="text-xs text-tinta-3">Recusada: {l.motivo_recusa}</span>}
          {(l.estado === "por_aprovar" || l.estado === "para_tecnico") && (
            <>
              <Botao tamanho="pequeno" variante="discreto" onClick={() => setRecusar((x) => !x)}>
                Recusar
              </Botao>
              <Botao
                tamanho="pequeno"
                icone={BadgeCheck}
                disabled={acao.aCorrer}
                onClick={() => decidir(`/v1/painel/licencas/${l.id}/aprovar`)}
              >
                {l.estado === "por_aprovar" ? "Aprovar e emitir" : "Aprovar mesmo assim"}
              </Botao>
            </>
          )}
        </div>
      </div>
      {recusar && (
        <div className="flex flex-col gap-2 border-t border-linha px-5 py-3">
          <input
            className={classeEntrada}
            placeholder="Porquê (vai por SMS à pessoa)"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
          />
          <div className="flex justify-end">
            <Botao
              tamanho="pequeno"
              variante="secundario"
              disabled={acao.aCorrer || motivo.trim().length < 5}
              onClick={() => decidir(`/v1/painel/licencas/${l.id}/recusar`, { motivo: motivo.trim() })}
            >
              Recusar e avisar
            </Botao>
          </div>
        </div>
      )}
      <ErroLinha erro={acao.erro} className="mx-5 mb-4" />
    </Cartao>
  );
}
