/*
 * Os tipos de licença decididos na chamada, num só sítio: o nome, o código
 * do processo, as regras (zod + valores por omissão), o avaliador puro, a
 * taxa, os campos que a câmara edita no painel e como se descreve a
 * licença na página do QR e no PDF. Sem BD.
 */
import { z } from 'zod';
import type { Feriados } from '../../common/dias-uteis.js';
import {
  AvaliacaoLicenca,
  CAMPOS_AVISOS,
  ConfigAvisos,
  dataPorExtenso,
  diaCurto,
  diaPorExtenso,
  num,
  somarDias,
  somarMeses,
} from './comum.js';
import {
  ATIVIDADES,
  avaliarRuido,
  CONFIG_RUIDO_OMISSAO,
  ConfigRuido,
  esquemaConfigRuido,
  lerConfigRuido,
  PedidoRuido,
} from './regras.js';
import {
  avaliarDistico,
  CONFIG_DISTICO_OMISSAO,
  ConfigDistico,
  entradaDistico,
  esquemaConfigDistico,
  lerConfigDistico,
  PedidoDistico,
} from './regras-distico.js';
import {
  avaliarEsplanada,
  CONFIG_ESPLANADA_OMISSAO,
  ConfigEsplanada,
  entradaEsplanada,
  esquemaConfigEsplanada,
  lerConfigEsplanada,
  PedidoEsplanada,
} from './regras-esplanada.js';
import {
  avaliarOcupacao,
  CONFIG_OCUPACAO_OMISSAO,
  ConfigOcupacao,
  entradaOcupacao,
  EQUIPAMENTOS,
  esquemaConfigOcupacao,
  lerConfigOcupacao,
  PedidoOcupacao,
} from './regras-ocupacao.js';
import {
  areaPublicidade,
  avaliarPublicidade,
  CONFIG_PUBLICIDADE_OMISSAO,
  ConfigPublicidade,
  entradaPublicidade,
  esquemaConfigPublicidade,
  isentaPublicidade,
  lerConfigPublicidade,
  PedidoPublicidade,
  SUPORTES,
} from './regras-publicidade.js';
import {
  avaliarRecinto,
  CONFIG_RECINTO_OMISSAO,
  ConfigRecinto,
  entradaRecinto,
  ESTRUTURAS,
  esquemaConfigRecinto,
  lerConfigRecinto,
  PedidoRecinto,
} from './regras-recinto.js';

export const TIPOS = [
  'ruido',
  'ocupacao_via',
  'esplanada',
  'distico_residente',
  'publicidade',
  'recinto_improvisado',
] as const;
export type TipoLicenca = (typeof TIPOS)[number];

/** Um número das regras, como o painel o mostra e edita. */
export interface CampoRegra {
  chave: string;
  rotulo: string;
  tipo:
    | 'hora'
    | 'inteiro'
    | 'decimal'
    | 'euros'
    | 'booleano'
    | 'opcoes'
    | 'lista_euros';
  unidade?: string;
  opcoes?: Record<string, string>;
}

/** Como a licença se descreve (página do QR, PDF, painel, SMS). */
export interface Resumo {
  /** O assunto do processo. */
  assunto: string;
  atividade: string;
  descricao: string;
  morada: string;
  /** "Dia" ou "Período" ou "Validade". */
  rotulo_dia: string;
  dia: string;
  horario: string | null;
  detalhes: { rotulo: string; valor: string }[];
  /** Até que dia vale (AAAA-MM-DD); null se ainda não foi emitida e depende disso. */
  valida_ate: string | null;
}

export interface DefTipo {
  tipo: TipoLicenca;
  /** "Licença especial de ruído". */
  nome: string;
  /** "licença de ruído" (no meio de uma frase). */
  curto: string;
  /** Para concordar: "emitida" / "emitido". */
  feminino: boolean;
  /** Código do tipo de processo e da numeração (LER 12/2026). */
  codigo: string;
  prazo_dias_uteis: number;
  ferramenta: string;
  esquemaConfig: z.ZodType;
  omissao: unknown;
  ler(v: unknown): unknown;
  campos: CampoRegra[];
  avaliar(
    dados: unknown,
    config: unknown,
    hoje: string,
    feriados: Feriados,
  ): AvaliacaoLicenca;
  /** `emitida`: dia da emissão (AAAA-MM-DD), se já foi emitida. */
  resumo(dados: unknown, config: unknown, emitida: string | null): Resumo;
  /**
   * Tem validade e renova-se (avisos antes de expirar e `renovar_licenca`):
   * os campos de `aviso_*` estão na config.
   */
  renovavel: boolean;
}

