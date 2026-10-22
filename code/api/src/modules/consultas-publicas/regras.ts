/*
 * Consultas públicas: as regras sem BD (perguntas, prazo, respostas,
 * freguesias, agregação dos resultados, CSV anonimizado). Testadas à parte.
 */
import { z } from 'zod';
import { normalizarTexto } from '../ocorrencias/ocorrencias.regras.js';

export const ESTADOS_CONSULTA = ['rascunho', 'aberta', 'fechada'] as const;
export type EstadoConsulta = (typeof ESTADOS_CONSULTA)[number];

/** O que a pessoa vê: o estado com o prazo aplicado. */
export type Situacao =
  | 'rascunho'
  | 'agendada' // aberta pela câmara, mas o prazo ainda não começou
  | 'aberta'
  | 'terminou' // aberta pela câmara, mas o prazo já passou
  | 'fechada';

export const CANAIS = [
  'telefone',
  'chat',
  'ia',
  'pagina',
  'sms',
  'whatsapp',
] as const;
export type Canal = (typeof CANAIS)[number];

/** As opções que o painel propõe ao criar uma pergunta. */
export const OPCOES_SUGERIDAS = ['Concordo', 'Não concordo', 'Tenho dúvidas'];

export interface Opcao {
  id: string;
  texto: string;
}

export interface Pergunta {
  id: string;
  texto: string;
  opcoes: Opcao[];
}

export const esquemaPerguntaEntrada = z.object({
  texto: z.string().trim().min(5).max(200),
  opcoes: z.array(z.string().trim().min(1).max(60)).min(2).max(6),
});

/** Ids estáveis: p1, p2… e a opção pelo texto ("Não concordo" → nao_concordo). */
export function montarPerguntas(
  entrada: z.output<typeof esquemaPerguntaEntrada>[],
): Pergunta[] {
  return entrada.map((p, i) => {
    const vistos = new Set<string>();
    const opcoes = p.opcoes.map((texto, j) => {
      let id =
        normalizarTexto(texto).replace(/ /g, '_').slice(0, 40) || `o${j + 1}`;
      if (vistos.has(id)) id = `${id}_${j + 1}`;
      vistos.add(id);
      return { id, texto };
    });
    return { id: `p${i + 1}`, texto: p.texto, opcoes };
  });
}

/** Datas como AAAA-MM-DD (comparam-se como texto). */
export function situacao(
  c: { estado: EstadoConsulta; abre_em: string; fecha_em: string },
  hoje: string,
): Situacao {
  if (c.estado !== 'aberta') return c.estado;
  if (hoje < c.abre_em) return 'agendada';
  if (hoje > c.fecha_em) return 'terminou';
  return 'aberta';
}

/** Os resultados ficam públicos quando já não se pode participar. */
export function resultadosPublicos(s: Situacao): boolean {
  return s === 'fechada' || s === 'terminou';
}

