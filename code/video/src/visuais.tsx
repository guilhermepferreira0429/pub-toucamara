import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { COR, TEXTO, TITULO } from './marca';
import type { Dados } from './tipos';

const suave = Easing.bezier(0.45, 0, 0.2, 1);

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function aparece(f: number, atraso: number): CSSProperties {
  return {
    opacity: interpolate(f, [atraso, atraso + 12], [0, 1], clamp),
    transform: `translateY(${interpolate(f, [atraso, atraso + 16], [20, 0], { ...clamp, easing: suave })}px)`,
  };
}

// ---------------------------------------------------------------------------
// Selos
// ---------------------------------------------------------------------------

export function Selo({ esquerda, texto = 'Dados de demonstração' }: { esquerda: boolean; texto?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        ...(esquerda ? { left: 32 } : { right: 32 }),
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 20px',
        borderRadius: 999,
        background: COR.ambarSuave,
        border: `2px solid ${COR.ambar}`,
        color: COR.ambar,
        fontSize: 24,
        fontWeight: 600,
        fontFamily: TEXTO,
        boxShadow: '0 6px 18px rgba(21,38,59,0.12)',
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 6, background: COR.ambar }} />
      {texto}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O telemóvel (moldura) com uma captura de 390 px CSS de largura
// ---------------------------------------------------------------------------

const ECRA_ALTURA = 880;
const ECRA_LARGURA = Math.round((390 / 844) * ECRA_ALTURA);

export function Moldura({ children, escala = 1 }: { children: ReactNode; escala?: number }) {
  return (
    <div
      style={{
        width: ECRA_LARGURA + 28,
        height: ECRA_ALTURA + 28,
        borderRadius: 66,
        background: COR.tinta,
        padding: 14,
        boxShadow: '0 30px 70px rgba(21,38,59,0.28)',
        transform: `scale(${escala})`,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: ECRA_LARGURA,
          height: ECRA_ALTURA,
          borderRadius: 52,
          overflow: 'hidden',
          background: COR.creme,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function EcraCaptura({
  dados,
  captura,
  y = 0,
}: {
  dados: Dados;
  captura: string;
  y?: number;
}) {
  const c = dados.capturas[captura];
  if (!c) return <Falta texto={`Falta "${captura}"`} />;
  const escala = ECRA_LARGURA / c.largura;
  return (
    <Img
      src={staticFile(`capturas/${c.ficheiro}`)}
      style={{
        position: 'absolute',
        left: 0,
        top: -y * escala,
        width: c.largura * escala,
        height: c.altura * escala,
      }}
    />
  );
}

function Falta({ texto }: { texto: string }) {
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', color: COR.terracota, fontSize: 28 }}>
      {texto}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// SMS recebidos
// ---------------------------------------------------------------------------

/** O remetente dos SMS da câmara (SMS_REMETENTE). */
const REMETENTE = 'TouCamara';

/** O ecrã de mensagens do telemóvel, com os SMS da câmara (o último a entrar). */
export function SmsConteudo({ mensagens, f }: { mensagens: string[]; f: number }) {
  const n = mensagens.length;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#FFFFFF' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: '44px 0 18px',
          borderBottom: '1px solid #E6E6E6',
          background: '#F7F7F7',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            background: COR.terracota,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: TITULO,
            fontWeight: 800,
            fontSize: 30,
          }}
        >
          ?
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#111' }}>{REMETENTE}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 30,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '0 18px',
        }}
      >
        {mensagens.map((m, i) => {
          const ultima = i === n - 1;
          return (
            <div
              key={i}
              style={{
                ...(ultima ? aparece(f, 10) : {}),
                alignSelf: 'flex-start',
                maxWidth: '88%',
                background: '#E9E9EB',
                color: '#111',
                borderRadius: 22,
                borderBottomLeftRadius: 6,
                padding: '14px 18px',
                fontSize: 21,
                lineHeight: 1.35,
                overflowWrap: 'anywhere',
              }}
            >
              {m}
            </div>
          );
        })}
      </div>
    </div>
  );
}
