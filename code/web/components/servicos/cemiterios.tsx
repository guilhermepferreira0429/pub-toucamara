"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import {
  Cartao,
  classeEntrada,
  dia,
  Dialogo,
  Campo,
  ErroLinha,
  Estado,
  euros,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Filtros, PilulaDemonstracao, Separadores } from "@/components/servicos/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Cemitérios (V4 #8): os pedidos de renovação/averbamento feitos ao
 * agente, as sepulturas e concessões (a terminar, com taxas por pagar) e as
 * taxas e horários (valores de demonstração).
 */

type EstadoPedido = "recebido" | "em_analise" | "concluido" | "recusado";
type EstadoConcessao = "perpetua" | "valida" | "a_terminar" | "terminada";

interface Resumo {
  cemiterios: {
    id: string;
    nome: string;
    freguesia: string | null;
    morada: string | null;
    horario_dito: string | null;
    nota_horario: string | null;
    demonstracao: boolean;
    sepulturas: number;
  }[];
  pedidos: Partial<Record<EstadoPedido, number>>;
  concessoes: { a_terminar: number; terminadas: number; com_divida: number };
  taxas: { servico: string; descricao: string; valor_cent: number; unidade?: string }[];
  fonte_taxas: { titulo: string; demonstracao: boolean };
}

interface Pedido {
  id: string;
  numero: string;
  tipo: "renovacao" | "averbamento" | "segunda_via_alvara";
  referencia: string;
  requerente_nome: string;
  relacao: string | null;
  observacoes: string | null;
  telefone: string | null;
  canal: string;
  estado: EstadoPedido;
  resposta: string | null;
  sepultura: string | null;
  criado_em: string;
  tratado_por_nome: string | null;
}

interface Sepultura {
  sepultura_id: string;
  cemiterio: string;
  tipo: string;
  talhao: string;
  numero: string;
  concessao: "temporaria" | "perpetua";
  titular_nome: string | null;
  concessao_fim: string | null;
  conservacao_divida_cent: number;
  conservacao_divida_desde: number | null;
  demonstracao: boolean;
  estado_concessao: EstadoConcessao;
  inumados: { nome: string; data_falecimento: string | null }[];
}

const TIPOS_SEPULTURA: Record<string, string> = { sepultura: "sepultura", jazigo: "jazigo", gavetao: "gavetão", ossario: "ossário" };

const TIPOS: Record<Pedido["tipo"], string> = {
  renovacao: "Renovação da concessão",
  averbamento: "Averbamento (novo titular)",
  segunda_via_alvara: "2.ª via do alvará",
};

const ESTADOS: Record<EstadoPedido, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }> = {
  recebido: { rotulo: "recebido", tom: "terracota" },
  em_analise: { rotulo: "em análise", tom: "ambar" },
  concluido: { rotulo: "concluído", tom: "verde" },
  recusado: { rotulo: "recusado", tom: "neutro" },
};

const CONCESSOES: Record<EstadoConcessao, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }> = {
  perpetua: { rotulo: "perpétua", tom: "neutro" },
  valida: { rotulo: "válida", tom: "verde" },
  a_terminar: { rotulo: "a terminar", tom: "ambar" },
  terminada: { rotulo: "terminada", tom: "terracota" },
};

export function PaginaCemiterios() {
  const { pode } = useSessao();
  const [vista, setVista] = useState<"pedidos" | "sepulturas" | "taxas">("pedidos");
  const resumo = useDados<Resumo>(pode("servicos_municipais") ? "/v1/painel/cemiterios" : null);

  if (!pode("servicos_municipais")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Serviços", "Cemitérios"]} titulo="Cemitérios" />
        <SemAcesso />
      </div>
    );
  }
  const r = resumo.dados;
  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Serviços", "Cemitérios"]}
        titulo="Cemitérios"
        descricao="Onde está sepultada uma pessoa, as concessões e os pedidos de renovação ou averbamento que o agente regista. O agente fala com cuidado: muitas pessoas ligam em luto."
        acoes={r?.cemiterios.some((c) => c.demonstracao) ? <PilulaDemonstracao texto="dados de demonstração" /> : null}
      />
      {r && (
        <div className="grid gap-3 px-4 sm:px-10 pb-5 sm:grid-cols-3">
          <Numero rotulo="Pedidos por tratar" valor={(r.pedidos.recebido ?? 0) + (r.pedidos.em_analise ?? 0)} />
          <Numero rotulo="Concessões a terminar (180 dias)" valor={r.concessoes.a_terminar + r.concessoes.terminadas} />
          <Numero rotulo="Sepulturas com taxas por pagar" valor={r.concessoes.com_divida} />
        </div>
      )}
      <Separadores
        rotulo="Vista"
        valor={vista}
        onMudar={setVista}
        opcoes={[
          ["pedidos", "Pedidos"],
          ["sepulturas", "Sepulturas e concessões"],
          ["taxas", "Taxas e horários"],
        ]}
      />
      <div className="px-4 sm:px-10">
        {vista === "pedidos" && <Pedidos contagens={r?.pedidos} onMudou={resumo.recarregar} />}
        {vista === "sepulturas" && <Sepulturas />}
        {vista === "taxas" && (
          <Estado aCarregar={resumo.aCarregar} erro={resumo.erro}>
            {r && <TaxasHorarios r={r} />}
          </Estado>
        )}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <Cartao className="p-4">
      <Rotulo>{rotulo}</Rotulo>
      <p className="mt-1 font-display text-3xl font-bold text-tinta">{valor}</p>
    </Cartao>
  );
}

