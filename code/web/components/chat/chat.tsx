"use client";

import {
  ArrowUp,
  ChevronLeft,
  Clock,
  FileText,
  Mic,
  RotateCw,
  Siren,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BalaoAgente,
  BalaoPessoa,
  IndicadorAEscrever,
  RespostasRapidas,
} from "./baloes";
import { CartaoChat, type AcoesCartao } from "./cartoes";
import { IdentificacaoSms } from "./identificacao";
import type { Mensagem } from "./tipos";
import { useChat } from "./use-chat";

/* ------------------------------------------------------------------ */

const MUNICIPIO_SITE = process.env.NEXT_PUBLIC_MUNICIPIO ?? "guimaraes";

/** O que o agente está a fazer, pelo nome da ferramenta (evento `ferramenta`). */
const A_FAZER: Record<string, string> = {
  procurar_conhecimento: "A consultar as fontes oficiais…",
  ver_vagas: "A ver as vagas…",
  marcar: "A marcar…",
  cancelar_marcacao: "A desmarcar…",
  agendar_recolha: "A agendar a recolha…",
  simular_taxa: "A calcular a taxa…",
  criar_pagamento: "A preparar o pagamento…",
  redigir: "A escrever o texto…",
  encaminhar: "A procurar o contacto certo…",
  iniciar_requerimento: "A preparar o requerimento…",
  preencher_campo: "A preencher o requerimento…",
  concluir_requerimento: "A concluir o requerimento…",
  registar_ocorrencia: "A registar a ocorrência…",
  estado_ocorrencia: "A consultar a ocorrência…",
  estado_processo: "A consultar o processo…",
  identificar_municipe: "A confirmar os seus dados…",
  passar_a_humano: "A passar a um funcionário…",
  conversa_anterior: "A rever a conversa anterior…",
  emergencia: "A tratar da emergência…",
  consultas_abertas: "A ver as consultas públicas…",
  participar_consulta: "A registar a sua opinião…",
};

const SUGESTOES = [
  "Quero fazer obras em casa",
  "Licença de esplanada",
  "Recolha de monos",
  "Marcar atendimento",
];

const PEDIR_PESSOA = "Quero falar com uma pessoa.";

/** A língua do browser (para o subtítulo "responde na sua língua"). */
const subscreverNada = () => () => {};
function useLinguaBrowser() {
  return useSyncExternalStore(
    subscreverNada,
    () => navigator.language || "pt-PT",
    () => "pt-PT",
  );
}

/* ------------------------------------------------------------------ */
/* Ditado por voz (Web Speech API, quando o browser a tem)              */
/* ------------------------------------------------------------------ */

interface ReconhecimentoFala {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type ConstrutorFala = new () => ReconhecimentoFala;

function construtorFala(): ConstrutorFala | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorFala;
    webkitSpeechRecognition?: ConstrutorFala;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function useDitado(lingua: string, aoTexto: (t: string) => void) {
  const suportado = useSyncExternalStore(
    subscreverNada,
    () => construtorFala() !== null,
    () => false,
  );
  const [aOuvir, setAOuvir] = useState(false);
  const rec = useRef<ReconhecimentoFala | null>(null);

  const alternar = useCallback(() => {
    if (rec.current) {
      rec.current.stop();
      return;
    }
    const C = construtorFala();
    if (!C) return;
    const r = new C();
    r.lang = lingua;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      aoTexto(t);
    };
    r.onend = r.onerror = () => {
      rec.current = null;
      setAOuvir(false);
    };
    rec.current = r;
    setAOuvir(true);
    r.start();
  }, [lingua, aoTexto]);

  useEffect(() => () => rec.current?.stop(), []);
  return { suportado, aOuvir, alternar };
}

/* ------------------------------------------------------------------ */

export interface ChatControlo {
  focar(): void;
}

interface Props {
  /** "ecra": telemóvel, ecrã inteiro (06…17). "janela": chat no site (portal). */
  variante?: "ecra" | "janela";
  municipio?: string;
  /** Título do cabeçalho; por omissão "Câmara de <município>" (ecrã) ou o nome do agente (janela). */
  titulo?: string;
  /** "A ver: …" — a página em que a pessoa está (chat no site). */
  contexto?: string;
  /** Ecrã: para onde volta a seta. */
  voltarHref?: string;
  /** Janela: fechar. */
  aoFechar?: () => void;
  sugestoes?: string[];
  /** Para o portal: pôr o cursor no campo ao abrir. */
  ref?: React.Ref<ChatControlo>;
}

