"use client";

import { AlarmClock, CalendarDays, MessageSquareText } from "lucide-react";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  ModoTeste,
  Nota,
  Rotulo,
  TituloSecao,
  Topo,
  Trilho,
  type Passo,
} from "./moldura";
import { usePublico } from "./use-publico";

/*
 * A reclamação (o link do SMS): o número, até quando a câmara tem de
 * responder, em que ponto está e, quando houver, a resposta escrita.
 */

interface ReclamacaoPublica {
  numero: string;
  municipio: string;
  estado: "recebida" | "em_analise" | "respondida" | "encerrada";
  estado_nome: string;
  canal: string;
  nome: string | null;
  servico: string | null;
  descricao: string;
  pedido: string | null;
  recebida_em: string;
  responder_ate: string;
  prazo_dias_uteis: number;
  prazo: { situacao: string; dias_uteis_restantes: number | null };
  resposta: string | null;
  respondida_em: string | null;
  encerrada_em: string | null;
  passos: { recebida: string; em_analise: string | null; respondida: string | null; encerrada: string | null };
  fonte: string;
  prazo_de_demonstracao: boolean;
}

const DATA = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric" });

function dataLonga(v: string): string {
  return DATA.format(/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v));
}

export function PaginaReclamacao({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<ReclamacaoPublica>(
    `/v1/public/reclamacoes/${encodeURIComponent(codigo)}`,
  );

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const r = c.dados;
  const respondida = !!r.resposta;
  const atraso = r.prazo.situacao === "em_atraso";
  const passos: Passo[] = [
    { titulo: "Recebida", detalhe: dataLonga(r.passos.recebida), estado: "feito" },
    {
      titulo: "Em análise",
      detalhe: r.passos.em_analise ? `Desde ${dataLonga(r.passos.em_analise)}` : "Um serviço da câmara vai analisá-la.",
      estado: r.passos.em_analise || respondida ? "feito" : "atual",
    },
    {
      titulo: "Respondida",
      detalhe: r.passos.respondida ? dataLonga(r.passos.respondida) : `Até ${dataLonga(r.responder_ate)}`,
      estado: respondida ? "feito" : r.passos.em_analise ? "atual" : "por_fazer",
    },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={r.numero} mono />
      <Cabecalho
        meta={`Câmara Municipal de ${r.municipio}`}
        titulo="A sua reclamação"
        sub={r.servico ? `Sobre ${r.servico}.` : undefined}
      />

      {respondida ? (
        <CartaoDestaque rotulo="A câmara respondeu" tom="verde">
          <p className="text-[16px] leading-[1.5] whitespace-pre-line">{r.resposta}</p>
          {r.respondida_em && <p className="text-[13px] text-white/80">{dataLonga(r.respondida_em)}</p>}
        </CartaoDestaque>
      ) : r.estado === "encerrada" ? (
        <Nota icone={MessageSquareText} tom="neutro" papel="status">
          Esta reclamação foi encerrada{r.encerrada_em ? ` a ${dataLonga(r.encerrada_em)}` : ""}.
        </Nota>
      ) : (
        <CartaoDestaque rotulo="A câmara tem de responder até" tom={atraso ? "tinta" : "terracota"}>
          <p className="flex items-center gap-2 font-display text-[26px] leading-tight font-bold">
            <CalendarDays className="size-7" aria-hidden />
            {dataLonga(r.responder_ate)}
          </p>
          <p className="text-[15px] text-white/85">
            {r.prazo_dias_uteis} dias úteis a contar do dia em que a recebemos. Mandamos-lhe a resposta por SMS ou email
            e fica também nesta página.
          </p>
        </CartaoDestaque>
      )}

      {atraso && !respondida && (
        <Nota icone={AlarmClock} tom="terracota" papel="alert">
          O prazo de resposta já passou. Pedimos desculpa pela demora: a sua reclamação continua a ser tratada.
        </Nota>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="ponto">
        <TituloSecao id="ponto">Em que ponto está</TituloSecao>
        <Trilho passos={passos} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5" aria-labelledby="o-que">
        <Rotulo id="o-que">O que nos disse</Rotulo>
        <p className="text-[15px] leading-[1.5] whitespace-pre-line text-tinta">{r.descricao}</p>
        {r.pedido && (
          <>
            <Rotulo>O que pede</Rotulo>
            <p className="text-[15px] leading-[1.5] text-tinta">{r.pedido}</p>
          </>
        )}
        <p className="text-[13px] text-tinta-3">
          {r.nome ? `${r.nome} · ` : ""}recebida por {r.canal} a {dataLonga(r.recebida_em)}
        </p>
      </section>

      {r.prazo_de_demonstracao && (
        <div className="flex flex-wrap gap-2">
          <ModoTeste texto="prazo de demonstração" />
        </div>
      )}
      <p className="text-[13px] leading-[1.45] text-tinta-3">Base do prazo: {r.fonte}</p>
      <MaisDuvidas nota="Guarde o número da reclamação: com ele pode perguntar pelo estado." />
    </div>
  );
}
