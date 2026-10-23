import { cruza, planosProibidos } from '../camara';
import type { Dados, Enquadramento, Quem, Retangulo } from '../tipos';
import { frameDoCompasso, TOTAL_F } from './ritmo';

/*
 * O vídeo único (TouCamara): sem voz, com música, cortes nos tempos fortes.
 * Primeiro o munícipe (uma renovação, do aviso à licença), depois o lado da
 * câmara, a prova (a avaliação) e o fecho. Cada toma dura um número de
 * compassos; a soma dá os 64 compassos da música.
 *
 * As regras do vídeo do painel continuam: o selo "Dados de demonstração"
 * em tudo o que vem da demonstração, a chamada diz que é simulada, e a
 * câmara nunca passa pelas zonas proibidas das capturas.
 */

export type Fundo = 'tinta' | 'creme' | 'terracota';

/** Um pedaço de texto que entra num tempo (contado desde o início da toma). */
export interface Pedaco {
  t: string;
  tempo: number;
  destaque?: boolean;
}

export type Plano =
  | { tipo: 'palavras'; fundo: Fundo; linhas: Pedaco[][]; pequeno?: boolean }
  | { tipo: 'marca'; sub: Pedaco[] }
  | {
      tipo: 'pagina';
      captura: string;
      de: Enquadramento;
      para?: Enquadramento;
      foco?: string | Retangulo;
      seloEsquerda?: boolean;
    }
  | { tipo: 'telemovel'; captura: string; de?: number; para?: number }
  | { tipo: 'sms'; mensagens: string[] }
  | { tipo: 'chamada'; captura: string; falas: { quem: Quem; texto: string }[] }
  | { tipo: 'numero'; captura: string; fundoRect: Retangulo; valor: number; sufixo?: string; texto: string; fundo: Fundo }
  | { tipo: 'avaliacao' }
  | { tipo: 'recortes'; antes: string; titulo: string; itens: string[]; lado?: string }
  | { tipo: 'mosaico'; tiles: { captura: string; rect: Retangulo }[]; titulo: string }
  | { tipo: 'fecho' }
  | { tipo: 'experimente' };

export interface Rotulo {
  antes?: string;
  titulo: string;
  texto?: string;
  /** Em cima, quando o que importa está no fundo do quadro. */
  cima?: boolean;
}

export interface Toma {
  id: string;
  compassos: number;
  plano: Plano;
  rotulo?: Rotulo;
  /** Selo "Dados de demonstração". */
  selo?: boolean;
  /** Pílula "Chamada simulada". */
  simulada?: boolean;
  entrada?: 'corte' | 'varrer' | 'clarao';
}

/** A avaliação final (ronda 5, docs/avaliacao/escala): chega para o munícipe? */
export const AVALIACAO = { perguntas: 180, tou: 113, site: 15, certas: '81.1', graves: 5 };

export const CREDITO_MUSICA =
  'Música: “Voxel Revolution”, Kevin MacLeod (incompetech.com) · Creative Commons BY 4.0';

/** Pedaços que entram um por tempo, a partir do tempo `de`. */
function porTempo(textos: string[], de = 0, passo = 1): Pedaco[] {
  return textos.map((t, i) => ({ t, tempo: de + i * passo }));
}

/** A primeira frase (ou as n primeiras) de uma fala. */
function frases(texto: string, n = 1): string {
  const partes = texto.match(/[^.!?]+[.!?]+/g) ?? [texto];
  return partes.slice(0, n).join('').trim();
}

/** Dias entre a captura e o fim da licença (a renovação de teste acaba daqui a 10). */
function diasAte(fim: string, agora: string): number {
  const dia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((dia(fim) - dia(agora)) / 86_400_000);
}

