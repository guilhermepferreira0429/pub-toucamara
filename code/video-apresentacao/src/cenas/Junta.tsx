import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Bolha, C, Logo } from '../marca'
import { Chip, LUGARES, SITES } from './Problema'

/** Os sites juntam-se num só ponto: a marca. */
export function Junta({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const junta = interpolate(f, [0, 34], [0, 1], { extrapolateRight: 'clamp', easing: (t) => t * t * t })
  const marca = spring({ frame: f - 30, fps, config: { damping: 12 } })
  const logo = spring({ frame: f - 52, fps, config: { damping: 200 } })
  return (
    <AbsoluteFill style={{ background: C.creme, opacity: interpolate(f, [dur - 10, dur], [1, 0], { extrapolateLeft: 'clamp' }) }}>
      {SITES.map((s, i) => {
        const l = LUGARES[i]
        const x = l.x + (960 - l.x) * junta
        const y = l.y + (500 - l.y) * junta
        return (
          <div key={s} style={{ position: 'absolute', left: x, top: y, opacity: 1 - junta, transform: `translate(-50%,-50%) rotate(${l.rodar * (1 - junta)}deg) scale(${1 - junta * 0.7})` }}>
            <Chip nome={s} />
          </div>
        )
      })}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 40 }}>
        <div style={{ transform: `scale(${marca})`, opacity: Math.min(1, marca) }}>
          <Bolha tamanho={190} />
        </div>
        <div style={{ opacity: logo, transform: `translateY(${(1 - logo) * 20}px)` }}>
          <Logo altura={86} />
        </div>
        <p style={{ opacity: logo, fontSize: 36, fontWeight: 650, color: C.tinta2, margin: 0 }}>Uma só porta para a câmara inteira. A qualquer hora.</p>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
