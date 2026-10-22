/*
 * "Não percebi esta carta da câmara" (o requerimento ao contrário): regras
 * puras, sem BD. A IA lê a carta (fotografia ou PDF) e devolve o que lá está,
 * cada coisa com o excerto de onde veio; aqui valida-se essa leitura (nunca
 * se aceita um prazo que o excerto não sustente), calcula-se a data-limite
 * por nós (dias úteis, feriados, CPA), escolhe-se o processo a que a carta
 * pertence, tiram-se dados pessoais do que se guarda e preparam-se os
 * rascunhos de resposta.
 */
import { z } from 'zod';
import {
  diasUteisEntre,
  eDiaUtil,
  Feriados,
  somarDiasUteis,
} from '../../common/dias-uteis.js';
import { nifValido } from '../municipes/municipes.service.js';
import { correspondeNumero, lerNumero } from '../processos/regras.js';

// ---------------------------------------------------------------------------
// Tipos de carta
// ---------------------------------------------------------------------------

export const TIPOS_CARTA = [
  'audiencia_previa',
  'pedido_elementos',
  'decisao',
  'liquidacao_taxa',
  'contraordenacao',
  'convocatoria',
  'ordem',
  'edital',
  'outro',
] as const;
export type TipoCarta = (typeof TIPOS_CARTA)[number];

export const TIPOS_RESPOSTA = [
  'pronuncia',
  'prorrogacao',
  'elementos',
  'pagamento',
] as const;
export type TipoResposta = (typeof TIPOS_RESPOSTA)[number];

export const TIPOS_ENTIDADE = [
  'camara',
  'junta_freguesia',
  'financas',
  'seguranca_social',
  'tribunal',
  'outra_publica',
  'privada',
  'desconhecida',
] as const;
export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];

interface InfoTipo {
  rotulo: string;
  /** O que é, por palavras simples (completa a explicação da IA). */
  o_que_e: string;
  /**
   * O que costuma acontecer se a pessoa não fizer nada, quando a carta não o
   * diz. É regra geral (não é o que a carta diz): o ecrã e o agente dizem-no.
   */
  se_nada: string;
  respostas: TipoResposta[];
}

export const TIPOS: Record<TipoCarta, InfoTipo> = {
  audiencia_previa: {
    rotulo: 'Notificação para audiência prévia',
    o_que_e:
      'A câmara diz-lhe o que pensa decidir (muitas vezes, recusar o pedido) e porquê, antes de decidir. Pode responder por escrito a dizer porque não concorda.',
    se_nada:
      'A câmara decide sem ouvir a sua versão, normalmente como já disse na carta.',
    respostas: ['pronuncia', 'prorrogacao'],
  },
  pedido_elementos: {
    rotulo: 'Pedido de documentos em falta',
    o_que_e:
      'Falta algum documento ou informação no seu pedido. A câmara só continua a analisar quando o receber.',
    se_nada:
      'O processo fica parado e pode ser rejeitado ou arquivado por falta dos documentos.',
    respostas: ['elementos', 'prorrogacao'],
  },
  decisao: {
    rotulo: 'Decisão sobre o seu pedido',
    o_que_e: 'A câmara comunica a decisão sobre o seu pedido.',
    se_nada:
      'A decisão mantém-se. Se não concordar, pode reclamar ou recorrer: confirme o prazo com a câmara.',
    respostas: [],
  },
  liquidacao_taxa: {
    rotulo: 'Taxa para pagar',
    o_que_e:
      'A câmara calculou uma taxa que tem de pagar, normalmente para o pedido seguir ou para receber a licença.',
    se_nada:
      'O valor fica em dívida e o pedido pode não avançar; pode haver juros ou cobrança. Confirme com a câmara.',
    respostas: ['pagamento'],
  },
  contraordenacao: {
    rotulo: 'Notificação de contraordenação (coima)',
    o_que_e:
      'A câmara acha que houve uma infração e pode aplicar uma coima. Pode apresentar a sua defesa por escrito.',
    se_nada: 'O processo segue sem a sua defesa e pode ter de pagar a coima.',
    respostas: ['pronuncia', 'pagamento'],
  },
  convocatoria: {
    rotulo: 'Convocatória',
    o_que_e:
      'A câmara chama-o para uma reunião, vistoria ou atendimento num dia e hora.',
    se_nada:
      'A reunião ou vistoria pode fazer-se sem si, ou o seu pedido pode atrasar.',
    respostas: ['prorrogacao'],
  },
  ordem: {
    rotulo: 'Ordem da câmara (fazer ou parar alguma coisa)',
    o_que_e:
      'A câmara manda fazer (ou parar) alguma coisa, por exemplo obras de conservação ou limpar um terreno, até uma data.',
    se_nada:
      'A câmara pode fazer o trabalho e cobrar-lhe, ou aplicar uma coima. Confirme com a câmara.',
    respostas: ['pronuncia', 'prorrogacao'],
  },
  edital: {
    rotulo: 'Edital (aviso público)',
    o_que_e:
      'Um aviso oficial para todos ficarem a saber de uma decisão, prazo ou consulta.',
    se_nada:
      'Normalmente não tem de fazer nada: é informação. Se quiser dar a sua opinião, veja o prazo.',
    respostas: [],
  },
  outro: {
    rotulo: 'Carta da câmara',
    o_que_e: 'Uma comunicação da câmara.',
    se_nada: 'Não conseguimos dizer o que acontece: pergunte à câmara.',
    respostas: [],
  },
};

