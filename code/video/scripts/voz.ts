/*
 * A voz do vídeo, pelo ElevenLabs: um MP3 por bloco do guião, em
 * public/voz/<id>.mp3, e os tempos de cada frase (para as legendas) em
 * src/voz.gerado.json. Só gera o que falta ou mudou (texto, voz ou modelo).
 *
 *   ELEVENLABS_API_KEY=... npm run voz            (tudo o que falta)
 *   ELEVENLABS_API_KEY=... npm run voz -- --forcar (tudo outra vez)
 *   ELEVENLABS_API_KEY=... npm run voz -- visao_1 fecho_2
 *
 * Variáveis: ELEVENLABS_VOZ_ID (o assistente), ELEVENLABS_VOZ_MUNICIPE (quem
 * liga, na cena da chamada), ELEVENLABS_MODELO (eleven_multilingual_v2).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guiao } from '../src/guiao';
import { dividirFrases } from '../src/tempos';
import type { Bloco, Dados, VozGerada } from '../src/tipos';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = join(RAIZ, 'public', 'voz');
const MANIFESTO = join(RAIZ, 'src', 'voz.gerado.json');

const CHAVE = process.env.ELEVENLABS_API_KEY;
const VOZES = {
  assistente: process.env.ELEVENLABS_VOZ_ID || 'DMcOknq8n1B6XshFIJKJ',
  municipe: process.env.ELEVENLABS_VOZ_MUNICIPE || 'JGnWZj684pcXmK2SxYIv',
};
const MODELO = process.env.ELEVENLABS_MODELO || 'eleven_multilingual_v2';
const BASE = 'https://api.elevenlabs.io';

if (!CHAVE) {
  console.error('Falta ELEVENLABS_API_KEY no ambiente.');
  process.exit(1);
}

const args = process.argv.slice(2);
const forcar = args.includes('--forcar');
const so = args.filter((a) => !a.startsWith('--'));

const dados = JSON.parse(
  readFileSync(join(RAIZ, 'src', 'dados.gerado.json'), 'utf8'),
) as Dados;
if (!dados.capturas) {
  console.error('Sem src/dados.gerado.json: corre primeiro `npm run capturar`.');
  process.exit(1);
}
const manifesto = JSON.parse(readFileSync(MANIFESTO, 'utf8')) as Record<
  string,
  VozGerada
>;
mkdirSync(PASTA, { recursive: true });

interface Alinhamento {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** O modelo só aceita forçar a língua nas versões 2.5 e 3. */
const aceitaLingua = /v2_5|v3/.test(MODELO);

async function gerar(b: Bloco, anterior?: string, seguinte?: string) {
  const vozId = VOZES[b.voz];
  const corpo = {
    text: b.texto,
    model_id: MODELO,
    ...(aceitaLingua ? { language_code: 'pt' } : {}),
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0.15,
      use_speaker_boost: true,
      speed: 1,
    },
    ...(anterior ? { previous_text: anterior } : {}),
    ...(seguinte ? { next_text: seguinte } : {}),
  };
  const r = await fetch(
    `${BASE}/v1/text-to-speech/${encodeURIComponent(vozId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': CHAVE!,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(corpo),
    },
  );
  if (!r.ok) {
    throw new Error(`ElevenLabs ${b.id}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
  const j = (await r.json()) as {
    audio_base64: string;
    alignment?: Alinhamento | null;
  };
  const mp3 = Buffer.from(j.audio_base64, 'base64');
  const ficheiro = `${b.id}.mp3`;
  writeFileSync(join(PASTA, ficheiro), mp3);
  const al = j.alignment;
  // Sem alinhamento: a duração pelo tamanho (128 kbit/s constantes).
  const duracao = al?.character_end_times_seconds.length
    ? al.character_end_times_seconds.at(-1)!
    : (mp3.length * 8) / 128_000;
  const g: VozGerada = {
    ficheiro,
    voz_id: vozId,
    modelo: MODELO,
    texto: b.texto,
    duracao: Math.round(duracao * 1000) / 1000,
    frases: al ? frasesAlinhadas(b.texto, al) : [],
  };
  return g;
}

/** O início e o fim de cada frase da legenda, pelos tempos de cada letra. */
function frasesAlinhadas(texto: string, al: Alinhamento) {
  const frases = dividirFrases(texto);
  const resultado: VozGerada['frases'] = [];
  let cursor = 0;
  for (const f of frases) {
    const i = texto.indexOf(f, cursor);
    if (i < 0) continue;
    const fim = Math.min(i + f.length - 1, al.character_end_times_seconds.length - 1);
    resultado.push({
      texto: f,
      inicio: al.character_start_times_seconds[Math.min(i, al.character_start_times_seconds.length - 1)],
      fim: al.character_end_times_seconds[fim],
    });
    cursor = i + f.length;
  }
  return resultado;
}

const blocos = guiao(dados).flatMap((c) => c.blocos);
let gerados = 0;
for (const [i, b] of blocos.entries()) {
  if (so.length && !so.includes(b.id)) continue;
  const atual = manifesto[b.id];
  const igual =
    atual &&
    atual.texto === b.texto &&
    atual.voz_id === VOZES[b.voz] &&
    atual.modelo === MODELO &&
    existsSync(join(PASTA, atual.ficheiro));
  if (igual && !forcar) continue;
  const mesmaVoz = (x?: Bloco) => (x && x.voz === b.voz ? x.texto : undefined);
  process.stdout.write(`${b.id}… `);
  manifesto[b.id] = await gerar(b, mesmaVoz(blocos[i - 1]), mesmaVoz(blocos[i + 1]));
  console.log(`${manifesto[b.id].duracao.toFixed(1)} s`);
  // Grava a cada passo: uma falha a meio não perde o que já se pagou.
  writeFileSync(MANIFESTO, `${JSON.stringify(manifesto, null, 2)}\n`);
  gerados++;
}
console.log(gerados ? `${gerados} gerados.` : 'Nada a gerar: está tudo em dia.');
