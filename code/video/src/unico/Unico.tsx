import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { COR, TEXTO, TITULO } from '../marca';
import type { Dados } from '../tipos';
import { EcraRecortes, Marca, Painel } from '../pecas';
import { EcraCaptura, Moldura, Selo, SmsConteudo } from '../visuais';
import {
  AVALIACAO,
  CREDITO_MUSICA,
  type Fundo,
  type Pedaco,
  type Plano,
  type Rotulo,
  type Toma,
  linhaUnica,
} from './guiao';
import { MUSICA, TEMPO_F, tempo } from './ritmo';

/*
 * O vídeo único: sem voz, a música manda. Cada toma entra com um pequeno
 * "soco" de escala no tempo forte, o texto entra aos tempos, e as mudanças
 * de secção levam um varrimento terracota ou um clarão.
 */

export type PropsUnico = { tomas: Toma[]; dados: Dados };

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const saida = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Terracota mais clara, para o destaque sobre o azul-tinta. */
const TERRACOTA_CLARA = '#E2774F';

const FUNDOS: Record<Fundo, { fundo: string; texto: string; destaque: string; secundario: string }> = {
  tinta: { fundo: COR.tinta, texto: COR.papel, destaque: TERRACOTA_CLARA, secundario: '#C9D1DB' },
  creme: { fundo: COR.creme, texto: COR.tinta, destaque: COR.terracota, secundario: COR.tinta2 },
  terracota: { fundo: COR.terracota, texto: '#FFFFFF', destaque: COR.tinta, secundario: 'rgba(255,255,255,0.85)' },
};

export function Unico({ tomas, dados }: PropsUnico) {
  const { tomas: linha, total } = linhaUnica(tomas);
  return (
    <AbsoluteFill style={{ backgroundColor: COR.tinta, fontFamily: TEXTO }}>
      {linha.map(({ toma, de, duracao, desvio }) => (
        <Sequence key={toma.id} from={de + desvio} durationInFrames={duracao - desvio}>
          <VistaToma toma={toma} dados={dados} duracao={duracao - desvio} />
        </Sequence>
      ))}
      {linha.map(({ toma, de }) =>
        toma.entrada === 'varrer' ? (
          <Sequence key={`v-${toma.id}`} from={Math.max(0, de - 8)} durationInFrames={18}>
            <Varrer />
          </Sequence>
        ) : toma.entrada === 'clarao' ? (
          <Sequence key={`c-${toma.id}`} from={de} durationInFrames={10}>
            <Clarao />
          </Sequence>
        ) : null,
      )}
      <Progresso total={total} />
      <Audio
        src={staticFile(MUSICA)}
        volume={(f) => interpolate(f, [0, 4, total - 45, total], [0, 1, 1, 0], clamp)}
      />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Peças de movimento
// ---------------------------------------------------------------------------

function useMola(atraso = 0, config = { damping: 13, stiffness: 170, mass: 0.6 }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { f, s: spring({ frame: f - atraso, fps, config }) };
}

/** Entra de baixo (ou da esquerda) com uma mola, no frame `atraso`. */
function Entra({
  atraso = 0,
  lado = 'baixo',
  distancia = 46,
  style,
  children,
}: {
  atraso?: number;
  lado?: 'baixo' | 'esquerda';
  distancia?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { f, s } = useMola(atraso);
  const d = (1 - s) * distancia;
  return (
    <div
      style={{
        ...style,
        opacity: f < atraso ? 0 : Math.min(1, s * 1.8),
        transform: lado === 'baixo' ? `translateY(${d}px)` : `translateX(${-d * 1.6}px)`,
      }}
    >
      {children}
    </div>
  );
}

/** O "soco" de cada corte: começa um pouco mais perto e assenta. */
function Soco({ children }: { children: ReactNode }) {
  const { s } = useMola(0, { damping: 18, stiffness: 190, mass: 0.7 });
  return <AbsoluteFill style={{ transform: `scale(${1.06 - 0.06 * s})` }}>{children}</AbsoluteFill>;
}

/** Um pequeno salto em cada tempo (para o que fica parado no ecrã). */
function pulso(f: number, forca = 0.03) {
  const local = f % TEMPO_F;
  return interpolate(local, [0, 7], [1 + forca, 1], clamp);
}

function Varrer() {
  const f = useCurrentFrame();
  const x =
    f <= 8
      ? interpolate(f, [0, 8], [-120, 0], { ...clamp, easing: saida })
      : interpolate(f, [8, 17], [0, 120], { ...clamp, easing: Easing.in(Easing.cubic) });
  return (
    <AbsoluteFill
      style={{
        transform: `translateX(${x}%) skewX(-8deg)`,
        background: COR.terracota,
        alignItems: 'center',
        justifyContent: 'center',
        width: '120%',
        left: '-10%',
      }}
    >
      <Bolha tamanho={200} cor="#FFFFFF" texto={COR.terracota} />
    </AbsoluteFill>
  );
}

function Clarao() {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: '#FFFFFF', opacity: interpolate(f, [0, 9], [0.85, 0], clamp) }} />;
}

function Progresso({ total }: { total: number }) {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 6,
        width: `${(f / total) * 100}%`,
        background: COR.terracota,
      }}
    />
  );
}

