/*
 * Que ferramentas do agente a porta para as IAs mostra, e como resume cada
 * pedido no painel. As de voz (motivo_da_chamada, identificar pelo NIF...)
 * ficam de fora: o assistente fala por escrito e a pessoa já está
 * identificada pela chave.
 */

/** Sem chave: só informação pública. */
export const FERRAMENTAS_PUBLICAS = [
  'procurar_conhecimento',
  'encaminhar',
  'simular_taxa',
  'ver_vagas',
  'o_que_posso_fazer',
  'consultas_abertas',
  'que_apoios_tenho',
] as const;

/** Com a chave pessoal: as ações em nome da pessoa. */
export const FERRAMENTAS_PESSOAIS = [
  ...FERRAMENTAS_PUBLICAS,
  'registar_ocorrencia',
  'estado_ocorrencia',
  'estado_processo',
  'marcar',
  'cancelar_marcacao',
  'agendar_recolha',
  'criar_pagamento',
  'iniciar_requerimento',
  'preencher_campo',
  'concluir_requerimento',
  'passar_a_humano',
  'redigir',
  'conversa_anterior',
  'nao_quero_avisos',
  'participar_consulta',
  'pedir_apoio',
  'pedir_licenca_ruido',
  'pedir_licenca_ocupacao_via',
  'pedir_licenca_esplanada',
  'pedir_distico_residente',
  'pedir_licenca_publicidade',
  'pedir_licenca_recinto_improvisado',
  'renovar_licenca',
  'registar_reclamacao',
] as const;

/** Não mudam nada: o cliente pode correr sem pedir confirmação. */
export const SO_LEITURA = new Set<string>([
  'procurar_conhecimento',
  'encaminhar',
  'simular_taxa',
  'ver_vagas',
  'o_que_posso_fazer',
  'consultas_abertas',
  'estado_ocorrencia',
  'estado_processo',
  'redigir',
  'conversa_anterior',
]);

export const TITULOS: Record<string, string> = {
  procurar_conhecimento: 'Procurar nas fontes oficiais',
  encaminhar: 'Que entidade trata disto',
  simular_taxa: 'Simular uma taxa municipal',
  ver_vagas: 'Ver vagas para atendimento',
  o_que_posso_fazer: 'O que posso fazer nesta morada (PDM)',
  consultas_abertas: 'Consultas públicas abertas',
  que_apoios_tenho: 'A que apoios tenho direito',
  participar_consulta: 'Participar numa consulta pública',
  pedir_apoio: 'Pedir um apoio',
  pedir_licenca_ruido: 'Pedir licença especial de ruído',
  pedir_licenca_ocupacao_via: 'Pedir licença de ocupação da via pública',
  pedir_licenca_esplanada: 'Pedir licença de esplanada',
  pedir_distico_residente: 'Pedir dístico de residente',
  pedir_licenca_publicidade: 'Pedir licença de publicidade',
  pedir_licenca_recinto_improvisado: 'Pedir licença de recinto improvisado',
  renovar_licenca: 'Renovar uma licença a expirar',
  registar_ocorrencia: 'Registar um problema na via pública',
  estado_ocorrencia: 'Estado de uma ocorrência',
  estado_processo: 'Estado de um processo',
  marcar: 'Marcar atendimento',
  cancelar_marcacao: 'Cancelar uma marcação',
  agendar_recolha: 'Agendar recolha de monos',
  criar_pagamento: 'Pagar uma taxa (modo de teste)',
  iniciar_requerimento: 'Começar um requerimento',
  preencher_campo: 'Preencher campos do requerimento',
  concluir_requerimento: 'Concluir o requerimento',
  passar_a_humano: 'Passar a um funcionário',
  redigir: 'Redigir reclamação, email ou pedido',
  registar_reclamacao: 'Registar uma reclamação formal',
  conversa_anterior: 'Conversas anteriores',
  nao_quero_avisos: 'Deixar de receber avisos por zona',
};

