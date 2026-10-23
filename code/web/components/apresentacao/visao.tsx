import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarClock,
  CircleCheck,
  Euro,
  ChartColumn,
  LandPlot,
  MapPinned,
  RotateCcw,
  Ticket,
  Vote,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { PILOTO, PROXIMOS, Secao } from "./pagina";
import { RodapeApresentacao, TopoApresentacao } from "./topo";

/*
 * Visão: para onde vai o Tou, Câmara?. Tudo o que aqui está é futuro e
 * diz-se como futuro; o que já existe aparece marcado como tal. A visão
 * completa só se revela no pitch (code/pitch, visao.privado.ts): aqui as
 * outras linhas ficam tapadas, como no slide.
 */

const LINKS = [
  { href: "#nao-esquece", nome: "Não esquece" },
  { href: "#o-pais", nome: "Do concelho ao país" },
  { href: "#mais-servicos", nome: "Mais serviços" },
  { href: "#para-la-chegar", nome: "Para lá chegar" },
];

/** O que já começa hoje a "não esquecer" (existe no produto). */
const JA_HOJE: { icone: LucideIcon; titulo: string; texto: string }[] = [
  {
    icone: RotateCcw,
    titulo: "Retoma a conversa",
    texto: "Quem volta a ligar não tem de contar tudo outra vez: o agente sabe onde ficou.",
  },
  {
    icone: CalendarClock,
    titulo: "Avisa antes de o prazo acabar",
    texto: "Por chamada ou SMS: quando falta um documento, quando um pedido muda de fase ou quando uma licença está a expirar.",
  },
  {
    icone: BellRing,
    titulo: "Liga a quem está sozinho",
    texto: "Numa onda de calor ou num corte de água, liga às pessoas inscritas e pergunta se estão bem.",
  },
];

const PAIS: { icone: LucideIcon; titulo: string; texto: string; hoje: string }[] = [
  {
    icone: MapPinned,
    titulo: "Guimarães",
    texto: "O piloto: chamadas reais, os dados da câmara e as regras validadas pelos técnicos.",
    hoje: "Hoje: a demonstração já usa as fontes oficiais de Guimarães.",
  },
  {
    icone: LandPlot,
    titulo: "O concelho inteiro",
    texto:
      "As juntas de freguesia e as empresas municipais (água, resíduos, desporto, habitação) na mesma linha: a pessoa liga uma vez e o pedido chega a quem trata.",
    hoje: "Hoje: as juntas já têm painel próprio na demonstração e o agente encaminha para as empresas municipais.",
  },
  {
    icone: Building2,
    titulo: "As outras 307 câmaras",
    texto:
      "O mesmo produto em cada concelho, com as suas fontes, as suas regras, a sua agenda e a sua voz. Uma câmara nova não começa do zero: começa com o que as outras já ensinaram.",
    hoje: "Hoje: tudo no produto já é por município, das regras às vozes.",
  },
];

const SERVICOS: { icone: LucideIcon; titulo: string; texto: string }[] = [
  {
    icone: Vote,
    titulo: "Orçamento participativo",
    texto: "Propor e votar por telefone, para quem nunca usou o site.",
  },
  {
    icone: Ticket,
    titulo: "Senhas para o balcão",
    texto: "Tirar a vez sem sair de casa e ser avisado quando estiver a chegar.",
  },
  {
    icone: Euro,
    titulo: "Fundos e apoios para empresas",
    texto: "Dizer a uma empresa a que programas pode concorrer, com os prazos.",
  },
  {
    icone: ChartColumn,
    titulo: "Comparar com as outras câmaras",
    texto: "Os mesmos indicadores em todos os concelhos, para cada câmara ver onde pode melhorar.",
  },
];

