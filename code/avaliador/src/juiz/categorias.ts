/*
 * Escala por categorias (v2): quão certa está uma resposta que responde, e
 * porque é que não respondeu quando não responde.
 *
 * Como nas regras do veredicto binário (regras.ts), o modelo só descreve a
 * resposta e a categoria sai daqui, de regras puras, testadas e iguais para
 * todos os sistemas. O modelo dá também a sua leitura global
 * (`categoria_juiz`), que serve só para detetar regras mal calibradas.
 *
 * Cada facto obrigatório do gabarito é E (essencial) ou S (secundário). Sem
 * classificação, todos contam como E (ver factos.ts, ehSecundario).
 *
 * Ordem (a primeira que se aplica decide):
 *  C1  Vazia, erro ou "não percebi" → sem_resposta.
 *  C2  Esperado `emergencia` e não manda ligar 112 → errada.
 *  C3  Erros graves → maioritariamente_errada se acerta algum essencial,
 *      senão errada.
 *  C4  Esperado passar_humano / fora_ambito / perguntar / outra_lingua e o
 *      sistema fez isso → certa; passou a pessoa numa pergunta difícil →
 *      certa. Esperado `perguntar` mas respondeu com todos os essenciais:
 *      não há regra própria, segue C7 a C10 como qualquer resposta.
 *  C5  Só manda contactar → mandou_contactar. Se a resposta tem todos os
 *      essenciais, mandar contactar É a resposta (ex.: "para onde ligo?") e
 *      segue para as regras seguintes, como na R5 binária.
 *  C6  Esperado `ocorrencia` e registou a ocorrência → certa.
 *  C7  Nenhum essencial certo → nao_encontrou se disse que não encontrou,
 *      senão inconclusiva. Num gabarito sem essenciais, aplica-se quando o
 *      esperado era um comportamento (passar_humano, fora_ambito,
 *      perguntar) que não foi feito, ou quando a resposta diz que não
 *      encontrou: não há facto que a salve.
 *  C8  Falta algum essencial → parcialmente_certa.
 *  C9  Falta algum secundário, ou há erros menores → maioritariamente_certa.
 *  C10 → certa.
 */
import type { Categoria, Comportamento, Suficiente } from '../tipos.js';
import {
  ehSecundario,
  mesmoFacto,
  type FactosDeterministicos,
} from './factos.js';
import {
  ehDificil,
  juntarFactos,
  semResposta,
  type ContextoVeredicto,
  type Descricao,
} from './regras.js';
import type { SaidaJuiz } from './rubrica.js';

export type CodigoCategoria =
  | 'C1-sem-resposta'
  | 'C2-emergencia-sem-112'
  | 'C3-erro-grave-com-essencial'
  | 'C3-erro-grave'
  | 'C4-comportamento-certo'
  | 'C4-passada-bem'
  | 'C5-so-manda-contactar'
  | 'C6-ocorrencia-registada'
  | 'C7-nao-encontrou'
  | 'C7-inconclusiva'
  | 'C8-essencial-em-falta'
  | 'C9-secundario-em-falta'
  | 'C9-erro-menor'
  | 'C10-completa';

/**
 * A descrição da v1 mais o que a v2 acrescenta. `factos_errados` são os
 * erros graves (o mesmo campo, para as regras binárias continuarem iguais).
 */
export interface DescricaoV2 extends Descricao {
  erros_menores: string[];
  nao_encontrou: boolean;
  suficiente: Suficiente;
  categoria_juiz: Categoria;
}

export interface ContextoCategoria extends ContextoVeredicto {
  /** Factos obrigatórios marcados S no gabarito; os outros são essenciais. */
  factos_secundarios: string[];
}

export interface DecisaoCategoria {
  categoria: Categoria;
  regra: CodigoCategoria;
}

/** Nota de 0 a 100: reporta-se sempre com a distribuição, nunca sozinha. */
export const NOTA_CATEGORIA: Record<Categoria, number> = {
  certa: 100,
  maioritariamente_certa: 75,
  parcialmente_certa: 50,
  maioritariamente_errada: 25,
  errada: 0,
  sem_resposta: 0,
  mandou_contactar: 0,
  nao_encontrou: 0,
  inconclusiva: 0,
};

/** Média das notas (0–100, uma casa decimal); null sem respostas. */
export function notaMedia(categorias: Categoria[]): number | null {
  if (!categorias.length) return null;
  const soma = categorias.reduce((s, c) => s + NOTA_CATEGORIA[c], 0);
  return Math.round((10 * soma) / categorias.length) / 10;
}

const COMPORTAMENTAIS: Comportamento[] = [
  'passar_humano',
  'fora_ambito',
  'perguntar',
  'outra_lingua',
];

/** Comportamentos que, num gabarito sem factos, são o próprio essencial. */
const COMPORTAMENTO_E_ESSENCIAL: Comportamento[] = [
  'passar_humano',
  'fora_ambito',
  'perguntar',
];

export function factosEssenciais(
  obrigatorios: string[],
  secundarios: string[],
): string[] {
  return obrigatorios.filter((f) => !ehSecundario(f, secundarios));
}

