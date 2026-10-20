"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ErroApi } from "@/lib/api";
import type { EstadoChat } from "./use-chat";

/**
 * Identificação por código SMS (para ver os seus processos): o número de
 * telemóvel → código de 6 dígitos. Aparece quando o agente precisa de saber
 * quem é a pessoa.
 */
export function IdentificacaoSms({
  chat,
  aoConfirmar,
}: {
  chat: Pick<EstadoChat, "pedirCodigo" | "confirmarCodigo" | "identificado">;
  aoConfirmar: () => void;
}) {
  const id = useId();
  const [passo, setPasso] = useState<"telefone" | "codigo">("telefone");
  const [telefone, setTelefone] = useState("");
  const [mascarado, setMascarado] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const campoCodigo = useRef<HTMLInputElement>(null);

  if (chat.identificado) {
    return (
      <div className="flex w-full items-center gap-2 rounded-[4px_18px_18px_18px] border border-verde bg-papel px-4 py-3 text-sm text-tinta">
        <span className="flex size-6 items-center justify-center rounded-full bg-verde" aria-hidden>
          <Check className="size-3.5 text-white" />
        </span>
        Identificado pelo número {chat.identificado}.
      </div>
    );
  }

  async function pedir(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setAEnviar(true);
    try {
      const r = await chat.pedirCodigo(telefone);
      setMascarado(r.telefone);
      setPasso("codigo");
      requestAnimationFrame(() => campoCodigo.current?.focus());
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar o código.");
    } finally {
      setAEnviar(false);
    }
  }

  async function confirmar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setAEnviar(true);
    try {
      await chat.confirmarCodigo(codigo);
      aoConfirmar();
    } catch (e) {
      if (e instanceof ErroApi) {
        const restantes = (e.detalhes as { tentativas_restantes?: number } | undefined)
          ?.tentativas_restantes;
        setErro(
          typeof restantes === "number"
            ? `${e.message} Restam ${restantes} tentativas.`
            : e.message,
        );
        if (e.codigo === "codigo_expirado" || e.codigo === "demasiadas_tentativas") {
          setPasso("telefone");
          setCodigo("");
        }
      } else setErro("Não foi possível confirmar o código.");
    } finally {
      setAEnviar(false);
    }
  }

  const campo =
    "h-11 min-w-0 flex-1 rounded-full border border-linha bg-creme px-4 text-[15px] text-tinta placeholder:text-tinta-3";
  const botao =
    "h-11 shrink-0 rounded-full bg-terracota px-4 text-sm font-semibold text-white hover:bg-terracota-escuro disabled:opacity-50";

  return (
    <div className="flex w-full flex-col gap-3 rounded-[4px_18px_18px_18px] border border-linha bg-papel p-4">
      <p className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tinta" aria-hidden>
          <ShieldCheck className="size-4 text-white" />
        </span>
        <span className="flex flex-col">
          <span className="text-[15px] font-bold text-tinta">Identificar-me</span>
          <span className="text-xs text-tinta-2">
            Para ver os seus processos, enviamos um código por SMS.
          </span>
        </span>
      </p>
      {passo === "telefone" ? (
        <form onSubmit={pedir} className="flex gap-2">
          <label htmlFor={`${id}-tel`} className="sr-only">
            Número de telemóvel
          </label>
          <input
            id={`${id}-tel`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="912 345 678"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            className={campo}
            required
            minLength={6}
            maxLength={25}
          />
          <button type="submit" className={botao} disabled={aEnviar || telefone.trim().length < 6}>
            {aEnviar ? "A enviar…" : "Enviar código"}
          </button>
        </form>
      ) : (
        <form onSubmit={confirmar} className="flex flex-col gap-2">
          <p className="text-xs text-tinta-2">
            Enviámos um código para {mascarado}.{" "}
            <button
              type="button"
              className="font-semibold text-terracota-escuro underline"
              onClick={() => {
                setPasso("telefone");
                setErro(null);
              }}
            >
              Mudar número
            </button>
          </p>
          <div className="flex gap-2">
            <label htmlFor={`${id}-cod`} className="sr-only">
              Código de 6 dígitos
            </label>
            <input
              id={`${id}-cod`}
              ref={campoCodigo}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              className={`${campo} font-mono tracking-[0.3em]`}
              required
            />
            <button type="submit" className={botao} disabled={aEnviar || codigo.length !== 6}>
              {aEnviar ? "A confirmar…" : "Confirmar"}
            </button>
          </div>
        </form>
      )}
      {erro && (
        <p role="alert" className="text-xs font-medium text-terracota-escuro">
          {erro}
        </p>
      )}
    </div>
  );
}
