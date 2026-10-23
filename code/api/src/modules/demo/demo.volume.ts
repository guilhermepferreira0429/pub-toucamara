import type { Canal, PessoaDemo, ProcessoDemo } from './demo.conteudo.js';

/*
 * Volume para a demonstração: mais pessoas, conversas ao longo dos últimos
 * 30 dias, processos, ocorrências espalhadas pelas freguesias e a ação
 * social (pessoas inscritas e uma campanha de onda de calor). Tudo
 * fictício e determinístico (a mesma lista sempre), com telefones da gama
 * de teste. Nada aqui toca nas fontes, nas respostas nem nas avaliações.
 */

export const MAIS_PESSOAS: PessoaDemo[] = [
  { chave: 'alice', nome: 'Alice Coelho', telefone: 121, nif: 21 },
  { chave: 'bruno', nome: 'Bruno Matos', telefone: 122, nif: 22 },
  { chave: 'catarina', nome: 'Catarina Leite', telefone: 123, nif: 23 },
  { chave: 'eduarda', nome: 'Eduarda Pires', telefone: 124, nif: 24 },
  { chave: 'filipe', nome: 'Filipe Castro', telefone: 125, nif: 25 },
  { chave: 'gloria', nome: 'Glória Barbosa', telefone: 126, nif: 26 },
  { chave: 'hugo', nome: 'Hugo Sampaio', telefone: 127, nif: 27 },
  { chave: 'irene', nome: 'Irene Moura', telefone: 128, nif: 28 },
  { chave: 'joaquim', nome: 'Joaquim Dias', telefone: 129, nif: 29 },
  { chave: 'laura', nome: 'Laura Cunha', telefone: 130, nif: 30 },
  { chave: 'miguel', nome: 'Miguel Peixoto', telefone: 131 },
  { chave: 'natalia', nome: 'Natália Ferraz', telefone: 132 },
  { chave: 'orlando', nome: 'Orlando Bastos', telefone: 133 },
  { chave: 'patricia', nome: 'Patrícia Guedes', telefone: 134 },
  { chave: 'sergio', nome: 'Sérgio Lemos', telefone: 135 },
  { chave: 'tania', nome: 'Tânia Correia', telefone: 136 },
  { chave: 'vasco', nome: 'Vasco Leal', telefone: 137 },
  { chave: 'beatriz', nome: 'Beatriz Mota', telefone: 138 },
  { chave: 'armando', nome: 'Armando Salgado', telefone: 139 },
  { chave: 'conceicao', nome: 'Conceição Araújo', telefone: 140 },
  { chave: 'domingos', nome: 'Domingos Silva', telefone: 141 },
  { chave: 'elisa', nome: 'Elisa Marques', telefone: 142 },
  { chave: 'francisco', nome: 'Francisco Brandão', telefone: 143 },
  { chave: 'gabriela', nome: 'Gabriela Lima', telefone: 144 },
  { chave: 'henrique', nome: 'Henrique Morais', telefone: 145 },
  { chave: 'isabel', nome: 'Isabel Fonseca', telefone: 146 },
  { chave: 'luis', nome: 'Luís Vaz', telefone: 147 },
  { chave: 'margarida', nome: 'Margarida Sá', telefone: 148 },
  { chave: 'nuno', nome: 'Nuno Ramos', telefone: 149 },
  { chave: 'olga', nome: 'Olga Pacheco', telefone: 150 },
];

/**
 * Mais conversas, para o painel ter volume: entre 2 e 6 por dia nos últimos
 * 30 dias, pelos modelos de conversa que já existem. Mesmo formato da agenda
 * geral: [modelo, pessoa, canal, dias atrás, hora].
 */
