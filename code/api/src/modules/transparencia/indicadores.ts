import type { IdConjunto } from './conjuntos.js';
import { Linha, mesPorExtenso, SUPRIMIDO, Valor } from './regras.js';

/*
 * Os números do mês para a câmara pôr no site: cada um vem do resumo da
 * última publicação de um conjunto (já com a supressão aplicada), com a
 * data e a ligação ao conjunto de origem. Puro.
 */

interface DefIndicador {
  id: string;
  titulo: string;
  conjunto: IdConjunto;
  coluna: string;
  unidade: '%' | 'dias' | 'dias úteis' | 'número';
  /** Outra coluna do mesmo resumo, para "x de y". */
  de?: string;
}

export const INDICADORES: readonly DefIndicador[] = [
  {
    id: 'resolvidos_pelo_agente_pct',
    titulo:
      'Pedidos resolvidos pelo atendimento automático, sem esperar por um funcionário',
    conjunto: 'atendimento',
    coluna: 'resolvidas_pelo_agente_pct',
    unidade: '%',
  },
  {
    id: 'conversas',
    titulo:
      'Conversas com o atendimento (telefone, chat, SMS, WhatsApp, email)',
    conjunto: 'atendimento',
    coluna: 'conversas',
    unidade: 'número',
  },
  {
    id: 'ocorrencias_resolvidas',
    titulo: 'Ocorrências reportadas no mês que já estão resolvidas',
    conjunto: 'ocorrencias',
    coluna: 'resolvidas',
    de: 'reportadas',
    unidade: 'número',
  },
  {
    id: 'tempo_medio_resolucao_ocorrencias',
    titulo: 'Tempo médio para resolver uma ocorrência',
    conjunto: 'ocorrencias',
    coluna: 'tempo_medio_resolucao_dias',
    unidade: 'dias',
  },
  {
    id: 'processos_dentro_do_prazo_pct',
    titulo: 'Processos decididos dentro do prazo legal',
    conjunto: 'processos',
    coluna: 'dentro_do_prazo_pct',
    unidade: '%',
  },
  {
    id: 'tempo_medio_decisao_processos',
    titulo: 'Tempo médio até à decisão de um processo',
    conjunto: 'processos',
    coluna: 'tempo_medio_decisao_dias_uteis',
    unidade: 'dias úteis',
  },
  {
    id: 'tempo_medio_resposta_reclamacoes',
    titulo: 'Tempo médio de resposta às reclamações',
    conjunto: 'reclamacoes',
    coluna: 'tempo_medio_resposta_dias_uteis',
    unidade: 'dias úteis',
  },
  {
    id: 'reclamacoes_no_prazo_pct',
    titulo: 'Reclamações respondidas dentro do prazo',
    conjunto: 'reclamacoes',
    coluna: 'respondidas_no_prazo_pct',
    unidade: '%',
  },
  {
    id: 'licencas_emitidas',
    titulo: 'Licenças emitidas',
    conjunto: 'licencas',
    coluna: 'emitidas',
    unidade: 'número',
  },
];

const formato = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 });

/** O valor como se lê no site: "73,5 %", "2,1 dias", "<5". */
export function textoValor(v: Valor, unidade: DefIndicador['unidade']): string {
  if (v === null || v === undefined) return 'Sem dados suficientes';
  if (v === SUPRIMIDO) return 'Menos de 5';
  const n = formato.format(Number(v));
  if (unidade === '%') return `${n} %`;
  if (unidade === 'número') return n;
  return `${n} ${Number(v) === 1 ? (unidade === 'dias' ? 'dia' : 'dia útil') : unidade}`;
}

export interface FonteIndicador {
  resumo: Record<string, Linha>;
  gerado_em: string;
  url: string;
  csv: string;
}

export interface Indicador {
  id: string;
  titulo: string;
  valor: Valor;
  unidade: DefIndicador['unidade'];
  texto: string;
  de?: Valor;
  mes: string;
  mes_por_extenso: string;
  atualizado_em: string;
  conjunto: IdConjunto;
  fonte: { url: string; csv: string; coluna: string };
}

export function montarIndicadores(
  mes: string,
  fontes: Partial<Record<IdConjunto, FonteIndicador>>,
) {
  const itens: Indicador[] = [];
  for (const d of INDICADORES) {
    const f = fontes[d.conjunto];
    if (!f) continue; // conjunto desligado ou ainda não publicado
    const linha = f.resumo[mes];
    const valor = linha ? (linha[d.coluna] ?? null) : null;
    const de = d.de && linha ? (linha[d.de] ?? null) : null;
    itens.push({
      id: d.id,
      titulo: d.titulo,
      valor,
      unidade: d.unidade,
      texto:
        d.de && valor !== null && de !== null
          ? `${textoValor(valor, d.unidade)} de ${textoValor(de, d.unidade)}`
          : textoValor(valor, d.unidade),
      ...(d.de ? { de } : {}),
      mes,
      mes_por_extenso: mesPorExtenso(mes),
      atualizado_em: f.gerado_em,
      conjunto: d.conjunto,
      fonte: { url: f.url, csv: f.csv, coluna: d.coluna },
    });
  }
  return itens;
}
