import { Mail, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Cabecalho, Topo, TituloSecao } from "@/components/municipe/moldura";
import { CONTACTO_ACESSIBILIDADE } from "@/lib/acessibilidade";

export const metadata: Metadata = {
  title: "Declaração de acessibilidade",
  robots: { index: true, follow: true },
};

/*
 * Declaração de acessibilidade, no modelo da AMA (acessibilidade.gov.pt) para
 * o Decreto-Lei n.º 83/2018, de 19 de outubro, que transpõe a Diretiva (UE)
 * 2016/2102. O estado e as não conformidades vêm da auditoria descrita em
 * docs/ACESSIBILIDADE.md: atualizar os dois juntos.
 */

const DATA = "22 de outubro de 2026";

const NAO_CONFORME: { titulo: string; detalhe: string; criterio: string }[] = [
  {
    titulo: "Documentos PDF",
    criterio: "1.3.1, 1.3.2, 2.4.2 e 3.1.1",
    detalhe:
      "Os PDF que a câmara gera (licenças, decisões, requerimentos) ainda não são PDF marcados (tagged): um leitor de ecrã pode lê-los fora de ordem. A mesma informação está sempre na página do link do SMS, em texto.",
  },
  {
    titulo: "Mapas",
    criterio: "1.1.1",
    detalhe:
      "O mapa das zonas do PDM mexe-se com o teclado (setas, + e −), mas o desenho das zonas não é descrito a quem usa leitor de ecrã. A resposta (o que se pode fazer naquele terreno) está escrita por baixo do mapa.",
  },
  {
    titulo: "Língua Gestual Portuguesa",
    criterio: "1.2.6 (nível AAA, voluntário)",
    detalhe:
      "Ainda não há vídeos em Língua Gestual Portuguesa. As páginas estão preparadas para os mostrar quando a câmara os gravar com um intérprete.",
  },
  {
    titulo: "Área interna da câmara (painel)",
    criterio: "1.4.10",
    detalhe:
      "Algumas listas e tabelas do painel dos funcionários ainda obrigam a deslizar para o lado em ecrãs muito estreitos (320 px) ou com zoom a 400 %.",
  },
  {
    titulo: "Respostas do assistente",
    criterio: "3.1.5 (nível AAA, voluntário)",
    detalhe:
      "As respostas do chat e da chamada são escritas pelo assistente em linguagem simples, mas não podemos garantir o nível de leitura de todas.",
  },
];

