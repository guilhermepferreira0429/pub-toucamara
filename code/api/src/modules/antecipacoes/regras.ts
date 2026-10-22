/*
 * "A câmara liga-lhe antes de o problema existir": o motor dos momentos.
 * Regras puras (sem BD), para testar à parte.
 *
 * Um momento é uma data que importa ao munícipe num processo, numa licença
 * ou num pagamento (o fim de um prazo dele, o fim do prazo da câmara, a
 * caducidade de um alvará...). Com uma antecedência em dias úteis (feriados
 * do município incluídos, `common/dias-uteis.ts`), a câmara contacta a
 * pessoa antes de a data passar. Um momento só gera um contacto por data
 * alvo: a `chave` (tipo, objeto e data) é única na BD.
 *
 * As antecedências por omissão e as consequências legais que se dizem ao
 * munícipe são VALORES DE DEMONSTRAÇÃO, escritos a partir das fontes que já
 * estão no código (glossário, catálogo das empresas); as que dependem de
 * interpretação jurídica levam `confirmar_jurista: true` e têm de ser
 * confirmadas pelo jurista da câmara antes de ir para produção.
 */
import { diasUteisEntre, eDiaUtil, Feriados } from '../../common/dias-uteis.js';

export const TIPOS_MOMENTO = [
  'prazo_municipe',
  'audiencia_previa',
  'prazo_camara',
  'caducidade_alvara',
  'pagamento_a_vencer',
  'licenca_expira',
] as const;
export type TipoMomento = (typeof TIPOS_MOMENTO)[number];

export const GRAVIDADES = ['alta', 'media', 'baixa'] as const;
export type Gravidade = (typeof GRAVIDADES)[number];

export const CANAIS_CONFIG = ['auto', 'chamada', 'notificacao'] as const;
export type CanalConfig = (typeof CANAIS_CONFIG)[number];

/** Por onde a câmara quer contactar: o agente liga, ou push/SMS. */
export type CanalPrevisto = 'chamada' | 'notificacao';

export interface ConfigTipo {
  ativo: boolean;
  /** Quantos dias úteis antes da data alvo se contacta. */
  antecedencia_dias_uteis: number;
  canal: CanalConfig;
}

export interface DefinicaoTipo {
  rotulo: string;
  /** Para o painel: o que é este momento, numa frase. */
  descricao: string;
  gravidade: Gravidade;
  /** A câmara muda a antecedência aqui? (as licenças têm a sua config). */
  configuravel: boolean;
  /** Onde se configura quando não é aqui. */
  gerido_em?: string;
  fonte_legal: string | null;
  /** A consequência legal tem de ser confirmada pelo jurista da câmara. */
  confirmar_jurista: boolean;
}

export const DEF_TIPO: Record<TipoMomento, DefinicaoTipo> = {
  prazo_municipe: {
    rotulo: 'Prazo do munícipe a acabar',
    descricao:
      'Um pedido de elementos sem resposta: falta pouco para o prazo que a câmara deu acabar.',
    gravidade: 'alta',
    configuravel: true,
    fonte_legal:
      'Prazo fixado no pedido do técnico (por omissão 10 dias úteis, o prazo supletivo do CPA)',
    confirmar_jurista: false,
  },
  audiencia_previa: {
    rotulo: 'Audiência prévia aberta',
    descricao:
      'A câmara propôs indeferir o pedido: a pessoa tem um prazo para se pronunciar por escrito.',
    gravidade: 'alta',
    configuravel: true,
    fonte_legal: 'Código do Procedimento Administrativo, arts. 121.º e 122.º',
    confirmar_jurista: true,
  },
  prazo_camara: {
    rotulo: 'Prazo da câmara a acabar sem decisão',
    descricao:
      'O prazo legal da câmara para decidir está a acabar. A pessoa fica a saber o que a lei prevê e a chefia recebe um alerta.',
    gravidade: 'media',
    configuravel: true,
    fonte_legal:
      'RJUE (Decreto-Lei n.º 555/99), art. 34.º (comunicação prévia) e art. 111.º; Código do Procedimento Administrativo, art. 130.º (deferimento tácito)',
    confirmar_jurista: true,
  },
  caducidade_alvara: {
    rotulo: 'Licença de obras perto de caducar',
    descricao:
      'A obra foi admitida ou licenciada mas ainda não começou: a licença pode caducar se a obra não começar a tempo.',
    gravidade: 'alta',
    configuravel: true,
    fonte_legal: 'RJUE (Decreto-Lei n.º 555/99), art. 71.º (caducidade)',
    confirmar_jurista: true,
  },
  pagamento_a_vencer: {
    rotulo: 'Taxa por pagar a vencer',
    descricao:
      'O processo foi decidido e falta pagar a taxa (e levantar o alvará): a guia está perto do fim do prazo.',
    gravidade: 'media',
    configuravel: true,
    fonte_legal: null,
    confirmar_jurista: false,
  },
  licenca_expira: {
    rotulo: 'Licença a expirar',
    descricao:
      'Uma licença (esplanada, publicidade, dístico...) perto do fim da validade, sem renovação pedida.',
    gravidade: 'media',
    configuravel: false,
    gerido_em: '/painel/licencas',
    fonte_legal: null,
    confirmar_jurista: false,
  },
};

