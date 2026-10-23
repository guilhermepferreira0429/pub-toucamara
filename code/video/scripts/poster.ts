/*
 * A capa do vídeo (a miniatura para o YouTube), a 1920×1080, a partir da
 * capa desenhada em docs/anexos-taikai/capas.
 * As de 1280×720 sobem com Lanczos (o ffmpeg que vem com o Remotion).
 *
 *   npm run poster        → out/tou-camara-capa.png
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPAS = join(RAIZ, '..', '..', 'docs', 'anexos-taikai', 'capas');
const SAIDA = join(RAIZ, 'out');
const CAPA: Record<string, string> = {
  'tou-camara': 'capa-trailer.png',
};

mkdirSync(SAIDA, { recursive: true });
for (const [nome, ficheiro] of Object.entries(CAPA)) {
  const origem = join(CAPAS, ficheiro);
  if (!existsSync(origem)) {
    console.warn(`Falta ${origem}`);
    continue;
  }
  const destino = join(SAIDA, `${nome}-capa.png`);
  const r = spawnSync(
    'npx',
    ['remotion', 'ffmpeg', '-y', '-v', 'error', '-i', origem, '-vf', 'scale=1920:1080:flags=lanczos', destino],
    { stdio: 'inherit', cwd: RAIZ },
  );
  if (r.status !== 0) throw new Error(`ffmpeg falhou em ${ficheiro}`);
  console.log(destino);
}
