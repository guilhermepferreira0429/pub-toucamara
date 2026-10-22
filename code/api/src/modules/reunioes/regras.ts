/*
 * Regras puras das atas: dividir a transcrição pelos pontos da ordem do dia,
 * ler quem fala, contar votos, montar a ata sem IA e verificar o que falta
 * antes de a aprovar. Sem BD nem rede (testadas em regras.spec.ts).
 */
import {
  Cabecalho,
  ConteudoAta,
  Membro,
  PontoAta,
  PontoOrdem,
  Resultado,
  TipoReuniao,
  Orgao,
  VotoForca,
} from './tipos.js';

/** Os dados da reunião que entram na ata. */
export interface DadosReuniao {
  orgao: Orgao;
  tipo: TipoReuniao;
  numero: string;
  data: string;
  hora: string | null;
  local: string;
  ordem_do_dia: PontoOrdem[];
  presencas: Membro[];
}

// ---------------------------------------------------------------------------
// Dividir a transcrição pelos pontos
// ---------------------------------------------------------------------------

const NUMERAIS: Record<string, number> = {
  um: 1,
  uma: 1,
  primeiro: 1,
  dois: 2,
  segundo: 2,
  tres: 3,
  terceiro: 3,
  quatro: 4,
  quarto: 4,
  cinco: 5,
  quinto: 5,
  seis: 6,
  sexto: 6,
  sete: 7,
  setimo: 7,
  oito: 8,
  oitavo: 8,
  nove: 9,
  nono: 9,
  dez: 10,
  decimo: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezasseis: 16,
  dezassete: 17,
  dezoito: 18,
  dezanove: 19,
  vinte: 20,
};

/** Sem acentos e em minúsculas (para comparar nomes e numerais). */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PALAVRAS = Object.keys(NUMERAIS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const NUMERO = `(\\d{1,3}|${PALAVRAS})(?![\\p{L}\\d])`;
const PREFIXO_N = `(?:n\\.?\\s?º\\s*|n\\.?o\\s+|numero\\s+)?`;
/** "Ponto 2", "PONTO N.º 3 –", "Presidente: Ponto dois." no início da linha. */
const MARCA_LINHA = new RegExp(
  `^\\s*(?:\\[[^\\]\\n]{1,60}\\]\\s*:?\\s*|[^:\\n\\d]{1,60}:\\s*)?ponto\\s+${PREFIXO_N}${NUMERO}`,
  'u',
);
/** "Passamos ao ponto 3", "vamos agora para o ponto quatro" a meio da frase. */
const MARCA_FRASE = new RegExp(
  `\\b(?:passa(?:mos|r|-se)?|vamos|segue-se|seguimos|entramos)\\s+(?:agora\\s+)?(?:ao|para o|no|o)\\s+ponto\\s+${PREFIXO_N}${NUMERO}`,
  'u',
);

/** O número do ponto que esta linha abre, ou null. */
export function marcaDePonto(linha: string): number | null {
  const l = normalizar(linha);
  const m = MARCA_LINHA.exec(l) ?? MARCA_FRASE.exec(l);
  if (!m) return null;
  const v = m[1];
  const n = /^\d+$/.test(v) ? Number(v) : NUMERAIS[v];
  return n && n > 0 ? n : null;
}

export interface Divisao {
  /** O que se disse antes do primeiro ponto (período antes da ordem do dia). */
  antes: string;
  /** Texto de cada ponto da ordem do dia (só os que tiveram marcador). */
  pontos: Map<number, string>;
  /** Marcadores de pontos que não estão na ordem do dia. */
  fora_da_ordem: { numero: number; texto: string }[];
  /** Havia algum marcador "Ponto n"? */
  com_marcadores: boolean;
}

/**
 * Parte a transcrição pelos marcadores "Ponto n". Sem marcadores fica tudo
 * em `antes` (quem redige divide à mão). Um ponto que volta a ser falado
 * mais tarde junta-se ao que já tinha.
 */
export function dividirPorPontos(
  transcricao: string,
  numeros: number[],
): Divisao {
  const validos = new Set(numeros);
  const blocos = new Map<number, string[]>();
  const fora = new Map<number, string[]>();
  const antes: string[] = [];
  let atual: number | null = null;
  let com = false;
  for (const linha of transcricao.replace(/\r\n?/g, '\n').split('\n')) {
    const n = marcaDePonto(linha);
    if (n !== null) {
      atual = n;
      com = true;
    }
    if (atual === null) {
      antes.push(linha);
      continue;
    }
    const alvo: Map<number, string[]> = validos.has(atual) ? blocos : fora;
    if (!alvo.has(atual)) alvo.set(atual, []);
    alvo.get(atual)!.push(linha);
  }
  const juntar = (l: string[]) => l.join('\n').trim();
  return {
    antes: juntar(antes),
    pontos: new Map([...blocos].map(([n, l]) => [n, juntar(l)])),
    fora_da_ordem: [...fora].map(([numero, l]) => ({
      numero,
      texto: juntar(l),
    })),
    com_marcadores: com,
  };
}

// ---------------------------------------------------------------------------
// Quem fala
// ---------------------------------------------------------------------------

export interface Fala {
  falante: string | null;
  texto: string;
}

const FALANTE_PARENTESES = /^\s*\[([^\]\n]{1,60})\]\s*:?\s*(.*)$/u;
const FALANTE_DOIS_PONTOS = /^\s*(\p{Lu}[^:\n\d]{0,59}?)\s*:\s+(.*)$/u;

