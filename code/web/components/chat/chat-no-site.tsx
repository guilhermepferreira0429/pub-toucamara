"use client";

import { ChevronDown, MessageCircle, Phone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/botao";
import { Chat, type ChatControlo } from "./chat";

/**
 * O chat no site da câmara (frame "Portal · Chat no site"): os botões
 * "Ligar agora" e "Escrever no chat", a janela do chat e o lançador redondo.
 * O chat só arranca (cria a sessão) quando a pessoa o abre; ao fechar fica
 * montado e escondido, para não perder a conversa.
 */
export function ChatNoSite({ contexto }: { contexto?: string }) {
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);
  const chat = useRef<ChatControlo>(null);
  const lancador = useRef<HTMLButtonElement>(null);

  // Só põe o cursor no chat quando foi a pessoa a abri-lo.
  const focarAoAbrir = useRef(true);

  function abrir() {
    focarAoAbrir.current = true;
    setMontado(true);
    setAberto(true);
  }

  // Como no design: em ecrãs largos o chat já aparece aberto ao lado do artigo.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (window.matchMedia("(min-width: 1280px)").matches) {
        focarAoAbrir.current = false;
        setMontado(true);
        setAberto(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const fechar = useCallback(() => {
    setAberto(false);
    requestAnimationFrame(() => lancador.current?.focus());
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const id = requestAnimationFrame(() => {
      if (focarAoAbrir.current) chat.current?.focar();
    });
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    window.addEventListener("keydown", tecla);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", tecla);
    };
  }, [aberto, fechar]);

  return (
    <>
      <aside
        aria-label="Atendimento"
        className="flex flex-col gap-4 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-[#111827]">Tem dúvidas sobre o seu caso?</h2>
          <p className="text-sm leading-relaxed text-[#374151]">
            O atendimento da câmara responde a qualquer hora, com base nos regulamentos
            oficiais. Por telefone ou por escrito.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <BotaoLink href="/ligar" tamanho="grande" icone={Phone}>
            Ligar agora
          </BotaoLink>
          <Botao
            variante="secundario"
            tamanho="grande"
            icone={MessageCircle}
            onClick={abrir}
            aria-controls="chat-no-site"
            aria-expanded={aberto}
          >
            Escrever no chat
          </Botao>
        </div>
      </aside>

      {montado && (
        <div
          id="chat-no-site"
          role="dialog"
          aria-label="Chat Tou, Câmara?"
          hidden={!aberto}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-creme sm:inset-auto sm:bottom-[104px] sm:right-6 sm:h-[620px] sm:max-h-[calc(100dvh-128px)] sm:w-[400px] sm:rounded-3xl sm:border sm:border-linha sm:shadow-[0_16px_48px_#15263b33] lg:right-16"
        >
          <Chat
            ref={chat}
            variante="janela"
            contexto={contexto}
            aoFechar={fechar}
            sugestoes={["Posso trocar as janelas?", "Preciso de licença?", "Quanto custa?"]}
          />
        </div>
      )}

      <button
        ref={lancador}
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        aria-label={aberto ? "Fechar o chat" : "Abrir o chat"}
        aria-expanded={aberto}
        aria-controls="chat-no-site"
        className={`fixed bottom-6 right-6 z-50 size-[60px] items-center justify-center rounded-[30px_30px_30px_8px] bg-terracota text-white shadow-[0_8px_24px_#b84a2466] transition-colors hover:bg-terracota-escuro lg:right-16 ${aberto ? "hidden sm:flex" : "flex"}`}
      >
        {aberto ? (
          <ChevronDown className="size-[26px]" aria-hidden />
        ) : (
          <MessageCircle className="size-[26px]" aria-hidden />
        )}
      </button>
    </>
  );
}