/** Porque não se pode participar, dito à pessoa. */
export function motivoSemParticipar(
  s: Situacao,
  c: { abre_em: string; fecha_em: string; relatorio_em: string },
): string | null {
  switch (s) {
    case 'aberta':
      return null;
    case 'agendada':
      return `Esta consulta ainda não começou: pode participar a partir de ${diaDito(c.abre_em)}.`;
    case 'rascunho':
      return 'Esta consulta ainda não foi aberta pela câmara.';
    default:
      return `Esta consulta já fechou (o prazo acabou a ${diaDito(c.fecha_em)}). O relatório sai a ${diaDito(c.relatorio_em)}.`;
  }
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "2026-11-30" → "30 de novembro". */
export function diaDito(dia: string): string {
  const [, m, d] = dia.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

export interface RespostaDada {
  /** O id da pergunta (p1), o número (1) ou o texto. Sem ele: a próxima por responder. */
  pergunta?: string;
  /** O id ou o texto da opção. */
  opcao: string;
}

export type LeituraRespostas =
  | { ok: true; respostas: Record<string, string> }
  | {
      ok: false;
      em_falta: Pergunta[];
      invalidas: { pergunta: string; dito: string; opcoes: string[] }[];
    };

function acharPergunta(perguntas: Pergunta[], dito: string): Pergunta | null {
  const n = normalizarTexto(dito);
  return (
    perguntas.find((p) => p.id === dito.trim().toLowerCase()) ??
    perguntas.find((_, i) => n === String(i + 1)) ??
    perguntas.find((p) => normalizarTexto(p.texto) === n) ??
    null
  );
}

export function acharOpcao(p: Pergunta, dito: string): Opcao | null {
  const n = normalizarTexto(dito);
  if (!n) return null;
  const exata =
    p.opcoes.find((o) => o.id === dito.trim()) ??
    p.opcoes.find(
      (o) => normalizarTexto(o.texto) === n || o.id === n.replace(/ /g, '_'),
    );
  if (exata) return exata;
  // "concordo plenamente" → "Concordo"; só se houver uma opção que encaixe.
  const parecidas = p.opcoes.filter((o) => {
    const t = normalizarTexto(o.texto);
    return n.startsWith(`${t} `) || t.startsWith(`${n} `);
  });
  return parecidas.length === 1 ? parecidas[0] : null;
}

/**
 * Lê as respostas do agente ou da página. Todas as perguntas de escolha têm
 * de ter resposta; `anteriores` (a participação que a pessoa já tinha) conta
 * para as que não vierem agora.
 */
export function lerRespostas(
  perguntas: Pergunta[],
  dadas: RespostaDada[],
  anteriores: Record<string, string> = {},
): LeituraRespostas {
  const respostas: Record<string, string> = {};
  for (const p of perguntas) {
    const a = anteriores[p.id];
    if (a && p.opcoes.some((o) => o.id === a)) respostas[p.id] = a;
  }
  const novas = new Set<string>();
  const invalidas: { pergunta: string; dito: string; opcoes: string[] }[] = [];
  for (const d of dadas) {
    const p = d.pergunta
      ? acharPergunta(perguntas, d.pergunta)
      : (perguntas.find((x) => !novas.has(x.id)) ?? null);
    if (!p) {
      invalidas.push({
        pergunta: d.pergunta ?? '?',
        dito: d.opcao,
        opcoes: [],
      });
      continue;
    }
    const o = acharOpcao(p, d.opcao);
    if (!o) {
      invalidas.push({
        pergunta: p.texto,
        dito: d.opcao,
        opcoes: p.opcoes.map((x) => x.texto),
      });
      continue;
    }
    respostas[p.id] = o.id;
    novas.add(p.id);
  }
  const emFalta = perguntas.filter((p) => !respostas[p.id]);
  if (emFalta.length || invalidas.length) {
    return { ok: false, em_falta: emFalta, invalidas };
  }
  return { ok: true, respostas };
}

// ---------------------------------------------------------------------------
// Freguesias
// ---------------------------------------------------------------------------

/**
 * As partes que identificam uma freguesia: "União das Freguesias de Oliveira,
 * São Paio e São Sebastião" → ["oliveira", "sao paio", "sao sebastiao"].
 */
export function partesFreguesia(nome: string): string[] {
  const semPrefixo = nome
    .trim()
    .replace(/^uni[ãa]o\s+(das|de)\s+freguesias\s+de\s+/i, '')
    .replace(/^freguesia\s+d[aeo]s?\s+/i, '');
  return semPrefixo
    .split(/\s*,\s*|\s+e\s+/i)
    .map(normalizarTexto)
    .filter((x) => x.length >= 3);
}

function contemPalavras(texto: string, parte: string): boolean {
  return ` ${texto} `.includes(` ${parte} `);
}

/** "azurem" ou "Freguesia de Azurém" → "Azurém" (da lista), ou a forma dita. */
export function resolverFreguesia(dita: string, candidatas: string[]): string {
  const n = normalizarTexto(dita).replace(/^freguesia d[aeo]s? /, '');
  if (!n) return dita.trim();
  const exata = candidatas.find((c) => normalizarTexto(c) === n);
  if (exata) return exata;
  const porParte = candidatas.filter((c) =>
    partesFreguesia(c).some((p) => p === n || contemPalavras(n, p)),
  );
  if (porParte.length === 1) return porParte[0];
  return dita.trim().replace(/\s+/g, ' ');
}

/**
 * A freguesia a partir do que a geocodificação encontrou (o `display_name`
 * do Nominatim: "Rua X, Azurém, Guimarães, Braga, …"). Só se uma das
 * candidatas aparecer; senão null e o agente pergunta.
 */
export function deduzirFreguesia(
  encontrada: string,
  candidatas: string[],
): string | null {
  const t = normalizarTexto(encontrada);
  if (!t) return null;
  const achadas = candidatas.filter((c) =>
    partesFreguesia(c).some((p) => contemPalavras(t, p)),
  );
  return achadas.length === 1 ? achadas[0] : null;
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

export interface ParticipacaoAgregavel {
  respostas: Record<string, string>;
  freguesia: string | null;
}

export const SEM_FREGUESIA = 'Sem freguesia indicada';

export interface ResultadoPergunta {
  id: string;
  texto: string;
  opcoes: { id: string; texto: string; n: number; pct: number }[];
  por_freguesia: {
    freguesia: string;
    abrangida: boolean;
    total: number;
    opcoes: Record<string, number>;
  }[];
}

export interface Resultados {
  total: number;
  freguesias: {
    freguesia: string;
    abrangida: boolean;
    participacoes: number;
  }[];
  perguntas: ResultadoPergunta[];
}

const pct = (n: number, t: number) =>
  t === 0 ? 0 : Math.round((n / t) * 1000) / 10;

/**
 * Contagens por opção, no total e por freguesia. As freguesias abrangidas
 * aparecem sempre (mesmo com 0), por ordem; depois as outras por ordem
 * alfabética e, no fim, quem não disse a freguesia.
 */
export function agregar(
  perguntas: Pergunta[],
  participacoes: ParticipacaoAgregavel[],
  abrangidas: string[] | null,
): Resultados {
  const lista = abrangidas ?? [];
  // A mesma freguesia escrita de maneiras diferentes conta junta (com o nome
  // da lista ou, fora dela, a primeira forma que apareceu).
  const nomes = new Map<string, string>(
    lista.map((a) => [normalizarTexto(a), a]),
  );
  const chave = (f: string | null) => {
    if (!f) return SEM_FREGUESIA;
    const n = normalizarTexto(f);
    if (!nomes.has(n)) nomes.set(n, f);
    return nomes.get(n) as string;
  };
  const contagem = new Map<string, number>();
  for (const a of lista) contagem.set(a, 0);
  for (const p of participacoes) {
    const f = chave(p.freguesia);
    contagem.set(f, (contagem.get(f) ?? 0) + 1);
  }
  const outras = [...contagem.keys()]
    .filter((f) => !lista.includes(f) && f !== SEM_FREGUESIA)
    .sort((a, b) => a.localeCompare(b, 'pt'));
  const ordem = [
    ...lista,
    ...outras,
    ...(contagem.has(SEM_FREGUESIA) ? [SEM_FREGUESIA] : []),
  ];
  const abrangida = (f: string) =>
    f !== SEM_FREGUESIA && (abrangidas === null || lista.includes(f));

  return {
    total: participacoes.length,
    freguesias: ordem.map((f) => ({
      freguesia: f,
      abrangida: abrangida(f),
      participacoes: contagem.get(f) ?? 0,
    })),
    perguntas: perguntas.map((q) => {
      const respondidas = participacoes.filter((p) => p.respostas[q.id]);
      return {
        id: q.id,
        texto: q.texto,
        opcoes: q.opcoes.map((o) => {
          const n = respondidas.filter(
            (p) => p.respostas[q.id] === o.id,
          ).length;
          return {
            id: o.id,
            texto: o.texto,
            n,
            pct: pct(n, respondidas.length),
          };
        }),
        por_freguesia: ordem.map((f) => {
          const daqui = respondidas.filter((p) => chave(p.freguesia) === f);
          return {
            freguesia: f,
            abrangida: abrangida(f),
            total: daqui.length,
            opcoes: Object.fromEntries(
              q.opcoes.map((o) => [
                o.id,
                daqui.filter((p) => p.respostas[q.id] === o.id).length,
              ]),
            ),
          };
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Opiniões livres (sem IA) e anonimização
// ---------------------------------------------------------------------------

const PALAVRAS_VAZIAS = new Set(
  (
    'a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas ' +
    'para pra com sem que se e ou mas nao sim ja so mais muito muita muitos muitas pouco ' +
    'eu tu ele ela nos vos eles elas me te lhe isto isso aquilo este esta esse essa ' +
    'aqui ali la ser ter estar ha foi era sao esta estao tem vai vao fazer acho penso ' +
    'como quando onde porque pois tambem ainda bem mal ao aos camara obra obras coisa coisas ' +
    'todo toda todos todas mesmo assim entao sobre entre ate depois antes deve devia seria'
  ).split(' '),
);

/** As palavras que mais aparecem nas opiniões (o resumo sem IA). */
export function palavrasFrequentes(
  textos: string[],
  limite = 12,
): { palavra: string; n: number }[] {
  const conta = new Map<string, number>();
  for (const t of textos) {
    // Uma vez por opinião: conta quantas pessoas falam disso.
    const unicas = new Set(
      normalizarTexto(t)
        .split(' ')
        .filter(
          (p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p) && !/^\d+$/.test(p),
        ),
    );
    for (const p of unicas) conta.set(p, (conta.get(p) ?? 0) + 1);
  }
  return [...conta.entries()]
    .filter(([, n]) => n >= 2 || textos.length < 5)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt'))
    .slice(0, limite)
    .map(([palavra, n]) => ({ palavra, n }));
}

/** Tira contactos e números de identificação que a pessoa tenha dito. */
export function anonimizarTexto(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(\+?\d[\d\s.-]{7,}\d)/g, '[número]');
}

function celula(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV das participações sem dados pessoais: sem telefone, nome nem ids; a
 * data só ao dia; a opinião sem contactos. Separador ";" (Excel em pt-PT).
 */
export function csvParticipacoes(
  perguntas: Pergunta[],
  temAberta: boolean,
  linhas: {
    dia: string;
    canal: Canal;
    freguesia: string | null;
    respostas: Record<string, string>;
    opiniao: string | null;
  }[],
): string {
  const cab = [
    'n',
    'dia',
    'canal',
    'freguesia',
    ...perguntas.map((p) => p.texto),
    ...(temAberta ? ['opiniao'] : []),
  ];
  const corpo = linhas.map((l, i) =>
    [
      String(i + 1),
      l.dia,
      l.canal,
      l.freguesia ?? '',
      ...perguntas.map(
        (p) => p.opcoes.find((o) => o.id === l.respostas[p.id])?.texto ?? '',
      ),
      ...(temAberta ? [anonimizarTexto(l.opiniao ?? '')] : []),
    ]
      .map(celula)
      .join(';'),
  );
  return `\uFEFF${[cab.map(celula).join(';'), ...corpo].join('\r\n')}\r\n`;
}
