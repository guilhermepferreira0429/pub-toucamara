import type { UtilizadorPainel } from '../../common/pedido.js';

export type Perfil = UtilizadorPainel['perfil'];

/**
 * Permissões do painel (secção 5.2 do plano), as mesmas da barra lateral:
 * sem permissão o item aparece com cadeado. `admin` e `equipa_toucamara`
 * podem tudo.
 */
export const PERMISSOES = {
  visao_geral: ['atendimento', 'tecnico', 'chefe_divisao', 'vereador'],
  conversas: ['atendimento', 'tecnico', 'chefe_divisao'],
  gravacoes: ['atendimento', 'chefe_divisao'],
  entrada: ['atendimento', 'tecnico', 'chefe_divisao'],
  processos: ['tecnico', 'chefe_divisao'],
  ocorrencias_ver: ['atendimento', 'tecnico', 'chefe_divisao'],
  ocorrencias: ['tecnico', 'chefe_divisao'],
  indicadores: ['tecnico', 'chefe_divisao', 'vereador'],
  conhecimento_ver: ['atendimento', 'tecnico', 'chefe_divisao'],
  conhecimento: ['chefe_divisao'],
  equipa: ['chefe_divisao'],
  agente: ['chefe_divisao'],
  // Campanhas de contacto e a lista de pessoas inscritas (dados sensíveis).
  acao_social: ['atendimento', 'chefe_divisao'],
  // Procedimentos internos e assistente (só funcionários): todos leem,
  // escrevem rascunhos e dão entrevistas; a chefia publica e arquiva.
  procedimentos_ver: ['atendimento', 'tecnico', 'chefe_divisao', 'vereador'],
  procedimentos: ['chefe_divisao'],
  // Livro de reclamações: quem atende regista e responde; a chefia muda o
  // prazo (recurso 'agente').
  reclamacoes: ['atendimento', 'tecnico', 'chefe_divisao'],
  // Contratação pública (interno): a chefia e os técnicos que tratam das
  // compras; mudar os limiares e aprovar é da chefia (recurso 'agente').
  contratacao: ['tecnico', 'chefe_divisao'],
} as const satisfies Record<string, readonly Perfil[]>;

export type Recurso = keyof typeof PERMISSOES;

const TUDO: readonly Perfil[] = ['admin', 'equipa_toucamara'];

export function pode(perfil: Perfil, recurso: Recurso): boolean {
  return (
    TUDO.includes(perfil) ||
    (PERMISSOES[recurso] as readonly Perfil[]).includes(perfil)
  );
}

/** Para a barra lateral: o que este perfil pode ver. */
export function permissoesDe(perfil: Perfil): Record<Recurso, boolean> {
  return Object.fromEntries(
    (Object.keys(PERMISSOES) as Recurso[]).map((r) => [r, pode(perfil, r)]),
  ) as Record<Recurso, boolean>;
}
