/*
 * A fotografia (ou o PDF) de uma carta, pronta para a API: a fotografia é
 * reduzida no browser (JPEG até 2000 px, < 5 MB, o limite da IA) e o PDF vai
 * como está até 10 MB. Usado no chat (anexo) e na página /carta/[codigo].
 */
import {
  MAXIMO_PDF,
  paraBase64,
  reduzirImagem,
} from "@/components/municipe/imagem";

export interface FicheiroCarta {
  mime: "image/jpeg" | "application/pdf";
  ficheiro_base64: string;
}

/** Os tipos que o seletor de ficheiros aceita. */
export const ACEITA_CARTA = "image/*,application/pdf";

export class ErroFicheiroCarta extends Error {}

export async function prepararFicheiroCarta(f: File): Promise<FicheiroCarta> {
  const pdf =
    f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
  if (pdf) {
    if (f.size > MAXIMO_PDF) {
      throw new ErroFicheiroCarta(
        "O PDF é demasiado grande (máximo 10 MB). Tire antes uma fotografia à carta.",
      );
    }
    return { mime: "application/pdf", ficheiro_base64: await paraBase64(f) };
  }
  if (f.type && !f.type.startsWith("image/")) {
    throw new ErroFicheiroCarta(
      "Envie uma fotografia da carta ou o PDF.",
    );
  }
  try {
    const jpeg = await reduzirImagem(f);
    return { mime: "image/jpeg", ficheiro_base64: await paraBase64(jpeg) };
  } catch {
    throw new ErroFicheiroCarta(
      "Não conseguimos abrir esta fotografia. Tire outra (JPEG ou PNG) ou envie o PDF.",
    );
  }
}
