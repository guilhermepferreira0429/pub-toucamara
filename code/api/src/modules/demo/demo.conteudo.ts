/*
 * O conteúdo da câmara de demonstração: pessoas, conversas, processos,
 * ocorrências, licenças, o que se publica no /agora e o regulamento em
 * linguagem simples. Tudo fictício e coerente entre si; as datas são
 * relativas ao dia em que se prepara (dias atrás / dias à frente).
 *
 * Nomes: portugueses e plausíveis, mas fictícios (não são de ninguém
 * conhecido). A requerente do processo do design (Sandra Martins) mantém o
 * nome do design. Telefones na gama de teste +351 910 000 xxx
 * (demo.regras.ts); NIF fictícios válidos no algoritmo.
 */

export type Canal = 'telefone' | 'chat' | 'sms' | 'whatsapp';
export type Resultado =
  'resolvida' | 'passada_funcionario' | 'sem_resposta' | 'marcacao';

export interface PessoaDemo {
  chave: string;
  nome: string;
  /** Índice na gama de teste (telefoneDemo). */
  telefone: number;
  /** Índice do NIF fictício (nifDemo), quando a pessoa o deu. */
  nif?: number;
}

export const PESSOAS: PessoaDemo[] = [
  { chave: 'sandra', nome: 'Sandra Martins', telefone: 101, nif: 1 },
  { chave: 'maria', nome: 'Maria Fernandes', telefone: 102, nif: 2 },
  { chave: 'jose', nome: 'José Oliveira', telefone: 103 },
  { chave: 'ana', nome: 'Ana Ribeiro', telefone: 104 },
  { chave: 'rui', nome: 'Rui Carvalho', telefone: 105 },
  { chave: 'manuel', nome: 'Manuel Pereira', telefone: 106, nif: 6 },
  { chave: 'teresa', nome: 'Teresa Lopes', telefone: 107, nif: 7 },
  { chave: 'carlos', nome: 'Carlos Mendes', telefone: 108, nif: 8 },
  { chave: 'helena', nome: 'Helena Sousa', telefone: 109, nif: 9 },
  { chave: 'pedro', nome: 'Pedro Antunes', telefone: 110, nif: 10 },
  { chave: 'luisa', nome: 'Luísa Gomes', telefone: 111 },
  { chave: 'antonio', nome: 'António Faria', telefone: 112 },
  { chave: 'ines', nome: 'Inês Machado', telefone: 113 },
  { chave: 'fernando', nome: 'Fernando Pinto', telefone: 114 },
  { chave: 'graca', nome: 'Graça Teixeira', telefone: 115 },
  { chave: 'joao', nome: 'João Freitas', telefone: 116 },
  { chave: 'rosa', nome: 'Rosa Magalhães', telefone: 117 },
  { chave: 'paulo', nome: 'Paulo Nogueira', telefone: 118 },
  { chave: 'marta', nome: 'Marta Rocha', telefone: 119 },
  { chave: 'jorge', nome: 'Jorge Abreu', telefone: 120 },
];

/**
 * Marcações do balcão para o dia de hoje (as que já passaram ficam
 * "realizada" ou "faltou"; as que faltam, "marcada"). A hora é a pedida: a
 * marcação fica na primeira vaga a partir dela.
 */
export const MARCACOES_HOJE: {
  chave: string;
  pessoa: string;
  hora: string;
  assunto: string;
}[] = [
  {
    chave: 'hoje_1',
    pessoa: 'rosa',
    hora: '09:30',
    assunto: 'Entregar documentos do processo de obras',
  },
  {
    chave: 'hoje_2',
    pessoa: 'jorge',
    hora: '11:00',
    assunto: 'Cartão municipal do idoso (para a mãe)',
  },
  {
    chave: 'hoje_3',
    pessoa: 'paulo',
    hora: '14:30',
    assunto: 'Dúvidas sobre o dístico de residente',
  },
  {
    chave: 'hoje_4',
    pessoa: 'graca',
    hora: '15:30',
    assunto: 'Tarifa social da água',
  },
];

/** Quem recebeu cada aviso por zona (moradas dos processos e ocorrências). */
export const DESTINATARIOS_AVISOS: Record<string, string[]> = {
  obras: ['jose', 'ana', 'rui', 'teresa', 'luisa', 'marta'],
  agua: ['joao', 'paulo', 'rosa', 'graca', 'fernando'],
};

