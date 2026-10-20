"use client";

import {
  CalendarCheck,
  Check,
  Loader2,
  MicOff,
  Mic,
  PhoneIncoming,
  PhoneOff,
  Siren,
  UserRound,
  Volume1,
  Volume2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { FonteOficial } from "@/components/ui/marca";
import { CartaoAoVivo } from "./cartoes";
import {
  BalaoAgente,
  Ecra,
  Gravacao,
  Rotulo,
  VERMELHO,
  telefoneDito,
} from "./comum";
import { MUNICIPIO_NOME } from "./config";
import { AvatarAoVivo, Onda } from "./onda";
import { A_FAZER, dataCurta, type EstadoChamada } from "./registo";

export interface PropsChamada {
  estado: EstadoChamada;
  segundos: number;
  falando: boolean;
  silenciado: boolean;
  altifalante: boolean;
  telefone: string | null;
  obterVolumeEntrada: () => number;
  obterVolumeSaida: () => number;
  onSilenciar: () => void;
  onAltifalante: () => void;
  onPessoa: () => void;
  onDizer: (texto: string) => void;
  onDesligar: () => void;
}

const QUEM = `Câmara de ${MUNICIPIO_NOME}`;

/* Anúncio do estado para leitores de ecrã (não visível). */
function Anuncio({ falando, silenciado }: { falando: boolean; silenciado: boolean }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {silenciado
        ? "Microfone silenciado."
        : falando
          ? "O agente está a falar."
          : "A ouvir. Pode falar."}
    </p>
  );
}

function Desligar({ onDesligar, pequeno }: { onDesligar: () => void; pequeno?: boolean }) {
  return (
    <button
      type="button"
      onClick={onDesligar}
      aria-label="Desligar a chamada"
      className={`flex shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-95 ${VERMELHO} ${pequeno ? "size-[68px]" : "size-[72px]"}`}
    >
      <PhoneOff className="size-7" aria-hidden />
    </button>
  );
}

function EmCurso({ ferramenta }: { ferramenta: string | null }) {
  if (!ferramenta || ferramenta === "procurar_conhecimento") return null;
  return (
    <p className="flex w-fit items-center gap-2 rounded-full bg-creme-2 px-3 py-1.5 text-xs font-semibold text-tinta-2">
      <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />
      {A_FAZER[ferramenta] ?? "A tratar do seu pedido…"}
    </p>
  );
}

function Consulta({ consulta }: { consulta: EstadoChamada["consulta"] }) {
  if (!consulta) return null;
  if (consulta === "a_consultar")
    return (
      <div className="flex w-full gap-2.5 rounded-[10px] bg-verde-suave px-3 py-2.5">
        <Loader2
          className="mt-0.5 size-4 shrink-0 text-verde motion-safe:animate-spin"
          aria-hidden
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold tracking-[0.8px] text-verde">
            A CONSULTAR
          </span>
          <span className="text-[13px] font-medium leading-[1.35] text-tinta">
            Informação oficial da câmara
          </span>
        </span>
      </div>
    );
  return (
    <FonteOficial
      documento={consulta.titulo}
      data={consulta.data ?? undefined}
      url={consulta.url}
    />
  );
}

/* ─── Cabeçalhos ─── */

function CabecalhoGrande({ segundos }: { segundos: number }) {
  return (
    <header className="flex w-full flex-col items-center gap-1.5">
      <Gravacao segundos={segundos} />
      <h1 className="font-display text-2xl font-bold tracking-[-0.4px] text-tinta">
        {QUEM}
      </h1>
      <p className="text-sm text-tinta-2">Atendimento municipal</p>
    </header>
  );
}

function CabecalhoCompacto({
  segundos,
  obterVolume,
}: {
  segundos: number;
  obterVolume: () => number;
}) {
  return (
    <header className="flex w-full items-center gap-3">
      <BalaoAgente tamanho={44} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <h1 className="font-display text-lg font-bold text-tinta">{QUEM}</h1>
        <Gravacao segundos={segundos} compacta />
      </span>
      <Onda obterVolume={obterVolume} pequena />
    </header>
  );
}

