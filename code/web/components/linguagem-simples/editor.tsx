"use client";

import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  dia,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  Rotulo,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { ESTADOS } from "./documentos";
import {
  TIPOS_DOCUMENTO,
  TITULOS_CHAVE,
  type Chave,
  type Documento,
  type Parte,
  type VersaoSimples,
} from "./tipos";

type ParteForm = Omit<Parte, "trechos">;
interface Formulario {
  titulo: string;
  resumo: string;
  partes: ParteForm[];
}

const ORIGENS: Record<VersaoSimples["origem"], string> = {
  ia: "Escrita pela IA",
  extrativo: "Excertos do original (sem IA)",
  manual: "Escrita à mão",
};

const ESTADOS_VERSAO: Record<string, string> = {
  rascunho: "Rascunho",
  publicada: "Publicada",
  substituida: "Substituída",
  descartada: "Descartada",
  retirada: "Tirada do ar",
};

function formDe(v: VersaoSimples | null, tituloFonte: string): Formulario {
  if (!v) return { titulo: tituloFonte, resumo: "", partes: [] };
  return {
    titulo: v.titulo,
    resumo: v.resumo,
    partes: v.partes.map((p) => ({
      chave: p.chave,
      titulo: p.titulo,
      texto: p.texto,
      seccoes: p.seccoes,
    })),
  };
}

/**
 * Editor da versão simples: o texto oficial à esquerda e a versão simples à
 * direita. Ao passar o rato ou focar uma parte, as secções de onde vem
 * ficam destacadas no original. "Gerar de novo", gravar, rever e publicar.
 */
export function EditorDocumento({ id }: { id: string }) {
  const doc = useDados<Documento>(`/v1/painel/linguagem-simples/${id}`);
  return (
    <div className="flex flex-col gap-4 px-10">
      <Link
        href="/painel/conhecimento/linguagem-simples"
        className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-tinta-2 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden /> Todos os documentos
      </Link>
      <Estado aCarregar={doc.aCarregar} erro={doc.erro} vazio={!doc.dados}>
        {doc.dados && (
          <Editor
            key={`${doc.dados.rascunho?.id ?? "novo"}:${doc.dados.rascunho?.editada_em ?? ""}:${doc.dados.publicada?.id ?? ""}`}
            d={doc.dados}
            onMudou={(n) => doc.mudar(() => n)}
          />
        )}
      </Estado>
    </div>
  );
}

