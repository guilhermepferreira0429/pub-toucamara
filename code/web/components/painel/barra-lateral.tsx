"use client";

import {
  AlarmClock,
  BadgeCheck,
  BookOpen,
  Bot,
  CalendarDays,
  ChartColumn,
  ChevronsUpDown,
  CircleParking,
  FolderOpen,
  GraduationCap,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  Lock,
  FileText,
  FileSignature,
  FileQuestion,
  HandCoins,
  HeartHandshake,
  House,
  LogOut,
  Map as IconeMapa,
  MapPin,
  Megaphone,
  MonitorPlay,
  MessageSquareHeart,
  MessagesSquare,
  Newspaper,
  NotebookPen,
  PhoneOutgoing,
  Radio,
  Receipt,
  Send,
  Search,
  Siren,
  Sparkles,
  Store,
  Ticket,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/marca";
import { abrirPesquisa, useTeclaAtalho } from "@/lib/pesquisa";
import { paginaDisponivel } from "@/lib/juntas";
import { useSessao, type Perfil, type Recurso } from "@/lib/sessao";

/*
 * Barra lateral única de todos os ecrãs da câmara (componente "Barra lateral
 * · unificada" do design). Itens sem permissão aparecem com cadeado e
 * esbatidos; uma secção inteira fica trancada quando o perfil não tem
 * nenhum dos seus itens.
 */

export interface Item {
  rotulo: string;
  href: string;
  icone: LucideIcon;
  recurso: Recurso;
  /** Chave da contagem (badge), quando há. */
  contagem?: keyof Contagens;
  /** Só aparece com a demonstração ligada no servidor (DEMO_ATIVA). */
  soDemo?: boolean;
}

export interface Seccao {
  titulo: string | null;
  itens: Item[];
}

export interface Contagens {
  entrada?: number;
  conversas?: number;
  processos?: number;
  ocorrencias?: number;
  conhecimento?: number;
}

export const SECCOES: Seccao[] = [
  {
    titulo: null,
    itens: [
      {
        rotulo: "Visão geral",
        href: "/painel",
        icone: LayoutDashboard,
        recurso: "visao_geral",
      },
    ],
  },
  {
    titulo: "ATENDIMENTO",
    itens: [
      {
        rotulo: "Conversas",
        href: "/painel/conversas",
        icone: MessagesSquare,
        recurso: "conversas",
        contagem: "conversas",
      },
      {
        rotulo: "Ao vivo",
        href: "/painel/ao-vivo",
        icone: Radio,
        recurso: "conversas",
      },
      {
        rotulo: "Entrada",
        href: "/painel/entrada",
        icone: Inbox,
        recurso: "entrada",
        contagem: "entrada",
      },
      {
        rotulo: "Reclamações",
        href: "/painel/reclamacoes",
        icone: NotebookPen,
        recurso: "reclamacoes",
      },
      {
        rotulo: "Marcações",
        href: "/painel/marcacoes",
        icone: CalendarDays,
        recurso: "conversas",
      },
      {
        rotulo: "Chamadas do agente",
        href: "/painel/chamadas",
        icone: PhoneOutgoing,
        recurso: "processos",
      },
      {
        rotulo: "Porta para as IAs",
        href: "/painel/ias",
        icone: Sparkles,
        recurso: "conversas",
      },
      {
        rotulo: "Ação social",
        href: "/painel/campanhas",
        icone: HeartHandshake,
        recurso: "acao_social",
      },
      {
        rotulo: "Apoios",
        href: "/painel/apoios",
        icone: HandCoins,
        recurso: "acao_social",
      },
    ],
  },
  {
    titulo: "PROCESSOS",
    itens: [
      {
        rotulo: "Processos",
        href: "/painel/processos",
        icone: FolderOpen,
        recurso: "processos",
        contagem: "processos",
      },
      {
        rotulo: "Atestados",
        href: "/painel/atestados",
        icone: FileSignature,
        recurso: "atestados",
      },
      {
        rotulo: "Ocorrências",
        href: "/painel/ocorrencias",
        icone: MapPin,
        recurso: "ocorrencias_ver",
        contagem: "ocorrencias",
      },
      {
        rotulo: "Licenças",
        href: "/painel/licencas",
        icone: BadgeCheck,
        recurso: "processos",
      },
      {
        rotulo: "Antecipações",
        href: "/painel/antecipacoes",
        icone: AlarmClock,
        recurso: "processos",
      },
      {
        rotulo: "Balcão para empresas",
        href: "/painel/empresas",
        icone: Store,
        recurso: "processos",
      },
      {
        rotulo: "Pagamentos",
        href: "/painel/pagamentos",
        icone: Receipt,
        recurso: "processos",
      },
      {
        rotulo: "Entregas em nome",
        href: "/painel/entregas",
        icone: Send,
        recurso: "processos",
      },
      {
        rotulo: "Cartas não percebidas",
        href: "/painel/cartas",
        icone: FileQuestion,
        recurso: "processos",
      },
      {
        rotulo: "Escolas",
        href: "/painel/escolas",
        icone: GraduationCap,
        recurso: "escolas",
      },
      {
        rotulo: "Habitação municipal",
        href: "/painel/habitacao",
        icone: House,
        recurso: "habitacao",
      },
      {
        rotulo: "Estacionamento",
        href: "/painel/estacionamento",
        icone: CircleParking,
        recurso: "estacionamento",
      },
      {
        rotulo: "Reservas",
        href: "/painel/reservas",
        icone: Ticket,
        recurso: "reservas",
      },
    ],
  },
  {
    titulo: "GESTÃO",
    itens: [
      {
        rotulo: "Indicadores",
        href: "/painel/indicadores",
        icone: ChartColumn,
        recurso: "indicadores",
      },
      {
        rotulo: "O que sentem os munícipes",
        href: "/painel/concelho",
        icone: MessageSquareHeart,
        recurso: "indicadores",
      },
      {
        rotulo: "Conhecimento",
        href: "/painel/conhecimento",
        icone: BookOpen,
        recurso: "conhecimento_ver",
        contagem: "conhecimento",
      },
      {
        rotulo: "Procedimentos",
        href: "/painel/procedimentos",
        icone: ClipboardList,
        recurso: "procedimentos_ver",
      },
      {
        rotulo: "Assistente interno",
        href: "/painel/assistente",
        icone: GraduationCap,
        recurso: "procedimentos_ver",
      },
      {
        rotulo: "Ordenamento",
        href: "/painel/ordenamento",
        icone: IconeMapa,
        recurso: "conhecimento_ver",
      },
      {
        rotulo: "Relatórios",
        href: "/painel/relatorios",
        icone: FileText,
        recurso: "indicadores",
      },
      {
        rotulo: "Consultas públicas",
        href: "/painel/consultas",
        icone: Vote,
        recurso: "indicadores",
      },
      {
        rotulo: "Comunicados e eventos",
        href: "/painel/comunicados",
        icone: Newspaper,
        recurso: "visao_geral",
      },
      {
        rotulo: "Avisos por zona",
        href: "/painel/avisos",
        icone: Megaphone,
        recurso: "agente",
      },
      {
        rotulo: "Emergências",
        href: "/painel/emergencias",
        icone: Siren,
        recurso: "acao_social",
      },
      {
        rotulo: "Agente",
        href: "/painel/agente",
        icone: Bot,
        recurso: "agente",
      },
      {
        rotulo: "Equipa e acessos",
        href: "/painel/equipa",
        icone: Users,
        recurso: "equipa",
      },
      {
        rotulo: "Preparar demo",
        href: "/painel/demo",
        icone: MonitorPlay,
        recurso: "demo",
        soDemo: true,
      },
    ],
  },
];

/** A demonstração está ligada no servidor? (só pergunta quem tem o recurso). */
function useDemoAtiva(): boolean {
  const { pedido, pode } = useSessao();
  const [ativa, setAtiva] = useState(false);
  useEffect(() => {
    if (!pode("demo")) return;
    pedido<{ ativa: boolean }>("/v1/painel/demo/estado")
      .then((r) => setAtiva(r.ativa))
      .catch(() => undefined);
  }, [pedido, pode]);
  return ativa;
}

const PERFIS: Record<Perfil, string> = {
  atendimento: "Atendimento",
  tecnico: "Técnico",
  chefe_divisao: "Chefe de divisão",
  vereador: "Vereação",
  equipa_toucamara: "Equipa Tou, Câmara?",
  admin: "Administração",
};

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return (
    (p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")
  ).toUpperCase();
}

function Contagem({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="rounded-[10px] bg-creme-2 px-2 py-0.5 text-[11px] font-bold text-tinta-2">
      {n}
    </span>
  );
}

export function BarraLateral({ contagens = {} }: { contagens?: Contagens }) {
  const { eu, pode, sair } = useSessao();
  const caminho = usePathname();
  const demoAtiva = useDemoAtiva();
  // Numa junta de freguesia o menu é reduzido (lib/juntas.ts).
  const visivel = (it: Item) =>
    paginaDisponivel(eu?.municipio.tipo, it.href) &&
    (!it.soDemo || (demoAtiva && pode(it.recurso)));
  const tecla = useTeclaAtalho();

  const ativo = (href: string) =>
    href === "/painel" ? caminho === "/painel" : caminho.startsWith(href);

  return (
    <aside className="sticky top-0 flex h-dvh w-62 shrink-0 flex-col gap-4.5 overflow-y-auto border-r border-linha bg-papel px-4 pb-5 pt-7">
      <div className="flex shrink-0 flex-col gap-2.5">
        <Link href="/painel" className="w-fit">
          <Logo tamanho={21} />
        </Link>
        <div className="flex items-center gap-2 rounded-lg bg-creme px-2 py-1.5">
          <span className="flex-1 truncate text-xs font-semibold text-tinta-2">
            {eu?.municipio.nome ?? "—"}
          </span>
          <ChevronsUpDown className="size-3.5 text-tinta-3" aria-hidden />
        </div>
      </div>

      {/* shrink-0: com muitos itens a barra faz scroll, e sem isto a
          pesquisa e o cabeçalho encolhiam para caber na altura. É um botão
          com ar de caixa: a pesquisa faz-se na paleta (pesquisa-global). */}
      <button
        type="button"
        onClick={abrirPesquisa}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-10 shrink-0 cursor-text items-center gap-2.5 rounded-xl border border-linha bg-creme pl-3 pr-1.5 text-left transition-colors hover:border-tinta-3/40 focus-visible:border-terracota focus-visible:bg-papel focus-visible:outline-none"
      >
        <Search className="size-4 shrink-0 text-tinta-3" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] text-tinta-3">
          Pesquisar tudo
        </span>
        <kbd
          aria-hidden
          className="flex h-6 shrink-0 items-center rounded-md border border-linha bg-papel px-1.5 font-sans text-[11px] font-semibold text-tinta-3 shadow-[0_1px_0_var(--color-linha)]"
        >
          {tecla}
        </kbd>
      </button>

      <nav className="flex shrink-0 flex-col gap-4.5" aria-label="Painel">
        {SECCOES.map((s, i) => {
          const trancada = s.itens
            .filter(visivel)
            .every((it) => !pode(it.recurso));
          return (
            <div key={i} className="flex flex-col gap-0.5">
              {s.titulo && (
                <div className="flex items-center justify-between px-3 pb-1.5">
                  <span className="text-[11px] font-bold text-tinta-3">
                    {s.titulo}
                  </span>
                  {trancada && (
                    <Lock
                      className="size-3 text-tinta-3"
                      aria-label="Sem acesso"
                    />
                  )}
                </div>
              )}
              {s.itens.filter(visivel).map((it) => {
                const permitido = pode(it.recurso);
                const Icone = it.icone;
                const corpo = (
                  <>
                    <Icone className="size-[17px]" aria-hidden />
                    <span className="flex-1 text-sm font-medium">
                      {it.rotulo}
                    </span>
                    {permitido ? (
                      <Contagem n={it.contagem && contagens[it.contagem]} />
                    ) : (
                      <Lock
                        className="size-3.5 text-tinta-3"
                        aria-label="Sem acesso"
                      />
                    )}
                  </>
                );
                const base =
                  "flex h-9 items-center gap-2.5 rounded-[10px] px-3";
                return permitido ? (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={ativo(it.href) ? "page" : undefined}
                    className={`${base} ${
                      ativo(it.href)
                        ? "bg-terracota-suave text-terracota-escuro"
                        : "text-tinta-2 hover:bg-creme"
                    }`}
                  >
                    {corpo}
                  </Link>
                ) : (
                  <span
                    key={it.href}
                    className={`${base} cursor-not-allowed text-tinta-2 opacity-45`}
                    title="O seu perfil não tem acesso a esta área"
                  >
                    {corpo}
                  </span>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="flex-1" />

      {eu && (
        <div className="flex items-center gap-2.5 border-t border-linha px-2 pt-3">
          {eu.utilizador.foto_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={eu.utilizador.foto_url}
              alt=""
              className="size-8.5 rounded-full border-[1.5px] border-papel object-cover"
            />
          ) : (
            <span className="flex size-8.5 items-center justify-center rounded-full bg-tinta text-xs font-bold text-white">
              {iniciais(eu.utilizador.nome)}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-[13px] font-semibold text-tinta">
              {eu.utilizador.nome}
            </span>
            <span className="truncate text-[11px] text-tinta-3">
              {PERFIS[eu.utilizador.perfil]}
            </span>
          </span>
          <button
            type="button"
            onClick={sair}
            className="rounded-md p-1 text-tinta-3 hover:bg-creme hover:text-tinta"
            aria-label="Sair"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      )}
    </aside>
  );
}

/** Contagens dos badges (entrada única); devolve {} se o perfil não tiver acesso. */
export function useContagens(): Contagens {
  const { pedido, pode } = useSessao();
  const [c, setC] = useState<Contagens>({});
  useEffect(() => {
    if (!pode("entrada")) return;
    pedido<{ por_tipo?: Record<string, number> }>("/v1/painel/entrada/resumo")
      .then((r) =>
        setC({
          entrada: Object.values(r.por_tipo ?? {}).reduce((a, b) => a + b, 0),
          conversas: r.por_tipo?.passagem,
          processos: r.por_tipo?.processo,
          ocorrencias: r.por_tipo?.ocorrencia,
        }),
      )
      .catch(() => undefined);
  }, [pedido, pode]);
  return c;
}