export function guiaoUnico(d: Dados): Toma[] {
  const m = d.municipe;
  if (!m) throw new Error('Falta o munícipe nas capturas: corre npm run capturar -- --video=painel,municipe.');
  const v = d.visao;
  const c = d.campanha;
  const fala = (n: number) => {
    const f = m.falas[n - 1];
    if (!f) throw new Error(`Falta a fala ${n} da renovação.`);
    return f;
  };
  // O ecrã do telemóvel no momento de cada fala (a última captura antes dela).
  const ecra = (n: number) =>
    m.falas.slice(0, n).reduce((cap, f) => f.captura ?? cap, 'municipe_chamada_01');

  const ecraInteiro: Retangulo = { x: 0, y: 0, w: 1920, h: 1080 };

  return [
    // ---------------------------------------------------------------- intro
    {
      id: 'abre',
      compassos: 2,
      plano: {
        tipo: 'palavras',
        fundo: 'tinta',
        linhas: [
          porTempo(['Falar', 'com a', 'câmara']),
          [
            { t: 'sem', tempo: 4 },
            { t: 'burocracia.', tempo: 5, destaque: true },
          ],
        ],
      },
    },
    {
      id: 'marca',
      compassos: 2,
      plano: {
        tipo: 'marca',
        sub: porTempo(['Telefone.', 'Chat.', 'SMS.', 'A qualquer hora.'], 2),
      },
    },
    {
      id: 'inicio',
      compassos: 2,
      plano: {
        tipo: 'pagina',
        captura: 'trailer_inicio',
        de: 'ecra',
        para: { rect: { x: 380, y: 120, w: 1240, h: 698 } },
      },
      rotulo: { antes: 'toucamara.descortina.pt', titulo: 'Uma porta para o munícipe.' },
    },
    {
      id: 'ligar',
      compassos: 2,
      plano: {
        tipo: 'pagina',
        captura: 'trailer_ligar',
        de: { rect: { x: 480, y: 0, w: 1440, h: 810 } },
        para: { rect: { x: 650, y: 60, w: 1100, h: 619 } },
      },
      rotulo: { antes: 'Sem instalar nada', titulo: 'Liga à câmara do browser.' },
    },

    // ------------------------------------------- 1.ª entrada: o munícipe
    {
      id: 'aviso',
      compassos: 2,
      entrada: 'varrer',
      selo: true,
      plano: { tipo: 'sms', mensagens: [m.sms.aviso ?? ''] },
      rotulo: { antes: '1 · O aviso', titulo: `A licença acaba daqui a ${diasAte(m.valida_ate, d.gerado_em)} dias.`, texto: 'A câmara avisa primeiro.' },
    },
    {
      id: 'chamada_a',
      compassos: 4,
      selo: true,
      simulada: true,
      plano: {
        tipo: 'chamada',
        captura: ecra(3),
        falas: [
          { quem: fala(2).quem, texto: frases(fala(2).texto, 3) },
          { quem: fala(3).quem, texto: frases(fala(3).texto, 1) },
        ],
      },
    },
    {
      id: 'chamada_b',
      compassos: 2,
      selo: true,
      simulada: true,
      plano: {
        tipo: 'chamada',
        captura: ecra(5),
        falas: [
          { quem: fala(4).quem, texto: frases(fala(4).texto, 1) },
          { quem: fala(5).quem, texto: frases(fala(5).texto, 2) },
        ],
      },
    },
    {
      id: 'pagamento',
      compassos: 2,
      selo: true,
      plano: { tipo: 'telemovel', captura: 'municipe_pagamento', de: 0, para: 220 },
      rotulo: { antes: '2 · O pagamento', titulo: 'Paga pelo link do SMS.', texto: 'Modo de teste: nada é cobrado.' },
    },
    {
      id: 'pago',
      compassos: 1,
      selo: true,
      plano: { tipo: 'telemovel', captura: 'municipe_pago' },
      rotulo: { titulo: 'Pago.', texto: 'Sem ir ao balcão.' },
    },
    {
      id: 'licenca',
      compassos: 2,
      selo: true,
      plano: { tipo: 'telemovel', captura: 'municipe_licenca', de: 0, para: 700 },
      rotulo: { antes: '3 · A licença', titulo: 'Emitida, com QR.', texto: 'Chega por SMS.' },
    },
    {
      id: 'licenca_painel',
      compassos: 3,
      selo: true,
      plano: {
        tipo: 'pagina',
        captura: 'municipe_licencas',
        de: { zona: 'cartao', margem: 200 },
        para: { zona: 'cartao', margem: 90 },
        foco: 'cartao',
      },
      rotulo: { antes: 'Do lado da câmara', titulo: 'Emitida pelas regras. Ninguém teve de lhe tocar.', cima: true },
    },

    // ------------------------------------------------ o lado da câmara
    // Factos do produto (os mesmos da página inicial), não números da
    // demonstração: 24 h, as 48 ferramentas do agente de entrada
    // (code/api/agente-voz) e as 90 funcionalidades de /funcionalidades.
    {
      id: 'sempre',
      compassos: 1,
      entrada: 'clarao',
      plano: { tipo: 'numero', captura: 'trailer_inicio', fundoRect: ecraInteiro, valor: 24, sufixo: ' h', texto: 'a atender, todos os dias', fundo: 'tinta' },
    },
    {
      id: 'acoes',
      compassos: 1,
      plano: { tipo: 'numero', captura: 'trailer_inicio', fundoRect: ecraInteiro, valor: 48, texto: 'ações que o assistente faz durante a chamada', fundo: 'terracota' },
    },
    {
      id: 'funcionalidades',
      compassos: 1,
      plano: { tipo: 'numero', captura: 'trailer_inicio', fundoRect: ecraInteiro, valor: 90, texto: 'funcionalidades, do atendimento à chefia', fundo: 'creme' },
    },
    {
      id: 'tratou',
      compassos: 2,
      selo: true,
      plano: {
        tipo: 'pagina',
        captura: 'visao',
        de: { rect: { x: v.requerimentos ? 270 : 612, y: 312, w: 1010, h: 568 } },
        para: { rect: { x: 870, y: 312, w: 1010, h: 568 } },
        foco: 'tratou',
      },
      rotulo: { antes: 'E não fica pela resposta', titulo: 'Regista ocorrências, consulta processos e marca atendimentos.', cima: true },
    },
    {
      id: 'ao_vivo',
      compassos: 2,
      selo: true,
      simulada: true,
      plano: { tipo: 'pagina', captura: 'chamada_04', de: { seguir: 'ultima', x: 630, w: 1270 } },
      rotulo: { antes: 'Ao vivo', titulo: 'O funcionário vê a chamada a acontecer.' },
    },
    {
      id: 'alerta',
      compassos: 1,
      selo: true,
      simulada: true,
      plano: {
        tipo: 'pagina',
        captura: d.falas.at(-1)?.captura ?? 'chamada_09',
        de: { seguir: 'ultima', x: 630, w: 1270 },
        para: { rect: { x: 1060, y: 120, w: 840, h: 473 } },
        foco: 'alerta',
      },
      rotulo: { antes: 'Pessoa vulnerável', titulo: 'Vive sozinha: a filha acompanha.' },
    },

    // ------------------------------------------------ a pausa a meio
    {
      id: 'passagem',
      compassos: 2,
      selo: true,
      plano: { tipo: 'pagina', captura: 'passagem', de: 'ecra', para: { zona: 'caso', margem: 140 }, foco: 'caso' },
      rotulo: { antes: 'Quando não sabe', titulo: 'Não inventa. Passa a um funcionário, com o caso resumido.' },
    },
    {
      id: 'entrada',
      compassos: 2,
      selo: true,
      plano: { tipo: 'pagina', captura: 'entrada', de: 'ecra', para: { rect: { x: 0, y: 0, w: 1700, h: 956 } } },
      rotulo: { antes: 'Entrada única', titulo: 'Telefone, chat, email e balcão, no mesmo sítio.' },
    },
    {
      id: 'calor',
      compassos: 2,
      selo: true,
      plano: { tipo: 'pagina', captura: 'campanha', de: 'ecra', para: { zona: 'contagens', margem: 80 }, foco: 'contagens' },
      rotulo: {
        antes: 'Onda de calor',
        titulo: `Ligou a ${c.total} pessoas. ${c.ajuda === 2 ? 'Duas' : c.ajuda} precisavam de ajuda.`,
      },
    },
    {
      id: 'relacao',
      compassos: 2,
      plano: {
        tipo: 'palavras',
        fundo: 'creme',
        pequeno: true,
        linhas: [
          [{ t: 'A relação com a câmara', tempo: 0 }],
          [{ t: 'não começa quando a pessoa liga,', tempo: 2 }],
          [{ t: 'nem acaba quando desliga.', tempo: 4, destaque: true }],
        ],
      },
    },

    // ------------------------------------------ 2.ª entrada: os processos
    {
      id: 'processo',
      compassos: 2,
      entrada: 'clarao',
      selo: true,
      plano: { tipo: 'pagina', captura: 'processo', de: 'ecra', para: { rect: { x: 230, y: 0, w: 1100, h: 619 } } },
      rotulo: { antes: 'Processos', titulo: 'O pedido chega à câmara organizado.' },
    },
    {
      id: 'apoio',
      compassos: 2,
      selo: true,
      plano: {
        tipo: 'recortes',
        antes: 'Ao técnico, já verificado',
        titulo: `${d.processo.numero} · Porta na cozinha`,
        itens: ['apoio_documentos', 'apoio_termo', 'apoio_pdm'],
        lado: 'apoio_regra',
      },
    },
    {
      id: 'ocorrencia',
      compassos: 2,
      selo: true,
      plano: { tipo: 'pagina', captura: 'ocorrencia', de: 'ecra', para: { zona: 'mapa', margem: 10 } },
      rotulo: {
        antes: 'Ocorrências',
        titulo: `${d.ocorrencia.avisos === 3 ? 'Três' : d.ocorrencia.avisos} avisos do mesmo buraco: uma ocorrência só.`,
      },
    },
    {
      id: 'fonte',
      compassos: 2,
      plano: {
        tipo: 'pagina',
        captura: 'trailer_ligar',
        de: { rect: { x: 560, y: 220, w: 1180, h: 664 } },
        para: { rect: { x: 650, y: 290, w: 1010, h: 568 } },
        foco: { x: 968, y: 406, w: 368, h: 328 },
      },
      rotulo: { antes: 'Com fonte', titulo: 'Cada resposta diz de onde vem.' },
    },

    // ------------------------------------------------ a prova
    {
      id: 'avaliacao',
      compassos: 3,
      entrada: 'clarao',
      plano: { tipo: 'avaliacao' },
    },
    {
      id: 'nao_sabe',
      compassos: 1,
      plano: {
        tipo: 'palavras',
        fundo: 'tinta',
        linhas: [porTempo(['Quando', 'não sabe,']), [{ t: 'diz que não sabe.', tempo: 2, destaque: true }]],
      },
    },
    {
      id: 'provas',
      compassos: 2,
      plano: {
        tipo: 'palavras',
        fundo: 'terracota',
        pequeno: true,
        linhas: [
          [{ t: 'Em produção', tempo: 0 }],
          [{ t: 'Mais de 1 600 testes', tempo: 1 }],
          [{ t: 'Acessível: WCAG 2.1 AA', tempo: 2 }],
          [{ t: `${AVALIACAO.perguntas} perguntas de teste`, tempo: 3 }],
        ],
      },
    },
    {
      id: 'mosaico',
      compassos: 2,
      selo: true,
      plano: {
        tipo: 'mosaico',
        titulo: 'A câmara inteira.',
        tiles: [
          { captura: 'visao', rect: { x: 250, y: 20, w: 1100, h: 619 } },
          { captura: d.falas.at(-1)?.captura ?? 'chamada_09', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
          { captura: 'entrada', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
          { captura: 'ocorrencia', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
          { captura: 'processo', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
          { captura: 'campanha', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
        ],
      },
    },

    // ------------------------------------------------------------ fecho
    { id: 'fecho', compassos: 4, entrada: 'varrer', plano: { tipo: 'fecho' } },
    // O último vai até ao fim da música.
    { id: 'experimente', compassos: 4, plano: { tipo: 'experimente' } },
  ];
}

export interface TomaTempo {
  toma: Toma;
  de: number;
  duracao: number;
  /** Frames até ao primeiro tempo forte (só a primeira toma, que começa antes da música). */
  desvio: number;
}

/** Onde começa e quanto dura cada toma (a primeira começa no frame 0). */
export function linhaUnica(tomas: Toma[]): { tomas: TomaTempo[]; total: number } {
  let k = 0;
  const r = tomas.map((toma, i) => {
    const de = i === 0 ? 0 : frameDoCompasso(k);
    const desvio = frameDoCompasso(k) - de;
    k += toma.compassos;
    const ate = i === tomas.length - 1 ? TOTAL_F : frameDoCompasso(k);
    return { toma, de, duracao: ate - de, desvio };
  });
  if (k !== 64) throw new Error(`O vídeo único tem ${k} compassos; a música tem 64.`);
  return { tomas: r, total: TOTAL_F };
}

/** As tomas que passam por zonas proibidas das capturas (o render recusa-se). */
export function proibidasUnico(tomas: Toma[], d: Dados): string[] {
  const paginas = tomas.flatMap((t) =>
    t.plano.tipo === 'pagina'
      ? [{ id: t.id, captura: t.plano.captura, de: t.plano.de, para: t.plano.para }]
      : [],
  );
  const recortes = tomas.flatMap((t) => {
    const p = t.plano;
    const rs =
      p.tipo === 'numero'
        ? [{ captura: p.captura, rect: p.fundoRect }]
        : p.tipo === 'mosaico'
          ? p.tiles
          : [];
    return rs.flatMap(({ captura, rect }) =>
      d.capturas[captura]?.proibidas?.some((z) => cruza(rect, z))
        ? [`${t.id} (${captura}): o recorte toca numa zona proibida`]
        : [],
    );
  });
  return [...planosProibidos(paginas, d.capturas), ...recortes];
}
