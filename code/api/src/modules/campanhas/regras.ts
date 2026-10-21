/*
 * Campanhas de contacto: tipos, estados de cada pessoa e os textos prontos
 * que o painel propõe (a câmara pode mudar tudo antes de ligar).
 */

export const TIPOS_CAMPANHA = [
  'onda_calor',
  'frio',
  'corte_agua',
  'outro',
] as const;
export type TipoCampanha = (typeof TIPOS_CAMPANHA)[number];

export const ESTADOS_DESTINATARIO = [
  'por_ligar',
  'a_ligar',
  'bem',
  'precisa_ajuda',
  'atendeu',
  'nao_atendeu',
  'sem_ligacao',
  'recusou',
  'cancelado',
] as const;
export type EstadoDestinatario = (typeof ESTADOS_DESTINATARIO)[number];

export const NECESSIDADES = [
  'agua',
  'transporte',
  'medicamentos',
  'companhia',
  'saude',
  'alimentacao',
  'outro',
] as const;

export interface Preset {
  tipo: TipoCampanha;
  titulo: string;
  mensagem: string;
  perguntas: string[];
  sms_recurso: string;
}

export const PRESETS: Preset[] = [
  {
    tipo: 'onda_calor',
    titulo: 'Onda de calor',
    mensagem:
      'Estamos a ligar a todas as pessoas inscritas na câmara por causa do calor destes dias. Queremos saber se está tudo bem consigo.',
    perguntas: [
      'Está tudo bem consigo?',
      'Tem água fresca e consegue manter a casa fresca?',
      'Precisa de alguma coisa, como água, transporte ou medicamentos?',
    ],
    sms_recurso:
      'Camara Municipal: com o calor destes dias, ligamos para saber se esta tudo bem. Beba agua e evite sair entre as 11h e as 17h. Se precisar de ajuda, ligue-nos a qualquer hora. Emergencias: 112.',
  },
  {
    tipo: 'frio',
    titulo: 'Frio intenso',
    mensagem:
      'Estamos a ligar a todas as pessoas inscritas na câmara por causa do frio destes dias. Queremos saber se está tudo bem consigo.',
    perguntas: [
      'Está tudo bem consigo?',
      'Consegue aquecer a casa?',
      'Precisa de alguma coisa, como agasalhos, transporte ou medicamentos?',
    ],
    sms_recurso:
      'Camara Municipal: com o frio destes dias, ligamos para saber se esta tudo bem. Se precisar de ajuda, ligue-nos a qualquer hora. Emergencias: 112.',
  },
  {
    tipo: 'corte_agua',
    titulo: 'Corte de água',
    mensagem:
      'Há um corte de água na sua zona. Estamos a ligar às pessoas inscritas para saber se precisam de água entregue em casa.',
    perguntas: [
      'Tem água em casa para beber e para a higiene?',
      'Precisa que lhe levemos água?',
    ],
    sms_recurso:
      'Camara Municipal: ha um corte de agua na sua zona. Se precisar que lhe levemos agua, ligue-nos. Emergencias: 112.',
  },
  {
    tipo: 'outro',
    titulo: 'Contacto da ação social',
    mensagem:
      'A ação social da câmara está a ligar às pessoas inscritas para saber se está tudo bem.',
    perguntas: ['Está tudo bem consigo?', 'Precisa de alguma coisa?'],
    sms_recurso:
      'Camara Municipal: ligamos para saber se esta tudo bem. Se precisar de alguma coisa, ligue-nos. Emergencias: 112.',
  },
];
