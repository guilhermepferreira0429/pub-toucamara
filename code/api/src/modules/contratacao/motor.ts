import { formatarEuros } from '../pagamentos/taxas.js';
import {
  ConfigContratacao,
  limiarDe,
  Limiares,
  NOMES_PROCEDIMENTO,
  NOMES_TIPO,
  Procedimento,
  PROCEDIMENTOS,
  ProcedimentoRegisto,
  TipoContrato,
} from './config.js';

/*
 * Motor de regras da contratação pública: puro (sem BD nem relógio), para
 * se testar à parte. Diz que procedimentos cabem num pedido, porquê, que
 * peças são precisas e se há alertas (limite acumulado com a mesma
 * entidade, objetos semelhantes no mesmo ano). Os valores vêm da
 * configuração do município — por defeito, de demonstração.
 */

/** Um contrato já celebrado (registo do município, importado do BASE ou à mão). */
export interface ContratoAnterior {
  id?: string;
  adjudicatario_nif: string;
  adjudicatario_nome?: string | null;
  objeto: string;
  cpv?: string | null;
  tipo: TipoContrato;
  preco_contratual_cent: number;
  /** 'AAAA-MM-DD'. */
  data_contrato: string;
  procedimento: ProcedimentoRegisto;
}

export interface PedidoAvaliacao {
  tipo: TipoContrato;
  /** Sem IVA. */
  valor_estimado_cent: number;
  /** NIF de quem se pensa convidar (para o limite acumulado). */
  entidade_adjudicataria?: string | null;
  objeto: string;
  cpv?: string | null;
  prazo_meses: number;
  contratos_anteriores: ContratoAnterior[];
  /** 'AAAA-MM-DD': o dia de referência (o ano económico atual). */
  hoje: string;
}

export interface Peca {
  codigo: string;
  nome: string;
  descricao: string;
  obrigatoria: boolean;
  /** O rascunho é gerado aqui (convite e caderno de encargos). */
  gerada_aqui: boolean;
  prazo_dias: number | null;
  prazo: string | null;
  prazo_demonstracao: boolean;
}

export interface AvaliacaoProcedimento {
  procedimento: Procedimento;
  nome: string;
  admissivel: boolean;
  /** Frases curtas: porque cabe ou não cabe. */
  porque: string[];
  alertas: string[];
  /** O limiar que define o procedimento (null no concurso). */
  limite_cent: number | null;
  pecas: Peca[];
}

export interface ContratoContado {
  id: string | null;
  adjudicatario_nif: string;
  adjudicatario_nome: string | null;
  objeto: string;
  preco_contratual_cent: number;
  data_contrato: string;
  procedimento: ProcedimentoRegisto;
}

export interface Acumulado {
  verificado: boolean;
  /** Porque não se verificou (sem NIF). */
  motivo: string | null;
  entidade_nif: string | null;
  anos: number[];
  contratos: ContratoContado[];
  /** Só os contratos anteriores. */
  anteriores_cent: number;
  /** O que se compara com o limite (com ou sem o contrato atual, conforme a configuração). */
  total_cent: number;
  incluir_contrato_atual: boolean;
  /** Por procedimento a que a regra se aplica. */
  limites: {
    procedimento: Procedimento;
    limite_cent: number;
    ultrapassa: boolean;
  }[];
  a_confirmar: boolean;
  fonte: string;
}

export interface Fracionamento {
  alerta: boolean;
  ano: number;
  semelhantes: (ContratoContado & {
    semelhanca: number;
    por: 'cpv' | 'objeto';
  })[];
  soma_semelhantes_cent: number;
  total_cent: number;
  procedimento_pelo_valor: Procedimento;
  procedimento_pelo_total: Procedimento;
  porque: string | null;
  fonte: string;
}

export interface ResultadoAvaliacao {
  tipo: TipoContrato;
  valor_estimado_cent: number;
  prazo_meses: number;
  procedimentos: AvaliacaoProcedimento[];
  /** O menos exigente dos admissíveis (o concurso público é sempre admissível). */
  recomendado: Procedimento;
  cabe_ajuste_direto: boolean;
  acumulado: Acumulado;
  fracionamento: Fracionamento;
  alertas: string[];
  resumo: string;
  demonstracao: boolean;
  fonte: string;
  limiares: Limiares;
}

