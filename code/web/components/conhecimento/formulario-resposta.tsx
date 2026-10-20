"use client";

import { Check, ExternalLink, Plus, Save, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/botao";
import type { ErroApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";
import { Campo, classeEntrada, ErroLinha, useDados } from "./comum";
import type { Definicoes, FonteCitada, Mapa } from "./tipos";

export interface ValoresResposta {
  pergunta_tipo: string;
  tema_id: string | null;
  texto_voz: string;
  texto_sms: string;
  passa_a_pessoa_quando: string;
  frases: string;
  /** As fontes (trechos) em que a resposta se apoia. */
  fontes?: FonteCitada[];
}

export const VAZIO: ValoresResposta = {
  pergunta_tipo: "",
  tema_id: null,
  texto_voz: "",
  texto_sms: "",
  passa_a_pessoa_quando: "",
  frases: "",
  fontes: [],
};

/** Os ids dos trechos escolhidos, para o corpo do pedido (`trechos`). */
export const trechosDe = (v: ValoresResposta) => (v.fontes ?? []).map((f) => f.trecho_id);

export const linhas = (t: string) =>
  t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Pode escrever respostas: a equipa interna sempre; a câmara (recurso
 * 'conhecimento') só com a edição pela câmara ligada no município.
 */
export function usePodeEditarRespostas(): { pode: boolean; interno: boolean; aCarregar: boolean } {
  const { eu, pode } = useSessao();
  const perfil = eu?.utilizador.perfil;
  const interno = perfil === "admin" || perfil === "equipa_toucamara";
  const def = useDados<Definicoes>(
    !interno && pode("conhecimento") ? "/v1/painel/conhecimento/definicoes" : null,
  );
  return {
    interno,
    pode: interno || (pode("conhecimento") && !!def.dados?.camara_edita_respostas),
    aCarregar: def.aCarregar,
  };
}

/** Frases curtas e sem jargão: uma verificação simples para quem escreve. */
function linguagem(texto: string): { ok: boolean; texto: string } {
  const frases = texto.split(/(?<=[.!?…])\s+/).filter((f) => f.trim());
  const longas = frases.filter((f) => f.split(/\s+/).length > 30).length;
  if (!frases.length) return { ok: false, texto: "Escreva o que o agente vai dizer." };
  if (longas)
    return {
      ok: false,
      texto: `${longas} ${longas === 1 ? "frase tem" : "frases têm"} mais de 30 palavras: ao telefone convém frases curtas.`,
    };
  return {
    ok: true,
    texto: `Linguagem simples · ${frases.length} ${frases.length === 1 ? "frase curta" : "frases curtas"}`,
  };
}

/**
 * Escolher as fontes: pesquisa nos trechos em vigor
 * (`GET /v1/painel/conhecimento/trechos?q=`) e junta à lista.
 */
function SeletorFontes({
  fontes,
  onChange,
}: {
  fontes: FonteCitada[];
  onChange: (f: FonteCitada[]) => void;
}) {
  const [q, setQ] = useState("");
  const [aplicada, setAplicada] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setAplicada(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const pesquisa = useDados<{ itens: FonteCitada[] }>(
    aplicada.length >= 2
      ? `/v1/painel/conhecimento/trechos?limite=8&q=${encodeURIComponent(aplicada.slice(0, 200))}`
      : null,
  );
  const escolhidos = new Set(fontes.map((f) => f.trecho_id));
  const resultados = (pesquisa.dados?.itens ?? []).filter((t) => !escolhidos.has(t.trecho_id));
  const nome = (f: FonteCitada) => (f.referencia ? `${f.titulo}, ${f.referencia}` : f.titulo);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-tinta">Fontes</span>
      {fontes.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {fontes.map((f) => (
            <li
              key={f.trecho_id}
              className="flex items-center gap-2 rounded-[10px] bg-creme px-3 py-2 text-[13px] text-tinta"
            >
              <span className="min-w-0 flex-1 truncate">{nome(f)}</span>
              {f.url && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-tinta-3 hover:text-tinta"
                  aria-label={`Abrir ${nome(f)} (nova janela)`}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
              <button
                type="button"
                onClick={() => onChange(fontes.filter((x) => x.trecho_id !== f.trecho_id))}
                className="text-tinta-3 hover:text-tinta"
                aria-label={`Tirar ${nome(f)}`}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-tinta-3">Ainda sem fontes. Procure abaixo o artigo ou a página.</p>
      )}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-3"
          aria-hidden
        />
        <input
          type="search"
          className={`${classeEntrada} pl-9`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Procurar nas fontes (ex.: obras isentas)"
          aria-label="Procurar trechos das fontes"
        />
      </div>
      {aplicada.length >= 2 && (
        <div aria-live="polite" className="flex flex-col gap-1">
          {pesquisa.aCarregar && !pesquisa.dados ? (
            <p className="text-xs text-tinta-3">A procurar…</p>
          ) : pesquisa.erro ? (
            <ErroLinha erro={pesquisa.erro} />
          ) : resultados.length === 0 ? (
            <p className="text-xs text-tinta-3">Nenhum trecho encontrado.</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {resultados.map((t) => (
                <li key={t.trecho_id}>
                  <button
                    type="button"
                    onClick={() => onChange([...fontes, t])}
                    className="flex w-full items-start gap-2 rounded-[10px] border border-linha px-3 py-2 text-left hover:bg-creme"
                  >
                    <Plus className="mt-0.5 size-3.5 shrink-0 text-terracota-escuro" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-semibold text-tinta">{nome(t)}</span>
                      {t.texto && (
                        <span className="line-clamp-2 text-xs text-tinta-2">{t.texto}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Formulário de uma resposta (nova, versão nova ou resposta a uma pergunta
 * sem resposta). Os campos de lista são uma linha por item.
 */
export function FormularioResposta({
  inicial = VAZIO,
  comPergunta = true,
  comTema = true,
  rotuloFrases = "Outras formas de perguntar (uma por linha)",
  textoGuardar = "Guardar",
  aCorrer,
  erro,
  onGuardar,
  onCancelar,
}: {
  inicial?: ValoresResposta;
  comPergunta?: boolean;
  comTema?: boolean;
  rotuloFrases?: string;
  textoGuardar?: string;
  aCorrer: boolean;
  erro: ErroApi | null;
  onGuardar: (v: ValoresResposta) => void;
  onCancelar?: () => void;
}) {
  const [v, setV] = useState(inicial);
  const temas = useDados<Mapa>(comTema ? "/v1/painel/conhecimento/mapa" : null);
  const muda = <K extends keyof ValoresResposta>(k: K, x: ValoresResposta[K]) =>
    setV((a) => ({ ...a, [k]: x }));
  const l = linguagem(v.texto_voz);
  const sms = v.texto_sms.length;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar(v);
      }}
    >
      {comPergunta && (
        <Campo rotulo="A pergunta, como as pessoas a fazem">
          <input
            className={classeEntrada}
            value={v.pergunta_tipo}
            onChange={(e) => muda("pergunta_tipo", e.target.value)}
            required
            minLength={3}
            maxLength={300}
            placeholder="Preciso de licença para obras na cozinha?"
          />
        </Campo>
      )}
      {comTema && (
        <Campo rotulo="Tema">
          <select
            className={classeEntrada}
            value={v.tema_id ?? ""}
            onChange={(e) => muda("tema_id", e.target.value || null)}
          >
            <option value="">Sem tema</option>
            {temas.dados?.temas.map((t) => (
              <option key={t.tema_id} value={t.tema_id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
      )}
      <div className="flex flex-col gap-2">
        <Campo rotulo="O que o agente vai dizer (ao telefone e no chat)">
          <textarea
            className={`${classeEntrada} min-h-28`}
            value={v.texto_voz}
            onChange={(e) => muda("texto_voz", e.target.value)}
            required
            maxLength={4000}
          />
        </Campo>
        <p className={`flex items-center gap-1.5 text-xs ${l.ok ? "text-verde" : "text-ambar"}`}>
          {l.ok && <Check className="size-3.5" aria-hidden />}
          {l.texto}
        </p>
      </div>
      <Campo
        rotulo="No SMS (opcional)"
        ajuda={
          <span className={sms > 160 ? "font-semibold text-ambar" : ""}>
            {sms} / 160{sms > 160 ? " · vai em mais de uma mensagem" : ""}
          </span>
        }
      >
        <textarea
          className={`${classeEntrada} min-h-16`}
          value={v.texto_sms}
          onChange={(e) => muda("texto_sms", e.target.value)}
          maxLength={640}
        />
      </Campo>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo rotulo="Passa a um funcionário quando (uma por linha)">
          <textarea
            className={`${classeEntrada} min-h-20`}
            value={v.passa_a_pessoa_quando}
            onChange={(e) => muda("passa_a_pessoa_quando", e.target.value)}
            placeholder={"perguntam por prazos\na parede é de suporte"}
          />
        </Campo>
        <Campo rotulo={rotuloFrases}>
          <textarea
            className={`${classeEntrada} min-h-20`}
            value={v.frases}
            onChange={(e) => muda("frases", e.target.value)}
            placeholder={"obras na cozinha\nremodelar a cozinha"}
          />
        </Campo>
      </div>
      <SeletorFontes fontes={v.fontes ?? []} onChange={(f) => muda("fontes", f)} />
      <ErroLinha erro={erro} />
      <div className="flex justify-end gap-2">
        {onCancelar && (
          <Botao variante="discreto" onClick={onCancelar}>
            Cancelar
          </Botao>
        )}
        <Botao type="submit" icone={Save} disabled={aCorrer}>
          {aCorrer ? "A guardar…" : textoGuardar}
        </Botao>
      </div>
    </form>
  );
}
