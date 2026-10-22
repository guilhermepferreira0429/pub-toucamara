"use client";

import {
  AlarmClock,
  Check,
  ExternalLink,
  FileUp,
  Lock,
  Mail,
  MessageSquareText,
  NotebookPen,
  Paperclip,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  dia,
  Dialogo,
  ErroLinha,
  Estado,
  numero,
  pct,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { BotaoExportar } from "@/components/painel/botao-exportar";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Livro de reclamações. As reclamações formais (do agente, do
 * balcão, do Livro Amarelo em papel e dos emails da triagem) com a
 * data-limite legal de resposta em dias úteis: a terminar a âmbar, em
 * atraso a vermelho. Atribuir a um serviço ou funcionário, responder (vai
 * por SMS ou email e fica na página pública) e encerrar.
 */

type EstadoRec = "recebida" | "em_analise" | "respondida" | "encerrada";
type Situacao =
  | "no_prazo"
  | "a_terminar"
  | "termina_hoje"
  | "em_atraso"
  | "respondida_no_prazo"
  | "respondida_fora_do_prazo";

interface Prazo {
  situacao: Situacao;
  dias_uteis_restantes: number | null;
}

interface Reclamacao {
  id: string;
  numero: string;
  codigo_publico: string;
  canal: string;
  canal_nome: string;
  estado: EstadoRec;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  resposta_por: "sms" | "email" | "carta";
  servico_visado: string | null;
  servico_id: string | null;
  servico: string | null;
  atribuida_a: string | null;
  atribuida_a_nome: string | null;
  descricao: string;
  pedido: string | null;
  recebida_em: string;
  prazo_dias_uteis: number;
  responder_ate: string;
  prazo: Prazo;
  prazo_de_demonstracao: boolean;
  resposta: string | null;
  respondida_em: string | null;
  respondida_por_nome: string | null;
  encerrada_em: string | null;
  nota_encerramento: string | null;
  conversa_id: string | null;
  email_id: string | null;
  criada_em: string;
}

interface Detalhe extends Reclamacao {
  eventos: { tipo: string; descricao: string; ator: string | null; criado_em: string }[];
  anexos: { id: string; nome: string; mime: string; url: string | null; criado_em: string }[];
  mensagens: { canal: string; destino: string; corpo: string; estado: string; enviar_em: string }[];
  armazenamento: boolean;
}

interface Config {
  prazo_dias_uteis: number;
  aviso_dias_uteis: number;
  destinatarios_avisos: { email: string; nome: string }[];
  fonte: { titulo: string; url: string | null };
  demonstracao: boolean;
}

interface Lista {
  reclamacoes: Reclamacao[];
  contagens: Record<EstadoRec, number>;
  indicadores: {
    total: number;
    abertas: number;
    em_atraso: number;
    respondidas: number;
    respondidas_no_prazo_pct: number | null;
    tempo_medio_dias_uteis: number | null;
    por_servico: {
      servico: string;
      total: number;
      abertas: number;
      em_atraso: number;
      respondidas_no_prazo_pct: number | null;
    }[];
  };
  config: Config;
}

interface Opcoes {
  servicos: { id: string; nome: string }[];
  utilizadores: { id: string; nome: string; servico_id: string | null }[];
}

const ESTADOS: Record<EstadoRec, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" | "tinta" }> = {
  recebida: { rotulo: "recebida", tom: "terracota" },
  em_analise: { rotulo: "em análise", tom: "ambar" },
  respondida: { rotulo: "respondida", tom: "verde" },
  encerrada: { rotulo: "encerrada", tom: "neutro" },
};

const FILTROS = ["abertas", "recebida", "em_analise", "respondida", "encerrada", "todas"] as const;
type Filtro = (typeof FILTROS)[number];

function dias(n: number): string {
  return `${n} dia${n === 1 ? "" : "s"} út${n === 1 ? "il" : "eis"}`;
}

