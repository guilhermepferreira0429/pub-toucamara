import type { Bloco, Cena, Visual, VozGerada } from './tipos';

export const FPS = 30;
/** Palavras por segundo quando ainda não há voz gerada. */
const RITMO = 2.6;
/** Pausa entre blocos por omissão (s). */
const PAUSA = 0.5;
/** Cruzamento entre imagens (frames). */
export const FUNDIDO = 12;

export interface FraseTempo {
  texto: string;
  inicio: number;
  fim: number;
}

export interface BlocoTempo {
  bloco: Bloco;
  cena: Cena;
  /** Frame de início e duração total (com a pausa). */
  de: number;
  duracao: number;
  /** Segundos de fala. */
  fala: number;
  /** Ficheiro de voz, se existe e corresponde ao texto atual. */
  audio: string | null;
  frases: FraseTempo[];
}

export interface VisualTempo {
  visual: Visual;
  cena: Cena;
  de: number;
  duracao: number;
}

export function estimar(texto: string): number {
  const palavras = texto.trim().split(/\s+/).length;
  return Math.max(1.4, palavras / RITMO + 0.3);
}

/** Frases com tempos proporcionais ao número de caracteres. */
function frasesProporcionais(texto: string, duracao: number): FraseTempo[] {
  const frases = dividirFrases(texto);
  const total = frases.reduce((s, f) => s + f.length, 0) || 1;
  let t = 0;
  return frases.map((f) => {
    const d = (f.length / total) * duracao;
    const r = { texto: f, inicio: t, fim: t + d };
    t += d;
    return r;
  });
}

/** Frases para as legendas (corta nos pontos finais, de interrogação e dois pontos longos). */
export function dividirFrases(texto: string): string[] {
  const partes = texto.match(/[^.!?]+[.!?]+["»”]?|[^.!?]+$/g) ?? [texto];
  const frases: string[] = [];
  for (const p of partes.map((x) => x.trim()).filter(Boolean)) {
    // Uma frase muito comprida parte-se nos dois pontos ou na vírgula do meio.
    if (p.length > 120) {
      const corte = p.indexOf(': ') > 30 ? p.indexOf(': ') + 1 : p.lastIndexOf(', ', p.length / 2 + 30) + 1;
      if (corte > 20) {
        frases.push(p.slice(0, corte).trim(), p.slice(corte).trim());
        continue;
      }
    }
    frases.push(p);
  }
  return frases;
}

export function linhaDoTempo(cenas: Cena[], voz: Record<string, VozGerada>) {
  const blocos: BlocoTempo[] = [];
  const visuais: VisualTempo[] = [];
  const avisos: string[] = [];
  let t = 0;
  for (const cena of cenas) {
    for (const bloco of cena.blocos) {
      const g = voz[bloco.id];
      const valida = g && g.texto === bloco.texto;
      if (g && !valida) avisos.push(`${bloco.id}: o texto mudou desde a voz gerada`);
      if (!g) avisos.push(`${bloco.id}: sem voz (duração estimada)`);
      const fala = valida ? g.duracao : estimar(bloco.texto);
      const frases =
        valida && g.frases.length ? g.frases : frasesProporcionais(bloco.texto, fala);
      const duracao = Math.round((fala + (bloco.pausa ?? PAUSA)) * FPS);
      blocos.push({
        bloco,
        cena,
        de: t,
        duracao,
        fala,
        audio: valida ? g.ficheiro : null,
        frases,
      });
      const pesos = bloco.visual.reduce((s, v) => s + (v.peso ?? 1), 0);
      let tv = t;
      bloco.visual.forEach((visual, i) => {
        const d =
          i === bloco.visual.length - 1
            ? t + duracao - tv
            : Math.round((duracao * (visual.peso ?? 1)) / pesos);
        visuais.push({ visual, cena, de: tv, duracao: d });
        tv += d;
      });
      t += duracao;
    }
  }
  return { blocos, visuais, total: t, avisos };
}
