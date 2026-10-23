import { AbsoluteFill } from 'remotion';
import { COR, TEXTO, TITULO } from '../marca';
import { Marca } from '../pecas';
import type { Dados } from '../tipos';
import { EcraCaptura, Moldura } from '../visuais';

/*
 * A miniatura do vídeo no YouTube (1920×1080; sobe como 1280×720). Lê-se
 * em pequeno: três linhas grandes, a marca e o telemóvel com a chamada.
 */
export function Miniatura({ dados }: { dados: Dados }) {
  const chamada = dados.municipe?.falas.findLast((f) => f.captura)?.captura ?? 'municipe_chamada_01';
  return (
    <AbsoluteFill style={{ backgroundColor: COR.tinta, fontFamily: TEXTO, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          right: -140,
          top: 90,
          width: 900,
          height: 900,
          borderRadius: 450,
          background: COR.terracota,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 250,
          top: 130,
          transform: 'rotate(6deg) scale(0.92)',
          transformOrigin: 'center',
        }}
      >
        <Moldura>
          <EcraCaptura dados={dados} captura={chamada} />
        </Moldura>
      </div>
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 110, gap: 36 }}>
        <Marca cor={COR.papel} tamanho={64} />
        <div
          style={{
            fontFamily: TITULO,
            fontWeight: 800,
            fontSize: 150,
            lineHeight: 0.98,
            letterSpacing: -6,
            color: '#FFFFFF',
            maxWidth: 1050,
          }}
        >
          Falar com a câmara <span style={{ color: '#E2774F' }}>sem burocracia.</span>
        </div>
        <div
          style={{
            alignSelf: 'flex-start',
            padding: '14px 28px',
            borderRadius: 999,
            background: COR.papel,
            color: COR.tinta,
            fontSize: 38,
            fontWeight: 700,
          }}
        >
          Hack4Guimarães 2035
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
