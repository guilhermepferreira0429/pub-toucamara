"use client";

import { Eye, Send, ShieldCheck, Unlink, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/components/ui/botao";
import { api, ErroApi, sse } from "@/lib/api";
import {
  ACarregar,
  Cabecalho,
  LinkInvalido,
  Nota,
  Rotulo,
  Topo,
} from "./moldura";

/*
 * "Fale com o meu filho" na chamada web: o familiar abre o link do SMS e vê
 * a conversa em direto. Pode escrever ao agente ("sou a filha, a minha mãe
 * tem o processo X"): a mensagem entra na chamada e o agente usa-a. A pessoa
 * pode deixar de partilhar e o link deixa de funcionar.
 */

type Quem = "municipe" | "agente" | "funcionario" | "familiar" | "ferramenta";

interface Fala {
  seq: number;
  quem: Quem;
  texto: string;
  em: string;
}

interface Acompanhamento {
  pessoa: string | null;
  municipio: string;
  quem: string;
  aviso: string;
  expira_em: string;
  mensagens_restantes: number;
  falas: Fala[];
}

type Estado =
  | { tipo: "a_carregar" }
  | { tipo: "invalido" }
  | { tipo: "terminado"; mensagem: string }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "ok"; dados: Acompanhamento };

const FIM: Record<string, string> = {
  retirado: "A pessoa deixou de partilhar esta conversa.",
  terminada: "A chamada terminou. Obrigado pela ajuda.",
  expirado: "Este link já expirou.",
};

export function PaginaAcompanhar({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "a_carregar" });
  const [novas, setNovas] = useState<Fala[]>([]);
  const [fim, setFim] = useState<string | null>(null);
  const fundo = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    let vivo = true;
    api<Acompanhamento>(`/v1/public/acompanhar/${encodeURIComponent(token)}`).then(
      (dados) => vivo && setEstado({ tipo: "ok", dados }),
      (e: unknown) => {
        if (!vivo) return;
        if (e instanceof ErroApi && (e.estado === 404 || e.codigo === "pedido_invalido"))
          setEstado({ tipo: "invalido" });
        else if (e instanceof ErroApi && e.estado === 410)
          setEstado({ tipo: "terminado", mensagem: e.message });
        else
          setEstado({
            tipo: "erro",
            mensagem: e instanceof ErroApi ? e.message : "Ocorreu um erro.",
          });
      },
    );
    return () => {
      vivo = false;
    };
  }, [token]);

  const desde = estado.tipo === "ok" ? (estado.dados.falas.at(-1)?.seq ?? 0) : null;

  useEffect(() => {
    if (desde === null) return;
    const ac = new AbortController();
    (async () => {
      try {
        for await (const ev of sse(
          `/v1/public/acompanhar/${encodeURIComponent(token)}/eventos?desde=${desde}`,
          { sinal: ac.signal },
        )) {
          if (ev.evento === "fala") setNovas((n) => [...n, ev.dados as Fala]);
          else if (ev.evento === "fim") {
            const m = (ev.dados as { motivo?: string }).motivo ?? "terminada";
            setFim(FIM[m] ?? FIM.terminada);
          }
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof ErroApi && e.estado === 410) setFim(e.message);
      }
    })();
    return () => ac.abort();
  }, [token, desde]);

  const falas =
    estado.tipo === "ok"
      ? [...estado.dados.falas, ...novas.filter((n) => n.seq > (desde ?? 0))]
      : [];

  useEffect(() => {
    fundo.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [falas.length]);

  if (estado.tipo === "a_carregar") return <ACarregar texto="A abrir a conversa…" />;
  if (estado.tipo === "invalido") return <LinkInvalido />;
  if (estado.tipo === "terminado" || estado.tipo === "erro")
    return <Terminado mensagem={estado.mensagem} />;

  const d = estado.dados;
  const deQuem = d.pessoa ?? "a pessoa que lhe pediu ajuda";

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={fim ? "terminada" : "em direto"} />
      <Cabecalho
        meta={`Câmara Municipal de ${d.municipio}`}
        titulo={`Está a acompanhar a chamada de ${deQuem}`}
        sub="Veja o que se fala com o assistente da câmara e escreva se puder ajudar."
      />
      <Nota icone={ShieldCheck} tom="neutro">
        {d.aviso}
      </Nota>

      <section aria-labelledby="conversa" className="flex flex-col gap-3">
        <Rotulo id="conversa">A conversa</Rotulo>
        <ol
          aria-live="polite"
          className="flex max-h-[55dvh] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-linha bg-papel p-4"
        >
          {!falas.length && (
            <li className="text-[15px] text-tinta-3">Ainda não há nada para mostrar.</li>
          )}
          {falas.map((f) => (
            <LinhaFala key={f.seq} f={f} pessoa={d.pessoa} />
          ))}
          <li ref={fundo} aria-hidden className="h-0" />
        </ol>
      </section>

      {fim ? (
        <Terminado mensagem={fim} embutido />
      ) : (
        <Escrever token={token} restantes={d.mensagens_restantes} />
      )}
    </div>
  );
}

