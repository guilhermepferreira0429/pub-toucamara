import type { Tema } from './demo.conteudo.js';

/*
 * O conhecimento da câmara de demonstração: fontes (textos de demonstração,
 * escritos à mão), respostas curadas por tema, a alteração de uma fonte por
 * rever (a taxa das esplanadas passa de 3 € para 3,50 € por m²), uma
 * contradição entre duas fontes e um teste de qualidade com resultados de
 * demonstração.
 *
 * Os textos não são as páginas oficiais: estão marcados como demonstração
 * (`fontes.demonstracao`, "texto de demonstração" no início do texto e "valor de
 * demonstração" ao lado de cada valor que não vem de uma fonte oficial). Os
 * endereços são os sites reais (câmara e Vimágua) com uma âncora por tema:
 * não se inventam páginas nem números de telefone.
 */

export const SITE_CAMARA = 'https://www.cm-guimaraes.pt/';
export const SITE_VIMAGUA = 'https://www.vimagua.pt';

/** Endereço do regulamento das esplanadas (antes: um domínio de demonstração). */
export const URL_REGULAMENTO = `${SITE_CAMARA}#regulamento-esplanadas`;
export const URL_REGULAMENTO_ANTIGO =
  'https://demo.toucamara.pt/regulamentos/esplanadas-abertas';

export type EntidadeFonte = 'camara' | 'agua';

export interface FonteDemo {
  chave: string;
  tema: Tema;
  entidade: EntidadeFonte;
  titulo: string;
  tipo: 'pagina' | 'regulamento';
  url: string;
  /** Secções `## Título` (cada uma vira um trecho com essa referência). */
  texto: string;
}

const pagina = (titulo: string, seccoes: [string, string][]) =>
  [
    `${titulo} (texto de demonstração)`,
    ...seccoes.flatMap(([t, c]) => [`## ${t}`, c]),
  ].join('\n');

