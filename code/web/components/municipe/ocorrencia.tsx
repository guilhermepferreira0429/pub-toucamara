"use client";

import { Camera, Check, ImageIcon, Images, Info, MapPin, Plus, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ErroApi } from "@/lib/api";
import { Botao } from "@/components/ui/botao";
import { dataLonga, hora, quandoRelativo } from "./formatar";
import { reduzirImagem } from "./imagem";
import {
  ACarregar,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  Nota,
  type Passo,
  Rotulo,
  Topo,
  Trilho,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";

type Estado = "nova" | "com_equipa" | "resolvida" | "duplicada" | "rejeitada";

interface OcorrenciaPublica {
  numero: string;
  categoria: string;
  descricao: string;
  morada: string;
  estado: Estado;
  prevista_para: string | null;
  criada_em: string;
  resolvida_em: string | null;
  municipio: string;
  estado_explicado: string;
  fotos: { id: string; enviada_em: string; url: string | null }[];
  pode_juntar_fotos: boolean;
  max_fotos: number;
}

interface UrlEnvio {
  foto_id: string;
  url_envio: string;
  metodo: "PUT";
  cabecalhos: Record<string, string>;
  fotos_restantes: number;
}

const MIMES_ACEITES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function passos(o: OcorrenciaPublica): Passo[] {
  const resolvida = o.estado === "resolvida";
  return [
    {
      titulo: "Registada",
      estado: "feito",
      detalhe: `${quandoRelativo(o.criada_em)}, ${hora(o.criada_em)}`,
    },
    {
      titulo: "Com a equipa",
      estado: resolvida ? "feito" : o.estado === "com_equipa" ? "atual" : "por_fazer",
      detalhe:
        o.estado === "com_equipa"
          ? o.prevista_para
            ? `prevista para ${dataLonga(o.prevista_para)}`
            : "a equipa já sabe"
          : o.estado === "nova"
            ? "a câmara está a encaminhar"
            : undefined,
    },
    {
      titulo: "Resolvida",
      estado: resolvida ? "feito" : "por_fazer",
      detalhe:
        resolvida && o.resolvida_em ? dataLonga(o.resolvida_em) : "avisamos por SMS",
    },
  ];
}

type Envio =
  | { passo: "nada" }
  | { passo: "escolhida"; blob: Blob; mime: string; previa: string }
  | { passo: "a_enviar"; previa: string }
  | { passo: "enviada" }
  | { passo: "erro"; mensagem: string };

/** 12 · Ocorrência · Juntar fotografia (link do SMS, pelo token). */
export function Ocorrencia({ token }: { token: string }) {
  const base = `/v1/public/ocorrencias/${encodeURIComponent(token)}`;
  const { c, recarregar, tentarOutraVez } = usePublico<OcorrenciaPublica>(base);
  const [envio, setEnvio] = useState<Envio>({ passo: "nada" });
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  const previa = envio.passo === "escolhida" || envio.passo === "a_enviar" ? envio.previa : null;
  useEffect(() => {
    if (!previa) return;
    return () => URL.revokeObjectURL(previa);
  }, [previa]);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const o = c.dados;
  const aberta = o.estado === "nova" || o.estado === "com_equipa" || o.estado === "resolvida";

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    let blob: Blob = f;
    let mime = f.type.toLowerCase();
    try {
      blob = await reduzirImagem(f, { ladoMaximo: 2000, maximoBytes: 4 * 1024 * 1024 });
      mime = "image/jpeg";
    } catch {
      // HEIC fora do Safari, por exemplo: segue o original, se for aceite.
      if (!MIMES_ACEITES.includes(mime)) {
        setEnvio({
          passo: "erro",
          mensagem: "Este ficheiro não é uma fotografia que possamos receber. Tire outra com a câmara.",
        });
        return;
      }
    }
    setEnvio({ passo: "escolhida", blob, mime, previa: URL.createObjectURL(blob) });
  }

  async function enviar() {
    if (envio.passo !== "escolhida") return;
    const { blob, mime, previa } = envio;
    setEnvio({ passo: "a_enviar", previa });
    try {
      const u = await api<UrlEnvio>(`${base}/fotos`, { corpo: { mime } });
      let res: Response;
      try {
        res = await fetch(u.url_envio, { method: "PUT", headers: u.cabecalhos, body: blob });
      } catch {
        throw new ErroApi(0, "sem_ligacao", "Sem ligação. Verifique a internet e tente outra vez.");
      }
      if (!res.ok) {
        throw new ErroApi(res.status, "envio_falhou", "Não foi possível enviar a fotografia. Tente outra vez.");
      }
      setEnvio({ passo: "enviada" });
      await recarregar();
    } catch (e) {
      setEnvio({ passo: "erro", mensagem: mensagemDe(e) });
    }
  }

  const restantes = o.max_fotos - o.fotos.length;

  return (
    <div className="flex w-full flex-col gap-[18px]">
      <Topo direita={o.numero} mono />

      <div className="flex w-full flex-col gap-2">
        <h1 className="font-display text-[30px] leading-[1.05] font-bold tracking-[-0.8px] text-tinta">
          {o.categoria}
        </h1>
        <p className="flex items-start gap-1.5 text-[16px] leading-[1.4] text-tinta-2">
          <MapPin className="mt-0.5 size-[18px] shrink-0 text-terracota" aria-hidden />
          {o.morada}
        </p>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-verde-suave px-2.5 py-1 text-[13px] font-semibold text-verde">
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
          Registada {quandoRelativo(o.criada_em)} às {hora(o.criada_em).replace("h", ":")}
        </span>
      </div>

      <section className="flex w-full flex-col gap-1.5 rounded-2xl border border-linha bg-papel p-4">
        <Rotulo>O que nos disse</Rotulo>
        <p className="text-[16px] leading-[1.5] text-tinta">{o.descricao}</p>
      </section>

      <section className="flex w-full flex-col gap-2.5" aria-labelledby="fotos">
        <Rotulo id="fotos">
          {o.fotos.length === 1 ? "A sua fotografia" : "As suas fotografias"}
        </Rotulo>

        {o.fotos.length > 0 && (
          <ul className={`grid gap-2 ${o.fotos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {o.fotos.map((f, i) => (
              <li key={f.id}>
                {f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                  <img
                    src={f.url}
                    alt={`Fotografia ${i + 1}, enviada ${quandoRelativo(f.enviada_em)}`}
                    className={`w-full rounded-2xl object-cover ${o.fotos.length === 1 ? "h-[200px]" : "h-[140px]"}`}
                  />
                ) : (
                  <div className="flex h-[140px] w-full flex-col items-center justify-center gap-1 rounded-2xl bg-creme-2 text-tinta-3">
                    <ImageIcon className="size-6" aria-hidden />
                    <span className="text-[13px]">Fotografia {i + 1} recebida</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {o.fotos.length === 0 && envio.passo === "nada" && (
          <p className="text-[15px] leading-[1.45] text-tinta-2">
            Uma fotografia ajuda a equipa a perceber o problema e a levar o material certo.
          </p>
        )}

        {previa && (
          // eslint-disable-next-line @next/next/no-img-element -- blob: local, antes de enviar
          <img
            src={previa}
            alt="A fotografia que escolheu, ainda por enviar"
            className="h-[200px] w-full rounded-2xl object-cover"
          />
        )}

        <div aria-live="polite" className="flex flex-col gap-2.5">
          {envio.passo === "enviada" && (
            <Nota icone={Check} tom="verde">
              Fotografia enviada. Obrigado: já está junto da ocorrência.
            </Nota>
          )}
          {envio.passo === "erro" && (
            <Nota icone={Info} tom="terracota" papel="alert">
              {envio.mensagem}
            </Nota>
          )}
        </div>

        {o.pode_juntar_fotos && envio.passo !== "escolhida" && envio.passo !== "a_enviar" && (
          <div className="flex flex-col gap-2.5 pt-1">
            {o.fotos.length > 0 ? (
              <button
                type="button"
                onClick={() => camera.current?.click()}
                className="inline-flex h-11 w-fit items-center gap-2 rounded-full px-1 text-[15px] font-semibold text-terracota-escuro hover:underline"
              >
                <Plus className="size-4" aria-hidden />
                Juntar outra fotografia
                <span className="font-normal text-tinta-3">
                  (pode mais {restantes})
                </span>
              </button>
            ) : (
              <>
                <Botao tamanho="grande" icone={Camera} className="w-full" onClick={() => camera.current?.click()}>
                  Tirar fotografia
                </Botao>
                <Botao
                  tamanho="grande"
                  variante="secundario"
                  icone={Images}
                  className="w-full"
                  onClick={() => galeria.current?.click()}
                >
                  Escolher da galeria
                </Botao>
              </>
            )}
          </div>
        )}
        {!o.pode_juntar_fotos && (
          <p className="text-[14px] text-tinta-3">
            {aberta && restantes <= 0
              ? `Já tem ${o.max_fotos} fotografias: é o máximo.`
              : "Esta ocorrência já está fechada e não recebe fotografias."}
          </p>
        )}
      </section>

      <section className="flex w-full flex-col gap-2.5" aria-labelledby="ponto">
        <Rotulo id="ponto">Em que ponto está</Rotulo>
        <p className="text-[16px] leading-[1.45] text-tinta">{o.estado_explicado}</p>
        {aberta && (
          <div className="pt-1">
            <Trilho passos={passos(o)} />
          </div>
        )}
      </section>

      {(envio.passo === "escolhida" || envio.passo === "a_enviar") && (
        <div className="sticky bottom-3 flex flex-col gap-2.5">
          <Botao
            tamanho="grande"
            icone={Send}
            className="w-full shadow-lg"
            disabled={envio.passo === "a_enviar"}
            onClick={() => void enviar()}
          >
            {envio.passo === "a_enviar" ? "A enviar…" : "Enviar fotografia"}
          </Botao>
          {envio.passo === "escolhida" && (
            <Botao
              tamanho="grande"
              variante="secundario"
              className="w-full bg-creme"
              onClick={() => {
                setEnvio({ passo: "nada" });
                galeria.current?.click();
              }}
            >
              Escolher outra
            </Botao>
          )}
        </div>
      )}

      <MaisDuvidas nota={null} />

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void escolher(e)}
      />
      <input
        ref={galeria}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void escolher(e)}
      />
    </div>
  );
}