/** A pílula do prazo: a terminar a âmbar, em atraso a vermelho. */
function PilulaPrazo({ p, ate }: { p: Prazo; ate: string }) {
  const n = p.dias_uteis_restantes ?? 0;
  switch (p.situacao) {
    case "em_atraso":
      return (
        <span className="inline-flex items-center gap-[5px] rounded-xl bg-red-700 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white">
          <AlarmClock className="size-3.5" aria-hidden />
          em atraso há {dias(-n)}
        </span>
      );
    case "termina_hoje":
      return (
        <Pilula tom="terracota" icone={AlarmClock}>
          o prazo termina hoje
        </Pilula>
      );
    case "a_terminar":
      return (
        <Pilula tom="ambar" icone={AlarmClock}>
          faltam {dias(n)} · até {dia(ate)}
        </Pilula>
      );
    case "no_prazo":
      return p.dias_uteis_restantes === null ? null : (
        <Pilula tom="neutro">
          faltam {dias(n)} · até {dia(ate)}
        </Pilula>
      );
    case "respondida_no_prazo":
      return (
        <Pilula tom="verde" icone={Check}>
          respondida no prazo
        </Pilula>
      );
    case "respondida_fora_do_prazo":
      return <Pilula tom="terracota">respondida fora do prazo</Pilula>;
  }
}