const eur = formatarEuros;

// --- Semelhança de objetos ---------------------------------------------------

const PALAVRAS_VAZIAS = new Set([
  'para',
  'pelo',
  'pela',
  'pelos',
  'pelas',
  'como',
  'entre',
  'sobre',
  'desde',
  'durante',
  'servico',
  'servicos',
  'prestacao',
  'aquisicao',
  'fornecimento',
  'contrato',
  'municipio',
  'municipal',
  'municipais',
  'camara',
  'concelho',
  'outros',
  'diversos',
  'respetivo',
  'respetiva',
]);

/** Palavras com significado do objeto, sem acentos nem palavras vazias. */
export function palavras(texto: string): Set<string> {
  return new Set(
    texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p))
      // Plural simples: "limpezas" = "limpeza".
      .map((p) => (p.length > 5 && p.endsWith('s') ? p.slice(0, -1) : p)),
  );
}

/** Jaccard entre as palavras dos dois objetos (0 a 1). */
export function semelhanca(a: string, b: string): number {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return 0;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns++;
  return comuns / (pa.size + pb.size - comuns);
}

/** Os N primeiros dígitos do CPV ('79340000-9' → '793'), ou null. */
export function prefixoCpv(
  cpv: string | null | undefined,
  n: number,
): string | null {
  const d = (cpv ?? '').replace(/\D/g, '');
  return d.length >= n ? d.slice(0, n) : null;
}

function anoDe(data: string): number {
  return Number(data.slice(0, 4));
}

function contado(c: ContratoAnterior): ContratoContado {
  return {
    id: c.id ?? null,
    adjudicatario_nif: c.adjudicatario_nif,
    adjudicatario_nome: c.adjudicatario_nome ?? null,
    objeto: c.objeto,
    preco_contratual_cent: c.preco_contratual_cent,
    data_contrato: c.data_contrato,
    procedimento: c.procedimento,
  };
}

// --- Limiares ------------------------------------------------------------------

/** O procedimento que o valor sozinho exige (sem prazo nem acumulado). */
export function procedimentoPorValor(l: Limiares, valor: number): Procedimento {
  if (valor <= l.ajuste_direto_simplificado_cent)
    return 'ajuste_direto_simplificado';
  if (valor < l.ajuste_direto_cent) return 'ajuste_direto';
  if (valor < l.consulta_previa_cent) return 'consulta_previa';
  return 'concurso_publico';
}

function cabeNoValor(l: Limiares, p: Procedimento, valor: number): boolean {
  switch (p) {
    case 'ajuste_direto_simplificado':
      return valor <= l.ajuste_direto_simplificado_cent;
    case 'ajuste_direto':
      return valor < l.ajuste_direto_cent;
    case 'consulta_previa':
      return valor < l.consulta_previa_cent;
    default:
      return true;
  }
}

function frasesValor(l: Limiares, p: Procedimento, valor: number): string {
  const v = eur(valor);
  switch (p) {
    case 'ajuste_direto_simplificado':
      return valor <= l.ajuste_direto_simplificado_cent
        ? `${v} não passa de ${eur(l.ajuste_direto_simplificado_cent)} (limite do ajuste direto simplificado).`
        : `${v} passa de ${eur(l.ajuste_direto_simplificado_cent)} (limite do ajuste direto simplificado).`;
    case 'ajuste_direto':
      return valor < l.ajuste_direto_cent
        ? `${v} fica abaixo de ${eur(l.ajuste_direto_cent)} (limite do ajuste direto).`
        : `${v} chega ou passa de ${eur(l.ajuste_direto_cent)} (limite do ajuste direto).`;
    case 'consulta_previa':
      return valor < l.consulta_previa_cent
        ? `${v} fica abaixo de ${eur(l.consulta_previa_cent)} (limite da consulta prévia).`
        : `${v} chega ou passa de ${eur(l.consulta_previa_cent)} (limite da consulta prévia).`;
    default:
      return 'O concurso público pode usar-se para qualquer valor.';
  }
}

// --- Acumulado com a mesma entidade -------------------------------------------

