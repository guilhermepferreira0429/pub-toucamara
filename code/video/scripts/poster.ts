/*
 * A miniatura do vídeo para o YouTube (src/unico/Miniatura.tsx): um PNG a
 * 1920×1080 e um JPG a 1280×720 (o tamanho que o YouTube pede, abaixo de 2 MB).
 *
 *   npm run poster        → out/tou-camara-miniatura.png e .jpg
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'out');

function chrome(): string | null {
  if (process.env.CHROME) return process.env.CHROME;
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return null;
  const pasta = readdirSync(base).find((d) => /^chromium_headless_shell-\d+$/.test(d));
  if (!pasta) return null;
  const exe = join(base, pasta, 'chrome-linux', 'headless_shell');
  return existsSync(exe) ? exe : null;
}

mkdirSync(SAIDA, { recursive: true });
const serveUrl = await bundle({ entryPoint: join(RAIZ, 'src', 'index.ts') });
const browserExecutable = chrome();
const composition = await selectComposition({ serveUrl, id: 'Miniatura', browserExecutable });
const png = join(SAIDA, 'tou-camara-miniatura.png');
await renderStill({ serveUrl, composition, output: png, browserExecutable });
const jpg = png.replace(/\.png$/, '.jpg');
const r = spawnSync(
  'npx',
  ['remotion', 'ffmpeg', '-y', '-v', 'error', '-i', png, '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', jpg],
  { stdio: 'inherit', cwd: RAIZ },
);
if (r.status !== 0) throw new Error('ffmpeg falhou na miniatura');
console.log(`${png}\n${jpg}`);