/** Os avisos de um tipo renovável (as regras já lidas). */
export function avisosDe(
  tipo: TipoLicenca,
  config: unknown,
): ConfigAvisos | null {
  if (!DEFS[tipo].renovavel) return null;
  const c = config as Partial<ConfigAvisos>;
  return {
    aviso_1_dias: c.aviso_1_dias ?? 0,
    aviso_2_dias: c.aviso_2_dias ?? 0,
    aviso_por_chamada: c.aviso_por_chamada ?? false,
  };
}

const RUIDO: DefTipo = {
  tipo: 'ruido',
  nome: 'Licença especial de ruído',
  curto: 'licença de ruído',
  feminino: true,
  codigo: 'LER',
  prazo_dias_uteis: 5,
  ferramenta: 'pedir_licenca_ruido',
  renovavel: false,
  esquemaConfig: esquemaConfigRuido,
  omissao: CONFIG_RUIDO_OMISSAO,
  ler: lerConfigRuido,
  campos: [
    { chave: 'hora_inicio_min', rotulo: 'Começa a partir das', tipo: 'hora' },
    {
      chave: 'hora_fim_max_semana',
      rotulo: 'Acaba até (dom. a qui.)',
      tipo: 'hora',
    },
    {
      chave: 'hora_fim_max_fds',
      rotulo: 'Acaba até (sex., sáb., véspera de feriado)',
      tipo: 'hora',
    },
    {
      chave: 'musica_exterior_ate',
      rotulo: 'Música no exterior até',
      tipo: 'hora',
    },
    {
      chave: 'antecedencia_min_dias_uteis',
      rotulo: 'Antecedência mínima',
      tipo: 'inteiro',
      unidade: 'dias úteis',
    },
    {
      chave: 'antecedencia_max_dias',
      rotulo: 'Antecedência máxima',
      tipo: 'inteiro',
      unidade: 'dias',
    },
    {
      chave: 'duracao_max_horas',
      rotulo: 'Duração máxima',
      tipo: 'inteiro',
      unidade: 'h',
    },
    { chave: 'pessoas_max', rotulo: 'Pessoas (sem análise)', tipo: 'inteiro' },
    { chave: 'taxa_cent', rotulo: 'Taxa', tipo: 'euros' },
  ],
  avaliar(dados, config, hoje, feriados) {
    const c = config as ConfigRuido;
    const a = avaliarRuido(dados as PedidoRuido, c, hoje, feriados);
    return {
      ...a,
      taxa: {
        linhas:
          c.taxa_cent > 0
            ? [
                {
                  codigo: 'LER',
                  descricao: 'Licença especial de ruído',
                  unidade: 'fixo',
                  quantidade: 1,
                  valor_unitario_cent: c.taxa_cent,
                  valor_cent: c.taxa_cent,
                },
              ]
            : [],
        total_cent: c.taxa_cent,
      },
    };
  },
  resumo(dados) {
    const d = dados as PedidoRuido & { descricao: string; morada: string };
    return {
      assunto: `${d.descricao} · ${diaCurto(d.data)}`,
      atividade: ATIVIDADES[d.atividade],
      descricao: d.descricao,
      morada: d.morada,
      rotulo_dia: 'Dia',
      dia: diaPorExtenso(d.data),
      horario: `${d.hora_inicio} às ${d.hora_fim}`,
      detalhes: [
        ...(d.pessoas ? [{ rotulo: 'Pessoas', valor: String(d.pessoas) }] : []),
        ...(d.musica_amplificada !== undefined
          ? [
              {
                rotulo: 'Música amplificada',
                valor: d.musica_amplificada ? 'sim' : 'não',
              },
            ]
          : []),
      ],
      valida_ate: d.data,
    };
  },
};

