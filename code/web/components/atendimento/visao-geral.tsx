"use client";

import {
  CalendarCheck,
  ChevronRight,
  CreditCard,
  FilePenLine,
  FolderSearch,
  MapPin,
  MessagesSquare,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { useDados, useFuso } from "./dados";
import {
  hojeNoFuso,
  MOTIVOS_PASSAGEM,
  mensagemErro,
  numero,
  pct,
  quando,
} from "./formatos";
import {
  BarrasPorHora,
  horaDePico,
  ListaTemas,
  porHora,
  textoHorarioBalcao,
} from "./graficos";
import { ChavePeriodo, chaveValida, periodoDe, SeletorPeriodo } from "./periodo";
import { PrimeiroDia } from "./primeiro-dia";
import { CartaoCustoIa } from "./custo-ia";
import { CartaoQualidade } from "./qualidade";
import { CartaoSatisfacao, type Satisfacao } from "./satisfacao";
import { BotaoRelatorio } from "./relatorio";
import { TabelaConversas } from "./tabela-conversas";
import type {
  ConversaLista,
  Pagina,
  Qualidade,
  SemRespostaItem,
  VisaoGeral as Dados,
} from "./tipos";
import { Cartao, ErroBloco, Esqueleto, Pilula, Vazio } from "./ui";

const TEXTO_PERIODO: Record<ChavePeriodo, string> = {
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  "90d": "nos últimos 90 dias",
  mes: "este mês",
  mes_passado: "no mês passado",
};

/** Painel · Visão geral (frame c27hq) e o primeiro dia (j6Zytv). */
export function VisaoGeral() {
  const { pode } = useSessao();
  const fuso = useFuso();
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const chave = chaveValida(params.get("periodo"), "7d");
  const hoje = hojeNoFuso(fuso);
  const p = periodoDe(chave, hoje);

  const permitido = pode("visao_geral");
  const vg = useDados<Dados>(
    permitido ? `/v1/painel/visao-geral?de=${p.de}&ate=${p.ate}` : null,
  );
  const ultimas = useDados<Pagina<ConversaLista>>(
    permitido && pode("conversas") ? "/v1/painel/conversas?limite=5" : null,
  );
  const satisfacao = useDados<Satisfacao>(
    permitido ? `/v1/painel/satisfacao?de=${p.de}&ate=${p.ate}` : null,
  );
  const qualidade = useDados<Qualidade>(
    permitido && pode("conhecimento_ver") ? "/v1/painel/conhecimento/qualidade" : null,
  );

  if (!permitido) {
    return (
      <>
        <CabecalhoPagina migalhas={["Atendimento"]} titulo="Visão geral" />
        <Aviso titulo="Sem acesso">
          O seu perfil não tem acesso à visão geral do atendimento.
        </Aviso>
      </>
    );
  }

  const mudarPeriodo = (v: ChavePeriodo) => {
    const q = new URLSearchParams(params.toString());
    if (v === "7d") q.delete("periodo");
    else q.set("periodo", v);
    const s = q.toString();
    router.replace(s ? `${caminho}?${s}` : caminho, { scroll: false });
  };

  const d = vg.dados;
  const semNenhuma =
    d &&
    d.indicadores.conversas.valor === 0 &&
    !d.indicadores.conversas.anterior &&
    (ultimas.dados ? ultimas.dados.itens.length === 0 : chave === "7d");

  if (semNenhuma && (!pode("conversas") || ultimas.dados)) {
    return <PrimeiroDia qualidade={qualidade.dados} />;
  }

  return (
    <div className="pb-12">
      <CabecalhoPagina
        migalhas={["Atendimento", chave === "7d" ? "Esta semana" : "Período"]}
        titulo="Visão geral"
        acoes={
          <>
            <SeletorPeriodo valor={chave} hoje={hoje} mudar={mudarPeriodo} />
            <BotaoRelatorio
              tipo={chave === "7d" ? "semanal" : "mensal"}
              de={p.de}
              ate={p.ate}
              rotulo="Relatório para o vereador"
            />
          </>
        }
      />

      <div className="flex flex-col gap-8 px-4 sm:px-10">
        {vg.erro && <ErroBloco mensagem={vg.erro} tentar={vg.recarregar} />}
        {!d && !vg.erro && (
          <>
            <Esqueleto className="h-36" />
            <Esqueleto className="h-44" />
            <Esqueleto className="h-80" />
          </>
        )}

        {d && (
          <>
            <Resumo dados={d} chave={chave} />
            <Atencao dados={d} />
            <Trabalho dados={d} />

            <div className="flex flex-col gap-6 xl:flex-row">
              <Procura dados={d} chave={chave} />
              {pode("conhecimento_ver") && (
                <CartaoQualidade dados={qualidade.dados} erro={qualidade.erro} />
              )}
            </div>

            <CartaoSatisfacao
              dados={satisfacao.dados}
              erro={satisfacao.erro}
              tentar={satisfacao.recarregar}
            />

            <div className="flex flex-col gap-6 xl:flex-row">
              <Cartao
                id="temas"
                titulo="O que mais perguntam"
                sub="Por tema, com a variação face ao período anterior"
                className="flex-1"
              >
                {d.o_que_perguntam.length ? (
                  <ListaTemas temas={d.o_que_perguntam} />
                ) : (
                  <Vazio titulo="Ainda sem temas neste período." />
                )}
              </Cartao>
              <SemResposta
                itens={d.atencao.sem_resposta.itens}
                total={d.atencao.sem_resposta.total ?? d.atencao.sem_resposta.itens.length}
              />
            </div>

            {pode("indicadores") && <CartaoCustoIa de={p.de} ate={p.ate} />}
          </>
        )}

        {pode("conversas") && (
          <Cartao
            id="ultimas"
            titulo="Últimas conversas"
            sub="Cada conversa resumida, com o que foi respondido"
            acao={
              <Link
                href="/painel/conversas"
                className="shrink-0 text-[13px] font-semibold text-terracota-escuro hover:underline"
              >
                {d?.indicadores.conversas.valor
                  ? `Ver as ${numero(d.indicadores.conversas.valor)}`
                  : "Ver todas"}
              </Link>
            }
            className="pb-2"
          >
            {ultimas.erro && (
              <ErroBloco mensagem={ultimas.erro} tentar={ultimas.recarregar} />
            )}
            {!ultimas.dados && !ultimas.erro && <Esqueleto className="h-64" />}
            {ultimas.dados &&
              (ultimas.dados.itens.length ? (
                <TabelaConversas itens={ultimas.dados.itens} />
              ) : (
                <Vazio icone={MessagesSquare} titulo="Ainda não há conversas." />
              ))}
          </Cartao>
        )}
      </div>
    </div>
  );
}

function Resumo({ dados, chave }: { dados: Dados; chave: ChavePeriodo }) {
  const i = dados.indicadores;
  const n = i.conversas.valor ?? 0;
  const fora = i.fora_de_horas_pct.valor;
  const v = i.conversas.variacao;
  const comparacao =
    v === null
      ? "Ainda não há dados do período anterior para comparar."
      : v === 0
        ? "Tantas como no período anterior."
        : `${v > 0 ? "Mais" : "Menos"} ${Math.abs(Math.round(v))}% do que no período anterior.`;

  const numeros: { rotulo: string; valor: string; cor: string }[] = [
    {
      rotulo: "resolvidas sem funcionário",
      valor: pct(i.resolvidas_sem_humano_pct.valor),
      cor: "text-verde",
    },
    { rotulo: "passadas a funcionário", valor: numero(i.passadas.valor), cor: "text-tinta" },
    { rotulo: "marcações no balcão", valor: numero(i.marcacoes.valor), cor: "text-tinta" },
    { rotulo: "sem resposta", valor: numero(i.sem_resposta.valor), cor: "text-ambar" },
  ];

  return (
    <section
      aria-label="Resumo do período"
      className="flex flex-col gap-8 border-b border-linha pb-8 pt-2 xl:flex-row xl:items-end xl:gap-12"
    >
      <div className="flex flex-1 flex-col gap-3">
        <p className="font-display text-[30px] font-bold leading-[1.08] tracking-[-1.2px] text-tinta sm:text-[40px]">
          {numero(n)} {n === 1 ? "conversa atendida" : "conversas atendidas"}{" "}
          {TEXTO_PERIODO[chave]}.
          {fora !== null && n > 0 && <> {pct(fora)} com o balcão fechado.</>}
        </p>
        <p className="text-[15px] text-tinta-2">{comparacao}</p>
      </div>
      {/* Telemóvel: 2 × 2; a partir de `sm`, os quatro lado a lado. */}
      <dl className="grid grid-cols-2 gap-y-5 sm:flex sm:shrink-0">
        {numeros.map((x, k) => (
          <div
            key={x.rotulo}
            className={`flex flex-col-reverse gap-1 px-5 sm:w-[132px] ${
              k === 0
                ? "pl-0 xl:pl-5"
                : k === 2
                  ? "pl-0 sm:border-l sm:border-linha sm:pl-5"
                  : "border-l border-linha"
            }`}
          >
            <dt className="text-xs leading-[1.35] text-tinta-2">{x.rotulo}</dt>
            <dd
              className={`font-display text-[32px] font-bold tracking-[-0.8px] ${x.cor}`}
            >
              {x.valor}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** O que precisa de atenção agora (passagens, ocorrências novas, prazos). */
function Atencao({ dados }: { dados: Dados }) {
  const fuso = useFuso();
  const { passagens, ocorrencias_novas, prazos_a_acabar } = dados.atencao;
  if (!passagens.total && !ocorrencias_novas.total && !prazos_a_acabar.itens.length) {
    return null;
  }
  const colunas = [
    passagens.total > 0 && (
      <div key="p" className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-tinta">
          Passagens a funcionário
          <Pilula tom="terracota">{passagens.total}</Pilula>
          {passagens.atrasadas > 0 && (
            <Pilula tom="ambar">
              {passagens.atrasadas} {passagens.atrasadas === 1 ? "atrasada" : "atrasadas"}
            </Pilula>
          )}
        </h3>
        <ul className="flex flex-col">
          {passagens.itens.slice(0, 3).map((x) => (
            <li key={x.id} className="border-t border-linha first:border-t-0">
              <Link
                href={`/painel/passagens/${x.id}`}
                className="flex items-center gap-2 py-2 hover:text-terracota-escuro"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-tinta">
                    {x.resumo}
                  </span>
                  <span className="text-xs text-tinta-3">
                    {MOTIVOS_PASSAGEM[x.motivo] ?? x.motivo} ·{" "}
                    {x.atribuida_a_nome ?? "por pegar"} · {quando(x.criada_em, fuso)}
                  </span>
                </span>
                {x.atrasada && <Pilula tom="ambar">atrasada</Pilula>}
                <ChevronRight className="size-4 shrink-0 text-tinta-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ),
    ocorrencias_novas.total > 0 && (
      <div key="o" className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-tinta">
          Ocorrências novas
          <Pilula tom="terracota">{ocorrencias_novas.total}</Pilula>
        </h3>
        <ul className="flex flex-col">
          {ocorrencias_novas.itens.slice(0, 3).map((o) => (
            <li key={o.id} className="border-t border-linha first:border-t-0">
              <Link
                href={`/painel/ocorrencias/${o.id}`}
                className="flex items-center gap-2 py-2 hover:text-terracota-escuro"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-tinta">
                    {o.numero} · {o.categoria}
                  </span>
                  <span className="truncate text-xs text-tinta-3">{o.morada}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-tinta-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ),
    prazos_a_acabar.itens.length > 0 && (
      <div key="z" className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-tinta">
          Prazos a acabar
          <Pilula tom="ambar">{prazos_a_acabar.itens.length}</Pilula>
        </h3>
        <ul className="flex flex-col">
          {prazos_a_acabar.itens.slice(0, 3).map((x) => (
            <li key={x.id} className="border-t border-linha first:border-t-0">
              <Link
                href={`/painel/processos/${x.id}`}
                className="flex items-center gap-2 py-2 hover:text-terracota-escuro"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-tinta">
                    {x.numero} · {x.assunto}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      x.atrasado ? "text-terracota-escuro" : "text-ambar"
                    }`}
                  >
                    {textoPrazo(x.dias_uteis_restantes)}
                    <span className="font-normal text-tinta-3">
                      {" "}
                      · {x.tecnico ?? "sem técnico"}
                    </span>
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-tinta-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ),
  ].filter(Boolean);

  return (
    <Cartao id="atencao" titulo="Precisa de atenção agora">
      <div className="flex flex-col gap-6 lg:flex-row">{colunas}</div>
    </Cartao>
  );
}

export function textoPrazo(dias: number): string {
  if (dias < 0) return `passou ${-dias} ${dias === -1 ? "dia útil" : "dias úteis"}`;
  if (dias === 0) return "termina hoje";
  if (dias === 1) return "termina amanhã";
  return `termina em ${dias} dias úteis`;
}

function Trabalho({ dados }: { dados: Dados }) {
  const t = dados.trabalho_semana;
  const blocos = [
    { icone: FilePenLine, valor: t.requerimentos, rotulo: "requerimentos preenchidos na conversa" },
    { icone: MapPin, valor: t.ocorrencias_agente, rotulo: "ocorrências registadas" },
    { icone: FolderSearch, valor: t.consultas_processo, rotulo: "consultas ao estado do processo" },
    { icone: CreditCard, valor: t.referencias_mb, rotulo: "referências Multibanco enviadas" },
    { icone: CalendarCheck, valor: t.marcacoes, rotulo: "marcações, com lembrete na véspera" },
  ];
  return (
    <section
      aria-labelledby="trabalho-titulo"
      className="flex flex-col gap-3.5 rounded-2xl bg-tinta p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="trabalho-titulo" className="font-display text-xl font-bold text-white">
          O que o agente tratou esta semana
        </h2>
        <p className="text-[13px] text-white/70">
          Não só respondeu: deixou o trabalho feito.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {blocos.map(({ icone: Icone, valor, rotulo }) => (
          <li key={rotulo} className="flex flex-col gap-1.5 rounded-xl bg-white/7 p-3.5">
            <Icone className="size-[18px] text-[#E07A55]" aria-hidden />
            <span className="font-display text-[28px] font-bold text-white">
              {numero(valor)}
            </span>
            <span className="text-xs leading-[1.35] text-white/80">{rotulo}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Procura({ dados, chave }: { dados: Dados; chave: ChavePeriodo }) {
  const horario = useSessao().eu?.municipio.horario_balcao;
  const horas = porHora(dados.quando_ligam.celulas);
  const pico = horaDePico(horas);
  const total = horas.reduce((s, v) => s + v, 0);
  return (
    <Cartao
      id="procura"
      titulo="Quando ligam e escrevem"
      sub={
        <>
          Conversas por hora do dia, {TEXTO_PERIODO[chave]}.
          {pico !== null && <> O pico é às {pico}h.</>}
        </>
      }
      acao={
        <div className="flex shrink-0 items-center gap-4 self-start text-xs text-tinta-2">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-tinta-3" aria-hidden />
            Balcão aberto
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-terracota" aria-hidden />
            Balcão fechado
          </span>
        </div>
      }
      className="flex-1 gap-5"
    >
      {total ? (
        <BarrasPorHora horas={horas} horario={horario} />
      ) : (
        <Vazio titulo="Ainda sem conversas neste período." />
      )}
      <p className="sr-only">
        Horário do balcão: {textoHorarioBalcao(horario)}.
      </p>
    </Cartao>
  );
}

function SemResposta({ itens, total }: { itens: SemRespostaItem[]; total: number }) {
  const { pedido, pode } = useSessao();
  const [pedidas, setPedidas] = useState<Record<string, "a_pedir" | "pedida" | string>>({});

  async function pedir(id: string) {
    setPedidas((p) => ({ ...p, [id]: "a_pedir" }));
    try {
      await pedido(`/v1/painel/conhecimento/sem-resposta/${id}/pedir-equipa`, {
        metodo: "POST",
      });
      setPedidas((p) => ({ ...p, [id]: "pedida" }));
    } catch (e) {
      setPedidas((p) => ({ ...p, [id]: mensagemErro(e) }));
    }
  }

  return (
    <Cartao
      id="sem-resposta"
      titulo="Perguntas sem resposta"
      sub="O agente passou a funcionário porque não tinha fonte oficial"
      acao={
        total > 0 ? (
          <span className="shrink-0 rounded-xl bg-ambar-suave px-2.5 py-1 text-xs font-bold text-ambar">
            {numero(total)} por responder
          </span>
        ) : undefined
      }
      className="flex-1 gap-3"
    >
      {itens.length === 0 ? (
        <Vazio titulo="Nenhuma pergunta por responder.">
          Quando o agente não encontrar resposta numa fonte oficial, a pergunta
          aparece aqui.
        </Vazio>
      ) : (
        <ul className="flex flex-col">
          {itens.map((x) => {
            const estado = pedidas[x.id];
            const jaPedida = estado === "pedida" || x.estado === "com_equipa";
            return (
              <li
                key={x.id}
                className="flex flex-wrap items-center gap-3 border-t border-linha py-3"
              >
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[17px_17px_17px_4px] bg-ambar-suave text-xs font-bold text-ambar">
                  {x.vezes}×<span className="sr-only"> perguntada</span>
                </span>
                <span className="min-w-0 flex-1 text-sm leading-[1.4] text-tinta">
                  “{x.texto}”
                </span>
                {jaPedida ? (
                  <Pilula tom="neutro">Pedida à equipa</Pilula>
                ) : x.estado === "espera_camara" ? (
                  <Pilula tom="ambar">À espera da câmara</Pilula>
                ) : (
                  pode("conhecimento") && (
                    <button
                      type="button"
                      onClick={() => pedir(x.id)}
                      disabled={estado === "a_pedir"}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-2xl border border-tinta px-3 text-xs font-semibold text-tinta hover:bg-tinta/5 disabled:opacity-60"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      {estado === "a_pedir" ? "A pedir…" : "Pedir resposta"}
                    </button>
                  )
                )}
                {estado && estado !== "a_pedir" && estado !== "pedida" && (
                  <p role="alert" className="w-full text-xs text-terracota-escuro">
                    {estado}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}
