"use client";

import {
  CalendarPlus,
  CalendarSync,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  Hourglass,
  RotateCcw,
  Truck,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Botao } from "@/components/ui/botao";
import {
  dataCurta,
  descarregarCalendario,
  euros,
  hora,
  mesEDia,
  quandoRelativo,
  diaSemana,
} from "./formatar";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  ModoTeste,
  Topo,
  TituloSecao,
} from "./moldura";
import { usePublico } from "./use-publico";

type Criado =
  | {
      tipo: "requerimento";
      titulo: string;
      estado: string;
      em_falta: string[];
      url: string | null;
    }
  | { tipo: "processo" | "ocorrencia"; titulo: string; estado: string; url: string | null }
  | {
      tipo: "marcacao";
      titulo: string;
      estado: string;
      inicio: string;
      local: string | null;
      levar: string[];
      url: string | null;
    }
  | { tipo: "recolha"; titulo: string; estado: string; inicio: string | null; url: null }
  | {
      tipo: "pagamento";
      titulo: string;
      estado: string;
      valor_cent: number;
      pagar_ate: string | null;
      modo_teste: boolean;
      url: string | null;
    };

interface ResumoPublico {
  municipio: { nome: string; telefone: string | null };
  data: string;
  resumo: string | null;
  resumo_pronto: boolean;
  proximos_passos: string[];
  criado: Criado[];
}

const ESTADOS: Record<string, string> = {
  // requerimentos
  a_preencher: "Faltam dados",
  pronto: "Pronto para rever e assinar",
  assinado: "Assinado",
  entregue: "Entregue na câmara",
  // processos
  entrada: "Deu entrada",
  documentos: "À espera de documentos seus",
  apreciacao: "Em análise",
  pareceres_externos: "À espera de outras entidades",
  decisao: "Em decisão",
  notificado: "Já tem decisão",
  arquivado: "Arquivado",
  // ocorrências
  nova: "Registada",
  com_equipa: "Com a equipa",
  resolvida: "Resolvida",
  duplicada: "Já tinha sido comunicada",
  rejeitada: "Não seguiu",
  // marcações e recolhas
  marcada: "Marcada",
  cancelada: "Cancelada",
  realizada: "Realizada",
  faltou: "Faltou",
  // pagamentos
  pendente: "Por pagar",
  pago: "Pago",
  expirado: "Prazo passou",
  cancelado: "Cancelado",
};

const ICONES: Record<Criado["tipo"], LucideIcon> = {
  requerimento: FileText,
  processo: ClipboardList,
  ocorrencia: TriangleAlert,
  marcacao: CalendarSync,
  recolha: Truck,
  pagamento: CreditCard,
};

const ACAO: Record<Criado["tipo"], string> = {
  requerimento: "Rever e assinar",
  processo: "Ver o processo",
  ocorrencia: "Ver e juntar fotografia",
  marcacao: "Ver a marcação",
  recolha: "",
  pagamento: "Pagar",
};

