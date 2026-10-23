/*
 * Render do vídeo do painel (MP4, H.264).
 *
 *   npm run render                         → out/painel.mp4
 *   npm run render -- out/rascunho.mp4
 *   npm run render -- --stills=0,450,1800  → out/stills/<frame>.png
 *
 * Usa o Chromium de /opt/pw-browsers quando existe (ou CHROME=...); senão o
 * Remotion descarrega o seu.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { guiao } from '../src/guiao';
import { guiaoMunicipe } from '../src/guiao-municipe';
import { linhaDoTempo } from '../src/tempos';
import type { Dados, VozGerada } from '../src/tipos';

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

const VIDEOS = {
  painel: { id: 'Painel', guiao },
  municipe: { id: 'Municipe', guiao: guiaoMunicipe },
} as const;

const args = process.argv.slice(2);
const stills = args.find((a) => a.startsWith('--stills='))?.slice(9);
const nome = (args.find((a) => a.startsWith('--video='))?.slice(8) ?? 'painel') as keyof typeof VIDEOS;
if (!VIDEOS[nome]) throw new Error(`Vídeo desconhecido: ${nome} (${Object.keys(VIDEOS).join(', ')})`);
const saida = args.find((a) => !a.startsWith('--')) ?? join(RAIZ, 'out', `${nome}.mp4`);

const dados = JSON.parse(readFileSync(join(RAIZ, 'src', 'dados.gerado.json'), 'utf8')) as Dados;
const voz = JSON.parse(readFileSync(join(RAIZ, 'src', 'voz.gerado.json'), 'utf8')) as Record<
  string,
  VozGerada
>;
const { total, avisos } = linhaDoTempo(VIDEOS[nome].guiao(dados), voz);
console.log(`Duração: ${(total / 30).toFixed(1)} s (${total} frames)`);
if (avisos.length) console.log(`Avisos:\n  ${avisos.join('\n  ')}`);

const serveUrl = await bundle({ entryPoint: join(RAIZ, 'src', 'index.ts') });
const browserExecutable = chrome();
const composition = await selectComposition({
  serveUrl,
  id: VIDEOS[nome].id,
  browserExecutable,
});

if (stills) {
  const pasta = join(RAIZ, 'out', 'stills', nome);
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
    crf: 18,
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