function LinhaFala({ f, pessoa }: { f: Fala; pessoa: string | null }) {
  if (f.quem === "ferramenta")
    return (
      <li className="flex items-center gap-2 self-center rounded-full bg-creme-2 px-3 py-1 text-[13px] text-tinta-2">
        <Wrench className="size-3.5" aria-hidden />
        {f.texto}
      </li>
    );
  const nome: Record<Exclude<Quem, "ferramenta">, string> = {
    municipe: pessoa ?? "A pessoa",
    agente: "Assistente da câmara",
    funcionario: "Funcionário da câmara",
    familiar: "Você",
  };
  const estilo: Record<Exclude<Quem, "ferramenta">, string> = {
    municipe: "self-start rounded-[4px_16px_16px_16px] bg-creme-2",
    agente: "self-end rounded-[16px_4px_16px_16px] border border-linha bg-papel",
    funcionario: "self-end rounded-[16px_4px_16px_16px] bg-tinta text-white",
    familiar: "self-start rounded-[4px_16px_16px_16px] bg-verde-suave",
  };
  return (
    <li className={`flex max-w-[88%] flex-col gap-1 px-3.5 py-2.5 ${estilo[f.quem]}`}>
      <span
        className={`text-[11px] font-bold tracking-[0.6px] uppercase ${f.quem === "funcionario" ? "text-white/70" : "text-tinta-3"}`}
      >
        {nome[f.quem]}
      </span>
      <span className="text-[15px] leading-[1.45]">{f.texto}</span>
    </li>
  );
}

function Escrever({ token, restantes }: { token: string; restantes: number }) {
  const [texto, setTexto] = useState("");
  const [faltam, setFaltam] = useState(restantes);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);
  return (
    <section aria-labelledby="escrever" className="flex flex-col gap-3">
      <Rotulo id="escrever">Escrever ao assistente</Rotulo>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!texto.trim()) return;
          setAEnviar(true);
          setErro(null);
          try {
            const r = await api<{ mensagens_restantes: number }>(
              `/v1/public/acompanhar/${encodeURIComponent(token)}/mensagens`,
              { corpo: { texto } },
            );
            setFaltam(r.mensagens_restantes);
            setTexto("");
            setEnviada(true);
          } catch (e) {
            setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar.");
          } finally {
            setAEnviar(false);
          }
        }}
      >
        <label htmlFor="texto-familiar" className="sr-only">
          Mensagem para o assistente
        </label>
        <textarea
          id="texto-familiar"
          value={texto}
          maxLength={500}
          rows={3}
          disabled={faltam <= 0}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: Sou a filha. A minha mãe tem o processo de obras CP-2026-12."
          className="w-full rounded-2xl border border-linha bg-papel px-4 py-3 text-[16px] text-tinta placeholder:text-tinta-3 focus:border-tinta focus:outline-none"
        />
        <Botao
          type="submit"
          tamanho="grande"
          icone={Send}
          disabled={aEnviar || !texto.trim() || faltam <= 0}
          className="w-full"
        >
          Enviar
        </Botao>
        <p className="text-[13px] text-tinta-3">
          O assistente lê a sua mensagem e diz à pessoa. {faltam > 0 ? `Pode enviar mais ${faltam}.` : "Já não pode enviar mais nesta chamada."}
        </p>
        {enviada && !erro && (
          <p role="status" className="text-[14px] font-semibold text-verde">
            Enviada. Vai aparecer na conversa.
          </p>
        )}
        {erro && (
          <p role="alert" className="text-[14px] font-semibold text-terracota-escuro">
            {erro}
          </p>
        )}
      </form>
    </section>
  );
}

function Terminado({ mensagem, embutido }: { mensagem: string; embutido?: boolean }) {
  const corpo = (
    <div className="flex flex-col gap-4">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-[28px_28px_28px_8px] bg-creme-2"
      >
        {embutido ? (
          <Eye className="size-7 text-tinta-2" />
        ) : (
          <Unlink className="size-7 text-terracota-escuro" />
        )}
      </span>
      <Cabecalho
        titulo={mensagem}
        sub="Por privacidade, já não pode ver a conversa nem escrever. Se precisar, ligue para a câmara."
      />
    </div>
  );
  if (embutido) return <section role="status">{corpo}</section>;
  return (
    <div className="flex w-full flex-col gap-8">
      <Topo />
      {corpo}
    </div>
  );
}
