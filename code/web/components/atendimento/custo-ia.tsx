"use client";

import { Coins, ShieldCheck } from "lucide-react";
import { useDados } from "./dados";
import { numero } from "./formatos";
import { Cartao, ErroBloco, Esqueleto } from "./ui";

/** GET /v1/painel/uso-ia/custos */
export interface CustosIa {
  desde: string;
  ate: string;
  estimativa: boolean;
  atendimentos: number;
  ia_eur: number;
  voz_eur: number;
  voz_minutos: number;
  total_eur: number;
  por_atendimento_eur: number | null;
  instrucoes_detetadas: number;
  pedidos_minimizados: number;
  por_tarefa: { tarefa: string; pedidos: number; tokens: number; eur: number }[];
  mes: { eur: number; limite_eur: number | null };
}

/** GET /v1/painel/uso-ia/registo */
export interface UsoIaLinha {
  em: string;
  tarefa: string;
  modelo: string;
  resultado: "ok" | "erro" | "recusa" | "limite";
  eur: number;
  dados_minimizados: boolean;
  instrucoes_detetadas: number;
}

/** Os nomes das tarefas como a câmara os diz. */
export const TAREFAS: Record<string, string> = {
  chat: "Conversa no chat",
  resumo_conversa: "Resumo da conversa",
  classificar_email: "Triagem de emails",
  perguntas_painel: "Perguntas ao painel",
  propor_resposta: "Propostas de resposta",
  contradicoes: "Informação contraditória",
  agrupar_perguntas: "Perguntas sem resposta",
  proposta_melhoria: "Melhorias ao portal",
  resumo_processo: "Resumo do processo",
  escolher_regulamento: "Regras aplicáveis",
  rascunho_parecer: "Rascunho de parecer",
  ler_projeto: "Leitura do projeto",
  ler_documento: "Leitura de documentos",
  ocr_arquivo: "Arquivo digitalizado",
  metadados_arquivo: "Arquivo digitalizado",
  linguagem_simples: "Linguagem simples",
  resumo_diario: "Resumo diário",
  rascunho_reclamacao: "Respostas a reclamações",
  sugestao_passagem: "Sugestão ao funcionário",
  sugestao_ao_vivo: "Ajuda ao vivo",
  encaminhar_servico: "Encaminhamento",
  analise_concelho: "Pergunte ao concelho",
  resumo_consulta: "Consultas públicas",
  ata_reuniao: "Atas de reuniões",
  traduzir_requerimento: "Tradução de requerimentos",
  ler_carta: "Cartas",
  cartas_formais: "Cartas",
  relatorio_vistoria: "Relatórios de vistoria",
  pecas_contratacao: "Contratação pública",
  assistente_procedimentos: "Assistente de procedimentos",
  entrevista_procedimento: "Procedimentos",
  chat_ferramenta: "Conversa no chat",
};

/** Valores pequenos (cêntimos e frações) sem perder o que interessa. */
export function euros(v: number): string {
  const casas = v !== 0 && Math.abs(v) < 0.1 ? 3 : 2;
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: casas,
  }).format(v);
}

/**
 * Visão geral · "Custo por atendimento": a IA (Claude) e a voz (minutos de
 * chamada) do período, a dividir pelas conversas. É uma estimativa pelos
 * preços públicos dos fornecedores, e diz-se.
 */
export function CartaoCustoIa({ de, ate }: { de: string; ate: string }) {
  const c = useDados<CustosIa>(`/v1/painel/uso-ia/custos?desde=${de}&ate=${ate}`);
  const d = c.dados;
  const tarefas = (d?.por_tarefa ?? []).filter((t) => t.eur > 0).slice(0, 4);

  return (
    <Cartao
      id="custo-ia"
      titulo="Custo por atendimento"
      sub="IA e voz no período, a dividir pelas conversas. Estimativa pelos preços públicos dos fornecedores."
      className="flex-1"
    >
      {c.erro && <ErroBloco mensagem={c.erro} tentar={c.recarregar} />}
      {!d && !c.erro && <Esqueleto className="h-32" />}
      {d && (
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-8">
          <div className="flex shrink-0 flex-col gap-1">
            <p className="flex items-baseline gap-2 font-display text-[40px] leading-none font-bold tracking-[-1px] text-tinta">
              <Coins className="size-6 self-center text-terracota" aria-hidden />
              {d.por_atendimento_eur === null ? "—" : euros(d.por_atendimento_eur)}
            </p>
            <p className="text-[13px] text-tinta-2">
              {d.atendimentos
                ? `${numero(d.atendimentos)} ${d.atendimentos === 1 ? "atendimento" : "atendimentos"} · ${euros(d.total_eur)} no total`
                : "Ainda sem atendimentos neste período."}
            </p>
            <p className="text-[13px] text-tinta-2">
              IA {euros(d.ia_eur)} · voz {euros(d.voz_eur)}
              {d.voz_minutos ? ` (${numero(d.voz_minutos)} min)` : ""}
            </p>
            {d.mes.limite_eur !== null && (
              <p className="text-[13px] text-tinta-2">
                Este mês: {euros(d.mes.eur)} de {euros(d.mes.limite_eur)}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {tarefas.length > 0 && (
              <ul className="flex flex-col gap-1.5" aria-label="Onde se gasta">
                {tarefas.map((t) => (
                  <li key={t.tarefa} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="truncate text-tinta">{TAREFAS[t.tarefa] ?? t.tarefa}</span>
                    <span className="shrink-0 tabular-nums text-tinta-2">
                      {euros(t.eur)} · {numero(t.pedidos)} {t.pedidos === 1 ? "pedido" : "pedidos"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-2 rounded-xl bg-verde-suave px-3 py-2 text-[13px] text-verde">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {numero(d.pedidos_minimizados)}{" "}
                {d.pedidos_minimizados === 1 ? "pedido foi" : "pedidos foram"} à IA sem telefones, NIF nem emails
                {d.instrucoes_detetadas
                  ? ` · ${numero(d.instrucoes_detetadas)} ${d.instrucoes_detetadas === 1 ? "texto de fora tentou" : "textos de fora tentaram"} dar ordens à IA e foram tratados como dados`
                  : ""}
                .
              </span>
            </p>
          </div>
        </div>
      )}
    </Cartao>
  );
}

/** Ficha da conversa · onde a IA foi usada (transparência), com o custo. */
export function UsoIaDaConversa({ conversaId }: { conversaId: string }) {
  const r = useDados<UsoIaLinha[]>(
    `/v1/painel/uso-ia/registo?alvo_tipo=conversa&alvo_id=${conversaId}`,
  );
  const linhas = r.dados ?? [];
  if (!linhas.length) return null;
  const total = linhas.reduce((s, l) => s + l.eur, 0);
  return (
    <section aria-labelledby="uso-ia-titulo" className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-5">
      <h2 id="uso-ia-titulo" className="text-sm font-bold text-tinta">
        Onde a IA foi usada
      </h2>
      <ul className="flex flex-col gap-1.5">
        {linhas.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-tinta">
              {TAREFAS[l.tarefa] ?? l.tarefa}
              {l.dados_minimizados && <span className="text-tinta-2"> · sem dados pessoais</span>}
              {l.instrucoes_detetadas > 0 && <span className="text-ambar"> · texto suspeito neutralizado</span>}
              {l.resultado !== "ok" && <span className="text-terracota-escuro"> · {l.resultado}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-tinta-2">{euros(l.eur)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-tinta-2">Total desta conversa: {euros(total)} (estimativa)</p>
    </section>
  );
}
