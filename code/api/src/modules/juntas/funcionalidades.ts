/*
 * O que a versão para juntas de freguesia tem e esconde (feature flags por
 * tipo de município). Regras puras: o interceptor do painel
 * (funcionalidades.interceptor.ts) e o filtro das ferramentas do agente
 * (juntas.module.ts) só perguntam aqui.
 *
 * A web tem a mesma lista para o menu (code/web/lib/juntas.ts): se mudar
 * aqui, muda lá.
 */

export type TipoMunicipio = 'camara' | 'junta';

/**
 * Áreas do painel que só a câmara tem (prefixos das rotas, sem o /v1):
 * urbanismo e obras, licenças, PDM, fiscalização, contratação pública,
 * arquivo de obras, balcão para empresas, pagamentos de taxas, ação
 * social e apoios, emergências e avisos por zona, dados abertos, turismo,
 * consultas públicas e chamadas feitas pelo agente.
 */
export const PAINEL_SO_CAMARA: readonly string[] = [
  '/painel/processos',
  '/painel/rascunhos',
  '/painel/tipos-processo',
  '/painel/requerimentos',
  '/painel/licencas',
  '/painel/ordenamento',
  '/painel/fiscalizacao',
  '/painel/contratacao',
  '/painel/arquivo',
  '/painel/empresas',
  '/painel/antecipacoes',
  '/painel/entregas',
  '/painel/cartas',
  '/painel/pagamentos',
  '/painel/taxas',
  '/painel/integracoes',
  '/painel/chamadas-saida',
  '/painel/campanhas',
  '/painel/apoios',
  '/painel/emergencias',
  '/painel/avisos-zona',
  '/painel/transparencia',
  '/painel/turismo',
  '/painel/consultas',
];

/** Áreas do painel que só a junta tem. */
export const PAINEL_SO_JUNTA: readonly string[] = ['/painel/atestados'];

function comPrefixo(caminho: string, prefixos: readonly string[]): boolean {
  return prefixos.some((p) => caminho === p || caminho.startsWith(`${p}/`));
}

/** O caminho da API sem o prefixo da versão nem a query: '/v1/painel/x?y' → '/painel/x'. */
export function caminhoSemVersao(url: string): string {
  const semQuery = url.split('?')[0] ?? '';
  return semQuery.replace(/^\/v\d+(?=\/)/, '');
}

/** Esta rota do painel existe para este tipo de município? */
export function painelDisponivel(
  tipo: TipoMunicipio | undefined,
  caminho: string,
): boolean {
  const c = caminhoSemVersao(caminho);
  if (!c.startsWith('/painel/')) return true;
  if ((tipo ?? 'camara') === 'junta') return !comPrefixo(c, PAINEL_SO_CAMARA);
  return !comPrefixo(c, PAINEL_SO_JUNTA);
}

/**
 * Ferramentas do agente que a junta não tem: licenças, PDM, requerimentos
 * e processos de urbanismo, taxas e pagamentos, balcão para empresas,
 * arquivo de obras, apoios sociais, recolha de monos, consultas públicas e
 * deliberações da câmara, cartas da câmara, entregas em nome da pessoa.
 * A junta fica com o atendimento geral (conhecimento, encaminhar, passar a
 * humano, ocorrências, marcações, reclamações, identificação, familiar…)
 * e com a área `junta` do catálogo de serviços.
 */
export const FERRAMENTAS_SO_CAMARA: ReadonlySet<string> = new Set([
  'pedir_licenca',
  'campos_da_licenca',
  'renovar_licenca',
  'o_que_posso_fazer',
  'simular_taxa',
  'criar_pagamento',
  'iniciar_requerimento',
  'preencher_campo',
  'concluir_requerimento',
  'estado_processo',
  'explicar_momento',
  'entregar_pedido',
  'o_que_a_empresa_precisa',
  'obrigacoes_da_empresa',
  'pedir_consulta_arquivo',
  'procurar_deliberacoes',
  'que_apoios_tenho',
  'pedir_apoio',
  'agendar_recolha',
  'consultas_abertas',
  'participar_consulta',
  'ler_carta',
  'preparar_resposta_carta',
]);

/** A área do catálogo de serviços (outros_servicos/pedir_servico) das juntas. */
export const AREA_JUNTA = 'junta';

export const DESCRICAO_AREA_JUNTA =
  'junta de freguesia: atestados (residência, agregado familiar, situação económica) e prova de vida';

/** O que a ferramenta pede, para decidir: a área do catálogo (se houver). */
function areaDe(entrada: unknown): string | undefined {
  const a = (entrada as { area?: unknown } | null)?.area;
  return typeof a === 'string' ? a : undefined;
}

export type DecisaoFerramenta =
  /** Segue para a ferramenta normal. */
  | 'seguir'
  /** Área `junta` do catálogo: trata o módulo das juntas. */
  | 'area_junta'
  /** Catálogo sem área numa junta: só a área da junta. */
  | 'catalogo_junta'
  /** Catálogo sem área numa câmara: o normal e mais a área da junta. */
  | 'catalogo_camara'
  /** Numa junta, é da câmara: responde com o contacto da câmara. */
  | 'so_camara';

/** O que fazer com uma chamada de ferramenta, pelo tipo de município. */
export function decidirFerramenta(
  tipo: TipoMunicipio | undefined,
  nome: string,
  entrada: unknown,
): DecisaoFerramenta {
  const junta = (tipo ?? 'camara') === 'junta';
  if (nome === 'outros_servicos' || nome === 'pedir_servico') {
    const area = areaDe(entrada);
    if (area === AREA_JUNTA) return 'area_junta';
    if (nome === 'outros_servicos' && area === undefined) {
      return junta ? 'catalogo_junta' : 'catalogo_camara';
    }
    return junta ? 'so_camara' : 'seguir';
  }
  if (junta && FERRAMENTAS_SO_CAMARA.has(nome)) return 'so_camara';
  return 'seguir';
}
