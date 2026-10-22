"use client";

import { FileText, HeartHandshake, MessageSquareText, PhoneOff, PhoneOutgoing } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  Dialogo,
  ErroLinha,
  Estado,
  Interruptor,
  Pilula,
  quando,
  SemAcesso,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Filtro } from "@/components/painel/filtro";
import { mascararTelefone } from "@/components/painel/formatos";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Chamadas do agente. As chamadas que o agente faz (processo que
 * avançou, documento em falta, prazo a terminar, pedido do técnico,
 * campanhas de ação social). Se ninguém atende, vai um SMS de recurso.
 * As agendadas ainda se podem cancelar.
 */

type EstadoChamada = "agendada" | "a_ligar" | "atendida" | "nao_atendida" | "falhou" | "cancelada";
type MotivoChamada =
  | "processo_fase"
  | "pedido_documento"
  | "lembrete_prazo"
  | "manual"
  | "campanha"
  | "renovacao_licenca";

interface Chamada {
  id: string;
  motivo: MotivoChamada;
  estado: EstadoChamada;
  tentativas: number;
  agendada_para: string | null;
  iniciada_em: string | null;
  terminada_em: string | null;
  telefone_e164: string | null;
  municipe_id: string;
  municipe_nome: string | null;
  processo_id: string | null;
  processo_numero: string | null;
  contexto: { nota?: string; o_que_mudou?: string; campanha?: { id: string } } | null;
  conversa_id: string | null;
  recurso_sms_id: string | null;
  erro: string | null;
  forcar_horario: boolean;
  criada_por: string | null;
  criada_por_nome: string | null;
  criada_em: string;
}

const ESTADOS: Record<EstadoChamada, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" | "tinta" }> = {
  agendada: { rotulo: "agendada", tom: "tinta" },
  a_ligar: { rotulo: "a ligar", tom: "ambar" },
  atendida: { rotulo: "atendida", tom: "verde" },
  nao_atendida: { rotulo: "não atendida", tom: "ambar" },
  falhou: { rotulo: "falhou", tom: "terracota" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
};

/** Rótulo curto e a frase que o agente diz (MOTIVO_FALADO em chamadas-saida/regras.ts). */
const MOTIVOS: Record<MotivoChamada, { rotulo: string; dito: string }> = {
  processo_fase: { rotulo: "Processo avançou", dito: "o processo avançou" },
  pedido_documento: { rotulo: "Falta um documento", dito: "falta um documento" },
  lembrete_prazo: {
    rotulo: "Prazo a terminar",
    dito: "o prazo para entregar um documento está a terminar",
  },
  manual: { rotulo: "Pedido do técnico", dito: "o técnico pediu para falar consigo sobre o processo" },
  campanha: {
    rotulo: "Ação social",
    dito: "a câmara está a ligar às pessoas inscritas para saber se está tudo bem",
  },
  renovacao_licenca: {
    rotulo: "Licença a expirar",
    dito: "a sua licença está quase a expirar e pode renová-la já nesta chamada",
  },
};

export function PaginaChamadas() {
  const { pode, pedido } = useSessao();
  const permitido = pode("processos");
  const [estado, setEstado] = useState<EstadoChamada | "">("");
  const [motivo, setMotivo] = useState<MotivoChamada | "">("");
  const [cancelar, setCancelar] = useState<Chamada | null>(null);
  const [enviarSms, setEnviarSms] = useState(true);
  const acao = useAcao();

  const params = new URLSearchParams({ limite: "50" });
  if (estado) params.set("estado", estado);
  if (motivo) params.set("motivo", motivo);
  const base = permitido ? `/v1/painel/chamadas-saida?${params.toString()}` : null;
  const lista = useDados<Pagina<Chamada>>(base);
  const mais = useMais(base, lista);

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Atendimento", "Chamadas do agente"]} titulo="Chamadas do agente" />
        <SemAcesso />
      </div>
    );
  }

  const itens = lista.dados?.itens ?? [];
  const confirmarCancelar = async () => {
    if (!cancelar) return;
    const r = await acao.executar(() =>
      pedido(`/v1/painel/chamadas-saida/${cancelar.id}/cancelar`, {
        metodo: "POST",
        corpo: { enviar_sms: enviarSms },
      }),
    );
    if (r !== undefined) {
      setCancelar(null);
      lista.recarregar();
    }
  };

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Atendimento", "Chamadas do agente"]}
        titulo="Chamadas do agente"
        descricao="O agente liga às pessoas quando o processo avança, quando falta um documento ou o prazo está a acabar, e nas campanhas de ação social. Se ninguém atender, segue um SMS."
      />
      <div className="flex flex-col gap-3 px-10 pb-5">
        <Filtro
          rotulo="Estado"
          valor={estado}
          onMudar={setEstado}
          opcoes={[
            { v: "", t: "Todos" },
            ...(Object.keys(ESTADOS) as EstadoChamada[]).map((e) => ({ v: e, t: ESTADOS[e].rotulo })),
          ]}
        />
        <Filtro
          rotulo="Motivo"
          valor={motivo}
          onMudar={setMotivo}
          opcoes={[
            { v: "", t: "Todos" },
            ...(Object.keys(MOTIVOS) as MotivoChamada[]).map((m) => ({ v: m, t: MOTIVOS[m].rotulo })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-4 px-10">
        <Cartao>
          <Estado
            aCarregar={lista.aCarregar}
            erro={lista.erro}
            vazio={itens.length === 0}
            textoVazio="Não há chamadas com estes filtros."
          >
            <ul className="divide-y divide-linha">
              {itens.map((c) => (
                <LinhaChamada
                  key={c.id}
                  c={c}
                  onCancelar={() => {
                    setEnviarSms(true);
                    acao.limpar();
                    setCancelar(c);
                  }}
                />
              ))}
            </ul>
          </Estado>
        </Cartao>
        <ErroLinha erro={mais.erro} />
        {mais.haMais && (
          <div className="flex justify-center">
            <Botao variante="secundario" tamanho="pequeno" disabled={mais.aCorrer} onClick={mais.mais}>
              Ver mais
            </Botao>
          </div>
        )}
      </div>

      <Dialogo titulo="Cancelar chamada" aberto={!!cancelar} onFechar={() => setCancelar(null)}>
        {cancelar && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-tinta">
              O agente já não liga a <strong>{cancelar.municipe_nome || "este munícipe"}</strong> (
              {MOTIVOS[cancelar.motivo]?.rotulo.toLowerCase() ?? cancelar.motivo}
              {cancelar.processo_numero ? `, processo ${cancelar.processo_numero}` : ""}).
            </p>
            <label className="flex items-center justify-between gap-3 rounded-[12px] bg-creme px-4 py-3">
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-tinta">Enviar o SMS na mesma</span>
                <span className="text-xs text-tinta-3">O aviso chega por escrito, sem a chamada.</span>
              </span>
              <Interruptor ligado={enviarSms} onMudar={setEnviarSms} rotulo="Enviar o SMS na mesma" />
            </label>
            <ErroLinha erro={acao.erro} />
            <div className="flex justify-end gap-2">
              <Botao variante="discreto" tamanho="pequeno" onClick={() => setCancelar(null)}>
                Voltar
              </Botao>
              <Botao tamanho="pequeno" icone={PhoneOff} disabled={acao.aCorrer} onClick={confirmarCancelar}>
                Cancelar chamada
              </Botao>
            </div>
          </div>
        )}
      </Dialogo>
    </div>
  );
}

