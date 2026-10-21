/*
 * "Registo de acessos" (V2 · Equipa e acessos): o audit_log em frases que
 * uma chefe de divisão percebe. Sem BD, para testar à parte.
 */

/** Ações que tocam em dados pessoais (gravações, fichas, anonimização). */
export const ACOES_DADOS_PESSOAIS = [
  'ouvir_gravacao',
  'ver',
  'ver_resumo',
  'anonimizar',
  'apagar',
  'apagar_retencao',
  'inscrever_contacto_cuidado',
  'remover_contacto_cuidado',
] as const;

const VERBOS: Record<string, string> = {
  ouvir_gravacao: 'ouviu a gravação',
  ver: 'viu',
  ver_resumo: 'viu o resumo',
  atribuir: 'ficou com',
  reatribuir: 'reatribuiu',
  aprovar: 'aprovou',
  responder: 'respondeu a',
  fechar: 'fechou',
  encaminhar: 'encaminhou',
  publicar: 'publicou',
  publicar_sem_avaliacao: 'publicou sem avaliação',
  anonimizar: 'anonimizou',
  apagar: 'apagou',
  apagar_retencao: 'apagou por fim do prazo de retenção',
  entrar: 'entrou no painel',
  ligar: 'pediu ao agente para ligar sobre',
  lancar_campanha: 'lançou a campanha',
  inscrever_contacto_cuidado: 'inscreveu uma pessoa na lista de contactos de',
  remover_contacto_cuidado: 'retirou uma pessoa da lista de contactos de',
  tratar_destinatario_campanha: 'tratou um pedido de ajuda de',
  recusar_licenca: 'recusou',
  aprovar_licenca: 'aprovou',
  mudar_regras_licenca: 'mudou as regras de',
  ligou_assistente_ia: 'ligou um assistente de IA',
  desligou_assistente_ia: 'desligou um assistente de IA',
  ensinar_agente: 'propôs uma resposta nova ao agente em',
  recusar_chamadas: 'pediu para não ser ligado',
  recusar_avisos: 'pediu para não receber avisos',
  gerar_relatorio: 'gerou',
  enviar_aviso_zona: 'enviou',
  carregar_zonas_demonstracao: 'carregou as zonas de demonstração do',
  criar: 'criou',
  atualizar: 'alterou',
  acrescentar_documento: 'acrescentou um documento exigido a',
  alterar_documento: 'alterou um documento exigido de',
  remover_documento: 'removeu um documento exigido de',
  alterar_perguntas_camara: 'mudou',
  juntar_familiar: 'juntou um familiar a',
  alterar_agente: 'alterou',
  pedir_apoio: 'fez',
  mudar_apoio: 'mudou os critérios de',
  criar_apoio: 'acrescentou',
  carregar_apoios_demonstracao: 'carregou os apoios de demonstração',
  ligar_quem_tem_direito:
    'pediu ao agente para ligar a quem pode ter direito a',
};

const OBJETOS: Record<string, string> = {
  conversa: 'uma conversa',
  passagem_humano: 'uma passagem a funcionário',
  processo: 'um processo',
  resposta: 'uma resposta do agente',
  campanha: 'uma campanha',
  campanha_destinatario: 'uma campanha',
  contacto_cuidado: 'ação social',
  licenca: 'uma licença',
  licenca_regras: 'licença de ruído',
  ligacao_ia: '',
  municipe: 'um munícipe',
  relatorio: 'um relatório',
  aviso_zona: 'um aviso por zona',
  zonas_pdm: 'PDM',
  pergunta_sem_resposta: 'Conhecimento',
  utilizador: 'um utilizador',
  tipo_processo: 'um tipo de processo',
  perguntas_camara: 'as perguntas da câmara',
  juncao_familiar: 'uma chamada',
  agente_config: 'o agente',
  apoio: 'um apoio',
  apoios: '',
  pedido_apoio: 'um pedido de apoio',
};

export function frase(acao: string, objetoTipo: string): string {
  const verbo = VERBOS[acao] ?? acao.replace(/_/g, ' ');
  const objeto = OBJETOS[objetoTipo] ?? objetoTipo.replace(/_/g, ' ');
  return objeto ? `${verbo} ${objeto}` : verbo;
}

/** Para onde o painel pode levar, quando o objeto tem página. */
export function ligacao(objetoTipo: string, objetoId: string): string | null {
  const uuid = /^[0-9a-f-]{36}$/i.test(objetoId);
  if (!uuid) return null;
  switch (objetoTipo) {
    case 'conversa':
      return `/painel/conversas/${objetoId}`;
    case 'passagem_humano':
      return `/painel/passagens/${objetoId}`;
    case 'processo':
      return `/painel/processos/${objetoId}`;
    case 'campanha':
      return `/painel/campanhas/${objetoId}`;
    default:
      return null;
  }
}
