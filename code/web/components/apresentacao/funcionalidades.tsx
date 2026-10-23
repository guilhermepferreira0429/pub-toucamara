import {
  ArrowRight,
  Building2,
  CircleCheck,
  Code,
  FileSearch,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  Library,
  MessageCircle,
  Network,
  PhoneOutgoing,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  Sun,
  TestTubes,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Secao } from "./secao";
import { RodapeApresentacao, TopoApresentacao } from "./topo";

/*
 * Tudo o que o Tou, Câmara? faz hoje, por área, com o estado de cada coisa.
 * Os estados batem com o código (docs/resumo/ESTADO.md, verificado item a item):
 * "a funcionar" de ponta a ponta, "em modo de teste" quando a ligação a um
 * sistema de fora é simulada, "dados de demonstração" quando os valores
 * ou os registos são de exemplo, "na API" quando está feito e testado mas
 * ainda não tem ecrã. O que ainda não existe está na /visao.
 */

type Estado = "real" | "teste" | "demo" | "api";

const ESTADOS: Record<Estado, { rotulo: string; classe: string; icone: LucideIcon; explica: string }> = {
  real: {
    rotulo: "A funcionar",
    classe: "bg-verde-suave text-verde",
    icone: CircleCheck,
    explica: "de ponta a ponta.",
  },
  demo: {
    rotulo: "Dados de demonstração",
    classe: "bg-creme-2 text-tinta-2",
    icone: Sparkles,
    explica: "funciona, mas os registos ou os valores são de exemplo, a trocar pelos da câmara.",
  },
  teste: {
    rotulo: "Em modo de teste",
    classe: "bg-ambar-suave text-ambar",
    icone: FlaskConical,
    explica: "a ligação a um sistema de fora é simulada, e o ecrã di-lo.",
  },
  api: {
    rotulo: "Na API, sem ecrã",
    classe: "bg-tinta/10 text-tinta",
    icone: Code,
    explica: "está feito e testado, mas ainda não tem ecrã no painel.",
  },
};

interface Area {
  id: string;
  /** Nome curto, para o menu. */
  nome: string;
  titulo: string;
  sub: string;
  icone: LucideIcon;
  itens: [string, string, Estado][];
}

