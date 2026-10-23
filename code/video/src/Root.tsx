import { Composition } from 'remotion';
import dadosGerados from './dados.gerado.json';
import vozGerada from './voz.gerado.json';
import { ALTURA, LARGURA } from './camara';
import { guiao, verificarProibidas } from './guiao';
import { FPS, linhaDoTempo } from './tempos';
import type { Dados, VozGerada } from './tipos';
import { Video } from './Video';

const dados = dadosGerados as unknown as Dados;
const voz = vozGerada as unknown as Record<string, VozGerada>;

export function Root() {
  if (!dados.capturas) {
    throw new Error('Sem capturas: corre primeiro `npm run capturar` (ver README).');
  }
  const cenas = guiao(dados);
  // O que nunca pode aparecer (resultados de demonstração do teste de
  // qualidade, avisos de IA desligada nesta instalação): falha logo aqui.
  const erros = verificarProibidas(cenas, dados);
  if (erros.length) throw new Error(`Zonas proibidas no vídeo:\n${erros.join('\n')}`);
  const { total } = linhaDoTempo(cenas, voz);
  return (
    <Composition
      id="Painel"
      component={Video}
      durationInFrames={total}
      fps={FPS}
      width={LARGURA}
      height={ALTURA}
      defaultProps={{ cenas, dados, voz }}
    />
  );
}