export const ROTULO_RESPOSTA: Record<TipoResposta, string> = {
  pronuncia: 'Responder por escrito (pronúncia)',
  prorrogacao: 'Pedir mais tempo',
  elementos: 'Enviar os documentos pedidos',
  pagamento: 'Pagar',
};

/** Onde se diz que regra de contagem se usou (só os artigos que temos à mão). */
export const FONTE_CONTAGEM =
  'Código do Procedimento Administrativo, art. 87.º';
export const FONTE_AUDIENCIA =
  'Código do Procedimento Administrativo, arts. 121.º e 122.º';

// ---------------------------------------------------------------------------
// O que a IA devolve (saída estruturada)
// ---------------------------------------------------------------------------

const comExcerto = <T extends z.ZodType>(valor: T, o_que: string) =>
  z.object({
    valor: valor.describe(o_que),
    excerto: z
      .string()
      .nullable()
      .describe(
        'O excerto exato (copiado) do documento de onde se tirou o valor; null se não está no documento.',
      ),
  });

export const esquemaLeituraCarta = z.object({
  legivel: z
    .boolean()
    .describe('Se o texto se lê (não está desfocado, cortado ou escuro).'),
  motivo_ilegivel: z
    .string()
    .nullable()
    .describe(
      'Se não se lê: como tirar outra fotografia, em português de Portugal. Senão null.',
    ),
  entidade_emissora: z
    .string()
    .nullable()
    .describe(
      'Quem escreveu a carta, como está no cabeçalho (ex.: "Câmara Municipal de Guimarães", "Autoridade Tributária e Aduaneira").',
    ),
  tipo_entidade: z
    .enum(TIPOS_ENTIDADE)
    .describe(
      'camara se é da câmara municipal (ou dos seus serviços); junta_freguesia; financas (AT); seguranca_social; tribunal; outra_publica; privada; desconhecida.',
    ),
  tipo: z
    .enum(TIPOS_CARTA)
    .describe(
      'audiencia_previa (projeto de decisão para se pronunciar), pedido_elementos (faltam documentos), decisao, liquidacao_taxa (taxa a pagar), contraordenacao (coima), convocatoria, ordem (obras, limpeza, demolição), edital, outro.',
    ),
  assunto: z
    .string()
    .describe('O assunto em poucas palavras ("Porta na cozinha").'),
  referencia: comExcerto(
    z.string().nullable(),
    'O número do processo ou a referência da carta (ex.: "CP 412/2026"); null se não há.',
  ),
  data_documento: comExcerto(
    z.string().nullable(),
    'A data da carta em AAAA-MM-DD; null se não há.',
  ),
  data_notificacao: comExcerto(
    z.string().nullable(),
    'A data em que a pessoa foi notificada ou recebeu (carimbo, aviso de receção, data de envio por email) em AAAA-MM-DD; null se não aparece. Não uses a data da carta.',
  ),
  prazo: z.object({
    dias: z
      .number()
      .int()
      .nullable()
      .describe('O número de dias do prazo como está escrito; null se não há.'),
    unidade: z
      .enum(['uteis', 'corridos', 'nao_diz'])
      .nullable()
      .describe(
        'uteis se diz "dias úteis", corridos se diz "dias seguidos/corridos/de calendário", nao_diz se só diz "dias".',
      ),
    data_limite_escrita: z
      .string()
      .nullable()
      .describe(
        'Se a carta diz uma data-limite ("até 30 de outubro de 2026"), em AAAA-MM-DD; senão null.',
      ),
    a_contar_de: z
      .enum(['notificacao', 'data_documento', 'outro'])
      .nullable()
      .describe(
        'De quando conta o prazo, como a carta diz; notificacao se diz "a contar da notificação/receção" ou não diz.',
      ),
    base_legal: z
      .string()
      .nullable()
      .describe(
        'A lei ou artigo que a carta cita para o prazo (ex.: "artigos 121.º e 122.º do CPA"); null se não cita.',
      ),
    excerto: z
      .string()
      .nullable()
      .describe(
        'O excerto exato com o prazo; null se a carta não tem prazo. Não inventes.',
      ),
  }),
  pedido: z
    .array(
      z.object({
        o_que: z.string().describe('O que a câmara pede, em palavras simples.'),
        excerto: z.string().describe('O excerto do documento.'),
      }),
    )
    .describe('O que a pessoa tem de fazer ou entregar (pode ser vazio).'),
  valores: z
    .array(
      z.object({
        descricao: z.string(),
        valor_cent: z.number().int().describe('Em cêntimos.'),
        referencia_mb: z
          .string()
          .nullable()
          .describe(
            'Entidade e referência Multibanco se aparecem; senão null.',
          ),
        excerto: z.string(),
      }),
    )
    .describe('Valores a pagar que aparecem na carta (pode ser vazio).'),
  consequencias: z
    .array(
      z.object({
        texto: z
          .string()
          .describe('O que acontece se não responder, em palavras simples.'),
        excerto: z.string(),
      }),
    )
    .describe(
      'Só as consequências que a CARTA diz (ex.: "o pedido será indeferido"). Vazio se não diz.',
    ),
  explicacao: z
    .string()
    .describe(
      'Explicação para o munícipe: 2 a 4 frases curtas, em português de Portugal, sem jargão, a dizer o que é a carta e o que pede. Sem nomes, NIF nem moradas.',
    ),
});

