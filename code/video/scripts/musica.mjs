/*
 * A música do vídeo único (TouCamara): "Voxel Revolution", de Kevin MacLeod
 * (incompetech.com), licença Creative Commons Atribuição 4.0
 * (https://creativecommons.org/licenses/by/4.0/). O crédito está no fim do
 * vídeo e no README.
 *
 *   node scripts/musica.mjs        → public/musica/voxel-revolution.mp3
 *
 * A faixa tem 122 BPM e o primeiro tempo forte aos 0,4807 s (medido no
 * original): 64 compassos, cerca de 2 min 10 s. Usa-se inteira, do
 * princípio ao fim verdadeiro; os tempos do vídeo (src/unico/ritmo.ts)
 * contam com isso.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ORIGINAL =
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Voxel%20Revolution.mp3';
const ORIGINAL = join(RAIZ, 'out', 'musica', 'voxel-revolution-original.mp3');
const SAIDA = join(RAIZ, 'public', 'musica', 'voxel-revolution.mp3');

// Um só troço: a faixa inteira (para cortar, juntar troços em fronteiras
// de frase de 8 compassos e acertar os compassos em src/unico/guiao.ts).
const TROCOS = [[0, null]];

if (!existsSync(ORIGINAL)) {
  mkdirSync(dirname(ORIGINAL), { recursive: true });
  const r = await fetch(URL_ORIGINAL);
  if (!r.ok) throw new Error(`Não consegui descarregar a música: HTTP ${r.status}`);
  writeFileSync(ORIGINAL, Buffer.from(await r.arrayBuffer()));
}

// Cada troço com 6 ms de entrada e saída, para os cortes não estalarem.
const filtros = TROCOS.map(([de, ate], i) => {
  const fim = ate === null ? '' : `:end=${ate.toFixed(4)}`;
  const saida =
    ate === null ? '' : `,afade=t=out:st=${(ate - de - 0.006).toFixed(4)}:d=0.006`;
  return `[0:a]atrim=start=${de.toFixed(4)}${fim},asetpts=PTS-STARTPTS,afade=t=in:d=0.006${saida}[t${i}]`;
});
const juntar = `${TROCOS.map((_, i) => `[t${i}]`).join('')}concat=n=${TROCOS.length}:v=0:a=1[s]`;

mkdirSync(dirname(SAIDA), { recursive: true });
execFileSync('ffmpeg', [
  '-v', 'error', '-y', '-i', ORIGINAL,
  '-filter_complex', [...filtros, juntar].join(';'),
  '-map', '[s]', '-ar', '44100', '-b:a', '192k', SAIDA,
]);
const duracao = execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', SAIDA,
]).toString().trim();
console.log(`${SAIDA} (${Number(duracao).toFixed(2)} s)`);