/**
 * Antecedências por omissão (VALORES DE DEMONSTRAÇÃO, a câmara muda-as no
 * painel). As licenças usam os avisos de validade de cada tipo de licença
 * (licencas/avisos-validade.ts): aqui só aparecem, não se duplicam.
 */
export const CONFIG_OMISSAO: Record<TipoMomento, ConfigTipo> = {
  prazo_municipe: { ativo: true, antecedencia_dias_uteis: 3, canal: 'auto' },
  audiencia_previa: {
    ativo: true,
    antecedencia_dias_uteis: 10,
    canal: 'auto',
  },
  prazo_camara: { ativo: true, antecedencia_dias_uteis: 3, canal: 'auto' },
  caducidade_alvara: {
    ativo: true,
    antecedencia_dias_uteis: 20,
    canal: 'auto',
  },
  pagamento_a_vencer: {
    ativo: true,
    antecedencia_dias_uteis: 3,
    canal: 'notificacao',
  },
  licenca_expira: { ativo: true, antecedencia_dias_uteis: 0, canal: 'auto' },
};

/**
 * Meses entre a admissão/licença da obra e a caducidade, se a obra não
 * começar. VALOR DE DEMONSTRAÇÃO (RJUE, art. 71.º): a confirmar pelo
 * jurista, o prazo depende do tipo de operação e do que diz o alvará.
 */
export const MESES_CADUCIDADE_OMISSAO = 12;

/** Os tipos de processo de obras (código do tipo) a que se aplica a caducidade. */
export const TIPOS_OBRA = ['CP', 'LO'];

/** Lê a config guardada; o que faltar ou estiver mal fica pela omissão. */
export function configDe(
  guardada: Partial<Record<string, Partial<ConfigTipo>>>,
): Record<TipoMomento, ConfigTipo & { demonstracao: boolean }> {
  return Object.fromEntries(
    TIPOS_MOMENTO.map((t) => {
      const g = guardada[t];
      const base = CONFIG_OMISSAO[t];
      if (!g || !DEF_TIPO[t].configuravel) {
        return [t, { ...base, demonstracao: true }];
      }
      return [
        t,
        {
          ativo: typeof g.ativo === 'boolean' ? g.ativo : base.ativo,
          antecedencia_dias_uteis:
            Number.isInteger(g.antecedencia_dias_uteis) &&
            g.antecedencia_dias_uteis! >= 0 &&
            g.antecedencia_dias_uteis! <= 60
              ? g.antecedencia_dias_uteis!
              : base.antecedencia_dias_uteis,
          canal: (CANAIS_CONFIG as readonly string[]).includes(g.canal ?? '')
            ? g.canal!
            : base.canal,
          demonstracao: false,
        },
      ];
    }),
  ) as Record<TipoMomento, ConfigTipo & { demonstracao: boolean }>;
}

// ---------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------

