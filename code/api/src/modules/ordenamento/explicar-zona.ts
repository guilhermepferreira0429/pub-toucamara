/*
 * As regras de uma zona do PDM em linguagem simples, para a página pública
 * das regras: por obra, o que é preciso até cada limite e acima deles; e o
 * que mudou entre duas versões. Sem BD. Lê os mesmos degraus que o
 * avaliador (`avaliarObra`), para não haver duas versões da regra.
 */
import { CONTROLO_DITO, Obra, OBRAS, RegraObra, RegrasZona } from './regras.js';
import { estavel } from '../licencas/explicar.js';

export interface ObraExplicada {
  obra: Obra;
  nome: string;
  /** "Não precisa de pedir nada à câmara até 10 m²." ... e o "acima". */
  frases: string[];
  notas: string[];
  /** Que medidas a resposta usa (para o verificador as pedir). */
  medidas: ('area_m2' | 'altura_m')[];
}

const v = (x: number) => String(x).replace('.', ',');
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function frasesObra(regra: RegraObra): string[] {
  const comLimite = regra.degraus.filter(
    (d) => d.area_max_m2 || d.altura_max_m,
  );
  if (!comLimite.length) {
    return [
      `${maiuscula(CONTROLO_DITO[regra.degraus[0]?.controlo ?? regra.acima])}.`,
    ];
  }
  return [
    ...comLimite.map(
      (d) =>
        `${maiuscula(CONTROLO_DITO[d.controlo])} até ${[
          d.area_max_m2 ? `${v(d.area_max_m2)} m²` : null,
          d.altura_max_m ? `${v(d.altura_max_m)} m de altura` : null,
        ]
          .filter(Boolean)
          .join(' e ')}.`,
    ),
    `Acima disso, ${CONTROLO_DITO[regra.acima]}.`,
  ];
}

export function explicarZona(regras: RegrasZona): ObraExplicada[] {
  return (Object.keys(OBRAS) as Obra[])
    .filter((o) => regras[o])
    .map((o) => {
      const r = regras[o]!;
      return {
        obra: o,
        nome: OBRAS[o],
        frases: frasesObra(r),
        notas: r.notas ?? [],
        medidas: [
          ...(r.degraus.some((d) => d.area_max_m2)
            ? (['area_m2'] as const)
            : []),
          ...(r.degraus.some((d) => d.altura_max_m)
            ? (['altura_m'] as const)
            : []),
        ],
      };
    });
}

export interface ConfigZona {
  nome: string;
  descricao: string | null;
  regras: RegrasZona;
  fonte: { titulo: string; artigo: string | null; url: string | null };
  demonstracao: boolean;
}

/** O que mudou numa zona, em linguagem simples. */
export function alteracoesZona(antes: ConfigZona, depois: ConfigZona) {
  const out: {
    campo: string;
    rotulo: string;
    antes: string;
    depois: string;
  }[] = [];
  for (const o of Object.keys(OBRAS) as Obra[]) {
    const a = antes.regras[o];
    const d = depois.regras[o];
    if (estavel(a) === estavel(d)) continue;
    out.push({
      campo: o,
      rotulo: OBRAS[o],
      antes: a ? frasesObra(a).join(' ') : 'sem regra',
      depois: d ? frasesObra(d).join(' ') : 'sem regra',
    });
  }
  if (antes.nome !== depois.nome) {
    out.push({
      campo: 'nome',
      rotulo: 'Nome da zona',
      antes: antes.nome,
      depois: depois.nome,
    });
  }
  if ((antes.descricao ?? '') !== (depois.descricao ?? '')) {
    out.push({
      campo: 'descricao',
      rotulo: 'Descrição',
      antes: antes.descricao ?? '—',
      depois: depois.descricao ?? '—',
    });
  }
  if (estavel(antes.fonte) !== estavel(depois.fonte)) {
    const t = (f: ConfigZona['fonte']) =>
      [f.titulo, f.artigo].filter(Boolean).join(', ');
    out.push({
      campo: 'fonte',
      rotulo: 'Base legal',
      antes: t(antes.fonte),
      depois: t(depois.fonte),
    });
  }
  if (antes.demonstracao !== depois.demonstracao) {
    out.push({
      campo: 'demonstracao',
      rotulo: 'Valores de demonstração',
      antes: antes.demonstracao ? 'sim' : 'não',
      depois: depois.demonstracao ? 'sim' : 'não',
    });
  }
  return out;
}
