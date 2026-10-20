import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const URL_MOSAICOS = 'https://tile.openstreetmap.org';

const TIMEOUT_MS = 5_000;
// ~10–30 KB cada: 600 mosaicos são no máximo uns 20 MB.
const MAX_CACHE = 600;
// Política de uso dos mosaicos do OSM: nada de descargas em massa. Uma
// planta são 9 mosaicos; isto deixa umas 10 plantas novas por minuto.
const MAX_PEDIDOS_MINUTO = 90;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** O mosaico não veio (rede, limite, resposta que não é PNG). */
export class MosaicoIndisponivel extends Error {}

/**
 * Mosaicos PNG de 256×256 de tile.openstreetmap.org. Segue a política de
 * uso (https://operations.osmfoundation.org/policies/tiles/): User-Agent
 * identificável (o mesmo da geocodificação), cache em memória, pedidos um a
 * um e um teto por minuto. Nunca devolve um mosaico falso: falha com
 * `MosaicoIndisponivel`. Nos testes substitui-se por um falso (sem rede).
 */
@Injectable()
export class MosaicosOsmService {
  private readonly logger = new Logger(MosaicosOsmService.name);
  private readonly cache = new Map<string, Buffer>();
  private readonly pedidos: number[] = [];
  private readonly userAgent: string;

  constructor(config: ConfigService) {
    const web = config.get<string>('app.webUrl') ?? '';
    this.userAgent = `TouCamara/1.0 (+${web || 'https://toucamara.pt'})`;
  }

  async obter(z: number, x: number, y: number): Promise<Buffer> {
    const chave = `${z}/${x}/${y}`;
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;

    const agora = Date.now();
    while (this.pedidos.length && this.pedidos[0] < agora - 60_000) {
      this.pedidos.shift();
    }
    if (this.pedidos.length >= MAX_PEDIDOS_MINUTO) {
      throw new MosaicoIndisponivel(
        'Limite de pedidos de mosaicos por minuto.',
      );
    }
    this.pedidos.push(agora);

    let r: Response;
    try {
      r = await fetch(`${URL_MOSAICOS}/${chave}.png`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.warn(`Mosaico ${chave}: ${(e as Error).message}`);
      throw new MosaicoIndisponivel((e as Error).message);
    }
    if (!r.ok) {
      this.logger.warn(`Mosaico ${chave}: HTTP ${r.status}`);
      throw new MosaicoIndisponivel(`HTTP ${r.status}`);
    }
    const png = Buffer.from(await r.arrayBuffer());
    if (!png.subarray(0, 8).equals(PNG)) {
      throw new MosaicoIndisponivel('A resposta não é um PNG.');
    }
    if (this.cache.size >= MAX_CACHE) {
      // Map mantém a ordem de inserção: sai o mais antigo.
      for (const primeira of this.cache.keys()) {
        this.cache.delete(primeira);
        break;
      }
    }
    this.cache.set(chave, png);
    return png;
  }
}