export function agendaMais(): [string, string, Canal, number, string][] {
  // Sem a piscina: as perguntas sem resposta ficam como no conhecimento de
  // demonstração.
  const modelos = [
    'horario',
    'cozinha',
    'agua',
    'monos',
    'tarifa_social',
    'estado_processo',
    'distico',
    'cartao_idoso',
    'fim_de_semana',
    'vizinhos',
    'esplanada_pergunta',
    'funcionario',
  ];
  const pessoas = [
    ...MAIS_PESSOAS.map((p) => p.chave),
    'rosa',
    'paulo',
    'marta',
    'jorge',
    'graca',
    'joao',
    'ines',
    'antonio',
    'luisa',
    'fernando',
  ];
  const canais: Canal[] = [
    'telefone',
    'telefone',
    'chat',
    'telefone',
    'whatsapp',
    'chat',
    'telefone',
    'sms',
  ];
  const horas = [
    '08:40',
    '09:15',
    '09:50',
    '10:25',
    '11:05',
    '11:40',
    '12:20',
    '14:10',
    '14:55',
    '15:30',
    '16:15',
    '17:05',
    '18:20',
    '19:45',
    '21:30',
    '22:50',
  ];
  // Um ciclo semanal: mais nos dias úteis, menos ao fim de semana.
  const porDia = [5, 6, 4, 5, 6, 3, 2];
  const lista: [string, string, Canal, number, string][] = [];
  let k = 0;
  for (let dia = 0; dia < 30; dia++) {
    for (let j = 0; j < porDia[dia % 7]; j++, k++) {
      lista.push([
        modelos[(k * 7) % modelos.length],
        pessoas[(k * 3) % pessoas.length],
        canais[k % canais.length],
        dia,
        // Hoje, só as horas da manhã (as que ainda não chegaram ficariam
        // todas encostadas à hora da preparação).
        horas[dia === 0 ? j : (k * 3 + j) % horas.length],
      ]);
    }
  }
  return lista;
}

export const MAIS_PROCESSOS: ProcessoDemo[] = [
  {
    chave: 'cobertura',
    pessoa: 'alice',
    assunto: 'Substituição da cobertura de uma moradia',
    morada: 'Rua de Vila Flor, 12',
    freguesia: 'Urgezes',
    fase: 'documentos',
    entrou_ha_dias: 4,
    entregues: 2,
  },
  {
    chave: 'piscina',
    pessoa: 'bruno',
    assunto: 'Piscina no logradouro',
    morada: 'Rua da Liberdade, 33',
    freguesia: 'Azurém',
    fase: 'apreciacao',
    entrou_ha_dias: 15,
    entregues: 'todos',
    prazo_em_dias_uteis: 9,
  },
  {
    chave: 'garagem',
    pessoa: 'catarina',
    assunto: 'Ampliação de garagem',
    morada: 'Rua Dr. Avelino Germano, 8',
    freguesia: 'Creixomil',
    fase: 'apreciacao',
    entrou_ha_dias: 20,
    entregues: 'todos',
    prazo_em_dias_uteis: 4,
  },
  {
    chave: 'fachada',
    pessoa: 'eduarda',
    assunto: 'Reparação de fachada no centro histórico',
    morada: 'Rua de Santa Maria, 45',
    freguesia: 'Oliveira, São Paio e São Sebastião',
    fase: 'apreciacao',
    entrou_ha_dias: 9,
    entregues: 'todos',
    prazo_em_dias_uteis: 12,
  },
  {
    chave: 'loja',
    pessoa: 'filipe',
    assunto: 'Alteração de loja para restaurante',
    morada: 'Avenida de São Gonçalo, 150',
    freguesia: 'Azurém',
    fase: 'documentos',
    entrou_ha_dias: 3,
    entregues: 1,
  },
  {
    chave: 'telheiro',
    pessoa: 'gloria',
    assunto: 'Telheiro para estacionamento',
    morada: 'Rua do Picoto, 27',
    freguesia: 'Fermentões',
    fase: 'notificado',
    entrou_ha_dias: 35,
    entregues: 'todos',
    decidido_ha_dias: 6,
    taxa_cent: 4210,
  },
  {
    chave: 'suporte',
    pessoa: 'hugo',
    assunto: 'Muro de suporte de terras',
    morada: 'Rua da Igreja, 5',
    freguesia: 'Ponte',
    fase: 'apreciacao',
    entrou_ha_dias: 18,
    entregues: 'todos',
    prazo_em_dias_uteis: 6,
  },
  {
    chave: 'moradia',
    pessoa: 'irene',
    assunto: 'Construção de moradia unifamiliar',
    morada: 'Rua das Agras, 14',
    freguesia: 'Fermentões',
    fase: 'documentos',
    entrou_ha_dias: 10,
    entregues: 3,
  },
];