export type LeituraCarta = z.infer<typeof esquemaLeituraCarta>;

export const SISTEMA_LEITURA = `És o assistente de atendimento de uma câmara municipal portuguesa.
Um munícipe enviou a fotografia (ou o PDF) de uma carta que recebeu e que não percebe: um ofício, notificação, edital ou guia.
Lê a carta e preenche os campos, SÓ com o que lá está escrito:
- Cada valor vem com o excerto exato do documento de onde o tiraste. Se não está no documento, o valor é null e o excerto também. Nunca inventes datas, prazos, valores nem números.
- O prazo é o que a carta diz ("no prazo de 10 dias úteis a contar da notificação"). Não calcules a data-limite: isso é feito depois. Se a carta não diz prazo, dias e excerto são null.
- A data de notificação é a de receção (carimbo, aviso de receção), nunca a data da carta.
- tipo_entidade: se a carta não é da câmara municipal (Finanças, Segurança Social, tribunal, uma empresa), diz qual é.
- A explicação é para uma pessoa sem formação jurídica: frases curtas, palavras simples, português de Portugal, sem repetir dados pessoais (nomes, NIF, moradas, telefones).
- Se não se lê bem, legivel: false e diz em motivo_ilegivel como tirar outra fotografia (mais luz, a carta toda, sem reflexos).`;

// ---------------------------------------------------------------------------
// Datas e números
// ---------------------------------------------------------------------------

/** 'AAAA-MM-DD' válido (e plausível: 2000–2100), senão null. */
export function dataIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100 || me < 1 || me > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(a, me - 1, d));
  if (dt.getUTCMonth() !== me - 1) return null;
  return s.trim();
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round(
    (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) /
      86_400_000,
  );
}

const UNIDADES = [
  '',
  'um',
  'dois',
  'tres',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quinze',
  'dezasseis',
  'dezassete',
  'dezoito',
  'dezanove',
];
const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];

/** Formas por extenso de 1 a 120 ("dez", "vinte e cinco", "noventa"). */
export function porExtenso(n: number): string[] {
  if (!Number.isInteger(n) || n < 1 || n > 120) return [];
  const formas: string[] = [];
  if (n < 20) formas.push(UNIDADES[n]);
  else if (n < 100) {
    const d = DEZENAS[Math.floor(n / 10)];
    const u = n % 10;
    formas.push(u ? `${d} e ${UNIDADES[u]}` : d);
  } else if (n === 100) formas.push('cem');
  else formas.push(`cento e ${porExtenso(n - 100)[0]}`);
  // Variantes: "uma", "duas", "quatorze", "dezesseis/dezessete/dezenove".
  return formas.flatMap((f) => {
    const v = [f];
    if (/\bum$/.test(f)) v.push(f.replace(/um$/, 'uma'));
    if (/\bdois$/.test(f)) v.push(f.replace(/dois$/, 'duas'));
    if (f === 'catorze') v.push('quatorze');
    if (f === 'dezasseis') v.push('dezesseis');
    if (f === 'dezassete') v.push('dezessete');
    if (f === 'dezanove') v.push('dezenove');
    return v;
  });
}

