import type { Tx } from '../database/database.service.js';

/**
 * Próximo número de uma série, atómico: 'CP' + 2026 → 412.
 * Formatar no domínio: `CP 412/2026`, `OC-0381`.
 */
export async function proximoNumero(
  q: Pick<Tx, 'query'>,
  municipioId: string,
  prefixo: string,
  ano = new Date().getFullYear(),
): Promise<number> {
  const [r] = await q.query<{ ultimo: number }>(
    `INSERT INTO numeracao (municipio_id, prefixo, ano, ultimo) VALUES ($1, $2, $3, 1)
     ON CONFLICT (municipio_id, prefixo, ano)
     DO UPDATE SET ultimo = numeracao.ultimo + 1
     RETURNING ultimo`,
    [municipioId, prefixo, ano],
  );
  return r.ultimo;
}