/** O balão "?" da marca. */
function Bolha({ tamanho, cor = COR.terracota, texto = '#FFFFFF' }: { tamanho: number; cor?: string; texto?: string }) {
  return (
    <div
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: `${tamanho / 2}px ${tamanho / 2}px ${tamanho / 2}px ${tamanho * 0.1}px`,
        background: cor,
        color: texto,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: TITULO,
        fontWeight: 800,
        fontSize: tamanho * 0.68,
      }}
    >
      ?
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uma toma
// ---------------------------------------------------------------------------

const COM_TELEFONE = new Set<Plano['tipo']>(['telemovel', 'sms', 'chamada']);

function VistaToma({ toma, dados, duracao }: { toma: Toma; dados: Dados; duracao: number }) {
  const p = toma.plano;
  // A página desenha o próprio selo (desvia-se do que está em foco).
  const seloGlobal = toma.selo && p.tipo !== 'pagina' && p.tipo !== 'recortes';
  return (
    <AbsoluteFill>
      <Soco>
        <Conteudo toma={toma} dados={dados} duracao={duracao} />
      </Soco>
      {toma.rotulo && !COM_TELEFONE.has(p.tipo) ? <RotuloCartao rotulo={toma.rotulo} /> : null}
      {seloGlobal ? <Selo esquerda={false} /> : null}
      {toma.simulada ? <Simulada /> : null}
    </AbsoluteFill>
  );
}

