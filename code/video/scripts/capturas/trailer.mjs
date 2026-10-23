/*
 * Trailer: além das capturas do painel e da renovação, a página inicial e a
 * chamada no browser (/ligar), no computador.
 */
import { captor } from './comum.mjs';

export async function capturarTrailer({ pagina, capturas, pasta }) {
  const { ir, guardar } = captor(pagina, capturas, { largura: 1920, altura: 1080, pasta });
  await ir('/');
  await guardar('trailer_inicio');
  await ir('/ligar');
  await guardar('trailer_ligar');
  return {};
}
