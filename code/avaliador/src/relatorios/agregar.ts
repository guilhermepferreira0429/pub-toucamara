/*
 * Agregações puras dos relatórios. As vistas da BD dão a taxa por execução;
 * aqui fica o que as vistas não sabem: restringir às perguntas comuns a
 * vários sistemas, as divergências e a escolha dos exemplos.
 */
import { resumirNumeros, type ResumoNumeros } from '../juiz/numeros.js';
import { regraDaJustificacao } from '../juiz/regras.js';
import type { Veredicto } from '../tipos.js';

export interface RespostaRel {
  resposta_id: string;
  pergunta_id: string;
  ordem: number;
  categoria: string;
  pergunta: string;
  comportamento: string;
  entidade_esperada: string | null;
  texto: string | null;
  captura_key: string | null;
  respondida_em: Date;
  veredicto: Veredicto;
  avaliador: string;
  rubrica_versao: string;
  justificacao: string | null;
  factos_errados: string[];
  factos_em_falta: string[];
  gabarito_resposta: string | null;
  /** Factos obrigatórios do gabarito usado (fontes da métrica "números sem fonte"). */
  gabarito_factos?: string[] | null;
}

export interface ExecucaoRel {
  id: string;
  sistema_id: string;
  sistema: string;
  nosso: boolean;
  municipio_id: string | null;
  agente_versao: string | null;
  iniciada_em: Date;
  terminada_em: Date | null;
  /** Só as respostas avaliadas (sem erro do adaptador). */
  respostas: RespostaRel[];
  /** Respostas com erro do adaptador ou ainda sem avaliação. */
  porResponder: number;
  porAvaliar: number;
}

export const ehCerta = (v: Veredicto) => v === 'certa' || v === 'passada_bem';

export interface Taxa {
  total: number;
  certas: number;
  passadas_bem: number;
  erradas: number;
  sem_resposta: number;
  /** 0–100; null sem respostas. Mesma fórmula da vista: (certas + passadas bem) / total. */
  taxa: number | null;
}

export function taxa(respostas: { veredicto: Veredicto }[]): Taxa {
  const c = (v: Veredicto) => respostas.filter((r) => r.veredicto === v).length;
  const t: Taxa = {
    total: respostas.length,
    certas: c('certa'),
    passadas_bem: c('passada_bem'),
    erradas: c('errada'),
    sem_resposta: c('sem_resposta'),
    taxa: null,
  };
  if (t.total) t.taxa = (100 * (t.certas + t.passadas_bem)) / t.total;
  return t;
}

export function porCategoria(respostas: RespostaRel[]): Map<string, Taxa> {
  const grupos = new Map<string, RespostaRel[]>();
  for (const r of [...respostas].sort((a, b) => a.ordem - b.ordem))
    grupos.set(r.categoria, [...(grupos.get(r.categoria) ?? []), r]);
  return new Map([...grupos].map(([k, v]) => [k, taxa(v)]));
}

/** Perguntas respondidas e avaliadas em TODAS as execuções. */
export function perguntasComuns(execs: ExecucaoRel[]): Set<string> {
  if (!execs.length) return new Set();
  let comuns = new Set(execs[0].respostas.map((r) => r.pergunta_id));
  for (const e of execs.slice(1)) {
    const desta = new Set(e.respostas.map((r) => r.pergunta_id));
    comuns = new Set([...comuns].filter((p) => desta.has(p)));
  }
  return comuns;
}

/** A mesma execução só com as perguntas comuns: comparar só o comparável. */
export function soComuns(e: ExecucaoRel, comuns: Set<string>): ExecucaoRel {
  return {
    ...e,
    respostas: e.respostas.filter((r) => comuns.has(r.pergunta_id)),
  };
}

export interface Par {
  pergunta_id: string;
  nos: RespostaRel;
  outro: RespostaRel;
}

export interface Divergencias {
  /** Nós certo, o outro errado/sem resposta. */
  nosGanhamos: Par[];
  /** O outro certo, nós errado/sem resposta. Mostra-se sempre: honestidade. */
  outroGanha: Par[];
}

export function divergencias(
  nos: ExecucaoRel,
  outro: ExecucaoRel,
): Divergencias {
  const deles = new Map(outro.respostas.map((r) => [r.pergunta_id, r]));
  const d: Divergencias = { nosGanhamos: [], outroGanha: [] };
  for (const r of [...nos.respostas].sort((a, b) => a.ordem - b.ordem)) {
    const o = deles.get(r.pergunta_id);
    if (!o) continue;
    const a = ehCerta(r.veredicto);
    const b = ehCerta(o.veredicto);
    if (a && !b)
      d.nosGanhamos.push({ pergunta_id: r.pergunta_id, nos: r, outro: o });
    if (!a && b)
      d.outroGanha.push({ pergunta_id: r.pergunta_id, nos: r, outro: o });
  }
  return d;
}

export type TipoExemplo = 'emergencia' | 'entidade' | 'contacte' | 'outro';

export const TITULO_EXEMPLO: Record<TipoExemplo, string> = {
  emergencia: 'Emergências',
  entidade: 'Entidades do concelho',
  contacte: '"Contacte-nos" em vez de responder',
  outro: 'Outras respostas',
};

