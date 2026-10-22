import type { Feriados } from '../../common/dias-uteis.js';
import {
  agregar,
  Pergunta,
  SEM_FREGUESIA,
} from '../consultas-publicas/regras.js';
import { diasUteis, resumoDecididos } from '../painel/gestao.js';
import { media } from '../perguntas-chefia/consulta.js';
import {
  Coluna,
  Frequencia,
  Linha,
  LinhaBruta,
  pct,
  suprimirLinha,
  suprimirLinhas,
  tabelar,
  totaisPorMes,
} from './regras.js';

/*
 * Os conjuntos de dados abertos, definidos em código: metadados, colunas e a
 * conta (pura) que transforma os factos lidos da BD em linhas agregadas. Os
 * factos já vêm sem nada que identifique alguém (sem nomes, telefones, NIF,
 * ids nem textos livres); a morada da ocorrência só serve para achar a
 * freguesia e nunca sai daqui.
 */

export const IDS_CONJUNTOS = [
  'ocorrencias',
  'processos',
  'atendimento',
  'reclamacoes',
  'consultas-publicas',
  'licencas',
] as const;
export type IdConjunto = (typeof IDS_CONJUNTOS)[number];

export interface DefConjunto {
  id: IdConjunto;
  /** Sobe quando as colunas ou a conta mudam (fica em cada publicação). */
  versao: number;
  titulo: string;
  descricao: string;
  palavras_chave: string[];
  frequencia: Frequencia;
  colunas: Coluna[];
  notas: string[];
}

/** O resultado de uma conta, antes da supressão. */
export interface Tabela {
  linhas: LinhaBruta[];
  /** Totais por mês ('AAAA-MM'), só com as medidas. */
  resumo: Record<string, LinhaBruta>;
}

export const SEM_FREGUESIA_IDENTIFICADA = 'Sem freguesia identificada';
export const OUTRA_FREGUESIA = 'Outra freguesia';
export const SEM_SERVICO = 'Sem serviço atribuído';

const mes: Coluna = {
  nome: 'mes',
  tipo: 'mes',
  descricao: 'Mês (AAAA-MM), no fuso do município.',
};

// ---------------------------------------------------------------------------
// Definições
// ---------------------------------------------------------------------------