/** Temas do painel ("o que mais perguntam"); criam-se se a câmara não os tiver. */
export const TEMAS = {
  obras: 'Obras e licenciamento',
  agua: 'Água e saneamento',
  ruido: 'Ruído e licenças de festas',
  vias: 'Vias e passeios',
  residuos: 'Resíduos e limpeza',
  balcao: 'Atendimento e marcações',
  social: 'Ação social e apoios',
  comercio: 'Comércio e esplanadas',
  iluminacao: 'Iluminação pública',
  eventos: 'Eventos e cultura',
  desporto: 'Desporto e piscinas',
} as const;
export type Tema = keyof typeof TEMAS;

export interface Turno {
  papel: 'municipe' | 'agente';
  texto: string;
}

export interface ConversaDemo {
  chave: string;
  pessoa: string;
  canal: Canal;
  /** Há quantos dias (0 = hoje). */
  dias: number;
  /** Hora local 'HH:MM' (hoje, se ainda não chegou, fica "há meia hora"). */
  hora: string;
  tema: Tema;
  resultado: Resultado;
  resumo: string;
  proximos?: string[];
  turnos: Turno[];
}

// Conversas que dão origem a outros objetos (processos, licenças, ocorrências,
// passagens, marcações, a reclamação): as chaves usam-se no serviço.
const ESPECIAIS: ConversaDemo[] = [
  {
    chave: 'porta_cozinha',
    pessoa: 'sandra',
    canal: 'telefone',
    dias: 16,
    hora: '21:40',
    tema: 'obras',
    resultado: 'resolvida',
    resumo:
      'Quer abrir uma porta entre a cozinha e a sala, numa parede interior. Precisa de comunicação prévia com termo de responsabilidade de um técnico. Recebeu por SMS os documentos a juntar.',
    proximos: [
      'Peça a um técnico o projeto e o termo de responsabilidade',
      'Entregue a comunicação prévia com os documentos',
    ],
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Boa noite. Quero abrir uma porta entre a cozinha e a sala. Preciso de licença?',
      },
      {
        papel: 'agente',
        texto:
          'Boa noite. Se a parede for interior e não mexer na fachada, não precisa de licença, mas precisa de uma comunicação prévia à câmara, com o termo de responsabilidade de um técnico. A parede é de suporte?',
      },
      { papel: 'municipe', texto: 'O arquiteto diz que não é estrutural.' },
      {
        papel: 'agente',
        texto:
          'Então chega a comunicação prévia. Vou enviar-lhe por SMS a lista de documentos e o link para entregar. A regra está no Regime Jurídico da Urbanização e Edificação, artigo 4.º.',
      },
    ],
  },
  {
    chave: 'festa_maria',
    pessoa: 'maria',
    canal: 'telefone',
    dias: 2,
    hora: '19:05',
    tema: 'ruido',
    resultado: 'resolvida',
    resumo:
      'Pediu a licença especial de ruído para a festa de anos no quintal (sábado, das 20h à 1h, 40 pessoas, com música). Cumpre as regras: pagou por MB WAY de teste e recebeu a licença com código QR.',
    proximos: ['Guarde a licença (PDF com QR) para mostrar se for preciso'],
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Olá, vou fazer uma festa de anos no quintal e quero ter música. Preciso de alguma licença?',
      },
      {
        papel: 'agente',
        texto:
          'Precisa de uma licença especial de ruído. Posso tratar já. Que dia é, a que horas começa e acaba, e quantas pessoas?',
      },
      {
        papel: 'municipe',
        texto:
          'É no sábado, das oito da noite à uma da manhã, umas quarenta pessoas, com colunas.',
      },
      {
        papel: 'agente',
        texto:
          'Verifiquei as regras e o seu pedido cumpre todas. A taxa é de 25 euros; enviei um pedido MB WAY para este número. Assim que estiver paga, a licença segue por SMS, com um código QR.',
      },
    ],
  },
  {
    chave: 'festa_teresa',
    pessoa: 'teresa',
    canal: 'telefone',
    dias: 1,
    hora: '12:20',
    tema: 'ruido',
    resultado: 'resolvida',
    resumo:
      'Pediu licença de ruído para um jantar com música numa terça-feira até à 1h. Fora das regras (em dia de semana o limite é a meia-noite): ficou para um técnico decidir e vai receber a resposta por SMS.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Queria licença para um jantar de aniversário com música, numa terça, até à uma da manhã.',
      },
      {
        papel: 'agente',
        texto:
          'O pedido ficou registado, mas não cabe nas regras automáticas: num dia de semana o limite é a meia-noite. Vai ser visto por um técnico e recebe a resposta por SMS.',
      },
    ],
  },
  {
    chave: 'buraco_1',
    pessoa: 'jose',
    canal: 'telefone',
    dias: 3,
    hora: '08:50',
    tema: 'vias',
    resultado: 'resolvida',
    resumo:
      'Reportou um buraco grande na Rua de Santo António, junto ao n.º 40. Ficou registada a ocorrência e recebeu por SMS o link para juntar fotografia.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Há um buraco enorme na Rua de Santo António, à frente do número 40. Já vi um carro a bater.',
      },
      {
        papel: 'agente',
        texto:
          'Obrigado por avisar. Fica registado e vai receber um SMS com um link para juntar uma fotografia, se puder.',
      },
    ],
  },
  {
    chave: 'buraco_2',
    pessoa: 'ana',
    canal: 'chat',
    dias: 2,
    hora: '13:15',
    tema: 'vias',
    resultado: 'resolvida',
    resumo:
      'Avisou do mesmo buraco na Rua de Santo António. Já estava reportado: juntámos o aviso dela e vai ser avisada quando estiver resolvido.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Boa tarde, na Rua de Santo António há um buraco no meio da estrada, perto do 40.',
      },
      {
        papel: 'agente',
        texto:
          'Esse problema já está reportado. Juntámos o seu aviso e vai ser avisada quando estiver resolvido. Obrigado!',
      },
    ],
  },
  {
    chave: 'buraco_3',
    pessoa: 'rui',
    canal: 'whatsapp',
    dias: 0,
    hora: '09:10',
    tema: 'vias',
    resultado: 'resolvida',
    resumo:
      'Terceiro aviso do buraco na Rua de Santo António. Já sabíamos: o aviso dele ficou junto ao original.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Bom dia, quem trata dos buracos? Rua de Santo António, número 40, está perigoso.',
      },
      {
        papel: 'agente',
        texto:
          'Bom dia. Já sabemos desse buraco: é o terceiro aviso e está com a equipa das vias. Juntámos o seu e vai receber um SMS quando estiver resolvido.',
      },
    ],
  },
  {
    chave: 'candeeiro',
    pessoa: 'fernando',
    canal: 'telefone',
    dias: 4,
    hora: '22:30',
    tema: 'iluminacao',
    resultado: 'resolvida',
    resumo:
      'Candeeiro apagado no Largo do Toural, do lado da Rua Paio Galvão. Ocorrência registada; a equipa já tem data para a reparação.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Está um candeeiro apagado no Toural há três noites, do lado da Paio Galvão.',
      },
      {
        papel: 'agente',
        texto:
          'Fica registado. A equipa da iluminação vai ver e recebe um SMS quando estiver resolvido.',
      },
    ],
  },
  {
    chave: 'contentor',
    pessoa: 'graca',
    canal: 'sms',
    dias: 6,
    hora: '10:45',
    tema: 'residuos',
    resultado: 'resolvida',
    resumo:
      'Contentor do lixo partido na Rua D. João I. Ocorrência registada e já resolvida (contentor trocado); foi avisada por SMS.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'Contentor do lixo partido na Rua D. João I, a tampa caiu.',
      },
      {
        papel: 'agente',
        texto:
          'Obrigado. Registámos a ocorrência e avisamos por SMS quando for trocado.',
      },
    ],
  },
  {
    chave: 'esplanada',
    pessoa: 'manuel',
    canal: 'chat',
    dias: 27,
    hora: '15:30',
    tema: 'comercio',
    resultado: 'resolvida',
    resumo:
      'Pediu a licença da esplanada do Café Pereira (10 m², 4 mesas). Cumpre as regras; pagou e recebeu a licença.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Quero pôr uma esplanada à porta do café, 4 mesas, uns 10 metros quadrados.',
      },
      {
        papel: 'agente',
        texto:
          'Cumpre as regras. A taxa é calculada por metro quadrado e por mês; depois de pagar, a licença segue por SMS.',
      },
    ],
  },
  {
    chave: 'passagem_marquise',
    pessoa: 'pedro',
    canal: 'telefone',
    dias: 0,
    hora: '10:20',
    tema: 'obras',
    resultado: 'passada_funcionario',
    resumo:
      'Recebeu a decisão da marquise e não percebe o valor da taxa (64,70 €). Quer falar com alguém sobre a guia de pagamento.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Recebi a carta da marquise a dizer que foi admitida, mas não percebo a taxa de 64 euros e 70. Pode explicar?',
      },
      {
        papel: 'agente',
        texto:
          'A taxa vem da tabela de taxas do município, mas não tenho aqui o detalhe da guia. Vou passar a um funcionário, que lhe responde por SMS ainda hoje.',
      },
      { papel: 'municipe', texto: 'Está bem, obrigado.' },
    ],
  },
  {
    chave: 'passagem_muro',
    pessoa: 'helena',
    canal: 'chat',
    dias: 0,
    hora: '11:05',
    tema: 'obras',
    resultado: 'passada_funcionario',
    resumo:
      'Tem um processo de comunicação prévia para um muro de vedação e quer saber se pode começar antes da decisão. Pediu para falar com um técnico.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Entreguei o pedido do muro de vedação. Posso começar a obra antes de me responderem?',
      },
      {
        papel: 'agente',
        texto:
          'Numa comunicação prévia só pode começar depois de a câmara admitir ou de passar o prazo sem resposta. Para o seu caso concreto, passo a um técnico.',
      },
      { papel: 'municipe', texto: 'Sim, prefiro falar com alguém.' },
    ],
  },
  {
    chave: 'reclamacao',
    pessoa: 'luisa',
    canal: 'telefone',
    dias: 3,
    hora: '16:40',
    tema: 'balcao',
    resultado: 'resolvida',
    resumo:
      'Fez uma reclamação formal: esperou mais de uma hora no Balcão Único sem senha nem informação. Ficou registada no livro de reclamações; a resposta segue por SMS dentro do prazo.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Quero fazer uma reclamação. Estive mais de uma hora no balcão e ninguém me disse nada.',
      },
      {
        papel: 'agente',
        texto:
          'Lamento. Vou registar a reclamação formal com as suas palavras e a resposta segue por SMS dentro do prazo legal.',
      },
    ],
  },
  {
    chave: 'marcacao_1',
    pessoa: 'antonio',
    canal: 'telefone',
    dias: 1,
    hora: '09:35',
    tema: 'balcao',
    resultado: 'marcacao',
    resumo:
      'Marcou atendimento presencial no Balcão Único para entregar documentos do licenciamento. Recebeu a confirmação por SMS.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Queria marcar uma hora no balcão para entregar uns papéis da obra.',
      },
      {
        papel: 'agente',
        texto:
          'Tenho vagas no Balcão Único. Ficou marcado; enviei a confirmação por SMS, com o link para remarcar.',
      },
    ],
  },
  {
    chave: 'marcacao_2',
    pessoa: 'ines',
    canal: 'chat',
    dias: 0,
    hora: '08:40',
    tema: 'balcao',
    resultado: 'marcacao',
    resumo:
      'Marcou atendimento no Balcão Único para tratar de uma licença. Confirmação enviada por SMS.',
    turnos: [
      { papel: 'municipe', texto: 'Posso marcar atendimento para amanhã?' },
      {
        papel: 'agente',
        texto: 'Pode. Ficou marcado e recebe a confirmação por SMS.',
      },
    ],
  },
  {
    chave: 'falta_agua',
    pessoa: 'joao',
    canal: 'telefone',
    dias: 1,
    hora: '07:55',
    tema: 'agua',
    resultado: 'resolvida',
    resumo:
      'Sem água em casa desde manhã. Encaminhado para a Vimágua, que gere a água no concelho, com os contactos enviados por SMS.',
    proximos: ['Contacte a Vimágua (contactos no SMS)'],
    turnos: [
      {
        papel: 'municipe',
        texto: 'Estou sem água em casa desde manhã. A quem ligo?',
      },
      {
        papel: 'agente',
        texto:
          'Quem trata da água no concelho é a Vimágua, não a câmara. Enviei-lhe por SMS onde encontrar os contactos da Vimágua.',
      },
    ],
  },
];

