"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, ErroApi, type OpcoesPedido } from "./api";

/** Recursos do painel (code/api/src/modules/auth/permissoes.ts). */
export type Recurso =
  | "visao_geral"
  | "conversas"
  | "gravacoes"
  | "entrada"
  | "processos"
  | "ocorrencias_ver"
  | "ocorrencias"
  | "indicadores"
  | "conhecimento_ver"
  | "conhecimento"
  | "equipa"
  | "agente";

export type Perfil =
  | "atendimento"
  | "tecnico"
  | "chefe_divisao"
  | "vereador"
  | "equipa_toucamara"
  | "admin";

export interface Eu {
  utilizador: {
    id: string;
    nome: string;
    email: string;
    perfil: Perfil;
    municipioId: string | null;
    servicoId: string | null;
    foto_url: string | null;
  };
  municipio: { id: string; slug: string; nome: string; fuso: string };
  permissoes: Record<Recurso, boolean>;
}

interface Sessao {
  token: string | null;
  eu: Eu | null;
  aCarregar: boolean;
  /** Pedido autenticado: junta o token e o município da equipa interna. */
  pedido<T>(caminho: string, o?: Omit<OpcoesPedido, "token">): Promise<T>;
  pode(r: Recurso): boolean;
  entrar(token: string): Promise<void>;
  sair(): void;
}

const CHAVE_TOKEN = "toucamara.token";
const CHAVE_MUNICIPIO = "toucamara.municipio";

const Contexto = createContext<Sessao | null>(null);

export function SessaoProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [eu, setEu] = useState<Eu | null>(null);
  const [aCarregar, setACarregar] = useState(true);

  const carregar = useCallback(async (t: string) => {
    try {
      const r = await api<Eu>("/v1/painel/auth/eu", {
        token: t,
        municipio: municipioEscolhido(),
      });
      setEu(r);
      setToken(t);
    } catch (e) {
      if (e instanceof ErroApi && e.estado === 401) {
        localStorage.removeItem(CHAVE_TOKEN);
        setToken(null);
        setEu(null);
      } else throw e;
    }
  }, []);

  useEffect(() => {
    const t = localStorage.getItem(CHAVE_TOKEN);
    // O token só existe no browser (localStorage): lê-se depois do primeiro
    // render, e o estado só muda quando a promessa resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.resolve(t ? carregar(t) : undefined)
      .catch(() => undefined)
      .finally(() => setACarregar(false));
  }, [carregar]);

  const sair = useCallback(() => {
    localStorage.removeItem(CHAVE_TOKEN);
    setToken(null);
    setEu(null);
  }, []);

  const valor = useMemo<Sessao>(
    () => ({
      token,
      eu,
      aCarregar,
      pedido: async <T,>(
        caminho: string,
        o: Omit<OpcoesPedido, "token"> = {},
      ) => {
        try {
          return await api<T>(caminho, {
            municipio: municipioEscolhido(),
            ...o,
            token,
          });
        } catch (e) {
          // Sessão expirada: volta ao ecrã de entrar.
          if (e instanceof ErroApi && e.codigo === "nao_autenticado") sair();
          throw e;
        }
      },
      pode: (r) => !!eu?.permissoes[r],
      entrar: async (t) => {
        localStorage.setItem(CHAVE_TOKEN, t);
        await carregar(t);
      },
      sair,
    }),
    [token, eu, aCarregar, carregar, sair],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): Sessao {
  const s = useContext(Contexto);
  if (!s) throw new Error("useSessao fora do SessaoProvider");
  return s;
}

/** O município escolhido pela equipa interna (header X-Municipio), ou null. */
export function municipioEscolhido(): string | null {
  return typeof window === "undefined"
    ? null
    : localStorage.getItem(CHAVE_MUNICIPIO);
}

/** Equipa interna: escolher o município (X-Municipio). */
export function escolherMunicipio(slug: string) {
  localStorage.setItem(CHAVE_MUNICIPIO, slug);
}
