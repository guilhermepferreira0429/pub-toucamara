"use client";

import { CircleCheck, MessagesSquare, Send, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { MudarEncaminhamento } from "./acoes-entrada";
import { ApoioFuncionario } from "./apoio-funcionario";
import { BotaoAcao, Ficha } from "./caixa";
import { useDados, useFuso } from "./dados";
import {
  canal,
  ESTADOS_PASSAGEM,
  mensagemErro,
  MOTIVOS_PASSAGEM,
  quando,
} from "./formatos";
import type { Passagem } from "./tipos";
import { AvatarAgente, ErroBloco, Esqueleto, LinhaFicha, Pilula, Rotulo } from "./ui";

/**
 * Passagem a funcionário (sem ecrã próprio no design): o caso resumido pelo
 * agente, pegar nela, responder por SMS ou email e fechar. Abre na Entrada
 * (pré-visualização) e em /painel/passagens/:id.
 */
export function PassagemDetalhe({ id, aoMudar }: { id: string; aoMudar?: () => void }) {
  const { pedido, eu, pode } = useSessao();
  const fuso = useFuso();
  const p = useDados<Passagem>(`/v1/painel/passagens/${id}`);
  const [aFazer, setAFazer] = useState<"pegar" | "fechar" | "responder" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [canalResp, setCanalResp] = useState<"sms" | "email" | null>(null);

  if (p.erro) return <ErroBloco className="m-8" mensagem={p.erro} tentar={p.recarregar} />;
  const d = p.dados;
  if (!d) {
    return (
      <div className="flex flex-col gap-5 px-8 py-7" aria-busy>
        <Esqueleto className="h-20" />
        <Esqueleto className="h-40" />
      </div>
    );
  }

  const estado = ESTADOS_PASSAGEM[d.estado] ?? { rotulo: d.estado, tom: "neutro" as const };
  const minha = d.atribuida_a?.id === eu?.utilizador.id;
  const fechada = d.estado === "fechada";
  const podeSms = !!d.municipe?.tem_telefone;
  const podeEmail = !!d.municipe?.tem_email;
  const preferido =
    canalResp ??
    (d.preferencia_resposta === "email" && podeEmail ? "email" : podeSms ? "sms" : podeEmail ? "email" : null);

  async function acao(
    tipo: "pegar" | "fechar" | "responder",
    caminho: string,
    corpo?: unknown,
  ) {
    setAFazer(tipo);
    setErro(null);
    try {
      const r = await pedido<Passagem>(caminho, { metodo: "POST", corpo });
      p.definir(() => r);
      if (tipo === "responder") setTexto("");
      aoMudar?.();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAFazer(null);
    }
  }

  return (
    <article className="flex flex-col gap-5 px-8 py-7" aria-labelledby="passagem-titulo">
      <header className="flex flex-col gap-2.5">
        <p className="text-xs text-tinta-3">
          Passagem a funcionário · {canal(d.canal).rotulo} · {quando(d.criada_em, fuso).toLowerCase()}
          {d.fora_de_horas && " · com o balcão fechado"}
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1
            id="passagem-titulo"
            className="font-display text-[26px] font-bold tracking-[-0.5px] text-tinta"
          >
            {MOTIVOS_PASSAGEM[d.motivo] ?? d.motivo}
          </h1>
          <Pilula tom={estado.tom}>{estado.rotulo}</Pilula>
          {d.atrasada && <Pilula tom="ambar">Atrasada</Pilula>}
        </div>
        {!fechada && (
          <div className="flex flex-wrap gap-2 pt-1">
            {!minha && (
              <BotaoAcao
                icone={UserRoundCheck}
                principal
                disabled={!!aFazer}
                onClick={() => acao("pegar", `/v1/painel/passagens/${d.id}/atribuir`)}
              >
                {aFazer === "pegar" ? "A atribuir…" : "Ficar com ela"}
              </BotaoAcao>
            )}
            {pode("entrada") && (
              <MudarEncaminhamento
                tipo="passagem"
                id={d.id}
                tecnicoId={d.atribuida_a?.id}
                aoMudar={() => {
                  p.recarregar();
                  aoMudar?.();
                }}
              />
            )}
            <BotaoAcao
              icone={CircleCheck}
              disabled={!!aFazer}
              onClick={() => acao("fechar", `/v1/painel/passagens/${d.id}/fechar`)}
            >
              {aFazer === "fechar" ? "A fechar…" : "Fechar"}
            </BotaoAcao>
          </div>
        )}
      </header>

      <section className="flex gap-3 rounded-[14px] bg-terracota-suave p-3.5">
        <AvatarAgente tamanho={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[13px] font-bold text-terracota-escuro">O caso, resumido pelo agente</p>
          <p className="text-sm leading-normal whitespace-pre-line text-tinta">{d.resumo}</p>
          <Link
            href={`/painel/conversas/${d.conversa_id}`}
            className="flex w-fit items-center gap-1.5 pt-1 text-xs font-bold text-terracota-escuro hover:underline"
          >
            <MessagesSquare className="size-3.5" aria-hidden />
            Ver a conversa
          </Link>
        </div>
      </section>

      <Ficha titulo="Ficha">
        <LinhaFicha campo="Munícipe" largura="w-[90px]">
          {d.municipe
            ? [d.municipe.nome, d.municipe.telefone].filter(Boolean).join(" · ") || "Sem nome"
            : "Não identificado"}
        </LinhaFicha>
        <LinhaFicha campo="Quer resposta" largura="w-[90px]">
          {d.preferencia_resposta ? canal(d.preferencia_resposta).rotulo : "Sem preferência"}
        </LinhaFicha>
        <LinhaFicha campo="Responder até" largura="w-[90px]">
          {d.responder_ate ? quando(d.responder_ate, fuso) : "Sem prazo"}
        </LinhaFicha>
        <LinhaFicha campo="Com quem" largura="w-[90px]">
          {d.atribuida_a ? (minha ? "Consigo" : d.atribuida_a.nome) : "Ninguém pegou ainda"}
        </LinhaFicha>
      </Ficha>

      {!fechada && (
        <ApoioFuncionario
          passagemId={d.id}
          resumo={d.resumo}
          ultimaResposta={d.respostas?.length ? d.respostas[d.respostas.length - 1].corpo : null}
          onUsar={setTexto}
        />
      )}

      {d.respostas && d.respostas.length > 0 && (
        <section className="flex flex-col gap-2">
          <Rotulo>Respostas enviadas</Rotulo>
          {d.respostas.map((r) => (
            <div key={r.id} className="rounded-xl border border-linha bg-papel p-3.5">
              <p className="pb-1 text-xs text-tinta-3">
                {canal(r.canal).rotulo} · {quando(r.enviada_em ?? r.enviar_em, fuso).toLowerCase()} ·{" "}
                {r.estado}
              </p>
              <p className="text-[13px] leading-normal whitespace-pre-line text-tinta">{r.corpo}</p>
            </div>
          ))}
        </section>
      )}

      {!fechada && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!preferido || texto.trim().length < 2) return;
            acao("responder", `/v1/painel/passagens/${d.id}/responder`, {
              texto: texto.trim(),
              canal: preferido,
            });
          }}
          className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-[18px]"
        >
          <label htmlFor={`resp-${d.id}`} className="text-[11px] font-bold tracking-[1px] text-tinta-3">
            RESPONDER AO MUNÍCIPE
          </label>
          {preferido ? (
            <>
              <textarea
                id={`resp-${d.id}`}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Escreva a resposta. Vai por SMS ou email, com o nome da câmara."
                className="w-full rounded-[10px] border border-linha bg-creme/40 p-3 text-sm text-tinta"
              />
              <div className="flex flex-wrap items-center gap-3">
                <fieldset className="flex gap-3 text-[13px] text-tinta">
                  <legend className="sr-only">Enviar por</legend>
                  {podeSms && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`canal-${d.id}`}
                        checked={preferido === "sms"}
                        onChange={() => setCanalResp("sms")}
                        className="accent-terracota"
                      />
                      SMS
                    </label>
                  )}
                  {podeEmail && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`canal-${d.id}`}
                        checked={preferido === "email"}
                        onChange={() => setCanalResp("email")}
                        className="accent-terracota"
                      />
                      Email
                    </label>
                  )}
                </fieldset>
                <span className="flex-1" />
                <BotaoAcao
                  icone={Send}
                  principal
                  type="submit"
                  disabled={!!aFazer || texto.trim().length < 2}
                >
                  {aFazer === "responder" ? "A enviar…" : "Enviar resposta"}
                </BotaoAcao>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-tinta-2">
              O munícipe não deixou telefone nem email: não é possível responder por aqui.
            </p>
          )}
        </form>
      )}

      {erro && (
        <p role="alert" className="text-[13px] text-terracota-escuro">
          {erro}
        </p>
      )}
    </article>
  );
}
