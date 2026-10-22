"use client";

import {
  AlarmClock,
  BadgeCheck,
  BookOpen,
  Bot,
  CalendarDays,
  ChartColumn,
  Landmark,
  CircleParking,
  Droplets,
  Flower2,
  FolderOpen,
  PawPrint,
  GraduationCap,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  ChevronRight,
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
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/ui/marca";
import { abrirPesquisa, useTeclaAtalho } from "@/lib/pesquisa";
import { paginaDisponivel } from "@/lib/juntas";
import { useSessao, type Perfil, type Recurso } from "@/lib/sessao";

/*
 * Barra lateral única de todos os ecrãs da câmara. Secções por tarefa que
 * recolhem (fica guardado no browser; a da página atual abre sozinha). O
 * nome de cada item é o título da página. O que o perfil não pode usar não
 * aparece (sem cadeados a ocupar espaço).
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
    titulo: "Atendimento",
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
    ],
  },
  {
    titulo: "Processos",
    itens: [
      {
        rotulo: "Processos",
        href: "/painel/processos",
        icone: FolderOpen,
        recurso: "processos",
        contagem: "processos",
      },
      {
        rotulo: "Licenças",
        href: "/painel/licencas",
        icone: BadgeCheck,
        recurso: "processos",
      },
      {
        rotulo: "Ocorrências",
        href: "/painel/ocorrencias",
        icone: MapPin,
        recurso: "ocorrencias_ver",
        contagem: "ocorrencias",
      },
      {
        rotulo: "Atestados",
        href: "/painel/atestados",
        icone: FileSignature,
        recurso: "atestados",
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
        rotulo: "Cartas não percebidas",
        href: "/painel/cartas",
        icone: FileQuestion,
        recurso: "processos",
      },
    ],
  },
  {
    titulo: "Serviços",
    itens: [
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
      {
        rotulo: "Cemitérios",
        href: "/painel/cemiterios",
        icone: Flower2,
        recurso: "servicos_municipais",
      },
      {
        rotulo: "Animais",
        href: "/painel/animais",
        icone: PawPrint,
        recurso: "servicos_municipais",
      },
      {
        rotulo: "Água e saneamento",
        href: "/painel/agua",
        icone: Droplets,
        recurso: "servicos_municipais",
      },
    ],
  },
  {
    titulo: "Comunidade",
    itens: [
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
      {
        rotulo: "Emergências",
        href: "/painel/emergencias",
        icone: Siren,
        recurso: "acao_social",
      },
      {
        rotulo: "Avisos por zona",
        href: "/painel/avisos",
        icone: Megaphone,
        recurso: "agente",
      },
      {
        rotulo: "Comunicados e eventos",
        href: "/painel/comunicados",
        icone: Newspaper,
        recurso: "visao_geral",
      },
      {
        rotulo: "Consultas públicas",
        href: "/painel/consultas",
        icone: Vote,
        recurso: "indicadores",
      },
    ],
  },
  {
    titulo: "Gestão",
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
        rotulo: "Relatórios",
        href: "/painel/relatorios",
        icone: FileText,
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
    ],
  },
  {
    titulo: "Configuração",
    itens: [
      {
        rotulo: "O seu agente",
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
        rotulo: "Demonstração",
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

const CHAVE_SECCOES = "painel:seccoes-abertas";
const EVENTO_SECCOES = "painel:seccoes";
// Sem armazenamento (janela privada), as escolhas ficam só nesta visita.
let seccoesEmMemoria: string | null = null;

function subscreverSeccoes(avisar: () => void) {
  window.addEventListener("storage", avisar);
  window.addEventListener(EVENTO_SECCOES, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(EVENTO_SECCOES, avisar);
  };
}

function lerSeccoes(): string | null {
  try {
    return localStorage.getItem(CHAVE_SECCOES) ?? seccoesEmMemoria;
  } catch {
    return seccoesEmMemoria;
  }
}

function guardarSeccoes(escolhas: Record<string, boolean>) {
  seccoesEmMemoria = JSON.stringify(escolhas);
  try {
    localStorage.setItem(CHAVE_SECCOES, seccoesEmMemoria);
  } catch {
    // Fica em memória.
  }
  window.dispatchEvent(new Event(EVENTO_SECCOES));
}

/** { "Processos": true, "Serviços": false, … } a partir do que ficou guardado. */
function escolhasDe(bruto: string | null): Record<string, boolean> {
  try {
    const v = JSON.parse(bruto ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === "boolean"),
    );
  } catch {
    return {};
  }
}

