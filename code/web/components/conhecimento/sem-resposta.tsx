"use client";

import { ArrowRight, FileDiff, Rocket, Save, Send, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  Campo,
  Cartao,
  classeEntrada,
  ErroLinha,
  Estado,
  haQuanto,
  Pilula,
  Rotulo,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "./comum";
import { linhas, usePodeEditarRespostas } from "./formulario-resposta";
import { Melhorias } from "./melhorias";
import { ErroPublicacao } from "./publicacao";
import type { EstadoPsr, Mapa, PerguntaSemResposta, Resposta } from "./tipos";

const ESTADOS: Record<EstadoPsr, { rotulo: string; tom: "ambar" | "neutro" | "verde" | "terracota" }> = {
  nova: { rotulo: "nova", tom: "ambar" },
  com_equipa: { rotulo: "com a equipa Tou, Câmara?", tom: "neutro" },
  espera_camara: { rotulo: "à espera da câmara", tom: "terracota" },
  resolvida: { rotulo: "resolvida", tom: "verde" },
  fora_ambito: { rotulo: "fora do âmbito", tom: "neutro" },
};

const FILTROS: { id: "" | EstadoPsr; rotulo: string }[] = [
  { id: "", rotulo: "Todas" },
  { id: "nova", rotulo: "Novas" },
  { id: "com_equipa", rotulo: "Com a equipa" },
  { id: "espera_camara", rotulo: "À espera da câmara" },
  { id: "resolvida", rotulo: "Resolvidas" },
];

interface TrechoEncontrado {
  trecho_id: string;
  titulo: string;
  referencia: string | null;
  entidade: string;
  texto: string;
}

/** A fonte oficial da resposta: a mesma pesquisa que o agente usa. */
function FonteOficial({
  pergunta,
  escolhidos,
  onMudar,
}: {
  pergunta: string;
  escolhidos: string[];
  onMudar: (ids: string[]) => void;
}) {
  const [q, setQ] = useState(pergunta);
  const [aplicada, setAplicada] = useState(pergunta);
  useEffect(() => {
    const t = setTimeout(() => setAplicada(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const r = useDados<{ itens: TrechoEncontrado[] }>(
    aplicada.length >= 2
      ? `/v1/painel/conhecimento/trechos?limite=5&q=${encodeURIComponent(aplicada.slice(0, 200))}`
      : null,
  );
  const alternar = (id: string) =>
    onMudar(escolhidos.includes(id) ? escolhidos.filter((x) => x !== id) : [...escolhidos, id]);
  return (
    <div className="flex flex-col gap-2">
      <Campo rotulo="Fonte oficial" ajuda="Escolha o trecho que o agente cita. Sem fonte, a resposta vale menos no teste.">
        <input className={classeEntrada} value={q} onChange={(e) => setQ(e.target.value)} />
      </Campo>
      <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {(r.dados?.itens ?? []).map((t) => (
          <li key={t.trecho_id}>
            <label
              className={`flex cursor-pointer gap-2.5 rounded-xl border p-2.5 text-[13px] ${
                escolhidos.includes(t.trecho_id) ? "border-terracota bg-terracota-suave/50" : "border-linha"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-terracota"
                checked={escolhidos.includes(t.trecho_id)}
                onChange={() => alternar(t.trecho_id)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-tinta">
                  {t.titulo}
                  {t.referencia ? ` · ${t.referencia}` : ""}
                  <span className="font-normal text-tinta-3"> · {t.entidade}</span>
                </span>
                <span className="line-clamp-2 text-tinta-2">{t.texto}</span>
              </span>
            </label>
          </li>
        ))}
        {r.dados && r.dados.itens.length === 0 && (
          <li className="text-xs text-tinta-3">Nenhum trecho encontrado. Tente outras palavras.</li>
        )}
      </ul>
    </div>
  );
}

const JARGAO = ["requerente", "deferimento", "indeferimento", "instrução do processo", "supra", "outrossim"];

/** "Linguagem simples · 2 frases curtas": avisa o que a pessoa não percebe. */
function LinguagemSimples({ texto }: { texto: string }) {
  const t = texto.trim();
  if (!t) return null;
  const frases = t.split(/[.!?]+\s/).filter((f) => f.trim());
  const palavras = t.split(/\s+/).length;
  const media = Math.round(palavras / Math.max(1, frases.length));
  const jargao = JARGAO.filter((j) => t.toLowerCase().includes(j));
  const bom = media <= 20 && jargao.length === 0;
  return (
    <p className={`rounded-xl px-3 py-2 text-xs ${bom ? "bg-verde-suave text-verde" : "bg-ambar-suave text-ambar"}`}>
      {bom ? "Linguagem simples" : "Pode ficar mais simples"} · {frases.length}{" "}
      {frases.length === 1 ? "frase" : "frases"}, {media} palavras em média
      {jargao.length ? ` · evite: ${jargao.join(", ")}` : ""}
    </p>
  );
}

function Responder({
  pergunta,
  onMudou,
}: {
  pergunta: PerguntaSemResposta;
  onMudou: (p: Partial<PerguntaSemResposta>) => void;
}) {
  const { pedido, pode } = useSessao();
  const editar = usePodeEditarRespostas();
  const [texto, setTexto] = useState("");
  const [sms, setSms] = useState("");
  const [passa, setPassa] = useState("");
  const [falta, setFalta] = useState(pergunta.o_que_falta ?? "");
  const [trechos, setTrechos] = useState<string[]>([]);
  const [criada, setCriada] = useState<Resposta | null>(null);
  const guardar = useAcao();
  const publicar = useAcao();
  const estado = useAcao();
  const fechada = pergunta.estado === "resolvida" || pergunta.estado === "fora_ambito";

  const mudarEstado = async (corpo: Record<string, unknown>, caminho = "") => {
    const p = await estado.executar(() =>
      pedido<PerguntaSemResposta>(
        `/v1/painel/conhecimento/sem-resposta/${pergunta.id}${caminho}`,
        caminho ? { metodo: "POST" } : { metodo: "PATCH", corpo },
      ),
    );
    if (p) onMudou(p);
  };

  const responder = async (): Promise<Resposta | undefined> => {
    if (criada) return criada;
    const r = await guardar.executar(() =>
      pedido<{ pergunta: PerguntaSemResposta; resposta: Resposta }>(
        `/v1/painel/conhecimento/sem-resposta/${pergunta.id}/responder`,
        {
          corpo: {
            texto_voz: texto.trim(),
            texto_sms: sms.trim() || null,
            passa_a_pessoa_quando: linhas(passa),
            trechos,
          },
        },
      ),
    );
    if (r) {
      setCriada(r.resposta);
      onMudou(r.pergunta);
      return r.resposta;
    }
  };

  return (
    <Cartao className="flex flex-col gap-[18px] p-6">
      <div className="flex flex-col gap-1.5">
        <Rotulo>{pergunta.resposta_id || criada ? "Pergunta com resposta" : "Nova resposta"}</Rotulo>
        <h2 className="font-display text-[22px] font-bold text-tinta">“{pergunta.texto}”</h2>
        <div className="flex flex-wrap gap-1.5">
          <Pilula tom={ESTADOS[pergunta.estado].tom}>{ESTADOS[pergunta.estado].rotulo}</Pilula>
          <Pilula>
            {pergunta.vezes}× · última {haQuanto(pergunta.ultima_em)}
          </Pilula>
        </div>
      </div>

      {pergunta.resposta_id || criada ? (
        <div className="flex flex-col gap-3 rounded-xl bg-verde-suave p-4 text-sm text-tinta">
          <p>
            Ligada à resposta{" "}
            <strong>«{criada?.pergunta_tipo ?? pergunta.resposta ?? "sem título"}»</strong>. A
            pergunta fica resolvida quando a resposta for para o ar.
          </p>
          <BotaoLink
            href={`/painel/conhecimento/respostas?id=${criada?.id ?? pergunta.resposta_id}`}
            variante="secundario"
            tamanho="pequeno"
            icone={ArrowRight}
            className="w-fit"
          >
            Abrir a resposta
          </BotaoLink>
          {criada && editar.pode && !criada.versao_no_ar_id && (
            <>
              <Botao
                tamanho="pequeno"
                icone={Rocket}
                className="w-fit"
                disabled={publicar.aCorrer}
                onClick={async () => {
                  const v = criada.versoes[0];
                  if (!v) return;
                  const nova = await publicar.executar(() =>
                    pedido<Resposta>(`/v1/painel/conhecimento/respostas/${criada.id}/publicar`, {
                      corpo: { versao_id: v.id },
                    }),
                  );
                  if (nova) {
                    setCriada(nova);
                    onMudou({ estado: "resolvida" });
                  }
                }}
              >
                Publicar no agente
              </Botao>
              <ErroPublicacao erro={publicar.erro} interno={editar.interno} />
            </>
          )}
        </div>
      ) : fechada ? (
        <p className="text-sm text-tinta-2">Esta pergunta já está fechada.</p>
      ) : editar.pode ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await responder();
          }}
        >
          <Campo rotulo="O que o agente vai dizer">
            <textarea
              className={`${classeEntrada} min-h-24`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              required
              maxLength={4000}
            />
          </Campo>
          <LinguagemSimples texto={texto} />
          <FonteOficial pergunta={pergunta.texto} escolhidos={trechos} onMudar={setTrechos} />
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="No SMS (opcional)" ajuda={`${sms.length} / 160`}>
              <textarea className={`${classeEntrada} min-h-16`} value={sms} onChange={(e) => setSms(e.target.value)} maxLength={640} />
            </Campo>
            <Campo rotulo="Passa a funcionário quando (uma por linha)">
              <textarea className={`${classeEntrada} min-h-16`} value={passa} onChange={(e) => setPassa(e.target.value)} placeholder="Pedirem um prazo ou um custo" />
            </Campo>
          </div>
          <p className="rounded-xl bg-creme-2 p-3 text-xs text-tinta-2">
            As frases reais com que as pessoas fizeram esta pergunta entram na resposta como
            “as pessoas perguntam assim”. Antes de publicar, a resposta passa pelo teste do agente.
          </p>
          <ErroLinha erro={guardar.erro} />
          <div className="flex justify-end gap-2">
            <Botao type="submit" variante="secundario" icone={Save} disabled={guardar.aCorrer || !texto.trim()}>
              Guardar rascunho
            </Botao>
            <Botao
              icone={Rocket}
              disabled={guardar.aCorrer || publicar.aCorrer || !texto.trim()}
              onClick={async () => {
                const r = await responder();
                const v = r?.versoes[0];
                if (!r || !v) return;
                const nova = await publicar.executar(() =>
                  pedido<Resposta>(`/v1/painel/conhecimento/respostas/${r.id}/publicar`, {
                    corpo: { versao_id: v.id },
                  }),
                );
                if (nova) {
                  setCriada(nova);
                  onMudou({ estado: "resolvida" });
                }
              }}
            >
              Publicar no agente
            </Botao>
          </div>
          <ErroPublicacao erro={publicar.erro} interno={editar.interno} />
        </form>
      ) : (
        <p className="rounded-xl bg-creme p-4 text-sm text-tinta-2">
          Neste município só a equipa Tou, Câmara? escreve as respostas. Pode pedir-lhe que trate
          desta pergunta.
        </p>
      )}

      {pode("conhecimento") && !fechada && (
        <div className="flex flex-col gap-3 border-t border-linha pt-4">
          <Campo rotulo="O que falta para responder (opcional)">
            <textarea
              className={`${classeEntrada} min-h-14`}
              value={falta}
              maxLength={1000}
              onChange={(e) => setFalta(e.target.value)}
              placeholder="Precisamos de uma regra escrita do Património."
            />
          </Campo>
          <div className="flex flex-wrap gap-2">
            <Botao
              variante="secundario"
              tamanho="pequeno"
              disabled={estado.aCorrer}
              onClick={() => mudarEstado({ o_que_falta: falta.trim() || null })}
            >
              Guardar nota
            </Botao>
            {pergunta.estado !== "com_equipa" && (
              <Botao
                variante="secundario"
                tamanho="pequeno"
                icone={Users}
                disabled={estado.aCorrer}
                onClick={() => mudarEstado({}, "/pedir-equipa")}
              >
                Pedir à equipa Tou, Câmara?
              </Botao>
            )}
            <Botao
              variante="discreto"
              tamanho="pequeno"
              disabled={estado.aCorrer}
              onClick={() => mudarEstado({ estado: "fora_ambito" })}
            >
              Fora do âmbito
            </Botao>
          </div>
          <ErroLinha erro={estado.erro} />
        </div>
      )}
    </Cartao>
  );
}

export function SemResposta() {
  const [filtro, setFiltro] = useState<"" | EstadoPsr>("");
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const mapa = useDados<Mapa>("/v1/painel/conhecimento/mapa");
  const base = `/v1/painel/conhecimento/sem-resposta?limite=50${filtro ? `&estado=${filtro}` : ""}`;
  const lista = useDados<Pagina<PerguntaSemResposta>>(base);
  const mais = useMais(base, lista);
  const itens = lista.dados?.itens ?? [];
  const atual = itens.find((p) => p.id === escolhida) ?? itens.find((p) => p.estado === "nova") ?? itens[0];
  const porRever = mapa.dados?.resumo.alteracoes_por_rever ?? 0;

  return (
    <div className="flex flex-col gap-5 px-10">
      {porRever > 0 && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-[14px] bg-ambar-suave px-[18px] py-3.5">
          <FileDiff className="size-5 text-ambar" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm font-bold text-ambar">
              {porRever === 1
                ? "Uma fonte oficial mudou"
                : `${porRever} alterações nas fontes oficiais`}
            </p>
            <p className="text-[13px] text-tinta-2">
              Há respostas do agente que citam o texto antigo. Preparámos as correções para rever.
            </p>
          </div>
          <Link
            href="/painel/conhecimento/alteracoes"
            className="flex h-[34px] items-center rounded-[17px] bg-ambar px-3.5 text-[13px] font-semibold text-white hover:bg-ambar/90"
          >
            Rever alterações
          </Link>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
        <Cartao className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-linha px-5 py-4">
            <Rotulo>Perguntas sem resposta</Rotulo>
            <label className="text-xs font-semibold text-tinta-2">
              <span className="sr-only">Estado</span>
              <select
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as "" | EstadoPsr)}
                className="bg-transparent outline-none"
              >
                {FILTROS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Estado
            aCarregar={lista.aCarregar}
            erro={lista.erro}
            vazio={!itens.length}
            textoVazio="Não há perguntas sem resposta. O agente está a responder a tudo."
          >
            <ul className="max-h-[calc(100dvh-280px)] overflow-y-auto">
              {itens.map((p) => {
                const ativo = p.id === atual?.id;
                return (
                  <li key={p.id} className="border-b border-linha last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setEscolhida(p.id)}
                      aria-current={ativo ? "true" : undefined}
                      className={`flex w-full items-start gap-3 px-5 py-3.5 text-left ${ativo ? "bg-creme" : "hover:bg-creme/60"}`}
                    >
                      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[17px_17px_17px_4px] bg-ambar-suave text-xs font-bold text-ambar">
                        {p.vezes}×
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm font-semibold text-tinta">{p.texto}</span>
                        <span className="text-xs text-tinta-3">
                          {ESTADOS[p.estado].rotulo} · última {haQuanto(p.ultima_em)}
                          {p.resposta ? ` · resposta: ${p.resposta}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {mais.haMais && (
              <div className="border-t border-linha p-3">
                <Botao variante="discreto" tamanho="pequeno" onClick={mais.mais} disabled={mais.aCorrer}>
                  Ver mais
                </Botao>
              </div>
            )}
          </Estado>
        </Cartao>

        {atual ? (
          <Responder
            key={atual.id}
            pergunta={atual}
            onMudou={(p) =>
              lista.mudar((d) => ({
                ...d,
                itens: d.itens.map((x) => (x.id === atual.id ? { ...x, ...p } : x)),
              }))
            }
          />
        ) : (
          !lista.aCarregar && (
            <Cartao className="p-6 text-sm text-tinta-2">
              <Send className="mb-2 size-5 text-tinta-3" aria-hidden />
              Quando o agente não souber responder, a pergunta aparece aqui.
            </Cartao>
          )
        )}
      </div>

      <Melhorias />
    </div>
  );
}
