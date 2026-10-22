/*
 * "Testar uma lei antes de a aprovar": corre as regras propostas (sem as
 * gravar) contra os pedidos antigos e diz o que mudaria: quantos deixavam
 * de ser aprovados na hora (passavam a ir a técnico) e vice-versa, quanto
 * mudava a receita das taxas e exemplos concretos, com o porquê.
 *
 * Puro e genérico: serve para qualquer tipo de licença (e para o PDM), só
 * precisa de uma função que avalie um pedido com umas regras.
 */
import { euros } from './comum.js';

export interface PedidoAntigo<D> {
  id: string;
  /** O número do pedido (ex.: "LER 12/2024"). */
  referencia: string;
  /** Dia em que foi feito (AAAA-MM-DD): a antecedência conta a partir daqui. */
  pedido_em: string;
  dados: D;
  /** Pedido de demonstração (não é real). */
  demonstracao: boolean;
}

/** O que interessa de uma avaliação para comparar. */
export interface Resultado {
  /** true: aprovado na hora (dentro das regras). */
  aprovado: boolean;
  /** O que diz a decisão ("aprovar", "técnico", "precisa de licença"). */
  decisao: string;
  /** Taxa cobrada se for aprovado na hora, em cêntimos. */
  taxa_cent: number;
  regras: { id: string; ok: boolean; texto: string }[];
}

export type Avaliador<C, D> = (
  dados: D,
  config: C,
  pedidoEm: string,
) => Resultado;

export interface Exemplo {
  id: string;
  referencia: string;
  pedido_em: string;
  resumo: string;
  demonstracao: boolean;
  antes: { decisao: string; aprovado: boolean; taxa_cent: number };
  depois: { decisao: string; aprovado: boolean; taxa_cent: number };
  porque: string[];
}

export interface ResultadoSimulacao {
  total: number;
  /** Pedidos em que a decisão ou a taxa muda. */
  mudam: number;
  /** Eram aprovados na hora e passavam a ir a técnico (ou a ser recusados). */
  deixam_de_ser_aprovados: number;
  /** Iam a técnico e passavam a ser aprovados na hora. */
  passam_a_ser_aprovados: number;
  /** Continuam aprovados, mas com outra taxa. */
  mudam_de_taxa: number;
  aprovados: { antes: number; depois: number };
  /** Soma das taxas dos pedidos aprovados na hora. */
  receita: { antes_cent: number; depois_cent: number; diferenca_cent: number };
  /** Que regras fazem a diferença. */
  por_regra: {
    id: string;
    passam_a_falhar: number;
    deixam_de_falhar: number;
  }[];
  periodo: { de: string; ate: string } | null;
  pedidos_de_demonstracao: number;
  exemplos: Exemplo[];
}

