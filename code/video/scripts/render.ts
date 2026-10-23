/*
 * Render do vídeo (MP4, H.264).
 *
 *   npm run render                         → out/tou-camara.mp4
 *   npm run render -- out/rascunho.mp4
 *   npm run render -- --stills=0,450,1800  → out/stills/<frame>.png
 *   npm run render -- --4k                 → out/tou-camara-4k.mp4 (3840×2160, para o YouTube)
 *
 * Usa o Chromium de /opt/pw-browsers quando existe (ou CHROME=...); senão o
 * Remotion descarrega o seu.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

function chrome(): string | null {
  if (process.env.CHROME) return process.env.CHROME;
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return null;
  const pasta = readdirSync(base).find((d) => /^chromium_headless_shell-\d+$/.test(d));
  if (!pasta) return null;
  const exe = join(base, pasta, 'chrome-linux', 'headless_shell');
  return existsSync(exe) ? exe : null;
}

const args = process.argv.slice(2);
const stills = args.find((a) => a.startsWith('--stills='))?.slice(9);
// Em 4K o YouTube guarda o vídeo com mais qualidade (o texto dos ecrãs fica
// legível); as capturas estão a 2x, por isso têm detalhe para isso.
const k4 = args.includes('--4k');
const saida =
  args.find((a) => !a.startsWith('--')) ?? join(RAIZ, 'out', k4 ? 'tou-camara-4k.mp4' : 'tou-camara.mp4');

const serveUrl = await bundle({ entryPoint: join(RAIZ, 'src', 'index.ts') });
const browserExecutable = chrome();
const composition = await selectComposition({
  serveUrl,
  id: 'TouCamara',
  browserExecutable,
});

if (stills) {
  const pasta = join(RAIZ, 'out', 'stills');
  mkdirSync(pasta, { recursive: true });
  for (const f of stills.split(',').map(Number)) {
    const output = join(pasta, `${String(f).padStart(5, '0')}.png`);
    await renderStill({ serveUrl, composition, frame: f, output, browserExecutable });
    console.log(output);
  }
} else {
  mkdirSync(dirname(saida), { recursive: true });
  let ultimo = -1;
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    crf: k4 ? 20 : 18,
    scale: k4 ? 2 : 1,
    outputLocation: saida,
    browserExecutable,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10);
      if (p !== ultimo) {
        ultimo = p;
        process.stdout.write(`${p * 10}% `);
      }
    },
  });
  console.log(`\n${saida}`);
}
