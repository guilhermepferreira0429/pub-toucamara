"use client";

import { BadgeCheck, CalendarDays, ExternalLink, Pencil, Plus, Ticket, X } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  euros,
  Interruptor,
  Pilula,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Reservas (V4 #4). O agente vê a disponibilidade, reserva
 * equipamentos e bilhetes (com pagamento de teste) e manda o link por SMS;
 * aqui vê-se o calendário dos próximos dias por equipamento, aprova-se ou
 * recusa-se o que precisa de um funcionário, e a chefia gere os
 * equipamentos (preço, horário, aprovação, ativo).
 */

type EstadoReserva = "por_aprovar" | "por_pagar" | "confirmada" | "recusada" | "cancelada";
type DiaSemana = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
type TipoEquip = "pavilhao" | "piscina" | "auditorio" | "sala" | "campo";

interface Reserva {
  id: string;
  tipo: "equipamento" | "bilhete";
  codigo: string;
  equipamento_id: string | null;
  titulo: string;
  dia: string;
  hora_inicio: string;
  hora_fim: string | null;
  quantidade: number;
  finalidade: string | null;
  nome: string | null;
  telefone: string | null;
  valor_cent: number;
  estado: EstadoReserva;
  motivo_recusa: string | null;
  decidida_por_nome: string | null;
  canal: string;
  demonstracao: boolean;
  pagamento: { estado: string; modo_teste: boolean } | null;
}

interface Equipamento {
  id: string;
  nome: string;
  tipo: TipoEquip;
  morada: string;
  descricao: string | null;
  lotacao: number | null;
  horario: Partial<Record<DiaSemana, string[]>>;
  duracao_slot_min: number;
  duracao_max_horas: number;
  antecedencia_horas: number;
  preco_hora_cent: number;
  entrada_cent: number | null;
  notas: string | null;
  aprovacao: "automatica" | "funcionario";
  ativo: boolean;
  demonstracao: boolean;
}

interface Sessao {
  id: string;
  titulo: string;
  local: string;
  dia: string;
  hora: string;
  lotacao: number;
  livres: number;
  preco_cent: number;
  demonstracao: boolean;
  evento_id: string | null;
}

interface Dados {
  de: string;
  ate: string;
  contagens: Record<EstadoReserva, number>;
  reservas: Reserva[];
  equipamentos: Equipamento[];
  sessoes: Sessao[];
}

const ESTADOS: Record<EstadoReserva, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }> = {
  por_aprovar: { rotulo: "por aprovar", tom: "terracota" },
  por_pagar: { rotulo: "à espera do pagamento", tom: "ambar" },
  confirmada: { rotulo: "confirmada", tom: "verde" },
  recusada: { rotulo: "recusada", tom: "neutro" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
};

const TIPOS: Record<TipoEquip, string> = {
  pavilhao: "Pavilhão",
  piscina: "Piscina",
  auditorio: "Auditório",
  sala: "Sala",
  campo: "Campo",
};

const DIAS: [DiaSemana, string][] = [
  ["seg", "Seg"],
  ["ter", "Ter"],
  ["qua", "Qua"],
  ["qui", "Qui"],
  ["sex", "Sex"],
  ["sab", "Sáb"],
  ["dom", "Dom"],
];

function diaLongo(d: string): string {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${d}T12:00:00Z`),
  );
}

type Vista = "calendario" | "bilhetes" | "equipamentos";

export function PaginaReservas() {
  const { pode, pedido } = useSessao();
  const [vista, setVista] = useState<Vista>("calendario");
  const [equip, setEquip] = useState<string>("todos");
  const caminho = pode("reservas")
    ? `/v1/painel/reservas${equip !== "todos" ? `?equipamento_id=${equip}` : ""}`
    : null;
  const d = useDados<Dados>(caminho);
  const demo = useAcao();

  if (!pode("reservas")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Reservas"]} titulo="Reservas" />
        <SemAcesso />
      </div>
    );
  }
  const equipamentos = d.dados?.equipamentos ?? [];
  const porDia = new Map<string, Reserva[]>();
  for (const r of (d.dados?.reservas ?? []).filter((x) => x.tipo === "equipamento")) {
    porDia.set(r.dia, [...(porDia.get(r.dia) ?? []), r]);
  }
  const porAprovar = (d.dados?.reservas ?? []).filter((r) => r.estado === "por_aprovar");
  const separadores: [Vista, string, number | undefined][] = [
    ["calendario", "Calendário", d.dados?.contagens.por_aprovar],
    ["bilhetes", "Eventos com bilhete", d.dados?.sessoes.length],
    ["equipamentos", "Equipamentos", equipamentos.length],
  ];

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Reservas"]}
        titulo="Reservas e bilhetes"
        descricao="Pavilhões, piscinas, auditórios, salas e campos reservados pelo telefone ou pelo chat, e bilhetes para eventos com lugares limitados. O que precisa de um funcionário aparece primeiro."
        acoes={
          pode("agente") && d.dados && equipamentos.length === 0 ? (
            <Botao
              tamanho="pequeno"
              variante="secundario"
              disabled={demo.aCorrer}
              onClick={async () => {
                const r = await demo.executar(() => pedido("/v1/painel/reservas/demonstracao", { metodo: "POST" }));
                if (r !== undefined) d.recarregar();
              }}
            >
              Carregar dados de demonstração
            </Botao>
          ) : undefined
        }
      />
      <ErroLinha erro={demo.erro} className="mx-10 mb-4" />
      <div className="flex gap-1 overflow-x-auto px-4 pb-4 sm:px-10 [&>*]:shrink-0 [&>*]:whitespace-nowrap" role="tablist" aria-label="Vista">
        {separadores.map(([v, rotulo, n]) => (
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
            {n ? ` · ${n}` : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 px-10">
        <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!d.dados}>
          {vista === "calendario" && (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Equipamento">
                {[{ id: "todos", nome: "Todos" }, ...equipamentos].map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={equip === e.id}
                    onClick={() => setEquip(e.id)}
                    className={`rounded-[10px] border px-3.5 py-2 text-[13px] font-semibold ${
                      equip === e.id ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta-2"
                    }`}
                  >
                    {e.nome}
                  </button>
                ))}
              </div>
              {porAprovar.length > 0 && (
                <section className="flex flex-col gap-3">
                  <Rotulo>Por aprovar</Rotulo>
                  {porAprovar.map((r) => (
                    <CartaoReserva key={r.id} r={r} onMudou={d.recarregar} />
                  ))}
                </section>
              )}
              <Estado
                vazio={porDia.size === 0}
                textoVazio="Não há reservas nos próximos 15 dias. Ligue para a linha e peça para reservar o pavilhão."
              >
                {[...porDia.entries()].map(([dia, lista]) => (
                  <section key={dia} className="flex flex-col gap-2">
                    <h2 className="flex items-center gap-2 pt-2 text-sm font-bold text-tinta first-letter:uppercase">
                      <CalendarDays className="size-4 text-terracota" aria-hidden />
                      {diaLongo(dia)}
                    </h2>
                    {lista
                      .filter((r) => r.estado !== "por_aprovar")
                      .map((r) => (
                        <CartaoReserva key={r.id} r={r} onMudou={d.recarregar} />
                      ))}
                  </section>
                ))}
              </Estado>
            </>
          )}
          {vista === "bilhetes" && d.dados && (
            <Bilhetes sessoes={d.dados.sessoes} reservas={d.dados.reservas.filter((r) => r.tipo === "bilhete")} />
          )}
          {vista === "equipamentos" && <Equipamentos lista={equipamentos} onMudou={d.recarregar} />}
        </Estado>
        <p className="text-xs text-tinta-3">
          <Pilula tom="ambar">valores de demonstração</Pilula> Equipamentos, horários, preços e eventos de exemplo; pagamentos
          em modo de teste (nada é cobrado).
        </p>
      </div>
    </div>
  );
}

function CartaoReserva({ r, onMudou }: { r: Reserva; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [recusar, setRecusar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const e = ESTADOS[r.estado];
  const fazer = async (caminho: string, corpo?: object) => {
    const x = await acao.executar(() => pedido(caminho, { metodo: "POST", corpo }));
    if (x !== undefined) {
      setRecusar(false);
      onMudou();
    }
  };
  const ativa = r.estado === "por_aprovar" || r.estado === "por_pagar" || r.estado === "confirmada";
  return (
    <Cartao className={r.estado === "por_aprovar" ? "border-terracota" : ""}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-5 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-tinta">
              {r.hora_inicio}
              {r.hora_fim ? `–${r.hora_fim}` : ""} · {r.titulo}
            </span>
            <Pilula tom={e.tom}>{e.rotulo}</Pilula>
            {r.demonstracao && <Pilula tom="neutro">demonstração</Pilula>}
          </div>
          {r.estado === "por_aprovar" && <span className="text-xs text-tinta-3 first-letter:uppercase">{diaLongo(r.dia)}</span>}
          <span className="text-[13px] text-tinta-2">
            {r.tipo === "bilhete" ? `${r.quantidade} bilhete(s)` : r.finalidade}
          </span>
          <span className="text-xs text-tinta-3">
            {r.nome ?? "Sem nome"}
            {r.telefone ? ` · ${r.telefone}` : ""} · {r.canal} · código {r.codigo}
            {r.motivo_recusa ? ` · recusada: ${r.motivo_recusa}` : ""}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="font-display text-lg font-bold text-tinta">{r.valor_cent ? euros(r.valor_cent) : "grátis"}</span>
          {r.pagamento && (
            <span className="text-xs text-tinta-3">
              {r.pagamento.estado === "pago" ? "pago" : "por pagar"}
              {r.pagamento.modo_teste ? " · teste" : ""}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-linha px-5 py-2.5">
        <a
          href={`/reserva/${r.codigo}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-terracota"
        >
          <ExternalLink className="size-4" aria-hidden /> página da reserva
        </a>
        <div className="flex items-center gap-2">
          {r.estado === "por_aprovar" && (
            <Botao tamanho="pequeno" icone={BadgeCheck} disabled={acao.aCorrer} onClick={() => fazer(`/v1/painel/reservas/${r.id}/aprovar`)}>
              Aprovar
            </Botao>
          )}
          {(r.estado === "por_aprovar" || r.estado === "por_pagar") && (
            <Botao tamanho="pequeno" variante="discreto" onClick={() => setRecusar((x) => !x)}>
              Recusar
            </Botao>
          )}
          {ativa && r.estado !== "por_aprovar" && (
            <Botao
              tamanho="pequeno"
              variante="discreto"
              icone={X}
              disabled={acao.aCorrer}
              onClick={() => fazer(`/v1/painel/reservas/${r.id}/cancelar`)}
            >
              Cancelar
            </Botao>
          )}
        </div>
      </div>
      {recusar && (
        <div className="flex flex-col gap-2 border-t border-linha px-5 py-3">
          <input
            className={classeEntrada}
            placeholder="Porquê (vai por SMS à pessoa)"
            aria-label="Motivo da recusa"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
          />
          <div className="flex justify-end">
            <Botao
              tamanho="pequeno"
              variante="secundario"
              disabled={acao.aCorrer || motivo.trim().length < 5}
              onClick={() => fazer(`/v1/painel/reservas/${r.id}/recusar`, { motivo: motivo.trim() })}
            >
              Recusar e avisar
            </Botao>
          </div>
        </div>
      )}
      <ErroLinha erro={acao.erro} className="mx-5 mb-3" />
    </Cartao>
  );
}

