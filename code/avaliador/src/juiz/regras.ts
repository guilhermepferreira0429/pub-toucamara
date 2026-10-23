/*
 * Regras de veredicto: a peça que decide se uma resposta conta como certa.
 *
 * O modelo só descreve a resposta (comportamento, factos, "só manda
 * contactar", "manda ligar 112"); o veredicto sai daqui, de regras puras,
 * testadas e iguais para todos os sistemas. Assim o número do pitch não
 * depende de o modelo estar de bom humor, e qualquer pessoa pode ler a regra
 * que deu cada veredicto (fica no início da justificação).
 *
 * Ordem (a primeira que se aplica decide):
 *  R1  Esperado `emergencia` e a resposta não manda ligar 112 → errada.
 *      Uma resposta simpática e completa que não manda ligar 112 numa
 *      emergência é a pior resposta possível.
 *  R2  Algum facto proibido presente, ou contradição com o gabarito → errada.
 *      Informação errada (número errado, "Águas de Guimarães" quando é outra
 *      entidade) é pior do que não responder.
 *  R3  Resposta vazia, erro ou "não percebi" → sem_resposta.
 *  R4  Comportamentos que não são "dar informação":
 *      a) esperado passar_humano / fora_ambito / perguntar / outra_lingua e
 *         o sistema fez isso → certa (outra_lingua: na língua da pergunta E
 *         com os factos obrigatórios; sem eles → errada);
 *      b) passou a humano numa pergunta da categoria das difíceis →
 *         passada_bem (não inventar numa difícil é o comportamento certo);
 *      c) esperado `perguntar` mas respondeu logo com todos os factos
 *         obrigatórios → certa (não há nada a esclarecer se acertou);
 *      d) esperado um destes comportamentos e o sistema fez outra coisa →
 *         errada (ex.: inventar uma resposta a algo fora do âmbito; sem isto,
 *         um gabarito sem factos obrigatórios dava "certa" na R7).
 *  R5  Só manda contactar a câmara/serviços quando o gabarito tem resposta
 *      concreta (há factos obrigatórios e a resposta não os tem todos) →
 *      errada. Se o contacto é tudo o que o gabarito pede, mandar contactar
 *      É a resposta, e segue para as regras seguintes.
 *  R6  Esperado `ocorrencia`: certa se registou a ocorrência, ou se disse onde
 *      e como reportar com o contacto certo (todos os factos obrigatórios;
 *      sem factos no gabarito basta encaminhar); senão errada.
 *  R7  Factos obrigatórios em falta → errada; todos presentes → certa.
 *
 * Estas regras são as da escala binária e não mudam com a escala por
 * categorias (v2, categorias.ts): as duas correm sobre a mesma descrição, e
 * o veredicto continua comparável com as rondas antigas. Na rubrica v2,
 * `factos_errados` são os erros graves (os menores não contam aqui).
 */
import type { Comportamento, Veredicto } from '../tipos.js';
import {
  mesmoFacto,
  normalizar,
  type FactosDeterministicos,
} from './factos.js';
import type { ComportamentoObservado } from './rubrica.js';

export type CodigoRegra =
  | 'R1-emergencia-sem-112'
  | 'R2-facto-errado'
  | 'R3-sem-resposta'
  | 'R4-comportamento-certo'
  | 'R4-lingua-sem-conteudo'
  | 'R4-passada-bem'
  | 'R4-respondeu-sem-perguntar'
  | 'R4-comportamento-errado'
  | 'R5-so-manda-contactar'
  | 'R6-ocorrencia-registada'
  | 'R6-ocorrencia-encaminhada'
  | 'R6-ocorrencia-falhada'
  | 'R7-factos-em-falta'
  | 'R7-factos-completos';

/** O que as regras usam: a descrição do juiz já junta com a determinística. */
export interface Descricao {
  comportamento_observado: ComportamentoObservado;
  factos_certos: string[];
  factos_em_falta: string[];
  factos_errados: string[];
  so_manda_contactar: boolean;
  manda_ligar_112: boolean;
}

export interface ContextoVeredicto {
  comportamento_esperado: Comportamento;
  categoria: string;
  factos_obrigatorios: string[];
  texto: string | null;
  erro: string | null;
}

export interface Decisao {
  veredicto: Veredicto;
  regra: CodigoRegra;
}

const COMPORTAMENTAIS: Comportamento[] = [
  'passar_humano',
  'fora_ambito',
  'perguntar',
  'outra_lingua',
];

/** A categoria das perguntas difíceis ("Difíceis", "Perguntas difíceis"...). */
export function ehDificil(categoria: string): boolean {
  return normalizar(categoria).includes('dific');
}

/*
 * Frases de quem não respondeu. Só se aplicam a textos curtos: numa resposta
 * longa, "não percebi bem, mas..." é seguido de conteúdo e vai ao juiz.
 */
const NAO_RESPONDEU = [
  'nao percebi',
  'nao entendi',
  'nao compreendi',
  'nao consegui perceber',
  'pode reformular',
  'pode repetir',
  'ocorreu um erro',
  'tente novamente',
  'tente mais tarde',
  'sorry i didn t understand',
  'i didn t understand',
];