function semAcentos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * O excerto sustenta "n dias"? Tem de ter o número (em algarismos ou por
 * extenso) e a palavra "dia". Assim um prazo que a IA "deduziu" sem estar
 * escrito não passa.
 */
export function excertoTemDias(excerto: string | null, n: number): boolean {
  if (!excerto) return false;
  const t = semAcentos(excerto);
  if (!/\bdias?\b/.test(t)) return false;
  if (new RegExp(`(^|\\D)${n}(\\D|$)`).test(t)) return true;
  return porExtenso(n).some((f) =>
    new RegExp(`(^|[^a-z])${f}([^a-z]|$)`).test(t),
  );
}

// ---------------------------------------------------------------------------
// Dados pessoais
// ---------------------------------------------------------------------------

/**
 * Tira de um texto os dados pessoais que não precisamos de guardar nem de
 * mostrar: NIF (9 algarismos com controlo válido, salvo referências
 * Multibanco), email, telefone, IBAN e n.º do cartão de cidadão. O que fica
 * (assunto, prazo, número do processo) é o que serve para explicar a carta.
 */
export function ocultarDadosPessoais(texto: string): string {
  return (
    texto
      // IBAN (PT50 0000 0000 0000 0000 0000 0)
      .replace(/\b[A-Z]{2}\d{2}(?:[ ]?\d{4}){4,7}(?:[ ]?\d{1,4})?\b/g, '[IBAN]')
      // Email
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
      // Cartão de cidadão: 8 algarismos + 1 + 2 letras + 1 ("12345678 9 ZZ1")
      .replace(/\b\d{8}\s?\d\s?[A-Z]{2}\d\b/g, '[n.º do cartão de cidadão]')
      // NIF com "NIF"/"contribuinte" antes: sempre.
      .replace(
        /\b\d{3}[\s.]?\d{3}[\s.]?\d{3}\b/g,
        (m, offset: number, todo: string) =>
          contexto(todo, offset, /(nif|nipc|contribuinte|fiscal)\D{0,8}$/)
            ? '[NIF]'
            : m,
      )
      // Telefones portugueses (+351 912 345 678, 253 000 000)
      .replace(
        /(?:\+351[\s-]?)?\b(?:9[1236]\d|2\d{2})[\s-]?\d{3}[\s-]?\d{3}\b/g,
        (m, offset: number, todo: string) =>
          contexto(todo, offset, REFERENCIAS) ? m : '[telefone]',
      )
      // Outros 9 algarismos com o controlo de um NIF (salvo referências).
      .replace(
        /\b\d{3}[\s.]?\d{3}[\s.]?\d{3}\b/g,
        (m, offset: number, todo: string) =>
          !contexto(todo, offset, REFERENCIAS) &&
          nifValido(m.replace(/\D/g, ''))
            ? '[NIF]'
            : m,
      )
  );
}

/** Palavras que dizem que o número é uma referência, não um dado pessoal. */
const REFERENCIAS = /(refer|entidade|multibanco|\bmb\b|guia|processo|oficio)/;

/** Os 30 caracteres antes do número falam de `padrao`? */
function contexto(todo: string, offset: number, padrao: RegExp): boolean {
  return padrao.test(semAcentos(todo.slice(Math.max(0, offset - 30), offset)));
}

// ---------------------------------------------------------------------------
// Validar a leitura
// ---------------------------------------------------------------------------

export interface Excerto<T> {
  valor: T;
  excerto: string | null;
}

