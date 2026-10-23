import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, Entra } from '../marca'

export const SITES = [
  'cm-guimaraes.pt', 'Vimágua', 'Vitrus', 'Tempo Livre', 'CASFIG', 'A Oficina', 'Agenda Cultural', 'Arquivo Municipal',
  'Ave Park', 'Biblioteca Municipal', 'CityFy', 'Fraterna', 'Guimarães 2030', 'Guimarães Marca', 'Guimarães Turismo',
  'Hereditas', 'Licenciamento Industrial', 'Mapas Online', 'Portal de Informação', 'Portal do Associativismo', 'Portal GOV',
  'Set-Up Guimarães', 'Taipas Termal', 'Teleférico de Guimarães',
]

// Lugares fixos numa grelha de 6 × 4 com desvio pseudo-aleatório (sempre iguais em cada render).
export const LUGARES = SITES.map((_, i) => {
  const r = (x: number) => x - Math.floor(x)
  const a = r(Math.sin(i * 12.9898) * 43758.5453)
  const b = r(Math.sin(i * 78.233) * 12345.6789)
  const col = i % 6
  const lin = Math.floor(i / 6)
  return { x: 230 + col * 292 + (a - 0.5) * 90, y: 380 + lin * 135 + (b - 0.5) * 50, rodar: (r(a + b) - 0.5) * 12 }
})

export function Chip({ nome, escuro = false }: { nome: string; escuro?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 22px',
        borderRadius: 14,
        background: escuro ? C.tinta : C.branco,
        color: escuro ? C.creme : C.tinta,
        boxShadow: '0 10px 30px rgba(21,38,59,.12)',
        fontSize: 26,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <i style={{ width: 12, height: 12, borderRadius: 6, background: C.terracota }} />
      {nome}
    </span>
  )
}

/** A resposta existe, mas está espalhada por mais de 20 sites. */
export function Problema({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const saida = interpolate(f, [dur - 12, dur], [1, 0], { extrapolateLeft: 'clamp' })
  return (
    <AbsoluteFill style={{ background: C.creme, opacity: saida }}>
      {SITES.map((s, i) => {
        const p = spring({ frame: f - 6 - i * 3, fps, config: { damping: 14, mass: 0.6 } })
        const l = LUGARES[i]
        return (
          <div key={s} style={{ position: 'absolute', left: l.x, top: l.y, transform: `translate(-50%,-50%) rotate(${l.rodar}deg) scale(${p})`, opacity: Math.min(1, p) }}>
            <Chip nome={s} />
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 140, top: 110 }}>
        <Entra de={20}>
          <h1 style={{ fontSize: 96, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, margin: 0 }}>
            A resposta existe.
          </h1>
        </Entra>
        <Entra de={70}>
          <h2 style={{ fontSize: 60, fontWeight: 800, letterSpacing: '-0.04em', margin: '18px 0 0', color: C.terracota }}>
            Espalhada por mais de 20 sites.
          </h2>
        </Entra>
      </div>
      <Entra de={140} style={{ position: 'absolute', left: 140, bottom: 70 }}>
        <p style={{ fontSize: 40, fontWeight: 700, background: C.tinta, color: C.creme, padding: '18px 30px', borderRadius: 16, margin: 0 }}>
          Às 22:04, fica para amanhã: balcão, email ou telefone.
        </p>
      </Entra>
    </AbsoluteFill>
  )
}
