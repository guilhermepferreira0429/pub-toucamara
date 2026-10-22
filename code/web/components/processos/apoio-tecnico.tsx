"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock4,
  ExternalLink,
  FileText,
  PenLine,
  Plus,
  RefreshCw,
  type LucideIcon,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Pilula } from "@/components/conhecimento/comum";
import { Aviso } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { DialogoAssinar } from "./dialogo-assinar";
import { FolhaRascunho } from "./folha-rascunho";
import { diaCurto, diaHora } from "./formatos";
import { NovoRascunho } from "./novo-rascunho";
import {
  TIPO_RASCUNHO_ROTULO,
  TIPOS_RASCUNHO,
  type ProcessoDetalhe,
  type Rascunho,
  type Regulamento,
  type ResumoProcesso,
  type TipoRascunho,
  type TrechoDestacado,
  type PerfilVerificacao,
  type Verificacoes,
} from "./tipos";
import {
  ACarregar,
  BotaoPainel,
  ErroEmLinha,
  Nota,
  paraErro,
  RotuloSeccao,
  Segmentado,
  usePedido,
} from "./ui";
import { BlocoVerificacoes, type EstadoVerificacoes } from "./verificacoes";

/*
 * V2 · Apoio ao técnico (tjX6g, uc2Hf, IbPF4, FR3XT): à esquerda as
 * verificações automáticas, o regulamento com as frases destacadas e o
 * resumo do processo numa página; à direita o rascunho (parecer técnico,
 * ofício, pedido de elementos, SMS) para rever, editar, aprovar com
 * assinatura simulada ou descartar. "Gerar outra vez" refaz as verificações
 * e o rascunho aberto.
 */

function Linha({
  icone: Icone,
  tom,
  titulo,
  texto,
}: {
  icone: LucideIcon;
  tom: "verde" | "ambar" | "neutro";
  titulo: string;
  texto: React.ReactNode;
}) {
  const fundo =
    tom === "verde" ? "bg-verde-suave text-verde" : tom === "ambar" ? "bg-ambar-suave text-ambar" : "bg-creme-2 text-tinta-2";
  return (
    <li className="flex gap-3 py-3">
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${fundo}`}>
        <Icone className="size-[13px]" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[13px] font-semibold text-tinta">{titulo}</p>
        <div className={`text-xs ${tom === "ambar" ? "text-ambar" : "text-tinta-2"}`}>{texto}</div>
      </div>
    </li>
  );
}

function Resumo({ processoId }: { processoId: string }) {
  const { pedido } = useSessao();
  const r = usePedido<ResumoProcesso>(`/v1/painel/processos/${processoId}/resumo`);
  const [aAtualizar, setAAtualizar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function atualizar() {
    setAAtualizar(true);
    setErro(null);
    try {
      r.definir(
        await pedido<ResumoProcesso>(
          `/v1/painel/processos/${processoId}/resumo?atualizar=true`,
        ),
      );
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAAtualizar(false);
    }
  }

  const d = r.dados;
  const nadaEmFalta = d ? /^nada em falta/i.test(d.o_que_falta) : false;
  return (
    <section aria-labelledby="titulo-resumo" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <RotuloSeccao>
          <span id="titulo-resumo">Resumo do processo</span>
        </RotuloSeccao>
        {d && (
          <button
            type="button"
            onClick={atualizar}
            disabled={aAtualizar}
            className="inline-flex items-center gap-1 text-xs font-semibold text-terracota-escuro hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${aAtualizar ? "animate-spin" : ""}`} aria-hidden />
            {aAtualizar ? "A gerar…" : "Gerar outra vez"}
          </button>
        )}
      </div>
      {r.erro && !d ? (
        <p className="rounded-xl bg-creme-2 p-3 text-[13px] text-tinta-2">
          {r.erro.codigo === "ia_indisponivel"
            ? "O resumo precisa da IA, que não está disponível agora."
            : r.erro.message}
        </p>
      ) : !d ? (
        <ACarregar className="py-3" texto="A resumir o processo…" />
      ) : (
        <>
          <p className="py-2 text-[13px] leading-relaxed text-tinta">{d.o_caso}</p>
          <ul className="flex flex-col divide-y divide-linha">
            <Linha icone={UserRound} tom="neutro" titulo="Requerente" texto={d.requerente} />
            <Linha icone={Check} tom="verde" titulo="O que já há" texto={d.o_que_ja_ha} />
            <Linha
              icone={nadaEmFalta ? Check : AlertTriangle}
              tom={nadaEmFalta ? "verde" : "ambar"}
              titulo="O que falta"
              texto={d.o_que_falta}
            />
            <Linha
              icone={Clock4}
              tom={d.prazos.proximo?.atrasado ? "ambar" : "neutro"}
              titulo={
                d.prazos.proximo
                  ? `Próximo prazo: ${diaCurto(d.prazos.proximo.data)} (${
                      d.prazos.proximo.de_quem === "camara" ? "câmara" : "munícipe"
                    })`
                  : "Prazos"
              }
              texto={d.prazos.texto}
            />
            {d.pontos_de_atencao.map((t) => (
              <Linha key={t} icone={AlertTriangle} tom="ambar" titulo="Ponto de atenção" texto={t} />
            ))}
            <Linha
              icone={ArrowRight}
              tom="neutro"
              titulo="Próximo passo sugerido"
              texto={d.proximo_passo_sugerido}
            />
          </ul>
          <p className="text-[11px] text-tinta-3">
            Gerado pela IA a {diaHora(d.gerado_em)}
            {d.em_cache ? " · o processo não mudou desde então" : ""}. Confirme
            no processo antes de decidir.
          </p>
        </>
      )}
      <ErroEmLinha erro={erro} />
    </section>
  );
}

