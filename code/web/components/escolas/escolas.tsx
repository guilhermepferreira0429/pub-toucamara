"use client";

import { Bus, Check, School, Utensils, X } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  dia,
  Dialogo,
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
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Escolas (V4 #3): as refeições do dia por escola (a contagem para
 * a cozinha, com as dietas), os pedidos de transporte escolar (aprovar ou
 * recusar, com SMS ao encarregado), os alunos com as inscrições e a oferta
 * de atividades. O agente trata dos pedidos pelo catálogo de serviços.
 */

type Escalao = "A" | "B" | "sem";

interface Painel {
  hoje: string;
  escolas: {
    id: string;
    nome: string;
    agrupamento: string | null;
    nivel: string;
    alunos: number;
    cantina: number;
    transporte_pendente: number;
    demonstracao: boolean;
  }[];
  atividades: {
    id: string;
    codigo: string;
    tipo: "aec" | "ferias";
    nome: string;
    escola: string | null;
    horario: string | null;
    inicio: string | null;
    fim: string | null;
    vagas: number;
    inscritos: number;
    preco_cent: number;
  }[];
  contagens: { alunos: number; pre_escolar_pendentes: number; transporte_pendentes: number };
  regras: {
    demonstracao: boolean;
    distancia_minima_km: number;
    precos_cent: Record<Escalao, number>;
    fontes: string[];
    nota: string;
  };
}

interface Refeicoes {
  dia: string;
  dia_de_aulas: boolean;
  total: number;
  desmarcadas: number;
  escolas: {
    escola_id: string;
    escola: string;
    total: number;
    por_escalao: Record<Escalao, number>;
    dietas: { aluno: string; alergias: string }[];
  }[];
}

interface PedidoTransporte {
  id: string;
  codigo: string;
  aluno: string;
  escola: string;
  morada: string;
  distancia_km: number | null;
  proposta: "cumpre" | "nao_cumpre" | "por_medir";
  estado: "pendente" | "aprovado" | "recusado";
  motivo: string | null;
  encarregado: string | null;
  telefone: string | null;
  criado_em: string;
  decidido_por: string | null;
}

interface Aluno {
  id: string;
  nome: string;
  ano: string | null;
  escalao: Escalao;
  alergias: string | null;
  escola: string | null;
  encarregado: string | null;
  telefone: string | null;
  cantina_desde: string | null;
  transporte: string | null;
  inscricoes: { tipo: string; estado: string; codigo: string; atividade: string | null; dados: { escolas_preferidas?: string[] } }[];
}

const ESCALAO: Record<Escalao, string> = { A: "escalão A", B: "escalão B", sem: "sem escalão" };
const ANO: Record<string, string> = { pre: "pré-escolar", "1": "1.º ano", "2": "2.º ano", "3": "3.º ano", "4": "4.º ano" };
const PROPOSTA = {
  cumpre: { rotulo: "cumpre a distância", tom: "verde" },
  nao_cumpre: { rotulo: "abaixo da distância mínima", tom: "ambar" },
  por_medir: { rotulo: "distância por medir", tom: "neutro" },
} as const;

type Vista = "refeicoes" | "transporte" | "alunos" | "atividades";

