/*
 * Fotografias tiradas no telemóvel: reduzir no browser antes de enviar
 * (canvas → JPEG). A verificação por foto aceita até 5 MB por imagem
 * (limite da IA); com 2000 px de lado já se lê bem um documento.
 */

export const MAXIMO_IMAGEM = 5 * 1024 * 1024;
export const MAXIMO_PDF = 10 * 1024 * 1024;

async function abrir(ficheiro: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(ficheiro, { imageOrientation: "from-image" });
    } catch {
      // alguns browsers não leem certos formatos por aqui: tenta pelo <img>
    }
  }
  const url = URL.createObjectURL(ficheiro);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function paraBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob> {
  return new Promise((ok, falha) =>
    canvas.toBlob(
      (b) => (b ? ok(b) : falha(new Error("toBlob"))),
      "image/jpeg",
      qualidade,
    ),
  );
}

/**
 * Reduz para JPEG com no máximo `ladoMaximo` px e `maximoBytes`. Lança
 * erro se o browser não conseguir abrir a imagem (ex.: HEIC fora do Safari).
 */
export async function reduzirImagem(
  ficheiro: Blob,
  { ladoMaximo = 2000, maximoBytes = MAXIMO_IMAGEM * 0.9 } = {},
): Promise<Blob> {
  const img = await abrir(ficheiro);
  let lado = ladoMaximo;
  let qualidade = 0.85;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * escala));
    canvas.height = Math.max(1, Math.round(img.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    // Fundo branco: PNG com transparência não fica preto em JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await paraBlob(canvas, qualidade);
    if (blob.size <= maximoBytes) return blob;
    lado = Math.round(lado * 0.8);
    qualidade = Math.max(0.6, qualidade - 0.08);
  }
  throw new Error("demasiado_grande");
}

/** base64 sem o prefixo "data:...;base64,". */
export function paraBase64(b: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => falha(r.error);
    r.readAsDataURL(b);
  });
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
