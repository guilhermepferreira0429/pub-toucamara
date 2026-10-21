/*
 * Fiscalização: tipos de visita, o que verificar em cada um (checklist),
 * a configuração do planeamento, o relatório estruturado e o "relatório
 * livre" quando não há IA. Sem BD, para testar à parte.
 *
 * As checklists, as durações, a velocidade média e o prazo para corrigir
 * são VALORES DE DEMONSTRAÇÃO: cada câmara confirma-os com o seu serviço de
 * fiscalização (as referências legais citadas são as que conhecemos do
 * RJUE, DL 555/99, e estão por confirmar com o jurista).
 */
import { z } from 'zod';

export const ESTADOS_VISITA = [
  'por_agendar',
  'agendada',
  'feita',
  'cancelada',
] as const;
export type EstadoVisita = (typeof ESTADOS_VISITA)[number];

export const TIPOS_VISITA = [
  'ocorrencia',
  'vistoria_utilizacao',
  'obra',
  'ocupacao_via',
  'reinspecao',
  'outra',
] as const;
export type TipoVisita = (typeof TIPOS_VISITA)[number];

export const ORIGENS = [
  'ocorrencia',
  'processo',
  'manual',
  'reinspecao',
] as const;
export type OrigemVisita = (typeof ORIGENS)[number];

export const CONCLUSOES = [
  'conforme',
  'com_infracoes',
  'inconclusivo',
] as const;
export type Conclusao = (typeof CONCLUSOES)[number];

export const NOMES_TIPO: Record<TipoVisita, string> = {
  ocorrencia: 'Verificação de ocorrência',
  vistoria_utilizacao: 'Vistoria para licença de utilização',
  obra: 'Fiscalização de obra particular',
  ocupacao_via: 'Ocupação da via pública',
  reinspecao: 'Nova visita (verificar correções)',
  outra: 'Outra fiscalização',
};

export const NOMES_ESTADO: Record<EstadoVisita, string> = {
  por_agendar: 'Por agendar',
  agendada: 'Agendada',
  feita: 'Feita',
  cancelada: 'Cancelada',
};

export const NOMES_CONCLUSAO: Record<Conclusao, string> = {
  conforme: 'Sem desconformidades',
  com_infracoes: 'Com desconformidades',
  inconclusivo: 'Inconclusivo',
};

export const RESPOSTAS = ['sim', 'nao', 'na'] as const;
export type Resposta = (typeof RESPOSTAS)[number];

/**
 * Um ponto a verificar. `conforme_se` diz que resposta está bem ('sim' ou
 * 'nao'); `null` é só informativo (não conta para a conclusão).
 */
export interface ItemChecklist {
  chave: string;
  rotulo: string;
  conforme_se: 'sim' | 'nao' | null;
  /** Norma a citar se não estiver conforme. */
  artigo: string | null;
  resposta: Resposta | null;
  nota: string | null;
}

type Modelo = Omit<ItemChecklist, 'resposta' | 'nota'>;

const item = (
  chave: string,
  rotulo: string,
  conforme_se: 'sim' | 'nao' | null,
  artigo: string | null = null,
): Modelo => ({ chave, rotulo, conforme_se, artigo });

