/*
 * Regras puras do apoio ao técnico (painel dos processos): o que se manda ao
 * Claude para o resumo do processo, o regulamento destacado e os rascunhos
 * de ofício / pedido de elementos / SMS, e o que se faz com a resposta
 * (prazos calculados por nós, destaques validados contra o texto, NIF fora).
 * Sem BD nem IA, para testar à parte.
 *
 * Os textos de sistema ficam em cache no ClaudeService: nada de datas, ids
 * ou nomes lá dentro; o que muda vai no conteúdo.
 */
import { z } from 'zod';
import type { EmFalta, EstadoPedido } from './avisos.js';
import type { CampoComValor } from './formulario.js';
import { Fase, FASES_FECHADAS } from './regras.js';
import { Verificacao, verificacoesEmTexto } from './verificacoes.js';

// ---------------------------------------------------------------------------
// Estado do processo (cache)
// ---------------------------------------------------------------------------

/**
 * Hash do estado do processo `p` (alias), para saber se o resumo em cache
 * ainda serve: fase, decisão, técnico, prazos, eventos, documentos (com o
 * estado da verificação), pedidos ao munícipe e requerimento. Só texto fixo:
 * os valores vêm das colunas.
 */
export const HASH_PROCESSO = `md5(concat_ws('|',
  p.fase, p.decisao, p.tecnico_id, p.prazo_inicio, p.prazo_fim, p.assunto, p.morada,
  (SELECT count(*) || ':' || coalesce(max(e.id), 0) FROM processo_eventos e WHERE e.processo_id = p.id),
  (SELECT string_agg(d.id || ':' || d.verificacao_estado, ',' ORDER BY d.id)
     FROM documentos d WHERE d.processo_id = p.id),
  (SELECT string_agg(pp.id::text, ',' ORDER BY pp.id) FROM processo_pedidos pp WHERE pp.processo_id = p.id),
  (SELECT max(r.atualizado_em) FROM requerimentos r WHERE r.processo_id = p.id)))`;

/**
 * Hash do que o regulamento destacado usa: tipo e base legal, assunto,
 * requerimento, o resumo de onde saem os pontos do caso (`ap` = linha do
 * resumo em `processo_apoio`, pode faltar) e a última leitura das fontes da
 * câmara (uma fonte nova ou alterada pode trazer a regra certa).
 */
export const HASH_REGULAMENTO = `md5(concat_ws('|',
  p.tipo_processo_id,
  (SELECT t.base_legal_trecho FROM tipos_processo t WHERE t.id = p.tipo_processo_id),
  p.assunto, p.morada,
  (SELECT max(r.atualizado_em) FROM requerimentos r WHERE r.processo_id = p.id),
  (SELECT ap.gerado_em FROM processo_apoio ap WHERE ap.processo_id = p.id AND ap.tipo = 'resumo'),
  (SELECT max(fv.lida_em) FROM fonte_versoes fv JOIN fontes fo ON fo.id = fv.fonte_id
    WHERE fo.municipio_id = p.municipio_id)))`;

// ---------------------------------------------------------------------------
// Datas e NIF
// ---------------------------------------------------------------------------

