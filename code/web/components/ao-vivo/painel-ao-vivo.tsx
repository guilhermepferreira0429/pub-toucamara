"use client";

import {
  AlertTriangle,
  BookOpen,
  Eye,
  FlaskConical,
  Headset,
  HelpCircle,
  MessagesSquare,
  PhoneCall,
  Play,
  Radio,
  Send,
  PhoneOff,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cartao,
  ErroLinha,
  Estado,
  Pilula,
  Rotulo,
  SemAcesso,
  classeEntrada,
  haQuanto,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { sse } from "@/lib/api";
import { municipioEscolhido, useSessao } from "@/lib/sessao";

/*
 * "Ao vivo": as chamadas web e os chats de agora. Ao abrir uma,
 * a conversa aparece em direto (SSE), com as ferramentas que o agente
 * chamou, a ficha da pessoa e sugestões para o funcionário a cada fala do
 * munícipe (regra, o que falta perguntar, alertas). "Assumir a conversa":
 * o funcionário escreve e o agente diz.
 */

type Quem = "municipe" | "agente" | "funcionario" | "familiar" | "ferramenta";

interface ItemLista {
  conversa_id: string;
  tipo: "chamada_web" | "chat";
  iniciada_em: string;
  ultima_atividade_em: string;
  pessoa: string | null;
  simulada: boolean;
  familiar: boolean;
  ultima_fala: { quem: string; texto: string } | null;
  alertas: string[];
}

interface Fala {
  seq: number;
  quem: Quem;
  texto: string;
  ferramenta: string | null;
  dados: Record<string, unknown>;
  em: string | null;
}

interface Detalhe {
  conversa: {
    id: string;
    tipo: "chamada_web" | "chat";
    iniciada_em: string;
    a_decorrer: boolean;
    simulada: boolean;
  };
  pessoa: {
    id: string;
    nome: string | null;
    telefone: string | null;
    conversas: number;
    processos: { id: string; numero: string; assunto: string; fase: string }[];
    ocorrencias: { id: string; numero: string; estado: string }[];
  } | null;
  falas: Fala[];
  familiar: { ativo: boolean; quem: string | null };
  pode_assumir: boolean;
  link_simulacao: string | null;
}

interface Alerta {
  tipo: "emergencia" | "vulneravel" | "irritacao";
  texto: string;
}

interface Sugestao {
  fala_seq: number | null;
  pergunta: string | null;
  tema?: string | null;
  ia: boolean;
  motivo_sem_ia: string | null;
  sugestao: { dizer: string | null; regra: string | null; confianca: string } | null;
  alertas: Alerta[];
  falta_perguntar: string[];
  falta_perguntar_demonstracao?: boolean;
  regras: {
    titulo: string;
    referencia: string | null;
    entidade: string | null;
    url: string | null;
    texto: string;
  }[];
  respostas_curadas: { pergunta: string; texto: string }[];
  sem_fonte: boolean;
}

const NOMES: Record<Quem, string> = {
  municipe: "Munícipe",
  agente: "Agente",
  funcionario: "Funcionário",
  familiar: "Familiar",
  ferramenta: "Ferramenta",
};

const ALERTA: Record<Alerta["tipo"], string> = {
  emergencia: "Emergência",
  vulneravel: "Pessoa vulnerável",
  irritacao: "Irritação",
};

/** Espera depois da última fala do munícipe antes de pedir sugestões. */
const DEBOUNCE_MS = 1500;

export function PainelAoVivo() {
  const { pode } = useSessao();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const lista = useDados<{ conversas: ItemLista[]; simulacao_disponivel: boolean }>(
    pode("conversas") ? "/v1/painel/ao-vivo" : null,
  );
  const { recarregar } = lista;
  const { pedido } = useSessao();
  const simular = useAcao();

  // A lista atualiza-se sozinha.
  useEffect(() => {
    const t = setInterval(recarregar, 4000);
    return () => clearInterval(t);
  }, [recarregar]);

  if (!pode("conversas")) return <SemAcesso />;

  const conversas = lista.dados?.conversas ?? [];
  const atual = escolhida ?? conversas[0]?.conversa_id ?? null;

  return (
    <div className="pb-16">
      <CabecalhoPagina
        migalhas={["Atendimento", "Ao vivo"]}
        titulo="Ao vivo"
        descricao="As chamadas web e os chats de agora. Abra uma para acompanhar em direto, ver sugestões e escrever ao agente."
        acoes={
          lista.dados?.simulacao_disponivel ? (
            <Botao
              variante="secundario"
              icone={Play}
              disabled={simular.aCorrer}
              onClick={async () => {
                const r = await simular.executar(() =>
                  pedido<{ conversa_id: string }>("/v1/painel/ao-vivo/simular", {
                    corpo: {},
                  }),
                );
                if (r) {
                  setEscolhida(r.conversa_id);
                  recarregar();
                }
              }}
            >
              Simular chamada
            </Botao>
          ) : undefined
        }
      />
      <ErroLinha erro={simular.erro} className="mx-4 sm:mx-10 mb-4" />
      <div className="grid gap-5 px-4 sm:px-10 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Cartao className="h-fit overflow-hidden">
          <div className="flex items-center gap-2 border-b border-linha px-4 py-3">
            <Radio className="size-4 text-terracota" aria-hidden />
            <Rotulo>A decorrer agora</Rotulo>
            <span className="ml-auto text-xs text-tinta-3">{conversas.length}</span>
          </div>
          <Estado
            aCarregar={lista.aCarregar && !lista.dados}
            erro={lista.erro}
            vazio={!conversas.length}
            textoVazio="Não há chamadas web nem chats a decorrer. Quando alguém ligar ou escrever no chat, aparece aqui."
          >
            <ul className="divide-y divide-linha">
              {conversas.map((c) => (
                <li key={c.conversa_id}>
                  <button
                    type="button"
                    onClick={() => setEscolhida(c.conversa_id)}
                    aria-current={atual === c.conversa_id}
                    className={`flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors ${
                      atual === c.conversa_id ? "bg-creme-2" : "hover:bg-creme-2/60"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {c.tipo === "chamada_web" ? (
                        <PhoneCall className="size-4 text-terracota" aria-hidden />
                      ) : (
                        <MessagesSquare className="size-4 text-tinta-2" aria-hidden />
                      )}
                      <span className="text-sm font-semibold text-tinta">
                        {c.pessoa ?? "Pessoa por identificar"}
                      </span>
                      <span className="ml-auto text-[11px] text-tinta-3">
                        {haQuanto(c.iniciada_em)}
                      </span>
                    </span>
                    {c.ultima_fala && (
                      <span className="line-clamp-2 text-[13px] text-tinta-2">
                        {NOMES[c.ultima_fala.quem as Quem] ?? c.ultima_fala.quem}: {c.ultima_fala.texto}
                      </span>
                    )}
                    <span className="flex flex-wrap gap-1.5">
                      {c.tipo === "chamada_web" ? (
                        <Pilula tom="terracota">Chamada web</Pilula>
                      ) : (
                        <Pilula>Chat</Pilula>
                      )}
                      {c.simulada && (
                        <Pilula tom="ambar" icone={FlaskConical}>
                          Simulada
                        </Pilula>
                      )}
                      {c.familiar && (
                        <Pilula tom="verde" icone={Eye}>
                          Familiar
                        </Pilula>
                      )}
                      {c.alertas.map((a) => (
                        <Pilula key={a} tom="terracota" icone={AlertTriangle}>
                          {ALERTA[a as Alerta["tipo"]] ?? a}
                        </Pilula>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Estado>
        </Cartao>
        {atual ? (
          <ConversaAoVivo key={atual} id={atual} />
        ) : (
          <Cartao className="flex flex-col items-center gap-3 p-10 text-center">
            <Headset className="size-8 text-tinta-3" aria-hidden />
            <p className="max-w-md text-sm text-tinta-2">
              Quando houver uma chamada a decorrer, a conversa aparece aqui em direto, com
              sugestões a cada fala do munícipe.
            </p>
          </Cartao>
        )}
      </div>
    </div>
  );
}

function ConversaAoVivo({ id }: { id: string }) {
  const { token, pedido } = useSessao();
  const detalhe = useDados<Detalhe>(`/v1/painel/ao-vivo/conversas/${id}`);
  const [novas, setNovas] = useState<Fala[]>([]);
  const [familiar, setFamiliar] = useState<Detalhe["familiar"] | null>(null);
  const [terminou, setTerminou] = useState(false);
  const fim = useRef<HTMLLIElement | null>(null);
  const d = detalhe.dados;
  const desde = d ? (d.falas.at(-1)?.seq ?? 0) : null;
  const simulada = !!d?.conversa.simulada;
  const temLink = !!d?.link_simulacao;
  const { recarregar } = detalhe;
  const recarregou = useRef(false);

  useEffect(() => {
    if (!token || desde === null || !d?.conversa.a_decorrer) return;
    const ac = new AbortController();
    (async () => {
      try {
        for await (const ev of sse(
          `/v1/painel/ao-vivo/conversas/${id}/eventos?desde=${desde}`,
          { token, municipio: municipioEscolhido(), sinal: ac.signal },
        )) {
          if (ev.evento === "fala") setNovas((n) => [...n, ev.dados as Fala]);
          else if (ev.evento === "familiar") {
            const fam = ev.dados as Detalhe["familiar"];
            setFamiliar(fam);
            // Simulação: o link do familiar só existe depois de o juntar.
            if (fam.ativo && simulada && !temLink && !recarregou.current) {
              recarregou.current = true;
              recarregar();
            }
          }
          else if (ev.evento === "fim") setTerminou(true);
        }
      } catch {
        // a ligação caiu: o botão "atualizar" volta a abrir
      }
    })();
    return () => ac.abort();
  }, [id, token, desde, d?.conversa.a_decorrer, simulada, temLink, recarregar]);

  const falas = d ? [...d.falas, ...novas.filter((n) => n.seq > (desde ?? 0))] : [];
  const ultimaDoMunicipe = [...falas].reverse().find((f) => f.quem === "municipe")?.seq ?? null;

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [falas.length]);

  if (!d) return <Cartao><Estado aCarregar={detalhe.aCarregar} erro={detalhe.erro} /></Cartao>;

  const aDecorrer = d.conversa.a_decorrer && !terminou;
  const fam = familiar ?? d.familiar;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Cartao className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-linha px-5 py-3.5">
            <span className="relative flex size-2.5">
              {aDecorrer && (
                <span className="absolute inline-flex size-full rounded-full bg-terracota opacity-60 motion-safe:animate-ping" />
              )}
              <span className={`relative inline-flex size-2.5 rounded-full ${aDecorrer ? "bg-terracota" : "bg-tinta-3"}`} />
            </span>
            <h2 className="font-display text-lg font-bold text-tinta">
              {d.conversa.tipo === "chamada_web" ? "Chamada web" : "Chat no site"}
            </h2>
            <span className="text-xs text-tinta-3">{aDecorrer ? "em direto" : "terminada"}</span>
            {d.conversa.simulada && (
              <Pilula tom="ambar" icone={FlaskConical}>
                Chamada simulada
              </Pilula>
            )}
            {fam.ativo && (
              <Pilula tom="verde" icone={Eye}>
                {maiuscula(fam.quem ?? "Familiar")} a acompanhar
              </Pilula>
            )}
            <Link
              href={`/painel/conversas/${d.conversa.id}`}
              className="ml-auto text-xs font-semibold text-terracota-escuro hover:underline"
            >
              Ficha da conversa
            </Link>
          </div>
          <ol
            aria-live="polite"
            aria-label="Transcrição em direto"
            className="flex max-h-[520px] min-h-[280px] flex-col gap-2.5 overflow-y-auto px-5 py-4"
          >
            {!falas.length && (
              <li className="text-sm text-tinta-3">À espera da primeira fala…</li>
            )}
            {falas.map((f) => (
              <LinhaFala key={`${f.quem}-${f.seq}`} f={f} />
            ))}
            <li ref={fim} aria-hidden className="h-0" />
          </ol>
          {d.conversa.simulada && d.link_simulacao && (
            <p className="border-t border-linha px-5 py-2.5 text-xs text-tinta-2">
              Simulação: o SMS do familiar ficou gravado (não saiu). Abra o{" "}
              <a href={d.link_simulacao} target="_blank" rel="noreferrer" className="font-semibold text-terracota-escuro underline">
                link do familiar
              </a>{" "}
              para ver a página dele.
            </p>
          )}
        </Cartao>
        {d.pode_assumir && aDecorrer && (
          <Assumir id={id} familiar={fam.ativo ? fam.quem : null} />
        )}
        {d.conversa.tipo === "chat" && aDecorrer && (
          <p className="text-xs text-tinta-3">
            No chat, o funcionário não escreve ao agente a meio: se for preciso, o agente passa o
            caso (fica em Conversas › Passagens).
          </p>
        )}
        {d.conversa.simulada && aDecorrer && (
          <div>
            <Botao
              variante="discreto"
              tamanho="pequeno"
              icone={PhoneOff}
              onClick={() =>
                void pedido(`/v1/painel/ao-vivo/conversas/${id}/terminar-simulacao`, {
                  metodo: "POST",
                }).then(() => setTerminou(true))
              }
            >
              Terminar a simulação
            </Botao>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-5">
        <Sugestoes id={id} fala={ultimaDoMunicipe} />
        <Ficha pessoa={d.pessoa} />
      </div>
    </div>
  );
}

function LinhaFala({ f }: { f: Fala }) {
  if (f.quem === "ferramenta") {
    const pedido = f.dados?.fase === "pedido";
    return (
      <li className="flex items-center gap-2 self-center rounded-full bg-creme-2 px-3 py-1 text-xs text-tinta-2">
        <Wrench className="size-3.5" aria-hidden />
        <span className={pedido ? "italic" : "font-semibold text-tinta"}>{f.texto}</span>
      </li>
    );
  }
  const estilos: Record<Exclude<Quem, "ferramenta">, string> = {
    municipe: "self-start rounded-[4px_16px_16px_16px] bg-creme-2",
    agente: "self-end rounded-[16px_4px_16px_16px] border border-linha bg-papel",
    funcionario: "self-end rounded-[16px_4px_16px_16px] bg-tinta text-white",
    familiar: "self-start rounded-[4px_16px_16px_16px] bg-verde-suave",
  };
  const nome =
    f.quem === "funcionario" && typeof f.dados?.nome === "string"
      ? `Funcionário · ${f.dados.nome}`
      : f.quem === "familiar" && typeof f.dados?.quem === "string"
        ? `Familiar · ${f.dados.quem}`
        : NOMES[f.quem];
  return (
    <li className={`flex max-w-[85%] flex-col gap-1 px-3.5 py-2.5 ${estilos[f.quem]}`}>
      <span className={`text-[10px] font-bold tracking-[0.6px] uppercase ${f.quem === "funcionario" ? "text-white/70" : "text-tinta-3"}`}>
        {nome}
      </span>
      <span className="text-[14px] leading-[1.45]">{f.texto}</span>
    </li>
  );
}

function Assumir({ id, familiar }: { id: string; familiar: string | null }) {
  const { pedido } = useSessao();
  const [texto, setTexto] = useState("");
  const [enviadas, setEnviadas] = useState(0);
  const acao = useAcao();
  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Headset className="size-4 text-terracota" aria-hidden />
        <h3 className="text-sm font-semibold text-tinta">Assumir a conversa</h3>
      </div>
      <p className="text-[13px] text-tinta-2">
        Escreva o que o agente deve dizer. Ele diz à pessoa “O funcionário da câmara pede para lhe
        dizer…”. Fica registado com o seu nome.
        {familiar && ` ${maiuscula(familiar)} também vê a conversa.`}
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!texto.trim()) return;
          const r = await acao.executar(() =>
            pedido(`/v1/painel/ao-vivo/conversas/${id}/assumir`, { corpo: { texto } }),
          );
          if (r) {
            setTexto("");
            setEnviadas((n) => n + 1);
          }
        }}
      >
        <label className="sr-only" htmlFor="assumir-texto">
          Mensagem para o agente dizer
        </label>
        <input
          id="assumir-texto"
          value={texto}
          maxLength={500}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: o balcão de obras abre amanhã às 9h, pode lá ir sem marcação."
          className={`${classeEntrada} flex-1`}
        />
        <Botao type="submit" icone={Send} disabled={acao.aCorrer || !texto.trim()}>
          Enviar ao agente
        </Botao>
      </form>
      {enviadas > 0 && !acao.erro && (
        <p className="text-xs text-verde" role="status">
          Enviada. Aparece na conversa como “Funcionário”.
        </p>
      )}
      <ErroLinha erro={acao.erro} />
    </Cartao>
  );
}

function Sugestoes({ id, fala }: { id: string; fala: number | null }) {
  const { pedido } = useSessao();
  const [s, setS] = useState<Sugestao | null>(null);
  const [aPedir, setAPedir] = useState(false);
  const pedir = useCallback(async () => {
    setAPedir(true);
    try {
      setS(await pedido<Sugestao>(`/v1/painel/ao-vivo/conversas/${id}/sugestao`, { metodo: "POST" }));
    } catch {
      // fica a sugestão anterior
    } finally {
      setAPedir(false);
    }
  }, [id, pedido]);

  // Debounce: só pede quando o munícipe acabou de falar.
  useEffect(() => {
    if (fala === null) return;
    const t = setTimeout(() => void pedir(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fala, pedir]);

  return (
    <Cartao className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-terracota" aria-hidden />
        <h3 className="text-sm font-semibold text-tinta">Ajuda ao funcionário</h3>
        {aPedir && <span className="ml-auto text-xs text-tinta-3">a pensar…</span>}
      </div>
      {!s && (
        <p className="text-[13px] text-tinta-3">
          A cada fala do munícipe aparecem aqui a regra que se aplica, o que falta perguntar e
          alertas.
        </p>
      )}
      {s && (
        <>
          {s.alertas.length > 0 && (
            <ul className="flex flex-col gap-2">
              {s.alertas.map((a) => (
                <li
                  key={a.tipo}
                  role="alert"
                  className="flex gap-2 rounded-xl bg-terracota-suave px-3 py-2 text-[13px] text-terracota-escuro"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <strong>{ALERTA[a.tipo]}.</strong> {a.texto}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.sugestao?.dizer && (
            <div className="flex flex-col gap-1.5 rounded-xl bg-creme-2 p-3">
              <Rotulo>Pode pedir ao agente para dizer</Rotulo>
              <p className="text-[13px] leading-[1.45] text-tinta">{s.sugestao.dizer}</p>
              {s.sugestao.regra && <p className="text-xs text-tinta-3">{s.sugestao.regra}</p>}
            </div>
          )}
          {s.falta_perguntar.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2">
                <Rotulo>Falta perguntar</Rotulo>
                {s.falta_perguntar_demonstracao && (
                  <Pilula tom="ambar" icone={FlaskConical} className="!py-0.5 !text-[10px]">
                    valores de demonstração
                  </Pilula>
                )}
              </span>
              <ul className="flex flex-col gap-1">
                {s.falta_perguntar.map((p) => (
                  <li key={p} className="flex gap-2 text-[13px] text-tinta-2">
                    <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-tinta-3" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Rotulo>Regras e fontes oficiais</Rotulo>
            {s.regras.length === 0 && s.respostas_curadas.length === 0 && (
              <p className="text-[13px] text-tinta-3">Não encontrei uma fonte para isto.</p>
            )}
            {s.respostas_curadas.map((r) => (
              <div key={r.pergunta} className="rounded-xl border border-linha p-3">
                <p className="text-xs font-semibold text-tinta">Resposta aprovada: {r.pergunta}</p>
                <p className="mt-1 text-[13px] text-tinta-2">{r.texto}</p>
              </div>
            ))}
            {s.regras.map((r, i) => (
              <div key={`${r.titulo}-${i}`} className="rounded-xl border border-linha p-3">
                <p className="text-xs font-semibold text-tinta">
                  {r.titulo}
                  {r.referencia ? ` · ${r.referencia}` : ""}
                </p>
                <p className="mt-1 line-clamp-4 text-[13px] text-tinta-2">{r.texto}</p>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-terracota-escuro hover:underline">
                    Abrir a fonte
                  </a>
                )}
              </div>
            ))}
          </div>
          {!s.ia && s.motivo_sem_ia && <p className="text-xs text-tinta-3">{s.motivo_sem_ia}</p>}
        </>
      )}
    </Cartao>
  );
}

function Ficha({ pessoa }: { pessoa: Detalhe["pessoa"] }) {
  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <UserRound className="size-4 text-terracota" aria-hidden />
        <h3 className="text-sm font-semibold text-tinta">Ficha da pessoa</h3>
      </div>
      {!pessoa ? (
        <p className="text-[13px] text-tinta-3">
          Ainda não identificada. Fica ligada quando der o número ou o NIF.
        </p>
      ) : (
        <>
          <div>
            <p className="font-semibold text-tinta">{pessoa.nome ?? "Sem nome"}</p>
            <p className="text-xs text-tinta-3">
              {pessoa.telefone ?? "sem telefone"} · {pessoa.conversas}{" "}
              {pessoa.conversas === 1 ? "conversa" : "conversas"}
            </p>
          </div>
          {pessoa.processos.length > 0 && (
            <div className="flex flex-col gap-1">
              <Rotulo>Processos</Rotulo>
              {pessoa.processos.map((p) => (
                <Link key={p.id} href={`/painel/processos/${p.id}`} className="text-[13px] text-tinta hover:underline">
                  {p.numero} · {p.assunto} <span className="text-tinta-3">({p.fase})</span>
                </Link>
              ))}
            </div>
          )}
          {pessoa.ocorrencias.length > 0 && (
            <div className="flex flex-col gap-1">
              <Rotulo>Ocorrências</Rotulo>
              {pessoa.ocorrencias.map((o) => (
                <span key={o.id} className="text-[13px] text-tinta">
                  {o.numero} <span className="text-tinta-3">({o.estado})</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Cartao>
  );
}

function maiuscula(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
