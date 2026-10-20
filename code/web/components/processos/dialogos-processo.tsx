"use client";

import { Phone, Send } from "lucide-react";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { diaLongo, diaHora } from "./formatos";
import type { ChamadaSaida, TipoProcesso } from "./tipos";
import {
  ACarregar,
  AREA_TEXTO,
  BotaoPainel,
  CAMPO,
  Campo,
  Dialogo,
  ErroEmLinha,
  paraErro,
  usePedido,
} from "./ui";

/*
 * Ações da ficha do processo que pedem confirmação: pedir um documento ao
 * munícipe (com prazo e aviso) e "ligar agora" (chamada do agente).
 */

const OUTRO = "__outro__";

export function DialogoPedirDocumento({
  aberto,
  onFechar,
  processoId,
  tipoId,
  emFalta,
  onFeito,
}: {
  aberto: boolean;
  onFechar: () => void;
  processoId: string;
  tipoId: string;
  emFalta: string[];
  onFeito: (mensagem: string) => void;
}) {
  const { pedido } = useSessao();
  const tipos = usePedido<{ itens: TipoProcesso[] }>(
    aberto ? "/v1/painel/tipos-processo" : null,
  );
  const docs = (
    tipos.dados?.itens.find((t) => t.id === tipoId)?.documentos ?? []
  ).filter((d) => !d.gerado_pelo_sistema);

  const [escolha, setEscolha] = useState("");
  const [nome, setNome] = useState("");
  const [nota, setNota] = useState("");
  const [prazo, setPrazo] = useState(10);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Por omissão, o primeiro documento que falta (ou "outro").
  const escolhaEfetiva =
    escolha ||
    docs.find((d) => emFalta.includes(d.nome))?.id ||
    docs[0]?.id ||
    OUTRO;

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    const corpo: Record<string, unknown> = { prazo_dias_uteis: prazo };
    if (escolhaEfetiva === OUTRO) {
      if (nome.trim().length < 2) {
        setErro("Escreva o nome do documento a pedir.");
        return;
      }
      corpo.nome = nome.trim();
    } else corpo.tipo_documento_id = escolhaEfetiva;
    if (nota.trim()) corpo.nota = nota.trim();
    setAEnviar(true);
    try {
      const r = await pedido<{
        prazo: string;
        aviso: "sms" | "email" | "chamada" | null;
      }>(`/v1/painel/processos/${processoId}/pedir-documento`, { corpo });
      const como =
        r.aviso === "sms"
          ? "O munícipe foi avisado por SMS"
          : r.aviso === "email"
            ? "O munícipe foi avisado por email"
            : r.aviso === "chamada"
              ? "O agente vai ligar ao munícipe a avisar"
              : "Sem contacto do munícipe: avise-o por outra via";
      onFeito(`Pedido registado, com prazo até ${diaLongo(r.prazo)}. ${como}.`);
      setNome("");
      setNota("");
      setEscolha("");
      onFechar();
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      onFechar={onFechar}
      titulo="Pedir documento"
      descricao="O munícipe recebe o pedido com o prazo e o link para entregar, sem vir ao balcão."
    >
      {tipos.aCarregar && !tipos.dados ? (
        <ACarregar />
      ) : (
        <form onSubmit={enviar} className="flex flex-col gap-4">
          <Campo rotulo="Documento">
            {(id) => (
              <select
                id={id}
                value={escolhaEfetiva}
                onChange={(e) => setEscolha(e.target.value)}
                className={CAMPO}
              >
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome}
                    {emFalta.includes(d.nome) ? " (em falta)" : ""}
                  </option>
                ))}
                <option value={OUTRO}>Outro documento…</option>
              </select>
            )}
          </Campo>
          {escolhaEfetiva === OUTRO && (
            <Campo rotulo="Nome do documento">
              {(id) => (
                <input
                  id={id}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={200}
                  required
                  className={CAMPO}
                />
              )}
            </Campo>
          )}
          <Campo
            rotulo="Nota para o munícipe (opcional)"
            ajuda="Por exemplo: com a assinatura do técnico autor."
          >
            {(id) => (
              <textarea
                id={id}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                rows={2}
                className={AREA_TEXTO}
              />
            )}
          </Campo>
          <Campo rotulo="Prazo para entregar (dias úteis)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={120}
                value={prazo}
                onChange={(e) =>
                  setPrazo(Math.max(1, Math.min(120, Number(e.target.value) || 1)))
                }
                className={`${CAMPO} w-32`}
              />
            )}
          </Campo>
          <ErroEmLinha erro={erro ?? tipos.erro} />
          <div className="flex gap-2.5">
            <BotaoPainel
              variante="contorno"
              grande
              className="flex-1"
              onClick={onFechar}
            >
              Cancelar
            </BotaoPainel>
            <BotaoPainel
              variante="principal"
              grande
              type="submit"
              icone={Send}
              disabled={aEnviar}
              className="flex-1"
            >
              {aEnviar ? "A enviar…" : "Pedir e avisar"}
            </BotaoPainel>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