/** Conversas do dia a dia, para os gráficos e os temas terem cara de verdade. */
interface Modelo {
  tema: Tema;
  resultado: Resultado;
  resumo: string;
  turnos: Turno[];
}

const MODELOS: Record<string, Modelo> = {
  cozinha: {
    tema: 'obras',
    resultado: 'resolvida',
    resumo:
      'Quer remodelar a cozinha sem mexer em paredes. Obra isenta de controlo prévio: não precisa de licença nem de comunicação.',
    turnos: [
      {
        papel: 'municipe',
        texto:
          'Vou remodelar a cozinha, trocar os móveis e o chão. Preciso de licença?',
      },
      {
        papel: 'agente',
        texto:
          'Não. Obras no interior que não mexem na estrutura nem na fachada estão isentas. Fonte: Regime Jurídico da Urbanização e Edificação, artigo 6.º.',
      },
    ],
  },
  agua: {
    tema: 'agua',
    resultado: 'resolvida',
    resumo:
      'Fuga de água na rua. Encaminhado para a Vimágua, com os contactos por SMS.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'Está a sair água de uma tampa na rua há horas.',
      },
      {
        papel: 'agente',
        texto: 'Isso é com a Vimágua. Enviei-lhe os contactos por SMS.',
      },
    ],
  },
  monos: {
    tema: 'residuos',
    resultado: 'resolvida',
    resumo:
      'Quer deitar fora um sofá. Explicado como marcar a recolha de monos, gratuita.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'Como faço para deitarem fora um sofá velho?',
      },
      {
        papel: 'agente',
        texto:
          'A recolha de monos é gratuita e marca-se por telefone. Deixe o sofá à porta na véspera do dia marcado.',
      },
    ],
  },
  horario: {
    tema: 'balcao',
    resultado: 'resolvida',
    resumo: 'Perguntou o horário do Balcão Único e se precisa de marcação.',
    turnos: [
      { papel: 'municipe', texto: 'A que horas abre o balcão da câmara?' },
      {
        papel: 'agente',
        texto:
          'O Balcão Único atende nos dias úteis. Pode ir sem marcação, mas com marcação não espera.',
      },
    ],
  },
  tarifa_social: {
    tema: 'social',
    resultado: 'resolvida',
    resumo:
      'Perguntou pela tarifa social da água. Explicado quem tem direito e que é automática para quem recebe certas prestações.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'Tenho direito a pagar menos de água? Sou reformada.',
      },
      {
        papel: 'agente',
        texto:
          'Pode ter direito à tarifa social. Para quem recebe certas prestações é atribuída automaticamente; enviei por SMS os passos para confirmar.',
      },
    ],
  },
  estado_processo: {
    tema: 'obras',
    resultado: 'resolvida',
    resumo:
      'Quis saber em que ponto está o seu processo. Disse a fase e o prazo de resposta.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'Em que ponto está o meu processo de obras?',
      },
      {
        papel: 'agente',
        texto:
          'Está em apreciação pelo técnico. O prazo de resposta termina daqui a seis dias úteis.',
      },
    ],
  },
  vizinhos: {
    tema: 'ruido',
    resultado: 'resolvida',
    resumo:
      'Queixa de barulho de vizinhos à noite. Explicado que, fora de horas, é a PSP que atua.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'Os vizinhos fazem barulho todas as noites. Quem resolve?',
      },
      {
        papel: 'agente',
        texto:
          'Depois das 23h, quem pode atuar logo é a PSP. Se for uma atividade com licença, a câmara fiscaliza; enviei-lhe os contactos.',
      },
    ],
  },
  esplanada_pergunta: {
    tema: 'comercio',
    resultado: 'resolvida',
    resumo:
      'Perguntou como pedir uma esplanada. Explicadas as regras e que pode pedir pelo telefone.',
    turnos: [
      { papel: 'municipe', texto: 'Quanto custa ter uma esplanada?' },
      {
        papel: 'agente',
        texto:
          'Paga uma taxa por metro quadrado e por mês. Se quiser, trato já do pedido consigo.',
      },
    ],
  },
  piscina: {
    tema: 'desporto',
    resultado: 'sem_resposta',
    resumo:
      'Perguntou quando reabre uma piscina municipal. Sem fonte para responder: ficou nas perguntas sem resposta.',
    turnos: [
      { papel: 'municipe', texto: 'Quando é que reabre a piscina municipal?' },
      {
        papel: 'agente',
        texto:
          'Não tenho essa informação confirmada. Registei a pergunta e a câmara vai acrescentá-la.',
      },
    ],
  },
  funcionario: {
    tema: 'obras',
    resultado: 'passada_funcionario',
    resumo:
      'Pediu para falar com um técnico sobre um pedido antigo. Passado a um funcionário, que já respondeu.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'Quero falar com o técnico que tem o meu processo.',
      },
      {
        papel: 'agente',
        texto: 'Passo a um funcionário, que lhe responde por SMS.',
      },
    ],
  },
  fim_de_semana: {
    tema: 'eventos',
    resultado: 'resolvida',
    resumo:
      'Perguntou o que há na cidade no fim de semana. Disse os eventos publicados.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'O que há para fazer em Guimarães este fim de semana?',
      },
      {
        papel: 'agente',
        texto:
          'Há uma feira de artesanato no centro e um concerto ao fim da tarde. Enviei os detalhes por SMS.',
      },
    ],
  },
  distico: {
    tema: 'vias',
    resultado: 'resolvida',
    resumo:
      'Perguntou pelo dístico de residente para estacionar na rua onde mora.',
    turnos: [
      { papel: 'municipe', texto: 'Como peço o dístico de residente?' },
      {
        papel: 'agente',
        texto:
          'Pode pedir já comigo; precisa de morar na zona e de ter o carro em seu nome.',
      },
    ],
  },
  cartao_idoso: {
    tema: 'social',
    resultado: 'resolvida',
    resumo: 'Perguntou como pedir o cartão municipal do idoso para a mãe.',
    turnos: [
      {
        papel: 'municipe',
        texto: 'A minha mãe tem 70 anos. Há algum cartão com descontos?',
      },
      {
        papel: 'agente',
        texto:
          'Há o cartão municipal do idoso. Enviei por SMS os documentos e onde pedir.',
      },
    ],
  },
};

