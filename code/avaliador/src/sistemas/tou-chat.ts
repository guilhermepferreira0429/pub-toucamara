/*
 * O nosso agente pelo chat público, exatamente como o browser de um munícipe:
 * `POST /v1/chat/sessoes` (uma sessão nova por pergunta) e
 * `POST /v1/chat/sessoes/:sessao/mensagens`, que responde em SSE
 * (eventos `texto`, `ferramenta`, `cartao`, `fim`, `erro`).
 */
import { bd } from '../bd.js';
import { config } from '../config.js';
import {
  ErroAdaptador,
  type Adaptador,
  type RespostaSistema,
  type Sistema,
} from '../tipos.js';
import { AcumuladorChat, lerSse } from './sse.js';

export interface OpcoesTouChat {
  /** Para testes: outro fetch. */
  fetch?: typeof fetch;
  /** Tempo máximo por pergunta (sessão + resposta completa). */
  timeoutMs?: number;
  /**
   * Quanto esperar no total por vagas quando a API responde 429. A API limita
   * as sessões novas por IP (20 em 10 min); com uma sessão por pergunta, uma
   * execução de 180 perguntas bate nesse limite e tem de esperar, não falhar.
   */
  esperaLimiteMaxMs?: number;
  /** Espera entre tentativas quando o 429 não traz Retry-After. */
  esperaLimiteMs?: number;
}

