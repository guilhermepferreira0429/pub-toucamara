import type { Metadata } from "next";
import { Suspense } from "react";
import { Chat } from "@/components/chat/chat";

export const metadata: Metadata = {
  title: "Chat da junta",
  description:
    "Pergunte à junta de freguesia: atestados, prova de vida, cemitério, feiras e caminhos.",
};

type Params = Promise<{ slug: string }>;

/**
 * O chat de uma junta de freguesia (versão junta): o mesmo chat, com o
 * agente e o conhecimento da junta (ex.: `/junta/guimaraes-azurem`).
 */
async function ChatJunta({ params }: { params: Params }) {
  const { slug } = await params;
  return (
    <Chat
      variante="ecra"
      municipio={slug}
      titulo="Junta de freguesia"
      sugestoes={[
        "Preciso de um atestado de residência",
        "Tenho de fazer a prova de vida",
        "Como registo o meu cão?",
        "Há um caminho cheio de mato",
      ]}
    />
  );
}

export default function PaginaChatJunta({ params }: { params: Params }) {
  return (
    <main className="flex h-dvh justify-center bg-creme-2">
      <div className="flex h-full w-full max-w-[560px] flex-col bg-creme sm:border-x sm:border-linha">
        <Suspense fallback={null}>
          <ChatJunta params={params} />
        </Suspense>
      </div>
    </main>
  );
}
