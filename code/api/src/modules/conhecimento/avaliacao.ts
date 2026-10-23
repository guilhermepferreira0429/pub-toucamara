import { HttpStatus } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';

/**
 * Gate de publicação (spec do avaliador, secção 9): nenhuma resposta curada
 * vai para o ar sem uma execução `tou-chat` do nosso agente, terminada, não
 * amostra, sobre a `agente_config.versao` atual, com taxa ≥ 75%.
 */
export const LIMIAR_PUBLICACAO = 75;

/** A execução candidata (a mais recente que conta) e o seu total em `avaliacao.resultados`. */
export interface ExecucaoGate {
  execucao_id: string;
  sistema: string;
  agente_versao: string | null;
  terminada_em: Date | string | null;
  /** NULL quando ainda nenhuma resposta tem avaliação. */
  taxa: number | null;
  total: number;
  por_avaliar: number;
}

export type DecisaoPublicacao =
  | { permitir: true; execucao_id: string; taxa: number }
  | {
      permitir: false;
      motivo: 'avaliacao_em_falta' | 'avaliacao_abaixo_do_limiar';
      /** Porquê, para o painel: sem execução, outra versão, por avaliar, abaixo. */
      causa: 'sem_execucao' | 'outra_versao' | 'por_avaliar' | 'abaixo';
      execucao_id: string | null;
      taxa: number | null;
    };

/** Decisão pura: execução + versão atual + limiar → permitir ou porquê não. */
export function decidirPublicacao(
  execucao: ExecucaoGate | null,
  versaoAtual: string | null,
  limiar: number = LIMIAR_PUBLICACAO,
): DecisaoPublicacao {
  const falta = (
    causa: 'sem_execucao' | 'outra_versao' | 'por_avaliar',
  ): DecisaoPublicacao => ({
    permitir: false,
    motivo: 'avaliacao_em_falta',
    causa,
    execucao_id: execucao?.execucao_id ?? null,
    taxa: execucao?.taxa ?? null,
  });
  if (!execucao || !execucao.terminada_em) return falta('sem_execucao');
  if (!versaoAtual || execucao.agente_versao !== versaoAtual) {
    return falta('outra_versao');
  }
  // Uma taxa sobre metade das respostas não diz nada: o juiz tem de acabar.
  if (execucao.taxa === null || execucao.total === 0 || execucao.por_avaliar) {
    return falta('por_avaliar');
  }
  if (execucao.taxa < limiar) {
    return {
      permitir: false,
      motivo: 'avaliacao_abaixo_do_limiar',
      causa: 'abaixo',
      execucao_id: execucao.execucao_id,
      taxa: execucao.taxa,
    };
  }
  return {
    permitir: true,
    execucao_id: execucao.execucao_id,
    taxa: execucao.taxa,
  };
}

/** O comando que a equipa corre para ter a execução que falta. */
export function comandoAvaliador(sistema: string | null): string {
  return `avaliador executar --sistema "${sistema ?? '<sistema tou-chat do município>'}" --motivo publicacao`;
}

/** Erro da API para uma decisão negativa (409 sem execução válida, 422 abaixo do limiar). */
export function erroPublicacao(
  d: Extract<DecisaoPublicacao, { permitir: false }>,
  ctx: { versao_atual: string | null; sistema: string | null },
  limiar: number = LIMIAR_PUBLICACAO,
): ErroApi {
  const detalhes = {
    causa: d.causa,
    execucao_id: d.execucao_id,
    taxa: d.taxa,
    limiar,
    versao_atual: ctx.versao_atual,
    comando: comandoAvaliador(ctx.sistema),
  };
  if (d.motivo === 'avaliacao_abaixo_do_limiar') {
    return new ErroApi(
      HttpStatus.UNPROCESSABLE_ENTITY,
      d.motivo,
      `A última avaliação do agente acertou ${String(d.taxa).replace('.', ',')}% (mínimo ${limiar}%). Corrija as respostas erradas e volte a correr o avaliador.`,
      detalhes,
    );
  }
  const porque = {
    sem_execucao: 'Ainda não há nenhuma avaliação terminada do agente.',
    outra_versao: 'A última avaliação não é da versão atual do agente.',
    por_avaliar: 'A última avaliação ainda tem respostas por avaliar.',
  }[d.causa as 'sem_execucao' | 'outra_versao' | 'por_avaliar'];
  return new ErroApi(
    HttpStatus.CONFLICT,
    d.motivo,
    `${porque} Corra o avaliador antes de publicar.`,
    detalhes,
  );
}

/**
 * As execuções que o painel mostra (Qualidade e Início): com alguma medida,
 * só as medidas; as de demonstração ("Preparar demo") são mais recentes e
 * tapavam o número real. Sem nenhuma medida (câmara de demonstração), as de
 * demonstração, que o ecrã assinala como tal.
 */
export function execucoesDoPainel<T extends { demonstracao: boolean }>(
  todas: T[],
  limite = 20,
): T[] {
  const medidas = todas.filter((e) => !e.demonstracao);
  return (medidas.length ? medidas : todas).slice(0, limite);
}
