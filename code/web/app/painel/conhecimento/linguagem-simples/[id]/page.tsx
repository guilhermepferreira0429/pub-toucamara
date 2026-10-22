import { EditorDocumento } from "@/components/linguagem-simples/editor";

export const metadata = { title: "Versão simples · Conhecimento" };

type Params = Promise<{ id: string }>;

/** Editor lado a lado: texto oficial | versão simples. */
export default async function PaginaDocumentoSimples({ params }: { params: Params }) {
  const { id } = await params;
  return <EditorDocumento id={id} />;
}