export default function PaginaAcessibilidade() {
  const { email, telefone, entidade } = CONTACTO_ACESSIBILIDADE;
  return (
    <div className="flex w-full flex-col gap-8">
      <Topo />
      <Cabecalho
        meta="Acessibilidade"
        titulo="Declaração de acessibilidade"
        sub={`${entidade[0].toUpperCase()}${entidade.slice(1)} compromete-se a tornar este serviço acessível, de acordo com o Decreto-Lei n.º 83/2018, de 19 de outubro, que transpõe a Diretiva (UE) 2016/2102 do Parlamento Europeu e do Conselho.`}
      />

      <section className="flex flex-col gap-3" aria-labelledby="ambito">
        <TituloSecao id="ambito">A que se aplica</TituloSecao>
        <p className="text-[16px] leading-[1.5] text-tinta-2">
          Ao atendimento &laquo;Tou, Câmara?&raquo; na internet: as páginas que
          abre pelos links das mensagens (processos, licenças, pagamentos,
          marcações, ocorrências, requerimentos e outras), o chat, a chamada pelo
          browser e o painel interno da câmara.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="estado">
        <TituloSecao id="estado">Estado de conformidade</TituloSecao>
        <p className="rounded-2xl border border-ambar bg-ambar-suave p-4 text-[17px] font-semibold text-tinta">
          Parcialmente conforme
        </p>
        <p className="text-[16px] leading-[1.5] text-tinta-2">
          Este serviço está parcialmente conforme com as Diretrizes de
          Acessibilidade para Conteúdo Web (WCAG) 2.1, nível AA, a norma que o
          Decreto-Lei n.º 83/2018 exige. Em baixo dizemos o que ainda não cumpre.
        </p>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="nao-conforme">
        <TituloSecao id="nao-conforme">O que ainda não é acessível</TituloSecao>
        <ul className="flex flex-col gap-4">
          {NAO_CONFORME.map((n) => (
            <li key={n.titulo} className="flex flex-col gap-1">
              <span className="text-[16px] font-bold text-tinta">{n.titulo}</span>
              <span className="text-[15px] leading-[1.5] text-tinta-2">{n.detalhe}</span>
              <span className="text-[13px] text-tinta-3">WCAG 2.1: {n.criterio}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="ajudas">
        <TituloSecao id="ajudas">O que já ajuda</TituloSecao>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[16px] leading-[1.5] text-tinta-2">
          <li>Pode tratar de tudo por telefone, falando, ou por escrito, no chat.</li>
          <li>
            No topo das páginas: &laquo;Ouvir esta página&raquo; (lê o texto em voz
            alta), letra maior e alto contraste.
          </li>
          <li>
            As páginas usam-se com o teclado, com &laquo;Saltar para o conteúdo&raquo; e o
            foco sempre visível.
          </li>
          <li>As páginas cabem num telemóvel pequeno e aguentam zoom a 200 %.</li>
          <li>Quem pediu menos movimento ao telemóvel não vê animações.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="como">
        <TituloSecao id="como">Como foi feita esta declaração</TituloSecao>
        <p className="text-[16px] leading-[1.5] text-tinta-2">
          Feita a {DATA}, com uma avaliação automática (axe-core 4.11, regras
          WCAG 2.1 A e AA) a 42 páginas, no telemóvel e no computador, e com
          verificações à mão do teclado, do zoom, do tamanho dos botões e do
          contraste das cores. Ainda não foi feita a avaliação com leitores de
          ecrã (NVDA, TalkBack, VoiceOver) nem testes com pessoas idosas ou com
          deficiência. Ainda não tem o Selo de Usabilidade e Acessibilidade.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="contacto">
        <TituloSecao id="contacto">Encontrou um problema?</TituloSecao>
        <p className="text-[16px] leading-[1.5] text-tinta-2">
          Diga-nos o que não conseguiu fazer e em que página. Respondemos e, se
          precisar, enviamos a informação de outra forma. O atendimento em Língua
          Gestual está no fim da página.
        </p>
        <ul className="flex flex-col gap-2">
          {email && (
            <li>
              <a
                href={`mailto:${email}?subject=${encodeURIComponent("Acessibilidade")}`}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-terracota-escuro underline"
              >
                <Mail className="size-5" aria-hidden />
                {email}
              </a>
            </li>
          )}
          {telefone && (
            <li>
              <a
                href={`tel:${telefone.replace(/\s/g, "")}`}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-terracota-escuro underline"
              >
                <Phone className="size-5" aria-hidden />
                {telefone}
              </a>
            </li>
          )}
          <li>
            <Link
              href="/chat"
              className="inline-flex min-h-11 items-center gap-2 font-semibold text-terracota-escuro underline"
            >
              <MessageCircle className="size-5" aria-hidden />
              Escrever no chat
            </Link>
          </li>
        </ul>
        <p className="text-[15px] leading-[1.5] text-tinta-2">
          Se a resposta não o satisfizer, pode reclamar no Livro de Reclamações
          ou contactar a AMA, Agência para a Modernização Administrativa, que
          acompanha a aplicação do Decreto-Lei n.º 83/2018 (
          <a
            href="https://www.acessibilidade.gov.pt"
            className="font-semibold text-terracota-escuro underline"
          >
            acessibilidade.gov.pt
          </a>
          ).
        </p>
      </section>
    </div>
  );
}
