import { AbsoluteFill, Sequence } from 'remotion'
import { Abertura } from './cenas/Abertura'
import { Acao } from './cenas/Acao'
import { Chamada } from './cenas/Chamada'
import { Fecho } from './cenas/Fecho'
import { Junta } from './cenas/Junta'
import { Painel } from './cenas/Painel'
import { Problema } from './cenas/Problema'
import { Prova } from './cenas/Prova'
import { C, estiloFontes, FONTE } from './marca'

// Cenas, em frames a 30 fps. Para mudar a duração de uma cena, muda aqui; as seguintes acompanham.
const cenas = [
  { id: 'abertura', dur: 180, C: Abertura },
  { id: 'problema', dur: 240, C: Problema },
  { id: 'junta', dur: 110, C: Junta },
  { id: 'chamada', dur: 600, C: Chamada },
  { id: 'acao', dur: 330, C: Acao },
  { id: 'prova', dur: 420, C: Prova },
  { id: 'painel', dur: 220, C: Painel },
  { id: 'fecho', dur: 300, C: Fecho },
]

export const DURACAO = cenas.reduce((s, c) => s + c.dur, 0)

export function Apresentacao() {
  let inicio = 0
  return (
    <AbsoluteFill style={{ background: C.creme, fontFamily: FONTE, color: C.tinta }}>
      <style>{estiloFontes}</style>
      {cenas.map(({ id, dur, C: Cena }) => {
        const de = inicio
        inicio += dur
        return (
          <Sequence key={id} from={de} durationInFrames={dur} name={id}>
            <Cena dur={dur} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
