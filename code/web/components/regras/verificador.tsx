"use client";

import { Check, CircleHelp, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/components/ui/botao";
import { mensagemDe } from "@/components/municipe/use-publico";
import { CartaoDestaque, Nota, TituloSecao } from "@/components/municipe/moldura";
import { api } from "@/lib/api";
import type { CampoVerificador, ResultadoVerificacao } from "./tipos";

/*
 * O verificador: a pessoa põe os dados de um pedido que ainda não fez e vê
 * que regras passa e falha, e porquê. A resposta vem do mesmo motor que
 * decide os pedidos reais (nada fica registado).
 */

export const classeCampo =
  "h-12 w-full rounded-xl border border-linha bg-papel px-3.5 text-[16px] text-tinta outline-none focus:border-terracota focus:ring-2 focus:ring-terracota/30";

type Valor = string | string[] | boolean | undefined;

function valorInicial(c: CampoVerificador): Valor {
  if (c.tipo === "opcoes") return [];
  if (c.tipo === "booleano") return c.opcional ? undefined : false;
  if (c.tipo === "opcao") return Object.keys(c.opcoes ?? {})[0];
  return "";
}

/** O formulário → o corpo do pedido (números com vírgula ou ponto). */
function corpoDe(campos: CampoVerificador[], v: Record<string, Valor>) {
  const corpo: Record<string, unknown> = {};
  for (const c of campos) {
    const x = v[c.chave];
    if (x === undefined || x === "") continue;
    if (c.tipo === "inteiro" || c.tipo === "decimal") {
      const n = Number(String(x).replace(",", "."));
      if (!Number.isNaN(n)) corpo[c.chave] = c.tipo === "inteiro" ? Math.round(n) : n;
    } else {
      corpo[c.chave] = x;
    }
  }
  return corpo;
}

const DESTAQUE = {
  automatica: { tom: "verde" as const, rotulo: "Cumpre as regras" },
  funcionario: { tom: "verde" as const, rotulo: "Cumpre as regras" },
  excecao: { tom: "tinta" as const, rotulo: "Precisa de uma pessoa" },
};

export function Verificador({
  municipio,
  tipo,
  campos,
}: {
  municipio: string;
  tipo: string;
  campos: CampoVerificador[];
}) {
  const [v, setV] = useState<Record<string, Valor>>(() =>
    Object.fromEntries(campos.map((c) => [c.chave, valorInicial(c)])),
  );
  const [r, setR] = useState<ResultadoVerificacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aCorrer, setACorrer] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const muda = (chave: string, x: Valor) => {
    setV((a) => ({ ...a, [chave]: x }));
    setR(null);
  };

  useEffect(() => {
    if (r) titulo.current?.focus();
  }, [r]);

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    const faltam = campos.filter((c) => !c.opcional && c.tipo !== "opcoes" && (v[c.chave] === undefined || v[c.chave] === ""));
    if (faltam.length) {
      setErro(`Preencha também: ${faltam.map((c) => c.rotulo.toLowerCase()).join(", ")}.`);
      return;
    }
    setACorrer(true);
    setErro(null);
    try {
      setR(
        await api<ResultadoVerificacao>(
          `/v1/public/regras/${encodeURIComponent(municipio)}/licencas/${encodeURIComponent(tipo)}/verificar`,
          { corpo: corpoDe(campos, v) },
        ),
      );
    } catch (x) {
      setErro(mensagemDe(x));
    } finally {
      setACorrer(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="verificador">
      <TituloSecao id="verificador">Verifique antes de pedir</TituloSecao>
      <p className="text-[15px] leading-[1.45] text-tinta-2">
        Ponha os dados do seu pedido e veja que regras cumpre. É o mesmo sistema que decide os pedidos a sério. Nada fica
        registado.
      </p>
      <form onSubmit={verificar} className="flex flex-col gap-4" noValidate>
        {campos.map((c) => (
          <CampoFormulario key={c.chave} c={c} valor={v[c.chave]} onMudar={(x) => muda(c.chave, x)} />
        ))}
        <Botao type="submit" tamanho="grande" icone={aCorrer ? LoaderCircle : ShieldCheck} disabled={aCorrer} className="w-full">
          {aCorrer ? "A verificar…" : "Verificar"}
        </Botao>
      </form>
      <div aria-live="polite" className="flex flex-col gap-4">
        {erro && (
          <Nota icone={X} tom="terracota" papel="alert">
            {erro}
          </Nota>
        )}
        {r && <Resultado r={r} titulo={titulo} />}
      </div>
    </section>
  );
}

function Resultado({ r, titulo }: { r: ResultadoVerificacao; titulo: React.RefObject<HTMLHeadingElement | null> }) {
  const d = DESTAQUE[r.decisao.via];
  return (
    <div className="flex flex-col gap-4">
      <CartaoDestaque rotulo={d.rotulo} tom={d.tom}>
        <h3 ref={titulo} tabIndex={-1} className="font-display text-[22px] leading-tight font-bold outline-none">
          {r.resultado}
        </h3>
        {r.taxa.total_cent > 0 && r.proposta === "aprovar" && (
          <p className="text-[15px] text-white/90">Taxa: {r.taxa.texto}</p>
        )}
      </CartaoDestaque>
      <ul className="flex flex-col gap-2.5" aria-label="Regras verificadas">
        {r.regras.map((x) => (
          <li key={x.id} className="flex gap-3 rounded-2xl border border-linha bg-papel p-3.5">
            {x.ok ? (
              <Check className="mt-0.5 size-5 shrink-0 text-verde" aria-hidden />
            ) : (
              <X className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
            )}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-tinta">
                <span className="sr-only">{x.ok ? "Cumpre: " : "Não cumpre: "}</span>
                {x.texto}
              </span>
              {x.regra && <span className="text-[13px] text-tinta-3">Regra: {x.regra}</span>}
            </span>
          </li>
        ))}
        {r.decisao.motivos
          .filter((m) => m.tipo === "dado_em_falta")
          .map((m) => (
            <li key={m.id} className="flex gap-3 rounded-2xl border border-ambar bg-papel p-3.5">
              <CircleHelp className="mt-0.5 size-5 shrink-0 text-ambar" aria-hidden />
              <span className="text-[15px] font-semibold text-tinta">{m.texto}</span>
            </li>
          ))}
      </ul>
      {r.condicoes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[14px] font-bold text-tinta">Se for aprovado, com estas condições:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-tinta-2">
            {r.condicoes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[13px] text-tinta-3">
        {r.nota} Regras na versão {r.versao}
        {r.demonstracao ? ", com valores de demonstração" : ""}.
      </p>
    </div>
  );
}

function CampoFormulario({
  c,
  valor,
  onMudar,
}: {
  c: CampoVerificador;
  valor: Valor;
  onMudar: (v: Valor) => void;
}) {
  const id = `campo-${c.chave}`;
  const ajuda = c.ajuda ? `${id}-ajuda` : undefined;
  const rotulo = (
    <>
      {c.rotulo}
      {c.unidade ? ` (${c.unidade})` : ""}
      {c.opcional && <span className="font-normal text-tinta-3"> · opcional</span>}
    </>
  );

  if (c.tipo === "booleano") {
    const opcoes: [string, Valor][] = [
      ["Sim", true],
      ["Não", false],
      ...(c.opcional ? ([["Não sei", undefined]] as [string, Valor][]) : []),
    ];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1.5 text-[15px] font-semibold text-tinta">{rotulo}</legend>
        <div className="flex flex-wrap gap-2">
          {opcoes.map(([texto, x]) => (
            <label
              key={texto}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] ${valor === x ? "border-terracota bg-terracota-suave font-semibold text-tinta" : "border-linha bg-papel text-tinta-2"}`}
            >
              <input
                type="radio"
                name={id}
                checked={valor === x}
                onChange={() => onMudar(x)}
                className="size-4 accent-terracota"
              />
              {texto}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (c.tipo === "opcoes") {
    const escolhidas = (valor as string[]) ?? [];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1.5 text-[15px] font-semibold text-tinta">{rotulo}</legend>
        {Object.entries(c.opcoes ?? {}).map(([k, texto]) => (
          <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-tinta">
            <input
              type="checkbox"
              checked={escolhidas.includes(k)}
              onChange={(e) =>
                onMudar(e.target.checked ? [...escolhidas, k] : escolhidas.filter((x) => x !== k))
              }
              className="size-5 accent-terracota"
            />
            {texto}
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold text-tinta">
        {rotulo}
      </label>
      {c.tipo === "opcao" ? (
        <select id={id} className={classeCampo} value={String(valor ?? "")} onChange={(e) => onMudar(e.target.value)}>
          {Object.entries(c.opcoes ?? {}).map(([k, texto]) => (
            <option key={k} value={k}>
              {texto}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={classeCampo}
          aria-describedby={ajuda}
          value={String(valor ?? "")}
          onChange={(e) => onMudar(e.target.value)}
          type={c.tipo === "data" ? "date" : c.tipo === "hora" ? "time" : "text"}
          inputMode={c.tipo === "inteiro" ? "numeric" : c.tipo === "decimal" ? "decimal" : undefined}
          autoComplete="off"
        />
      )}
      {c.ajuda && (
        <p id={ajuda} className="text-[13px] text-tinta-3">
          {c.ajuda}
        </p>
      )}
    </div>
  );
}