const OCUPACAO: DefTipo = {
  tipo: 'ocupacao_via',
  nome: 'Licença de ocupação da via pública',
  curto: 'licença de ocupação da via pública',
  feminino: true,
  codigo: 'OVP',
  prazo_dias_uteis: 10,
  ferramenta: 'pedir_licenca_ocupacao_via',
  renovavel: true,
  esquemaConfig: esquemaConfigOcupacao,
  omissao: CONFIG_OCUPACAO_OMISSAO,
  ler: lerConfigOcupacao,
  campos: [
    {
      chave: 'equipamentos',
      rotulo: 'Autorizado sem técnico',
      tipo: 'opcoes',
      opcoes: EQUIPAMENTOS,
    },
    {
      chave: 'area_max_m2',
      rotulo: 'Área máxima',
      tipo: 'decimal',
      unidade: 'm²',
    },
    {
      chave: 'dias_max',
      rotulo: 'Dias no máximo',
      tipo: 'inteiro',
      unidade: 'dias',
    },
    {
      chave: 'passeio_livre_min_m',
      rotulo: 'Passeio livre para peões',
      tipo: 'decimal',
      unidade: 'm',
    },
    {
      chave: 'estrada_vai_a_tecnico',
      rotulo: 'Ocupar a estrada vai a técnico',
      tipo: 'booleano',
    },
    {
      chave: 'antecedencia_min_dias_uteis',
      rotulo: 'Antecedência mínima',
      tipo: 'inteiro',
      unidade: 'dias úteis',
    },
    {
      chave: 'antecedencia_max_dias',
      rotulo: 'Antecedência máxima',
      tipo: 'inteiro',
      unidade: 'dias',
    },
    { chave: 'taxa_base_cent', rotulo: 'Taxa fixa', tipo: 'euros' },
    {
      chave: 'taxa_m2_dia_cent',
      rotulo: 'Taxa por m² e por dia',
      tipo: 'euros',
    },
    ...CAMPOS_AVISOS,
  ],
  avaliar: (d, c, h, f) =>
    avaliarOcupacao(d as PedidoOcupacao, c as ConfigOcupacao, h, f),
  resumo(dados) {
    const d = dados as PedidoOcupacao;
    const fim = somarDias(d.data_inicio, d.dias - 1);
    return {
      assunto: `${EQUIPAMENTOS[d.equipamento]} na via pública · ${d.descricao}`,
      atividade: `${EQUIPAMENTOS[d.equipamento]} na via pública`,
      descricao: d.descricao,
      morada: d.morada,
      rotulo_dia: 'Período',
      dia:
        d.dias === 1
          ? diaPorExtenso(d.data_inicio)
          : `De ${dataPorExtenso(d.data_inicio)} a ${dataPorExtenso(fim)} (${d.dias} dias)`,
      horario: null,
      detalhes: [
        { rotulo: 'Área ocupada', valor: `${num(d.area_m2)} m²` },
        { rotulo: 'Passeio livre', valor: `${num(d.passeio_livre_m)} m` },
        ...(d.ocupa_estrada
          ? [{ rotulo: 'Ocupa a estrada', valor: 'sim' }]
          : []),
      ],
      valida_ate: fim,
    };
  },
};

