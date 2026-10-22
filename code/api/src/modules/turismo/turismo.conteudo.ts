/*
 * Conteúdo turístico de DEMONSTRAÇÃO (Guimarães), carregado como fontes do
 * conhecimento (tipo 'turismo', uma por tema e por língua). Escrito por nós
 * com informação pública geral: o que é cada sítio, como chegar, o que é
 * típico. NÃO tem horários, preços nem contactos: onde seriam precisos diz
 * "consulte no local ou no site oficial". Tudo a confirmar com o turismo da
 * câmara, que pode editar cada fonte no painel (Conhecimento › Fontes).
 *
 * Os pontos do mapa têm coordenadas APROXIMADAS; o tempo de visita e a
 * acessibilidade são estimativas de demonstração. O título de cada secção
 * "## …" é o nome do ponto nessa língua (é assim que a página /visitar junta
 * o texto da fonte ao ponto do mapa).
 */
import type { Interesse, Lingua, Ponto } from './turismo.regras.js';

export interface PontoDemo extends Omit<Ponto, 'nome'> {
  nome: Record<Lingua, string>;
}

export interface TemaDemo {
  tema: string;
  ordem: number;
  titulo: Record<Lingua, string>;
  texto: Record<Lingua, string>;
  /** Chaves dos pontos que este tema descreve (secções com o nome do ponto). */
  pontos?: string[];
}

/** O site oficial genérico, citado só como "fonte a confirmar". */
export const SITE_OFICIAL = 'https://www.cm-guimaraes.pt/';

const AVISO: Record<Lingua, string> = {
  pt: 'Conteúdo de demonstração, a confirmar com o turismo da câmara. Horários, preços e condições de acesso: consulte no local ou no site oficial (fonte a confirmar).',
  en: 'Demonstration content, to be confirmed with the municipal tourism office. Opening hours, prices and access: check on site or on the official website (source to be confirmed).',
  es: 'Contenido de demostración, pendiente de confirmar con la oficina de turismo del ayuntamiento. Horarios, precios y condiciones de acceso: consulte en el lugar o en la web oficial (fuente por confirmar).',
  fr: "Contenu de démonstration, à confirmer avec l'office de tourisme de la mairie. Horaires, tarifs et conditions d'accès : renseignez-vous sur place ou sur le site officiel (source à confirmer).",
};

const I = (...i: Interesse[]) => i;

export const PONTOS_DEMO: PontoDemo[] = [
  {
    chave: 'toural',
    categoria: 'monumento',
    lat: 41.4416,
    lng: -8.296,
    minutos: 10,
    acessibilidade: 'boa',
    interesses: I('historia'),
    ordem: 1,
    nome: {
      pt: 'Largo do Toural',
      en: 'Largo do Toural (main square)',
      es: 'Largo do Toural (plaza central)',
      fr: 'Largo do Toural (place centrale)',
    },
  },
  {
    chave: 'oliveira',
    categoria: 'monumento',
    lat: 41.4425,
    lng: -8.2946,
    minutos: 20,
    acessibilidade: 'boa',
    interesses: I('historia', 'gastronomia'),
    ordem: 2,
    destaque: true,
    nome: {
      pt: 'Largo da Oliveira',
      en: 'Largo da Oliveira (Olive Tree Square)',
      es: 'Largo da Oliveira (plaza del Olivo)',
      fr: "Largo da Oliveira (place de l'Olivier)",
    },
  },
  {
    chave: 'alberto_sampaio',
    categoria: 'museu',
    lat: 41.4422,
    lng: -8.2941,
    minutos: 45,
    acessibilidade: 'parcial',
    interesses: I('museus', 'historia'),
    ordem: 3,
    nome: {
      pt: 'Museu de Alberto Sampaio',
      en: 'Alberto Sampaio Museum',
      es: 'Museo de Alberto Sampaio',
      fr: 'Musée Alberto Sampaio',
    },
  },
  {
    chave: 'santiago',
    categoria: 'monumento',
    lat: 41.443,
    lng: -8.295,
    minutos: 10,
    acessibilidade: 'boa',
    interesses: I('historia', 'gastronomia'),
    ordem: 4,
    nome: {
      pt: 'Praça de Santiago',
      en: 'Praça de Santiago (St James Square)',
      es: 'Praça de Santiago (plaza de Santiago)',
      fr: 'Praça de Santiago (place Saint-Jacques)',
    },
  },
  {
    chave: 'santa_maria',
    categoria: 'monumento',
    lat: 41.4445,
    lng: -8.293,
    minutos: 15,
    acessibilidade: 'parcial',
    interesses: I('historia'),
    ordem: 5,
    nome: {
      pt: 'Rua de Santa Maria',
      en: 'Rua de Santa Maria (Santa Maria Street)',
      es: 'Rua de Santa Maria (calle de Santa María)',
      fr: 'Rua de Santa Maria (rue Santa Maria)',
    },
  },
  {
    chave: 'paco',
    categoria: 'monumento',
    lat: 41.4463,
    lng: -8.2909,
    minutos: 45,
    acessibilidade: 'parcial',
    interesses: I('historia', 'museus'),
    ordem: 6,
    destaque: true,
    nome: {
      pt: 'Paço dos Duques de Bragança',
      en: 'Palace of the Dukes of Braganza',
      es: 'Palacio de los Duques de Braganza',
      fr: 'Palais des Ducs de Bragance',
    },
  },
  {
    chave: 'sao_miguel',
    categoria: 'monumento',
    lat: 41.4474,
    lng: -8.2907,
    minutos: 10,
    acessibilidade: 'parcial',
    interesses: I('historia'),
    ordem: 7,
    nome: {
      pt: 'Igreja de São Miguel do Castelo',
      en: 'Church of São Miguel do Castelo',
      es: 'Iglesia de São Miguel do Castelo',
      fr: 'Église São Miguel do Castelo',
    },
  },
  {
    chave: 'castelo',
    categoria: 'monumento',
    lat: 41.4479,
    lng: -8.2902,
    minutos: 30,
    acessibilidade: 'dificil',
    interesses: I('historia'),
    ordem: 8,
    destaque: true,
    nome: {
      pt: 'Castelo de Guimarães',
      en: 'Guimarães Castle',
      es: 'Castillo de Guimarães',
      fr: 'Château de Guimarães',
    },
  },
  {
    chave: 'couros',
    categoria: 'monumento',
    lat: 41.4398,
    lng: -8.2925,
    minutos: 20,
    acessibilidade: 'parcial',
    interesses: I('historia'),
    ordem: 9,
    nome: {
      pt: 'Zona de Couros',
      en: 'Couros district (old tanneries)',
      es: 'Zona de Couros (antiguas curtidurías)',
      fr: 'Quartier de Couros (anciennes tanneries)',
    },
  },
  {
    chave: 'martins_sarmento',
    categoria: 'museu',
    lat: 41.4405,
    lng: -8.2985,
    minutos: 45,
    acessibilidade: 'parcial',
    interesses: I('museus', 'historia'),
    ordem: 10,
    nome: {
      pt: 'Museu Martins Sarmento',
      en: 'Martins Sarmento Museum',
      es: 'Museo Martins Sarmento',
      fr: 'Musée Martins Sarmento',
    },
  },
  {
    chave: 'ciajg',
    categoria: 'museu',
    lat: 41.4403,
    lng: -8.3,
    minutos: 60,
    acessibilidade: 'boa',
    interesses: I('museus'),
    ordem: 11,
    nome: {
      pt: 'Centro Internacional das Artes José de Guimarães',
      en: 'José de Guimarães International Arts Centre',
      es: 'Centro Internacional de las Artes José de Guimarães',
      fr: 'Centre international des arts José de Guimarães',
    },
  },
  {
    chave: 'casa_memoria',
    categoria: 'museu',
    lat: 41.4398,
    lng: -8.3022,
    minutos: 40,
    acessibilidade: 'boa',
    interesses: I('museus', 'historia'),
    ordem: 12,
    nome: {
      pt: 'Casa da Memória',
      en: 'Casa da Memória (House of Memory)',
      es: 'Casa da Memória (Casa de la Memoria)',
      fr: 'Casa da Memória (Maison de la Mémoire)',
    },
  },
  {
    chave: 'teleferico',
    categoria: 'transporte',
    lat: 41.4413,
    lng: -8.2877,
    minutos: 20,
    acessibilidade: 'parcial',
    interesses: I('natureza'),
    ordem: 13,
    nome: {
      pt: 'Teleférico da Penha',
      en: 'Penha cable car',
      es: 'Teleférico de la Penha',
      fr: 'Téléphérique de la Penha',
    },
  },
  {
    chave: 'penha',
    categoria: 'natureza',
    lat: 41.4262,
    lng: -8.2667,
    minutos: 90,
    acessibilidade: 'parcial',
    interesses: I('natureza'),
    ordem: 14,
    nome: {
      pt: 'Monte e Santuário da Penha',
      en: 'Penha Mountain and Sanctuary',
      es: 'Monte y Santuario de la Penha',
      fr: 'Mont et sanctuaire de la Penha',
    },
  },
  {
    chave: 'citania',
    categoria: 'monumento',
    lat: 41.528,
    lng: -8.315,
    minutos: 90,
    acessibilidade: 'dificil',
    interesses: I('historia', 'natureza'),
    ordem: 15,
    fora_do_centro: true,
    nome: {
      pt: 'Citânia de Briteiros',
      en: 'Citânia de Briteiros (Iron Age hillfort)',
      es: 'Citânia de Briteiros (castro de la Edad del Hierro)',
      fr: "Citânia de Briteiros (oppidum de l'âge du fer)",
    },
  },
];