/** As tarjas tapadas da visão (como no pitch): a primeira linha revela-se, as outras não. */
function Tarjas() {
  return (
    <div className="flex flex-col gap-3" aria-label="O resto da visão revela-se no pitch">
      {[78, 64, 88].map((w) => (
        <span
          key={w}
          aria-hidden
          className="block h-[30px] rounded-full bg-tinta/85 sm:h-[44px]"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

export function PaginaVisao() {
  return (
    <div className="min-h-dvh bg-creme text-tinta">
      <TopoApresentacao links={LINKS} />
      <main id="conteudo">
        <section className="overflow-hidden">
          <div className="mx-auto grid w-full max-w-[1120px] gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:pb-24 lg:pt-20">
            <div className="flex flex-col gap-6">
              <span className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota">Visão</span>
              <h1 className="font-display text-[44px] font-extrabold leading-[1.02] tracking-[-1.6px] sm:text-[60px]">
                Hoje, a câmara que <span className="text-terracota">atende</span>.
                <br />
                Amanhã, a câmara que <span className="text-terracota">não esquece</span>.
              </h1>
              <p className="max-w-[560px] text-[18px] leading-relaxed text-tinta-2">
                O Tou, Câmara? começa por atender: a qualquer hora, só com informação oficial, e a tratar do assunto na
                conversa. A ambição vai mais longe. Esta página diz para onde vamos; o que já existe está marcado como
                tal.
              </p>
            </div>
            <div className="flex flex-col gap-5 rounded-[28px] border border-linha bg-papel p-7 sm:p-9">
              <p className="font-display text-[22px] font-extrabold leading-tight">
                A câmara que atende. <span className="text-terracota">A câmara que não esquece.</span>
              </p>
              <Tarjas />
              <p className="text-[14px] leading-relaxed text-tinta-2">
                O resto conta-se no palco, a 26 de outubro, no Centro Internacional das Artes José de Guimarães.
              </p>
            </div>
          </div>
        </section>

        <Secao
          id="nao-esquece"
          rotulo="Não esquece"
          titulo="Uma câmara que se lembra de quem ligou."
          sub="Não é preciso explicar tudo outra vez, nem ficar à espera de uma carta: a câmara lembra-se do que ficou por tratar e liga antes. Isto já começa hoje."
        >
          <ul className="grid gap-4 md:grid-cols-3">
            {JA_HOJE.map((j) => {
              const Icone = j.icone;
              return (
                <li key={j.titulo} className="flex flex-col gap-3 rounded-3xl border border-linha bg-papel p-6">
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-terracota-suave">
                      <Icone className="size-5 text-terracota-escuro" aria-hidden />
                    </span>
                    <span className="rounded-full bg-verde-suave px-2.5 py-1 text-[12px] font-bold text-verde">
                      Já existe
                    </span>
                  </span>
                  <span className="font-display text-[19px] font-bold leading-tight">{j.titulo}</span>
                  <span className="text-[15px] leading-relaxed text-tinta-2">{j.texto}</span>
                </li>
              );
            })}
          </ul>
        </Secao>

        <Secao
          id="o-pais"
          rotulo="Do concelho ao país"
          titulo="Primeiro Guimarães. Depois, as outras 307 câmaras."
          sub="Portugal tem 308 concelhos e cada um atende as mesmas perguntas de formas diferentes. O mesmo agente, com as fontes e as regras de cada um, chega a todos."
          fundo="bg-papel"
        >
          <ol className="grid gap-4 md:grid-cols-3">
            {PAIS.map((p, i) => {
              const Icone = p.icone;
              return (
                <li key={p.titulo} className="flex flex-col gap-4 rounded-3xl border border-linha bg-creme p-6">
                  <span className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-tinta text-papel">
                      <Icone className="size-5" aria-hidden />
                    </span>
                    <span className="text-[13px] font-bold uppercase tracking-[1px] text-tinta-2">Passo {i + 1}</span>
                  </span>
                  <span className="font-display text-[22px] font-extrabold leading-tight">{p.titulo}</span>
                  <span className="text-[15px] leading-relaxed text-tinta-2">{p.texto}</span>
                  <span className="mt-auto flex gap-2 border-t border-linha pt-4 text-[14px] leading-relaxed text-tinta">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-verde" aria-hidden />
                    {p.hoje}
                  </span>
                </li>
              );
            })}
          </ol>
        </Secao>

        <Secao
          id="mais-servicos"
          rotulo="Mais serviços"
          titulo="O que a câmara faz, cada vez mais pelo telefone."
          sub="Hoje o agente já trata de pedidos, licenças, marcações, ocorrências e dos serviços municipais. Estas são as ideias seguintes: ainda não existem."
        >
          <ul className="grid gap-4 sm:grid-cols-2">
            {SERVICOS.map((s) => {
              const Icone = s.icone;
              return (
                <li key={s.titulo} className="flex gap-4 rounded-3xl border border-dashed border-tinta-3/50 bg-papel/60 p-6">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-creme-2">
                    <Icone className="size-5 text-tinta-2" aria-hidden />
                  </span>
                  <span className="flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[19px] font-bold leading-tight">{s.titulo}</span>
                      <span className="rounded-full bg-creme-2 px-2.5 py-0.5 text-[12px] font-bold text-tinta-2">
                        Ainda não existe
                      </span>
                    </span>
                    <span className="text-[15px] leading-relaxed text-tinta-2">{s.texto}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <Link
            href="/funcionalidades"
            className="inline-flex items-center gap-2 self-start text-[16px] font-semibold text-terracota-escuro underline underline-offset-4"
          >
            Ver tudo o que já faz hoje
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Secao>

        <Secao
          id="para-la-chegar"
          rotulo="Para lá chegar"
          titulo="O que falta para a câmara o usar a sério."
          sub="O que está construído e o que depende de terceiros: números, credenciações e acessos aos sistemas da câmara."
          fundo="bg-papel"
        >
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PROXIMOS.map((p) => {
              const Icone = p.icone;
              return (
                <li key={p.passo} className="flex flex-col gap-4 rounded-3xl border border-linha bg-creme p-6">
                  <span className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-terracota-suave">
                      <Icone className="size-5 text-terracota-escuro" aria-hidden />
                    </span>
                    <span className="font-display text-[19px] font-bold leading-tight">{p.passo}</span>
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-[12px] font-bold uppercase tracking-[1px] text-verde">Já existe</span>
                    <span className="text-[14px] leading-relaxed text-tinta-2">{p.existe}</span>
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-[12px] font-bold uppercase tracking-[1px] text-terracota">Falta</span>
                    <span className="text-[14px] leading-relaxed text-tinta-2">{p.falta}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-5 rounded-3xl bg-terracota p-6 text-white sm:p-8">
            <p className="font-display text-[24px] font-extrabold leading-tight">O piloto em Guimarães</p>
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {PILOTO.map((p) => (
                <li key={p} className="flex gap-2.5 text-[15px] leading-snug">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-terracota-suave" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </Secao>
      </main>
      <RodapeApresentacao />
    </div>
  );
}
