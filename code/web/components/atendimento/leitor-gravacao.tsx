"use client";

import { Pause, Play } from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useSessao } from "@/lib/sessao";
import { mensagemErro, tempoAudio } from "./formatos";
import type { Momento, Turno } from "./tipos";

export const MOMENTOS: Record<string, string> = {
  consentimento: "Consentimento",
  pergunta_de_volta: "Pergunta de volta",
  resposta_com_fonte: "Resposta com fonte",
  requerimento: "Requerimento",
  ocorrencia: "Ocorrência",
  marcacao: "Marcação",
  recolha: "Recolha",
  pagamento: "Pagamento",
  sms: "SMS",
  passagem: "Passada a funcionário",
  emergencia: "Emergência",
  idioma: "Mudou de idioma",
};

export interface Leitor {
  /** Salta para o momento (e começa a tocar). */
  irPara(ms: number): void;
}

const BARRAS = 110;

/** Altura "de onda" estável por conversa (não há forma de onda na API). */
function alturas(semente: string): number[] {
  let h = 0;
  for (const c of semente) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: BARRAS }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 0.15 + ((h >>> 16) % 1000) / 1180;
  });
}

/**
 * Leitor da gravação (cartão escuro do design): play, "onda" com quem fala
 * (agente/munícipe, a partir dos turnos), marcadores dos momentos e os
 * momentos em pílulas. A URL é assinada (5 min) e só se pede ao tocar.
 */
export const LeitorGravacao = forwardRef<
  Leitor,
  {
    conversaId: string;
    duracaoS: number | null;
    turnos: Turno[];
    momentos: Momento[];
    comAudio: boolean;
    semAudio?: string;
  }
