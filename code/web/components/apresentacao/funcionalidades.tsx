import {
  BadgeCheck,
  Building2,
  CircleCheck,
  FlaskConical,
  HardHat,
  HeartHandshake,
  LayoutDashboard,
  MapPinned,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Secao } from "./pagina";
import { RodapeApresentacao, TopoApresentacao } from "./topo";

/*
 * Tudo o que o Tou, Câmara? faz hoje, por área, com o estado de cada coisa.
 * Os estados batem com o código (docs/ESTADO.md, verificado item a item):
 * "a funcionar" de ponta a ponta, "em modo de teste" quando a ligação a um
 * sistema de fora é simulada, "dados de demonstração" quando os valores
 * ou os registos são de exemplo. O que ainda não existe está na /visao.
 */

type Estado = "real" | "teste" | "demo";

const ESTADOS: Record<Estado, { rotulo: string; classe: string; icone: LucideIcon }> = {
  real: { rotulo: "A funcionar", classe: "bg-verde-suave text-verde", icone: CircleCheck },
  teste: { rotulo: "Em modo de teste", classe: "bg-ambar-suave text-ambar", icone: FlaskConical },
  demo: { rotulo: "Dados de demonstração", classe: "bg-creme-2 text-tinta-2", icone: Sparkles },
};

interface Area {
  id: string;
  titulo: string;
  sub: string;
  icone: LucideIcon;
  itens: [string, string, Estado][];
}