function Conteudo({ toma, dados, duracao }: { toma: Toma; dados: Dados; duracao: number }) {
  const p = toma.plano;
  switch (p.tipo) {
    case 'palavras':
      return <Palavras linhas={p.linhas} fundo={p.fundo} pequeno={p.pequeno} />;
    case 'marca':
      return <Abertura sub={p.sub} />;
    case 'pagina':
      return (
        <Painel
          plano={{
            tipo: 'painel',
            captura: p.captura,
            de: p.de,
            para: p.para,
            foco: p.foco,
            selo: p.seloEsquerda ? 'esquerda' : undefined,
          }}
          dados={dados}
          duracao={duracao}
          selo={!!toma.selo}
        />
      );
    case 'telemovel':
      return (
        <ComTelefone rotulo={toma.rotulo}>
          <Rolar dados={dados} captura={p.captura} de={p.de} para={p.para} duracao={duracao} />
        </ComTelefone>
      );
    case 'sms':
      return (
        <ComTelefone rotulo={toma.rotulo}>
          <SmsAgora mensagens={p.mensagens} />
        </ComTelefone>
      );
    case 'chamada':
      return <Chamada dados={dados} captura={p.captura} falas={p.falas} duracao={duracao} />;
    case 'numero':
      return <Numero dados={dados} plano={p} />;
    case 'avaliacao':
      return <Avaliacao />;
    case 'recortes':
      return (
        <EcraRecortes
          recortes={{ tipo: 'recortes', antes: p.antes, titulo: p.titulo, itens: p.itens, lado: p.lado }}
          dados={dados}
          duracao={duracao}
          selo={!!toma.selo}
        />
      );
    case 'mosaico':
      return <Mosaico dados={dados} tiles={p.tiles} titulo={p.titulo} />;
    case 'fecho':
      return <Fecho />;
    case 'experimente':
      return <Experimente duracao={duracao} />;
  }
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

function Palavras({ linhas, fundo, pequeno }: { linhas: Pedaco[][]; fundo: Fundo; pequeno?: boolean }) {
  const f = useCurrentFrame();
  const cores = FUNDOS[fundo];
  const tamanho = pequeno ? 92 : 150;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: cores.fundo,
        justifyContent: 'center',
        padding: '0 200px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: pequeno ? 18 : 6 }}>
        {linhas.map((linha, i) => (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', columnGap: tamanho * 0.26 }}>
            {linha.map((p) => (
              <Entra key={p.t} atraso={tempo(p.tempo) + 1} distancia={tamanho * 0.45}>
                <span
                  style={{
                    display: 'inline-block',
                    fontFamily: TITULO,
                    fontWeight: 800,
                    fontSize: tamanho,
                    lineHeight: 1.04,
                    letterSpacing: pequeno ? -2 : -5,
                    color: p.destaque ? cores.destaque : cores.texto,
                    transform: p.destaque ? `scale(${pulso(f, 0.025)})` : undefined,
                    transformOrigin: 'left center',
                  }}
                >
                  {p.t}
                </span>
              </Entra>
            ))}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function Abertura({ sub }: { sub: Pedaco[] }) {
  const f = useCurrentFrame();
  const { s } = useMola(0, { damping: 9, stiffness: 150, mass: 0.7 });
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme, alignItems: 'center', justifyContent: 'center', gap: 56 }}>
      <div style={{ transform: `scale(${(0.6 + 0.4 * s) * pulso(f, 0.015)})`, opacity: Math.min(1, s * 2) }}>
        <Marca cor={COR.tinta} tamanho={150} />
      </div>
      <div style={{ display: 'flex', gap: 30 }}>
        {sub.map((p, i) => (
          <Entra key={p.t} atraso={tempo(p.tempo)}>
            <span
              style={{
                fontSize: 54,
                fontWeight: 600,
                color: i === sub.length - 1 ? COR.terracota : COR.tinta2,
              }}
            >
              {p.t}
            </span>
          </Entra>
        ))}
      </div>
    </AbsoluteFill>
  );
}

/** O rótulo das páginas: um cartão azul-tinta que entra da esquerda. */
function RotuloCartao({ rotulo }: { rotulo: Rotulo }) {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        left: 60,
        ...(rotulo.cima ? { top: 110 } : { bottom: 64 }),
        maxWidth: 1180,
      }}
    >
      <Entra atraso={2} lado="esquerda" distancia={40}>
        <div
          style={{
            background: 'rgba(21, 38, 59, 0.95)',
            borderRadius: 28,
            padding: '26px 38px 30px',
            boxShadow: '0 18px 50px rgba(21,38,59,0.35)',
          }}
        >
          {rotulo.antes ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: 'uppercase',
                color: COR.terracotaSuave,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: TERRACOTA_CLARA,
                  transform: `scale(${pulso(f, 0.5)})`,
                }}
              />
              {rotulo.antes}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: TITULO,
              fontWeight: 800,
              fontSize: 62,
              lineHeight: 1.06,
              letterSpacing: -1.5,
              color: '#FFFFFF',
              textWrap: 'balance',
            }}
          >
            {rotulo.titulo}
          </div>
          {rotulo.texto ? (
            <div style={{ fontSize: 32, color: '#C9D1DB', marginTop: 10 }}>{rotulo.texto}</div>
          ) : null}
        </div>
      </Entra>
    </div>
  );
}

function Simulada() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          padding: '10px 22px',
          borderRadius: 999,
          background: COR.ambarSuave,
          border: `2px solid ${COR.ambar}`,
          color: COR.ambar,
          fontSize: 24,
          fontWeight: 700,
          boxShadow: '0 6px 18px rgba(21,38,59,0.12)',
        }}
      >
        Chamada simulada · o ecrã e as respostas da API são os verdadeiros
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O telemóvel
// ---------------------------------------------------------------------------

