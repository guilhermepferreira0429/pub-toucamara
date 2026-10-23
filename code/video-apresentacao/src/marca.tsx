import type { CSSProperties, ReactNode } from 'react'
import { interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

export const C = {
  creme: '#f7f0e4',
  creme2: '#efe5d3',
  creme3: '#e4d6bd',
  tinta: '#15263b',
  tinta2: '#45546a',
  terracota: '#b84a24',
  terracotaClara: '#f0d3c3',
  branco: '#ffffff',
  verde: '#dce8d8',
  verdeTinta: '#2c5a34',
  noite: '#0f1c2d',
}

export const FONTE = 'Inter, system-ui, sans-serif'

export const estiloFontes = `
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900; font-display: block;
  src: url(${staticFile('inter-latin-opsz-normal.woff2')}) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900; font-display: block;
  src: url(${staticFile('inter-latin-ext-opsz-normal.woff2')}) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
`

/** O ponto de interrogação da marca, em balão. */
export function Bolha({ tamanho = 72, cor = C.terracota, sinal = C.branco, style }: { tamanho?: number; cor?: string; sinal?: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: tamanho,
        height: tamanho,
        borderRadius: `${tamanho * 0.5}px ${tamanho * 0.5}px ${tamanho * 0.5}px ${tamanho * 0.12}px`,
        background: cor,
        color: sinal,
        fontSize: tamanho * 0.62,
        fontWeight: 900,
        lineHeight: 1,
        ...style,
      }}
    >
      ?
    </span>
  )
}

export function Logo({ altura = 64, claro = false }: { altura?: number; claro?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: altura * 0.18, fontSize: altura, fontWeight: 880, letterSpacing: '-0.045em', color: claro ? C.creme : C.tinta }}>
      Tou, Câmara
      <Bolha tamanho={altura * 1.02} cor={claro ? C.creme : C.terracota} sinal={claro ? C.tinta : C.branco} />
    </span>
  )
}

/** Entra a subir e a aparecer, com mola. */
export function Entra({ de = 0, sobe = 40, children, style }: { de?: number; sobe?: number; children: ReactNode; style?: CSSProperties }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: f - de, fps, config: { damping: 200 } })
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * sobe}px)`, ...style }}>{children}</div>
}

/** Texto escrito letra a letra (como quem fala). */
export function Escreve({ texto, de = 0, porFrame = 1.6 }: { texto: string; de?: number; porFrame?: number }) {
  const f = useCurrentFrame()
  const n = Math.max(0, Math.floor((f - de) * porFrame))
  return (
    <>
      {texto.slice(0, n)}
      <span style={{ opacity: 0 }}>{texto.slice(n)}</span>
    </>
  )
}

export function sai(f: number, fim: number, dur = 12) {
  return interpolate(f, [fim - dur, fim], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
}