export function simular<C, D>(
  atuais: C,
  propostas: C,
  pedidos: PedidoAntigo<D>[],
  avaliar: Avaliador<C, D>,
  opcoes: { exemplos?: number; resumir?: (d: D) => string } = {},
): ResultadoSimulacao {
  const maxExemplos = opcoes.exemplos ?? 8;
  const resumir = opcoes.resumir ?? (() => '');
  const porRegra = new Map<
    string,
    { passam_a_falhar: number; deixam_de_falhar: number }
  >();
  const contaRegra = (
    id: string,
    k: 'passam_a_falhar' | 'deixam_de_falhar',
  ) => {
    const r = porRegra.get(id) ?? { passam_a_falhar: 0, deixam_de_falhar: 0 };
    r[k]++;
    porRegra.set(id, r);
  };

  const r: ResultadoSimulacao = {
    total: pedidos.length,
    mudam: 0,
    deixam_de_ser_aprovados: 0,
    passam_a_ser_aprovados: 0,
    mudam_de_taxa: 0,
    aprovados: { antes: 0, depois: 0 },
    receita: { antes_cent: 0, depois_cent: 0, diferenca_cent: 0 },
    por_regra: [],
    periodo: null,
    pedidos_de_demonstracao: 0,
    exemplos: [],
  };
  // Os exemplos: primeiro os que mudam de decisão, depois os de taxa.
  const deDecisao: Exemplo[] = [];
  const deTaxa: Exemplo[] = [];

  for (const p of pedidos) {
    if (p.demonstracao) r.pedidos_de_demonstracao++;
    if (!r.periodo) r.periodo = { de: p.pedido_em, ate: p.pedido_em };
    else {
      if (p.pedido_em < r.periodo.de) r.periodo.de = p.pedido_em;
      if (p.pedido_em > r.periodo.ate) r.periodo.ate = p.pedido_em;
    }

    const a = avaliar(p.dados, atuais, p.pedido_em);
    const d = avaliar(p.dados, propostas, p.pedido_em);
    const taxaA = a.aprovado ? a.taxa_cent : 0;
    const taxaD = d.aprovado ? d.taxa_cent : 0;
    if (a.aprovado) r.aprovados.antes++;
    if (d.aprovado) r.aprovados.depois++;
    r.receita.antes_cent += taxaA;
    r.receita.depois_cent += taxaD;

    const mudaDecisao = a.aprovado !== d.aprovado || a.decisao !== d.decisao;
    const mudaTaxa = taxaA !== taxaD;
    if (!mudaDecisao && !mudaTaxa) continue;
    r.mudam++;
    if (a.aprovado && !d.aprovado) r.deixam_de_ser_aprovados++;
    else if (!a.aprovado && d.aprovado) r.passam_a_ser_aprovados++;
    else if (a.aprovado && d.aprovado && mudaTaxa) r.mudam_de_taxa++;

    // Porquê: as regras que mudaram de resultado, e a taxa.
    const antes = new Map(a.regras.map((x) => [x.id, x]));
    const porque: string[] = [];
    for (const x of d.regras) {
      const y = antes.get(x.id);
      if (y && y.ok === x.ok) continue;
      if (!x.ok) {
        contaRegra(x.id, 'passam_a_falhar');
        porque.push(`Passa a falhar: ${x.texto}`);
      } else if (y && !y.ok) {
        contaRegra(x.id, 'deixam_de_falhar');
        porque.push(`Passa a cumprir: ${x.texto}`);
      }
    }
    const depois = new Set(d.regras.map((x) => x.id));
    for (const y of a.regras) {
      if (!depois.has(y.id) && !y.ok) {
        contaRegra(y.id, 'deixam_de_falhar');
        porque.push(`Deixa de contar: ${y.texto}`);
      }
    }
    if (porque.length === 0 && a.decisao !== d.decisao) {
      porque.push(`A resposta passa de "${a.decisao}" a "${d.decisao}".`);
    }
    if (mudaTaxa) {
      porque.push(`Taxa cobrada: ${euros(taxaA)} → ${euros(taxaD)}.`);
    }
    const lista = mudaDecisao ? deDecisao : deTaxa;
    if (lista.length < maxExemplos) {
      lista.push({
        id: p.id,
        referencia: p.referencia,
        pedido_em: p.pedido_em,
        resumo: resumir(p.dados),
        demonstracao: p.demonstracao,
        antes: { decisao: a.decisao, aprovado: a.aprovado, taxa_cent: taxaA },
        depois: { decisao: d.decisao, aprovado: d.aprovado, taxa_cent: taxaD },
        porque,
      });
    }
  }

  r.receita.diferenca_cent = r.receita.depois_cent - r.receita.antes_cent;
  r.por_regra = [...porRegra.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort(
      (x, y) =>
        y.passam_a_falhar +
        y.deixam_de_falhar -
        (x.passam_a_falhar + x.deixam_de_falhar),
    );
  r.exemplos = [...deDecisao, ...deTaxa].slice(0, maxExemplos);
  return r;
}
