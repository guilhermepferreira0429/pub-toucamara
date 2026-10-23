import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { avaliacao } from '../avaliacao'
import { C, Entra } from '../marca'

const COR: Record<string, string> = { s: C.verdeTinta, p: C.creme3, n: C.terracota }
const VIRA = 150

function mistura(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`
}

/** O momento da prova: 180 perguntas, cada uma um ponto. Os pontos mudam de cor, linha a linha. */
export function Prova({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const site = avaliacao.grelha.site
  const tou = avaliacao.grelha.tou
  const virado = f >= VIRA
  const conta = (de: number, para: number) => Math.round(interpolate(f, [VIRA + 10, VIRA + 70], [de, para], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
  const rotulo = spring({ frame: f - VIRA, fps, config: { damping: 200 } })
  return (
    <AbsoluteFill style={{ background: C.creme, opacity: interpolate(f, [dur - 12, dur], [1, 0], { extrapolateLeft: 'clamp' }) }}>
      <div style={{ position: 'absolute', left: 120, top: 120, width: 660 }}>
        <Entra>
          <h1 style={{ fontSize: 96, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 0.98, margin: 0 }}>
            180 perguntas.
            <br />
            As mesmas.
          </h1>
        </Entra>
        <div style={{ height: 76, marginTop: 34, position: 'relative' }}>
          <span style={{ position: 'absolute', opacity: 1 - rotulo, padding: '12px 28px', borderRadius: 999, background: C.creme2, fontSize: 34, fontWeight: 820 }}>A assistente do site</span>
          <span style={{ position: 'absolute', opacity: rotulo, transform: `translateY(${(1 - rotulo) * 16}px)`, padding: '12px 28px', borderRadius: 999, background: C.terracota, color: C.branco, fontSize: 34, fontWeight: 820 }}>Tou, Câmara?</span>
        </div>
        <Entra de={20}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginTop: 30 }}>
            <span style={{ minWidth: 150, fontSize: 120, fontWeight: 900, letterSpacing: '-0.05em', color: C.verdeTinta, fontVariantNumeric: 'tabular-nums' }}>{conta(avaliacao.site.sai, avaliacao.tou.sai)}</span>
            <span style={{ fontSize: 34, fontWeight: 700 }}>saíram a saber o que fazer</span>
          </div>
        </Entra>
        <Entra de={30}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
            <span style={{ minWidth: 150, fontSize: 120, fontWeight: 900, letterSpacing: '-0.05em', color: C.terracota, fontVariantNumeric: 'tabular-nums' }}>{conta(avaliacao.site.contactenos, avaliacao.tou.contactenos)}</span>
            <span style={{ fontSize: 34, fontWeight: 700 }}>acabaram em “contacte-nos”</span>
          </div>
        </Entra>
        <Entra de={50}>
          <p style={{ fontSize: 24, fontWeight: 560, lineHeight: 1.4, color: C.tinta2, marginTop: 40 }}>
            Perguntas de munícipes, {avaliacao.data}. Julgadas por dois juízes, às cegas, contra respostas de referência tiradas das fontes oficiais.
          </p>
        </Entra>
      </div>

      <div style={{ position: 'absolute', left: 860, top: 130, display: 'grid', gridTemplateColumns: 'repeat(15, 52px)', gap: 12 }}>
        {Array.from(site).map((r, i) => {
          const linha = Math.floor(i / 15)
          const aparece = spring({ frame: f - 4 - linha * 2 - (i % 15) * 0.6, fps, config: { damping: 200 } })
          const t = interpolate(f, [VIRA + linha * 4 + (i % 15) * 1.2, VIRA + linha * 4 + (i % 15) * 1.2 + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const fica = virado && tou[i] === 's' && r !== 's'
          const pulso = fica ? 1 + Math.sin(t * Math.PI) * 0.3 : 1
          return <i key={i} style={{ width: 52, height: 52, borderRadius: 26, background: mistura(COR[r], COR[tou[i]], t), transform: `scale(${aparece * pulso})` }} />
        })}
      </div>
      <div style={{ position: 'absolute', left: 860, top: 922, display: 'flex', gap: 40, fontSize: 26, fontWeight: 680, color: C.tinta2 }}>
        {[
          ['s', 'Sai a saber o que fazer'],
          ['p', 'Ajuda em parte'],
          ['n', 'Não ajuda'],
        ].map(([k, t]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <i style={{ width: 22, height: 22, borderRadius: 11, background: COR[k] }} />
            {t}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}