export const FONTES_DEMO: FonteDemo[] = [
  {
    chave: 'obras',
    tema: 'obras',
    entidade: 'camara',
    titulo: 'Obras particulares: o que precisa de licença',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#obras-particulares`,
    texto: pagina('Obras particulares: o que precisa de licença', [
      [
        'Obras isentas',
        'As obras de conservação e as obras no interior da casa que não mexem na estrutura, na fachada, na cércea nem no número de pisos estão isentas de licença e de comunicação prévia (Regime Jurídico da Urbanização e Edificação, artigo 6.º).',
      ],
      [
        'Comunicação prévia',
        'Abrir uma porta numa parede interior que não é estrutural, fazer um anexo, um muro ou fechar uma varanda precisa de comunicação prévia: entrega-se o projeto e o termo de responsabilidade de um técnico (RJUE, artigos 4.º e 35.º).',
      ],
      [
        'Prazo de apreciação',
        'Com os documentos completos, a câmara tem 20 dias úteis para apreciar a comunicação prévia (prazo de demonstração). Enquanto faltar um documento, o prazo não começa a contar.',
      ],
      [
        'Saber como está o processo',
        'Pode perguntar ao agente, por telefone ou no chat, em que fase está o processo e quando termina o prazo. Para isso o agente pede o NIF, que não repete em voz alta.',
      ],
    ]),
  },
  {
    chave: 'agua',
    tema: 'agua',
    entidade: 'agua',
    titulo: 'Água e saneamento: avarias',
    tipo: 'pagina',
    url: `${SITE_VIMAGUA}#avarias`,
    texto: pagina('Água e saneamento: avarias', [
      [
        'Quem gere a água',
        'A água e o saneamento no concelho de Guimarães são geridos pela Vimágua, não pela câmara. Falta de água, roturas e fugas na via pública comunicam-se à Vimágua; os contactos estão em www.vimagua.pt.',
      ],
      [
        'Cortes programados',
        'Os cortes de água para obras na rede são avisados com antecedência às pessoas da zona, por SMS, e publicados em "O que se passa perto de mim".',
      ],
    ]),
  },
  {
    chave: 'social',
    tema: 'social',
    entidade: 'camara',
    titulo: 'Ação social: apoios municipais',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#acao-social`,
    texto: pagina('Ação social: apoios municipais', [
      [
        'Tarifa social da água',
        'A tarifa social da água destina-se a famílias com carência económica e é atribuída automaticamente a quem recebe certas prestações sociais (Decreto-Lei n.º 147/2017). Quem acha que tem direito e não a tem pode pedir a confirmação à Vimágua.',
      ],
      [
        'Cartão municipal do idoso',
        'O cartão municipal do idoso dá descontos em serviços e equipamentos municipais. Pede-se no Balcão Único com o documento de identificação e um comprovativo de morada no concelho (requisitos de demonstração).',
      ],
    ]),
  },
  {
    chave: 'ruido',
    tema: 'ruido',
    entidade: 'camara',
    titulo: 'Licença especial de ruído',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#licenca-ruido`,
    texto: pagina('Licença especial de ruído', [
      [
        'Quando é precisa',
        'Festas com música amplificada ao ar livre, perto de casas, precisam de licença especial de ruído (Regulamento Geral do Ruído, artigo 15.º). O agente trata do pedido por telefone e verifica as regras na hora.',
      ],
      [
        'Regras e taxa',
        'Pede-se com pelo menos 2 dias úteis de antecedência. A música no exterior pode ir até à meia-noite nos dias de semana e até às 2h nas noites de sexta e de sábado. A taxa é de 25 euros (regras e valor de demonstração).',
      ],
      [
        'Barulho de vizinhos',
        'O barulho de vizinhos entre as 23h e as 7h pode ser comunicado à PSP, que pode atuar logo (Regulamento Geral do Ruído, artigo 24.º). Se for uma atividade com licença, a câmara fiscaliza.',
      ],
    ]),
  },
  {
    chave: 'vias',
    tema: 'vias',
    entidade: 'camara',
    titulo: 'Vias, passeios e estacionamento',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#vias-e-passeios`,
    texto: pagina('Vias, passeios e estacionamento', [
      [
        'Buracos e passeios',
        'Buracos na estrada, passeios partidos ou carros a tapar a passagem podem ser comunicados ao agente, a qualquer hora. Fica registada uma ocorrência com número e a pessoa recebe por SMS um link para juntar uma fotografia e acompanhar o estado.',
      ],
      [
        'Dístico de residente',
        'O dístico de residente pede-se a quem mora na zona de estacionamento tarifado e tem o carro em seu nome. Pode pedi-lo pelo telefone, com o agente (regras de demonstração).',
      ],
    ]),
  },
  {
    chave: 'residuos',
    tema: 'residuos',
    entidade: 'camara',
    titulo: 'Recolha de lixo e de monos',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#residuos`,
    texto: pagina('Recolha de lixo e de monos', [
      [
        'Recolha de monos',
        'A recolha de móveis velhos e eletrodomésticos é gratuita e marca-se pelo telefone. Os monos ficam à porta na véspera do dia marcado e a pessoa recebe um lembrete por SMS.',
      ],
      [
        'Contentores',
        'Contentores partidos ou a transbordar comunicam-se ao agente: fica registada uma ocorrência para a equipa da recolha.',
      ],
    ]),
  },
  {
    chave: 'balcao',
    tema: 'balcao',
    entidade: 'camara',
    titulo: 'Balcão Único: atendimento e marcações',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#balcao-unico`,
    texto: pagina('Balcão Único: atendimento e marcações', [
      [
        'Marcação',
        'O Balcão Único atende nos dias úteis. Pode marcar atendimento pelo telefone, a qualquer hora, e recebe a confirmação por SMS. Quem vai sem marcação continua a ser atendido.',
      ],
      [
        'Reclamações',
        'Pode apresentar uma reclamação pelo telefone, ao agente, ou no livro de reclamações. A reclamação fica registada com número e a resposta segue por escrito.',
      ],
    ]),
  },
  {
    chave: 'iluminacao',
    tema: 'iluminacao',
    entidade: 'camara',
    titulo: 'Iluminação pública: avarias',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#iluminacao-publica`,
    texto: pagina('Iluminação pública: avarias', [
      [
        'Candeeiro apagado',
        'Um candeeiro apagado ou a piscar comunica-se ao agente com a rua e um ponto de referência. Fica registada uma ocorrência e a pessoa é avisada por SMS quando a equipa tiver tratado.',
      ],
    ]),
  },
  {
    chave: 'eventos',
    tema: 'eventos',
    entidade: 'camara',
    titulo: 'Agenda cultural e eventos',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#agenda`,
    texto: pagina('Agenda cultural e eventos', [
      [
        'Agenda',
        'Os eventos da câmara (feiras, concertos, visitas guiadas e mercados) são publicados em "O que se passa perto de mim". O agente diz o que há e envia os detalhes por SMS.',
      ],
      [
        'Visitas guiadas',
        'As visitas guiadas ao centro histórico são a pé e têm inscrição no posto de turismo.',
      ],
    ]),
  },
  {
    chave: 'esplanadas_faq',
    tema: 'comercio',
    entidade: 'camara',
    titulo: 'Esplanadas: perguntas frequentes',
    tipo: 'pagina',
    url: `${SITE_CAMARA}#esplanadas-perguntas`,
    texto: pagina('Esplanadas: perguntas frequentes', [
      [
        'Como se pede',
        'A esplanada aberta pede-se por mera comunicação prévia, com 5 dias úteis de antecedência. Pode tratar do pedido pelo telefone, com o agente.',
      ],
      [
        'Quanto custa',
        'A taxa da esplanada é de 3 euros por metro quadrado e por mês, com o mínimo de 20 euros (valores de demonstração).',
      ],
    ]),
  },
];

