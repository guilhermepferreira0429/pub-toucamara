"use client";

import { ArrowLeft, Bot, Check, Mic, MicOff, Send, SkipForward, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  Cartao,
  classeEntrada,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { useDitado } from "./ditado";
import { AvisoInterno } from "./procedimentos";

/*
 * Entrevista de quem se vai reformar: uma pergunta de cada vez, resposta
 * escrita ou ditada (o browser transcreve). No fim, o rascunho do
 * procedimento fica pronto para rever.
 */

interface Turno {
  id: string;
  ordem: number;
  chave: string;
  pergunta: string;
  resposta: string | null;
  por_voz: boolean;
  respondida_em: string | null;
}

interface Entrevista {
  id: string;
  area: string;
  entrevistado_id: string;
  entrevistado_nome: string;
  modo: "ia" | "guiao";
  estado: "em_curso" | "concluida" | "cancelada";
  procedimento_id: string | null;
  criada_em: string;
  guiao_total: number;
  turnos: Turno[];
  pergunta_atual: Turno | null;
  pode_concluir: boolean;
}

interface Concluida {
  procedimento_id: string;
  ia: boolean;
  motivo_sem_ia: string | null;
}

export function PaginaEntrevista() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { pode, pedido, eu } = useSessao();
  const ver = pode("procedimentos_ver");
  const d = useDados<Entrevista>(ver ? `/v1/painel/procedimentos/entrevistas/${id}` : null);
  const [texto, setTexto] = useState("");
  const [porVoz, setPorVoz] = useState(false);
  const [fim, setFim] = useState<Concluida | null>(null);
  const base = useRef("");
  const acao = useAcao();

  const aoTexto = useCallback((t: string) => {
    setTexto(base.current ? `${base.current} ${t}` : t);
  }, []);
  const ditado = useDitado(aoTexto);

  if (!ver) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Procedimentos", "Entrevista"]} titulo="Entrevista" />
        <SemAcesso />
      </div>
    );
  }

  const e = d.dados;
  const podeResponder = !!e && (e.entrevistado_id === eu?.utilizador.id || pode("procedimentos"));

  const enviar = async (saltar = false) => {
    if (ditado.aOuvir) ditado.alternar();
    const corpo = saltar ? { saltar: true } : { resposta: texto, por_voz: porVoz };
    const r = await acao.executar(() =>
      pedido<Entrevista>(`/v1/painel/procedimentos/entrevistas/${id}/responder`, { metodo: "POST", corpo }),
    );
    if (r) {
      d.mudar(() => r);
      setTexto("");
      setPorVoz(false);
    }
  };

  const concluir = async () => {
    const r = await acao.executar(() =>
      pedido<Concluida>(`/v1/painel/procedimentos/entrevistas/${id}/concluir`, { metodo: "POST" }),
    );
    if (r) {
      setFim(r);
      d.recarregar();
    }
  };

  const cancelar = async () => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/procedimentos/entrevistas/${id}/cancelar`, { metodo: "POST" }),
    );
    if (r) router.push("/painel/procedimentos");
  };

  const respondidas = e?.turnos.filter((t) => t.respondida_em).length ?? 0;

  return (
    <div className="flex flex-col pb-12">
      <div className="px-10 pt-6">
        <Link href="/painel/procedimentos" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-tinta-2">
          <ArrowLeft className="size-4" aria-hidden /> Procedimentos
        </Link>
      </div>
      <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={!e}>
        {e && (
          <>
            <CabecalhoPagina
              migalhas={["Procedimentos", "Entrevista"]}
              titulo={e.area}
              descricao={
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {e.entrevistado_nome} · começou {quando(e.criada_em)} · {respondidas} respostas
                  </span>
                  <Pilula tom={e.modo === "ia" ? "tinta" : "neutro"}>
                    {e.modo === "ia" ? "perguntas com IA" : "guião fixo"}
                  </Pilula>
                  {e.estado !== "em_curso" && (
                    <Pilula tom={e.estado === "concluida" ? "verde" : "neutro"}>{e.estado === "concluida" ? "concluída" : "cancelada"}</Pilula>
                  )}
                </span>
              }
              acoes={
                e.estado === "em_curso" && podeResponder ? (
                  <>
                    <Botao variante="discreto" icone={X} onClick={() => void cancelar()} disabled={acao.aCorrer}>
                      Cancelar
                    </Botao>
                    <Botao icone={Check} onClick={() => void concluir()} disabled={!e.pode_concluir || acao.aCorrer}>
                      Concluir e escrever o rascunho
                    </Botao>
                  </>
                ) : e.procedimento_id ? (
                  <Link
                    href={`/painel/procedimentos/${e.procedimento_id}`}
                    className="rounded-full bg-terracota px-4 py-2 text-sm font-semibold text-white"
                  >
                    Ver o rascunho
                  </Link>
                ) : null
              }
            />
            <AvisoInterno />

            <div className="mx-10 flex max-w-3xl flex-col gap-4">
              {fim && (
                <Cartao className="flex flex-col gap-2 border-verde/40 bg-verde-suave/40 p-5">
                  <p className="font-semibold text-tinta">Obrigado! O rascunho está escrito.</p>
                  <p className="text-sm text-tinta-2">
                    {fim.ia
                      ? "Foi redigido com IA a partir das suas respostas. Reveja-o antes de a chefia o publicar."
                      : fim.motivo_sem_ia}
                  </p>
                  <Link
                    href={`/painel/procedimentos/${fim.procedimento_id}`}
                    className="self-start font-semibold text-terracota underline"
                  >
                    Abrir o rascunho
                  </Link>
                </Cartao>
              )}

              <ol className="flex flex-col gap-3">
                {e.turnos.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2">
                    <div className="flex max-w-[85%] items-start gap-2">
                      <Bot className="mt-1 size-4 shrink-0 text-terracota" aria-hidden />
                      <p className="rounded-2xl rounded-tl-sm bg-papel px-4 py-2.5 text-sm text-tinta shadow-sm">
                        {t.pergunta}
                      </p>
                    </div>
                    {t.respondida_em && (
                      <p className="max-w-[85%] self-end whitespace-pre-line rounded-2xl rounded-tr-sm bg-tinta px-4 py-2.5 text-sm text-white">
                        {t.resposta ?? <span className="italic opacity-70">(saltou a pergunta)</span>}
                        {t.por_voz && <span className="mt-1 block text-[11px] opacity-70">ditado por voz</span>}
                      </p>
                    )}
                  </li>
                ))}
              </ol>

              {e.estado === "em_curso" && !e.pergunta_atual && (
                <p className="rounded-xl bg-creme-2 px-4 py-3 text-sm text-tinta-2">
                  Já não há mais perguntas. Carregue em &quot;Concluir e escrever o rascunho&quot;.
                </p>
              )}

              {e.estado === "em_curso" && e.pergunta_atual && podeResponder && (
                <Cartao className="flex flex-col gap-3 p-4">
                  <label htmlFor="resposta" className="sr-only">
                    A sua resposta
                  </label>
                  <textarea
                    id="resposta"
                    className={`${classeEntrada} min-h-32`}
                    placeholder={ditado.aOuvir ? "A ouvir… fale à vontade." : "Escreva como explicaria a um colega novo."}
                    value={texto}
                    onChange={(ev) => setTexto(ev.target.value)}
                  />
                  <ErroLinha erro={acao.erro} />
                  <div className="flex flex-wrap items-center gap-2">
                    {ditado.suportado && (
                      <Botao
                        variante={ditado.aOuvir ? "principal" : "secundario"}
                        icone={ditado.aOuvir ? MicOff : Mic}
                        aria-pressed={ditado.aOuvir}
                        onClick={() => {
                          if (!ditado.aOuvir) {
                            base.current = texto.trim();
                            setPorVoz(true);
                          }
                          ditado.alternar();
                        }}
                      >
                        {ditado.aOuvir ? "Parar de ditar" : "Responder por voz"}
                      </Botao>
                    )}
                    <span className="flex-1" />
                    <Botao variante="discreto" icone={SkipForward} onClick={() => void enviar(true)} disabled={acao.aCorrer}>
                      Saltar
                    </Botao>
                    <Botao icone={Send} onClick={() => void enviar()} disabled={!texto.trim() || acao.aCorrer}>
                      {acao.aCorrer ? "A guardar…" : "Responder"}
                    </Botao>
                  </div>
                  {ditado.suportado && (
                    <p className="text-xs text-tinta-3">
                      A voz é transcrita pelo próprio browser e fica no campo para rever antes de enviar. A gravação não
                      é guardada.
                    </p>
                  )}
                </Cartao>
              )}
              {e.estado === "em_curso" && !podeResponder && (
                <p className="text-sm text-tinta-3">Só {e.entrevistado_nome} (ou a chefia) responde a esta entrevista.</p>
              )}
            </div>
          </>
        )}
      </Estado>
    </div>
  );
}
