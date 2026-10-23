import { Composition, Still } from 'remotion';
import dadosGerados from './dados.gerado.json';
import { ALTURA, LARGURA } from './camara';
import type { Dados } from './tipos';
import { guiaoUnico, proibidasUnico } from './unico/guiao';
import { FPS, TOTAL_F } from './unico/ritmo';
import { Miniatura } from './unico/Miniatura';
import { Unico } from './unico/Unico';

const dados = dadosGerados as unknown as Dados;

/** O vídeo: sem voz, com música (src/unico). */
export function Root() {
  if (!dados.capturas || !dados.municipe) {
    throw new Error('Sem capturas: corre primeiro `npm run capturar` (ver README).');
  }
  const tomas = guiaoUnico(dados);
  // O que nunca pode aparecer (resultados de demonstração do teste de
  // qualidade, avisos de IA desligada nesta instalação): falha logo aqui.
  const erros = proibidasUnico(tomas, dados);
  if (erros.length) throw new Error(`Zonas proibidas:\n${erros.join('\n')}`);
  return (
    <>
      <Composition
        id="TouCamara"
        component={Unico}
        durationInFrames={TOTAL_F}
        fps={FPS}
        width={LARGURA}
        height={ALTURA}
        defaultProps={{ tomas, dados }}
      />
      <Still id="Miniatura" component={Miniatura} width={LARGURA} height={ALTURA} defaultProps={{ dados }} />
    </>
  );
}
