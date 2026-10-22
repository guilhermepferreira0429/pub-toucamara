"use client";

import { Building2, ExternalLink, Pencil, Plus, RotateCcw, Search, Store } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  dia,
  ErroLinha,
  Estado,
  euros,
  Interruptor,
  Pilula,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
  Dialogo,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { FaixaDemonstracao } from "@/components/painel/faixa-demonstracao";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import type { Atividade, Calendario, Flag, Lista, Periodicidade } from "./tipos";

/*
 * Painel · Balcão para empresas: o catálogo do que cada atividade precisa
 * (o agente e a página /empresas usam-no logo), testar com um perfil e o
 * calendário de obrigações de uma empresa pelo NIF. Ver: quem trata dos
 * processos; mudar o catálogo: quem gere o agente. Tudo fica na auditoria.
 */

interface Requisito {
  chave: string;
  titulo: string;
  o_que_e: string;
  onde: "camara" | "fora";
  entidade: string;
  tipo_licenca: string | null;
  tipo_processo: string | null;
  url: string | null;
  atividades: Atividade[];
  quando: Flag[];
  prazo: string;
  antecedencia_dias: number | null;
  periodicidade: Periodicidade;
  fonte: { titulo: string; url: string | null };
  demonstracao: boolean;
  ativo: boolean;
  ordem: number;
}

interface ItemCatalogo extends Requisito {
  alterado: boolean;
  novo: boolean;
  omissao: Requisito | null;
}

interface Painel {
  itens: ItemCatalogo[];
  atividades: Record<Atividade, string>;
  flags: Record<Flag, string>;
  periodicidades: Record<Periodicidade, string>;
  tipos_licenca: Record<string, string>;
  uso: { listas_30_dias: number; por_atividade: { atividade: string; nome: string; n: number }[] };
}

interface Obrigacoes {
  municipe_id: string;
  titular: string | null;
  licencas: { numero: string; nome: string; estado: string; valida_ate: string | null; taxa_cent: number }[];
  calendario: Calendario;
}

const NOVO: Requisito = {
  chave: "",
  titulo: "",
  o_que_e: "",
  onde: "camara",
  entidade: "Câmara Municipal",
  tipo_licenca: null,
  tipo_processo: null,
  url: null,
  atividades: [],
  quando: [],
  prazo: "",
  antecedencia_dias: null,
  periodicidade: "unica",
  fonte: { titulo: "", url: null },
  demonstracao: true,
  ativo: true,
  ordem: 200,
};

function semMarcas(i: ItemCatalogo): Requisito {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alterado, novo, omissao, ...r } = i;
  return r;
}

