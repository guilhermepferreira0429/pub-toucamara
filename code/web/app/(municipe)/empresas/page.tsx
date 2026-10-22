import { AssistenteEmpresas } from "@/components/empresas/assistente";

export const metadata = {
  title: "Balcão para empresas",
  description: "O que a sua empresa precisa: licenças, prazos, taxas e calendário de obrigações.",
};

/** Balcão para empresas: as perguntas e a lista personalizada. */
export default function Pagina() {
  return <AssistenteEmpresas />;
}
