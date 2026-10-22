"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import "./mapa.css";
import mapboxgl, { type GeoJSONSource, type LngLatLike } from "mapbox-gl";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  CENTRO_OMISSAO,
  configDe,
  eSatelite,
  eStandard,
  estiloMapbox,
  estilosDoBotao,
  guardarPreferenciaSatelite,
  lerPreferenciaSatelite,
  tokenMapbox,
  VISTA_2D,
  VISTA_3D,
  VISTA_INCLINADA,
} from "./config";
import { Controlos, type EstadoLocalizacao } from "./controlos";
import { bboxTexto, caixa, chavePontos, contorno, menosMovimento, pedirLocalizacao } from "./geometria";
import type { LatLng, MarcadorMapa, ModoVista, PropsMapaCidade } from "./tipos";
import { PontoAqui } from "./vidro";

/*
 * O motor Mapbox GL (v3) do MapaCidade: estilo Standard (edifícios 3D,
 * luz de dia, cores da marca) ou Standard Satellite, vista oblíqua, zonas
 * (preenchidas; em volume no 3D), pontos em camada de círculos (muitos) e
 * marcadores React (poucos, focáveis). Só corre no browser e só se carrega
 * nas páginas com mapa (next/dynamic). Se o estilo não abrir (token errado,
 * sem WebGL, sem rede para o Mapbox), avisa com aoFalhar e o MapaCidade
 * passa para o Leaflet.
 */

const ORIGEM_FORMAS = "tc-formas";
const ORIGEM_PONTOS = "tc-pontos";
const CAMADA_PREENCHER = "tc-formas-preencher";
const CAMADA_LINHA = "tc-formas-linha";
const CAMADA_VOLUME = "tc-formas-volume";
const CAMADA_PONTOS = "tc-pontos-circulos";
const ORIGEM_RELEVO = "tc-relevo";

/** Os textos dos controlos do Mapbox em português. */
const LOCALE_PT = {
  "AttributionControl.ToggleAttribution": "Mostrar ou esconder os créditos do mapa",
  "LogoControl.Title": "Logótipo do Mapbox",
  "Map.Title": "Mapa",
  "NavigationControl.ResetBearing": "Apontar para norte",
  "NavigationControl.ZoomIn": "Aproximar",
  "NavigationControl.ZoomOut": "Afastar",
  "ScrollZoomBlocker.CtrlMessage": "Use Ctrl + roda do rato para aproximar o mapa",
  "ScrollZoomBlocker.CmdMessage": "Use ⌘ + roda do rato para aproximar o mapa",
  "TouchPanBlocker.Message": "Use dois dedos para mexer no mapa",
};

function vistaDe(v: ModoVista) {
  return v === "3d" ? VISTA_3D : v === "inclinado" ? VISTA_INCLINADA : VISTA_2D;
}

function lngLat(p: LatLng): LngLatLike {
  return [p.lng, p.lat];
}