/**
 * O regulamento das esplanadas com a taxa nova (lido "esta noite"): a
 * alteração por rever. O resto do texto fica igual ao de `REGULAMENTO`.
 */
export const TAXA_ANTIGA =
  'A ocupação está sujeita ao pagamento de uma taxa de 3 euros por metro quadrado e por mês, com o valor mínimo de 20 euros.';
export const TAXA_NOVA =
  'A ocupação está sujeita ao pagamento de uma taxa de 3,50 euros por metro quadrado e por mês, com o valor mínimo de 20 euros.';

export interface RespostaDemo {
  chave: string;
  tema: Tema;
  pergunta: string;
  frases: string[];
  texto_voz: string;
  texto_sms: string;
  passa_a_pessoa_quando?: string[];
  /** [chave da fonte, referência do trecho]; 'regulamento' = o das esplanadas. */
  trechos: [string, string][];
  estado: 'no_ar' | 'em_teste' | 'rascunho';
  /** Palavras que ligam uma conversa do mesmo tema a esta resposta. */
  palavras?: RegExp;
}

export const RESPOSTAS_DEMO: RespostaDemo[] = [
  {
    chave: 'obras_interior',
    tema: 'obras',
    pergunta: 'Preciso de licença para obras no interior da casa?',
    frases: [
      'Vou remodelar a cozinha, preciso de licença?',
      'Posso trocar o chão sem licença?',
    ],
    texto_voz:
      'Não precisa. Obras no interior que não mexem na estrutura, na fachada nem na cércea estão isentas de licença e de comunicação prévia.',
    texto_sms:
      'Obras no interior sem mexer na estrutura nem na fachada: isentas de licença (RJUE, art. 6.º).',
    trechos: [['obras', 'Obras isentas']],
    estado: 'no_ar',
    palavras: /cozinha|interior|remodel/i,
  },
  {
    chave: 'obras_comunicacao',
    tema: 'obras',
    pergunta: 'Preciso de licença para abrir uma porta ou fazer um anexo?',
    frases: [
      'Quero abrir uma porta entre a cozinha e a sala',
      'Preciso de licença para um muro?',
    ],
    texto_voz:
      'Precisa de comunicação prévia, com o projeto e o termo de responsabilidade de um técnico. Com os documentos completos, a câmara aprecia em 20 dias úteis.',
    texto_sms:
      'Comunicação prévia: projeto + termo de responsabilidade do técnico. Apreciação em 20 dias úteis.',
    passa_a_pessoa_quando: ['a parede pode ser estrutural'],
    trechos: [
      ['obras', 'Comunicação prévia'],
      ['obras', 'Prazo de apreciação'],
    ],
    estado: 'no_ar',
    palavras: /porta|parede|anexo|muro|marquise|varanda|telheiro/i,
  },
  {
    chave: 'obras_estado',
    tema: 'obras',
    pergunta: 'Em que ponto está o meu processo de obras?',
    frases: [
      'Como está o meu processo?',
      'Já decidiram o meu pedido de obras?',
    ],
    texto_voz:
      'Digo-lhe já. Preciso do seu NIF para encontrar o processo; depois digo a fase e quando termina o prazo.',
    texto_sms: 'O estado do processo: fase e prazo, depois de confirmar o NIF.',
    trechos: [
      ['obras', 'Saber como está o processo'],
      ['obras', 'Prazo de apreciação'],
    ],
    estado: 'no_ar',
    palavras: /processo|ponto|fase|prazo/i,
  },
  {
    chave: 'agua_avaria',
    tema: 'agua',
    pergunta: 'Estou sem água ou há uma fuga na rua. A quem ligo?',
    frases: ['Estou sem água em casa', 'Está a sair água de uma tampa na rua'],
    texto_voz:
      'Quem trata da água no concelho é a Vimágua, não a câmara. Envio-lhe por SMS onde encontrar os contactos da Vimágua.',
    texto_sms: 'Água e saneamento: Vimágua, contactos em www.vimagua.pt.',
    trechos: [['agua', 'Quem gere a água']],
    estado: 'no_ar',
  },
  {
    chave: 'tarifa_social',
    tema: 'social',
    pergunta: 'Tenho direito à tarifa social da água?',
    frases: ['Sou reformada, pago menos de água?'],
    texto_voz:
      'Pode ter. A tarifa social é automática para quem recebe certas prestações sociais. Se acha que tem direito e não a tem, peça a confirmação à Vimágua.',
    texto_sms:
      'Tarifa social da água: automática com certas prestações sociais (DL 147/2017).',
    trechos: [['social', 'Tarifa social da água']],
    estado: 'no_ar',
    palavras: /tarifa/i,
  },
  {
    chave: 'cartao_idoso',
    tema: 'social',
    pergunta: 'Como peço o cartão municipal do idoso?',
    frases: ['Há algum cartão com descontos para idosos?'],
    texto_voz:
      'Pede-se no Balcão Único, com o documento de identificação e um comprovativo de morada no concelho. Posso marcar-lhe o atendimento.',
    texto_sms:
      'Cartão municipal do idoso: Balcão Único, com identificação e comprovativo de morada.',
    trechos: [['social', 'Cartão municipal do idoso']],
    estado: 'no_ar',
    palavras: /cartão|idos/i,
  },
  {
    chave: 'licenca_ruido',
    tema: 'ruido',
    pergunta: 'Preciso de licença para uma festa com música?',
    frases: ['Vou fazer uma festa no quintal com colunas'],
    texto_voz:
      'Precisa da licença especial de ruído. Posso tratar já: digo-lhe na hora se cumpre as regras e a taxa é de 25 euros.',
    texto_sms:
      'Licença especial de ruído: 2 dias úteis de antecedência, taxa de 25 € (valor de demonstração).',
    trechos: [
      ['ruido', 'Quando é precisa'],
      ['ruido', 'Regras e taxa'],
    ],
    estado: 'no_ar',
    palavras: /festa|música|licença|jantar/i,
  },
  {
    chave: 'ruido_vizinhos',
    tema: 'ruido',
    pergunta: 'Os vizinhos fazem barulho à noite. Quem resolve?',
    frases: ['Os bares fazem barulho até de madrugada'],
    texto_voz:
      'Entre as 23h e as 7h, quem pode atuar logo é a PSP. Se for uma atividade com licença, a câmara fiscaliza.',
    texto_sms:
      'Barulho à noite (23h-7h): PSP. Atividades com licença: fiscalização da câmara.',
    trechos: [['ruido', 'Barulho de vizinhos']],
    estado: 'no_ar',
    palavras: /vizinh|barulho|bares|noite/i,
  },
  {
    chave: 'buraco',
    tema: 'vias',
    pergunta: 'Como comunico um buraco na estrada?',
    frases: [
      'Há um buraco enorme na minha rua',
      'Os carros estão em cima do passeio',
    ],
    texto_voz:
      'Pode dizer-me já: registo uma ocorrência com número e envio-lhe por SMS um link para juntar uma fotografia.',
    texto_sms:
      'Ocorrência registada: junte uma fotografia pelo link e acompanhe o estado.',
    trechos: [['vias', 'Buracos e passeios']],
    estado: 'no_ar',
  },
  {
    chave: 'distico',
    tema: 'vias',
    pergunta: 'Como peço o dístico de residente?',
    frases: ['Quero estacionar na rua onde moro'],
    texto_voz:
      'Pode pedir já comigo: precisa de morar na zona e de ter o carro em seu nome.',
    texto_sms: 'Dístico de residente: morar na zona e ter o carro em seu nome.',
    trechos: [['vias', 'Dístico de residente']],
    estado: 'no_ar',
    palavras: /dístico|residente/i,
  },
  {
    chave: 'monos',
    tema: 'residuos',
    pergunta: 'Como marco a recolha de monos?',
    frases: ['Como deito fora um sofá velho?'],
    texto_voz:
      'A recolha de monos é gratuita e marca-se por telefone. Deixe-os à porta na véspera do dia marcado; recebe um lembrete por SMS.',
    texto_sms:
      'Recolha de monos: gratuita, marcada por telefone, à porta na véspera.',
    trechos: [['residuos', 'Recolha de monos']],
    estado: 'no_ar',
    palavras: /monos|sofá|móve/i,
  },
  {
    chave: 'contentor',
    tema: 'residuos',
    pergunta: 'O contentor está partido ou a transbordar. Quem trata?',
    frases: ['O contentor do lixo tem a tampa partida'],
    texto_voz:
      'Registo já uma ocorrência para a equipa da recolha e aviso-o por SMS quando estiver tratado.',
    texto_sms: 'Ocorrência registada para a equipa da recolha.',
    trechos: [['residuos', 'Contentores']],
    estado: 'no_ar',
    palavras: /contentor|lixo|sacos/i,
  },
  {
    chave: 'marcacao',
    tema: 'balcao',
    pergunta: 'Como marco atendimento no Balcão Único?',
    frases: [
      'A que horas abre o balcão da câmara?',
      'Quero marcar atendimento',
    ],
    texto_voz:
      'O Balcão Único atende nos dias úteis. Posso marcar-lhe já uma hora; recebe a confirmação por SMS. Sem marcação também é atendido.',
    texto_sms:
      'Balcão Único: dias úteis; marcação por telefone com confirmação por SMS.',
    trechos: [['balcao', 'Marcação']],
    estado: 'no_ar',
  },
  {
    chave: 'reclamacao',
    tema: 'balcao',
    pergunta: 'Como faço uma reclamação?',
    frases: ['Quero reclamar do atendimento'],
    texto_voz:
      'Pode fazê-la já comigo: fica registada com número e a resposta segue por escrito.',
    texto_sms: 'Reclamação registada com número; resposta por escrito.',
    trechos: [['balcao', 'Reclamações']],
    estado: 'no_ar',
    palavras: /reclama|esperei|espera/i,
  },
  {
    chave: 'esplanada_taxa',
    tema: 'comercio',
    pergunta: 'Quanto custa uma esplanada?',
    frases: ['Quanto custa ter uma esplanada?', 'Como peço uma esplanada?'],
    texto_voz:
      'A esplanada aberta pede-se com 5 dias úteis de antecedência. A taxa é de 3 euros por metro quadrado e por mês, com o mínimo de 20 euros. Posso tratar já do pedido.',
    texto_sms:
      'Esplanada: 5 dias úteis de antecedência; 3 €/m² por mês, mínimo 20 € (valores de demonstração).',
    trechos: [
      ['regulamento', 'art. 2.º'],
      ['regulamento', 'art. 4.º'],
    ],
    estado: 'no_ar',
  },
  {
    chave: 'candeeiro',
    tema: 'iluminacao',
    pergunta: 'Há um candeeiro apagado na minha rua.',
    frases: ['O candeeiro da rua está apagado há três noites'],
    texto_voz:
      'Registo uma ocorrência com a rua e um ponto de referência e aviso-o por SMS quando a equipa tiver tratado.',
    texto_sms:
      'Candeeiro apagado: ocorrência registada; aviso por SMS quando estiver tratado.',
    trechos: [['iluminacao', 'Candeeiro apagado']],
    estado: 'no_ar',
  },
  {
    chave: 'fim_de_semana',
    tema: 'eventos',
    pergunta: 'O que há para fazer em Guimarães este fim de semana?',
    frases: ['Há alguma feira este fim de semana?'],
    texto_voz:
      'Digo-lhe os eventos publicados para esses dias e envio os detalhes por SMS.',
    texto_sms: 'Eventos publicados em "O que se passa perto de mim".',
    trechos: [
      ['eventos', 'Agenda'],
      ['eventos', 'Visitas guiadas'],
    ],
    estado: 'no_ar',
  },
  {
    chave: 'piscina',
    tema: 'desporto',
    pergunta: 'Quando reabre a piscina municipal?',
    frases: ['Quando é que reabre a piscina municipal?'],
    texto_voz:
      'Ainda sem data confirmada: esta resposta fica em rascunho até o serviço de desporto confirmar a reabertura.',
    texto_sms: 'Reabertura da piscina municipal: data por confirmar.',
    trechos: [],
    estado: 'rascunho',
  },
];

