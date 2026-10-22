"use client";

import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Botao } from "@/components/ui/botao";
import { Logo } from "@/components/ui/marca";
import {
  Cartao,
  ErroLinha,
  Estado,
  euros,
  numero,
  pct,
  quando,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { useSessao } from "@/lib/sessao";
import { TIPOS } from "./lista";
import type { DadosDiario, DadosPeriodo, Indicador, Relatorio } from "./tipos";
import { mesDe, periodoCurto, periodoPorExtenso } from "./util";

const FASES: Record<string, string> = {
  entrada: "Entrada até documentos completos",
  documentos: "À espera de documentos",
  apreciacao: "Apreciação técnica",
  pareceres_externos: "Pareceres de outras entidades",
  decisao: "Decisão",
  notificado: "Aviso ao munícipe",
};

const TRABALHO: Record<string, string> = {
  requerimentos: "requerimentos preenchidos",
  ocorrencias_agente: "ocorrências registadas",
  consultas_processo: "consultas ao estado de processos",
  referencias_mb: "referências Multibanco",
  marcacoes: "marcações",
  recolhas: "recolhas de monos",
  passagens: "passagens a um funcionário",
};

const ESTADO_PSR: Record<string, { texto: string; cor: string }> = {
  resolvida: { texto: "Já responde.", cor: "bg-verde" },
  com_equipa: { texto: "A equipa Tou, Câmara? está a tratar.", cor: "bg-ambar" },
  espera_camara: { texto: "À espera de informação da câmara.", cor: "bg-terracota" },
  nova: { texto: "Ainda sem resposta.", cor: "bg-terracota" },
  fora_ambito: { texto: "Fora do âmbito do agente.", cor: "bg-tinta-3" },
};

const valor = (x: number | Indicador): number | null => (typeof x === "number" ? x : x.valor);

function variacao(i: Indicador): string | null {
  if (i.variacao === null) return null;
  const s = i.variacao > 0 ? "+" : "";
  return i.unidade === "pct"
    ? `${s}${numero(i.variacao, 1)} p.p. face ao período anterior`
    : `${s}${numero(i.variacao, 1)}% face ao período anterior`;
}

function Numero({ v, rotulo, i, destaque }: { v: string; rotulo: string; i?: Indicador; destaque?: boolean }) {
  const varia = i ? variacao(i) : null;
  return (
    <div className="flex flex-col gap-1 border-l border-linha px-4 first:border-l-0 first:pl-0">
      <span className={`font-display text-[28px] font-bold ${destaque ? "text-terracota" : "text-tinta"}`}>{v}</span>
      <span className="text-[11px] text-tinta-2">{rotulo}</span>
      {varia && <span className="text-[10px] text-tinta-3">{varia}</span>}
    </div>
  );
}

function Barras({ titulo, linhas }: { titulo: string; linhas: { rotulo: string; valor: number; texto?: string }[] }) {
  const max = Math.max(1, ...linhas.map((l) => l.valor));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-bold tracking-[0.4px] text-tinta-3 uppercase">{titulo}</p>
      {linhas.length ? (
        linhas.map((l) => (
          <div key={l.rotulo} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-xs">
              <span className="text-tinta">{l.rotulo}</span>
              <span className="font-bold text-tinta">{l.texto ?? numero(l.valor)}</span>
            </div>
            <span className="h-[7px] overflow-hidden rounded bg-creme-2" aria-hidden>
              <span className="block h-full rounded bg-terracota" style={{ width: `${(l.valor / max) * 100}%` }} />
            </span>
          </div>
        ))
      ) : (
        <p className="text-xs text-tinta-3">Sem dados no período.</p>
      )}
    </div>
  );
}