/** Data (ou ISO) → 'AAAA-MM-DD' em Lisboa. */
export function dia(d: Date | string): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(d).toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Lisbon',
  });
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export function diaPt(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/**
 * Nove algarismos seguidos (com ou sem espaços de 3 em 3) parecem um NIF:
 * no resumo não aparecem. Telefones portugueses também têm nove, e também
 * não fazem falta no resumo.
 */
const NOVE_ALGARISMOS = /(?<!\d)\d{3}[ .]?\d{3}[ .]?\d{3}(?!\d)/g;

export function semNif(texto: string): string {
  return texto.replace(NOVE_ALGARISMOS, '[omitido]');
}

// ---------------------------------------------------------------------------
// Próximo prazo
// ---------------------------------------------------------------------------

export interface ProximoPrazo {
  data: string;
  de_quem: 'camara' | 'municipe';
  descricao: string;
  atrasado: boolean;
}

/**
 * O prazo que acaba primeiro: o da câmara (prazo do processo, enquanto não
 * está fechado) ou o de um pedido ao munícipe ainda por responder. Calculado
 * aqui e não pela IA: datas não se inventam.
 */
export function proximoPrazo(
  p: { fase: Fase; prazo_fim: string | null },
  pedidos: { descricao: string; prazo: string; estado: EstadoPedido }[],
  hoje: string,
): ProximoPrazo | null {
  const candidatos: Omit<ProximoPrazo, 'atrasado'>[] = [];
  if (p.prazo_fim && !FASES_FECHADAS.includes(p.fase)) {
    candidatos.push({
      data: p.prazo_fim,
      de_quem: 'camara',
      descricao: 'Prazo da câmara para decidir o processo.',
    });
  }
  if (!FASES_FECHADAS.includes(p.fase)) {
    for (const x of pedidos) {
      if (x.estado === 'respondido') continue;
      candidatos.push({
        data: x.prazo,
        de_quem: 'municipe',
        descricao: `O munícipe entregar: ${x.descricao}.`,
      });
    }
  }
  if (!candidatos.length) return null;
  // O mais cedo; em empate, o do munícipe (é o que trava o processo).
  candidatos.sort(
    (a, b) =>
      a.data.localeCompare(b.data) ||
      (a.de_quem === b.de_quem ? 0 : a.de_quem === 'municipe' ? -1 : 1),
  );
  const c = candidatos[0];
  return { ...c, atrasado: c.data < hoje };
}

// ---------------------------------------------------------------------------
// Contexto do processo (o que o Claude lê)
// ---------------------------------------------------------------------------

export interface ContextoProcesso {
  numero: string;
  tipo: { codigo: string; nome: string; prazo_dias_uteis: number };
  assunto: string;
  morada: string | null;
  freguesia: string | null;
  fase: Fase;
  fase_rotulo: string;
  decisao: string | null;
  tecnico: string | null;
  prazo: {
    inicio: string | null;
    fim: string | null;
    dias_uteis_restantes: number | null;
  };
  /** Nome já mascarado ('Maria F.'); o resumo não precisa de mais. */
  municipe: {
    nome: string | null;
    tem_telefone: boolean;
    tem_email: boolean;
  } | null;
  requerimento: {
    estado: string;
    assinatura: string | null;
    campos: CampoComValor[];
  } | null;
  documentos: {
    tipo_documento: string | null;
    origem: string;
    verificacao_estado: string;
    verificacao: unknown;
    emitido_em: string | null;
    recebido_em: Date | string;
  }[];
  em_falta: EmFalta[];
  pedidos: {
    descricao: string;
    nota: string | null;
    prazo: string;
    estado: EstadoPedido;
  }[];
  eventos: {
    tipo: string;
    descricao: string;
    interno: boolean;
    ator_nome: string | null;
    em: Date | string;
  }[];
  conversa: {
    canal: string;
    iniciada_em: Date | string;
    resumo: string | null;
    proximos_passos: string[];
  } | null;
}

/** Eventos mais recentes que entram no contexto (os mais antigos resumem-se). */
const MAX_EVENTOS = 60;
const MAX_TEXTO_EVENTO = 600;

function cortar(t: string, max: number): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Verificação automática do documento ('validade: emitida há 8 meses'). */
function verificacaoCurta(v: unknown): string {
  if (!Array.isArray(v)) return '';
  const falhas = v
    .filter(
      (x): x is { regra?: unknown; ok?: unknown; detalhe?: unknown } =>
        typeof x === 'object' && x !== null,
    )
    .filter((x) => x.ok === false)
    .map((x) =>
      [x.regra, x.detalhe].filter((y) => typeof y === 'string').join(': '),
    )
    .filter(Boolean);
  return falhas.length ? ` (falhou: ${falhas.join('; ')})` : '';
}

/**
 * O processo em texto, por secções. Sem NIF: os campos de NIF do
 * requerimento ficam de fora (só se diz se está registado) e o resto passa
 * por `semNif`.
 */
export function montarContextoProcesso(
  c: ContextoProcesso,
  hoje: string,
): string {
  const l: string[] = [];
  l.push(`Hoje: ${hoje}`);
  l.push(`Processo ${c.numero} · ${c.tipo.codigo} ${c.tipo.nome}`);
  l.push(`Assunto: ${c.assunto}`);
  if (c.morada)
    l.push(`Local: ${c.morada}${c.freguesia ? ` (${c.freguesia})` : ''}`);
  l.push(
    `Fase: ${c.fase_rotulo}${c.decisao ? ` · decisão: ${c.decisao}` : ''}`,
  );
  l.push(`Técnico: ${c.tecnico ?? 'sem técnico atribuído'}`);
  l.push(
    c.prazo.fim
      ? `Prazo da câmara: de ${c.prazo.inicio ?? '?'} a ${c.prazo.fim}` +
          (c.prazo.dias_uteis_restantes !== null
            ? ` (${c.prazo.dias_uteis_restantes} dias úteis restantes)`
            : '')
      : `Prazo da câmara: ainda não começou (conta ${c.tipo.prazo_dias_uteis} dias úteis com o processo completo)`,
  );

  l.push('', '## Requerente');
  if (c.municipe) {
    l.push(
      `${c.municipe.nome ?? 'sem nome'} · contacto: ${
        [
          c.municipe.tem_telefone ? 'telefone' : null,
          c.municipe.tem_email ? 'email' : null,
        ]
          .filter(Boolean)
          .join(' e ') || 'nenhum'
      }`,
    );
  } else {
    l.push('Sem munícipe associado.');
  }

  l.push('', '## Requerimento');
  if (c.requerimento) {
    l.push(
      `Estado: ${c.requerimento.estado}${c.requerimento.assinatura ? ` · assinatura: ${c.requerimento.assinatura}` : ''}`,
    );
    for (const campo of c.requerimento.campos) {
      if (campo.tipo === 'nif') {
        l.push(`- ${campo.rotulo}: ${campo.valor ? 'registado' : 'em falta'}`);
        continue;
      }
      l.push(`- ${campo.rotulo}: ${campo.valor ?? '(por preencher)'}`);
    }
  } else {
    l.push('Sem requerimento.');
  }

  l.push('', '## Documentos entregues');
  if (c.documentos.length) {
    for (const d of c.documentos) {
      l.push(
        `- ${d.tipo_documento ?? 'Documento sem tipo'} · ${d.origem} · recebido ${dia(d.recebido_em)}` +
          `${d.emitido_em ? ` · emitido ${d.emitido_em}` : ''} · verificação: ${d.verificacao_estado}` +
          verificacaoCurta(d.verificacao),
      );
    }
  } else {
    l.push('Nenhum.');
  }

  l.push('', '## Em falta');
  if (c.em_falta.length) {
    for (const f of c.em_falta) {
      l.push(`- ${f.nome}${f.prazo ? ` (pedido, prazo ${f.prazo})` : ''}`);
    }
  } else {
    l.push('Nada.');
  }

  l.push('', '## Pedidos ao munícipe');
  if (c.pedidos.length) {
    for (const p of c.pedidos) {
      l.push(
        `- ${p.descricao}${p.nota ? ` (${p.nota})` : ''} · prazo ${p.prazo} · ${p.estado}`,
      );
    }
  } else {
    l.push('Nenhum.');
  }

  l.push('', '## Linha do tempo');
  const eventos = c.eventos.slice(-MAX_EVENTOS);
  if (c.eventos.length > eventos.length) {
    l.push(
      `(${c.eventos.length - eventos.length} eventos mais antigos omitidos)`,
    );
  }
  for (const e of eventos) {
    l.push(
      `- ${dia(e.em)} · ${e.tipo}${e.interno ? ' (nota interna)' : ''}` +
        `${e.ator_nome ? ` · ${e.ator_nome}` : ''}: ${cortar(e.descricao, MAX_TEXTO_EVENTO)}`,
    );
  }

  l.push('', '## Conversa de origem');
  if (c.conversa) {
    l.push(`${c.conversa.canal} · ${dia(c.conversa.iniciada_em)}`);
    l.push(c.conversa.resumo ?? '(sem resumo)');
    if (c.conversa.proximos_passos.length) {
      l.push(`Próximos passos: ${c.conversa.proximos_passos.join('; ')}`);
    }
  } else {
    l.push('Nenhuma.');
  }

  return semNif(l.join('\n'));
}

// ---------------------------------------------------------------------------
// Resumo do processo
// ---------------------------------------------------------------------------

export const SISTEMA_RESUMO_PROCESSO = `És assistente de um técnico de uma câmara municipal portuguesa.
Recebes um processo administrativo (tipo, fase, prazos, requerimento, documentos e verificação, pedidos ao munícipe, linha do tempo com notas internas, conversa em que o pedido entrou).
Faz o resumo numa página para o técnico perceber o caso sem ler o processo todo.

Regras:
- Português de Portugal, frases curtas e concretas. Sem jargão por explicar.
- Usa só o que está no processo. Se algo não se sabe, diz que não consta; nunca inventes factos, datas, artigos de lei ou nomes.
- Nunca escrevas o NIF nem números de telefone.
- As notas internas contam para o técnico (são da equipa), mas não as cites palavra a palavra se tiverem dados pessoais.
- Datas no formato DD/MM/AAAA.`;

export const esquemaResumoProcesso = z.object({
  o_caso: z
    .string()
    .describe(
      'O caso em 2 a 3 frases: o que o requerente pede, onde, e em que ponto está.',
    ),
  requerente: z
    .string()
    .describe(
      'O essencial sobre o requerente (nome como aparece, qualidade em que pede, como contactar), numa frase. Sem NIF.',
    ),
  o_que_ja_ha: z
    .string()
    .describe(
      'O que já está no processo: requerimento, documentos entregues e se passaram a verificação.',
    ),
  o_que_falta: z
    .string()
    .describe(
      'O que falta (documentos, elementos, pareceres) e de quem depende. "Nada em falta." se for o caso.',
    ),
  prazos: z
    .string()
    .describe(
      'Os prazos em curso numa frase: o próximo prazo, de quem é (câmara ou munícipe) e se está em atraso.',
    ),
  pontos_de_atencao: z
    .array(z.string())
    .describe(
      'De 0 a 5 pontos que o técnico não pode deixar passar (documento rejeitado, prazo a acabar, contradição entre dados, nota interna relevante).',
    ),
  proximo_passo_sugerido: z
    .string()
    .describe('O próximo passo do técnico, numa frase começada por verbo.'),
});

export type ResumoIa = z.output<typeof esquemaResumoProcesso>;

export interface ResumoProcesso {
  o_caso: string;
  requerente: string;
  o_que_ja_ha: string;
  o_que_falta: string;
  prazos: { texto: string; proximo: ProximoPrazo | null };
  pontos_de_atencao: string[];
  proximo_passo_sugerido: string;
}

/**
 * A resposta da IA pronta a guardar: espaços limpos, sem NIF, no máximo 5
 * pontos de atenção. O próximo prazo vem do cálculo (`proximoPrazo`).
 */
export function limparResumo(
  r: ResumoIa,
  proximo: ProximoPrazo | null,
): ResumoProcesso {
  const t = (s: string) => semNif(s.replace(/\s+/g, ' ').trim());
  return {
    o_caso: t(r.o_caso),
    requerente: t(r.requerente),
    o_que_ja_ha: t(r.o_que_ja_ha),
    o_que_falta: t(r.o_que_falta),
    prazos: { texto: t(r.prazos), proximo },
    pontos_de_atencao: r.pontos_de_atencao.map(t).filter(Boolean).slice(0, 5),
    proximo_passo_sugerido: t(r.proximo_passo_sugerido),
  };
}

// ---------------------------------------------------------------------------
// Regulamento aplicável
// ---------------------------------------------------------------------------

export interface TrechoRegulamento {
  trecho_id: string;
  referencia: string | null;
  texto: string;
  fonte: string;
  entidade: string | null;
  url: string;
  /** Quando a versão da fonte foi lida ('AAAA-MM-DD'). */
  data: string | null;
  origem: 'base_legal' | 'pesquisa';
}

export interface Destaque {
  inicio: number;
  fim: number;
}

export interface TrechoDestacado extends TrechoRegulamento {
  porque_se_aplica: string | null;
  destaques: Destaque[];
}

function normalizarTexto(t: string): string {
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Junta as listas (base legal primeiro, depois cada pesquisa) sem
 * repetidos: o mesmo trecho, ou o mesmo texto noutra versão ou fonte.
 */
export function juntarTrechos(
  listas: TrechoRegulamento[][],
  max = 12,
): TrechoRegulamento[] {
  const ids = new Set<string>();
  const textos = new Set<string>();
  const r: TrechoRegulamento[] = [];
  for (const lista of listas) {
    for (const t of lista) {
      const n = normalizarTexto(t.texto);
      if (ids.has(t.trecho_id) || textos.has(n) || !n) continue;
      ids.add(t.trecho_id);
      textos.add(n);
      r.push(t);
      if (r.length >= max) return r;
    }
  }
  return r;
}

/** Os valores do requerimento em texto livre (descrição da obra, etc.). */
export function descricaoDoRequerimento(campos: CampoComValor[]): string {
  return campos
    .filter((c) => c.tipo === 'texto' && c.valor)
    .map((c) => c.valor)
    .join('. ');
}

/**
 * As duas perguntas ao conhecimento: o tipo com o assunto e a descrição; e
 * os pontos do caso (do resumo, se houver, ou o que falta e as notas).
 * Curtas: a pesquisa é por lexemas em OU e uma pergunta enorme acerta em
 * tudo. A segunda só vai se trouxer algo de novo.
 */
export function perguntasRegulamento(d: {
  tipo: string;
  assunto: string;
  descricao: string;
  pontos: string[];
}): string[] {
  const primeira = cortar(
    [d.tipo, d.assunto, d.descricao].filter(Boolean).join('. '),
    300,
  );
  const segunda = cortar(d.pontos.filter(Boolean).join('. '), 300);
  return segunda && normalizarTexto(segunda) !== normalizarTexto(primeira)
    ? [primeira, segunda]
    : [primeira];
}

export const SISTEMA_REGULAMENTO = `És assistente jurídico de um técnico de uma câmara municipal portuguesa.
Recebes um processo resumido e trechos numerados de leis, regulamentos e tabelas (com referência e fonte).
Escolhe os trechos que se aplicam a este processo e, para cada um, explica porquê e indica as frases que o técnico deve ler.

Regras:
- Só trechos que se aplicam de facto a este caso; deixa de fora os que só partilham palavras.
- porque_se_aplica: uma ou duas frases em português de Portugal, sem jargão por explicar.
- frases: copia do texto do trecho, letra a letra (mesma pontuação, maiúsculas e acentos), as frases ou partes de frase a destacar. Nada de paráfrases, reticências nem texto que não esteja lá.
- Não acrescentes regras que não estejam nos trechos.`;

export const esquemaRegulamentoIa = z.object({
  trechos: z
    .array(
      z.object({
        n: z.number().int().describe('O número do trecho na lista.'),
        porque_se_aplica: z.string(),
        frases: z
          .array(z.string())
          .describe('Frases copiadas literalmente do texto do trecho.'),
      }),
    )
    .describe('Só os trechos que se aplicam, do mais ao menos importante.'),
});

export type RegulamentoIa = z.output<typeof esquemaRegulamentoIa>;

export function conteudoRegulamento(
  caso: string,
  trechos: TrechoRegulamento[],
): string {
  return [
    '## Processo',
    caso,
    '',
    '## Trechos',
    ...trechos.map(
      (t, i) =>
        `[${i + 1}] ${t.fonte}${t.referencia ? ` · ${t.referencia}` : ''}\n${t.texto}`,
    ),
  ].join('\n');
}

/**
 * Posições ([inicio, fim[) das frases no texto. Uma frase que não esteja
 * literalmente no texto descarta-se (aceita-se só aparar espaços e aspas
 * à volta). Sobrepostas ou encostadas juntam-se.
 */
export function localizarDestaques(
  texto: string,
  frases: string[],
): Destaque[] {
  const r: Destaque[] = [];
  for (const bruta of frases) {
    const f = bruta
      .trim()
      .replace(/^["'«“]+|["'»”]+$/g, '')
      .trim();
    if (f.length < 3) continue;
    const i = texto.indexOf(f);
    if (i < 0) continue;
    r.push({ inicio: i, fim: i + f.length });
  }
  r.sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
  const juntos: Destaque[] = [];
  for (const d of r) {
    const ultimo = juntos[juntos.length - 1];
    if (ultimo && d.inicio <= ultimo.fim) {
      ultimo.fim = Math.max(ultimo.fim, d.fim);
    } else {
      juntos.push({ ...d });
    }
  }
  return juntos;
}

/**
 * A escolha da IA aplicada aos trechos: só os escolhidos (pela ordem dela),
 * com os destaques validados; a base legal do tipo fica sempre, mesmo que a
 * IA não a escolha (é a regra que a câmara definiu para este tipo).
 * Números fora da lista e repetidos ignoram-se.
 */
export function aplicarEscolha(
  trechos: TrechoRegulamento[],
  escolha: RegulamentoIa,
): TrechoDestacado[] {
  const vistos = new Set<number>();
  const r: TrechoDestacado[] = [];
  for (const e of escolha.trechos) {
    const t = trechos[e.n - 1];
    if (!t || vistos.has(e.n)) continue;
    vistos.add(e.n);
    r.push({
      ...t,
      porque_se_aplica: e.porque_se_aplica.trim() || null,
      destaques: localizarDestaques(t.texto, e.frases),
    });
  }
  trechos.forEach((t, i) => {
    if (t.origem === 'base_legal' && !vistos.has(i + 1)) {
      r.unshift({ ...t, porque_se_aplica: null, destaques: [] });
    }
  });
  return r;
}

/** Sem IA: os trechos tal como vieram, sem destaques. */
export function semDestaques(trechos: TrechoRegulamento[]): TrechoDestacado[] {
  return trechos.map((t) => ({ ...t, porque_se_aplica: null, destaques: [] }));
}

// ---------------------------------------------------------------------------
// Rascunhos
// ---------------------------------------------------------------------------

export const TIPOS_RASCUNHO = [
  'parecer',
  'oficio',
  'pedido_elementos',
  'notificacao_sms',
] as const;
export type TipoRascunho = (typeof TIPOS_RASCUNHO)[number];

export const TIPO_RASCUNHO_ROTULO: Record<TipoRascunho, string> = {
  parecer: 'Parecer técnico',
  oficio: 'Ofício',
  pedido_elementos: 'Pedido de elementos',
  notificacao_sms: 'Notificação por SMS',
};

/**
 * Canal de `modelos_resposta` que serve cada tipo de rascunho. O parecer é
 * interno: só usa um modelo se o técnico o escolher.
 */
export const CANAL_MODELO: Record<TipoRascunho, 'oficio' | 'sms'> = {
  parecer: 'oficio',
  oficio: 'oficio',
  pedido_elementos: 'oficio',
  notificacao_sms: 'sms',
};

const REGRAS_COMUNS = `Regras:
- Português de Portugal, formal mas claro: o requerente tem de perceber à primeira leitura o que se passa e o que tem de fazer.
- Sem jargão por explicar: se usares um termo técnico ou jurídico, explica-o em poucas palavras.
- Cita os artigos que fundamentam (ex.: "nos termos do art. 11.º do RJUE") só a partir dos trechos de regulamento que recebes. Nunca inventes artigos, prazos, valores nem factos.
- Se recebes um modelo aprovado da câmara, segue a estrutura e as fórmulas dele, preenchendo os campos entre chavetas com os dados do processo.
- Se faltar um dado, escreve [a completar pelo técnico] em vez de o inventar.
- As verificações automáticas são indícios para o técnico: usa-as, mas o que vem da leitura da IA está por confirmar e o que é simulado ou de demonstração não se afirma como verificado. Nunca as apresentes como decisão.
- Responde só com o texto do documento, sem comentários nem markdown.`;

/** Instruções fixas por tipo (ficam em cache). */
export const SISTEMA_RASCUNHO: Record<TipoRascunho, string> = {
  parecer: `Rediges pareceres técnicos internos de uma câmara municipal portuguesa sobre um processo de obras, para o técnico rever e assinar. O parecer vai à chefia que decide, não ao requerente.
Estrutura, por esta ordem:
PARECER TÉCNICO
Processo (n.º) · (tipo de processo)
Requerente: (nome) · Local: (morada)
1. Objeto: o que se pede, numa ou duas frases.
2. Enquadramento: o regime aplicável e se o processo está instruído com os elementos exigidos. Cita os trechos de regulamento pelo número entre parênteses retos, como vêm na lista ([1], [2]).
3. Apreciação: o que se verificou. Cada verificação em ATENÇÃO ou FALHA tem de aparecer aqui, com o que se recomenda (por exemplo, confirmar com o técnico autor antes da decisão). O que veio da leitura da IA diz-se "o projeto identifica…", nunca como facto verificado pela câmara.
4. Proposta: admissão, admissão condicionada, pedido de elementos ou indeferimento. Com pontos em ATENÇÃO, a admissão fica condicionada à confirmação referida no ponto 3. Com FALHA (por exemplo, um documento em falta), propõe pedir os elementos em falta em vez de admitir.
Fecha com "O Técnico" para a assinatura. A data e o cabeçalho do município são acrescentados à parte.
${REGRAS_COMUNS}`,
  oficio: `Rediges ofícios de uma câmara municipal portuguesa dirigidos ao requerente de um processo, para o técnico rever e aprovar.
Estrutura: destinatário, assunto com o n.º do processo, corpo (o que se comunica e com que fundamento, o que o requerente tem de fazer, se alguma coisa), fecho cordial e a indicação "O Técnico" para a assinatura. A data e o cabeçalho do município são acrescentados à parte.
${REGRAS_COMUNS}`,
  pedido_elementos: `Rediges pedidos de elementos de uma câmara municipal portuguesa: o ofício que pede ao requerente os documentos ou elementos em falta num processo, para o técnico rever e aprovar.
Estrutura: destinatário, assunto com o n.º do processo, o que falta (lista numerada, cada elemento com uma frase simples a dizer o que é e para que serve), o prazo para entregar em dias úteis a contar da notificação, como entregar (pelo link do processo que recebe por SMS ou email, ou no balcão), o que acontece se não entregar (só se constar dos trechos de regulamento), fecho cordial e "O Técnico" para a assinatura.
${REGRAS_COMUNS}`,
  notificacao_sms: `Rediges SMS de uma câmara municipal portuguesa ao requerente de um processo, para o técnico rever e aprovar.
O SMS começa pelo nome da câmara, diz o n.º do processo e o essencial numa ou duas frases. No máximo 300 caracteres. Sem links (o link do processo é acrescentado à parte). Sem citar artigos.
${REGRAS_COMUNS}`,
};

export interface DadosRascunho {
  tipo: TipoRascunho;
  municipio: string;
  /** Resumo do processo em texto (montarContextoProcesso). */
  processo: string;
  /** Nome completo do requerente (o documento é dirigido a ele). */
  destinatario: string | null;
  regulamento: TrechoDestacado[];
  modelo: { nome: string; corpo: string } | null;
  documentos_pedidos: { nome: string }[];
  prazo_dias_uteis: number | null;
  instrucoes: string | null;
  /** As verificações automáticas do processo (null = não foram feitas). */
  verificacoes?: Verificacao[] | null;
}

/** Os trechos com as frases destacadas marcadas »assim«. */
function trechoComDestaques(t: TrechoDestacado): string {
  let s = '';
  let i = 0;
  for (const d of t.destaques) {
    s += `${t.texto.slice(i, d.inicio)}»${t.texto.slice(d.inicio, d.fim)}«`;
    i = d.fim;
  }
  return s + t.texto.slice(i);
}

export function conteudoRascunho(d: DadosRascunho): string {
  const l: string[] = [
    `Câmara: ${d.municipio}`,
    `Destinatário: ${d.destinatario ?? '[nome do requerente]'}`,
    '',
    '## Processo',
    d.processo,
    '',
    '## Regulamento aplicável',
  ];
  if (d.regulamento.length) {
    for (const [i, t] of d.regulamento.entries()) {
      l.push(
        `[${i + 1}] ${t.fonte}${t.referencia ? ` · ${t.referencia}` : ''}` +
          `${t.porque_se_aplica ? ` (${t.porque_se_aplica})` : ''}:\n  ${trechoComDestaques(t)}`,
      );
    }
  } else {
    l.push('Nenhum trecho encontrado: não cites artigos.');
  }
  l.push('', '## Verificações automáticas');
  l.push(
    d.verificacoes
      ? verificacoesEmTexto(d.verificacoes)
      : 'Não foram feitas: não digas que algo foi verificado.',
  );
  if (d.tipo === 'pedido_elementos') {
    l.push('', '## Elementos a pedir');
    for (const x of d.documentos_pedidos) l.push(`- ${x.nome}`);
    l.push(`Prazo: ${d.prazo_dias_uteis ?? 10} dias úteis`);
  }
  l.push('', '## Modelo aprovado da câmara');
  l.push(d.modelo ? `${d.modelo.nome}\n${d.modelo.corpo}` : 'Nenhum.');
  if (d.instrucoes) {
    l.push('', '## Instruções do técnico', d.instrucoes);
  }
  return l.join('\n');
}

/** Tira cercas de código e espaços a mais; o SMS fica numa linha. */
export function limparRascunho(texto: string, tipo: TipoRascunho): string {
  const s = texto
    .replace(/^```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tipo === 'notificacao_sms' ? s.replace(/\s+/g, ' ') : s;
}

/** As referências do regulamento citadas no corpo ('art. 11.º' aparece no texto). */
export function artigosCitados(
  corpo: string,
  trechos: { referencia: string | null; fonte: string }[],
): { referencia: string; fonte: string }[] {
  const c = normalizarTexto(corpo);
  const r: { referencia: string; fonte: string }[] = [];
  for (const t of trechos) {
    if (!t.referencia) continue;
    // 'art. 6.º, n.º 1' → procura-se o artigo ('art. 6.º').
    const artigo = normalizarTexto(t.referencia.split(',')[0]);
    if (artigo && c.includes(artigo)) {
      if (!r.some((x) => x.referencia === t.referencia && x.fonte === t.fonte))
        r.push({ referencia: t.referencia, fonte: t.fonte });
    }
  }
  return r;
}

/** O SMS leva o link do processo no fim (a IA não o conhece). */
export function smsComLink(corpo: string, link: string): string {
  return corpo.includes(link) ? corpo : `${corpo.trim()} ${link}`;
}
