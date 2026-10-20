"use client";

import { Check, CornerDownRight, Mail, Paperclip, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FonteOficial } from "@/components/ui/marca";
import { useSessao } from "@/lib/sessao";
import { CriarProcesso } from "./acoes-entrada";
import { BotaoAcao, EtiquetaCaixa } from "./caixa";
import { useDados, useFuso } from "./dados";
import { useServicosEPessoas } from "./equipa";
import { mensagemErro, quando } from "./formatos";
import type { EmailDetalhe } from "./tipos";
import { ErroBloco, Esqueleto, Rotulo } from "./ui";

export const ESTADOS_EMAIL: Record<EmailDetalhe["estado"], string> = {
  nova: "Por tratar",
  respondida: "Respondido",
  encaminhada: "Encaminhado",
  virou_processo: "Virou processo",
};

/**
 * Pré-visualização de um email da caixa geral: o que escreveram, a
 * resposta redigida pela IA (editável) com as fontes, e as ações.
 */
export function EmailPrevia({ id, aoMudar }: { id: string; aoMudar?: () => void }) {
  const fuso = useFuso();
  const e = useDados<EmailDetalhe>(`/v1/painel/emails/${id}`);
  const d = e.dados;

  if (e.erro) return <ErroBloco className="m-8" mensagem={e.erro} tentar={e.recarregar} />;
  if (!d) {
    return (
      <div className="flex flex-col gap-5 px-8 py-7" aria-busy>
        <Esqueleto className="h-20" />
        <Esqueleto className="h-32" />
        <Esqueleto className="h-56" />
      </div>
    );
  }

  const para = Array.isArray(d.para) ? d.para.join(", ") : d.para;
  const confianca = d.confianca === null ? null : d.confianca >= 0.8 ? "alta" : d.confianca >= 0.5 ? "média" : "baixa";

  return (
    <article className="flex flex-col gap-5 px-8 py-7" aria-labelledby="email-assunto">
      <header className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-xs text-tinta-3">
          <Mail className="size-3.5" aria-hidden />
          {[para, `de ${d.de}`, quando(d.recebido_em, fuso).toLowerCase()].filter(Boolean).join(" · ")}
        </p>
        <h1
          id="email-assunto"
          className="font-display text-2xl font-bold tracking-[-0.4px] text-tinta"
        >
          {d.assunto || "(sem assunto)"}
        </h1>
        <div className="flex flex-wrap gap-1.5">
          <EtiquetaCaixa>{d.servico ?? "Serviço por atribuir"}</EtiquetaCaixa>
          {d.tema && (
            <EtiquetaCaixa tom="verde" icone={Check}>
              {d.tema}
              {confianca && ` · confiança ${confianca}`}
            </EtiquetaCaixa>
          )}
          {d.estado !== "nova" && (
            <EtiquetaCaixa tom="creme" icone={Check}>
              {ESTADOS_EMAIL[d.estado]}
            </EtiquetaCaixa>
          )}
        </div>
      </header>

      <section className="flex flex-col gap-1.5 rounded-[14px] bg-creme-2 p-4">
        <Rotulo>O que escreveram</Rotulo>
        <p className="text-sm leading-normal whitespace-pre-line text-tinta">
          {d.texto?.trim() || "(email sem texto)"}
        </p>
        {d.anexos && d.anexos.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-2">
            {d.anexos.map((a) => (
              <li
                key={a.nome}
                className="flex items-center gap-1.5 rounded-lg bg-papel px-2 py-1 text-xs text-tinta-2"
              >
                <Paperclip className="size-3.5" aria-hidden />
                {a.nome}
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.estado === "respondida" ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-[18px]">
          <Rotulo>
            Resposta enviada
            {d.respondido_em && ` · ${quando(d.respondido_em, fuso).toLowerCase()}`}
            {d.respondido_por_nome && ` · ${d.respondido_por_nome}`}
          </Rotulo>
          <p className="text-sm leading-[1.55] whitespace-pre-line text-tinta">{d.resposta}</p>
        </section>
      ) : d.estado === "virou_processo" ? (
        <p className="text-sm text-tinta-2">
          Este email deu origem a um processo.{" "}
          {d.processo_id && (
            <Link
              href={`/painel/processos/${d.processo_id}`}
              className="font-semibold text-terracota-escuro hover:underline"
            >
              Abrir o processo
            </Link>
          )}
        </p>
      ) : (
        <Responder
          email={d}
          aoMudar={() => {
            e.recarregar();
            aoMudar?.();
          }}
        />
      )}

      {d.estado === "encaminhada" && d.encaminhado_em && (
        <p className="text-xs text-tinta-3">
          Encaminhado a {d.servico ?? "um serviço"} {quando(d.encaminhado_em, fuso).toLowerCase()}.
        </p>
      )}

      {d.classificado_em && (
        <p className="text-[11px] text-tinta-3">
          Classificado e redigido automaticamente. Confirme sempre os valores antes de enviar.
        </p>
      )}
    </article>
  );
}

function Responder({ email: d, aoMudar }: { email: EmailDetalhe; aoMudar: () => void }) {
  const { pedido } = useSessao();
  const [texto, setTexto] = useState(d.rascunho_resposta ?? "");
  const [aEnviar, setAEnviar] = useState<"responder" | "encaminhar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolher, setEscolher] = useState(false);
  const [servico, setServico] = useState(d.servico_id ?? "");
  const lista = useServicosEPessoas(escolher);

  async function responder() {
    if (!texto.trim()) return;
    setAEnviar("responder");
    setErro(null);
    try {
      await pedido(`/v1/painel/emails/${d.id}/responder`, { corpo: { texto: texto.trim() } });
      aoMudar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAEnviar(null);
    }
  }

  async function encaminhar(servicoId: string) {
    setAEnviar("encaminhar");
    setErro(null);
    try {
      await pedido(`/v1/painel/emails/${d.id}/encaminhar`, { corpo: { servico_id: servicoId } });
      aoMudar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAEnviar(null);
    }
  }

  return (
    <>
      <section className="flex flex-col gap-3 rounded-[16px_16px_16px_4px] border-[1.5px] border-terracota bg-papel p-[18px]">
        <label htmlFor={`resposta-${d.id}`} className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-terracota-escuro" aria-hidden />
          <span className="text-[11px] font-bold tracking-[1px] text-terracota-escuro">
            {d.rascunho_resposta
              ? "RESPOSTA REDIGIDA · REVEJA ANTES DE ENVIAR"
              : "A SUA RESPOSTA"}
          </span>
        </label>
        <textarea
          id={`resposta-${d.id}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={Math.min(14, Math.max(6, texto.split("\n").length + 1))}
          placeholder={
            d.classificado_em
              ? "Escreva a resposta ao munícipe."
              : "A resposta ainda está a ser redigida. Pode escrever a sua."
          }
          className="w-full resize-y rounded-lg bg-transparent text-sm leading-[1.55] text-tinta outline-none focus-visible:outline-2"
        />
        {d.fontes.map((f) => (
          <FonteOficial
            key={f.trecho_id}
            documento={[f.titulo, f.referencia].filter(Boolean).join(", ")}
            data={f.entidade}
            url={f.url}
          />
        ))}
      </section>

      {erro && (
        <p role="alert" className="text-[13px] text-terracota-escuro">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <BotaoAcao
          icone={Send}
          principal
          onClick={responder}
          disabled={!!aEnviar || !texto.trim()}
        >
          {aEnviar === "responder" ? "A enviar…" : "Rever e enviar"}
        </BotaoAcao>
        {d.servico_id && d.estado === "nova" && !escolher ? (
          <BotaoAcao
            icone={CornerDownRight}
            onClick={() => encaminhar(d.servico_id!)}
            disabled={!!aEnviar}
          >
            {aEnviar === "encaminhar" ? "A encaminhar…" : `Encaminhar a ${d.servico}`}
          </BotaoAcao>
        ) : null}
        {!escolher && (
          <button
            type="button"
            onClick={() => setEscolher(true)}
            className="h-10 rounded-[10px] px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme-2"
          >
            {d.servico_id ? "Outro serviço" : "Encaminhar a um serviço"}
          </button>
        )}
        <CriarProcesso tipo="email" id={d.id} assunto={d.assunto} aoCriar={aoMudar} />
      </div>

      {escolher && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-linha bg-papel p-4">
          {lista.disponivel ? (
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-tinta-2">
              Encaminhar a
              <select
                value={servico}
                onChange={(e) => setServico(e.target.value)}
                className="h-10 rounded-[10px] border border-linha bg-papel px-3 text-[13px] text-tinta"
              >
                <option value="">Escolha o serviço</option>
                {lista.servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="flex-1 text-xs text-tinta-2">
              A lista de serviços só aparece a quem gere a equipa ou vê os indicadores.
            </p>
          )}
          {lista.disponivel && (
            <BotaoAcao
              icone={CornerDownRight}
              principal
              disabled={!servico || !!aEnviar}
              onClick={() => encaminhar(servico)}
            >
              {aEnviar === "encaminhar" ? "A encaminhar…" : "Encaminhar"}
            </BotaoAcao>
          )}
          <button
            type="button"
            onClick={() => setEscolher(false)}
            className="h-10 rounded-[10px] px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme"
          >
            Cancelar
          </button>
        </div>
      )}
    </>
  );
}
