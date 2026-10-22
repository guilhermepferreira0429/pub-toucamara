"use client";

import {
  ArrowUp,
  BadgeCheck,
  ChevronDown,
  ExternalLink,
  FileText,
  Scale,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { TextoComTermos } from "@/components/linguagem-simples/texto-com-termos";
import {
  TIPOS_DOCUMENTO,
  type DocumentoPublico,
  type TermoPublico,
} from "@/components/linguagem-simples/tipos";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  Nota,
  Rotulo,
  TituloSecao,
  Topo,
} from "./moldura";
import { usePublico } from "./use-publico";

/*
 * Um edital ou regulamento em linguagem simples (FUN §14): a versão simples
 * primeiro, revista pela câmara, e sempre o texto oficial completo, com a
 * data da versão e o link da fonte. Cada parte simples leva ao artigo de
 * onde vem, e cada artigo volta à frase simples. Os termos do glossário
 * estão sublinhados e explicam-se ao toque.
 */

/** "1 de março de 2026" (datas AAAA-MM-DD ou ISO). */
function dataExtenso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Lisbon",
  }).format(d);
}

const idSeccao = (s: string) => `original-${s}`;
const idParte = (i: number) => `simples-${i}`;

/** Leva ao elemento, com o foco (para quem usa teclado ou leitor de ecrã). */
function irPara(id: string) {
  // Depois de o React mostrar o texto oficial.
  window.setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, 30);
}

