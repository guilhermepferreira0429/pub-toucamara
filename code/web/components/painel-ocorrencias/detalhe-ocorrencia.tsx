"use client";

import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { ArrowLeft, Check, MapPin, Save, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { diaCurto, diaHora, diaLongo, hojeIso } from "@/components/processos/formatos";
import {
  ACarregar,
  BotaoPainel,
  CAMPO_CREME,
  Campo,
  Chip,
  ErroEmLinha,
  Nota,
  paraErro,
  RotuloSeccao,
  usePedido,
} from "@/components/processos/ui";
import type { ServicosEquipa } from "@/components/atendimento/equipa";
import { useSessao } from "@/lib/sessao";
import {
  ESTADO_ROTULO,
  type CategoriaOcorrencia,
  type EstadoOcorrencia,
  type EventoOcorrencia,
  type OcorrenciaDetalhe,
} from "./tipos";

/*
 * Detalhe de uma ocorrência na coluna da direita: fotografias, descrição,
 * quem reportou (e os duplicados juntos), linha do tempo e, com permissão,
 * estado, serviço e data prevista (PATCH). Resolver avisa por SMS todos os
 * que reportaram.
 */

export function IconeCategoria({
  nome,
  className,
}: {
  nome: string | null;
  className?: string;
}) {
  if (!nome) return <MapPin className={className} aria-hidden />;
  return (
    <DynamicIcon
      name={nome as IconName}
      className={className}
      aria-hidden
      fallback={() => <MapPin className={className} aria-hidden />}
    />
  );
}

const TOM_ESTADO: Record<EstadoOcorrencia, "terracota" | "ambar" | "verde" | "neutro"> = {
  nova: "terracota",
  com_equipa: "ambar",
  resolvida: "verde",
  duplicada: "neutro",
  rejeitada: "neutro",
};

export function ChipEstadoOcorrencia({ estado }: { estado: EstadoOcorrencia }) {
  return (
    <Chip tom={TOM_ESTADO[estado]} pequeno>
      {ESTADO_ROTULO[estado]}
    </Chip>
  );
}

function textoEvento(e: EventoOcorrencia, servicos: Map<string, string>): string {
  const d = (e.dados ?? {}) as Record<string, string | null | undefined>;
  switch (e.tipo) {
    case "registada":
      return e.ator_tipo === "agente" ? "Registada pelo agente" : "Registada";
    case "foto":
      return "Fotografia recebida";
    case "atribuida":
      return d.para ? `Enviada para ${servicos.get(d.para) ?? "um serviço"}` : "Sem serviço atribuído";
    case "prevista":
      return d.para ? `Prevista para ${diaLongo(d.para)}` : "Sem data prevista";
    case "resolvida":
      return "Resolvida";
    case "estado":
      return `Estado: ${ESTADO_ROTULO[d.de as EstadoOcorrencia] ?? d.de} → ${
        ESTADO_ROTULO[d.para as EstadoOcorrencia] ?? d.para
      }`;
    case "avisado_sms":
      return "Quem reportou foi avisado por SMS";
    case "duplicada":
    case "junta":
      return "Junta a uma ocorrência igual";
    default:
      return e.tipo.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

function Gerir({
  o,
  servicos,
  onAtualizado,
}: {
  o: OcorrenciaDetalhe;
  servicos: [string, string][];
  onAtualizado: (o: OcorrenciaDetalhe) => void;
}) {
  const { pedido } = useSessao();
  const editavel: EstadoOcorrencia[] = ["nova", "com_equipa", "resolvida", "rejeitada"];
  const [estado, setEstado] = useState<EstadoOcorrencia>(o.estado);
  const [servico, setServico] = useState(o.servico_id ?? "");
  const [prevista, setPrevista] = useState(o.prevista_para ?? "");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const mudancas: Record<string, unknown> = {};
  if (estado !== o.estado) mudancas.estado = estado;
  if (servico !== (o.servico_id ?? "")) mudancas.servico_id = servico || null;
  if (prevista !== (o.prevista_para ?? "")) mudancas.prevista_para = prevista || null;
  const resolve = estado === "resolvida" && o.estado !== "resolvida";

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!Object.keys(mudancas).length) return;
    if (
      resolve &&
      !window.confirm(
        `Marcar como resolvida? Vamos avisar por SMS ${
          o.reportes > 1 ? `as ${o.reportes} pessoas que a reportaram` : "quem a reportou"
        }.`,
      )
    ) {
      return;
    }
    setAGuardar(true);
    setErro(null);
    try {
      onAtualizado(
        await pedido<OcorrenciaDetalhe>(`/v1/painel/ocorrencias/${o.id}`, {
          metodo: "PATCH",
          corpo: mudancas,
        }),
      );
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-3 rounded-xl bg-creme p-3.5">
      <RotuloSeccao as="h3">Tratar</RotuloSeccao>
      <div className="grid grid-cols-2 gap-2.5">
        <Campo rotulo="Estado">
          {(id) => (
            <select
              id={id}
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoOcorrencia)}
              className={`${CAMPO_CREME} bg-papel`}
            >
              {editavel.map((s) => (
                <option key={s} value={s}>
                  {ESTADO_ROTULO[s]}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo rotulo="Prevista para">
          {(id) => (
            <input
              id={id}
              type="date"
              value={prevista}
              min={o.prevista_para && o.prevista_para < hojeIso() ? undefined : hojeIso()}
              onChange={(e) => setPrevista(e.target.value)}
              className={`${CAMPO_CREME} bg-papel`}
            />
          )}
        </Campo>
      </div>
      <Campo rotulo="Serviço">
        {(id) => (
          <select
            id={id}
            value={servico}
            onChange={(e) => setServico(e.target.value)}
            className={`${CAMPO_CREME} bg-papel`}
          >
            <option value="">Sem serviço</option>
            {servicos.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        )}
      </Campo>
      {resolve && (
        <p className="text-xs text-ambar">
          Ao resolver, {o.reportes > 1 ? `as ${o.reportes} pessoas que reportaram recebem` : "quem reportou recebe"} um
          SMS a avisar.
        </p>
      )}
      <ErroEmLinha erro={erro} />
      <BotaoPainel
        type="submit"
        variante={resolve ? "principal" : "tinta"}
        pequeno
        icone={resolve ? Check : Save}
        disabled={aGuardar || !Object.keys(mudancas).length}
        className="self-start"
      >
        {aGuardar ? "A guardar…" : resolve ? "Resolver e avisar" : "Guardar"}
      </BotaoPainel>
    </form>
  );
}

export function DetalheOcorrencia({
  id,
  categorias,
  onVoltar,
  onAlterada,
  onAbrir,
}: {
  id: string;
  categorias: CategoriaOcorrencia[];
  onVoltar: () => void;
  onAlterada: () => void;
  onAbrir: (id: string) => void;
}) {
  const { pode } = useSessao();
  const r = usePedido<OcorrenciaDetalhe>(`/v1/painel/ocorrencias/${id}`);
  const [aviso, setAviso] = useState<string | null>(null);

  // Todos os serviços do município; sem acesso, os das categorias.
  const lista = usePedido<ServicosEquipa>(
    pode("visao_geral") ? "/v1/painel/servicos" : null,
  );
  const servicos = new Map<string, string>();
  for (const sv of lista.dados?.itens ?? []) servicos.set(sv.id, sv.nome);
  for (const c of categorias) if (c.servico_id && c.servico) servicos.set(c.servico_id, c.servico);
  const o = r.dados && r.dados.id === id ? r.dados : null;
  if (o?.servico_id && o.servico) servicos.set(o.servico_id, o.servico);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-linha px-4 py-3">
        <button
          type="button"
          onClick={onVoltar}
          className="inline-flex items-center gap-1.5 rounded-md px-1 text-xs font-semibold text-tinta-2 hover:text-tinta"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Voltar à lista
        </button>
      </div>
      {r.erro && !o ? (
        <div className="p-4">
          <ErroEmLinha erro={r.erro} />
        </div>
      ) : !o ? (
        <ACarregar className="p-4" />
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-terracota-suave">
              <IconeCategoria nome={o.icone} className="size-4 text-terracota-escuro" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-tinta">
                {o.categoria} · {o.numero}
              </h2>
              <p className="text-xs text-tinta-3">
                {o.morada ?? "Sem morada"} · {diaHora(o.criada_em)}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                <ChipEstadoOcorrencia estado={o.estado} />
                {o.servico && <Chip tom="neutro" pequeno>{o.servico}</Chip>}
                {o.prevista_para && o.estado !== "resolvida" && (
                  <Chip tom="papel" pequeno>prevista {diaCurto(o.prevista_para)}</Chip>
                )}
                {o.reportes > 1 && (
                  <Chip tom="tinta" pequeno icone={Users}>
                    {o.reportes} avisos
                  </Chip>
                )}
              </div>
            </div>
          </div>

          {aviso && (
            <Nota onFechar={() => setAviso(null)}>{aviso}</Nota>
          )}

          {o.fotos.length > 0 && (
            <ul className="grid grid-cols-2 gap-2">
              {o.fotos.map((f, i) =>
                f.url ? (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do armazenamento */}
                      <img
                        src={f.url}
                        alt={`Fotografia ${i + 1} enviada a ${diaHora(f.enviada_em)}`}
                        className="h-[110px] w-full rounded-[10px] object-cover"
                      />
                    </a>
                  </li>
                ) : (
                  <li key={f.id} className="flex h-[110px] items-center justify-center rounded-[10px] bg-creme-2 text-xs text-tinta-3">
                    Fotografia sem armazenamento
                  </li>
                ),
              )}
            </ul>
          )}

          {o.descricao && <p className="whitespace-pre-line text-[13px] text-tinta">{o.descricao}</p>}

          <p className="text-xs text-tinta-2">
            {o.municipe_nome ?? "Munícipe"}
            {o.municipe_telefone ? ` · ${o.municipe_telefone}` : ""}
            {o.conversa_id && (
              <>
                {" · "}
                <Link
                  href={`/painel/conversas/${o.conversa_id}`}
                  className="font-semibold text-terracota-escuro hover:underline"
                >
                  ver a conversa
                </Link>
              </>
            )}
          </p>

          {o.duplicada_de ? (
            <p className="rounded-xl bg-creme-2 p-3 text-[13px] text-tinta-2">
              Esta ocorrência está junta à{" "}
              <button
                type="button"
                onClick={() => onAbrir(o.duplicada_de!)}
                className="font-semibold text-terracota-escuro underline"
              >
                {o.duplicada_de_numero ?? "original"}
              </button>
              : trate-a lá.
            </p>
          ) : pode("ocorrencias") ? (
            <Gerir
              key={`${o.estado}-${o.servico_id}-${o.prevista_para}`}
              o={o}
              servicos={[...servicos]}
              onAtualizado={(n) => {
                r.definir(n);
                onAlterada();
                if (n.avisados) {
                  setAviso(
                    `Resolvida. ${n.avisados === 1 ? "Avisámos 1 pessoa" : `Avisámos ${n.avisados} pessoas`} por SMS.`,
                  );
                } else setAviso("Alterações guardadas.");
              }}
            />
          ) : (
            <p className="text-xs text-tinta-3">
              Pode ver, mas não alterar ocorrências com o seu perfil.
            </p>
          )}

          {o.duplicados.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <RotuloSeccao as="h3">
                Também reportada por ({o.duplicados.length})
              </RotuloSeccao>
              <ul className="flex flex-col divide-y divide-linha rounded-xl border border-linha">
                {o.duplicados.map((d) => (
                  <li key={d.id} className="px-3 py-2 text-xs text-tinta-2">
                    <span className="font-semibold text-tinta">{d.numero}</span> · {diaHora(d.criada_em)}
                    {d.municipe_telefone ? ` · ${d.municipe_telefone}` : ""}
                    {d.descricao && <span className="block text-tinta-3">{d.descricao}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {o.eventos.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <RotuloSeccao as="h3">Linha do tempo</RotuloSeccao>
              <ol className="flex flex-col gap-1.5 border-l-2 border-linha pl-3">
                {o.eventos.map((e) => (
                  <li key={e.id} className="text-xs text-tinta-2">
                    <span className="text-tinta">{textoEvento(e, servicos)}</span>
                    <span className="text-tinta-3">
                      {" "}
                      · {diaHora(e.em)}
                      {e.ator_nome ? ` · ${e.ator_nome}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