export function PaginaBalcaoEmpresas() {
  const { pode } = useSessao();
  const d = useDados<Painel>(pode("processos") ? "/v1/painel/empresas/catalogo" : null);
  const [filtro, setFiltro] = useState<Atividade | "todas">("todas");
  const [aEditar, setAEditar] = useState<{ r: Requisito; novo: boolean } | null>(null);
  const repor = useAcao();
  const { pedido } = useSessao();

  if (!pode("processos")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Balcão para empresas"]} titulo="Balcão para empresas" />
        <SemAcesso />
      </div>
    );
  }

  const p = d.dados;
  const editar = pode("agente");
  const itens = (p?.itens ?? []).filter(
    (i) => filtro === "todas" || i.atividades.length === 0 || i.atividades.includes(filtro),
  );

  async function reporItem(i: ItemCatalogo) {
    const r = await repor.executar(() =>
      pedido<Painel>(`/v1/painel/empresas/catalogo/${i.chave}`, { metodo: "DELETE" }),
    );
    if (r) d.mudar(() => r);
  }

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Balcão para empresas"]}
        titulo="Balcão para empresas"
        descricao="O que cada atividade precisa para abrir e funcionar. O agente e a página das empresas usam este catálogo; as taxas vêm das regras das licenças e da tabela em vigor."
        acoes={
          <>
            <a
              href="/empresas"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-full border-[1.5px] border-tinta px-4 text-sm font-semibold text-tinta hover:bg-tinta/5"
            >
              <ExternalLink className="size-4" aria-hidden />
              Ver a página pública
            </a>
            {editar && (
              <Botao icone={Plus} onClick={() => setAEditar({ r: NOVO, novo: true })}>
                Novo requisito
              </Botao>
            )}
          </>
        }
      />

      <div className="grid gap-6 px-10 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {p && p.itens.some((i) => i.demonstracao) && (
            <FaixaDemonstracao>
              {p.itens.filter((i) => i.demonstracao).length} de {p.itens.length} requisitos têm prazos, condições ou
              taxas ainda por confirmar pela câmara. O regime legal está indicado em cada um; ao editar um requisito
              confirmado, desligue «Valores de demonstração».
            </FaixaDemonstracao>
          )}
          {p && (
            <Cartao className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
              <p className="flex items-center gap-2 text-sm text-tinta">
                <Store className="size-4 text-terracota" aria-hidden />
                <span className="font-display text-2xl font-bold">{p.uso.listas_30_dias}</span>
                listas feitas nos últimos 30 dias
              </p>
              <div className="flex flex-wrap gap-1.5">
                {p.uso.por_atividade.map((x) => (
                  <Pilula key={x.atividade}>
                    {x.nome} · {x.n}
                  </Pilula>
                ))}
              </div>
            </Cartao>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-tinta-2">
              Atividade
              <select
                className={`${classeEntrada} w-auto`}
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as Atividade | "todas")}
              >
                <option value="todas">Todas</option>
                {p &&
                  (Object.entries(p.atividades) as [Atividade, string][]).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </label>
            <span className="text-sm text-tinta-2" aria-live="polite">
              {itens.length} requisitos
            </span>
          </div>

          <ErroLinha erro={repor.erro} />
          <Cartao>
            <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!p}>
              <ul className="divide-y divide-linha">
                {itens.map((i) => (
                  <li key={i.chave} className={`flex flex-col gap-2 p-4 ${i.ativo ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <h2 className="text-[15px] font-semibold text-tinta">{i.titulo}</h2>
                        <p className="line-clamp-2 text-sm text-tinta-2">{i.o_que_e}</p>
                      </div>
                      {editar && (
                        <div className="flex shrink-0 gap-1.5">
                          {i.alterado && (
                            <Botao
                              variante="discreto"
                              tamanho="pequeno"
                              icone={RotateCcw}
                              disabled={repor.aCorrer}
                              onClick={() => reporItem(i)}
                              aria-label={`${i.novo ? "Apagar" : "Repor o original de"} ${i.titulo}`}
                            >
                              {i.novo ? "Apagar" : "Repor"}
                            </Botao>
                          )}
                          <Botao
                            variante="secundario"
                            tamanho="pequeno"
                            icone={Pencil}
                            onClick={() => setAEditar({ r: semMarcas(i), novo: false })}
                            aria-label={`Editar ${i.titulo}`}
                          >
                            Editar
                          </Botao>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Pilula tom={i.onde === "camara" ? "terracota" : "neutro"} icone={Building2}>
                        {i.onde === "camara" ? "Na câmara" : i.entidade}
                      </Pilula>
                      {i.tipo_licenca && p && <Pilula tom="tinta">{p.tipos_licenca[i.tipo_licenca]}</Pilula>}
                      <Pilula>{p?.periodicidades[i.periodicidade]}</Pilula>
                      {i.atividades.length ? (
                        i.atividades.map((a) => <Pilula key={a}>{p?.atividades[a]}</Pilula>)
                      ) : (
                        <Pilula>Todas as atividades</Pilula>
                      )}
                      {i.quando.length > 0 && (
                        <Pilula>Se: {i.quando.map((f) => p?.flags[f].toLowerCase()).join(" ou ")}</Pilula>
                      )}
                      {i.novo ? (
                        <Pilula tom="verde">acrescentado pela câmara</Pilula>
                      ) : (
                        i.alterado && <Pilula tom="verde">alterado pela câmara</Pilula>
                      )}
                      {!i.ativo && <Pilula>desligado</Pilula>}
                    </div>
                    <p className="text-xs text-tinta-2">Base: {i.fonte.titulo}</p>
                  </li>
                ))}
              </ul>
            </Estado>
          </Cartao>
        </div>

        <div className="flex flex-col gap-6">
          {p && <Testar painel={p} />}
          <ObrigacoesEmpresa />
        </div>
      </div>

      {aEditar && p && (
        <Editor
          painel={p}
          inicial={aEditar.r}
          novo={aEditar.novo}
          onFechar={() => setAEditar(null)}
          onGravado={(r) => {
            d.mudar(() => r);
            setAEditar(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de um requisito
// ---------------------------------------------------------------------------

function Editor({
  painel,
  inicial,
  novo,
  onFechar,
  onGravado,
}: {
  painel: Painel;
  inicial: Requisito;
  novo: boolean;
  onFechar: () => void;
  onGravado: (p: Painel) => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [r, setR] = useState<Requisito>(inicial);
  const mudar = <K extends keyof Requisito>(k: K, v: Requisito[K]) => setR((x) => ({ ...x, [k]: v }));
  const alternar = <T extends string>(lista: T[], v: T) =>
    lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];

  async function gravar(e: React.FormEvent) {
    e.preventDefault();
    const corpo: Requisito = {
      ...r,
      url: r.url?.trim() || null,
      tipo_processo: r.tipo_processo?.trim() || null,
      fonte: { titulo: r.fonte.titulo, url: r.fonte.url?.trim() || null },
    };
    const p = await acao.executar(() =>
      pedido<Painel>(`/v1/painel/empresas/catalogo/${encodeURIComponent(corpo.chave)}`, {
        metodo: "PUT",
        corpo,
      }),
    );
    if (p) onGravado(p);
  }

  return (
    <Dialogo titulo={novo ? "Novo requisito" : `Editar · ${inicial.titulo}`} aberto onFechar={onFechar} largura="max-w-2xl">
      <form onSubmit={gravar} className="flex flex-col gap-4">
        {novo && (
          <Campo rotulo="Chave (identificador)" ajuda="Só letras minúsculas, números e _ (ex.: mercado_municipal).">
            <input
              className={classeEntrada}
              required
              pattern="[a-z0-9_]{2,60}"
              value={r.chave}
              onChange={(e) => mudar("chave", e.target.value)}
            />
          </Campo>
        )}
        <Campo rotulo="Título">
          <input className={classeEntrada} required minLength={3} value={r.titulo} onChange={(e) => mudar("titulo", e.target.value)} />
        </Campo>
        <Campo rotulo="O que é (para o munícipe)">
          <textarea
            className={`${classeEntrada} min-h-20`}
            required
            minLength={3}
            value={r.o_que_e}
            onChange={(e) => mudar("o_que_e", e.target.value)}
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Onde se trata">
            <select className={classeEntrada} value={r.onde} onChange={(e) => mudar("onde", e.target.value as Requisito["onde"])}>
              <option value="camara">Na câmara</option>
              <option value="fora">Fora da câmara</option>
            </select>
          </Campo>
          <Campo rotulo="Quem trata">
            <input className={classeEntrada} required value={r.entidade} onChange={(e) => mudar("entidade", e.target.value)} />
          </Campo>
          <Campo rotulo="Pedido pelo agente (tipo de licença)">
            <select
              className={classeEntrada}
              value={r.tipo_licenca ?? ""}
              onChange={(e) => mudar("tipo_licenca", e.target.value || null)}
            >
              <option value="">Nenhum</option>
              {Object.entries(painel.tipos_licenca).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Taxa pela tabela (tipo de processo)" ajuda="Código, ex.: CP. Vazio se não houver.">
            <input
              className={classeEntrada}
              value={r.tipo_processo ?? ""}
              onChange={(e) => mudar("tipo_processo", e.target.value)}
            />
          </Campo>
        </div>
        <Campo rotulo="Link (para tratar fora da câmara)">
          <input type="url" className={classeEntrada} value={r.url ?? ""} onChange={(e) => mudar("url", e.target.value)} />
        </Campo>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold text-tinta">Para que atividades (nenhuma = todas)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(Object.entries(painel.atividades) as [Atividade, string][]).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-tinta">
                <input
                  type="checkbox"
                  className="size-4 accent-terracota"
                  checked={r.atividades.includes(k)}
                  onChange={() => mudar("atividades", alternar(r.atividades, k))}
                />
                {v}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold text-tinta">
            Só quando a empresa responde sim a (nenhuma = sempre; basta uma)
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(Object.entries(painel.flags) as [Flag, string][]).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-tinta">
                <input
                  type="checkbox"
                  className="size-4 accent-terracota"
                  checked={r.quando.includes(k)}
                  onChange={() => mudar("quando", alternar(r.quando, k))}
                />
                {v}
              </label>
            ))}
          </div>
        </fieldset>
        <Campo rotulo="Prazo">
          <textarea
            className={`${classeEntrada} min-h-16`}
            required
            minLength={3}
            value={r.prazo}
            onChange={(e) => mudar("prazo", e.target.value)}
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Quando" >
            <select
              className={classeEntrada}
              value={r.periodicidade}
              onChange={(e) => mudar("periodicidade", e.target.value as Periodicidade)}
            >
              {(Object.entries(painel.periodicidades) as [Periodicidade, string][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Antecedência (dias)" ajuda="Vazio: a do tipo de licença.">
            <input
              type="number"
              min={0}
              max={365}
              className={classeEntrada}
              value={r.antecedencia_dias ?? ""}
              onChange={(e) => mudar("antecedencia_dias", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Campo>
          <Campo rotulo="Ordem na lista">
            <input
              type="number"
              min={0}
              max={999}
              className={classeEntrada}
              value={r.ordem}
              onChange={(e) => mudar("ordem", Number(e.target.value))}
            />
          </Campo>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Base legal (fonte)">
            <input
              className={classeEntrada}
              required
              minLength={3}
              value={r.fonte.titulo}
              onChange={(e) => mudar("fonte", { ...r.fonte, titulo: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Link da fonte">
            <input
              type="url"
              className={classeEntrada}
              value={r.fonte.url ?? ""}
              onChange={(e) => mudar("fonte", { ...r.fonte, url: e.target.value })}
            />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-6">
          <span className="flex items-center gap-2 text-sm text-tinta">
            <Interruptor ligado={r.demonstracao} onMudar={(v) => mudar("demonstracao", v)} rotulo="Valores de demonstração" />
            Valores de demonstração (desligar quando confirmados)
          </span>
          <span className="flex items-center gap-2 text-sm text-tinta">
            <Interruptor ligado={r.ativo} onMudar={(v) => mudar("ativo", v)} rotulo="Ligado" />
            Ligado (aparece nas listas)
          </span>
        </div>
        <ErroLinha erro={acao.erro} />
        <div className="flex justify-end gap-2">
          <Botao variante="discreto" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" disabled={acao.aCorrer}>
            {acao.aCorrer ? "A gravar…" : "Gravar"}
          </Botao>
        </div>
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Testar com um perfil
// ---------------------------------------------------------------------------

function Testar({ painel }: { painel: Painel }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [atividade, setAtividade] = useState<Atividade>("restauracao");
  const [flags, setFlags] = useState<Flag[]>([]);
  const [r, setR] = useState<{ lista: Lista; calendario: Calendario } | null>(null);

  async function testar(e: React.FormEvent) {
    e.preventDefault();
    const corpo = Object.fromEntries([["atividade", atividade], ...flags.map((f) => [f, true])]);
    const x = await acao.executar(() =>
      pedido<{ lista: Lista; calendario: Calendario }>("/v1/painel/empresas/pre-visualizar", { corpo }),
    );
    if (x) setR(x);
  }

  return (
    <Cartao className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-bold text-tinta">Testar com um perfil</h2>
        <p className="text-sm text-tinta-2">O que a lista diria a esta empresa, com o catálogo de agora.</p>
      </div>
      <form onSubmit={testar} className="flex flex-col gap-3">
        <Campo rotulo="Atividade">
          <select className={classeEntrada} value={atividade} onChange={(e) => setAtividade(e.target.value as Atividade)}>
            {(Object.entries(painel.atividades) as [Atividade, string][]).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Campo>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold text-tinta">Responde sim a</legend>
          {(Object.entries(painel.flags) as [Flag, string][]).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-tinta">
              <input
                type="checkbox"
                className="size-4 accent-terracota"
                checked={flags.includes(k)}
                onChange={() => setFlags((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]))}
              />
              {v}
            </label>
          ))}
        </fieldset>
        <Botao type="submit" icone={Search} disabled={acao.aCorrer}>
          Ver a lista
        </Botao>
      </form>
      <ErroLinha erro={acao.erro} />
      {r && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <Rotulo>
            {r.lista.itens.length} itens · {r.lista.na_camara} na câmara
          </Rotulo>
          <ol className="flex flex-col gap-1.5">
            {r.lista.itens.map((i, k) => (
              <li key={i.chave} className="rounded-[10px] bg-creme px-3 py-2 text-sm text-tinta">
                <span className="font-semibold">
                  {k + 1}. {i.titulo}
                </span>
                <span className="block text-xs text-tinta-2">
                  {i.onde === "camara" ? "Câmara" : i.entidade}
                  {i.taxa ? ` · ${i.taxa.texto}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Cartao>
  );
}

// ---------------------------------------------------------------------------
// Obrigações de uma empresa (pelo NIF)
// ---------------------------------------------------------------------------

function ObrigacoesEmpresa() {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [nif, setNif] = useState("");
  const [r, setR] = useState<Obrigacoes | null>(null);

  async function procurar(e: React.FormEvent) {
    e.preventDefault();
    setR(null);
    const x = await acao.executar(() =>
      pedido<Obrigacoes>(`/v1/painel/empresas/obrigacoes?nif=${encodeURIComponent(nif.replace(/\s/g, ""))}`),
    );
    if (x) setR(x);
  }

  return (
    <Cartao className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-bold text-tinta">Calendário de uma empresa</h2>
        <p className="text-sm text-tinta-2">
          As licenças emitidas a esse NIF, as renovações e os prazos. Fica registado quem consultou.
        </p>
      </div>
      <form onSubmit={procurar} className="flex items-end gap-2">
        <Campo rotulo="NIF" className="flex-1">
          <input
            className={classeEntrada}
            inputMode="numeric"
            required
            pattern="\s*\d[\d\s]{7,}\d\s*"
            value={nif}
            onChange={(e) => setNif(e.target.value)}
          />
        </Campo>
        <Botao type="submit" icone={Search} disabled={acao.aCorrer}>
          Ver
        </Botao>
      </form>
      <ErroLinha erro={acao.erro} />
      {r && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {r.titular && <p className="text-sm font-semibold text-tinta">{r.titular}</p>}
          {r.licencas.length === 0 ? (
            <p className="text-sm text-tinta-2">Sem licenças em nome desta empresa.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {r.licencas.map((l) => (
                <li key={l.numero} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-mono font-semibold">{l.numero}</span> · {l.nome}
                  </span>
                  <span className="text-tinta-2">
                    {l.valida_ate ? `até ${dia(l.valida_ate)}` : l.estado.replace("_", " ")}
                    {l.taxa_cent ? ` · ${euros(l.taxa_cent)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {r.calendario.eventos.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Rotulo>Próximas datas</Rotulo>
              <ol className="flex flex-col gap-1.5">
                {r.calendario.eventos.map((e) => (
                  <li key={e.id} className="rounded-[10px] bg-creme px-3 py-2 text-sm text-tinta">
                    <span className="font-semibold">{dia(e.data)}</span> · {e.titulo}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}