/** O texto do trecho com as frases que se aplicam a este caso pintadas. */
function TextoDestacado({ t }: { t: TrechoDestacado }) {
  const marcas = [...t.destaques]
    .filter((d) => d.fim > d.inicio)
    .sort((a, b) => a.inicio - b.inicio);
  const partes: React.ReactNode[] = [];
  let pos = 0;
  marcas.forEach((m, i) => {
    const inicio = Math.max(m.inicio, pos);
    if (inicio > pos) partes.push(t.texto.slice(pos, inicio));
    if (m.fim > inicio) {
      partes.push(
        <mark key={i} className="rounded-sm bg-ambar-suave px-0.5 text-tinta">
          {t.texto.slice(inicio, m.fim)}
        </mark>,
      );
    }
    pos = Math.max(pos, m.fim);
  });
  if (pos < t.texto.length) partes.push(t.texto.slice(pos));
  return <>{partes}</>;
}

function Regras({ processoId }: { processoId: string }) {
  const { pedido } = useSessao();
  const r = usePedido<Regulamento>(`/v1/painel/processos/${processoId}/regulamento`);
  const [aAtualizar, setAAtualizar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function atualizar() {
    setAAtualizar(true);
    setErro(null);
    try {
      r.definir(
        await pedido<Regulamento>(
          `/v1/painel/processos/${processoId}/regulamento?atualizar=true`,
        ),
      );
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAAtualizar(false);
    }
  }

  const d = r.dados;
  return (
    <section aria-labelledby="titulo-regras" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <RotuloSeccao>
          <span id="titulo-regras">Regras aplicáveis a este caso</span>
        </RotuloSeccao>
        {d?.ia_disponivel && (
          <button
            type="button"
            onClick={atualizar}
            disabled={aAtualizar}
            className="inline-flex items-center gap-1 text-xs font-semibold text-terracota-escuro hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${aAtualizar ? "animate-spin" : ""}`} aria-hidden />
            {aAtualizar ? "A procurar…" : "Procurar outra vez"}
          </button>
        )}
      </div>
      {r.erro && !d ? (
        <ErroEmLinha erro={r.erro} />
      ) : !d ? (
        <ACarregar texto="A procurar o regulamento…" />
      ) : d.trechos.length === 0 ? (
        <p className="rounded-xl bg-creme-2 p-3 text-[13px] text-tinta-2">
          Não encontrámos trechos do regulamento para este caso. Confirme a base
          legal do tipo de processo em Conhecimento.
        </p>
      ) : (
        <>
          {!d.destacado && (
            <p className="text-xs text-tinta-3">
              Sem IA: mostramos os trechos encontrados, sem as frases destacadas.
            </p>
          )}
          <ol className="flex flex-col gap-3">
            {d.trechos.map((t, i) => (
              <li key={t.trecho_id} className="flex flex-col gap-2 rounded-xl border border-linha bg-papel p-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-terracota-escuro">[{i + 1}]</span>
                  <p className="min-w-0 flex-1 text-[13px] font-bold text-tinta">
                    {t.referencia ?? t.fonte}
                  </p>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Abrir a fonte: ${t.fonte} (nova janela)`}
                    className="text-tinta-3 hover:text-tinta"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </div>
                <blockquote className="border-l-2 border-ambar-suave bg-ambar-suave/25 py-1.5 pl-3 pr-1 text-[13px] leading-relaxed text-tinta">
                  <TextoDestacado t={t} />
                </blockquote>
                {t.porque_se_aplica && (
                  <p className="text-xs text-tinta-2">{t.porque_se_aplica}</p>
                )}
                <p className="text-[11px] text-tinta-3">
                  {[t.fonte, t.entidade, t.data ? `lido a ${diaCurto(t.data)}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  {t.origem === "base_legal" ? " · base legal do tipo" : ""}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
      <ErroEmLinha erro={erro} />
    </section>
  );
}

export function ApoioTecnico() {
  const { id } = useParams<{ id: string }>();
  const { pode, pedido } = useSessao();
  const permitido = pode("processos");
  const ficha = usePedido<ProcessoDetalhe>(permitido ? `/v1/painel/processos/${id}` : null);
  const lista = usePedido<{ itens: Rascunho[]; armazenamento_disponivel: boolean }>(
    permitido ? `/v1/painel/processos/${id}/rascunhos` : null,
  );
  const verif = usePedido<Verificacoes>(
    permitido ? `/v1/painel/processos/${id}/verificacoes` : null,
  );
  const [aVerificar, setAVerificar] = useState(false);
  const [erroVerificar, setErroVerificar] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoRascunho>("parecer");
  const [escolhido, setEscolhido] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState(false);
  const [assinar, setAssinar] = useState<Rascunho | null>(null);
  const [mensagem, setMensagem] = useState<{ tom: "verde" | "ambar" | "erro"; texto: string } | null>(null);
  const [aRegerar, setARegerar] = useState(false);

  if (!permitido) {
    return (
      <div className="pt-10">
        <Aviso titulo="Sem acesso aos processos.">
          O seu perfil não inclui os processos.
        </Aviso>
      </div>
    );
  }
  const p = ficha.dados;
  if (ficha.erro && !p) {
    return (
      <div className="pt-10">
        <Aviso titulo="Não foi possível abrir o processo." tom="erro">
          {ficha.erro.message}
        </Aviso>
      </div>
    );
  }
  if (!p) return <ACarregar className="px-10 pt-10" texto="A abrir o apoio ao técnico…" />;

  const todos = lista.dados?.itens ?? [];
  const doTipo = todos.filter((r) => r.tipo === tipo);
  const atual =
    doTipo.find((r) => r.id === escolhido[tipo]) ??
    doTipo.find((r) => r.estado !== "descartado") ??
    doTipo[0] ??
    null;
  const mostrarNovo = novo || (!lista.aCarregar && lista.dados && !atual);

  function substituir(r: Rascunho) {
    const itens = lista.dados?.itens ?? [];
    const existe = itens.some((x) => x.id === r.id);
    lista.definir({
      armazenamento_disponivel: lista.dados?.armazenamento_disponivel ?? false,
      itens: existe ? itens.map((x) => (x.id === r.id ? r : x)) : [r, ...itens],
    });
    setEscolhido((e) => ({ ...e, [r.tipo]: r.id }));
  }

  async function verificarOutraVez(perfil?: PerfilVerificacao): Promise<boolean> {
    setAVerificar(true);
    setErroVerificar(null);
    try {
      verif.definir(
        await pedido<Verificacoes>(
          perfil
            ? `/v1/painel/processos/${id}/verificacoes?perfil=${perfil}`
            : `/v1/painel/processos/${id}/verificacoes?atualizar=true`,
        ),
      );
      return true;
    } catch (e) {
      setErroVerificar(paraErro(e).message);
      return false;
    } finally {
      setAVerificar(false);
    }
  }

  const estadoVerificacoes: EstadoVerificacoes = {
    dados: verif.dados,
    erro: verif.erro,
    aCarregar: verif.aCarregar,
    aAtualizar: aVerificar,
    atualizar: async () => {
      await verificarOutraVez();
    },
    escolherPerfil: async (perfil) => {
      await verificarOutraVez(perfil);
    },
    erroAtualizar: erroVerificar,
  };

  async function gerarOutraVez() {
    setARegerar(true);
    setMensagem(null);
    // As verificações primeiro: o rascunho novo já as usa.
    await verificarOutraVez();
    if (!atual) {
      setARegerar(false);
      return;
    }
    try {
      const corpo: Record<string, unknown> = { tipo: atual.tipo };
      if (atual.instrucoes) corpo.instrucoes = atual.instrucoes;
      if (atual.modelo_id) corpo.modelo_id = atual.modelo_id;
      if (atual.tipo === "pedido_elementos" && atual.documentos_pedidos?.length) {
        corpo.documentos_pedidos = atual.documentos_pedidos.map((d) =>
          d.tipo_documento_id ? { tipo_documento_id: d.tipo_documento_id } : { texto: d.nome },
        );
        if (atual.prazo_dias_uteis) corpo.prazo_dias_uteis = atual.prazo_dias_uteis;
      }
      const r = await pedido<Rascunho>(`/v1/painel/processos/${id}/rascunhos`, { corpo });
      substituir(r);
      setMensagem({ tom: "verde", texto: "Novo rascunho gerado. O anterior continua na lista." });
    } catch (e) {
      setMensagem({ tom: "erro", texto: paraErro(e).message });
    } finally {
      setARegerar(false);
    }
  }

  const sub = [p.numero, p.assunto, p.morada].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-linha bg-papel px-8 py-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <Link
            href={`/painel/processos/${p.id}`}
            aria-label={`Voltar ao processo ${p.numero}`}
            className="rounded-full p-1 text-tinta-2 hover:bg-creme-2 hover:text-tinta"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="font-display text-[22px] font-bold leading-tight text-tinta">
              Apoio ao técnico
            </h1>
            <p className="truncate text-[13px] text-tinta-2">{sub}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {p.demonstracao && <Pilula tom="ambar">processo de demonstração</Pilula>}
          <BotaoPainel
            icone={RefreshCw}
            onClick={gerarOutraVez}
            disabled={aRegerar || aVerificar}
            title={
              atual
                ? "Refaz as verificações automáticas e o rascunho aberto"
                : "Refaz as verificações automáticas"
            }
          >
            {aRegerar ? "A gerar…" : "Gerar outra vez"}
          </BotaoPainel>
          <BotaoPainel
            variante="principal"
            icone={PenLine}
            disabled={!atual || atual.estado !== "rascunho"}
            onClick={() => atual && setAssinar(atual)}
          >
            Aprovar e assinar
          </BotaoPainel>
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside
          aria-label="Verificações, regulamento e resumo"
          className="flex flex-col gap-6 border-r border-linha py-6 pl-8 pr-6"
        >
          <BlocoVerificacoes processoId={p.id} v={estadoVerificacoes} />
          <Regras processoId={p.id} />
          <Resumo processoId={p.id} />
        </aside>

        <section aria-label="Documento" className="flex flex-col gap-4 bg-creme-2 px-10 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmentado<TipoRascunho>
              rotulo="Tipo de documento"
              fundo="bg-white/50"
              valor={tipo}
              onChange={(v) => {
                setTipo(v);
                setNovo(false);
              }}
              opcoes={TIPOS_RASCUNHO.map((t) => ({
                valor: t,
                rotulo: TIPO_RASCUNHO_ROTULO[t],
                contagem: todos.filter((r) => r.tipo === t && r.estado !== "descartado").length || null,
              }))}
            />
            <div className="flex items-center gap-2">
              {doTipo.length > 1 && !mostrarNovo && (
                <label className="flex items-center gap-2 text-xs font-semibold text-tinta-2">
                  <FileText className="size-3.5" aria-hidden />
                  <span className="sr-only">Rascunho</span>
                  <select
                    value={atual?.id ?? ""}
                    onChange={(e) => setEscolhido({ ...escolhido, [tipo]: e.target.value })}
                    className="rounded-md border border-linha bg-papel px-2 py-1 text-xs"
                  >
                    {doTipo.map((r) => (
                      <option key={r.id} value={r.id}>
                        {diaHora(r.criado_em)} · {r.estado}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!mostrarNovo && (
                <BotaoPainel pequeno icone={Plus} onClick={() => setNovo(true)}>
                  Novo rascunho
                </BotaoPainel>
              )}
            </div>
          </div>

          {mensagem && (
            <Nota tom={mensagem.tom} onFechar={() => setMensagem(null)}>
              {mensagem.texto}
            </Nota>
          )}

          {lista.erro && !lista.dados ? (
            <ErroEmLinha erro={lista.erro} />
          ) : lista.aCarregar && !lista.dados ? (
            <ACarregar texto="A carregar os rascunhos…" />
          ) : mostrarNovo ? (
            <NovoRascunho
              key={tipo}
              tipo={tipo}
              processo={p}
              onCancelar={atual ? () => setNovo(false) : undefined}
              onCriado={(r) => {
                substituir(r);
                setNovo(false);
                setMensagem({ tom: "verde", texto: "Rascunho gerado. Reveja antes de assinar." });
              }}
            />
          ) : atual ? (
            <FolhaRascunho
              key={`${atual.id}-${atual.versao}-${atual.estado}`}
              r={atual}
              processo={p}
              onAssinar={setAssinar}
              onAtualizado={(r, texto) => {
                substituir(r);
                if (texto) setMensagem({ tom: "verde", texto });
              }}
            />
          ) : null}
        </section>
      </div>

      <DialogoAssinar
        rascunho={assinar}
        numero={p.numero}
        onFechar={() => setAssinar(null)}
        onAssinado={(r) => {
          setAssinar(null);
          substituir(r);
          setMensagem({
            tom: r.pdf_aviso ? "ambar" : "verde",
            texto: `${r.tipo_rotulo} aprovado com assinatura simulada.${r.pdf_aviso ? ` ${r.pdf_aviso}` : ""}`,
          });
          ficha.recarregar();
        }}
      />
    </div>
  );
}