export const CONJUNTOS: Record<IdConjunto, DefConjunto> = {
  ocorrencias: {
    id: 'ocorrencias',
    versao: 1,
    titulo: 'Ocorrências na via pública por categoria, freguesia e mês',
    descricao:
      'Problemas reportados à câmara (buracos, iluminação, lixo, ...) por telefone, chat, SMS ou balcão, com quantos já foram resolvidos e o tempo médio até à resolução.',
    palavras_chave: [
      'ocorrências',
      'espaço público',
      'manutenção',
      'freguesias',
    ],
    frequencia: 'diaria',
    colunas: [
      mes,
      {
        nome: 'categoria',
        tipo: 'texto',
        descricao: 'Categoria da ocorrência.',
      },
      {
        nome: 'freguesia',
        tipo: 'texto',
        descricao: `Freguesia, reconhecida na morada a partir da lista de freguesias do município ("${SEM_FREGUESIA_IDENTIFICADA}" quando não se reconhece).`,
      },
      {
        nome: 'reportadas',
        tipo: 'contagem',
        descricao:
          'Ocorrências reportadas no mês (sem os avisos repetidos do mesmo problema nem as rejeitadas).',
      },
      {
        nome: 'resolvidas',
        tipo: 'contagem',
        descricao: 'Das reportadas no mês, quantas já estão resolvidas.',
      },
      {
        nome: 'em_aberto',
        tipo: 'contagem',
        descricao: 'Das reportadas no mês, quantas ainda estão por resolver.',
      },
      {
        nome: 'tempo_medio_resolucao_dias',
        tipo: 'decimal',
        base: 'resolvidas',
        descricao:
          'Tempo médio entre o registo e a resolução, em dias de calendário (uma casa decimal).',
      },
    ],
    notas: [
      'O mês é o do registo da ocorrência: as resolvidas são as desse mês que já foram resolvidas até à data da publicação.',
    ],
  },
  processos: {
    id: 'processos',
    versao: 1,
    titulo: 'Processos (pedidos à câmara) por tipo e mês',
    descricao:
      'Pedidos que deram entrada e decisões tomadas, por tipo de processo: tempo médio até à decisão, percentagem decidida dentro do prazo legal e percentagem de pedidos que chegaram completos à primeira.',
    palavras_chave: ['processos', 'urbanismo', 'prazos', 'licenciamento'],
    frequencia: 'diaria',
    colunas: [
      mes,
      {
        nome: 'tipo_codigo',
        tipo: 'texto',
        descricao: 'Código do tipo de processo.',
      },
      { nome: 'tipo', tipo: 'texto', descricao: 'Nome do tipo de processo.' },
      {
        nome: 'prazo_legal_dias_uteis',
        tipo: 'inteiro',
        descricao: 'Prazo legal de decisão deste tipo, em dias úteis.',
      },
      {
        nome: 'entrados',
        tipo: 'contagem',
        descricao: 'Processos que deram entrada no mês.',
      },
      {
        nome: 'completos_a_primeira_pct',
        tipo: 'percentagem',
        base: 'entrados',
        parte: '_completos',
        descricao:
          'Dos que deram entrada no mês, % que chegaram já com todos os documentos (o prazo começou no próprio dia).',
      },
      {
        nome: 'decididos',
        tipo: 'contagem',
        descricao: 'Processos decididos no mês.',
      },
      {
        nome: 'tempo_medio_decisao_dias_uteis',
        tipo: 'decimal',
        base: 'decididos',
        descricao:
          'Dos decididos no mês, tempo médio da entrada à decisão, em dias úteis (sem fins de semana nem feriados).',
      },
      {
        nome: 'dentro_do_prazo_pct',
        tipo: 'percentagem',
        base: '_com_prazo',
        parte: '_no_prazo',
        descricao:
          'Dos decididos no mês que tinham prazo a correr, % decididos até ao fim do prazo legal.',
      },
    ],
    notas: [
      'Entrados conta pelo mês de entrada; decididos, tempo e prazo contam pelo mês da decisão.',
      'O prazo legal só começa a contar com o processo completo: os que nunca ficaram completos não entram na percentagem dentro do prazo.',
    ],
  },
  atendimento: {
    id: 'atendimento',
    versao: 1,
    titulo: 'Atendimento por canal e mês',
    descricao:
      'Conversas com o atendimento da câmara (telefone, chat, SMS, WhatsApp, email) e como terminaram: resolvidas pelo agente, passadas a um funcionário ou sem resposta.',
    palavras_chave: ['atendimento', 'munícipes', 'canais', 'serviço público'],
    frequencia: 'diaria',
    colunas: [
      mes,
      {
        nome: 'canal',
        tipo: 'texto',
        descricao: 'telefone, chat, sms, whatsapp, email ou balcao.',
      },
      {
        nome: 'conversas',
        tipo: 'contagem',
        descricao: 'Conversas iniciadas no mês.',
      },
      {
        nome: 'resolvidas_pelo_agente',
        tipo: 'contagem',
        descricao:
          'Resolvidas sem passar a um funcionário (inclui as que terminaram com uma marcação).',
      },
      {
        nome: 'resolvidas_pelo_agente_pct',
        tipo: 'percentagem',
        base: 'conversas',
        parte: 'resolvidas_pelo_agente',
        descricao: '% das conversas resolvidas pelo agente.',
      },
      {
        nome: 'passadas_a_funcionario',
        tipo: 'contagem',
        descricao: 'Passadas a um funcionário da câmara, com o caso resumido.',
      },
      {
        nome: 'sem_resposta',
        tipo: 'contagem',
        descricao: 'Conversas em que o agente não tinha a resposta.',
      },
      {
        nome: 'fora_de_horas',
        tipo: 'contagem',
        descricao: 'Conversas fora do horário do balcão.',
      },
      {
        nome: 'duracao_media_minutos',
        tipo: 'decimal',
        base: '_com_duracao',
        descricao:
          'Duração média das conversas com duração conhecida, em minutos.',
      },
    ],
    notas: ['O mês é o do início da conversa.'],
  },
  reclamacoes: {
    id: 'reclamacoes',
    versao: 1,
    titulo: 'Reclamações por serviço e mês',
    descricao:
      'Reclamações formais (livro de reclamações) recebidas, respondidas e respondidas dentro do prazo, por serviço da câmara.',
    palavras_chave: [
      'reclamações',
      'livro de reclamações',
      'prazos',
      'serviços',
    ],
    frequencia: 'diaria',
    colunas: [
      mes,
      {
        nome: 'servico',
        tipo: 'texto',
        descricao: `Serviço da câmara que trata a reclamação ("${SEM_SERVICO}" enquanto ninguém a tem).`,
      },
      {
        nome: 'recebidas',
        tipo: 'contagem',
        descricao: 'Reclamações recebidas no mês.',
      },
      {
        nome: 'respondidas',
        tipo: 'contagem',
        descricao: 'Das recebidas no mês, quantas já foram respondidas.',
      },
      {
        nome: 'respondidas_no_prazo',
        tipo: 'contagem',
        descricao: 'Das respondidas, quantas até à data-limite.',
      },
      {
        nome: 'respondidas_no_prazo_pct',
        tipo: 'percentagem',
        base: 'respondidas',
        parte: 'respondidas_no_prazo',
        descricao: '% das respondidas que o foram dentro do prazo.',
      },
      {
        nome: 'em_atraso',
        tipo: 'contagem',
        descricao:
          'Das recebidas no mês, quantas estão por responder e já passaram a data-limite.',
      },
      {
        nome: 'tempo_medio_resposta_dias_uteis',
        tipo: 'decimal',
        base: 'respondidas',
        descricao: 'Tempo médio até à resposta, em dias úteis.',
      },
    ],
    notas: ['O mês é o da receção da reclamação.'],
  },
  'consultas-publicas': {
    id: 'consultas-publicas',
    versao: 1,
    titulo: 'Resultados das consultas públicas fechadas, por freguesia',
    descricao:
      'As respostas às perguntas de cada consulta pública já fechada, contadas por opção e por freguesia de quem participou.',
    palavras_chave: ['consultas públicas', 'participação', 'freguesias'],
    frequencia: 'diaria',
    colunas: [
      {
        nome: 'consulta_codigo',
        tipo: 'texto',
        descricao: 'Código da consulta (o do link público).',
      },
      { nome: 'consulta', tipo: 'texto', descricao: 'Título da consulta.' },
      {
        nome: 'fechada_em',
        tipo: 'data',
        descricao: 'Último dia para participar (AAAA-MM-DD).',
      },
      { nome: 'pergunta', tipo: 'texto', descricao: 'A pergunta.' },
      { nome: 'opcao', tipo: 'texto', descricao: 'A opção de resposta.' },
      {
        nome: 'freguesia',
        tipo: 'texto',
        descricao: `Freguesia de quem participou ("${OUTRA_FREGUESIA}" fora da lista do município, "${SEM_FREGUESIA}" quando não a disse).`,
      },
      {
        nome: 'respostas',
        tipo: 'contagem',
        descricao: 'Quantas pessoas desta freguesia escolheram esta opção.',
      },
      {
        nome: 'respostas_freguesia',
        tipo: 'contagem',
        descricao:
          'Quantas pessoas desta freguesia responderam a esta pergunta.',
      },
      {
        nome: 'pct',
        tipo: 'percentagem',
        base: 'respostas_freguesia',
        parte: 'respostas',
        descricao: '% das respostas da freguesia que escolheram esta opção.',
      },
    ],
    notas: [
      'Só consultas fechadas. As opiniões livres não se publicam (são textos das pessoas).',
    ],
  },
  licencas: {
    id: 'licencas',
    versao: 1,
    titulo: 'Licenças pedidas e emitidas por tipo e mês',
    descricao:
      'Licenças municipais simples (ruído, ocupação da via pública, esplanadas, dísticos de residente, publicidade, recintos improvisados) pedidas, emitidas e recusadas.',
    palavras_chave: ['licenças', 'licenciamento', 'espaço público'],
    frequencia: 'diaria',
    colunas: [
      mes,
      {
        nome: 'tipo_codigo',
        tipo: 'texto',
        descricao: 'Código do tipo de licença.',
      },
      { nome: 'tipo', tipo: 'texto', descricao: 'Nome do tipo de licença.' },
      {
        nome: 'pedidas',
        tipo: 'contagem',
        descricao: 'Licenças pedidas no mês.',
      },
      {
        nome: 'emitidas',
        tipo: 'contagem',
        descricao: 'Licenças emitidas no mês.',
      },
      {
        nome: 'emitidas_sem_tecnico',
        tipo: 'contagem',
        descricao:
          'Das emitidas, quantas cumpriam as regras na hora e não precisaram de análise de um técnico.',
      },
      {
        nome: 'recusadas',
        tipo: 'contagem',
        descricao: 'Licenças recusadas no mês.',
      },
    ],
    notas: [
      'Pedidas conta pelo mês do pedido; emitidas e recusadas pelo mês da decisão.',
    ],
  },
};

