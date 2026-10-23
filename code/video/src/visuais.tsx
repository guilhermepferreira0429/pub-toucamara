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
import type { Capa, Chamada, Dados, Sms, Telemovel } from './tipos';

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

function TextoAoLado({ titulo, texto, f }: { titulo?: string; texto?: string; f: number }) {
  if (!titulo && !texto) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 820 }}>
      {titulo ? (
        <div
          style={{
            ...aparece(f, 6),
            fontFamily: TITULO,
            fontWeight: 800,
            fontSize: 72,
            lineHeight: 1.05,
            letterSpacing: -1.5,
            color: COR.tinta,
            textWrap: 'balance',
          }}
        >
          {titulo}
        </div>
      ) : null}
      {texto ? (
        <div style={{ ...aparece(f, 14), fontSize: 36, lineHeight: 1.35, color: COR.tinta2 }}>{texto}</div>
      ) : null}
    </div>
  );
}

export function EcraTelemovel({
  visual,
  dados,
  duracao,
  selo,
}: {
  visual: Telemovel;
  dados: Dados;
  duracao: number;
  selo: boolean;
}) {
  const f = useCurrentFrame();
  const c = dados.capturas[visual.captura];
  const maxY = c ? Math.max(0, c.altura - 844) : 0;
  const y = interpolate(
    f,
    [duracao * 0.2, duracao * 0.85],
    [Math.min(visual.de ?? 0, maxY), Math.min(visual.para ?? visual.de ?? 0, maxY)],
    { ...clamp, easing: suave },
  );
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme, fontFamily: TEXTO }}>
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', gap: 110, paddingLeft: 250 }}>
        <div style={aparece(f, 0)}>
          <Moldura>
            <EcraCaptura dados={dados} captura={visual.captura} y={y} />
          </Moldura>
        </div>
        <TextoAoLado titulo={visual.titulo} texto={visual.texto} f={f} />
      </AbsoluteFill>
      {selo ? <Selo esquerda={false} /> : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// SMS recebidos
// ---------------------------------------------------------------------------

/** O remetente dos SMS da câmara (SMS_REMETENTE). */
const REMETENTE = 'TouCamara';

export function EcraSms({
  visual,
  duracao,
  selo,
}: {
  visual: Sms;
  duracao: number;
  selo: boolean;
}) {
  const f = useCurrentFrame();
  void duracao;
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme, fontFamily: TEXTO }}>
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', gap: 110, paddingLeft: 250 }}>
        <div style={aparece(f, 0)}>
          <Moldura>
            <SmsConteudo mensagens={visual.mensagens} f={f} />
          </Moldura>
        </div>
        <TextoAoLado titulo={visual.titulo} texto={visual.texto} f={f} />
      </AbsoluteFill>
      {selo ? <Selo esquerda={false} /> : null}
    </AbsoluteFill>
  );
}

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

// ---------------------------------------------------------------------------
// A chamada: o ecrã verdadeiro e a conversa escrita ao lado
// ---------------------------------------------------------------------------

/** Quantas falas cabem na coluna (as mais recentes). */
const FALAS_VISIVEIS = 4;

