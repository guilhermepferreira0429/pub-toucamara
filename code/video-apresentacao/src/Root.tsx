import { Composition } from 'remotion'
import { Apresentacao, DURACAO } from './Apresentacao'

export function Root() {
  return (
    <Composition
      id="Apresentacao"
      component={Apresentacao}
      durationInFrames={DURACAO}
      fps={30}
      width={1920}
      height={1080}
    />
  )
}