/** [modelo, pessoa, canal, dias atrás, hora]: mais na última semana. */
const AGENDA_GERAL: [string, string, Canal, number, string][] = [
  ['cozinha', 'rosa', 'telefone', 0, '09:45'],
  ['horario', 'paulo', 'chat', 0, '08:15'],
  ['agua', 'marta', 'telefone', 0, '07:30'],
  ['monos', 'jorge', 'telefone', 1, '10:10'],
  ['esplanada_pergunta', 'manuel', 'chat', 1, '15:20'],
  ['vizinhos', 'rosa', 'whatsapp', 1, '23:10'],
  ['tarifa_social', 'graca', 'telefone', 2, '11:30'],
  ['estado_processo', 'carlos', 'telefone', 2, '14:05'],
  ['fim_de_semana', 'marta', 'chat', 2, '20:15'],
  ['cozinha', 'jorge', 'telefone', 3, '18:45'],
  ['distico', 'paulo', 'sms', 3, '12:00'],
  ['funcionario', 'helena', 'telefone', 4, '10:30'],
  ['piscina', 'joao', 'chat', 4, '21:05'],
  ['horario', 'ines', 'telefone', 5, '09:20'],
  ['cartao_idoso', 'rosa', 'telefone', 5, '11:50'],
  ['agua', 'paulo', 'whatsapp', 6, '08:05'],
  ['monos', 'graca', 'telefone', 6, '16:30'],
  ['cozinha', 'marta', 'chat', 7, '22:40'],
  ['estado_processo', 'pedro', 'telefone', 8, '10:00'],
  ['vizinhos', 'jorge', 'telefone', 9, '23:30'],
  ['tarifa_social', 'joao', 'telefone', 10, '15:10'],
  ['funcionario', 'carlos', 'chat', 11, '09:55'],
  ['distico', 'ines', 'telefone', 12, '17:20'],
  ['esplanada_pergunta', 'paulo', 'telefone', 13, '11:15'],
  ['piscina', 'marta', 'telefone', 14, '19:40'],
  ['cozinha', 'antonio', 'telefone', 16, '10:40'],
  ['agua', 'rosa', 'sms', 18, '08:30'],
  ['horario', 'jorge', 'chat', 20, '14:25'],
  ['cartao_idoso', 'graca', 'telefone', 22, '10:05'],
  ['fim_de_semana', 'joao', 'whatsapp', 25, '18:50'],
];

