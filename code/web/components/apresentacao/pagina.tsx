import {
  Accessibility,
  ArrowRight,
  CircleCheck,
  CirclePlay,
  ClipboardCheck,
  Database,
  FileText,
  FlaskConical,
  Globe,
  Hourglass,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Lock,
  MapPin,
  MessageCircle,
  MessageSquare,
  Mic,
  Phone,
  PhoneOutgoing,
  RotateCcw,
  Route,
  Scale,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { MUNICIPIO } from "@/components/chamada/config";
import { FonteOficial, Logo } from "@/components/ui/marca";
import { AREAS, GrelhaDestaques, TOTAL_FUNCIONALIDADES } from "./funcionalidades";
import { NumerosAvaliacao } from "./numeros-avaliacao";
import { Lista, Secao } from "./secao";
import { RodapeApresentacao, TopoApresentacao } from "./topo";

/*
 * Página de apresentação (a raiz do site): o que é o Tou, Câmara?, onde se
 * experimenta, como se sabe que responde bem, o que é real e o que é
 * simulado, como está feito e o que vem a seguir. É a página que o júri
 * abre. O que é visão nunca aparece como feito.
 */

const APK_URL = process.env.NEXT_PUBLIC_APK_URL ?? "";
const VIDEO_URL = process.env.NEXT_PUBLIC_VIDEO_URL ?? "";

const SECOES = [
  { id: "experimentar", nome: "Experimentar" },
  { id: "liga-primeiro", nome: "Liga primeiro" },
  { id: "avaliacao", nome: "Avaliação" },
  { id: "real", nome: "Real e simulado" },
  { id: "proximos-passos", nome: "Próximos passos" },
];

interface Acesso {
  href: string;
  titulo: string;
  texto: string;
  icone: LucideIcon;
  externo?: boolean;
}

/** Os canais e o painel: em destaque. */
const PRINCIPAIS: Acesso[] = [
  {
    href: "/ligar",
    titulo: "Ligar",
    texto: "Fale com o assistente no browser, como numa chamada. Basta autorizar o microfone.",
    icone: Phone,
  },
  {
    href: "/chat",
    titulo: "Chat",
    texto: "Escreva a pergunta. Cada resposta traz a fonte oficial de onde veio.",
    icone: MessageSquare,
  },
  {
    href: "/entrar",
    titulo: "Painel da câmara",
    texto: "O lado da câmara: conversas resumidas, pedidos, ocorrências, licenças e indicadores.",
    icone: LayoutDashboard,
  },
  ...(APK_URL
    ? [
        {
          href: APK_URL,
          titulo: "App para Android",
          texto: "Entrar com o número de telemóvel, reportar um problema com foto, seguir os seus assuntos.",
          icone: Smartphone,
          externo: true,
        },
      ]
    : []),
];

/** As páginas públicas que mostram o resto do produto. */
const ACESSOS: Acesso[] = [
  {
    href: "/funcionalidades",
    titulo: "Funcionalidades",
    texto: "Tudo o que já faz, por área, com o estado de cada coisa: a funcionar, em teste ou com dados de exemplo.",
    icone: ListChecks,
  },
  {
    href: "/visao",
    titulo: "Visão",
    texto: "Para onde vamos: a câmara que não esquece, do concelho às outras 307 câmaras, e mais serviços.",
    icone: Sparkles,
  },
  {
    href: "/avaliacao",
    titulo: "Avaliação",
    texto: "As perguntas de teste, a resposta dada, a resposta certa e o veredicto do juiz, uma a uma.",
    icone: ClipboardCheck,
  },
  {
    href: `/agora/${MUNICIPIO}`,
    titulo: "Perto de si",
    texto: "Obras, cortes, avisos e eventos do concelho, em lista e no mapa.",
    icone: MapPin,
  },
  {
    href: "/regras",
    titulo: "Regras públicas",
    texto: "As regras que decidem cada licença, à vista de todos, com um verificador para o seu caso.",
    icone: Scale,
  },
  {
    href: "/visitar",
    titulo: "Visitar Guimarães",
    texto: "Para quem visita: o que ver e o que está a acontecer, em quatro línguas.",
    icone: Landmark,
  },
  ...(VIDEO_URL
    ? [
        {
          href: VIDEO_URL,
          titulo: "Vídeo da demonstração",
          texto: "Uma chamada do princípio ao fim: a pergunta, o pedido tratado, o SMS e o painel.",
          icone: CirclePlay,
          externo: true,
        },
      ]
    : []),
];

const NUMEROS: [string, string][] = [
  ["24 h", "a atender, todos os dias"],
  [String(TOTAL_FUNCIONALIDADES), "funcionalidades, do atendimento à chefia"],
  ["48", "ações que o assistente faz durante a chamada"],
  ["180", "perguntas de teste no avaliador"],
];

/** A câmara que liga primeiro: o que acontece sem ninguém ligar (tudo existe; ver /funcionalidades). */
const LIGA_PRIMEIRO: { quando: string; faz: string; icone: LucideIcon }[] = [
  {
    quando: "Uma licença está a acabar",
    faz: "Avisa e, na chamada, renova: confirma os dados, volta a ver as regras, calcula a taxa e dá a referência.",
    icone: RotateCcw,
  },
  {
    quando: "O prazo de uma audiência prévia está a acabar",
    faz: "Liga antes, para a pessoa não perder o prazo para responder.",
    icone: Hourglass,
  },
  {
    quando: "Falta um documento no processo",
    faz: "Manda um SMS com o link para enviar a foto do documento.",
    icone: FileText,
  },
  {
    quando: "Há uma onda de calor",
    faz: "Liga às pessoas que vivem sozinhas e se inscreveram, e pergunta se estão bem.",
    icone: Sun,
  },
  {
    quando: "Há obras numa rua amanhã",
    faz: "Avisa por SMS só quem perguntou por aquela rua.",
    icone: MapPin,
  },
  {
    quando: "O buraco que alguém reportou foi tapado",
    faz: "Manda um SMS a dizer que ficou resolvido.",
    icone: CircleCheck,
  },
];

const PERGUNTAS = [
  "Quero fazer obras na cozinha, mudar os azulejos e a bancada. Preciso de licença?",
  "Estou sem água em casa desde manhã. O que se passa?",
  "Quanto custa uma licença de ruído para uma festa de anos?",
  "Há um buraco grande na minha rua.",
];

const PASSOS: { titulo: string; texto: string; icone: LucideIcon }[] = [
  {
    titulo: "Liga ou escreve",
    texto: "Por telefone, no chat do site, por SMS ou na app. A qualquer hora, em português de Portugal, e noutras línguas para quem visita.",
    icone: Mic,
  },
  {
    titulo: "Percebe e pergunta",
    texto: "Quando falta informação, pergunta. Responde só com informação oficial e diz sempre de onde vem.",
    icone: MessageCircle,
  },
  {
    titulo: "Trata na conversa",
    texto: "Preenche o requerimento, regista a ocorrência, marca o atendimento, gera o pagamento ou encaminha para a entidade certa.",
    icone: ListChecks,
  },
  {
    titulo: "Sai a saber o que fazer",
    texto: "No fim chega um SMS com os documentos, os links e os próximos passos. A câmara vê o resumo no painel.",
    icone: Send,
  },
];

const MUNICIPE = [
  "Respostas com a fonte oficial: regulamento, tabela de taxas, página da câmara.",
  "Quando não sabe, ou a pessoa pede, passa a um funcionário, que responde no prazo que foi dito.",
  "O requerimento preenchido durante a chamada, pronto a rever e assinar.",
  "Ocorrências com foto e localização; quem reportou recebe um SMS quando fica resolvida.",
  "Em que ponto está o processo, sem ir ao balcão.",
  "Encaminha para a entidade certa: Vimágua, juntas de freguesia, serviços nacionais. Numa emergência, manda ligar para o 112.",
];

const CAMARA = [
  "O resumo de cada chamada e conversa, os temas mais perguntados e os picos de procura.",
  "Os pedidos passados a funcionário, as ocorrências, os processos, as licenças e as marcações, por área.",
  "Apoio ao técnico na análise de projetos de obras, sempre marcado “a confirmar”.",
  "Relatório mensal e resumo diário para o executivo.",
  "A câmara decide o que o assistente sabe: as fontes, as regras de encaminhamento, as pronúncias.",
  "Uma app para a equipa de campo: tarefas do dia por proximidade, fechar com a foto do depois, funciona sem rede.",
];

const REAL = [
  "Chamada por voz no browser e chat",
  "Respostas com fonte e encaminhamento para a entidade certa",
  "Aviso para ligar para o 112 nas emergências",
  "Resumos das conversas e painel da câmara",
  "Ocorrências com foto e localização",
  "Licenças decididas pelas regras, com PDF e QR",
  "Requerimento preenchido durante a chamada",
  "SMS no fim da chamada",
  "Recolha das fontes oficiais",
];

const SIMULADO = [
  "Pagamentos (Multibanco e MB WAY, em modo de teste)",
  "Chave Móvel Digital e assinatura",
  "Entrega do pedido em nome da pessoa",
  "Ligação à gestão documental da câmara",
  "Ligação à Vimágua",
  "Operadores nos avisos de emergência",
];

const DEMONSTRACAO = [
  "Zonas do plano diretor municipal e valores dos regulamentos",
  "Escolas, habitação, reservas, estacionamento, cemitérios e animais",
  "Pessoas e processos usados na demonstração",
];

const TECNOLOGIA: { peca: string; como: string; icone: LucideIcon }[] = [
  { peca: "Voz", como: "ElevenLabs, ligado às ferramentas da API: 48 ações no assistente que atende.", icone: Mic },
  {
    peca: "Inteligência artificial",
    como: "Claude, da Anthropic. Na demonstração, pela API da Anthropic; em produção passaria para o Amazon Bedrock, com processamento na UE (ainda não está feito).",
    icone: Sparkles,
  },
  { peca: "API central", como: "NestJS (TypeScript): as ações do assistente, os webhooks, o painel e as páginas públicas.", icone: Server },
  { peca: "Base de dados", como: "PostgreSQL, com segurança por linha: cada câmara e cada junta só vê os seus dados.", icone: Database },
  { peca: "Site, chat e painel", como: "Next.js e React.", icone: LayoutDashboard },
  { peca: "Apps", como: "Flutter: a app do munícipe e a da equipa de campo.", icone: Smartphone },
  { peca: "SMS", como: "Twilio, para o resumo do fim da chamada, os avisos e os códigos de entrada na app.", icone: Send },
];

const CONFIANCA: { titulo: string; texto: string; icone: LucideIcon }[] = [
  {
    titulo: "Testes",
    texto: "Cerca de 1 660 testes unitários e 79 conjuntos de testes de ponta a ponta na API, além das 180 perguntas do avaliador.",
    icone: CircleCheck,
  },
  {
    titulo: "Acessibilidade",
    texto: "WCAG 2.1 AA: 0 erros automáticos em 42 páginas. Letra maior, alto contraste e “ouvir esta página”.",
    icone: Accessibility,
  },
  {
    titulo: "Dados pessoais",
    texto: "Aviso de gravação e consentimento, NIF cifrado, registo de todos os acessos e dados apagados no fim do prazo.",
    icone: Lock,
  },
];

export const PROXIMOS: { passo: string; existe: string; falta: string; icone: LucideIcon }[] = [
  {
    passo: "Número português",
    existe: "Assistente de voz, início e fim da chamada, chamadas feitas pela câmara.",
    falta: "Comprar o número e ligá-lo ao assistente.",
    icone: Phone,
  },
  {
    passo: "Sistemas da câmara",
    existe: "Ligações simuladas à gestão documental, aos pagamentos e à Vimágua.",
    falta: "Saber que sistemas a câmara usa e ter acesso; contrato com um fornecedor de pagamentos.",
    icone: Route,
  },
  {
    passo: "Chave Móvel Digital",
    existe: "Entregar o pedido em nome da pessoa, de ponta a ponta, em simulação.",
    falta: "Credenciação na AMA e acesso ao balcão online.",
    icone: KeyRound,
  },
  {
    passo: "Apps nas lojas",
    existe: "App do munícipe e app da equipa de campo.",
    falta: "Publicar na Google Play; no iPhone, falta a aprovação da Apple.",
    icone: Store,
  },
  {
    passo: "WhatsApp",
    existe: "Canal completo, com o mesmo assistente.",
    falta: "Verificação da conta pela Meta.",
    icone: MessageCircle,
  },
  {
    passo: "Inteligência artificial na Europa",
    existe: "O Claude, hoje pela API da Anthropic.",
    falta: "Em produção, o Claude no Amazon Bedrock, com processamento na UE.",
    icone: Globe,
  },
];

export const PILOTO = [
  "Medir a taxa de acerto com chamadas reais",
  "Os técnicos validarem as regras dos projetos de obras",
  "Carregar os dados reais da câmara",
  "Ligar as juntas de freguesia",
  "Acordo com a Proteção Civil para os avisos de emergência",
];

function CartaoAcesso({ a, destaque = false }: { a: Acesso; destaque?: boolean }) {
  const Icone = a.icone;
  const conteudo = (
    <>
      <span
        className={`flex items-center justify-center rounded-2xl bg-terracota-suave text-terracota-escuro transition-colors group-hover:bg-terracota group-hover:text-white ${destaque ? "size-14" : "size-11"}`}
      >
        <Icone className={destaque ? "size-7" : "size-5"} aria-hidden />
      </span>
      <span className="flex flex-col gap-1.5">
        <span
          className={`flex items-center gap-2 font-display font-bold text-tinta ${destaque ? "text-[24px]" : "text-[18px]"}`}
        >
          {a.titulo}
          <ArrowRight
            className="size-4 text-tinta-3 transition-transform group-hover:translate-x-1 group-hover:text-terracota"
            aria-hidden
          />
        </span>
        <span className={`leading-relaxed text-tinta-2 ${destaque ? "text-[15px]" : "text-[14px]"}`}>{a.texto}</span>
      </span>
    </>
  );
  const classe = `group flex h-full flex-col gap-4 rounded-3xl border bg-papel transition-all hover:-translate-y-0.5 hover:border-terracota hover:shadow-[0_12px_32px_-16px_rgba(21,38,59,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracota ${destaque ? "border-tinta/15 p-7" : "border-linha p-6"}`;
  return a.externo ? (
    <a href={a.href} className={classe} target="_blank" rel="noreferrer">
      {conteudo}
    </a>
  ) : (
    <Link href={a.href} className={classe}>
      {conteudo}
    </Link>
  );
}

/** Uma conversa de exemplo no topo: a pergunta, a resposta com fonte e o SMS do fim. */
function ConversaExemplo() {
  return (
    <div className="relative isolate mx-auto w-full max-w-[440px]">
      <div className="absolute -inset-4 -z-10 rotate-2 rounded-[36px] bg-terracota-suave/70" aria-hidden />
      <div className="flex flex-col gap-3 rounded-[28px] border border-linha bg-papel p-5 shadow-[0_24px_60px_-28px_rgba(21,38,59,0.45)] sm:p-6">
        <div className="flex items-center justify-between border-b border-linha pb-3">
          <Logo tamanho={18} />
          <span className="rounded-full bg-creme-2 px-2.5 py-1 text-[11px] font-semibold text-tinta-2">Exemplo</span>
        </div>
        <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-tinta px-4 py-3 text-[14px] leading-snug text-papel">
          Quero mudar os azulejos e a bancada da cozinha. Preciso de licença?
        </p>
        <div className="flex max-w-[92%] flex-col gap-2.5 rounded-2xl rounded-bl-md bg-creme px-4 py-3">
          <p className="text-[14px] leading-snug text-tinta">
            Não precisa. Obras no interior que não mexam na estrutura, na fachada nem no telhado estão isentas de licença
            e de comunicação prévia.
          </p>
          <FonteOficial documento="Regime Jurídico da Urbanização e da Edificação, artigo 6.º" />
        </div>
        <div className="mt-1 flex items-start gap-3 rounded-2xl border border-dashed border-linha p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-verde-suave">
            <Send className="size-4 text-verde" aria-hidden />
          </span>
          <p className="text-[13px] leading-snug text-tinta-2">
            <span className="font-semibold text-tinta">No fim da chamada, um SMS</span> com o resumo e um link para o que
            tem de fazer.
          </p>
        </div>
      </div>
    </div>
  );
}

export function PaginaApresentacao() {
  return (
    <div className="flex min-h-dvh flex-col bg-creme font-body text-tinta">
      <TopoApresentacao
        links={[
          ...SECOES.map((s) => ({ href: `#${s.id}`, nome: s.nome })),
          { href: "/funcionalidades", nome: "Funcionalidades" },
          { href: "/visao", nome: "Visão" },
        ]}
      />

      <main id="conteudo" tabIndex={-1} className="flex flex-col outline-none">
        {/* Topo */}
        <section className="overflow-hidden">
          <div className="mx-auto grid w-full max-w-[1120px] items-center gap-14 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pb-28 lg:pt-20">
            <div className="flex flex-col gap-7">
              <span className="inline-flex items-center gap-2 self-start rounded-full border border-linha bg-papel px-3.5 py-1.5 text-[13px] font-semibold text-tinta-2">
                <span className="size-2 rounded-full bg-terracota" aria-hidden />
                Hack4Guimarães 2035 · Falar com a câmara sem burocracia
              </span>
              <h1 className="font-display text-[48px] font-extrabold leading-[1.02] tracking-[-1.8px] text-tinta sm:text-[64px]">
                A câmara que <span className="text-terracota">atende</span>.
              </h1>
              <p className="max-w-[560px] text-[18px] leading-relaxed text-tinta-2">
                Um assistente que atende os munícipes de Guimarães por telefone, chat, SMS e app, responde só com
                informação oficial e trata do assunto na conversa. E não espera que liguem: avisa antes de um prazo
                acabar, renova a licença e liga a quem está sozinho numa onda de calor. Por trás, a câmara inteira
                num só painel.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/ligar"
                  className="inline-flex min-h-14 items-center gap-2.5 rounded-full bg-terracota px-7 text-[17px] font-bold text-white shadow-[0_10px_24px_-12px_rgba(184,74,36,0.8)] transition-colors hover:bg-terracota-escuro focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracota"
                >
                  <Phone className="size-5" aria-hidden />
                  Ligar agora
                </Link>
                <Link
                  href="/chat"
                  className="inline-flex min-h-14 items-center gap-2.5 rounded-full border-2 border-tinta px-7 text-[17px] font-bold text-tinta transition-colors hover:bg-tinta hover:text-papel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracota"
                >
                  <MessageSquare className="size-5" aria-hidden />
                  Escrever no chat
                </Link>
              </div>
              <p className="text-[14px] text-tinta-3">
                A chamada é feita no browser: basta autorizar o microfone. Quer ver o lado da câmara?{" "}
                <Link href="/entrar" className="font-semibold text-terracota underline underline-offset-2">
                  Abra o painel
                </Link>
                .
              </p>
            </div>
            <ConversaExemplo />
          </div>
        </section>

        {/* Números (todos verificados no código; nada de estimativas) */}
        <section aria-label="Em números" className="border-y border-linha bg-papel">
          <dl className="mx-auto grid w-full max-w-[1120px] grid-cols-2 gap-y-8 px-5 py-10 sm:px-8 lg:grid-cols-4">
            {NUMEROS.map(([n, t]) => (
              <div key={t} className="flex flex-col gap-1 pr-4">
                <dt className="sr-only">{t}</dt>
                <dd className="font-display text-[40px] font-extrabold leading-none tracking-[-1px] text-tinta">{n}</dd>
                <dd className="text-[14px] leading-snug text-tinta-2">{t}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Experimentar */}
        <Secao
          id="experimentar"
          rotulo="Experimentar"
          titulo="Tudo à distância de um clique"
          sub="O mesmo assistente em todos os canais, e o painel onde a câmara vê o que aconteceu."
          fundo="bg-creme-2/60"
        >
          <ul className={`grid gap-4 sm:grid-cols-2 ${PRINCIPAIS.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {PRINCIPAIS.map((a) => (
              <li key={a.titulo}>
                <CartaoAcesso a={a} destaque />
              </li>
            ))}
          </ul>
          <ul className="-mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ACESSOS.map((a) => (
              <li key={a.titulo}>
                <CartaoAcesso a={a} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-4 rounded-3xl bg-tinta p-6 text-papel sm:p-8">
            <p className="font-display text-[20px] font-bold">Perguntas para experimentar</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {PERGUNTAS.map((p) => (
                <li key={p} className="rounded-2xl bg-white/10 px-4 py-3 text-[15px] leading-snug">
                  &ldquo;{p}&rdquo;
                </li>
              ))}
            </ul>
          </div>
          {/* O caso que mostra a diferença: não informa, trata (com os dados de demonstração). */}
          <div className="flex flex-col gap-4 rounded-3xl border-2 border-terracota bg-papel p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
            <div className="flex flex-1 flex-col gap-2">
              <p className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota">Experimente uma renovação</p>
              <p className="font-display text-[22px] font-bold leading-tight">
                Não diz onde renovar: renova.
              </p>
              <p className="text-[15px] leading-relaxed text-tinta-2">
                Ligue e, quando pedir o número, escreva <strong className="text-tinta">910 000 106</strong> (o Manuel
                Pereira, do Café Pereira). Diga &ldquo;quero renovar a licença da esplanada&rdquo;. O agente encontra a
                licença que acaba daqui a 5 dias, confirma os dados, volta a ver as regras, calcula a taxa e dá a
                referência para pagar.
              </p>
            </div>
            <Link
              href="/ligar"
              className="inline-flex min-h-12 shrink-0 items-center gap-2 self-start rounded-full bg-terracota px-6 text-[16px] font-bold text-white hover:bg-terracota-escuro sm:self-center"
            >
              <Phone className="size-5" aria-hidden />
              Ligar e renovar
            </Link>
          </div>
        </Secao>

        {/* A câmara que liga primeiro */}
        <section id="liga-primeiro" aria-labelledby="liga-primeiro-titulo" className="scroll-mt-20 bg-tinta text-papel">
          <div className="mx-auto grid w-full max-w-[1120px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1.35fr] lg:py-24">
            <div className="flex flex-col gap-5">
              <span className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota-suave">Liga primeiro</span>
              <h2
                id="liga-primeiro-titulo"
                className="font-display text-[32px] font-extrabold leading-[1.1] tracking-[-0.8px] sm:text-[44px]"
              >
                A câmara que não espera que liguem.
              </h2>
              <p className="text-[17px] leading-relaxed text-papel/80">
                Um assistente que só responde fica à espera da pergunta. Este sabe o que está a acabar, o que falta e
                quem precisa, e contacta primeiro: chamada do assistente nos casos importantes, SMS nos outros.
              </p>
              <span className="inline-flex items-center gap-3 self-start rounded-2xl bg-white/10 px-4 py-3 text-[15px]">
                <PhoneOutgoing className="size-5 shrink-0 text-terracota-suave" aria-hidden />
                <span>
                  <strong className="font-semibold text-papel">{AREAS[0].itens.length} situações</strong>
                  <span className="text-papel/75"> em que a câmara liga ou avisa primeiro.</span>
                </span>
              </span>
              <Link
                href="/funcionalidades#liga-primeiro"
                className="inline-flex items-center gap-2 self-start text-[16px] font-semibold text-papel underline underline-offset-4 hover:text-terracota-suave"
              >
                Ver todas
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2">
              {LIGA_PRIMEIRO.map((l) => {
                const Icone = l.icone;
                return (
                  <li key={l.quando} className="flex flex-col gap-3 rounded-3xl bg-white/[0.07] p-5 ring-1 ring-white/10">
                    <span className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-terracota text-white">
                        <Icone className="size-4" aria-hidden />
                      </span>
                      <span className="text-[13px] font-bold uppercase tracking-[0.8px] text-terracota-suave">Quando</span>
                    </span>
                    <span className="font-display text-[18px] font-bold leading-snug">{l.quando}</span>
                    <span className="text-[14px] leading-relaxed text-papel/75">{l.faz}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Como funciona */}
        <Secao
          id="como-funciona"
          rotulo="Como funciona"
          titulo="Responder não chega. É preciso resolver."
          sub="O munícipe não quer ser encaminhado. Quer sair da conversa a saber o que fazer."
        >
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PASSOS.map((p, i) => {
              const Icone = p.icone;
              return (
                <li key={p.titulo} className="flex flex-col gap-4 rounded-3xl border border-linha bg-papel p-6">
                  <div className="flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-full bg-tinta text-papel">
                      <Icone className="size-5" aria-hidden />
                    </span>
                    <span className="font-display text-[40px] font-extrabold leading-none text-creme-2">{i + 1}</span>
                  </div>
                  <span className="font-display text-[19px] font-bold text-tinta">{p.titulo}</span>
                  <span className="text-[14px] leading-relaxed text-tinta-2">{p.texto}</span>
                </li>
              );
            })}
          </ol>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-5 rounded-3xl border border-linha bg-papel p-6 sm:p-8">
              <span className="flex items-center gap-3 font-display text-[22px] font-bold text-tinta">
                <span className="flex size-10 items-center justify-center rounded-full bg-terracota-suave">
                  <UserRound className="size-5 text-terracota-escuro" aria-hidden />
                </span>
                Para quem liga ou escreve
              </span>
              <Lista itens={MUNICIPE} icone={CircleCheck} cor="text-terracota" />
            </div>
            <div className="flex flex-col gap-5 rounded-3xl border border-linha bg-papel p-6 sm:p-8">
              <span className="flex items-center gap-3 font-display text-[22px] font-bold text-tinta">
                <span className="flex size-10 items-center justify-center rounded-full bg-verde-suave">
                  <Landmark className="size-5 text-verde" aria-hidden />
                </span>
                Para a câmara
              </span>
              <Lista itens={CAMARA} icone={CircleCheck} cor="text-verde" />
            </div>
          </div>
          <p className="text-[15px] leading-relaxed text-tinta-2">
            Também trata de escolas, habitação municipal, reservas de equipamentos e bilhetes, estacionamento e multas,
            água, cemitérios, animais e juntas de freguesia, para já com dados de demonstração.
          </p>
        </Secao>

        {/* Muito mais do que um chat */}
        <Secao
          id="destaques"
          rotulo="Destaques"
          titulo="Muito mais do que um chat."
          sub={`Por trás da conversa está a câmara inteira: ${TOTAL_FUNCIONALIDADES} funcionalidades, do atendimento à chefia, cada uma com o seu estado.`}
          fundo="bg-papel"
        >
          <GrelhaDestaques fundoCartao="bg-creme" />
          <Link
            href="/funcionalidades"
            className="inline-flex min-h-12 items-center gap-2 self-start rounded-full bg-tinta px-6 text-[16px] font-bold text-papel hover:bg-tinta-2"
          >
            Ver as {TOTAL_FUNCIONALIDADES} funcionalidades
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Secao>

        {/* Avaliação */}
        <Secao
          id="avaliacao"
          rotulo="Avaliação"
          titulo="Como sabemos que responde bem"
          sub="Um assistente da câmara não pode inventar. Por isso construímos um avaliador, e os resultados estão abertos a todos."
          fundo="bg-verde-suave/50"
        >
          <div className="grid items-start gap-8 lg:grid-cols-[1fr_1.1fr]">
            <ol className="flex flex-col gap-5">
              {[
                ["180 perguntas de teste", "Das que os munícipes fazem no dia a dia, em todas as áreas da câmara."],
                ["A resposta certa, com a fonte", "Para cada pergunta, a resposta certa escrita a partir das fontes oficiais e revista por uma pessoa."],
                [
                  "Um juiz automático",
                  "Compara cada resposta com a certa e explica o veredicto. Passar a um funcionário numa pergunta difícil conta como certo; inventar conta como errado.",
                ],
                ["Comparação justa", "As mesmas perguntas, feitas à assistente do site da câmara, avaliadas pelo mesmo juiz."],
                ["Um travão", "Nenhuma versão nova do assistente é publicada sem acertar em pelo menos 8 de cada 10."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-verde font-display text-[14px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-[16px] font-bold text-tinta">{t}</span>
                    <span className="text-[15px] leading-relaxed text-tinta-2">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <NumerosAvaliacao />
          </div>
        </Secao>

        {/* Real e simulado */}
        <Secao
          id="real"
          rotulo="Sem truques"
          titulo="O que é real e o que é simulado"
          sub="Dizemos sempre o que funciona de verdade e o que ainda está em modo de teste. Nos ecrãs, o que é simulado está marcado."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-5 rounded-3xl border border-linha bg-papel p-6">
              <span className="inline-flex items-center gap-2 self-start rounded-full bg-verde-suave px-3 py-1 text-[13px] font-bold text-verde">
                <ShieldCheck className="size-4" aria-hidden />
                Funciona de verdade
              </span>
              <Lista itens={REAL} icone={CircleCheck} cor="text-verde" />
            </div>
            <div className="flex flex-col gap-5 rounded-3xl border border-linha bg-papel p-6">
              <span className="inline-flex items-center gap-2 self-start rounded-full bg-ambar-suave px-3 py-1 text-[13px] font-bold text-ambar">
                <FlaskConical className="size-4" aria-hidden />
                Simulado, à espera de acesso
              </span>
              <Lista itens={SIMULADO} icone={FlaskConical} cor="text-ambar" />
            </div>
            <div className="flex flex-col gap-5 rounded-3xl border border-linha bg-papel p-6">
              <span className="inline-flex items-center gap-2 self-start rounded-full bg-creme-2 px-3 py-1 text-[13px] font-bold text-tinta-2">
                <FileText className="size-4" aria-hidden />
                Dados de demonstração
              </span>
              <Lista itens={DEMONSTRACAO} icone={FileText} cor="text-tinta-3" />
              <p className="mt-auto rounded-2xl bg-creme px-4 py-3 text-[14px] leading-relaxed text-tinta-2">
                <span className="font-semibold text-tinta">Ainda não:</span> número de telefone português. A demonstração
                é por chamada no browser.
              </p>
            </div>
          </div>
        </Secao>

        {/* Como está feito */}
        <Secao
          id="tecnologia"
          rotulo="Por dentro"
          titulo="Como está feito"
          sub="Um só assistente para todos os canais, uma API central e uma base de dados preparada para várias câmaras e juntas."
          fundo="bg-creme-2/60"
        >
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TECNOLOGIA.map((t) => {
              const Icone = t.icone;
              return (
                <li key={t.peca} className="flex gap-4 rounded-2xl border border-linha bg-papel p-5">
                  <Icone className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
                  <span className="flex flex-col gap-1">
                    <span className="text-[15px] font-bold text-tinta">{t.peca}</span>
                    <span className="text-[14px] leading-relaxed text-tinta-2">{t.como}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="grid gap-4 lg:grid-cols-3">
            {CONFIANCA.map((c) => {
              const Icone = c.icone;
              return (
                <div key={c.titulo} className="flex flex-col gap-3 rounded-3xl bg-tinta p-6 text-papel">
                  <Icone className="size-6 text-terracota-suave" aria-hidden />
                  <span className="font-display text-[19px] font-bold">{c.titulo}</span>
                  <span className="text-[14px] leading-relaxed text-papel/80">{c.texto}</span>
                </div>
              );
            })}
          </div>
        </Secao>

        {/* Próximos passos */}
        <Secao
          id="proximos-passos"
          rotulo="O que vem a seguir"
          titulo="Quase tudo o que falta é acesso, não código"
          sub="Cada fluxo já existe e está à espera de uma credencial ou de um acordo."
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
                    <span className="font-display text-[19px] font-bold leading-tight text-tinta">{p.passo}</span>
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
          <Link
            href="/visao"
            className="inline-flex items-center gap-2 self-start text-[16px] font-semibold text-terracota-escuro underline underline-offset-4"
          >
            Ver a visão: do concelho às outras 307 câmaras
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <div className="flex flex-col gap-5 rounded-3xl bg-terracota p-6 text-white sm:p-8">
            <p className="font-display text-[24px] font-extrabold leading-tight">Depois: um piloto em Guimarães</p>
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