>(function LeitorGravacao({ conversaId, duracaoS, turnos, momentos, comAudio, semAudio }, ref) {
  const { pedido } = useSessao();
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [aTocar, setATocar] = useState(false);
  const [posicao, setPosicao] = useState(0);
  const [total, setTotal] = useState((duracaoS ?? 0) * 1000);
  const [erro, setErro] = useState<string | null>(null);
  const [aPedir, setAPedir] = useState(false);

  const fimTurnos = Math.max(0, ...turnos.map((t) => t.fim_ms ?? t.inicio_ms ?? 0));
  const duracao = total || fimTurnos || 1;
  const ondas = useMemo(() => alturas(conversaId), [conversaId]);
  const marcados = momentos.filter((m) => m.em_ms !== null);

  async function garantirUrl(): Promise<string | null> {
    if (url) return url;
    setAPedir(true);
    setErro(null);
    try {
      const r = await pedido<{ url: string }>(`/v1/painel/conversas/${conversaId}/gravacao`);
      setUrl(r.url);
      return r.url;
    } catch (e) {
      setErro(mensagemErro(e));
      return null;
    } finally {
      setAPedir(false);
    }
  }

  async function tocar(ms?: number) {
    if (!comAudio) return;
    const u = await garantirUrl();
    const a = audio.current;
    if (!u || !a) return;
    if (a.src !== u) a.src = u;
    if (ms !== undefined) a.currentTime = ms / 1000;
    try {
      await a.play();
    } catch {
      // URL expirada: pede outra e tenta uma vez.
      setUrl(null);
      setErro("A gravação não abriu. Tente outra vez.");
    }
  }

  useImperativeHandle(ref, () => ({ irPara: (ms: number) => void tocar(ms) }));

  function alternar() {
    const a = audio.current;
    if (aTocar && a) a.pause();
    else void tocar();
  }

  function procurar(ms: number) {
    setPosicao(ms);
    if (audio.current && url) audio.current.currentTime = ms / 1000;
    else if (comAudio) void tocar(ms);
  }

  function quemFala(ms: number): "agente" | "municipe" | null {
    const t = turnos.find(
      (x) => x.inicio_ms !== null && ms >= x.inicio_ms && ms <= (x.fim_ms ?? x.inicio_ms),
    );
    if (!t) return null;
    return t.papel === "municipe" ? "municipe" : "agente";
  }

  return (
    <section
      aria-label={comAudio ? "Gravação da chamada" : "Momentos da conversa"}
      className="flex flex-col gap-3 rounded-2xl bg-tinta px-5 py-4"
    >
      {comAudio && (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={alternar}
            disabled={aPedir}
            aria-label={aTocar ? "Pausa" : "Ouvir a gravação"}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-terracota text-white hover:bg-terracota-escuro disabled:opacity-70"
          >
            {aTocar ? (
              <Pause className="size-[18px]" aria-hidden />
            ) : (
              <Play className="size-[18px]" aria-hidden />
            )}
          </button>

          <div className="relative h-12 min-w-0 flex-1">
            <div className="flex h-full items-center gap-0.5" aria-hidden>
              {ondas.map((a, i) => {
                const ms = ((i + 0.5) / BARRAS) * duracao;
                const q = quemFala(ms);
                return (
                  <span
                    key={i}
                    className={`flex-1 rounded-[1.5px] ${
                      q === "municipe" ? "bg-white" : q === "agente" ? "bg-[#E07A55]" : "bg-white/25"
                    } ${ms > posicao ? "opacity-60" : ""}`}
                    style={{ height: `${Math.round(a * 100)}%` }}
                  />
                );
              })}
            </div>
            {marcados.map((m) => (
              <span
                key={m.id}
                aria-hidden
                className="absolute inset-y-0 w-0.5 bg-terracota-suave"
                style={{ left: `${Math.min(100, ((m.em_ms ?? 0) / duracao) * 100)}%` }}
              />
            ))}
            <span
              aria-hidden
              className="absolute -inset-y-1 w-[3px] rounded-sm bg-white"
              style={{ left: `${Math.min(100, (posicao / duracao) * 100)}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.round(duracao)}
              step={1000}
              value={Math.round(posicao)}
              onChange={(e) => procurar(Number(e.target.value))}
              aria-label="Posição na gravação"
              aria-valuetext={`${tempoAudio(posicao)} de ${tempoAudio(duracao)}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          <span className="shrink-0 text-[13px] font-semibold text-white tabular-nums">
            {tempoAudio(posicao)} / {tempoAudio(duracao)}
          </span>
          <audio
            ref={audio}
            preload="none"
            onPlay={() => setATocar(true)}
            onPause={() => setATocar(false)}
            onEnded={() => setATocar(false)}
            onTimeUpdate={(e) => setPosicao(e.currentTarget.currentTime * 1000)}
            onLoadedMetadata={(e) =>
              Number.isFinite(e.currentTarget.duration) &&
              setTotal(e.currentTarget.duration * 1000)
            }
          />
        </div>
      )}

      {!comAudio && semAudio && <p className="text-[13px] text-white/70">{semAudio}</p>}
      {erro && (
        <p role="alert" className="text-[13px] text-[#F2B49B]">
          {erro}
        </p>
      )}

      {(marcados.length > 0 || comAudio) && (
        <div className={`flex flex-wrap items-center gap-2 ${comAudio ? "pl-[60px]" : ""}`}>
          {marcados.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => comAudio && procurar(m.em_ms ?? 0)}
              disabled={!comAudio}
              className="flex items-center gap-1.5 rounded-xl bg-white/8 px-2.5 py-1 enabled:hover:bg-white/15"
            >
              <span className="text-[11px] font-bold text-terracota-suave">
                {tempoAudio(m.em_ms)}
              </span>
              <span className="text-xs text-white/80">{MOMENTOS[m.tipo] ?? m.tipo}</span>
            </button>
          ))}
          {comAudio && (
            <span className="flex items-center gap-3 pl-3 text-[11px] text-white/60" aria-hidden>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px] bg-[#E07A55]" />
                Agente
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px] bg-white" />
                Munícipe
              </span>
            </span>
          )}
        </div>
      )}
    </section>
  );
});
