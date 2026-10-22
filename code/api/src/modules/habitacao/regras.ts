/*
 * Habitação municipal (V4 #7): as regras em código, sem BD.
 *
 * Tudo aqui são valores de demonstração até a câmara confirmar o seu
 * regulamento de atribuição de habitação:
 * - IAS de 2025 (522,50 €);
 * - arrendamento apoiado: limite de rendimento e fórmula da renda
 *   simplificada a partir da Lei n.º 81/2014 (alterada pela Lei n.º 32/2016):
 *   taxa de esforço = 0,067 × RMC/IAS, no máximo 23%, renda mínima de 1% do IAS;
 * - renda acessível: limites de rendimento como na Portaria n.º 176/2019
 *   (35 000 € para 1 pessoa, 45 000 € para 2, mais 5 000 € por pessoa) e
 *   taxa de esforço até 35%;
 * - a grelha de pontuação (100 pontos) é nossa, para mostrar como seria.
 */

export type Regime = 'apoiado' | 'acessivel';
export type Situacao =
  | 'sem_casa'
  | 'despejo'
  | 'sem_condicoes'
  | 'sobrelotacao'
  | 'renda_excessiva'
  | 'adequada';

export const SITUACOES: Record<Situacao, { rotulo: string; pontos: number }> = {
  sem_casa: {
    rotulo:
      'sem casa (na rua, abrigo ou casa de familiares a título provisório)',
    pontos: 30,
  },
  despejo: { rotulo: 'com ordem de despejo', pontos: 25 },
  sem_condicoes: {
    rotulo: 'casa sem condições (insalubre ou degradada)',
    pontos: 25,
  },
  sobrelotacao: { rotulo: 'casa pequena demais para o agregado', pontos: 20 },
  renda_excessiva: {
    rotulo: 'renda acima de metade do rendimento',
    pontos: 15,
  },
  adequada: { rotulo: 'casa adequada', pontos: 0 },
};

export const IAS_CENT = 52250;
const MESES_ANO = 14;

export const REGRAS_HABITACAO = {
  demonstracao: true,
  ias_cent: IAS_CENT,
  apoiado: {
    /** Limite anual = 14 × IAS × (1,5 + 0,5 por cada pessoa a mais). */
    fator_base: 1.5,
    fator_pessoa: 0.5,
    taxa_coeficiente: 0.067,
    taxa_maxima: 0.23,
    renda_minima_fracao_ias: 0.01,
    deducao_por_pessoa_fracao_ias: 0.1,
  },
  acessivel: {
    limite_1_cent: 3_500_000,
    limite_2_cent: 4_500_000,
    por_pessoa_cent: 500_000,
    taxa_esforco_maxima: 0.35,
  },
  piquete: '253 000 999',
  fontes: [
    'Lei n.º 81/2014 (renda apoiada), alterada pela Lei n.º 32/2016',
    'Portaria n.º 176/2019 (Programa de Arrendamento Acessível)',
  ],
  nota: 'Critérios, pontuação, limites e número do piquete são valores de demonstração, a confirmar pela câmara.',
} as const;

export const ROTULO_REGIME: Record<Regime, string> = {
  apoiado: 'arrendamento apoiado (habitação social)',
  acessivel: 'renda acessível',
};

/** Rendimento anual bruto máximo do agregado. */
export function limiteRendimento(regime: Regime, agregado: number): number {
  if (regime === 'acessivel') {
    const a = REGRAS_HABITACAO.acessivel;
    if (agregado <= 1) return a.limite_1_cent;
    return a.limite_2_cent + (agregado - 2) * a.por_pessoa_cent;
  }
  const p = REGRAS_HABITACAO.apoiado;
  return Math.round(
    MESES_ANO * IAS_CENT * (p.fator_base + p.fator_pessoa * (agregado - 1)),
  );
}

export interface DadosCandidatura {
  regime: Regime;
  agregado: number;
  rendimento_anual_cent: number;
  situacao: Situacao;
  menores?: number;
  idosos_ou_deficiencia?: number;
  anos_residencia?: number;
  casa_propria?: boolean;
}