export interface OcorrenciaVolume {
  chave: string;
  pessoa: string;
  categoria: 'buraco' | 'iluminacao' | 'lixo';
  descricao: string;
  morada: string;
  lat: number;
  lng: number;
  /** Há quantos dias foi reportada. */
  dias: number;
  estado: 'nova' | 'com_equipa' | 'resolvida';
}

/** Ocorrências espalhadas pelas freguesias (coordenadas aproximadas). */
export const MAIS_OCORRENCIAS: OcorrenciaVolume[] = [
  {
    chave: 'v_azurem_1',
    pessoa: 'joaquim',
    categoria: 'buraco',
    descricao: 'Buraco no passeio à saída da escola.',
    morada: 'Rua da Liberdade, 60, Azurém',
    lat: 41.4512,
    lng: -8.2878,
    dias: 2,
    estado: 'nova',
  },
  {
    chave: 'v_azurem_2',
    pessoa: 'laura',
    categoria: 'iluminacao',
    descricao: 'Dois candeeiros apagados na rotunda.',
    morada: 'Avenida de São Gonçalo, junto à rotunda, Azurém',
    lat: 41.4481,
    lng: -8.2856,
    dias: 5,
    estado: 'com_equipa',
  },
  {
    chave: 'v_creixomil_1',
    pessoa: 'miguel',
    categoria: 'lixo',
    descricao: 'Contentor do papel a transbordar há dias.',
    morada: 'Rua Dr. Avelino Germano, 20, Creixomil',
    lat: 41.4352,
    lng: -8.3071,
    dias: 1,
    estado: 'nova',
  },
  {
    chave: 'v_creixomil_2',
    pessoa: 'natalia',
    categoria: 'buraco',
    descricao:
      'Tampa de esgoto solta: faz barulho cada vez que passa um carro.',
    morada: 'Rua de Camões, 140, Creixomil',
    lat: 41.4381,
    lng: -8.3032,
    dias: 9,
    estado: 'resolvida',
  },
  {
    chave: 'v_urgezes_1',
    pessoa: 'orlando',
    categoria: 'lixo',
    descricao: 'Móveis velhos deixados junto aos contentores.',
    morada: 'Rua de Vila Flor, 8, Urgezes',
    lat: 41.4329,
    lng: -8.2961,
    dias: 3,
    estado: 'com_equipa',
  },
  {
    chave: 'v_urgezes_2',
    pessoa: 'patricia',
    categoria: 'iluminacao',
    descricao: 'Candeeiro a piscar a noite toda.',
    morada: 'Rua de Urgezes, 31, Urgezes',
    lat: 41.4302,
    lng: -8.2988,
    dias: 12,
    estado: 'resolvida',
  },
  {
    chave: 'v_costa_1',
    pessoa: 'sergio',
    categoria: 'buraco',
    descricao: 'O piso abateu na subida para a Penha.',
    morada: 'Rua da Penha, 210, Costa',
    lat: 41.4467,
    lng: -8.2779,
    dias: 4,
    estado: 'com_equipa',
  },
  {
    chave: 'v_fermentoes_1',
    pessoa: 'tania',
    categoria: 'lixo',
    descricao: 'Ecoponto partido, com vidro no chão.',
    morada: 'Rua das Agras, 40, Fermentões',
    lat: 41.4561,
    lng: -8.3129,
    dias: 6,
    estado: 'nova',
  },
  {
    chave: 'v_fermentoes_2',
    pessoa: 'vasco',
    categoria: 'buraco',
    descricao: 'Buraco fundo na berma, perigoso para motas.',
    morada: 'Avenida de Fermentões, 77, Fermentões',
    lat: 41.4588,
    lng: -8.3172,
    dias: 15,
    estado: 'resolvida',
  },
  {
    chave: 'v_ponte_1',
    pessoa: 'beatriz',
    categoria: 'iluminacao',
    descricao: 'A rua inteira está às escuras desde ontem.',
    morada: 'Rua da Igreja, Ponte',
    lat: 41.4653,
    lng: -8.3384,
    dias: 0,
    estado: 'nova',
  },
  {
    chave: 'v_silvares_1',
    pessoa: 'armando',
    categoria: 'lixo',
    descricao: 'Restos de obras despejados num terreno.',
    morada: 'Rua do Monte, Silvares',
    lat: 41.4297,
    lng: -8.2779,
    dias: 8,
    estado: 'com_equipa',
  },
  {
    chave: 'v_polvoreira_1',
    pessoa: 'conceicao',
    categoria: 'buraco',
    descricao: 'Vários buracos na estrada depois da chuva.',
    morada: 'Rua Central, Polvoreira',
    lat: 41.4231,
    lng: -8.2702,
    dias: 2,
    estado: 'nova',
  },
  {
    chave: 'v_mesaofrio_1',
    pessoa: 'domingos',
    categoria: 'iluminacao',
    descricao: 'Candeeiro tombado depois do temporal.',
    morada: 'Rua de Mesão Frio, 15, Mesão Frio',
    lat: 41.4498,
    lng: -8.2667,
    dias: 11,
    estado: 'resolvida',
  },
  {
    chave: 'v_centro_1',
    pessoa: 'elisa',
    categoria: 'lixo',
    descricao: 'Papeleira cheia e lixo no chão do largo.',
    morada: 'Largo da Oliveira, Guimarães',
    lat: 41.4436,
    lng: -8.2919,
    dias: 1,
    estado: 'nova',
  },
  {
    chave: 'v_centro_2',
    pessoa: 'francisco',
    categoria: 'buraco',
    descricao: 'Calçada levantada: já vi uma senhora tropeçar.',
    morada: 'Rua de Santa Maria, 30, Guimarães',
    lat: 41.4447,
    lng: -8.2933,
    dias: 3,
    estado: 'com_equipa',
  },
  {
    chave: 'v_centro_3',
    pessoa: 'gabriela',
    categoria: 'iluminacao',
    descricao: 'Candeeiros apagados junto ao Paço dos Duques.',
    morada: 'Rua Conde Dom Henrique, Guimarães',
    lat: 41.4473,
    lng: -8.2906,
    dias: 6,
    estado: 'resolvida',
  },
  {
    chave: 'v_saotorcato_1',
    pessoa: 'henrique',
    categoria: 'buraco',
    descricao: 'Estrada degradada junto à escola primária.',
    morada: 'Rua de São Torcato, São Torcato',
    lat: 41.4848,
    lng: -8.2575,
    dias: 14,
    estado: 'com_equipa',
  },
  {
    chave: 'v_candoso_1',
    pessoa: 'isabel',
    categoria: 'lixo',
    descricao: 'Contentor queimado, precisa de ser substituído.',
    morada: 'Rua de Candoso, Candoso',
    lat: 41.4251,
    lng: -8.3256,
    dias: 5,
    estado: 'nova',
  },
  {
    chave: 'v_caldelas_1',
    pessoa: 'luis',
    categoria: 'iluminacao',
    descricao: 'A iluminação do parque está apagada.',
    morada: 'Avenida das Termas, Caldelas',
    lat: 41.4846,
    lng: -8.3518,
    dias: 7,
    estado: 'resolvida',
  },
  {
    chave: 'v_brito_1',
    pessoa: 'margarida',
    categoria: 'buraco',
    descricao: 'Buraco grande à entrada da rotunda.',
    morada: 'Rua de Brito, Brito',
    lat: 41.4566,
    lng: -8.3664,
    dias: 1,
    estado: 'nova',
  },
  {
    chave: 'v_moreira_1',
    pessoa: 'nuno',
    categoria: 'lixo',
    descricao: 'A recolha do lixo não passou esta semana.',
    morada: 'Rua da Estação, Moreira de Cónegos',
    lat: 41.3897,
    lng: -8.3484,
    dias: 2,
    estado: 'com_equipa',
  },
  {
    chave: 'v_azurem_3',
    pessoa: 'olga',
    categoria: 'lixo',
    descricao: 'Óleo usado deixado junto ao ecoponto.',
    morada: 'Rua Padre Gaspar Roriz, Azurém',
    lat: 41.4532,
    lng: -8.2908,
    dias: 10,
    estado: 'resolvida',
  },
  {
    chave: 'v_creixomil_3',
    pessoa: 'alice',
    categoria: 'iluminacao',
    descricao: 'A passadeira não tem luz à noite.',
    morada: 'Avenida Conde Margaride, 150, Creixomil',
    lat: 41.4421,
    lng: -8.3015,
    dias: 0,
    estado: 'nova',
  },
  {
    chave: 'v_costa_2',
    pessoa: 'bruno',
    categoria: 'buraco',
    descricao: 'Passeio partido pelas raízes de uma árvore.',
    morada: 'Rua da Costa, 18, Costa',
    lat: 41.4521,
    lng: -8.2738,
    dias: 13,
    estado: 'resolvida',
  },
  {
    chave: 'v_urgezes_3',
    pessoa: 'catarina',
    categoria: 'buraco',
    descricao: 'Lomba sem sinalização: os carros batem.',
    morada: 'Rua de Urgezes, 90, Urgezes',
    lat: 41.4278,
    lng: -8.2935,
    dias: 4,
    estado: 'nova',
  },
  {
    chave: 'v_silvares_2',
    pessoa: 'eduarda',
    categoria: 'iluminacao',
    descricao: 'Candeeiro aceso de dia, todos os dias.',
    morada: 'Rua de Silvares, 5, Silvares',
    lat: 41.4315,
    lng: -8.2741,
    dias: 16,
    estado: 'resolvida',
  },
];

