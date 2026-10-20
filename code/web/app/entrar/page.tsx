import { Suspense } from "react";
import { Entrar } from "./entrar";

export const metadata = { title: "Entrar" };

export default function PaginaEntrar() {
  return (
    <Suspense>
      <Entrar />
    </Suspense>
  );
}