const IDIOMA_VALIDO = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** URL base da API: a do sistema (dev, staging, produção) ou a do .env. */
export function baseApi(sistema: Pick<Sistema, 'url'>): string {
  const base = (sistema.url || config.apiUrl).replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

/** O slug do município do sistema: `config.slug` ou o do `municipio_id`. */
export async function slugDoSistema(sistema: Sistema): Promise<string> {
  const s = sistema.config.slug;
  if (typeof s === 'string' && s.trim()) return s.trim();
  if (sistema.municipio_id) {
    const [m] = await bd.query<{ slug: string }>(
      'SELECT slug FROM municipios WHERE id = $1',
      [sistema.municipio_id],
    );
    if (m) return m.slug;
  }
  throw new ErroAdaptador(
    `O sistema "${sistema.nome}" não tem município (municipio_id ou config.slug).`,
    true,
  );
}

/**
 * A versão atual do agente de um município (`agente_config.versao`), para a
 * execução gravar em `agente_versao`: o gate de publicação só aceita uma
 * execução feita sobre a versão que está no ar.
 */
export async function versaoAgente(slug: string): Promise<string | null> {
  const [r] = await bd.query<{ versao: string }>(
    `SELECT a.versao FROM agente_config a
     JOIN municipios m ON m.id = a.municipio_id
     WHERE m.slug = $1`,
    [slug],
  );
  return r?.versao ?? null;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AdaptadorTouChat implements Adaptador {
  readonly paralelo = 4;
  private slug: Promise<string> | null = null;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;
  private readonly esperaLimiteMaxMs: number;
  private readonly esperaLimiteMs: number;

  constructor(
    private readonly sistema: Sistema,
    opcoes: OpcoesTouChat = {},
  ) {
    this.f = opcoes.fetch ?? fetch;
    this.timeoutMs = opcoes.timeoutMs ?? 90_000;
    this.esperaLimiteMaxMs = opcoes.esperaLimiteMaxMs ?? 12 * 60_000;
    this.esperaLimiteMs = opcoes.esperaLimiteMs ?? 30_000;
  }

  pausa(): number {
    return 0;
  }

  async perguntar(p: {
    texto: string;
    idioma: string;
  }): Promise<RespostaSistema> {
    this.slug ??= slugDoSistema(this.sistema);
    const slug = await this.slug;
    const base = baseApi(this.sistema);

    const sessao = await this.pedir<{ sessao: string }>(
      `${base}/chat/sessoes`,
      {
        municipio: slug,
        ...(IDIOMA_VALIDO.test(p.idioma) ? { idioma: p.idioma } : {}),
      },
    );
    if (!sessao.json?.sessao) {
      throw new ErroAdaptador('A API não devolveu o token da sessão.');
    }

    // A latência conta da mensagem ao `fim`: é o que o munícipe espera.
    const t0 = Date.now();
    const controlo = new AbortController();
    const relogio = setTimeout(() => controlo.abort(), this.timeoutMs);
    try {
      const res = await this.pedir(
        `${base}/chat/sessoes/${encodeURIComponent(sessao.json.sessao)}/mensagens`,
        { texto: p.texto },
        controlo.signal,
        true,
      );
      if (!res.resposta.body)
        throw new ErroAdaptador('Resposta SSE sem corpo.');
      const ac = new AcumuladorChat();
      let n = 0;
      for await (const e of lerSse(
        res.resposta.body as unknown as AsyncIterable<Uint8Array>,
      )) {
        n++;
        if (ac.juntar(e)) break;
      }
      const r = ac.resultado;
      if (r.erro) {
        throw new ErroAdaptador(`chat: ${r.erro.codigo}: ${r.erro.mensagem}`);
      }
      if (!r.terminou) {
        throw new ErroAdaptador('A ligação SSE fechou sem o evento `fim`.');
      }
      return {
        texto: r.texto,
        latencia_ms: Date.now() - t0,
        ferramentas: r.ferramentas,
        fontes: r.fontes,
        bruto: {
          sessao: sessao.json.sessao,
          turno_id: r.turnoId,
          eventos: n,
          url: base,
        },
      };
    } catch (e) {
      if (controlo.signal.aborted) {
        throw new ErroAdaptador(
          `Sem resposta completa em ${Math.round(this.timeoutMs / 1000)} s.`,
        );
      }
      throw e;
    } finally {
      clearTimeout(relogio);
    }
  }

  /**
   * POST com JSON. Espera e repete nos 429 (limite da API); qualquer outro
   * erro HTTP vira ErroAdaptador com o código da API. API inacessível é
   * fatal: as perguntas seguintes falhariam todas da mesma maneira.
   */
  private async pedir<T>(
    url: string,
    corpo: unknown,
    sinal?: AbortSignal,
    stream = false,
  ): Promise<{ resposta: Response; json: T | null }> {
    const limite = Date.now() + this.esperaLimiteMaxMs;
    for (;;) {
      let res: Response;
      try {
        res = await this.f(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: stream ? 'text/event-stream' : 'application/json',
            ...(config.agenteSegredo
              ? { 'X-Agente-Segredo': config.agenteSegredo }
              : {}),
          },
          body: JSON.stringify(corpo),
          signal: sinal,
        });
      } catch (e) {
        if (sinal?.aborted) throw e;
        throw new ErroAdaptador(
          `API inacessível em ${url}: ${(e as Error).message}`,
          true,
        );
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        const espera =
          Number.isFinite(ra) && ra > 0 ? ra * 1000 : this.esperaLimiteMs;
        await res.body?.cancel().catch(() => undefined);
        if (Date.now() + espera > limite) {
          throw new ErroAdaptador('Limite de pedidos da API (429) não passou.');
        }
        await dormir(espera);
        continue;
      }
      if (!res.ok) {
        const erro = await res
          .json()
          .then(
            (j: { erro?: { codigo?: string; mensagem?: string } }) => j.erro,
          )
          .catch(() => undefined);
        const msg = `HTTP ${res.status}${erro?.codigo ? ` ${erro.codigo}` : ''}: ${erro?.mensagem ?? res.statusText}`;
        // Município desconhecido: a configuração do sistema está errada.
        throw new ErroAdaptador(msg, res.status === 404 && !stream);
      }
      if (stream) return { resposta: res, json: null };
      return { resposta: res, json: (await res.json()) as T };
    }
  }
}
