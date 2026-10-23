import type { ReactNode } from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Bolha, C, Entra, Escreve } from '../marca'

// Texto do agente tirado da resposta real do chat (avaliação de 23/10, pergunta 69), encurtado.
const PERGUNTA = 'Estou sem água em casa. Para onde ligo?'
const RESPOSTA =
  'Ligue para a Vimágua, pelo 253 439 560, e escolha a opção 3. A linha funciona 24 horas por dia, por isso está aberta agora.'
const SMS = 'Câmara de Guimarães: falta de água em casa. Vimágua 253 439 560, opção 3 (24 h). Fonte: vimagua.pt'

function Balao({ quem, children }: { quem: 'municipe' | 'agente'; children: ReactNode }) {
  const m = quem === 'municipe'
  return (
    <div
      style={{
        alignSelf: m ? 'flex-end' : 'flex-start',
        maxWidth: 820,
        padding: '26px 32px',
        borderRadius: m ? '30px 30px 8px 30px' : '30px 30px 30px 8px',
        background: m ? C.tinta : C.branco,
        color: m ? C.creme : C.tinta,
        fontSize: 40,
        fontWeight: 620,
        lineHeight: 1.3,
        boxShadow: '0 14px 40px rgba(21,38,59,.10)',
      }}
    >
      {children}
    </div>
  )
}

function Onda({ ativa }: { ativa: boolean }) {
  const f = useCurrentFrame()
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: 90 }}>
      {Array.from({ length: 13 }, (_, i) => {
        const h = ativa ? 18 + Math.abs(Math.sin(f * 0.35 + i * 0.9)) * 64 : 10
        return <i key={i} style={{ width: 9, height: h, borderRadius: 5, background: C.terracota }} />
      })}
    </div>
  )
}

/** Uma chamada real: pergunta, resposta com fonte, e o SMS no fim. */
export function Chamada({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const seg = Math.floor(f / fps) + 12
  const relogio = `00:${String(seg).padStart(2, '0')}`
  const fala = (f > 40 && f < 110) || (f > 150 && f < 330)
  const smsP = spring({ frame: f - 400, fps, config: { damping: 15 } })
  return (
    <AbsoluteFill style={{ background: C.creme, opacity: interpolate(f, [dur - 12, dur], [1, 0], { extrapolateLeft: 'clamp' }) }}>
      {/* Telemóvel com a chamada */}
      <div style={{ position: 'absolute', left: 140, top: 110, width: 470, height: 860, borderRadius: 64, background: C.tinta, padding: 26, boxShadow: '0 40px 80px rgba(21,38,59,.25)' }}>
        <div style={{ height: '100%', borderRadius: 44, background: C.noite, color: C.creme, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 110, gap: 26 }}>
          <Bolha tamanho={130} />
          <div style={{ fontSize: 40, fontWeight: 800 }}>Câmara de Guimarães</div>
          <div style={{ fontSize: 32, fontWeight: 600, color: '#b9c1cc', fontVariantNumeric: 'tabular-nums' }}>{relogio}</div>
          <Onda ativa={fala} />
          <div style={{ marginTop: 'auto', marginBottom: 70, width: 110, height: 110, borderRadius: 55, background: C.terracota, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800 }}>
            ✕
          </div>
        </div>
      </div>

      {/* Transcrição */}
      <div style={{ position: 'absolute', left: 720, right: 140, top: 120, display: 'flex', flexDirection: 'column', gap: 34 }}>
        <Entra de={0}>
          <p style={{ margin: 0, fontSize: 30, fontWeight: 760, color: C.terracota, letterSpacing: '0.04em', textTransform: 'uppercase' }}>22:04 · uma chamada à câmara</p>
        </Entra>
        {f > 36 && (
          <Balao quem="municipe">
            <Escreve texto={PERGUNTA} de={40} porFrame={0.75} />
          </Balao>
        )}
        {f > 140 && (
          <Balao quem="agente">
            <Escreve texto={RESPOSTA} de={150} porFrame={0.75} />
          </Balao>
        )}
        {f > 330 && (
          <Entra de={330} sobe={14}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '12px 22px', borderRadius: 999, background: C.verde, color: C.verdeTinta, fontSize: 28, fontWeight: 760 }}>
              ✓ Fonte oficial · Vimágua
            </span>
          </Entra>
        )}
      </div>

      {/* SMS no fim da chamada */}
      {f > 395 && (
        <div style={{ position: 'absolute', right: 140, bottom: 90, width: 760, transform: `translateY(${(1 - smsP) * 120}px)`, opacity: Math.min(1, smsP) }}>
          <p style={{ margin: '0 0 14px', fontSize: 28, fontWeight: 760, color: C.tinta2 }}>No fim da chamada, chega por SMS:</p>
          <div style={{ background: C.tinta, color: C.creme, borderRadius: 26, padding: '26px 30px', fontSize: 32, lineHeight: 1.35, fontWeight: 560, boxShadow: '0 20px 50px rgba(21,38,59,.25)' }}>
            {SMS}
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 26, fontWeight: 600, color: C.tinta2 }}>Funciona em qualquer telemóvel, com ou sem internet.</p>
        </div>
      )}
    </AbsoluteFill>
  )
}