const ESPLANADA: DefTipo = {
  tipo: 'esplanada',
  nome: 'Licença de esplanada',
  curto: 'licença de esplanada',
  feminino: true,
  codigo: 'ESP',
  prazo_dias_uteis: 10,
  ferramenta: 'pedir_licenca_esplanada',
  renovavel: true,
  esquemaConfig: esquemaConfigEsplanada,
  omissao: CONFIG_ESPLANADA_OMISSAO,
  ler: lerConfigEsplanada,
  campos: [
    {
      chave: 'area_max_m2',
      rotulo: 'Área máxima',
      tipo: 'decimal',
      unidade: 'm²',
    },
    { chave: 'mesas_max', rotulo: 'Mesas no máximo', tipo: 'inteiro' },
    {
      chave: 'passeio_livre_min_m',
      rotulo: 'Passeio livre para peões',
      tipo: 'decimal',
      unidade: 'm',
    },
    {
      chave: 'meses_max',
      rotulo: 'Meses no máximo',
      tipo: 'inteiro',
      unidade: 'meses',
    },
    { chave: 'hora_fecho', rotulo: 'Recolhe até às', tipo: 'hora' },
    {
      chave: 'estrado_vai_a_tecnico',
      rotulo: 'Estrado ou estrutura fixa vai a técnico',
      tipo: 'booleano',
    },
    {
      chave: 'centro_historico_vai_a_tecnico',
      rotulo: 'Centro histórico vai a técnico',
      tipo: 'booleano',
    },
    {
      chave: 'antecedencia_min_dias_uteis',
      rotulo: 'Antecedência mínima',
      tipo: 'inteiro',
      unidade: 'dias úteis',
    },
    {
      chave: 'antecedencia_max_dias',
      rotulo: 'Antecedência máxima',
      tipo: 'inteiro',
      unidade: 'dias',
    },
    {
      chave: 'taxa_m2_mes_cent',
      rotulo: 'Taxa por m² e por mês',
      tipo: 'euros',
    },
    { chave: 'taxa_minima_cent', rotulo: 'Taxa mínima', tipo: 'euros' },
    ...CAMPOS_AVISOS,
  ],
  avaliar: (d, c, h, f) =>
    avaliarEsplanada(d as PedidoEsplanada, c as ConfigEsplanada, h, f),
  resumo(dados) {
    const d = dados as PedidoEsplanada;
    const fim = somarDias(somarMeses(d.data_inicio, d.meses), -1);
    return {
      assunto: `Esplanada · ${d.estabelecimento}`,
      atividade: `Esplanada aberta de ${d.estabelecimento}`,
      descricao: `${d.mesas} mesas em ${num(d.area_m2)} m²`,
      morada: d.morada,
      rotulo_dia: 'Período',
      dia: `De ${dataPorExtenso(d.data_inicio)} a ${dataPorExtenso(fim)}`,
      horario: null,
      detalhes: [
        { rotulo: 'Estabelecimento', valor: d.estabelecimento },
        { rotulo: 'Área', valor: `${num(d.area_m2)} m²` },
        { rotulo: 'Mesas', valor: String(d.mesas) },
        { rotulo: 'Passeio livre', valor: `${num(d.passeio_livre_m)} m` },
      ],
      valida_ate: fim,
    };
  },
};

const DISTICO: DefTipo = {
  tipo: 'distico_residente',
  nome: 'Dístico de residente',
  curto: 'dístico de residente',
  feminino: false,
  codigo: 'DRE',
  prazo_dias_uteis: 5,
  ferramenta: 'pedir_distico_residente',
  renovavel: true,
  esquemaConfig: esquemaConfigDistico,
  omissao: CONFIG_DISTICO_OMISSAO,
  ler: lerConfigDistico,
  campos: [
    {
      chave: 'disticos_max_por_fogo',
      rotulo: 'Dísticos por casa (sem análise)',
      tipo: 'inteiro',
    },
    {
      chave: 'taxa_por_ordem_cent',
      rotulo: 'Taxa por ano (1.º, 2.º, …)',
      tipo: 'lista_euros',
    },
    {
      chave: 'validade_meses',
      rotulo: 'Validade',
      tipo: 'inteiro',
      unidade: 'meses',
    },
    {
      chave: 'exige_morada_comprovada',
      rotulo: 'Exige morada comprovada',
      tipo: 'booleano',
    },
    {
      chave: 'exige_viatura_em_nome',
      rotulo: 'Exige o carro em nome de quem pede',
      tipo: 'booleano',
    },
    ...CAMPOS_AVISOS,
  ],
  avaliar: (d, c) => avaliarDistico(d as PedidoDistico, c as ConfigDistico),
  resumo(dados, config, emitida) {
    const d = dados as PedidoDistico;
    const c = config as ConfigDistico;
    const fim = emitida
      ? somarDias(somarMeses(emitida, c.validade_meses), -1)
      : null;
    return {
      assunto: `Dístico de residente · ${d.matricula}`,
      atividade: `Estacionar como residente o carro ${d.matricula}`,
      descricao: `Carro ${d.matricula}`,
      morada: d.morada,
      rotulo_dia: 'Validade',
      dia:
        emitida && fim
          ? `De ${dataPorExtenso(emitida)} a ${dataPorExtenso(fim)}`
          : `${c.validade_meses} meses a partir da emissão`,
      horario: null,
      detalhes: [
        { rotulo: 'Matrícula', valor: d.matricula },
        { rotulo: 'Dístico da casa', valor: `${d.disticos_ja_tem + 1}.º` },
      ],
      valida_ate: fim,
    };
  },
};