export interface LeituraValidada {
  legivel: boolean;
  motivo_ilegivel: string | null;
  entidade_emissora: string | null;
  tipo_entidade: TipoEntidade;
  da_camara: boolean;
  tipo: TipoCarta;
  tipo_rotulo: string;
  assunto: string;
  referencia: Excerto<string | null>;
  data_documento: Excerto<string | null>;
  data_notificacao: Excerto<string | null>;
  prazo: {
    /** Só true quando o excerto sustenta os dias (ou a data escrita). */
    encontrado: boolean;
    dias: number | null;
    unidade: 'uteis' | 'corridos' | 'nao_diz' | null;
    data_limite_escrita: string | null;
    a_contar_de: 'notificacao' | 'data_documento' | 'outro' | null;
    base_legal: string | null;
    excerto: string | null;
    /** O que se descartou da IA e porquê (para o painel e testes). */
    descartado: string | null;
  };
  pedido: { o_que: string; excerto: string }[];
  valores: {
    descricao: string;
    valor_cent: number;
    referencia_mb: string | null;
    excerto: string;
  }[];
  consequencias: {
    texto: string;
    excerto: string | null;
    origem: 'carta' | 'regra_geral';
  }[];
  explicacao: string;
  o_que_e: string;
}

/** As entidades municipais: câmara e serviços da câmara. */
function daCamara(l: LeituraCarta, nomeMunicipio: string | null): boolean {
  if (l.tipo_entidade === 'camara') return true;
  if (l.tipo_entidade !== 'desconhecida') return false;
  const e = semAcentos(l.entidade_emissora ?? '');
  return (
    /camara municipal|municipio de/.test(e) ||
    (!!nomeMunicipio && e.includes(semAcentos(nomeMunicipio)))
  );
}

const MAX_TEXTO = 600;
const curto = (s: string) => ocultarDadosPessoais(s.trim()).slice(0, MAX_TEXTO);
const curtoOuNull = (s: string | null) => (s && s.trim() ? curto(s) : null);

/**
 * Da leitura da IA ao que guardamos e mostramos: datas válidas, prazo só
 * com excerto que o sustente (senão "não encontrado"), valores positivos,
 * consequências da carta (ou a regra geral, marcada como tal) e sem dados
 * pessoais nos textos.
 */
export function validarLeitura(
  l: LeituraCarta,
  nomeMunicipio: string | null = null,
): LeituraValidada {
  const info = TIPOS[l.tipo] ?? TIPOS.outro;
  const dataComExcerto = (x: {
    valor: string | null;
    excerto: string | null;
  }) => {
    const valor = dataIso(x.valor);
    return { valor, excerto: valor ? curtoOuNull(x.excerto) : null };
  };

  // Prazo: nunca inventado. Dias plausíveis e sustentados pelo excerto, ou
  // uma data-limite escrita com excerto.
  let descartado: string | null = null;
  let dias =
    l.prazo.dias !== null && l.prazo.dias >= 1 && l.prazo.dias <= 365
      ? l.prazo.dias
      : null;
  if (l.prazo.dias !== null && dias === null) {
    descartado = `dias fora do plausível (${l.prazo.dias})`;
  }
  if (dias !== null && !excertoTemDias(l.prazo.excerto, dias)) {
    descartado = `o excerto não diz ${dias} dias`;
    dias = null;
  }
  let dataEscrita = dataIso(l.prazo.data_limite_escrita);
  if (dataEscrita && !l.prazo.excerto) {
    descartado = 'data-limite sem excerto';
    dataEscrita = null;
  }
  const encontrado = dias !== null || dataEscrita !== null;

  const consequencias: LeituraValidada['consequencias'] = l.consequencias
    .filter((c) => c.texto.trim() && c.excerto.trim())
    .slice(0, 5)
    .map((c) => ({
      texto: curto(c.texto),
      excerto: curto(c.excerto),
      origem: 'carta' as const,
    }));
  if (!consequencias.length) {
    consequencias.push({
      texto: info.se_nada,
      excerto: null,
      origem: 'regra_geral',
    });
  }

  return {
    legivel: l.legivel,
    motivo_ilegivel: l.legivel ? null : curtoOuNull(l.motivo_ilegivel),
    entidade_emissora: curtoOuNull(l.entidade_emissora),
    tipo_entidade: l.tipo_entidade,
    da_camara: daCamara(l, nomeMunicipio),
    tipo: l.tipo,
    tipo_rotulo: info.rotulo,
    assunto: curto(l.assunto || info.rotulo).slice(0, 160),
    referencia: {
      valor: l.referencia.valor?.trim()
        ? l.referencia.valor.trim().slice(0, 60)
        : null,
      excerto: curtoOuNull(l.referencia.excerto),
    },
    data_documento: dataComExcerto(l.data_documento),
    data_notificacao: dataComExcerto(l.data_notificacao),
    prazo: {
      encontrado,
      dias,
      unidade: dias !== null ? (l.prazo.unidade ?? 'nao_diz') : null,
      data_limite_escrita: dataEscrita,
      a_contar_de:
        dias !== null ? (l.prazo.a_contar_de ?? 'notificacao') : null,
      base_legal: encontrado ? curtoOuNull(l.prazo.base_legal) : null,
      excerto: encontrado ? curtoOuNull(l.prazo.excerto) : null,
      descartado,
    },
    pedido: l.pedido
      .filter((p) => p.o_que.trim())
      .slice(0, 10)
      .map((p) => ({ o_que: curto(p.o_que), excerto: curto(p.excerto) })),
    valores: l.valores
      .filter((v) => Number.isInteger(v.valor_cent) && v.valor_cent > 0)
      .slice(0, 5)
      .map((v) => ({
        descricao: curto(v.descricao),
        valor_cent: v.valor_cent,
        referencia_mb: v.referencia_mb?.trim() || null,
        excerto: curto(v.excerto),
      })),
    consequencias,
    explicacao: curto(l.explicacao),
    o_que_e: info.o_que_e,
  };
}