function Marcacao({ m }: { m: Extract<Criado, { tipo: "marcacao" }> }) {
  const { mes, dia } = mesEDia(m.inicio);
  const quando = `${diaSemana(m.inicio).replace("-feira", "")}, ${dataCurta(m.inicio)}, ${hora(m.inicio)}`;
  const ativa = m.estado === "marcada";
  return (
    <section
      aria-label="A sua marcação"
      className="flex w-full flex-col gap-4 rounded-[20px] border border-linha bg-papel p-5"
    >
      <div className="flex w-full items-center gap-4">
        <div
          aria-hidden
          className="flex w-[60px] shrink-0 flex-col overflow-hidden rounded-xl border border-linha"
        >
          <span className="bg-terracota py-[3px] text-center text-[11px] font-bold tracking-[0.8px] text-white">
            {mes}
          </span>
          <span className="bg-white pt-1 pb-1.5 text-center font-display text-[24px] font-bold text-tinta">
            {dia}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            className={`text-[11px] font-bold tracking-[0.8px] uppercase ${ativa ? "text-verde" : "text-ambar"}`}
          >
            {ativa ? "Marcámos por si" : (ESTADOS[m.estado] ?? m.estado)}
          </p>
          <p className="text-[18px] font-bold text-tinta first-letter:uppercase">
            {quando}
          </p>
          <p className="text-[14px] leading-[1.4] text-tinta-2">
            {[m.titulo, m.local].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {m.levar.length > 0 && (
        <p className="text-[14px] leading-[1.45] text-tinta-2">
          <span className="font-semibold text-tinta">Leve consigo: </span>
          {m.levar.join(", ")}.
        </p>
      )}
      {ativa && (
        <div className="flex w-full gap-2.5">
          <Botao
            variante="secundario"
            icone={CalendarPlus}
            className="h-12 flex-1 text-[15px]"
            onClick={() =>
              descarregarCalendario({
                titulo: m.titulo,
                inicio: m.inicio,
                local: m.local,
                notas: m.levar.length ? `Levar: ${m.levar.join(", ")}` : null,
              })
            }
          >
            Calendário
          </Botao>
          {m.url && (
            <a
              href={m.url}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] border-tinta text-[15px] font-semibold text-tinta transition-colors hover:bg-tinta/5"
            >
              <CalendarSync className="size-4" aria-hidden />
              Remarcar
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function LinhaCriado({ c }: { c: Exclude<Criado, { tipo: "marcacao" }> }) {
  const Icone = ICONES[c.tipo];
  const detalhe =
    c.tipo === "pagamento"
      ? `${euros(c.valor_cent)}${c.pagar_ate && c.estado === "pendente" ? ` · pagar até ${dataCurta(c.pagar_ate)}` : ""}`
      : c.tipo === "recolha" && c.inicio
        ? `${dataCurta(c.inicio)}, a partir das ${hora(c.inicio)}`
        : c.tipo === "requerimento" && c.em_falta.length
          ? `Falta: ${c.em_falta.join(", ")}`
          : null;
  const conteudo = (
    <>
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-terracota-suave"
      >
        <Icone className="size-[18px] text-terracota-escuro" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-semibold text-tinta">{c.titulo}</span>
        <span className="text-[14px] text-tinta-2">
          {ESTADOS[c.estado] ?? c.estado}
          {detalhe && ` · ${detalhe}`}
        </span>
        {c.tipo === "pagamento" && c.modo_teste && (
          <span className="pt-1">
            <ModoTeste />
          </span>
        )}
        {c.url && ACAO[c.tipo] && (
          <span className="pt-1 text-[15px] font-semibold text-terracota-escuro">
            {ACAO[c.tipo]}
          </span>
        )}
      </span>
      {c.url && <ChevronRight className="size-5 shrink-0 text-tinta-2" aria-hidden />}
    </>
  );
  const classe =
    "flex w-full items-center gap-3.5 border-b border-linha py-3.5 text-left last:border-b-0";
  return c.url ? (
    <li>
      <a href={c.url} className={`${classe} hover:bg-creme-2/50`}>
        {conteudo}
      </a>
    </li>
  ) : (
    <li className={classe}>{conteudo}</li>
  );
}

/** 05 · O que tem de fazer (link do SMS do resumo da chamada). */
export function Resumo({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<ResumoPublico>(
    `/v1/public/resumos/${encodeURIComponent(codigo)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const r = c.dados;
  const marcacoes = r.criado.filter(
    (x): x is Extract<Criado, { tipo: "marcacao" }> => x.tipo === "marcacao",
  );
  const outros = r.criado.filter(
    (x): x is Exclude<Criado, { tipo: "marcacao" }> => x.tipo !== "marcacao",
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <Topo direita={r.municipio.nome} />
      <Cabecalho
        meta={`A sua chamada de ${quandoRelativo(r.data)} · ${hora(r.data).replace("h", ":")}`}
        titulo="O que tem de fazer"
        grande
      />

      {r.resumo ? (
        <CartaoDestaque rotulo="Em resumo">
          <p className="font-display text-[21px] leading-[1.25] font-semibold tracking-[-0.3px] whitespace-pre-line">
            {r.resumo}
          </p>
        </CartaoDestaque>
      ) : (
        <section className="flex w-full flex-col gap-3 rounded-[20px] border border-linha bg-papel p-5">
          <p className="flex items-center gap-2 text-[16px] font-semibold text-tinta">
            <Hourglass className="size-5 text-terracota" aria-hidden />
            Ainda estamos a escrever o resumo.
          </p>
          <p className="text-[15px] leading-[1.45] text-tinta-2">
            Demora só um minuto. Carregue em atualizar daqui a pouco.
          </p>
          <Botao
            variante="secundario"
            icone={RotateCcw}
            className="h-12 text-[15px]"
            onClick={tentarOutraVez}
          >
            Atualizar
          </Botao>
        </section>
      )}

      {r.proximos_passos.length > 0 && (
        <section className="flex w-full flex-col gap-4" aria-labelledby="passos">
          <TituloSecao id="passos">
            {r.proximos_passos.length === 1
              ? "O passo seguinte"
              : `São ${r.proximos_passos.length} passos`}
          </TituloSecao>
          <ol className="flex w-full flex-col gap-4">
            {r.proximos_passos.map((p, i) => (
              <li key={i} className="flex w-full gap-3.5">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tinta text-[13px] font-bold text-white"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5 text-[16px] leading-[1.45] text-tinta">{p}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {marcacoes.map((m, i) => (
        <Marcacao key={`${m.inicio}-${i}`} m={m} />
      ))}

      {outros.length > 0 && (
        <section className="flex w-full flex-col" aria-labelledby="registado">
          <div className="pb-1">
            <TituloSecao id="registado">O que ficou tratado</TituloSecao>
          </div>
          <ul className="flex w-full flex-col">
            {outros.map((o, i) => (
              <LinhaCriado key={`${o.tipo}-${i}`} c={o} />
            ))}
          </ul>
        </section>
      )}

      <MaisDuvidas telefone={r.municipio.telefone} />
    </div>
  );
}