export function PaginaEscolas() {
  const { pode, pedido } = useSessao();
  const permitido = pode("escolas");
  const [vista, setVista] = useState<Vista>("refeicoes");
  const d = useDados<Painel>(permitido ? "/v1/painel/escolas" : null);
  const demo = useAcao();

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Serviços", "Escolas"]} titulo="Escolas" />
        <SemAcesso />
      </div>
    );
  }

  const carregarDemo = async () => {
    const r = await demo.executar(() => pedido("/v1/painel/escolas/demonstracao", { metodo: "POST" }));
    if (r !== undefined) d.recarregar();
  };

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Serviços", "Escolas"]}
        titulo="Escolas"
        descricao="Pré-escolar e 1.º ciclo: refeições, transporte escolar, atividades e pré-inscrições. Os pais tratam por telefone ou chat; aqui decide-se e prepara-se a cozinha."
        acoes={
          <>
            <Pilula tom="ambar">valores de demonstração</Pilula>
            {d.dados && d.dados.escolas.length === 0 && (
              <Botao variante="secundario" tamanho="pequeno" onClick={carregarDemo} disabled={demo.aCorrer}>
                Carregar escolas de demonstração
              </Botao>
            )}
          </>
        }
      />
      <ErroLinha erro={demo.erro} className="mx-10 mb-4" />
      {d.dados && (
        <div className="grid gap-3 px-10 pb-5 sm:grid-cols-4">
          <Numero rotulo="Escolas" valor={d.dados.escolas.length} />
          <Numero rotulo="Alunos registados" valor={d.dados.contagens.alunos} />
          <Numero rotulo="Transporte por decidir" valor={d.dados.contagens.transporte_pendentes} destaque />
          <Numero rotulo="Pré-inscrições à espera do agrupamento" valor={d.dados.contagens.pre_escolar_pendentes} />
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto px-4 pb-4 sm:px-10 [&>*]:shrink-0 [&>*]:whitespace-nowrap" role="tablist" aria-label="Vista">
        {(
          [
            ["refeicoes", "Refeições do dia"],
            ["transporte", "Transporte escolar"],
            ["alunos", "Alunos e inscrições"],
            ["atividades", "Atividades"],
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
      <div className="grid gap-6 px-10 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!d.dados}>
            {d.dados && vista === "refeicoes" && <RefeicoesDoDia hoje={d.dados.hoje} />}
            {vista === "transporte" && <Transporte onMudou={d.recarregar} />}
            {vista === "alunos" && <Alunos />}
            {d.dados && vista === "atividades" && <Atividades lista={d.dados.atividades} />}
          </Estado>
        </div>
        {d.dados && <Regras p={d.dados} />}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <Cartao className={`px-5 py-4 ${destaque && valor > 0 ? "border-terracota" : ""}`}>
      <Rotulo>{rotulo}</Rotulo>
      <p className="mt-1 font-display text-3xl font-bold text-tinta">{valor}</p>
    </Cartao>
  );
}

function Regras({ p }: { p: Painel }) {
  return (
    <Cartao className="flex h-fit flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <Rotulo>Regras que o agente aplica</Rotulo>
        <Pilula tom="ambar">demonstração</Pilula>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm text-tinta-2">
        <li>Refeição sem escalão: {euros(p.regras.precos_cent.sem)}</li>
        <li>Escalão B: {euros(p.regras.precos_cent.B)} · Escalão A: gratuita</li>
        <li>Marcar/desmarcar até às 10h do dia anterior</li>
        <li>Transporte a partir de {p.regras.distancia_minima_km} km de casa à escola</li>
        <li>Pré-escolar: a colocação é decidida pelo agrupamento</li>
      </ul>
      <p className="text-xs text-tinta-3">{p.regras.nota}</p>
      <ul className="text-xs text-tinta-3">
        {p.regras.fontes.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      <Rotulo className="mt-2">Escolas</Rotulo>
      <ul className="flex flex-col gap-2">
        {p.escolas.map((e) => (
          <li key={e.id} className="text-sm">
            <span className="font-semibold text-tinta">{e.nome}</span>
            <span className="block text-xs text-tinta-3">
              {e.alunos} alunos · {e.cantina} na cantina
              {e.transporte_pendente ? ` · ${e.transporte_pendente} transporte por decidir` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

function RefeicoesDoDia({ hoje }: { hoje: string }) {
  const [dia_, setDia] = useState(hoje);
  const r = useDados<Refeicoes>(`/v1/painel/escolas/refeicoes?dia=${dia_}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Campo rotulo="Dia" className="w-48">
          <input type="date" className={classeEntrada} value={dia_} onChange={(e) => e.target.value && setDia(e.target.value)} />
        </Campo>
        {r.dados && (
          <p className="pb-2 text-sm text-tinta-2">
            <Utensils className="mr-1 inline size-4" aria-hidden />
            <strong className="text-tinta">{r.dados.total}</strong> refeições
            {r.dados.desmarcadas ? ` · ${r.dados.desmarcadas} desmarcadas` : ""}
          </p>
        )}
      </div>
      <Estado
        aCarregar={r.aCarregar}
        erro={r.erro}
        vazio={r.dados?.escolas.length === 0}
        textoVazio={r.dados && !r.dados.dia_de_aulas ? "Neste dia não há aulas (fim de semana ou feriado)." : "Nenhum aluno com refeição neste dia."}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {r.dados?.escolas.map((e) => (
            <Cartao key={e.escola_id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold text-tinta">{e.escola}</p>
                  <p className="text-xs text-tinta-3">
                    A {e.por_escalao.A} · B {e.por_escalao.B} · sem escalão {e.por_escalao.sem}
                  </p>
                </div>
                <span className="font-display text-4xl font-bold text-terracota">{e.total}</span>
              </div>
              {e.dietas.length > 0 && (
                <div className="mt-4 rounded-xl bg-ambar-suave/60 p-3">
                  <Rotulo>Dietas e alergias (só para a cozinha)</Rotulo>
                  <ul className="mt-1 text-sm text-tinta">
                    {e.dietas.map((x) => (
                      <li key={x.aluno}>
                        {x.aluno}: <strong>{x.alergias}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Cartao>
          ))}
        </div>
      </Estado>
    </div>
  );
}

function Transporte({ onMudou }: { onMudou: () => void }) {
  const [estado, setEstado] = useState<"pendente" | "aprovado" | "recusado" | "">("pendente");
  const d = useDados<{ pedidos: PedidoTransporte[] }>(`/v1/painel/escolas/transporte${estado ? `?estado=${estado}` : ""}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Estado">
        {(
          [
            ["pendente", "Por decidir"],
            ["aprovado", "Aprovados"],
            ["recusado", "Recusados"],
            ["", "Todos"],
          ] as const
        ).map(([v, rotulo]) => (
          <button
            key={v}
            type="button"
            aria-pressed={estado === v}
            onClick={() => setEstado(v)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
              estado === v ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.pedidos.length === 0} textoVazio="Não há pedidos de transporte aqui.">
        {d.dados?.pedidos.map((p) => (
          <CartaoTransporte
            key={p.id}
            p={p}
            onMudou={() => {
              d.recarregar();
              onMudou();
            }}
          />
        ))}
      </Estado>
    </div>
  );
}

function CartaoTransporte({ p, onMudou }: { p: PedidoTransporte; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [recusar, setRecusar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const decidir = async (decisao: "aprovar" | "recusar") => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/escolas/transporte/${p.id}/decidir`, {
        metodo: "POST",
        corpo: decisao === "recusar" ? { decisao, motivo } : { decisao },
      }),
    );
    if (r !== undefined) {
      setRecusar(false);
      onMudou();
    }
  };
  const prop = PROPOSTA[p.proposta];
  return (
    <Cartao className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-tinta">{p.codigo}</span>
            <Pilula tom={prop.tom}>{prop.rotulo}</Pilula>
            {p.estado !== "pendente" && (
              <Pilula tom={p.estado === "aprovado" ? "verde" : "neutro"}>{p.estado}</Pilula>
            )}
          </div>
          <p className="font-display text-lg font-bold text-tinta">
            <Bus className="mr-1.5 inline size-4" aria-hidden />
            {p.aluno} → {p.escola}
          </p>
          <p className="text-[13px] text-tinta-2">
            {p.morada}
            {p.distancia_km !== null ? ` · ${String(p.distancia_km).replace(".", ",")} km (dito pelo encarregado)` : ""}
          </p>
          <p className="text-xs text-tinta-3">
            Encarregado: {p.encarregado ?? "—"} {p.telefone ? `· ${p.telefone}` : ""} · pedido {quando(p.criado_em)}
            {p.decidido_por ? ` · decidido por ${p.decidido_por}` : ""}
          </p>
          {p.motivo && <p className="text-[13px] text-tinta-2">Motivo: {p.motivo}</p>}
        </div>
        {p.estado === "pendente" && (
          <div className="flex gap-2">
            <Botao tamanho="pequeno" icone={Check} onClick={() => decidir("aprovar")} disabled={acao.aCorrer}>
              Aprovar
            </Botao>
            <Botao tamanho="pequeno" variante="secundario" icone={X} onClick={() => setRecusar(true)} disabled={acao.aCorrer}>
              Recusar
            </Botao>
          </div>
        )}
      </div>
      <ErroLinha erro={acao.erro} className="mt-3" />
      <Dialogo titulo="Recusar o transporte" aberto={recusar} onFechar={() => setRecusar(false)}>
        <Campo rotulo="Motivo" ajuda="Vai no SMS ao encarregado de educação.">
          <textarea className={classeEntrada} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="discreto" tamanho="pequeno" onClick={() => setRecusar(false)}>
            Cancelar
          </Botao>
          <Botao tamanho="pequeno" onClick={() => decidir("recusar")} disabled={!motivo.trim() || acao.aCorrer}>
            Recusar e avisar
          </Botao>
        </div>
      </Dialogo>
    </Cartao>
  );
}

function Alunos() {
  const d = useDados<{ alunos: Aluno[] }>("/v1/painel/escolas/alunos");
  return (
    <Cartao className="overflow-x-auto">
      <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.alunos.length === 0} textoVazio="Ainda não há alunos registados.">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-linha text-xs text-tinta-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Aluno</th>
              <th className="px-4 py-3 font-semibold">Escola</th>
              <th className="px-4 py-3 font-semibold">Escalão</th>
              <th className="px-4 py-3 font-semibold">Cantina</th>
              <th className="px-4 py-3 font-semibold">Inscrições</th>
              <th className="px-4 py-3 font-semibold">Encarregado</th>
            </tr>
          </thead>
          <tbody>
            {d.dados?.alunos.map((a) => (
              <tr key={a.id} className="border-b border-linha last:border-0 align-top">
                <td className="px-4 py-3">
                  <span className="font-semibold text-tinta">{a.nome}</span>
                  <span className="block text-xs text-tinta-3">{a.ano ? ANO[a.ano] : "—"}</span>
                  {a.alergias && (
                    <span className="mt-1 block text-xs font-semibold text-ambar">Saúde: {a.alergias}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-tinta-2">{a.escola ?? "—"}</td>
                <td className="px-4 py-3 text-tinta-2">{ESCALAO[a.escalao]}</td>
                <td className="px-4 py-3 text-tinta-2">{a.cantina_desde ? `desde ${dia(a.cantina_desde)}` : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {a.transporte && <Pilula tom={a.transporte === "aprovado" ? "verde" : "neutro"}>transporte {a.transporte}</Pilula>}
                    {a.inscricoes.map((i) => (
                      <Pilula key={i.codigo} tom={i.estado === "pendente" ? "ambar" : "neutro"}>
                        {i.tipo === "pre_escolar"
                          ? `pré-escolar (${i.estado === "pendente" ? "agrupamento decide" : i.estado})`
                          : `${i.atividade}${i.estado === "pendente" ? " · lista de espera" : ""}`}
                      </Pilula>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-tinta-2">
                  {a.encarregado ?? "—"}
                  {a.telefone && <span className="block text-tinta-3">{a.telefone}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
    </Cartao>
  );
}

function Atividades({ lista }: { lista: Painel["atividades"] }) {
  if (!lista.length) return <p className="text-sm text-tinta-3">Ainda não há atividades.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {lista.map((a) => (
        <Cartao key={a.id} className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pilula tom="tinta">{a.tipo === "aec" ? "AEC" : "Férias desportivas"}</Pilula>
            <span className="font-mono text-xs text-tinta-3">{a.codigo}</span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-tinta">
            <School className="mr-1.5 inline size-4" aria-hidden />
            {a.nome}
          </p>
          <p className="text-[13px] text-tinta-2">
            {a.escola ?? "Todas as escolas"}
            {a.horario ? ` · ${a.horario}` : ""}
            {a.inicio ? ` · ${dia(a.inicio)}${a.fim ? ` a ${dia(a.fim)}` : ""}` : ""}
          </p>
          <p className="mt-2 text-sm text-tinta">
            {a.inscritos}/{a.vagas} inscritos · {a.preco_cent ? euros(a.preco_cent) : "gratuita"}
          </p>
        </Cartao>
      ))}
    </div>
  );
}
