"use client";

import { CalendarDays, CircleCheck, FileText, MapPin, MessageSquareText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import { api } from "@/lib/api";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  Nota,
  Rotulo,
  TituloSecao,
  Topo,
} from "./moldura";
import { dataLonga } from "./formatar";
import { mensagemDe, usePublico } from "./use-publico";

/*
 * A página da consulta pública (link do SMS, do chat ou do site): o que está
 * em causa em linguagem simples, participar com o telemóvel (código por SMS,
 * sem conta) e, depois de fechar, o resultado por freguesia.
 */

interface Opcao {
  id: string;
  texto: string;
}
interface Pergunta {
  id: string;
  texto: string;
  opcoes: Opcao[];
}
interface ResultadoPergunta {
  id: string;
  texto: string;
  opcoes: { id: string; texto: string; n: number; pct: number }[];
  por_freguesia: { freguesia: string; abrangida: boolean; total: number; opcoes: Record<string, number> }[];
}

interface ConsultaPublica {
  codigo: string;
  municipio: string;
  titulo: string;
  resumo: string;
  documento_titulo: string | null;
  documento_url: string | null;
  perguntas: Pergunta[];
  pergunta_aberta: string | null;
  freguesias: string[] | null;
  abre_em: string;
  fecha_em: string;
  relatorio_em: string;
  situacao: "agendada" | "aberta" | "terminou" | "fechada";
  participacoes: number;
  pode_participar: boolean;
  motivo: string | null;
  freguesias_sugeridas: string[];
  resultados: { total: number; perguntas: ResultadoPergunta[] } | null;
  temas: { sintese: string; temas: { tema: string; descricao: string; opinioes: number }[] } | null;
  participacao?: { registada: boolean; alterada: boolean; freguesia: string; dizer: string };
}

const CORES = ["bg-verde", "bg-terracota", "bg-ambar", "bg-tinta", "bg-tinta-3", "bg-terracota-escuro"];
const OUTRA = "__outra__";

export function PaginaConsulta({ codigo }: { codigo: string }) {
  const caminho = `/v1/public/consultas-publicas/${encodeURIComponent(codigo)}`;
  const { c, definir, tentarOutraVez } = usePublico<ConsultaPublica>(caminho);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const x = c.dados;
  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={x.codigo} mono />
      <Cabecalho
        meta={`Consulta pública · Câmara Municipal de ${x.municipio}`}
        titulo={x.titulo}
        sub={
          x.pode_participar
            ? `Pode dar a sua opinião até ${dataLonga(x.fecha_em)}.`
            : (x.motivo ?? undefined)
        }
      />

      <section className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5" aria-labelledby="em-causa">
        <Rotulo id="em-causa">O que está em causa</Rotulo>
        <p className="text-[16px] leading-[1.5] text-tinta">{x.resumo}</p>
        {x.documento_url && (
          <a
            href={x.documento_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-[15px] font-semibold text-terracota underline-offset-2 hover:underline"
          >
            <FileText className="size-5" aria-hidden />
            {x.documento_titulo ?? "Ver o documento"}
          </a>
        )}
        <ul className="flex flex-col gap-2 pt-1 text-[15px] text-tinta-2">
          <li className="flex gap-2.5">
            <MapPin className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
            {x.freguesias?.length ? `Freguesias: ${x.freguesias.join(", ")}` : "Todo o concelho"}
          </li>
          <li className="flex gap-2.5">
            <CalendarDays className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
            De {dataLonga(x.abre_em)} a {dataLonga(x.fecha_em)}. Relatório a {dataLonga(x.relatorio_em)}.
          </li>
        </ul>
      </section>

      {x.participacao && (
        <CartaoDestaque rotulo="Obrigado" tom="verde">
          <p className="flex items-center gap-2 font-display text-[24px] leading-tight font-bold">
            <CircleCheck className="size-7" aria-hidden /> A sua opinião foi registada
          </p>
          <p className="text-[15px] text-white/90">{x.participacao.dizer}</p>
        </CartaoDestaque>
      )}

      {x.pode_participar && !x.participacao && (
        <Participar x={x} caminho={caminho} onFeito={definir} />
      )}

      {!x.pode_participar && !x.resultados && x.motivo && (
        <Nota icone={CalendarDays} tom="neutro" papel="status">
          {x.motivo}
        </Nota>
      )}

      {x.resultados && <ResultadoPublico r={x.resultados} temas={x.temas} />}

      <MaisDuvidas
        titulo="Prefere falar com alguém?"
        nota="Também pode dar a sua opinião por telefone ou no chat: é só dizer que quer participar nesta consulta."
      />
    </div>
  );
}