const PUBLICIDADE: DefTipo = {
  tipo: 'publicidade',
  nome: 'Licença de publicidade',
  curto: 'licença de publicidade',
  feminino: true,
  codigo: 'PUB',
  prazo_dias_uteis: 10,
  ferramenta: 'pedir_licenca_publicidade',
  renovavel: true,
  esquemaConfig: esquemaConfigPublicidade,
  omissao: CONFIG_PUBLICIDADE_OMISSAO,
  ler: lerConfigPublicidade,
  campos: [
    {
      chave: 'suportes',
      rotulo: 'Suportes aceites sem técnico',
      tipo: 'opcoes',
      opcoes: SUPORTES,
    },
    {
      chave: 'area_isenta_m2',
      rotulo: 'Isenta até (no próprio estabelecimento)',
      tipo: 'decimal',
      unidade: 'm²',
    },
    {
      chave: 'area_max_m2',
      rotulo: 'Área máxima sem técnico',
      tipo: 'decimal',
      unidade: 'm²',
    },
    {
      chave: 'alheia_vai_a_tecnico',
      rotulo: 'Fora do próprio estabelecimento vai a técnico',
      tipo: 'booleano',
    },
    {
      chave: 'centro_historico_vai_a_tecnico',
      rotulo: 'Centro histórico vai a técnico',
      tipo: 'booleano',
    },
    {
      chave: 'iluminado_vai_a_tecnico',
      rotulo: 'Iluminada vai a técnico',
      tipo: 'booleano',
    },
    {
      chave: 'meses_max',
      rotulo: 'Meses no máximo',
      tipo: 'inteiro',
      unidade: 'meses',
    },
    {
      chave: 'antecedencia_min_dias_uteis',
      rotulo: 'Antecedência mínima',
      tipo: 'inteiro',
      unidade: 'dias úteis',
    },
    {
      chave: 'antecedencia_max_dias',
      rotulo: 'Antecedência máxima',
      tipo: 'inteiro',
      unidade: 'dias',
    },
    {
      chave: 'taxa_m2_mes_cent',
      rotulo: 'Taxa por m² e por mês',
      tipo: 'euros',
    },
    {
      chave: 'taxa_iluminado_m2_mes_cent',
      rotulo: 'Taxa por m² e por mês (iluminada)',
      tipo: 'euros',
    },
    { chave: 'taxa_minima_cent', rotulo: 'Taxa mínima', tipo: 'euros' },
    ...CAMPOS_AVISOS,
  ],
  avaliar: (d, c, h, f) =>
    avaliarPublicidade(d as PedidoPublicidade, c as ConfigPublicidade, h, f),
  resumo(dados, config) {
    const d = dados as PedidoPublicidade;
    const fim = somarDias(somarMeses(d.data_inicio, d.meses), -1);
    const isenta = isentaPublicidade(d, config as ConfigPublicidade);
    return {
      assunto: `Publicidade · ${d.estabelecimento}`,
      atividade: `${SUPORTES[d.suporte]} de ${d.estabelecimento}`,
      descricao: d.mensagem,
      morada: d.morada,
      rotulo_dia: 'Período',
      dia: `De ${dataPorExtenso(d.data_inicio)} a ${dataPorExtenso(fim)}`,
      horario: null,
      detalhes: [
        { rotulo: 'Suporte', valor: SUPORTES[d.suporte] },
        {
          rotulo: 'Medidas',
          valor: `${num(d.largura_m)} × ${num(d.altura_m)} m (${num(areaPublicidade(d))} m²)`,
        },
        { rotulo: 'Iluminado', valor: d.iluminado ? 'sim' : 'não' },
        {
          rotulo: 'No próprio estabelecimento',
          valor: d.no_proprio_estabelecimento ? 'sim' : 'não',
        },
        ...(isenta
          ? [
              {
                rotulo: 'Regime',
                valor: 'mera comunicação (isenta de licença)',
              },
            ]
          : []),
      ],
      valida_ate: fim,
    };
  },
};

