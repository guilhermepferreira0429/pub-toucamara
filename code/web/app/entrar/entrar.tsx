"use client";

import {
  ArrowLeft,
  BadgeCheck,
  ClipboardCheck,
  Eye,
  KeyRound,
  LoaderCircle,
  Mail,
  MailCheck,
  MapPin,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/components/ui/botao";
import { Logo } from "@/components/ui/marca";
import { api, API_URL, ErroApi } from "@/lib/api";
import { SessaoProvider, useSessao } from "@/lib/sessao";

const ERROS_OIDC: Record<string, string> = {
  sem_acesso: "A sua conta da câmara não tem acesso ao painel. Peça acesso à chefia.",
  token_invalido: "Não foi possível confirmar a sua conta da câmara. Tente outra vez.",
  pedido_expirado: "O pedido expirou. Tente outra vez.",
  recusado_pelo_fornecedor: "O login da câmara foi cancelado.",
  fornecedor_indisponivel: "O login da câmara não está disponível agora. Use o link por email.",
};

interface FornecedorOidc {
  municipio: string;
  nome: string;
  nome_botao: string;
}

/** "Entrar com a conta da câmara" (OIDC), quando a câmara o tem configurado. */
function BotoesOidc() {
  const [itens, setItens] = useState<FornecedorOidc[]>([]);
  useEffect(() => {
    api<{ itens: FornecedorOidc[] }>("/v1/painel/auth/oidc")
      .then((r) => setItens(r.itens))
      .catch(() => setItens([]));
  }, []);
  if (!itens.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {itens.map((f) => (
        <a
          key={f.municipio}
          href={`${API_URL}/v1/painel/auth/oidc/${encodeURIComponent(f.municipio)}/iniciar`}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-tinta px-4 text-sm font-semibold text-white hover:bg-tinta/90"
        >
          <KeyRound className="size-4" aria-hidden />
          {f.nome_botao}
          {itens.length > 1 ? ` · ${f.nome}` : ""}
        </a>
      ))}
      <p className="text-center text-xs text-tinta-3">ou receba um link por email</p>
    </div>
  );
}

/**
 * Entrar no painel por link mágico: pede o email, a API manda o link; ao
 * abrir o link (?token=…) troca-se pelo JWT e segue para o painel.
 */
function Formulario() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  // O link do júri (/entrar?juri=CHAVE): entra logo, só de leitura.
  const chaveJuri = params.get("juri");
  const erroOidc = params.get("erro");
  const { entrar } = useSessao();
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"inicio" | "a_enviar" | "enviado" | "a_entrar">(
    token || chaveJuri ? "a_entrar" : "inicio",
  );
  const [erro, setErro] = useState<string | null>(
    erroOidc ? (ERROS_OIDC[erroOidc] ?? "Não foi possível entrar com a conta da câmara.") : null,
  );
  const usado = useRef(false);

  useEffect(() => {
    if ((!token && !chaveJuri) || usado.current) return;
    usado.current = true;
    (token
      ? api<{ token: string }>("/v1/painel/auth/entrar", { corpo: { token } })
      : api<{ token: string }>("/v1/painel/auth/juri", { corpo: { chave: chaveJuri } })
    )
      .then((r) => entrar(r.token))
      .then(() => router.replace("/painel"))
      .catch((e) => {
        setErro(e instanceof ErroApi ? e.message : "Não foi possível entrar.");
        setEstado("inicio");
      });
  }, [token, chaveJuri, entrar, router]);

  async function pedirLink(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setEstado("a_enviar");
    try {
      // O email do júri não recebe link: a API devolve logo a sessão.
      const r = await api<{ token: string } | undefined>("/v1/painel/auth/link", { corpo: { email } });
      if (r?.token) {
        setEstado("a_entrar");
        await entrar(r.token);
        router.replace("/painel");
        return;
      }
      setEstado("enviado");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar.");
      setEstado("inicio");
    }
  }

  return (
    <main className="flex min-h-dvh bg-creme">
      <PainelMarca />
      <div className="flex flex-1 flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between gap-4">
          <span className="lg:hidden">
            <Logo tamanho={24} />
          </span>
          <Link
            href="/"
            className="ml-auto inline-flex items-center gap-1.5 text-[14px] font-semibold text-tinta-2 hover:text-tinta"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Sobre o projeto
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[440px]">
            {estado === "a_entrar" ? (
              <Cartao>
                <div role="status" className="flex flex-col items-center gap-4 py-6 text-center">
                  <LoaderCircle className="size-9 animate-spin text-terracota" aria-hidden />
                  <p className="font-display text-xl font-bold text-tinta">A entrar no painel…</p>
                  <p className="text-[14px] text-tinta-2">Só um momento.</p>
                </div>
              </Cartao>
            ) : estado === "enviado" ? (
              <Cartao>
                <div className="flex flex-col gap-5">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-verde-suave text-verde">
                    <MailCheck className="size-6" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-2">
                    <h1 className="font-display text-[28px] font-bold leading-tight tracking-[-0.5px] text-tinta">
                      Veja o seu email
                    </h1>
                    <p className="text-[15px] leading-relaxed text-tinta-2">
                      Se <span className="font-semibold text-tinta">{email}</span> tiver acesso ao painel, enviámos um
                      link para entrar. É válido durante 15 minutos e só funciona uma vez.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEstado("inicio")}
                    className="self-start text-[14px] font-semibold text-terracota-escuro underline underline-offset-2"
                  >
                    Usar outro email
                  </button>
                </div>
              </Cartao>
            ) : (
              <Cartao>
                <form onSubmit={pedirLink} className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <h1 className="font-display text-[30px] font-bold leading-tight tracking-[-0.6px] text-tinta">
                      Entrar no painel
                    </h1>
                    <p className="text-[15px] leading-relaxed text-tinta-2">
                      Para quem trabalha na câmara. Sem palavras-passe: recebe um link no email de trabalho.
                    </p>
                  </div>
                  <BotoesOidc />
                  <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-tinta">
                    Email de trabalho
                    <span className="flex h-13 items-center gap-2.5 rounded-xl border border-linha bg-creme px-3.5 transition-colors focus-within:border-terracota focus-within:bg-papel">
                      <Mail className="size-[18px] text-tinta-3" aria-hidden />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-transparent text-base font-normal text-tinta outline-none placeholder:text-tinta-3"
                        placeholder="nome@cm-guimaraes.pt"
                      />
                    </span>
                  </label>
                  {erro && (
                    <p role="alert" className="rounded-xl bg-terracota-suave/60 px-3.5 py-2.5 text-[14px] text-terracota-escuro">
                      {erro}
                    </p>
                  )}
                  <Botao type="submit" tamanho="grande" disabled={estado === "a_enviar"} className="w-full">
                    {estado === "a_enviar" ? "A enviar…" : "Enviar link para entrar"}
                  </Botao>
                </form>
                <div className="mt-6 flex gap-3 rounded-2xl bg-creme-2/70 p-4">
                  <Eye className="mt-0.5 size-5 shrink-0 text-tinta-2" aria-hidden />
                  <p className="text-[13px] leading-relaxed text-tinta-2">
                    <span className="font-semibold text-tinta">Júri do Hack4Guimarães?</span> Use o link ou o email que
                    lhe enviámos: entra logo, só para ver, até 28 de outubro.
                  </p>
                </div>
              </Cartao>
            )}
            <p className="mt-6 text-center text-[13px] text-tinta-2">
              É munícipe?{" "}
              <Link href="/ligar" className="font-semibold text-terracota-escuro underline underline-offset-2">
                Ligue à câmara
              </Link>{" "}
              ou{" "}
              <Link href="/chat" className="font-semibold text-terracota-escuro underline underline-offset-2">
                escreva no chat
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function Cartao({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[28px] border border-linha bg-papel p-7 shadow-[0_30px_60px_-45px_rgba(21,38,59,0.45)] sm:p-9">
      {children}
    </div>
  );
}

const O_QUE_HA: [LucideIcon, string, string][] = [
  [MessagesSquare, "Conversas", "O que o agente resolveu sozinho e o que passou a uma pessoa, com a fonte."],
  [ClipboardCheck, "Pedidos já preenchidos", "Requerimentos e licenças que chegam com os dados confirmados."],
  [MapPin, "Ocorrências", "Com fotografia, morada e o que fazer a seguir."],
  [BadgeCheck, "Avaliação à vista", "As mesmas perguntas, a resposta certa e o veredicto."],
];

/** No computador, à esquerda: a marca e o que se encontra lá dentro. */
function PainelMarca() {
  return (
    <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-tinta px-14 py-12 text-papel lg:flex">
      {/* O balão da marca, grande e desfocado, como fundo. */}
      <span
        aria-hidden
        className="absolute -right-24 -bottom-24 size-[420px] rounded-[210px_210px_210px_40px] bg-terracota/25 blur-[2px]"
      />
      <Link href="/" className="relative w-fit">
        <Logo tamanho={30} claro />
      </Link>
      <div className="relative flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="text-[12px] font-bold uppercase tracking-[1.4px] text-terracota-suave">Painel da câmara</p>
          <h2 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-1.2px]">
            O atendimento inteiro, num só sítio.
          </h2>
        </div>
        <ul className="flex flex-col gap-5">
          {O_QUE_HA.map(([Icone, titulo, texto]) => (
            <li key={titulo} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Icone className="size-5 text-terracota-suave" aria-hidden />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[16px] font-semibold">{titulo}</span>
                <span className="text-[14px] leading-relaxed text-papel/75">{texto}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-[13px] text-papel/70">
        Demonstração do Hack4Guimarães 2035.
      </p>
    </aside>
  );
}

export function Entrar() {
  return (
    <SessaoProvider>
      <Formulario />
    </SessaoProvider>
  );
}