function Pedidos({ contagens, onMudou }: { contagens?: Partial<Record<EstadoPedido, number>>; onMudou: () => void }) {
  const [estado, setEstado] = useState<EstadoPedido | "">("");
  const base = `/v1/painel/cemiterios/pedidos${estado ? `?estado=${estado}` : ""}`;
  const d = useDados<Pagina<Pedido>>(base);
  const mais = useMais(base, d);
  return (
    <div>
      <Filtros
        rotulo="Estado"
        valor={estado}
        onMudar={setEstado}
        contagens={contagens}
        opcoes={[
          ["", "Todos"],
          ["recebido", "Recebidos"],
          ["em_analise", "Em análise"],
          ["concluido", "Concluídos"],
          ["recusado", "Recusados"],
        ]}
      />
      <div className="flex flex-col gap-3">
        <Estado
          aCarregar={d.aCarregar}
          erro={d.erro}
          vazio={d.dados?.itens.length === 0}
          textoVazio="Ainda não há pedidos. Experimente no chat: «quero renovar a concessão da sepultura do meu pai»."
        >
          {d.dados?.itens.map((p) => (
            <CartaoPedido
              key={p.id}
              p={p}
              onMudou={() => {
                d.recarregar();
                onMudou();
              }}
            />
          ))}
        </Estado>
        {mais.haMais && (
          <Botao variante="secundario" onClick={mais.mais} disabled={mais.aCorrer}>
            Ver mais
          </Botao>
        )}
        <ErroLinha erro={mais.erro} />
      </div>
    </div>
  );
}

