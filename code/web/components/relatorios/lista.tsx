"use client";

import { ChevronRight, FileText, Mail, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  SemAcesso,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { useSessao } from "@/lib/sessao";
import type { Relatorio, RelatorioResumo, TipoRelatorio } from "./tipos";
import { periodoPorExtenso } from "./util";

export const TIPOS: Record<TipoRelatorio, { rotulo: string; descricao: string }> = {
  semanal: { rotulo: "Semanal", descricao: "Enviado sozinho à segunda, 8h, à presidência, vereação e chefias." },
  mensal: { rotulo: "Mensal", descricao: "O mês inteiro, para a reunião com a vereação." },
  executivo: { rotulo: "Para o executivo", descricao: "Processos e atendimento, para a reunião de câmara." },
  diario: { rotulo: "Resumo diário", descricao: "As últimas 24 horas, em poucas linhas." },
};

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Gerar({ onGerado }: { onGerado: (r: Relatorio) => void }) {
  const { pedido } = useSessao();
  const [tipo, setTipo] = useState<TipoRelatorio>("mensal");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState(hoje());
  const [ateDiario, setAteDiario] = useState("");
  const [enviar, setEnviar] = useState(false);
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const corpo =
          tipo === "diario"
            ? { tipo, enviar, ...(ateDiario ? { ate: new Date(ateDiario).toISOString() } : {}) }
            : { tipo, de, ate, enviar };
        const r = await acao.executar(() => pedido<Relatorio>("/v1/painel/relatorios/gerar", { corpo }));
        if (r) onGerado(r);
      }}
    >
      <Campo rotulo="Tipo" ajuda={TIPOS[tipo].descricao}>
        <select className={classeEntrada} value={tipo} onChange={(e) => setTipo(e.target.value as TipoRelatorio)}>
          {(Object.keys(TIPOS) as TipoRelatorio[]).map((t) => (
            <option key={t} value={t}>
              {TIPOS[t].rotulo}
            </option>
          ))}
        </select>
      </Campo>
      {tipo === "diario" ? (
        <Campo rotulo="As 24 horas até (opcional; por omissão, agora)">
          <input type="datetime-local" className={classeEntrada} value={ateDiario} onChange={(e) => setAteDiario(e.target.value)} />
        </Campo>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="De">
            <input type="date" required className={classeEntrada} value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
          </Campo>
          <Campo rotulo="Até">
            <input type="date" required className={classeEntrada} value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
          </Campo>
        </div>
      )}
      <label className="flex items-center gap-2 text-[13px] text-tinta">
        <input type="checkbox" className="accent-terracota" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} />
        Enviar também por email a quem o recebe
      </label>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={FileText} disabled={acao.aCorrer}>
          {acao.aCorrer ? "A gerar…" : "Gerar relatório"}
        </Botao>
      </div>
    </form>
  );
}

export function ListaRelatorios() {
  const { pode } = useSessao();
  const router = useRouter();
  const [tipo, setTipo] = useState<"" | TipoRelatorio>("");
  const [gerar, setGerar] = useState(false);
  const ver = pode("indicadores");
  const base = ver ? `/v1/painel/relatorios?limite=30${tipo ? `&tipo=${tipo}` : ""}` : null;
  const lista = useDados<Pagina<RelatorioResumo>>(base);
  const mais = useMais(base, lista);

  if (!ver) {
    return (
      <>
        <CabecalhoPagina titulo="Relatórios" />
        <SemAcesso />
      </>
    );
  }
  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Gestão", "Relatórios"]}
        titulo="Relatórios"
        descricao="Semanais e mensais, feitos sozinhos a partir das conversas, ocorrências e processos."
        acoes={
          <Botao icone={Plus} onClick={() => setGerar(true)}>
            Gerar relatório
          </Botao>
        }
      />
      <div className="flex flex-col gap-4 px-10">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo">
          {(["", "semanal", "mensal", "executivo", "diario"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => setTipo(t)}
              className={`rounded-[14px] border px-3 py-1.5 text-xs font-semibold ${
                tipo === t ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta-2"
              }`}
            >
              {t ? TIPOS[t].rotulo : "Todos"}
            </button>
          ))}
        </div>
        <Cartao className="overflow-hidden">
          <Estado
            aCarregar={lista.aCarregar}
            erro={lista.erro}
            vazio={!lista.dados?.itens.length}
            textoVazio="Ainda não há relatórios deste tipo. O semanal sai à segunda e o mensal no dia 1."
          >
            <ul>
              {lista.dados?.itens.map((r) => (
                <li key={r.id} className="border-b border-linha last:border-b-0">
                  <Link href={`/painel/relatorios/${r.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-creme/60">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-creme">
                      <FileText className="size-5 text-terracota" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-semibold text-tinta">
                        {TIPOS[r.tipo]?.rotulo ?? r.tipo} · {periodoPorExtenso(r.de, r.ate)}
                      </span>
                      <span className="text-xs text-tinta-3">Gerado {quando(r.gerado_em)}</span>
                    </span>
                    {r.enviado_em && (
                      <Pilula tom="verde" icone={Mail}>
                        Enviado {quando(r.enviado_em)}
                      </Pilula>
                    )}
                    {!r.tem_pdf && <Pilula>sem PDF</Pilula>}
                    <ChevronRight className="size-4 text-tinta-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            {mais.haMais && (
              <div className="border-t border-linha p-3">
                <Botao variante="discreto" tamanho="pequeno" onClick={mais.mais} disabled={mais.aCorrer}>
                  Ver mais
                </Botao>
              </div>
            )}
          </Estado>
        </Cartao>
      </div>
      <Dialogo titulo="Gerar relatório" aberto={gerar} onFechar={() => setGerar(false)}>
        <Gerar onGerado={(r) => router.push(`/painel/relatorios/${r.id}`)} />
      </Dialogo>
    </div>
  );
}