export const CONVERSAS: ConversaDemo[] = [
  ...ESPECIAIS,
  ...AGENDA_GERAL.map(([modelo, pessoa, canal, dias, hora], i) => {
    const m = MODELOS[modelo];
    return {
      chave: `geral_${String(i + 1).padStart(2, '0')}`,
      pessoa,
      canal,
      dias,
      hora,
      tema: m.tema,
      resultado: m.resultado,
      resumo: m.resumo,
      turnos: m.turnos,
    };
  }),
];

// ---------------------------------------------------------------------------
// Processos
// ---------------------------------------------------------------------------

export interface ProcessoDemo {
  chave: string;
  pessoa: string;
  conversa?: string;
  assunto: string;
  morada: string;
  freguesia: string;
  /** Número preferido (o do design); se já estiver usado, segue a série. */
  numero?: number;
  fase: 'documentos' | 'apreciacao' | 'notificado';
  /** Há quantos dias deu entrada. */
  entrou_ha_dias: number;
  /** Documentos exigidos entregues: 'todos' ou só os primeiros n. */
  entregues: 'todos' | number;
  /** Prazo a acabar daqui a n dias úteis (só em apreciação). */
  prazo_em_dias_uteis?: number;
  decidido_ha_dias?: number;
  /** Taxa por pagar depois da decisão, em cêntimos. */
  taxa_cent?: number;
}