function Fala({ quem, children }: { quem: "pessoa" | "agente"; children: ReactNode }) {
  return quem === "pessoa" ? (
    <div className="flex w-full flex-col gap-1 rounded-[16px_4px_16px_16px] bg-creme-2 px-3.5 py-3">
      <Rotulo>Você</Rotulo>
      <p className="text-[15px] leading-[1.45] text-tinta-2">{children}</p>
    </div>
  ) : (
    <div className="flex w-full flex-col gap-1 rounded-[4px_16px_16px_16px] border border-linha bg-papel px-3.5 py-3">
      <Rotulo className="text-terracota-escuro">Agente</Rotulo>
      <p className="text-[15px] leading-[1.45] text-tinta">{children}</p>
    </div>
  );
}

/* ─── Controlos ─── */

function BotaoRedondo({
  rotulo,
  pressionado,
  destaque,
  onClick,
  children,
  grande,
}: {
  rotulo: string;
  pressionado?: boolean;
  destaque?: boolean;
  onClick: () => void;
  children: ReactNode;
  grande?: boolean;
}) {
  const cor = destaque
    ? "bg-terracota-suave text-terracota-escuro"
    : pressionado
      ? "bg-tinta text-white"
      : "bg-creme-2 text-tinta";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressionado}
      aria-label={rotulo}
      className={`flex shrink-0 items-center justify-center rounded-full transition-colors ${cor} ${grande ? "size-[60px]" : "size-14"}`}
    >
      {children}
    </button>
  );
}

function ControlosComLegenda(p: PropsChamada) {
  const itens = [
    {
      texto: p.silenciado ? "Silenciado" : "Silenciar",
      botao: (
        <BotaoRedondo
          grande
          rotulo="Silenciar o microfone"
          pressionado={p.silenciado}
          onClick={p.onSilenciar}
        >
          {p.silenciado ? (
            <MicOff className="size-6" aria-hidden />
          ) : (
            <Mic className="size-6" aria-hidden />
          )}
        </BotaoRedondo>
      ),
    },
    {
      texto: "Altifalante",
      botao: (
        <BotaoRedondo
          grande
          rotulo="Volume alto"
          pressionado={p.altifalante}
          onClick={p.onAltifalante}
        >
          {p.altifalante ? (
            <Volume2 className="size-6" aria-hidden />
          ) : (
            <Volume1 className="size-6" aria-hidden />
          )}
        </BotaoRedondo>
      ),
    },
    {
      texto: "Uma pessoa",
      botao: (
        <BotaoRedondo grande destaque rotulo="Falar com uma pessoa" onClick={p.onPessoa}>
          <UserRound className="size-6" aria-hidden />
        </BotaoRedondo>
      ),
    },
  ];
  return (
    <div className="flex w-full justify-around pt-1">
      {itens.map((i) => (
        <div key={i.texto} className="flex flex-col items-center gap-2">
          {i.botao}
          <span aria-hidden className="text-xs font-medium text-tinta-2">
            {i.texto}
          </span>
        </div>
      ))}
    </div>
  );
}

function ControlosCompactos(p: PropsChamada) {
  return (
    <div className="flex w-full items-center justify-between px-2 pt-1">
      <BotaoRedondo
        rotulo="Silenciar o microfone"
        pressionado={p.silenciado}
        onClick={p.onSilenciar}
      >
        {p.silenciado ? (
          <MicOff className="size-[22px]" aria-hidden />
        ) : (
          <Mic className="size-[22px]" aria-hidden />
        )}
      </BotaoRedondo>
      <Desligar onDesligar={p.onDesligar} pequeno />
      <BotaoRedondo destaque rotulo="Falar com uma pessoa" onClick={p.onPessoa}>
        <UserRound className="size-[22px]" aria-hidden />
      </BotaoRedondo>
    </div>
  );
}

/* ─── 03 Chamada (T0K7H) ─── */

