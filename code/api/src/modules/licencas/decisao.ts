/*
 * "Os humanos só tratam das exceções": depois de correr as regras de um
 * tipo, decide quem fecha o pedido. Sem BD, para testar à parte.
 *
 * - 'automatica': cumpre todas as regras, tem todos os dados de que as
 *   regras precisam e a câmara deixou este tipo decidir sozinho. Emite-se
 *   logo que estiver pago (ou logo, se não tiver taxa).
 * - 'excecao': falhou uma regra (vai a um técnico) ou falta um dado que as
 *   regras precisam (um funcionário confirma). Fica o motivo concreto.
 * - 'funcionario': cumpre as regras, mas a câmara pediu que alguém confirme
 *   todos os pedidos deste tipo.
 *
 * Nada que falhe uma regra é aprovado sozinho: `podeEmitirSozinha` volta a
 * ver as regras guardadas antes de cada emissão automática.
 */
import type { AvaliacaoLicenca, RegraAvaliada } from './comum.js';
import type { TipoLicenca } from './tipos.js';

export type ViaDecisao = 'automatica' | 'excecao' | 'funcionario';

export interface MotivoExcecao {
  tipo: 'regra' | 'dado_em_falta';
  /** O id da regra que falhou ou o campo que falta. */
  id: string;
  /** Curto, para agrupar no indicador ("Antecedência", "Nº de pessoas"). */
  rotulo: string;
  /** A frase concreta deste pedido. */
  texto: string;
}

export interface Decisao {
  via: ViaDecisao;
  motivos: MotivoExcecao[];
}

/** O nome curto de cada regra (os ids que os avaliadores devolvem). */
export const ROTULOS_REGRAS: Record<TipoLicenca, Record<string, string>> = {
  ruido: {
    data: 'Data do pedido',
    antecedencia: 'Antecedência',
    hora_inicio: 'Hora de início',
    hora_fim: 'Hora de fim',
    duracao: 'Duração',
    pessoas: 'Número de pessoas',
    atividade: 'Obra fora de horas',
  },
  ocupacao_via: {
    data: 'Data do pedido',
    antecedencia: 'Antecedência',
    equipamento: 'Equipamento',
    area: 'Área ocupada',
    dias: 'Dias de ocupação',
    passeio: 'Passeio livre',
    estrada: 'Ocupa a estrada',
  },
  esplanada: {
    data: 'Data do pedido',
    antecedencia: 'Antecedência',
    area: 'Área',
    mesas: 'Mesas',
    passeio: 'Passeio livre',
    meses: 'Meses',
    estrado: 'Estrado ou estrutura fixa',
    centro_historico: 'Centro histórico',
  },
  distico_residente: {
    matricula: 'Matrícula',
    morada: 'Morada comprovada',
    viatura: 'Carro em nome de quem pede',
    por_fogo: 'Dísticos por casa',
  },
  publicidade: {
    data: 'Data do pedido',
    antecedencia: 'Antecedência',
    suporte: 'Suporte',
    proprio: 'Fora do próprio estabelecimento',
    area: 'Área do anúncio',
    meses: 'Meses',
    centro_historico: 'Centro histórico',
    iluminado: 'Anúncio iluminado',
  },
  recinto_improvisado: {
    data: 'Data do pedido',
    antecedencia: 'Antecedência',
    lotacao: 'Lotação',
    dias: 'Dias do evento',
    estruturas: 'Estruturas',
  },
};

export function rotuloRegra(tipo: TipoLicenca, id: string): string {
  return ROTULOS_REGRAS[tipo][id] ?? id;
}

/**
 * Dados opcionais na entrada da ferramenta que uma regra usa. Sem eles a
 * regra não corre: por isso, sem eles, o pedido não se decide sozinho.
 * `ativo` diz se, com estas regras, o dado conta (ex.: se a câmara não
 * manda a estrada a técnico, não interessa saber se ocupa a estrada).
 */
export interface DadoParaDecidir {
  campo: string;
  rotulo: string;
  /** Frase para o painel e para o agente: "Falta saber quantas pessoas vão." */
  falta: string;
  ativo(config: Record<string, unknown>): boolean;
}