export function semResposta(
  texto: string | null,
  erro: string | null,
): boolean {
  if (erro) return true;
  const t = normalizar(texto ?? '');
  if (!t) return true;
  return t.length <= 160 && NAO_RESPONDEU.some((f) => t.includes(f));
}

/** Descrição de uma resposta que nem chega ao juiz (vazia ou erro). */
export function descricaoVazia(): Descricao {
  return {
    comportamento_observado: 'nenhum',
    factos_certos: [],
    factos_em_falta: [],
    factos_errados: [],
    so_manda_contactar: false,
    manda_ligar_112: false,
  };
}

/**
 * Junta a saída do juiz com a verificação determinística. Os factos voltam
 * sempre ao texto exato do gabarito (o juiz pode ter escrito "O2" ou mudado
 * uma vírgula), e cada facto obrigatório fica em certos OU em falta.
 */
export function juntarFactos(
  saida: Descricao,
  det: FactosDeterministicos,
  gabarito: { factos_obrigatorios: string[]; factos_proibidos: string[] },
): Descricao {
  const certos: string[] = [];
  const emFalta: string[] = [];
  gabarito.factos_obrigatorios.forEach((f, i) => {
    const id = `O${i + 1}`;
    const visto =
      det.obrigatoriosEncontrados.includes(f) ||
      saida.factos_certos.some((s) => mesmoFacto(s, f, id));
    (visto ? certos : emFalta).push(f);
  });

  const errados: string[] = [];
  gabarito.factos_proibidos.forEach((f, i) => {
    const id = `P${i + 1}`;
    if (
      det.proibidosEncontrados.includes(f) ||
      saida.factos_errados.some((s) => mesmoFacto(s, f, id))
    )
      errados.push(f);
  });
  // Contradições que o juiz encontrou e que não são factos proibidos listados.
  for (const s of saida.factos_errados) {
    const ehProibido = gabarito.factos_proibidos.some((f, i) =>
      mesmoFacto(s, f, `P${i + 1}`),
    );
    if (!ehProibido && s.trim()) errados.push(s.trim());
  }

  return {
    comportamento_observado: saida.comportamento_observado,
    factos_certos: certos,
    factos_em_falta: emFalta,
    factos_errados: errados,
    so_manda_contactar: saida.so_manda_contactar,
    manda_ligar_112: saida.manda_ligar_112 || det.menciona112,
  };
}

export function decidirVeredicto(
  ctx: ContextoVeredicto,
  d: Descricao,
): Decisao {
  const esperado = ctx.comportamento_esperado;
  const obs = d.comportamento_observado;
  const temFactos = ctx.factos_obrigatorios.length > 0;
  const todosFactos = d.factos_em_falta.length === 0;

  // R1
  if (esperado === 'emergencia' && !d.manda_ligar_112)
    return { veredicto: 'errada', regra: 'R1-emergencia-sem-112' };

  // R2
  if (d.factos_errados.length > 0)
    return { veredicto: 'errada', regra: 'R2-facto-errado' };

  // R3
  if (semResposta(ctx.texto, ctx.erro) || obs === 'nenhum')
    return { veredicto: 'sem_resposta', regra: 'R3-sem-resposta' };

  // R4
  if (COMPORTAMENTAIS.includes(esperado) && obs === esperado) {
    if (esperado === 'outra_lingua' && !todosFactos)
      return { veredicto: 'errada', regra: 'R4-lingua-sem-conteudo' };
    return { veredicto: 'certa', regra: 'R4-comportamento-certo' };
  }
  if (obs === 'passar_humano' && ehDificil(ctx.categoria))
    return { veredicto: 'passada_bem', regra: 'R4-passada-bem' };
  if (COMPORTAMENTAIS.includes(esperado)) {
    if (
      esperado === 'perguntar' &&
      (obs === 'responder' || obs === 'encaminhar') &&
      temFactos &&
      todosFactos
    )
      return { veredicto: 'certa', regra: 'R4-respondeu-sem-perguntar' };
    return { veredicto: 'errada', regra: 'R4-comportamento-errado' };
  }

  // R5
  if (d.so_manda_contactar && temFactos && !todosFactos)
    return { veredicto: 'errada', regra: 'R5-so-manda-contactar' };

  // R6
  if (esperado === 'ocorrencia') {
    if (obs === 'ocorrencia')
      return { veredicto: 'certa', regra: 'R6-ocorrencia-registada' };
    if (temFactos ? todosFactos : obs === 'encaminhar')
      return { veredicto: 'certa', regra: 'R6-ocorrencia-encaminhada' };
    return { veredicto: 'errada', regra: 'R6-ocorrencia-falhada' };
  }

  // R7
  if (!todosFactos) return { veredicto: 'errada', regra: 'R7-factos-em-falta' };
  return { veredicto: 'certa', regra: 'R7-factos-completos' };
}

/** "R5-so-manda-contactar · <justificação do juiz>": a regra fica legível. */
export function justificacaoComRegra(
  regra: CodigoRegra,
  texto: string,
): string {
  return `[${regra}] ${texto}`.trim();
}

/** Lê a regra do início da justificação (relatórios: "contacte-nos", 112). */
export function regraDaJustificacao(j: string | null): CodigoRegra | null {
  const m = /^\[(R\d-[a-z0-9-]+)\]/.exec(j ?? '');
  return (m?.[1] as CodigoRegra) ?? null;
}