export function PaginaDocumento({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<DocumentoPublico>(
    `/v1/public/documentos/${encodeURIComponent(codigo)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar texto="A abrir o documento…" />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;
  return <Documento d={c.dados} />;
}

function Documento({ d }: { d: DocumentoPublico }) {
  const [originalAberto, setOriginalAberto] = useState(false);
  const [destaque, setDestaque] = useState<string | null>(null);
  const termos = useMemo(
    () => new Map<string, TermoPublico>(d.glossario.map((t) => [t.id, t])),
    [d.glossario],
  );
  const referencias = useMemo(
    () => new Map(d.original.seccoes.map((s, i) => [s.id, s.referencia ?? `parte ${i + 1}`])),
    [d.original.seccoes],
  );
  // Que partes simples citam cada secção (para voltar do artigo à frase).
  const partesDe = useMemo(() => {
    const m = new Map<string, number[]>();
    d.simples.partes.forEach((p, i) =>
      p.seccoes.forEach((s) => m.set(s, [...(m.get(s) ?? []), i])),
    );
    return m;
  }, [d.simples.partes]);

  const verNoOriginal = (s: string) => {
    setOriginalAberto(true);
    setDestaque(s);
    irPara(idSeccao(s));
  };
  const tipo = TIPOS_DOCUMENTO[d.tipo] ?? "Documento";
  const vigor = dataExtenso(d.original.vigor_desde);
  const demonstracao = d.glossario.some((t) => t.demonstracao);

  return (
    <div className="flex w-full flex-col gap-7">
      <Topo direita={tipo} />

      <div className="flex flex-col gap-2">
        <Cabecalho meta={`${tipo} · em linguagem simples`} titulo={d.simples.titulo} />
        {d.simples.resumo.texto && (
          <TextoComTermos
            texto={d.simples.resumo.texto}
            marcas={d.simples.resumo.termos}
            termos={termos}
            className="text-[16px] leading-[1.45] text-tinta-2"
          />
        )}
      </div>

      <Nota icone={Scale} tom="neutro">
        <p className="font-semibold">{d.aviso_legal}</p>
        <p className="mt-1 text-[13px] text-tinta-2">
          Documento oficial: {d.fonte.titulo} ({d.fonte.entidade}).
        </p>
      </Nota>

      {d.simples.desatualizada && (
        <Nota icone={TriangleAlert} tom="terracota" papel="alert">
          <p className="font-semibold">O texto oficial mudou depois deste resumo.</p>
          <p className="mt-1">
            O resumo foi feito a partir da versão
            {d.simples.versao_oficial_do_resumo
              ? ` de ${dataExtenso(d.simples.versao_oficial_do_resumo)}`
              : " anterior"}{" "}
            e pode já não estar certo. Leia o texto oficial abaixo: é o que vale.
          </p>
        </Nota>
      )}

      <section aria-labelledby="titulo-simples" className="flex flex-col gap-4">
        <h2 id="titulo-simples" className="sr-only">
          Versão simples
        </h2>
        {d.simples.partes.map((p, i) => (
          <article
            key={i}
            id={idParte(i)}
            tabIndex={-1}
            className="flex flex-col gap-2.5 rounded-2xl border border-linha bg-papel p-4 outline-none focus-visible:ring-2 focus-visible:ring-terracota"
          >
            <h3 className="font-display text-[20px] font-bold tracking-[-0.3px] text-tinta">
              {p.titulo}
            </h3>
            <TextoComTermos
              texto={p.texto}
              marcas={p.termos}
              termos={termos}
              className="text-[17px] leading-[1.5] text-tinta"
            />
            {p.seccoes.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-tinta-2">
                <span>Vem de:</span>
                {p.seccoes.map((s) => (
                  <a
                    key={s}
                    href={`#${idSeccao(s)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      verNoOriginal(s);
                    }}
                    className="font-semibold text-terracota-escuro underline underline-offset-2"
                  >
                    {referencias.get(s)}
                    <span className="sr-only"> (ver no texto oficial)</span>
                  </a>
                ))}
              </p>
            )}
          </article>
        ))}
        <p className="flex items-center gap-1.5 text-[13px] text-tinta-3">
          <BadgeCheck className="size-4 text-verde" aria-hidden />
          Revisto e publicado pela câmara
          {dataExtenso(d.simples.publicada_em) ? ` a ${dataExtenso(d.simples.publicada_em)}` : ""}.
        </p>
      </section>

      <section aria-labelledby="titulo-original" className="flex flex-col gap-3">
        <TituloSecao id="titulo-original">Texto oficial</TituloSecao>
        <button
          type="button"
          aria-expanded={originalAberto}
          aria-controls="texto-oficial"
          onClick={() => setOriginalAberto((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-tinta px-5 py-4 text-left text-[16px] font-semibold text-white"
        >
          <span className="flex items-center gap-2.5">
            <FileText className="size-5 shrink-0" aria-hidden />
            {originalAberto ? "Esconder o texto oficial" : "Ler o texto oficial completo"}
          </span>
          <ChevronDown
            className={`size-5 shrink-0 transition-transform ${originalAberto ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        <div id="texto-oficial" hidden={!originalAberto} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-xl bg-creme-2 p-4 text-[14px] text-tinta-2">
            <p className="font-semibold text-tinta">{d.fonte.titulo}</p>
            <p>{d.fonte.entidade}</p>
            {vigor && <p>Versão em vigor desde {vigor}.</p>}
            <a
              href={d.fonte.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 font-semibold text-terracota-escuro underline underline-offset-2"
            >
              Abrir na fonte oficial
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only"> (abre noutra janela)</span>
            </a>
          </div>

          {d.original.seccoes.map((s) => {
            const voltar = partesDe.get(s.id) ?? [];
            return (
              <section
                key={s.id}
                id={idSeccao(s.id)}
                tabIndex={-1}
                aria-label={s.referencia ?? undefined}
                className={`flex scroll-mt-4 flex-col gap-2 rounded-xl border p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-terracota ${
                  destaque === s.id ? "border-terracota bg-terracota-suave/40" : "border-linha bg-papel"
                }`}
              >
                {s.referencia && <Rotulo>{s.referencia}</Rotulo>}
                <TextoComTermos
                  texto={s.texto}
                  marcas={s.termos}
                  termos={termos}
                  className="font-serif text-[15px] leading-[1.6] text-tinta"
                />
                {voltar.length > 0 && (
                  <a
                    href={`#${idParte(voltar[0])}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setDestaque(null);
                      irPara(idParte(voltar[0]));
                    }}
                    className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-terracota-escuro underline underline-offset-2"
                  >
                    <ArrowUp className="size-3.5" aria-hidden />
                    Ver em linguagem simples ({d.simples.partes[voltar[0]].titulo})
                  </a>
                )}
              </section>
            );
          })}
        </div>
      </section>

      {demonstracao && (
        <p className="text-[12px] leading-[1.45] text-tinta-3">
          Algumas explicações dos termos sublinhados são valores de demonstração, ainda por validar
          pela câmara.
        </p>
      )}

      <MaisDuvidas titulo="Ficou com dúvidas?" nota={d.aviso_legal} />
    </div>
  );
}