function Itens({ titulo, itens }: { titulo: string; itens: { titulo: string; texto: string; cor: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-bold tracking-[0.4px] text-tinta-3 uppercase">{titulo}</p>
      {itens.length ? (
        itens.map((x, i) => (
          <div key={i} className="flex gap-2.5">
            <span className={`mt-0.5 size-[18px] shrink-0 rounded-full ${x.cor}`} aria-hidden />
            <div className="flex min-w-0 flex-col gap-px">
              <span className="text-xs font-bold text-tinta">{x.titulo}</span>
              <span className="text-[11px] text-tinta-2">{x.texto}</span>
            </div>
          </div>
        ))
      ) : (
        <p className="text-xs text-tinta-3">Nada a assinalar.</p>
      )}
    </div>
  );
}

function Folha({
  cabecalho,
  meta,
  eyebrow,
  titulo,
  children,
  rodape,
}: {
  cabecalho: string;
  meta: string;
  eyebrow: string;
  titulo: string;
  children: React.ReactNode;
  rodape: string;
}) {
  return (
    <article className="mx-auto flex w-full max-w-[900px] flex-col gap-[26px] rounded-sm bg-[#FFFDF8] px-8 py-10 shadow-[0_2px_24px_rgba(21,38,59,0.08)] md:px-16 md:py-14">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-linha pb-[18px]">
        <Logo tamanho={18} />
        <div className="flex flex-col gap-0.5 text-right">
          <p className="text-[11px] font-bold tracking-[0.4px] text-tinta-3 uppercase">{cabecalho}</p>
          <p className="text-xs text-tinta-2">{meta}</p>
        </div>
      </header>
      <div className="flex flex-col gap-2.5">
        <p className="text-[10px] font-bold tracking-[0.6px] text-terracota uppercase">{eyebrow}</p>
        <h1 className="font-display text-[32px] leading-tight font-bold text-tinta">{titulo}</h1>
      </div>
      {children}
      <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-linha pt-3.5 text-[10px] text-tinta-3">
        <span>{rodape}</span>
        <span>Tou, Câmara?</span>
      </footer>
    </article>
  );
}

function RelatorioPeriodo({ r, d }: { r: Relatorio; d: DadosPeriodo }) {
  const t = d.totais;
  const de = d.periodo.de;
  const ate = d.periodo.ate;
  const meta = `Gerado ${quando(r.gerado_em)}${r.enviado_em ? ` · enviado ${quando(r.enviado_em)}` : ""}`;
  const rodape = `Gerado a partir das conversas, ocorrências e processos · Dados de ${periodoPorExtenso(de, ate)}`;
  const temas = d.top_temas.slice(0, 5).map((x) => ({ rotulo: x.tema, valor: x.total }));

  if (d.tipo === "executivo") {
    const fases = d.processos.por_fase
      .filter((f) => f.dias_medios_na_fase !== null)
      .sort((a, b) => (b.dias_medios_na_fase ?? 0) - (a.dias_medios_na_fase ?? 0));
    const pior = fases[0];
    const trabalho = Object.entries(d.trabalho_feito)
      .map(([k, x]) => ({ k, v: valor(x) ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 4);
    return (
      <Folha
        cabecalho={`Relatório para o executivo · ${periodoCurto(de, ate)}`}
        meta={meta}
        eyebrow={`Processos e atendimento · ${d.municipio.nome}`}
        titulo={`${numero(d.processos.em_curso)} processos em curso, ${numero(d.processos.atrasados)} atrasados. ${pct(t.resolvidas_sem_humano_pct.valor)} das conversas resolvidas sem funcionário.`}
        rodape={rodape}
      >
        <div className="grid grid-cols-2 gap-y-4 border-y border-linha py-4 md:grid-cols-4">
          <Numero destaque v={numero(d.processos.em_curso)} rotulo="processos em curso" />
          <Numero v={numero(d.processos.atrasados)} rotulo="processos atrasados" />
          <Numero v={pct(t.resolvidas_sem_humano_pct.valor)} rotulo="resolvidas sem funcionário" i={t.resolvidas_sem_humano_pct} />
          <Numero
            v={d.ocorrencias.tempo_medio_resolucao_h.valor === null ? "—" : `${numero(d.ocorrencias.tempo_medio_resolucao_h.valor, 1)} h`}
            rotulo="para resolver uma ocorrência"
            i={d.ocorrencias.tempo_medio_resolucao_h}
          />
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          <Barras
            titulo="Onde os processos param (dias)"
            linhas={fases.map((f) => ({ rotulo: FASES[f.fase] ?? f.fase, valor: f.dias_medios_na_fase ?? 0, texto: numero(f.dias_medios_na_fase, 1) }))}
          />
          <Itens
            titulo="O que o agente tratou"
            itens={trabalho.map((x) => ({ titulo: `${numero(x.v)} ${TRABALHO[x.k] ?? x.k}`, texto: "", cor: "bg-tinta" }))}
          />
        </div>
        {pior && (
          <section className="flex flex-col gap-1.5 rounded-xl bg-terracota-suave p-[18px]">
            <p className="text-[10px] font-bold tracking-[0.4px] text-terracota-escuro uppercase">A leitura do período</p>
            <p className="text-[13px] text-tinta">
              Onde os processos ficam mais tempo é em «{FASES[pior.fase] ?? pior.fase}»: {numero(pior.dias_medios_na_fase, 1)} dias em média,
              com {numero(pior.atrasados)} {pior.atrasados === 1 ? "processo atrasado" : "processos atrasados"} nesta fase.
            </p>
          </section>
        )}
      </Folha>
    );
  }

  if (d.tipo === "semanal") {
    const mudancas = d.top_temas
      .filter((x) => x.novo || (x.variacao !== null && Math.abs(x.variacao) >= 20))
      .slice(0, 3)
      .map((x) => ({
        titulo: x.novo ? `${x.tema} (novo)` : `${x.tema} ${x.variacao! > 0 ? "+" : ""}${numero(x.variacao, 0)}%`,
        texto: `${numero(x.total)} conversas, contra ${numero(x.anterior)} na semana anterior.`,
        cor: x.novo || (x.variacao ?? 0) > 0 ? "bg-ambar" : "bg-verde",
      }));
    return (
      <Folha
        cabecalho={`Relatório semanal · ${periodoPorExtenso(de, ate)}`}
        meta={meta}
        eyebrow={`O que se passou esta semana em ${d.municipio.nome}`}
        titulo={`${numero(t.conversas.valor)} conversas, ${numero(d.ocorrencias.registadas.valor)} ocorrências e ${numero(valor(d.trabalho_feito.requerimentos))} requerimentos preenchidos.`}
        rodape={rodape}
      >
        <div className="grid grid-cols-2 gap-y-4 border-y border-linha py-4 md:grid-cols-4">
          <Numero destaque v={numero(t.conversas.valor)} rotulo="conversas por telefone e chat" i={t.conversas} />
          <Numero v={numero(d.ocorrencias.registadas.valor)} rotulo="ocorrências registadas" i={d.ocorrencias.registadas} />
          <Numero v={numero(valor(d.trabalho_feito.requerimentos))} rotulo="requerimentos preenchidos na chamada" />
          <Numero v={numero(t.sem_resposta.valor)} rotulo="perguntas sem resposta" i={t.sem_resposta} />
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          <Barras titulo="O que mais perguntaram" linhas={temas} />
          <Itens titulo="O que mudou desde a semana passada" itens={mudancas} />
        </div>
        <section className="flex flex-col gap-1.5 rounded-xl bg-ambar-suave p-[18px]">
          <p className="text-[10px] font-bold tracking-[0.4px] text-ambar uppercase">Para acompanhar esta semana</p>
          <p className="text-[13px] text-tinta">
            Há {numero(d.ocorrencias.abertas_agora)} {d.ocorrencias.abertas_agora === 1 ? "ocorrência aberta" : "ocorrências abertas"} e{" "}
            {numero(d.processos.atrasados)} {d.processos.atrasados === 1 ? "processo atrasado" : "processos atrasados"}.{" "}
            {numero(t.passadas.valor)} conversas foram passadas a um funcionário.
          </p>
        </section>
      </Folha>
    );
  }

  return (
    <Folha
      cabecalho={`Relatório mensal · ${periodoCurto(de, ate)}`}
      meta={meta}
      eyebrow={`Atendimento · ${d.municipio.nome}`}
      titulo={`Em ${mesDe(de)}, ${numero(t.conversas.valor)} conversas tiveram resposta. ${pct(t.fora_de_horas_pct.valor)} foram com o balcão fechado.`}
      rodape={rodape}
    >
      <div className="grid grid-cols-2 gap-y-4 border-y border-linha py-4 md:grid-cols-4">
        <Numero destaque v={numero(t.conversas.valor)} rotulo="conversas por telefone e chat" i={t.conversas} />
        <Numero v={pct(t.resolvidas_sem_humano_pct.valor)} rotulo="resolvidas sem funcionário" i={t.resolvidas_sem_humano_pct} />
        <Numero v={numero(t.marcacoes.valor)} rotulo="marcações no balcão certo" i={t.marcacoes} />
        <Numero v={numero(d.ocorrencias.registadas.valor)} rotulo="ocorrências registadas" i={d.ocorrencias.registadas} />
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <Barras titulo="O que mais perguntaram" linhas={temas} />
        <Itens
          titulo="Sem resposta e o que fizemos"
          itens={d.sem_resposta.slice(0, 4).map((s) => ({
            titulo: `${s.texto} (${s.vezes}×)`,
            texto: ESTADO_PSR[s.estado]?.texto ?? s.estado,
            cor: ESTADO_PSR[s.estado]?.cor ?? "bg-tinta-3",
          }))}
        />
      </div>
      <section className="flex flex-col gap-1.5 rounded-xl bg-ambar-suave p-[18px]">
        <p className="text-[10px] font-bold tracking-[0.4px] text-ambar uppercase">Ocorrências e custos</p>
        <p className="text-[13px] text-tinta">
          {numero(d.ocorrencias.resolvidas.valor)} ocorrências resolvidas
          {d.ocorrencias.tempo_medio_resolucao_h.valor !== null
            ? `, em ${numero(d.ocorrencias.tempo_medio_resolucao_h.valor, 1)} horas em média`
            : ""}
          ; {numero(d.ocorrencias.abertas_agora)} continuam abertas. Saíram {numero(d.sms.enviados)} SMS
          ({euros(d.sms.custo_cent)}).
        </p>
      </section>
    </Folha>
  );
}

function RelatorioDiario({ r, d }: { r: Relatorio; d: DadosDiario }) {
  const n = d.numeros;
  const a = d.atencao;
  return (
    <Folha
      cabecalho={`Resumo diário · ${periodoPorExtenso(d.periodo.de, d.periodo.ate)}`}
      meta={`Gerado ${quando(r.gerado_em)}${r.enviado_em ? ` · enviado ${quando(r.enviado_em)}` : ""}`}
      eyebrow={`As últimas 24 horas em ${d.municipio.nome}`}
      titulo={`${numero(n.conversas)} conversas, ${pct(n.resolvidas_sem_humano_pct)} resolvidas sem funcionário.`}
      rodape={`Das ${quando(d.janela.de)} às ${quando(d.janela.ate)}`}
    >
      {d.abertura && <p className="font-serif text-[17px] leading-relaxed text-tinta">{d.abertura.texto}</p>}
      <div className="grid grid-cols-2 gap-y-4 border-y border-linha py-4 md:grid-cols-4">
        <Numero destaque v={numero(n.conversas)} rotulo={`${numero(n.chamadas)} chamadas e ${numero(n.escritas)} escritas`} />
        <Numero v={numero(n.passadas)} rotulo="passadas a um funcionário" />
        <Numero v={numero(n.ocorrencias_novas)} rotulo={`ocorrências novas (${numero(n.ocorrencias_resolvidas)} resolvidas)`} />
        <Numero v={numero(n.requerimentos_novos + n.processos_novos)} rotulo="requerimentos e processos novos" />
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <Barras
          titulo="O mais pedido"
          linhas={d.mais_pedidos.map((t) => ({
            rotulo: t.subiu_muito ? `${t.tema} ↑` : t.tema,
            valor: t.total,
          }))}
        />
        <Itens
          titulo="Reclamações"
          itens={[
            ...d.reclamacoes.por_tema.map((x) => ({ titulo: `${x.tema} (${x.total})`, texto: "conversas e emails de reclamação", cor: "bg-ambar" })),
            ...d.reclamacoes.ocorrencias_repetidas.map((x) => ({
              titulo: `${x.categoria} · ${x.zona} (${x.repetidas}×)`,
              texto: `O mesmo problema reportado várias vezes: ${x.ocorrencias.join(", ")}`,
              cor: "bg-terracota",
            })),
          ]}
        />
      </div>
      {(a.emergencias.total > 0 || a.passagens.atrasadas > 0 || a.processos_prazo_hoje.total > 0 || a.picos.length > 0) && (
        <section className="flex flex-col gap-1.5 rounded-xl bg-ambar-suave p-[18px] text-[13px] text-tinta">
          <p className="text-[10px] font-bold tracking-[0.4px] text-ambar uppercase">Atenção</p>
          {a.emergencias.total > 0 && <p>{numero(a.emergencias.total)} emergências encaminhadas para o 112.</p>}
          {a.passagens.total > 0 && (
            <p>
              {numero(a.passagens.total)} passagens por responder
              {a.passagens.atrasadas ? `, ${numero(a.passagens.atrasadas)} fora do prazo` : ""}.
            </p>
          )}
          {a.processos_prazo_hoje.total > 0 && (
            <p>
              Prazo hoje: {a.processos_prazo_hoje.itens.map((p) => `${p.numero}${p.tecnico ? ` (${p.tecnico})` : ""}`).join(", ")}.
            </p>
          )}
          {a.picos.length > 0 && <p>Subiram muito: {a.picos.map((p) => p.tema).join(", ")}.</p>}
        </section>
      )}
      {d.citacoes.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <p className="text-[10px] font-bold tracking-[0.4px] text-tinta-3 uppercase">O que disseram</p>
          {d.citacoes.map((c, i) => (
            <blockquote key={i} className="border-l-2 border-terracota pl-3 font-serif text-sm text-tinta">
              “{c.texto}”{c.tema && <span className="ml-1 font-sans text-[11px] text-tinta-3">· {c.tema}</span>}
            </blockquote>
          ))}
        </section>
      )}
    </Folha>
  );
}

export function DetalheRelatorio() {
  const { pedido, pode } = useSessao();
  const { id } = useParams<{ id: string }>();
  const ver = pode("indicadores");
  const r = useDados<Relatorio>(ver && id ? `/v1/painel/relatorios/${id}` : null);
  const pdf = useAcao();

  if (!ver) return <div className="pt-8"><SemAcesso /></div>;
  const dados = r.dados;
  return (
    <div className="flex flex-col gap-5 px-4 sm:px-10 pt-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/painel/relatorios" className="flex items-center gap-1.5 text-sm font-semibold text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          Relatórios
        </Link>
        {dados && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-tinta-3">{TIPOS[dados.tipo]?.rotulo}</span>
            <Botao
              icone={Download}
              disabled={!dados.tem_pdf || pdf.aCorrer}
              title={dados.tem_pdf ? undefined : "Este relatório não tem PDF guardado"}
              onClick={async () => {
                const x = await pdf.executar(() => pedido<{ url: string }>(`/v1/painel/relatorios/${dados.id}/pdf`));
                if (x) window.open(x.url, "_blank", "noopener");
              }}
            >
              Descarregar PDF
            </Botao>
          </div>
        )}
      </div>
      <ErroLinha erro={pdf.erro} />
      {!dados ? (
        <Cartao>
          <Estado aCarregar={r.aCarregar} erro={r.erro} />
        </Cartao>
      ) : dados.dados.tipo === "diario" ? (
        <RelatorioDiario r={dados} d={dados.dados as DadosDiario} />
      ) : (
        <RelatorioPeriodo r={dados} d={dados.dados as DadosPeriodo} />
      )}
    </div>
  );
}