function Bilhetes({ sessoes, reservas }: { sessoes: Sessao[]; reservas: Reserva[] }) {
  if (!sessoes.length) return <p className="p-5 text-sm text-tinta-3">Não há eventos com bilhete marcados.</p>;
  return (
    <div className="flex flex-col gap-3">
      {sessoes.map((s) => {
        const vendidos = s.lotacao - s.livres;
        const daSessao = reservas.filter((r) => r.titulo === s.titulo);
        return (
          <Cartao key={s.id} className="flex flex-col gap-2 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Ticket className="size-4 text-terracota" aria-hidden />
              <span className="font-display text-lg font-bold text-tinta">{s.titulo}</span>
              {s.livres === 0 && <Pilula tom="terracota">esgotado</Pilula>}
              {s.evento_id && <Pilula tom="neutro">no feed de eventos</Pilula>}
              {s.demonstracao && <Pilula tom="ambar">demonstração</Pilula>}
            </div>
            <span className="text-[13px] text-tinta-2 first-letter:uppercase">
              {diaLongo(s.dia)} às {s.hora} · {s.local} · {s.preco_cent ? euros(s.preco_cent) : "gratuito"}
            </span>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-creme-2" aria-hidden>
                <div className="h-full bg-terracota" style={{ width: `${Math.min(100, (vendidos / s.lotacao) * 100)}%` }} />
              </div>
              <span className="text-xs text-tinta-3">
                {vendidos} de {s.lotacao} lugares · {s.livres} livres
              </span>
            </div>
            {daSessao.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-tinta-2">
                {daSessao.map((r) => (
                  <li key={r.id}>
                    {r.nome ?? "Sem nome"} · {r.quantidade} · {ESTADOS[r.estado].rotulo} · {r.codigo}
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        );
      })}
    </div>
  );
}

function Equipamentos({ lista, onMudou }: { lista: Equipamento[]; onMudou: () => void }) {
  const { pode } = useSessao();
  const [editar, setEditar] = useState<Equipamento | "novo" | null>(null);
  const gere = pode("agente");
  return (
    <div className="flex flex-col gap-3">
      {gere && (
        <div>
          <Botao tamanho="pequeno" icone={Plus} onClick={() => setEditar("novo")}>
            Novo equipamento
          </Botao>
        </div>
      )}
      {!lista.length && <p className="p-5 text-sm text-tinta-3">Ainda não há equipamentos.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {lista.map((e) => (
          <Cartao key={e.id} className={`flex flex-col gap-1.5 px-5 py-4 ${e.ativo ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-bold text-tinta">{e.nome}</span>
              <Pilula tom="tinta">{TIPOS[e.tipo]}</Pilula>
              {!e.ativo && <Pilula tom="neutro">desativado</Pilula>}
              {e.demonstracao && <Pilula tom="ambar">demonstração</Pilula>}
            </div>
            <span className="text-[13px] text-tinta-2">{e.morada}</span>
            <span className="text-[13px] text-tinta">
              {e.preco_hora_cent ? `${euros(e.preco_hora_cent)} por hora` : "Gratuito"}
              {e.entrada_cent !== null ? ` · entrada ${euros(e.entrada_cent)}` : ""} ·{" "}
              {e.aprovacao === "funcionario" ? "um funcionário aprova" : "confirmada na hora"}
            </span>
            <span className="text-xs text-tinta-3">
              {DIAS.filter(([k]) => e.horario[k]?.length)
                .map(([k, n]) => `${n} ${e.horario[k]!.join(", ")}`)
                .join(" · ")}
            </span>
            <span className="text-xs text-tinta-3">
              Até {e.duracao_max_horas} h seguidas · {e.antecedencia_horas} h de antecedência
              {e.lotacao ? ` · ${e.lotacao} pessoas` : ""}
            </span>
            {gere && (
              <div className="pt-1">
                <Botao tamanho="pequeno" variante="discreto" icone={Pencil} onClick={() => setEditar(e)}>
                  Editar
                </Botao>
              </div>
            )}
          </Cartao>
        ))}
      </div>
      {editar && (
        <FormEquipamento
          key={editar === "novo" ? "novo" : editar.id}
          inicial={editar === "novo" ? null : editar}
          onFechar={() => setEditar(null)}
          onGuardado={() => {
            setEditar(null);
            onMudou();
          }}
        />
      )}
    </div>
  );
}

function FormEquipamento({
  inicial,
  onFechar,
  onGuardado,
}: {
  inicial: Equipamento | null;
  onFechar: () => void;
  onGuardado: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<TipoEquip>(inicial?.tipo ?? "pavilhao");
  const [morada, setMorada] = useState(inicial?.morada ?? "");
  const [preco, setPreco] = useState(((inicial?.preco_hora_cent ?? 0) / 100).toFixed(2));
  const [aprovacao, setAprovacao] = useState(inicial?.aprovacao ?? "automatica");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [maxHoras, setMaxHoras] = useState(String(inicial?.duracao_max_horas ?? 3));
  const [antecedencia, setAntecedencia] = useState(String(inicial?.antecedencia_horas ?? 24));
  const [horario, setHorario] = useState<Record<DiaSemana, string>>(
    Object.fromEntries(DIAS.map(([k]) => [k, (inicial?.horario[k] ?? []).join(", ")])) as Record<DiaSemana, string>,
  );

  const guardar = async () => {
    const corpo = {
      nome,
      tipo,
      morada,
      descricao: inicial?.descricao ?? null,
      lotacao: inicial?.lotacao ?? null,
      horario: Object.fromEntries(
        DIAS.map(([k]) => [
          k,
          horario[k]
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        ]),
      ),
      duracao_slot_min: inicial?.duracao_slot_min ?? 60,
      duracao_max_horas: Number(maxHoras),
      antecedencia_horas: Number(antecedencia),
      preco_hora_cent: Math.round(Number(preco.replace(",", ".")) * 100),
      entrada_cent: inicial?.entrada_cent ?? null,
      notas: inicial?.notas ?? null,
      aprovacao,
      ativo,
    };
    const r = await acao.executar(() =>
      inicial
        ? pedido(`/v1/painel/reservas/equipamentos/${inicial.id}`, { metodo: "PUT", corpo })
        : pedido("/v1/painel/reservas/equipamentos", { metodo: "POST", corpo }),
    );
    if (r !== undefined) onGuardado();
  };

  return (
    <Dialogo titulo={inicial ? `Editar ${inicial.nome}` : "Novo equipamento"} aberto onFechar={onFechar} largura="max-w-2xl">
      <div className="grid gap-4 md:grid-cols-2">
        <Campo rotulo="Nome">
          <input className={classeEntrada} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo rotulo="Tipo">
          <select className={classeEntrada} value={tipo} onChange={(e) => setTipo(e.target.value as TipoEquip)}>
            {Object.entries(TIPOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Morada" className="md:col-span-2">
          <input className={classeEntrada} value={morada} onChange={(e) => setMorada(e.target.value)} />
        </Campo>
        <Campo rotulo="Preço por hora (€)" ajuda="0 para gratuito">
          <input className={classeEntrada} inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} />
        </Campo>
        <Campo rotulo="Quem confirma">
          <select
            className={classeEntrada}
            value={aprovacao}
            onChange={(e) => setAprovacao(e.target.value as "automatica" | "funcionario")}
          >
            <option value="automatica">Confirmada na hora</option>
            <option value="funcionario">Um funcionário aprova</option>
          </select>
        </Campo>
        <Campo rotulo="Máximo de horas seguidas">
          <input className={classeEntrada} inputMode="numeric" value={maxHoras} onChange={(e) => setMaxHoras(e.target.value)} />
        </Campo>
        <Campo rotulo="Antecedência mínima (horas)">
          <input
            className={classeEntrada}
            inputMode="numeric"
            value={antecedencia}
            onChange={(e) => setAntecedencia(e.target.value)}
          />
        </Campo>
      </div>
      <fieldset className="mt-4 flex flex-col gap-2">
        <legend className="text-[13px] font-semibold text-tinta">Horário de reservas (ex.: 09:00-13:00, 14:00-20:00)</legend>
        {DIAS.map(([k, n]) => (
          <label key={k} className="grid grid-cols-[48px_1fr] items-center gap-2 text-sm text-tinta-2">
            {n}
            <input
              className={classeEntrada}
              value={horario[k]}
              placeholder="fechado"
              onChange={(e) => setHorario((h) => ({ ...h, [k]: e.target.value }))}
            />
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex items-center gap-2 text-sm text-tinta">
        <Interruptor ligado={ativo} onMudar={setAtivo} rotulo="Ativo" /> Ativo (aparece ao agente)
      </div>
      <ErroLinha erro={acao.erro} className="mt-3" />
      <div className="mt-5 flex justify-end gap-2">
        <Botao variante="discreto" onClick={onFechar}>
          Cancelar
        </Botao>
        <Botao disabled={acao.aCorrer || nome.trim().length < 3 || morada.trim().length < 3} onClick={guardar}>
          Guardar
        </Botao>
      </div>
    </Dialogo>
  );
}