// ---------------------------------------------------------------------------
// Prazo (calculado por nós)
// ---------------------------------------------------------------------------

export interface CalculoPrazo {
  /**
   * calculado: há data-limite. sem_prazo: a carta não tem prazo (não se
   * inventa). falta_data: há dias mas não sabemos quando foi notificado.
   */
  estado: 'calculado' | 'sem_prazo' | 'falta_data';
  inicio: string | null;
  /** De onde veio o início: notificação lida, data dita pela pessoa, data da carta. */
  inicio_origem: 'notificacao' | 'rececao_dita' | 'data_documento' | null;
  data_limite: string | null;
  dias: number | null;
  unidade: 'uteis' | 'corridos' | null;
  /** Dias úteis de hoje até ao limite (0 = é hoje; negativo = já passou). */
  faltam_dias_uteis: number | null;
  faltam_dias: number | null;
  terminou: boolean;
  /** Como se contou, em palavras. */
  regra: string;
  fontes: string[];
}

/**
 * A data-limite. Dias úteis: não contam sábados, domingos nem feriados, nem o
 * dia da notificação. Dias corridos: contam todos, mas se o último calhar num
 * dia não útil passa para o dia útil seguinte. Só "dias": a regra geral do
 * CPA é contar dias úteis. Uma data escrita na carta vale como está.
 */
export function calcularPrazo(e: {
  prazo: LeituraValidada['prazo'];
  dataNotificacao: string | null;
  dataDocumento: string | null;
  dataRececaoDita: string | null;
  hoje: string;
  feriados: Feriados;
}): CalculoPrazo {
  const vazio = {
    inicio: null,
    inicio_origem: null,
    data_limite: null,
    dias: e.prazo.dias,
    unidade: null,
    faltam_dias_uteis: null,
    faltam_dias: null,
    terminou: false,
    fontes: [] as string[],
  };
  const fim = (
    limite: string,
    regra: string,
    o: Partial<CalculoPrazo>,
  ): CalculoPrazo => {
    const faltamUteis = diasUteisEntre(e.hoje, limite, e.feriados);
    return {
      ...vazio,
      ...o,
      estado: 'calculado',
      data_limite: limite,
      faltam_dias_uteis: faltamUteis,
      faltam_dias: diasEntre(e.hoje, limite),
      terminou: limite < e.hoje,
      regra,
    };
  };

  if (e.prazo.data_limite_escrita) {
    return fim(e.prazo.data_limite_escrita, 'Data-limite escrita na carta.', {
      fontes: e.prazo.base_legal ? [e.prazo.base_legal] : [],
    });
  }
  if (!e.prazo.dias) {
    return {
      ...vazio,
      estado: 'sem_prazo',
      regra: 'A carta não diz um prazo.',
    };
  }

  let inicio: string | null = null;
  let origem: CalculoPrazo['inicio_origem'] = null;
  if (e.prazo.a_contar_de === 'data_documento' && e.dataDocumento) {
    inicio = e.dataDocumento;
    origem = 'data_documento';
  } else if (e.dataRececaoDita) {
    inicio = e.dataRececaoDita;
    origem = 'rececao_dita';
  } else if (e.dataNotificacao) {
    inicio = e.dataNotificacao;
    origem = 'notificacao';
  }
  const unidade = e.prazo.unidade === 'corridos' ? 'corridos' : 'uteis';
  const fontes = [
    ...(e.prazo.base_legal ? [e.prazo.base_legal] : []),
    FONTE_CONTAGEM,
  ];
  if (!inicio) {
    return {
      ...vazio,
      estado: 'falta_data',
      unidade,
      fontes,
      regra: `${e.prazo.dias} dias ${unidade === 'uteis' ? 'úteis' : 'seguidos'} a contar do dia em que recebeu a carta, que não sabemos.`,
    };
  }

  let limite: string;
  let regra: string;
  if (unidade === 'uteis') {
    limite = somarDiasUteis(inicio, e.prazo.dias, e.feriados);
    regra =
      e.prazo.unidade === 'nao_diz'
        ? `A carta diz ${e.prazo.dias} dias sem dizer de que tipo: pela regra geral do CPA contam-se dias úteis (sem sábados, domingos e feriados), a partir do dia seguinte ao da notificação.`
        : `${e.prazo.dias} dias úteis (sem sábados, domingos e feriados), a partir do dia seguinte ao da notificação.`;
  } else {
    limite = somarDias(inicio, e.prazo.dias);
    regra = `${e.prazo.dias} dias seguidos a partir do dia seguinte ao da notificação`;
    if (!eDiaUtil(limite, e.feriados)) {
      limite = somarDiasUteis(limite, 1, e.feriados);
      regra +=
        '; o último calha num dia sem serviço e passa para o dia útil seguinte.';
    } else regra += '.';
  }
  return fim(limite, regra, {
    inicio,
    inicio_origem: origem,
    dias: e.prazo.dias,
    unidade,
    fontes,
  });
}

