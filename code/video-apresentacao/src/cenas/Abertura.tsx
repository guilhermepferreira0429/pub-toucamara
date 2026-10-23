import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { C, Entra, sai } from '../marca'

/** Cold open: 22:04, sem água em casa e ninguém para responder. */
export function Abertura({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  const zoom = interpolate(f, [0, dur], [1.08, 1.0])
  const minuto = f < 70 ? '03' : '04'
  return (
    <AbsoluteFill style={{ background: C.noite, opacity: sai(f, dur, 10) }}>
      <Img src={staticFile('guimaraes-noite.webp')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, opacity: 0.45 }} />
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(15,28,45,.92) 0%, rgba(15,28,45,.55) 60%, rgba(15,28,45,.2) 100%)' }} />
      <AbsoluteFill style={{ padding: '150px 140px', color: C.creme }}>
        <Entra de={4} sobe={20}>
          <div style={{ fontSize: 260, fontWeight: 900, letterSpacing: '-0.06em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
            22:{minuto}
          </div>
        </Entra>
        <Entra de={40}>
          <p style={{ fontSize: 64, fontWeight: 760, letterSpacing: '-0.03em', lineHeight: 1.12, maxWidth: 1150, marginTop: 50 }}>
            Ficou sem água em casa.
            <br />
            Para onde liga?
          </p>
        </Entra>
        <Entra de={100}>
          <p style={{ fontSize: 40, fontWeight: 600, color: '#b9c1cc', marginTop: 34 }}>A câmara fechou às 17:00.</p>
        </Entra>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
