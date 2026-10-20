"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AGENTE_ID, MUNICIPIO } from "./config";
import { EcraChamada } from "./ecra-chamada";
import {
  EcraConsentimento,
  EcraEntrada,
  EcraMicrofone,
  EcraNumero,
  EcraSemMicrofone,
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

  const conversa = useConversation({
    onConnect: () => {
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
      const p = passoRef.current;
      if (p === "chamada") fechar(d.reason === "error" ? "caiu" : "terminada");
      else if (p === "microfone") fechar("caiu");
    },
    onError: () => {
      // Erros antes de atender (agente privado, rede, sem permissões…).
      if (passoRef.current === "microfone") fechar("caiu");
    },
    onMessage: ({ message, role }) => {
      if (message?.trim())
        despachar({ tipo: "mensagem", papel: role, texto: message.trim() });
    },
    onAgentToolRequest: (t) =>
      despachar({ tipo: "pedido", ferramenta: t.tool_name }),
    onAgentToolResponse: (t) =>
      despachar({
        tipo: "resposta",
        ferramenta: t.tool_name,
        erro: t.is_error,
        resultado: "full_tool_result" in t ? t.full_tool_result : undefined,
      }),
  });

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
    conversa.startSession({
      agentId: AGENTE_ID,
      useWakeLock: true,
      dynamicVariables: {
        municipio: MUNICIPIO,
        canal: "browser",
        telefone: !semSms && digitos ? `+351${digitos}` : "",
        quer_sms: semSms ? "nao" : "sim",
      },
    });
  };

  const desligar = () => {
    fechar("terminada");
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
          onDigitos={setDigitos}
          onSemSms={setSemSms}
          onVoltar={() => ir("consentimento")}
          onLigar={ligar}
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