const AREAS: Area[] = [
  {
    id: "atender",
    titulo: "Atender",
    sub: "Por onde as pessoas falam com a câmara.",
    icone: MessageCircle,
    itens: [
      ["Chamada por voz", "No browser, sem instalar nada; a linha telefónica entra quando houver número.", "real"],
      ["Chat no site", "O mesmo assistente por escrito, com as mesmas ferramentas.", "real"],
      ["SMS no fim", "O que ficou combinado, os papéis a levar e os links para seguir o pedido.", "real"],
      ["App do munícipe", "Android (o APK está gerado), com entrada por código SMS; no iPhone falta a aprovação da Apple.", "real"],
      ["Passa a um funcionário", "Quando não sabe ou a pessoa pede, com o resumo para não perguntar tudo de novo.", "real"],
      ["Várias línguas", "Responde na língua de quem fala; o turismo tem páginas em quatro línguas.", "real"],
      ["Assistentes de IA", "Uma porta oficial (MCP) para o assistente de cada pessoa perguntar à câmara.", "real"],
      ["Ler melhor", "Ouvir a página, letra maior e alto contraste em todas as páginas dos SMS.", "real"],
    ],
  },
  {
    id: "responder",
    titulo: "Responder certo",
    sub: "Só com informação oficial, e a provar que acerta.",
    icone: BadgeCheck,
    itens: [
      ["Fontes oficiais", "Cada resposta diz de onde vem: o documento, o artigo e a data.", "real"],
      ["Recolha automática", "Os sites da câmara são lidos sozinhos e as páginas novas descobertas.", "real"],
      ["Alterações e contradições", "Quando uma fonte muda ou duas dizem coisas diferentes, alguém revê antes.", "real"],
      ["Avaliação aberta", "Perguntas de teste, resposta certa e veredicto de um juiz, à vista em /avaliacao.", "real"],
      ["Números verificados", "Valores e prazos ditos pelo agente confirmados na fonte.", "real"],
      ["Linguagem simples", "Regulamentos reescritos para se perceberem, com cada parte ligada ao artigo.", "real"],
    ],
  },
  {
    id: "tratar",
    titulo: "Tratar do assunto",
    sub: "Não só responder: deixar o pedido feito na conversa.",
    icone: CircleCheck,
    itens: [
      ["Requerimentos preenchidos", "Os dados confirmados na conversa e o PDF pronto para a câmara.", "real"],
      ["Estado do processo", "Pelo NIF: em que fase está e o que falta.", "real"],
      ["Marcações", "Marca no serviço certo, com lembrete na véspera; remarcar e cancelar.", "real"],
      ["Ocorrências", "Buraco, lixo, iluminação: com foto e morada, e \"já sabemos\" quando alguém já avisou.", "real"],
      ["Reclamações formais", "Com número e prazo legal de resposta, em dias úteis.", "real"],
      ["Não percebi esta carta", "A pessoa manda o ofício e o agente explica-o; os que mais confundem vão para reescrever.", "real"],
      ["Licenças", "Decididas pelas regras públicas: o que cumpre sai logo, o resto vai a uma pessoa.", "demo"],
      ["Pagamentos", "Referência Multibanco e MB WAY durante a conversa.", "teste"],
      ["Entregar em nome da pessoa", "O pedido entregue no balcão online, com a Chave Móvel Digital.", "teste"],
    ],
  },
  {
    id: "territorio",
    titulo: "Território",
    sub: "O que se passa e o que se pode fazer em cada sítio.",
    icone: MapPinned,
    itens: [
      ["Perto de si", "Obras, cortes, avisos e eventos do concelho, em lista e no mapa.", "real"],
      ["Avisos por zona", "SMS a quem perguntou por aquela rua, quando há obras ou cortes.", "real"],
      ["O que posso fazer nesta morada", "A zona do plano diretor e se a obra é isenta, precisa de comunicação ou de licença.", "demo"],
      ["Emergências", "SMS a toda a zona e chamada a quem mais precisa; os operadores e o alerta para todos os telemóveis são simulados.", "teste"],
      ["Visitar", "O que ver e o que está a acontecer, para quem visita.", "demo"],
    ],
  },
  {
    id: "social",
    titulo: "Ação social",
    sub: "A câmara que liga primeiro.",
    icone: HeartHandshake,
    itens: [
      ["Ligar a quem está sozinho", "Em ondas de calor, frio ou cortes de água, só a quem deu autorização.", "real"],
      ["Apoios", "Quem tem direito e ainda não pediu, com o pedido feito na conversa.", "demo"],
    ],
  },
  {
    id: "servicos",
    titulo: "Serviços municipais",
    sub: "As áreas que a câmara atende todos os dias, num só catálogo.",
    icone: Building2,
    itens: [
      ["Escolas", "Inscrições, refeições, transporte e atividades.", "demo"],
      ["Habitação municipal", "Candidaturas, rendas e reparações.", "demo"],
      ["Estacionamento", "Multas, parques e lugares para deficientes.", "demo"],
      ["Reservas e bilhetes", "Pavilhões, piscinas, auditórios e eventos.", "demo"],
      ["Cemitérios e animais", "Sepulturas e concessões; canil, adoções e animais perdidos.", "demo"],
      ["Água e saneamento", "Leituras, faturas e avarias, com a empresa da água.", "teste"],
      ["Juntas de freguesia", "Atestados e prova de vida, com painel próprio da junta.", "demo"],
      ["Balcão para empresas", "O que uma empresa precisa para abrir ou mudar, passo a passo.", "demo"],
    ],
  },
  {
    id: "painel",
    titulo: "Para a câmara",
    sub: "O painel: ver tudo, decidir depressa e saber o que os munícipes sentem.",
    icone: LayoutDashboard,
    itens: [
      ["Visão geral e indicadores", "O que o agente tratou, o que precisa de atenção e os números do período.", "real"],
      ["O que sentem os munícipes", "Perguntas em linguagem normal sobre as conversas reais, sem dados pessoais.", "real"],
      ["Ao vivo", "Acompanhar uma conversa a decorrer, com sugestões, e assumir quando é preciso.", "real"],
      ["Relatórios", "Semanal, mensal e para o executivo, em PDF.", "real"],
      ["Apoio ao técnico", "Análise de projetos de obras antes de o técnico os abrir, com o que confirmar.", "demo"],
      ["Assistente interno", "Os procedimentos da câmara explicados a quem trabalha lá.", "real"],
      ["A câmara liga antes", "Avisos antes de um prazo acabar ou de uma licença expirar.", "real"],
      ["Pesquisar tudo e exportar", "Uma pesquisa para o painel inteiro e listas para o Excel.", "real"],
      ["Satisfação e custos", "\"Ficou resolvido?\" no fim, e quanto custa cada atendimento.", "real"],
    ],
  },
  {
    id: "equipa",
    titulo: "Equipa de campo",
    sub: "Quem resolve na rua.",
    icone: HardHat,
    itens: [
      ["App da equipa", "Tarefas do dia por proximidade, a foto do depois para fechar, e funciona sem rede.", "real"],
    ],
  },
  {
    id: "confianca",
    titulo: "Confiança e privacidade",
    sub: "O que protege a câmara e as pessoas.",
    icone: ShieldCheck,
    itens: [
      ["Dados pessoais fora da IA", "Emails, telefones, NIF e IBAN tirados antes de qualquer texto ir para a IA.", "real"],
      ["Texto de fora delimitado", "Páginas, emails e falas tratados como dados, nunca como instruções.", "real"],
      ["Registo de acessos", "Quem viu o quê, e ouvir uma gravação, fica registado.", "real"],
      ["Regras públicas", "As regras que decidem cada pedido à vista de todos, com histórico.", "real"],
      ["Gravação avisada", "A chamada diz que é gravada, e a pessoa pode recusar.", "real"],
    ],
  },
];

