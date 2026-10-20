import type { Metadata } from "next";
import { PaginaQr } from "@/components/chamada/codigo-qr";

export const metadata: Metadata = {
  title: "Ligar pelo telemóvel",
  robots: { index: false },
};

export default function PaginaLigarQr() {
  return <PaginaQr />;
}
