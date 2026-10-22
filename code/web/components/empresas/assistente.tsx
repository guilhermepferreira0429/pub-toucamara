"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, ListChecks, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  MaisDuvidas,
  Nota,
  Topo,
} from "@/components/municipe/moldura";
import { mensagemDe, usePublico } from "@/components/municipe/use-publico";
import { Botao } from "@/components/ui/botao";
import { api } from "@/lib/api";
import { mostrar, type Atividade, type Flag, type PaginaLista, type Perfil, type Perguntas } from "./tipos";

/*
 * Balcão para empresas (página pública, telemóvel primeiro): duas perguntas
 * de cada vez — primeiro a atividade, depois o que vai ter — e a lista
 * personalizada do que a empresa precisa, num link que se pode partilhar.
 * Não pedimos nome, NIF nem morada: só o perfil da atividade.
 */

const MUNICIPIO = process.env.NEXT_PUBLIC_MUNICIPIO ?? "guimaraes";

const OPCAO =
  "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] border-linha bg-papel px-4 py-3 text-[16px] font-medium text-tinta transition-colors hover:border-tinta-3 has-[:checked]:border-terracota has-[:checked]:bg-terracota-suave/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-terracota";

const ENTRADA =
  "min-h-12 w-full rounded-xl border-[1.5px] border-linha bg-papel px-3.5 text-[16px] text-tinta outline-none focus:border-terracota focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracota";

function Marca() {
  return (
    <span
      aria-hidden
      className="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-tinta-2 peer-checked:border-terracota peer-checked:[&>span]:opacity-100"
    >
      <span className="size-2.5 rounded-full bg-terracota opacity-0" />
    </span>
  );
}

