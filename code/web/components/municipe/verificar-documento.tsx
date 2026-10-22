"use client";

import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Check,
  CircleCheck,
  ClockAlert,
  EyeOff,
  FileText,
  FileWarning,
  FileX,
  Images,
  Info,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useFocoPreso } from "@/lib/foco";
import { Botao } from "@/components/ui/botao";
import { MAXIMO_PDF, paraBase64, reduzirImagem } from "./imagem";
import { Nota } from "./moldura";
import { mensagemDe } from "./use-publico";

/** As três listas de documentos do requerimento (API: resumirEntregas). */
export interface DocumentosRequerimento {
  tem: { id: string; nome: string }[];
  por_verificar: { id: string; nome: string }[];
  faltam: {
    id: string;
    nome: string;
    obrigatorio: boolean;
    ultima_verificacao:
      | "fora_de_prazo"
      | "documento_errado"
      | "ilegivel"
      | null;
  }[];
}

type EstadoVerificacao =
  | "valido"
  | "fora_de_prazo"
  | "documento_errado"
  | "ilegivel";

interface Regra {
  regra: "legivel" | "documento" | "validade" | "assinatura" | "nif_requerente";
  ok: boolean;
  detalhe: string;
}

interface Resultado {
  documento: { id: string; nome: string };
  estado: EstadoVerificacao;
  valido: boolean;
  mensagem: string;
  regras: Regra[];
  guardado: boolean;
  aviso?: string;
  documentos: DocumentosRequerimento;
}

const NOMES_REGRA: Record<Regra["regra"], [string, string]> = {
  legivel: ["Lê-se bem", "Não se lê bem"],
  documento: ["É o documento pedido", "Não é o documento pedido"],
  validade: ["Está dentro do prazo", "Está fora de prazo"],
  assinatura: ["Está assinado", "Falta assinatura ou carimbo"],
  nif_requerente: ["O NIF confere", "O NIF não confere"],
};