/** Instruções para o modelo do assistente (vão no `initialize`). */
export function instrucoes(municipio: string, pessoal: boolean): string {
  return [
    `Porta oficial da Câmara Municipal de ${municipio} para assistentes de IA (serviço Tou, Câmara?).`,
    'As ferramentas são as mesmas do atendimento telefónico da câmara. Algumas descrições falam em "chamada" ou "dizer": aqui, escreve à pessoa.',
    'Responde só com o que as ferramentas devolvem e diz a fonte. Se vier sem_fonte: true, não inventes: usa passar_a_humano (se disponível) ou indica o contacto da câmara.',
    'Emergências (fogo, fumo, acidente, alguém em perigo): diz para ligar já para o 112, antes de qualquer outra coisa.',
    'Antes de uma ação que muda alguma coisa (registar, marcar, pagar, concluir), confirma os dados com a pessoa.',
    pessoal
      ? 'Esta ligação foi autorizada pela pessoa, pelo número de telemóvel verificado por SMS: as ações ficam em nome dela e os SMS vão para esse número.'
      : 'Sem chave pessoal só há informação pública. Para registar ocorrências, marcar ou ver processos, a pessoa liga o assistente em /ia no site da câmara.',
  ].join('\n');
}

type Obj = Record<string, unknown>;

function texto(v: unknown, max = 80): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Uma linha para o feed do painel. Sem dados pessoais além do que o painel
 * já mostra noutros sítios (morada de uma ocorrência, assunto de uma marcação).
 */
export function resumirPedido(
  nome: string,
  entrada: Obj,
  saida: unknown,
): string {
  const r = (saida && typeof saida === 'object' ? saida : {}) as Obj;
  switch (nome) {
    case 'procurar_conhecimento':
      return `Perguntou: "${texto(entrada.pergunta) ?? '…'}"${r.sem_fonte ? ' (sem fonte)' : ''}`;
    case 'encaminhar':
      return `Quem trata de: ${texto(entrada.assunto ?? entrada.pergunta) ?? '…'}`;
    case 'simular_taxa':
      return 'Simulou uma taxa';
    case 'ver_vagas':
      return 'Viu vagas para atendimento';
    case 'o_que_posso_fazer':
      return `Perguntou o que pode fazer em ${texto(entrada.morada, 60) ?? '…'}`;
    case 'registar_ocorrencia':
      if (r.registada === false) return 'Ocorrência por classificar';
      return `${r.duplicada ? 'Juntou a ocorrência' : 'Registou a ocorrência'} ${texto(r.numero) ?? ''}: ${texto(entrada.categoria, 40) ?? ''} em ${texto(entrada.morada, 60) ?? '…'}`.replace(
        /\s+/g,
        ' ',
      );
    case 'estado_ocorrencia':
      return `Viu o estado da ocorrência${entrada.numero ? ` ${texto(entrada.numero)}` : ''}`;
    case 'estado_processo':
      return `Viu o estado do processo${entrada.numero ? ` ${texto(entrada.numero)}` : ''}`;
    case 'marcar':
      return `Marcou atendimento${entrada.assunto ? `: ${texto(entrada.assunto, 60)}` : ''}`;
    case 'cancelar_marcacao':
      return 'Cancelou uma marcação';
    case 'agendar_recolha':
      return 'Agendou uma recolha de monos';
    case 'criar_pagamento':
      return 'Pediu uma referência de pagamento (teste)';
    case 'iniciar_requerimento':
      return `Começou um requerimento${entrada.tipo ? ` (${texto(entrada.tipo, 40)})` : ''}`;
    case 'preencher_campo':
      return 'Preencheu campos do requerimento';
    case 'concluir_requerimento':
      return 'Concluiu o requerimento';
    case 'passar_a_humano':
      return 'Passou o caso a um funcionário';
    case 'redigir':
      return `Redigiu ${entrada.tipo === 'reclamacao' ? 'uma reclamação' : entrada.tipo === 'email' ? 'um email' : 'um pedido'}`;
    case 'registar_reclamacao':
      return r.registada === true
        ? `Registou a reclamação ${texto(r.numero) ?? ''}`.trim()
        : 'Preparou uma reclamação formal';
    default:
      return TITULOS[nome] ?? nome;
  }
}