function ComTelefone({ rotulo, children }: { rotulo?: Rotulo; children: ReactNode }) {
  const { s } = useMola(0, { damping: 14, stiffness: 150, mass: 0.7 });
  const circulo = spring({ frame: useCurrentFrame(), fps: 30, config: { damping: 20, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 520 - 470,
          top: 540 - 470,
          width: 940,
          height: 940,
          borderRadius: 470,
          background: COR.terracotaSuave,
          transform: `scale(${0.7 + 0.3 * circulo})`,
        }}
      />
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 300, gap: 130 }}>
        <div
          style={{
            transform: `translateY(${(1 - s) * 140}px) rotate(${(1 - s) * -7}deg)`,
            opacity: Math.min(1, s * 2),
          }}
        >
          <Moldura>{children}</Moldura>
        </div>
        {rotulo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
            {rotulo.antes ? (
              <Entra atraso={3}>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    letterSpacing: 3,
                    textTransform: 'uppercase',
                    color: COR.terracota,
                  }}
                >
                  {rotulo.antes}
                </div>
              </Entra>
            ) : null}
            <Entra atraso={5}>
              <div
                style={{
                  fontFamily: TITULO,
                  fontWeight: 800,
                  fontSize: 100,
                  lineHeight: 1.0,
                  letterSpacing: -3,
                  color: COR.tinta,
                  textWrap: 'balance',
                }}
              >
                {rotulo.titulo}
              </div>
            </Entra>
            {rotulo.texto ? (
              <Entra atraso={tempo(1)}>
                <div style={{ fontSize: 44, lineHeight: 1.3, color: COR.tinta2 }}>{rotulo.texto}</div>
              </Entra>
            ) : null}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Rolar({
  dados,
  captura,
  de = 0,
  para,
  duracao,
}: {
  dados: Dados;
  captura: string;
  de?: number;
  para?: number;
  duracao: number;
}) {
  const f = useCurrentFrame();
  const c = dados.capturas[captura];
  const maxY = c ? Math.max(0, c.altura - 844) : 0;
  const y = interpolate(f, [duracao * 0.15, duracao * 0.9], [Math.min(de, maxY), Math.min(para ?? de, maxY)], {
    ...clamp,
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  });
  return <EcraCaptura dados={dados} captura={captura} y={y} />;
}

function SmsAgora({ mensagens }: { mensagens: string[] }) {
  const f = useCurrentFrame();
  return <SmsConteudo mensagens={mensagens} f={f} />;
}

