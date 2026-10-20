/*
 * Configuração da chamada no browser (variáveis NEXT_PUBLIC_, embutidas no
 * build). Sem NEXT_PUBLIC_ELEVENLABS_AGENT_ID o ecrã 01 diz que a chamada está
 * por configurar e oferece o chat.
 */

export const AGENTE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

/** Slug do município: vai para o agente como variável dinâmica `municipio`. */
export const MUNICIPIO = process.env.NEXT_PUBLIC_MUNICIPIO ?? "guimaraes";

const NOMES: Record<string, string> = {
  guimaraes: "Guimarães",
  braga: "Braga",
  porto: "Porto",
  lisboa: "Lisboa",
};

/** Nome para mostrar ("Câmara de Guimarães"). */
export const MUNICIPIO_NOME =
  process.env.NEXT_PUBLIC_MUNICIPIO_NOME ??
  NOMES[MUNICIPIO] ??
  MUNICIPIO.replace(/-/g, " ").replace(/(^|\s)\S/g, (l) => l.toUpperCase());

/** Número da linha da câmara, para quem não pode usar o microfone (opcional). */
export const TELEFONE_CAMARA = process.env.NEXT_PUBLIC_TELEFONE_CAMARA ?? "";
