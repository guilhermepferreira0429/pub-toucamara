import { FileText, Menu, Search } from "lucide-react";
import type { Metadata } from "next";
import { ChatNoSite } from "@/components/chat/chat-no-site";

export const metadata: Metadata = {
  title: "Obras isentas de controlo prévio · Município de Guimarães",
};

/*
 * Página de portal municipal de demonstração (frame "Portal · Chat no site"):
 * um artigo normal do site da câmara com o chat Tou, Câmara? por cima.
 * O portal tem o aspeto neutro de um site municipal (não usa a paleta do
 * produto); só o chat é Tou, Câmara?.
 */

const MENU = ["Município", "Viver", "Serviços", "Balcão Online", "Contactos"];

const DOCUMENTOS = [
  "Regulamento Municipal de Urbanização e Edificação (PDF, 1,2 MB)",
  "Tabela de Taxas Municipais 2026 (PDF, 640 KB)",
  "Formulário de comunicação prévia (PDF, 210 KB)",
];

const TITULO = "Obras isentas de controlo prévio";

export default function Portal() {
  return (
    <div className="flex min-h-dvh flex-col bg-white font-body">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-5 lg:px-16">
        <a href="#" className="flex items-center gap-2.5" aria-label="Município de Guimarães, início">
          <span className="size-[34px] rounded-md bg-[#d9dce1]" aria-hidden />
          <span className="flex flex-col">
            <span className="text-[10px] font-semibold tracking-[1px] text-[#6b7280]">
              MUNICÍPIO DE
            </span>
            <span className="text-lg font-bold leading-tight text-[#1f2328]">Guimarães</span>
          </span>
        </a>
        <nav aria-label="Principal" className="hidden items-center gap-8 md:flex">
          {MENU.map((m) => (
            <a
              key={m}
              href="#"
              aria-current={m === "Serviços" ? "page" : undefined}
              className={`text-sm font-medium hover:text-[#1f2328] ${m === "Serviços" ? "text-[#1f2328]" : "text-[#4b5563]"}`}
            >
              {m}
            </a>
          ))}
          <button type="button" aria-label="Pesquisar" className="text-[#4b5563]">
            <Search className="size-[18px]" aria-hidden />
          </button>
        </nav>
        <button type="button" aria-label="Menu" className="text-[#4b5563] md:hidden">
          <Menu className="size-6" aria-hidden />
        </button>
      </header>

      <main className="flex flex-1 px-5 pb-32 pt-10 lg:px-16">
        <article className="flex w-full max-w-[720px] flex-col gap-5">
          <nav aria-label="Caminho" className="text-[13px] text-[#6b7280]">
            Início &nbsp;›&nbsp; Serviços &nbsp;›&nbsp; Urbanismo &nbsp;›&nbsp; Obras
          </nav>
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.8px] text-[#111827] sm:text-[40px]">
            {TITULO}
          </h1>
          <p className="text-base leading-[1.65] text-[#374151]">
            Algumas obras não precisam de licença nem de comunicação prévia à câmara, nos
            termos do artigo 6.º do Regime Jurídico da Urbanização e da Edificação (RJUE),
            aprovado pelo Decreto-Lei n.º 555/99, na sua redação atual.
          </p>
          <p className="text-base leading-[1.65] text-[#374151]">
            Estão neste caso as obras de conservação e as obras de alteração no interior de
            edifícios que não impliquem modificações na estrutura de estabilidade, das cérceas,
            da forma das fachadas e da forma dos telhados ou coberturas.
          </p>
          <p className="text-base leading-[1.65] text-[#374151]">
            A isenção de controlo prévio não dispensa o cumprimento das normas legais e
            regulamentares aplicáveis, nomeadamente as constantes de planos municipais e do
            Regulamento Municipal de Urbanização e Edificação.
          </p>

          <ChatNoSite contexto={TITULO} />

          <section className="flex flex-col pt-2">
            <h2 className="text-lg font-bold text-[#111827]">Documentos relacionados</h2>
            <ul>
              {DOCUMENTOS.map((d) => (
                <li key={d} className="border-b border-[#e5e7eb]">
                  <a href="#" className="flex items-center gap-2.5 py-3 text-sm text-[#1d4ed8] hover:underline">
                    <FileText className="size-4 shrink-0 text-[#4b5563]" aria-hidden />
                    {d}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </article>
      </main>
    </div>
  );
}
