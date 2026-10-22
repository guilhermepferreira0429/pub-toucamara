"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErroApi, sse } from "@/lib/api";
import type { Cartao, EstadoLigacao, Mensagem } from "./tipos";

interface SessaoCriada {
  sessao: string;
  saudacao: string;
  agente: string;
  retomada: boolean;
  municipio: { slug: string; nome: string };
}

let contador = 0;
const novoId = () => `m${Date.now().toString(36)}${(contador++).toString(36)}`;

const hora = () =>
  new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

/** A língua do browser no formato que a API aceita (pt-PT, en, uk…). */
function idiomaDoBrowser(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const l = navigator.language ?? "";
  const [base, regiao] = l.split("-");
  const candidato = regiao
    ? `${base.toLowerCase()}-${regiao.toUpperCase()}`
    : base.toLowerCase();
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test(candidato) ? candidato : undefined;
}

function lerToken(chave: string): string | undefined {
  try {
    return localStorage.getItem(chave) ?? undefined;
  } catch {
    return undefined;
  }
}

function guardarToken(chave: string, valor: string | null) {
  try {
    if (valor) localStorage.setItem(chave, valor);
    else localStorage.removeItem(chave);
  } catch {
    // modo privado: segue sem retomar
  }
}

/** Junta os cartões do mesmo requerimento num só (o último estado ganha). */
function juntarCartao(cartoes: Cartao[], novo: Cartao): Cartao[] {
  if (novo.tipo === "requerimento") {
    const id = novo.dados.requerimento_id;
    const i = cartoes.findIndex(
      (c) => c.tipo === "requerimento" && c.dados.requerimento_id === id,
    );
    if (i >= 0) {
      const antigo = cartoes[i] as Extract<Cartao, { ferramenta: string }>;
      const junto = { ...novo, dados: { ...antigo.dados, ...novo.dados } };
      return cartoes.map((c, j) => (j === i ? junto : c));
    }
  }
  if (novo.tipo === "fonte") {
    const i = cartoes.findIndex((c) => c.tipo === "fonte");
    if (i >= 0) {
      const antigo = cartoes[i] as Extract<Cartao, { tipo: "fonte" }>;
      const vistas = new Set(
        antigo.fontes.map((f) => `${f.url}#${f.referencia}`),
      );
      const fontes = [
        ...antigo.fontes,
        ...novo.fontes.filter((f) => !vistas.has(`${f.url}#${f.referencia}`)),
      ];
      return cartoes.map((c, j) => (j === i ? { tipo: "fonte", fontes } : c));
    }
  }
  return [...cartoes, novo];
}

/**
 * O estado do chat: sessão anónima (token no localStorage para retomar na
 * próxima visita), mensagens com resposta em SSE e as mensagens que ficaram
 * por enviar quando a ligação falha (nunca se perdem: voltam a seguir quando
 * a rede volta ou com "Tentar").
 */
