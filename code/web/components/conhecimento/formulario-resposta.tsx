"use client";

import { Check, Save } from "lucide-react";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import type { ErroApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";
import { Campo, classeEntrada, ErroLinha, useDados } from "./comum";
import type { Definicoes, Mapa } from "./tipos";

export interface ValoresResposta {
  pergunta_tipo: string;
  tema_id: string | null;
  texto_voz: string;
  texto_sms: string;
  passa_a_pessoa_quando: string;
  frases: string;
}

export const VAZIO: ValoresResposta = {
  pergunta_tipo: "",
  tema_id: null,
  texto_voz: "",
  texto_sms: "",
  passa_a_pessoa_quando: "",
  frases: "",
};

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