function LinhaChamada({ c, onCancelar }: { c: Chamada; onCancelar: () => void }) {
  const e = ESTADOS[c.estado] ?? { rotulo: c.estado, tom: "neutro" as const };
  const m = MOTIVOS[c.motivo] ?? { rotulo: c.motivo, dito: "" };
  const campanha = c.contexto?.campanha?.id;
  const quemPediu = c.criada_por_nome
    ? c.criada_por_nome
    : campanha
      ? "campanha"
      : "automática";

  return (
    <li className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <PhoneOutgoing className="size-4 text-terracota" aria-hidden />
          <span className="text-[15px] font-semibold text-tinta">{m.rotulo}</span>
          <Pilula tom={e.tom}>{e.rotulo}</Pilula>
          {c.forcar_horario && <Pilula tom="ambar">fora de horas</Pilula>}
          {c.recurso_sms_id && <Pilula>SMS enviado</Pilula>}
        </div>
        {m.dito && <p className="text-[13px] text-tinta-2">O agente diz que {m.dito}.</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-tinta-2">
          <span className="font-semibold text-tinta">{c.municipe_nome || "Munícipe sem nome"}</span>
          <span className="font-mono text-xs text-tinta-3">{mascararTelefone(c.telefone_e164)}</span>
          {c.processo_id && (
            <Link
              href={`/painel/processos/${c.processo_id}`}
              className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-terracota hover:underline"
            >
              <FileText className="size-3.5" aria-hidden />
              {c.processo_numero ?? "processo"}
            </Link>
          )}
          {campanha && (
            <Link
              href={`/painel/campanhas/${campanha}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-terracota hover:underline"
            >
              <HeartHandshake className="size-3.5" aria-hidden /> campanha
            </Link>
          )}
          {c.conversa_id && (
            <Link
              href={`/painel/conversas/${c.conversa_id}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-tinta-2 hover:text-tinta"
            >
              <MessageSquareText className="size-3.5" aria-hidden /> conversa
            </Link>
          )}
        </div>
        {c.erro && (
          <p
            className={`rounded-[10px] px-3 py-1.5 text-xs ${
              c.estado === "falhou" || c.estado === "nao_atendida"
                ? "bg-terracota-suave/60 text-terracota-escuro"
                : "bg-creme-2 text-tinta-2"
            }`}
          >
            {c.erro}
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-tinta-3">
          <span>
            pedida {quando(c.criada_em)} · {quemPediu}
          </span>
          <span>
            {c.tentativas} {c.tentativas === 1 ? "tentativa" : "tentativas"}
          </span>
          {c.estado === "agendada" && c.agendada_para && <span>liga {quando(c.agendada_para)}</span>}
          {c.terminada_em && <span>terminou {quando(c.terminada_em)}</span>}
        </div>
      </div>
      <div className="flex items-start md:justify-end">
        {c.estado === "agendada" && (
          <Botao tamanho="pequeno" variante="discreto" icone={PhoneOff} onClick={onCancelar}>
            Cancelar
          </Botao>
        )}
      </div>
    </li>
  );
}