export const PROCESSO_PORTA: ProcessoDemo = {
  chave: 'porta_cozinha',
  pessoa: 'sandra',
  conversa: 'porta_cozinha',
  assunto: 'Porta na cozinha',
  morada: 'Rua de Camões, 85',
  freguesia: 'Creixomil',
  numero: 412,
  fase: 'apreciacao',
  entrou_ha_dias: 12,
  entregues: 'todos',
  prazo_em_dias_uteis: 8,
};

export const PROCESSOS: ProcessoDemo[] = [
  {
    chave: 'anexo',
    pessoa: 'carlos',
    assunto: 'Anexo no quintal para arrumos',
    morada: 'Rua Francisco Agra, 51',
    freguesia: 'Azurém',
    fase: 'documentos',
    entrou_ha_dias: 6,
    entregues: 1,
  },
  {
    chave: 'muro',
    pessoa: 'helena',
    assunto: 'Muro de vedação do terreno',
    morada: 'Rua Gil Vicente, 120',
    freguesia: 'Oliveira, São Paio e São Sebastião',
    fase: 'apreciacao',
    entrou_ha_dias: 26,
    entregues: 'todos',
    prazo_em_dias_uteis: 2,
  },
  {
    chave: 'marquise',
    pessoa: 'pedro',
    assunto: 'Fecho de varanda com marquise',
    morada: 'Avenida D. Afonso Henriques, 210',
    freguesia: 'Oliveira, São Paio e São Sebastião',
    fase: 'notificado',
    entrou_ha_dias: 30,
    entregues: 'todos',
    decidido_ha_dias: 4,
    taxa_cent: 6470,
  },
];