/**
 * O chat do munícipe: cabeçalho, conversa com balões e cartões, indicador do
 * que o agente está a fazer, identificação por SMS e estado sem ligação.
 */
export function Chat({
  variante = "ecra",
  municipio = MUNICIPIO_SITE,
  titulo,
  contexto,
  voltarHref = "/",
  aoFechar,
  sugestoes = SUGESTOES,
  ref,
}: Props) {
  const chat = useChat(municipio);
  const { enviar: enviarChat, ocupado } = chat;
  const idCampo = useId();
  const janela = variante === "janela";
  const lingua = useLinguaBrowser();
  const outraLingua = !lingua.toLowerCase().startsWith("pt");

  const [rascunho, setRascunho] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const colado = useRef(true);

  const focar = useCallback(() => campo.current?.focus(), []);
  useImperativeHandle(ref, () => ({ focar }), [focar]);

  const ditado = useDitado(lingua, setRascunho);

  // Desce com a conversa, a não ser que a pessoa tenha subido para ler.
  useEffect(() => {
    const el = scroller.current;
    if (el && colado.current) el.scrollTop = el.scrollHeight;
  }, [chat.mensagens]);

  // O campo cresce com o texto (até 5 linhas).
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [rascunho]);

  const enviar = useCallback(
    (texto: string) => {
      if (!texto.trim() || ocupado) return;
      colado.current = true;
      void enviarChat(texto);
    },
    [enviarChat, ocupado],
  );

  function submeter(ev?: React.FormEvent) {
    ev?.preventDefault();
    const t = rascunho.trim();
    if (!t || chat.ocupado) return;
    // O texto passa para a conversa (e fica lá, por enviar, se a rede falhar).
    setRascunho("");
    enviar(t);
    focar();
  }

  const acoes: AcoesCartao = {
    enviar,
    escrever: (t) => {
      if (t) setRascunho((r) => r || t);
      requestAnimationFrame(focar);
    },
    ocupado: chat.ocupado,
  };

  const temPerguntas = chat.mensagens.some((m) => m.papel === "pessoa");
  const primeiraHora = chat.mensagens[0]?.hora;
  // A identificação aparece depois da última resposta que consultou processos.
  const idIdentificar = [...chat.mensagens]
    .reverse()
    .find(
      (m) =>
        m.papel === "agente" &&
        m.estado === "feita" &&
        (m.usadas ?? []).some((u) => u === "estado_processo" || u === "identificar_municipe"),
    )?.id;
  const passouAPessoa = chat.mensagens.some((m) =>
    (m.usadas ?? []).includes("passar_a_humano"),
  );
  const tituloFinal =
    titulo ??
    (janela
      ? (chat.agente ?? "Tou, Câmara?")
      : chat.nomeMunicipio
        ? `Câmara de ${chat.nomeMunicipio}`
        : "Câmara Municipal");
  // Na janela o título da página é o do site; o do chat fica abaixo.
  const Titulo = janela ? "h2" : "h1";
  const subtitulo = outraLingua
    ? "Answers in your language"
    : janela
      ? "Responde com fonte oficial, 24h"
      : "Responde com fonte oficial";

  return (
    <section
      aria-label={`Chat ${tituloFinal}`}
      className={`flex h-full min-h-0 flex-col bg-creme ${janela ? "" : "w-full"}`}
    >
      {/* Cabeçalho */}
      <header
        className={`flex shrink-0 items-center gap-3 border-b border-linha ${janela ? "bg-papel py-4 pl-[18px] pr-4" : "pb-3.5 pl-3 pr-4 pt-3"}`}
      >
        {!janela && (
          <Link
            href={voltarHref}
            aria-label="Voltar"
            className="flex size-8 items-center justify-center rounded-full text-tinta hover:bg-creme-2"
          >
            <ChevronLeft className="size-6" aria-hidden />
          </Link>
        )}
        <span
          aria-hidden
          className={`flex shrink-0 items-center justify-center bg-terracota font-display font-extrabold text-white ${janela ? "size-9 rounded-[18px_18px_18px_5px] text-xl" : "size-10 rounded-[20px_20px_20px_5px] text-[22px]"}`}
        >
          ?
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <Titulo
            className={`truncate text-tinta ${janela ? "font-display text-[17px] font-bold" : "text-[15px] font-bold"}`}
          >
            {tituloFinal}
          </Titulo>
          <p className="truncate text-xs font-medium text-verde">{subtitulo}</p>
        </div>
        <button
          type="button"
          onClick={() => enviar(PEDIR_PESSOA)}
          disabled={chat.ocupado}
          aria-label="Falar com uma pessoa"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-terracota-suave font-semibold text-terracota-escuro transition-colors hover:bg-terracota-suave/70 disabled:opacity-60 ${janela ? "px-[11px] py-[7px] text-xs" : "px-3 py-2 text-[13px]"}`}
        >
          <UserRound className={janela ? "size-3.5" : "size-[15px]"} aria-hidden />
          Pessoa
        </button>
        {janela && aoFechar && (
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar o chat"
            className="flex size-8 items-center justify-center rounded-full text-tinta-2 hover:bg-creme-2"
          >
            <X className="size-5" aria-hidden />
          </button>
        )}
      </header>

      {/* Sem ligação (06e) / indisponível */}
      {(chat.ligacao === "sem_ligacao" || chat.ligacao === "indisponivel") && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2.5 bg-ambar-suave px-4 py-3"
        >
          <WifiOff className="size-4 shrink-0 text-ambar" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <p className="text-[13px] font-bold text-ambar">
              {chat.ligacao === "sem_ligacao" ? "Está sem ligação" : "O chat não está disponível"}
            </p>
            <p className="text-xs text-tinta-2">
              {chat.ligacao === "sem_ligacao"
                ? "A mensagem fica guardada e seguimos quando a rede voltar."
                : (chat.avisoGeral ?? "Tente daqui a pouco.")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void chat.tentarDeNovo()}
            disabled={chat.ocupado}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-ambar hover:bg-ambar/10"
          >
            Tentar
          </button>
        </div>
      )}

      {/* Conversa */}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          role="log"
          aria-live="off"
          aria-label="Conversa"
          className={`flex flex-col ${janela ? "gap-2.5 p-4" : "gap-3 px-4 pb-5 pt-4"}`}
        >
          {contexto && (
            <p className="flex items-center gap-1.5 self-start rounded-xl bg-creme-2 px-2.5 py-[5px] text-[11px] font-medium text-tinta-2">
              <FileText className="size-3" aria-hidden />A ver: {contexto}
            </p>
          )}
          {primeiraHora && !janela && (
            <p className="text-center text-[11px] font-medium text-tinta-3">
              Hoje, {primeiraHora}
            </p>
          )}
          {chat.ligacao === "a_iniciar" && chat.mensagens.length === 0 && (
            <IndicadorAEscrever rotulo="A ligar…" />
          )}

          {chat.mensagens.map((m) =>
            m.papel === "pessoa" ? (
              <LinhaPessoa
                key={m.id}
                m={m}
                aoTentar={() => void chat.tentarDeNovo()}
                ocupado={chat.ocupado}
              />
            ) : (
              <div key={m.id} className="flex flex-col gap-2">
                <RespostaAgente
                  m={m}
                  janela={janela}
                  acoes={acoes}
                  aoRepetir={() => chat.repetir(m.id)}
                />
                {m.id === idIdentificar && (
                  <div className={janela ? "w-full" : "w-full max-w-[310px]"}>
                    <IdentificacaoSms
                      chat={chat}
                      aoConfirmar={() => focar()}
                    />
                  </div>
                )}
              </div>
            ),
          )}

          {!temPerguntas && chat.ligacao === "pronto" && (
            <RespostasRapidas
              opcoes={sugestoes}
              aoEscolher={enviar}
              desativado={chat.ocupado}
              pequeno={janela}
            />
          )}

          {passouAPessoa && (
            <p className="flex items-center justify-center gap-2 py-1 text-xs font-semibold text-terracota-escuro">
              <Siren className="size-3.5" aria-hidden />
              Se for uma emergência, ligue{" "}
              <a href="tel:112" className="underline">
                112
              </a>
              .
            </p>
          )}
        </div>
      </div>

      {/* Anúncios para leitores de ecrã: só a resposta completa. */}
      <div aria-live="polite" className="sr-only">
        {chat.anuncio}
      </div>

      {/* Escrever */}
      <form
        onSubmit={submeter}
        className={`shrink-0 border-t border-linha bg-papel ${janela ? "flex flex-col gap-2 px-3.5 pb-2.5 pt-3" : "px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2.5"}`}
      >
        <div className={`flex items-end ${janela ? "gap-2" : "gap-2.5"}`}>
          <label htmlFor={idCampo} className="sr-only">
            A sua mensagem
          </label>
          <textarea
            id={idCampo}
            ref={campo}
            rows={1}
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submeter();
              }
            }}
            maxLength={2000}
            enterKeyHint="send"
            placeholder="Escreva a sua pergunta…"
            className={`min-w-0 flex-1 resize-none rounded-[23px] border border-linha bg-creme leading-[1.35] text-tinta placeholder:text-tinta-3 ${janela ? "min-h-[42px] px-4 py-[10px] text-sm" : "min-h-[46px] px-[18px] py-[11px] text-[15px]"}`}
          />
          {!janela && ditado.suportado && (
            <button
              type="button"
              onClick={ditado.alternar}
              aria-label={ditado.aOuvir ? "Parar o ditado" : "Ditar a mensagem"}
              aria-pressed={ditado.aOuvir}
              className={`flex size-[46px] shrink-0 items-center justify-center rounded-full transition-colors ${ditado.aOuvir ? "bg-tinta text-white" : "bg-creme-2 text-tinta hover:bg-linha"}`}
            >
              <Mic className="size-5" aria-hidden />
            </button>
          )}
          <button
            type="submit"
            aria-label="Enviar"
            disabled={!rascunho.trim() || chat.ocupado}
            className={`flex shrink-0 items-center justify-center rounded-full bg-terracota text-white transition-colors hover:bg-terracota-escuro disabled:bg-terracota/50 ${janela ? "size-[42px]" : "size-[46px]"}`}
          >
            <ArrowUp className={janela ? "size-[18px]" : "size-5"} aria-hidden />
          </button>
        </div>
        {janela && (
          <p className="text-[11px] text-tinta-3">
            Conversa registada para qualidade. Em emergência, ligue 112.
          </p>
        )}
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function LinhaPessoa({
  m,
  aoTentar,
  ocupado,
}: {
  m: Mensagem;
  aoTentar: () => void;
  ocupado: boolean;
}) {
  const porEnviar = m.estado === "por_enviar";
  return (
    <div className="flex flex-col items-end gap-1 pl-10">
      <div className={porEnviar ? "opacity-60" : undefined}>
        <BalaoPessoa texto={m.texto} />
      </div>
      {porEnviar && (
        <p className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[11px] text-tinta-3">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            Por enviar{m.aviso ? ` · ${m.aviso}` : ""}
          </span>
          <button
            type="button"
            onClick={aoTentar}
            disabled={ocupado}
            className="font-bold text-terracota-escuro hover:underline disabled:opacity-50"
          >
            Tentar
          </button>
        </p>
      )}
    </div>
  );
}

function RespostaAgente({
  m,
  janela,
  acoes,
  aoRepetir,
}: {
  m: Mensagem;
  janela: boolean;
  acoes: AcoesCartao;
  aoRepetir: () => void;
}) {
  const aCorrer = m.estado === "a_responder";
  const rotulo = m.ferramenta
    ? (A_FAZER[m.ferramenta] ?? "A tratar do pedido…")
    : "A escrever…";
  // Sem cartões o balão cresce até 310 px (design: 260–310); com cartões a
  // coluna fica com 310 px como no design.
  return (
    <div className={`flex flex-col gap-2 ${janela ? "pr-4" : "max-w-[310px]"}`}>
      {m.texto && <BalaoAgente texto={m.texto} aCorrer={aCorrer} />}
      {m.cartoes.map((c, i) => (
        <CartaoChat key={`${c.tipo}-${i}`} cartao={c} acoes={acoes} />
      ))}
      {aCorrer && (!m.texto || m.ferramenta) && <IndicadorAEscrever rotulo={rotulo} />}
      {(m.estado === "interrompida" || m.estado === "erro") && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-tinta-2">
          <span>
            {m.estado === "erro"
              ? (m.aviso ?? "Não consegui responder.")
              : "A ligação caiu a meio da resposta."}
          </span>
          <button
            type="button"
            onClick={aoRepetir}
            disabled={acoes.ocupado}
            className="inline-flex items-center gap-1 font-bold text-terracota-escuro hover:underline disabled:opacity-50"
          >
            <RotateCw className="size-3" aria-hidden />
            Repetir
          </button>
        </p>
      )}
    </div>
  );
}