export const AREAS: Area[] = [
  {
    id: "liga-primeiro",
    nome: "Liga primeiro",
    titulo: "Não espera que a pessoa ligue.",
    sub: "Quando há alguma coisa a fazer, é a câmara que contacta primeiro: por chamada do assistente nos casos importantes, por SMS nos outros.",
    icone: PhoneOutgoing,
    itens: [
      ["Renova antes de acabar", "Avisa antes de uma licença acabar e, na chamada, renova: confirma os dados, volta a ver as regras, calcula a taxa e dá a referência.", "demo"],
      ["Antes de um prazo prejudicar", "Audiência prévia, alvará a caducar, pagamento a vencer: liga nos casos importantes e a quem não tem a app.", "real"],
      ["Falta um documento", "Avisa por SMS ou chamada, com o link para enviar a foto do documento.", "real"],
      ["O processo avançou", "Liga de volta a dizer o que foi decidido e o que fazer a seguir.", "real"],
      ["Liga a quem está sozinho", "Em ondas de calor, frio ou cortes de água, liga às pessoas inscritas e pergunta se estão bem.", "real"],
      ["Tem direito e ainda não pediu", "Liga a quem pode ter direito a um apoio, e o pedido fica feito na conversa.", "demo"],
      ["Só a quem é afetado", "Obras ou um corte de água numa rua: SMS a quem perguntou por ela, e não a toda a gente.", "real"],
      ["Resolvido, com a foto", "Quem reportou a ocorrência recebe um SMS quando a equipa a fecha.", "real"],
      ["Lembrete na véspera", "Da marcação, com remarcar e cancelar no link do SMS.", "real"],
      ["Prazos da câmara", "A chefia é avisada antes de passar um prazo legal da câmara.", "real"],
      ["Emergências", "SMS a toda a zona e chamada a quem mais precisa, com dupla confirmação.", "teste"],
    ],
  },
  {
    id: "atender",
    nome: "Atender",
    titulo: "Por onde as pessoas falam com a câmara.",
    sub: "O mesmo assistente em todos os canais, que se lembra de quem já ligou.",
    icone: MessageCircle,
    itens: [
      ["Chamada por voz", "No browser, sem instalar nada; a linha telefónica entra quando houver número.", "real"],
      ["Chat no site", "O mesmo assistente por escrito, com as mesmas ações.", "real"],
      ["SMS", "O resumo no fim da conversa, e o estado do processo a quem manda o número por SMS.", "real"],
      ["App do munícipe", "Android, com entrada por código SMS; no iPhone falta a aprovação da Apple.", "real"],
      ["WhatsApp", "O mesmo assistente pelo número da câmara; falta a verificação da conta pela Meta.", "teste"],
      ["A conversa continua", "Começa ao telefone e continua no chat; quem volta a ligar não tem de contar tudo outra vez.", "real"],
      ["“Fale com o meu filho”", "Um familiar junta-se à conversa, com autorização, vê o que se diz e escreve ao assistente.", "real"],
      ["Passa a um funcionário", "Quando não sabe ou a pessoa pede, com o caso resumido para não perguntar tudo de novo.", "real"],
      ["Várias línguas", "Responde na língua de quem fala, e o requerimento fica em português para a câmara.", "real"],
      ["Porta para as IAs", "Uma porta oficial (MCP) para o assistente de IA de cada pessoa perguntar e pedir à câmara.", "real"],
      ["Ler melhor", "Ouvir a página, letra maior e alto contraste em todas as páginas dos SMS.", "real"],
    ],
  },
  {
    id: "resolver",
    nome: "Resolver",
    titulo: "Não só responder: deixar o assunto tratado.",
    sub: "Antes de desligar, o pedido está feito, a taxa calculada e a pessoa sabe o que vem a seguir.",
    icone: CircleCheck,
    itens: [
      ["Licenças decididas na chamada", "Ruído, esplanada, andaimes, dístico, publicidade e recintos: o que cumpre as regras sai logo, com PDF e QR.", "demo"],
      ["Requerimentos preenchidos", "Os dados confirmados na conversa e o PDF pronto para a câmara.", "real"],
      ["Verifica os documentos por foto", "Antes de entregar: diz o que falta ou o que está fora de prazo.", "real"],
      ["Simulador de taxas", "Quanto vai pagar, antes de pedir.", "demo"],
      ["O que posso fazer nesta morada", "A zona do plano diretor e se a obra é isenta, precisa de comunicação ou de licença.", "demo"],
      ["Estado do processo", "Em que fase está, o que falta e os prazos legais, numa linha do tempo.", "real"],
      ["Marcações", "No serviço certo, com lembrete na véspera; remarcar e cancelar.", "real"],
      ["Ocorrências: “já sabemos”", "Buraco, lixo, iluminação: com foto e morada; se alguém já avisou, junta as duas.", "real"],
      ["Recolha de monos", "Marca a recolha dos móveis velhos com a empresa municipal.", "real"],
      ["Reclamações formais", "Com número e prazo legal de resposta, em dias úteis.", "real"],
      ["“Não percebi esta carta”", "A pessoa manda o ofício e o assistente explica-o; os que mais confundem vão para reescrever.", "real"],
      ["Rascunhos", "Um email, uma reclamação ou uma resposta, escritos com a pessoa.", "real"],
      ["Consultas públicas por telefone", "Participar numa chamada, com os resultados por freguesia.", "real"],
      ["Pagamentos", "Referência Multibanco e MB WAY durante a conversa.", "teste"],
      ["Entregar em nome da pessoa", "O pedido entregue no balcão online, com a Chave Móvel Digital.", "teste"],
    ],
  },
  {
    id: "servicos",
    nome: "Serviços",
    titulo: "A câmara inteira, e o concelho à volta.",
    sub: "As áreas que a câmara atende todos os dias, as juntas, as empresas municipais e quem visita.",
    icone: Building2,
    itens: [
      ["Escolas", "Inscrições, refeições, transporte e atividades.", "demo"],
      ["Habitação municipal", "Candidaturas por pontuação, rendas e reparações.", "demo"],
      ["Estacionamento", "Multas e defesas, dísticos, parques e lugares reservados.", "demo"],
      ["Reservas e bilhetes", "Pavilhões, piscinas, auditórios e eventos, com QR no bilhete.", "demo"],
      ["Cemitérios", "Sepulturas, concessões, taxas e horários.", "demo"],
      ["Animais", "Canil, adoções, animais perdidos e encontrados.", "demo"],
      ["Água e saneamento", "Leituras, faturas e avarias, enviadas à empresa da água.", "teste"],
      ["Juntas de freguesia", "Atestados e prova de vida, com painel próprio e mais simples para a junta.", "demo"],
      ["Balcão para empresas", "O que uma empresa precisa para abrir ou mudar, com o calendário das obrigações.", "demo"],
      ["Perto de si", "Obras, cortes, avisos e eventos do concelho, em lista e no mapa.", "real"],
      ["Visitar", "O que ver e o que está a acontecer, em quatro línguas.", "demo"],
    ],
  },
  {
    id: "por-dentro",
    nome: "Por dentro",
    titulo: "Quem atende, quem analisa, quem vai à rua.",
    sub: "O trabalho da câmara por trás da conversa: menos papel a circular e mais tempo para o que precisa de uma pessoa.",
    icone: LayoutDashboard,
    itens: [
      ["Caixa de entrada única", "Telefone, chat, email e balcão no mesmo sítio, com o processo criado a partir do pedido.", "real"],
      ["Encaminhamento automático", "Cada pedido vai para o serviço e o técnico certos.", "real"],
      ["Email geral triado", "Classificado, encaminhado e com um rascunho de resposta para o funcionário só aprovar.", "real"],
      ["Ao vivo", "Acompanhar uma conversa a decorrer, com sugestões a cada fala, e assumir quando é preciso.", "real"],
      ["Apoio ao técnico", "O projeto de obras analisado antes de o técnico o abrir, com o que confirmar.", "demo"],
      ["Regulamento aplicável", "As regras relevantes para aquele processo, destacadas.", "real"],
      ["Rascunho do ofício", "Parecer, ofício ou pedido de elementos para o técnico rever e aprovar.", "real"],
      ["Prazos legais", "Em dias úteis, com feriados, e alertas antes de passarem.", "real"],
      ["App da equipa de campo", "Tarefas do dia por proximidade, visita com relatório ditado, a foto do depois; funciona sem rede.", "real"],
      ["Fiscalização", "Plano de visitas do dia e relatório de vistoria ditado por voz, em PDF.", "api"],
      ["Assistente interno", "Os procedimentos da câmara explicados a quem trabalha lá, com a fonte.", "real"],
    ],
  },
  {
    id: "chefia",
    nome: "Chefia",
    titulo: "Decidir com números, não com palpites.",
    sub: "Para a chefia e o executivo: onde estão os problemas, o que sentem os munícipes e o que muda se mudar uma regra.",
    icone: Landmark,
    itens: [
      ["Pessoas só nas exceções", "O que cumpre as regras decide-se sozinho; a chefia vê quantos casos foram a uma pessoa e porquê.", "demo"],
      ["Testar uma regra antes de a aprovar", "Contra os pedidos antigos: quantos mudariam, a receita e exemplos.", "demo"],
      ["Perguntas em linguagem normal", "“Que processos terminam o prazo nos próximos 5 dias úteis?”, e a resposta com os números.", "real"],
      ["O que sentem os munícipes", "Os temas das conversas reais, sem dados pessoais.", "real"],
      ["Onde param os processos", "Tempo médio por tipo, atrasados e carga de cada técnico.", "real"],
      ["Resumo diário e relatórios", "Um resumo diário para o presidente, e relatórios semanal, mensal e para o executivo, em PDF.", "real"],
      ["O que falta no portal", "As perguntas sem resposta transformadas em melhorias para o site.", "real"],
      ["Consultas públicas resumidas", "Os temas das participações, por freguesia.", "real"],
      ["Satisfação e custos", "“Ficou resolvido?” no fim, e quanto custa cada atendimento.", "real"],
      ["Pesquisar e exportar", "Uma pesquisa para o painel inteiro e listas para o Excel.", "real"],
    ],
  },
  {
    id: "memoria",
    nome: "Memória",
    titulo: "Uma câmara que não esquece o que sabe.",
    sub: "O conhecimento mantém-se sozinho, aprende com quem trabalha lá e não se perde quando alguém sai.",
    icone: Library,
    itens: [
      ["Fontes oficiais", "Cada resposta diz de onde vem: o documento, o artigo e a data.", "real"],
      ["Recolha automática", "Os sites da câmara são lidos todos os dias e as páginas novas descobertas sozinhas.", "real"],
      ["Contradições entre sites", "Quando uma fonte muda ou duas dizem coisas diferentes, alguém revê antes.", "real"],
      ["Aprende com o funcionário", "A resposta de quem atendeu a passagem entra no assistente depois de aprovada.", "real"],
      ["Entrevista quem se vai reformar", "Faz as perguntas, a pessoa responde de viva voz, e ficam escritos os procedimentos que só ela sabia.", "real"],
      ["Linguagem simples", "Regulamentos e editais reescritos para se perceberem, com cada parte ligada ao artigo.", "real"],
      ["Tradutor do “administrativês”", "“Comunicação prévia”, “deferimento tácito”: explicados onde aparecem.", "demo"],
      ["Que regra valia nesse dia", "As versões de cada regulamento, para responder com a regra em vigor numa data.", "api"],
      ["Arquivo antigo pesquisável", "Processos digitalizados, lidos e pesquisáveis por morada.", "api"],
      ["Atas e deliberações", "Das reuniões de câmara e da assembleia, pesquisáveis, e o assistente procura nelas.", "api"],
    ],
  },
  {
    id: "aberta",
    nome: "Aberta",
    titulo: "Aberta, verificável e segura.",
    sub: "Tudo o que decide um pedido está à vista, e os dados das pessoas ficam protegidos.",
    icone: ShieldCheck,
    itens: [
      ["Regras públicas", "As regras que decidem cada pedido à vista de todos, com histórico e o “porquê” de cada decisão.", "real"],
      ["Avaliação aberta", "Perguntas de teste, resposta certa e veredicto de um juiz, à vista em /avaliacao.", "real"],
      ["As perguntas da câmara", "Cada câmara junta as que mais recebe, e o assistente só vai para o ar quando passa nelas.", "real"],
      ["Números verificados", "Valores e prazos ditos pelo assistente confirmados na fonte.", "real"],
      ["Dados abertos", "Indicadores e conjuntos de dados em CSV e JSON, com histórico.", "api"],
      ["Contratação pública", "“Cabe no ajuste direto?”: os limiares, o acumulado com a mesma entidade e as peças.", "api"],
      ["Dados pessoais fora da IA", "Emails, telefones, NIF e IBAN tirados antes de qualquer texto ir para a IA.", "real"],
      ["Cada câmara só vê o seu", "Segurança por linha na base de dados, para cada câmara e cada junta.", "real"],
      ["Registo de acessos", "Quem viu o quê, e ouvir uma gravação, fica registado.", "real"],
      ["Gravação avisada", "A chamada diz que é gravada, e a pessoa pode recusar.", "real"],
      ["Entrar com a conta da câmara", "Login com o sistema de contas que a câmara já usa (OIDC).", "real"],
    ],
  },
];