export function PaginaReclamacoes() {
  const { pode } = useSessao();
  const router = useRouter();
  const params = useSearchParams();
  const selecionada = params.get("id");
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [nova, setNova] = useState(false);
  const caminho = pode("reclamacoes")
    ? `/v1/painel/reclamacoes${filtro === "todas" ? "" : `?estado=${filtro}`}`
    : null;
  const d = useDados<Lista>(caminho);
  const opcoes = useDados<Opcoes>(pode("reclamacoes") ? "/v1/painel/reclamacoes/opcoes" : null);
  const escolher = (id: string | null) =>
    router.replace(id ? `/painel/reclamacoes?id=${id}` : "/painel/reclamacoes", { scroll: false });

  if (!pode("reclamacoes")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Atendimento", "Reclamações"]} titulo="Reclamações" />
        <SemAcesso />
      </div>
    );
  }

  const ind = d.dados?.indicadores;
  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Atendimento", "Reclamações"]}
        titulo="Livro de reclamações"
        descricao="Reclamações formais com número e prazo legal de resposta, contado em dias úteis com os feriados do município. Entram pelo agente (telefone e chat), pelos emails da triagem, ao balcão ou pelo Livro Amarelo em papel."
        acoes={
          <>
            <BotaoExportar
              caminho={`/v1/painel/reclamacoes/exportar.csv${filtro === "todas" ? "" : `?estado=${filtro}`}`}
              base="reclamacoes"
            />
            <Botao icone={Plus} onClick={() => setNova(true)}>
              Registar reclamação
            </Botao>
          </>
        }
      />

      {ind && (
        <div className="grid gap-3 px-4 sm:px-10 pb-5 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador rotulo="Por responder" valor={numero(ind.abertas)} />
          <Indicador
            rotulo="Em atraso"
            valor={numero(ind.em_atraso)}
            alerta={ind.em_atraso > 0}
          />
          <Indicador
            rotulo="Respondidas no prazo"
            valor={pct(ind.respondidas_no_prazo_pct)}
            nota={`${numero(ind.respondidas)} respondidas no último ano`}
          />
          <Indicador
            rotulo="Tempo médio de resposta"
            valor={ind.tempo_medio_dias_uteis === null ? "—" : dias(ind.tempo_medio_dias_uteis)}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 sm:px-10 pb-5" role="group" aria-label="Estado">
        {FILTROS.map((f) => {
          const n =
            f === "todas"
              ? null
              : f === "abertas"
                ? (d.dados?.contagens.recebida ?? 0) + (d.dados?.contagens.em_analise ?? 0)
                : d.dados?.contagens[f];
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => setFiltro(f)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
                filtro === f ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
              }`}
            >
              {f === "todas" ? "Todas" : f === "abertas" ? "Por responder" : ESTADOS[f].rotulo}
              {n ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 px-4 sm:px-10 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Estado
            aCarregar={d.aCarregar}
            erro={d.erro}
            vazio={d.dados?.reclamacoes.length === 0}
            textoVazio="Não há reclamações neste estado. Ligue para a linha (ou use o chat) e diga que quer fazer uma reclamação formal."
          >
            {(d.dados?.reclamacoes ?? []).map((r) => (
              <LinhaReclamacao key={r.id} r={r} ativa={r.id === selecionada} onEscolher={() => escolher(r.id)} />
            ))}
          </Estado>
          <EmailsCandidatos onConvertida={(id) => { d.recarregar(); escolher(id); }} />
        </div>
        <div className="flex flex-col gap-4">
          {selecionada && (
            <DetalheReclamacao
              key={selecionada}
              id={selecionada}
              opcoes={opcoes.dados}
              onMudou={d.recarregar}
              onFechar={() => escolher(null)}
            />
          )}
          {d.dados && <CartaoConfig config={d.dados.config} onMudou={d.recarregar} />}
          {ind && ind.por_servico.length > 0 && (
            <Cartao className="p-5">
              <Rotulo>Por serviço (último ano)</Rotulo>
              <table className="mt-3 w-full text-[13px]">
                <thead className="text-left text-tinta-3">
                  <tr>
                    <th className="pb-1 font-semibold">Serviço</th>
                    <th className="pb-1 text-right font-semibold">Total</th>
                    <th className="pb-1 text-right font-semibold">Abertas</th>
                    <th className="pb-1 text-right font-semibold">Atraso</th>
                    <th className="pb-1 text-right font-semibold">No prazo</th>
                  </tr>
                </thead>
                <tbody>
                  {ind.por_servico.map((s) => (
                    <tr key={s.servico} className="border-t border-linha text-tinta">
                      <td className="py-1.5">{s.servico}</td>
                      <td className="py-1.5 text-right">{s.total}</td>
                      <td className="py-1.5 text-right">{s.abertas}</td>
                      <td className={`py-1.5 text-right ${s.em_atraso ? "font-bold text-red-700" : ""}`}>{s.em_atraso}</td>
                      <td className="py-1.5 text-right">{pct(s.respondidas_no_prazo_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Cartao>
          )}
        </div>
      </div>

      <NovaReclamacao
        aberto={nova}
        opcoes={opcoes.dados}
        onFechar={() => setNova(false)}
        onCriada={(id) => {
          setNova(false);
          d.recarregar();
          escolher(id);
        }}
      />
    </div>
  );
}

function Indicador({ rotulo, valor, nota, alerta }: { rotulo: string; valor: string; nota?: string; alerta?: boolean }) {
  return (
    <Cartao className={`flex flex-col gap-1 p-4 ${alerta ? "border-red-700" : ""}`}>
      <Rotulo>{rotulo}</Rotulo>
      <span className={`font-display text-2xl font-bold ${alerta ? "text-red-700" : "text-tinta"}`}>{valor}</span>
      {nota && <span className="text-xs text-tinta-3">{nota}</span>}
    </Cartao>
  );
}

function LinhaReclamacao({ r, ativa, onEscolher }: { r: Reclamacao; ativa: boolean; onEscolher: () => void }) {
  const e = ESTADOS[r.estado];
  const atraso = r.prazo.situacao === "em_atraso";
  return (
    <button
      type="button"
      onClick={onEscolher}
      aria-current={ativa}
      className={`flex w-full flex-col gap-1.5 rounded-2xl border bg-papel px-5 py-4 text-left transition-colors hover:border-terracota ${
        ativa ? "border-terracota ring-1 ring-terracota" : atraso ? "border-red-700" : "border-linha"
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-tinta">{r.numero}</span>
        <Pilula tom={e.tom}>{e.rotulo}</Pilula>
        <PilulaPrazo p={r.prazo} ate={r.responder_ate} />
        <Pilula tom="neutro">{r.canal_nome}</Pilula>
      </span>
      <span className="line-clamp-2 text-[14px] text-tinta">{r.descricao}</span>
      <span className="text-xs text-tinta-3">
        {r.nome ?? "Sem nome"} · {r.servico ?? (r.servico_visado ? `sobre ${r.servico_visado}` : "sem serviço atribuído")}
        {r.atribuida_a_nome ? ` · com ${r.atribuida_a_nome}` : ""} · entrou {dia(r.recebida_em)}
      </span>
    </button>
  );
}

function DetalheReclamacao({
  id,
  opcoes,
  onMudou,
  onFechar,
}: {
  id: string;
  opcoes?: Opcoes;
  onMudou: () => void;
  onFechar: () => void;
}) {
  const { pedido } = useSessao();
  const d = useDados<Detalhe>(`/v1/painel/reclamacoes/${id}`);
  const acao = useAcao();
  const [servico, setServico] = useState<string | null>(null);
  const [funcionario, setFuncionario] = useState<string | null>(null);
  const [notas, setNotas] = useState("");
  const [texto, setTexto] = useState<string | null>(null);
  const [origem, setOrigem] = useState<"ia" | "modelo" | null>(null);
  const [nota, setNota] = useState("");

  const r = d.dados;
  if (!r) {
    return (
      <Cartao>
        <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!r} />
      </Cartao>
    );
  }
  const aberta = r.estado === "recebida" || r.estado === "em_analise";
  const resposta = texto ?? "";

  const correr = async <T,>(caminho: string, corpo?: object): Promise<T | undefined> => {
    const x = await acao.executar(() => pedido<T>(caminho, { metodo: "POST", corpo }));
    if (x !== undefined) {
      d.recarregar();
      onMudou();
    }
    return x;
  };

  const rascunho = async () => {
    const x = await acao.executar(() =>
      pedido<{ texto: string; origem: "ia" | "modelo" }>(`/v1/painel/reclamacoes/${id}/rascunho`, {
        metodo: "POST",
        corpo: notas.trim() ? { notas: notas.trim() } : {},
      }),
    );
    if (x) {
      setTexto(x.texto);
      setOrigem(x.origem);
    }
  };

  const anexar = async (f: File) => {
    const x = await acao.executar(async () => {
      const envio = await pedido<{ url_envio: string; mime: string }>(`/v1/painel/reclamacoes/${id}/anexos`, {
        metodo: "POST",
        corpo: { nome: f.name, mime: f.type || "application/octet-stream" },
      });
      const res = await fetch(envio.url_envio, { method: "PUT", headers: { "Content-Type": envio.mime }, body: f });
      if (!res.ok) throw new Error("O envio do ficheiro falhou.");
      return true;
    });
    if (x) d.recarregar();
  };

  const via =
    r.resposta_por === "sms" && r.telefone
      ? `por SMS para ${r.telefone} (com o link para a página)`
      : r.resposta_por === "email" && r.email
        ? `por email para ${r.email}`
        : "por carta (imprima a resposta)";

  return (
    <Cartao className={r.prazo.situacao === "em_atraso" ? "border-red-700" : "border-terracota"}>
      <div className="flex items-start justify-between gap-3 border-b border-linha px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold text-tinta">{r.numero}</span>
            <Pilula tom={ESTADOS[r.estado].tom}>{ESTADOS[r.estado].rotulo}</Pilula>
          </span>
          <PilulaPrazo p={r.prazo} ate={r.responder_ate} />
          <span className="text-xs text-tinta-3">
            Entrou {dia(r.recebida_em)} por {r.canal_nome} · responder até {dia(r.responder_ate)} ({dias(r.prazo_dias_uteis)})
            {r.prazo_de_demonstracao ? " · prazo de demonstração" : ""}
          </span>
        </div>
        <Botao tamanho="pequeno" variante="discreto" onClick={onFechar}>
          Fechar
        </Botao>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-col gap-1 text-[13px] text-tinta-2">
          <span className="font-semibold text-tinta">{r.nome ?? "Sem nome"}</span>
          {r.telefone && <span>{r.telefone}</span>}
          {r.email && <span>{r.email}</span>}
          {r.servico_visado && <span>Sobre: {r.servico_visado}</span>}
        </div>
        <div>
          <Rotulo>O que aconteceu</Rotulo>
          <p className="mt-1.5 text-[14px] whitespace-pre-line text-tinta">{r.descricao}</p>
        </div>
        {r.pedido && (
          <div>
            <Rotulo>O que pede</Rotulo>
            <p className="mt-1.5 text-[14px] text-tinta">{r.pedido}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-[13px] font-semibold">
          <a
            href={`/reclamacao/${r.codigo_publico}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-terracota"
          >
            <ExternalLink className="size-4" aria-hidden /> página do munícipe
          </a>
          {r.conversa_id && (
            <Link href={`/painel/conversas/${r.conversa_id}`} className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta">
              <MessageSquareText className="size-4" aria-hidden /> conversa
            </Link>
          )}
          {r.email_id && (
            <Link href={`/painel/emails/${r.email_id}`} className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta">
              <Mail className="size-4" aria-hidden /> email original
            </Link>
          )}
        </div>

        {aberta && (
          <div className="flex flex-col gap-2 rounded-xl bg-creme p-3">
            <Rotulo>Atribuir</Rotulo>
            <select
              className={classeEntrada}
              aria-label="Serviço"
              value={servico ?? r.servico_id ?? ""}
              onChange={(e) => setServico(e.target.value)}
            >
              <option value="">Sem serviço</option>
              {(opcoes?.servicos ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
            <select
              className={classeEntrada}
              aria-label="Funcionário"
              value={funcionario ?? r.atribuida_a ?? ""}
              onChange={(e) => setFuncionario(e.target.value)}
            >
              <option value="">Sem funcionário</option>
              {(opcoes?.utilizadores ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
            <div className="flex justify-end">
              <Botao
                tamanho="pequeno"
                variante="secundario"
                disabled={acao.aCorrer || (servico === null && funcionario === null)}
                onClick={() =>
                  correr(`/v1/painel/reclamacoes/${id}/atribuir`, {
                    ...(servico !== null ? { servico_id: servico || null } : {}),
                    ...(funcionario !== null ? { utilizador_id: funcionario || null } : {}),
                  })
                }
              >
                Atribuir
              </Botao>
            </div>
          </div>
        )}

        {r.resposta ? (
          <div>
            <Rotulo>Resposta</Rotulo>
            <p className="mt-1.5 rounded-xl bg-verde-suave/60 p-3 text-[14px] whitespace-pre-line text-tinta">{r.resposta}</p>
            <p className="mt-1 text-xs text-tinta-3">
              {quando(r.respondida_em)}
              {r.respondida_por_nome ? ` · ${r.respondida_por_nome}` : ""}
            </p>
          </div>
        ) : (
          aberta && (
            <div className="flex flex-col gap-2">
              <Rotulo>Responder</Rotulo>
              <input
                className={classeEntrada}
                placeholder="Notas para o rascunho (o que foi apurado, o que a câmara vai fazer)"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
              <div className="flex justify-end">
                <Botao tamanho="pequeno" variante="discreto" icone={Sparkles} disabled={acao.aCorrer} onClick={rascunho}>
                  Escrever rascunho
                </Botao>
              </div>
              <textarea
                className={`${classeEntrada} min-h-44`}
                aria-label="Resposta"
                placeholder="A resposta escrita ao munícipe"
                value={resposta}
                onChange={(e) => setTexto(e.target.value)}
              />
              {origem && (
                <p className="text-xs text-tinta-3">
                  {origem === "ia" ? "Rascunho escrito pela IA" : "Rascunho do modelo da câmara (sem IA)"}: complete o que está entre [ ]
                  e confirme os factos antes de enviar.
                </p>
              )}
              <p className="text-xs text-tinta-3">A resposta segue {via} e fica na página da reclamação.</p>
              <div className="flex justify-end">
                <Botao
                  tamanho="pequeno"
                  icone={Send}
                  disabled={acao.aCorrer || resposta.trim().length < 20}
                  onClick={() => correr(`/v1/painel/reclamacoes/${id}/responder`, { texto: resposta.trim() })}
                >
                  Enviar resposta
                </Botao>
              </div>
            </div>
          )
        )}

        {r.estado !== "encerrada" ? (
          <div className="flex flex-col gap-2 border-t border-linha pt-3">
            {r.estado !== "respondida" && (
              <input
                className={classeEntrada}
                placeholder="Porque encerra sem resposta (ex.: a pessoa desistiu)"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            )}
            <div className="flex justify-end">
              <Botao
                tamanho="pequeno"
                variante="secundario"
                icone={Lock}
                disabled={acao.aCorrer || (r.estado !== "respondida" && nota.trim().length < 3)}
                onClick={() =>
                  correr(`/v1/painel/reclamacoes/${id}/encerrar`, nota.trim() ? { nota: nota.trim() } : {})
                }
              >
                Encerrar
              </Botao>
            </div>
          </div>
        ) : (
          <p className="text-xs text-tinta-3">
            Encerrada {quando(r.encerrada_em)}
            {r.nota_encerramento ? `: ${r.nota_encerramento}` : ""}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Rotulo>Anexos</Rotulo>
          {r.anexos.length === 0 && <p className="text-[13px] text-tinta-3">Sem anexos.</p>}
          <ul className="flex flex-col gap-1">
            {r.anexos.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[13px] text-tinta">
                <Paperclip className="size-4 text-tinta-3" aria-hidden />
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-terracota underline">
                    {a.nome}
                  </a>
                ) : (
                  <span>{a.nome}</span>
                )}
              </li>
            ))}
          </ul>
          {r.armazenamento ? (
            <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-tinta-2 hover:text-tinta">
              <FileUp className="size-4" aria-hidden />
              Juntar folha digitalizada ou foto
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void anexar(f);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="text-xs text-tinta-3">Para juntar ficheiros, a instalação precisa do armazenamento (S3).</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Rotulo>Histórico</Rotulo>
          <ol className="flex flex-col gap-1.5">
            {r.eventos.map((e, i) => (
              <li key={i} className="text-[13px] text-tinta">
                <span className="text-tinta-3">{quando(e.criado_em)} · </span>
                {e.descricao}
                {e.ator ? <span className="text-tinta-3"> ({e.ator})</span> : null}
              </li>
            ))}
          </ol>
        </div>

        {r.mensagens.length > 0 && (
          <div className="flex flex-col gap-2">
            <Rotulo>Mensagens enviadas</Rotulo>
            <ul className="flex flex-col gap-1.5">
              {r.mensagens.map((m, i) => (
                <li key={i} className="rounded-lg bg-creme px-3 py-2 text-[12px] text-tinta-2">
                  <span className="font-semibold text-tinta">
                    {m.canal === "sms" ? "SMS" : "Email"} · {m.destino} · {m.estado}
                  </span>
                  <span className="mt-0.5 line-clamp-3 block">{m.corpo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ErroLinha erro={acao.erro} />
      </div>
    </Cartao>
  );
}

function CartaoConfig({ config, onMudou }: { config: Config; onMudou: () => void }) {
  const { pode, pedido } = useSessao();
  const acao = useAcao();
  const [editar, setEditar] = useState(false);
  const [prazo, setPrazo] = useState(String(config.prazo_dias_uteis));
  const [aviso, setAviso] = useState(String(config.aviso_dias_uteis));
  const [confirmado, setConfirmado] = useState(!config.demonstracao);
  const guardar = async () => {
    const x = await acao.executar(() =>
      pedido("/v1/painel/reclamacoes/config", {
        metodo: "PUT",
        corpo: {
          ...config,
          prazo_dias_uteis: Number(prazo),
          aviso_dias_uteis: Number(aviso),
          demonstracao: !confirmado,
        },
      }),
    );
    if (x !== undefined) {
      setEditar(false);
      onMudou();
    }
  };
  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Rotulo>Prazo de resposta</Rotulo>
        {config.demonstracao && <Pilula tom="ambar">valores de demonstração</Pilula>}
      </div>
      <p className="text-[14px] text-tinta">
        <span className="font-display text-xl font-bold">{dias(config.prazo_dias_uteis)}</span> a contar do dia seguinte à
        entrada. Aviso interno quando faltam {dias(config.aviso_dias_uteis)} ou menos, e enquanto estiver em atraso (de manhã, nos dias úteis).
      </p>
      <p className="text-xs text-tinta-3">Base: {config.fonte.titulo}</p>
      {pode("agente") &&
        (editar ? (
          <div className="flex flex-col gap-3">
            <Campo rotulo="Prazo (dias úteis)">
              <input className={classeEntrada} type="number" min={1} max={120} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </Campo>
            <Campo rotulo="Avisar quando faltam (dias úteis)">
              <input className={classeEntrada} type="number" min={0} max={30} value={aviso} onChange={(e) => setAviso(e.target.value)} />
            </Campo>
            <label className="flex items-start gap-2 text-[13px] text-tinta">
              <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-0.5" />
              O prazo foi confirmado pelo jurista da câmara
            </label>
            <div className="flex justify-end gap-2">
              <Botao tamanho="pequeno" variante="discreto" onClick={() => setEditar(false)}>
                Cancelar
              </Botao>
              <Botao tamanho="pequeno" disabled={acao.aCorrer} onClick={guardar}>
                Guardar
              </Botao>
            </div>
            <p className="text-xs text-tinta-3">Só as reclamações novas usam o prazo novo.</p>
          </div>
        ) : (
          <div className="flex justify-end">
            <Botao tamanho="pequeno" variante="secundario" onClick={() => setEditar(true)}>
              Mudar o prazo
            </Botao>
          </div>
        ))}
      <ErroLinha erro={acao.erro} />
    </Cartao>
  );
}

function EmailsCandidatos({ onConvertida }: { onConvertida: (id: string) => void }) {
  const { pedido } = useSessao();
  const d = useDados<{ emails: { id: string; de: string; assunto: string | null; excerto: string; recebido_em: string; tema: string | null }[] }>(
    "/v1/painel/reclamacoes/emails",
  );
  const acao = useAcao();
  const emails = d.dados?.emails ?? [];
  if (emails.length === 0) return null;
  return (
    <Cartao className="mt-3 flex flex-col">
      <div className="border-b border-linha px-5 py-3">
        <Rotulo>Emails da triagem que parecem reclamações</Rotulo>
        <p className="mt-1 text-[13px] text-tinta-2">
          Se a pessoa apresenta uma reclamação formal, registe-a: fica com número e prazo, e a resposta segue por email.
        </p>
      </div>
      <ul>
        {emails.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 border-b border-linha px-5 py-3 last:border-0">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] font-semibold text-tinta">{e.assunto ?? "(sem assunto)"}</span>
              <span className="line-clamp-2 text-[13px] text-tinta-2">{e.excerto}</span>
              <span className="text-xs text-tinta-3">
                {e.de} · {quando(e.recebido_em)}
                {e.tema ? ` · ${e.tema}` : ""}
              </span>
            </div>
            <Botao
              tamanho="pequeno"
              variante="secundario"
              icone={NotebookPen}
              disabled={acao.aCorrer}
              onClick={async () => {
                const r = await acao.executar(() =>
                  pedido<{ id: string }>(`/v1/painel/reclamacoes/emails/${e.id}`, { metodo: "POST", corpo: {} }),
                );
                if (r) {
                  d.recarregar();
                  onConvertida(r.id);
                }
              }}
            >
              Registar como reclamação
            </Botao>
          </li>
        ))}
      </ul>
      <ErroLinha erro={acao.erro} className="m-4" />
    </Cartao>
  );
}

const CANAIS_PAINEL = [
  ["balcao", "Balcão"],
  ["livro_amarelo", "Livro Amarelo (papel)"],
  ["telefone", "Telefone"],
  ["email", "Email"],
] as const;

function NovaReclamacao({
  aberto,
  opcoes,
  onFechar,
  onCriada,
}: {
  aberto: boolean;
  opcoes?: Opcoes;
  onFechar: () => void;
  onCriada: (id: string) => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [f, setF] = useState({
    canal: "balcao",
    nome: "",
    telefone: "",
    email: "",
    servico_visado: "",
    servico_id: "",
    descricao: "",
    pedido: "",
    recebida_em: "",
  });
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const criar = async () => {
    const corpo = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
    const r = await acao.executar(() => pedido<{ id: string }>("/v1/painel/reclamacoes", { metodo: "POST", corpo }));
    if (r) onCriada(r.id);
  };
  return (
    <Dialogo titulo="Registar reclamação" aberto={aberto} onFechar={onFechar} largura="max-w-xl">
      <div className="flex flex-col gap-3">
        <Campo rotulo="Como chegou">
          <select className={classeEntrada} value={f.canal} onChange={mudar("canal")}>
            {CANAIS_PAINEL.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </Campo>
        {f.canal === "livro_amarelo" && (
          <Campo rotulo="Data escrita na folha" ajuda="O prazo conta a partir deste dia. Junte a folha digitalizada depois de registar.">
            <input className={classeEntrada} type="date" value={f.recebida_em} onChange={mudar("recebida_em")} />
          </Campo>
        )}
        <Campo rotulo="Nome">
          <input className={classeEntrada} value={f.nome} onChange={mudar("nome")} />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Telemóvel" ajuda="A resposta vai por SMS.">
            <input className={classeEntrada} value={f.telefone} onChange={mudar("telefone")} inputMode="tel" />
          </Campo>
          <Campo rotulo="Email" ajuda="Sem telemóvel, vai por email; sem nenhum, por carta.">
            <input className={classeEntrada} value={f.email} onChange={mudar("email")} type="email" />
          </Campo>
        </div>
        <Campo rotulo="De que serviço se queixa">
          <input className={classeEntrada} value={f.servico_visado} onChange={mudar("servico_visado")} />
        </Campo>
        <Campo rotulo="Atribuir já a">
          <select className={classeEntrada} value={f.servico_id} onChange={mudar("servico_id")}>
            <option value="">Ainda não</option>
            {(opcoes?.servicos ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="O que aconteceu">
          <textarea className={`${classeEntrada} min-h-28`} value={f.descricao} onChange={mudar("descricao")} />
        </Campo>
        <Campo rotulo="O que pede">
          <input className={classeEntrada} value={f.pedido} onChange={mudar("pedido")} />
        </Campo>
        <ErroLinha erro={acao.erro} />
        <div className="flex justify-end gap-2">
          <Botao variante="discreto" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao disabled={acao.aCorrer || f.nome.trim().length < 2 || f.descricao.trim().length < 10} onClick={criar}>
            Registar
          </Botao>
        </div>
      </div>
    </Dialogo>
  );
}
