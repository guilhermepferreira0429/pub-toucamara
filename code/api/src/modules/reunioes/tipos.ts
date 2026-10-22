import { z } from 'zod';

export const ORGAOS = ['camara', 'assembleia'] as const;
export type Orgao = (typeof ORGAOS)[number];

export const TIPOS_REUNIAO = ['ordinaria', 'extraordinaria'] as const;
export type TipoReuniao = (typeof TIPOS_REUNIAO)[number];

export const ESTADOS_REUNIAO = [
  'agendada',
  'realizada',
  'ata_rascunho',
  'ata_aprovada',
  'publicada',
] as const;
export type EstadoReuniao = (typeof ESTADOS_REUNIAO)[number];

/**
 * O resultado de cada ponto. `empate` e `por_preencher` ficam por resolver:
 * a ata não se aprova com eles (no empate decide o voto de qualidade do
 * presidente, a confirmar com os serviços).
 */
export const RESULTADOS = [
  'aprovada_unanimidade',
  'aprovada_maioria',
  'rejeitada',
  'empate',
  'retirada',
  'adiada',
  'sem_votacao',
  'por_preencher',
] as const;
export type Resultado = (typeof RESULTADOS)[number];

/** O filtro `votacao=` da pesquisa ('aprovada' = unanimidade ou maioria). */
export const FILTROS_VOTACAO = [
  'aprovada',
  'aprovada_unanimidade',
  'aprovada_maioria',
  'rejeitada',
  'retirada',
  'adiada',
  'sem_votacao',
] as const;
export type FiltroVotacao = (typeof FILTROS_VOTACAO)[number];

export const NOME_ORGAO: Record<Orgao, string> = {
  camara: 'Câmara Municipal',
  assembleia: 'Assembleia Municipal',
};

export const NOME_RESULTADO: Record<Resultado, string> = {
  aprovada_unanimidade: 'aprovada por unanimidade',
  aprovada_maioria: 'aprovada por maioria',
  rejeitada: 'rejeitada',
  empate: 'empate (falta o voto de qualidade)',
  retirada: 'retirada da ordem do dia',
  adiada: 'adiada',
  sem_votacao: 'sem votação (para conhecimento)',
  por_preencher: 'votação por preencher',
};

const texto = (max: number) => z.string().trim().max(max);

export const esquemaPontoOrdem = z.object({
  numero: z.number().int().min(1).max(999),
  titulo: texto(500).min(2),
  descricao: texto(5000).default(''),
});
export type PontoOrdem = z.infer<typeof esquemaPontoOrdem>;

export const esquemaMembro = z.object({
  nome: texto(160).min(2),
  /** 'Presidente', 'Vereador', 'Deputado municipal', 'Presidente da junta de Azurém'... */
  cargo: texto(120).min(2),
  /** 'PS', 'PSD', 'CDU', 'Independente'... null se não se aplica (secretário). */
  forca_politica: texto(80).min(1).nullable().default(null),
  presente: z.boolean().default(true),
  falta_justificada: z.boolean().default(false),
});
export type Membro = z.infer<typeof esquemaMembro>;

const ordemUnica = z
  .array(esquemaPontoOrdem)
  .max(200)
  .refine(
    (pontos) => new Set(pontos.map((p) => p.numero)).size === pontos.length,
    'Há pontos com o mesmo número.',
  );

export const esquemaCriarReuniao = z.object({
  orgao: z.enum(ORGAOS),
  tipo: z.enum(TIPOS_REUNIAO),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data AAAA-MM-DD.'),
  hora: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Hora HH:MM.')
    .nullable()
    .default(null),
  local: texto(300).min(2),
  ordem_do_dia: ordemUnica.default([]),
  presencas: z.array(esquemaMembro).max(200).default([]),
});
export type CriarReuniao = z.infer<typeof esquemaCriarReuniao>;

export const esquemaMudarReuniao = esquemaCriarReuniao
  .omit({ orgao: true })
  .partial()
  .extend({
    /** Só de 'agendada' para 'realizada' (o resto muda com a ata). */
    estado: z.literal('realizada').optional(),
  });

