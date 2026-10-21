import { z } from 'zod';

/*
 * Regras do arquivo antigo (V3 · FUN §13, ponto 5): estados, quem pode o
 * quê, a configuração (prazos e taxas) e os textos para o munícipe. Puro.
 *
 * O acesso a documentos nominativos segue a LADA (Lei n.º 26/2016, de 22 de
 * agosto): o titular ou quem demonstre interesse direto, pessoal, legítimo e
 * constitucionalmente protegido (art. 6.º, n.º 5); resposta em 10 dias
 * (art. 15.º, n.º 1). Ainda por confirmar com o arquivo municipal: os
 * prazos e as taxas são valores de demonstração até a câmara os pôr.
 */

export const ESTADOS_DOCUMENTO = [
  'por_processar',
  'processado',
  'revisto',
] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export const ORIGENS_TEXTO = ['camada_texto', 'ocr_ia', 'manual'] as const;
export type OrigemTexto = (typeof ORIGENS_TEXTO)[number];

export const MIMES_ARQUIVO = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
] as const;
export type MimeArquivo = (typeof MIMES_ARQUIVO)[number];

export const EXTENSOES: Record<MimeArquivo, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/tiff': 'tif',
};

/** Máximo de ficheiros por lote (uma pasta de processo digitalizada). */
export const MAX_LOTE = 50;
/** Tamanho máximo de um ficheiro (o Claude lê PDFs até 32 MB). */
export const MAX_BYTES = 30 * 1024 * 1024;

export const ESTADOS_PEDIDO = [
  'recebido',
  'agendado',
  'em_preparacao',
  'pronto',
  'encerrado',
] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export const NOMES_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  recebido: 'Recebido',
  agendado: 'Consulta marcada',
  em_preparacao: 'Cópia em preparação',
  pronto: 'Cópia pronta',
  encerrado: 'Encerrado',
};

export const MODALIDADES = ['presencial', 'copia_certificada'] as const;
export type Modalidade = (typeof MODALIDADES)[number];

export const QUALIDADES = ['titular', 'interesse_legitimo'] as const;
export type Qualidade = (typeof QUALIDADES)[number];

export const RESULTADOS = [
  'consultado',
  'entregue',
  'recusado',
  'sem_documentos',
  'desistiu',
] as const;
export type Resultado = (typeof RESULTADOS)[number];

export const NOMES_RESULTADO: Record<Resultado, string> = {
  consultado: 'Consulta feita',
  entregue: 'Cópia entregue',
  recusado: 'Acesso recusado (sem legitimidade, LADA)',
  sem_documentos: 'Sem documentos no arquivo',
  desistiu: 'O munícipe desistiu',
};

/** A lei, citada como "a confirmar com o arquivo" (nunca como certeza). */
export const LADA = {
  lei: 'Lei n.º 26/2016, de 22 de agosto (LADA)',
  nominativos: 'art. 6.º, n.º 5',
  prazo: 'art. 15.º, n.º 1',
  a_confirmar: true,
} as const;

// ------------------------------------------------------------------
// Permissões dentro do recurso 'arquivo'
// ------------------------------------------------------------------

type PerfilPainel =
  | 'atendimento'
  | 'tecnico'
  | 'chefe_divisao'
  | 'vereador'
  | 'equipa_toucamara'
  | 'admin';

/**
 * O recurso 'arquivo' deixa entrar quem atende (lê e trata os pedidos de
 * consulta). Pesquisar nos documentos, carregar digitalizações e rever os
 * metadados é dos técnicos e da chefia (e da equipa interna).
 */
export const PERFIS_DOCUMENTOS: readonly PerfilPainel[] = [
  'tecnico',
  'chefe_divisao',
  'admin',
  'equipa_toucamara',
];

export function podeDocumentos(perfil: PerfilPainel): boolean {
  return PERFIS_DOCUMENTOS.includes(perfil);
}

// ------------------------------------------------------------------
// Configuração (municipios.arquivo_config)
// ------------------------------------------------------------------