function Editor({ d, onMudou }: { d: Documento; onMudou: (d: Documento) => void }) {
  const { pedido, pode } = useSessao();
  const escrever = pode("conhecimento");
  const acao = useAcao();
  const [form, setForm] = useState<Formulario>(() =>
    formDe(d.rascunho ?? d.publicada, d.fonte.titulo),
  );
  const [sujo, setSujo] = useState(false);
  const [ativa, setAtiva] = useState<number | null>(null);
  const [publicar, setPublicar] = useState(false);
  const [confirmo, setConfirmo] = useState(false);
  const refsSeccoes = useRef(new Map<string, HTMLElement>());

  const baseId = d.rascunho?.fonte_versao_id ?? d.versao_atual_id;
  const original = baseId ? d.originais[baseId] : undefined;
  const seccoes = original?.seccoes ?? [];
  const referencia = (s: string) => {
    const i = seccoes.findIndex((x) => x.id === s);
    return i < 0 ? s : (seccoes[i].referencia ?? `Parte ${i + 1}`);
  };
  const destacadas = new Set(ativa !== null ? (form.partes[ativa]?.seccoes ?? []) : []);

  // A secção de origem da parte ativa fica à vista no original.
  useEffect(() => {
    if (ativa === null) return;
    const primeira = form.partes[ativa]?.seccoes[0];
    const el = primeira ? refsSeccoes.current.get(primeira) : undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [ativa, form.partes]);

  const mudar = (f: (x: Formulario) => Formulario) => {
    setForm(f);
    setSujo(true);
  };
  const mudarParte = (i: number, p: Partial<ParteForm>) =>
    mudar((x) => ({ ...x, partes: x.partes.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const alternarSeccao = (i: number, s: string) => {
    const atual = form.partes[i]?.seccoes ?? [];
    mudarParte(i, {
      seccoes: atual.includes(s) ? atual.filter((x) => x !== s) : [...atual, s],
    });
  };

  const gerar = (modo: "ia" | "extrativo") =>
    acao.executar(async () => {
      const n = await pedido<Documento>(`/v1/painel/linguagem-simples/${d.id}/gerar`, {
        corpo: { modo },
      });
      onMudou(n);
    });
  const guardar = () =>
    acao.executar(async () => {
      const n = await pedido<Documento>(`/v1/painel/linguagem-simples/${d.id}/rascunho`, {
        metodo: "PUT",
        corpo: form,
      });
      onMudou(n);
      return n;
    });
  const fazerPublicar = () =>
    acao.executar(async () => {
      if (!d.rascunho) return;
      const n = await pedido<Documento>(
        `/v1/painel/linguagem-simples/${d.id}/versoes/${d.rascunho.id}/publicar`,
        { corpo: { confirmo: true } },
      );
      setPublicar(false);
      onMudou(n);
    });
  const retirar = () =>
    acao.executar(async () => {
      const n = await pedido<Documento>(`/v1/painel/linguagem-simples/${d.id}/retirar`, {
        corpo: {},
      });
      onMudou(n);
    });

  const r = d.rascunho;
  const e = ESTADOS[d.estado];
  const temGerado = !!r || !!d.publicada;

  return (
    <div className="flex flex-col gap-4">
      <Cartao className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Rotulo>{TIPOS_DOCUMENTO[d.tipo]} · {d.fonte.entidade}</Rotulo>
            <h2 className="font-display text-xl font-bold text-tinta">{d.fonte.titulo}</h2>
            <a
              href={d.fonte.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 self-start text-[13px] text-tinta-2 hover:underline"
            >
              Fonte oficial <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
          <Pilula tom={e.tom}>{e.rotulo}</Pilula>
          {d.link && (
            <a
              href={d.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-terracota-escuro hover:underline"
            >
              Ver a página pública <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>

        {d.publicada?.desatualizada && (
          <p role="alert" className="flex gap-2 rounded-[10px] bg-terracota-suave/60 px-3 py-2 text-[13px] text-terracota-escuro">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            O texto oficial mudou depois da versão publicada. A página pública avisa o munícipe e
            mostra o texto oficial novo; o agente deixa de mandar este resumo. Gere de novo e reveja.
          </p>
        )}
        {r?.desatualizada && (
          <p className="flex gap-2 rounded-[10px] bg-ambar-suave px-3 py-2 text-[13px] text-ambar">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Este rascunho foi feito de um texto oficial que já mudou: não se pode publicar. Gere de
            novo a partir do texto atual.
          </p>
        )}
        {r?.origem === "extrativo" && (
          <p className="flex gap-2 rounded-[10px] bg-ambar-suave px-3 py-2 text-[13px] text-ambar">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            São excertos do texto oficial, ainda sem linguagem simples. Reescreva as partes antes
            de publicar.
          </p>
        )}

        {escrever && (
          <div className="flex flex-wrap items-center gap-2">
            <Botao
              icone={temGerado ? RefreshCw : Sparkles}
              variante={temGerado ? "secundario" : "principal"}
              disabled={acao.aCorrer || !d.ia_disponivel || !d.versao_atual_id}
              onClick={() => gerar("ia")}
            >
              {temGerado ? "Gerar de novo" : "Gerar versão simples"}
            </Botao>
            {!d.ia_disponivel && (
              <>
                <Botao
                  variante="secundario"
                  icone={FileText}
                  disabled={acao.aCorrer || !d.versao_atual_id}
                  onClick={() => gerar("extrativo")}
                >
                  Partir de excertos
                </Botao>
                <span className="text-xs text-tinta-3">
                  A IA não está configurada: escreva à mão ou parta de excertos do original.
                </span>
              </>
            )}
            <span className="ml-auto" />
            {d.publicada && (
              <Botao variante="discreto" icone={Undo2} disabled={acao.aCorrer} onClick={retirar}>
                Tirar do ar
              </Botao>
            )}
            <Botao
              variante="secundario"
              icone={Save}
              disabled={acao.aCorrer || !sujo || form.partes.length === 0}
              onClick={guardar}
            >
              Guardar rascunho
            </Botao>
            <Botao
              icone={Check}
              disabled={acao.aCorrer || !r || sujo || r.desatualizada}
              title={sujo ? "Guarde primeiro as alterações." : undefined}
              onClick={() => {
                setConfirmo(false);
                setPublicar(true);
              }}
            >
              Rever e publicar
            </Botao>
          </div>
        )}
        <ErroLinha erro={acao.erro} />
        {acao.aCorrer && (
          <p className="text-xs text-tinta-3" aria-live="polite">
            A trabalhar… gerar com a IA pode demorar uns segundos.
          </p>
        )}
      </Cartao>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Original */}
        <Cartao className="flex flex-col lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]">
          <div className="border-b border-linha px-5 py-3">
            <Rotulo>Texto oficial</Rotulo>
            <p className="text-xs text-tinta-3">
              {original
                ? `Versão em vigor desde ${dia(original.vigor_desde)} · lida ${quando(original.lida_em)}`
                : "A fonte ainda não tem texto lido."}
            </p>
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto p-4">
            {seccoes.map((s, i) => {
              const ligada = destacadas.has(s.id);
              return (
                <div
                  key={s.id}
                  ref={(el) => {
                    if (el) refsSeccoes.current.set(s.id, el);
                    else refsSeccoes.current.delete(s.id);
                  }}
                  className={`rounded-xl border p-3 transition-colors ${
                    ligada ? "border-terracota bg-terracota-suave/50" : "border-linha bg-creme/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.4px] text-tinta-3">
                      {s.referencia ?? `Parte ${i + 1}`}
                    </span>
                    <span className="text-[10px] text-tinta-3">{s.id}</span>
                    {escrever && ativa !== null && form.partes[ativa] && (
                      <button
                        type="button"
                        onClick={() => alternarSeccao(ativa, s.id)}
                        className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-terracota-escuro hover:bg-terracota-suave"
                        aria-pressed={ligada}
                      >
                        <Link2 className="size-3" aria-hidden />
                        {ligada ? "Desligar da parte" : "Ligar à parte"}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-[13px] leading-[1.55] text-tinta">
                    {s.texto}
                  </p>
                </div>
              );
            })}
          </div>
        </Cartao>

        {/* Versão simples */}
        <Cartao className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Rotulo>Versão simples</Rotulo>
            {r ? (
              <Pilula tom="ambar">
                Rascunho n.º {r.numero} · {ORIGENS[r.origem]}
              </Pilula>
            ) : d.publicada ? (
              <Pilula tom="verde">Publicada n.º {d.publicada.numero}</Pilula>
            ) : (
              <Pilula>Ainda não há</Pilula>
            )}
            {sujo && <Pilula tom="ambar">Alterações por guardar</Pilula>}
          </div>
          {!r && d.publicada && (
            <p className="text-xs text-tinta-3">
              Está a ver a versão publicada. Ao guardar, cria-se um rascunho novo (sobre o texto
              oficial atual) que tem de ser revisto antes de substituir esta.
            </p>
          )}
          <Campo rotulo="Título">
            <input
              className={classeEntrada}
              value={form.titulo}
              maxLength={200}
              disabled={!escrever}
              onChange={(ev) => mudar((x) => ({ ...x, titulo: ev.target.value }))}
            />
          </Campo>
          <Campo rotulo="Resumo" ajuda="Uma ou duas frases: de que trata e a quem interessa.">
            <textarea
              className={`${classeEntrada} min-h-[70px]`}
              value={form.resumo}
              maxLength={1000}
              disabled={!escrever}
              onChange={(ev) => mudar((x) => ({ ...x, resumo: ev.target.value }))}
            />
          </Campo>

          {form.partes.map((p, i) => (
            <fieldset
              key={i}
              onMouseEnter={() => setAtiva(i)}
              onFocusCapture={() => setAtiva(i)}
              className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors ${
                ativa === i ? "border-terracota" : "border-linha"
              }`}
            >
              <legend className="sr-only">Parte {i + 1}</legend>
              <div className="flex gap-2">
                <select
                  aria-label="Pergunta a que responde"
                  className={`${classeEntrada} w-auto`}
                  value={p.chave}
                  disabled={!escrever}
                  onChange={(ev) => {
                    const chave = ev.target.value as Chave;
                    mudarParte(i, {
                      chave,
                      titulo:
                        p.titulo === TITULOS_CHAVE[p.chave] ? TITULOS_CHAVE[chave] : p.titulo,
                    });
                  }}
                >
                  {Object.entries(TITULOS_CHAVE).map(([k, t]) => (
                    <option key={k} value={k}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Título da parte"
                  className={classeEntrada}
                  value={p.titulo}
                  maxLength={120}
                  disabled={!escrever}
                  onChange={(ev) => mudarParte(i, { titulo: ev.target.value })}
                />
                {escrever && (
                  <button
                    type="button"
                    aria-label={`Apagar a parte ${i + 1}`}
                    onClick={() => {
                      setAtiva(null);
                      mudar((x) => ({ ...x, partes: x.partes.filter((_, j) => j !== i) }));
                    }}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full text-tinta-3 hover:bg-creme-2 hover:text-terracota-escuro"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </div>
              <textarea
                aria-label="Texto em linguagem simples"
                className={`${classeEntrada} min-h-[90px]`}
                value={p.texto}
                maxLength={3000}
                disabled={!escrever}
                onChange={(ev) => mudarParte(i, { texto: ev.target.value })}
              />
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-tinta-2">
                <span>Vem de:</span>
                {p.seccoes.length === 0 && (
                  <span className="text-terracota-escuro">
                    nenhuma secção (escolha no texto oficial, à esquerda)
                  </span>
                )}
                {p.seccoes.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full bg-terracota-suave px-2 py-0.5 font-semibold text-terracota-escuro"
                  >
                    {referencia(s)}
                    {escrever && (
                      <button
                        type="button"
                        aria-label={`Desligar ${referencia(s)}`}
                        onClick={() => alternarSeccao(i, s)}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </fieldset>
          ))}
          {escrever && (
            <Botao
              variante="discreto"
              icone={Plus}
              className="self-start"
              disabled={!seccoes.length}
              onClick={() => {
                mudar((x) => ({
                  ...x,
                  partes: [
                    ...x.partes,
                    { chave: "outro", titulo: TITULOS_CHAVE.outro, texto: "", seccoes: [] },
                  ],
                }));
                setAtiva(form.partes.length);
              }}
            >
              Acrescentar parte
            </Botao>
          )}
        </Cartao>
      </div>

      <Cartao className="p-5">
        <Rotulo>Histórico</Rotulo>
        {d.historico.length === 0 ? (
          <p className="mt-2 text-sm text-tinta-3">Ainda não há versões.</p>
        ) : (
          <ul className="mt-2 divide-y divide-linha text-sm">
            {d.historico.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-semibold text-tinta">n.º {h.numero}</span>
                <Pilula tom={h.estado === "publicada" ? "verde" : h.estado === "rascunho" ? "ambar" : "neutro"}>
                  {ESTADOS_VERSAO[h.estado] ?? h.estado}
                </Pilula>
                <span className="text-tinta-2">{ORIGENS[h.origem as VersaoSimples["origem"]]}</span>
                <span className="text-tinta-3">
                  · {quando(h.criada_em)}
                  {h.criada_por_nome ? ` por ${h.criada_por_nome}` : ""}
                  {h.revista_por_nome ? ` · revista por ${h.revista_por_nome}` : ""}
                  {h.publicada_em ? ` em ${quando(h.publicada_em)}` : ""}
                  {h.fonte_versao_id !== d.versao_atual_id ? " · de um texto oficial antigo" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Dialogo titulo="Rever e publicar" aberto={publicar} onFechar={() => setPublicar(false)}>
        <div className="flex flex-col gap-4 text-sm text-tinta-2">
          <p>
            A versão simples vai aparecer ao munícipe, com o texto oficial completo ao lado, e o
            agente vai passar a mandar o link. Fica registado que foi revista por si.
          </p>
          <p className="rounded-[10px] bg-creme-2 px-3 py-2 text-tinta">{d.aviso_legal}</p>
          <label className="flex items-start gap-2.5 text-tinta">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-terracota"
              checked={confirmo}
              onChange={(ev) => setConfirmo(ev.target.checked)}
            />
            Comparei cada parte com o artigo de onde vem: não há nada inventado nem que contradiga
            o texto oficial.
          </label>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" onClick={() => setPublicar(false)}>
              Cancelar
            </Botao>
            <Botao icone={Check} disabled={!confirmo || acao.aCorrer} onClick={fazerPublicar}>
              Publicar
            </Botao>
          </div>
        </div>
      </Dialogo>
    </div>
  );
}