// ---------------------------------------------------------------------------
// Ocorrências (coordenadas de ruas do centro de Guimarães)
// ---------------------------------------------------------------------------

export const PONTOS = {
  santo_antonio: {
    lat: 41.44283,
    lng: -8.29372,
    morada: 'Rua de Santo António, 40, Guimarães',
  },
  toural: {
    lat: 41.44162,
    lng: -8.29598,
    morada: 'Largo do Toural, junto à Rua Paio Galvão, Guimarães',
  },
  joao_i: {
    lat: 41.44458,
    lng: -8.29801,
    morada: 'Rua D. João I, 77, Guimarães',
  },
  oliveira: {
    lat: 41.44319,
    lng: -8.29236,
    morada: 'Largo da Oliveira, Guimarães',
  },
  sao_damaso: {
    lat: 41.44212,
    lng: -8.29133,
    morada: 'Alameda de São Dâmaso, Guimarães',
  },
  conde_margaride: {
    lat: 41.44528,
    lng: -8.29944,
    morada: 'Avenida Conde Margaride, 20, Guimarães',
  },
} as const;

// ---------------------------------------------------------------------------
// Regulamento em linguagem simples (texto de demonstração)
// ---------------------------------------------------------------------------

export const REGULAMENTO = {
  titulo: 'Regulamento das esplanadas abertas (texto de demonstração)',
  url: 'https://www.cm-guimaraes.pt/#regulamento-esplanadas',
  texto: [
    'Regulamento das esplanadas abertas (texto de demonstração, não é o regulamento em vigor)',
    'Artigo 1.º Objeto',
    'O presente regulamento estabelece as regras de instalação de esplanadas abertas na via pública, junto a estabelecimentos de restauração e bebidas, nos termos do Decreto-Lei n.º 48/2011 (Licenciamento Zero). Os valores indicados são valores de demonstração.',
    'Artigo 2.º Mera comunicação prévia',
    '1 - A instalação de esplanada aberta está sujeita a mera comunicação prévia, apresentada com a antecedência mínima de cinco dias úteis.',
    '2 - A comunicação indica a área a ocupar, o número de mesas e o período pretendido, até doze meses.',
    'Artigo 3.º Condições de instalação',
    '1 - A esplanada não pode ocupar mais de 30 m² nem ter mais de 10 mesas.',
    '2 - Deve ficar livre um corredor de passeio com, pelo menos, 1,5 metros de largura para a circulação de peões.',
    '3 - A esplanada encerra até às 23 horas.',
    '4 - A instalação de estrados, toldos fixos ou esplanadas no centro histórico depende de apreciação técnica.',
    'Artigo 4.º Taxas',
    'A ocupação está sujeita ao pagamento de uma taxa de 3 euros por metro quadrado e por mês, com o valor mínimo de 20 euros.',
    'Artigo 5.º Fiscalização',
    'A fiscalização compete aos serviços municipais, que podem mandar retirar a esplanada que não cumpra as condições do artigo 3.º.',
  ].join('\n'),
  simples: {
    titulo: 'Esplanadas: o que precisa de saber',
    resumo:
      'Para pôr uma esplanada à porta do seu café ou restaurante basta avisar a câmara com 5 dias úteis de antecedência e pagar a taxa. Valores de demonstração.',
    partes: [
      {
        chave: 'o_que_e',
        titulo: 'Do que trata',
        texto:
          'Diz como pode pôr mesas e cadeiras na rua, à porta do seu café ou restaurante.',
        artigos: [1],
      },
      {
        chave: 'o_que_tem_de_fazer',
        titulo: 'O que tem de fazer',
        texto:
          'Avise a câmara pelo menos 5 dias úteis antes. Diga quantos metros quer ocupar, quantas mesas e por quantos meses (até 12). Pode fazê-lo por telefone, com o agente.',
        artigos: [2],
      },
      {
        chave: 'a_quem_se_aplica',
        titulo: 'As regras da esplanada',
        texto:
          'No máximo 30 m² e 10 mesas. Deixe pelo menos 1,5 metros de passeio livre para as pessoas passarem. Feche até às 23h. Com estrado, toldo fixo ou no centro histórico, um técnico tem de ver primeiro.',
        artigos: [3],
      },
      {
        chave: 'quanto_custa',
        titulo: 'Quanto custa',
        texto:
          'Paga 3 euros por metro quadrado, por mês. O mínimo são 20 euros. Exemplo: 10 m² durante 1 mês custam 30 euros.',
        artigos: [4],
      },
      {
        chave: 'outro',
        titulo: 'Se não cumprir',
        texto:
          'A câmara pode mandar retirar a esplanada que não cumpra estas regras.',
        artigos: [5],
      },
    ],
  },
} as const;