export const TOTAL_FUNCIONALIDADES = AREAS.reduce((n, a) => n + a.itens.length, 0);

interface Destaque {
  icone: LucideIcon;
  titulo: string;
  texto: string;
  estado: Estado;
  experimentar?: { href: string; texto: string };
}

/** O que nenhum chat faz. Os mesmos destaques na página inicial. */
export const DESTAQUES: Destaque[] = [
  {
    icone: RotateCcw,
    titulo: "Renova a licença na chamada",
    texto: "Avisa antes de acabar e, na mesma chamada, confirma os dados, volta a ver as regras, calcula a taxa e dá a referência para pagar.",
    estado: "demo",
    experimentar: { href: "/ligar?experimentar=renovacao", texto: "Experimentar com o seu número" },
  },
  {
    icone: PhoneOutgoing,
    titulo: "Liga antes de o prazo acabar",
    texto: "Audiência prévia, documento em falta, alvará a caducar: a câmara contacta primeiro, em vez de esperar pela reclamação.",
    estado: "real",
  },
  {
    icone: Sun,
    titulo: "Liga a quem está sozinho",
    texto: "Numa onda de calor ou num corte de água, liga às pessoas inscritas e pergunta se estão bem.",
    estado: "real",
  },
  {
    icone: Scale,
    titulo: "Decide na chamada",
    texto: "O que cumpre as regras públicas sai logo, com PDF e QR. As pessoas da câmara só tratam das exceções.",
    estado: "demo",
    experimentar: { href: "/regras", texto: "Ver as regras" },
  },
  {
    icone: TestTubes,
    titulo: "Testa uma regra antes de a aprovar",
    texto: "Corre a regra nova contra os pedidos antigos: quantos mudariam, quanto se cobraria e exemplos.",
    estado: "demo",
  },
  {
    icone: FileSearch,
    titulo: "Analisa o projeto antes do técnico",
    texto: "As verificações do projeto de obras feitas antes de o técnico o abrir, sempre marcadas “a confirmar”.",
    estado: "demo",
  },
  {
    icone: UserPlus,
    titulo: "“Fale com o meu filho”",
    texto: "Um familiar junta-se à conversa, com autorização, e ajuda quem tem mais dificuldade.",
    estado: "real",
  },
  {
    icone: Network,
    titulo: "A porta oficial para as IAs",
    texto: "O assistente de IA de cada pessoa pergunta e pede à câmara pela porta oficial (MCP), com as mesmas regras.",
    estado: "real",
    experimentar: { href: "/ia", texto: "Ligar o seu assistente" },
  },
];

