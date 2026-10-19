import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizarTexto } from './ocorrencias.regras.js';

export interface Coordenadas {
  lat: number;
  lng: number;
  /** O que o Nominatim encontrou, para o painel confirmar. */
  encontrada: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/*
 * A ferramenta tem orçamento p95 < 400 ms: a geocodificação é a parte lenta.
 * Se não responder a tempo regista-se sem coordenadas e a chamada continua;
 * o painel mostra a morada e a equipa marca o sítio.
 */
const TIMEOUT_MS = 1_500;
const MAX_CACHE = 2_000;

/** Lê a resposta (format=jsonv2) do Nominatim: o primeiro resultado válido. */
export function lerRespostaNominatim(json: unknown): Coordenadas | null {
  if (!Array.isArray(json)) return null;
  for (const r of json as unknown[]) {
    if (typeof r !== 'object' || r === null) continue;
    const { lat, lon, display_name } = r as Record<string, unknown>;
    const la = Number(lat);
    const lo = Number(lon);
    if (
      lat === undefined ||
      lon === undefined ||
      !Number.isFinite(la) ||
      !Number.isFinite(lo) ||
      Math.abs(la) > 90 ||
      Math.abs(lo) > 180
    ) {
      continue;
    }
    return {
      lat: la,
      lng: lo,
      encontrada: typeof display_name === 'string' ? display_name : '',
    };
  }
  return null;
}

/** A pesquisa enviada: a morada com o nome do município, para não cair noutra terra. */
export function textoPesquisa(morada: string, municipio: string): string {
  const m = morada.trim().replace(/\s+/g, ' ');
  return normalizarTexto(m).includes(normalizarTexto(municipio))
    ? m
    : `${m}, ${municipio}`;
}

/**
 * Morada dita ao telefone → lat/lng com o Nominatim (OpenStreetMap). Nunca
 * lança: sem resposta, devolve null. A política de uso do Nominatim pede um
 * User-Agent identificável e no máximo um pedido por segundo; a cache por
 * texto normalizado evita repetir a mesma rua.
 */
@Injectable()
export class GeocodificacaoService {
  private readonly logger = new Logger(GeocodificacaoService.name);
  private readonly cache = new Map<string, Coordenadas | null>();
  private readonly userAgent: string;

  constructor(config: ConfigService) {
    const web = config.get<string>('app.webUrl') ?? '';
    this.userAgent = `TouCamara/1.0 (+${web || 'https://toucamara.pt'})`;
  }

  async geocodificar(
    morada: string,
    municipio: string,
  ): Promise<Coordenadas | null> {
    const q = textoPesquisa(morada, municipio);
    const chave = normalizarTexto(q);
    if (this.cache.has(chave)) return this.cache.get(chave) ?? null;

    const url = new URL(NOMINATIM);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('countrycodes', 'pt');
    url.searchParams.set('limit', '1');
    url.searchParams.set('accept-language', 'pt');
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) {
        this.logger.warn(`Nominatim respondeu ${r.status}`);
        return null;
      }
      const coordenadas = lerRespostaNominatim(await r.json());
      // "Não encontrado" também fica em cache; falhas de rede não.
      this.guardar(chave, coordenadas);
      return coordenadas;
    } catch (e) {
      this.logger.warn(`Geocodificação falhou: ${(e as Error).message}`);
      return null;
    }
  }

  private guardar(chave: string, valor: Coordenadas | null) {
    if (this.cache.size >= MAX_CACHE) {
      // Map mantém a ordem de inserção: sai a mais antiga.
      for (const primeira of this.cache.keys()) {
        this.cache.delete(primeira);
        break;
      }
    }
    this.cache.set(chave, valor);
  }
}
