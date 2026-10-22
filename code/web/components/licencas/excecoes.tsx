"use client";

import { ExternalLink, Gauge } from "lucide-react";
import {
  Cartao,
  ErroLinha,
  Interruptor,
  numero,
  Pilula,
  Rotulo,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { BASE_MINIMA } from "@/components/atendimento/formatos";
import { useSessao } from "@/lib/sessao";

/*
 * "Os humanos só tratam das exceções": nos últimos 30 dias, quanto se
 * decidiu sozinho e quanto foi exceção (e porquê), por tipo. A chefia
 * escolhe aqui, por tipo, se os pedidos dentro das regras se decidem
 * sozinhos ou se um funcionário confirma (fica no histórico público e na
 * auditoria).
 */

interface Bloco {
  total: number;
  automatica: number;
  excecao: number;
  funcionario: number;
  pct_automatica: number | null;
  pct_excecao: number | null;
}

interface Indicador extends Bloco {
  dias: number;
  por_tipo: (Bloco & {
    tipo: string;
    nome: string;
    aprovacao: "automatica" | "funcionario";
    motivos: { tipo: "regra" | "dado_em_falta"; id: string; rotulo: string; n: number }[];
  })[];
}

/** "33%" só com pedidos suficientes; com poucos, "1 de 3" (a percentagem engana). */
function parte(n: number, total: number, pct: number | null): string {
  if (!total || pct === null) return "—";
  return total < BASE_MINIMA ? `${numero(n)} de ${numero(total)}` : `${pct}%`;
}

/** A barra: verde = sozinho, âmbar = exceções, cinzento = funcionário por escolha. */
function Barra({ b }: { b: Bloco }) {
  if (!b.total) return <div className="h-2 w-full rounded-full bg-creme-2" aria-hidden />;
  const p = (n: number) => `${(n / b.total) * 100}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-creme-2" aria-hidden>
      <span className="bg-verde" style={{ width: p(b.automatica) }} />
      <span className="bg-ambar" style={{ width: p(b.excecao) }} />
      <span className="bg-tinta-3" style={{ width: p(b.funcionario) }} />
    </div>
  );
}

export function IndicadorExcecoes({ onMudou }: { onMudou?: () => void }) {
  const { pedido, pode } = useSessao();
  const d = useDados<Indicador>("/v1/painel/licencas/indicador?dias=30");
  const acao = useAcao();
  const i = d.dados;

  const mudar = async (tipo: string, automatica: boolean) => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/licencas/aprovacao/${tipo}`, {
        metodo: "PUT",
        corpo: { aprovacao: automatica ? "automatica" : "funcionario" },
      }),
    );
    if (r !== undefined) {
      d.recarregar();
      onMudou?.();
    }
  };

  return (
    <Cartao className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-terracota" aria-hidden />
          <Rotulo>Os humanos só tratam das exceções · últimos 30 dias</Rotulo>
        </div>
        <a
          href="/regras"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-terracota"
        >
          <ExternalLink className="size-3.5" aria-hidden /> regras públicas
        </a>
      </div>
      {!i ? (
        <p className="text-sm text-tinta-3">{d.erro ? d.erro.message : "A carregar…"}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="font-display text-3xl font-bold text-tinta">
                {parte(i.automatica, i.total, i.pct_automatica)}
              </p>
              <p className="text-xs text-tinta-3">decidido automaticamente</p>
            </div>
            <div>
              <p className="font-display text-3xl font-bold text-ambar">
                {parte(i.excecao, i.total, i.pct_excecao)}
              </p>
              <p className="text-xs text-tinta-3">exceções (foram a uma pessoa)</p>
            </div>
            <p className="text-xs text-tinta-3">
              {numero(i.total)} pedidos · {numero(i.automatica)} sozinhos · {numero(i.excecao)} exceções
              {i.funcionario ? ` · ${numero(i.funcionario)} confirmados por escolha da câmara` : ""}
            </p>
          </div>
          <Barra b={i} />
          <ul className="flex flex-col divide-y divide-linha">
            {i.por_tipo.map((t) => (
              <li key={t.tipo} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-tinta">{t.nome}</span>
                  <label className="flex items-center gap-2 text-xs text-tinta-2">
                    {t.aprovacao === "automatica" ? "decide sozinho dentro das regras" : "um funcionário confirma"}
                    <Interruptor
                      ligado={t.aprovacao === "automatica"}
                      desativado={!pode("agente") || acao.aCorrer}
                      onMudar={(v) => void mudar(t.tipo, v)}
                      rotulo={`${t.nome}: decidir sozinho os pedidos dentro das regras`}
                    />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <Barra b={t} />
                  <span className="w-28 shrink-0 text-right text-xs text-tinta-3">
                    {!t.total
                      ? "sem pedidos"
                      : t.total < BASE_MINIMA
                        ? `${numero(t.automatica)} de ${numero(t.total)} sozinhos`
                        : `${t.pct_automatica}% sozinho · ${numero(t.total)}`}
                  </span>
                </div>
                {t.motivos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.motivos.slice(0, 5).map((m) => (
                      <Pilula key={`${m.tipo}:${m.id}`} tom={m.tipo === "regra" ? "ambar" : "neutro"}>
                        {m.tipo === "dado_em_falta" ? `falta: ${m.rotulo.toLowerCase()}` : m.rotulo} · {m.n}
                      </Pilula>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <ErroLinha erro={acao.erro} />
          <p className="text-xs text-tinta-3">
            Nada que falhe uma regra é aprovado sozinho. Mudar aqui fica no histórico público das regras e no registo
            de acessos.
          </p>
        </>
      )}
    </Cartao>
  );
}