/** Um marcador React dentro de um mapboxgl.Marker (portal para o elemento). */
function MarcadorMb({
  mapa,
  m,
  interativo,
  aoSelecionar,
  aoArrastar,
}: {
  mapa: mapboxgl.Map;
  m: MarcadorMapa;
  interativo: boolean;
  aoSelecionar?: (id: string) => void;
  aoArrastar?: (id: string, p: LatLng) => void;
}) {
  const [el] = useState(() => document.createElement("div"));
  const marcador = useRef<mapboxgl.Marker | null>(null);
  const chamadas = useRef({ aoSelecionar, aoArrastar, id: m.id });
  useEffect(() => {
    chamadas.current = { aoSelecionar, aoArrastar, id: m.id };
  });

  const ancora = m.ancora === "baixo" ? "bottom" : "center";
  const arrastavel = !!m.arrastavel;
  useEffect(() => {
    const mk = new mapboxgl.Marker({ element: el, anchor: ancora, draggable: arrastavel, occludedOpacity: 1 })
      .setLngLat([m.lng, m.lat])
      .addTo(mapa);
    marcador.current = mk;
    const aoFim = () => {
      const p = mk.getLngLat();
      chamadas.current.aoArrastar?.(chamadas.current.id, { lat: p.lat, lng: p.lng });
    };
    mk.on("dragend", aoFim);
    return () => {
      mk.off("dragend", aoFim);
      mk.remove();
      marcador.current = null;
    };
    // A posição muda no efeito de baixo (sem recriar o marcador).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa, el, ancora, arrastavel]);

  useEffect(() => {
    marcador.current?.setLngLat([m.lng, m.lat]);
  }, [m.lat, m.lng]);

  // Nome acessível, foco e teclado (o Mapbox põe "Map marker" por omissão).
  useEffect(() => {
    el.classList.add("mapa-marcador");
    el.classList.toggle("mapa-marcador-frente", !!m.frente);
    el.setAttribute("aria-label", m.nome);
    if (interativo) {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
    } else {
      el.setAttribute("role", "img");
      el.removeAttribute("tabindex");
    }
    if (!interativo) return;
    const clicar = (ev: Event) => {
      ev.stopPropagation();
      chamadas.current.aoSelecionar?.(chamadas.current.id);
    };
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        chamadas.current.aoSelecionar?.(chamadas.current.id);
      }
    };
    el.addEventListener("click", clicar);
    el.addEventListener("keydown", tecla);
    return () => {
      el.removeEventListener("click", clicar);
      el.removeEventListener("keydown", tecla);
    };
  }, [el, m.nome, m.frente, interativo]);

  return createPortal(
    m.conteudo ?? <span className="mapa-ponto" style={{ "--cor": m.cor ?? "#b84a24" } as CSSProperties} />,
    el,
  );
}

function geojsonFormas(formas: PropsMapaCidade["formas"]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (formas ?? []).map((f) => {
      const anel = contorno(f).map((p) => [p.lng, p.lat]);
      if (anel.length && (anel[0][0] !== anel[anel.length - 1][0] || anel[0][1] !== anel[anel.length - 1][1])) {
        anel.push(anel[0]);
      }
      return {
        type: "Feature",
        id: f.id,
        properties: {
          id: f.id,
          cor: f.cor,
          preencher: f.esbatida ? 0.05 : (f.preenchimento ?? 0.2),
          espessura: f.esbatida ? 1 : (f.espessura ?? 2.5),
          opacidade: f.esbatida ? 0.4 : 1,
          tracejado: !!f.tracejado,
          altura: f.altura_m ?? 0,
          rotulo: f.rotulo ?? "",
        },
        geometry: { type: "Polygon", coordinates: [anel] },
      };
    }),
  };
}