function Chamada({
  dados,
  captura,
  falas,
  duracao,
}: {
  dados: Dados;
  captura: string;
  falas: { quem: 'agente' | 'municipe'; texto: string }[];
  duracao: number;
}) {
  const { s } = useMola(0, { damping: 14, stiffness: 150, mass: 0.7 });
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme, overflow: 'hidden' }}>
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 200, gap: 100 }}>
        <div style={{ transform: `translateY(${(1 - s) * 140}px)`, opacity: Math.min(1, s * 2) }}>
          <Moldura>
            <EcraCaptura dados={dados} captura={captura} />
          </Moldura>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: 1060 }}>
          {falas.map((fala, i) => {
            const agente = fala.quem === 'agente';
            return (
              <Entra key={i} atraso={i === 0 ? 3 : Math.round(duracao * 0.3)}>
                <div
                  style={{
                    marginLeft: agente ? 0 : 120,
                    background: agente ? COR.tinta : COR.papel,
                    color: agente ? COR.papel : COR.tinta,
                    border: agente ? 'none' : `2px solid ${COR.linha}`,
                    borderRadius: 30,
                    padding: '22px 30px',
                    boxShadow: '0 14px 36px rgba(21,38,59,0.16)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                      color: agente ? COR.terracotaSuave : COR.terracota,
                      marginBottom: 8,
                    }}
                  >
                    {agente ? 'Assistente' : 'Munícipe'}
                  </div>
                  <div style={{ fontSize: 40, lineHeight: 1.28 }}>{fala.texto}</div>
                </div>
              </Entra>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

function Numero({ dados, plano }: { dados: Dados; plano: Extract<Plano, { tipo: 'numero' }> }) {
  const f = useCurrentFrame();
  const cores = FUNDOS[plano.fundo];
  const c = dados.capturas[plano.captura];
  const r = plano.fundoRect;
  const escala = 1920 / r.w;
  const valor = Math.round(
    interpolate(f, [2, tempo(1.6)], [0, plano.valor], { ...clamp, easing: Easing.out(Easing.cubic) }),
  );
  const destaque = plano.fundo === 'creme' ? COR.terracota : cores.texto;
  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, overflow: 'hidden', justifyContent: 'center' }}>
      {c ? (
        <Img
          src={staticFile(`capturas/${c.ficheiro}`)}
          style={{
            position: 'absolute',
            left: -r.x * escala,
            top: -r.y * escala,
            width: c.largura * escala,
            height: c.altura * escala,
            opacity: plano.fundo === 'creme' ? 0.16 : 0.1,
            filter: 'grayscale(1) blur(3px)',
            transform: `scale(${interpolate(f, [0, 60], [1.04, 1.0], clamp)})`,
          }}
        />
      ) : null}
      <div style={{ position: 'relative', padding: '0 200px' }}>
        <div
          style={{
            fontFamily: TITULO,
            fontWeight: 800,
            fontSize: 340,
            lineHeight: 0.9,
            letterSpacing: -12,
            color: destaque,
            transform: `scale(${pulso(f, 0.02)})`,
            transformOrigin: 'left center',
          }}
        >
          {valor}
          {plano.sufixo ? <span style={{ fontSize: 220, letterSpacing: -6 }}>{plano.sufixo}</span> : null}
        </div>
        <Entra atraso={tempo(1)}>
          <div style={{ fontSize: 68, fontWeight: 600, color: cores.texto, marginTop: 18, letterSpacing: -1 }}>
            {plano.texto}
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
}

function Avaliacao() {
  const f = useCurrentFrame();
  const LARGURA_BARRA = 960;
  const barra = (valor: number, atraso: number) =>
    interpolate(f, [atraso, atraso + tempo(2)], [0, valor], { ...clamp, easing: Easing.out(Easing.cubic) });
  const tou = barra(AVALIACAO.tou, tempo(2));
  const site = barra(AVALIACAO.site, tempo(3));
  const linha = (rotulo: string, v: number, cor: string, atraso: number, forte: boolean) => (
    <Entra atraso={atraso}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <div style={{ width: 500, fontSize: 36, fontWeight: forte ? 700 : 500, color: forte ? '#FFFFFF' : '#C9D1DB' }}>
          {rotulo}
        </div>
        <div style={{ width: LARGURA_BARRA, height: 64, borderRadius: 32, background: 'rgba(255,255,255,0.08)' }}>
          <div
            style={{
              width: (v / AVALIACAO.perguntas) * LARGURA_BARRA,
              height: 64,
              borderRadius: 32,
              background: cor,
            }}
          />
        </div>
        <div style={{ fontFamily: TITULO, fontWeight: 800, fontSize: 84, color: forte ? '#FFFFFF' : '#C9D1DB', width: 170 }}>
          {Math.round(v)}
        </div>
      </div>
    </Entra>
  );
  return (
    <AbsoluteFill style={{ backgroundColor: COR.tinta, justifyContent: 'center', padding: '0 150px', gap: 46 }}>
      <Entra atraso={1}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: COR.terracotaSuave }}>
          Testado às claras · {AVALIACAO.perguntas} perguntas de teste
        </div>
      </Entra>
      <Entra atraso={tempo(1)}>
        <div
          style={{
            fontFamily: TITULO,
            fontWeight: 800,
            fontSize: 76,
            lineHeight: 1.05,
            letterSpacing: -2,
            color: '#FFFFFF',
            maxWidth: 1500,
          }}
        >
          Em quantas o munícipe sai a saber o que fazer?
        </div>
      </Entra>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
        {linha('Tou, Câmara?', tou, COR.verde, tempo(2), true)}
        {linha('O assistente atual do site', site, '#6B7A8C', tempo(3), false)}
      </div>
      <Entra atraso={tempo(5)}>
        <div style={{ fontSize: 30, lineHeight: 1.4, color: '#C9D1DB' }}>
          Resposta certa revista por uma pessoa · dois juízes automáticos, às cegas · quando responde,{' '}
          {AVALIACAO.certas}% certas ou quase
        </div>
      </Entra>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Mosaico e fecho
// ---------------------------------------------------------------------------

function Mosaico({
  dados,
  tiles,
  titulo,
}: {
  dados: Dados;
  tiles: { captura: string; rect: { x: number; y: number; w: number; h: number } }[];
  titulo: string;
}) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = 520;
  const A = Math.round((L * 9) / 16);
  const zoom = interpolate(f, [tempo(3), tempo(8)], [1, 1.08], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme, alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(3, ${L}px)`,
          gap: 34,
          transform: `scale(${zoom}) rotate(-2deg)`,
        }}
      >
        {tiles.map((t, i) => {
          const c = dados.capturas[t.captura];
          const s = spring({ frame: f - tempo(i * 0.5), fps, config: { damping: 12, stiffness: 160, mass: 0.6 } });
          const escala = L / t.rect.w;
          const aceso = Math.floor(f / TEMPO_F) % tiles.length === i && f > tempo(4);
          return (
            <div
              key={t.captura}
              style={{
                position: 'relative',
                width: L,
                height: A,
                borderRadius: 18,
                overflow: 'hidden',
                background: COR.papel,
                border: `3px solid ${aceso ? COR.terracota : COR.linha}`,
                boxShadow: '0 16px 40px rgba(21,38,59,0.18)',
                opacity: f < tempo(i * 0.5) ? 0 : Math.min(1, s * 2),
                transform: `scale(${0.6 + 0.4 * s})`,
              }}
            >
              {c ? (
                <Img
                  src={staticFile(`capturas/${c.ficheiro}`)}
                  style={{
                    position: 'absolute',
                    left: -t.rect.x * escala,
                    top: -t.rect.y * escala,
                    width: c.largura * escala,
                    height: c.altura * escala,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Entra atraso={tempo(3.5)}>
          <div
            style={{
              background: COR.tinta,
              color: '#FFFFFF',
              borderRadius: 34,
              padding: '28px 56px',
              fontFamily: TITULO,
              fontWeight: 800,
              fontSize: 96,
              letterSpacing: -3,
              boxShadow: '0 24px 60px rgba(21,38,59,0.35)',
              transform: `scale(${pulso(f, 0.02)})`,
            }}
          >
            {titulo}
          </div>
        </Entra>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Fecho() {
  return (
    <AbsoluteFill style={{ backgroundColor: COR.tinta, justifyContent: 'center', padding: '0 200px', gap: 40 }}>
      <Entra atraso={2}>
        <Marca cor={COR.papel} tamanho={64} />
      </Entra>
      <Entra atraso={tempo(1)}>
        <div
          style={{
            fontFamily: TITULO,
            fontWeight: 800,
            fontSize: 120,
            lineHeight: 1.0,
            letterSpacing: -4,
            color: '#FFFFFF',
            maxWidth: 1450,
          }}
        >
          A câmara inteira, numa só plataforma.
        </div>
      </Entra>
      <Entra atraso={tempo(3)}>
        <div style={{ fontSize: 48, color: '#C9D1DB' }}>Uma porta para o munícipe. Um sistema para a câmara.</div>
      </Entra>
      <Entra atraso={tempo(6)}>
        <div
          style={{
            display: 'inline-block',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: COR.terracotaSuave,
          }}
        >
          Hack4Guimarães 2035 · Falar com a câmara sem burocracia
        </div>
      </Entra>
    </AbsoluteFill>
  );
}

function Experimente({ duracao }: { duracao: number }) {
  const f = useCurrentFrame();
  const escurece = interpolate(f, [duracao - 40, duracao - 4], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: COR.creme }}>
      <AbsoluteFill style={{ justifyContent: 'center', padding: '0 200px', gap: 30 }}>
        <Entra atraso={1}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <Bolha tamanho={72} />
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: COR.terracota }}>
              Experimente
            </div>
          </div>
        </Entra>
        <Entra atraso={tempo(1)}>
          <div
            style={{
              fontFamily: TITULO,
              fontWeight: 800,
              fontSize: 132,
              letterSpacing: -5,
              color: COR.tinta,
              transform: `scale(${pulso(f, 0.012)})`,
              transformOrigin: 'left center',
            }}
          >
            toucamara.descortina.pt
          </div>
        </Entra>
        <Entra atraso={tempo(2)}>
          <div style={{ fontSize: 46, color: COR.tinta2 }}>Ligue do browser, escreva no chat ou abra o painel da câmara.</div>
        </Entra>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 200, right: 200, bottom: 70 }}>
        <Entra atraso={tempo(4)}>
          <div style={{ fontSize: 24, lineHeight: 1.6, color: COR.tinta2 }}>
            Pessoas, conversas e processos do painel são dados de demonstração; as chamadas do vídeo são simuladas, com
            as respostas verdadeiras da API.
            <br />
            {CREDITO_MUSICA}
          </div>
        </Entra>
      </div>
      <AbsoluteFill style={{ background: COR.tinta, opacity: escurece }} />
    </AbsoluteFill>
  );
}
