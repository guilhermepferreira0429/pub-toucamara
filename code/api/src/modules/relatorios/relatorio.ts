import {
  indicadoresDoPeriodo,
  LinhaProcessosFase,
  LinhaResultados,
  LinhaTrabalho,
  resumir,
  resumirProcessos,
  TemaContado,
  topTemas,
  trabalhoFeito,
} from '../painel/agregados.js';
import {
  indicador,
  inicioSemana,
  Periodo,
  periodoAnterior,
  somarDias,
} from '../painel/periodos.js';

/*
 * Relatórios semanal e mensal: período e conteúdo (`relatorios.dados`).
 * Puro: as linhas vêm do PainelDadosService.
 */

export type TipoRelatorio = 'semanal' | 'mensal' | 'executivo';

/**
 * O período fechado antes de `hoje`: semanal = a semana passada (segunda a
 * domingo); mensal = o mês passado. Os jobs correm segunda e dia 1.
 */
export function periodoRelatorio(
  tipo: 'semanal' | 'mensal',
  hoje: string,
): Periodo {
  if (tipo === 'semanal') {
    const segunda = somarDias(inicioSemana(hoje), -7);
    return { de: segunda, ate: somarDias(segunda, 6) };
  }
  const primeiroDeste = `${hoje.slice(0, 8)}01`;
  const ate = somarDias(primeiroDeste, -1);
  return { de: `${ate.slice(0, 8)}01`, ate };
}

/**
 * Período anterior para comparar: no mensal o mês de calendário anterior
 * (outubro contra setembro, mesmo com tamanhos diferentes); nos outros o
 * período do mesmo tamanho imediatamente antes.
 */
export function periodoDeComparacao(tipo: TipoRelatorio, p: Periodo): Periodo {
  const mesInteiro =
    p.de.endsWith('-01') && somarDias(p.ate, 1).endsWith('-01');
  if (tipo === 'mensal' && mesInteiro) {
    const ate = somarDias(p.de, -1);
    return { de: `${ate.slice(0, 8)}01`, ate };
  }
  return periodoAnterior(p);
}

export interface EntradaRelatorio {
  municipio: { nome: string; slug: string };
  tipo: TipoRelatorio;
  periodo: Periodo;
  anterior: Periodo;
  resultados: { atual: LinhaResultados[]; anterior: LinhaResultados[] };
  trabalho: { atual: LinhaTrabalho; anterior: LinhaTrabalho };
  temas: {
    atual: TemaContado[];
    anterior: { tema_id: string; total: number }[];
  };
  semResposta: { texto: string; vezes: number; estado: string }[];
  ocorrenciasAbertas: number;
  processos: LinhaProcessosFase[];
}

const TITULOS: Record<TipoRelatorio, string> = {
  semanal: 'Relatório semanal',
  mensal: 'Relatório mensal',
  executivo: 'Relatório executivo',
};

/** O que fica em `relatorios.dados` e alimenta o PDF e o painel. */
export function montarDados(e: EntradaRelatorio) {
  const atual = resumir(e.resultados.atual);
  const ant = resumir(e.resultados.anterior);
  const t = e.trabalho.atual;
  const ta = e.trabalho.anterior;
  const mediaResolucao = (x: LinhaTrabalho) =>
    x.ocorrencias_resolvidas
      ? Math.round((x.horas_resolucao / x.ocorrencias_resolvidas) * 10) / 10
      : null;
  const processos = resumirProcessos(e.processos);
  return {
    titulo: TITULOS[e.tipo],
    municipio: e.municipio,
    tipo: e.tipo,
    periodo: e.periodo,
    periodo_anterior: e.anterior,
    totais: indicadoresDoPeriodo(atual, ant),
    trabalho_feito: trabalhoFeito(t, ta),
    top_temas: topTemas(e.temas.atual, e.temas.anterior, 10),
    sem_resposta: e.semResposta.slice(0, 10).map((s) => ({
      texto: s.texto,
      vezes: s.vezes,
      estado: s.estado,
    })),
    ocorrencias: {
      registadas: indicador(t.ocorrencias, ta.ocorrencias),
      resolvidas: indicador(
        t.ocorrencias_resolvidas,
        ta.ocorrencias_resolvidas,
      ),
      tempo_medio_resolucao_h: indicador(
        mediaResolucao(t),
        mediaResolucao(ta),
        'n',
      ),
      abertas_agora: e.ocorrenciasAbertas,
    },
    sms: {
      enviados: t.sms_enviados,
      segmentos: t.sms_segmentos,
      custo_cent: t.sms_custo_cent,
    },
    processos: {
      em_curso: processos.em_curso,
      atrasados: processos.atrasados,
      por_fase: processos.por_fase,
    },
  };
}

export type DadosRelatorio = ReturnType<typeof montarDados>;