export function decidirCategoria(
  ctx: ContextoCategoria,
  d: DescricaoV2,
): DecisaoCategoria {
  const esperado = ctx.comportamento_esperado;
  const obs = d.comportamento_observado;
  const certo = (f: string) => d.factos_certos.includes(f);
  const essenciais = factosEssenciais(
    ctx.factos_obrigatorios,
    ctx.factos_secundarios,
  );
  const essenciaisCertos = essenciais.filter(certo);
  const essenciaisEmFalta = essenciais.filter((f) => !certo(f));
  const secundariosEmFalta = ctx.factos_obrigatorios.filter(
    (f) => ehSecundario(f, ctx.factos_secundarios) && !certo(f),
  );
  const todosEssenciais = essenciais.length > 0 && !essenciaisEmFalta.length;

  // C1
  if (semResposta(ctx.texto, ctx.erro) || obs === 'nenhum')
    return { categoria: 'sem_resposta', regra: 'C1-sem-resposta' };

  // C2
  if (esperado === 'emergencia' && !d.manda_ligar_112)
    return { categoria: 'errada', regra: 'C2-emergencia-sem-112' };

  // C3
  if (d.factos_errados.length > 0)
    return essenciaisCertos.length
      ? {
          categoria: 'maioritariamente_errada',
          regra: 'C3-erro-grave-com-essencial',
        }
      : { categoria: 'errada', regra: 'C3-erro-grave' };

  // C4
  if (COMPORTAMENTAIS.includes(esperado) && obs === esperado)
    return { categoria: 'certa', regra: 'C4-comportamento-certo' };
  if (obs === 'passar_humano' && ehDificil(ctx.categoria))
    return { categoria: 'certa', regra: 'C4-passada-bem' };

  // C5
  if (d.so_manda_contactar && !todosEssenciais)
    return { categoria: 'mandou_contactar', regra: 'C5-so-manda-contactar' };

  // C6
  if (esperado === 'ocorrencia' && obs === 'ocorrencia')
    return { categoria: 'certa', regra: 'C6-ocorrencia-registada' };

  // C7
  const nenhumEssencial = essenciais.length
    ? essenciaisCertos.length === 0
    : d.nao_encontrou || COMPORTAMENTO_E_ESSENCIAL.includes(esperado);
  if (nenhumEssencial)
    return d.nao_encontrou
      ? { categoria: 'nao_encontrou', regra: 'C7-nao-encontrou' }
      : { categoria: 'inconclusiva', regra: 'C7-inconclusiva' };

  // C8
  if (essenciaisEmFalta.length)
    return { categoria: 'parcialmente_certa', regra: 'C8-essencial-em-falta' };

  // C9
  if (secundariosEmFalta.length)
    return {
      categoria: 'maioritariamente_certa',
      regra: 'C9-secundario-em-falta',
    };
  if (d.erros_menores.length)
    return { categoria: 'maioritariamente_certa', regra: 'C9-erro-menor' };

  // C10
  return { categoria: 'certa', regra: 'C10-completa' };
}

/** A saída de uma resposta que nem chega ao juiz (vazia ou erro). */
export function saidaVazia(): SaidaJuiz {
  return {
    comportamento_observado: 'nenhum',
    factos_certos: [],
    em_falta: [],
    erros_graves: [],
    erros_menores: [],
    so_manda_contactar: false,
    nao_encontrou: false,
    manda_112: false,
    suficiente: 'nao',
    categoria_juiz: 'sem_resposta',
    nota: 'Sem resposta: não foi ao juiz.',
  };
}

/**
 * Da saída do juiz (campos da v2) à descrição que as duas escalas usam: os
 * nomes antigos para as regras binárias (factos_errados = erros_graves) e a
 * verificação determinística por cima (juntarFactos). Um erro "menor" que é
 * afinal um facto proibido passa a grave: um facto proibido nunca é menor.
 */
export function juntarDescricao(
  saida: SaidaJuiz,
  det: FactosDeterministicos,
  gabarito: { factos_obrigatorios: string[]; factos_proibidos: string[] },
): DescricaoV2 {
  const base = juntarFactos(
    {
      comportamento_observado: saida.comportamento_observado,
      factos_certos: saida.factos_certos,
      factos_em_falta: saida.em_falta,
      factos_errados: saida.erros_graves,
      so_manda_contactar: saida.so_manda_contactar,
      manda_ligar_112: saida.manda_112,
    },
    det,
    gabarito,
  );
  const menores: string[] = [];
  for (const m of saida.erros_menores) {
    const t = m.trim();
    if (!t) continue;
    const proibido = gabarito.factos_proibidos.find((f, i) =>
      mesmoFacto(t, f, `P${i + 1}`),
    );
    if (!proibido) menores.push(t);
    else if (!base.factos_errados.includes(proibido))
      base.factos_errados.push(proibido);
  }
  return {
    ...base,
    erros_menores: menores,
    nao_encontrou: saida.nao_encontrou,
    suficiente: saida.suficiente,
    categoria_juiz: saida.categoria_juiz,
  };
}
