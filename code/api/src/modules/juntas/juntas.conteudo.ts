/*
 * A junta de freguesia de demonstração ("Preparar demo"): o nome, o agente
 * e o conhecimento dos serviços que a junta trata por conhecimento
 * (horários e contactos, licença de canídeos, feiras e mercados, caminhos,
 * cemitério). TUDO é de demonstração: horários, requisitos e prazos são
 * plausíveis mas não vêm da junta; os textos dizem-no e as fontes ficam
 * marcadas com `demonstracao = true`. Não há preços nem telefones
 * inventados: remete-se para a tabela de taxas e os contactos da junta.
 */

export const FREGUESIA_DEMO = 'Azurém';
export const NOME_JUNTA_DEMO = 'Junta de Freguesia de Azurém';

/** O slug da junta de demonstração a partir do da câmara. */
export function slugJuntaDemo(slugCamara: string): string {
  return `${slugCamara}-azurem`;
}

export const AGENTE_JUNTA_DEMO = {
  nome: 'Junta de Azurém',
  saudacao:
    'Olá, fala a Junta de Freguesia de Azurém. Posso ajudar com atestados, prova de vida, licença de cães, cemitério, feiras e caminhos. Em que posso ajudar?',
  versao: 'junta-demonstracao-1',
};

export interface UtilizadorDemo {
  chave: string;
  nome: string;
  perfil: 'chefe_divisao' | 'atendimento';
}

export const UTILIZADORES_JUNTA_DEMO: UtilizadorDemo[] = [
  {
    chave: 'presidente',
    nome: 'Presidente da Junta (demonstração)',
    perfil: 'chefe_divisao',
  },
  {
    chave: 'secretaria',
    nome: 'Secretaria da Junta (demonstração)',
    perfil: 'atendimento',
  },
];

/** O email (único) de um utilizador da junta de demonstração. */
export function emailUtilizadorDemo(slugJunta: string, chave: string): string {
  return `${chave}.${slugJunta}@demonstracao.toucamara.pt`;
}

/** Os textos com {camara} trocado pelo nome da câmara do concelho. */
export function textoFonte(f: FonteJunta, camara: string): string {
  return f.texto.replaceAll('{camara}', camara);
}

export interface FonteJunta {
  chave: string;
  titulo: string;
  tipo: 'pagina' | 'regulamento' | 'contactos';
  texto: string;
}

const AVISO =
  'Informação de demonstração do Tou, Câmara?, ainda por confirmar pela junta de freguesia.';

