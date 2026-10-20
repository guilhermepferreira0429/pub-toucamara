import type { Metadata } from "next";
import { Chat } from "@/components/chat/chat";

export const metadata: Metadata = {
  title: "Chat",
  description: "Pergunte à câmara. Responde com fonte oficial, a qualquer hora.",
};

/** Chat do munícipe em ecrã inteiro (telemóvel): frames 06…06e, 14, 16 e 17. */
export default function PaginaChat() {
  return (
    <main className="flex h-dvh justify-center bg-creme-2">
      <div className="flex h-full w-full max-w-[560px] flex-col bg-creme sm:border-x sm:border-linha">
        <Chat variante="ecra" />
      </div>
    </main>
  );
}