function comMaiuscula(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function cabecalhoResultado(r: Resultado): {
  icone: LucideIcon;
  frase: string;
  cor: string;
  fundo: string;
} {
  switch (r.estado) {
    case "valido":
      return {
        icone: CircleCheck,
        frase: "Está tudo certo",
        cor: "text-verde",
        fundo: "bg-verde-suave",
      };
    case "fora_de_prazo":
      return {
        icone: ClockAlert,
        frase: "É o documento certo, mas está fora de prazo",
        cor: "text-ambar",
        fundo: "bg-ambar-suave",
      };
    case "ilegivel":
      return {
        icone: EyeOff,
        frase: "Não se consegue ler bem",
        cor: "text-ambar",
        fundo: "bg-ambar-suave",
      };
    case "documento_errado":
      return r.regras.find((x) => x.regra === "documento")?.ok
        ? {
            icone: FileWarning,
            frase: "É o documento certo, mas falta alguma coisa",
            cor: "text-ambar",
            fundo: "bg-ambar-suave",
          }
        : {
            icone: FileX,
            frase: "Não parece ser o documento pedido",
            cor: "text-terracota-escuro",
            fundo: "bg-terracota-suave",
          };
  }
}

type Passo =
  | { passo: "escolher" }
  | { passo: "a_verificar" }
  | { passo: "resultado"; r: Resultado }
  | { passo: "erro"; mensagem: string };

/**
 * 10 · Verificar documento por foto. Ecrã inteiro por cima da página:
 * escolher o documento, tirar (ou escolher) a foto, reduzir no browser e
 * mostrar o que a câmara encontrou, regra a regra.
 */
export function VerificarDocumento({
  token,
  documentos,
  inicial,
  onFechar,
  onVerificado,
}: {
  token: string;
  documentos: { id: string; nome: string; detalhe?: string }[];
  inicial?: string | null;
  onFechar: () => void;
  onVerificado: (docs: DocumentosRequerimento) => void;
}) {
  const titulo = useId();
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [docId, setDocId] = useState<string | null>(
    inicial ?? (documentos.length === 1 ? documentos[0].id : null),
  );
  const [p, setP] = useState<Passo>({ passo: "escolher" });
  const [previa, setPrevia] = useState<string | null>(null);
  const [eraPdf, setEraPdf] = useState(false);

  const doc = documentos.find((d) => d.id === docId) ?? null;

  const aoFechar = useRef(onFechar);
  useEffect(() => {
    aoFechar.current = onFechar;
  }, [onFechar]);

  // Diálogo: foco lá dentro, Esc fecha, a página de trás não rola.
  useEffect(() => {
    fechar.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar.current();
    };
    document.addEventListener("keydown", tecla);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = antes;
    };
  }, []);
  // Tab e Shift+Tab não saem do diálogo; ao fechar o foco volta ao botão.
  useFocoPreso(caixa, true);

  useEffect(() => {
    return () => {
      if (previa) URL.revokeObjectURL(previa);
    };
  }, [previa]);

  async function usar(f: File) {
    if (!docId) return;
    setP({ passo: "a_verificar" });
    let blob: Blob;
    let mime: string;
    if (f.type === "application/pdf") {
      if (f.size > MAXIMO_PDF) {
        setP({
          passo: "erro",
          mensagem: "Este PDF é demasiado grande (máximo 10 MB). Tire uma fotografia ao documento.",
        });
        return;
      }
      blob = f;
      mime = "application/pdf";
      setEraPdf(true);
      setPrevia(null);
    } else {
      try {
        blob = await reduzirImagem(f);
      } catch {
        setP({
          passo: "erro",
          mensagem:
            "Não conseguimos abrir esta fotografia. Tire outra com a câmara do telemóvel.",
        });
        return;
      }
      mime = "image/jpeg";
      setEraPdf(false);
      setPrevia(URL.createObjectURL(blob));
    }
    try {
      const r = await api<Resultado>(
        `/v1/public/requerimentos/${encodeURIComponent(token)}/documentos/verificar`,
        {
          corpo: {
            tipo_documento_id: docId,
            mime,
            imagem_base64: await paraBase64(blob),
          },
        },
      );
      setP({ passo: "resultado", r });
      onVerificado(r.documentos);
    } catch (e) {
      setP({ passo: "erro", mensagem: mensagemDe(e) });
    }
  }

  function escolherFicheiro(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void usar(f);
  }

  function outraFoto() {
    setP({ passo: "escolher" });
    setPrevia(null);
    setEraPdf(false);
  }

  return (
    <div
      ref={caixa}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titulo}
      className="fixed inset-0 z-50 flex justify-center bg-[#111]"
    >
      <div className="flex h-full w-full max-w-[430px] flex-col">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            ref={fechar}
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="flex size-11 items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            <X className="size-6" aria-hidden />
          </button>
          <h2 id={titulo} className="text-[16px] font-semibold text-white">
            Verificar documento
          </h2>
          <span className="size-11" aria-hidden />
        </div>

        {/* A fotografia (ou as instruções), com os cantos de enquadrar. */}
        <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden px-10 py-6">
          {previa ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: local, sem otimização
            <img
              src={previa}
              alt={doc ? `A sua fotografia de: ${doc.nome}` : "A sua fotografia"}
              className="max-h-full max-w-full rounded object-contain"
            />
          ) : eraPdf ? (
            <FileText className="size-20 text-white/90" aria-hidden />
          ) : (
            <p className="max-w-[260px] text-center text-[16px] leading-[1.5] text-white/90">
              Ponha o documento numa mesa, com boa luz, e fotografe-o inteiro, de
              frente.
            </p>
          )}
          {["top-4 left-5", "top-4 right-5 rotate-90", "bottom-4 right-5 rotate-180", "bottom-4 left-5 -rotate-90"].map(
            (pos) => (
              <span key={pos} aria-hidden className={`absolute size-9 ${pos}`}>
                <span className="absolute top-0 left-0 h-1 w-9 rounded-sm bg-terracota" />
                <span className="absolute top-0 left-0 h-9 w-1 rounded-sm bg-terracota" />
              </span>
            ),
          )}
        </div>

        <div
          className="flex max-h-[70dvh] flex-col gap-3.5 overflow-y-auto rounded-t-[28px] bg-creme px-5 pt-[22px] pb-7"
          aria-live="polite"
        >
          {p.passo === "escolher" && (
            <>
              {documentos.length > 1 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="pb-2 text-[17px] font-bold text-tinta">
                    Que documento vai fotografar?
                  </legend>
                  {documentos.map((d) => (
                    <label
                      key={d.id}
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2.5 ${docId === d.id ? "border-terracota bg-papel" : "border-linha bg-papel/60"}`}
                    >
                      <input
                        type="radio"
                        name="documento"
                        value={d.id}
                        checked={docId === d.id}
                        onChange={() => setDocId(d.id)}
                        className="size-5 accent-terracota"
                      />
                      <span className="flex flex-col">
                        <span className="text-[16px] font-semibold text-tinta">{d.nome}</span>
                        {d.detalhe && (
                          <span className="text-[13px] text-tinta-3">{d.detalhe}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {documentos.length === 1 && doc && (
                <p className="text-[17px] font-bold text-tinta">{doc.nome}</p>
              )}
              <p className="text-[15px] leading-[1.45] text-tinta-2">
                Vemos se é o documento certo, se se lê bem e se está dentro do prazo.
              </p>
              <Botao
                tamanho="grande"
                icone={Camera}
                className="w-full"
                disabled={!docId}
                onClick={() => camera.current?.click()}
              >
                Tirar fotografia
              </Botao>
              <Botao
                tamanho="grande"
                variante="secundario"
                icone={Images}
                className="w-full"
                disabled={!docId}
                onClick={() => galeria.current?.click()}
              >
                Escolher da galeria
              </Botao>
            </>
          )}

          {p.passo === "a_verificar" && (
            <div role="status" className="flex items-center gap-3 py-4">
              <LoaderCircle className="size-6 animate-spin text-terracota" aria-hidden />
              <p className="text-[16px] text-tinta">
                A ler o documento… demora uns segundos.
              </p>
            </div>
          )}

          {p.passo === "erro" && (
            <>
              <Nota icone={Info} tom="terracota" papel="alert">
                {p.mensagem}
              </Nota>
              <Botao tamanho="grande" icone={Camera} className="w-full" onClick={outraFoto}>
                Tentar outra vez
              </Botao>
            </>
          )}

          {p.passo === "resultado" && (
            <ResultadoVerificacao
              r={p.r}
              onOutra={outraFoto}
              onFechar={onFechar}
            />
          )}
        </div>

        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={escolherFicheiro}
        />
        <input
          ref={galeria}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={escolherFicheiro}
        />
      </div>
    </div>
  );
}

function ResultadoVerificacao({
  r,
  onOutra,
  onFechar,
}: {
  r: Resultado;
  onOutra: () => void;
  onFechar: () => void;
}) {
  const c = cabecalhoResultado(r);
  const Icone = c.icone;
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={`flex size-[34px] shrink-0 items-center justify-center rounded-full ${c.fundo}`}
        >
          <Icone className={`size-[18px] ${c.cor}`} />
        </span>
        <div className="flex min-w-0 flex-col gap-px">
          <p className="text-[17px] font-bold text-tinta">{r.documento.nome}</p>
          <p className={`text-[14px] font-semibold ${c.cor}`}>{c.frase}</p>
        </div>
      </div>

      {r.regras.length > 0 && (
        <ul className="flex flex-col" aria-label="O que verificámos">
          {r.regras.map((g) => (
            <li
              key={g.regra}
              className="flex gap-3 border-b border-linha py-2.5 last:border-b-0"
            >
              <span
                aria-hidden
                className={`mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full ${g.ok ? "bg-verde" : "bg-ambar-suave"}`}
              >
                {g.ok ? (
                  <Check className="size-3 text-white" strokeWidth={3} />
                ) : (
                  <X className="size-3 text-ambar" strokeWidth={3} />
                )}
              </span>
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold text-tinta">
                  {(NOMES_REGRA[g.regra] ?? [g.regra, g.regra])[g.ok ? 0 : 1]}
                  <span className="sr-only">{g.ok ? " (certo)" : " (com problema)"}</span>
                </span>
                <span className="text-[14px] leading-[1.4] text-tinta-2">
                  {comMaiuscula(g.detalhe)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {r.valido && r.guardado && (
        <p className="text-[15px] leading-[1.5] text-tinta">
          Juntámos o documento ao seu pedido. Não precisa de o entregar outra vez.
        </p>
      )}
      {!r.valido && (
        <p className="text-[15px] leading-[1.5] text-tinta">
          {r.estado === "ilegivel"
            ? "Tire outra fotografia com mais luz, sem reflexos e com o documento inteiro."
            : r.estado === "fora_de_prazo"
              ? "Peça uma nova e volte a fotografá-la. Muitas certidões pedem-se online, sem sair de casa."
              : "Confirme que é este o documento pedido e tire outra fotografia."}
        </p>
      )}
      {r.aviso && (
        <Nota icone={Info} tom="ambar">
          {r.aviso}
        </Nota>
      )}

      {r.valido ? (
        <Botao tamanho="grande" icone={Check} className="w-full" onClick={onFechar}>
          Concluir
        </Botao>
      ) : (
        <>
          <Botao tamanho="grande" icone={Camera} className="w-full" onClick={onOutra}>
            Tirar outra foto
          </Botao>
          <Botao tamanho="grande" variante="secundario" className="w-full" onClick={onFechar}>
            Fazer isto mais tarde
          </Botao>
        </>
      )}
    </>
  );
}
