import { Composition } from 'remotion';
import dadosGerados from './dados.gerado.json';
import vozGerada from './voz.gerado.json';
import { ALTURA, LARGURA } from './camara';
import { guiao, verificarProibidas } from './guiao';
import { guiaoMunicipe } from './guiao-municipe';
import { FPS, linhaDoTempo } from './tempos';
import type { Dados, VozGerada } from './tipos';
import { Video } from './Video';

const dados = dadosGerados as unknown as Dados;
const voz = vozGerada as unknown as Record<string, VozGerada>;

export function Root() {
  if (!dados.capturas) {
    throw new Error('Sem capturas: corre primeiro `npm run capturar` (ver README).');
  }
  const videos = [
    { id: 'Painel', cenas: guiao(dados) },
    ...(dados.municipe ? [{ id: 'Municipe', cenas: guiaoMunicipe(dados) }] : []),
  ];
  return (
    <>
      {videos.map(({ id, cenas }) => {
        // O que nunca pode aparecer (resultados de demonstração do teste de
        // qualidade, avisos de IA desligada nesta instalação): falha logo aqui.
        const erros = verificarProibidas(cenas, dados);
        if (erros.length) throw new Error(`Zonas proibidas em ${id}:\n${erros.join('\n')}`);
        const { total } = linhaDoTempo(cenas, voz);
        return (
          <Composition
            key={id}
            id={id}
            component={Video}
            durationInFrames={total}
            fps={FPS}
            width={LARGURA}
            height={ALTURA}
            defaultProps={{ cenas, dados, voz }}
          />
        );
      })}
    </>
  );
}
