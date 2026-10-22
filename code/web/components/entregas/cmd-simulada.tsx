"use client";

import { ArrowLeft, CircleAlert, KeyRound, LoaderCircle, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Botao } from "@/components/ui/botao";
import { ACarregar, ErroCarregar, LinkInvalido, Topo } from "@/components/municipe/moldura";
import { mensagemDe, usePublico } from "@/components/municipe/use-publico";
import { AvisoSimulacao } from "./aviso-simulacao";
import type { EntregaPublica } from "./tipos";

const classeCampo =
  "h-14 w-full rounded-xl border-[1.5px] border-tinta-3 bg-white px-4 text-[18px] text-tinta placeholder:text-tinta-3 focus:border-tinta focus:outline-2 focus:outline-offset-2 focus:outline-tinta aria-[invalid=true]:border-terracota-escuro";

/**
 * O passo "autorizar com Chave Móvel Digital", SIMULADO: imita o ecrã do
 * fornecedor (telemóvel + PIN), com o aviso grande de que é uma simulação e
 * o PIN de demonstração à vista. A identidade devolvida é a que a câmara já
 * tem do requerente.
 */
export function CmdSimulada({ token }: { token: string }) {
  const caminho = `/v1/public/entregas/${encodeURIComponent(token)}`;
  const { c, tentarOutraVez } = usePublico<EntregaPublica>(caminho);
  const estado = useSearchParams().get("estado") ?? "";
  const router = useRouter();
  const [telefone, setTelefone] = useState("");
  const [pin, setPin] = useState("");
  const [nif, setNif] = useState("");
  const [aCorrer, setACorrer] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const erroRef = useRef<HTMLParagraphElement>(null);
  const ids = { tel: useId(), pin: useId(), nif: useId(), ajudaPin: useId(), erro: useId() };

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const e = c.dados;
  const voltar = `/entrega/${encodeURIComponent(token)}`;

  if (!e.autenticacao.simulada || e.estado !== "a_espera_autorizacao" || !estado) {
    return (
      <div className="flex w-full flex-col gap-6">
        <Topo direita={e.municipio} />
        <p className="text-[16px] text-tinta-2">
          Este passo já não está disponível. Volte à página do pedido.
        </p>
        <Link
          href={voltar}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-full border-[1.5px] border-tinta text-[17px] font-semibold text-tinta"
        >
          <ArrowLeft className="size-5" aria-hidden />
          Voltar ao pedido
        </Link>
      </div>
    );
  }

  async function submeter(ev: React.FormEvent) {
    ev.preventDefault();
    setACorrer(true);
    setErro(null);
    try {
      await api(`${caminho}/autorizar-simulado`, {
        corpo: {
          estado,
          pin,
          ...(telefone ? { telefone } : {}),
          ...(nif ? { nif } : {}),
        },
      });
      router.replace(voltar);
    } catch (x) {
      setErro(mensagemDe(x));
      setACorrer(false);
      requestAnimationFrame(() => erroRef.current?.focus());
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="Chave Móvel Digital · simulação" />
      <AvisoSimulacao detalhe="Este ecrã imita a Chave Móvel Digital para a demonstração. Não é o site da autenticacao.gov e o que fizer aqui não tem validade legal." />

      <form
        onSubmit={submeter}
        noValidate
        aria-labelledby="titulo-cmd"
        className="flex w-full flex-col gap-5 rounded-2xl border border-linha bg-papel p-5"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-full bg-tinta text-white"
          >
            <Smartphone className="size-5" />
          </span>
          <div>
            <h1 id="titulo-cmd" className="font-display text-[22px] font-bold text-tinta">
              Autorizar com Chave Móvel Digital
            </h1>
            <p className="text-[14px] text-tinta-2">
              Entrega de: {e.resumo.tipo.nome}
            </p>
          </div>
        </div>

        {e.autenticacao.pede_telefone && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.tel} className="text-[15px] font-semibold text-tinta">
              Número de telemóvel
            </label>
            <input
              id={ids.tel}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={telefone}
              onChange={(x) => setTelefone(x.target.value)}
              placeholder="912 345 678"
              className={classeCampo}
            />
            {e.autenticacao.telefone_mascarado && (
              <p className="text-[13px] text-tinta-2">
                O número para onde enviámos o SMS: {e.autenticacao.telefone_mascarado}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.pin} className="text-[15px] font-semibold text-tinta">
            PIN da Chave Móvel Digital
          </label>
          <input
            id={ids.pin}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
            value={pin}
            onChange={(x) => setPin(x.target.value.replace(/\D/g, ""))}
            aria-describedby={`${ids.ajudaPin}${erro ? ` ${ids.erro}` : ""}`}
            aria-invalid={erro ? true : undefined}
            className={`${classeCampo} tracking-[0.4em]`}
          />
          <p id={ids.ajudaPin} className="text-[13px] font-semibold text-tinta">
            PIN de demonstração: <span className="font-mono">{e.autenticacao.pin_demonstracao}</span>
          </p>
        </div>

        {e.autenticacao.pede_nif && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.nif} className="text-[15px] font-semibold text-tinta">
              NIF
            </label>
            <input
              id={ids.nif}
              inputMode="numeric"
              maxLength={9}
              value={nif}
              onChange={(x) => setNif(x.target.value.replace(/\D/g, ""))}
              className={classeCampo}
            />
            <p className="text-[13px] text-tinta-2">
              A câmara ainda não tem o seu NIF. Na Chave Móvel Digital real viria da autenticação.
            </p>
          </div>
        )}

        {erro && (
          <p
            id={ids.erro}
            ref={erroRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-terracota-suave p-3 text-[15px] text-terracota-escuro"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {erro}
          </p>
        )}

        <Botao
          type="submit"
          tamanho="grande"
          icone={aCorrer ? LoaderCircle : KeyRound}
          disabled={aCorrer || !pin}
          className="w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        >
          {aCorrer ? "A autorizar e a entregar…" : "Autorizar (simulação)"}
        </Botao>
        <Link
          href={voltar}
          className="self-center rounded-full px-4 py-2 text-[15px] font-semibold text-tinta-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-tinta"
        >
          Cancelar e voltar ao pedido
        </Link>
      </form>
    </div>
  );
}