export function PaginaFuncionalidades() {
  const todas = AREAS.flatMap((a) => a.itens);
  const conta = (e: Estado) => todas.filter((i) => i[2] === e).length;
  return (
    <div className="min-h-dvh bg-creme text-tinta">
      <TopoApresentacao links={AREAS.slice(0, 5).map((a) => ({ href: `#${a.id}`, nome: a.titulo }))} />
      <main id="conteudo">
        <section className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-5 pb-6 pt-14 sm:px-8 lg:pt-20">
          <div className="flex max-w-[760px] flex-col gap-5">
            <span className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota">Funcionalidades</span>
            <h1 className="font-display text-[44px] font-extrabold leading-[1.02] tracking-[-1.6px] sm:text-[56px]">
              Tudo o que já faz hoje.
            </h1>
            <p className="text-[18px] leading-relaxed text-tinta-2">
              {todas.length} funcionalidades, com o estado de cada uma. O que ainda não existe não está aqui: está na{" "}
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
                <li key={e} className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[14px] font-semibold ${classe}`}>
                  <Icone className="size-4" aria-hidden />
                  {rotulo} · {conta(e)}
                </li>
              );
            })}
          </ul>
          <p className="max-w-[760px] text-[14px] leading-relaxed text-tinta-2">
            <strong className="text-tinta">Em modo de teste:</strong> a ligação a um sistema de fora é simulada e o ecrã
            di-lo. <strong className="text-tinta">Dados de demonstração:</strong> funciona, mas os registos ou os valores
            são de exemplo, a trocar pelos da câmara.
          </p>
        </section>

        {AREAS.map((a, i) => {
          const Icone = a.icone;
          return (
            <Secao key={a.id} id={a.id} rotulo={a.titulo} titulo={a.sub} fundo={i % 2 ? "bg-papel" : ""}>
              <div className="-mt-4 flex items-center gap-3 text-tinta-2">
                <Icone className="size-5 text-terracota" aria-hidden />
                <span className="text-[14px]">{a.itens.length} funcionalidades</span>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {a.itens.map(([titulo, texto, estado]) => {
                  const e = ESTADOS[estado];
                  const IconeEstado = e.icone;
                  return (
                    <li
                      key={titulo}
                      className={`flex flex-col gap-3 rounded-3xl border border-linha p-5 ${i % 2 ? "bg-creme" : "bg-papel"}`}
                    >
                      <span className="font-display text-[18px] font-bold leading-tight">{titulo}</span>
                      <span className="text-[14px] leading-relaxed text-tinta-2">{texto}</span>
                      <span
                        className={`mt-auto inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[12px] font-bold ${e.classe}`}
                      >
                        <IconeEstado className="size-3.5" aria-hidden />
                        {e.rotulo}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Secao>
          );
        })}
      </main>
      <RodapeApresentacao />
    </div>
  );
}