function Participar({
  x,
  caminho,
  onFeito,
}: {
  x: ConsultaPublica;
  caminho: string;
  onFeito: (d: ConsultaPublica) => void;
}) {
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [opiniao, setOpiniao] = useState("");
  const [freguesia, setFreguesia] = useState("");
  const [outra, setOutra] = useState("");
  const [telefone, setTelefone] = useState("");
  const [pedido, setPedido] = useState<{ pedido: string; telefone: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aCorrer, setACorrer] = useState(false);

  const freguesiaFinal = freguesia === OUTRA ? outra.trim() : freguesia;
  const completo = x.perguntas.every((p) => respostas[p.id]) && freguesiaFinal.length >= 2;

  const correr = async (f: () => Promise<void>) => {
    setACorrer(true);
    setErro(null);
    try {
      await f();
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setACorrer(false);
    }
  };

  const pedirCodigo = () =>
    correr(async () => {
      const r = await api<{ pedido: string; telefone: string }>(`${caminho}/codigo`, {
        corpo: { telefone },
      });
      setPedido(r);
    });

  const enviar = () =>
    correr(async () => {
      if (!pedido) return;
      const r = await api<ConsultaPublica>(`${caminho}/participar`, {
        corpo: {
          pedido: pedido.pedido,
          codigo: codigo.trim(),
          respostas,
          opiniao: opiniao.trim() || undefined,
          freguesia: freguesiaFinal,
        },
      });
      onFeito(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pedido) void pedirCodigo();
        else void enviar();
      }}
    >
      <TituloSecao>A sua opinião</TituloSecao>
      {x.perguntas.map((p, i) => (
        <fieldset key={p.id} className="flex flex-col gap-2.5">
          <legend className="pb-2 text-[17px] font-bold text-tinta">
            {x.perguntas.length > 1 ? `${i + 1}. ` : ""}
            {p.texto}
          </legend>
          {p.opcoes.map((o) => {
            const escolhida = respostas[p.id] === o.id;
            return (
              <label
                key={o.id}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] px-4 text-[17px] ${
                  escolhida ? "border-terracota bg-terracota-suave/50 font-semibold" : "border-linha bg-papel"
                }`}
              >
                <input
                  type="radio"
                  name={p.id}
                  value={o.id}
                  checked={escolhida}
                  onChange={() => setRespostas((r) => ({ ...r, [p.id]: o.id }))}
                  className="size-5 accent-terracota"
                />
                {o.texto}
              </label>
            );
          })}
        </fieldset>
      ))}

      {x.pergunta_aberta && (
        <label className="flex flex-col gap-2">
          <span className="text-[17px] font-bold text-tinta">
            {x.pergunta_aberta} <span className="font-normal text-tinta-3">(opcional)</span>
          </span>
          <textarea
            value={opiniao}
            onChange={(e) => setOpiniao(e.target.value)}
            maxLength={2000}
            rows={4}
            className="w-full rounded-2xl border-[1.5px] border-linha bg-papel p-4 text-[16px] text-tinta outline-none focus:border-terracota"
            placeholder="Escreva como falaria. Não ponha o seu nome nem contactos."
          />
        </label>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-[17px] font-bold text-tinta">Em que freguesia mora?</span>
        <select
          value={freguesia}
          onChange={(e) => setFreguesia(e.target.value)}
          className="h-14 w-full rounded-2xl border-[1.5px] border-linha bg-papel px-4 text-[16px] text-tinta"
          required
        >
          <option value="">Escolha a freguesia</option>
          {x.freguesias_sugeridas.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value={OUTRA}>Outra freguesia</option>
        </select>
        {freguesia === OUTRA && (
          <input
            value={outra}
            onChange={(e) => setOutra(e.target.value)}
            className="h-14 w-full rounded-2xl border-[1.5px] border-linha bg-papel px-4 text-[16px]"
            placeholder="Nome da freguesia"
            aria-label="Nome da freguesia"
            maxLength={120}
          />
        )}
      </label>

      <section className="flex flex-col gap-3 rounded-2xl bg-creme-2 p-4" aria-labelledby="telemovel">
        <p id="telemovel" className="flex items-center gap-2 text-[16px] font-bold text-tinta">
          <ShieldCheck className="size-5 text-verde" aria-hidden /> Confirmar com o telemóvel
        </p>
        <p className="text-[14px] leading-[1.45] text-tinta-2">
          Cada pessoa participa uma vez: se já deu a opinião por telefone ou no chat, esta substitui a anterior.
          O número não aparece nos resultados.
        </p>
        {!pedido ? (
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            className="h-14 w-full rounded-2xl border-[1.5px] border-linha bg-papel px-4 text-[18px]"
            placeholder="912 345 678"
            aria-label="Número de telemóvel"
          />
        ) : (
          <>
            <p className="text-[14px] text-tinta">Enviámos um código para {pedido.telefone}.</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="h-14 w-full rounded-2xl border-[1.5px] border-linha bg-papel px-4 font-mono text-[22px] tracking-[6px]"
              placeholder="000000"
              aria-label="Código do SMS"
            />
          </>
        )}
      </section>

      {erro && (
        <Nota icone={MessageSquareText} tom="terracota" papel="alert">
          {erro}
        </Nota>
      )}
      <Botao
        type="submit"
        tamanho="grande"
        className="w-full"
        disabled={aCorrer || !completo || (!pedido ? telefone.trim().length < 9 : codigo.length !== 6)}
      >
        {aCorrer ? "Um momento…" : pedido ? "Enviar a minha opinião" : "Receber o código por SMS"}
      </Botao>
    </form>
  );
}

function ResultadoPublico({
  r,
  temas,
}: {
  r: NonNullable<ConsultaPublica["resultados"]>;
  temas: ConsultaPublica["temas"];
}) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="resultado">
      <TituloSecao id="resultado">O resultado</TituloSecao>
      <p className="text-[15px] text-tinta-2">{r.total === 1 ? "1 pessoa participou." : `${r.total} pessoas participaram.`}</p>
      {r.perguntas.map((p) => (
        <div key={p.id} className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5">
          <p className="text-[17px] font-bold text-tinta">{p.texto}</p>
          <ul className="flex flex-col gap-2.5">
            {p.opcoes.map((o, i) => (
              <li key={o.id} className="flex flex-col gap-1">
                <span className="flex justify-between text-[15px] text-tinta">
                  <span>{o.texto}</span>
                  <span className="font-semibold">
                    {o.pct.toLocaleString("pt-PT")}% <span className="font-normal text-tinta-3">({o.n})</span>
                  </span>
                </span>
                <span className="h-2.5 w-full overflow-hidden rounded-full bg-creme-2" aria-hidden>
                  <span className={`block h-full ${CORES[i % CORES.length]}`} style={{ width: `${o.pct}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <details className="pt-1">
            <summary className="cursor-pointer text-[14px] font-semibold text-tinta-2">Por freguesia</summary>
            <ul className="mt-2 flex flex-col divide-y divide-linha text-[14px]">
              {p.por_freguesia
                .filter((f) => f.total > 0)
                .map((f) => (
                  <li key={f.freguesia} className="flex flex-col gap-0.5 py-2">
                    <span className="font-semibold text-tinta">
                      {f.freguesia} <span className="font-normal text-tinta-3">· {f.total}</span>
                    </span>
                    <span className="text-tinta-2">
                      {p.opcoes.map((o) => `${o.texto}: ${f.opcoes[o.id] ?? 0}`).join(" · ")}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </div>
      ))}
      {temas && temas.temas.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5">
          <Rotulo>O que as pessoas disseram</Rotulo>
          {temas.sintese && <p className="text-[15px] leading-[1.5] text-tinta">{temas.sintese}</p>}
          <ul className="flex flex-col gap-2">
            {temas.temas.map((t) => (
              <li key={t.tema} className="text-[15px] text-tinta">
                <strong>{t.tema}</strong> <span className="text-tinta-3">({t.opinioes})</span>: {t.descricao}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