function VistaConversa(p: PropsChamada) {
  const { estado: e } = p;
  return (
    <Ecra className="items-center gap-6">
      <CabecalhoGrande segundos={p.segundos} />
      <AvatarAoVivo obterVolume={p.obterVolumeSaida} />
      <div className="flex flex-col items-center gap-1.5">
        <Onda obterVolume={p.falando ? p.obterVolumeSaida : p.obterVolumeEntrada} />
        <span aria-hidden className="text-[13px] font-medium text-tinta-2">
          {p.silenciado ? "Microfone silenciado" : p.falando ? "A responder" : "A ouvir"}
        </span>
      </div>
      <section
        aria-label="Legendas em direto"
        className="flex w-full flex-col gap-2.5 rounded-[20px] border border-linha bg-papel p-4"
      >
        <Rotulo>Legendas em direto</Rotulo>
        {!e.ultimaPessoa && !e.ultimaAgente && (
          <p className="text-[15px] leading-[1.45] text-tinta-3">
            Diga o que precisa, como se falasse ao balcão.
          </p>
        )}
        {e.ultimaPessoa && (
          <p className="text-sm leading-[1.45] text-tinta-3">
            Você: {e.ultimaPessoa}
          </p>
        )}
        {e.ultimaAgente && (
          <p className="text-base font-medium leading-[1.45] text-tinta">
            {e.ultimaAgente}
          </p>
        )}
        <Consulta consulta={e.consulta} />
        <EmCurso ferramenta={e.emCurso} />
      </section>
      <ControlosComLegenda {...p} />
      <Desligar onDesligar={p.onDesligar} />
    </Ecra>
  );
}

/* ─── 07 / 11 / 13 / 19: chamada com cartão ─── */

function VistaComCartao(p: PropsChamada) {
  const { estado: e } = p;
  if (!e.cartao) return null;
  return (
    <Ecra className="gap-4 pt-1">
      <CabecalhoCompacto
        segundos={p.segundos}
        obterVolume={p.falando ? p.obterVolumeSaida : p.obterVolumeEntrada}
      />
      {e.ultimaPessoa && <Fala quem="pessoa">{e.ultimaPessoa}</Fala>}
      <CartaoAoVivo cartao={e.cartao} identificadoNif={e.identificadoNif} />
      {e.ultimaAgente && <Fala quem="agente">{e.ultimaAgente}</Fala>}
      <EmCurso ferramenta={e.emCurso} />
      <div className="flex-1" />
      <ControlosCompactos {...p} />
    </Ecra>
  );
}

/* ─── 03b A passar a um funcionário (F0GpnK) ─── */

