"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Eye,
  FileText,
  type LucideIcon,
  Mail,
  MessageSquareText,
  Plus,
  Save,
  Send,
  Undo2,
} from "lucide-react";
import { useRef, useState } from "react";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { contarSms, diaCurto, diaHora, semAcentos, textoSms } from "./formatos";
import { SeparadoresProcessos } from "./navegacao";
import {
  CANAIS_MODELO,
  type CanalModelo,
  type EstadoModelo,
  type Modelo,
  type ModeloDetalhe,
  type Pagina,
  type PreVisualizacao,
  type ProcessoResumo,
  type VariavelModelo,
} from "./tipos";
import {
  ACarregar,
  AREA_TEXTO,
  BotaoPainel,
  CAMPO,
  Campo,
  Chip,
  ErroEmLinha,
  Nota,
  paraErro,
  RotuloSeccao,
  usePedido,
} from "./ui";

/*
 * V2 · Processos · Modelos de resposta (I8xUA): lista por canal, editor com
 * variáveis, estados (rascunho → a rever → aprovado), versões,
 * pré-visualização com os dados de um processo e contagem de SMS.
 * Ler: 'processos'; escrever e aprovar: 'conhecimento'.
 */

const CANAL: Record<CanalModelo, { rotulo: string; grupo: string; icone: LucideIcon }> = {
  oficio: { rotulo: "Ofício", grupo: "Ofícios", icone: FileText },
  sms: { rotulo: "SMS", grupo: "SMS", icone: MessageSquareText },
  email: { rotulo: "Email", grupo: "Email", icone: Mail },
};
const SMS_MAX = 640;

function ChipEstado({ m }: { m: Pick<Modelo, "estado" | "aprovado_por_nome" | "aprovado_em"> }) {
  switch (m.estado) {
    case "aprovado":
      return (
        <Chip tom="verde" pequeno icone={BadgeCheck}>
          Aprovado{m.aprovado_por_nome ? ` por ${m.aprovado_por_nome}` : ""}
          {m.aprovado_em ? ` a ${diaCurto(m.aprovado_em)}` : ""}
        </Chip>
      );
    case "a_rever":
      return <Chip tom="ambar" pequeno>a rever</Chip>;
    case "rascunho":
      return <Chip tom="neutro" pequeno>rascunho</Chip>;
    default:
      return <Chip tom="neutro" pequeno>substituído</Chip>;
  }
}

/** As chavetas do corpo que não são variáveis conhecidas. */
function desconhecidas(corpo: string, nomes: string[]): string[] {
  const r = new Set<string>();
  for (const m of corpo.matchAll(/\{([^{}\n]*)\}/g)) {
    if (!nomes.includes(m[1])) r.add(m[0]);
  }
  return [...r];
}

function ContagemSms({ corpo }: { corpo: string }) {
  const c = contarSms(corpo);
  const s = contarSms(semAcentos(corpo));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip tom={c.segmentos > 1 ? "ambar" : "verde"} pequeno icone={Check}>
        {textoSms(c)}
        {c.codificacao === "ucs2" ? " por causa dos acentos" : ""}
      </Chip>
      {c.codificacao === "ucs2" && (
        <Chip tom="neutro" pequeno>Sem acentos: {s.segmentos} SMS</Chip>
      )}
      {corpo.length > SMS_MAX && (
        <Chip tom="erro" pequeno icone={AlertTriangle}>
          Máximo de {SMS_MAX} caracteres
        </Chip>
      )}
    </div>
  );
}

