import type { Captura, Enquadramento, Retangulo } from './tipos';

export const LARGURA = 1920;
export const ALTURA = 1080;
const PROPORCAO = LARGURA / ALTURA;
/** Zoom máximo: as capturas estão a 2x, mais do que isto fica desfocado. */
const ZOOM_MAX = 1.9;

function uniao(rs: Retangulo[]): Retangulo {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w));
  const y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Um retângulo 16:9 dentro da captura que contém `r` (com margem). */
export function enquadrar(c: Captura, e: Enquadramento): Retangulo {
  if (e === 'ecra') return { x: 0, y: 0, w: LARGURA, h: ALTURA };
  if ('seguir' in e) {
    const h = e.w / PROPORCAO;
    const z = c.zonas[e.seguir];
    const fundo = z ? z.y + z.h : h;
    const y = Math.min(Math.max(fundo - h * (e.altura ?? 0.72), 0), c.altura - h);
    return { x: Math.min(e.x, c.largura - e.w), y, w: e.w, h };
  }
  let r: Retangulo;
  let margem = 0;
  if ('rect' in e) r = e.rect;
  else {
    const nomes = 'zona' in e ? [e.zona] : e.zonas;
    const zonas = nomes.map((n) => c.zonas[n]).filter(Boolean);
    if (!zonas.length) return { x: 0, y: 0, w: LARGURA, h: ALTURA };
    // Só a parte visível no ecrã capturado conta (as zonas podem passar o fundo).
    r = uniao(zonas);
    r = { ...r, h: Math.min(r.h, c.altura - r.y) };
    margem = e.margem ?? 40;
  }
  let w = r.w + margem * 2;
  let h = r.h + margem * 2;
  if (w / h > PROPORCAO) h = w / PROPORCAO;
  else w = h * PROPORCAO;
  w = Math.min(Math.max(w, LARGURA / ZOOM_MAX), LARGURA);
  h = w / PROPORCAO;
  if (h > c.altura) {
    h = c.altura;
    w = h * PROPORCAO;
  }
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), c.largura - w);
  const y = Math.min(Math.max(cy - h / 2, 0), c.altura - h);
  return { x, y, w, h };
}

function cruza(a: Retangulo, b: Retangulo) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Os planos cuja câmara toca numa zona proibida da captura, em algum
 * momento do movimento (verifica-se ao longo do caminho, não só no início
 * e no fim).
 */
export function planosProibidos(
  planos: { captura: string; de: Enquadramento; para?: Enquadramento; id: string }[],
  capturas: Record<string, Captura>,
): string[] {
  const erros: string[] = [];
  for (const p of planos) {
    const c = capturas[p.captura];
    if (!c?.proibidas?.length) continue;
    const de = enquadrar(c, p.de);
    const para = p.para ? enquadrar(c, p.para) : de;
    for (let i = 0; i <= 20; i++) {
      const cam = interpolarRet(de, para, i / 20);
      const r = c.proibidas.find((z) => cruza(cam, z));
      if (r) {
        erros.push(
          `${p.id} (${p.captura}): a câmara toca numa zona proibida em ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`,
        );
        break;
      }
    }
  }
  return erros;
}

export function interpolarRet(a: Retangulo, b: Retangulo, t: number): Retangulo {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}