function deslocar(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** O dia útil n antes de `dia` (o próprio dia não conta); n = 0 → `dia`. */
export function recuarDiasUteis(
  dia: string,
  n: number,
  feriados: Feriados,
): string {
  let d = dia;
  let contados = 0;
  while (contados < n) {
    d = deslocar(d, -1);
    if (eDiaUtil(d, feriados)) contados++;
  }
  return d;
}

/** 'AAAA-MM-DD' + meses (fim do mês se o dia não existir: 31/01 + 1 = 28/02). */
export function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1, 12));
  const ultimo = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
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

/** '2026-10-30' → '30 de outubro' (o que o agente diz). */
export function diaDito(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} de ${MESES[Number(m) - 1]}`;
}

/** '2026-10-30' → '30/10' (SMS). */
function diaCurto(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// ---------------------------------------------------------------------
// Candidatos e momentos
// ---------------------------------------------------------------------

/** O regime do prazo da câmara, pelo código do tipo de processo. */
export type Regime = 'comunicacao_previa' | 'licenciamento' | 'geral';

export function regimeDe(codigoTipo: string | null | undefined): Regime {
  if (codigoTipo === 'CP') return 'comunicacao_previa';
  if (codigoTipo === 'LO') return 'licenciamento';
  return 'geral';
}

/** Uma situação encontrada na BD que pode dar um momento. */
export interface Candidato {
  tipo: TipoMomento;
  /** O pedido, processo, pagamento ou licença (parte da chave). */
  objeto_id: string;
  municipio_id: string;
  municipe_id: string | null;
  processo: {
    id: string;
    numero: string;
    assunto: string;
    tipo_codigo: string | null;
  } | null;
  /** O dia que importa (fim do prazo, caducidade, validade...). */
  data_alvo: string;
  /** O dia em que a situação começou (pedido feito, audiência aberta...). */
  inicio: string | null;
  /** O que é: o documento pedido, o fundamento, o valor... */
  descricao: string | null;
  valor_cent?: number | null;
  /** Já houve um aviso de outro job (lembrete do pedido, aviso da licença). */
  ja_avisado?: boolean;
  licenca?: { id: string; numero: string; nome: string } | null;
  pagamento_id?: string | null;
  pedido_id?: string | null;
}

export interface Momento extends Candidato {
  chave: string;
  gravidade: Gravidade;
  /** O primeiro dia em que se contacta (data alvo − antecedência úteis). */
  contactar_em: string;
  /** Dias úteis de hoje até à data alvo (0 = hoje). */
  faltam_dias_uteis: number;
  /** Hoje é dia de contactar (e ainda não passou). */
  devido: boolean;
  fonte_legal: string | null;
  confirmar_jurista: boolean;
  demonstracao: boolean;
}

/** A chave idempotente: um contacto por (tipo, objeto, data alvo). */
export function chaveMomento(
  c: Pick<Candidato, 'tipo' | 'objeto_id' | 'data_alvo'>,
): string {
  return `${c.tipo}:${c.objeto_id}:${c.data_alvo}`;
}

/**
 * O momento desta situação hoje, ou null se a data já passou.
 *
 * Devido = a configuração está ativa e hoje fica entre `contactar_em` e a
 * data alvo. Exceção: um pedido de elementos que já começou dentro da
 * janela (prazo curto) não leva aviso, porque o próprio pedido já disse o
 * prazo (a mesma regra do lembrete em processos/avisos.ts).
 */
export function avaliar(
  c: Candidato,
  cfg: ConfigTipo & { demonstracao?: boolean },
  hoje: string,
  feriados: Feriados,
): Momento | null {
  if (c.data_alvo < hoje) return null;
  const def = DEF_TIPO[c.tipo];
  const contactar_em = recuarDiasUteis(
    c.data_alvo,
    cfg.antecedencia_dias_uteis,
    feriados,
  );
  const faltam = diasUteisEntre(hoje, c.data_alvo, feriados);
  let devido = cfg.ativo && hoje >= contactar_em;
  if (
    devido &&
    c.tipo === 'prazo_municipe' &&
    c.inicio &&
    diasUteisEntre(c.inicio, c.data_alvo, feriados) <=
      cfg.antecedencia_dias_uteis
  ) {
    devido = false;
  }
  return {
    ...c,
    chave: chaveMomento(c),
    gravidade: gravidadeDe(c, faltam),
    contactar_em,
    faltam_dias_uteis: faltam,
    devido,
    fonte_legal: def.fonte_legal,
    confirmar_jurista: def.confirmar_jurista,
    demonstracao: cfg.demonstracao ?? true,
  };
}

/**
 * A gravidade do tipo; um prazo da câmara a 1 dia útil ou menos sobe a
 * alta (é o alerta de gestão que não pode esperar).
 */
export function gravidadeDe(
  c: Pick<Candidato, 'tipo'>,
  faltamDiasUteis: number,
): Gravidade {
  const g = DEF_TIPO[c.tipo].gravidade;
  if (c.tipo === 'prazo_camara' && faltamDiasUteis <= 1) return 'alta';
  return g;
}

/**
 * Por onde contactar. A câmara pode fixar o canal por tipo; em 'auto' o
 * agente liga nos importantes (gravidade alta) e a quem não tem a app (sem
 * smartphone, um SMS com link ajuda pouco); o resto vai por push/SMS. As
 * regras das chamadas de saída (horário, recusa, uma por dia) decidem
 * depois se a chamada pode mesmo ser feita; se não, vai a notificação.
 */
export function canalPreferido(e: {
  gravidade: Gravidade;
  canal: CanalConfig;
  temApp: boolean;
}): CanalPrevisto {
  if (e.canal !== 'auto') return e.canal;
  if (e.gravidade === 'alta') return 'chamada';
  if (e.gravidade === 'media' && !e.temApp) return 'chamada';
  return 'notificacao';
}

// ---------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------

export interface Textos {
  /** Título curto (push, painel). */
  titulo: string;
  /** SMS/push: curto, com o link no fim. */
  sms: string;
  /** O que o agente diz ao ligar (variável `o_que_mudou`). */
  dizer: string;
  /** O que a pessoa pode fazer (o agente diz e a ferramenta devolve). */
  o_que_pode_fazer: string;
  /** Só no prazo da câmara: o alerta interno para a chefia. */
  alerta?: string;
}

function dias(n: number): string {
  if (n <= 0) return 'hoje';
  return n === 1 ? 'em 1 dia útil' : `em ${n} dias úteis`;
}

/** 'A obra excede' → 'a obra excede' (no meio da frase). */
function minuscula(s: string): string {
  return /^[A-ZÀ-Ú][a-zà-ú]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

function euros(cent: number): string {
  return `${(cent / 100).toFixed(2).replace('.', ',')} €`;
}

/**
 * O que se diz em cada momento. Nunca se promete o resultado: as
 * consequências legais vão como "a lei prevê", com a câmara a confirmar.
 */
export function textos(
  m: Momento,
  d: { municipio: string; link: string },
): Textos {
  const proc = m.processo?.numero ?? '';
  const no = proc ? `no processo ${proc}` : '';
  const ate = diaDito(m.data_alvo);
  switch (m.tipo) {
    case 'prazo_municipe':
      return {
        titulo: `Processo ${proc}: prazo a acabar`,
        sms: `${d.municipio}: ${no} falta entregar ${m.descricao ?? 'um documento'}. O prazo acaba a ${diaCurto(m.data_alvo)}. Envie aqui: ${d.link}`,
        dizer: `${no.replace(/^n/, 'N')} ainda falta entregar ${m.descricao ?? 'um documento'}. O prazo acaba no dia ${ate}.`,
        o_que_pode_fazer:
          'Pode enviar o documento pelo link do SMS ou entregá-lo no balcão. Se não o conseguir ter a tempo, diga-nos: o técnico pode dar mais prazo. Quer que lhe explique o que tem de enviar?',
      };
    case 'audiencia_previa':
      return {
        titulo: `Processo ${proc}: pode pronunciar-se`,
        sms: `${d.municipio}: ${no} a câmara propõe indeferir o pedido. Pode responder por escrito até ${diaCurto(m.data_alvo)}. Veja aqui: ${d.link}`,
        dizer: `${no.replace(/^n/, 'N')} a câmara está a pensar indeferir o pedido${m.descricao ? `, porque ${minuscula(m.descricao.replace(/[.]$/, ''))}` : ''}. Antes de decidir, tem até ao dia ${ate} para dizer o que pensa, por escrito.`,
        o_que_pode_fazer:
          'Pode responder por escrito com as suas razões, juntar documentos ou corrigir o projeto. Se não responder, a câmara decide com o que tem. Quer que lhe explique o que pode escrever?',
      };
    case 'prazo_camara': {
      const regime = regimeDe(m.processo?.tipo_codigo);
      const lei =
        regime === 'comunicacao_previa'
          ? 'Na comunicação prévia a lei permite fazer a obra sem esperar por uma licença, depois de pagar as taxas; a câmara pode verificar depois.'
          : regime === 'licenciamento'
            ? 'Quando a lei o prevê, se a câmara não decidir dentro do prazo o pedido pode contar como aprovado (deferimento tácito).'
            : 'Se a câmara não decidir dentro do prazo, pode pedir informação sobre o atraso e reclamar.';
      return {
        titulo: `Processo ${proc}: prazo da câmara`,
        sms: `${d.municipio}: o prazo da câmara para decidir o processo ${proc} acaba a ${diaCurto(m.data_alvo)}. Antes de avançar, fale connosco. ${d.link}`,
        dizer: `O prazo da câmara para decidir o processo ${proc} acaba no dia ${ate}. ${lei} Antes de avançar com alguma coisa, confirme connosco o que se aplica ao seu caso.`,
        o_que_pode_fazer:
          'Pode esperar pela decisão, que está a ser tratada, ou falar com o técnico. Não avance com a obra sem confirmar com a câmara o que se aplica ao seu caso.',
        alerta:
          regime === 'licenciamento'
            ? `O processo ${proc} pode ficar tacitamente deferido ${dias(m.faltam_dias_uteis)} (${ate}) se não houver decisão.`
            : regime === 'comunicacao_previa'
              ? `O prazo da câmara no processo ${proc} (comunicação prévia) acaba ${dias(m.faltam_dias_uteis)} (${ate}) sem pronúncia.`
              : `O prazo legal do processo ${proc} acaba ${dias(m.faltam_dias_uteis)} (${ate}) sem decisão.`,
      };
    }
    case 'caducidade_alvara':
      return {
        titulo: `Processo ${proc}: obra por começar`,
        sms: `${d.municipio}: a obra do processo ${proc} tem de começar até ${diaCurto(m.data_alvo)}, senão a licença pode caducar. Fale connosco: ${d.link}`,
        dizer: `A obra do processo ${proc} foi aprovada mas ainda não nos disse que começou. Se não começar até ao dia ${ate}, a licença pode caducar e teria de pedir outra vez.`,
        o_que_pode_fazer:
          'Se a obra já começou, diga-nos para atualizarmos o processo. Se precisar de mais tempo, pode pedir uma prorrogação antes desse dia.',
      };
    case 'pagamento_a_vencer':
      return {
        titulo: `Processo ${proc}: taxa por pagar`,
        sms: `${d.municipio}: falta pagar ${m.valor_cent ? euros(m.valor_cent) : 'a taxa'} do processo ${proc} até ${diaCurto(m.data_alvo)} para receber o alvará. ${d.link}`,
        dizer: `O processo ${proc} já está decidido. Falta pagar a taxa${m.valor_cent ? ` de ${euros(m.valor_cent)}` : ''} até ao dia ${ate} para receber o alvará e poder começar.`,
        o_que_pode_fazer:
          'Pode pagar por MB WAY ou Multibanco com a referência do SMS. Se a referência expirar, pedimos outra.',
      };
    case 'licenca_expira':
      return {
        titulo: `${m.licenca?.nome ?? 'Licença'} a expirar`,
        sms: `${d.municipio}: ${m.licenca?.nome ?? 'a licença'} ${m.licenca?.numero ?? ''} é válida até ${diaCurto(m.data_alvo)}. Pode renovar connosco. ${d.link}`,
        dizer: `${m.licenca?.nome ?? 'A licença'} ${m.licenca?.numero ?? ''} é válida até ao dia ${ate}.`,
        o_que_pode_fazer:
          'Pode renovar já nesta chamada com os mesmos dados (renovar_licenca).',
      };
  }
}
