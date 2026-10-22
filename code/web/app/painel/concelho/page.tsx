import { Suspense } from "react";
import { PaginaConcelho } from "@/components/concelho/concelho";

export const metadata = { title: "O que sentem os munícipes" };

/** "Pergunte ao concelho": o que os munícipes sentem, lido nas conversas. */
export default function Pagina() {
  return (
    <Suspense>
      <PaginaConcelho />
    </Suspense>
  );
}
