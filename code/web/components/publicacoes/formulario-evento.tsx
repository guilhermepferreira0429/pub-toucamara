"use client";

import type { ApiMapa } from "@/components/mapa/tipos";
import { Crosshair, Save, Send, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import { classeEntrada, dia, ErroLinha, Pilula, useAcao } from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { ErroApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";
import { AvisoSms, CampoForm, comErro, PreVisualizacao } from "./comum";
import {
  corpoEvento,
  errosDaApi,
  itemDeEvento,
  paraLocal,
  validarEvento,
  type ContextoAgora,
  type Erros,
  type Evento,
  type FormEvento,
} from "./tipos";

/*
 * Criar ou editar um evento da câmara: nome, descrição, quando (início e
 * fim), local (nome + ponto no mini-mapa), freguesia e link. À direita a
 * pré-visualização e quem é avisado ao publicar.
 */

const MapaPonto = dynamic(() => import("./mapa-ponto"), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-xl bg-creme-2" />,
});

const IDS: Record<string, string> = {
  titulo: "e-titulo",
  descricao: "e-descricao",
  inicio: "e-inicio",
  fim: "e-fim",
  local: "e-local",
  lat: "e-lat",
  freguesia: "e-freguesia",
  link: "e-link",
};

function focarPrimeiro(e: Erros) {
  const k = Object.keys(IDS).find((x) => e[x]);
  if (k) document.getElementById(IDS[k])?.focus();
}

function numeroOuNada(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return v.trim() && Number.isFinite(n) ? n : null;
}

export function FormularioEvento({
  evento,
  contexto,
  onGuardado,
  onCancelar,
}: {
  evento?: Evento;
  contexto: ContextoAgora | undefined;
  onGuardado: (e: Evento, publicado: boolean) => void;
  onCancelar: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const mapa = useRef<ApiMapa | null>(null);
  const ligarMapa = useCallback((m: ApiMapa | null) => {
    mapa.current = m;
  }, []);
  const [f, setF] = useState<FormEvento>({
    titulo: evento?.titulo ?? "",
    descricao: evento?.descricao ?? "",
    local: evento?.local ?? "",
    ponto: evento && evento.lat !== null && evento.lng !== null ? { lat: evento.lat, lng: evento.lng } : null,
    inicio: paraLocal(evento?.inicio),
    fim: paraLocal(evento?.fim),
    freguesia: evento?.freguesia ?? "",
    link: evento?.link ?? "",
  });
  // O texto das coordenadas (para se poder escrever "41,44" sem saltar).
  const [coords, setCoords] = useState({
    lat: f.ponto ? String(f.ponto.lat) : "",
    lng: f.ponto ? String(f.ponto.lng) : "",
  });
  const [erros, setErros] = useState<Erros>({});
  const [tentou, setTentou] = useState(false);
  const muda = (p: Partial<FormEvento>) => {
    const n = { ...f, ...p };
    setF(n);
    if (tentou) setErros(validarEvento(n));
  };
  const porPonto = (p: { lat: number; lng: number } | null) => {
    muda({ ponto: p });
    setCoords({ lat: p ? p.lat.toFixed(6) : "", lng: p ? p.lng.toFixed(6) : "" });
  };
  const porCoords = (c: { lat: string; lng: string }) => {
    setCoords(c);
    const lat = numeroOuNada(c.lat);
    const lng = numeroOuNada(c.lng);
    const ok = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    muda({ ponto: ok ? { lat, lng } : null });
  };
  const coordsMeias = (coords.lat.trim() !== "" || coords.lng.trim() !== "") && !f.ponto;
  const errosVistos: Erros = {
    ...erros,
    lat: erros.lat ?? (tentou && coordsMeias ? "Latitude e longitude vêm juntas (números, por exemplo 41.4425 e -8.2918)." : undefined),
  };

  const publicado = evento?.estado === "publicado";
  const raio = contexto?.parametros.raio_subscricao_m ?? 300;
  const diasDepois = contexto?.parametros.evento_visivel_dias_depois ?? 7;

  const pedidoAbr = useMemo(
    () => ({
      fonte: "evento" as const,
      lat: f.ponto ? Math.round(f.ponto.lat * 1e6) / 1e6 : null,
      lng: f.ponto ? Math.round(f.ponto.lng * 1e6) / 1e6 : null,
      freguesia: f.freguesia.trim().length >= 2 ? f.freguesia.trim() : null,
    }),
    [f.ponto, f.freguesia],
  );

  const guardar = async (publicar: boolean) => {
    setTentou(true);
    const e = validarEvento(f);
    if (coordsMeias) e.lat = "Latitude e longitude vêm juntas (números, por exemplo 41.4425 e -8.2918).";
    setErros(e);
    if (Object.keys(e).length) {
      focarPrimeiro(e);
      return;
    }
    const corpo = corpoEvento(f);
    const r = await acao.executar(async () => {
      try {
        let ev = evento
          ? await pedido<Evento>(`/v1/painel/eventos/${evento.id}`, { metodo: "PATCH", corpo })
          : await pedido<Evento>("/v1/painel/eventos", { metodo: "POST", corpo: { ...corpo, publicar } });
        if (evento && publicar && ev.estado !== "publicado") {
          ev = await pedido<Evento>(`/v1/painel/eventos/${ev.id}/publicar`, { metodo: "POST" });
        }
        return ev;
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

  const quantos = Object.values(errosVistos).filter(Boolean).length;

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
        <CampoForm id={IDS.titulo} rotulo="Nome do evento" erro={errosVistos.titulo}>
          {(a) => (
            <input
              {...a}
              className={comErro(`${classeEntrada} min-h-11`, errosVistos.titulo)}
              value={f.titulo}
              maxLength={140}
              onChange={(e) => muda({ titulo: e.target.value })}
            />
          )}
        </CampoForm>
        <CampoForm
          id={IDS.descricao}
          rotulo="Descrição"
          erro={errosVistos.descricao}
          ajuda="O que é, para quem, quem organiza, se é gratuito ou o preço, se é preciso inscrição."
        >
          {(a) => (
            <textarea
              {...a}
              rows={5}
              className={comErro(classeEntrada, errosVistos.descricao)}
              value={f.descricao}
              maxLength={3000}
              onChange={(e) => muda({ descricao: e.target.value })}
            />
          )}
        </CampoForm>

        <div className="grid gap-3 sm:grid-cols-2">
          <CampoForm id={IDS.inicio} rotulo="Começa" erro={errosVistos.inicio}>
            {(a) => (
              <input
                {...a}
                type="datetime-local"
                className={comErro(`${classeEntrada} min-h-11`, errosVistos.inicio)}
                value={f.inicio}
                onChange={(e) => muda({ inicio: e.target.value })}
              />
            )}
          </CampoForm>
          <CampoForm id={IDS.fim} rotulo="Acaba" opcional erro={errosVistos.fim}>
            {(a) => (
              <input
                {...a}
                type="datetime-local"
                min={f.inicio || undefined}
                className={comErro(`${classeEntrada} min-h-11`, errosVistos.fim)}
                value={f.fim}
                onChange={(e) => muda({ fim: e.target.value })}
              />
            )}
          </CampoForm>
        </div>

        <CampoForm
          id={IDS.local}
          rotulo="Local"
          erro={errosVistos.local}
          ajuda="O nome do sítio como as pessoas o conhecem (Largo da Oliveira, Pavilhão Multiusos)."
        >
          {(a) => (
            <input
              {...a}
              className={comErro(`${classeEntrada} min-h-11`, errosVistos.local)}
              value={f.local}
              maxLength={200}
              onChange={(e) => muda({ local: e.target.value })}
            />
          )}
        </CampoForm>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-[13px] font-semibold text-tinta">
            Ponto no mapa <span className="font-normal text-tinta-3">(opcional, mas é o que avisa quem vive perto)</span>
          </legend>
          <MapaPonto
            ponto={f.ponto}
            onPonto={porPonto}
            raioAviso={raio}
            onMapa={ligarMapa}
            rotulo="Mapa para escolher o ponto do evento: clique no mapa para o pôr, arraste o marcador para o mudar"
          />
          <p className="text-xs text-tinta-3">
            Clique no mapa para pôr o ponto. O círculo tracejado mostra até onde chegam as subscrições feitas pela rua
            ({raio} m).
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <CampoForm id={IDS.lat} rotulo="Latitude" erro={errosVistos.lat}>
              {(a) => (
                <input
                  {...a}
                  inputMode="decimal"
                  className={comErro(`${classeEntrada} min-h-11`, errosVistos.lat)}
                  value={coords.lat}
                  placeholder="41.4425"
                  onChange={(e) => porCoords({ ...coords, lat: e.target.value })}
                />
              )}
            </CampoForm>
            <CampoForm id="e-lng" rotulo="Longitude">
              {(a) => (
                <input
                  {...a}
                  aria-invalid={!!errosVistos.lat}
                  inputMode="decimal"
                  className={comErro(`${classeEntrada} min-h-11`, errosVistos.lat)}
                  value={coords.lng}
                  placeholder="-8.2918"
                  onChange={(e) => porCoords({ ...coords, lng: e.target.value })}
                />
              )}
            </CampoForm>
            <Botao
              variante="secundario"
              icone={Crosshair}
              className="min-h-11"
              onClick={() => {
                const c = mapa.current?.centro();
                if (c) porPonto({ lat: c.lat, lng: c.lng });
              }}
            >
              Centro do mapa
            </Botao>
            <Botao
              variante="discreto"
              icone={Trash2}
              className="min-h-11"
              disabled={!f.ponto}
              onClick={() => porPonto(null)}
            >
              Tirar ponto
            </Botao>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <CampoForm id={IDS.freguesia} rotulo="Freguesia" opcional erro={errosVistos.freguesia}>
            {(a) => (
              <>
                <input
                  {...a}
                  list="e-freguesias-lista"
                  className={comErro(`${classeEntrada} min-h-11`, errosVistos.freguesia)}
                  value={f.freguesia}
                  maxLength={120}
                  onChange={(e) => muda({ freguesia: e.target.value })}
                />
                <datalist id="e-freguesias-lista">
                  {(contexto?.freguesias ?? []).map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </>
            )}
          </CampoForm>
          <CampoForm
            id={IDS.link}
            rotulo="Link"
            opcional
            erro={errosVistos.link}
            ajuda="Página do evento ou das inscrições."
          >
            {(a) => (
              <input
                {...a}
                type="url"
                inputMode="url"
                placeholder="https://"
                className={comErro(`${classeEntrada} min-h-11`, errosVistos.link)}
                value={f.link}
                onChange={(e) => muda({ link: e.target.value })}
              />
            )}
          </CampoForm>
        </div>

        <div className="flex flex-col gap-1 rounded-xl bg-creme px-3 py-2.5 text-[13px] text-tinta-2">
          <p>
            <span className="font-semibold text-tinta">Quanto tempo fica na página «O que se passa»: </span>
            {evento?.visivel_ate
              ? `até ${dia(evento.visivel_ate)} (${diasDepois} dias depois de acabar).`
              : `desde que é publicado até ${diasDepois} dias depois de acabar.`}
          </p>
          {contexto?.parametros.demonstracao && <Pilula className="w-fit">valores de demonstração</Pilula>}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <PreVisualizacao
          item={itemDeEvento(f, evento?.id ?? "previa", evento?.publicado_em ?? null)}
          slug={contexto?.municipio.slug ?? ""}
        />
        {!publicado && <AvisoSms pedidoAbr={pedidoAbr} jaPublicado={!!evento?.publicado_em} />}
        {publicado && (
          <p className="rounded-xl border border-linha bg-creme p-3 text-[13px] text-tinta-2">
            Já está publicado: o que mudar aparece logo na página «O que se passa», sem novo aviso por SMS.
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
