"use client";

import { Accessibility, CircleParking, FileText, MessageSquareText, Scale } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  classeEntrada,
  dia,
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
 * Painel · Estacionamento (V4 #5). O agente consulta multas, gera o
 * pagamento (modo de teste), regista defesas e pedidos de lugar reservado
 * para pessoas com deficiência; aqui o serviço decide as defesas e os
 * pedidos (com uma nota que segue por SMS) e vê os parques e tarifas.
 */

type EstadoMulta = "por_pagar" | "paga" | "em_defesa" | "anulada";

interface Multa {
  id: string;
  numero_auto: string;
  matricula: string;
  infracao: string;
  local: string;
  verificada_em: string;
  valor_cent: number;
  prazo_pagamento: string;
  prazo_defesa: string;
  estado: EstadoMulta;
  processo_id: string | null;
  paga_em: string | null;
  demonstracao: boolean;
  fora_do_prazo: boolean;
}

interface Defesa {
  id: string;
  numero_auto: string;
  matricula: string;
  infracao: string;
  valor_cent: number;
  nome: string | null;
  telefone: string | null;
  texto: string;
  estado: "por_analisar" | "aceite" | "recusada";
  nota: string | null;
  decidida_por_nome: string | null;
  decidida_em: string | null;
  conversa_id: string | null;
  canal: string;
  criada_em: string;
}

interface Lugar {
  id: string;
  numero: string;
  nome: string | null;
  telefone: string | null;
  morada: string;
  matricula: string | null;
  tem_cartao: boolean;
  observacoes: string | null;
  estado: "recebido" | "aprovado" | "recusado";
  nota: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  conversa_id: string | null;
  criado_em: string;
}

interface Parque {
  id: string;
  nome: string;
  tipo: "parque" | "zona_tarifada";
  morada: string;
  lugares: number | null;
  lugares_deficiencia: number | null;
  horario_dito: string;
  tarifa_dita: string;
  pagamento_telemovel: boolean;
  notas: string | null;
  ativo: boolean;
  demonstracao: boolean;
}

interface Dados {
  contagens: {
    multas_por_pagar: number;
    multas_em_defesa: number;
    multas_pagas: number;
    defesas_por_analisar: number;
    lugares_por_decidir: number;
  };
  multas: Multa[];
  defesas: Defesa[];
  lugares: Lugar[];
  parques: Parque[];
  regras: { multas: { fonte: string; prazo_dias_uteis: number; demonstracao: boolean } };
}

const ESTADOS_MULTA: Record<EstadoMulta, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }> = {
  por_pagar: { rotulo: "por pagar", tom: "terracota" },
  em_defesa: { rotulo: "defesa por analisar", tom: "ambar" },
  paga: { rotulo: "paga", tom: "verde" },
  anulada: { rotulo: "anulada", tom: "neutro" },
};

type Vista = "defesas" | "multas" | "lugares" | "parques";

export function PaginaEstacionamento() {
  const { pode, pedido } = useSessao();
  const [vista, setVista] = useState<Vista>("defesas");
  const d = useDados<Dados>(pode("estacionamento") ? "/v1/painel/estacionamento" : null);
  const demo = useAcao();

  if (!pode("estacionamento")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Serviços", "Estacionamento"]} titulo="Estacionamento" />
        <SemAcesso />
      </div>
    );
  }
  const c = d.dados?.contagens;
  const vazio = d.dados && d.dados.multas.length === 0 && d.dados.parques.length === 0;
  const separadores: [Vista, string, number | undefined][] = [
    ["defesas", "Defesas", c?.defesas_por_analisar],
    ["multas", "Multas", c?.multas_por_pagar],
    ["lugares", "Lugares reservados", c?.lugares_por_decidir],
    ["parques", "Parques e tarifas", undefined],
  ];

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Serviços", "Estacionamento"]}
        titulo="Estacionamento"
        descricao="Multas consultadas e pagas na chamada, defesas por escrito para decidir, pedidos de lugar reservado e os parques que o agente indica. O dístico de residente está nas Licenças."
        acoes={
          pode("agente") && vazio ? (
            <Botao
              tamanho="pequeno"
              variante="secundario"
              disabled={demo.aCorrer}
              onClick={async () => {
                const r = await demo.executar(() =>
                  pedido("/v1/painel/estacionamento/demonstracao", { metodo: "POST" }),
                );
                if (r !== undefined) d.recarregar();
              }}
            >
              Carregar dados de demonstração
            </Botao>
          ) : undefined
        }
      />
      <ErroLinha erro={demo.erro} className="mx-4 sm:mx-10 mb-4" />
      {c && (
        <div className="grid grid-cols-2 gap-3 px-4 sm:px-10 pb-5 md:grid-cols-5">
          <Numero rotulo="Por pagar" valor={c.multas_por_pagar} />
          <Numero rotulo="Em defesa" valor={c.multas_em_defesa} />
          <Numero rotulo="Pagas" valor={c.multas_pagas} />
          <Numero rotulo="Defesas por analisar" valor={c.defesas_por_analisar} destaque />
          <Numero rotulo="Lugares por decidir" valor={c.lugares_por_decidir} destaque />
        </div>
      )}
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
      <div className="flex flex-col gap-4 px-4 sm:px-10">
        <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!d.dados}>
          {d.dados && vista === "defesas" && (
            <Estado vazio={d.dados.defesas.length === 0} textoVazio="Ainda não há defesas. O agente regista-as quando alguém diz que a multa está errada.">
              {d.dados.defesas.map((x) => (
                <CartaoDefesa key={x.id} d={x} onMudou={d.recarregar} />
              ))}
            </Estado>
          )}
          {d.dados && vista === "multas" && <TabelaMultas multas={d.dados.multas} />}
          {d.dados && vista === "lugares" && (
            <Estado vazio={d.dados.lugares.length === 0} textoVazio="Ainda não há pedidos de lugar reservado.">
              {d.dados.lugares.map((x) => (
                <CartaoLugar key={x.id} l={x} onMudou={d.recarregar} />
              ))}
            </Estado>
          )}
          {d.dados && vista === "parques" && <ListaParques parques={d.dados.parques} />}
        </Estado>
        {d.dados?.regras.multas.demonstracao && (
          <p className="text-xs text-tinta-3">
            <Pilula tom="ambar">valores de demonstração</Pilula> Prazos de {d.dados.regras.multas.prazo_dias_uteis} dias
            úteis para pagar ou defender ({d.dados.regras.multas.fonte}), parques, tarifas e multas de exemplo: a confirmar
            pela câmara.
          </p>
        )}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <Cartao className={`px-4 py-3 ${destaque && valor > 0 ? "border-terracota" : ""}`}>
      <Rotulo>{rotulo}</Rotulo>
      <p className="font-display text-2xl font-bold text-tinta">{valor}</p>
    </Cartao>
  );
}