function SimNao({
  nome,
  pergunta,
  valor,
  onMudar,
}: {
  nome: string;
  pergunta: string;
  valor: boolean | undefined;
  onMudar: (v: boolean) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-[16px] leading-[1.4] font-semibold text-tinta">{pergunta}</legend>
      <div className="grid grid-cols-2 gap-2">
        {[
          [true, "Sim"],
          [false, "Não"],
        ].map(([v, rotulo]) => (
          <label key={String(v)} className={OPCAO}>
            <input
              type="radio"
              name={nome}
              className="peer sr-only"
              checked={valor === v}
              onChange={() => onMudar(v as boolean)}
            />
            <Marca />
            {rotulo as string}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AssistenteEmpresas() {
  const router = useRouter();
  const { c, tentarOutraVez } = usePublico<Perguntas>(`/v1/public/empresas/${MUNICIPIO}/perguntas`);
  const [passo, setPasso] = useState<1 | 2>(1);
  const [perfil, setPerfil] = useState<Perfil>({});
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const primeiraVez = useRef(true);

  // Ao mudar de passo, o foco vai para o título (leitores de ecrã e teclado).
  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    titulo.current?.focus();
  }, [passo]);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "erro" || c.estado === "invalido") {
    return (
      <ErroCarregar
        mensagem={c.estado === "erro" ? c.mensagem : "Não encontrámos o município."}
        onTentar={tentarOutraVez}
      />
    );
  }
  const d = c.dados;
  const mudar = (k: keyof Perfil, v: unknown) =>
    setPerfil((p) => ({ ...p, [k]: v === "" || v === undefined ? undefined : v }));
  const visiveis = d.perguntas.filter((q) => mostrar(q, perfil));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!perfil.atividade) return;
    // Só as respostas das perguntas que estão à vista.
    const corpo: Perfil = {
      atividade: perfil.atividade,
      fase: perfil.fase,
      abertura: perfil.fase === "abrir" ? perfil.abertura : undefined,
    };
    for (const q of visiveis) corpo[q.campo] = perfil[q.campo] ?? false;
    if (corpo.esplanada && perfil.area_esplanada_m2) corpo.area_esplanada_m2 = perfil.area_esplanada_m2;
    if (corpo.publicidade && perfil.area_publicidade_m2) {
      corpo.area_publicidade_m2 = perfil.area_publicidade_m2;
      corpo.publicidade_iluminada = perfil.publicidade_iluminada ?? false;
    }
    if (corpo.obras && perfil.area_obra_m2) corpo.area_obra_m2 = perfil.area_obra_m2;
    setAEnviar(true);
    setErro(null);
    try {
      const r = await api<PaginaLista>(`/v1/public/empresas/${MUNICIPIO}/lista`, { corpo });
      router.push(`/empresas/${r.codigo}`);
    } catch (x) {
      setErro(mensagemDe(x));
      setAEnviar(false);
    }
  }

  const numero = (k: "area_esplanada_m2" | "area_publicidade_m2" | "area_obra_m2", rotulo: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-[15px] font-semibold text-tinta">{rotulo}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.5"
        className={ENTRADA}
        value={perfil[k] ?? ""}
        onChange={(e) => mudar(k, e.target.value ? Number(e.target.value) : undefined)}
      />
    </label>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={`Passo ${passo} de 2`} />
      <Cabecalho
        meta={`Câmara Municipal de ${d.municipio} · Empresas`}
        titulo="O que a sua empresa precisa"
        sub="Responda a umas perguntas e dizemos-lhe o que tratar, onde, até quando e quanto custa. Não pedimos nome, NIF nem morada."
      />

      {passo === 1 ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (perfil.atividade) setPasso(2);
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-3">
              <h2
                ref={titulo}
                tabIndex={-1}
                className="font-display text-[22px] font-bold tracking-[-0.4px] text-tinta outline-none"
              >
                Qual é a atividade?
              </h2>
            </legend>
            {d.atividades.map((a) => (
              <label key={a.valor} className={OPCAO}>
                <input
                  type="radio"
                  name="atividade"
                  className="peer sr-only"
                  checked={perfil.atividade === a.valor}
                  onChange={() => mudar("atividade", a.valor as Atividade)}
                />
                <Marca />
                {a.rotulo}
              </label>
            ))}
          </fieldset>
          <Botao type="submit" tamanho="grande" icone={ArrowRight} disabled={!perfil.atividade} className="w-full">
            Continuar
          </Botao>
        </form>
      ) : (
        <form className="flex flex-col gap-6" onSubmit={enviar} aria-describedby="nota-perguntas">
          <div className="flex flex-col gap-1">
            <h2
              ref={titulo}
              tabIndex={-1}
              className="font-display text-[22px] font-bold tracking-[-0.4px] text-tinta outline-none"
            >
              Mais umas perguntas
            </h2>
            <p id="nota-perguntas" className="text-[15px] text-tinta-2">
              {d.atividades.find((a) => a.valor === perfil.atividade)?.rotulo}. Se não souber, deixe em branco.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 text-[16px] font-semibold text-tinta">Vai abrir agora ou já está a funcionar?</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["abrir", "Vou abrir"],
                  ["aberta", "Já funciona"],
                ] as const
              ).map(([v, rotulo]) => (
                <label key={v} className={OPCAO}>
                  <input
                    type="radio"
                    name="fase"
                    className="peer sr-only"
                    checked={perfil.fase === v}
                    onChange={() => mudar("fase", v)}
                  />
                  <Marca />
                  {rotulo}
                </label>
              ))}
            </div>
          </fieldset>

          {perfil.fase === "abrir" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[16px] font-semibold text-tinta">Mais ou menos quando conta abrir?</span>
              <span id="ajuda-abertura" className="text-[14px] text-tinta-2">
                Serve para lhe dar as datas no calendário.
              </span>
              <input
                type="date"
                className={ENTRADA}
                aria-describedby="ajuda-abertura"
                value={perfil.abertura ?? ""}
                onChange={(e) => mudar("abertura", e.target.value)}
              />
            </label>
          )}

          {visiveis.map((q) => (
            <SimNao
              key={q.campo}
              nome={q.campo}
              pergunta={q.pergunta}
              valor={perfil[q.campo as Flag]}
              onMudar={(v) => mudar(q.campo, v)}
            />
          ))}

          {(perfil.esplanada || perfil.publicidade || perfil.obras) && (
            <details className="rounded-2xl border border-linha bg-papel p-4 open:pb-5">
              <summary className="cursor-pointer text-[16px] font-semibold text-tinta">
                Para estimar as taxas (opcional)
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                {perfil.esplanada && numero("area_esplanada_m2", "Área da esplanada, em m²")}
                {perfil.publicidade && numero("area_publicidade_m2", "Área do anúncio, em m²")}
                {perfil.publicidade && (
                  <label className="flex min-h-12 items-center gap-3 text-[16px] text-tinta">
                    <input
                      type="checkbox"
                      className="size-5 accent-terracota"
                      checked={perfil.publicidade_iluminada ?? false}
                      onChange={(e) => mudar("publicidade_iluminada", e.target.checked)}
                    />
                    O anúncio é iluminado
                  </label>
                )}
                {perfil.obras && numero("area_obra_m2", "Área da obra, em m²")}
              </div>
            </details>
          )}

          {erro && (
            <Nota icone={AlertTriangle} tom="terracota" papel="alert">
              {erro}
            </Nota>
          )}

          <div className="flex flex-col gap-2">
            <Botao type="submit" tamanho="grande" icone={aEnviar ? LoaderCircle : ListChecks} disabled={aEnviar} className="w-full">
              {aEnviar ? "A preparar a lista…" : "Ver o que preciso"}
            </Botao>
            <Botao type="button" variante="discreto" tamanho="grande" icone={ArrowLeft} onClick={() => setPasso(1)} className="w-full">
              Mudar a atividade
            </Botao>
          </div>
        </form>
      )}

      <MaisDuvidas
        titulo="Prefere falar com alguém?"
        nota="Esta lista é uma orientação. Alguns valores são de demonstração e a decisão final é sempre da câmara."
      />
    </div>
  );
}
