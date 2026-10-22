"use client";

import "leaflet/dist/leaflet.css";
import "./mapa.css";
import L from "leaflet";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Circle, CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { CENTRO_OMISSAO } from "./config";
import { Controlos, type EstadoLocalizacao } from "./controlos";
import { bboxTexto, chavePontos, menosMovimento, pedirLocalizacao } from "./geometria";
import type { LatLng, MarcadorMapa, PropsMapaCidade } from "./tipos";
import { PontoAqui } from "./vidro";

/*
 * O motor Leaflet + OpenStreetMap do MapaCidade (sem token do Mapbox, ou se
 * o Mapbox falhar). A mesma API, em 2D: sem 3D nem bússola. Os marcadores
 * React vão para dentro do elemento de um L.divIcon (portal).
 */

/** Marcador React num L.marker (o divIcon tem 0×0; o CSS põe a âncora). */
function MarcadorLf({
  m,
  interativo,
  aoSelecionar,
  aoArrastar,
}: {
  m: MarcadorMapa;
  interativo: boolean;
  aoSelecionar?: (id: string) => void;
  aoArrastar?: (id: string, p: LatLng) => void;
}) {
  const map = useMap();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const marcador = useRef<L.Marker | null>(null);
  const chamadas = useRef({ aoSelecionar, aoArrastar, id: m.id });
  useEffect(() => {
    chamadas.current = { aoSelecionar, aoArrastar, id: m.id };
  });

  const arrastavel = !!m.arrastavel;
  useEffect(() => {
    const mk = L.marker([m.lat, m.lng], {
      icon: L.divIcon({ className: "mapa-marcador mapa-marcador-lf", html: "", iconSize: [0, 0] }),
      keyboard: interativo,
      interactive: interativo || arrastavel,
      draggable: arrastavel,
      zIndexOffset: m.frente ? 1000 : 0,
      riseOnHover: true,
    }).addTo(map);
    marcador.current = mk;
    mk.on("click", () => chamadas.current.aoSelecionar?.(chamadas.current.id));
    mk.on("dragend", () => {
      const p = mk.getLatLng();
      chamadas.current.aoArrastar?.(chamadas.current.id, { lat: p.lat, lng: p.lng });
    });
    setEl(mk.getElement() ?? null);
    return () => {
      mk.remove();
      marcador.current = null;
      setEl(null);
    };
    // A posição e a frente mudam nos efeitos de baixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, interativo, arrastavel]);

  useEffect(() => {
    marcador.current?.setLatLng([m.lat, m.lng]);
  }, [m.lat, m.lng]);
  useEffect(() => {
    marcador.current?.setZIndexOffset(m.frente ? 1000 : 0);
  }, [m.frente]);

  useEffect(() => {
    if (!el) return;
    el.setAttribute("aria-label", m.nome);
    if (interativo) {
      el.setAttribute("role", "button");
    } else {
      el.setAttribute("role", "img");
      if (!arrastavel) el.removeAttribute("tabindex");
    }
  }, [el, m.nome, interativo, arrastavel]);

  if (!el) return null;
  return createPortal(
    <span className={m.ancora === "baixo" ? "mapa-ancora-baixo" : "mapa-ancora-centro"}>
      {m.conteudo ?? <span className="mapa-ponto" style={{ "--cor": m.cor ?? "#b84a24" } as CSSProperties} />}
    </span>,
    el,
  );
}

/** Eventos, API e enquadramento (dentro do MapContainer). */
function Ligacoes(props: PropsMapaCidade & { chamadas: React.RefObject<PropsMapaCidade> }) {
  const { chamadas, enquadrar, enquadrarUmaVez, zoomMaximo = 16, selecionado, seguirSelecionado, marcadores, pontos, margens } =
    props;
  const map = useMapEvents({
    moveend: () => avisar(),
    click: (e) => chamadas.current.aoClicar?.({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  const avisar = useCallback(() => {
    const b = map.getBounds();
    const c = map.getCenter();
    chamadas.current.aoMover?.({
      bbox: bboxTexto(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()),
      zoom: map.getZoom(),
      centro: { lat: c.lat, lng: c.lng },
    });
  }, [map, chamadas]);

  const almofada = useCallback(
    () => ({
      paddingTopLeft: L.point(32 + (margens?.esquerda ?? 0), 32 + (margens?.topo ?? 0)),
      paddingBottomRight: L.point(32 + (margens?.direita ?? 0), 32 + (margens?.baixo ?? 0)),
    }),
    [margens?.esquerda, margens?.topo, margens?.direita, margens?.baixo],
  );

  useEffect(() => {
    avisar();
    chamadas.current.aoPronto?.({
      motor: "leaflet",
      centro: () => {
        const c = map.getCenter();
        return { lat: c.lat, lng: c.lng };
      },
      zoom: () => map.getZoom(),
      contem: (p) => map.getBounds().contains([p.lat, p.lng]),
      voarPara: (p, z) => map.setView([p.lat, p.lng], z ?? map.getZoom(), { animate: !menosMovimento() }),
      enquadrar: (pts, o) => {
        if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { ...almofada(), maxZoom: o?.maxZoom ?? 16 });
      },
    });
    const ref = chamadas;
    return () => ref.current.aoPronto?.(null);
  }, [map, avisar, chamadas, almofada]);

  const chave = chavePontos(enquadrar);
  const feito = useRef<string | null>(null);
  useEffect(() => {
    if (!enquadrar?.length || feito.current === chave) return;
    if (enquadrarUmaVez && feito.current !== null) return;
    const primeira = feito.current === null;
    feito.current = chave;
    const animar = !primeira && !menosMovimento();
    if (enquadrar.length === 1) map.setView([enquadrar[0].lat, enquadrar[0].lng], zoomMaximo, { animate: animar });
    else
      map.fitBounds(L.latLngBounds(enquadrar.map((p) => [p.lat, p.lng])), {
        ...almofada(),
        maxZoom: zoomMaximo,
        animate: animar,
      });
  }, [map, chave, enquadrar, enquadrarUmaVez, zoomMaximo, almofada]);

  useEffect(() => {
    if (!seguirSelecionado || !selecionado) return;
    const alvo = (marcadores ?? []).find((x) => x.id === selecionado) ?? (pontos ?? []).find((x) => x.id === selecionado);
    if (!alvo) return;
    if (!map.getBounds().pad(-0.15).contains([alvo.lat, alvo.lng])) {
      map.panTo([alvo.lat, alvo.lng], { animate: !menosMovimento() });
    }
    // Só quando muda o selecionado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selecionado, seguirSelecionado]);
  return null;
}

/** Os botões em vidro (zoom e localização; sem 3D no Leaflet). */
function ControlosLf({
  props,
  aoAqui,
}: {
  props: PropsMapaCidade;
  aoAqui: (p: LatLng) => void;
}) {
  const map = useMap();
  const [estado, setEstado] = useState<EstadoLocalizacao>("inativo");
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Os botões estão dentro do contentor do Leaflet: não arrastam nem fazem zoom ao mapa.
    if (!caixa.current) return;
    L.DomEvent.disableClickPropagation(caixa.current);
    L.DomEvent.disableScrollPropagation(caixa.current);
  }, []);
  const c = props.controlos;
  if (!c || props.estatico) return null;
  const localizar = () => {
    setEstado("a_pedir");
    pedirLocalizacao()
      .then((p) => {
        setEstado("ok");
        aoAqui(p);
        props.aoLocalizar?.(p);
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15), { animate: !menosMovimento() });
      })
      .catch((e: Error) => setEstado(e.message === "recusado" ? "recusado" : "indisponivel"));
  };
  return (
    <div ref={caixa} className="contents">
    <Controlos
      posicao={c.posicao}
      direita={12 + (props.margens?.direita ?? 0)}
      baixo={(props.margens?.baixo ?? 0) + 40}
      zoom={c.zoom ? { mais: () => map.zoomIn(), menos: () => map.zoomOut() } : undefined}
      localizacao={c.localizacao ? { pedir: localizar, estado } : undefined}
    />
    </div>
  );
}

export default function MotorLeaflet(props: PropsMapaCidade) {
  const { marcadores = [], pontos = [], formas = [], selecionado, estatico, aqui: aquiFora } = props;
  const chamadas = useRef<PropsMapaCidade>(props);
  useEffect(() => {
    chamadas.current = props;
  });
  const [aquiDentro, setAquiDentro] = useState<LatLng | null>(null);
  const aqui = aquiFora === undefined ? aquiDentro : aquiFora;
  const [inicio] = useState(() => {
    const c = props.centro ?? props.enquadrar?.[0] ?? CENTRO_OMISSAO;
    return { centro: [c.lat, c.lng] as [number, number], zoom: props.zoom ?? 14 };
  });
  const interativo = !estatico && !!props.aoSelecionar;

  return (
    <div
      className="mapa-motor"
      style={
        {
          "--mapa-baixo": `${props.margens?.baixo ?? 0}px`,
          "--mapa-direita": `${props.margens?.direita ?? 0}px`,
        } as CSSProperties
      }
    >
      <MapContainer
        center={inicio.centro}
        zoom={inicio.zoom}
        zoomControl={false}
        scrollWheelZoom={!estatico && (props.rodaRato ?? !props.cooperativo)}
        dragging={!estatico}
        doubleClickZoom={!estatico}
        touchZoom={!estatico}
        keyboard={!estatico}
        boxZoom={!estatico}
        className="size-full"
        attributionControl
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        {formas.map((f) => {
          const opcoes = {
            color: f.cor,
            weight: f.esbatida ? 1 : (f.espessura ?? 2.5),
            opacity: f.esbatida ? 0.4 : 1,
            fillOpacity: f.esbatida ? 0.05 : (f.preenchimento ?? 0.2),
            dashArray: f.tracejado ? "6 6" : undefined,
          };
          const balao = f.rotulo ? <Tooltip sticky>{f.rotulo}</Tooltip> : null;
          return f.tipo === "poligono" ? (
            <Polygon
              key={f.id}
              positions={f.pontos.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={opcoes}
              interactive={!!f.rotulo}
            >
              {balao}
            </Polygon>
          ) : (
            <Circle
              key={f.id}
              center={[f.centro.lat, f.centro.lng]}
              radius={f.raio_m}
              pathOptions={opcoes}
              interactive={!!f.rotulo}
            >
              {balao}
            </Circle>
          );
        })}
        {pontos.map((p) => {
          const ativo = p.id === selecionado;
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={ativo ? 15 : 9}
              pathOptions={{ color: "#ffffff", weight: ativo ? 3.5 : 2, fillColor: p.cor, fillOpacity: 1 }}
              eventHandlers={{ click: () => chamadas.current.aoSelecionar?.(p.id) }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                {p.rotulo}
              </Tooltip>
            </CircleMarker>
          );
        })}
        {marcadores.map((m) => (
          <MarcadorLf
            key={m.id}
            m={m}
            interativo={interativo}
            aoSelecionar={props.aoSelecionar}
            aoArrastar={props.aoArrastar}
          />
        ))}
        {aqui && <MarcadorLf m={{ id: "__aqui", ...aqui, nome: "Está aqui", conteudo: <PontoAqui /> }} interativo={false} />}
        <Ligacoes {...props} chamadas={chamadas} />
        <ControlosLf props={props} aoAqui={setAquiDentro} />
      </MapContainer>
    </div>
  );
}
