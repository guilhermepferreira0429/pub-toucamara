import type { CSSProperties } from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { LARGURA, enquadrar, interpolarRet } from './camara';
import { COR, TITULO } from './marca';
import type { Dados, PlanoPainel, Recortes } from './tipos';
import { Selo } from './visuais';

/*
 * Peças do vídeo: uma página do painel com a câmara a mover-se, recortes
 * da página arrumados num ecrã, e a marca.
 */

const suave = Easing.bezier(0.45, 0, 0.2, 1);

// ---------------------------------------------------------------------------
// Uma captura do painel, com a câmara a mover-se e a zona em foco
// ---------------------------------------------------------------------------

export function Painel({
  plano,
  dados,
  duracao,
  selo,
}: {
  plano: PlanoPainel;
  dados: Dados;
  duracao: number;
  selo: boolean;
}) {
  const f = useCurrentFrame();
  const c = dados.capturas[plano.captura];
  if (!c) return <Falta texto={`Falta a captura "${plano.captura}"`} />;
  const de = enquadrar(c, plano.de);
  const para = plano.para ? enquadrar(c, plano.para) : encolher(de, c, 0.03);
  const t = interpolate(f, [0, Math.max(1, duracao)], [0, 1], {
    extrapolateRight: 'clamp',
    easing: suave,
  });
  const cam = interpolarRet(de, para, t);
  const escala = LARGURA / cam.w;
  const foco =
    typeof plano.foco === 'string' ? c.zonas[plano.foco] : plano.foco;
  const opFoco = interpolate(f, [duracao * 0.18, duracao * 0.18 + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: COR.creme }}>
      <Img
        src={staticFile(`capturas/${c.ficheiro}`)}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: c.largura,
          height: c.altura,
          transformOrigin: '0 0',
          transform: `scale(${escala}) translate(${-cam.x}px, ${-cam.y}px)`,
        }}
      />
      {foco ? (
        <div
          style={{
            position: 'absolute',
            left: (foco.x - 10 - cam.x) * escala,
            top: (foco.y - 10 - cam.y) * escala,
            width: (foco.w + 20) * escala,
            height: (foco.h + 20) * escala,
            borderRadius: 18 * escala,
            border: `${4}px solid ${COR.terracota}`,
            boxShadow: `0 0 0 4000px rgba(21, 38, 59, ${0.28 * opFoco})`,
            opacity: opFoco,
          }}
        />
      ) : null}
      {selo ? (
        <Selo
          esquerda={
            plano.selo
              ? plano.selo === 'esquerda'
              : [foco, c.zonas.alerta].some(
            (z) =>
              z &&
              (z.x + z.w - cam.x) * escala > LARGURA - 460 &&
              (z.y - cam.y) * escala < 130,
              )
          }
        />
      ) : null}
    </AbsoluteFill>
  );
}

/** Um pouco mais perto, para a imagem nunca estar parada. */
function encolher(r: { x: number; y: number; w: number; h: number }, c: { largura: number; altura: number }, p: number) {
  const w = r.w * (1 - p);
  const h = r.h * (1 - p);
  return {
    x: Math.min(Math.max(r.x + (r.w - w) / 2, 0), c.largura - w),
    y: Math.min(Math.max(r.y + (r.h - h) / 2, 0), c.altura - h),
    w,
    h,
  };
}

function Falta({ texto }: { texto: string }) {
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        color: COR.terracota,
        fontSize: 48,
      }}
    >
      {texto}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Recortes do painel arrumados num ecrã (elementos soltos, com o nome da página)
// ---------------------------------------------------------------------------

/** Escala dos recortes (px CSS da página → px do vídeo). */
const ESCALA_RECORTE = 1.6;
/** Altura máxima de um cartão (acima das legendas). */
const ALTURA_COLUNA = 660;

export function EcraRecortes({
  recortes,
  dados,
  duracao,
  selo,
}: {
  recortes: Recortes;
  dados: Dados;
  duracao: number;
  selo: boolean;
}) {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, duracao], [1, 1.03], { extrapolateRight: 'clamp' });
  const aparece = (i: number): CSSProperties => {
    const a = 6 + i * 9;
    return {
      opacity: interpolate(f, [a, a + 12], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      transform: `translateY(${interpolate(f, [a, a + 16], [18, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: suave,
      })}px)`,
    };
  };
  const cartao = (nome: string, i: number, alturaMax?: number) => {
    const c = dados.capturas[nome];
    if (!c) return <Falta key={nome} texto={`Falta o recorte "${nome}"`} />;
    const altura = c.altura * ESCALA_RECORTE;
    const corta = alturaMax !== undefined && altura > alturaMax;
    return (
      <div
        key={nome}
        style={{
          ...aparece(i),
          position: 'relative',
          background: COR.papel,
          border: `2px solid ${COR.linha}`,
          borderRadius: 22,
          padding: 18,
          boxShadow: '0 12px 30px rgba(21,38,59,0.10)',
          overflow: 'hidden',
          height: corta ? alturaMax : undefined,
        }}
      >
        <Img
          src={staticFile(`capturas/${c.ficheiro}`)}
          style={{ display: 'block', width: c.largura * ESCALA_RECORTE, height: altura }}
        />
        {corta ? (
          // Um cartão comprido (o texto da regra) acaba num esbatido.
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 140,
              background: `linear-gradient(rgba(255,251,245,0), ${COR.papel} 85%)`,
            }}
          />
        ) : null}
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme }}>
      <AbsoluteFill
        style={{
          padding: '84px 0 0',
          alignItems: 'center',
          transform: `scale(${zoom})`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={aparece(0)}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 2.5,
                textTransform: 'uppercase',
                color: COR.terracota,
              }}
            >
              {recortes.antes}
            </div>
            <div
              style={{
                fontFamily: TITULO,
                fontWeight: 800,
                fontSize: 52,
                letterSpacing: -1,
                color: COR.tinta,
                marginTop: 6,
              }}
            >
              {recortes.titulo}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {recortes.itens.map((n, i) => cartao(n, i + 1))}
            </div>
            {recortes.lado
              ? cartao(recortes.lado, recortes.itens.length + 1, ALTURA_COLUNA)
              : null}
          </div>
        </div>
      </AbsoluteFill>
      {selo ? <Selo esquerda={false} /> : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// A marca
// ---------------------------------------------------------------------------

export function Marca({ cor, tamanho = 44 }: { cor: string; tamanho?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tamanho * 0.18,
        fontFamily: TITULO,
        fontWeight: 800,
        fontSize: tamanho,
        color: cor,
        letterSpacing: -0.5,
      }}
    >
      Tou, Câmara
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: tamanho * 1.05,
          height: tamanho * 1.05,
          borderRadius: `${tamanho * 0.52}px ${tamanho * 0.52}px ${tamanho * 0.52}px ${tamanho * 0.1}px`,
          background: COR.terracota,
          color: '#fff',
          fontSize: tamanho * 0.72,
        }}
      >
        ?
      </span>
    </div>
  );
}