function CartaoPedido({ p, onMudou }: { p: Pedido; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [fechar, setFechar] = useState<"concluido" | "recusado" | null>(null);
  const [resposta, setResposta] = useState("");
  const mudar = async (estado: EstadoPedido, texto?: string) => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/cemiterios/pedidos/${p.id}`, {
        metodo: "PATCH",
        corpo: { estado, ...(texto ? { resposta: texto } : {}) },
      }),
    );
    if (r) {
      setFechar(null);
      onMudou();
    }
  };
  const aberto = p.estado === "recebido" || p.estado === "em_analise";
  return (
    <Cartao className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-tinta-3">{p.numero}</p>
          <h3 className="mt-0.5 font-display text-lg font-bold text-tinta">{TIPOS[p.tipo]}</h3>
          <p className="mt-1 text-sm text-tinta-2">
            {p.requerente_nome}
            {p.relacao ? ` · ${p.relacao}` : ""} · {quando(p.criado_em)} · {p.canal}
          </p>
        </div>
        <Pilula tom={ESTADOS[p.estado].tom}>{ESTADOS[p.estado].rotulo}</Pilula>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-tinta-3">O que disse</dt>
          <dd className="text-tinta">{p.referencia}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-3">Sepultura identificada</dt>
          <dd className="text-tinta">{p.sepultura ?? "— (confirmar com a pessoa)"}</dd>
        </div>
        {p.observacoes && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-tinta-3">Observações</dt>
            <dd className="text-tinta">{p.observacoes}</dd>
          </div>
        )}
        {p.resposta && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-tinta-3">Resposta{p.tratado_por_nome ? ` de ${p.tratado_por_nome}` : ""}</dt>
            <dd className="text-tinta">{p.resposta}</dd>
          </div>
        )}
      </dl>
      {aberto && (
        <div className="mt-4 flex flex-wrap gap-2">
          {p.estado === "recebido" && (
            <Botao variante="secundario" tamanho="pequeno" disabled={acao.aCorrer} onClick={() => mudar("em_analise")}>
              Pôr em análise
            </Botao>
          )}
          <Botao tamanho="pequeno" onClick={() => setFechar("concluido")}>
            Concluir
          </Botao>
          <Botao variante="discreto" tamanho="pequeno" onClick={() => setFechar("recusado")}>
            Recusar
          </Botao>
        </div>
      )}
      <ErroLinha erro={acao.erro} className="mt-3" />
      <Dialogo
        titulo={fechar === "concluido" ? "Concluir o pedido" : "Recusar o pedido"}
        aberto={!!fechar}
        onFechar={() => setFechar(null)}
      >
        <Campo rotulo="Resposta (vai por SMS)" ajuda={p.telefone ? undefined : "Este pedido não tem telemóvel: a resposta fica só registada."}>
          <textarea
            className={`${classeEntrada} min-h-24`}
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            placeholder="Ex.: A renovação está feita. Pode pagar a taxa no balcão."
          />
        </Campo>
        <ErroLinha erro={acao.erro} className="mt-3" />
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="discreto" onClick={() => setFechar(null)}>
            Cancelar
          </Botao>
          <Botao disabled={acao.aCorrer || resposta.trim().length < 3} onClick={() => fechar && mudar(fechar, resposta.trim())}>
            {fechar === "concluido" ? "Concluir e avisar" : "Recusar e avisar"}
          </Botao>
        </div>
      </Dialogo>
    </Cartao>
  );
}

function Sepulturas() {
  const [q, setQ] = useState("");
  const [pesquisa, setPesquisa] = useState("");
  const d = useDados<{ sepulturas: Sepultura[] }>(
    `/v1/painel/cemiterios/sepulturas${pesquisa ? `?q=${encodeURIComponent(pesquisa)}` : ""}`,
  );
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPesquisa(q.trim());
        }}
      >
        <label className="sr-only" htmlFor="pesquisa-sepulturas">
          Procurar
        </label>
        <input
          id="pesquisa-sepulturas"
          className={classeEntrada}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome de quem está sepultado, titular ou talhão e número"
        />
        <Botao type="submit" icone={Search} variante="secundario">
          Procurar
        </Botao>
      </form>
      <Cartao className="overflow-x-auto">
        <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.sepulturas.length === 0} textoVazio="Nenhuma sepultura encontrada.">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-linha text-xs text-tinta-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Local</th>
                <th className="px-4 py-3 font-semibold">Quem lá está</th>
                <th className="px-4 py-3 font-semibold">Titular</th>
                <th className="px-4 py-3 font-semibold">Concessão</th>
                <th className="px-4 py-3 font-semibold">Conservação por pagar</th>
              </tr>
            </thead>
            <tbody>
              {d.dados?.sepulturas.map((s) => (
                <tr key={s.sepultura_id} className="border-b border-linha last:border-0 align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-tinta">
                      Talhão {s.talhao}, {TIPOS_SEPULTURA[s.tipo] ?? s.tipo} n.º {s.numero}
                    </p>
                    <p className="text-xs text-tinta-3">{s.cemiterio}</p>
                  </td>
                  <td className="px-4 py-3 text-tinta-2">
                    {s.inumados.map((i) => (
                      <p key={i.nome}>
                        {i.nome}
                        {i.data_falecimento ? ` (${dia(i.data_falecimento)})` : ""}
                      </p>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-tinta-2">{s.titular_nome ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Pilula tom={CONCESSOES[s.estado_concessao].tom}>{CONCESSOES[s.estado_concessao].rotulo}</Pilula>
                    {s.concessao_fim && <p className="mt-1 text-xs text-tinta-3">até {dia(s.concessao_fim)}</p>}
                  </td>
                  <td className="px-4 py-3 text-tinta-2">
                    {s.conservacao_divida_cent > 0
                      ? `${euros(s.conservacao_divida_cent)}${s.conservacao_divida_desde ? ` desde ${s.conservacao_divida_desde}` : ""}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>
    </div>
  );
}

function TaxasHorarios({ r }: { r: Resumo }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Cartao className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-tinta">Taxas</h2>
          {r.fonte_taxas.demonstracao && <PilulaDemonstracao />}
        </div>
        <ul className="mt-3 divide-y divide-linha text-sm">
          {r.taxas.map((t) => (
            <li key={t.descricao} className="flex justify-between gap-4 py-2">
              <span className="text-tinta-2">{t.descricao}</span>
              <span className="font-semibold whitespace-nowrap text-tinta">
                {euros(t.valor_cent)}
                {t.unidade ? ` ${t.unidade}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-tinta-3">Fonte: {r.fonte_taxas.titulo}.</p>
      </Cartao>
      <Cartao className="p-5">
        <h2 className="font-display text-lg font-bold text-tinta">Cemitérios e horários</h2>
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {r.cemiterios.length === 0 && <li className="text-tinta-3">Ainda não há cemitérios registados (Preparar demo).</li>}
          {r.cemiterios.map((c) => (
            <li key={c.id}>
              <p className="font-semibold text-tinta">
                {c.nome} <span className="font-normal text-tinta-3">· {c.sepulturas} sepulturas</span>
              </p>
              <p className="text-tinta-2">{c.horario_dito ?? "Sem horário registado"}</p>
              {c.nota_horario && <p className="text-xs text-tinta-3">{c.nota_horario}</p>}
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}
