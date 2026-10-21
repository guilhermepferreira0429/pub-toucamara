"use client";

import {
  BadgeCheck,
  Building2,
  Info,
  Plus,
  Save,
  Sparkles,
  Timer,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { ServicosEquipa } from "@/components/atendimento/equipa";
import { Dialogo } from "@/components/conhecimento/comum";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { SeparadoresProcessos } from "./navegacao";
import type { DocumentoTipo, TipoProcesso } from "./tipos";
import { ACarregar, CAMPO, Chip, ErroEmLinha, RotuloSeccao, usePedido } from "./ui";

/*
 * V2 · Processos · Tipos e documentos (mxkWE): como a câmara trata cada tipo
 * de pedido. Quem gere o agente (chefia) muda prazos, serviço, a frase do
 * agente e os documentos exigidos, com as verificações que fazemos sozinhos.
 */

type Verificacao =
  | { tipo: "validade"; meses?: number; dias?: number }
  | { tipo: "assinatura" }
  | { tipo: "nif_requerente" };

function lerVerificacoes(v: unknown): Verificacao[] {
  return Array.isArray(v) ? (v as Verificacao[]) : [];
}

const TIPO_CAMPO: Record<string, string> = {
  texto: "texto",
  numero: "número",
  data: "data",
  sim_nao: "sim / não",
  morada: "morada",
  nif: "NIF",
  escolha: "escolha",
};

function verificacoes(d: DocumentoTipo): string[] {
  const r: string[] = [];
  if (d.gerado_pelo_sistema) r.push("gerado pelo sistema");
  if (Array.isArray(d.verificacoes)) {
    for (const v of d.verificacoes as { tipo?: string; meses?: number; dias?: number }[]) {
      if (v?.tipo === "validade") {
        if (v.meses) r.push(`validade de ${v.meses} ${v.meses === 1 ? "mês" : "meses"}`);
        else if (v.dias) r.push(`validade de ${v.dias} dias`);
      } else if (v?.tipo === "assinatura") r.push("assinado");
      else if (v?.tipo === "nif_requerente") r.push("NIF do requerente");
    }
  }
  return r;
}

function useEditar(t: TipoProcesso, onMudou: (t: TipoProcesso) => void) {
  const { pedido } = useSessao();
  const [erro, setErro] = useState<string | null>(null);
  const [aCorrer, setACorrer] = useState(false);
  async function correr(caminho: string, metodo: "POST" | "PATCH" | "DELETE", corpo?: unknown) {
    setACorrer(true);
    setErro(null);
    try {
      onMudou(await pedido<TipoProcesso>(`/v1/painel/tipos-processo/${t.id}${caminho}`, { metodo, corpo }));
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Ocorreu um erro.");
      return false;
    } finally {
      setACorrer(false);
    }
  }
  return { erro, aCorrer, correr };
}

function DadosEditaveis({
  t,
  servicos,
  onMudou,
}: {
  t: TipoProcesso;
  servicos: { id: string; nome: string }[];
  onMudou: (t: TipoProcesso) => void;
}) {
  const [prazo, setPrazo] = useState(String(t.prazo_dias_uteis));
  const [servico, setServico] = useState(t.servico_id ?? "");
  const [frase, setFrase] = useState(t.frase_do_agente ?? "");
  const e = useEditar(t, onMudou);
  const mudou =
    Number(prazo) !== t.prazo_dias_uteis ||
    (servico || null) !== t.servico_id ||
    (frase.trim() || null) !== t.frase_do_agente;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-tinta-2">Prazo de apreciação (dias úteis)</span>
          <input type="number" min={1} max={365} value={prazo} onChange={(x) => setPrazo(x.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-tinta-2">Serviço</span>
          <select value={servico} onChange={(x) => setServico(x.target.value)} className={CAMPO}>
            <option value="">Sem serviço definido</option>
            {servicos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-tinta-2">O que o agente diz ao munícipe</span>
        <textarea rows={2} value={frase} onChange={(x) => setFrase(x.target.value)} className={`${CAMPO} h-auto py-2`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          tamanho="pequeno"
          icone={Save}
          disabled={!mudou || e.aCorrer || !(Number(prazo) >= 1)}
          onClick={() =>
            e.correr("", "PATCH", {
              prazo_dias_uteis: Number(prazo),
              servico_id: servico || null,
              frase_do_agente: frase.trim() || null,
            })
          }
        >
          Guardar
        </Botao>
        <Botao
          tamanho="pequeno"
          variante="discreto"
          disabled={e.aCorrer}
          onClick={() => e.correr("", "PATCH", { ativo: !t.ativo })}
        >
          {t.ativo ? "Desativar (o agente deixa de o propor)" : "Ativar"}
        </Botao>
      </div>
      <ErroEmLinha erro={e.erro} />
    </div>
  );
}

function LinhaDocumentoEditavel({
  t,
  d,
  onMudou,
}: {
  t: TipoProcesso;
  d: DocumentoTipo;
  onMudou: (t: TipoProcesso) => void;
}) {
  const e = useEditar(t, onMudou);
  const v = lerVerificacoes(d.verificacoes);
  const validade = v.find((x) => x.tipo === "validade") as { meses?: number } | undefined;
  const tem = (tipo: Verificacao["tipo"]) => v.some((x) => x.tipo === tipo);
  const mudar = (nova: Verificacao[]) => e.correr(`/documentos/${d.id}`, "PATCH", { verificacoes: nova });
  const alternar = (tipo: "assinatura" | "nif_requerente") =>
    mudar(tem(tipo) ? v.filter((x) => x.tipo !== tipo) : [...v, { tipo }]);
  return (
    <tr className="border-t border-linha align-top">
      <td className="px-3.5 py-2.5 text-[13px] font-semibold text-tinta">
        {d.nome}
        <ErroEmLinha erro={e.erro} />
      </td>
      <td className="px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <label className="flex items-center gap-1 rounded-full border border-linha px-2 py-1">
            validade
            <input
              type="number"
              min={0}
              max={60}
              defaultValue={validade?.meses ?? ""}
              placeholder="—"
              aria-label="Validade em meses"
              className="w-10 bg-transparent text-center outline-none"
              onBlur={(x) => {
                const n = Number(x.target.value);
                const resto = v.filter((y) => y.tipo !== "validade");
                if ((validade?.meses ?? 0) === (n || 0)) return;
                void mudar(n > 0 ? [...resto, { tipo: "validade", meses: n }] : resto);
              }}
            />
            meses
          </label>
          {(["assinatura", "nif_requerente"] as const).map((tipo) => (
            <button
              key={tipo}
              type="button"
              disabled={e.aCorrer}
              aria-pressed={tem(tipo)}
              onClick={() => alternar(tipo)}
              className={`rounded-full border px-2 py-1 font-semibold ${
                tem(tipo) ? "border-verde bg-verde-suave text-verde" : "border-linha text-tinta-3"
              }`}
            >
              {tipo === "assinatura" ? "assinado" : "NIF do requerente"}
            </button>
          ))}
        </div>
      </td>
      <td className="px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={d.obrigatorio}
            disabled={e.aCorrer}
            aria-label={`${d.nome} obrigatório`}
            onChange={(x) => void e.correr(`/documentos/${d.id}`, "PATCH", { obrigatorio: x.target.checked })}
            className="size-4 accent-terracota"
          />
          <button
            type="button"
            aria-label={`Remover ${d.nome}`}
            disabled={e.aCorrer}
            onClick={() => {
              if (window.confirm(`Remover "${d.nome}" dos documentos exigidos?`)) {
                void e.correr(`/documentos/${d.id}`, "DELETE");
              }
            }}
            className="rounded-md p-1 text-tinta-3 hover:bg-creme hover:text-terracota-escuro"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function NovoDocumento({ t, onMudou }: { t: TipoProcesso; onMudou: (t: TipoProcesso) => void }) {
  const [nome, setNome] = useState("");
  const e = useEditar(t, onMudou);
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t border-linha px-3.5 py-2.5"
      onSubmit={async (x) => {
        x.preventDefault();
        if (await e.correr("/documentos", "POST", { nome: nome.trim() })) setNome("");
      }}
    >
      <input
        value={nome}
        onChange={(x) => setNome(x.target.value)}
        placeholder="Novo documento exigido (ex.: Certidão do registo predial)"
        className={`${CAMPO} min-w-[260px] flex-1`}
      />
      <Botao type="submit" tamanho="pequeno" icone={Plus} disabled={e.aCorrer || nome.trim().length < 3}>
        Acrescentar
      </Botao>
      <ErroEmLinha erro={e.erro} />
    </form>
  );
}

function Detalhe({
  t,
  podeEditar,
  servicos,
  onMudou,
}: {
  t: TipoProcesso;
  podeEditar: boolean;
  servicos: { id: string; nome: string }[];
  onMudou: (t: TipoProcesso) => void;
}) {
  const docs = [...t.documentos].sort((a, b) => a.ordem - b.ordem);
  return (
    <section
      aria-labelledby="titulo-tipo"
      className="flex min-w-0 flex-1 flex-col gap-[18px] rounded-2xl border border-linha bg-papel p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="titulo-tipo" className="font-display text-[22px] font-bold text-tinta">
          {t.nome}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <Chip tom="neutro" pequeno>
            Código {t.codigo}
          </Chip>
          <Chip tom="neutro" pequeno>
            Usado em {t.usado_este_ano} {t.usado_este_ano === 1 ? "processo" : "processos"} este ano
          </Chip>
          {t.ativo ? (
            <Chip tom="verde" pequeno icone={BadgeCheck}>
              Ativo
            </Chip>
          ) : (
            <Chip tom="ambar" pequeno>
              Inativo · o agente não o propõe
            </Chip>
          )}
        </div>
      </div>

      {podeEditar ? (
        <DadosEditaveis key={t.id} t={t} servicos={servicos} onMudou={onMudou} />
      ) : (
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <dt className="text-xs font-semibold text-tinta-2">Prazo de apreciação</dt>
          <dd className="flex h-10 items-center gap-2 rounded-[10px] bg-creme px-3 text-[13px] font-medium text-tinta">
            <Timer className="size-3.5 text-tinta-3" aria-hidden />
            {t.prazo_dias_uteis} dias úteis
          </dd>
        </div>
        <div className="flex flex-col gap-1.5">
          <dt className="text-xs font-semibold text-tinta-2">Serviço</dt>
          <dd className="flex h-10 items-center gap-2 rounded-[10px] bg-creme px-3 text-[13px] font-medium text-tinta">
            <Building2 className="size-3.5 text-tinta-3" aria-hidden />
            {t.servico ?? "Sem serviço definido"}
          </dd>
        </div>
      </dl>
      )}

      <div className="overflow-hidden rounded-xl border border-linha">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Documentos exigidos</caption>
          <thead>
            <tr className="bg-creme">
              <th scope="col" className="px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                Documentos exigidos
              </th>
              <th scope="col" className="px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                Verificamos sozinhos
              </th>
              <th scope="col" className="w-[110px] px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                Obrigatório
              </th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3.5 py-3 text-[13px] text-tinta-3">
                  Este tipo não exige documentos.
                </td>
              </tr>
            ) : podeEditar ? (
              docs.map((d) => <LinhaDocumentoEditavel key={d.id} t={t} d={d} onMudou={onMudou} />)
            ) : (
              docs.map((d) => (
                <tr key={d.id} className="border-t border-linha">
                  <td className="px-3.5 py-2.5 text-[13px] font-semibold text-tinta">{d.nome}</td>
                  <td className="px-3.5 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      {verificacoes(d).map((v) => (
                        <Chip key={v} tom="verde" pequeno icone={Sparkles}>
                          {v}
                        </Chip>
                      ))}
                      {verificacoes(d).length === 0 && (
                        <span className="text-xs text-tinta-3">só leitura do documento</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    {d.obrigatorio ? (
                      <Chip tom="verde" pequeno>Sim</Chip>
                    ) : (
                      <Chip tom="neutro" pequeno>Não</Chip>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {podeEditar && <NovoDocumento t={t} onMudou={onMudou} />}
      </div>

      {t.formulario.length > 0 && (
        <div className="flex flex-col gap-2">
          <RotuloSeccao as="h3">Requerimento · o que o agente pergunta</RotuloSeccao>
          <ul className="flex flex-col divide-y divide-linha rounded-xl border border-linha">
            {t.formulario.map((c) => (
              <li key={c.chave} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5">
                <span className="text-[13px] font-semibold text-tinta">{c.rotulo}</span>
                <span className="text-xs text-tinta-3">
                  {TIPO_CAMPO[c.tipo] ?? c.tipo}
                  {c.obrigatorio ? " · obrigatório" : " · opcional"}
                  {c.opcoes?.length ? ` · ${c.opcoes.join(", ")}` : ""}
                </span>
                {c.pergunta_do_agente && (
                  <span className="basis-full text-xs italic text-tinta-2">“{c.pergunta_do_agente}”</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!podeEditar && (
      <div className="flex flex-col gap-2 rounded-xl bg-creme-2 p-3.5">
        <RotuloSeccao as="h3">O que o agente diz ao munícipe</RotuloSeccao>
        <p className="text-[13px] text-tinta">
          {t.frase_do_agente ? `“${t.frase_do_agente}”` : "Sem frase definida: o agente explica a partir dos documentos exigidos."}
        </p>
      </div>
      )}
    </section>
  );
}

export function TiposProcesso() {
  const { pode } = useSessao();
  const r = usePedido<{ itens: TipoProcesso[] }>(
    pode("processos") ? "/v1/painel/tipos-processo" : null,
  );
  const equipa = usePedido<ServicosEquipa>(pode("agente") ? "/v1/painel/servicos" : null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const itens = r.dados?.itens ?? [];
  const atual = itens.find((t) => t.id === escolhido) ?? itens[0] ?? null;
  const podeEditar = pode("agente");
  const servicos = (equipa.dados?.itens ?? []).map((x) => ({ id: x.id, nome: x.nome }));
  const trocar = (t: TipoProcesso) => {
    const lista = itens.some((x) => x.id === t.id) ? itens.map((x) => (x.id === t.id ? t : x)) : [...itens, t];
    r.definir({ itens: lista });
    setEscolhido(t.id);
  };

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Processos", "Tipos de processo"]}
        titulo="Processos"
        descricao="Como a câmara trata cada tipo de pedido."
        acoes={
          <>
            {podeEditar && (
              <Botao tamanho="pequeno" icone={Plus} onClick={() => setNovo(true)}>
                Novo tipo
              </Botao>
            )}
            <SeparadoresProcessos atual="/painel/processos/tipos" />
          </>
        }
      />
      <Dialogo titulo="Novo tipo de processo" aberto={novo} onFechar={() => setNovo(false)}>
        <NovoTipo
          servicos={servicos}
          onCriado={(t) => {
            setNovo(false);
            trocar(t);
          }}
        />
      </Dialogo>
      {!pode("processos") ? (
        <Aviso titulo="Sem acesso aos processos." />
      ) : r.erro && !r.dados ? (
        <Aviso titulo="Não foi possível carregar os tipos de processo." tom="erro">
          {r.erro.message}
        </Aviso>
      ) : !r.dados ? (
        <ACarregar className="px-10" />
      ) : itens.length === 0 ? (
        <Aviso titulo="Ainda não há tipos de processo.">
          A equipa Tou, Câmara? configura-os com a câmara.
        </Aviso>
      ) : (
        <div className="flex flex-col gap-4 px-10">
          <p className="flex items-center gap-2 text-xs text-tinta-3">
            <Info className="size-3.5" aria-hidden />
            {podeEditar
              ? "As mudanças valem logo: o agente pede os documentos novos e verifica-os sozinho. O formulário do requerimento é configurado pela equipa Tou, Câmara?."
              : "Só a chefia muda prazos e documentos. O formulário é configurado pela equipa Tou, Câmara?."}
          </p>
          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <nav
              aria-label="Tipos de processo"
              className="w-full shrink-0 overflow-hidden rounded-2xl border border-linha bg-papel lg:w-[340px]"
            >
              <p className="px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                {itens.length} {itens.length === 1 ? "tipo" : "tipos"}
              </p>
              <ul>
                {itens.map((t) => {
                  const ativo = t.id === atual?.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setEscolhido(t.id)}
                        aria-current={ativo ? "true" : undefined}
                        className={`flex w-full flex-col gap-[3px] px-4 py-3 text-left hover:bg-creme ${
                          ativo ? "bg-creme" : ""
                        } ${t.ativo ? "" : "opacity-60"}`}
                      >
                        <span className="text-sm font-semibold text-tinta">
                          {t.codigo} · {t.nome}
                        </span>
                        <span className="text-xs text-tinta-3">
                          {t.documentos.length}{" "}
                          {t.documentos.length === 1 ? "documento" : "documentos"} ·{" "}
                          {t.prazo_dias_uteis} dias úteis
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {atual && <Detalhe t={atual} podeEditar={podeEditar} servicos={servicos} onMudou={trocar} />}
          </div>
        </div>
      )}
    </div>
  );
}

function NovoTipo({
  servicos,
  onCriado,
}: {
  servicos: { id: string; nome: string }[];
  onCriado: (t: TipoProcesso) => void;
}) {
  const { pedido } = useSessao();
  const [f, setF] = useState({ codigo: "", nome: "", prazo: "20", servico: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [aCorrer, setACorrer] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setACorrer(true);
        setErro(null);
        try {
          onCriado(
            await pedido<TipoProcesso>("/v1/painel/tipos-processo", {
              corpo: {
                codigo: f.codigo.trim(),
                nome: f.nome.trim(),
                prazo_dias_uteis: Number(f.prazo),
                servico_id: f.servico || null,
              },
            }),
          );
        } catch (x) {
          setErro(x instanceof Error ? x.message : "Ocorreu um erro.");
        } finally {
          setACorrer(false);
        }
      }}
    >
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-tinta-2">Código</span>
          <input
            value={f.codigo}
            maxLength={6}
            placeholder="OVP"
            onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase() })}
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-tinta-2">Nome</span>
          <input
            value={f.nome}
            placeholder="Ocupação da via pública"
            onChange={(e) => setF({ ...f, nome: e.target.value })}
            className={CAMPO}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-tinta-2">Prazo (dias úteis)</span>
          <input type="number" min={1} max={365} value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-tinta-2">Serviço</span>
          <select value={f.servico} onChange={(e) => setF({ ...f, servico: e.target.value })} className={CAMPO}>
            <option value="">Sem serviço</option>
            {servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErroEmLinha erro={erro} />
      <div className="flex justify-end">
        <Botao
          type="submit"
          icone={Plus}
          disabled={aCorrer || !/^[A-Z]{2,6}$/.test(f.codigo) || f.nome.trim().length < 3 || !(Number(f.prazo) >= 1)}
        >
          Criar tipo
        </Botao>
      </div>
    </form>
  );
}