export const FONTES_JUNTA_DEMO: FonteJunta[] = [
  {
    chave: 'horarios',
    titulo: 'Horários e contactos da Junta de Freguesia de Azurém',
    tipo: 'contactos',
    texto: `Horários e contactos da Junta de Freguesia de Azurém.
${AVISO}

A secretaria da junta atende de segunda a sexta-feira, das 9h00 às 12h30 e das 14h00 às 17h30 (horário de demonstração). Ao sábado e domingo e nos feriados a junta está fechada.
O presidente da junta recebe os fregueses por marcação, pedida na secretaria.
Para assuntos da câmara municipal (obras, licenças, urbanismo, plano diretor municipal, taxas municipais, água) a junta encaminha para a {camara}.
O telefone e o email da junta são os publicados no site oficial da junta; o agente não inventa números.`,
  },
  {
    chave: 'atestados',
    titulo: 'Atestados e prova de vida',
    tipo: 'pagina',
    texto: `Atestados passados pela Junta de Freguesia de Azurém.
${AVISO}

A junta passa atestados de residência, de composição do agregado familiar e de situação económica, e faz a prova de vida para pensões. Os atestados podem ser pedidos por telefone ou no chat: o agente recolhe os dados, lê-os de volta e a pessoa confirma. Depois um funcionário da junta verifica e emite o atestado, e a pessoa recebe um SMS com o link para o documento.
Segundo o Decreto-Lei n.º 135/99, artigo 34.º, os atestados de residência, vida e situação económica são passados quando um membro da junta ou da assembleia de freguesia conhece os factos, com o testemunho de dois eleitores recenseados na freguesia, ou mediante declaração do próprio.
Atestado de residência: precisa do documento de identificação e de estar recenseado na freguesia (ou de um comprovativo de morada). Prazo de demonstração: 2 dias úteis.
Atestado de agregado familiar: o nome e o parentesco de cada pessoa que vive na casa. Prazo de demonstração: 3 dias úteis.
Atestado de situação económica: a última declaração de IRS ou um comprovativo de rendimentos. Prazo de demonstração: 5 dias úteis.
Prova de vida: a pessoa vem à junta com o cartão de cidadão. Quem não pode sair de casa pede a visita da junta.
O valor a pagar por cada atestado é o da tabela de taxas da junta.`,
  },
  {
    chave: 'canideos',
    titulo: 'Licença e registo de cães',
    tipo: 'regulamento',
    texto: `Licença e registo de cães e gatos na junta de freguesia.
${AVISO}

Os cães têm de ter microchip e estar registados no Sistema de Informação de Animais de Companhia (SIAC); o registo é feito pelo médico veterinário quando põe o microchip (Decreto-Lei n.º 82/2019).
A licença anual do cão é tratada na junta de freguesia da residência do dono. Para a licença leve o documento de identificação, o comprovativo de registo no SIAC e o boletim com a vacina antirrábica em dia.
Cães de raças potencialmente perigosas precisam também do seguro de responsabilidade civil e do registo criminal do detentor.
Animais perdidos ou encontrados e adoções são tratados pelo canil municipal da câmara.`,
  },
  {
    chave: 'feiras',
    titulo: 'Feiras e mercados da freguesia',
    tipo: 'pagina',
    texto: `Feiras e mercados na freguesia de Azurém.
${AVISO}

A junta organiza uma feira mensal de produtos locais no largo da freguesia, no primeiro domingo de cada mês, das 8h00 às 13h00 (calendário de demonstração).
Quem quiser vender pede um lugar na secretaria da junta, com o documento de identificação e o número de contribuinte; os lugares são atribuídos por ordem de pedido.
As feiras e os mercados municipais do concelho (como o mercado municipal) são da {camara}.`,
  },
  {
    chave: 'caminhos',
    titulo: 'Limpeza e pequenas reparações de caminhos',
    tipo: 'pagina',
    texto: `Limpeza e pequenas reparações de caminhos e espaços públicos da freguesia.
${AVISO}

A junta trata da limpeza de caminhos, valetas e bermas, do corte de mato nos caminhos públicos e de pequenas reparações (buracos em caminhos de terra ou calçada, sinais caídos, bancos e papeleiras partidos).
Pode reportar um problema por telefone ou no chat: o agente regista a ocorrência com a morada e manda um link para juntar fotografias. A equipa da junta vê no painel e avisa quando estiver resolvido.
Obras maiores, estradas municipais, iluminação pública e recolha do lixo são da câmara municipal ou das empresas municipais; a junta encaminha.`,
  },
  {
    chave: 'cemiterio',
    titulo: 'Cemitério paroquial de Azurém',
    tipo: 'regulamento',
    texto: `Cemitério paroquial de Azurém.
${AVISO}

O cemitério da freguesia é gerido pela junta. Está aberto todos os dias, das 8h00 às 18h00 no inverno e das 8h00 às 20h00 no verão (horário de demonstração).
Os pedidos de inumação, exumação, trasladação e de concessão de sepultura ou jazigo fazem-se na secretaria da junta, com a certidão de óbito e o documento de identificação de quem pede.
Para saber onde está sepultado um familiar, a secretaria consulta o registo do cemitério.
As taxas são as da tabela de taxas da junta.`,
  },
];

/** Categorias de ocorrência da junta (as da câmara ficam na câmara). */
export const CATEGORIAS_JUNTA_DEMO: { nome: string; icone: string }[] = [
  { nome: 'Limpeza de caminhos', icone: 'trash' },
  { nome: 'Pequenas reparações', icone: 'construction' },
];

/** Pedidos de atestado já feitos, para o painel da junta ter o que mostrar. */
export const ATESTADOS_JUNTA_DEMO = [
  {
    chave: 'residencia',
    tipo: 'residencia' as const,
    nome: 'Rosa Fernandes (demonstração)',
    morada: 'Rua de Azurém, 12, Azurém',
    finalidade: 'apresentar no centro de saúde',
    telefone: 951,
  },
  {
    chave: 'agregado',
    tipo: 'agregado_familiar' as const,
    nome: 'Joaquim Pereira (demonstração)',
    morada: 'Travessa do Campus, 4, Azurém',
    finalidade: 'candidatura a bolsa de estudo',
    telefone: 952,
    agregado: [
      { nome: 'Lúcia Pereira', parentesco: 'mulher' },
      { nome: 'Tiago Pereira', parentesco: 'filho' },
    ],
  },
];
