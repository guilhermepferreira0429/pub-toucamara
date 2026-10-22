import { API_URL } from "@/lib/api";

// O link curto que vai no SMS (WEB_URL/r/CODIGO) é servido pela API, que conta a
// abertura e responde com o redirect para a página certa. O link aponta para o
// site, por isso aqui só se reencaminha para a API.
export async function GET(request: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const destino = new URL(`${API_URL}/r/${encodeURIComponent(codigo)}`, request.url);
  return Response.redirect(destino, 302);
}
