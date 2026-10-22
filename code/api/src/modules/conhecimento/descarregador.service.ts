import { Injectable, Logger } from '@nestjs/common';
import {
  ErroFonte,
  lerRobots,
  permitido,
  Robots,
  USER_AGENT,
} from './recolha.js';

export type Descarga =
  | {
      estado: 'ok';
      http: number;
      bytes: Buffer;
      tipo: string;
      etag: string | null;
      ultimaModificacao: string | null;
    }
  /** 304: o site diz que nada mudou desde a última leitura. */
  | { estado: 'nao_modificado'; http: 304 };

export interface OpcoesDescarga {
  /** Da última leitura: pedido condicional (If-None-Match / If-Modified-Since). */
  etag?: string | null;
  ultimaModificacao?: string | null;
  /** A câmara autorizou ler mesmo que o robots.txt não deixe. */
  ignorarRobots?: boolean;
}

/** Falha que passa sozinha (rede, 5xx, 429): tenta-se outra vez. */
class ErroTemporario extends Error {
  constructor(
    mensagem: string,
    readonly esperarMs = 0,
  ) {
    super(mensagem);
  }
}

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 15 * 1024 * 1024;
const TENTATIVAS = 3;
/** Espera entre tentativas (a 2.ª e a 3.ª); o Retry-After do site manda, até 60 s. */
const ESPERAS_MS = [2_000, 10_000];
const ROBOTS_VALIDADE_MS = 24 * 3600_000;
const ROBOTS_FALHA_MS = 10 * 60_000;
/** O Crawl-delay do site conta, mas nunca mais de 30 s. */
const ATRASO_MAX_MS = 30_000;

/**
 * Todos os pedidos da recolha (leitura das fontes e descoberta dos sites)
 * passam por aqui:
 * - robots.txt de cada site (24 h em cache); se não deixar, a fonte fica em
 *   erro, a não ser que a câmara tenha autorizado (`ignorarRobots`);
 * - um pedido de cada vez por site, com RECOLHA_INTERVALO_MS (2 s por
 *   defeito) ou o Crawl-delay entre eles;
 * - pedido condicional com o ETag/Last-Modified da última leitura (304 = não
 *   se descarrega nem se processa nada);
 * - 3 tentativas para falhas de rede, 5xx e 429; 4xx é definitivo.
 */
@Injectable()
export class DescarregadorService {
  private readonly logger = new Logger(DescarregadorService.name);
  private readonly robots = new Map<
    string,
    { r: Robots | null; ate: number }
  >();
  /** Por site, a hora a que pode sair o próximo pedido. */
  private readonly vez = new Map<string, number>();

  /** Pausa mínima entre pedidos ao mesmo site (os testes põem 0). */
  intervaloMs = Number(process.env.RECOLHA_INTERVALO_MS ?? 2_000);

  async obter(url: string, o: OpcoesDescarga = {}): Promise<Descarga> {
    const u = new URL(url);
    const robots = await this.robotsDe(u.origin);
    if (!o.ignorarRobots && robots && !permitido(robots, url)) {
      throw new ErroFonte(
        'O robots.txt do site não deixa ler esta página: colar o texto, ou a câmara autoriza a leitura no painel',
        'robots',
      );
    }
    const atraso = Math.min(
      ATRASO_MAX_MS,
      Math.max(this.intervaloMs, (robots?.atraso ?? 0) * 1000),
    );

    for (let tentativa = 1; ; tentativa++) {
      await this.aguardarVez(u.host, atraso);
      try {
        return await this.pedido(url, o);
      } catch (e) {
        if (!(e instanceof ErroTemporario)) throw e;
        if (tentativa >= TENTATIVAS) {
          throw new ErroFonte(
            `${e.message} (${TENTATIVAS} tentativas)`,
            /^HTTP/.test(e.message) ? 'http' : 'rede',
          );
        }
        await this.esperar(
          Math.min(60_000, Math.max(e.esperarMs, ESPERAS_MS[tentativa - 1])),
        );
      }
    }
  }

  /** O robots.txt do site, ou null (não existe ou não respondeu: pode-se ler). */
  async robotsDe(origem: string): Promise<Robots | null> {
    const guardado = this.robots.get(origem);
    if (guardado && guardado.ate > Date.now()) return guardado.r;
    let r: Robots | null = null;
    let validade = ROBOTS_VALIDADE_MS;
    try {
      const res = await fetch(`${origem}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) r = lerRobots(await res.text());
      // 4xx: não há robots.txt, lê-se tudo. 5xx: tenta-se mais tarde.
      else if (res.status >= 500) validade = ROBOTS_FALHA_MS;
    } catch (e) {
      validade = ROBOTS_FALHA_MS;
      this.logger.warn(
        `robots.txt de ${origem} sem resposta: ${(e as Error).message}`,
      );
    }
    this.robots.set(origem, { r, ate: Date.now() + validade });
    return r;
  }

  private async pedido(url: string, o: OpcoesDescarga): Promise<Descarga> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept:
        'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5',
      'Accept-Language': 'pt-PT,pt;q=0.9',
    };
    if (o.etag) headers['If-None-Match'] = o.etag;
    if (o.ultimaModificacao) headers['If-Modified-Since'] = o.ultimaModificacao;

    let res: Response;
    try {
      res = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const nome = (e as Error).name;
      throw new ErroTemporario(
        nome === 'TimeoutError' || nome === 'AbortError'
          ? `Sem resposta em ${TIMEOUT_MS / 1000} s`
          : `Não foi possível ligar: ${(e as Error).message}`,
      );
    }
    if (res.status === 304) return { estado: 'nao_modificado', http: 304 };
    if (res.status === 429 || res.status >= 500) {
      const depois = Number(res.headers.get('retry-after'));
      throw new ErroTemporario(
        `HTTP ${res.status}`,
        Number.isFinite(depois) ? depois * 1000 : 0,
      );
    }
    if (res.status === 404 || res.status === 410) {
      throw new ErroFonte(
        `A página deixou de existir (HTTP ${res.status}): mudar o endereço ou arquivar a fonte`,
        'nao_existe',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ErroFonte(
        `O site bloqueou a leitura (HTTP ${res.status}): colar texto pelo painel`,
        'bloqueado',
      );
    }
    if (!res.ok) throw new ErroFonte(`HTTP ${res.status}`, 'http');

    const tamanho = Number(res.headers.get('content-length') ?? 0);
    if (tamanho > MAX_BYTES) {
      throw new ErroFonte(
        `Ficheiro demasiado grande (${Math.round(tamanho / 1e6)} MB)`,
        'grande',
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) {
      throw new ErroFonte(
        `Ficheiro demasiado grande (${Math.round(bytes.length / 1e6)} MB)`,
        'grande',
      );
    }
    return {
      estado: 'ok',
      http: res.status,
      bytes,
      tipo: res.headers.get('content-type') ?? '',
      etag: res.headers.get('etag'),
      ultimaModificacao: res.headers.get('last-modified'),
    };
  }

  /** Reserva a vez do próximo pedido a este site e espera por ela. */
  private async aguardarVez(host: string, atrasoMs: number): Promise<void> {
    const agora = Date.now();
    const quando = Math.max(agora, (this.vez.get(host) ?? 0) + atrasoMs);
    this.vez.set(host, quando);
    if (quando > agora) await this.esperar(quando - agora);
  }

  /** Separado para os testes não esperarem a sério. */
  protected esperar(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