export const DADOS_PARA_DECIDIR: Record<TipoLicenca, DadoParaDecidir[]> = {
  ruido: [
    {
      campo: 'pessoas',
      rotulo: 'Número de pessoas',
      falta: 'Falta saber quantas pessoas vão (a regra tem um máximo).',
      ativo: () => true,
    },
  ],
  ocupacao_via: [
    {
      campo: 'ocupa_estrada',
      rotulo: 'Ocupa a estrada',
      falta: 'Falta saber se ocupa a estrada ou lugares de estacionamento.',
      ativo: (c) => c.estrada_vai_a_tecnico === true,
    },
  ],
  esplanada: [
    {
      campo: 'estrado',
      rotulo: 'Estrado ou estrutura fixa',
      falta: 'Falta saber se leva estrado ou estrutura fixa.',
      ativo: (c) => c.estrado_vai_a_tecnico === true,
    },
    {
      campo: 'centro_historico',
      rotulo: 'Centro histórico',
      falta: 'Falta saber se fica no centro histórico.',
      ativo: (c) => c.centro_historico_vai_a_tecnico === true,
    },
  ],
  distico_residente: [],
  publicidade: [
    {
      campo: 'centro_historico',
      rotulo: 'Centro histórico',
      falta: 'Falta saber se fica no centro histórico.',
      ativo: (c) => c.centro_historico_vai_a_tecnico === true,
    },
  ],
  recinto_improvisado: [],
};

function motivoDeRegra(tipo: TipoLicenca, r: RegraAvaliada): MotivoExcecao {
  return {
    tipo: 'regra',
    id: r.id,
    rotulo: rotuloRegra(tipo, r.id),
    texto: r.texto,
  };
}

/** Os dados que as regras precisam e que não vieram no pedido. */
export function dadosEmFalta(
  tipo: TipoLicenca,
  dados: Record<string, unknown>,
  config: Record<string, unknown>,
): MotivoExcecao[] {
  return DADOS_PARA_DECIDIR[tipo]
    .filter((d) => d.ativo(config) && dados[d.campo] === undefined)
    .map((d) => ({
      tipo: 'dado_em_falta' as const,
      id: d.campo,
      rotulo: d.rotulo,
      texto: d.falta,
    }));
}

/** Quem fecha o pedido, e porquê (ver o topo do ficheiro). */
export function decidir(
  tipo: TipoLicenca,
  dados: Record<string, unknown>,
  config: { aprovacao: 'automatica' | 'funcionario' } & Record<string, unknown>,
  avaliacao: Pick<AvaliacaoLicenca, 'regras' | 'proposta'>,
): Decisao {
  const falhadas = avaliacao.regras.filter((r) => !r.ok);
  const emFalta = dadosEmFalta(tipo, dados, config);
  if (falhadas.length || avaliacao.proposta !== 'aprovar') {
    return {
      via: 'excecao',
      motivos: [...falhadas.map((r) => motivoDeRegra(tipo, r)), ...emFalta],
    };
  }
  if (config.aprovacao !== 'automatica') {
    // Quem confirma vê também o que falta saber.
    return { via: 'funcionario', motivos: emFalta };
  }
  if (emFalta.length) return { via: 'excecao', motivos: emFalta };
  return { via: 'automatica', motivos: [] };
}

/**
 * A última verificação antes de uma emissão sem ninguém: a licença foi
 * decidida como automática, a proposta é aprovar e todas as regras
 * guardadas passam. Se alguma coisa não bater, fica para uma pessoa.
 */
export function podeEmitirSozinha(l: {
  decisao: ViaDecisao | null;
  proposta: 'aprovar' | 'tecnico';
  avaliacao: { regras: RegraAvaliada[] };
  excecao?: MotivoExcecao[] | null;
}): boolean {
  return (
    l.decisao === 'automatica' &&
    l.proposta === 'aprovar' &&
    l.avaliacao.regras.length > 0 &&
    l.avaliacao.regras.every((r) => r.ok) &&
    !(l.excecao && l.excecao.length)
  );
}

/** Para o painel e para a página pública. */
export const VIA_DITA: Record<ViaDecisao, string> = {
  automatica: 'decidida automaticamente pelas regras',
  excecao: 'exceção: vai a uma pessoa',
  funcionario: 'um funcionário confirma (escolha da câmara)',
};
