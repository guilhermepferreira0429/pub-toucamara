/*
 * O que as capturas dos três vídeos partilham: endereços, a sessão do
 * painel, o browser e as funções que guardam cada ecrã com as suas zonas.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SAIDA = join(RAIZ, 'public', 'capturas');
export const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
export const API = process.env.API_URL ?? 'http://localhost:3001';
export const MUNICIPIO = process.env.MUNICIPIO ?? 'guimaraes';
export const TOKEN = process.env.PAINEL_TOKEN;

export function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const pasta = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  return pasta ? join(base, pasta, 'chrome-linux', 'chrome') : undefined;
}

/** GET (ou outro método) à API do painel, com a sessão. */
export async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const r = await fetch(`${API}/v1/painel/${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(corpo ? { 'content-type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`${metodo} ${caminho}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

export const ESCONDER =
  'nextjs-portal{display:none!important} *{scrollbar-width:none!important} ::-webkit-scrollbar{display:none!important}';

/**
 * As funções de captura de uma página. `capturas` é o mapa partilhado
 * (vai para src/dados.gerado.json); `largura`/`altura` são as do ecrã em
 * px CSS (1920×1080 no painel, 390×844 no telemóvel).
 */
export function captor(pagina, capturas, { largura, altura, pasta }) {
  async function ir(caminho, espera = 'networkidle') {
    await pagina.goto(caminho.startsWith('http') ? caminho : WEB + caminho, {
      waitUntil: espera,
      timeout: 180_000,
    });
    await pagina.addStyleTag({ content: ESCONDER });
    await pagina.evaluate(() => document.fonts.ready);
    await pagina.waitForTimeout(900);
  }

  /** Retângulo (px CSS da página) da primeira secção que começa com o texto. */
  async function seccao(texto) {
    return pagina.evaluate((t) => {
      const s = [...document.querySelectorAll('main section')].find((e) =>
        (e.textContent ?? '').trim().startsWith(t),
      );
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    }, texto);
  }

  /** Retângulo do elemento mais pequeno que contém o texto, subindo `subir` níveis. */
  async function elemento(texto, subir = 0, raiz = 'main') {
    return pagina.evaluate(
      ([t, n, q]) => {
        const todos = [...document.querySelectorAll(`${q} *`)].filter((e) =>
          (e.textContent ?? '').includes(t),
        );
        let e = todos.at(-1);
        if (!e) return null;
        for (let i = 0; i < n && e.parentElement; i++) e = e.parentElement;
        const r = e.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      },
      [texto, subir, raiz],
    );
  }

  /**
   * Guarda a captura e as zonas. `proibidas`: o que nunca pode aparecer no
   * vídeo (resultados do teste de qualidade de demonstração, avisos de que
   * a IA ou o armazenamento não estão ligados nesta instalação local): o
   * render falha se uma câmara lhes tocar.
   */
  async function guardar(nome, zonas = {}, { inteira = false, proibidas = [] } = {}) {
    const ficheiro = `${nome}.jpg`;
    await pagina.screenshot({
      path: join(pasta, ficheiro),
      type: 'jpeg',
      quality: 90,
      fullPage: inteira,
    });
    const alturaFinal = inteira
      ? await pagina.evaluate(() => document.documentElement.scrollHeight)
      : altura;
    const limpas = Object.fromEntries(
      Object.entries(zonas).filter(([, r]) => r && r.w > 0 && r.h > 0),
    );
    for (const k of Object.keys(zonas)) {
      if (!limpas[k]) console.warn(`  aviso: zona "${k}" não encontrada em ${nome}`);
    }
    capturas[nome] = {
      ficheiro,
      largura,
      altura: alturaFinal,
      zonas: limpas,
      proibidas: proibidas.filter((r) => r && r.w > 0 && r.h > 0),
    };
    console.log(`${ficheiro} (${largura}×${alturaFinal})`);
  }

  /** Captura de um só elemento (uma linha de uma lista, um cartão). */
  async function recorte(nome, localizador) {
    const ficheiro = `${nome}.jpg`;
    await localizador.scrollIntoViewIfNeeded();
    const caixa = await localizador.boundingBox();
    if (!caixa) throw new Error(`Recorte ${nome}: elemento não encontrado`);
    await localizador.screenshot({ path: join(pasta, ficheiro), type: 'jpeg', quality: 92 });
    capturas[nome] = {
      ficheiro,
      largura: Math.round(caixa.width),
      altura: Math.round(caixa.height),
      zonas: {},
      proibidas: [],
    };
    console.log(`${ficheiro} (recorte ${Math.round(caixa.width)}×${Math.round(caixa.height)})`);
  }

  return { ir, seccao, elemento, guardar, recorte };
}

/** Dia de hoje em Lisboa, 'AAAA-MM-DD', mais `dias`. */
export function diaLisboa(dias = 0) {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
