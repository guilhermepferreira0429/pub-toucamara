"use client";

import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  MessageCircle,
  MessageSquareText,
  Mic,
  MicOff,
  Phone,
  RotateCcw,
  ShieldCheck,
  Siren,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/botao";
import { FonteOficial, Logo } from "@/components/ui/marca";
import {
  BalaoAgente,
  Cabecalho,
  Ecra,
  LinhaFacto,
  Navegacao,
  telefoneDito,
} from "./comum";
import { MUNICIPIO_NOME, TELEFONE_CAMARA } from "./config";

/* ───────────────────────── 01 Entrada (F2RWPP) ───────────────────────── */

const CONFIANCA: [LucideIcon, string][] = [
  [BadgeCheck, "Diz sempre de onde vem a resposta"],
  [UserRound, "Passa a um funcionário quando não sabe"],
  [MessageSquareText, "Manda SMS com os papéis certos"],
];

export function EcraEntrada({
  configurada,
  onLigar,
}: {
  configurada: boolean;
  onLigar: () => void;
}) {
  return (
    <Ecra className="gap-7">
      <div className="flex w-full items-center justify-between">
        <Logo tamanho={24} />
        {configurada ? (
          <span className="flex items-center gap-1.5 rounded-full bg-verde-suave px-2.5 py-1.5">
            <span aria-hidden className="size-[7px] rounded-full bg-verde" />
            <span className="text-xs font-semibold text-verde">
              Atende agora
            </span>
          </span>
        ) : (
          <span className="rounded-full bg-ambar-suave px-2.5 py-1.5 text-xs font-semibold text-ambar">
            Por configurar
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 pt-3">
        <p className="text-[11px] font-bold uppercase leading-[1.4] text-terracota">
          Câmara Municipal de {MUNICIPIO_NOME}
        </p>
        <h1 className="font-display text-[40px] font-bold leading-[1.02] tracking-[-1.2px] text-tinta">
          Ligue à câmara. Alguém atende mesmo.
        </h1>
        <p className="text-base leading-normal text-tinta-2">
          Obras, licenças e documentos, a qualquer hora. Responde com a
          informação oficial e manda-lhe um SMS com o que tem de levar.
        </p>
      </div>

      {/* Exemplo de conversa (ilustrativo). */}
      <figure
        aria-label="Exemplo de conversa"
        className="flex flex-col gap-2.5 rounded-3xl bg-creme-2 px-4 py-5"
      >
        <p className="ml-auto max-w-[250px] rounded-[18px_4px_18px_18px] bg-terracota px-4 py-3 text-[15px] leading-[1.45] text-white">
          Posso pintar a fachada de outra cor?
        </p>
        <p className="max-w-[280px] rounded-[4px_18px_18px_18px] border border-linha bg-papel px-4 py-3 text-[15px] leading-[1.45] text-tinta">
          Pode, mas no centro histórico a cor tem de ser aprovada antes. Mora
          no centro?
        </p>
        <div className="max-w-[280px]">
          <FonteOficial
            documento="Regulamento Municipal de Urbanização e Edificação de Guimarães"
            data="Verificada hoje às 03:00"
          />
        </div>
      </figure>

      <ul className="flex flex-col gap-3.5">
        {CONFIANCA.map(([Icone, texto]) => (
          <li key={texto} className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-terracota-suave">
              <Icone className="size-4 text-terracota-escuro" aria-hidden />
            </span>
            <span className="text-[15px] font-medium text-tinta">{texto}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 pt-2">
        {configurada ? (
          <>
            <Botao
              tamanho="grande"
              icone={Phone}
              onClick={onLigar}
              className="w-full"
            >
              Ligar agora
            </Botao>
            <BotaoLink
              href="/chat"
              tamanho="grande"
              variante="secundario"
              icone={MessageCircle}
              className="w-full"
            >
              Escrever no chat
            </BotaoLink>
            <p className="text-xs leading-[1.45] text-tinta-3">
              Grátis pelo browser. A chamada é gravada para garantir a
              qualidade, e pode recusar.
            </p>
          </>
        ) : (
          <>
            <p
              role="status"
              className="rounded-2xl bg-ambar-suave px-4 py-3 text-sm leading-normal text-ambar"
            >
              A chamada no browser está por configurar. Entretanto, fale
              connosco por escrito.
            </p>
            <BotaoLink
              href="/chat"
              tamanho="grande"
              icone={MessageCircle}
              className="w-full"
            >
              Escrever no chat
            </BotaoLink>
            {TELEFONE_CAMARA && (
              <a
                href={`tel:${TELEFONE_CAMARA.replace(/\s/g, "")}`}
                className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full border-[1.5px] border-tinta text-[17px] font-semibold text-tinta hover:bg-tinta/5"
              >
                <Phone className="size-[1.15em]" aria-hidden />
                Ligar {TELEFONE_CAMARA}
              </a>
            )}
          </>
        )}
      </div>

      {/* Discreto, mas dito: quem chega pelo QR do pitch não pode julgar que
          está a ligar para o serviço oficial da câmara. */}
      <p className="border-t border-linha pt-4 text-xs leading-[1.5] text-tinta-2">
        Demonstração do projeto Tou, Câmara? no Hack4Guimarães 2035: não é o serviço oficial da Câmara Municipal de{" "}
        {MUNICIPIO_NOME}.{" "}
        <Link href="/" className="font-semibold text-terracota underline underline-offset-2">
          Sobre o projeto
        </Link>
      </p>
    </Ecra>
  );
}

/* ─────────────────────── 02 Consentimento (Vgwny) ────────────────────── */

export function EcraConsentimento({
  onVoltar,
  onAceitar,
}: {
  onVoltar: () => void;
  onAceitar: () => void;
}) {
  return (
    <Ecra className="gap-7">
      <Navegacao passo="1 de 2" onVoltar={onVoltar} />
      <Cabecalho icone={Mic} titulo="Antes de começar: esta chamada é gravada.">
        Gravamos para a câmara poder confirmar o que lhe foi dito e melhorar o
        atendimento.
      </Cabecalho>
      <ul className="flex flex-col">
        <LinhaFacto
          icone={Clock}
          titulo="Só o tempo necessário"
          detalhe="A gravação é apagada quando deixa de ser precisa."
        />
        <LinhaFacto
          icone={ShieldCheck}
          titulo="Tratada na União Europeia"
          detalhe="Os seus dados não saem da UE."
        />
        <LinhaFacto
          icone={UserRound}
          titulo="Uma pessoa, quando quiser"
          detalhe="Basta dizer “quero falar com uma pessoa”."
        />
        <LinhaFacto
          icone={Siren}
          corIcone="text-terracota"
          titulo="Em emergência, ligue 112"
          detalhe="Fogo, acidente ou perigo não são connosco."
        />
      </ul>
      <div className="mt-auto flex flex-col gap-3">
        <Botao
          tamanho="grande"
          icone={ArrowRight}
          onClick={onAceitar}
          className="w-full"
        >
          Aceitar e continuar
        </Botao>
        <Link
          href="/chat"
          className="flex h-11 w-full items-center justify-center rounded-full text-[15px] font-semibold text-terracota-escuro hover:bg-creme-2"
        >
          Não aceito, prefiro escrever no chat
        </Link>
      </div>
    </Ecra>
  );
}

/* ────────────────────── 02a Número para o SMS (O2w0X) ────────────────── */

/** Telemóvel português: 9 dígitos a começar por 9. */
export function telemovelValido(digitos: string): boolean {
  return /^9[1236]\d{7}$/.test(digitos);
}

/** A licença de demonstração para experimentar uma renovação (API: public/demo/…/renovacao). */
export interface LicencaParaRenovar {
  numero: string;
  valida_ate: string;
  estabelecimento: string;
  ja_existia: boolean;
}

/** "2 de novembro" a partir de AAAA-MM-DD. */
function diaDito(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function EcraNumero({
  digitos,
  semSms,
  onDigitos,
  onSemSms,
  onVoltar,
  onLigar,
  renovacao,
}: {
  digitos: string;
  semSms: boolean;
  onDigitos: (d: string) => void;
  onSemSms: (v: boolean) => void;
  onVoltar: () => void;
  onLigar: () => void;
  renovacao: {
    ativa: boolean;
    licenca: LicencaParaRenovar | null;
    aPreparar: boolean;
    erro: string | null;
    onAtiva: (v: boolean) => void;
    onPreparar: () => void;
  };
}) {
  const id = useId();
  const [tentou, setTentou] = useState(false);
  const invalido = !semSms && !telemovelValido(digitos);
  const mostrarErro = tentou && invalido;
  const porPreparar = renovacao.ativa && !renovacao.licenca;

  return (
    <Ecra className="gap-7">
      <Navegacao passo="2 de 2" onVoltar={onVoltar} />
      <Cabecalho icone={MessageSquareText} titulo="Para onde mandamos o SMS?">
        No fim da chamada enviamos-lhe os documentos, os links e a marcação. O
        número serve só para isso.
      </Cabecalho>

      <form
        className="flex flex-1 flex-col gap-7"
        onSubmit={(e) => {
          e.preventDefault();
          setTentou(true);
          if (invalido || renovacao.aPreparar) return;
          if (porPreparar) renovacao.onPreparar();
          else onLigar();
        }}
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`${id}-tel`}
            className="text-sm font-semibold text-tinta"
          >
            Telemóvel
          </label>
          <div
            className={`flex h-14 items-center gap-2.5 rounded-[14px] border-[1.5px] bg-papel px-2 transition-colors focus-within:border-terracota ${
              mostrarErro ? "border-terracota" : "border-linha"
            } ${semSms ? "opacity-50" : ""}`}
          >
            <span className="flex h-10 items-center rounded-[10px] bg-creme-2 px-2.5 text-[15px] font-semibold text-tinta">
              PT +351
            </span>
            <input
              id={`${id}-tel`}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="912 345 678"
              disabled={semSms}
              value={telefoneDito(digitos)}
              onChange={(e) =>
                onDigitos(e.target.value.replace(/\D/g, "").slice(0, 9))
              }
              aria-invalid={mostrarErro}
              aria-describedby={`${id}-ajuda`}
              className="h-full min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-[0.5px] text-tinta caret-terracota outline-none placeholder:text-tinta-3/60 disabled:cursor-not-allowed"
            />
          </div>
          <p
            id={`${id}-ajuda`}
            aria-live="polite"
            className={`text-[13px] ${mostrarErro ? "font-semibold text-terracota-escuro" : "text-tinta-2"}`}
          >
            {mostrarErro
              ? "Escreva um número de telemóvel português, com 9 algarismos (ex.: 912 345 678)."
              : "Não partilhamos o número. É apagado ao fim de 30 dias."}
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-3">
          <span className="relative flex size-[22px] shrink-0">
            <input
              type="checkbox"
              checked={semSms}
              onChange={(e) => onSemSms(e.target.checked)}
              className="peer size-[22px] cursor-pointer appearance-none rounded-md border-[1.5px] border-tinta-3 bg-papel checked:border-terracota checked:bg-terracota"
            />
            <Check
              aria-hidden
              className="pointer-events-none absolute inset-0 m-auto hidden size-4 text-white peer-checked:block"
              strokeWidth={3}
            />
          </span>
          <span className="text-[15px] text-tinta-2">Não quero receber SMS</span>
        </label>

        <div
          className={`flex flex-col gap-3 rounded-2xl border-[1.5px] p-4 ${
            renovacao.ativa ? "border-terracota bg-papel" : "border-linha"
          }`}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <span className="relative mt-0.5 flex size-[22px] shrink-0">
              <input
                type="checkbox"
                checked={renovacao.ativa}
                onChange={(e) => renovacao.onAtiva(e.target.checked)}
                aria-describedby={`${id}-renovacao`}
                className="peer size-[22px] cursor-pointer appearance-none rounded-md border-[1.5px] border-tinta-3 bg-papel checked:border-terracota checked:bg-terracota"
              />
              <Check
                aria-hidden
                className="pointer-events-none absolute inset-0 m-auto hidden size-4 text-white peer-checked:block"
                strokeWidth={3}
              />
            </span>
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-[15px] font-semibold text-tinta">
                <RotateCcw className="size-4 text-terracota" aria-hidden />
                Experimentar uma renovação
              </span>
              <span id={`${id}-renovacao`} className="text-[13px] leading-snug text-tinta-2">
                Criamos neste número uma licença de esplanada de demonstração, a acabar daqui a 10 dias. Na chamada,
                peça para a renovar: a referência para pagar chega-lhe por SMS.
              </span>
            </span>
          </label>
          {renovacao.licenca && (
            <p
              role="status"
              className="flex gap-2.5 rounded-xl bg-verde-suave px-3 py-2.5 text-[14px] leading-snug text-tinta"
            >
              <Check className="mt-0.5 size-4 shrink-0 text-verde" aria-hidden strokeWidth={3} />
              <span>
                Pronto: a licença {renovacao.licenca.numero}, do {renovacao.licenca.estabelecimento}, acaba a{" "}
                {diaDito(renovacao.licenca.valida_ate)}. Ligue e diga{" "}
                <strong>&ldquo;quero renovar a licença da esplanada&rdquo;</strong>.
              </span>
            </p>
          )}
          {renovacao.erro && (
            <p role="alert" className="text-[13px] font-semibold text-terracota-escuro">
              {renovacao.erro}
            </p>
          )}
        </div>

        <Botao
          type="submit"
          tamanho="grande"
          icone={porPreparar ? RotateCcw : Phone}
          disabled={renovacao.aPreparar}
          className="mt-auto w-full"
        >
          {porPreparar ? (renovacao.aPreparar ? "A preparar a licença…" : "Preparar a licença") : "Ligar agora"}
        </Botao>
      </form>
    </Ecra>
  );
}

/* ───────────────────────── 02b Microfone (l9bg0) ─────────────────────── */

export function EcraMicrofone({ aLigar }: { aLigar: boolean }) {
  return (
    <Ecra className="items-center gap-5 pt-20">
      <BalaoAgente
        tamanho={120}
        className="motion-safe:animate-[pulse_2s_ease-in-out_infinite]"
      />
      <p
        role="status"
        aria-live="polite"
        className="font-display text-2xl font-bold tracking-[-0.4px] text-tinta"
      >
        {aLigar ? "A ligar…" : "A preparar a chamada…"}
      </p>
      {!aLigar && (
        <p className="flex items-center gap-2 rounded-full bg-terracota px-3.5 py-2 text-[13px] font-semibold text-white">
          <Mic className="size-4" aria-hidden />
          Toque em Permitir para falar connosco
        </p>
      )}
    </Ecra>
  );
}

/* ─────────────────────── 02c Sem microfone (M67ax) ───────────────────── */

const PASSOS = {
  iphone: {
    rotulo: "No iPhone (Safari)",
    passos: [
      "Toque em “aA” na barra do endereço",
      "Escolha “Definições do site”",
      "Em Microfone, escolha “Permitir”",
    ],
  },
  android: {
    rotulo: "No Android (Chrome)",
    passos: [
      "Toque no ícone ao lado do endereço",
      "Escolha “Permissões”",
      "Ative o Microfone e volte a tentar",
    ],
  },
} as const;

export function EcraSemMicrofone({
  onVoltar,
  onTentar,
}: {
  onVoltar: () => void;
  onTentar: () => void;
}) {
  // Só se chega aqui depois de um toque: já estamos no browser.
  const android =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const guia = android ? PASSOS.android : PASSOS.iphone;

  return (
    <Ecra className="gap-7">
      <Navegacao onVoltar={onVoltar} />
      <Cabecalho
        icone={MicOff}
        escuro
        titulo="Sem microfone, não o conseguimos ouvir."
      >
        Pode autorizar nas definições do browser, ou falar connosco de outra
        forma.
      </Cabecalho>

      <section className="flex flex-col gap-3 rounded-2xl bg-creme-2 p-[18px]">
        <h2 className="text-[10px] font-bold uppercase leading-none tracking-[0.9px] text-tinta-3">
          {guia.rotulo}
        </h2>
        <ol className="flex flex-col gap-3">
          {guia.passos.map((p, i) => (
            <li key={p} className="flex items-center gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tinta text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="text-[15px] text-tinta">{p}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-auto flex flex-col gap-3">
        <Botao
          tamanho="grande"
          icone={RotateCcw}
          onClick={onTentar}
          className="w-full"
        >
          Tentar outra vez
        </Botao>
        <BotaoLink
          href="/chat"
          tamanho="grande"
          variante="secundario"
          icone={MessageCircle}
          className="w-full"
        >
          Escrever no chat
        </BotaoLink>
        {TELEFONE_CAMARA && (
          <a
            href={`tel:${TELEFONE_CAMARA.replace(/\s/g, "")}`}
            className="flex h-10 items-center justify-center text-[15px] font-semibold text-terracota-escuro"
          >
            Ou ligue do telemóvel: {TELEFONE_CAMARA}
          </a>
        )}
      </div>
    </Ecra>
  );
}
