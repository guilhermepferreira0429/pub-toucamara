"use client";

import { ChevronDown, ChevronUp, Home, TriangleAlert, Wrench } from "lucide-react";
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
 * Painel · Habitação municipal (V4 #7): candidaturas ordenadas pela
 * pontuação provisória (cada critério explicado), pedidos de reparação
 * (estado e a quem fica atribuída; urgentes primeiro) e os fogos com os
 * inquilinos, a renda e os pedidos de revisão da renda.
 */

type EstadoCand = "submetida" | "em_analise" | "admitida" | "excluida" | "atribuida";
type EstadoRep = "registada" | "atribuida" | "em_curso" | "concluida";

interface Painel {
  contagens: Record<string, number>;
  regras: {
    demonstracao: boolean;
    ias_cent: number;
    piquete: string;
    fontes: string[];
    nota: string;
    limites: { apoiado: { agregado: number; limite_cent: number }[]; acessivel: { agregado: number; limite_cent: number }[] };
  };
}

interface Candidatura {
  id: string;
  codigo: string;
  regime: "apoiado" | "acessivel";
  agregado: number;
  rendimento_anual_cent: number;
  elegivel: boolean;
  pontuacao: number;
  criterios: {
    lista?: { criterio: string; pontos: number; maximo: number; porque: string }[];
    exclusoes?: string[];
  };
  estado: EstadoCand;
  nota: string | null;
  nome: string | null;
  telefone: string | null;
  criado_em: string;
  demonstracao: boolean;
}

interface Reparacao {
  id: string;
  codigo: string;
  categoria: string;
  descricao: string;
  urgencia: "urgente" | "normal";
  estado: EstadoRep;
  atribuida_a: string | null;
  morada: string;
  inquilino: string | null;
  telefone: string | null;
  criado_em: string;
}

interface Fogos {
  fogos: {
    id: string;
    codigo: string;
    morada: string;
    tipologia: string;
    area_m2: number | null;
    estado: string;
    demonstracao: boolean;
    regime: string | null;
    renda_cent: number | null;
    em_divida_cent: number | null;
    agregado: number | null;
    inquilino: string | null;
    reparacoes_abertas: number | null;
  }[];
  revisoes: {
    id: string;
    codigo: string;
    inquilino: string | null;
    morada: string;
    motivo: string;
    rendimento_mensal_cent: number;
    agregado: number;
    renda_atual_cent: number;
    renda_estimada_cent: number;
    estado: string;
    criado_em: string;
  }[];
}

const ESTADOS_CAND: Record<EstadoCand, string> = {
  submetida: "submetida",
  em_analise: "em análise",
  admitida: "admitida",
  excluida: "excluída",
  atribuida: "casa atribuída",
};
const ESTADOS_REP: Record<EstadoRep, string> = {
  registada: "registada",
  atribuida: "atribuída",
  em_curso: "em curso",
  concluida: "concluída",
};
const REGIME = { apoiado: "arrendamento apoiado", acessivel: "renda acessível" } as Record<string, string>;

type Vista = "candidaturas" | "reparacoes" | "fogos";

export function PaginaHabitacao() {
  const { pode, pedido } = useSessao();
  const permitido = pode("habitacao");
  const [vista, setVista] = useState<Vista>("candidaturas");
  const d = useDados<Painel>(permitido ? "/v1/painel/habitacao" : null);
  const demo = useAcao();

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Serviços", "Habitação"]} titulo="Habitação municipal" />
        <SemAcesso />
      </div>
    );
  }

  const c = d.dados?.contagens;
  const carregarDemo = async () => {
    const r = await demo.executar(() => pedido("/v1/painel/habitacao/demonstracao", { metodo: "POST" }));
    if (r !== undefined) d.recarregar();
  };

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Serviços", "Habitação"]}
        titulo="Habitação municipal"
        descricao="Candidaturas com a pontuação provisória que o agente calculou, reparações pedidas pelos inquilinos e os fogos da câmara."
        acoes={
          <>
            <Pilula tom="ambar">valores de demonstração</Pilula>
            {c && c.fogos === 0 && (
              <Botao variante="secundario" tamanho="pequeno" onClick={carregarDemo} disabled={demo.aCorrer}>
                Carregar fogos de demonstração
              </Botao>
            )}
          </>
        }
      />
      <ErroLinha erro={demo.erro} className="mx-4 sm:mx-10 mb-4" />
      {c && (
        <div className="grid gap-3 px-4 sm:px-10 pb-5 sm:grid-cols-4">
          <Numero rotulo="Candidaturas por analisar" valor={c.candidaturas_por_analisar} />
          <Numero rotulo="Reparações abertas" valor={c.reparacoes_abertas} />
          <Numero rotulo="Reparações urgentes" valor={c.reparacoes_urgentes} destaque />
          <Numero rotulo="Fogos livres" valor={c.fogos_livres} sufixo={` de ${c.fogos}`} />
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto px-4 pb-4 sm:px-10 [&>*]:shrink-0 [&>*]:whitespace-nowrap" role="tablist" aria-label="Vista">
        {(
          [
            ["candidaturas", "Candidaturas"],
            ["reparacoes", "Reparações"],
            ["fogos", "Fogos e inquilinos"],
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
      <div className="grid gap-6 px-4 sm:px-10 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {vista === "candidaturas" && <Candidaturas onMudou={d.recarregar} />}
          {vista === "reparacoes" && <Reparacoes onMudou={d.recarregar} />}
          {vista === "fogos" && <ListaFogos />}
        </div>
        <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!d.dados}>
          {d.dados && <Regras p={d.dados} />}
        </Estado>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, destaque, sufixo }: { rotulo: string; valor: number; destaque?: boolean; sufixo?: string }) {
  return (
    <Cartao className={`px-5 py-4 ${destaque && valor > 0 ? "border-terracota" : ""}`}>
      <Rotulo>{rotulo}</Rotulo>
      <p className="mt-1 font-display text-3xl font-bold text-tinta">
        {valor}
        {sufixo && <span className="text-base font-semibold text-tinta-3">{sufixo}</span>}
      </p>
    </Cartao>
  );
}

function Regras({ p }: { p: Painel }) {
  return (
    <Cartao className="flex h-fit flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <Rotulo>Critérios que o agente aplica</Rotulo>
        <Pilula tom="ambar">demonstração</Pilula>
      </div>
      <p className="text-sm text-tinta-2">
        Pontuação até 100: situação da casa (30), rendimento por pessoa (25), crianças (15), idosos ou pessoas com
        deficiência (15), anos no concelho (15).
      </p>
      <div>
        <Rotulo>Limite de rendimento anual</Rotulo>
        <table className="mt-1 w-full text-xs text-tinta-2">
          <thead>
            <tr className="text-tinta-3">
              <th className="text-left font-semibold">Pessoas</th>
              <th className="text-right font-semibold">Apoiado</th>
              <th className="text-right font-semibold">Acessível</th>
            </tr>
          </thead>
          <tbody>
            {p.regras.limites.apoiado.map((l, i) => (
              <tr key={l.agregado}>
                <td>{l.agregado}</td>
                <td className="text-right">{euros(l.limite_cent)}</td>
                <td className="text-right">{euros(p.regras.limites.acessivel[i].limite_cent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-tinta-2">
        IAS: {euros(p.regras.ias_cent)} · Piquete de urgências: <strong>{p.regras.piquete}</strong>
      </p>
      <p className="text-xs text-tinta-3">{p.regras.nota}</p>
      <ul className="text-xs text-tinta-3">
        {p.regras.fontes.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
    </Cartao>
  );
}

function Candidaturas({ onMudou }: { onMudou: () => void }) {
  const d = useDados<{ candidaturas: Candidatura[] }>("/v1/painel/habitacao/candidaturas");
  return (
    <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.candidaturas.length === 0} textoVazio="Ainda não há candidaturas. Ligue para a linha e peça uma casa da câmara.">
      {d.dados?.candidaturas.map((c, i) => (
        <CartaoCandidatura
          key={c.id}
          c={c}
          posicao={c.elegivel ? i + 1 : null}
          onMudou={() => {
            d.recarregar();
            onMudou();
          }}
        />
      ))}
    </Estado>
  );
}

function CartaoCandidatura({ c, posicao, onMudou }: { c: Candidatura; posicao: number | null; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [aberto, setAberto] = useState(false);
  const mudar = async (estado: EstadoCand) => {
    const r = await acao.executar(() => pedido(`/v1/painel/habitacao/candidaturas/${c.id}`, { metodo: "PATCH", corpo: { estado } }));
    if (r !== undefined) onMudou();
  };
  return (
    <Cartao className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-tinta">{c.codigo}</span>
            <Pilula tom="tinta">{REGIME[c.regime]}</Pilula>
            <Pilula tom={c.estado === "excluida" ? "neutro" : c.estado === "admitida" ? "verde" : "ambar"}>{ESTADOS_CAND[c.estado]}</Pilula>
            {!c.elegivel && <Pilula tom="terracota">não cumpre os requisitos</Pilula>}
          </div>
          <p className="font-display text-lg font-bold text-tinta">{c.nome ?? "Sem nome"}</p>
          <p className="text-[13px] text-tinta-2">
            {c.agregado} {c.agregado === 1 ? "pessoa" : "pessoas"} · {euros(c.rendimento_anual_cent)} por ano · {quando(c.criado_em)}
            {c.telefone ? ` · ${c.telefone}` : ""}
          </p>
          {c.nota && <p className="text-[13px] text-tinta-2">Nota: {c.nota}</p>}
        </div>
        <div className="text-right">
          <p className="font-display text-4xl font-bold text-terracota">{c.pontuacao}</p>
          <p className="text-xs text-tinta-3">pontos provisórios{posicao ? ` · ${posicao}.º` : ""}</p>
        </div>
      </div>
      <button type="button" onClick={() => setAberto(!aberto)} className="mt-3 flex items-center gap-1 text-[13px] font-semibold text-tinta-2" aria-expanded={aberto}>
        {aberto ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
        Critérios
      </button>
      {aberto && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {c.criterios.lista?.map((x) => (
            <li key={x.criterio} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm">
              <span>
                <span className="font-semibold text-tinta">{x.criterio}</span>
                <span className="block text-xs text-tinta-3">{x.porque}</span>
              </span>
              <span className="font-mono text-tinta-2">
                {x.pontos}/{x.maximo}
              </span>
            </li>
          ))}
          {c.criterios.exclusoes?.map((x) => (
            <li key={x} className="text-sm text-terracota-escuro">
              <TriangleAlert className="mr-1 inline size-4" aria-hidden />
              {x}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-[13px] font-semibold text-tinta" htmlFor={`estado-${c.id}`}>
          Estado
        </label>
        <select
          id={`estado-${c.id}`}
          className={`${classeEntrada} w-auto`}
          value={c.estado}
          disabled={acao.aCorrer}
          onChange={(e) => mudar(e.target.value as EstadoCand)}
        >
          {(Object.keys(ESTADOS_CAND) as EstadoCand[]).map((e) => (
            <option key={e} value={e}>
              {ESTADOS_CAND[e]}
            </option>
          ))}
        </select>
      </div>
      <ErroLinha erro={acao.erro} className="mt-3" />
    </Cartao>
  );
}

function Reparacoes({ onMudou }: { onMudou: () => void }) {
  const d = useDados<{ reparacoes: Reparacao[]; categorias: Record<string, string> }>("/v1/painel/habitacao/reparacoes");
  return (
    <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.reparacoes.length === 0} textoVazio="Não há pedidos de reparação.">
      {d.dados?.reparacoes.map((r) => (
        <CartaoReparacao
          key={r.id}
          r={r}
          categoria={d.dados?.categorias[r.categoria] ?? r.categoria}
          onMudou={() => {
            d.recarregar();
            onMudou();
          }}
        />
      ))}
    </Estado>
  );
}

function CartaoReparacao({ r, categoria, onMudou }: { r: Reparacao; categoria: string; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [equipa, setEquipa] = useState(r.atribuida_a ?? "");
  const mudar = async (corpo: { estado?: EstadoRep; atribuida_a?: string }) => {
    const x = await acao.executar(() => pedido(`/v1/painel/habitacao/reparacoes/${r.id}`, { metodo: "PATCH", corpo }));
    if (x !== undefined) onMudou();
  };
  return (
    <Cartao className={`p-5 ${r.urgencia === "urgente" && r.estado !== "concluida" ? "border-terracota" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-tinta">{r.codigo}</span>
        {r.urgencia === "urgente" && (
          <Pilula tom="terracota" icone={TriangleAlert}>
            urgente
          </Pilula>
        )}
        <Pilula tom={r.estado === "concluida" ? "verde" : "neutro"}>{ESTADOS_REP[r.estado]}</Pilula>
        <Pilula tom="tinta">{categoria}</Pilula>
      </div>
      <p className="mt-2 font-display text-lg font-bold text-tinta">
        <Wrench className="mr-1.5 inline size-4" aria-hidden />
        {r.descricao}
      </p>
      <p className="text-[13px] text-tinta-2">
        {r.morada} · {r.inquilino ?? "—"} {r.telefone ? `· ${r.telefone}` : ""} · {quando(r.criado_em)}
      </p>
      {r.estado !== "concluida" && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <input
            className={`${classeEntrada} max-w-xs`}
            placeholder="Equipa ou pessoa"
            aria-label="Atribuir a"
            value={equipa}
            onChange={(e) => setEquipa(e.target.value)}
          />
          <Botao tamanho="pequeno" variante="secundario" disabled={equipa.trim().length < 2 || acao.aCorrer} onClick={() => mudar({ atribuida_a: equipa.trim() })}>
            Atribuir
          </Botao>
          {r.estado !== "em_curso" && (
            <Botao tamanho="pequeno" variante="discreto" disabled={acao.aCorrer} onClick={() => mudar({ estado: "em_curso" })}>
              Em curso
            </Botao>
          )}
          <Botao tamanho="pequeno" disabled={acao.aCorrer} onClick={() => mudar({ estado: "concluida" })}>
            Concluída (avisa por SMS)
          </Botao>
        </div>
      )}
      {r.estado === "concluida" && r.atribuida_a && <p className="mt-2 text-xs text-tinta-3">Feita por: {r.atribuida_a}</p>}
      <ErroLinha erro={acao.erro} className="mt-3" />
    </Cartao>
  );
}

function ListaFogos() {
  const d = useDados<Fogos>("/v1/painel/habitacao/fogos");
  return (
    <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.fogos.length === 0} textoVazio="Ainda não há fogos registados.">
      <Cartao className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-linha text-xs text-tinta-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Fogo</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Inquilino</th>
              <th className="px-4 py-3 font-semibold">Renda</th>
              <th className="px-4 py-3 font-semibold">Em atraso</th>
            </tr>
          </thead>
          <tbody>
            {d.dados?.fogos.map((f) => (
              <tr key={f.id} className="border-b border-linha last:border-0 align-top">
                <td className="px-4 py-3">
                  <span className="font-semibold text-tinta">
                    <Home className="mr-1 inline size-3.5" aria-hidden />
                    {f.morada}
                  </span>
                  <span className="block text-xs text-tinta-3">
                    {f.codigo} · {f.tipologia}
                    {f.area_m2 ? ` · ${f.area_m2} m²` : ""}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Pilula tom={f.estado === "livre" ? "verde" : f.estado === "em_obras" ? "ambar" : "neutro"}>{f.estado.replace("_", " ")}</Pilula>
                </td>
                <td className="px-4 py-3 text-tinta-2">
                  {f.inquilino ?? "—"}
                  {f.agregado ? <span className="block text-xs text-tinta-3">{f.agregado} pessoas · {REGIME[f.regime ?? ""] ?? ""}</span> : null}
                  {f.reparacoes_abertas ? <span className="block text-xs text-terracota-escuro">{f.reparacoes_abertas} reparação(ões) aberta(s)</span> : null}
                </td>
                <td className="px-4 py-3 text-tinta-2">{f.renda_cent !== null ? euros(f.renda_cent) : "—"}</td>
                <td className="px-4 py-3 text-tinta-2">{f.em_divida_cent ? <strong className="text-terracota-escuro">{euros(f.em_divida_cent)}</strong> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Cartao>
      {d.dados && d.dados.revisoes.length > 0 && (
        <Cartao className="p-5">
          <Rotulo>Pedidos de revisão da renda</Rotulo>
          <ul className="mt-2 flex flex-col gap-3">
            {d.dados.revisoes.map((v) => (
              <li key={v.id} className="text-sm">
                <span className="font-mono font-semibold text-tinta">{v.codigo}</span> · {v.inquilino ?? "—"} · {v.morada}
                <span className="block text-tinta-2">
                  {v.motivo} · {euros(v.rendimento_mensal_cent)}/mês, {v.agregado} {v.agregado === 1 ? "pessoa" : "pessoas"} · renda{" "}
                  {euros(v.renda_atual_cent)} → cerca de {euros(v.renda_estimada_cent)} (provisório)
                </span>
                <span className="block text-xs text-tinta-3">
                  {v.estado} · {dia(v.criado_em)}
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </Estado>
  );
}
