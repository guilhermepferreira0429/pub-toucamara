"use client";

import { BookOpenCheck, GraduationCap, Lightbulb, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { BotaoAcao } from "./caixa";
import { mensagemErro } from "./formatos";
import { Pilula, Rotulo } from "./ui";

/*
 * Ajuda ao funcionário numa passagem: o agente continua a trabalhar com
 * ele. Sugere a resposta (se houver IA), mostra a regra que se aplica e a
 * ficha da pessoa. Depois de responder, "Ensinar ao agente" guarda a
 * resposta como conhecimento novo, para alguém aprovar.
 */

interface Sugestao {
  ia: boolean;
  motivo_sem_ia: string | null;
  sugestao: {
    resposta: string;
    regra: string | null;
    confianca: "alta" | "media" | "baixa";
    falta_saber: string | null;
  } | null;
  sem_fonte: boolean;
  respostas_curadas: { pergunta: string; texto: string }[];
  regras: { titulo: string; referencia: string | null; entidade: string; url: string; texto: string }[];
  processos: { id: string; numero: string; assunto: string; fase: string; prazo_fim: string | null }[];
  ocorrencias: { id: string; numero: string; morada: string; estado: string }[];
  pergunta: string;
}

const CONFIANCA = {
  alta: { rotulo: "confiança alta", tom: "verde" },
  media: { rotulo: "confiança média", tom: "ambar" },
  baixa: { rotulo: "confiança baixa", tom: "terracota" },
} as const;

export function ApoioFuncionario({
  passagemId,
  resumo,
  ultimaResposta,
  onUsar,
}: {
  passagemId: string;
  resumo: string;
  ultimaResposta: string | null;
  onUsar: (texto: string) => void;
}) {
  const { pedido } = useSessao();
  const [s, setS] = useState<Sugestao | null>(null);
  const [aPedir, setAPedir] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function pedir() {
    setAPedir(true);
    setErro(null);
    try {
      setS(await pedido<Sugestao>(`/v1/painel/passagens/${passagemId}/sugestao`, { metodo: "POST" }));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAPedir(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-terracota/40 bg-papel p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-terracota" aria-hidden />
          <p className="text-[13px] font-bold text-tinta">Ajuda do agente</p>
        </div>
        <BotaoAcao icone={aPedir ? LoaderCircle : Lightbulb} disabled={aPedir} onClick={pedir}>
          {aPedir ? "A procurar…" : s ? "Pedir outra vez" : "Sugerir resposta e regra"}
        </BotaoAcao>
      </div>
      {!s && !erro && (
        <p className="text-[13px] text-tinta-2">
          O agente procura nas fontes oficiais a regra que se aplica, junta os processos da pessoa e
          propõe uma resposta. O funcionário decide o que envia.
        </p>
      )}
      {erro && (
        <p role="alert" className="text-[13px] text-terracota-escuro">
          {erro}
        </p>
      )}
      {s && (
        <div className="flex flex-col gap-4">
          {s.sugestao ? (
            <div className="flex flex-col gap-2 rounded-xl bg-terracota-suave/60 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Rotulo>Resposta sugerida</Rotulo>
                <Pilula tom={CONFIANCA[s.sugestao.confianca].tom}>{CONFIANCA[s.sugestao.confianca].rotulo}</Pilula>
                {s.sugestao.regra && <Pilula tom="neutro">{s.sugestao.regra}</Pilula>}
              </div>
              <p className="text-sm leading-normal whitespace-pre-line text-tinta">{s.sugestao.resposta}</p>
              {s.sugestao.falta_saber && (
                <p className="text-[13px] text-ambar">Confirmar antes de enviar: {s.sugestao.falta_saber}</p>
              )}
              <div>
                <BotaoAcao principal icone={BookOpenCheck} onClick={() => onUsar(s.sugestao!.resposta)}>
                  Usar esta resposta
                </BotaoAcao>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-tinta-2">{s.motivo_sem_ia}</p>
          )}

          <div className="flex flex-col gap-2">
            <Rotulo>Regras que se aplicam</Rotulo>
            {s.regras.length === 0 && s.respostas_curadas.length === 0 ? (
              <p className="text-[13px] text-tinta-2">
                Não há fonte oficial para isto. Depois de responder, ensine o agente para a próxima vez.
              </p>
            ) : (
              <>
                {s.respostas_curadas.map((r) => (
                  <div key={r.pergunta} className="rounded-xl border border-linha p-3">
                    <p className="text-xs font-bold text-verde">Resposta aprovada pela câmara · {r.pergunta}</p>
                    <p className="pt-1 text-[13px] text-tinta">{r.texto}</p>
                  </div>
                ))}
                {s.regras.map((r) => (
                  <div key={`${r.titulo}-${r.referencia}`} className="rounded-xl border border-linha p-3">
                    <p className="text-xs font-bold text-tinta">
                      {r.titulo}
                      {r.referencia ? ` · ${r.referencia}` : ""}
                      <span className="font-normal text-tinta-3"> · {r.entidade}</span>
                    </p>
                    <p className="pt-1 text-[13px] leading-normal text-tinta-2">{r.texto}</p>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-terracota">
                        abrir a fonte
                      </a>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {(s.processos.length > 0 || s.ocorrencias.length > 0) && (
            <div className="flex flex-col gap-2">
              <Rotulo>Desta pessoa</Rotulo>
              <div className="flex flex-wrap gap-2">
                {s.processos.map((p) => (
                  <Link
                    key={p.id}
                    href={`/painel/processos/${p.id}`}
                    className="rounded-full border border-linha px-3 py-1 text-xs font-semibold text-tinta hover:bg-creme"
                  >
                    {p.numero} · {p.assunto} · {p.fase}
                  </Link>
                ))}
                {s.ocorrencias.map((o) => (
                  <span key={o.id} className="rounded-full border border-linha px-3 py-1 text-xs font-semibold text-tinta">
                    {o.numero} · {o.morada} · {o.estado}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {ultimaResposta && <Ensinar passagemId={passagemId} pergunta={s?.pergunta ?? resumo} resposta={ultimaResposta} />}
    </section>
  );
}

function Ensinar({ passagemId, pergunta: p0, resposta: r0 }: { passagemId: string; pergunta: string; resposta: string }) {
  const { pedido } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [pergunta, setPergunta] = useState(p0);
  const [resposta, setResposta] = useState(r0);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  if (feito) {
    return (
      <p className="rounded-xl bg-verde-suave px-3.5 py-2.5 text-[13px] text-verde">
        Ficou em Conhecimento › Sem resposta. Depois de aprovada (e de passar nas perguntas de teste),
        o agente já sabe responder.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-linha pt-3">
      {!aberto ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-tinta-2">Respondeu a uma pergunta que o agente não sabia?</p>
          <BotaoAcao icone={GraduationCap} onClick={() => setAberto(true)}>
            Ensinar ao agente
          </BotaoAcao>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setAEnviar(true);
            setErro(null);
            try {
              await pedido(`/v1/painel/passagens/${passagemId}/ensinar`, {
                corpo: { pergunta: pergunta.trim(), resposta: resposta.trim() },
              });
              setFeito(true);
            } catch (er) {
              setErro(mensagemErro(er));
            } finally {
              setAEnviar(false);
            }
          }}
        >
          <label className="text-xs font-bold text-tinta-3" htmlFor={`ens-p-${passagemId}`}>
            A PERGUNTA, COMO AS PESSOAS A FAZEM
          </label>
          <input
            id={`ens-p-${passagemId}`}
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            className="rounded-[10px] border border-linha bg-creme/40 p-2.5 text-sm text-tinta"
          />
          <label className="text-xs font-bold text-tinta-3" htmlFor={`ens-r-${passagemId}`}>
            A RESPOSTA
          </label>
          <textarea
            id={`ens-r-${passagemId}`}
            rows={3}
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            className="rounded-[10px] border border-linha bg-creme/40 p-2.5 text-sm text-tinta"
          />
          {erro && (
            <p role="alert" className="text-[13px] text-terracota-escuro">
              {erro}
            </p>
          )}
          <div className="flex justify-end">
            <BotaoAcao
              principal
              type="submit"
              icone={GraduationCap}
              disabled={aEnviar || pergunta.trim().length < 5 || resposta.trim().length < 5}
            >
              {aEnviar ? "A guardar…" : "Propor ao conhecimento"}
            </BotaoAcao>
          </div>
        </form>
      )}
    </div>
  );
}
