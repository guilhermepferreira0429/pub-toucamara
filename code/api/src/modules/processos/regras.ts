/*
 * Regras puras dos processos: fases em linguagem simples, número do
 * processo, documentos que faltam e escolha do tipo a partir do que o
 * munícipe disse. Sem BD, para testar à parte.
 */

export const FASES = [
  'entrada',
  'documentos',
  'apreciacao',
  'pareceres_externos',
  'decisao',
  'notificado',
  'arquivado',
] as const;

export type Fase = (typeof FASES)[number];

/** O que o agente e a página dizem ao munícipe ("o seu processo …"). */
export const FASE_EM_PALAVRAS: Record<Fase, string> = {
  entrada: 'deu entrada e aguarda a verificação inicial',
  documentos: 'está à espera de documentos da sua parte',
  apreciacao: 'está a ser analisado pelo técnico',
  pareceres_externos: 'aguarda pareceres de entidades externas',
  decisao: 'está na fase de decisão',
  notificado: 'já tem decisão, que lhe foi comunicada',
  arquivado: 'está arquivado',
};

/** Para o painel e para eventos ("Fase: Apreciação → Decisão"). */
export const FASE_ROTULO: Record<Fase, string> = {
  entrada: 'Entrada',
  documentos: 'Documentos',
  apreciacao: 'Apreciação',
  pareceres_externos: 'Pareceres externos',
  decisao: 'Decisão',
  notificado: 'Notificado',
  arquivado: 'Arquivado',
};

/** Fases em que o prazo já não corre (não há atraso a mostrar). */
export const FASES_FECHADAS: readonly Fase[] = ['notificado', 'arquivado'];

export function formatarNumero(codigo: string, n: number, ano: number): string {
  return `${codigo} ${n}/${ano}`;
}

export interface NumeroDito {
  codigo: string | null;
  n: number;
  ano: number | null;
}

/**
 * O número como vem falado ou escrito: 'CP 412/2026', 'cp 412 de 2026',
 * 'CP-412', '412/2026', '412'. Sem número → null.
 */
export function lerNumero(texto: string): NumeroDito | null {
  const m =
    /(?:^|[^a-z])([a-z]{1,5})?\s*[-.]?\s*(\d{1,6})(?:\s*(?:\/|de|-)\s*(\d{4}))?/i.exec(
      texto.trim(),
    );
  if (!m) return null;
  return {
    codigo: m[1] ? m[1].toUpperCase() : null,
    n: Number(m[2]),
    ano: m[3] ? Number(m[3]) : null,
  };
}

/** 'CP 412/2026' corresponde ao que foi dito? Só se compara o que foi dito. */
export function correspondeNumero(numero: string, dito: NumeroDito): boolean {
  const m = /^(\S+)\s+(\d+)\/(\d{4})$/.exec(numero);
  if (!m) return false;
  return (
    Number(m[2]) === dito.n &&
    (dito.codigo === null || m[1].toUpperCase() === dito.codigo) &&
    (dito.ano === null || Number(m[3]) === dito.ano)
  );
}

export interface DocumentoExigido {
  id: string;
  nome: string;
  obrigatorio: boolean;
  gerado_pelo_sistema: boolean;
  /** Já há um documento deste tipo que não foi rejeitado. */
  tem: boolean;
}

/**
 * `tem`: os que já chegaram. `faltam`: os obrigatórios por entregar (os que o
 * sistema gera, como a planta de localização, nunca faltam ao munícipe).
 */
export function resumirDocumentos(lista: DocumentoExigido[]): {
  tem: string[];
  faltam: string[];
} {
  return {
    tem: lista.filter((d) => d.tem).map((d) => d.nome),
    faltam: lista
      .filter((d) => !d.tem && d.obrigatorio && !d.gerado_pelo_sistema)
      .map((d) => d.nome),
  };
}

export interface CandidatoTipo {
  id: string;
  codigo: string;
  nome: string;
  pontuacao: number;
}

// Abaixo disto a correspondência é ruído (trigramas soltos).
const MINIMO = 0.15;

/**
 * Escolhe o tipo de processo a partir da pesquisa: um claro vencedor (o dobro
 * do segundo) ou as opções para o agente perguntar. Ordenados por pontuação.
 */
export function escolherTipo(
  candidatos: CandidatoTipo[],
): { tipo: CandidatoTipo } | { opcoes: CandidatoTipo[] } {
  const validos = candidatos.filter((c) => c.pontuacao >= MINIMO);
  const [primeiro, segundo] = validos;
  if (!primeiro) return { opcoes: [] };
  if (!segundo || primeiro.pontuacao >= 2 * segundo.pontuacao) {
    return { tipo: primeiro };
  }
  return {
    opcoes: validos
      .filter((c) => c.pontuacao >= primeiro.pontuacao / 2)
      .slice(0, 4),
  };
}

/** Para o painel: 'Maria Fernandes' → 'Maria F.'. */
export function mascararNome(nome: string | null): string | null {
  if (!nome) return null;
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1][0]}.`;
}