export interface Criterio {
  criterio: string;
  pontos: number;
  maximo: number;
  porque: string;
}

export interface Avaliacao {
  elegivel: boolean;
  exclusoes: string[];
  pontuacao: number;
  criterios: Criterio[];
  limite_cent: number;
}

function euros(cent: number): string {
  return `${Math.round(cent / 100).toLocaleString('pt-PT')} €`;
}

/** Elegibilidade e pontuação provisória, cada critério explicado. */
export function avaliarCandidatura(d: DadosCandidatura): Avaliacao {
  const limite = limiteRendimento(d.regime, d.agregado);
  const exclusoes: string[] = [];
  if (d.rendimento_anual_cent > limite) {
    exclusoes.push(
      `O rendimento anual do agregado (${euros(d.rendimento_anual_cent)}) passa o limite de ${euros(limite)} para ${d.agregado} ${d.agregado === 1 ? 'pessoa' : 'pessoas'}.`,
    );
  }
  if (d.casa_propria) {
    exclusoes.push(
      'Alguém do agregado tem casa própria adequada no concelho ou perto.',
    );
  }

  const criterios: Criterio[] = [];
  const sit = SITUACOES[d.situacao];
  criterios.push({
    criterio: 'Situação da casa',
    pontos: sit.pontos,
    maximo: 30,
    porque: `Vive em ${sit.rotulo}.`,
  });

  const perCapitaMes = d.rendimento_anual_cent / MESES_ANO / d.agregado;
  const r = perCapitaMes / IAS_CENT;
  const pRend = r < 0.5 ? 25 : r < 1 ? 18 : r < 1.5 ? 10 : r < 2 ? 5 : 0;
  criterios.push({
    criterio: 'Rendimento por pessoa',
    pontos: pRend,
    maximo: 25,
    porque: `${euros(perCapitaMes)} por pessoa e por mês (${(Math.round(r * 100) / 100).toLocaleString('pt-PT')} vezes o IAS).`,
  });

  const menores = Math.max(0, d.menores ?? 0);
  criterios.push({
    criterio: 'Crianças e jovens',
    pontos: Math.min(15, menores * 5),
    maximo: 15,
    porque: menores
      ? `${menores} ${menores === 1 ? 'menor' : 'menores'} no agregado (5 pontos cada).`
      : 'Sem menores no agregado.',
  });

  const idosos = Math.max(0, d.idosos_ou_deficiencia ?? 0);
  criterios.push({
    criterio: 'Idosos ou pessoas com deficiência',
    pontos: Math.min(15, idosos * 8),
    maximo: 15,
    porque: idosos
      ? `${idosos} ${idosos === 1 ? 'pessoa' : 'pessoas'} com 65 anos ou mais ou com deficiência (8 pontos cada).`
      : 'Ninguém com 65 anos ou mais nem com deficiência.',
  });

  const anos = d.anos_residencia;
  const pRes =
    anos === undefined
      ? 0
      : anos >= 10
        ? 15
        : anos >= 5
          ? 10
          : anos >= 2
            ? 5
            : 0;
  criterios.push({
    criterio: 'Anos a viver no concelho',
    pontos: pRes,
    maximo: 15,
    porque:
      anos === undefined
        ? 'Não disse há quantos anos vive no concelho.'
        : `${anos} ${anos === 1 ? 'ano' : 'anos'} no concelho.`,
  });

  return {
    elegivel: exclusoes.length === 0,
    exclusoes,
    pontuacao: criterios.reduce((s, c) => s + c.pontos, 0),
    criterios,
    limite_cent: limite,
  };
}

/**
 * Renda estimada pelo rendimento mensal líquido do agregado.
 * - apoiado: RMC = rendimento − 10% do IAS por cada pessoa além do titular;
 *   taxa = min(0,067 × RMC/IAS, 23%); renda = taxa × RMC, no mínimo 1% do IAS;
 * - acessível: no máximo 35% do rendimento (nunca acima da renda atual).
 */