/** "Nome: texto" ou "[Nome] texto". Os números e "Ponto" não contam como nome. */
export function falanteDaLinha(
  linha: string,
): { falante: string; texto: string } | null {
  const m = FALANTE_PARENTESES.exec(linha) ?? FALANTE_DOIS_PONTOS.exec(linha);
  if (!m) return null;
  const nome = m[1].trim();
  if (!nome || nome.split(/\s+/).length > 8) return null;
  if (/^ponto\b/i.test(normalizar(nome))) return null;
  return { falante: nome, texto: m[2].trim() };
}

/** As falas por ordem; as linhas sem nome continuam a fala anterior. */
export function lerFalas(texto: string): Fala[] {
  const falas: Fala[] = [];
  for (const linha of texto.replace(/\r\n?/g, '\n').split('\n')) {
    if (!linha.trim()) continue;
    const f = falanteDaLinha(linha);
    if (f) {
      falas.push({ falante: f.falante, texto: f.texto });
      continue;
    }
    const ultima = falas[falas.length - 1];
    if (ultima) ultima.texto = `${ultima.texto} ${linha.trim()}`.trim();
    else falas.push({ falante: null, texto: linha.trim() });
  }
  return falas;
}

/** O membro da reunião com este nome (ou com o nome dentro: "Vereador João Silva"). */
export function membroDe(
  falante: string,
  membros: Pick<Membro, 'nome' | 'forca_politica' | 'cargo'>[],
): Pick<Membro, 'nome' | 'forca_politica' | 'cargo'> | null {
  const f = normalizar(falante);
  return (
    membros.find((m) => normalizar(m.nome) === f) ??
    membros.find((m) => {
      const n = normalizar(m.nome);
      return f.includes(n) || n.includes(f);
    }) ??
    null
  );
}

const MAX_RESUMO = 400;

