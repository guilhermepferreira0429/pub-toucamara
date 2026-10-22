"use client";

import {
  BadgeCheck,
  BookOpen,
  Bot,
  CalendarDays,
  ChartColumn,
  ChevronsUpDown,
  FolderOpen,
  GraduationCap,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  Lock,
  FileText,
  HandCoins,
  HeartHandshake,
  LogOut,
  Map as IconeMapa,
  MapPin,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  PhoneOutgoing,
  Receipt,
  Send,
  Search,
  Siren,
  Sparkles,
  Store,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/marca";
import { useSessao, type Perfil, type Recurso } from "@/lib/sessao";

/*
 * Barra lateral única de todos os ecrãs da câmara (componente "Barra lateral
 * · unificada" do design). Itens sem permissão aparecem com cadeado e
 * esbatidos; uma secção inteira fica trancada quando o perfil não tem
 * nenhum dos seus itens.
 */

interface Item {
  rotulo: string;
  href: string;
  icone: LucideIcon;
  recurso: Recurso;
  /** Chave da contagem (badge), quando há. */
  contagem?: keyof Contagens;
}

interface Seccao {
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

const SECCOES: Seccao[] = [
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
      { rotulo: "Agente", href: "/painel/agente", icone: Bot, recurso: "agente" },
      {
        rotulo: "Equipa e acessos",
        href: "/painel/equipa",
        icone: Users,
        recurso: "equipa",
      },
    ],
  },
];

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
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
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

  const ativo = (href: string) =>
    href === "/painel" ? caminho === "/painel" : caminho.startsWith(href);

  return (
    <aside className="sticky top-0 flex h-dvh w-62 shrink-0 flex-col gap-4.5 overflow-y-auto border-r border-linha bg-papel px-4 pb-5 pt-7">
      <div className="flex flex-col gap-2.5">
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

      <label className="flex h-9.5 items-center gap-2 rounded-[10px] border border-linha bg-creme pl-3 pr-2">
        <Search className="size-[15px] text-tinta-3" aria-hidden />
        <input
          type="search"
          placeholder="Pesquisar tudo"
          className="w-full bg-transparent text-xs text-tinta outline-none placeholder:text-tinta-3"
        />
        <kbd className="rounded-[5px] border border-linha bg-papel px-1.5 py-0.5 text-[10px] font-semibold text-tinta-3">
          ⌘K
        </kbd>
      </label>

      <nav className="flex flex-col gap-4.5" aria-label="Painel">
        {SECCOES.map((s, i) => {
          const trancada = s.itens.every((it) => !pode(it.recurso));
          return (
            <div key={i} className="flex flex-col gap-0.5">
              {s.titulo && (
                <div className="flex items-center justify-between px-3 pb-1.5">
                  <span className="text-[11px] font-bold text-tinta-3">
                    {s.titulo}
                  </span>
                  {trancada && (
                    <Lock className="size-3 text-tinta-3" aria-label="Sem acesso" />
                  )}
                </div>
              )}
              {s.itens.map((it) => {
                const permitido = pode(it.recurso);
                const Icone = it.icone;
                const corpo = (
                  <>
                    <Icone className="size-[17px]" aria-hidden />
                    <span className="flex-1 text-sm font-medium">{it.rotulo}</span>
                    {permitido ? (
                      <Contagem n={it.contagem && contagens[it.contagem]} />
                    ) : (
                      <Lock className="size-3.5 text-tinta-3" aria-label="Sem acesso" />
                    )}
                  </>
                );
                const base = "flex h-9 items-center gap-2.5 rounded-[10px] px-3";
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