function mesmoTipoPrestacao(
  c: ContratoAnterior,
  tipo: TipoContrato,
  cpv: string | null | undefined,
  digitos: number,
): boolean {
  if (c.tipo !== tipo) return false;
  const a = prefixoCpv(cpv, digitos);
  const b = prefixoCpv(c.cpv, digitos);
  // Sem CPV dos dois lados conta o tipo de contrato (do lado da prudência).
  return a === null || b === null || a === b;
}

export function calcularAcumulado(
  p: PedidoAvaliacao,
  cfg: ConfigContratacao,
): Acumulado {
  const a = cfg.acumulado;
  const ano = anoDe(p.hoje);
  const anos = Array.from({ length: a.anos }, (_, i) => ano - a.anos + 1 + i);
  const l = cfg.tipos[p.tipo];
  const base = {
    anos,
    incluir_contrato_atual: a.incluir_contrato_atual,
    a_confirmar: a.a_confirmar,
    fonte: a.fonte,
  };
  const nif = p.entidade_adjudicataria?.trim() || null;
  if (!nif) {
    return {
      ...base,
      verificado: false,
      motivo:
        'Sem o NIF da entidade a convidar não se verifica o limite acumulado: indique-o antes de convidar.',
      entidade_nif: null,
      contratos: [],
      anteriores_cent: 0,
      total_cent: a.incluir_contrato_atual ? p.valor_estimado_cent : 0,
      limites: [],
    };
  }
  const contratos = p.contratos_anteriores.filter(
    (c) =>
      c.adjudicatario_nif === nif &&
      anos.includes(anoDe(c.data_contrato)) &&
      c.data_contrato <= p.hoje &&
      a.contam.includes(c.procedimento) &&
      mesmoTipoPrestacao(c, p.tipo, p.cpv, a.cpv_digitos),
  );
  const anteriores = contratos.reduce((s, c) => s + c.preco_contratual_cent, 0);
  const total =
    anteriores + (a.incluir_contrato_atual ? p.valor_estimado_cent : 0);
  const limites = a.aplica_a.map((proc) => {
    const limite = a.limite_cent ?? limiarDe(l, proc) ?? 0;
    // O simplificado vai "até" o limite; os outros ficam "abaixo" dele.
    const ultrapassa =
      proc === 'ajuste_direto_simplificado' && a.limite_cent === null
        ? total > limite
        : total >= limite;
    return { procedimento: proc, limite_cent: limite, ultrapassa };
  });
  return {
    ...base,
    verificado: true,
    motivo: null,
    entidade_nif: nif,
    contratos: contratos.map(contado),
    anteriores_cent: anteriores,
    total_cent: total,
    limites,
  };
}

// --- Fracionamento --------------------------------------------------------------

export function calcularFracionamento(
  p: PedidoAvaliacao,
  cfg: ConfigContratacao,
): Fracionamento {
  const f = cfg.fracionamento;
  const ano = anoDe(p.hoje);
  const l = cfg.tipos[p.tipo];
  const semelhantes = p.contratos_anteriores.flatMap(
    (c): Fracionamento['semelhantes'] => {
      if (c.tipo !== p.tipo || anoDe(c.data_contrato) !== ano) return [];
      const a = prefixoCpv(p.cpv, f.cpv_digitos);
      const b = prefixoCpv(c.cpv, f.cpv_digitos);
      const s = semelhanca(p.objeto, c.objeto);
      if (a !== null && a === b) {
        return [
          {
            ...contado(c),
            semelhanca: Math.round(s * 100) / 100,
            por: 'cpv' as const,
          },
        ];
      }
      if (s >= f.semelhanca_minima) {
        return [
          {
            ...contado(c),
            semelhanca: Math.round(s * 100) / 100,
            por: 'objeto' as const,
          },
        ];
      }
      return [];
    },
  );
  const soma = semelhantes.reduce((s, c) => s + c.preco_contratual_cent, 0);
  const total = soma + p.valor_estimado_cent;
  const peloValor = procedimentoPorValor(l, p.valor_estimado_cent);
  const peloTotal = procedimentoPorValor(l, total);
  const alerta =
    semelhantes.length > 0 &&
    PROCEDIMENTOS.indexOf(peloTotal) > PROCEDIMENTOS.indexOf(peloValor);
  return {
    alerta,
    ano,
    semelhantes,
    soma_semelhantes_cent: soma,
    total_cent: total,
    procedimento_pelo_valor: peloValor,
    procedimento_pelo_total: peloTotal,
    porque: semelhantes.length
      ? `Em ${ano} já há ${semelhantes.length} ${semelhantes.length === 1 ? 'contrato semelhante' : 'contratos semelhantes'} (${eur(soma)}). ` +
        (alerta
          ? `Somando este, dá ${eur(total)}, que já pede ${NOMES_PROCEDIMENTO[peloTotal]} em vez de ${NOMES_PROCEDIMENTO[peloValor]}. Se for a mesma necessidade, o valor a considerar é o total: dividir a despesa para ficar abaixo do limite é fracionamento.`
          : `Somando este, dá ${eur(total)}, que continua a caber em ${NOMES_PROCEDIMENTO[peloValor]}.`)
      : null,
    fonte: f.fonte,
  };
}

