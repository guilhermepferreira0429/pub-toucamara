"use client";

import { CircleHelp, Moon, Sun, TrendingUp, type LucideIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { BarraEmpilhada, CartaoNumero } from "./cartoes";
import { useDados, useFuso } from "./dados";
import { decimal, duracao, hojeNoFuso, mesAno, numero, pct, variacaoPct } from "./formatos";
import { balcaoAberto, horaDePico, ListaTemas, MapaCalor, porHora } from "./graficos";
import { IndicadoresProcessos } from "./gestao";
import { ChavePeriodo, chaveValida, periodoDe, ROTULOS_PERIODO, SeletorPeriodo } from "./periodo";
import { Perguntar } from "./perguntar";
import { BotaoRelatorio } from "./relatorio";
import type { Indicadores as DadosIndicadores, VisaoGeral } from "./tipos";
import { Cartao, ErroBloco, Esqueleto, Separadores, Vazio } from "./ui";

type Vista = "atendimento" | "processos";

const CORES_CANAL: Record<string, { rotulo: string; cor: string }> = {
  telefone: { rotulo: "Telefone", cor: "bg-terracota" },
  chat: { rotulo: "Chat no site", cor: "bg-tinta" },
  email: { rotulo: "Email", cor: "bg-tinta-3" },
  sms: { rotulo: "SMS", cor: "bg-ambar" },
  balcao: { rotulo: "Balcão", cor: "bg-verde" },
  whatsapp: { rotulo: "WhatsApp", cor: "bg-verde-suave" },
};

/**
 * Indicadores (frames EIEyr e XijeY numa página com separadores) com a
 * caixa "Pergunte ao painel" no topo.
 */
export function Indicadores() {
  const { pode } = useSessao();
  const fuso = useFuso();
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const vista: Vista = params.get("vista") === "processos" ? "processos" : "atendimento";
  const chave = chaveValida(params.get("periodo"), "mes");
  const hoje = hojeNoFuso(fuso);
  const p = periodoDe(chave, hoje);

  const permitido = pode("indicadores");
  const visao = useDados<VisaoGeral>(
    permitido && pode("visao_geral") ? `/v1/painel/visao-geral?de=${p.de}&ate=${p.ate}` : null,
  );
  const ind = useDados<DadosIndicadores>(
    permitido && vista === "atendimento" ? `/v1/painel/indicadores?de=${p.de}&ate=${p.ate}` : null,
  );

  if (!permitido) {
    return (
      <>
        <CabecalhoPagina migalhas={["Gestão"]} titulo="Indicadores" />
        <Aviso titulo="Sem acesso">O seu perfil não tem acesso aos indicadores.</Aviso>
      </>
    );
  }

  function mudar(m: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(m)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    router.replace(s ? `${caminho}?${s}` : caminho, { scroll: false });
  }

  const contexto =
    chave === "mes" || chave === "mes_passado" ? mesAno(p.de) : ROTULOS_PERIODO[chave];

  return (
    <div className="pb-12">
      <CabecalhoPagina
        migalhas={["Gestão", contexto]}
        titulo="Indicadores"
        acoes={
          <>
            {vista === "atendimento" && (
              <SeletorPeriodo
                valor={chave}
                hoje={hoje}
                mudar={(v: ChavePeriodo) => mudar({ periodo: v === "mes" ? null : v })}
              />
            )}
            <BotaoRelatorio
              tipo={vista === "processos" ? "executivo" : chave === "7d" ? "semanal" : "mensal"}
              de={p.de}
              ate={p.ate}
              rotulo={vista === "processos" ? "Relatório para o executivo" : "Relatório do período"}
            />
          </>
        }
      />
      <div className="flex flex-col gap-6 px-10">
        <Perguntar />

        <div className="border-b border-linha">
          <Separadores
            rotulo="Indicadores"
            valor={vista}
            mudar={(v) => mudar({ vista: v === "atendimento" ? null : v })}
            opcoes={[
              { valor: "atendimento", rotulo: "Atendimento" },
              { valor: "processos", rotulo: "Processos" },
            ]}
          />
        </div>

        {vista === "atendimento" ? (
          <Atendimento
            visao={visao}
            ind={ind}
            semVisao={!pode("visao_geral")}
          />
        ) : (
          <IndicadoresProcessos visao={visao.dados} />
        )}
      </div>
    </div>
  );
}

function Atendimento({
  visao,
  ind,
  semVisao,
}: {
  visao: ReturnType<typeof useDados<VisaoGeral>>;
  ind: ReturnType<typeof useDados<DadosIndicadores>>;
  semVisao: boolean;
}) {
  const v = visao.dados;
  const t = ind.dados?.totais;
  const i = v?.indicadores;

  const detalheConversas = i?.conversas.variacao != null
    ? `${variacaoPct(i.conversas.variacao)} face ao período anterior`
    : "sem período anterior para comparar";
  const pontos = i?.resolvidas_sem_humano_pct.variacao;
  const segundos = i?.duracao_media_s.variacao;
  const dAnterior = i?.duracao_media_s.anterior;
  const dAtual = i?.duracao_media_s.valor;

  return (
    <div className="flex flex-col gap-6">
      {ind.erro && <ErroBloco mensagem={ind.erro} tentar={ind.recarregar} />}
      {visao.erro && <ErroBloco mensagem={visao.erro} tentar={visao.recarregar} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {t ? (
          <>
            <CartaoNumero
              valor={numero(t.conversas)}
              rotulo="conversas"
              detalhe={i ? detalheConversas : null}
              corDetalhe={(i?.conversas.variacao ?? 0) > 0 ? "text-verde" : "text-tinta-2"}
            />
            <CartaoNumero
              valor={pct(t.resolvidas_sem_humano_pct)}
              rotulo="resolvidas sem funcionário"
              detalhe={
                pontos == null
                  ? null
                  : `${pontos > 0 ? "+" : pontos < 0 ? "−" : ""}${decimal(Math.abs(pontos), 1)} pontos`
              }
              corDetalhe={(pontos ?? 0) >= 0 ? "text-verde" : "text-terracota-escuro"}
            />
            <CartaoNumero
              valor={pct(t.fora_de_horas_pct)}
              rotulo="com o balcão fechado"
              detalhe={`${numero(t.fora_de_horas)} conversas fora de horas, todas atendidas`}
              corDetalhe="text-verde"
            />
            <CartaoNumero
              valor={duracao(t.duracao_media_s)}
              rotulo="duração média"
              detalhe={
                segundos == null || dAnterior == null || dAtual == null
                  ? null
                  : dAtual === dAnterior
                    ? "igual ao período anterior"
                    : `${dAtual < dAnterior ? "menos" : "mais"} ${duracao(Math.abs(dAtual - dAnterior))} que no período anterior`
              }
              corDetalhe="text-tinta-2"
            />
          </>
        ) : (
          [0, 1, 2, 3].map((k) => <Esqueleto key={k} className="h-[120px]" />)
        )}
      </div>

      <div className="flex flex-col gap-6 xl:flex-row">
        {!semVisao && (
          <Cartao
            id="quando"
            titulo="Quando procuram a câmara"
            sub="Conversas por dia e hora. O quadrado tracejado é o horário do balcão."
            className="flex-1"
          >
            {v ? (
              v.quando_ligam.maximo ? (
                <MapaCalor celulas={v.quando_ligam.celulas} maximo={v.quando_ligam.maximo} />
              ) : (
                <Vazio titulo="Ainda sem conversas neste período." />
              )
            ) : (
              <Esqueleto className="h-52" />
            )}
          </Cartao>
        )}
        <Cartao
          id="canais"
          titulo="Por onde e como acabou"
          className={`w-full shrink-0 ${semVisao ? "" : "xl:w-[340px]"}`}
        >
          {t ? (
            <div className="flex flex-col gap-5">
              <BarraEmpilhada
                titulo="CANAL"
                partes={Object.entries(t.por_canal)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => ({
                    rotulo: CORES_CANAL[k]?.rotulo ?? k,
                    valor: n,
                    cor: CORES_CANAL[k]?.cor ?? "bg-tinta-3",
                  }))}
              />
              <BarraEmpilhada
                titulo="RESULTADO"
                partes={[
                  { rotulo: "Resolvida pelo agente", valor: t.resolvidas_sem_humano, cor: "bg-verde" },
                  { rotulo: "Passada a funcionário", valor: t.passadas, cor: "bg-terracota-suave" },
                  { rotulo: "Sem resposta", valor: t.sem_resposta, cor: "bg-ambar" },
                ]}
              />
              <dl className="grid grid-cols-2 gap-2 border-t border-linha pt-3 text-xs">
                <div>
                  <dt className="text-tinta-3">SMS enviados</dt>
                  <dd className="text-[13px] font-bold text-tinta">{numero(t.sms.enviados)}</dd>
                </div>
                <div>
                  <dt className="text-tinta-3">Ocorrências registadas</dt>
                  <dd className="text-[13px] font-bold text-tinta">
                    {numero(t.ocorrencias.registadas)}
                    <span className="font-normal text-tinta-3">
                      {" "}
                      · {numero(t.ocorrencias.abertas_agora)} abertas
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <Esqueleto className="h-52" />
          )}
        </Cartao>
      </div>

      {!semVisao && (
        <div className="flex flex-col gap-6 xl:flex-row">
          <Cartao id="temas-mes" titulo="Temas do período" className="flex-1">
            {v ? (
              v.o_que_perguntam.length ? (
                <ListaTemas temas={v.o_que_perguntam} tamanho="13" />
              ) : (
                <Vazio titulo="Ainda sem temas neste período." />
              )
            ) : (
              <Esqueleto className="h-48" />
            )}
          </Cartao>
          <OQueMudou visao={v} />
        </div>
      )}
    </div>
  );
}

/** "O que mudou": três leituras tiradas dos números (não inventadas). */
function OQueMudou({ visao }: { visao?: VisaoGeral }) {
  const leituras: { icone: LucideIcon; titulo: string; detalhe: string }[] = [];
  if (visao) {
    const subida = [...visao.o_que_perguntam]
      .filter((t) => t.novo || (t.variacao ?? 0) > 0)
      .sort((a, b) => (b.novo ? 1e9 : (b.variacao ?? 0)) - (a.novo ? 1e9 : (a.variacao ?? 0)))[0];
    if (subida) {
      leituras.push({
        icone: TrendingUp,
        titulo: subida.novo
          ? `${subida.tema}: tema novo`
          : `${subida.tema} subiu ${variacaoPct(subida.variacao)?.replace("+", "")}`,
        detalhe: `${numero(subida.total)} conversas neste período, ${numero(subida.anterior)} no anterior.`,
      });
    }
    const sr = visao.atencao.sem_resposta.itens[0];
    if (sr) {
      leituras.push({
        icone: CircleHelp,
        titulo: `“${sr.texto}” sem resposta ${sr.vezes} ${sr.vezes === 1 ? "vez" : "vezes"}`,
        detalhe: sr.o_que_falta ?? "Falta uma fonte oficial para o agente poder responder.",
      });
    }
    const pico = horaDePico(porHora(visao.quando_ligam.celulas));
    if (pico !== null) {
      const aberto = balcaoAberto(pico);
      leituras.push({
        icone: aberto ? Sun : Moon,
        titulo: `Pico às ${pico}h`,
        detalhe: aberto
          ? "Dentro do horário do balcão."
          : "A uma hora em que o balcão está fechado.",
      });
    }
  }
  return (
    <section
      aria-labelledby="mudou-titulo"
      className="flex w-full shrink-0 flex-col gap-3.5 rounded-2xl bg-tinta p-6 xl:w-[340px]"
    >
      <h2 id="mudou-titulo" className="font-display text-[19px] font-bold tracking-[-0.3px] text-white">
        O que mudou neste período
      </h2>
      {!visao && <Esqueleto className="h-40 bg-white/10" />}
      {visao && leituras.length === 0 && (
        <p className="text-[13px] text-white/70">Ainda sem dados suficientes para comparar.</p>
      )}
      <ul className="flex flex-col gap-3.5">
        {leituras.map(({ icone: Icone, titulo, detalhe }) => (
          <li key={titulo} className="flex gap-3">
            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-white/10">
              <Icone className="size-[15px] text-terracota-suave" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-bold text-white">{titulo}</span>
              <span className="text-xs leading-[1.4] text-white/70">{detalhe}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
