/*
 * Textos da interface da página /visitar (e do cartão de roteiro no chat) em
 * português, inglês, espanhol e francês. O conteúdo turístico em si vem das
 * fontes da câmara (API), já na língua escolhida.
 */

export const LINGUAS = ["pt", "en", "es", "fr"] as const;
export type Lingua = (typeof LINGUAS)[number];

export const NOME_LINGUA: Record<Lingua, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
  fr: "Français",
};

/** Código BCP 47 para o atributo `lang` e para o chat. */
export const CODIGO_LINGUA: Record<Lingua, string> = {
  pt: "pt-PT",
  en: "en",
  es: "es",
  fr: "fr",
};

export function linguaValida(v: string | null | undefined): Lingua | null {
  const base = (v ?? "").toLowerCase().split(/[-_]/)[0];
  return (LINGUAS as readonly string[]).includes(base) ? (base as Lingua) : null;
}

export interface Textos {
  titulo: (municipio: string) => string;
  subtitulo: string;
  escolherLingua: string;
  demonstracao: string;
  avisoDemo: string;
  hoje: string;
  hojeVazio: string;
  eventosProximos: string;
  imperdiveis: string;
  roteiros: string;
  roteiro: Record<string, string>;
  minutos: (n: number) => string;
  duracao: (min: number) => string;
  chegada: (min: number) => string;
  acessibilidade: Record<"boa" | "parcial" | "dificil", string>;
  foraDoCentro: string;
  semDegraus: string;
  excluidos: (nomes: string) => string;
  mapa: string;
  mapaAjuda: string;
  verNoMapa: string;
  abrirMapa: string;
  saberMais: string;
  temas: string;
  fonte: (titulo: string, entidade: string) => string;
  verFonte: string;
  perguntar: string;
  perguntarAjuda: string;
  abrirChat: string;
  fecharChat: string;
  sugestoes: string[];
  saudacao: string;
  oQueSePassa: string;
  qr: string;
  emergencia: string;
  aCarregar: string;
  erro: string;
  tentar: string;
  vazio: string;
  quando: (inicio: string | null) => string | null;
  tituloQr: string;
  textoQr: string;
}

const data = (iso: string | null, locale: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  }).format(d);
};

const horas = (min: number, h: string, m: string) => {
  const hh = Math.floor(min / 60);
  const mm = Math.round(min % 60);
  if (!hh) return `${mm} ${m}`;
  return mm ? `${hh} ${h} ${mm} ${m}` : `${hh} ${h}`;
};