function Chip({ estado, pequeno = false }: { estado: Estado; pequeno?: boolean }) {
  const e = ESTADOS[estado];
  const Icone = e.icone;
  return (
    <span
      className={`inline-flex items-center gap-1.5 self-start rounded-full font-bold ${e.classe} ${pequeno ? "px-2.5 py-1 text-[12px]" : "px-3 py-1 text-[13px]"}`}
    >
      <Icone className="size-3.5" aria-hidden />
      {e.rotulo}
    </span>
  );
}

/** A grelha dos destaques, usada aqui e na página inicial. */
export function GrelhaDestaques({ fundoCartao = "bg-papel" }: { fundoCartao?: string }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {DESTAQUES.map((d) => {
        const Icone = d.icone;
        return (
          <li key={d.titulo} className={`flex flex-col gap-3.5 rounded-3xl border border-linha p-6 ${fundoCartao}`}>
            <span className="flex size-11 items-center justify-center rounded-2xl bg-terracota text-white">
              <Icone className="size-5" aria-hidden />
            </span>
            <span className="font-display text-[19px] font-bold leading-tight">{d.titulo}</span>
            <span className="text-[14px] leading-relaxed text-tinta-2">{d.texto}</span>
            <span className="mt-auto flex flex-col gap-3 pt-1">
              <Chip estado={d.estado} pequeno />
              {d.experimentar && (
                <Link
                  href={d.experimentar.href}
                  className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-terracota-escuro underline underline-offset-4 hover:text-terracota"
                >
                  {d.experimentar.texto}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PaginaFuncionalidades() {
  const todas = AREAS.flatMap((a) => a.itens);
  const conta = (e: Estado) => todas.filter((i) => i[2] === e).length;
  return (
    <div className="min-h-dvh bg-creme text-tinta">
      <TopoApresentacao
        links={[
          { href: "#destaques", nome: "Destaques" },
          ...AREAS.slice(0, 6).map((a) => ({ href: `#${a.id}`, nome: a.nome })),
        ]}
      />
      <main id="conteudo">
        <section className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-5 pb-6 pt-14 sm:px-8 lg:pt-20">
          <div className="flex max-w-[800px] flex-col gap-5">
            <span className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota">Funcionalidades</span>
            <h1 className="font-display text-[44px] font-extrabold leading-[1.02] tracking-[-1.6px] sm:text-[60px]">
              Muito mais do que um chat.
            </h1>
            <p className="text-[18px] leading-relaxed text-tinta-2">
              {TOTAL_FUNCIONALIDADES} funcionalidades em {AREAS.length} áreas: o que o munícipe vê, o que a câmara usa por
              dentro e o que acontece sem ninguém ligar. Cada uma com o seu estado. O que ainda não existe não está aqui:
              está na{" "}
              <Link href="/visao" className="font-semibold text-terracota-escuro underline underline-offset-2">
                visão
              </Link>
              .
            </p>
          </div>
          <ul className="flex flex-wrap gap-3" aria-label="Estados">
            {(Object.keys(ESTADOS) as Estado[]).map((e) => {
              const { rotulo, classe, icone: Icone } = ESTADOS[e];
              return (
                <li
                  key={e}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[14px] font-semibold ${classe}`}
                >
                  <Icone className="size-4" aria-hidden />
                  {rotulo} · {conta(e)}
                </li>
              );
            })}
          </ul>
          <dl className="grid max-w-[900px] gap-x-8 gap-y-1.5 text-[14px] leading-relaxed text-tinta-2 sm:grid-cols-2">
            {(Object.keys(ESTADOS) as Estado[]).map((e) => (
              <div key={e}>
                <dt className="inline font-semibold text-tinta">{ESTADOS[e].rotulo}:</dt>{" "}
                <dd className="inline">{ESTADOS[e].explica}</dd>
              </div>
            ))}
          </dl>
          <nav aria-label="Áreas" className="flex flex-wrap gap-2">
            {AREAS.map((a) => {
              const Icone = a.icone;
              return (
                <a
                  key={a.id}
                  href={`#${a.id}`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-linha bg-papel px-4 text-[14px] font-semibold text-tinta hover:border-terracota hover:text-terracota-escuro"
                >
                  <Icone className="size-4 text-terracota" aria-hidden />
                  {a.nome}
                  <span className="text-tinta-3">{a.itens.length}</span>
                </a>
              );
            })}
          </nav>
        </section>

        <Secao
          id="destaques"
          rotulo="Destaques"
          titulo="O que nenhum chat faz."
          sub="Não espera que liguem, decide o que é simples e deixa às pessoas da câmara só o que precisa de uma pessoa."
        >
          <GrelhaDestaques />
        </Secao>

        {AREAS.map((a, i) => {
          const Icone = a.icone;
          const escuro = i % 2 === 0;
          return (
            <Secao key={a.id} id={a.id} rotulo={a.nome} titulo={a.titulo} sub={a.sub} fundo={escuro ? "bg-papel" : ""}>
              <div className="-mt-4 flex items-center gap-3 text-tinta-2">
                <Icone className="size-5 text-terracota" aria-hidden />
                <span className="text-[14px]">{a.itens.length} funcionalidades</span>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {a.itens.map(([titulo, texto, estado]) => (
                  <li
                    key={titulo}
                    className={`flex flex-col gap-3 rounded-3xl border border-linha p-5 ${escuro ? "bg-creme" : "bg-papel"}`}
                  >
                    <span className="font-display text-[18px] font-bold leading-tight">{titulo}</span>
                    <span className="text-[14px] leading-relaxed text-tinta-2">{texto}</span>
                    <span className="mt-auto">
                      <Chip estado={estado} pequeno />
                    </span>
                  </li>
                ))}
              </ul>
            </Secao>
          );
        })}
      </main>
      <RodapeApresentacao />
    </div>
  );
}