export function DialogoLigar({
  aberto,
  onFechar,
  processoId,
  numero,
  telefone,
  onFeito,
}: {
  aberto: boolean;
  onFechar: () => void;
  processoId: string;
  numero: string;
  telefone: string | null;
  onFeito: (mensagem: string) => void;
}) {
  const { pedido } = useSessao();
  const [nota, setNota] = useState("");
  const [aLigar, setALigar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function ligar(ev: React.FormEvent) {
    ev.preventDefault();
    setALigar(true);
    setErro(null);
    try {
      const corpo: Record<string, unknown> = { motivo: "manual" };
      if (nota.trim()) corpo.nota = nota.trim();
      const c = await pedido<ChamadaSaida>(
        `/v1/painel/processos/${processoId}/ligar`,
        { corpo },
      );
      const agora = new Date(c.agendada_para).getTime() <= Date.now() + 60_000;
      onFeito(
        c.estado === "falhou" || c.erro
          ? `A chamada não foi feita: ${c.erro ?? "erro do fornecedor"}.`
          : agora
            ? "O agente está a ligar ao munícipe."
            : `Fora do horário: a chamada fica marcada para ${diaHora(c.agendada_para)}.`,
      );
      setNota("");
      onFechar();
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setALigar(false);
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      onFechar={onFechar}
      titulo="Ligar ao munícipe"
      descricao={`O agente liga em nome da câmara e explica o ponto do processo ${numero}.`}
    >
      <form onSubmit={ligar} className="flex flex-col gap-4">
        <p className="rounded-xl bg-creme-2 px-3 py-2.5 text-[13px] text-tinta-2">
          {telefone
            ? `Número do munícipe: ${telefone}.`
            : "O munícipe não tem telefone registado."}{" "}
          Fora do horário de chamadas, a chamada fica marcada para o próximo
          período permitido.
        </p>
        <Campo
          rotulo="O que o agente deve explicar (opcional)"
          ajuda="Fica no contexto da chamada."
        >
          {(id) => (
            <textarea
              id={id}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={500}
              rows={3}
              className={AREA_TEXTO}
            />
          )}
        </Campo>
        <ErroEmLinha erro={erro} />
        <div className="flex gap-2.5">
          <BotaoPainel
            variante="contorno"
            grande
            className="flex-1"
            onClick={onFechar}
          >
            Cancelar
          </BotaoPainel>
          <BotaoPainel
            variante="principal"
            grande
            type="submit"
            icone={Phone}
            disabled={aLigar || !telefone}
            className="flex-1"
          >
            {aLigar ? "A ligar…" : "Ligar agora"}
          </BotaoPainel>
        </div>
      </form>
    </Dialogo>
  );
}