export interface ContactoCuidado {
  chave: string;
  nome: string;
  /** Índice na gama de teste (telefoneDemo). */
  telefone: number;
  morada: string;
  freguesia: string;
  notas: string;
  /** Como correu a campanha da onda de calor. */
  calor: {
    estado: 'bem' | 'precisa_ajuda' | 'nao_atendeu' | 'recusou';
    necessidades?: string[];
    nota?: string;
    tratado?: string;
  };
}

/** Pessoas inscritas na ação social (com consentimento), todas fictícias. */
export const CUIDADO: ContactoCuidado[] = [
  {
    chave: 'albertina',
    nome: 'Albertina Ribeiro',
    telefone: 151,
    morada: 'Rua de Santa Luzia, 22',
    freguesia: 'Oliveira, São Paio e São Sebastião',
    notas: 'Vive sozinha',
    calor: {
      estado: 'bem',
      nota: 'Está bem, tem a ventoinha ligada e bebe água.',
    },
  },
  {
    chave: 'joaquim_f',
    nome: 'Joaquim Fernandes',
    telefone: 152,
    morada: 'Rua da Penha, 88',
    freguesia: 'Costa',
    notas: 'Usa cadeira de rodas',
    calor: {
      estado: 'precisa_ajuda',
      necessidades: ['agua', 'companhia'],
      nota: 'Não tem água fresca e não consegue sair de casa.',
      tratado: 'A ação social levou água e volta amanhã.',
    },
  },
  {
    chave: 'ceu',
    nome: 'Maria do Céu Costa',
    telefone: 153,
    morada: 'Rua de Camões, 61',
    freguesia: 'Creixomil',
    notas: 'Vive sozinha',
    calor: { estado: 'bem', nota: 'A filha passa lá todos os dias.' },
  },
  {
    chave: 'ermelinda',
    nome: 'Ermelinda Pinto',
    telefone: 154,
    morada: 'Rua das Agras, 9',
    freguesia: 'Fermentões',
    notas: 'Medicação diária',
    calor: {
      estado: 'precisa_ajuda',
      necessidades: ['medicamentos'],
      nota: 'Acabaram-se os comprimidos da tensão e não tem quem os vá buscar.',
    },
  },
  {
    chave: 'abilio',
    nome: 'Abílio Teixeira',
    telefone: 155,
    morada: 'Rua de Urgezes, 12',
    freguesia: 'Urgezes',
    notas: 'Vive sozinho',
    calor: { estado: 'nao_atendeu' },
  },
  {
    chave: 'rosalina',
    nome: 'Rosalina Gomes',
    telefone: 156,
    morada: 'Rua da Igreja, 40',
    freguesia: 'Ponte',
    notas: 'Não sai de casa',
    calor: { estado: 'bem', nota: 'Está tudo bem, obrigada por ligarem.' },
  },
  {
    chave: 'custodio',
    nome: 'Custódio Martins',
    telefone: 157,
    morada: 'Rua de São Torcato, 3',
    freguesia: 'São Torcato',
    notas: 'Vive sozinho',
    calor: { estado: 'bem', nota: 'Está bem e tem a casa fresca.' },
  },
  {
    chave: 'deolinda',
    nome: 'Deolinda Faria',
    telefone: 158,
    morada: 'Rua do Monte, 17',
    freguesia: 'Silvares',
    notas: 'Filhos no estrangeiro',
    calor: { estado: 'nao_atendeu' },
  },
  {
    chave: 'amelia',
    nome: 'Amélia Rocha',
    telefone: 159,
    morada: 'Rua Central, 25',
    freguesia: 'Polvoreira',
    notas: 'Vive sozinha',
    calor: { estado: 'bem', nota: 'Está bem.' },
  },
  {
    chave: 'armindo',
    nome: 'Armindo Neves',
    telefone: 160,
    morada: 'Avenida das Termas, 70',
    freguesia: 'Caldelas',
    notas: 'Diabético',
    calor: { estado: 'recusou', nota: 'Disse que não quer mais chamadas.' },
  },
  {
    chave: 'felismina',
    nome: 'Felismina Lopes',
    telefone: 161,
    morada: 'Rua de Brito, 11',
    freguesia: 'Brito',
    notas: 'Vive sozinha',
    calor: { estado: 'bem', nota: 'Está bem, a vizinha ajuda.' },
  },
  {
    chave: 'belmiro',
    nome: 'Belmiro Sousa',
    telefone: 162,
    morada: 'Rua da Estação, 4',
    freguesia: 'Moreira de Cónegos',
    notas: 'Mobilidade reduzida',
    calor: { estado: 'bem', nota: 'Está bem.' },
  },
];

export const CAMPANHA_CALOR = {
  titulo: 'Onda de calor · aviso amarelo',
  mensagem:
    'Bom dia. Fala o assistente da câmara. Com o calor destes dias, estamos a ligar a quem se inscreveu para saber se está tudo bem.',
  perguntas: [
    'Está tudo bem consigo?',
    'Tem água fresca em casa?',
    'Precisa que alguém o visite?',
  ],
  sms_recurso:
    'Câmara Municipal: ligámos por causa do calor e não conseguimos falar consigo. Se precisar de ajuda, responda a este SMS.',
  /** Há quantos dias foi feita. */
  dias: 2,
};