const RECINTO: DefTipo = {
  tipo: 'recinto_improvisado',
  nome: 'Licença de recinto improvisado',
  curto: 'licença de recinto improvisado',
  feminino: true,
  codigo: 'LRI',
  prazo_dias_uteis: 10,
  ferramenta: 'pedir_licenca_recinto_improvisado',
  renovavel: false,
  esquemaConfig: esquemaConfigRecinto,
  omissao: CONFIG_RECINTO_OMISSAO,
  ler: lerConfigRecinto,
  campos: [
    {
      chave: 'estruturas',
      rotulo: 'Estruturas aceites sem vistoria',
      tipo: 'opcoes',
      opcoes: ESTRUTURAS,
    },
    {
      chave: 'lotacao_max',
      rotulo: 'Lotação sem vistoria',
      tipo: 'inteiro',
      unidade: 'pessoas',
    },
    {
      chave: 'dias_max',
      rotulo: 'Dias no máximo',
      tipo: 'inteiro',
      unidade: 'dias',
    },
    {
      chave: 'antecedencia_min_dias_uteis',
      rotulo: 'Antecedência mínima',
      tipo: 'inteiro',
      unidade: 'dias úteis',
    },
    {
      chave: 'antecedencia_max_dias',
      rotulo: 'Antecedência máxima',
      tipo: 'inteiro',
      unidade: 'dias',
    },
    { chave: 'taxa_base_cent', rotulo: 'Taxa fixa', tipo: 'euros' },
    { chave: 'taxa_dia_cent', rotulo: 'Taxa por dia', tipo: 'euros' },
  ],
  avaliar: (d, c, h, f) =>
    avaliarRecinto(d as PedidoRecinto, c as ConfigRecinto, h, f),
  resumo(dados) {
    const d = dados as PedidoRecinto;
    const fim = somarDias(d.data_inicio, d.dias - 1);
    return {
      assunto: `Recinto improvisado · ${d.descricao}`,
      atividade: `Recinto improvisado: ${d.descricao}`,
      descricao: d.descricao,
      morada: d.morada,
      rotulo_dia: 'Período',
      dia:
        d.dias === 1
          ? diaPorExtenso(d.data_inicio)
          : `De ${dataPorExtenso(d.data_inicio)} a ${dataPorExtenso(fim)} (${d.dias} dias)`,
      horario: null,
      detalhes: [
        { rotulo: 'Lotação', valor: `${d.lotacao} pessoas` },
        {
          rotulo: 'Estruturas',
          valor: d.estruturas.length
            ? d.estruturas.map((e) => ESTRUTURAS[e].toLowerCase()).join(', ')
            : 'nenhuma',
        },
        {
          rotulo: 'Música',
          valor: d.musica ? 'sim (com licença de ruído)' : 'não',
        },
      ],
      valida_ate: fim,
    };
  },
};

export const DEFS: Record<TipoLicenca, DefTipo> = {
  ruido: RUIDO,
  ocupacao_via: OCUPACAO,
  esplanada: ESPLANADA,
  distico_residente: DISTICO,
  publicidade: PUBLICIDADE,
  recinto_improvisado: RECINTO,
};

/** As entradas das ferramentas novas (a do ruído está no serviço). */
export const ENTRADAS = {
  ocupacao_via: entradaOcupacao,
  esplanada: entradaEsplanada,
  distico_residente: entradaDistico,
  publicidade: entradaPublicidade,
  recinto_improvisado: entradaRecinto,
};

export const esquemaTipo = z.enum(TIPOS);

/** "aprovado na hora" / "vai a técnico", para a simulação. */
export function decisaoDita(proposta: 'aprovar' | 'tecnico'): string {
  return proposta === 'aprovar' ? 'aprovado na hora' : 'vai a técnico';
}