function Decidir({
  opcoes,
  caminho,
  onMudou,
}: {
  opcoes: [string, string, "principal" | "secundario"][];
  caminho: string;
  onMudou: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [nota, setNota] = useState("");
  return (
    <div className="flex flex-col gap-2 border-t border-linha px-5 py-3">
      <input
        className={classeEntrada}
        placeholder="Nota para a pessoa (vai por SMS)"
        aria-label="Nota da decisão"
        value={nota}
        onChange={(e) => setNota(e.target.value)}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {opcoes.map(([decisao, rotulo, variante]) => (
          <Botao
            key={decisao}
            tamanho="pequeno"
            variante={variante}
            disabled={acao.aCorrer || nota.trim().length < 5}
            onClick={async () => {
              const r = await acao.executar(() =>
                pedido(caminho, { metodo: "POST", corpo: { decisao, nota: nota.trim() } }),
              );
              if (r !== undefined) onMudou();
            }}
          >
            {rotulo}
          </Botao>
        ))}
      </div>
      <ErroLinha erro={acao.erro} />
    </div>
  );
}

function CartaoDefesa({ d, onMudou }: { d: Defesa; onMudou: () => void }) {
  const aberta = d.estado === "por_analisar";
  return (
    <Cartao className={aberta ? "border-terracota" : ""}>
      <div className="flex flex-col gap-1.5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="size-4 text-terracota" aria-hidden />
          <span className="font-mono text-sm font-semibold text-tinta">{d.numero_auto}</span>
          <Pilula tom="tinta">{d.matricula}</Pilula>
          <Pilula tom={aberta ? "ambar" : d.estado === "aceite" ? "verde" : "neutro"}>
            {aberta ? "por analisar" : d.estado === "aceite" ? "aceite · multa anulada" : "recusada"}
          </Pilula>
        </div>
        <span className="text-[13px] text-tinta-2">
          {d.infracao} · {euros(d.valor_cent)}
        </span>
        <blockquote className="mt-1 rounded-[10px] bg-creme px-3 py-2 text-sm text-tinta">“{d.texto}”</blockquote>
        <span className="text-xs text-tinta-3">
          {d.nome ?? "Sem nome"}
          {d.telefone ? ` · ${d.telefone}` : ""} · {d.canal} · {quando(d.criada_em)}
          {d.conversa_id && (
            <>
              {" · "}
              <Link href={`/painel/conversas/${d.conversa_id}`} className="inline-flex items-center gap-1 font-semibold text-tinta-2">
                <MessageSquareText className="size-3.5" aria-hidden /> conversa
              </Link>
            </>
          )}
        </span>
        {!aberta && (
          <span className="text-xs text-tinta-3">
            Decidida {quando(d.decidida_em)}
            {d.decidida_por_nome ? ` por ${d.decidida_por_nome}` : ""}: {d.nota}
          </span>
        )}
      </div>
      {aberta && (
        <Decidir
          caminho={`/v1/painel/estacionamento/defesas/${d.id}/decidir`}
          onMudou={onMudou}
          opcoes={[
            ["recusada", "Recusar", "secundario"],
            ["aceite", "Aceitar e anular a multa", "principal"],
          ]}
        />
      )}
    </Cartao>
  );
}

function CartaoLugar({ l, onMudou }: { l: Lugar; onMudou: () => void }) {
  const aberto = l.estado === "recebido";
  return (
    <Cartao className={aberto ? "border-terracota" : ""}>
      <div className="flex flex-col gap-1.5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Accessibility className="size-4 text-terracota" aria-hidden />
          <span className="font-mono text-sm font-semibold text-tinta">{l.numero}</span>
          <Pilula tom={aberto ? "ambar" : l.estado === "aprovado" ? "verde" : "neutro"}>
            {aberto ? "por decidir" : l.estado}
          </Pilula>
          <Pilula tom={l.tem_cartao ? "verde" : "terracota"}>{l.tem_cartao ? "tem cartão" : "sem cartão"}</Pilula>
        </div>
        <span className="font-display text-lg font-bold text-tinta">{l.morada}</span>
        <span className="text-[13px] text-tinta-2">
          {l.matricula ? `Viatura ${l.matricula}` : "Sem matrícula"}
          {l.observacoes ? ` · ${l.observacoes}` : ""}
        </span>
        <span className="text-xs text-tinta-3">
          {l.nome ?? "Sem nome"}
          {l.telefone ? ` · ${l.telefone}` : ""} · {quando(l.criado_em)}
        </span>
        {!aberto && (
          <span className="text-xs text-tinta-3">
            Decidido {quando(l.decidido_em)}
            {l.decidido_por_nome ? ` por ${l.decidido_por_nome}` : ""}: {l.nota}
          </span>
        )}
      </div>
      {aberto && (
        <Decidir
          caminho={`/v1/painel/estacionamento/lugares/${l.id}/decidir`}
          onMudou={onMudou}
          opcoes={[
            ["recusado", "Recusar", "secundario"],
            ["aprovado", "Aprovar", "principal"],
          ]}
        />
      )}
    </Cartao>
  );
}

function TabelaMultas({ multas }: { multas: Multa[] }) {
  if (!multas.length) return <p className="p-5 text-sm text-tinta-3">Ainda não há multas registadas.</p>;
  return (
    <Cartao className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-linha text-[11px] tracking-[0.4px] text-tinta-3 uppercase">
          <tr>
            <th className="px-4 py-3">Auto</th>
            <th className="px-4 py-3">Matrícula</th>
            <th className="px-4 py-3">Infração</th>
            <th className="px-4 py-3">Valor</th>
            <th className="px-4 py-3">Pagar até</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3">
              <span className="sr-only">Processo</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {multas.map((m) => {
            const e = ESTADOS_MULTA[m.estado];
            return (
              <tr key={m.id} className="border-b border-linha last:border-0">
                <td className="px-4 py-3 font-mono font-semibold text-tinta">{m.numero_auto}</td>
                <td className="px-4 py-3 font-mono">{m.matricula}</td>
                <td className="px-4 py-3 text-tinta-2">
                  {m.infracao}
                  <span className="block text-xs text-tinta-3">
                    {m.local} · {quando(m.verificada_em)}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold">{euros(m.valor_cent)}</td>
                <td className="px-4 py-3">
                  {dia(m.prazo_pagamento)}
                  {m.fora_do_prazo && m.estado === "por_pagar" && (
                    <span className="block text-xs text-terracota">fora do prazo</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Pilula tom={e.tom}>{e.rotulo}</Pilula>
                    {m.demonstracao && <Pilula tom="neutro">demonstração</Pilula>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {m.processo_id && (
                    <Link
                      href={`/painel/processos/${m.processo_id}`}
                      className="inline-flex items-center gap-1 font-semibold text-tinta-2 hover:text-tinta"
                    >
                      <FileText className="size-4" aria-hidden /> processo
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Cartao>
  );
}

function ListaParques({ parques }: { parques: Parque[] }) {
  if (!parques.length) return <p className="p-5 text-sm text-tinta-3">Ainda não há parques registados.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {parques.map((p) => (
        <Cartao key={p.id} className="flex flex-col gap-1.5 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <CircleParking className="size-4 text-terracota" aria-hidden />
            <span className="font-display text-lg font-bold text-tinta">{p.nome}</span>
            {p.demonstracao && <Pilula tom="ambar">valores de demonstração</Pilula>}
          </div>
          <span className="text-[13px] text-tinta-2">{p.morada}</span>
          <span className="text-[13px] text-tinta">
            <span className="font-semibold">{p.tipo === "zona_tarifada" ? "Pago: " : "Aberto: "}</span>
            {p.horario_dito}
          </span>
          <span className="text-[13px] text-tinta">
            <span className="font-semibold">Tarifa: </span>
            {p.tarifa_dita}
          </span>
          <span className="text-xs text-tinta-3">
            {p.lugares ? `${p.lugares} lugares` : "Lugares na via pública"}
            {p.lugares_deficiencia ? ` · ${p.lugares_deficiencia} para pessoas com deficiência` : ""}
            {p.pagamento_telemovel ? " · paga-se pelo telemóvel" : ""}
          </span>
          {p.notas && <span className="text-xs text-tinta-3">{p.notas}</span>}
        </Cartao>
      ))}
    </div>
  );
}
