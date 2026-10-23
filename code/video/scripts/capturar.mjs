/*
 * Capturas para o vídeo, a partir de um painel a correr com a
 * demonstração preparada (ver README). Grava em public/capturas/ as imagens
 * (1920×1080 a 2x; o telemóvel a 390×844 a 3x) e em src/dados.gerado.json
 * os números que o vídeo mostra e as zonas de cada ecrã para onde a câmara
 * vai. Pode correr-se as vezes que for preciso.
 *
 *   PAINEL_TOKEN=... npm run capturar                       (tudo: painel, munícipe, trailer)
 *   PAINEL_TOKEN=... npm run capturar -- --video=municipe,trailer
 *
 * Variáveis: WEB_URL (http://localhost:3000), API_URL (http://localhost:3001),
 * MUNICIPIO (guimaraes), PAINEL_TOKEN (sessão de chefia ou administração do
 * painel), CHROME (executável do Chromium; por omissão o de /opt/pw-browsers).
 * O vídeo do munícipe precisa também de AGENTE_SEGREDO e das variáveis da
 * base (DB_*): ver scripts/capturas/municipe.mjs.
 *
 * Antes de capturar, esconde o que não é da demonstração ("Preparar demo"
 * com "limpar testes"): as chamadas simuladas das capturas anteriores não
 * entram nos números. LIMPAR=0 salta este passo.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { MUNICIPIO, RAIZ, SAIDA, TOKEN, api, chrome } from './capturas/comum.mjs';
import { capturarMunicipe } from './capturas/municipe.mjs';
import { capturarPainel } from './capturas/painel.mjs';
import { capturarTrailer } from './capturas/trailer.mjs';

const VIDEOS = { painel: capturarPainel, municipe: capturarMunicipe, trailer: capturarTrailer };
const escolha = process.argv.find((a) => a.startsWith('--video='))?.slice(8);
const quais = escolha ? escolha.split(',') : Object.keys(VIDEOS);
for (const q of quais) {
  if (!VIDEOS[q]) throw new Error(`Vídeo desconhecido: ${q} (${Object.keys(VIDEOS).join(', ')})`);
}

if (!TOKEN) {
  console.error('Falta PAINEL_TOKEN (sessão do painel). Ver README.');
  process.exit(1);
}

if (process.env.LIMPAR !== '0') {
  const { ocultados } = await api('demo/preparar', {
    metodo: 'POST',
    corpo: { confirmar: true, limpar_testes: true },
  });
  console.log(`Escondido o que não é da demonstração: ${JSON.stringify(ocultados)}`);
}

mkdirSync(SAIDA, { recursive: true });
const browser = await chromium.launch({
  executablePath: chrome(),
  // Microfone falso: a chamada do /ligar pede o microfone antes de ligar.
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const contexto = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  timezoneId: 'Europe/Lisbon',
  locale: 'pt-PT',
});
await contexto.addInitScript(
  ([token, municipio]) => {
    try {
      localStorage.setItem('toucamara.token', token);
      localStorage.setItem('toucamara.municipio', municipio);
    } catch {
      /* sem localStorage */
    }
  },
  [TOKEN, MUNICIPIO],
);
const pagina = await contexto.newPage();

// O que já lá está (os vídeos que não se capturam agora ficam como estavam).
const FICHEIRO = join(RAIZ, 'src', 'dados.gerado.json');
const anterior = existsSync(FICHEIRO) ? JSON.parse(readFileSync(FICHEIRO, 'utf8')) : {};
const capturas = { ...(anterior.capturas ?? {}) };
let dados = { ...anterior };
for (const q of quais) {
  console.log(`\n== ${q}`);
  const parte = await VIDEOS[q]({ browser, pagina, capturas, pasta: SAIDA });
  dados = { ...dados, ...parte };
}
await browser.close();

dados.gerado_em = new Date().toISOString();
dados.capturas = capturas;
writeFileSync(FICHEIRO, `${JSON.stringify(dados, null, 2)}\n`);
console.log('src/dados.gerado.json');