export const TEXTOS: Record<Lingua, Textos> = {
  pt: {
    titulo: (m) => `Visitar ${m}`,
    subtitulo: "O que ver, roteiros a pé, mapa e um assistente que responde na sua língua.",
    escolherLingua: "Língua",
    demonstracao: "Conteúdo de demonstração",
    avisoDemo:
      "Informação de demonstração, a confirmar com o turismo da câmara. Horários e preços: consulte no local ou no site oficial.",
    hoje: "O que ver hoje",
    hojeVazio: "Sem eventos marcados para os próximos dias. Veja os imperdíveis:",
    eventosProximos: "Eventos dos próximos dias",
    imperdiveis: "Imperdíveis",
    roteiros: "Roteiros a pé",
    roteiro: {
      duas_horas: "Duas horas no centro histórico",
      meio_dia: "Meio dia: história e museus",
      dia_inteiro: "Dia inteiro: cidade e Penha",
      sem_degraus: "Com menos degraus (mobilidade reduzida)",
    },
    minutos: (n) => `${n} min`,
    duracao: (min) => `cerca de ${horas(min, "h", "min")}`,
    chegada: (min) => (min ? `+${horas(min, "h", "min")}` : "início"),
    acessibilidade: { boa: "Acesso fácil", parcial: "Acesso com calçada ou degraus", dificil: "Acesso difícil (escadas)" },
    foraDoCentro: "Fora do centro (carro ou táxi)",
    semDegraus: "Com mobilidade reduzida",
    excluidos: (n) => `Fica de fora por ter acesso difícil: ${n}.`,
    mapa: "Mapa",
    mapaAjuda: "Os pontos e os eventos estão também nas listas desta página.",
    verNoMapa: "Ver no mapa",
    abrirMapa: "Abrir no mapa",
    saberMais: "Saber mais",
    temas: "Informação útil",
    fonte: (t, e) => `Fonte: ${t} · ${e}`,
    verFonte: "Ver a fonte",
    perguntar: "Pergunte ao assistente",
    perguntarAjuda: "Responde por escrito, a qualquer hora, na sua língua, com base na informação da câmara.",
    abrirChat: "Abrir o chat",
    fecharChat: "Fechar o chat",
    sugestoes: ["O que posso ver em duas horas?", "Como chego à Penha?", "O que há hoje?"],
    saudacao: "Olá! Sou o assistente da câmara. O que gostaria de visitar?",
    oQueSePassa: "Tudo o que se passa no concelho",
    qr: "Código QR para cartazes",
    emergencia: "Emergência: 112",
    aCarregar: "A carregar…",
    erro: "Não foi possível carregar a página.",
    tentar: "Tentar outra vez",
    vazio: "Ainda não há informação turística publicada.",
    quando: (i) => data(i, "pt-PT"),
    tituloQr: "Visite com o assistente da câmara.",
    textoQr: "Aponte a câmara do telemóvel: o que ver, roteiros, mapa e respostas na sua língua.",
  },
  en: {
    titulo: (m) => `Visit ${m}`,
    subtitulo: "What to see, walking routes, a map and an assistant that answers in your language.",
    escolherLingua: "Language",
    demonstracao: "Demonstration content",
    avisoDemo:
      "Demonstration information, to be confirmed with the municipal tourism office. Opening hours and prices: check on site or on the official website.",
    hoje: "What to see today",
    hojeVazio: "No events in the coming days. See the highlights:",
    eventosProximos: "Events in the coming days",
    imperdiveis: "Highlights",
    roteiros: "Walking routes",
    roteiro: {
      duas_horas: "Two hours in the historic centre",
      meio_dia: "Half a day: history and museums",
      dia_inteiro: "A full day: the city and Penha",
      sem_degraus: "Fewer steps (reduced mobility)",
    },
    minutos: (n) => `${n} min`,
    duracao: (min) => `about ${horas(min, "h", "min")}`,
    chegada: (min) => (min ? `+${horas(min, "h", "min")}` : "start"),
    acessibilidade: { boa: "Easy access", parcial: "Cobbles or some steps", dificil: "Difficult access (stairs)" },
    foraDoCentro: "Outside the centre (car or taxi)",
    semDegraus: "Reduced mobility",
    excluidos: (n) => `Left out because access is difficult: ${n}.`,
    mapa: "Map",
    mapaAjuda: "The places and events are also listed on this page.",
    verNoMapa: "Show on map",
    abrirMapa: "Open in map",
    saberMais: "Learn more",
    temas: "Useful information",
    fonte: (t, e) => `Source: ${t} · ${e}`,
    verFonte: "View source",
    perguntar: "Ask the assistant",
    perguntarAjuda: "Answers in writing, at any time, in your language, based on the council's information.",
    abrirChat: "Open the chat",
    fecharChat: "Close the chat",
    sugestoes: ["What can I see in two hours?", "How do I get to Penha?", "What's on today?"],
    saudacao: "Hello! I'm the council's assistant. What would you like to visit?",
    oQueSePassa: "Everything happening in the municipality (Portuguese)",
    qr: "QR code for posters",
    emergencia: "Emergency: 112",
    aCarregar: "Loading…",
    erro: "The page could not be loaded.",
    tentar: "Try again",
    vazio: "No tourist information has been published yet.",
    quando: (i) => data(i, "en-GB"),
    tituloQr: "Visit with the council's assistant.",
    textoQr: "Point your phone camera: what to see, routes, a map and answers in your language.",
  },
  es: {
    titulo: (m) => `Visitar ${m}`,
    subtitulo: "Qué ver, rutas a pie, mapa y un asistente que responde en su idioma.",
    escolherLingua: "Idioma",
    demonstracao: "Contenido de demostración",
    avisoDemo:
      "Información de demostración, pendiente de confirmar con la oficina de turismo del ayuntamiento. Horarios y precios: consulte en el lugar o en la web oficial.",
    hoje: "Qué ver hoy",
    hojeVazio: "No hay eventos en los próximos días. Vea lo imprescindible:",
    eventosProximos: "Eventos de los próximos días",
    imperdiveis: "Imprescindibles",
    roteiros: "Rutas a pie",
    roteiro: {
      duas_horas: "Dos horas en el centro histórico",
      meio_dia: "Medio día: historia y museos",
      dia_inteiro: "Un día entero: la ciudad y la Penha",
      sem_degraus: "Con menos escalones (movilidad reducida)",
    },
    minutos: (n) => `${n} min`,
    duracao: (min) => `unas ${horas(min, "h", "min")}`,
    chegada: (min) => (min ? `+${horas(min, "h", "min")}` : "inicio"),
    acessibilidade: { boa: "Acceso fácil", parcial: "Empedrado o algún escalón", dificil: "Acceso difícil (escaleras)" },
    foraDoCentro: "Fuera del centro (coche o taxi)",
    semDegraus: "Movilidad reducida",
    excluidos: (n) => `Se queda fuera por tener acceso difícil: ${n}.`,
    mapa: "Mapa",
    mapaAjuda: "Los lugares y los eventos también están en las listas de esta página.",
    verNoMapa: "Ver en el mapa",
    abrirMapa: "Abrir en el mapa",
    saberMais: "Saber más",
    temas: "Información útil",
    fonte: (t, e) => `Fuente: ${t} · ${e}`,
    verFonte: "Ver la fuente",
    perguntar: "Pregunte al asistente",
    perguntarAjuda: "Responde por escrito, a cualquier hora, en su idioma, con la información del ayuntamiento.",
    abrirChat: "Abrir el chat",
    fecharChat: "Cerrar el chat",
    sugestoes: ["¿Qué puedo ver en dos horas?", "¿Cómo llego a la Penha?", "¿Qué hay hoy?"],
    saudacao: "¡Hola! Soy el asistente del ayuntamiento. ¿Qué le gustaría visitar?",
    oQueSePassa: "Todo lo que pasa en el municipio (en portugués)",
    qr: "Código QR para carteles",
    emergencia: "Emergencias: 112",
    aCarregar: "Cargando…",
    erro: "No se ha podido cargar la página.",
    tentar: "Intentar de nuevo",
    vazio: "Aún no hay información turística publicada.",
    quando: (i) => data(i, "es-ES"),
    tituloQr: "Visite con el asistente del ayuntamiento.",
    textoQr: "Apunte la cámara del móvil: qué ver, rutas, mapa y respuestas en su idioma.",
  },
  fr: {
    titulo: (m) => `Visiter ${m}`,
    subtitulo: "Que voir, itinéraires à pied, carte et un assistant qui répond dans votre langue.",
    escolherLingua: "Langue",
    demonstracao: "Contenu de démonstration",
    avisoDemo:
      "Informations de démonstration, à confirmer avec l'office de tourisme de la mairie. Horaires et tarifs : renseignez-vous sur place ou sur le site officiel.",
    hoje: "Que voir aujourd'hui",
    hojeVazio: "Aucun événement dans les prochains jours. Voici l'essentiel :",
    eventosProximos: "Événements des prochains jours",
    imperdiveis: "À ne pas manquer",
    roteiros: "Itinéraires à pied",
    roteiro: {
      duas_horas: "Deux heures dans le centre historique",
      meio_dia: "Une demi-journée : histoire et musées",
      dia_inteiro: "Une journée : la ville et la Penha",
      sem_degraus: "Moins de marches (mobilité réduite)",
    },
    minutos: (n) => `${n} min`,
    duracao: (min) => `environ ${horas(min, "h", "min")}`,
    chegada: (min) => (min ? `+${horas(min, "h", "min")}` : "départ"),
    acessibilidade: { boa: "Accès facile", parcial: "Pavés ou quelques marches", dificil: "Accès difficile (escaliers)" },
    foraDoCentro: "Hors du centre (voiture ou taxi)",
    semDegraus: "Mobilité réduite",
    excluidos: (n) => `Laissé de côté car l'accès est difficile : ${n}.`,
    mapa: "Carte",
    mapaAjuda: "Les lieux et les événements figurent aussi dans les listes de cette page.",
    verNoMapa: "Voir sur la carte",
    abrirMapa: "Ouvrir la carte",
    saberMais: "En savoir plus",
    temas: "Informations utiles",
    fonte: (t, e) => `Source : ${t} · ${e}`,
    verFonte: "Voir la source",
    perguntar: "Demandez à l'assistant",
    perguntarAjuda: "Il répond par écrit, à toute heure, dans votre langue, avec les informations de la mairie.",
    abrirChat: "Ouvrir le chat",
    fecharChat: "Fermer le chat",
    sugestoes: ["Que voir en deux heures ?", "Comment aller à la Penha ?", "Qu'y a-t-il aujourd'hui ?"],
    saudacao: "Bonjour ! Je suis l'assistant de la mairie. Que souhaitez-vous visiter ?",
    oQueSePassa: "Tout ce qui se passe dans la commune (en portugais)",
    qr: "Code QR pour les affiches",
    emergencia: "Urgences : 112",
    aCarregar: "Chargement…",
    erro: "Impossible de charger la page.",
    tentar: "Réessayer",
    vazio: "Aucune information touristique n'a encore été publiée.",
    quando: (i) => data(i, "fr-FR"),
    tituloQr: "Visitez avec l'assistant de la mairie.",
    textoQr: "Pointez l'appareil photo de votre téléphone : que voir, itinéraires, carte et réponses dans votre langue.",
  },
};
