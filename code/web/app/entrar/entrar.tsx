"use client";

import { KeyRound, Mail } from "lucide-react";
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
    <main className="flex min-h-dvh items-center justify-center bg-creme px-6">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Logo />
        {estado === "a_entrar" ? (
          <p className="text-tinta-2">A entrar…</p>
        ) : estado === "enviado" ? (
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-2xl font-bold">Veja o seu email</h1>
            <p className="text-sm text-tinta-2">
              Se {email} tiver acesso ao painel, enviámos um link para entrar.
              É válido durante 15 minutos.
            </p>
          </div>
        ) : (
          <form onSubmit={pedirLink} className="flex flex-col gap-4">
            <h1 className="font-display text-2xl font-bold">Entrar no painel</h1>
            <BotoesOidc />
            <label className="flex flex-col gap-1.5 text-sm font-medium text-tinta-2">
              Email de trabalho
              <span className="flex h-12 items-center gap-2 rounded-xl border border-linha bg-papel px-3">
                <Mail className="size-4 text-tinta-3" aria-hidden />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent text-base text-tinta outline-none"
                  placeholder="nome@cm-guimaraes.pt"
                />
              </span>
            </label>
            {erro && <p className="text-sm text-terracota-escuro">{erro}</p>}
            <Botao type="submit" disabled={estado === "a_enviar"}>
              {estado === "a_enviar" ? "A enviar…" : "Enviar link para entrar"}
            </Botao>
          </form>
        )}
      </div>
    </main>
  );
}

export function Entrar() {
  return (
    <SessaoProvider>
      <Formulario />
    </SessaoProvider>
  );
}
