"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, ErroApi } from "@/lib/api";
import { useTranscricaoAoVivo, type Injetar } from "./ao-vivo";
import { AGENTE_ID, MUNICIPIO } from "./config";
import { FaixaAoVivo } from "./faixa-ao-vivo";
import { EcraChamada } from "./ecra-chamada";
import {
  EcraConsentimento,
  EcraEntrada,
  EcraMicrofone,
  EcraNumero,
  EcraSemMicrofone,
  type LicencaParaRenovar,
} from "./ecras-entrada";
import { EcraCaiu, EcraTerminada } from "./ecras-fim";
import { ESTADO_INICIAL, reduzir } from "./registo";

/*
 * A chamada no browser (plano B da demo): o mesmo agente do ElevenLabs que
 * atende o telefone, pelo SDK @elevenlabs/react (WebRTC). Um só ecrã com
 * estados, porque a sessão de voz e a autorização do microfone têm de
 * sobreviver à passagem entre passos.
 *
 * 01 entrada → 02 consentimento → 02a número → 02b microfone
 *   → (02c sem microfone) → 03 chamada (+ cartões, 03b, 03c) → 03d / 03e
 */

type Passo =
  | "entrada"
  | "consentimento"
  | "numero"
  | "microfone"
  | "sem_microfone"
  | "chamada"
  | "terminada"
  | "caiu";

/** Se o agente não atender em 25 s, a chamada conta como falhada. */
const LIMITE_LIGAR_MS = 25_000;

export function ChamadaNoBrowser() {
  return (
    <ConversationProvider>
      <Fluxo />
    </ConversationProvider>
  );
}

