import {
  Accessibility,
  ArrowRight,
  BellRing,
  BookOpen,
  Building2,
  CalendarClock,
  Car,
  ChartColumn,
  CircleCheck,
  Euro,
  GraduationCap,
  History,
  LandPlot,
  Link2Off,
  MapPinned,
  Network,
  Phone,
  RotateCcw,
  Scale,
  Ticket,
  Vote,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { PILOTO, PROXIMOS } from "./pagina";
import { Secao } from "./secao";
import { RodapeApresentacao, TopoApresentacao } from "./topo";

/*
 * Visão: para onde vai o Tou, Câmara?. Tudo o que aqui está é futuro e
 * diz-se como futuro; o que já existe aparece marcado como tal ("Já existe"
 * só para o que está no código, "Já começa" quando existe numa parte).
 * A visão completa só se revela no pitch (code/pitch, visao.privado.ts):
 * aqui as outras linhas ficam tapadas, como no slide.
 */

const LINKS = [
  { href: "#degraus", nome: "Os degraus" },
  { href: "#nao-esquece", nome: "Não esquece" },
  { href: "#concelho", nome: "O concelho" },
  { href: "#o-pais", nome: "O país" },
  { href: "#plataforma", nome: "Aberta" },
  { href: "#mais-servicos", nome: "Mais serviços" },
  { href: "#para-la-chegar", nome: "Para lá chegar" },
];

type Marca = "partida" | "existe" | "comeca" | "ainda-nao";

const MARCAS: Record<Marca, { rotulo: string; classe: string }> = {
  partida: { rotulo: "O ponto de partida", classe: "bg-creme-2 text-tinta-2" },
  existe: { rotulo: "Já existe", classe: "bg-verde-suave text-verde" },
  comeca: { rotulo: "Já começa", classe: "bg-ambar-suave text-ambar" },
  "ainda-nao": { rotulo: "Ainda não existe", classe: "bg-creme-2 text-tinta-2" },
};

function Selo({ marca }: { marca: Marca }) {
  const m = MARCAS[marca];
  return (
    <span className={`inline-flex self-start rounded-full px-2.5 py-1 text-[12px] font-bold ${m.classe}`}>
      {m.rotulo}
    </span>
  );
}

/** A escada: de responder a melhorar a câmara. Sobe da esquerda para a direita. */
const DEGRAUS: { titulo: string; texto: string; marca: Marca; hoje?: string }[] = [
  {
    titulo: "Responder",
    texto: "Diz o que está no site, a qualquer hora. É onde começa um assistente.",
    marca: "partida",
  },
  {
    titulo: "Resolver",
    texto: "Trata do assunto na conversa: o requerimento, a ocorrência, a marcação, o pagamento.",
    marca: "existe",
  },
  {
    titulo: "Antecipar",
    texto: "Liga antes de um prazo acabar, renova a licença, avisa só quem é afetado e liga a quem está sozinho.",
    marca: "existe",
  },
  {
    titulo: "Decidir",
    texto: "O que cumpre regras públicas decide-se na hora. As pessoas da câmara ficam com as exceções e com o que pede julgamento.",
    marca: "comeca",
    hoje: "Nas licenças simples.",
  },
  {
    titulo: "Melhorar a câmara",
    texto: "Cada pergunta sem resposta, carta que ninguém percebe ou processo parado vira uma melhoria. Cada regra nova é testada antes de aprovada.",
    marca: "comeca",
    hoje: "No painel da chefia.",
  },
];

const DEGRAU_ALTURA = ["lg:mt-36", "lg:mt-27", "lg:mt-18", "lg:mt-9", "lg:mt-0"];

/** O que já começa hoje a "não esquecer" (existe no produto). */
const NAO_ESQUECE: { icone: LucideIcon; titulo: string; texto: string }[] = [
  {
    icone: RotateCcw,
    titulo: "Lembra-se de quem ligou",
    texto: "Quem volta a ligar não tem de contar tudo outra vez: o assistente sabe onde ficou e o que está pendente.",
  },
  {
    icone: CalendarClock,
    titulo: "Lembra-se dos prazos",
    texto: "Dos munícipes e da câmara: liga ou avisa antes de uma licença acabar, de um documento faltar ou de um prazo passar.",
  },
  {
    icone: BellRing,
    titulo: "Lembra-se de quem está sozinho",
    texto: "Numa onda de calor ou num corte de água, liga às pessoas inscritas e pergunta se estão bem.",
  },
  {
    icone: GraduationCap,
    titulo: "Lembra-se do que aprendeu",
    texto: "Quando não sabe, passa a uma pessoa; a resposta dela entra no assistente depois de aprovada.",
  },
  {
    icone: BookOpen,
    titulo: "Lembra-se de quem saiu",
    texto: "Entrevista quem se vai reformar e escreve os procedimentos que só essa pessoa sabia.",
  },
  {
    icone: History,
    titulo: "Lembra-se de que regra valia",
    texto: "Guarda as versões de cada regulamento, para responder com a regra em vigor numa data.",
  },
];

/** Quem está por trás da mesma linha, no concelho de Guimarães (as entidades estão nos dados). */
const CONCELHO: { nome: string; trata: string }[] = [
  { nome: "Câmara Municipal", trata: "Licenças, obras, ocorrências, ação social" },
  { nome: "Juntas de freguesia", trata: "Atestados, prova de vida, o que é da freguesia" },
  { nome: "Vimágua", trata: "Água e saneamento" },
  { nome: "Vitrus Ambiente", trata: "Recolha de lixo e de monos" },
  { nome: "Tempo Livre", trata: "Desporto e equipamentos" },
  { nome: "CASFIG", trata: "Habitação municipal" },
  { nome: "Serviços nacionais", trata: "Encaminhados, com o contacto certo" },
  { nome: "112", trata: "Numa emergência, manda ligar logo" },
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
      "As juntas de freguesia e as empresas municipais na mesma linha: a pessoa liga uma vez e o pedido chega a quem trata.",
    hoje: "Hoje: as juntas já têm painel próprio na demonstração e o assistente encaminha para as empresas municipais.",
  },
  {
    icone: Building2,
    titulo: "As outras 307 câmaras",
    texto:
      "O mesmo produto em cada concelho, com as suas fontes, as suas regras, a sua agenda e a sua voz. Uma câmara nova não começa do zero: começa com o que as outras já ensinaram.",
    hoje: "Hoje: tudo no produto já é por município, das regras às vozes.",
  },
];