export const esquemaVotoForca = z.object({
  forca_politica: texto(80).min(1),
  a_favor: z.number().int().min(0).max(999),
  contra: z.number().int().min(0).max(999),
  abstencoes: z.number().int().min(0).max(999),
});
export type VotoForca = z.infer<typeof esquemaVotoForca>;

const esquemaIntervencao = z.object({
  membro: texto(160).min(1),
  forca_politica: texto(80).nullable().default(null),
  resumo: texto(20000).default(''),
});

const esquemaDeclaracao = z.object({
  membro: texto(160).min(1),
  forca_politica: texto(80).nullable().default(null),
  texto: texto(20000).min(1),
});

export const esquemaPontoAta = z.object({
  numero: z.number().int().min(1).max(999),
  titulo: texto(500).min(1),
  resumo_discussao: texto(50000).default(''),
  intervencoes: z.array(esquemaIntervencao).max(200).default([]),
  proposta: texto(20000).default(''),
  votacao: z.array(esquemaVotoForca).max(50).default([]),
  resultado: z.enum(RESULTADOS).default('por_preencher'),
  deliberacao: texto(20000).default(''),
  declaracoes_voto: z.array(esquemaDeclaracao).max(100).default([]),
  /** Sem IA: o excerto da transcrição deste ponto (para quem redige). */
  transcricao: texto(400000).nullable().default(null),
});
export type PontoAta = z.infer<typeof esquemaPontoAta>;

const esquemaPessoaAta = z.object({
  nome: texto(160).min(1),
  cargo: texto(120).default(''),
  forca_politica: texto(80).nullable().default(null),
  falta_justificada: z.boolean().default(false),
});

export const esquemaCabecalho = z.object({
  orgao: z.enum(ORGAOS),
  tipo: z.enum(TIPOS_REUNIAO),
  numero: texto(40),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora_inicio: z.string().nullable().default(null),
  hora_fim: z.string().nullable().default(null),
  local: texto(300).default(''),
  presidente: texto(160).nullable().default(null),
  presentes: z.array(esquemaPessoaAta).max(200).default([]),
  ausentes: z.array(esquemaPessoaAta).max(200).default([]),
});

/** A ata (o que se edita, versão a versão). */
export const esquemaConteudoAta = z.object({
  cabecalho: esquemaCabecalho,
  antes_da_ordem_do_dia: texto(100000).default(''),
  pontos: z
    .array(esquemaPontoAta)
    .max(200)
    .refine(
      (p) => new Set(p.map((x) => x.numero)).size === p.length,
      'Há pontos com o mesmo número.',
    ),
  /** Notas para quem revê (o que falta, o que a IA não percebeu). */
  notas: z.array(texto(2000)).max(50).default([]),
});
export type ConteudoAta = z.infer<typeof esquemaConteudoAta>;
export type Cabecalho = ConteudoAta['cabecalho'];

export const esquemaEditarAta = z.object({
  conteudo: esquemaConteudoAta,
  /** A versão que se editou: se entretanto houve outra, 409. */
  versao: z.number().int().min(1),
  nota: texto(500).nullable().default(null),
});

export const esquemaAprovar = z
  .object({
    modo: z.enum(['minuta', 'reuniao_seguinte']),
    /** Com 'reuniao_seguinte': a reunião onde foi aprovada. */
    reuniao_id: z.uuid().nullable().default(null),
  })
  .refine((a) => a.modo === 'minuta' || a.reuniao_id, {
    message: 'Diz em que reunião foi aprovada (reuniao_id).',
    path: ['reuniao_id'],
  });

/**
 * Base legal do formato da ata. Valores que não confirmámos com um
 * jurista: ficam marcados como de demonstração.
 */
export const BASE_LEGAL = {
  demonstracao: true,
  fonte:
    'Lei n.º 75/2013, de 12 de setembro (regime jurídico das autarquias locais), Anexo I, art. 57.º (atas) e art. 58.º (voto de vencido)',
  nota: 'Formato da ata a confirmar com os serviços.',
  conteudo_minimo: [
    'data e local da reunião',
    'membros presentes e ausentes',
    'assuntos apreciados',
    'decisões e deliberações tomadas',
    'forma e resultado das votações',
    'declarações de voto',
    'o facto de a ata ter sido lida e aprovada',
  ],
} as const;