function idSeccao(titulo: string) {
  return `menu-${titulo.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}`;
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

  // Secções abertas: por omissão só o Atendimento; a da página atual está
  // sempre aberta (a não ser que a pessoa a feche aqui); o resto fica como a
  // pessoa deixou, guardado no browser.
  const seccaoAtual = SECCOES.find((sec) =>
    sec.itens.some((it) => it.href !== "/painel" && ativo(it.href)),
  )?.titulo;
  const bruto = useSyncExternalStore(subscreverSeccoes, lerSeccoes, () => null);
  const escolhas = useMemo(() => escolhasDe(bruto), [bruto]);
  const [fechadaAqui, setFechadaAqui] = useState<{ caminho: string; titulo: string } | null>(null);
  const aberta = (titulo: string) =>
    (titulo === seccaoAtual &&
      !(fechadaAqui?.caminho === caminho && fechadaAqui.titulo === titulo)) ||
    (escolhas[titulo] ?? titulo === "Atendimento");
  const alternar = (titulo: string) => {
    const agora = aberta(titulo);
    if (titulo === seccaoAtual) setFechadaAqui(agora ? { caminho, titulo } : null);
    guardarSeccoes({ ...escolhas, [titulo]: !agora });
  };

  return (
    <aside className="sticky top-0 flex h-dvh w-62 shrink-0 flex-col gap-4.5 overflow-y-auto border-r border-linha bg-papel px-4 pb-5 pt-7">
      <div className="flex shrink-0 flex-col gap-2.5">
        <Link href="/painel" className="w-fit">
          <Logo tamanho={21} />
        </Link>
        {/* Só mostra o município da sessão: não abre nada, por isso sem seta de menu. */}
        <div className="flex items-center gap-2 rounded-lg bg-creme px-2 py-1.5">
          <Landmark className="size-3.5 shrink-0 text-tinta-3" aria-hidden />
          <span className="flex-1 truncate text-xs font-semibold text-tinta-2">
            {eu?.municipio.nome ?? "—"}
          </span>
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

      <nav className="flex shrink-0 flex-col gap-1" aria-label="Painel">
        {SECCOES.map((sec) => {
          const itens = sec.itens.filter(
            (it) => visivel(it) && pode(it.recurso),
          );
          if (!itens.length) return null;
          const lista = (
            <ul
              id={sec.titulo ? idSeccao(sec.titulo) : undefined}
              className="flex flex-col gap-0.5"
            >
              {itens.map((it) => {
                const Icone = it.icone;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={ativo(it.href) ? "page" : undefined}
                      className={`flex h-9 items-center gap-2.5 rounded-[10px] px-3 ${
                        ativo(it.href)
                          ? "bg-terracota-suave text-terracota-escuro"
                          : "text-tinta-2 hover:bg-creme"
                      }`}
                    >
                      <Icone className="size-[17px] shrink-0" aria-hidden />
                      <span className="flex-1 truncate text-sm font-medium">
                        {it.rotulo}
                      </span>
                      <Contagem n={it.contagem && contagens[it.contagem]} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          );
          if (!sec.titulo) return <div key="inicio">{lista}</div>;
          const estaAberta = aberta(sec.titulo);
          const pendentes = itens.reduce(
            (n, it) => n + ((it.contagem && contagens[it.contagem]) || 0),
            0,
          );
          return (
            <div key={sec.titulo} className="flex flex-col gap-0.5 pt-2">
              <button
                type="button"
                aria-expanded={estaAberta}
                aria-controls={idSeccao(sec.titulo)}
                onClick={() => alternar(sec.titulo!)}
                className="group flex h-8 items-center gap-1.5 rounded-lg px-3 text-left hover:bg-creme focus-visible:outline-2 focus-visible:outline-terracota"
              >
                <ChevronRight
                  className={`size-3.5 shrink-0 text-tinta-3 transition-transform ${estaAberta ? "rotate-90" : ""}`}
                  aria-hidden
                />
                <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.4px] text-tinta-2">
                  {sec.titulo}
                </span>
                {!estaAberta && pendentes > 0 && (
                  <span
                    className="rounded-[10px] bg-terracota-suave px-2 py-0.5 text-[11px] font-bold text-terracota-escuro"
                    aria-label={`${pendentes} por tratar`}
                  >
                    {pendentes}
                  </span>
                )}
              </button>
              {estaAberta && lista}
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