function geojsonPontos(pontos: PropsMapaCidade["pontos"]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (pontos ?? []).map((p) => ({
      type: "Feature",
      properties: { id: p.id, cor: p.cor, rotulo: p.rotulo },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

export default function MotorMapbox(props: PropsMapaCidade & { aoFalhar: (motivo: string) => void }) {
  const {
    marcadores = [],
    pontos,
    formas,
    enquadrar,
    enquadrarUmaVez,
    zoomMaximo = 16,
    selecionado = null,
    seguirSelecionado,
    controlos,
    estatico,
    margens,
    aqui: aquiFora,
  } = props;
  const contentor = useRef<HTMLDivElement>(null);
  const [mapa, setMapa] = useState<mapboxgl.Map | null>(null);
  const [estiloPronto, setEstiloPronto] = useState(false);
  const vistaInicial = props.vista ?? "2d";
  const [em3d, setEm3d] = useState(vistaInicial === "3d");
  const [graus, setGraus] = useState<number>(vistaDe(vistaInicial).bearing);
  const [inclinado, setInclinado] = useState(vistaDe(vistaInicial).pitch > 0);
  const [estadoLoc, setEstadoLoc] = useState<EstadoLocalizacao>("inativo");
  const [aquiDentro, setAquiDentro] = useState<LatLng | null>(null);
  const aqui = aquiFora === undefined ? aquiDentro : aquiFora;

  // Satélite / Mapa: com o botão, vale a escolha de quem vê (neste browser).
  const botaoSatelite = !!controlos?.satelite;
  const estilos = estilosDoBotao(props.estilo);
  const [satelite, setSatelite] = useState(() =>
    botaoSatelite
      ? (lerPreferenciaSatelite() ?? eSatelite(estiloMapbox(props.estilo)))
      : eSatelite(estiloMapbox(props.estilo)),
  );
  const estiloAtual = botaoSatelite
    ? satelite
      ? estilos.satelite
      : estilos.mapa
    : estiloMapbox(props.estilo);
  const estiloInicial = useRef(estiloAtual);
  const eventosLigados = useRef(false);

  // As chamadas mais recentes (os eventos do mapa ligam-se uma vez).
  const chamadas = useRef(props);
  useEffect(() => {
    chamadas.current = props;
  });

  // Criar o mapa (uma vez).
  useEffect(() => {
    const el = contentor.current;
    const token = tokenMapbox();
    if (!el || !token) return;
    const p = chamadas.current;
    const estilo = estiloInicial.current;
    const v = vistaDe(p.vista ?? "2d");
    const c = p.centro ?? p.enquadrar?.[0] ?? CENTRO_OMISSAO;
    const cooperativo = p.cooperativo ?? false;
    let m: mapboxgl.Map;
    try {
      m = new mapboxgl.Map({
        container: el,
        accessToken: token,
        style: estilo,
        config: configDe(estilo),
        center: lngLat(c),
        zoom: p.zoom ?? 14,
        pitch: v.pitch,
        bearing: v.bearing,
        maxPitch: 70,
        language: "pt",
        locale: LOCALE_PT,
        cooperativeGestures: cooperativo && !p.estatico,
        scrollZoom: !p.estatico && (p.rodaRato ?? !cooperativo),
        interactive: !p.estatico,
        attributionControl: false,
        respectPrefersReducedMotion: true,
      });
    } catch {
      p.aoFalhar("sem-webgl");
      return;
    }
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    let carregado = false;
    m.on("error", (e) => {
      // Antes de o estilo abrir, qualquer erro (token, rede) = passar para o Leaflet.
      if (!carregado) chamadas.current.aoFalhar(String((e.error as { status?: number })?.status ?? "estilo"));
    });
    m.on("style.load", () => {
      carregado = true;
      setEstiloPronto(true);
    });
    const avisarMovimento = () => {
      const b = m.getBounds();
      if (!b) return;
      const ctr = m.getCenter();
      chamadas.current.aoMover?.({
        bbox: bboxTexto(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()),
        zoom: m.getZoom(),
        centro: { lat: ctr.lat, lng: ctr.lng },
      });
    };
    m.on("moveend", avisarMovimento);
    m.once("load", avisarMovimento);
    m.on("rotate", () => setGraus(m.getBearing()));
    m.on("pitch", () => setInclinado(m.getPitch() > 1));
    m.on("click", (e) => {
      const emPonto =
        m.getLayer(CAMADA_PONTOS) && m.queryRenderedFeatures(e.point, { layers: [CAMADA_PONTOS] }).length > 0;
      if (!emPonto) chamadas.current.aoClicar?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    setMapa(m);
    const api = {
      motor: "mapbox" as const,
      centro: () => {
        const x = m.getCenter();
        return { lat: x.lat, lng: x.lng };
      },
      zoom: () => m.getZoom(),
      contem: (q: LatLng) => !!m.getBounds()?.contains(lngLat(q)),
      voarPara: (q: LatLng, z?: number) =>
        m.easeTo({ center: lngLat(q), zoom: z ?? m.getZoom(), duration: menosMovimento() ? 0 : 700 }),
      enquadrar: (pts: LatLng[], o?: { maxZoom?: number }) => {
        const cx = caixa(pts);
        if (cx) m.fitBounds(cx, { padding: 48, maxZoom: o?.maxZoom ?? 16, duration: menosMovimento() ? 0 : 700 });
      },
    };
    p.aoPronto?.(api);
    return () => {
      chamadas.current.aoPronto?.(null);
      m.remove();
      eventosLigados.current = false;
      setMapa(null);
      setEstiloPronto(false);
    };
  }, []);

  // Trocar de estilo (Satélite / Mapa): as camadas próprias perdem-se com o
  // estilo antigo e voltam a ser criadas no style.load seguinte.
  const estiloAplicado = useRef(estiloAtual);
  useEffect(() => {
    if (!mapa || estiloAplicado.current === estiloAtual) return;
    estiloAplicado.current = estiloAtual;
    setEstiloPronto(false);
    // (Os tipos do mapbox-gl exigem as fontes locais; undefined = as do estilo.)
    mapa.setStyle(estiloAtual, {
      diff: false,
      config: configDe(estiloAtual),
      localFontFamily: undefined,
      localIdeographFontFamily: undefined,
    });
  }, [mapa, estiloAtual]);

  const alternarSatelite = useCallback(() => {
    setSatelite((v) => {
      guardarPreferenciaSatelite(!v);
      return !v;
    });
  }, []);

  // As margens (painéis por cima): a câmara centra-se no espaço que se vê.
  const mTopo = margens?.topo ?? 0;
  const mBaixo = margens?.baixo ?? 0;
  const mEsq = margens?.esquerda ?? 0;
  const mDir = margens?.direita ?? 0;
  useEffect(() => {
    mapa?.setPadding({ top: mTopo, bottom: mBaixo, left: mEsq, right: mDir });
  }, [mapa, mTopo, mBaixo, mEsq, mDir]);

  // Fontes e camadas próprias (zonas e pontos), depois de o estilo abrir.
  const standard = eStandard(estiloAtual);
  useEffect(() => {
    if (!mapa || !estiloPronto) return;
    const slot = standard ? { slot: "middle" } : {};
    if (!mapa.getSource(ORIGEM_FORMAS)) {
      mapa.addSource(ORIGEM_FORMAS, { type: "geojson", data: geojsonFormas([]) });
      mapa.addLayer({
        id: CAMADA_PREENCHER,
        type: "fill",
        source: ORIGEM_FORMAS,
        ...slot,
        paint: {
          "fill-color": ["get", "cor"],
          "fill-opacity": ["get", "preencher"],
          "fill-emissive-strength": 1,
        },
      });
      mapa.addLayer({
        id: CAMADA_LINHA,
        type: "line",
        source: ORIGEM_FORMAS,
        ...slot,
        layout: { "line-join": "round" },
        paint: {
          "line-color": ["get", "cor"],
          "line-width": ["get", "espessura"],
          "line-opacity": ["get", "opacidade"],
          "line-dasharray": ["case", ["get", "tracejado"], ["literal", [2, 2]], ["literal", [1, 0]]],
          "line-emissive-strength": 1,
        },
      });
      mapa.addLayer({
        id: CAMADA_VOLUME,
        type: "fill-extrusion",
        source: ORIGEM_FORMAS,
        ...slot,
        filter: [">", ["get", "altura"], 0],
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": ["get", "cor"],
          "fill-extrusion-height": ["get", "altura"],
          "fill-extrusion-opacity": 0.82,
          "fill-extrusion-emissive-strength": 0.6,
        },
      });
    }
    if (!mapa.getSource(ORIGEM_PONTOS)) {
      mapa.addSource(ORIGEM_PONTOS, { type: "geojson", data: geojsonPontos([]) });
      mapa.addLayer({
        id: CAMADA_PONTOS,
        type: "circle",
        source: ORIGEM_PONTOS,
        ...(standard ? { slot: "top" } : {}),
        paint: {
          "circle-color": ["get", "cor"],
          "circle-radius": 9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-emissive-strength": 1,
          "circle-pitch-alignment": "viewport",
        },
      });
    }
    // Os eventos por camada ficam no mapa e servem para qualquer estilo:
    // ligam-se uma vez (trocar de estilo não os duplica).
    if (!eventosLigados.current) {
      eventosLigados.current = true;
      // Clicar num ponto = selecionar; ao passar o rato, o rótulo.
      const balao = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "mapa-balao" });
      mapa.on("click", CAMADA_PONTOS, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") chamadas.current.aoSelecionar?.(id);
      });
      const mostrar = (e: mapboxgl.MapMouseEvent) => {
        const f = e.features?.[0];
        const rotulo = f?.properties?.rotulo;
        mapa.getCanvas().style.cursor = f?.layer?.id === CAMADA_PONTOS ? "pointer" : "";
        if (rotulo) balao.setLngLat(e.lngLat).setText(String(rotulo)).addTo(mapa);
        else balao.remove();
      };
      const esconder = () => {
        mapa.getCanvas().style.cursor = "";
        balao.remove();
      };
      mapa.on("mousemove", CAMADA_PONTOS, mostrar);
      mapa.on("mouseleave", CAMADA_PONTOS, esconder);
      mapa.on("mousemove", CAMADA_PREENCHER, mostrar);
      mapa.on("mouseleave", CAMADA_PREENCHER, esconder);
    }
  }, [mapa, estiloPronto, standard]);

  // Os dados das zonas e dos pontos.
  useEffect(() => {
    if (!mapa || !estiloPronto) return;
    (mapa.getSource(ORIGEM_FORMAS) as GeoJSONSource | undefined)?.setData(geojsonFormas(formas));
  }, [mapa, estiloPronto, formas]);
  useEffect(() => {
    if (!mapa || !estiloPronto) return;
    (mapa.getSource(ORIGEM_PONTOS) as GeoJSONSource | undefined)?.setData(geojsonPontos(pontos));
  }, [mapa, estiloPronto, pontos]);
  useEffect(() => {
    if (!mapa || !estiloPronto || !mapa.getLayer(CAMADA_PONTOS)) return;
    const sel = selecionado ?? "";
    mapa.setPaintProperty(CAMADA_PONTOS, "circle-radius", ["case", ["==", ["get", "id"], sel], 15, 9]);
    mapa.setPaintProperty(CAMADA_PONTOS, "circle-stroke-width", ["case", ["==", ["get", "id"], sel], 3.5, 2]);
  }, [mapa, estiloPronto, selecionado]);

  // 3D: zonas em volume e relevo; 2D: planas.
  useEffect(() => {
    if (!mapa || !estiloPronto) return;
    if (mapa.getLayer(CAMADA_VOLUME)) mapa.setLayoutProperty(CAMADA_VOLUME, "visibility", em3d ? "visible" : "none");
    try {
      if (em3d) {
        if (!mapa.getSource(ORIGEM_RELEVO)) {
          mapa.addSource(ORIGEM_RELEVO, { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512 });
        }
        mapa.setTerrain({ source: ORIGEM_RELEVO, exaggeration: 1.2 });
      } else if (mapa.getTerrain()) {
        mapa.setTerrain(null);
      }
    } catch {
      // Sem relevo: o resto do 3D continua.
    }
  }, [mapa, estiloPronto, em3d]);

  // Enquadrar (à entrada; depois, quando os pontos mudam).
  const chave = chavePontos(enquadrar);
  const enquadrado = useRef<string | null>(null);
  useEffect(() => {
    if (!mapa || !enquadrar?.length) return;
    if (enquadrado.current === chave) return;
    if (enquadrarUmaVez && enquadrado.current !== null) return;
    const primeira = enquadrado.current === null;
    enquadrado.current = chave;
    const duracao = primeira || menosMovimento() ? 0 : 700;
    if (enquadrar.length === 1) {
      mapa.easeTo({ center: lngLat(enquadrar[0]), zoom: zoomMaximo, duration: duracao });
      return;
    }
    const cx = caixa(enquadrar);
    if (cx) {
      const cont = mapa.getContainer();
      mapa.fitBounds(cx, {
        // Mapas pequenos (cartões): menos margem.
        padding: Math.min(48, Math.round(Math.min(cont.clientWidth, cont.clientHeight) / 7)),
        maxZoom: zoomMaximo,
        duration: duracao,
        pitch: mapa.getPitch(),
        bearing: mapa.getBearing(),
      });
    }
  }, [mapa, chave, enquadrar, enquadrarUmaVez, zoomMaximo]);

  // Seguir o selecionado (se estiver fora da vista, ou perto da borda).
  useEffect(() => {
    if (!mapa || !seguirSelecionado || !selecionado) return;
    const alvo =
      marcadores.find((x) => x.id === selecionado) ?? (pontos ?? []).find((x) => x.id === selecionado) ?? null;
    if (!alvo) return;
    const ecra = mapa.project(lngLat(alvo));
    const cont = mapa.getContainer();
    const margem = 0.15;
    const w = cont.clientWidth - mEsq - mDir;
    const h = cont.clientHeight - mTopo - mBaixo;
    const dentro =
      ecra.x > mEsq + w * margem &&
      ecra.x < mEsq + w * (1 - margem) &&
      ecra.y > mTopo + h * margem &&
      ecra.y < mTopo + h * (1 - margem);
    if (!dentro) mapa.easeTo({ center: lngLat(alvo), duration: menosMovimento() ? 0 : 700 });
    // Só quando muda o selecionado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa, selecionado, seguirSelecionado]);

  const alternar3d = useCallback(() => {
    if (!mapa) return;
    const v = em3d ? vistaDe(vistaInicial === "3d" ? "2d" : vistaInicial) : VISTA_3D;
    setEm3d(!em3d);
    mapa.easeTo({ pitch: v.pitch, bearing: v.bearing, duration: menosMovimento() ? 0 : 900 });
  }, [mapa, em3d, vistaInicial]);

  const localizar = useCallback(() => {
    setEstadoLoc("a_pedir");
    pedirLocalizacao()
      .then((p) => {
        setEstadoLoc("ok");
        setAquiDentro(p);
        chamadas.current.aoLocalizar?.(p);
        mapa?.easeTo({ center: lngLat(p), zoom: Math.max(mapa.getZoom(), 15.5), duration: menosMovimento() ? 0 : 900 });
      })
      .catch((e: Error) => setEstadoLoc(e.message === "recusado" ? "recusado" : "indisponivel"));
  }, [mapa]);

  const interativo = !estatico && !!props.aoSelecionar;
  const duracao = () => (menosMovimento() ? 0 : 300);

  return (
    <div
      className="mapa-motor"
      style={{ "--mapa-baixo": `${mBaixo}px`, "--mapa-direita": `${mDir}px` } as CSSProperties}
    >
      <div ref={contentor} className="size-full" />
      {mapa &&
        marcadores.map((m) => (
          <MarcadorMb
            key={m.id}
            mapa={mapa}
            m={m}
            interativo={interativo}
            aoSelecionar={props.aoSelecionar}
            aoArrastar={props.aoArrastar}
          />
        ))}
      {mapa && aqui && (
        <MarcadorMb mapa={mapa} m={{ id: "__aqui", ...aqui, nome: "Está aqui", conteudo: <PontoAqui /> }} interativo={false} />
      )}
      {!estatico && controlos && mapa && (
        <Controlos
          posicao={controlos.posicao}
          direita={12 + mDir}
          baixo={mBaixo + 40}
          zoom={controlos.zoom ? { mais: () => mapa.zoomIn({ duration: duracao() }), menos: () => mapa.zoomOut({ duration: duracao() }) } : undefined}
          bussola={
            controlos.bussola
              ? {
                  graus,
                  inclinado,
                  repor: () => mapa.easeTo({ bearing: 0, duration: menosMovimento() ? 0 : 500 }),
                }
              : undefined
          }
          localizacao={controlos.localizacao ? { pedir: localizar, estado: estadoLoc } : undefined}
          vista3d={controlos.vista3d ? { em3d, alternar: alternar3d } : undefined}
          satelite={botaoSatelite ? { ativo: satelite, alternar: alternarSatelite } : undefined}
        />
      )}
    </div>
  );
}