export const esquemaConfig = z.object({
  /** O arquivo responde (data ou valor) neste prazo. LADA: 10 dias. */
  prazo_resposta_dias_uteis: z.number().int().min(1).max(60),
  presencial: z.object({
    local: z.string().trim().min(3).max(200),
    gratuita: z.boolean(),
    horario: z.string().trim().max(200).nullable(),
  }),
  copia_certificada: z.object({
    /** Taxa da certidão/cópia certificada (primeira página), em cêntimos. */
    taxa_base_cents: z.number().int().min(0).max(100_000),
    /** Cada página a mais, em cêntimos. */
    por_pagina_cents: z.number().int().min(0).max(10_000),
    /** Dias úteis para preparar, depois de pago. */
    prazo_dias_uteis: z.number().int().min(1).max(60),
  }),
  /** true enquanto os valores não vierem do regulamento de taxas da câmara. */
  demonstracao: z.boolean(),
  fonte: z.string().trim().max(300).nullable(),
});
export type ConfigArquivo = z.infer<typeof esquemaConfig>;

/** Valores de demonstração: não são os de nenhuma câmara. */
export const CONFIG_DEMONSTRACAO: ConfigArquivo = {
  prazo_resposta_dias_uteis: 10,
  presencial: {
    local: 'Arquivo Municipal (com marcação prévia)',
    gratuita: true,
    horario: 'dias úteis, das 9h30 às 12h30 e das 14h00 às 16h30',
  },
  copia_certificada: {
    taxa_base_cents: 500,
    por_pagina_cents: 50,
    prazo_dias_uteis: 5,
  },
  demonstracao: true,
  fonte: `${LADA.lei}, ${LADA.prazo} (prazo de resposta, a confirmar com o arquivo). Taxas: valores de demonstração.`,
};

export function lerConfig(c: unknown): ConfigArquivo {
  const r = esquemaConfig.safeParse(c);
  return r.success ? r.data : CONFIG_DEMONSTRACAO;
}

/** Taxa da cópia certificada para `paginas` páginas, em cêntimos. */
export function taxaCopia(config: ConfigArquivo, paginas: number): number {
  const p = Math.max(1, Math.floor(paginas));
  return (
    config.copia_certificada.taxa_base_cents +
    (p - 1) * config.copia_certificada.por_pagina_cents
  );
}

export function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/** "ARQ 3/2026" */
export function numeroPedido(n: number, ano: number): string {
  return `ARQ ${n}/${ano}`;
}

// ------------------------------------------------------------------
// Textos para o munícipe
// ------------------------------------------------------------------

/** Como se consulta, dito pelo agente (com os valores marcados se forem de demonstração). */
export function comoConsultar(config: ConfigArquivo): {
  presencial: string;
  copia_certificada: string;
} {
  const p = config.presencial;
  const c = config.copia_certificada;
  const marca = config.demonstracao ? ' (valor de demonstração)' : '';
  return {
    presencial:
      `Consulta presencial no ${p.local}${p.horario ? `, ${p.horario}` : ''}` +
      (p.gratuita ? ', sem custos.' : '.') +
      ' O arquivo marca o dia e avisa por SMS.',
    copia_certificada:
      `Cópia certificada: ${euros(c.taxa_base_cents)} a primeira página e ${euros(c.por_pagina_cents)} cada página a mais${marca}. ` +
      `Fica pronta uns ${c.prazo_dias_uteis} dias úteis depois de paga; o arquivo avisa por SMS com o valor certo.`,
  };
}

/** A explicação do acesso a documentos com dados de outras pessoas. */
export function textoLada(): string {
  return (
    'Os processos antigos têm dados pessoais de quem os pediu. Pela lei de acesso aos documentos administrativos ' +
    `(${LADA.lei}, ${LADA.nominativos}; a confirmar com o arquivo), pode consultar se for o titular (o requerente ou o proprietário, ` +
    'ou herdeiro) ou se tiver autorização escrita do titular ou um interesse direto, pessoal e legítimo (por exemplo, comprou a casa ' +
    'e precisa do projeto). O arquivo pode pedir um documento que o prove.'
  );
}

