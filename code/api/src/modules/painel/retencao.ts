/*
 * Regras de retenção (RGPD, secção 8 do plano). Puro: o job retencao_rgpd
 * (rgpd.service.ts) decide com estas funções e só depois toca na BD.
 */

export const OBJETOS_RETENCAO = [
  'gravacoes',
  'transcricoes',
  'telefones_sem_processo',
  'fotos_ocorrencias',
] as const;
export type ObjetoRetencao = (typeof OBJETOS_RETENCAO)[number];

export interface Politica {
  objeto: ObjetoRetencao;
  /** Intervalo do Postgres em texto: '30 days', '1 year'. */
  guardar: string;
  acao: 'apagar' | 'anonimizar';
  origem: 'municipio' | 'omissao';
}

/** Sem política do município valem as do plano. */
export const POLITICAS_POR_OMISSAO: Record<
  ObjetoRetencao,
  Omit<Politica, 'objeto' | 'origem'>
> = {
  gravacoes: { guardar: '30 days', acao: 'apagar' },
  transcricoes: { guardar: '12 mons', acao: 'anonimizar' },
  telefones_sem_processo: { guardar: '30 days', acao: 'anonimizar' },
  fotos_ocorrencias: { guardar: '12 mons', acao: 'apagar' },
};

/** As quatro políticas do município, completadas com as omissões. */
export function politicasEfetivas(
  doMunicipio: readonly {
    objeto: string;
    guardar: string;
    acao: 'apagar' | 'anonimizar';
  }[],
): Politica[] {
  const por = new Map(doMunicipio.map((p) => [p.objeto, p]));
  return OBJETOS_RETENCAO.map((objeto) => {
    const p = por.get(objeto);
    return p
      ? { objeto, guardar: p.guardar, acao: p.acao, origem: 'municipio' }
      : { objeto, ...POLITICAS_POR_OMISSAO[objeto], origem: 'omissao' };
  });
}

/** O que um munícipe ainda tem com a câmara (para decidir se se anonimiza). */
export interface FichaMunicipe {
  id: string;
  criado_em: Date;
  processos: number;
  requerimentos: number;
  /** Marcações ('marcada') e recolhas ('marcada') que ainda não passaram. */
  marcacoes_futuras: number;
  /** Ocorrências ainda abertas: tem de receber o SMS de resolvida. */
  ocorrencias_abertas: number;
  ultima_conversa_em: Date | null;
}

/**
 * "Telefones sem processo": anonimiza-se o munícipe que não tem processos,
 * requerimentos, marcações futuras nem ocorrências abertas, e cujo último
 * contacto (ou criação) é anterior ao limite.
 */
export function podeAnonimizarMunicipe(
  f: FichaMunicipe,
  limite: Date,
): boolean {
  if (f.processos > 0 || f.requerimentos > 0) return false;
  if (f.marcacoes_futuras > 0 || f.ocorrencias_abertas > 0) return false;
  const ultimo = f.ultima_conversa_em ?? f.criado_em;
  return ultimo < limite && f.criado_em < limite;
}

/** Texto que fica no lugar das transcrições anonimizadas. */
export const TEXTO_ANONIMIZADO = '[anonimizado]';

/** Ação registada no audit_log para cada objeto. */
export function acaoAuditoria(p: Politica): 'apagar_retencao' | 'anonimizar' {
  // Gravações e fotos só se podem apagar; transcrições e telefones anonimizam-se
  // (apagar turnos partia citações e perguntas sem resposta que lhes apontam).
  if (p.objeto === 'gravacoes' || p.objeto === 'fotos_ocorrencias') {
    return 'apagar_retencao';
  }
  return 'anonimizar';
}
