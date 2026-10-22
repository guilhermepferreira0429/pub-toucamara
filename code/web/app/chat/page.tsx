import type { Metadata } from "next";
import { Chat } from "@/components/chat/chat";
import { LateralComputador } from "@/components/municipe/lateral-computador";

export const metadata: Metadata = {
  title: "Chat",
  description: "Pergunte à câmara. Responde com fonte oficial, a qualquer hora.",
};

/**
 * Chat do munícipe (frames 06…06e, 14, 16 e 17). No telemóvel, ecrã inteiro;
 * no computador, a conversa num cartão largo e, ao lado, a câmara.
 */
export default function PaginaChat() {
  return (
    <main className="flex h-dvh justify-center bg-creme-2 lg:gap-14 lg:bg-creme lg:px-10 lg:py-8">
      <aside aria-label="A câmara" className="hidden lg:block lg:w-[300px] lg:shrink-0 lg:pt-2">
        <LateralComputador sem={["chat"]} />
      </aside>
      <div className="flex h-full w-full max-w-[560px] flex-col bg-creme sm:border-x sm:border-linha lg:max-w-[760px] lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-linha lg:bg-papel lg:shadow-[0_30px_60px_-45px_rgba(21,38,59,0.45)]">
        <Chat variante="ecra" />
      </div>
    </main>
  );
}