function PreVisualizar({ modeloId }: { modeloId: string }) {
  const { pedido } = useSessao();
  const processos = usePedido<Pagina<ProcessoResumo>>("/v1/painel/processos?limite=50");
  const [processoId, setProcessoId] = useState("");
  const [r, setR] = useState<PreVisualizacao | null>(null);
  const [aCarregar, setACarregar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function ver(id: string) {
    setProcessoId(id);
    setR(null);
    if (!id) return;
    setACarregar(true);
    setErro(null);
    try {
      setR(
        await pedido<PreVisualizacao>(`/v1/painel/modelos/${modeloId}/pre-visualizar`, {
          corpo: { processo_id: id },
        }),
      );
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setACarregar(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-linha bg-creme p-4">
      <Campo rotulo="Ver com os dados de um processo">
        {(id) => (
          <select id={id} value={processoId} onChange={(e) => ver(e.target.value)} className={CAMPO}>
            <option value="">Escolha um processo…</option>
            {(processos.dados?.itens ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.numero} · {p.assunto}
              </option>
            ))}
          </select>
        )}
      </Campo>
      {processos.erro && <ErroEmLinha erro={processos.erro} />}
      {aCarregar && <ACarregar texto="A preencher o modelo…" />}
      <ErroEmLinha erro={erro} />
      {r && (
        <>
          <div className="whitespace-pre-wrap rounded-[10px] bg-white px-5 py-4 font-serif text-sm leading-relaxed text-tinta">
            {r.texto}
          </div>
          {r.em_falta.length > 0 && (
            <p className="text-xs text-ambar">
              Sem valor neste processo: {r.em_falta.join(", ")} (fica «a completar»).
            </p>
          )}
          {r.sms && <ContagemSms corpo={r.texto} />}
        </>
      )}
    </div>
  );
}

function Editor({
  m,
  variaveis,
  podeEditar,
  onGuardado,
}: {
  m: ModeloDetalhe;
  variaveis: VariavelModelo[];
  podeEditar: boolean;
  onGuardado: (m: ModeloDetalhe, texto: string) => void;
}) {
  const { pedido } = useSessao();
  const area = useRef<HTMLTextAreaElement>(null);
  const [nome, setNome] = useState(m.nome);
  const [corpo, setCorpo] = useState(m.corpo);
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [verPrevia, setVerPrevia] = useState(false);

  const editavel = podeEditar && m.estado !== "substituido";
  const mudou = nome.trim() !== m.nome || corpo !== m.corpo;
  const invalidas = desconhecidas(corpo, variaveis.map((v) => v.nome));
  const Icone = CANAL[m.canal].icone;

  function inserir(marcador: string) {
    const el = area.current;
    const ini = el?.selectionStart ?? corpo.length;
    const fim = el?.selectionEnd ?? corpo.length;
    const novo = corpo.slice(0, ini) + marcador + corpo.slice(fim);
    setCorpo(novo);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + marcador.length, ini + marcador.length);
    });
  }

  async function guardar(estado?: EstadoModelo) {
    setAGuardar(true);
    setErro(null);
    const corpoPedido: Record<string, unknown> = {};
    if (nome.trim() !== m.nome) corpoPedido.nome = nome.trim();
    if (corpo !== m.corpo) corpoPedido.corpo = corpo;
    if (estado) corpoPedido.estado = estado;
    try {
      const r = await pedido<ModeloDetalhe>(`/v1/painel/modelos/${m.id}`, {
        metodo: "PATCH",
        corpo: corpoPedido,
      });
      onGuardado(
        r,
        r.nova_versao
          ? `Criada a versão ${r.versao} em rascunho. A aprovada continua em uso até aprovar esta.`
          : estado === "aprovado"
            ? "Modelo aprovado: os rascunhos passam a usá-lo."
            : estado === "a_rever"
              ? "Enviado para aprovação."
              : estado === "rascunho"
                ? "Voltou a rascunho."
                : "Alterações guardadas.",
      );
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGuardar(false);
    }
  }

  const transicao = (e: EstadoModelo) => {
    if (!editavel || !m.transicoes.includes(e)) return null;
    const conf = {
      a_rever: { rotulo: "Pedir aprovação", icone: Send, variante: "tinta" as const },
      aprovado: { rotulo: "Aprovar", icone: BadgeCheck, variante: "principal" as const },
      rascunho: { rotulo: "Voltar a rascunho", icone: Undo2, variante: "texto" as const },
      substituido: null,
    }[e];
    if (!conf) return null;
    return (
      <BotaoPainel
        key={e}
        pequeno
        variante={conf.variante}
        icone={conf.icone}
        disabled={aGuardar || invalidas.length > 0}
        onClick={() => guardar(e)}
      >
        {conf.rotulo}
      </BotaoPainel>
    );
  };

  return (
    <section aria-labelledby="titulo-modelo" className="flex min-w-0 flex-1 flex-col gap-4 rounded-2xl border border-linha bg-papel p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {editavel ? (
            <>
              <h2 id="titulo-modelo" className="sr-only">
                {m.nome}
              </h2>
              <label htmlFor="nome-modelo" className="sr-only">Nome do modelo</label>
              <input
                id="nome-modelo"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={200}
                className="w-full rounded-md bg-transparent font-display text-[22px] font-bold text-tinta hover:bg-creme focus:bg-creme"
              />
            </>
          ) : (
            <h2 id="titulo-modelo" className="font-display text-[22px] font-bold text-tinta">
              {m.nome}
            </h2>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Chip tom="neutro" pequeno icone={Icone}>{CANAL[m.canal].rotulo}</Chip>
            <ChipEstado m={m} />
            <Chip tom="papel" pequeno>versão {m.versao}</Chip>
          </div>
        </div>
      </div>

      {editavel && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-tinta-3">Inserir:</span>
          {variaveis.map((v) => (
            <button
              key={v.nome}
              type="button"
              onClick={() => inserir(v.marcador)}
              title={v.descricao}
              className="rounded-md bg-terracota-suave px-2 py-[3px] font-mono text-[11px] font-semibold text-terracota-escuro hover:bg-terracota-suave/70"
            >
              {`{${v.rotulo}}`}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="corpo-modelo" className="sr-only">Texto do modelo</label>
        <textarea
          id="corpo-modelo"
          ref={area}
          value={corpo}
          onChange={(e) => setCorpo(e.target.value)}
          readOnly={!editavel}
          rows={m.canal === "sms" ? 6 : 14}
          maxLength={20000}
          className="w-full rounded-xl border border-linha bg-white px-6 py-5 font-serif text-sm leading-relaxed text-tinta read-only:bg-white/70"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {invalidas.length > 0 ? (
          invalidas.map((x) => (
            <Chip key={x} tom="erro" pequeno icone={AlertTriangle}>
              {x} não é uma variável
            </Chip>
          ))
        ) : (
          <Chip tom="verde" pequeno icone={Check}>
            Variáveis certas
          </Chip>
        )}
        {m.canal === "sms" && <ContagemSms corpo={corpo} />}
      </div>

      {m.estado === "aprovado" && editavel && mudou && (
        <p className="text-xs text-ambar">
          Este modelo está aprovado: guardar cria a versão {m.versao + 1} em rascunho.
        </p>
      )}

      <ErroEmLinha erro={erro} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-tinta-3">
          Versão {m.versao} · atualizada a {diaHora(m.atualizado_em)}
          {m.atualizado_por_nome ? ` por ${m.atualizado_por_nome}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <BotaoPainel
            pequeno
            variante="texto"
            icone={Eye}
            aria-expanded={verPrevia}
            onClick={() => setVerPrevia((v) => !v)}
          >
            Ver com dados reais
          </BotaoPainel>
          {editavel && mudou && (
            <BotaoPainel pequeno icone={Save} disabled={aGuardar || invalidas.length > 0} onClick={() => guardar()}>
              {aGuardar ? "A guardar…" : "Guardar"}
            </BotaoPainel>
          )}
          {transicao("rascunho")}
          {transicao("a_rever")}
          {transicao("aprovado")}
        </div>
      </div>

      {verPrevia && <PreVisualizar modeloId={m.id} />}

      {m.versoes.length > 1 && (
        <div className="flex flex-col gap-1.5 border-t border-linha pt-3">
          <RotuloSeccao as="h3">Versões</RotuloSeccao>
          <ul className="flex flex-col gap-1 text-xs text-tinta-2">
            {m.versoes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-tinta">v{v.versao}</span>
                <ChipEstado m={{ estado: v.estado, aprovado_por_nome: v.aprovado_por_nome, aprovado_em: v.aprovado_em }} />
                <span>
                  criada a {diaCurto(v.criado_em)}
                  {v.criado_por_nome ? ` por ${v.criado_por_nome}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NovoModelo({
  variaveis,
  onCriado,
  onCancelar,
}: {
  variaveis: VariavelModelo[];
  onCriado: (m: ModeloDetalhe) => void;
  onCancelar: () => void;
}) {
  const { pedido } = useSessao();
  const [canal, setCanal] = useState<CanalModelo>("oficio");
  const [nome, setNome] = useState("");
  const [corpo, setCorpo] = useState("");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const invalidas = desconhecidas(corpo, variaveis.map((v) => v.nome));

  async function criar(ev: React.FormEvent) {
    ev.preventDefault();
    setAGuardar(true);
    setErro(null);
    try {
      onCriado(
        await pedido<ModeloDetalhe>("/v1/painel/modelos", {
          corpo: { canal, nome: nome.trim(), corpo },
        }),
      );
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <form onSubmit={criar} className="flex min-w-0 flex-1 flex-col gap-4 rounded-2xl border border-linha bg-papel p-6">
      <h2 className="font-display text-[22px] font-bold text-tinta">Novo modelo</h2>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Campo rotulo="Canal">
          {(id) => (
            <select id={id} value={canal} onChange={(e) => setCanal(e.target.value as CanalModelo)} className={CAMPO}>
              {CANAIS_MODELO.map((c) => (
                <option key={c} value={c}>{CANAL[c].rotulo}</option>
              ))}
            </select>
          )}
        </Campo>
        <Campo rotulo="Nome">
          {(id) => (
            <input id={id} value={nome} onChange={(e) => setNome(e.target.value)} minLength={3} maxLength={200} required className={CAMPO} />
          )}
        </Campo>
      </div>
      <Campo
        rotulo="Texto"
        ajuda={`Variáveis: ${variaveis.map((v) => v.marcador).join(" ")}`}
      >
        {(id) => (
          <textarea
            id={id}
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            rows={10}
            required
            className={`${AREA_TEXTO} font-serif text-sm`}
          />
        )}
      </Campo>
      {invalidas.length > 0 && (
        <p className="text-xs text-terracota-escuro">Não são variáveis: {invalidas.join(", ")}</p>
      )}
      {canal === "sms" && corpo && <ContagemSms corpo={corpo} />}
      <ErroEmLinha erro={erro} />
      <div className="flex gap-2">
        <BotaoPainel variante="texto" onClick={onCancelar}>Cancelar</BotaoPainel>
        <BotaoPainel variante="principal" type="submit" icone={Plus} disabled={aGuardar || invalidas.length > 0}>
          {aGuardar ? "A criar…" : "Criar em rascunho"}
        </BotaoPainel>
      </div>
    </form>
  );
}

export function ModelosResposta() {
  const { pode } = useSessao();
  const ler = pode("processos");
  const escrever = pode("conhecimento");
  const lista = usePedido<Pagina<Modelo>>(ler ? "/v1/painel/modelos?limite=200" : null);
  const vars = usePedido<{ itens: VariavelModelo[] }>(ler ? "/v1/painel/modelos/variaveis" : null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const itens = lista.dados?.itens ?? [];
  const idAtual = escolhido ?? itens[0]?.id ?? null;
  const detalhe = usePedido<ModeloDetalhe>(idAtual && !novo ? `/v1/painel/modelos/${idAtual}` : null);
  const aprovados = itens.filter((m) => m.estado === "aprovado").length;

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Processos", "Modelos de resposta"]}
        titulo="Processos"
        descricao="Como a câmara trata cada tipo de pedido."
        acoes={<SeparadoresProcessos atual="/painel/processos/modelos" />}
      />
      {!ler ? (
        <Aviso titulo="Sem acesso aos modelos de resposta." />
      ) : lista.erro && !lista.dados ? (
        <Aviso titulo="Não foi possível carregar os modelos." tom="erro">
          {lista.erro.message}
        </Aviso>
      ) : !lista.dados ? (
        <ACarregar className="px-10" />
      ) : (
        <div className="flex flex-col gap-4 px-10">
          {mensagem && (
            <Nota onFechar={() => setMensagem(null)}>{mensagem}</Nota>
          )}
          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <nav aria-label="Modelos de resposta" className="w-full shrink-0 overflow-hidden rounded-2xl border border-linha bg-papel lg:w-[340px]">
              <div className="flex items-center justify-between px-4 py-3.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                  {aprovados} {aprovados === 1 ? "modelo aprovado" : "modelos aprovados"}
                </p>
                {escrever && (
                  <button
                    type="button"
                    onClick={() => setNovo(true)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-terracota-escuro hover:underline"
                  >
                    <Plus className="size-[13px]" aria-hidden />
                    Novo
                  </button>
                )}
              </div>
              {itens.length === 0 && (
                <p className="px-4 pb-4 text-[13px] text-tinta-3">
                  Ainda não há modelos.{escrever ? " Crie o primeiro." : ""}
                </p>
              )}
              {CANAIS_MODELO.map((c) => {
                const doCanal = itens.filter((m) => m.canal === c);
                if (!doCanal.length) return null;
                const Icone = CANAL[c].icone;
                return (
                  <div key={c}>
                    <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
                      {CANAL[c].grupo}
                    </p>
                    <ul>
                      {doCanal.map((m) => {
                        const ativo = !novo && m.id === idAtual;
                        return (
                          <li key={m.id}>
                            <button
                              type="button"
                              aria-current={ativo ? "true" : undefined}
                              onClick={() => {
                                setNovo(false);
                                setEscolhido(m.id);
                              }}
                              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-creme ${ativo ? "bg-creme" : ""}`}
                            >
                              <Icone className="size-[15px] shrink-0 text-tinta-2" aria-hidden />
                              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-tinta">
                                {m.nome}
                              </span>
                              {m.estado !== "aprovado" && <ChipEstado m={m} />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </nav>

            {novo ? (
              <NovoModelo
                variaveis={vars.dados?.itens ?? []}
                onCancelar={() => setNovo(false)}
                onCriado={(m) => {
                  setNovo(false);
                  setEscolhido(m.id);
                  setMensagem("Modelo criado em rascunho.");
                  lista.recarregar();
                }}
              />
            ) : detalhe.erro && !detalhe.dados ? (
              <div className="flex-1"><ErroEmLinha erro={detalhe.erro} /></div>
            ) : detalhe.dados && detalhe.dados.id === idAtual ? (
              <Editor
                key={`${detalhe.dados.id}-${detalhe.dados.atualizado_em}`}
                m={detalhe.dados}
                variaveis={vars.dados?.itens ?? []}
                podeEditar={escrever}
                onGuardado={(m, texto) => {
                  setMensagem(texto);
                  setEscolhido(m.id);
                  detalhe.definir(m);
                  lista.recarregar();
                }}
              />
            ) : idAtual ? (
              <ACarregar className="flex-1" />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