export function useChat(municipio: string) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [ligacao, setLigacao] = useState<EstadoLigacao>("a_iniciar");
  const [avisoGeral, setAvisoGeral] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const [agente, setAgente] = useState<string | null>(null);
  const [nomeMunicipio, setNomeMunicipio] = useState<string | null>(null);
  const [identificado, setIdentificado] = useState<string | null>(null);

  const chave = `toucamara:chat:${municipio}`;
  const sessaoRef = useRef<string | null>(null);
  const iniciarRef = useRef<Promise<string | null> | null>(null);
  const ocupadoRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const mensagensRef = useRef<Mensagem[]>([]);

  useEffect(() => {
    mensagensRef.current = mensagens;
  }, [mensagens]);

  const alterar = useCallback((id: string, f: (m: Mensagem) => Mensagem) => {
    setMensagens((ms) => ms.map((m) => (m.id === id ? f(m) : m)));
  }, []);

  const iniciar = useCallback((): Promise<string | null> => {
    if (sessaoRef.current) return Promise.resolve(sessaoRef.current);
    if (iniciarRef.current) return iniciarRef.current;
    const pedido = async (
      anterior: string | undefined,
    ): Promise<SessaoCriada> =>
      api<SessaoCriada>("/v1/chat/sessoes", {
        corpo: {
          municipio,
          idioma: idiomaDoBrowser(),
          ...(anterior ? { sessao_anterior: anterior } : {}),
        },
      });
    const p = (async () => {
      const anterior = lerToken(chave);
      try {
        let r: SessaoCriada;
        try {
          r = await pedido(anterior);
        } catch (e) {
          // Token guardado estragado: esquece-o e começa do zero.
          if (anterior && e instanceof ErroApi && e.estado === 400) {
            guardarToken(chave, null);
            r = await pedido(undefined);
          } else throw e;
        }
        sessaoRef.current = r.sessao;
        guardarToken(chave, r.sessao);
        setAgente(r.agente);
        setNomeMunicipio(r.municipio?.nome ?? null);
        setAvisoGeral(null);
        setLigacao("pronto");
        setMensagens((ms) =>
          ms.some((m) => m.id === "saudacao")
            ? ms
            : [
                {
                  id: "saudacao",
                  papel: "agente",
                  texto: r.saudacao,
                  cartoes: [],
                  estado: "feita",
                  hora: hora(),
                },
                ...ms,
              ],
        );
        return r.sessao;
      } catch (e) {
        if (e instanceof ErroApi && e.codigo !== "sem_ligacao") {
          setLigacao("indisponivel");
          setAvisoGeral(e.message);
        } else {
          setLigacao("sem_ligacao");
        }
        return null;
      } finally {
        iniciarRef.current = null;
      }
    })();
    iniciarRef.current = p;
    return p;
  }, [chave, municipio]);

  useEffect(() => {
    void iniciar();
  }, [iniciar]);

  const enviar = useCallback(
    async (textoBruto: string, reenviarId?: string): Promise<boolean> => {
      const texto = textoBruto.trim().slice(0, 2000);
      if (!texto || ocupadoRef.current) return false;
      ocupadoRef.current = true;
      setOcupado(true);

      const idPessoa = reenviarId ?? novoId();
      if (reenviarId) {
        alterar(idPessoa, (m) => ({ ...m, estado: "enviada", aviso: null }));
      } else {
        setMensagens((ms) => [
          ...ms,
          {
            id: idPessoa,
            papel: "pessoa",
            texto,
            cartoes: [],
            estado: "enviada",
            hora: hora(),
          },
        ]);
      }
      const porEnviar = (aviso: string | null) =>
        alterar(idPessoa, (m) => ({ ...m, estado: "por_enviar", aviso }));

      const idAgente = novoId();
      const tirarAgente = () =>
        setMensagens((ms) => ms.filter((m) => m.id !== idAgente));
      let recebeu = false;
      let final = "";
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const correr = async (sessao: string) => {
        for await (const ev of sse(
          `/v1/chat/sessoes/${encodeURIComponent(sessao)}/mensagens`,
          { corpo: { texto }, sinal: ctrl.signal },
        )) {
          const d = (ev.dados ?? {}) as Record<string, unknown>;
          if (ev.evento === "texto" && typeof d.texto === "string") {
            recebeu = true;
            final += d.texto;
            const delta = d.texto;
            alterar(idAgente, (m) => ({
              ...m,
              texto: m.texto + delta,
              ferramenta: null,
            }));
          } else if (ev.evento === "ferramenta" && typeof d.nome === "string") {
            recebeu = true;
            const nome = d.nome;
            alterar(idAgente, (m) => ({
              ...m,
              ferramenta: nome,
              usadas: [...(m.usadas ?? []), nome],
            }));
          } else if (ev.evento === "cartao") {
            recebeu = true;
            const cartao = ev.dados as Cartao;
            alterar(idAgente, (m) => ({
              ...m,
              cartoes: juntarCartao(m.cartoes, cartao),
            }));
          } else if (ev.evento === "fim") {
            alterar(idAgente, (m) => ({
              ...m,
              estado: "feita",
              ferramenta: null,
            }));
          } else if (ev.evento === "erro") {
            const msg =
              typeof d.mensagem === "string"
                ? d.mensagem
                : "Não consegui responder. Tente outra vez.";
            alterar(idAgente, (m) => ({
              ...m,
              estado: "erro",
              ferramenta: null,
              aviso: msg,
            }));
            setAnuncio(msg);
          }
        }
      };

      try {
        let sessao = sessaoRef.current ?? (await iniciar());
        if (!sessao) {
          porEnviar(null);
          return false;
        }
        setMensagens((ms) => [
          ...ms,
          {
            id: idAgente,
            papel: "agente",
            texto: "",
            cartoes: [],
            estado: "a_responder",
            ferramenta: null,
            usadas: [],
            hora: hora(),
          },
        ]);
        try {
          await correr(sessao);
        } catch (e) {
          const expirou =
            e instanceof ErroApi &&
            (e.codigo === "sessao_expirada" ||
              e.codigo === "sessao_desconhecida");
          if (!expirou) throw e;
          // Sessão velha: abre outra (retoma a anterior) e repete a mensagem.
          sessaoRef.current = null;
          sessao = await iniciar();
          if (!sessao) throw new ErroApi(0, "sem_ligacao", "Sem ligação.");
          await correr(sessao);
        }
        if (ctrl.signal.aborted) return true;
        setLigacao("pronto");
        // Stream fechado sem `fim` nem `erro`: o que chegou fica, marcado.
        alterar(idAgente, (m) =>
          m.estado === "a_responder"
            ? {
                ...m,
                estado: m.texto ? "feita" : "interrompida",
                ferramenta: null,
              }
            : m,
        );
        if (final) setAnuncio(final);
        return true;
      } catch (e) {
        if ((e as Error).name === "AbortError") return false;
        if (e instanceof ErroApi && e.codigo !== "sem_ligacao") {
          // Recusado antes de começar (ocupado, limite, IA desligada): a
          // mensagem não foi tratada, fica por enviar com o motivo.
          tirarAgente();
          porEnviar(e.message);
          setAnuncio(e.message);
          return false;
        }
        if (recebeu) {
          alterar(idAgente, (m) => ({
            ...m,
            estado: "interrompida",
            ferramenta: null,
          }));
        } else {
          tirarAgente();
          porEnviar(null);
        }
        setLigacao("sem_ligacao");
        setAnuncio("Está sem ligação. A mensagem fica guardada.");
        return false;
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        ocupadoRef.current = false;
        setOcupado(false);
      }
    },
    [alterar, iniciar],
  );

  /** Volta a tentar: abre a sessão se falta e envia o que ficou por enviar. */
  const tentarDeNovo = useCallback(async () => {
    if (ocupadoRef.current) return;
    if (!sessaoRef.current) {
      setLigacao("a_iniciar");
      if (!(await iniciar())) return;
    }
    for (const m of mensagensRef.current) {
      if (m.papel === "pessoa" && m.estado === "por_enviar") {
        if (!(await enviar(m.texto, m.id))) return;
      }
    }
    setLigacao("pronto");
  }, [enviar, iniciar]);

  /** Repete a última pergunta (resposta interrompida ou com erro). */
  const repetir = useCallback(
    (idAgente: string) => {
      const ms = mensagensRef.current;
      const i = ms.findIndex((m) => m.id === idAgente);
      const pergunta = ms
        .slice(0, i)
        .reverse()
        .find((m) => m.papel === "pessoa");
      if (pergunta) {
        setMensagens((xs) => xs.filter((m) => m.id !== idAgente));
        void enviar(pergunta.texto, pergunta.id);
      }
    },
    [enviar],
  );

  useEffect(() => {
    const online = () => void tentarDeNovo();
    const offline = () => setLigacao("sem_ligacao");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      abortRef.current?.abort();
    };
  }, [tentarDeNovo]);

  const pedirCodigo = useCallback(
    async (telefone: string) => {
      const sessao = sessaoRef.current ?? (await iniciar());
      if (!sessao)
        throw new ErroApi(
          0,
          "sem_ligacao",
          "Sem ligação. Verifique a internet.",
        );
      return api<{ enviado: boolean; telefone: string; expira_em: string }>(
        `/v1/chat/sessoes/${encodeURIComponent(sessao)}/identificar`,
        { corpo: { telefone } },
      );
    },
    [iniciar],
  );

  const confirmarCodigo = useCallback(async (codigo: string) => {
    const sessao = sessaoRef.current;
    if (!sessao)
      throw new ErroApi(0, "sem_ligacao", "Sem ligação. Verifique a internet.");
    const r = await api<{ identificado: boolean; telefone: string }>(
      `/v1/chat/sessoes/${encodeURIComponent(sessao)}/confirmar`,
      { corpo: { codigo } },
    );
    setIdentificado(r.telefone);
    setAnuncio(`Identificação confirmada: ${r.telefone}.`);
    return r;
  }, []);

  return {
    mensagens,
    ligacao,
    avisoGeral,
    ocupado,
    anuncio,
    agente,
    nomeMunicipio,
    identificado,
    enviar,
    tentarDeNovo,
    repetir,
    pedirCodigo,
    confirmarCodigo,
  };
}

export type EstadoChat = ReturnType<typeof useChat>;