function cortar(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Sem IA: uma intervenção por pessoa que falou no ponto, com o início do
 * que disse (literal, para quem redige resumir).
 */
export function intervencoesDoTexto(
  texto: string,
  membros: Membro[],
): PontoAta['intervencoes'] {
  const porFalante = new Map<string, { nome: string; textos: string[] }>();
  for (const f of lerFalas(texto)) {
    if (!f.falante) continue;
    const chave = normalizar(f.falante);
    if (!porFalante.has(chave))
      porFalante.set(chave, { nome: f.falante, textos: [] });
    porFalante.get(chave)!.textos.push(f.texto);
  }
  return [...porFalante.values()].map(({ nome, textos }) => {
    const m = membroDe(nome, membros);
    return {
      membro: m?.nome ?? nome,
      forca_politica: m?.forca_politica ?? null,
      resumo: cortar(textos.join(' '), MAX_RESUMO),
    };
  });
}

// ---------------------------------------------------------------------------
// Votos
// ---------------------------------------------------------------------------

export interface Totais {
  a_favor: number;
  contra: number;
  abstencoes: number;
  votantes: number;
}

export function contarVotos(votacao: VotoForca[]): Totais {
  const t = votacao.reduce(
    (s, v) => ({
      a_favor: s.a_favor + v.a_favor,
      contra: s.contra + v.contra,
      abstencoes: s.abstencoes + v.abstencoes,
    }),
    { a_favor: 0, contra: 0, abstencoes: 0 },
  );
  return { ...t, votantes: t.a_favor + t.contra + t.abstencoes };
}

/**
 * O resultado pelos votos: sem votos contra nem abstenções é unanimidade;
 * mais a favor do que contra é maioria; empate fica `empate` (decide o voto
 * de qualidade do presidente, a confirmar com os serviços).
 */
export function resultadoDosVotos(votacao: VotoForca[]): Resultado {
  const t = contarVotos(votacao);
  if (t.votantes === 0) return 'por_preencher';
  if (t.a_favor > 0 && t.contra === 0 && t.abstencoes === 0)
    return 'aprovada_unanimidade';
  if (t.a_favor > t.contra) return 'aprovada_maioria';
  if (t.contra > t.a_favor) return 'rejeitada';
  return 'empate';
}

function porForca(votacao: VotoForca[], campo: keyof Totais): string {
  return votacao
    .filter((v) => (v[campo as keyof VotoForca] as number) > 0)
    .map((v) => `${v.forca_politica} ${v[campo as keyof VotoForca]}`)
    .join(', ');
}

function n(qtd: number, um: string, varios: string): string {
  return `${qtd} ${qtd === 1 ? um : varios}`;
}

/**
 * A frase da votação para a ata: "Aprovada por maioria, com 6 votos a favor
 * (PS 5, CDS-PP 1), 3 votos contra (PSD 3) e 2 abstenções (CDU 2)."
 */
export function fraseVotacao(
  votacao: VotoForca[],
  resultado: Resultado,
): string {
  switch (resultado) {
    case 'retirada':
      return 'Ponto retirado da ordem do dia.';
    case 'adiada':
      return 'Ponto adiado.';
    case 'sem_votacao':
      return 'Ponto sem votação (para conhecimento).';
    case 'por_preencher':
      return 'Votação por preencher.';
    default:
      break;
  }
  const t = contarVotos(votacao);
  const partes: string[] = [];
  if (t.a_favor) {
    const f = porForca(votacao, 'a_favor');
    partes.push(
      `${n(t.a_favor, 'voto a favor', 'votos a favor')}${f ? ` (${f})` : ''}`,
    );
  }
  if (t.contra) {
    const f = porForca(votacao, 'contra');
    partes.push(
      `${n(t.contra, 'voto contra', 'votos contra')}${f ? ` (${f})` : ''}`,
    );
  }
  if (t.abstencoes) {
    const f = porForca(votacao, 'abstencoes');
    partes.push(
      `${n(t.abstencoes, 'abstenção', 'abstenções')}${f ? ` (${f})` : ''}`,
    );
  }
  const lista =
    partes.length > 1
      ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
      : (partes[0] ?? '');
  const inicio: Record<string, string> = {
    aprovada_unanimidade: 'Aprovada por unanimidade',
    aprovada_maioria: 'Aprovada por maioria',
    rejeitada: 'Rejeitada',
    empate: 'Empate na votação',
  };
  return lista
    ? `${inicio[resultado]}, com ${lista}.`
    : `${inicio[resultado]}.`;
}

/** Uma linha por força política presente, com os votos a zero (para preencher). */
export function votacaoParaPreencher(membros: Membro[]): VotoForca[] {
  const forcas: string[] = [];
  for (const m of membros) {
    if (!m.presente || !m.forca_politica) continue;
    if (!forcas.includes(m.forca_politica)) forcas.push(m.forca_politica);
  }
  return forcas.map((forca_politica) => ({
    forca_politica,
    a_favor: 0,
    contra: 0,
    abstencoes: 0,
  }));
}

/** Avisos da votação: mais votos do que membros presentes dessa força. */
export function verificarVotacao(
  votacao: VotoForca[],
  presentes: { forca_politica: string | null }[],
): string[] {
  const avisos: string[] = [];
  const contagem = new Map<string, number>();
  for (const p of presentes) {
    if (!p.forca_politica) continue;
    const k = normalizar(p.forca_politica);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  if (!contagem.size) return avisos;
  for (const v of votacao) {
    const votos = v.a_favor + v.contra + v.abstencoes;
    const presentesForca = contagem.get(normalizar(v.forca_politica));
    if (presentesForca === undefined) {
      if (votos > 0)
        avisos.push(
          `${v.forca_politica}: votos de uma força sem membros presentes.`,
        );
    } else if (votos > presentesForca) {
      avisos.push(
        `${v.forca_politica}: ${votos} votos para ${presentesForca} ${presentesForca === 1 ? 'membro presente' : 'membros presentes'}.`,
      );
    }
  }
  return avisos;
}

// ---------------------------------------------------------------------------
// Montar a ata
// ---------------------------------------------------------------------------

export function cabecalhoDe(r: DadosReuniao): Cabecalho {
  const pessoa = (m: Membro) => ({
    nome: m.nome,
    cargo: m.cargo,
    forca_politica: m.forca_politica,
    falta_justificada: m.falta_justificada,
  });
  const presidente =
    r.presencas.find(
      (m) => m.presente && /^presidente$/i.test(normalizar(m.cargo)),
    ) ??
    r.presencas.find(
      (m) => m.presente && normalizar(m.cargo).startsWith('presidente'),
    );
  return {
    orgao: r.orgao,
    tipo: r.tipo,
    numero: r.numero,
    data: r.data,
    hora_inicio: r.hora,
    hora_fim: null,
    local: r.local,
    presidente: presidente?.nome ?? null,
    presentes: r.presencas.filter((m) => m.presente).map(pessoa),
    ausentes: r.presencas.filter((m) => !m.presente).map(pessoa),
  };
}

/**
 * Sem IA: a ata a partir da ordem do dia. Cada ponto leva o excerto da
 * transcrição (se houver marcadores "Ponto n"), quem falou e a votação com
 * uma linha por força política, a zeros, para preencher.
 */
export function montarAtaSemIa(
  r: DadosReuniao,
  transcricao: string | null,
): ConteudoAta {
  const divisao = transcricao
    ? dividirPorPontos(
        transcricao,
        r.ordem_do_dia.map((p) => p.numero),
      )
    : null;
  const notas: string[] = [
    'Rascunho montado sem IA: resumir a discussão, preencher a votação e redigir a deliberação de cada ponto.',
  ];
  if (transcricao && divisao && !divisao.com_marcadores) {
    notas.push(
      'A transcrição não tem marcadores "Ponto n": ficou toda no período antes da ordem do dia, para dividir à mão.',
    );
  }
  if (!transcricao) notas.push('Ainda sem transcrição da reunião.');
  for (const f of divisao?.fora_da_ordem ?? []) {
    notas.push(
      `A transcrição fala de um ponto ${f.numero} que não está na ordem do dia.`,
    );
  }
  const presentes = r.presencas.filter((m) => m.presente);
  const pontos: PontoAta[] = r.ordem_do_dia.map((p) => {
    const excerto = divisao?.pontos.get(p.numero) ?? null;
    return {
      numero: p.numero,
      titulo: p.titulo,
      resumo_discussao: '',
      intervencoes: excerto ? intervencoesDoTexto(excerto, r.presencas) : [],
      proposta: p.descricao,
      votacao: votacaoParaPreencher(presentes),
      resultado: 'por_preencher',
      deliberacao: '',
      declaracoes_voto: [],
      transcricao: excerto,
    };
  });
  return {
    cabecalho: cabecalhoDe(r),
    antes_da_ordem_do_dia: divisao?.antes ?? '',
    pontos,
    notas,
  };
}

/** O que a IA devolve por ponto (ia.ts). */
export interface PontoIa {
  numero: number;
  resumo_discussao: string;
  intervencoes: {
    membro: string;
    forca_politica: string | null;
    resumo: string;
  }[];
  proposta: string;
  votacao: VotoForca[];
  resultado: Resultado;
  deliberacao: string;
  declaracoes_voto: {
    membro: string;
    forca_politica: string | null;
    texto: string;
  }[];
}

/**
 * Com IA: a ordem do dia manda (os pontos e os títulos são os dela); a IA
 * enche cada ponto. O resultado de um ponto votado conta-se pelos votos,
 * não pelo que a IA escreveu; votos negativos ficam a zero.
 */
export function juntarAtaIa(
  r: DadosReuniao,
  ia: { antes_da_ordem_do_dia: string; pontos: PontoIa[] },
  transcricao: string | null,
): ConteudoAta {
  const divisao = transcricao
    ? dividirPorPontos(
        transcricao,
        r.ordem_do_dia.map((p) => p.numero),
      )
    : null;
  const notas = [
    'Rascunho escrito com IA a partir da transcrição: rever cada ponto (sobretudo votações e deliberações) antes de aprovar.',
  ];
  const presentes = r.presencas.filter((m) => m.presente);
  const pontos: PontoAta[] = r.ordem_do_dia.map((p) => {
    const x = ia.pontos.find((i) => i.numero === p.numero);
    if (!x) {
      notas.push(`A IA não encontrou o ponto ${p.numero} na transcrição.`);
      return {
        numero: p.numero,
        titulo: p.titulo,
        resumo_discussao: '',
        intervencoes: [],
        proposta: p.descricao,
        votacao: votacaoParaPreencher(presentes),
        resultado: 'por_preencher',
        deliberacao: '',
        declaracoes_voto: [],
        transcricao: divisao?.pontos.get(p.numero) ?? null,
      };
    }
    const votacao = x.votacao
      .filter((v) => v.forca_politica?.trim())
      .map((v) => ({
        forca_politica: v.forca_politica.trim(),
        a_favor: Math.max(0, Math.trunc(v.a_favor)),
        contra: Math.max(0, Math.trunc(v.contra)),
        abstencoes: Math.max(0, Math.trunc(v.abstencoes)),
      }));
    const semVotos = ['retirada', 'adiada', 'sem_votacao'].includes(
      x.resultado,
    );
    const resultado: Resultado = semVotos
      ? x.resultado
      : votacao.length
        ? resultadoDosVotos(votacao)
        : 'por_preencher';
    return {
      numero: p.numero,
      titulo: p.titulo,
      resumo_discussao: x.resumo_discussao.trim(),
      intervencoes: x.intervencoes.map((i) => ({
        membro: i.membro,
        forca_politica:
          i.forca_politica ??
          membroDe(i.membro, r.presencas)?.forca_politica ??
          null,
        resumo: i.resumo,
      })),
      proposta: x.proposta.trim() || p.descricao,
      votacao: votacao.length ? votacao : votacaoParaPreencher(presentes),
      resultado,
      deliberacao: x.deliberacao.trim(),
      declaracoes_voto: x.declaracoes_voto,
      transcricao: null,
    };
  });
  return {
    cabecalho: cabecalhoDe(r),
    antes_da_ordem_do_dia: ia.antes_da_ordem_do_dia.trim(),
    pontos,
    notas,
  };
}

// ---------------------------------------------------------------------------
// Verificar antes de aprovar
// ---------------------------------------------------------------------------

const VOTADOS: Resultado[] = [
  'aprovada_unanimidade',
  'aprovada_maioria',
  'rejeitada',
];

export interface Verificacao {
  /** O que impede a aprovação. */
  pendentes: string[];
  /** O que convém ver (não impede). */
  avisos: string[];
}

export function verificarAta(c: ConteudoAta): Verificacao {
  const pendentes: string[] = [];
  const avisos: string[] = [];
  if (!c.cabecalho.local.trim()) pendentes.push('Falta o local da reunião.');
  if (!c.pontos.length) pendentes.push('A ata não tem pontos.');
  for (const p of c.pontos) {
    const nome = `Ponto ${p.numero}`;
    if (p.resultado === 'por_preencher')
      pendentes.push(`${nome}: falta o resultado da votação.`);
    if (p.resultado === 'empate')
      pendentes.push(
        `${nome}: empate na votação; indicar o resultado com o voto de qualidade do presidente.`,
      );
    if (VOTADOS.includes(p.resultado) && !p.deliberacao.trim())
      pendentes.push(`${nome}: falta o texto da deliberação.`);
    if (VOTADOS.includes(p.resultado)) {
      const t = contarVotos(p.votacao);
      const pelosVotos = resultadoDosVotos(p.votacao);
      if (t.votantes === 0) {
        avisos.push(`${nome}: resultado sem votos registados.`);
      } else if (
        pelosVotos !== p.resultado &&
        !(pelosVotos === 'empate' && p.resultado !== 'aprovada_unanimidade')
      ) {
        avisos.push(
          `${nome}: o resultado indicado não bate certo com os votos (pelos votos: ${pelosVotos.replace(/_/g, ' ')}).`,
        );
      }
      avisos.push(
        ...verificarVotacao(p.votacao, c.cabecalho.presentes).map(
          (a) => `${nome}: ${a}`,
        ),
      );
    }
  }
  return { pendentes, avisos };
}

/**
 * Preenche o resultado de quem só pôs votos: um ponto 'por_preencher' com
 * votos passa ao resultado contado.
 */
export function completarResultados(c: ConteudoAta): ConteudoAta {
  return {
    ...c,
    pontos: c.pontos.map((p) =>
      p.resultado === 'por_preencher' && contarVotos(p.votacao).votantes > 0
        ? { ...p, resultado: resultadoDosVotos(p.votacao) }
        : p,
    ),
  };
}

// ---------------------------------------------------------------------------
// Índice e textos
// ---------------------------------------------------------------------------

/** O que entra no índice de deliberações (só pontos com algo deliberado). */
export function deliberacoesDaAta(c: ConteudoAta): {
  ponto: PontoAta;
  votacao_texto: string;
  texto_pesquisa: string;
}[] {
  return c.pontos
    .filter(
      (p) =>
        p.resultado !== 'por_preencher' &&
        (p.deliberacao.trim() || VOTADOS.includes(p.resultado)),
    )
    .map((p) => ({
      ponto: p,
      votacao_texto: fraseVotacao(p.votacao, p.resultado),
      texto_pesquisa: [p.titulo, p.proposta, p.deliberacao, p.resumo_discussao]
        .filter((s) => s && s.trim())
        .join('\n'),
    }));
}

/**
 * Palavras que estão em quase todas as deliberações ("A Câmara Municipal
 * deliberou aprovar a proposta..."). A pesquisa é um OU de lexemas: com elas
 * tudo acertava em tudo. O órgão filtra-se à parte (`orgao=`).
 */
const GENERICAS = new Set(
  [
    'camara',
    'camaras',
    'municipal',
    'municipais',
    'municipio',
    'concelho',
    'assembleia',
    'reuniao',
    'reunioes',
    'sessao',
    'ata',
    'atas',
    'ponto',
    'deliberacao',
    'deliberacoes',
    'deliberou',
    'deliberaram',
    'deliberado',
    'decidiu',
    'decidir',
    'decidido',
    'decisao',
    'decisoes',
    'aprovar',
    'aprovou',
    'aprovado',
    'aprovada',
    'aprovacao',
    'proposta',
    'votacao',
    'votou',
    'vereador',
    'vereadora',
    'vereacao',
    'presidente',
    'alguma',
    'algum',
    'coisa',
    'ja',
    'sobre',
    'quero',
    'saber',
  ].map(normalizar),
);

/** A pergunta sem as palavras genéricas; vazia se só tinha essas. */
export function limparConsulta(q: string): string {
  return q
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p && !GENERICAS.has(normalizar(p)))
    .join(' ');
}

/** "12 de março de 2026". */
export function dataPorExtenso(dia: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${dia}T12:00:00Z`));
}

/** "Ata da reunião ordinária da Câmara Municipal" / "sessão ... da Assembleia". */
export function tituloAta(orgao: Orgao, tipo: TipoReuniao): string {
  const tipoTxt = tipo === 'ordinaria' ? 'ordinária' : 'extraordinária';
  return orgao === 'camara'
    ? `Ata da reunião ${tipoTxt} da Câmara Municipal`
    : `Ata da sessão ${tipoTxt} da Assembleia Municipal`;
}
