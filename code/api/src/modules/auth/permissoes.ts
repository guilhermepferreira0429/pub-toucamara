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
  // Reuniões de câmara e assembleia (atas e deliberações): a chefia, os
  // vereadores e quem secretaria (os serviços administrativos, perfil
  // 'atendimento': não há um perfil próprio de secretariado).
  reunioes: ['atendimento', 'chefe_divisao', 'vereador'],
  // Contratação pública (interno): a chefia e os técnicos que tratam das
  // compras; mudar os limiares e aprovar é da chefia (recurso 'agente').
  contratacao: ['tecnico', 'chefe_divisao'],
  // Dados abertos: quem vê os indicadores vê o que se publica; ligar,
  // desligar e publicar já é decisão da chefia.
  transparencia: ['chefe_divisao'],
  // Fiscalização: os técnicos (fiscais) e a chefia planeiam as visitas e
  // ditam os relatórios; a configuração do planeamento é da chefia ('agente').
  fiscalizacao: ['tecnico', 'chefe_divisao'],
  // Arquivo antigo: quem atende trata os pedidos de consulta; pesquisar,
  // carregar digitalizações e rever metadados é dos técnicos e da chefia
  // (arquivo/regras.ts, PERFIS_DOCUMENTOS).
  arquivo: ['atendimento', 'tecnico', 'chefe_divisao'],
  // Comunicados, notícias e eventos do feed "o que se passa perto de mim":
  // quem atende (comunicação) e a chefia escrevem e publicam; ver é de quem
  // tem a visão geral.
  comunicados: ['atendimento', 'chefe_divisao'],
  // Preparar a câmara de demonstração e esconder os registos dos testes:
  // só a chefia (e a administração, que pode tudo).
  demo: ['chefe_divisao'],
  // Escolas (refeições, transporte, atividades, pré-escolar): quem atende e
  // os técnicos da educação veem e decidem; dados de menores e de saúde.
  escolas: ['atendimento', 'tecnico', 'chefe_divisao'],
  // Habitação municipal: rendimentos e situação das famílias (dados
  // sensíveis): os técnicos da habitação e a chefia.
  habitacao: ['tecnico', 'chefe_divisao'],
  // Atestados da junta de freguesia (só nas juntas): quem atende e a chefia
  // emitem ou recusam os pedidos que o agente recolheu.
  atestados: ['atendimento', 'tecnico', 'chefe_divisao'],
  // Estacionamento (multas, defesas, lugares reservados): quem atende e os
  // técnicos da fiscalização e do trânsito decidem; os vereadores não.
  estacionamento: ['atendimento', 'tecnico', 'chefe_divisao'],
  // Reservas de equipamentos e bilhetes: quem atende aprova e recusa; criar e
  // mudar equipamentos (preços, horário, aprovação) é da chefia ('agente').
  reservas: ['atendimento', 'tecnico', 'chefe_divisao'],
  // Serviços municipais do catálogo (V4: cemitérios, animais, água…): quem
  // atende, os técnicos e a chefia tratam os pedidos registados pelo agente.
  servicos_municipais: ['atendimento', 'tecnico', 'chefe_divisao'],
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