// --- Peças e documentos -------------------------------------------------------

function peca(
  codigo: string,
  nome: string,
  descricao: string,
  o: Partial<
    Pick<Peca, 'obrigatoria' | 'gerada_aqui' | 'prazo_dias' | 'prazo'>
  > & {
    demo?: boolean;
  } = {},
): Peca {
  return {
    codigo,
    nome,
    descricao,
    obrigatoria: o.obrigatoria ?? true,
    gerada_aqui: o.gerada_aqui ?? false,
    prazo_dias: o.prazo_dias ?? null,
    prazo: o.prazo ?? null,
    prazo_demonstracao: o.demo ?? false,
  };
}

/** As peças e os documentos de cada procedimento, com prazos de demonstração. */
export function pecasDe(
  proc: Procedimento,
  tipo: TipoContrato,
  valor: number,
  cfg: ConfigContratacao,
): Peca[] {
  const z = cfg.prazos;
  const demo = z.demonstracao;
  const cabimento = peca(
    'informacao_cabimento',
    'Informação de cabimento e compromisso',
    'A contabilidade confirma que há verba no orçamento e dá o número de compromisso.',
  );
  const decisao = peca(
    'decisao_contratar',
    'Decisão de contratar e de autorizar a despesa',
    'Despacho de quem tem competência para o valor, com a escolha do procedimento fundamentada.',
  );
  const base = peca(
    'publicacao_base',
    'Publicação no portal BASE',
    'Registar o contrato no portal dos contratos públicos; sem isso o contrato não produz efeitos nem se pode pagar.',
    {
      prazo_dias: z.publicacao_base_dias,
      prazo: `até ${z.publicacao_base_dias} dias depois de celebrado o contrato`,
      demo,
    },
  );
  const convite = (nome: string, dias: number, desc: string) =>
    peca('convite', nome, desc, {
      gerada_aqui: true,
      prazo_dias: dias,
      prazo: `pelo menos ${dias} dias para apresentar propostas`,
      demo,
    });
  const caderno = (obrigatoria = true) =>
    peca(
      'caderno_encargos',
      'Caderno de encargos',
      'As cláusulas do contrato: o que se compra, prazo, preço, obrigações e penalidades.',
      { gerada_aqui: true, obrigatoria },
    );
  const comuns = {
    habilitacao: peca(
      'habilitacao',
      'Documentos de habilitação',
      'Certidões de não dívida (Finanças e Segurança Social), registo criminal e declaração de aceitação do caderno de encargos.',
    ),
    adjudicacao: peca(
      'adjudicacao',
      'Decisão de adjudicação e notificação',
      'Escolha da proposta e notificação ao adjudicatário (e aos outros concorrentes).',
    ),
    contrato: peca(
      'contrato',
      'Contrato escrito',
      'Minuta aprovada e contrato assinado (em alguns casos pode dispensar-se — a confirmar).',
    ),
    juri: peca(
      'juri',
      'Designação do júri',
      'Pelo menos três membros efetivos e dois suplentes (ou a fundamentação da dispensa, quando a lei o permitir).',
    ),
    relatorioPreliminar: peca(
      'relatorio_preliminar',
      'Relatório preliminar',
      'O júri analisa e ordena as propostas.',
    ),
    audiencia: peca(
      'audiencia_previa',
      'Audiência prévia',
      'Os concorrentes pronunciam-se sobre o relatório preliminar.',
      {
        prazo_dias: z.audiencia_previa_dias,
        prazo: `pelo menos ${z.audiencia_previa_dias} dias`,
        demo,
      },
    ),
    relatorioFinal: peca(
      'relatorio_final',
      'Relatório final',
      'Proposta de adjudicação depois da audiência prévia.',
    ),
  };

  switch (proc) {
    case 'ajuste_direto_simplificado':
      return [
        cabimento,
        peca(
          'proposta_ou_fatura',
          'Orçamento ou fatura da entidade',
          'A adjudicação pode ser feita sobre a fatura ou o orçamento, sem as outras formalidades (a confirmar).',
        ),
        decisao,
        convite(
          'Pedido de proposta',
          z.propostas_ajuste_direto_dias,
          'Opcional: um pedido curto à entidade, com o objeto e o preço.',
        ),
        caderno(false),
        base,
      ].map((x) => (x.codigo === 'convite' ? { ...x, obrigatoria: false } : x));
    case 'ajuste_direto':
      return [
        cabimento,
        decisao,
        convite(
          'Convite',
          z.propostas_ajuste_direto_dias,
          'Convite à entidade escolhida para apresentar proposta.',
        ),
        caderno(),
        comuns.adjudicacao,
        comuns.habilitacao,
        comuns.contrato,
        base,
      ];
    case 'consulta_previa':
      return [
        cabimento,
        decisao,
        convite(
          'Convite',
          z.propostas_consulta_previa_dias,
          'Convite a pelo menos três entidades para apresentarem proposta.',
        ),
        caderno(),
        comuns.juri,
        comuns.relatorioPreliminar,
        comuns.audiencia,
        comuns.relatorioFinal,
        comuns.adjudicacao,
        comuns.habilitacao,
        comuns.contrato,
        base,
      ];
    case 'concurso_publico': {
      const europeu =
        cfg.tipos[tipo].europeu_cent !== null &&
        valor >= (cfg.tipos[tipo].europeu_cent ?? 0);
      const dias = europeu
        ? z.propostas_concurso_europeu_dias
        : tipo === 'empreitada'
          ? z.propostas_concurso_empreitada_dias
          : z.propostas_concurso_dias;
      return [
        cabimento,
        decisao,
        peca(
          'anuncio_dr',
          'Anúncio no Diário da República',
          'O anúncio do concurso, publicado pela plataforma eletrónica.',
        ),
        ...(europeu
          ? [
              peca(
                'anuncio_joue',
                'Anúncio no Jornal Oficial da União Europeia',
                'O valor chega ao limiar europeu: o concurso tem publicidade internacional.',
              ),
            ]
          : []),
        convite(
          'Programa do procedimento',
          dias,
          'As regras do concurso: quem pode concorrer, documentos, critério de adjudicação e prazos.',
        ),
        caderno(),
        comuns.juri,
        comuns.relatorioPreliminar,
        comuns.audiencia,
        comuns.relatorioFinal,
        comuns.adjudicacao,
        comuns.habilitacao,
        comuns.contrato,
        base,
      ];
    }
  }
}

