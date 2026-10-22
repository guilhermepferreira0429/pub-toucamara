"use client";

import { Save, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { classeEntrada, dia, ErroLinha, Pilula, useAcao } from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { ErroApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";
import { AvisoSms, CampoForm, comErro, PreVisualizacao } from "./comum";
import { EscolherFreguesias } from "./freguesias";
import {
  corpoComunicado,
  errosDaApi,
  itemDeComunicado,
  TIPOS_COMUNICADO,
  validarComunicado,
  type Comunicado,
  type ContextoAgora,
  type Erros,
  type FormComunicado,
} from "./tipos";

/*
 * Criar ou editar um comunicado / notícia: tipo, título, texto, imagem
 * (endereço), âmbito (todo o concelho ou freguesias). À direita a
 * pré-visualização e quem é avisado por SMS ao publicar.
 */

const IDS: Record<string, string> = {
  tipo: "c-tipo-comunicado",
  titulo: "c-titulo",
  texto: "c-texto",
  imagem_url: "c-imagem",
  freguesias: "c-freguesias",
};

function focarPrimeiro(e: Erros) {
  const k = Object.keys(IDS).find((x) => e[x]);
  if (k) document.getElementById(IDS[k])?.focus();
}

export function FormularioComunicado({
  comunicado,
  contexto,
  onGuardado,
  onCancelar,
}: {
  comunicado?: Comunicado;
  contexto: ContextoAgora | undefined;
  onGuardado: (c: Comunicado, publicado: boolean) => void;
  onCancelar: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [f, setF] = useState<FormComunicado>({
    tipo: comunicado?.tipo ?? "comunicado",
    titulo: comunicado?.titulo ?? "",
    texto: comunicado?.texto ?? "",
    imagem_url: comunicado?.imagem_url ?? "",
    concelho: !comunicado?.freguesias?.length,
    freguesias: comunicado?.freguesias ?? [],
  });
  const [erros, setErros] = useState<Erros>({});
  const [tentou, setTentou] = useState(false);
  const muda = (p: Partial<FormComunicado>) => {
    const n = { ...f, ...p };
    setF(n);
    if (tentou) setErros(validarComunicado(n));
  };
  const publicado = comunicado?.estado === "publicado";
  const dias = contexto?.parametros.comunicado_visivel_dias ?? 30;

  const pedidoAbr = useMemo(
    () => ({
      fonte: "comunicado" as const,
      tipo: f.tipo,
      freguesias: f.concelho ? null : f.freguesias,
    }),
    [f.tipo, f.concelho, f.freguesias],
  );

  const guardar = async (publicar: boolean) => {
    setTentou(true);
    const e = validarComunicado(f);
    setErros(e);
    if (Object.keys(e).length) {
      focarPrimeiro(e);
      return;
    }
    const corpo = corpoComunicado(f);
    const r = await acao.executar(async () => {
      try {
        let c = comunicado
          ? await pedido<Comunicado>(`/v1/painel/comunicados/${comunicado.id}`, { metodo: "PATCH", corpo })
          : await pedido<Comunicado>("/v1/painel/comunicados", { metodo: "POST", corpo: { ...corpo, publicar } });
        if (comunicado && publicar && c.estado !== "publicado") {
          c = await pedido<Comunicado>(`/v1/painel/comunicados/${c.id}/publicar`, { metodo: "POST" });
        }
        return c;
      } catch (x) {
        if (x instanceof ErroApi) {
          const campos = errosDaApi(x.detalhes);
          if (Object.keys(campos).length) {
            setErros(campos);
            focarPrimeiro(campos);
          }
        }
        throw x;
      }
    });
    if (r) onGuardado(r, publicar && !publicado);
  };

  const quantos = Object.keys(erros).length;

  return (
    <form
      noValidate
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
      onSubmit={(e) => {
        e.preventDefault();
        void guardar(false);
      }}
    >
      <div className="flex flex-col gap-4">
        {quantos > 0 && (
          <p role="alert" className="rounded-[10px] bg-terracota-suave/60 px-3 py-2 text-[13px] text-terracota-escuro">
            {quantos === 1 ? "Há um campo a corrigir." : `Há ${quantos} campos a corrigir.`}
          </p>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-[13px] font-semibold text-tinta">Tipo</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(TIPOS_COMUNICADO) as (keyof typeof TIPOS_COMUNICADO)[]).map((t) => (
              <label
                key={t}
                className={`flex min-h-11 cursor-pointer gap-2.5 rounded-xl border p-3 ${
                  f.tipo === t ? "border-terracota bg-terracota-suave/30" : "border-linha bg-creme"
                }`}
              >
                <input
                  type="radio"
                  name="tipo"
                  id={`c-tipo-${t}`}
                  value={t}
                  checked={f.tipo === t}
                  onChange={() => muda({ tipo: t })}
                  className="mt-0.5 size-4 accent-terracota"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-tinta">{TIPOS_COMUNICADO[t].rotulo}</span>
                  <span className="text-xs text-tinta-2">{TIPOS_COMUNICADO[t].ajuda}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <CampoForm id={IDS.titulo} rotulo="Título" erro={erros.titulo} ajuda="Curto e claro: é o que se lê primeiro.">
          {(a) => (
            <input
              {...a}
              className={comErro(`${classeEntrada} min-h-11`, erros.titulo)}
              value={f.titulo}
              maxLength={140}
              onChange={(e) => muda({ titulo: e.target.value })}
            />
          )}
        </CampoForm>

        <CampoForm
          id={IDS.texto}
          rotulo="Texto"
          erro={erros.texto}
          ajuda={`${f.texto.trim().length} de 5000 caracteres. No /agora aparecem as primeiras linhas; o resto no detalhe.`}
        >
          {(a) => (
            <textarea
              {...a}
              rows={7}
              className={comErro(classeEntrada, erros.texto)}
              value={f.texto}
              maxLength={5000}
              onChange={(e) => muda({ texto: e.target.value })}
            />
          )}
        </CampoForm>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-[13px] font-semibold text-tinta">Para quem</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { v: true, r: "Todo o concelho", a: "Aparece a toda a gente. Não envia SMS." },
              { v: false, r: "Só algumas freguesias", a: "Avisa quem subscreveu essas freguesias." },
            ].map((o) => (
              <label
                key={String(o.v)}
                className={`flex min-h-11 cursor-pointer gap-2.5 rounded-xl border p-3 ${
                  f.concelho === o.v ? "border-terracota bg-terracota-suave/30" : "border-linha bg-creme"
                }`}
              >
                <input
                  type="radio"
                  name="ambito"
                  checked={f.concelho === o.v}
                  onChange={() => muda({ concelho: o.v })}
                  className="mt-0.5 size-4 accent-terracota"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-tinta">{o.r}</span>
                  <span className="text-xs text-tinta-2">{o.a}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-tinta-3">
            Os comunicados ficam no concelho ou nas freguesias: não têm ponto no mapa. Para um sítio exato (uma
            rua, um largo) use um evento ou um aviso por zona.
          </p>
        </fieldset>

        {!f.concelho && (
          <CampoForm id={IDS.freguesias} rotulo="Freguesias" erro={erros.freguesias}>
            {(a) => (
              <EscolherFreguesias
                id={a.id}
                valor={f.freguesias}
                onMudar={(v) => muda({ freguesias: v })}
                conhecidas={contexto?.freguesias ?? []}
                erro={erros.freguesias}
                descricao={a["aria-describedby"]}
              />
            )}
          </CampoForm>
        )}

        <CampoForm
          id={IDS.imagem_url}
          rotulo="Imagem"
          opcional
          erro={erros.imagem_url}
          ajuda="O endereço de uma imagem já publicada (por exemplo, no site da câmara)."
        >
          {(a) => (
            <input
              {...a}
              type="url"
              inputMode="url"
              placeholder="https://"
              className={comErro(`${classeEntrada} min-h-11`, erros.imagem_url)}
              value={f.imagem_url}
              onChange={(e) => muda({ imagem_url: e.target.value })}
            />
          )}
        </CampoForm>

        <div className="flex flex-col gap-1 rounded-xl bg-creme px-3 py-2.5 text-[13px] text-tinta-2">
          <p>
            <span className="font-semibold text-tinta">Quanto tempo fica no /agora: </span>
            {comunicado?.visivel_ate
              ? `até ${dia(comunicado.visivel_ate)} (${dias} dias depois de publicado).`
              : `${dias} dias a contar da publicação.`}{" "}
            Pode despublicá-lo antes.
          </p>
          {contexto?.parametros.demonstracao && <Pilula className="w-fit">valores de demonstração</Pilula>}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <PreVisualizacao
          item={itemDeComunicado(f, comunicado?.id ?? "previa", comunicado?.publicado_em ?? null)}
          slug={contexto?.municipio.slug ?? ""}
        />
        {!publicado && <AvisoSms pedidoAbr={pedidoAbr} jaPublicado={!!comunicado?.publicado_em} />}
        {publicado && (
          <p className="rounded-xl border border-linha bg-creme p-3 text-[13px] text-tinta-2">
            Já está publicado: o que mudar aparece logo no /agora, sem novo aviso por SMS.
          </p>
        )}
        <ErroLinha erro={acao.erro} />
        <div className="flex flex-wrap justify-end gap-2">
          <Botao variante="discreto" className="min-h-11" onClick={onCancelar}>
            Cancelar
          </Botao>
          <Botao type="submit" variante="secundario" icone={Save} className="min-h-11" disabled={acao.aCorrer}>
            {publicado ? "Guardar" : "Guardar rascunho"}
          </Botao>
          {!publicado && (
            <Botao icone={Send} className="min-h-11" disabled={acao.aCorrer} onClick={() => void guardar(true)}>
              Publicar
            </Botao>
          )}
        </div>
      </div>
    </form>
  );
}