export function EcraChamada({
  visual,
  dados,
  selo,
}: {
  visual: Chamada;
  dados: Dados;
  selo: boolean;
}) {
  const f = useCurrentFrame();
  const inicio = Math.max(0, visual.atual - FALAS_VISIVEIS + 1);
  const vistas = visual.falas.slice(inicio, visual.atual + 1);
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme, fontFamily: TEXTO }}>
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', gap: 90, paddingLeft: 170 }}>
        <Moldura>
          <EcraCaptura dados={dados} captura={visual.captura} />
        </Moldura>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 1060 }}>
          <div
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 18px',
              borderRadius: 999,
              border: `2px solid ${COR.ambar}`,
              background: COR.ambarSuave,
              color: COR.ambar,
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            Chamada simulada · o ecrã e as respostas da API são os verdadeiros
          </div>
          {vistas.map((fala, i) => {
            const atual = inicio + i === visual.atual;
            const agente = fala.quem === 'agente';
            return (
              <div
                key={inicio + i}
                style={{
                  ...(atual ? aparece(f, 2) : {}),
                  alignSelf: agente ? 'flex-start' : 'flex-end',
                  maxWidth: 900,
                  opacity: atual ? 1 : 0.5,
                  background: agente ? COR.tinta : COR.papel,
                  color: agente ? COR.papel : COR.tinta,
                  border: agente ? 'none' : `2px solid ${COR.linha}`,
                  borderRadius: 26,
                  padding: '18px 26px',
                  boxShadow: atual ? '0 12px 30px rgba(21,38,59,0.14)' : 'none',
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    color: agente ? COR.terracotaSuave : COR.terracota,
                    marginBottom: 6,
                  }}
                >
                  {agente ? 'Assistente' : 'Munícipe'}
                </div>
                <div style={{ fontSize: atual ? 32 : 26, lineHeight: 1.32 }}>{fala.texto}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {selo ? <Selo esquerda={false} /> : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Capas (o cartão de abertura de cada vídeo, com o desenho da capa)
// ---------------------------------------------------------------------------

export function EcraCapa({
  capa,
  dados,
  duracao,
}: {
  capa: Capa;
  dados: Dados;
  duracao: number;
}) {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, duracao], [1, 1.02], clamp);
  if (capa.video === 'municipe') {
    return (
      <AbsoluteFill style={{ flexDirection: 'row', fontFamily: TEXTO }}>
        <div
          style={{
            width: 960,
            background: COR.terracota,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 100px 0 110px',
            gap: 34,
          }}
        >
          <div
            style={{
              ...aparece(f, 0),
              fontFamily: TITULO,
              fontWeight: 800,
              fontSize: 104,
              lineHeight: 1.0,
              letterSpacing: -3,
              color: '#FFFFFF',
              textWrap: 'balance',
            }}
          >
            {capa.titulo}
          </div>
          <div style={{ ...aparece(f, 10), fontSize: 36, lineHeight: 1.4, color: 'rgba(255,255,255,0.9)' }}>
            {capa.sub}
          </div>
        </div>
        <div
          style={{
            width: 960,
            background: COR.creme,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <div style={{ ...aparece(f, 4), transform: `scale(${0.98 * zoom})` }}>
            <Moldura>
              <EcraCaptura dados={dados} captura={capa.captura} />
            </Moldura>
          </div>
          <Selo esquerda={false} />
        </div>
      </AbsoluteFill>
    );
  }
  // Painel: fundo azul, o título à esquerda e o painel num monitor.
  const c = dados.capturas[capa.captura];
  const r = capa.recorte ?? { x: 0, y: 0, w: 1920, h: 1080 };
  const LARG = 960;
  const ALT = Math.round((LARG * r.h) / r.w);
  const escala = LARG / r.w;
  return (
    <AbsoluteFill style={{ background: COR.tinta, fontFamily: TEXTO, flexDirection: 'row', alignItems: 'center' }}>
      <div style={{ width: 760, padding: '0 0 0 120px', display: 'flex', flexDirection: 'column', gap: 34 }}>
        <div
          style={{
            ...aparece(f, 0),
            fontFamily: TITULO,
            fontWeight: 800,
            fontSize: 132,
            lineHeight: 0.98,
            letterSpacing: -4,
            color: '#FFFFFF',
          }}
        >
          {capa.titulo}
        </div>
        <div style={{ ...aparece(f, 10), fontSize: 38, lineHeight: 1.4, color: '#E4E9EF', maxWidth: 560 }}>
          {capa.sub}
        </div>
      </div>
      <div
        style={{
          ...aparece(f, 4),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transform: `scale(${zoom})`,
        }}
      >
        <div
          style={{
            padding: 16,
            borderRadius: 30,
            background: '#24364D',
            boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ position: 'relative', width: LARG, height: ALT, borderRadius: 16, overflow: 'hidden', background: COR.creme }}>
            {c ? (
              <Img
                src={staticFile(`capturas/${c.ficheiro}`)}
                style={{
                  position: 'absolute',
                  left: -r.x * escala,
                  top: -r.y * escala,
                  width: c.largura * escala,
                  height: c.altura * escala,
                }}
              />
            ) : null}
          </div>
        </div>
        <div style={{ width: 130, height: 64, background: '#24364D' }} />
        <div style={{ width: 300, height: 18, borderRadius: 9, background: '#33465E' }} />
      </div>
      <Selo esquerda={false} />
    </AbsoluteFill>
  );
}