/** Valores de demonstração (por confirmar com o serviço de fiscalização). */
export const CHECKLISTS: Record<TipoVisita, Modelo[]> = {
  ocorrencia: [
    item('problema_existe', 'O problema reportado existe no local?', 'nao'),
    item(
      'perigo_imediato',
      'Há perigo imediato para pessoas ou veículos?',
      'nao',
    ),
    item(
      'responsavel_identificado',
      'Há um responsável identificado (proprietário, empresa, obra)?',
      null,
    ),
  ],
  vistoria_utilizacao: [
    item(
      'conforme_projeto',
      'A obra está de acordo com o projeto aprovado?',
      'sim',
      'RJUE, art. 64.º',
    ),
    item(
      'fachadas_cerceas',
      'Fachadas, cérceas e implantação como no projeto?',
      'sim',
      'RJUE, art. 64.º',
    ),
    item(
      'livro_obra',
      'O livro de obra está no local e preenchido?',
      'sim',
      'RJUE, art. 97.º',
    ),
    item(
      'acessibilidades',
      'Cumpre as regras de acessibilidade?',
      'sim',
      'DL 163/2006',
    ),
    item(
      'exteriores_concluidos',
      'Os arranjos exteriores e a limpeza da obra estão concluídos?',
      'sim',
    ),
  ],
  obra: [
    item(
      'aviso_afixado',
      'O aviso da licença ou comunicação prévia está afixado e visível?',
      'sim',
      'RJUE, art. 78.º',
    ),
    item(
      'obra_titulada',
      'A obra corresponde ao que foi licenciado ou comunicado?',
      'sim',
      'RJUE, art. 4.º',
    ),
    item(
      'livro_obra',
      'O livro de obra está no local?',
      'sim',
      'RJUE, art. 97.º',
    ),
    item('estaleiro_seguro', 'O estaleiro está vedado e sinalizado?', 'sim'),
    item('via_desimpedida', 'A via pública está limpa e desimpedida?', 'sim'),
  ],
  ocupacao_via: [
    item('licenca_valida', 'Há licença de ocupação válida?', 'sim'),
    item('area_licenciada', 'A área ocupada corresponde à licenciada?', 'sim'),
    item(
      'passagem_peoes',
      'Fica passagem livre para peões (incluindo cadeiras de rodas)?',
      'sim',
    ),
  ],
  reinspecao: [
    item(
      'medidas_cumpridas',
      'As medidas pedidas na visita anterior foram cumpridas?',
      'sim',
    ),
  ],
  outra: [item('irregularidade', 'Encontrou alguma irregularidade?', 'nao')],
};

export function checklistDe(tipo: TipoVisita): ItemChecklist[] {
  return CHECKLISTS[tipo].map((i) => ({ ...i, resposta: null, nota: null }));
}

/** Na nova visita: verificar cada infração da visita anterior. */
export function checklistReinspecao(
  infracoes: { descricao: string; artigo: string | null }[],
): ItemChecklist[] {
  return [
    ...checklistDe('reinspecao'),
    ...infracoes.map((inf, i) => ({
      chave: `corrigida_${i + 1}`,
      rotulo: `Foi corrigida: ${inf.descricao}?`,
      conforme_se: 'sim' as const,
      artigo: inf.artigo,
      resposta: null,
      nota: null,
    })),
  ];
}