/** Porque é que este exemplo é forte, do lado do outro sistema. */
export function tipoExemplo(p: Par): TipoExemplo {
  if (p.nos.comportamento === 'emergencia') return 'emergencia';
  const regra = regraDaJustificacao(p.outro.justificacao);
  if (regra === 'R5-so-manda-contactar') return 'contacte';
  if (p.nos.comportamento === 'encaminhar' || p.nos.entidade_esperada)
    return 'entidade';
  return 'outro';
}

/**
 * Os exemplos mais fortes para levar a uma câmara, por esta ordem:
 * emergências (o risco é real), entidades do concelho (a resposta errada
 * manda o munícipe para o sítio errado), "contacte-nos" (o assistente não
 * ajuda) e o resto. Até `porTipo` de cada, com capturas primeiro (são a
 * prova), e pela ordem do conjunto para ser estável.
 */
export function escolherExemplos(
  pares: Par[],
  porTipo = 3,
): { tipo: TipoExemplo; pares: Par[] }[] {
  const ordem: TipoExemplo[] = ['emergencia', 'entidade', 'contacte', 'outro'];
  return ordem
    .map((tipo) => ({
      tipo,
      pares: pares
        .filter((p) => tipoExemplo(p) === tipo)
        .sort(
          (a, b) =>
            Number(!!b.outro.captura_key) - Number(!!a.outro.captura_key) ||
            a.nos.ordem - b.nos.ordem,
        )
        .slice(0, porTipo),
    }))
    .filter((g) => g.pares.length);
}

/**
 * "Números sem fonte": valores (€, prazos, horas, telefones, %) ditos na
 * resposta que não estão na pergunta nem no gabarito (escrito a partir das
 * fontes oficiais). Por resposta, quantos; agregado, a % de respostas com
 * pelo menos um. Respostas sem gabarito ficam de fora (não há com que
 * comparar) e contam em `sem_gabarito`.
 */
export function numerosSemFonte(respostas: RespostaRel[]): ResumoNumeros & {
  sem_gabarito: number;
  porResposta: { resposta_id: string; numeros: string[] }[];
} {
  const comGabarito = respostas.filter((r) => r.gabarito_resposta !== null);
  const { porResposta, ...resumo } = resumirNumeros(
    comGabarito.map((r) => ({
      texto: r.texto,
      fontes: [
        r.pergunta,
        r.gabarito_resposta ?? '',
        ...(r.gabarito_factos ?? []),
      ],
    })),
  );
  return {
    ...resumo,
    sem_gabarito: respostas.length - comGabarito.length,
    porResposta: comGabarito.map((r, i) => ({
      resposta_id: r.resposta_id,
      numeros: porResposta[i].semFonte.map((n) => n.texto),
    })),
  };
}

/** Frases simples para "o que muda para o munícipe". */
export function oQueMuda(
  nos: ExecucaoRel,
  outro: ExecucaoRel,
  d: Divergencias,
): string[] {
  const tn = taxa(nos.respostas);
  const to = taxa(outro.respostas);
  const n = tn.total;
  const frases: string[] = [];
  const okN = tn.certas + tn.passadas_bem;
  const okO = to.certas + to.passadas_bem;
  frases.push(
    `Em ${n} perguntas, o munícipe passa a ter a resposta certa em ${okN} (hoje: ${okO}).`,
  );
  if (d.nosGanhamos.length)
    frases.push(
      `${d.nosGanhamos.length === 1 ? '1 pergunta que hoje fica mal respondida passa' : `${d.nosGanhamos.length} perguntas que hoje ficam mal respondidas passam`} a ter resposta certa.`,
    );
  const emerg = d.nosGanhamos.filter(
    (p) => tipoExemplo(p) === 'emergencia',
  ).length;
  if (emerg)
    frases.push(
      `Em ${emerg} ${emerg === 1 ? 'situação' : 'situações'} de emergência, o munícipe é mandado ligar 112 logo à primeira.`,
    );
  const contacte = outro.respostas.filter(
    (r) => regraDaJustificacao(r.justificacao) === 'R5-so-manda-contactar',
  ).length;
  if (contacte)
    frases.push(
      `Hoje, ${contacte === 1 ? '1 resposta limita-se' : `${contacte} respostas limitam-se`} a mandar contactar a câmara; isso é trabalho que volta para os serviços.`,
    );
  const errosO = outro.respostas.filter((r) => r.factos_errados.length).length;
  const errosN = nos.respostas.filter((r) => r.factos_errados.length).length;
  if (errosO > errosN)
    frases.push(
      `Respostas com informação errada (números, entidades, prazos): hoje ${errosO}, com o Tou, Câmara? ${errosN}.`,
    );
  const numO = numerosSemFonte(outro.respostas).com_numeros_sem_fonte;
  const numN = numerosSemFonte(nos.respostas).com_numeros_sem_fonte;
  if (numO > numN)
    frases.push(
      `Respostas com valores que não estão nas fontes oficiais (taxas, prazos, horários, telefones): hoje ${numO}, com o Tou, Câmara? ${numN}.`,
    );
  if (tn.passadas_bem)
    frases.push(
      `Quando a pergunta é difícil, o Tou, Câmara? passa a uma pessoa da câmara em vez de inventar (${tn.passadas_bem} ${tn.passadas_bem === 1 ? 'vez' : 'vezes'}).`,
    );
  if (d.outroGanha.length)
    frases.push(
      `Em ${d.outroGanha.length} ${d.outroGanha.length === 1 ? 'pergunta' : 'perguntas'} o assistente atual acertou e nós não; estão listadas neste relatório.`,
    );
  return frases;
}