/** "faltam 6 dias úteis (até 3 de novembro)", "termina hoje", "já terminou". */
export function fraseFaltam(p: CalculoPrazo): string | null {
  if (p.estado !== 'calculado' || !p.data_limite) return null;
  const dia = diaPorExtenso(p.data_limite);
  if (p.terminou) return `O prazo já terminou a ${dia}.`;
  if (p.faltam_dias === 0) return `O prazo termina hoje, ${dia}.`;
  const n = p.faltam_dias_uteis ?? 0;
  return `Faltam ${n} ${n === 1 ? 'dia útil' : 'dias úteis'}: o prazo termina a ${dia}.`;
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

/** '2026-11-03' → '3 de novembro'. */
export function diaPorExtenso(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

// ---------------------------------------------------------------------------
// Ligar ao processo
// ---------------------------------------------------------------------------

export interface CandidatoProcesso {
  id: string;
  numero: string;
  municipe_id: string | null;
}

export type Ligacao =
  | { tipo: 'ligado'; processoId: string; numero: string }
  /** A referência é de um processo nosso, mas não sabemos quem é a pessoa. */
  | { tipo: 'precisa_identificacao' }
  /** É de um processo de outra pessoa (não se diz nada dele). */
  | { tipo: 'de_outro' }
  | { tipo: 'solto' };

/**
 * A carta é de um processo da câmara desta pessoa? Só se liga com a pessoa
 * identificada e dona do processo; de outra pessoa não se revela nada.
 */
export function escolherProcesso(
  referencia: string | null,
  municipeId: string | null,
  candidatos: CandidatoProcesso[],
): Ligacao {
  if (!referencia) return { tipo: 'solto' };
  const dito = lerNumero(referencia);
  if (!dito) return { tipo: 'solto' };
  // 'CP DEMO-412/2026' (processo de demonstração quando o 412 já existia)
  // corresponde ao 'CP 412/2026' da carta.
  const iguais = candidatos.filter((c) =>
    correspondeNumero(c.numero.replace(/ DEMO-/, ' '), dito),
  );
  if (!iguais.length) return { tipo: 'solto' };
  if (!municipeId) return { tipo: 'precisa_identificacao' };
  const meu = iguais.find((c) => c.municipe_id === municipeId);
  if (meu) return { tipo: 'ligado', processoId: meu.id, numero: meu.numero };
  return { tipo: 'de_outro' };
}

// ---------------------------------------------------------------------------
// Rascunhos de resposta
// ---------------------------------------------------------------------------

export interface DadosRascunho {
  municipio: string;
  nome: string | null;
  referencia: string | null;
  assunto: string;
  dataCarta: string | null;
  argumentos: string | null;
  diasPedidos: number | null;
  dataLimite: string | null;
  pedido: string[];
}

function dataPt(iso: string | null): string | null {
  return iso ? iso.split('-').reverse().join('/') : null;
}

function cabecalho(d: DadosRascunho): string {
  const ref = d.referencia
    ? `Processo n.º ${d.referencia}`
    : 'Processo n.º [a preencher]';
  const carta = d.dataCarta
    ? `, notificado(a) por ofício de ${dataPt(d.dataCarta)}`
    : '';
  return [
    `Exmo.(a) Senhor(a) Presidente da Câmara Municipal de ${d.municipio}`,
    '',
    `Assunto: ${d.assunto} — ${ref}`,
    '',
    `${d.nome ?? '[O seu nome]'}, requerente no processo acima indicado${carta}, vem expor e requerer o seguinte:`,
  ].join('\n');
}

const FECHO = (d: DadosRascunho) =>
  [
    '',
    'Pede deferimento.',
    '',
    `${d.municipio}, [data]`,
    '',
    d.nome ?? '[O seu nome]',
  ].join('\n');

/**
 * Pronúncia em audiência prévia (ou defesa): os argumentos da pessoa, em
 * linguagem formal, sem acrescentar factos. Com IA, a IA reescreve só a
 * parte dos argumentos; este é o modelo e a alternativa sem IA.
 */
export function rascunhoPronuncia(
  d: DadosRascunho,
  argumentosFormais?: string,
): string {
  const args = (argumentosFormais ?? d.argumentos ?? '').trim();
  const corpo = args
    ? args
        .split(/\n+/)
        .map((p, i) => `${i + 1}. ${p.replace(/^\d+[.)]\s*/, '').trim()}`)
        .join('\n')
    : '1. [Explique aqui porque não concorda com a decisão que a câmara pensa tomar.]';
  return [
    cabecalho(d),
    '',
    'Em sede de audiência prévia, discorda do sentido provável da decisão comunicado, pelos seguintes motivos:',
    '',
    corpo,
    '',
    'Pelo exposto, requer que os fundamentos acima sejam tidos em conta e que a decisão final seja revista em conformidade.',
    FECHO(d),
  ].join('\n');
}

export function rascunhoProrrogacao(d: DadosRascunho): string {
  const dias = d.diasPedidos ?? 10;
  const motivo = d.argumentos?.trim()
    ? d.argumentos.trim()
    : '[Explique aqui porque precisa de mais tempo, por exemplo: aguardar um documento de outra entidade.]';
  const ate = d.dataLimite ? ` (que termina a ${dataPt(d.dataLimite)})` : '';
  return [
    cabecalho(d),
    '',
    `Requer a prorrogação do prazo para responder à notificação${ate}, por mais ${dias} dias úteis, pelo seguinte motivo:`,
    '',
    motivo,
    FECHO(d),
  ].join('\n');
}

export function rascunhoElementos(d: DadosRascunho): string {
  const lista = d.pedido.length
    ? d.pedido.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : '1. [Os documentos pedidos na carta]';
  return [
    cabecalho(d),
    '',
    'Em resposta ao pedido de elementos, junta os seguintes documentos:',
    '',
    lista,
    FECHO(d),
  ].join('\n');
}

/** O que dizer da resposta escolhida (agente e página). */
export function respostasPossiveis(
  tipo: TipoCarta,
  temValores: boolean,
): TipoResposta[] {
  const r = [...TIPOS[tipo].respostas];
  if (temValores && !r.includes('pagamento')) r.push('pagamento');
  return r;
}

export const SISTEMA_PRONUNCIA = `Escreves, em português de Portugal, a parte dos argumentos de uma resposta escrita de um munícipe à câmara municipal (pronúncia em audiência prévia ou defesa).
Recebes o que a pessoa disse por palavras dela. Reescreve-o em linguagem formal correta, em parágrafos curtos (um por argumento, sem numeração), na terceira pessoa ("o requerente", "a requerente").
Regras: não acrescentes factos, leis, artigos, datas nem números que a pessoa não disse; não prometas nada; não uses fórmulas de abertura nem de fecho (o resto da carta já as tem). Só o texto dos argumentos.`;

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------

// Sem 0/O, 1/I/L: lê-se num SMS e dita-se ao telefone.
export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TAMANHO_CODIGO = 10;

export function codigoValido(c: string): boolean {
  return new RegExp(`^[${ALFABETO_CODIGO}]{${TAMANHO_CODIGO}}$`).test(c);
}

/** "[carta ABCD234567]" na mensagem do chat (o anexo enviado). */
export function codigoNaMensagem(texto: string): string | null {
  const m = new RegExp(
    `\\[CARTA ([${ALFABETO_CODIGO}]{${TAMANHO_CODIGO}})\\]`,
  ).exec(texto.toUpperCase());
  return m ? m[1] : null;
}
