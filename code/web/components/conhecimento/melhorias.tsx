"use client";

import { Check, ExternalLink, Mail, RotateCcw, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  Cartao,
  classeEntrada,
  Dialogo,
  dia,
  ErroLinha,
  Estado,
  numero,
  Pilula,
  Rotulo,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "./comum";
import type { EstadoMelhoria, Melhoria, MelhoriaResumo, ResumoMelhorias } from "./tipos";

const ESTADOS: Record<EstadoMelhoria, { rotulo: string; tom: "ambar" | "neutro" | "verde" | "terracota" }> = {
  proposta: { rotulo: "proposta", tom: "ambar" },
  enviada: { rotulo: "enviada", tom: "neutro" },
  publicada: { rotulo: "publicada no portal", tom: "verde" },
  rejeitada: { rotulo: "rejeitada", tom: "terracota" },
};

const TIPOS: Record<string, string> = {
  nova_informacao: "Informação nova no portal",
  tornar_visivel: "Tornar visível o que já existe",
};

function Detalhe({ id, onMudou }: { id: string; onMudou: () => void }) {
  const { pedido, pode } = useSessao();
  const m = useDados<Melhoria>(`/v1/painel/conhecimento/melhorias/${id}`);
  const [email, setEmail] = useState("");
  const acao = useAcao();
  const escrever = pode("conhecimento");

  if (m.erro || !m.dados) return <Estado aCarregar={m.aCarregar} erro={m.erro} />;
  const d = m.dados;
  const mudar = async (f: () => Promise<Melhoria>) => {
    const r = await acao.executar(f);
    if (r) {
      m.mudar(() => r);
      onMudou();
    }
  };
  const estado = (e: EstadoMelhoria) =>
    mudar(() =>
      pedido<Melhoria>(`/v1/painel/conhecimento/melhorias/${id}`, {
        metodo: "PATCH",
        corpo: { estado: e },
      }),
    );

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap gap-1.5">
        <Pilula tom={ESTADOS[d.estado].tom}>{ESTADOS[d.estado].rotulo}</Pilula>
        <Pilula>{TIPOS[d.tipo] ?? d.tipo}</Pilula>
        <Pilula>{numero(d.vezes)}× perguntado</Pilula>
      </div>
      <div className="flex flex-col gap-1">
        <Rotulo>O que falta</Rotulo>
        <p className="text-tinta">{d.o_que_falta}</p>
      </div>
      <div className="flex flex-col gap-1">
        <Rotulo>Sugestão para o portal</Rotulo>
        <p className="rounded-xl bg-creme p-3 whitespace-pre-line text-tinta">{d.sugestao}</p>
      </div>
      {(d.onde || d.fonte_existente) && (
        <div className="flex flex-col gap-1 text-[13px] text-tinta-2">
          {d.onde && (
            <p>
              Onde:{" "}
              {d.onde_url ? (
                <a href={d.onde_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-tinta underline">
                  {d.onde} <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                d.onde
              )}
            </p>
          )}
          {d.fonte_existente && (
            <p>
              Já existe em:{" "}
              <a href={d.fonte_existente_url ?? "#"} target="_blank" rel="noreferrer" className="text-tinta underline">
                {d.fonte_existente}
              </a>
            </p>
          )}
          {(d.servico || d.entidade) && <p>Responsável: {d.servico ?? d.entidade}</p>}
          {d.enviada_para && (
            <p>
              Enviada para {d.enviada_para} a {dia(d.enviada_em)}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Rotulo>Perguntas ligadas</Rotulo>
        <ul className="flex flex-col gap-2">
          {d.perguntas.map((p) => (
            <li key={p.id} className="rounded-xl border border-linha p-3">
              <p className="font-semibold text-tinta">
                {p.texto} <span className="font-normal text-tinta-3">· {p.vezes}×</span>
              </p>
              {p.exemplos.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-tinta-2">
                  {p.exemplos.map((x, i) => (
                    <li key={i}>“{x}”</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
      <ErroLinha erro={acao.erro} />
      {escrever && d.estado !== "publicada" && (
        <div className="flex flex-col gap-3 border-t border-linha pt-4">
          {(d.estado === "proposta" || d.estado === "enviada") && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                mudar(() =>
                  pedido<Melhoria>(`/v1/painel/conhecimento/melhorias/${id}/enviar`, {
                    corpo: email.trim() ? { email: email.trim() } : {},
                  }),
                );
              }}
            >
              <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-tinta">
                Enviar por email para
                <input
                  type="email"
                  className={classeEntrada}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="o email do serviço responsável (por omissão)"
                />
              </label>
              <Botao type="submit" icone={Mail} disabled={acao.aCorrer}>
                {d.estado === "enviada" ? "Reenviar" : "Enviar"}
              </Botao>
            </form>
          )}
          <div className="flex flex-wrap gap-2">
            {d.estado !== "rejeitada" && (
              <Botao variante="secundario" tamanho="pequeno" icone={Check} disabled={acao.aCorrer} onClick={() => estado("publicada")}>
                Já está no portal
              </Botao>
            )}
            {d.estado !== "rejeitada" ? (
              <Botao variante="discreto" tamanho="pequeno" icone={X} disabled={acao.aCorrer} onClick={() => estado("rejeitada")}>
                Rejeitar
              </Botao>
            ) : (
              <Botao variante="secundario" tamanho="pequeno" icone={RotateCcw} disabled={acao.aCorrer} onClick={() => estado("proposta")}>
                Voltar a propor
              </Botao>
            )}
          </div>
          <p className="text-xs text-tinta-3">
            Quando a melhoria estiver publicada, as perguntas ligadas passam a resolvidas.
          </p>
        </div>
      )}
    </div>
  );
}

/** Melhorias ao portal: perguntas sem resposta que pedem informação no site da câmara. */
export function Melhorias() {
  const { pedido, pode } = useSessao();
  const [filtro, setFiltro] = useState<"" | EstadoMelhoria>("");
  const [aberta, setAberta] = useState<MelhoriaResumo | null>(null);
  const [gerado, setGerado] = useState<string | null>(null);
  const resumo = useDados<ResumoMelhorias>("/v1/painel/conhecimento/melhorias/resumo");
  const base = `/v1/painel/conhecimento/melhorias?limite=20${filtro ? `&estado=${filtro}` : ""}`;
  const lista = useDados<Pagina<MelhoriaResumo>>(base);
  const mais = useMais(base, lista);
  const gerar = useAcao();
  const r = resumo.dados;

  return (
    <Cartao className="flex flex-col gap-4 p-6" aria-labelledby="titulo-melhorias">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="titulo-melhorias" className="font-display text-xl font-bold text-tinta">
            Melhorias ao portal
          </h2>
          <p className="text-[13px] text-tinta-2">
            Perguntas a que nem o portal responde: o que propomos acrescentar ou tornar visível.
          </p>
        </div>
        {pode("conhecimento") && (
          <Botao
            variante="secundario"
            tamanho="pequeno"
            icone={Sparkles}
            disabled={gerar.aCorrer}
            onClick={async () => {
              const x = await gerar.executar(() =>
                pedido<{ em_fila: boolean }>("/v1/painel/conhecimento/melhorias/gerar", {
                  metodo: "POST",
                }),
              );
              if (x)
                setGerado(
                  x.em_fila
                    ? "Estamos a preparar propostas novas. Aparecem aqui dentro de alguns minutos."
                    : "Já há propostas a ser preparadas.",
                );
            }}
          >
            Gerar propostas
          </Botao>
        )}
      </div>
      {gerado && <p className="rounded-xl bg-verde-suave px-3 py-2 text-[13px] text-verde">{gerado}</p>}
      <ErroLinha erro={gerar.erro} />

      {r && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["propostas", r.propostas],
            ["enviadas", r.enviadas],
            ["publicadas no portal", r.publicadas],
            ["perguntas resolvidas", r.perguntas_resolvidas],
          ].map(([rot, n]) => (
            <div key={rot} className="flex flex-col gap-0.5 rounded-xl bg-creme p-3">
              <dt className="order-2 text-xs text-tinta-2">{rot}</dt>
              <dd className="font-display text-2xl font-bold text-tinta">{numero(n as number)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar melhorias">
        {(["", "proposta", "enviada", "publicada", "rejeitada"] as const).map((e) => (
          <button
            key={e}
            type="button"
            aria-pressed={filtro === e}
            onClick={() => setFiltro(e)}
            className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
              filtro === e ? "border-tinta bg-tinta text-white" : "border-linha bg-creme text-tinta-2"
            }`}
          >
            {e ? ESTADOS[e].rotulo : "Todas"}
          </button>
        ))}
      </div>

      <Estado
        aCarregar={lista.aCarregar}
        erro={lista.erro}
        vazio={!lista.dados?.itens.length}
        textoVazio="Ainda não há melhorias propostas."
      >
        <ul className="flex flex-col">
          {lista.dados?.itens.map((m) => (
            <li key={m.id} className="border-t border-linha">
              <button
                type="button"
                onClick={() => setAberta(m)}
                className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:bg-creme/60"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-tinta">{m.titulo}</span>
                  <span className="text-xs text-tinta-2">
                    {m.perguntas} {m.perguntas === 1 ? "pergunta" : "perguntas"} · {numero(m.vezes)}×
                    {m.entidade ? ` · ${m.entidade}` : ""}
                  </span>
                </span>
                <Pilula tom={ESTADOS[m.estado].tom}>{ESTADOS[m.estado].rotulo}</Pilula>
              </button>
            </li>
          ))}
        </ul>
        {mais.haMais && (
          <Botao variante="discreto" tamanho="pequeno" onClick={mais.mais} disabled={mais.aCorrer} className="w-fit">
            Ver mais
          </Botao>
        )}
      </Estado>

      <Dialogo titulo={aberta?.titulo ?? ""} aberto={!!aberta} onFechar={() => setAberta(null)} largura="max-w-2xl">
        {aberta && (
          <Detalhe
            id={aberta.id}
            onMudou={() => {
              lista.recarregar();
              resumo.recarregar();
            }}
          />
        )}
      </Dialogo>
    </Cartao>
  );
}