function VistaPassagem(p: PropsChamada) {
  const c = p.estado.cartao;
  if (c?.tipo !== "passagem") return null;
  return (
    <Ecra className="items-center gap-6">
      <CabecalhoGrande segundos={p.segundos} />
      <div aria-hidden className="flex items-center gap-3 pt-4">
        <BalaoAgente tamanho={72} />
        <span className="flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`size-1.5 rounded-full ${
                c.emCurso
                  ? "bg-terracota motion-safe:animate-pulse"
                  : i < 2
                    ? "bg-terracota"
                    : "bg-verde"
              }`}
              style={c.emCurso ? { animationDelay: `${i * 200}ms` } : undefined}
            />
          ))}
        </span>
        <span className="flex size-[72px] items-center justify-center rounded-full bg-tinta">
          <UserRound className="size-8 text-white" />
        </span>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-[28px] font-bold leading-[1.1] tracking-[-0.6px] text-tinta">
          {c.emCurso ? "A passar a um funcionário" : "Passámos o seu caso a um funcionário"}
        </h2>
        <p className="text-[15px] leading-normal text-tinta-2">
          {c.emCurso
            ? "Não desligue. Já contámos o seu caso, não precisa de repetir."
            : (c.dizer ?? "Já tem tudo o que nos disse. Não precisa de repetir.")}
        </p>
      </div>
      {c.responderAte && (
        <div className="flex w-full items-center justify-between rounded-[18px] border border-linha bg-papel p-[18px]">
          <Rotulo>Resposta até</Rotulo>
          <span className="text-[15px] font-bold text-tinta">
            {dataCurta(c.responderAte)}
          </span>
        </div>
      )}
      {p.estado.ultimaAgente && !c.emCurso && (
        <div className="flex w-full flex-col gap-2.5 rounded-[18px] bg-creme-2 p-[18px]">
          <Rotulo>O agente disse</Rotulo>
          <p className="text-sm leading-normal text-tinta">{p.estado.ultimaAgente}</p>
        </div>
      )}
      <Anuncio falando={p.falando} silenciado={p.silenciado} />
      <div className="flex-1" />
      <Desligar onDesligar={p.onDesligar} />
    </Ecra>
  );
}

/* ─── 03c Fora de horas (tUkcA) ─── */

function VistaForaDeHoras(p: PropsChamada) {
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const c = p.estado.cartao;
  if (c?.tipo !== "passagem") return null;
  const opcoes = [
    {
      icone: PhoneIncoming,
      titulo: "Um funcionário liga-me",
      detalhe: p.telefone
        ? `Assim que o balcão abrir, para o ${telefoneDito(p.telefone)}`
        : "Assim que o balcão abrir",
      dizer: "Prefiro que um funcionário me ligue quando o balcão abrir.",
    },
    {
      icone: CalendarCheck,
      titulo: "Marcar atendimento no balcão",
      detalhe: "Escolhemos consigo o dia e a hora",
      dizer: "Prefiro marcar um atendimento no balcão.",
    },
  ];
  return (
    <Ecra className="items-center gap-6">
      <CabecalhoGrande segundos={p.segundos} />
      <div className="pt-4">
        <BalaoAgente tamanho={72} />
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-[28px] font-bold leading-[1.1] tracking-[-0.6px] text-tinta">
          Agora não há funcionários disponíveis.
        </h2>
        <p className="text-[15px] leading-normal text-tinta-2">
          {c.dizer ?? "O balcão está fechado."} Escolha como prefere seguir:
        </p>
      </div>
      <ul className="flex w-full flex-col gap-2.5">
        {opcoes.map((o, i) => (
          <li key={o.titulo}>
            <button
              type="button"
              onClick={() => {
                setEscolhida(i);
                p.onDizer(o.dizer);
              }}
              aria-pressed={escolhida === i}
              className={`flex w-full items-center gap-3.5 rounded-2xl border p-4 text-left ${
                escolhida === i ? "border-terracota bg-terracota-suave" : "border-linha bg-papel"
              }`}
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                  escolhida === i ? "bg-terracota text-white" : "bg-creme-2 text-tinta"
                }`}
              >
                <o.icone className="size-[18px]" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-tinta">{o.titulo}</span>
                <span className="text-[13px] text-tinta-2">{o.detalhe}</span>
              </span>
              {escolhida === i && <Check className="size-[22px] text-terracota" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
      <a
        href="tel:112"
        className="flex items-center gap-2 text-[13px] font-semibold text-terracota-escuro"
      >
        <Siren className="size-[15px]" aria-hidden />
        Se for uma emergência, ligue 112.
      </a>
      <Anuncio falando={p.falando} silenciado={p.silenciado} />
      <div className="flex-1" />
      <Desligar onDesligar={p.onDesligar} />
    </Ecra>
  );
}

export function EcraChamada(p: PropsChamada) {
  const c = p.estado.cartao;
  let vista: ReactNode;
  if (c?.tipo === "passagem")
    vista = c.foraDeHoras ? <VistaForaDeHoras {...p} /> : <VistaPassagem {...p} />;
  else if (c) vista = <VistaComCartao {...p} />;
  else vista = <VistaConversa {...p} />;
  return (
    <>
      {c?.tipo !== "passagem" && (
        <Anuncio falando={p.falando} silenciado={p.silenciado} />
      )}
      {vista}
    </>
  );
}