/**
 * Preparações antigas: os nomes de teste ("Fulano", "Sicrano", "Beltrano")
 * e os textos que não diziam quem gere a água. Os acertos trocam-nos onde
 * ficaram gravados (DemoAcertosService).
 */
export const NOMES_ANTIGOS: readonly (readonly [string, string])[] = [
  ['Café Sicrano, Lda', 'Café Pereira, Lda'],
  ['Café Sicrano', 'Café Pereira'],
  ['Maria Fulana', 'Maria Fernandes'],
  ['José Sicrano', 'José Oliveira'],
  ['Ana Beltrana', 'Ana Ribeiro'],
  ['Rui Fulano', 'Rui Carvalho'],
  ['Manuel Sicrano', 'Manuel Pereira'],
  ['Teresa Beltrana', 'Teresa Lopes'],
  ['Carlos Fulano', 'Carlos Mendes'],
  ['Helena Sicrana', 'Helena Sousa'],
  ['Pedro Beltrano', 'Pedro Antunes'],
  ['Luísa Fulana', 'Luísa Gomes'],
  ['António Sicrano', 'António Faria'],
  ['Inês Beltrana', 'Inês Machado'],
  ['Fernando Fulano', 'Fernando Pinto'],
  ['Graça Sicrana', 'Graça Teixeira'],
  ['João Beltrano', 'João Freitas'],
  ['Rosa Fulana', 'Rosa Magalhães'],
  ['Paulo Sicrano', 'Paulo Nogueira'],
  ['Marta Beltrana', 'Marta Rocha'],
  ['Jorge Fulano', 'Jorge Abreu'],
  ['Rafael Fulano', 'Rafael Fernandes'],
  ['Beatriz Sicrano', 'Beatriz Lopes'],
  ['Gonçalo Beltrano', 'Gonçalo Mendes'],
  ['Leonor Fulano', 'Leonor Sousa'],
];
export const TEXTOS_ANTIGOS: readonly (readonly [string, string])[] = [
  [
    'Encaminhado para a empresa que gere a água no concelho, com o contacto de avarias 24 horas, enviado por SMS.',
    'Encaminhado para a Vimágua, que gere a água no concelho, com os contactos enviados por SMS.',
  ],
  [
    'Quem trata da água no concelho é a empresa municipal das águas, não a câmara. Enviei-lhe por SMS o contacto de avarias, que atende 24 horas.',
    'Quem trata da água no concelho é a Vimágua, não a câmara. Enviei-lhe por SMS onde encontrar os contactos da Vimágua.',
  ],
  [
    'Encaminhado para a empresa municipal das águas, com o contacto de avarias por SMS.',
    'Encaminhado para a Vimágua, com os contactos por SMS.',
  ],
  [
    'Isso é com a empresa das águas. Enviei-lhe o contacto de avarias, 24 horas, por SMS.',
    'Isso é com a Vimágua. Enviei-lhe os contactos por SMS.',
  ],
  [
    'Ligue para a linha de avarias da água (contacto no SMS)',
    'Contacte a Vimágua (contactos no SMS)',
  ],
  ['a empresa das águas', 'a Vimágua'],
  ['à empresa das águas', 'à Vimágua'],
];