// ---------------------------------------------------------------------
// Configuração do planeamento (municipios.fiscalizacao_config)
// ---------------------------------------------------------------------

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const esquemaConfig = z.object({
  /** O edifício da câmara (ou o armazém da fiscalização). */
  ponto_partida: z
    .object({
      nome: z.string().trim().min(2).max(200),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .nullable(),
  hora_inicio: hora,
  hora_fim: hora,
  velocidade_kmh: z.number().min(5).max(120),
  fator_percurso: z.number().min(1).max(3),
  duracao_min: z.object(
    Object.fromEntries(
      TIPOS_VISITA.map((t) => [t, z.number().int().min(5).max(480)]),
    ) as Record<TipoVisita, z.ZodNumber>,
  ),
  /** Prazo para corrigir quando o fiscal não diz outro, em dias de calendário. */
  prazo_correcao_dias: z.number().int().min(1).max(365),
  /** Os valores ainda não foram confirmados pela câmara. */
  demonstracao: z.boolean(),
});

export type ConfigFiscalizacao = z.output<typeof esquemaConfig>;

/**
 * Valores de demonstração. Sem ponto de partida: cada câmara põe as
 * coordenadas do seu edifício (nada de um município fica no código).
 * 30 km/h com mais 30 % de percurso é uma média urbana razoável; as
 * durações e os 30 dias para corrigir são estimativas nossas.
 */
export const CONFIG_DEMONSTRACAO: ConfigFiscalizacao = {
  ponto_partida: null,
  hora_inicio: '09:00',
  hora_fim: '17:30',
  velocidade_kmh: 30,
  fator_percurso: 1.3,
  duracao_min: {
    ocorrencia: 20,
    vistoria_utilizacao: 60,
    obra: 40,
    ocupacao_via: 20,
    reinspecao: 20,
    outra: 30,
  },
  prazo_correcao_dias: 30,
  demonstracao: true,
};

export function lerConfig(c: unknown): ConfigFiscalizacao {
  const r = esquemaConfig.safeParse(c);
  return r.success ? r.data : CONFIG_DEMONSTRACAO;
}

// ---------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------

/** O que a IA tira do ditado (e o que o fiscal pode corrigir à mão). */
export const esquemaEstruturado = z.object({
  resumo: z
    .string()
    .describe('Uma ou duas frases, em português de Portugal, com o essencial.'),
  constatacoes: z
    .array(z.string())
    .describe('O que o fiscal viu no local, uma frase por constatação.'),
  infracoes: z
    .array(
      z.object({
        descricao: z.string(),
        artigo: z
          .string()
          .nullable()
          .describe(
            'A norma, só se o fiscal a disser (ex.: "RJUE, art. 97.º"). Nunca inventar.',
          ),
      }),
    )
    .describe(
      'Desconformidades ou infrações encontradas. Vazio se não houver.',
    ),
  medidas: z
    .array(z.string())
    .describe(
      'O que o responsável tem de fazer ou o que o fiscal fez (notificou, embargou...).',
    ),
  prazo_dias: z
    .number()
    .int()
    .nullable()
    .describe('Prazo para corrigir em dias, só se o fiscal o disser.'),
  prazo_data: z
    .string()
    .nullable()
    .describe(
      'Data-limite para corrigir (AAAA-MM-DD), só se o fiscal disser uma data.',
    ),
  fotos_referidas: z
    .array(z.string())
    .describe(
      'Fotografias que o fiscal refere (ex.: "foto 2: fissura na fachada").',
    ),
  respostas_checklist: z
    .array(
      z.object({
        chave: z.string(),
        resposta: z.enum(RESPOSTAS).nullable(),
        nota: z.string().nullable(),
      }),
    )
    .describe(
      'Para cada ponto da checklist que o ditado responde: sim, nao ou na (não se aplica).',
    ),
  conclusao: z.enum(CONCLUSOES),
});

export type Estruturado = z.output<typeof esquemaEstruturado>;

/** O que fica guardado (sem as respostas da checklist, que vão para a visita). */
export type RelatorioEstruturado = Omit<Estruturado, 'respostas_checklist'> & {
  /** true = relatório livre (sem IA): o texto tal como foi ditado. */
  livre: boolean;
};

export const SISTEMA_IA = `És o assistente de um fiscal municipal em Portugal. Recebes o que o fiscal ditou no terreno (transcrição de voz, pode ter erros de reconhecimento) e a checklist da visita. Estrutura o relatório de vistoria.

Regras:
- Usa só o que o fiscal disse. Não inventes factos, artigos de lei, prazos nem fotografias.
- "infracoes" só com o que o fiscal considerou desconforme. Artigo só se ele o disser.
- "prazo_dias" ou "prazo_data" só se ele disser um prazo para corrigir.
- "respostas_checklist": só os pontos que o ditado responde, com a chave tal como vem.
- "conclusao": "conforme" se não há desconformidades, "com_infracoes" se há, "inconclusivo" se não foi possível verificar (sem acesso, ninguém no local...).
- Português de Portugal, frases curtas e claras.`;

export function conteudoIa(
  tipo: TipoVisita,
  motivo: string,
  checklist: ItemChecklist[],
  texto: string,
): string {
  const pontos = checklist
    .map(
      (i) =>
        `- ${i.chave}: ${i.rotulo}${i.resposta ? ` (já respondido: ${i.resposta})` : ''}`,
    )
    .join('\n');
  return `Tipo de visita: ${NOMES_TIPO[tipo]}\nMotivo: ${motivo}\n\nChecklist:\n${pontos}\n\nDitado do fiscal:\n"""\n${texto}\n"""`;
}

/** Não conforme: respondido com o contrário do que está bem. */
export function naoConforme(i: ItemChecklist): boolean {
  return (
    i.conforme_se != null &&
    (i.resposta === 'sim' || i.resposta === 'nao') &&
    i.resposta !== i.conforme_se
  );
}

/**
 * Conclusão pela checklist: alguma desconformidade → com_infracoes; todos
 * os pontos que contam respondidos e bem → conforme; senão inconclusivo.
 */
export function conclusaoDaChecklist(checklist: ItemChecklist[]): Conclusao {
  const contam = checklist.filter((i) => i.conforme_se != null);
  if (contam.some(naoConforme)) return 'com_infracoes';
  if (contam.length && contam.every((i) => i.resposta != null))
    return 'conforme';
  return 'inconclusivo';
}

/** Junta as respostas (da IA ou do fiscal) à checklist; as que já existiam ganham. */
export function aplicarRespostas(
  checklist: ItemChecklist[],
  respostas: {
    chave: string;
    resposta: Resposta | null;
    nota?: string | null;
  }[],
  sobrepor = false,
): ItemChecklist[] {
  const porChave = new Map(respostas.map((r) => [r.chave, r]));
  return checklist.map((i) => {
    const r = porChave.get(i.chave);
    if (!r) return i;
    if (!sobrepor && i.resposta != null) return i;
    return {
      ...i,
      resposta: r.resposta ?? i.resposta,
      nota: r.nota?.trim() ? r.nota.trim() : i.nota,
    };
  });
}

const NUMEROS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  três: 3,
  cinco: 5,
  oito: 8,
  dez: 10,
  quinze: 15,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  sessenta: 60,
  noventa: 90,
};

/** "prazo de 15 dias", "30 dias para corrigir", "quinze dias úteis" → 15. */
export function prazoNoTexto(texto: string): number | null {
  const t = texto.toLowerCase();
  const m =
    /(\d{1,3}|[a-zçãéê]+)\s+dias(?:\s+(?:úteis|uteis|seguidos))?\s+(?:para\s+(?:corrigir|repor|regularizar|legalizar|retirar|resolver))/.exec(
      t,
    ) ?? /prazo\s+(?:de\s+)?(\d{1,3}|[a-zçãéê]+)\s+dias/.exec(t);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
  return n && n > 0 && n <= 365 ? n : null;
}

/** "foto 2", "fotografia três", "tirei foto da fachada" → as frases que as referem. */
export function fotosNoTexto(texto: string): string[] {
  return frases(texto).filter((f) => /\bfoto(grafia)?s?\b/i.test(f));
}

/** "artigo 97.º", "art. 4", "artigo 102-A" → as referências tal como ditas. */
export function artigosNoTexto(texto: string): string[] {
  const r =
    /\bart(?:igo|\.)\s*\d+[.º°]*(?:\s*[-–]\s*[a-z])?(?:\.º)?(?:,?\s*n\.?º\s*\d+)?(?:\s+d[oa]\s+[A-ZÀ-Ú][\wÀ-ú.]*(?:\s+\d+\/\d+)?)?/gi;
  const vistos = new Set<string>();
  for (const m of texto.matchAll(r))
    vistos.add(m[0].trim().replace(/[.,;:]+$/, ''));
  return [...vistos];
}

function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Sem IA: o texto fica como "relatório livre" e a estrutura sai da
 * checklist preenchida à mão (as desconformidades são as infrações) e de
 * duas leituras simples do texto (o prazo dito e as fotos referidas).
 */
export function relatorioLivre(
  texto: string,
  checklist: ItemChecklist[],
): RelatorioEstruturado {
  const infracoes = checklist.filter(naoConforme).map((i) => ({
    descricao: i.nota
      ? `${semPergunta(i.rotulo)}: ${i.nota}`
      : semPergunta(i.rotulo),
    artigo: i.artigo,
  }));
  const conclusao = conclusaoDaChecklist(checklist);
  const limpo = texto.trim();
  const artigos = artigosNoTexto(texto);
  return {
    resumo: limpo.length > 280 ? `${limpo.slice(0, 277)}...` : limpo,
    constatacoes: checklist
      .filter((i) => i.resposta != null)
      .map(
        (i) =>
          `${semPergunta(i.rotulo)}: ${NOMES_RESPOSTA[i.resposta as Resposta]}${i.nota ? ` (${i.nota})` : ''}`,
      )
      .concat(
        artigos.length
          ? [`Normas referidas no ditado: ${artigos.join('; ')}.`]
          : [],
      ),
    infracoes,
    medidas: [],
    prazo_dias: infracoes.length ? prazoNoTexto(texto) : null,
    prazo_data: null,
    fotos_referidas: fotosNoTexto(texto),
    conclusao,
    livre: true,
  };
}

export const NOMES_RESPOSTA: Record<Resposta, string> = {
  sim: 'sim',
  nao: 'não',
  na: 'não se aplica',
};

function semPergunta(rotulo: string): string {
  return rotulo.replace(/\?$/, '');
}

/** Normaliza o que veio da IA: só infrações com texto, prazo plausível. */
export function daIa(e: Estruturado): RelatorioEstruturado {
  const { respostas_checklist: _r, ...resto } = e;
  void _r;
  const prazoData =
    e.prazo_data && /^\d{4}-\d{2}-\d{2}$/.test(e.prazo_data)
      ? e.prazo_data
      : null;
  const infracoes = e.infracoes
    .map((i) => ({
      descricao: i.descricao.trim(),
      artigo: i.artigo?.trim() || null,
    }))
    .filter((i) => i.descricao);
  return {
    ...resto,
    infracoes,
    prazo_dias:
      e.prazo_dias && e.prazo_dias > 0 && e.prazo_dias <= 365
        ? e.prazo_dias
        : null,
    prazo_data: prazoData,
    conclusao:
      infracoes.length && e.conclusao === 'conforme'
        ? 'com_infracoes'
        : e.conclusao,
    livre: false,
  };
}

/** A data-limite para corrigir: a que o fiscal disse, senão hoje + dias. */
export function dataLimite(
  hoje: string,
  r: Pick<RelatorioEstruturado, 'prazo_dias' | 'prazo_data'>,
  diasPorOmissao: number,
): { data: string; dias: number; dito_pelo_fiscal: boolean } {
  if (r.prazo_data && r.prazo_data > hoje) {
    return {
      data: r.prazo_data,
      dias: Math.round(
        (Date.parse(`${r.prazo_data}T12:00:00Z`) -
          Date.parse(`${hoje}T12:00:00Z`)) /
          86_400_000,
      ),
      dito_pelo_fiscal: true,
    };
  }
  const dias = r.prazo_dias ?? diasPorOmissao;
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return {
    data: d.toISOString().slice(0, 10),
    dias,
    dito_pelo_fiscal: r.prazo_dias != null,
  };
}

/** '2026-10-21' → '21/10/2026'. */
export function dataCurta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function formatarNumero(n: number, ano: number): string {
  return `FIS ${n}/${ano}`;
}

// ---------------------------------------------------------------------
// Textos para o munícipe (SMS e linha do tempo do processo)
// ---------------------------------------------------------------------

export function notaOcorrencia(
  conclusao: Conclusao,
  dia: string,
  prazo: string | null,
): string {
  const quando = dataCurta(dia);
  switch (conclusao) {
    case 'conforme':
      return `A fiscalização foi ao local a ${quando} e não encontrou o problema.`;
    case 'com_infracoes':
      return prazo
        ? `A fiscalização foi ao local a ${quando} e pediu ao responsável para corrigir até ${dataCurta(prazo)}. Depois volta a verificar.`
        : `A fiscalização foi ao local a ${quando} e pediu ao responsável para corrigir.`;
    default:
      return `A fiscalização foi ao local a ${quando}, mas não conseguiu verificar tudo. O caso continua a ser acompanhado.`;
  }
}

export function notaProcesso(
  conclusao: Conclusao,
  dia: string,
  infracoes: number,
  prazo: string | null,
): string {
  const quando = dataCurta(dia);
  switch (conclusao) {
    case 'conforme':
      return `Vistoria feita a ${quando}: sem desconformidades.`;
    case 'com_infracoes':
      return (
        `Vistoria feita a ${quando}: ${infracoes === 1 ? 'há 1 ponto' : `há ${infracoes} pontos`} a corrigir` +
        (prazo ? ` até ${dataCurta(prazo)}. Depois há nova vistoria.` : '.')
      );
    default:
      return `Vistoria feita a ${quando}, mas não foi possível verificar tudo. A câmara vai contactá-lo.`;
  }
}