function Fluxo() {
  const [passo, setPasso] = useState<Passo>("entrada");
  const passoRef = useRef<Passo>("entrada");
  const ir = useCallback((p: Passo) => {
    passoRef.current = p;
    setPasso(p);
  }, []);

  const [digitos, setDigitos] = useState("");
  const [semSms, setSemSms] = useState(false);
  // "Experimentar uma renovação" (/ligar?experimentar=renovacao): uma licença
  // de demonstração no número da pessoa, para os SMS da renovação lhe chegarem.
  const [renovacao, setRenovacao] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("experimentar") === "renovacao",
  );
  const [licenca, setLicenca] = useState<LicencaParaRenovar | null>(null);
  const [aPreparar, setAPreparar] = useState(false);
  const [erroPreparar, setErroPreparar] = useState<string | null>(null);

  /** Prepara a licença antes da chamada; a chamada começa noutro toque. */
  const prepararRenovacao = async () => {
    setAPreparar(true);
    setErroPreparar(null);
    try {
      setLicenca(
        await api<LicencaParaRenovar>(`/v1/public/demo/${MUNICIPIO}/renovacao`, {
          corpo: { telefone: digitos },
        }),
      );
    } catch (e) {
      setErroPreparar(
        e instanceof ErroApi ? e.message : "Não foi possível preparar a licença. Tente outra vez.",
      );
    } finally {
      setAPreparar(false);
    }
  };
  const [estado, despachar] = useReducer(reduzir, ESTADO_INICIAL);
  const [aLigar, setALigar] = useState(false);
  const [chegouALigar, setChegouALigar] = useState(false);
  const [altifalante, setAltifalante] = useState(true);
  const [inicio, setInicio] = useState<number | null>(null);
  const [agora, setAgora] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const inicioRef = useRef<number | null>(null);
  const microfone = useRef<MediaStream | null>(null);

  const libertarMicrofone = () => {
    microfone.current?.getTracks().forEach((t) => t.stop());
    microfone.current = null;
  };

  const fechar = (para: "terminada" | "caiu") => {
    libertarMicrofone();
    setALigar(false);
    setDuracao(
      inicioRef.current ? Math.round((Date.now() - inicioRef.current) / 1000) : 0,
    );
    ir(para);
  };

  // Transcrição em direto (painel ao vivo, familiar a acompanhar). O que o
  // funcionário ou o familiar escrevem chega aqui e vai para o agente.
  const injetarNoAgente = useRef<(i: Injetar) => void>(() => {});
  const aoVivo = useTranscricaoAoVivo({
    injetar: useCallback((i: Injetar) => injetarNoAgente.current(i), []),
  });
  const telefoneRef = useRef<string | null>(null);

  const conversa = useConversation({
    onConnect: ({ conversationId }) => {
      void aoVivo.iniciar(conversationId, telefoneRef.current);
      // O SDK já tem o seu próprio fluxo de áudio: largamos o do pedido.
      libertarMicrofone();
      const t = Date.now();
      inicioRef.current = t;
      setInicio(t);
      setAgora(t);
      setChegouALigar(true);
      setALigar(false);
      ir("chamada");
    },
    onDisconnect: (d) => {
      void aoVivo.terminar();
      const p = passoRef.current;
      if (p === "chamada") fechar(d.reason === "error" ? "caiu" : "terminada");
      else if (p === "microfone") fechar("caiu");
    },
    onError: () => {
      // Erros antes de atender (agente privado, rede, sem permissões…).
      if (passoRef.current === "microfone") fechar("caiu");
    },
    onMessage: ({ message, role }) => {
      if (!message?.trim()) return;
      // A nota que nós mandámos ao agente não é o munícipe a falar.
      if (role === "user" && message.trim().startsWith("(nota do sistema:")) return;
      despachar({ tipo: "mensagem", papel: role, texto: message.trim() });
      aoVivo.fala(role === "user" ? "municipe" : "agente", message.trim());
    },
    onAgentToolRequest: (t) => {
      despachar({ tipo: "pedido", ferramenta: t.tool_name });
      aoVivo.ferramenta(t.tool_name, "pedido");
    },
    onAgentToolResponse: (t) => {
      const resultado = "full_tool_result" in t ? t.full_tool_result : undefined;
      despachar({
        tipo: "resposta",
        ferramenta: t.tool_name,
        erro: t.is_error,
        resultado,
      });
      aoVivo.ferramenta(t.tool_name, "resposta", t.is_error, resultado);
    },
  });

  const { sendContextualUpdate, sendUserMessage } = conversa;
  useEffect(() => {
    injetarNoAgente.current = (i: Injetar) => {
      // Contexto (não interrompe) e uma nota curta para o agente responder já.
      sendContextualUpdate(i.contexto);
      sendUserMessage(i.gatilho);
    };
  }, [sendContextualUpdate, sendUserMessage]);

  const { endSession } = conversa;

  /** Tem de correr dentro do toque (iOS só deixa pedir o microfone assim). */
  const ligar = async () => {
    despachar({ tipo: "reiniciar" });
    inicioRef.current = null;
    setInicio(null);
    setChegouALigar(false);
    setALigar(false);
    ir("microfone");
    if (!navigator.mediaDevices?.getUserMedia) {
      ir("sem_microfone");
      return;
    }
    try {
      microfone.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      // NotAllowedError (recusou), NotFoundError (sem microfone), SecurityError.
      ir("sem_microfone");
      return;
    }
    setALigar(true);
    telefoneRef.current = !semSms && digitos ? `+351${digitos}` : null;
    conversa.startSession({
      agentId: AGENTE_ID,
      // WebSocket e não WebRTC: o agente só aceita ligações do nosso domínio
      // (allowlist) e a ligação WebRTC não leva o cabeçalho Origin, por isso
      // era recusada logo ("Client did not provide the origin header").
      connectionType: "websocket",
      useWakeLock: true,
      dynamicVariables: {
        municipio: MUNICIPIO,
        canal: "browser",
        telefone: !semSms && digitos ? `+351${digitos}` : "",
        quer_sms: semSms ? "nao" : "sim",
        // A gravação já foi aceite no ecrã antes da chamada: a primeira
        // mensagem não repete o aviso (ao telefone é dito por extenso).
        aviso_gravacao: "",
      },
    });
  };

  const desligar = () => {
    fechar("terminada");
    void aoVivo.terminar();
    conversa.endSession();
  };

  // Relógio da chamada.
  useEffect(() => {
    if (passo !== "chamada") return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [passo]);

  // Ninguém atendeu a tempo.
  useEffect(() => {
    if (!aLigar) return;
    const id = setTimeout(() => {
      if (passoRef.current !== "microfone") return;
      endSession();
      libertarMicrofone();
      setALigar(false);
      ir("caiu");
    }, LIMITE_LIGAR_MS);
    return () => clearTimeout(id);
  }, [aLigar, endSession, ir]);

  // Cada passo começa no topo.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [passo]);

  const telefone = !semSms && digitos ? digitos : null;
  const segundos = inicio ? Math.max(0, Math.floor((agora - inicio) / 1000)) : 0;

  switch (passo) {
    case "entrada":
      return (
        <EcraEntrada
          configurada={!!AGENTE_ID}
          onLigar={() => ir("consentimento")}
        />
      );
    case "consentimento":
      return (
        <EcraConsentimento
          onVoltar={() => ir("entrada")}
          onAceitar={() => ir("numero")}
        />
      );
    case "numero":
      return (
        <EcraNumero
          digitos={digitos}
          semSms={semSms}
          onDigitos={(d) => {
            setDigitos(d);
            setLicenca(null);
          }}
          onSemSms={(v) => {
            setSemSms(v);
            if (v) setRenovacao(false);
          }}
          onVoltar={() => ir("consentimento")}
          onLigar={ligar}
          renovacao={{
            ativa: renovacao,
            licenca,
            aPreparar,
            erro: erroPreparar,
            onAtiva: (v) => {
              setRenovacao(v);
              setErroPreparar(null);
              if (v) setSemSms(false);
            },
            onPreparar: prepararRenovacao,
          }}
        />
      );
    case "microfone":
      return <EcraMicrofone aLigar={aLigar} />;
    case "sem_microfone":
      return (
        <EcraSemMicrofone onVoltar={() => ir("numero")} onTentar={ligar} />
      );
    case "chamada":
      return (
        <EcraChamada
          estado={estado}
          segundos={segundos}
          falando={conversa.isSpeaking}
          silenciado={conversa.isMuted}
          altifalante={altifalante}
          telefone={telefone}
          obterVolumeEntrada={conversa.getInputVolume}
          obterVolumeSaida={conversa.getOutputVolume}
          onSilenciar={() => conversa.setMuted(!conversa.isMuted)}
          onAltifalante={() => {
            const alto = !altifalante;
            setAltifalante(alto);
            conversa.setVolume({ volume: alto ? 1 : 0.5 });
          }}
          onPessoa={() => conversa.sendUserMessage("Quero falar com uma pessoa.")}
          onDizer={(texto) => conversa.sendUserMessage(texto)}
          onDesligar={desligar}
          faixa={
            <FaixaAoVivo
              familiar={aoVivo.estado.familiar}
              funcionario={aoVivo.estado.funcionario}
              onRetirar={() => void aoVivo.retirarFamiliar()}
            />
          }
        />
      );
    case "terminada":
      return (
        <EcraTerminada
          estado={estado}
          segundos={duracao}
          telefone={telefone}
          onLigarOutraVez={ligar}
        />
      );
    case "caiu":
      return (
        <EcraCaiu
          estado={estado}
          segundos={duracao}
          chegouALigar={chegouALigar}
          onLigar={ligar}
        />
      );
  }
}