export interface DadosLeitura {
  nome: string | null;
  morada?: string | null;
  ano?: number | null;
  requerente?: string | null;
  numero_antigo?: string | null;
  descricao?: string | null;
  qualidade: Qualidade;
  interesse?: string | null;
  modalidade: Modalidade;
}

export function textoLerDeVolta(d: DadosLeitura): string {
  const procura = [
    d.numero_antigo ? `o processo n.º ${d.numero_antigo}` : null,
    d.morada ? `na morada ${d.morada}` : null,
    d.ano ? `de por volta de ${d.ano}` : null,
    d.requerente ? `em nome de ${d.requerente}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    `Pedido de consulta ao arquivo${d.nome ? ` em nome de ${d.nome}` : ''}.`,
    `Procura ${procura || 'um processo antigo'}${d.descricao ? ` (${d.descricao})` : ''}.`,
    d.qualidade === 'titular'
      ? 'Diz que é o titular do processo (ou herdeiro).'
      : `Pede como interessado: ${d.interesse ?? 'interesse por explicar'}.`,
    d.modalidade === 'presencial'
      ? 'Quer consultar presencialmente, com marcação.'
      : 'Quer uma cópia certificada (com taxa).',
  ].join(' ');
}

export function smsRegisto(
  municipio: string,
  numero: string,
  responderAte: string,
  modalidade: Modalidade,
): string {
  return (
    `${municipio}: o seu pedido de consulta ao arquivo tem o n.º ${numero}. ` +
    `Até ${dataCurta(responderAte)} o arquivo diz-lhe ` +
    (modalidade === 'presencial'
      ? 'o dia da consulta.'
      : 'o valor e quando fica pronta a cópia certificada.') +
    ' Leve o cartão de cidadão.'
  );
}

export function smsMarcado(
  municipio: string,
  numero: string,
  quando: Date,
  local: string,
): string {
  return (
    `${municipio}: consulta ao arquivo (${numero}) marcada para ${dataHora(quando)}, no ${local}. ` +
    'Leve o cartão de cidadão. Se não puder ir, responda a este SMS.'
  );
}

export function smsCopia(
  municipio: string,
  numero: string,
  taxaCents: number,
  pronta: boolean,
  demonstracao: boolean,
): string {
  const valor = `${euros(taxaCents)}${demonstracao ? ' (valor de demonstração)' : ''}`;
  return pronta
    ? `${municipio}: a cópia certificada do pedido ${numero} está pronta. Valor: ${valor}. Pode levantá-la no arquivo com o cartão de cidadão.`
    : `${municipio}: a cópia certificada do pedido ${numero} está a ser preparada. Valor: ${valor}. Avisamos quando estiver pronta.`;
}

export function smsEncerrado(
  municipio: string,
  numero: string,
  resultado: Resultado,
  nota: string | null,
): string | null {
  if (resultado === 'recusado') {
    return (
      `${municipio}: o pedido ${numero} não pôde ser aceite: o documento tem dados pessoais e falta provar que é o titular ou o interesse legítimo` +
      `${nota ? ` (${nota})` : ''}. Pode voltar a pedir com esse documento.`
    );
  }
  if (resultado === 'sem_documentos') {
    return `${municipio}: o arquivo não encontrou documentos para o pedido ${numero}${nota ? ` (${nota})` : ''}.`;
  }
  return null;
}

function dataCurta(dia: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${dia}T12:00:00Z`));
}

export function dataHora(d: Date): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Quantos documentos, dito sem revelar nada sobre eles. */
export function textoEncontrados(n: number): string {
  if (n === 0) {
    return 'Não encontrei documentos digitalizados com esses dados. Pode haver papéis ainda por digitalizar: o arquivo procura à mão.';
  }
  if (n === 1) return 'Encontrei um documento que pode ser o que procura.';
  return `Encontrei ${n} documentos que podem ser o que procura.`;
}
