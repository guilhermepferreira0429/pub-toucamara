"use client";

import { Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/components/ui/botao";
import { Logo } from "@/components/ui/marca";
import { api, ErroApi } from "@/lib/api";
import { SessaoProvider, useSessao } from "@/lib/sessao";

/**
 * Entrar no painel por link mágico: pede o email, a API manda o link; ao
 * abrir o link (?token=…) troca-se pelo JWT e segue para o painel.
 */
function Formulario() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const { entrar } = useSessao();
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"inicio" | "a_enviar" | "enviado" | "a_entrar">(
    token ? "a_entrar" : "inicio",
  );
  const [erro, setErro] = useState<string | null>(null);
  const usado = useRef(false);

  useEffect(() => {
    if (!token || usado.current) return;
    usado.current = true;
    api<{ token: string }>("/v1/painel/auth/entrar", { corpo: { token } })
      .then((r) => entrar(r.token))
      .then(() => router.replace("/painel"))
      .catch((e) => {
        setErro(e instanceof ErroApi ? e.message : "Não foi possível entrar.");
        setEstado("inicio");
      });
  }, [token, entrar, router]);

  async function pedirLink(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setEstado("a_enviar");
    try {
      await api("/v1/painel/auth/link", { corpo: { email } });
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