/** A pergunta sem resposta (as conversas "piscina") ligada ao rascunho. */
export const PERGUNTA_SEM_RESPOSTA = {
  texto: 'Quando reabre a piscina municipal?',
  o_que_falta: 'A data de reabertura confirmada pelo serviço de desporto.',
  resposta: 'piscina',
};

/** Contradição: a página das perguntas frequentes ainda diz 3 €. */
export const CONTRADICAO = {
  assunto: 'Esplanadas · taxa por metro quadrado',
  valor_a: '3,50 € por m² e por mês',
  valor_b: '3 € por m² e por mês',
};

// ---------------------------------------------------------------------------
// Teste de qualidade (resultados de demonstração)
// ---------------------------------------------------------------------------

export interface PerguntaAvaliacaoDemo {
  tema: Tema;
  texto: string;
  comportamento: 'responder' | 'encaminhar' | 'ocorrencia' | 'passar_humano';
  gabarito: string;
  factos: string[];
}

export const PERGUNTAS_AVALIACAO: PerguntaAvaliacaoDemo[] = [
  {
    tema: 'obras',
    texto: 'Preciso de licença para remodelar a cozinha sem mexer em paredes?',
    comportamento: 'responder',
    gabarito:
      'Não precisa: obras no interior que não mexem na estrutura nem na fachada estão isentas (RJUE, art. 6.º).',
    factos: ['isentas', 'artigo 6.º'],
  },
  {
    tema: 'obras',
    texto:
      'Quero abrir uma porta numa parede interior. O que tenho de entregar?',
    comportamento: 'responder',
    gabarito:
      'Comunicação prévia com o projeto e o termo de responsabilidade de um técnico.',
    factos: ['comunicação prévia', 'termo de responsabilidade'],
  },
  {
    tema: 'obras',
    texto: 'Quanto tempo demora a câmara a responder a uma comunicação prévia?',
    comportamento: 'responder',
    gabarito: '20 dias úteis depois de os documentos estarem completos.',
    factos: ['20 dias úteis'],
  },
  {
    tema: 'obras',
    texto: 'Quero falar com o técnico que tem o meu processo.',
    comportamento: 'passar_humano',
    gabarito: 'Passa a um funcionário, que responde por SMS.',
    factos: [],
  },
  {
    tema: 'agua',
    texto: 'Estou sem água em casa. A quem ligo?',
    comportamento: 'encaminhar',
    gabarito:
      'À Vimágua, que gere a água no concelho; contactos em www.vimagua.pt.',
    factos: ['Vimágua'],
  },
  {
    tema: 'agua',
    texto: 'Há uma fuga de água na estrada. Quem trata?',
    comportamento: 'encaminhar',
    gabarito: 'A Vimágua.',
    factos: ['Vimágua'],
  },
  {
    tema: 'ruido',
    texto: 'Preciso de licença para uma festa com música no quintal?',
    comportamento: 'responder',
    gabarito:
      'Sim, a licença especial de ruído; pede-se com 2 dias úteis de antecedência e a taxa é de 25 euros.',
    factos: ['licença especial de ruído', '2 dias úteis'],
  },
  {
    tema: 'ruido',
    texto: 'Até que horas pode haver música numa festa à sexta-feira?',
    comportamento: 'responder',
    gabarito: 'Até às 2h nas noites de sexta e de sábado.',
    factos: ['2h'],
  },
  {
    tema: 'ruido',
    texto: 'Os vizinhos fazem barulho às duas da manhã. O que faço?',
    comportamento: 'encaminhar',
    gabarito: 'Entre as 23h e as 7h, a PSP pode atuar logo.',
    factos: ['PSP'],
  },
  {
    tema: 'vias',
    texto: 'Há um buraco grande na minha rua.',
    comportamento: 'ocorrencia',
    gabarito:
      'Regista uma ocorrência e envia o link para a fotografia por SMS.',
    factos: ['ocorrência'],
  },
  {
    tema: 'vias',
    texto: 'Como peço o dístico de residente?',
    comportamento: 'responder',
    gabarito:
      'Morar na zona e ter o carro em seu nome; pode pedir pelo telefone.',
    factos: ['morar na zona'],
  },
  {
    tema: 'residuos',
    texto: 'Como deito fora um sofá velho?',
    comportamento: 'responder',
    gabarito:
      'Recolha de monos gratuita, marcada por telefone; à porta na véspera.',
    factos: ['gratuita'],
  },
  {
    tema: 'residuos',
    texto: 'O contentor da minha rua está partido.',
    comportamento: 'ocorrencia',
    gabarito: 'Regista uma ocorrência para a equipa da recolha.',
    factos: ['ocorrência'],
  },
  {
    tema: 'balcao',
    texto: 'Posso marcar atendimento no Balcão Único?',
    comportamento: 'responder',
    gabarito:
      'Sim, pelo telefone, com confirmação por SMS; sem marcação também é atendido.',
    factos: ['SMS'],
  },
  {
    tema: 'balcao',
    texto: 'Quero fazer uma reclamação do atendimento.',
    comportamento: 'responder',
    gabarito: 'Regista a reclamação com número; a resposta segue por escrito.',
    factos: ['número'],
  },
  {
    tema: 'social',
    texto: 'Tenho direito à tarifa social da água?',
    comportamento: 'responder',
    gabarito:
      'É automática para quem recebe certas prestações sociais (DL 147/2017).',
    factos: ['automática'],
  },
  {
    tema: 'social',
    texto: 'Como peço o cartão municipal do idoso?',
    comportamento: 'responder',
    gabarito: 'No Balcão Único, com identificação e comprovativo de morada.',
    factos: ['Balcão Único'],
  },
  {
    tema: 'comercio',
    texto: 'Quanto custa uma esplanada de 10 m² durante um mês?',
    comportamento: 'responder',
    gabarito: '3 euros por m² e por mês: 30 euros (mínimo de 20 euros).',
    factos: ['30 euros'],
  },
  {
    tema: 'comercio',
    texto: 'Até que horas pode estar aberta uma esplanada?',
    comportamento: 'responder',
    gabarito: 'Até às 23 horas (regulamento das esplanadas, art. 3.º).',
    factos: ['23 horas'],
  },
  {
    tema: 'comercio',
    texto: 'Com que antecedência peço a esplanada?',
    comportamento: 'responder',
    gabarito: '5 dias úteis.',
    factos: ['5 dias úteis'],
  },
  {
    tema: 'iluminacao',
    texto: 'O candeeiro da minha rua está apagado.',
    comportamento: 'ocorrencia',
    gabarito: 'Regista uma ocorrência com a rua e um ponto de referência.',
    factos: ['ocorrência'],
  },
  {
    tema: 'eventos',
    texto: 'O que há este fim de semana no centro?',
    comportamento: 'responder',
    gabarito: 'Os eventos publicados, com os detalhes por SMS.',
    factos: [],
  },
  {
    tema: 'eventos',
    texto: 'Como me inscrevo numa visita guiada?',
    comportamento: 'responder',
    gabarito: 'No posto de turismo.',
    factos: ['posto de turismo'],
  },
  {
    tema: 'desporto',
    texto: 'Quando reabre a piscina municipal?',
    comportamento: 'responder',
    gabarito:
      'Ainda sem data confirmada: o agente diz que não sabe e regista a pergunta.',
    factos: [],
  },
];

