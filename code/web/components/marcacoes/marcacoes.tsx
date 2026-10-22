"use client";

import {
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  UserX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { hojeNoFuso, somarDias } from "@/components/atendimento/formatos";
import {
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { mascararTelefone } from "@/components/painel/formatos";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Agenda de marcações. O agente marca nas agendas dos serviços
 * (atendimento presencial, vistorias…); aqui o balcão vê o dia, hora a hora,
 * e regista quem veio, quem faltou, ou cancela (o munícipe recebe um SMS).
 */

type EstadoMarcacao = "marcada" | "realizada" | "faltou" | "cancelada";
type Mudanca = Exclude<EstadoMarcacao, "marcada">;

interface Marcacao {
  id: string;
  agenda_id: string;
  agenda: string;
  inicio: string;
  fim: string;
  assunto: string | null;
  levar: string[] | null;
  estado: EstadoMarcacao;
  conversa_id: string | null;
  criada_em: string;
  lembrete_enviado_em: string | null;
  municipe: { id: string; nome: string | null; telefone: string | null };
}

interface Agenda {
  id: string;
  nome: string;
  local: string | null;
  servico: string;
  duracao_min: number;
}

const ESTADOS: Record<EstadoMarcacao, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" | "tinta" }> = {
  marcada: { rotulo: "marcada", tom: "tinta" },
  realizada: { rotulo: "realizada", tom: "verde" },
  faltou: { rotulo: "faltou", tom: "ambar" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
};

const CONTAGENS: Record<EstadoMarcacao, [string, string]> = {
  marcada: ["por atender", "por atender"],
  realizada: ["realizada", "realizadas"],
  faltou: ["falta", "faltas"],
  cancelada: ["cancelada", "canceladas"],
};

const MUDANCAS: Record<Mudanca, { botao: string; titulo: string; texto: string; confirmar: string }> = {
  realizada: {
    botao: "Realizada",
    titulo: "Marcar como realizada",
    texto: "A pessoa veio e foi atendida.",
    confirmar: "Sim, foi atendida",
  },
  faltou: {
    botao: "Faltou",
    titulo: "Marcar falta",
    texto: "A pessoa não apareceu à hora marcada.",
    confirmar: "Sim, faltou",
  },
  cancelada: {
    botao: "Cancelar",
    titulo: "Cancelar marcação",
    texto:
      "A vaga fica livre para outra pessoa. Se a marcação ainda não passou, o munícipe recebe um SMS a dizer que foi cancelada pelos serviços. Não se pode desfazer.",
    confirmar: "Cancelar marcação",
  },
};

function diaPorExtenso(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function horaNoFuso(iso: string, fuso: string): string {
  return new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: fuso });
}

export function PaginaMarcacoes() {
  const { pode, eu } = useSessao();
  const permitido = pode("conversas");
  const fuso = eu?.municipio.fuso ?? "Europe/Lisbon";
  const hoje = hojeNoFuso(fuso);
  const [dia, setDia] = useState<string>(hoje);
  const [agenda, setAgenda] = useState("");
  const [confirmar, setConfirmar] = useState<{ m: Marcacao; para: Mudanca } | null>(null);
  const acao = useAcao();
  const { pedido } = useSessao();

  const caminho = permitido
    ? `/v1/painel/marcacoes?dia=${dia}${agenda ? `&agenda_id=${agenda}` : ""}`
    : null;
  const d = useDados<{ dia: string; itens: Marcacao[] }>(caminho);
  const agendas = useDados<{ itens: Agenda[] }>(permitido ? "/v1/painel/agendas" : null);

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Atendimento", "Marcações"]} titulo="Marcações" />
        <SemAcesso />
      </div>
    );
  }

  const itens = d.dados?.itens ?? [];
  const contagem = (e: EstadoMarcacao) => itens.filter((m) => m.estado === e).length;

  const mudar = async () => {
    if (!confirmar) return;
    const r = await acao.executar(() =>
      pedido(`/v1/painel/marcacoes/${confirmar.m.id}`, { metodo: "PATCH", corpo: { estado: confirmar.para } }),
    );
    if (r !== undefined) {
      setConfirmar(null);
      d.recarregar();
    }
  };

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Atendimento", "Marcações"]}
        titulo="Agenda de marcações"
        descricao="O que o agente marcou nas agendas dos serviços, hora a hora. Registe quem veio e quem faltou; se cancelar, a pessoa é avisada por SMS."
      />

      <div className="flex flex-wrap items-center gap-3 px-10 pb-5">
        <div className="flex items-center gap-1" role="group" aria-label="Dia">
          <button
            type="button"
            onClick={() => setDia(somarDias(dia, -1))}
            className="rounded-full border border-linha p-2 text-tinta-2 hover:bg-creme"
            aria-label="Dia anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setDia(hoje)}
            aria-pressed={dia === hoje}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
              dia === hoje ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
            }`}
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setDia(somarDias(dia, 1))}
            className="rounded-full border border-linha p-2 text-tinta-2 hover:bg-creme"
            aria-label="Dia seguinte"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span className="sr-only">Escolher dia</span>
          <input
            type="date"
            className={`${classeEntrada} w-auto py-1.5`}
            value={dia}
            onChange={(e) => e.target.value && setDia(e.target.value)}
          />
        </label>
        <span className="font-display text-lg font-bold text-tinta first-letter:uppercase">{diaPorExtenso(dia)}</span>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[13px] font-semibold text-tinta-2">
          Agenda
          <select
            className={`${classeEntrada} w-auto py-1.5`}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
          >
            <option value="">Todas</option>
            {(agendas.dados?.itens ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      {itens.length > 0 && (
        <div className="flex flex-wrap gap-2 px-10 pb-4">
          {(Object.keys(ESTADOS) as EstadoMarcacao[]).map((e) => (
            <Pilula key={e} tom={contagem(e) ? ESTADOS[e].tom : "neutro"}>
              {contagem(e)} {contagem(e) === 1 ? CONTAGENS[e][0] : CONTAGENS[e][1]}
            </Pilula>
          ))}
        </div>
      )}

      <div className="px-10">
        <Cartao>
          <Estado
            aCarregar={d.aCarregar}
            erro={d.erro}
            vazio={itens.length === 0}
            textoVazio={
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4" aria-hidden /> Não há marcações neste dia
                {agenda ? " nesta agenda" : ""}.
              </span>
            }
          >
            <ul className="divide-y divide-linha">
              {itens.map((m) => (
                <LinhaMarcacao key={m.id} m={m} fuso={fuso} onMudar={(para) => setConfirmar({ m, para })} />
              ))}
            </ul>
          </Estado>
        </Cartao>
      </div>

      <Dialogo
        titulo={confirmar ? MUDANCAS[confirmar.para].titulo : ""}
        aberto={!!confirmar}
        onFechar={() => {
          setConfirmar(null);
          acao.limpar();
        }}
      >
        {confirmar && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-tinta">
              <strong>{confirmar.m.municipe.nome || "Munícipe sem nome"}</strong>, {confirmar.m.agenda}, às{" "}
              {horaNoFuso(confirmar.m.inicio, fuso)}.
            </p>
            <p className="text-sm text-tinta-2">{MUDANCAS[confirmar.para].texto}</p>
            <ErroLinha erro={acao.erro} />
            <div className="flex justify-end gap-2">
              <Botao variante="discreto" tamanho="pequeno" onClick={() => setConfirmar(null)}>
                Voltar
              </Botao>
              <Botao tamanho="pequeno" disabled={acao.aCorrer} onClick={mudar}>
                {MUDANCAS[confirmar.para].confirmar}
              </Botao>
            </div>
          </div>
        )}
      </Dialogo>
    </div>
  );
}

function LinhaMarcacao({
  m,
  fuso,
  onMudar,
}: {
  m: Marcacao;
  fuso: string;
  onMudar: (para: Mudanca) => void;
}) {
  const e = ESTADOS[m.estado];
  // Cancelada é final; realizada ↔ faltou ainda se pode corrigir.
  const opcoes: Mudanca[] =
    m.estado === "cancelada"
      ? []
      : (["realizada", "faltou", "cancelada"] as const).filter((x) => x !== m.estado);
  const icones = { realizada: Check, faltou: UserX, cancelada: X } as const;

  return (
    <li
      className={`grid gap-4 px-5 py-4 md:grid-cols-[96px_minmax(0,1fr)_auto] ${
        m.estado === "cancelada" ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-col">
        <span className="font-display text-xl font-bold text-tinta">{horaNoFuso(m.inicio, fuso)}</span>
        <span className="text-xs text-tinta-3">até {horaNoFuso(m.fim, fuso)}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-tinta">{m.municipe.nome || "Munícipe sem nome"}</span>
          <span className="font-mono text-xs text-tinta-3">{mascararTelefone(m.municipe.telefone)}</span>
          <Pilula tom={e.tom}>{e.rotulo}</Pilula>
          <Pilula>{m.agenda}</Pilula>
        </div>
        <p className="text-sm text-tinta-2">{m.assunto ?? "Sem assunto indicado."}</p>
        {m.levar && m.levar.length > 0 && (
          <div>
            <Rotulo className="mt-1">Trazer</Rotulo>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-tinta-2">
              {m.levar.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-tinta-3">
          <span>marcada {quando(m.criada_em)}</span>
          {m.lembrete_enviado_em && (
            <span className="inline-flex items-center gap-1">
              <BellRing className="size-3.5" aria-hidden /> lembrete enviado {quando(m.lembrete_enviado_em)}
            </span>
          )}
          {m.conversa_id && (
            <Link
              href={`/painel/conversas/${m.conversa_id}`}
              className="inline-flex items-center gap-1 font-semibold text-tinta-2 hover:text-tinta"
            >
              <MessageSquareText className="size-3.5" aria-hidden /> conversa
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-1.5 md:justify-end">
        {opcoes.map((x) => (
          <Botao
            key={x}
            tamanho="pequeno"
            variante={x === "cancelada" ? "discreto" : "secundario"}
            icone={icones[x]}
            onClick={() => onMudar(x)}
          >
            {MUDANCAS[x].botao}
          </Botao>
        ))}
      </div>
    </li>
  );
}
