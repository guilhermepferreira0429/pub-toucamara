import type { Metadata } from "next";
import { QrParaTelemovel } from "@/components/chamada/codigo-qr";
import { ChamadaNoBrowser } from "@/components/chamada/fluxo-chamada";
import { LateralComputador } from "@/components/municipe/lateral-computador";

export const metadata: Metadata = {
  title: "Ligar à câmara",
  description:
    "Fale com a câmara pelo browser: obras, licenças e documentos, a qualquer hora.",
};

/**
 * No telemóvel, a chamada em ecrã inteiro. No computador, a chamada num
 * cartão com o tamanho de um telemóvel e, ao lado, a câmara e um QR para
 * continuar no telemóvel.
 */
export default function PaginaLigar() {
  return (
    <div className="min-h-dvh bg-creme lg:flex lg:items-start lg:justify-center lg:gap-16 lg:px-10 lg:py-10">
      <aside aria-label="A câmara" className="hidden lg:sticky lg:top-10 lg:block lg:w-[320px]">
        <LateralComputador sem={["ligar"]}>
          <QrParaTelemovel />
        </LateralComputador>
      </aside>
      <div className="lg:w-[460px] lg:shrink-0 lg:overflow-hidden lg:rounded-[32px] lg:border lg:border-linha lg:bg-creme lg:shadow-[0_30px_60px_-40px_rgba(21,38,59,0.5)]">
        <ChamadaNoBrowser />
      </div>
    </div>
  );
}