/**
 * As três execuções (dias atrás) e as perguntas que correram mal em cada
 * uma (índice → veredicto, resposta do agente, justificação do juiz). A
 * primeira fica abaixo dos 80% (o gate parou a publicação), as outras
 * acima. Resultados de demonstração: não são a taxa real do produto.
 */
export interface FalhaDemo {
  veredicto: 'errada' | 'sem_resposta';
  resposta: string;
  justificacao: string;
  factos_errados?: string[];
}

export const EXECUCOES_AVALIACAO: {
  dias: number;
  falhas: Record<number, FalhaDemo>;
}[] = [
  {
    dias: 19,
    falhas: {
      2: {
        veredicto: 'errada',
        resposta: 'A câmara responde em 30 dias.',
        justificacao: 'Prazo errado: são 20 dias úteis.',
        factos_errados: ['30 dias'],
      },
      7: {
        veredicto: 'errada',
        resposta: 'A música tem de acabar à meia-noite.',
        justificacao: 'À sexta e ao sábado o limite é às 2h.',
        factos_errados: ['meia-noite'],
      },
      10: {
        veredicto: 'sem_resposta',
        resposta: 'Não tenho essa informação.',
        justificacao: 'A regra do dístico estava na fonte.',
      },
      16: {
        veredicto: 'sem_resposta',
        resposta: 'Não sei responder a isso.',
        justificacao: 'A fonte diz onde se pede o cartão.',
      },
      18: {
        veredicto: 'errada',
        resposta: 'Pode estar aberta até à meia-noite.',
        justificacao: 'O regulamento diz 23 horas.',
        factos_errados: ['meia-noite'],
      },
      23: {
        veredicto: 'errada',
        resposta: 'A piscina reabre na segunda-feira.',
        justificacao: 'Inventou uma data que não está em nenhuma fonte.',
        factos_errados: ['segunda-feira'],
      },
    },
  },
  {
    dias: 8,
    falhas: {
      7: {
        veredicto: 'errada',
        resposta: 'A música tem de acabar à meia-noite.',
        justificacao: 'À sexta e ao sábado o limite é às 2h.',
        factos_errados: ['meia-noite'],
      },
      18: {
        veredicto: 'errada',
        resposta: 'Pode estar aberta até à meia-noite.',
        justificacao: 'O regulamento diz 23 horas.',
        factos_errados: ['meia-noite'],
      },
      23: {
        veredicto: 'sem_resposta',
        resposta: 'Não tenho essa informação.',
        justificacao: 'Sem fonte: devia dizer que regista a pergunta.',
      },
    },
  },
  {
    dias: 1,
    falhas: {
      18: {
        veredicto: 'errada',
        resposta: 'Pode estar aberta até à meia-noite.',
        justificacao: 'O regulamento diz 23 horas (art. 3.º).',
        factos_errados: ['meia-noite'],
      },
      23: {
        veredicto: 'sem_resposta',
        resposta: 'Não tenho essa informação confirmada.',
        justificacao: 'Não disse que registava a pergunta para a câmara.',
      },
    },
  },
];