export function eConjunto(id: string): id is IdConjunto {
  return (IDS_CONJUNTOS as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// Factos (o que a BD devolve, já sem dados pessoais) e as contas
// ---------------------------------------------------------------------------

export interface FactoOcorrencia extends Record<string, unknown> {
  mes: string;
  categoria: string;
  freguesia: string;
  aberta: boolean;
  /** Horas até à resolução; null se ainda não foi resolvida. */
  horas: number | null;
}

export function tabelaOcorrencias(
  fs: readonly FactoOcorrencia[],
  meses: readonly string[],
): Tabela {
  const medidas = (g: readonly FactoOcorrencia[]): LinhaBruta => {
    const resolvidas = g.filter((f) => f.horas !== null);
    return {
      reportadas: g.length,
      resolvidas: resolvidas.length,
      em_aberto: g.filter((f) => f.aberta).length,
      tempo_medio_resolucao_dias: media(
        resolvidas.map((f) => (f.horas as number) / 24),
      ),
    };
  };
  return {
    linhas: tabelar(fs, ['mes', 'categoria', 'freguesia'], medidas),
    resumo: totaisPorMes(fs, meses, medidas),
  };
}

export type FactoProcesso = {
  mes: string;
  tipo_codigo: string;
  tipo: string;
  prazo_legal_dias_uteis: number;
} & (
  | { kind: 'entrada'; completo: boolean }
  | {
      kind: 'decisao';
      entrada: string;
      decisao: string;
      prazo_fim: string | null;
    }
);

export function tabelaProcessos(
  fs: readonly FactoProcesso[],
  meses: readonly string[],
  feriados: Feriados,
): Tabela {
  const medidas = (g: readonly FactoProcesso[]): LinhaBruta => {
    const entrados = g.filter((f) => f.kind === 'entrada');
    const decididos = g.filter((f) => f.kind === 'decisao');
    const r = resumoDecididos(decididos, feriados);
    const completos = entrados.filter((f) => f.completo).length;
    return {
      entrados: entrados.length,
      _completos: completos,
      completos_a_primeira_pct: pct(completos, entrados.length),
      decididos: decididos.length,
      tempo_medio_decisao_dias_uteis: r.media_dias_uteis,
      dentro_do_prazo_pct: r.dentro_do_prazo_pct,
      _com_prazo: r.com_prazo,
      _no_prazo: decididos.filter(
        (f) => f.prazo_fim && f.decisao <= f.prazo_fim,
      ).length,
    };
  };
  return {
    linhas: tabelar(
      fs as (FactoProcesso & Record<string, unknown>)[],
      ['mes', 'tipo_codigo', 'tipo', 'prazo_legal_dias_uteis'],
      medidas,
    ),
    resumo: totaisPorMes(fs, meses, medidas),
  };
}

/** Uma linha de mv_resultados_periodo somada por mês e canal. */
export interface FactoAtendimento extends Record<string, unknown> {
  mes: string;
  canal: string;
  conversas: number;
  resolvidas: number;
  passadas: number;
  sem_resposta: number;
  fora_de_horas: number;
  duracao_total_s: number;
  com_duracao: number;
}

export function tabelaAtendimento(
  fs: readonly FactoAtendimento[],
  meses: readonly string[],
): Tabela {
  const medidas = (g: readonly FactoAtendimento[]): LinhaBruta => {
    const soma = (k: keyof FactoAtendimento) =>
      g.reduce((s, f) => s + Number(f[k] ?? 0), 0);
    const conversas = soma('conversas');
    const comDuracao = soma('com_duracao');
    return {
      conversas,
      resolvidas_pelo_agente: soma('resolvidas'),
      resolvidas_pelo_agente_pct: pct(soma('resolvidas'), conversas),
      passadas_a_funcionario: soma('passadas'),
      sem_resposta: soma('sem_resposta'),
      fora_de_horas: soma('fora_de_horas'),
      duracao_media_minutos: comDuracao
        ? Math.round((soma('duracao_total_s') / comDuracao / 60) * 10) / 10
        : null,
      _com_duracao: comDuracao,
    };
  };
  return {
    linhas: tabelar(fs, ['mes', 'canal'], medidas),
    resumo: totaisPorMes(fs, meses, medidas),
  };
}

export interface FactoReclamacao extends Record<string, unknown> {
  mes: string;
  servico: string;
  recebida_em: string;
  responder_ate: string;
  /** Dia da resposta; null se ainda não foi respondida. */
  respondida_dia: string | null;
}

export function tabelaReclamacoes(
  fs: readonly FactoReclamacao[],
  meses: readonly string[],
  hoje: string,
  feriados: Feriados,
): Tabela {
  const medidas = (g: readonly FactoReclamacao[]): LinhaBruta => {
    const resp = g.filter((f) => f.respondida_dia);
    const noPrazo = resp.filter(
      (f) => (f.respondida_dia as string) <= f.responder_ate,
    );
    return {
      recebidas: g.length,
      respondidas: resp.length,
      respondidas_no_prazo: noPrazo.length,
      respondidas_no_prazo_pct: pct(noPrazo.length, resp.length),
      em_atraso: g.filter((f) => !f.respondida_dia && hoje > f.responder_ate)
        .length,
      tempo_medio_resposta_dias_uteis: media(
        resp.map((f) =>
          Math.max(
            0,
            diasUteis(f.recebida_em, f.respondida_dia as string, feriados),
          ),
        ),
      ),
    };
  };
  return {
    linhas: tabelar(fs, ['mes', 'servico'], medidas),
    resumo: totaisPorMes(fs, meses, medidas),
  };
}

export interface FactoConsulta {
  codigo: string;
  titulo: string;
  fecha_em: string;
  perguntas: Pergunta[];
  /** As freguesias que a câmara definiu (null = todo o concelho). */
  freguesias: string[] | null;
  /** Já resolvidas para a lista (ou OUTRA_FREGUESIA, ou null se não disse). */
  participacoes: {
    respostas: Record<string, string>;
    freguesia: string | null;
  }[];
}

/** Reaproveita o `agregar` das consultas públicas (o mesmo que o painel mostra). */
export function tabelaConsultas(cs: readonly FactoConsulta[]): Tabela {
  const linhas: LinhaBruta[] = [];
  const ordenadas = [...cs].sort(
    (a, b) =>
      b.fecha_em.localeCompare(a.fecha_em) || a.codigo.localeCompare(b.codigo),
  );
  for (const c of ordenadas) {
    const r = agregar(c.perguntas, c.participacoes, c.freguesias);
    for (const p of r.perguntas) {
      for (const f of p.por_freguesia) {
        for (const o of c.perguntas.find((q) => q.id === p.id)?.opcoes ?? []) {
          const n = f.opcoes[o.id] ?? 0;
          linhas.push({
            consulta_codigo: c.codigo,
            consulta: c.titulo,
            fechada_em: c.fecha_em,
            pergunta: p.texto,
            opcao: o.texto,
            freguesia: f.freguesia,
            respostas: n,
            respostas_freguesia: f.total,
            pct: pct(n, f.total),
          });
        }
      }
    }
  }
  return { linhas, resumo: {} };
}

export type FactoLicenca = {
  mes: string;
  tipo_codigo: string;
  tipo: string;
} & (
  | { kind: 'pedido' }
  | { kind: 'decisao'; emitida: boolean; sem_tecnico: boolean }
);

export function tabelaLicencas(
  fs: readonly FactoLicenca[],
  meses: readonly string[],
): Tabela {
  const medidas = (g: readonly FactoLicenca[]): LinhaBruta => {
    const decisoes = g.filter((f) => f.kind === 'decisao');
    const emitidas = decisoes.filter((f) => f.emitida);
    return {
      pedidas: g.filter((f) => f.kind === 'pedido').length,
      emitidas: emitidas.length,
      emitidas_sem_tecnico: emitidas.filter((f) => f.sem_tecnico).length,
      recusadas: decisoes.length - emitidas.length,
    };
  };
  return {
    linhas: tabelar(
      fs as (FactoLicenca & Record<string, unknown>)[],
      ['mes', 'tipo_codigo', 'tipo'],
      medidas,
    ),
    resumo: totaisPorMes(fs, meses, medidas),
  };
}

// ---------------------------------------------------------------------------
// Supressão final
// ---------------------------------------------------------------------------

/** Linhas sem nenhuma contagem (tudo a zero) não dizem nada: saem. */
function temAlgo(def: DefConjunto, l: LinhaBruta): boolean {
  return def.colunas.some(
    (c) => c.tipo === 'contagem' && Number(l[c.nome] ?? 0) > 0,
  );
}

export interface TabelaPublicada {
  linhas: Linha[];
  resumo: Record<string, Linha>;
}

/** A tabela como se publica: contagens pequenas escondidas, sem colunas internas. */
export function publicar(def: DefConjunto, t: Tabela): TabelaPublicada {
  const medidas = def.colunas.filter(
    (c) => !['texto', 'mes', 'data', 'inteiro'].includes(c.tipo),
  );
  const linhas =
    def.id === 'consultas-publicas'
      ? t.linhas
      : t.linhas.filter((l) => temAlgo(def, l));
  return {
    linhas: suprimirLinhas(def.colunas, linhas),
    resumo: Object.fromEntries(
      Object.entries(t.resumo).map(([m, l]) => [m, suprimirLinha(medidas, l)]),
    ),
  };
}