const nome = (chave: string, l: Lingua) =>
  PONTOS_DEMO.find((p) => p.chave === chave)!.nome[l];

/** Cabeçalho de secção com o nome do ponto (liga o texto ao mapa). */
const S = (chave: string, l: Lingua) => `## ${nome(chave, l)}`;

export const TEMAS_DEMO: TemaDemo[] = [
  // -------------------------------------------------------------------
  {
    tema: 'centro_historico',
    ordem: 1,
    pontos: [
      'castelo',
      'paco',
      'sao_miguel',
      'santa_maria',
      'oliveira',
      'santiago',
      'toural',
      'couros',
    ],
    titulo: {
      pt: 'Turismo · Centro histórico e monumentos',
      en: 'Tourism · Historic centre and monuments',
      es: 'Turismo · Centro histórico y monumentos',
      fr: 'Tourisme · Centre historique et monuments',
    },
    texto: {
      pt: `${AVISO.pt}

O centro histórico de Guimarães é Património Mundial da UNESCO desde 2001. Guimarães é conhecida como o berço de Portugal: está ligada ao nascimento do reino e a D. Afonso Henriques, o primeiro rei. O centro faz-se bem a pé; as ruas são de calçada e há algumas subidas.

${S('castelo', 'pt')}
O que é: castelo medieval no Monte Latito, com origem no século X, símbolo da fundação de Portugal.
Horário e preço: consulte no local ou no site oficial.
Acessibilidade: recinto com calçada e escadas; o acesso às muralhas e à torre é só por escadas.
Como chegar: a pé a partir do Largo da Oliveira, cerca de 10 minutos a subir pela Rua de Santa Maria.

${S('paco', 'pt')}
O que é: palácio do século XV mandado construir por D. Afonso, primeiro duque de Bragança. Hoje é museu, com mobiliário, tapeçarias e pinturas.
Horário e preço: consulte no local ou no site oficial.
Acessibilidade: a confirmar com o monumento (pergunte pelo acesso para pessoas com mobilidade reduzida).
Como chegar: fica ao lado do castelo, no Monte Latito.

${S('sao_miguel', 'pt')}
O que é: pequena igreja românica entre o castelo e o paço. Diz a tradição que D. Afonso Henriques foi batizado aqui.
Acessibilidade: relva e calçada à volta.

${S('santa_maria', 'pt')}
O que é: uma das ruas mais antigas da cidade; liga o centro ao castelo, com casas medievais e varandas de granito.
Acessibilidade: calçada irregular e subida.

${S('oliveira', 'pt')}
O que é: o coração do centro histórico, com a Igreja de Nossa Senhora da Oliveira e o Padrão do Salado, monumento gótico do século XIV.
Acessibilidade: largo plano, de calçada.

${S('santiago', 'pt')}
O que é: praça medieval ao lado do Largo da Oliveira, com casas de varandas de madeira e esplanadas.
Acessibilidade: praça plana, de calçada.

${S('toural', 'pt')}
O que é: a praça central da cidade. Perto fica o troço de muralha com a inscrição «Aqui nasceu Portugal».
Acessibilidade: largo plano.

${S('couros', 'pt')}
O que é: antiga zona dos curtumes, junto ao rio de Couros, com os tanques onde se curtiam as peles. Foi incluída no Património Mundial em 2023.
Acessibilidade: ruas com algum declive.`,
      en: `${AVISO.en}

The historic centre of Guimarães has been a UNESCO World Heritage Site since 2001. Guimarães is known as the birthplace of Portugal: it is linked to the founding of the kingdom and to Afonso Henriques, the first king. The centre is easy to explore on foot; streets are cobbled and there are some slopes.

${S('castelo', 'en')}
What it is: a medieval castle on Latito Hill, dating back to the 10th century, a symbol of the founding of Portugal.
Opening hours and price: check on site or on the official website.
Accessibility: cobbled grounds and stairs; the walls and the keep are reached by stairs only.
Getting there: on foot from Largo da Oliveira, about 10 minutes uphill along Rua de Santa Maria.

${S('paco', 'en')}
What it is: a 15th-century palace built by Afonso, first Duke of Braganza. Today it is a museum with furniture, tapestries and paintings.
Opening hours and price: check on site or on the official website.
Accessibility: to be confirmed with the monument (ask about access for people with reduced mobility).
Getting there: next to the castle, on Latito Hill.

${S('sao_miguel', 'en')}
What it is: a small Romanesque church between the castle and the palace. Tradition says Afonso Henriques was baptised here.
Accessibility: grass and cobbles around it.

${S('santa_maria', 'en')}
What it is: one of the oldest streets in town, linking the centre to the castle, with medieval houses and granite balconies.
Accessibility: uneven cobbles and uphill.

${S('oliveira', 'en')}
What it is: the heart of the historic centre, with the Church of Our Lady of the Olive Tree and the Padrão do Salado, a 14th-century Gothic monument.
Accessibility: flat, cobbled square.

${S('santiago', 'en')}
What it is: a medieval square next to Largo da Oliveira, with wooden-balconied houses and outdoor cafés.
Accessibility: flat, cobbled square.

${S('toural', 'en')}
What it is: the main square of the city. Nearby is the stretch of the old wall with the words "Aqui nasceu Portugal" (Portugal was born here).
Accessibility: flat square.

${S('couros', 'en')}
What it is: the old tanning district by the Couros river, with the tanks where hides were tanned. It was added to the World Heritage Site in 2023.
Accessibility: some sloping streets.`,
      es: `${AVISO.es}

El centro histórico de Guimarães es Patrimonio de la Humanidad de la UNESCO desde 2001. Guimarães es conocida como la cuna de Portugal: está ligada al nacimiento del reino y a Afonso Henriques, el primer rey. El centro se recorre bien a pie; las calles son empedradas y hay algunas cuestas.

${S('castelo', 'es')}
Qué es: castillo medieval en el Monte Latito, con origen en el siglo X, símbolo de la fundación de Portugal.
Horario y precio: consulte en el lugar o en la web oficial.
Accesibilidad: recinto empedrado y con escaleras; a las murallas y a la torre solo se sube por escaleras.
Cómo llegar: a pie desde el Largo da Oliveira, unos 10 minutos de subida por la Rua de Santa Maria.

${S('paco', 'es')}
Qué es: palacio del siglo XV mandado construir por Afonso, primer duque de Braganza. Hoy es museo, con mobiliario, tapices y pinturas.
Horario y precio: consulte en el lugar o en la web oficial.
Accesibilidad: por confirmar con el monumento (pregunte por el acceso para personas con movilidad reducida).
Cómo llegar: junto al castillo, en el Monte Latito.

${S('sao_miguel', 'es')}
Qué es: pequeña iglesia románica entre el castillo y el palacio. Según la tradición, Afonso Henriques fue bautizado aquí.
Accesibilidad: césped y empedrado alrededor.

${S('santa_maria', 'es')}
Qué es: una de las calles más antiguas de la ciudad; une el centro con el castillo, con casas medievales y balcones de granito.
Accesibilidad: empedrado irregular y cuesta arriba.

${S('oliveira', 'es')}
Qué es: el corazón del centro histórico, con la Iglesia de Nuestra Señora de la Oliveira y el Padrão do Salado, monumento gótico del siglo XIV.
Accesibilidad: plaza llana, empedrada.

${S('santiago', 'es')}
Qué es: plaza medieval junto al Largo da Oliveira, con casas de balcones de madera y terrazas.
Accesibilidad: plaza llana, empedrada.

${S('toural', 'es')}
Qué es: la plaza central de la ciudad. Cerca está el tramo de muralla con la inscripción «Aqui nasceu Portugal» (Aquí nació Portugal).
Accesibilidad: plaza llana.

${S('couros', 'es')}
Qué es: antigua zona de curtidurías junto al río Couros, con los tanques donde se curtían las pieles. Se incluyó en el Patrimonio de la Humanidad en 2023.
Accesibilidad: calles con cierta pendiente.`,
      fr: `${AVISO.fr}

Le centre historique de Guimarães est inscrit au patrimoine mondial de l'UNESCO depuis 2001. Guimarães est connue comme le berceau du Portugal : elle est liée à la naissance du royaume et à Afonso Henriques, le premier roi. Le centre se visite facilement à pied ; les rues sont pavées et il y a quelques montées.

${S('castelo', 'fr')}
Ce que c'est : château médiéval sur le mont Latito, dont l'origine remonte au Xe siècle, symbole de la fondation du Portugal.
Horaires et tarif : renseignez-vous sur place ou sur le site officiel.
Accessibilité : enceinte pavée avec des marches ; les remparts et le donjon ne sont accessibles que par des escaliers.
Comment y aller : à pied depuis le Largo da Oliveira, environ 10 minutes de montée par la Rua de Santa Maria.

${S('paco', 'fr')}
Ce que c'est : palais du XVe siècle construit par Afonso, premier duc de Bragance. C'est aujourd'hui un musée, avec du mobilier, des tapisseries et des peintures.
Horaires et tarif : renseignez-vous sur place ou sur le site officiel.
Accessibilité : à confirmer auprès du monument (demandez l'accès pour les personnes à mobilité réduite).
Comment y aller : à côté du château, sur le mont Latito.

${S('sao_miguel', 'fr')}
Ce que c'est : petite église romane entre le château et le palais. Selon la tradition, Afonso Henriques y a été baptisé.
Accessibilité : pelouse et pavés autour.

${S('santa_maria', 'fr')}
Ce que c'est : l'une des plus anciennes rues de la ville ; elle relie le centre au château, avec des maisons médiévales et des balcons en granit.
Accessibilité : pavés irréguliers et montée.

${S('oliveira', 'fr')}
Ce que c'est : le cœur du centre historique, avec l'église Notre-Dame de l'Olivier et le Padrão do Salado, monument gothique du XIVe siècle.
Accessibilité : place plate et pavée.

${S('santiago', 'fr')}
Ce que c'est : place médiévale à côté du Largo da Oliveira, avec des maisons à balcons en bois et des terrasses.
Accessibilité : place plate et pavée.

${S('toural', 'fr')}
Ce que c'est : la place centrale de la ville. Tout près se trouve le pan de muraille portant l'inscription « Aqui nasceu Portugal » (Ici est né le Portugal).
Accessibilité : place plate.

${S('couros', 'fr')}
Ce que c'est : l'ancien quartier des tanneries, au bord de la rivière Couros, avec les bassins où l'on tannait les peaux. Il a été ajouté au patrimoine mondial en 2023.
Accessibilité : rues en légère pente.`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'museus',
    ordem: 2,
    pontos: [
      'alberto_sampaio',
      'martins_sarmento',
      'ciajg',
      'casa_memoria',
      'citania',
    ],
    titulo: {
      pt: 'Turismo · Museus',
      en: 'Tourism · Museums',
      es: 'Turismo · Museos',
      fr: 'Tourisme · Musées',
    },
    texto: {
      pt: `${AVISO.pt}

${S('alberto_sampaio', 'pt')}
O que é: museu de arte sacra e decorativa, nos edifícios da antiga Colegiada de Nossa Senhora da Oliveira, no Largo da Oliveira.
Horário e preço: consulte no local ou no site oficial.
Acessibilidade: a confirmar com o museu.

${S('martins_sarmento', 'pt')}
O que é: museu de arqueologia, com peças da Citânia de Briteiros e de outros castros do Noroeste.
Horário e preço: consulte no local ou no site oficial.
Acessibilidade: a confirmar com o museu.

${S('ciajg', 'pt')}
O que é: centro de arte contemporânea com a coleção do artista José de Guimarães e exposições temporárias.
Horário e preço: consulte no local ou no site oficial.
Acessibilidade: a confirmar com o centro.

${S('casa_memoria', 'pt')}
O que é: centro de interpretação da história e das tradições de Guimarães.
Horário e preço: consulte no local ou no site oficial.

${S('citania', 'pt')}
O que é: povoado fortificado da Idade do Ferro (castro), a cerca de 15 km do centro.
Como chegar: de carro ou de táxi; pergunte no posto de turismo pelos transportes públicos.
Acessibilidade: terreno irregular, com pedra e desníveis.`,
      en: `${AVISO.en}

${S('alberto_sampaio', 'en')}
What it is: a museum of sacred and decorative art, in the buildings of the former Collegiate Church of Our Lady of the Olive Tree, on Largo da Oliveira.
Opening hours and price: check on site or on the official website.
Accessibility: to be confirmed with the museum.

${S('martins_sarmento', 'en')}
What it is: an archaeology museum with finds from Citânia de Briteiros and other hillforts of north-west Portugal.
Opening hours and price: check on site or on the official website.
Accessibility: to be confirmed with the museum.

${S('ciajg', 'en')}
What it is: a contemporary art centre with the collection of the artist José de Guimarães and temporary exhibitions.
Opening hours and price: check on site or on the official website.
Accessibility: to be confirmed with the centre.

${S('casa_memoria', 'en')}
What it is: an interpretation centre about the history and traditions of Guimarães.
Opening hours and price: check on site or on the official website.

${S('citania', 'en')}
What it is: a fortified Iron Age settlement (hillfort), about 15 km from the centre.
Getting there: by car or taxi; ask the tourist office about public transport.
Accessibility: uneven, stony ground.`,
      es: `${AVISO.es}

${S('alberto_sampaio', 'es')}
Qué es: museo de arte sacro y decorativo, en los edificios de la antigua Colegiata de Nuestra Señora de la Oliveira, en el Largo da Oliveira.
Horario y precio: consulte en el lugar o en la web oficial.
Accesibilidad: por confirmar con el museo.

${S('martins_sarmento', 'es')}
Qué es: museo de arqueología, con piezas de la Citânia de Briteiros y de otros castros del noroeste.
Horario y precio: consulte en el lugar o en la web oficial.
Accesibilidad: por confirmar con el museo.

${S('ciajg', 'es')}
Qué es: centro de arte contemporáneo con la colección del artista José de Guimarães y exposiciones temporales.
Horario y precio: consulte en el lugar o en la web oficial.
Accesibilidad: por confirmar con el centro.

${S('casa_memoria', 'es')}
Qué es: centro de interpretación de la historia y las tradiciones de Guimarães.
Horario y precio: consulte en el lugar o en la web oficial.

${S('citania', 'es')}
Qué es: poblado fortificado de la Edad del Hierro (castro), a unos 15 km del centro.
Cómo llegar: en coche o en taxi; pregunte en la oficina de turismo por el transporte público.
Accesibilidad: terreno irregular, con piedras y desniveles.`,
      fr: `${AVISO.fr}

${S('alberto_sampaio', 'fr')}
Ce que c'est : musée d'art sacré et décoratif, dans les bâtiments de l'ancienne collégiale Notre-Dame de l'Olivier, sur le Largo da Oliveira.
Horaires et tarif : renseignez-vous sur place ou sur le site officiel.
Accessibilité : à confirmer auprès du musée.

${S('martins_sarmento', 'fr')}
Ce que c'est : musée d'archéologie, avec des pièces de la Citânia de Briteiros et d'autres sites fortifiés du nord-ouest.
Horaires et tarif : renseignez-vous sur place ou sur le site officiel.
Accessibilité : à confirmer auprès du musée.

${S('ciajg', 'fr')}
Ce que c'est : centre d'art contemporain avec la collection de l'artiste José de Guimarães et des expositions temporaires.
Horaires et tarif : renseignez-vous sur place ou sur le site officiel.
Accessibilité : à confirmer auprès du centre.

${S('casa_memoria', 'fr')}
Ce que c'est : centre d'interprétation de l'histoire et des traditions de Guimarães.
Horaires et tarif : renseignez-vous sur place ou sur le site officiel.

${S('citania', 'fr')}
Ce que c'est : village fortifié de l'âge du fer, à environ 15 km du centre.
Comment y aller : en voiture ou en taxi ; demandez à l'office de tourisme pour les transports publics.
Accessibilité : terrain irrégulier et pierreux.`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'penha',
    ordem: 3,
    pontos: ['teleferico', 'penha'],
    titulo: {
      pt: 'Turismo · Penha e teleférico',
      en: 'Tourism · Penha and the cable car',
      es: 'Turismo · La Penha y el teleférico',
      fr: 'Tourisme · La Penha et le téléphérique',
    },
    texto: {
      pt: `${AVISO.pt}

${S('teleferico', 'pt')}
O que é: liga a cidade (junto ao Parque das Hortas) ao Monte da Penha, com vista sobre Guimarães.
Horário e preço: funciona em parte do ano; consulte no local ou no site oficial.
Acessibilidade: a confirmar com o operador.

${S('penha', 'pt')}
O que é: o ponto mais alto da cidade, com o santuário, grutas, trilhos e parque de merendas.
Como chegar: de teleférico, de carro ou a pé por trilhos (subida longa).
Acessibilidade: parte das zonas tem caminhos de terra e escadas.`,
      en: `${AVISO.en}

${S('teleferico', 'en')}
What it is: links the city (next to Parque das Hortas) to Penha Mountain, with views over Guimarães.
Opening hours and price: runs part of the year; check on site or on the official website.
Accessibility: to be confirmed with the operator.

${S('penha', 'en')}
What it is: the highest point of the city, with the sanctuary, caves, trails and a picnic park.
Getting there: by cable car, by car or on foot along trails (long climb).
Accessibility: some areas have dirt paths and steps.`,
      es: `${AVISO.es}

${S('teleferico', 'es')}
Qué es: une la ciudad (junto al Parque das Hortas) con el Monte de la Penha, con vistas sobre Guimarães.
Horario y precio: funciona parte del año; consulte en el lugar o en la web oficial.
Accesibilidad: por confirmar con el operador.

${S('penha', 'es')}
Qué es: el punto más alto de la ciudad, con el santuario, grutas, senderos y zona de merendero.
Cómo llegar: en teleférico, en coche o a pie por senderos (subida larga).
Accesibilidad: algunas zonas tienen caminos de tierra y escaleras.`,
      fr: `${AVISO.fr}

${S('teleferico', 'fr')}
Ce que c'est : relie la ville (près du Parque das Hortas) au mont de la Penha, avec vue sur Guimarães.
Horaires et tarif : fonctionne une partie de l'année ; renseignez-vous sur place ou sur le site officiel.
Accessibilité : à confirmer auprès de l'exploitant.

${S('penha', 'fr')}
Ce que c'est : le point le plus haut de la ville, avec le sanctuaire, des grottes, des sentiers et une aire de pique-nique.
Comment y aller : en téléphérique, en voiture ou à pied par les sentiers (longue montée).
Accessibilité : certaines zones ont des chemins de terre et des marches.`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'percursos',
    ordem: 4,
    titulo: {
      pt: 'Turismo · Percursos a pé',
      en: 'Tourism · Walking routes',
      es: 'Turismo · Rutas a pie',
      fr: 'Tourisme · Itinéraires à pied',
    },
    texto: {
      pt: `${AVISO.pt}

## Duas horas no centro histórico
Largo do Toural, Largo da Oliveira e Praça de Santiago, Rua de Santa Maria, Paço dos Duques e Castelo. Cerca de 2 km, com subida no fim. Tempos estimados (demonstração).

## Meio dia: história e museus
O percurso de duas horas, mais o Museu de Alberto Sampaio e a Zona de Couros. Termine com uma pausa para provar os doces conventuais.

## Dia inteiro: cidade e Penha
De manhã o centro histórico; à tarde, teleférico até à Penha e regresso ao fim do dia.

## Percurso com menos degraus
Para quem tem mobilidade reduzida ou leva carrinho de bebé: o Largo do Toural, o Largo da Oliveira e a Praça de Santiago são planos (de calçada). A subida ao castelo é íngreme; de carro ou de táxi pode chegar perto do Paço dos Duques. Confirme os acessos no posto de turismo.`,
      en: `${AVISO.en}

## Two hours in the historic centre
Largo do Toural, Largo da Oliveira and Praça de Santiago, Rua de Santa Maria, the Palace of the Dukes and the Castle. About 2 km, uphill at the end. Estimated times (demonstration).

## Half a day: history and museums
The two-hour route, plus the Alberto Sampaio Museum and the Couros district. End with a break to taste the convent sweets.

## A full day: the city and Penha
The historic centre in the morning; in the afternoon, the cable car up to Penha and back at the end of the day.

## Step-free route
For people with reduced mobility or with a pushchair: Largo do Toural, Largo da Oliveira and Praça de Santiago are flat (cobbled). The climb to the castle is steep; by car or taxi you can get close to the Palace of the Dukes. Check access at the tourist office.`,
      es: `${AVISO.es}

## Dos horas en el centro histórico
Largo do Toural, Largo da Oliveira y Praça de Santiago, Rua de Santa Maria, el Palacio de los Duques y el Castillo. Unos 2 km, con subida al final. Tiempos estimados (demostración).

## Medio día: historia y museos
La ruta de dos horas, más el Museo de Alberto Sampaio y la Zona de Couros. Termine con una pausa para probar los dulces conventuales.

## Un día entero: la ciudad y la Penha
Por la mañana el centro histórico; por la tarde, teleférico hasta la Penha y vuelta al final del día.

## Ruta con menos escalones
Para personas con movilidad reducida o con carrito de bebé: el Largo do Toural, el Largo da Oliveira y la Praça de Santiago son llanos (empedrados). La subida al castillo es empinada; en coche o taxi puede llegar cerca del Palacio de los Duques. Confirme los accesos en la oficina de turismo.`,
      fr: `${AVISO.fr}

## Deux heures dans le centre historique
Largo do Toural, Largo da Oliveira et Praça de Santiago, Rua de Santa Maria, le Palais des Ducs et le Château. Environ 2 km, avec une montée à la fin. Durées estimées (démonstration).

## Une demi-journée : histoire et musées
L'itinéraire de deux heures, plus le musée Alberto Sampaio et le quartier de Couros. Terminez par une pause pour goûter les douceurs conventuelles.

## Une journée entière : la ville et la Penha
Le centre historique le matin ; l'après-midi, le téléphérique jusqu'à la Penha et retour en fin de journée.

## Itinéraire avec moins de marches
Pour les personnes à mobilité réduite ou avec une poussette : le Largo do Toural, le Largo da Oliveira et la Praça de Santiago sont plats (pavés). La montée au château est raide ; en voiture ou en taxi on peut s'approcher du Palais des Ducs. Vérifiez les accès à l'office de tourisme.`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'eventos',
    ordem: 5,
    titulo: {
      pt: 'Turismo · Festas e eventos',
      en: 'Tourism · Festivals and events',
      es: 'Turismo · Fiestas y eventos',
      fr: 'Tourisme · Fêtes et événements',
    },
    texto: {
      pt: `${AVISO.pt}

## Eventos dos próximos dias
Os eventos, as obras e os avisos dos próximos dias estão na página «O que se passa» da câmara e na página Visitar. Pergunte ao assistente o que há hoje ou neste fim de semana.

## Festas da Cidade e Gualterianas
Festas em honra de São Gualter, no início de agosto, com a Marcha Gualteriana, música e feira. Datas exatas e programa: site oficial.

## Festas Nicolinas
Festas dos estudantes, entre o fim de novembro e 7 de dezembro, com o cortejo do Pinheiro e o toque das caixas e dos bombos. Programa: site oficial.

## Outros eventos
Ao longo do ano há festivais de música, teatro e jazz. Consulte a agenda cultural no site oficial (fonte a confirmar).`,
      en: `${AVISO.en}

## Events in the coming days
Events, roadworks and notices for the coming days are on the council's "What's on" page and on the Visit page. Ask the assistant what is on today or this weekend.

## City Festivities and Gualterianas
Festivities in honour of Saint Gualter, in early August, with the Marcha Gualteriana parade, music and a fair. Exact dates and programme: official website.

## Nicolinas Festivities
Student festivities from the end of November to 7 December, with the Pinheiro (pine tree) procession and the beating of snare and bass drums. Programme: official website.

## Other events
Throughout the year there are music, theatre and jazz festivals. Check the cultural agenda on the official website (source to be confirmed).`,
      es: `${AVISO.es}

## Eventos de los próximos días
Los eventos, las obras y los avisos de los próximos días están en la página «Qué pasa» del ayuntamiento y en la página Visitar. Pregunte al asistente qué hay hoy o este fin de semana.

## Fiestas de la Ciudad y Gualterianas
Fiestas en honor de San Gualter, a principios de agosto, con la Marcha Gualteriana, música y feria. Fechas exactas y programa: web oficial.

## Fiestas Nicolinas
Fiestas de los estudiantes, entre finales de noviembre y el 7 de diciembre, con el desfile del Pinheiro (pino) y el toque de cajas y bombos. Programa: web oficial.

## Otros eventos
A lo largo del año hay festivales de música, teatro y jazz. Consulte la agenda cultural en la web oficial (fuente por confirmar).`,
      fr: `${AVISO.fr}

## Événements des prochains jours
Les événements, les travaux et les avis des prochains jours sont sur la page « Ce qui se passe » de la mairie et sur la page Visiter. Demandez à l'assistant ce qu'il y a aujourd'hui ou ce week-end.

## Fêtes de la Ville et Gualterianas
Fêtes en l'honneur de saint Gualter, début août, avec la Marcha Gualteriana (défilé), de la musique et une foire. Dates exactes et programme : site officiel.

## Fêtes Nicolinas
Fêtes des étudiants, de fin novembre au 7 décembre, avec le cortège du Pinheiro (le pin) et les tambours. Programme : site officiel.

## Autres événements
Tout au long de l'année, il y a des festivals de musique, de théâtre et de jazz. Consultez l'agenda culturel sur le site officiel (source à confirmer).`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'transportes',
    ordem: 6,
    titulo: {
      pt: 'Turismo · Como chegar e circular',
      en: 'Tourism · Getting here and around',
      es: 'Turismo · Cómo llegar y moverse',
      fr: 'Tourisme · Venir et se déplacer',
    },
    texto: {
      pt: `${AVISO.pt}

## Comboio de e para o Porto
Há comboios entre o Porto (estações de São Bento e Campanhã) e Guimarães; a viagem demora cerca de uma hora a uma hora e um quarto. Horários e bilhetes: site da CP. A estação de Guimarães fica a cerca de 10 a 15 minutos a pé do centro histórico.

## Aeroporto do Porto
O Aeroporto Francisco Sá Carneiro fica a cerca de 50 km. Há autocarros e serviços de transfer; horários e preços com as operadoras.

## Autocarros
Autocarros urbanos ligam o centro aos bairros e à Penha; autocarros expresso ligam a outras cidades. Horários: site do operador ou posto de turismo.

## Estacionamento
O centro histórico tem trânsito limitado. Há parques de estacionamento à volta do centro; preços e horários no local.

## Teleférico
O teleférico liga a cidade ao Monte da Penha. Funciona em parte do ano; confirme o horário.

## Táxis
Há praças de táxis no centro e junto à estação.`,
      en: `${AVISO.en}

## Train to and from Porto
Trains run between Porto (São Bento and Campanhã stations) and Guimarães; the journey takes about one hour to one hour and a quarter. Timetables and tickets: CP (Portuguese Railways) website. Guimarães station is about a 10 to 15 minute walk from the historic centre.

## Porto Airport
Francisco Sá Carneiro Airport is about 50 km away. There are buses and transfer services; timetables and prices from the operators.

## Buses
City buses link the centre to the neighbourhoods and to Penha; express coaches link to other cities. Timetables: operator's website or tourist office.

## Parking
Traffic is restricted in the historic centre. There are car parks around the centre; prices and opening hours on site.

## Cable car
The cable car links the city to Penha Mountain. It runs part of the year; check the timetable.

## Taxis
There are taxi ranks in the centre and next to the station.`,
      es: `${AVISO.es}

## Tren desde y hacia Oporto
Hay trenes entre Oporto (estaciones de São Bento y Campanhã) y Guimarães; el viaje dura entre una hora y una hora y cuarto. Horarios y billetes: web de CP (trenes de Portugal). La estación de Guimarães está a unos 10 a 15 minutos a pie del centro histórico.

## Aeropuerto de Oporto
El Aeropuerto Francisco Sá Carneiro está a unos 50 km. Hay autobuses y servicios de traslado; horarios y precios con las empresas.

## Autobuses
Los autobuses urbanos unen el centro con los barrios y la Penha; los autobuses exprés unen con otras ciudades. Horarios: web del operador u oficina de turismo.

## Aparcamiento
El centro histórico tiene tráfico limitado. Hay aparcamientos alrededor del centro; precios y horarios en el lugar.

## Teleférico
El teleférico une la ciudad con el Monte de la Penha. Funciona parte del año; confirme el horario.

## Taxis
Hay paradas de taxi en el centro y junto a la estación.`,
      fr: `${AVISO.fr}

## Train depuis et vers Porto
Des trains relient Porto (gares de São Bento et Campanhã) à Guimarães ; le trajet dure environ une heure à une heure et quart. Horaires et billets : site de la CP (chemins de fer portugais). La gare de Guimarães est à environ 10 à 15 minutes à pied du centre historique.

## Aéroport de Porto
L'aéroport Francisco Sá Carneiro est à environ 50 km. Il y a des bus et des navettes ; horaires et tarifs auprès des compagnies.

## Bus
Les bus urbains relient le centre aux quartiers et à la Penha ; des cars express relient d'autres villes. Horaires : site de l'exploitant ou office de tourisme.

## Stationnement
La circulation est limitée dans le centre historique. Il y a des parkings autour du centre ; tarifs et horaires sur place.

## Téléphérique
Le téléphérique relie la ville au mont de la Penha. Il fonctionne une partie de l'année ; vérifiez les horaires.

## Taxis
Il y a des stations de taxis dans le centre et près de la gare.`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'comer',
    ordem: 7,
    titulo: {
      pt: 'Turismo · Comer e provar',
      en: 'Tourism · Local food',
      es: 'Turismo · Comer y probar',
      fr: 'Tourisme · Gastronomie locale',
    },
    texto: {
      pt: `${AVISO.pt}

## Doces conventuais
O toucinho do céu e as tortas de Guimarães são doces tradicionais da cidade, à venda em pastelarias do centro.

## Pratos típicos
Rojões à minhota, caldo verde e bacalhau. Para beber, vinho verde da região.

## Onde comer
Há restaurantes e esplanadas no centro histórico, sobretudo à volta do Largo da Oliveira e da Praça de Santiago. A câmara não recomenda estabelecimentos em particular.`,
      en: `${AVISO.en}

## Convent sweets
Toucinho do céu (an almond cake) and tortas de Guimarães (pastries with a sweet filling) are traditional sweets of the city, sold in pastry shops in the centre.

## Typical dishes
Rojões à minhota (marinated pork), caldo verde (kale soup) and bacalhau (salt cod). To drink, the region's vinho verde.

## Where to eat
There are restaurants and outdoor cafés in the historic centre, especially around Largo da Oliveira and Praça de Santiago. The council does not recommend any particular establishment.`,
      es: `${AVISO.es}

## Dulces conventuales
El toucinho do céu (pastel de almendra) y las tortas de Guimarães (pasteles rellenos) son dulces tradicionales de la ciudad, a la venta en pastelerías del centro.

## Platos típicos
Rojões à minhota (cerdo adobado), caldo verde (sopa de col) y bacalao. Para beber, vinho verde de la región.

## Dónde comer
Hay restaurantes y terrazas en el centro histórico, sobre todo alrededor del Largo da Oliveira y la Praça de Santiago. El ayuntamiento no recomienda ningún establecimiento en particular.`,
      fr: `${AVISO.fr}

## Douceurs conventuelles
Le toucinho do céu (gâteau aux amandes) et les tortas de Guimarães (pâtisseries fourrées) sont des douceurs traditionnelles de la ville, vendues dans les pâtisseries du centre.

## Plats typiques
Rojões à minhota (porc mariné), caldo verde (soupe au chou) et bacalhau (morue). À boire, le vinho verde de la région.

## Où manger
Il y a des restaurants et des terrasses dans le centre historique, surtout autour du Largo da Oliveira et de la Praça de Santiago. La mairie ne recommande aucun établissement en particulier.`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'posto_turismo',
    ordem: 8,
    titulo: {
      pt: 'Turismo · Posto de turismo e visitas guiadas',
      en: 'Tourism · Tourist office and guided tours',
      es: 'Turismo · Oficina de turismo y visitas guiadas',
      fr: 'Tourisme · Office de tourisme et visites guidées',
    },
    texto: {
      pt: `${AVISO.pt}

## Posto de turismo
O posto de turismo dá informação, mapas e marca visitas guiadas. Morada, horário e contactos: consulte o site oficial (fonte a confirmar).

## Visitas guiadas
Há visitas guiadas ao centro histórico; inscrição e horários no posto de turismo.

## Sites oficiais
Site da Câmara Municipal (cm-guimaraes.pt) e a informação turística da câmara. Fonte a confirmar com o turismo da câmara.`,
      en: `${AVISO.en}

## Tourist office
The tourist office provides information and maps and books guided tours. Address, opening hours and contacts: check the official website (source to be confirmed).

## Guided tours
There are guided tours of the historic centre; booking and times at the tourist office.

## Official websites
The City Council website (cm-guimaraes.pt) and the council's tourist information. Source to be confirmed with the municipal tourism office.`,
      es: `${AVISO.es}

## Oficina de turismo
La oficina de turismo da información y mapas y reserva visitas guiadas. Dirección, horario y contactos: consulte la web oficial (fuente por confirmar).

## Visitas guiadas
Hay visitas guiadas al centro histórico; inscripción y horarios en la oficina de turismo.

## Webs oficiales
La web del Ayuntamiento (cm-guimaraes.pt) y la información turística del ayuntamiento. Fuente por confirmar con la oficina de turismo.`,
      fr: `${AVISO.fr}

## Office de tourisme
L'office de tourisme donne des informations et des plans et réserve les visites guidées. Adresse, horaires et contacts : consultez le site officiel (source à confirmer).

## Visites guidées
Il y a des visites guidées du centre historique ; inscription et horaires à l'office de tourisme.

## Sites officiels
Le site de la mairie (cm-guimaraes.pt) et les informations touristiques de la mairie. Source à confirmer avec l'office de tourisme.`,
    },
  },
  // -------------------------------------------------------------------
  {
    tema: 'saude_emergencia',
    ordem: 9,
    titulo: {
      pt: 'Turismo · Saúde e emergências',
      en: 'Tourism · Health and emergencies',
      es: 'Turismo · Salud y emergencias',
      fr: 'Tourisme · Santé et urgences',
    },
    texto: {
      pt: `${AVISO.pt}

## Emergência: 112
Em caso de perigo, acidente, incêndio ou alguém ferido, ligue 112. É o número europeu de emergência, gratuito, a partir de qualquer telefone.

## Saúde: SNS 24
Para aconselhamento de saúde quando não é uma emergência, ligue para a linha SNS 24: 808 24 24 24.

## Hospital
O Hospital da Senhora da Oliveira, em Guimarães, tem urgência. Em caso grave, ligue 112.

## Farmácias
Há farmácias no centro. A farmácia de serviço à noite está afixada na porta de cada farmácia.

## Roubo ou perda de documentos
Dirija-se à polícia (PSP). Se for estrangeiro, contacte também a embaixada ou o consulado do seu país.`,
      en: `${AVISO.en}

## Emergency: 112
In case of danger, an accident, a fire or someone injured, call 112. It is the European emergency number, free from any phone.

## Health: SNS 24
For health advice when it is not an emergency, call the SNS 24 line (Portuguese national health service): 808 24 24 24.

## Hospital
Hospital da Senhora da Oliveira, in Guimarães, has an emergency department. If it is serious, call 112.

## Pharmacies
There are pharmacies in the centre. The pharmacy open at night is posted on the door of every pharmacy.

## Theft or lost documents
Go to the police (PSP). If you are a foreign visitor, also contact your country's embassy or consulate.`,
      es: `${AVISO.es}

## Emergencias: 112
En caso de peligro, accidente, incendio o alguien herido, llame al 112. Es el número europeo de emergencias, gratuito desde cualquier teléfono.

## Salud: SNS 24
Para consejos de salud cuando no es una emergencia, llame a la línea SNS 24 (servicio nacional de salud portugués): 808 24 24 24.

## Hospital
El Hospital da Senhora da Oliveira, en Guimarães, tiene urgencias. Si es grave, llame al 112.

## Farmacias
Hay farmacias en el centro. La farmacia de guardia por la noche está indicada en la puerta de cada farmacia.

## Robo o pérdida de documentos
Diríjase a la policía (PSP). Si es extranjero, contacte también con la embajada o el consulado de su país.`,
      fr: `${AVISO.fr}

## Urgences : 112
En cas de danger, d'accident, d'incendie ou de personne blessée, appelez le 112. C'est le numéro d'urgence européen, gratuit depuis n'importe quel téléphone.

## Santé : SNS 24
Pour un conseil de santé quand ce n'est pas une urgence, appelez la ligne SNS 24 (service national de santé portugais) : 808 24 24 24.

## Hôpital
L'Hospital da Senhora da Oliveira, à Guimarães, dispose d'un service d'urgences. Si c'est grave, appelez le 112.

## Pharmacies
Il y a des pharmacies dans le centre. La pharmacie de garde la nuit est affichée sur la porte de chaque pharmacie.

## Vol ou perte de documents
Adressez-vous à la police (PSP). Si vous êtes étranger, contactez aussi l'ambassade ou le consulat de votre pays.`,
    },
  },
];

/** Endereço único de cada fonte (o site oficial, a confirmar, com uma âncora). */
export function urlFonteDemo(tema: string, lingua: Lingua): string {
  return `${SITE_OFICIAL}#turismo-demonstracao-${tema}-${lingua}`;
}
