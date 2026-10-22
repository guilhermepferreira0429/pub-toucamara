"use client";

import { CircleCheck, CircleDashed, ExternalLink, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import {
  ACAO_ROTULO,
  BotaoComprovativo,
  dataHora,
  PilulaEstado,
  PilulaSimulado,
} from "./comum-painel";
import {
  ESTADO_ROTULO,
  type DetalheEntrega,
  type EntregaPainel,
  type EstadoEntrega,
  type ListaEntregas,
  type ModoEntrega,
} from "./tipos";

/** O modo atual (simulado / real por configurar) e o que falta para a entrega real. */
export function CartaoModo({ modo }: { modo: ModoEntrega }) {
  const titulo =
    modo.estado === "simulado"
      ? "Modo de demonstração: tudo simulado"
      : modo.estado === "real_por_configurar"
        ? "Modo real, por configurar"
        : "Modo real";
  const linha = (
    rotulo: string,
    p: { rotulo: string; simulada: boolean; configurada: boolean; em_falta: string[] },
  ) => (
    <li className="flex flex-col gap-1 border-t border-linha py-3 first:border-t-0">
      <span className="flex flex-wrap items-center gap-2 text-sm">
        {p.configurada && !p.simulada ? (
          <CircleCheck className="size-4 text-verde" aria-hidden />
        ) : (
          <CircleDashed className="size-4 text-ambar" aria-hidden />
        )}
        <span className="font-semibold text-tinta">{rotulo}:</span>
        <span className="text-tinta-2">{p.rotulo}</span>
        {p.simulada ? (
          <Pilula tom="ambar">simulado</Pilula>
        ) : p.configurada ? (
          <Pilula tom="verde">configurado</Pilula>
        ) : (
          <Pilula tom="terracota">por configurar</Pilula>
        )}
      </span>
      {p.em_falta.length > 0 && (
        <span className="pl-6 text-xs text-tinta-2">
          Falta definir: <code className="font-mono">{p.em_falta.join(", ")}</code>
        </span>
      )}
    </li>
  );
  return (
    <Cartao className="p-5" aria-labelledby="modo-entregas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="modo-entregas" className="font-display text-lg font-bold text-tinta">
          {titulo}
        </h2>
        <Pilula tom={modo.simulado ? "ambar" : "verde"}>
          {modo.simulado ? "sem validade legal" : "com autenticação real"}
        </Pilula>
      </div>
      {modo.aviso && <p className="mt-1 text-sm text-tinta-2">{modo.aviso}</p>}
      <ul className="mt-3">
        {linha("Autenticação", modo.autenticacao)}
        {linha("Submissão", modo.submissao)}
      </ul>
      {modo.o_que_falta.length > 0 && (
        <div className="mt-2 rounded-xl bg-creme-2 p-4">
          <Rotulo>O que falta para a entrega real</Rotulo>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-tinta">
            {modo.o_que_falta.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-tinta-2">
            Os passos, quem os faz e as variáveis estão em{" "}
            <code className="font-mono">{modo.documento}</code>. O link de autorização vale{" "}
            {modo.validade_horas} horas.
          </p>
        </div>
      )}
    </Cartao>
  );
}

function DialogoCancelar({
  entrega,
  onFechar,
  onFeito,
}: {
  entrega: EntregaPainel | null;
  onFechar: () => void;
  onFeito: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [motivo, setMotivo] = useState("");
  return (
    <Dialogo titulo="Cancelar a entrega" aberto={!!entrega} onFechar={onFechar}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!entrega) return;
          const r = await acao.executar(() =>
            pedido(`/v1/painel/entregas/${entrega.id}/cancelar`, { corpo: { motivo } }),
          );
          if (r) {
            setMotivo("");
            onFeito();
          }
        }}
      >
        <p className="text-sm text-tinta-2">
          O link de autorização deixa de servir e nada é entregue. Fica registado na auditoria.
        </p>
        <Campo rotulo="Motivo">
          <input
            className={classeEntrada}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            minLength={3}
            required
          />
        </Campo>
        <ErroLinha erro={acao.erro} />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="h-10 rounded-full px-4 text-sm font-semibold text-tinta-2 hover:bg-creme-2"
          >
            Voltar
          </button>
          <button
            type="submit"
            disabled={acao.aCorrer || motivo.trim().length < 3}
            className="h-10 rounded-full bg-terracota px-4 text-sm font-semibold text-white hover:bg-terracota-escuro disabled:opacity-60"
          >
            {acao.aCorrer ? "A cancelar…" : "Cancelar a entrega"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

const ATOR: Record<string, string> = {
  municipe: "munícipe",
  agente: "agente",
  sistema: "sistema",
  utilizador: "funcionário",
};

function DialogoDetalhe({ id, onFechar }: { id: string | null; onFechar: () => void }) {
  const d = useDados<DetalheEntrega>(id ? `/v1/painel/entregas/${id}` : null);
  const e = d.dados;
  return (
    <Dialogo titulo="Entrega em nome do munícipe" aberto={!!id} onFechar={onFechar} largura="max-w-2xl">
      <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!e}>
        {e && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <PilulaEstado estado={e.estado} />
              <PilulaSimulado simulado={e.simulado} />
              <span className="font-semibold text-tinta">{e.tipo.nome}</span>
              {e.numero_entrada && (
                <span className="font-mono text-tinta">{e.numero_entrada}</span>
              )}
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-tinta-3">Munícipe</dt>
              <dd>{e.municipe?.nome ?? "—"}</dd>
              <dt className="text-tinta-3">Confirmou</dt>
              <dd>
                «{e.confirmacao}» · {dataHora(e.confirmado_em)} ({e.canal})
              </dd>
              <dt className="text-tinta-3">Autenticação</dt>
              <dd>
                {e.autenticacao.modo === "simulada" ? "Chave Móvel Digital simulada" : "autenticacao.gov"}
                {e.autenticacao.nivel_garantia ? ` · nível ${e.autenticacao.nivel_garantia}` : ""}
                {e.autenticacao.nif_mascarado ? ` · NIF ${e.autenticacao.nif_mascarado}` : ""}
              </dd>
              <dt className="text-tinta-3">Link válido até</dt>
              <dd>{dataHora(e.expira_em)}</dd>
              {e.erro && (
                <>
                  <dt className="text-tinta-3">Erro</dt>
                  <dd className="text-terracota-escuro">{e.erro}</dd>
                </>
              )}
            </dl>
            <div>
              <Rotulo>Histórico</Rotulo>
              <ol className="mt-2 flex flex-col gap-1.5">
                {e.historico.map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-28 shrink-0 text-tinta-3">{dataHora(h.em)}</span>
                    <span className="text-tinta">
                      {ACAO_ROTULO[h.acao] ?? h.acao}
                      <span className="text-tinta-3"> · {ATOR[h.ator_tipo] ?? h.ator_tipo}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {e.estado === "entregue" && (
              <BotaoComprovativo entregaId={e.id} numero={e.numero_entrada} />
            )}
          </div>
        )}
      </Estado>
    </Dialogo>
  );
}

/** Uma linha da lista (também usada na ficha do processo). */
export function LinhaEntrega({
  e,
  onDetalhe,
  onCancelar,
  onAtualizado,
  mostrarProcesso = true,
}: {
  e: EntregaPainel;
  mostrarProcesso?: boolean;
  onDetalhe?: () => void;
  onCancelar?: () => void;
  onAtualizado: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  return (
    <li className="flex flex-col gap-2 border-t border-linha px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <PilulaEstado estado={e.estado} />
        <PilulaSimulado simulado={e.simulado} />
        <span className="font-semibold text-tinta">{e.tipo.nome}</span>
        {e.municipe?.nome && <span className="text-sm text-tinta-2">· {e.municipe.nome}</span>}
        {mostrarProcesso && e.processo && (
          <Link
            href={`/painel/processos/${e.processo.id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-terracota-escuro hover:underline"
          >
            {e.processo.numero ?? "Processo"}
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        )}
      </div>
      <p className="text-sm text-tinta-2">
        {e.estado === "entregue" ? (
          <>
            Entrada <span className="font-mono font-semibold text-tinta">{e.numero_entrada}</span> ·{" "}
            {dataHora(e.entregue_em)}
          </>
        ) : e.estado === "a_espera_autorizacao" ? (
          <>Confirmado {dataHora(e.confirmado_em)} · link válido até {dataHora(e.expira_em)}</>
        ) : e.erro ? (
          <span className="text-terracota-escuro">{e.erro}</span>
        ) : (
          <>Atualizado {dataHora(e.atualizado_em)}</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onDetalhe && (
          <button
            type="button"
            onClick={onDetalhe}
            className="h-8 rounded-full px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme-2 focus-visible:outline-2 focus-visible:outline-tinta"
          >
            Ver histórico
          </button>
        )}
        {e.estado === "entregue" && (
          <BotaoComprovativo entregaId={e.id} numero={e.numero_entrada} />
        )}
        {e.estado === "falhou" && (
          <button
            type="button"
            disabled={acao.aCorrer}
            onClick={async () => {
              const r = await acao.executar(() =>
                pedido(`/v1/painel/entregas/${e.id}/tentar-de-novo`, { corpo: {} }),
              );
              if (r) onAtualizado();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-tinta px-3 text-[13px] font-semibold text-white hover:bg-tinta/90 disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${acao.aCorrer ? "animate-spin" : ""}`} aria-hidden />
            {acao.aCorrer ? "A entregar…" : "Tentar de novo"}
          </button>
        )}
        {onCancelar && ["preparado", "a_espera_autorizacao", "falhou"].includes(e.estado) && (
          <button
            type="button"
            onClick={onCancelar}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-terracota-escuro hover:bg-terracota-suave/60"
          >
            <X className="size-3.5" aria-hidden />
            Cancelar
          </button>
        )}
      </div>
      <ErroLinha erro={acao.erro} />
    </li>
  );
}

/** Painel · Entregas em nome do munícipe. */
export function PaginaEntregas() {
  const { pode } = useSessao();
  const params = useSearchParams();
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoEntrega | "">("");
  const [cancelar, setCancelar] = useState<EntregaPainel | null>(null);
  const idFiltro = useId();
  const permitido = pode("processos");
  const lista = useDados<ListaEntregas>(
    permitido ? `/v1/painel/entregas${estado ? `?estado=${estado}` : ""}` : null,
  );
  const aberto = params.get("id");

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Entregas"]} titulo="Entregas em nome do munícipe" />
        <SemAcesso />
      </div>
    );
  }

  return (
    <div className="pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Entregas"]}
        titulo="Entregas em nome do munícipe"
        descricao="O agente entrega o pedido no balcão online depois de a pessoa confirmar o resumo e autorizar com a Chave Móvel Digital."
      />
      <div className="flex flex-col gap-6 px-10">
        {lista.dados && <CartaoModo modo={lista.dados.modo} />}

        <Cartao>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <h2 className="font-display text-lg font-bold text-tinta">Entregas</h2>
            <span className="flex items-center gap-2">
              <label htmlFor={idFiltro} className="text-sm text-tinta-2">
                Estado
              </label>
              <select
                id={idFiltro}
                value={estado}
                onChange={(e) => setEstado(e.target.value as EstadoEntrega | "")}
                className={`${classeEntrada} h-9 w-auto`}
              >
                <option value="">Todos</option>
                {(Object.keys(ESTADO_ROTULO) as EstadoEntrega[]).map((k) => (
                  <option key={k} value={k}>
                    {ESTADO_ROTULO[k]}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <Estado
            aCarregar={lista.aCarregar}
            erro={lista.erro}
            vazio={!lista.dados?.itens.length}
            textoVazio="Ainda não há entregas. Aparecem quando o agente prepara uma, com a confirmação da pessoa."
          >
            <ul className="border-t border-linha">
              {lista.dados?.itens.map((e) => (
                <LinhaEntrega
                  key={e.id}
                  e={e}
                  onDetalhe={() => router.replace(`/painel/entregas?id=${e.id}`)}
                  onCancelar={() => setCancelar(e)}
                  onAtualizado={lista.recarregar}
                />
              ))}
            </ul>
          </Estado>
        </Cartao>
      </div>

      <DialogoDetalhe id={aberto} onFechar={() => router.replace("/painel/entregas")} />
      <DialogoCancelar
        entrega={cancelar}
        onFechar={() => setCancelar(null)}
        onFeito={() => {
          setCancelar(null);
          lista.recarregar();
        }}
      />
    </div>
  );
}