const ABERTA: { icone: LucideIcon; titulo: string; texto: string; href?: string; ver?: string }[] = [
  {
    icone: Network,
    titulo: "Uma porta oficial para as IAs",
    texto: "O assistente de IA de cada pessoa pergunta e pede à câmara pela porta oficial (MCP), com as mesmas regras e as mesmas fontes.",
    href: "/ia",
    ver: "Ligar o seu assistente",
  },
  {
    icone: Scale,
    titulo: "Regras à vista de todos",
    texto: "As regras que decidem cada pedido são públicas, com histórico, e cada decisão diz porquê.",
    href: "/regras",
    ver: "Ver as regras",
  },
  {
    icone: ChartColumn,
    titulo: "Dados abertos",
    texto: "Os indicadores e os conjuntos de dados da câmara em CSV e JSON, com histórico.",
  },
];

const SERVICOS: { icone: LucideIcon; titulo: string; texto: string }[] = [
  { icone: Vote, titulo: "Orçamento participativo", texto: "Propor e votar por telefone, para quem nunca usou o site." },
  { icone: Ticket, titulo: "Senhas para o balcão", texto: "Tirar a vez sem sair de casa e ser avisado quando estiver a chegar." },
  { icone: Euro, titulo: "Fundos europeus", texto: "Encontrar os avisos abertos e preparar as candidaturas da câmara e das empresas." },
  { icone: ChartColumn, titulo: "Comparar com as outras câmaras", texto: "Os mesmos indicadores em todos os concelhos, para cada câmara ver onde pode melhorar." },
  { icone: Accessibility, titulo: "Língua gestual", texto: "Vídeos e atendimento em língua gestual portuguesa, ao lado da leitura em voz alta que já existe." },
  { icone: Zap, titulo: "Energia dos edifícios", texto: "O consumo dos edifícios municipais, com os desvios assinalados." },
  { icone: Car, titulo: "Frota municipal", texto: "As viaturas, as revisões e os custos, num só sítio." },
  { icone: Link2Off, titulo: "O concelho na internet", texto: "Todos os sites públicos do concelho revistos: duplicados, links partidos e informação desatualizada." },
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
              <p className="max-w-[580px] text-[18px] leading-relaxed text-tinta-2">
                O Tou, Câmara? já atende, resolve e liga primeiro. A ambição é maior: uma câmara que se lembra de cada
                pessoa, decide o que é simples na hora, aprende com cada conversa e chega ao país inteiro. Esta página diz
                para onde vamos; o que já existe está marcado como tal.
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
          id="degraus"
          rotulo="Os degraus"
          titulo="De responder a melhorar a câmara."
          sub="Cinco degraus. O primeiro é onde começa qualquer assistente. O Tou, Câmara? já subiu três e começou os outros dois."
          fundo="bg-papel"
        >
          <ol className="grid gap-3 lg:grid-cols-5 lg:items-start">
            {DEGRAUS.map((d, i) => {
              const feito = d.marca === "existe";
              return (
                <li
                  key={d.titulo}
                  className={`flex flex-col gap-3 rounded-3xl p-5 ${DEGRAU_ALTURA[i]} ${
                    feito
                      ? "bg-tinta text-papel"
                      : d.marca === "comeca"
                        ? "border-2 border-dashed border-terracota/60 bg-creme"
                        : "border border-linha bg-creme"
                  }`}
                >
                  <span
                    className={`font-display text-[40px] font-extrabold leading-none ${feito ? "text-terracota-suave" : "text-terracota"}`}
                  >
                    {i + 1}
                  </span>
                  <span className="font-display text-[21px] font-extrabold leading-tight">{d.titulo}</span>
                  <span className={`text-[14px] leading-relaxed ${feito ? "text-papel/80" : "text-tinta-2"}`}>
                    {d.texto}
                  </span>
                  <span className="mt-1 flex flex-col gap-1.5">
                    <Selo marca={d.marca} />
                    {d.hoje && <span className="text-[13px] text-tinta-2">{d.hoje}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </Secao>

        <Secao
          id="nao-esquece"
          rotulo="Não esquece"
          titulo="Uma câmara que se lembra."
          sub="Não é preciso explicar tudo outra vez, nem ficar à espera de uma carta: a câmara lembra-se do que ficou por tratar, de quem precisa e do que aprendeu. Isto já começa hoje."
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NAO_ESQUECE.map((j) => {
              const Icone = j.icone;
              return (
                <li key={j.titulo} className="flex flex-col gap-3 rounded-3xl border border-linha bg-papel p-6">
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-terracota-suave">
                      <Icone className="size-5 text-terracota-escuro" aria-hidden />
                    </span>
                    <Selo marca="existe" />
                  </span>
                  <span className="font-display text-[19px] font-bold leading-tight">{j.titulo}</span>
                  <span className="text-[15px] leading-relaxed text-tinta-2">{j.texto}</span>
                </li>
              );
            })}
          </ul>
        </Secao>

        <section id="concelho" aria-labelledby="concelho-titulo" className="scroll-mt-20 bg-tinta text-papel">
          <div className="mx-auto grid w-full max-w-[1120px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1.2fr] lg:items-center lg:py-24">
            <div className="flex flex-col gap-5">
              <span className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota-suave">O concelho</span>
              <h2
                id="concelho-titulo"
                className="font-display text-[32px] font-extrabold leading-[1.1] tracking-[-0.8px] sm:text-[44px]"
              >
                Uma só porta para tudo o que é público no concelho.
              </h2>
              <p className="text-[17px] leading-relaxed text-papel/80">
                A pessoa não tem de saber quem trata de quê. Liga uma vez, e o pedido chega a quem trata: a câmara, a
                junta, a empresa municipal ou o serviço nacional.
              </p>
              <p className="flex gap-2.5 text-[15px] leading-relaxed text-papel/90">
                <CircleCheck className="mt-1 size-4 shrink-0 text-terracota-suave" aria-hidden />
                Hoje: o assistente já encaminha para estas entidades, com o contacto certo, e as juntas têm painel próprio
                na demonstração.
              </p>
            </div>
            <div className="relative flex flex-col items-center gap-5">
              <span className="flex items-center gap-2.5 rounded-full bg-terracota px-6 py-3 font-display text-[20px] font-extrabold text-white shadow-[0_16px_40px_-16px_rgba(0,0,0,0.6)]">
                <Phone className="size-5" aria-hidden />
                Tou, Câmara?
              </span>
              <ul className="grid w-full gap-2.5 sm:grid-cols-2">
                {CONCELHO.map((c) => (
                  <li key={c.nome} className="flex flex-col gap-0.5 rounded-2xl bg-white/[0.07] px-4 py-3 ring-1 ring-white/10">
                    <span className="font-display text-[16px] font-bold">{c.nome}</span>
                    <span className="text-[13px] leading-snug text-papel/70">{c.trata}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <Secao
          id="o-pais"
          rotulo="O país"
          titulo="Primeiro Guimarães. Depois, as outras 307 câmaras."
          sub="Portugal tem 308 concelhos e cada um atende as mesmas perguntas de formas diferentes. O mesmo assistente, com as fontes e as regras de cada um, chega a todos. O que uma câmara ensina, as outras aprendem."
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
          id="plataforma"
          rotulo="Aberta"
          titulo="A câmara aberta a qualquer assistente."
          sub="Cada vez mais pessoas vão perguntar ao seu próprio assistente de IA. A câmara tem de lhe responder com a mesma voz oficial, e qualquer pessoa tem de poder verificar porque é que um pedido foi decidido assim."
        >
          <ul className="grid gap-4 md:grid-cols-3">
            {ABERTA.map((a) => {
              const Icone = a.icone;
              return (
                <li key={a.titulo} className="flex flex-col gap-3 rounded-3xl border border-linha bg-papel p-6">
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-terracota-suave">
                      <Icone className="size-5 text-terracota-escuro" aria-hidden />
                    </span>
                    <Selo marca="existe" />
                  </span>
                  <span className="font-display text-[19px] font-bold leading-tight">{a.titulo}</span>
                  <span className="text-[15px] leading-relaxed text-tinta-2">{a.texto}</span>
                  {a.href && (
                    <Link
                      href={a.href}
                      className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[14px] font-semibold text-terracota-escuro underline underline-offset-4"
                    >
                      {a.ver}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Secao>

        <Secao
          id="mais-servicos"
          rotulo="Mais serviços"
          titulo="O que a câmara faz, cada vez mais pelo telefone."
          sub="Hoje o assistente já trata de pedidos, licenças, marcações, ocorrências, apoios e dos serviços municipais. Estas são as ideias seguintes: ainda não existem."
          fundo="bg-papel"
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICOS.map((s) => {
              const Icone = s.icone;
              return (
                <li
                  key={s.titulo}
                  className="flex flex-col gap-3 rounded-3xl border border-dashed border-tinta-3/50 bg-creme/60 p-6"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-creme-2">
                    <Icone className="size-5 text-tinta-2" aria-hidden />
                  </span>
                  <span className="font-display text-[18px] font-bold leading-tight">{s.titulo}</span>
                  <span className="text-[14px] leading-relaxed text-tinta-2">{s.texto}</span>
                  <span className="mt-auto pt-1">
                    <Selo marca="ainda-nao" />
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
        >
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PROXIMOS.map((p) => {
              const Icone = p.icone;
              return (
                <li key={p.passo} className="flex flex-col gap-4 rounded-3xl border border-linha bg-papel p-6">
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