export function estimarRenda(p: {
  regime: Regime;
  rendimento_mensal_cent: number;
  agregado: number;
  renda_atual_cent: number;
}): { renda_cent: number; taxa: number; explicacao: string } {
  if (p.regime === 'acessivel') {
    const max = Math.round(
      p.rendimento_mensal_cent * REGRAS_HABITACAO.acessivel.taxa_esforco_maxima,
    );
    const renda = Math.min(p.renda_atual_cent, max);
    return {
      renda_cent: renda,
      taxa: p.rendimento_mensal_cent ? renda / p.rendimento_mensal_cent : 0,
      explicacao: `Na renda acessível a renda não passa de 35% do rendimento (${euros(max)} por mês).`,
    };
  }
  const a = REGRAS_HABITACAO.apoiado;
  const deducao = Math.round(
    (p.agregado - 1) * a.deducao_por_pessoa_fracao_ias * IAS_CENT,
  );
  const rmc = Math.max(0, p.rendimento_mensal_cent - deducao);
  const taxa = Math.min(a.taxa_coeficiente * (rmc / IAS_CENT), a.taxa_maxima);
  const minima = Math.round(a.renda_minima_fracao_ias * IAS_CENT);
  const renda = Math.max(Math.round(taxa * rmc), minima);
  return {
    renda_cent: renda,
    taxa: Math.round(taxa * 10000) / 10000,
    explicacao: `Renda apoiada: rendimento corrigido de ${euros(rmc)} e taxa de esforço de ${(Math.round(taxa * 1000) / 10).toLocaleString('pt-PT')}%.`,
  };
}

export const CATEGORIAS_REPARACAO = {
  agua: 'água e canalização',
  gas: 'gás',
  eletricidade: 'eletricidade',
  infiltracoes: 'telhado e infiltrações',
  humidade: 'humidade e bolor',
  portas_janelas: 'portas e janelas',
  aquecimento: 'aquecimento e água quente',
  elevador: 'elevador e partes comuns',
  outro: 'outro',
} as const;
export type CategoriaReparacao = keyof typeof CATEGORIAS_REPARACAO;

const URGENTE =
  /inunda|fuga|rebent|cheiro a g[aá]s|sem luz|sem eletricidade|sem [aá]gua|fa[ií]sca|curto|fumo|desab|a cair|preso no elevador|n[aã]o fecha a porta da rua/i;
const PERIGO = /cheiro a g[aá]s|fa[ií]sca|fumo|curto|desab|a cair|choque/i;

/** Urgência da reparação e se há perigo imediato (112). */
export function classificarReparacao(p: {
  categoria: CategoriaReparacao;
  descricao: string;
  urgente?: boolean;
}): { urgencia: 'urgente' | 'normal'; perigo: boolean } {
  const perigo = p.categoria === 'gas' || PERIGO.test(p.descricao);
  const urgente = perigo || p.urgente === true || URGENTE.test(p.descricao);
  return { urgencia: urgente ? 'urgente' : 'normal', perigo };
}

function deIso(s: string): Date {
  return new Date(`${s}T12:00:00Z`);
}

/** As próximas n prestações da renda a partir de hoje (AAAA-MM-DD). */
export function proximasPrestacoes(
  hoje: string,
  diaVencimento: number,
  rendaCent: number,
  n = 3,
): { vence: string; valor_cent: number }[] {
  const d = deIso(hoje);
  let ano = d.getUTCFullYear();
  let mes = d.getUTCMonth();
  if (d.getUTCDate() > diaVencimento) mes += 1;
  const lista: { vence: string; valor_cent: number }[] = [];
  for (let i = 0; i < n; i++, mes++) {
    if (mes > 11) {
      mes -= 12;
      ano += 1;
    }
    const vence = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(diaVencimento).padStart(2, '0')}`;
    lista.push({ vence, valor_cent: rendaCent });
  }
  return lista;
}

export function eurosTexto(cent: number): string {
  return `${(cent / 100).toFixed(2).replace('.', ',')} €`;
}
