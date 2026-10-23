import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, Entra } from '../marca'

// Taxa real: Tabela de Taxas e Outras Receitas Municipais 2025/2026, art. 25.º (Centro Histórico e Toural).
const LINHAS = [
  { rotulo: 'Pedido', valor: 'Licença de esplanada' },
  { rotulo: 'Onde', valor: 'Largo do Toural · centro histórico' },
  { rotulo: 'Área', valor: '12 m² · 4 mesas · 2 m de passeio livre' },
  { rotulo: 'Taxa', valor: '12 m² × 18,18 € = 218,16 € por ano' },
  { rotulo: 'Quem pede', valor: 'Identificado com código por SMS' },
]

/** Não fica pela resposta: trata do assunto na conversa. */
export function Acao({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const carimbo = spring({ frame: f - 220, fps, config: { damping: 9, mass: 0.7 } })
  return (
    <AbsoluteFill style={{ background: C.creme, opacity: interpolate(f, [dur - 12, dur], [1, 0], { extrapolateLeft: 'clamp' }) }}>
      <div style={{ position: 'absolute', left: 140, top: 140, width: 640 }}>
        <Entra>
          <h1 style={{ fontSize: 92, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, margin: 0 }}>Responder não chega.</h1>
        </Entra>
        <Entra de={30}>
          <h2 style={{ fontSize: 64, fontWeight: 850, letterSpacing: '-0.04em', lineHeight: 1.05, margin: '26px 0 0', color: C.terracota }}>Trata do assunto na conversa.</h2>
        </Entra>
        <Entra de={60}>
          <p style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.35, color: C.tinta2, marginTop: 40 }}>
            Faz as perguntas uma a uma, calcula a taxa com a tabela oficial e submete o pedido. A equipa da câmara só olha para as exceções.
          </p>
        </Entra>
      </div>

      <div style={{ position: 'absolute', left: 900, right: 140, top: 150, background: C.branco, borderRadius: 34, padding: '44px 50px', boxShadow: '0 30px 70px rgba(21,38,59,.14)' }}>
        {LINHAS.map((l, i) => (
          <Entra key={l.rotulo} de={50 + i * 26} sobe={16}>
            <div style={{ display: 'flex', gap: 30, padding: '22px 0', borderBottom: i < LINHAS.length - 1 ? `2px solid ${C.creme2}` : 'none' }}>
              <span style={{ width: 200, fontSize: 28, fontWeight: 700, color: C.tinta2 }}>{l.rotulo}</span>
              <span style={{ flex: 1, fontSize: 32, fontWeight: 760, color: l.rotulo === 'Taxa' ? C.terracota : C.tinta }}>{l.valor}</span>
            </div>
          </Entra>
        ))}
        {f > 215 && (
          <div
            style={{
              position: 'absolute',
              right: 50,
              bottom: -60,
              transform: `rotate(-7deg) scale(${2 - carimbo})`,
              opacity: Math.min(1, carimbo),
              border: `6px solid ${C.verdeTinta}`,
              color: C.verdeTinta,
              background: C.verde,
              borderRadius: 18,
              padding: '16px 30px',
              fontSize: 40,
              fontWeight: 900,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            Pedido submetido
          </div>
        )}
      </div>
      <Entra de={250} style={{ position: 'absolute', left: 900, bottom: 80 }}>
        <p style={{ margin: 0, fontSize: 28, fontWeight: 650, color: C.tinta2 }}>A referência Multibanco segue por SMS. Taxa da Tabela de Taxas 2025/2026, art. 25.º.</p>
      </Entra>
    </AbsoluteFill>
  )
}
