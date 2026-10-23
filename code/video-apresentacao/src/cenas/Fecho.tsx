import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, Entra, Logo } from '../marca'

/** As palavras trocam de lugar: as pessoas e o Estado. Depois, a marca e o endereço. */
export function Fecho({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const troca = spring({ frame: f - 70, fps, config: { damping: 18 } })
  const frase = interpolate(f, [150, 165], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const fim = spring({ frame: f - 165, fps, config: { damping: 200 } })
  const palavra = (texto: string, cor: string) => <span style={{ color: cor }}>{texto}</span>
  return (
    <AbsoluteFill style={{ background: C.noite, color: C.creme, opacity: interpolate(f, [dur - 15, dur], [1, 0], { extrapolateLeft: 'clamp' }) }}>
      <AbsoluteFill style={{ justifyContent: 'center', padding: '0 160px', opacity: frase }}>
        <Entra>
          <p style={{ fontSize: 44, fontWeight: 650, color: '#b9c1cc', margin: '0 0 24px' }}>Durante séculos,</p>
        </Entra>
        <Entra de={10}>
          <h1 style={{ fontSize: 104, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1.05, margin: 0, position: 'relative', height: 240 }}>
            <span style={{ position: 'absolute', opacity: 1 - troca }}>
              {palavra('as pessoas', C.creme)} aprenderam
              <br />a falar com {palavra('o Estado', '#f0936b')}.
            </span>
            <span style={{ position: 'absolute', opacity: troca, transform: `translateY(${(1 - troca) * 24}px)` }}>
              Agora, {palavra('o Estado', '#f0936b')} aprende
              <br />a falar com {palavra('as pessoas', C.creme)}.
            </span>
          </h1>
        </Entra>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 40, opacity: fim, transform: `scale(${0.96 + fim * 0.04})` }}>
        <Logo altura={110} claro />
        <p style={{ fontSize: 56, fontWeight: 820, margin: 0, color: '#f0936b' }}>Tou. A qualquer hora.</p>
        <p style={{ fontSize: 40, fontWeight: 700, margin: '20px 0 0', padding: '16px 34px', borderRadius: 999, background: C.creme, color: C.tinta }}>toucamara.descortina.pt/ligar</p>
        <p style={{ fontSize: 26, fontWeight: 600, margin: 0, color: '#8a94a3' }}>Hack4Guimarães 2035 · Demonstração: não é o serviço oficial da câmara.</p>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
