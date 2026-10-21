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
  carregar_historico_licencas_demonstracao:
    'carregou pedidos antigos de demonstração de',
  ligou_assistente_ia: 'ligou um assistente de IA',
  desligou_assistente_ia: 'desligou um assistente de IA',
  ensinar_agente: 'propôs uma resposta nova ao agente em',
  recusar_chamadas: 'pediu para não ser ligado',
  recusar_avisos: 'pediu para não receber avisos',
  gerar_relatorio: 'gerou',
  enviar_aviso_zona: 'enviou',
  carregar_zonas_demonstracao: 'carregou as zonas de demonstração do',
  mudar_regras_zona: 'mudou as regras de',
  carregar_consultas_pdm_demonstracao: 'carregou perguntas de demonstração do',
  criar: 'criou',
  atualizar: 'alterou',
  acrescentar_documento: 'acrescentou um documento exigido a',
  alterar_documento: 'alterou um documento exigido de',
  remover_documento: 'removeu um documento exigido de',
  alterar_perguntas_camara: 'mudou',
  juntar_familiar: 'juntou um familiar a',
  pedir_avaliacao: 'pediu um teste do agente',
  mudar_vigencia: 'acertou as datas de vigência de',
  alterar_agente: 'alterou',
  arquivar: 'arquivou',
  iniciar_entrevista: 'começou',
  concluir_entrevista: 'concluiu',
  cancelar_entrevista: 'cancelou',
  tratar_lacuna: 'tratou',
  pedir_apoio: 'fez',
  mudar_apoio: 'mudou os critérios de',
  criar_apoio: 'acrescentou',
  carregar_apoios_demonstracao: 'carregou os apoios de demonstração',
  ligar_quem_tem_direito:
    'pediu ao agente para ligar a quem pode ter direito a',
  abrir_consulta: 'abriu',
  fechar_consulta: 'fechou',
  resumir_opinioes: 'resumiu as opiniões de',
  exportar_participacoes: 'exportou as participações (anonimizadas) de',
  ligar_consulta: 'mandou o agente ligar às pessoas inscritas sobre',
  participar_consulta: 'participou em',
  alterar_participacao: 'mudou a participação em',
  registar_reclamacao: 'registou',
  atribuir_reclamacao: 'atribuiu',
  encerrar_reclamacao: 'encerrou',
  converter_email_reclamacao: 'registou como reclamação formal',
  mudar_prazo_reclamacoes: 'mudou o prazo de resposta de',
  acrescentar_anexo_reclamacao: 'juntou um anexo a',
  enviar_gravacao_reuniao: 'enviou a gravação de',
  transcrever_reuniao: 'pediu a transcrição da gravação de',
  gravar_transcricao_reuniao: 'gravou a transcrição de',
  gerar_rascunho_ata: 'gerou o rascunho de',
  editar_ata: 'editou',
  aprovar_ata: 'aprovou',
  publicar_ata: 'publicou',
  importar_contratos_base: 'importou contratos do portal BASE para',
  enviar_revisao_contratacao: 'enviou para revisão jurídica',
  devolver_contratacao: 'devolveu ao rascunho',
  alterar_peca_contratacao: 'alterou uma peça de',
  mudar_regras_contratacao: 'mudou os limiares',
  publicar_dados_abertos: 'publicou',
  ligar_dados_abertos: 'ligou a publicação de',
  desligar_dados_abertos: 'desligou a publicação de',
  ditar_relatorio: 'ditou o relatório de',
  corrigir_relatorio: 'reviu o relatório de',
  concluir_visita: 'fechou o relatório de',
  cancelar_visita: 'cancelou',
  acrescentar_foto_visita: 'juntou uma fotografia a',
  mudar_config_fiscalizacao: 'mudou o planeamento de',
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
  licenca_regras: 'uma licença',
  ligacao_ia: '',
  municipe: 'um munícipe',
  relatorio: 'um relatório',
  aviso_zona: 'um aviso por zona',
  zonas_pdm: 'PDM',
  zona_pdm: 'uma zona do PDM',
  pergunta_sem_resposta: 'Conhecimento',
  utilizador: 'um utilizador',
  tipo_processo: 'um tipo de processo',
  perguntas_camara: 'as perguntas da câmara',
  juncao_familiar: 'uma chamada',
  pedido_avaliacao: '',
  fonte: 'uma fonte oficial',
  agente_config: 'o agente',
  procedimento: 'um procedimento interno',
  entrevista: 'uma entrevista sobre um procedimento',
  assistente_pergunta: 'uma pergunta sem resposta do assistente interno',
  apoio: 'um apoio',
  apoios: '',
  pedido_apoio: 'um pedido de apoio',
  consulta_publica: 'uma consulta pública',
  reclamacao: 'uma reclamação',
  reclamacoes_config: 'as reclamações',
  reuniao: 'uma reunião',
  ata: 'uma ata',
  procedimento_contratacao: 'um procedimento de contratação pública',
  contrato_publico: 'um contrato público',
  contratos_publicos: 'o registo de contratos públicos',
  contratacao_config: 'da contratação pública',
  conjunto_dados: 'um conjunto de dados abertos',
  visita_fiscalizacao: 'uma visita de fiscalização',
  fiscalizacao_config: 'a fiscalização',
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
    case 'procedimento':
      return `/painel/procedimentos/${objetoId}`;
    case 'reclamacao':
      return `/painel/reclamacoes?id=${objetoId}`;
    case 'entrevista':
      return `/painel/procedimentos/entrevistas/${objetoId}`;
    default:
      return null;
  }
}