// --- Avaliação ----------------------------------------------------------------

export function avaliarProcedimento(
  p: PedidoAvaliacao,
  cfg: ConfigContratacao,
): ResultadoAvaliacao {
  const l = cfg.tipos[p.tipo];
  const valor = p.valor_estimado_cent;
  const acumulado = calcularAcumulado(p, cfg);
  const fracionamento = calcularFracionamento(p, cfg);
  const alertasGerais: string[] = [];

  const procedimentos = PROCEDIMENTOS.map((proc): AvaliacaoProcedimento => {
    const porque = [frasesValor(l, proc, valor)];
    const alertas: string[] = [];
    let admissivel = cabeNoValor(l, proc, valor);

    if (proc === 'ajuste_direto_simplificado') {
      const max = cfg.prazo_max_meses.ajuste_direto_simplificado;
      if (p.prazo_meses > max) {
        admissivel = false;
        porque.push(
          `O contrato dura ${p.prazo_meses} meses e o ajuste direto simplificado só serve até ${max} meses.`,
        );
      }
    }

    const lim = acumulado.limites.find((x) => x.procedimento === proc);
    if (lim?.ultrapassa) {
      admissivel = false;
      porque.push(
        `Com a mesma entidade (NIF ${acumulado.entidade_nif}) os contratos de ${acumulado.anos[0]} a ${acumulado.anos[acumulado.anos.length - 1]} ` +
          `somam ${eur(acumulado.total_cent)}${acumulado.incluir_contrato_atual ? ' com este' : ''}, ` +
          `o que chega ao limite acumulado de ${eur(lim.limite_cent)}: não se pode voltar a convidar esta entidade por ${NOMES_PROCEDIMENTO[proc]}.`,
      );
    } else if (lim && acumulado.contratos.length) {
      porque.push(
        `Com a mesma entidade os contratos somam ${eur(acumulado.total_cent)}${acumulado.incluir_contrato_atual ? ' com este' : ''}, abaixo do limite acumulado de ${eur(lim.limite_cent)}.`,
      );
    }

    if (
      admissivel &&
      fracionamento.alerta &&
      PROCEDIMENTOS.indexOf(proc) <
        PROCEDIMENTOS.indexOf(fracionamento.procedimento_pelo_total)
    ) {
      alertas.push(
        `Possível fracionamento: com os contratos semelhantes de ${fracionamento.ano} o total é ${eur(fracionamento.total_cent)}, que já pede ${NOMES_PROCEDIMENTO[fracionamento.procedimento_pelo_total]}.`,
      );
    }
    if (
      proc !== 'ajuste_direto_simplificado' &&
      p.prazo_meses > cfg.prazo_max_meses.geral
    ) {
      alertas.push(
        `O contrato dura ${p.prazo_meses} meses: mais de ${cfg.prazo_max_meses.geral} meses tem de ser fundamentado.`,
      );
    }
    if (
      proc === 'concurso_publico' &&
      l.europeu_cent !== null &&
      valor >= l.europeu_cent
    ) {
      alertas.push(
        `O valor chega a ${eur(l.europeu_cent)}: o concurso tem de ser publicado também no Jornal Oficial da União Europeia.`,
      );
    }

    return {
      procedimento: proc,
      nome: NOMES_PROCEDIMENTO[proc],
      admissivel,
      porque,
      alertas,
      limite_cent: limiarDe(l, proc),
      pecas: pecasDe(proc, p.tipo, valor, cfg),
    };
  });

  const recomendado =
    procedimentos.find((x) => x.admissivel)?.procedimento ?? 'concurso_publico';
  const cabeAjusteDireto = procedimentos.some(
    (x) =>
      x.admissivel &&
      (x.procedimento === 'ajuste_direto' ||
        x.procedimento === 'ajuste_direto_simplificado'),
  );

  if (!acumulado.verificado && acumulado.motivo)
    alertasGerais.push(acumulado.motivo);
  if (fracionamento.alerta && fracionamento.porque)
    alertasGerais.push(fracionamento.porque);
  if (acumulado.limites.some((x) => x.ultrapassa)) {
    alertasGerais.push(
      `A entidade com o NIF ${acumulado.entidade_nif} já chegou ao limite acumulado: pode convidar-se outra entidade ou usar um procedimento mais exigente.`,
    );
  }

  const v = eur(valor);
  const resumo = cabeAjusteDireto
    ? `Cabe no ${NOMES_PROCEDIMENTO[recomendado]}: ${NOMES_TIPO[p.tipo]} de ${v} sem IVA.`
    : `Não cabe no ajuste direto: ${NOMES_TIPO[p.tipo]} de ${v} sem IVA pede ${NOMES_PROCEDIMENTO[recomendado]}.`;

  return {
    tipo: p.tipo,
    valor_estimado_cent: valor,
    prazo_meses: p.prazo_meses,
    procedimentos,
    recomendado,
    cabe_ajuste_direto: cabeAjusteDireto,
    acumulado,
    fracionamento,
    alertas: alertasGerais,
    resumo,
    demonstracao: cfg.demonstracao || l.demonstracao,
    fonte: `${cfg.fonte}. ${l.fonte}.`,
    limiares: l,
  };
}
