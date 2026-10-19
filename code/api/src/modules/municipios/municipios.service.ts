import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';

export interface Municipio {
  id: string;
  slug: string;
  nome: string;
  fuso: string;
}

// Os municípios quase não mudam; cada pedido do agente não precisa de ir à BD.
const VALIDADE_MS = 60_000;

/**
 * Resolve o município de cada pedido. Todo o código é genérico: o que é de
 * Guimarães está nos dados (seed), nunca em constantes.
 */
@Injectable()
export class MunicipiosService {
  private cache = new Map<string, { municipio: Municipio; ate: number }>();
  private cacheFeriados = new Map<string, { dias: Set<string>; ate: number }>();

  constructor(private readonly db: DatabaseService) {}

  async porSlug(slug: string): Promise<Municipio> {
    const chave = slug.trim().toLowerCase();
    const emCache = this.cache.get(chave);
    if (emCache && emCache.ate > Date.now()) return emCache.municipio;

    const [municipio] = await this.db.query<Municipio>(
      'SELECT id, slug, nome, fuso FROM municipios WHERE slug = $1',
      [chave],
    );
    if (!municipio) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'municipio_desconhecido',
        `Município "${slug}" não existe.`,
      );
    }
    this.cache.set(chave, { municipio, ate: Date.now() + VALIDADE_MS });
    return municipio;
  }

  async porId(id: string): Promise<Municipio> {
    const [m] = await this.db.query<{ slug: string }>(
      'SELECT slug FROM municipios WHERE id = $1',
      [id],
    );
    if (!m) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'municipio_desconhecido',
        'Município não existe.',
      );
    }
    return this.porSlug(m.slug);
  }

  /** Feriados nacionais + municipais, 'YYYY-MM-DD', para contar dias úteis. */
  async feriados(municipioId: string): Promise<Set<string>> {
    const emCache = this.cacheFeriados.get(municipioId);
    if (emCache && emCache.ate > Date.now()) return emCache.dias;
    const linhas = await this.db.query<{ dia: string }>(
      `SELECT to_char(data, 'YYYY-MM-DD') AS dia FROM feriados
       WHERE municipio_id IS NULL OR municipio_id = $1`,
      [municipioId],
    );
    const dias = new Set(linhas.map((l) => l.dia));
    this.cacheFeriados.set(municipioId, {
      dias,
      ate: Date.now() + VALIDADE_MS,
    });
    return dias;
  }
}
