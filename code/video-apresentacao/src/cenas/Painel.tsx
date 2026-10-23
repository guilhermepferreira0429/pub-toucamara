import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { C, Entra } from '../marca'

const CONVERSAS = [
  { hora: '22:04', tema: 'Água', resumo: 'Sem água em casa. Encaminhado para a Vimágua, opção 3.', estado: 'Resolvido na chamada', cor: C.verde, tinta: C.verdeTinta },
  { hora: '21:37', tema: 'Obras', resumo: 'Azulejos da cozinha. Isento de licença (RJUE); avisar 5 dias antes.', estado: 'Resolvido na chamada', cor: C.verde, tinta: C.verdeTinta },
  { hora: '19:12', tema: 'Emergência', resumo: 'Fumo numa casa. Mandado ligar já para o 112.', estado: '112', cor: C.terracotaClara, tinta: C.terracota },
  { hora: '18:50', tema: 'Esplanada', resumo: 'Largo do Toural, 12 m². Pedido submetido, taxa calculada.', estado: 'Pedido submetido', cor: C.verde, tinta: C.verdeTinta },
  { hora: '17:41', tema: 'Processo', resumo: 'Quer saber se o processo foi aprovado. Passado ao urbanismo, com resumo.', estado: 'Passou a funcionário', cor: C.creme2, tinta: C.tinta },
]

/** O lado da câmara: cada conversa chega resumida. Exemplo ilustrativo. */
export function Painel({ dur }: { dur: number }) {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: C.tinta, color: C.creme, opacity: interpolate(f, [dur - 12, dur], [1, 0], { extrapolateLeft: 'clamp' }) }}>
      <div style={{ position: 'absolute', left: 140, top: 150, width: 620 }}>
        <Entra>
          <h1 style={{ fontSize: 88, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, margin: 0 }}>E a câmara vê tudo.</h1>
        </Entra>
        <Entra de={24}>
          <p style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.35, color: '#b9c1cc', marginTop: 36 }}>
            Cada conversa chega resumida. Quando passa a um funcionário, ele já sabe o caso e não tem de perguntar tudo de novo.
          </p>
        </Entra>
        <Entra de={40}>
          <p style={{ fontSize: 22, fontWeight: 600, color: '#8a94a3', marginTop: 30 }}>Exemplo ilustrativo do painel.</p>
        </Entra>
      </div>
      <div style={{ position: 'absolute', left: 860, right: 120, top: 130, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {CONVERSAS.map((c, i) => (
          <Entra key={c.hora} de={14 + i * 14} sobe={24}>
            <div style={{ background: C.creme, color: C.tinta, borderRadius: 24, padding: '24px 30px', display: 'grid', gridTemplateColumns: '90px 1fr', gap: '6px 22px' }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: C.tinta2, fontVariantNumeric: 'tabular-nums' }}>{c.hora}</span>
              <span style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <b style={{ fontSize: 28 }}>{c.tema}</b>
                <span style={{ fontSize: 20, fontWeight: 760, padding: '5px 14px', borderRadius: 999, background: c.cor, color: c.tinta }}>{c.estado}</span>
              </span>
              <span />
              <span style={{ fontSize: 25, fontWeight: 560, color: C.tinta2 }}>{c.resumo}</span>
            </div>
          </Entra>
        ))}
      </div>
    </AbsoluteFill>
  )
}
