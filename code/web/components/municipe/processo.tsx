"use client";

import {
  ArrowLeft,
  CalendarClock,
  Check,
  CircleCheck,
  Hash,
  Info,
  MessageCircle,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BotaoLink } from "@/components/ui/botao";
import { dataCurta, dataLonga } from "./formatar";
import {
  ACarregar,
  Cabecalho,
  CartaoAjuda,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  Nota,
  type Passo,
  ROTA_CHAT,
  Topo,
  TituloSecao,
  Trilho,
} from "./moldura";
import { ListaDocumentos } from "./requerimento";
import { mensagemDe, usePublico } from "./use-publico";
import {
  type DocumentosRequerimento,
  VerificarDocumento,
} from "./verificar-documento";

type Fase =
  | "entrada"
  | "documentos"
  | "apreciacao"
  | "pareceres_externos"
  | "decisao"
  | "notificado"
  | "arquivado";

interface ProcessoPublico {
  municipio: string;
  numero: string;
  tipo: string;
  assunto: string;
  fase: Fase;
  fase_rotulo: string;
  fase_em_palavras: string;
  decisao: string | null;
  decidido_em: string | null;
  criado_em: string;
  prazo: {
    inicio: string | null;
    fim: string | null;
    dias_uteis_restantes: number | null;
    a_contar: boolean;
  };
  documentos: {
    tem: string[];
    faltam: string[];
    em_falta: { nome: string; prazo: string | null }[];
  };
  linha_do_tempo: { em: string; tipo: string; descricao: string }[];
  requerimento_token: string | null;
}

/** Em que passo do trilho está cada fase (0 = pedido recebido). */
const PASSO_DA_FASE: Record<Fase, number> = {
  entrada: 1,
  documentos: 1,
  apreciacao: 2,
  pareceres_externos: 2,
  decisao: 3,
  notificado: 4,
  arquivado: 4,
};

function passos(p: ProcessoPublico): Passo[] {
  const atual = PASSO_DA_FASE[p.fase];
  const estado = (i: number): Passo["estado"] =>
    i < atual ? "feito" : i === atual ? "atual" : "por_fazer";
  const falta = p.documentos.em_falta;
  return [
    { titulo: "Pedido recebido", detalhe: dataCurta(p.criado_em), estado: "feito" },
    {
      titulo: "Documentos completos",
      // Um pedido do técnico a meio da análise também volta a pôr aqui a marca.
      estado: falta.length ? "atual" : estado(1),
      detalhe: falta.length
        ? `Falta ${falta.map((f) => f.nome.toLowerCase()).join(", ")}`
        : atual > 1
          ? "Tem tudo"
          : "A câmara está a confirmar",
      alerta: falta.length > 0,
    },
    {
      titulo: "Análise do técnico",
      estado: estado(2),
      detalhe:
        p.fase === "pareceres_externos"
          ? "À espera do parecer de outras entidades"
          : p.prazo.fim && atual <= 2
            ? `Resposta até ${dataLonga(p.prazo.fim)}`
            : atual < 2
              ? "Começa quando os documentos estiverem completos"
              : undefined,
    },
    {
      titulo: "Decisão",
      estado: estado(3),
      detalhe: atual < 3 ? "Avisamos por SMS" : undefined,
    },
  ];
}

function textoPrazo(p: ProcessoPublico["prazo"]): string | null {
  if (!p.a_contar || !p.fim) return null;
  const d = p.dias_uteis_restantes;
  if (d === null) return `A câmara tem até ${dataLonga(p.fim)} para responder.`;
  if (d > 1) return `A câmara tem até ${dataLonga(p.fim)} para responder: faltam ${d} dias úteis.`;
  if (d === 1) return `A câmara tem até ${dataLonga(p.fim)} para responder: falta 1 dia útil.`;
  if (d === 0) return "O prazo de resposta da câmara termina hoje.";
  return `O prazo de resposta da câmara terminou a ${dataLonga(p.fim)}.`;
}

function LinhaDoTempo({ eventos }: { eventos: ProcessoPublico["linha_do_tempo"] }) {
  if (!eventos.length) return null;
  return (
    <section className="flex w-full flex-col gap-2" aria-labelledby="historico">
      <TituloSecao id="historico">O que já aconteceu</TituloSecao>
      <ul className="flex flex-col">
        {[...eventos].reverse().map((e, i) => (
          <li key={`${e.em}-${i}`} className="flex gap-3 border-b border-linha py-3 last:border-b-0">
            <span className="w-14 shrink-0 pt-px text-[13px] font-semibold text-tinta-3">
              {dataCurta(e.em)}
            </span>
            <span className="text-[15px] leading-[1.45] text-tinta">{e.descricao}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** V2 · Decisão. */
function Decisao({ p }: { p: ProcessoPublico }) {
  const admitido = p.decisao === "admitido";
  return (
    <>
      <CartaoDestaque tom={admitido ? "verde" : "tinta"} className="gap-3.5 rounded-[28px_28px_28px_8px] px-[22px] py-7">
        <span
          aria-hidden
          className="flex size-[52px] items-center justify-center rounded-full bg-white"
        >
          {admitido ? (
            <Check className="size-7 text-verde" strokeWidth={3} />
          ) : (
            <X className="size-7 text-tinta" strokeWidth={3} />
          )}
        </span>
        <h1 className="font-display text-[34px] leading-[1.05] font-bold tracking-[-1px]">
          {admitido ? "O seu pedido foi aprovado." : "O seu pedido não foi aprovado."}
        </h1>
        <p className="text-[16px] leading-[1.5] text-white/90">
          {p.decidido_em ? `A câmara decidiu a ${dataLonga(p.decidido_em)}. ` : ""}
          {admitido
            ? `${p.tipo}: ${p.assunto} foi admitido.`
            : `${p.tipo}: ${p.assunto} foi indeferido. Pode saber porquê e o que pode fazer a seguir: ligue-nos ou escreva no chat.`}
        </p>
      </CartaoDestaque>

      <section className="flex w-full flex-col" aria-labelledby="e-agora">
        <TituloSecao id="e-agora">E agora?</TituloSecao>
        <ul className="flex flex-col pt-2">
          {(admitido
            ? [
                {
                  icone: Hash,
                  t: "Guarde o número do processo",
                  d: `${p.numero}. É o que lhe pedem ao telefone, no balcão ou na obra.`,
                },
                {
                  icone: CalendarClock,
                  t: "Respeite as condições e os prazos",
                  d: "Estão na decisão que a câmara lhe enviou.",
                },
                {
                  icone: MessageCircle,
                  t: "Dúvidas sobre a decisão?",
                  d: "Ligue ou escreva no chat. Já sabemos qual é o seu caso.",
                },
              ]
            : [
                {
                  icone: MessageCircle,
                  t: "Pergunte porquê",
                  d: "Explicamos a decisão e o que pode mudar para voltar a pedir.",
                },
                {
                  icone: Hash,
                  t: "Guarde o número do processo",
                  d: `${p.numero}. Vai precisar dele se quiser reclamar ou pedir de novo.`,
                },
              ]
          ).map((x) => (
            <li key={x.t} className="flex gap-3.5 border-b border-linha py-3.5 last:border-b-0">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-terracota-suave"
              >
                <x.icone className="size-[17px] text-terracota-escuro" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[16px] font-semibold text-tinta">{x.t}</span>
                <span className="text-[14px] leading-[1.45] text-tinta-2">{x.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <BotaoLink href={ROTA_CHAT} tamanho="grande" icone={MessageCircle} className="w-full">
        Falar sobre a decisão
      </BotaoLink>
    </>
  );
}

/** V2 · Enviar documento: pelo requerimento do processo. */
function EnviarDocumento({
  p,
  onVoltar,
}: {
  p: ProcessoPublico & { requerimento_token: string };
  onVoltar: () => void;
}) {
  const token = p.requerimento_token;
  const [docs, setDocs] = useState<DocumentosRequerimento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verificar, setVerificar] = useState<{ inicial: string | null } | null>(null);
  const [enviados, setEnviados] = useState(0);

  useEffect(() => {
    let ativo = true;
    api<{ documentos: DocumentosRequerimento }>(
      `/v1/public/requerimentos/${encodeURIComponent(token)}`,
    )
      .then((r) => ativo && setDocs(r.documentos))
      .catch((e: unknown) => ativo && setErro(mensagemDe(e)));
    return () => {
      ativo = false;
    };
  }, [token]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const aoVerificar = useCallback((d: DocumentosRequerimento) => {
    setDocs(d);
    setEnviados((n) => n + 1);
  }, []);
  const fechar = useCallback(() => setVerificar(null), []);

  const lista = docs
    ? [
        ...docs.faltam.map((d) => ({ id: d.id, nome: d.nome, detalhe: "em falta" })),
        ...docs.por_verificar.map((d) => ({ id: d.id, nome: d.nome, detalhe: "por verificar" })),
        ...docs.tem.map((d) => ({ id: d.id, nome: d.nome, detalhe: "já verificado" })),
      ]
    : [];
  const tudo = docs && docs.faltam.filter((d) => d.obrigatorio).length === 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <nav className="flex w-full items-center justify-between">
        <button
          type="button"
          onClick={onVoltar}
          className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-[16px] font-semibold text-tinta hover:bg-creme-2"
        >
          <ArrowLeft className="size-6" aria-hidden />
          Voltar
        </button>
        <span className="text-[14px] font-medium text-tinta-3">{p.numero}</span>
      </nav>
      <Cabecalho
        titulo="Enviar documento"
        sub="Tire uma fotografia ao documento (ou escolha o PDF). Vemos logo se está tudo certo, sem ir ao balcão."
      />
      {erro && (
        <Nota icone={Info} tom="terracota" papel="alert">
          {erro}
        </Nota>
      )}
      {!docs && !erro && (
        <p role="status" className="text-[15px] text-tinta-2">
          A ver o que falta…
        </p>
      )}
      {docs && (
        <ListaDocumentos
          documentos={docs}
          onFotografar={(id) => setVerificar({ inicial: id })}
        />
      )}
      {enviados > 0 && tudo && (
        <section className="flex w-full flex-col gap-1.5 rounded-[20px_20px_20px_6px] bg-verde-suave p-[18px]">
          <p className="font-display text-[22px] font-bold text-verde">Está tudo entregue.</p>
          <p className="text-[15px] leading-[1.5] text-tinta">
            Juntámos os documentos ao processo. O técnico segue com a análise e
            avisamos por SMS.
          </p>
        </section>
      )}
      <button
        type="button"
        onClick={onVoltar}
        className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-terracota px-6 text-[17px] font-semibold text-white hover:bg-terracota-escuro"
      >
        <ArrowLeft className="size-5" aria-hidden />
        Voltar ao processo
      </button>
      {verificar && (
        <VerificarDocumento
          token={token}
          documentos={lista}
          inicial={verificar.inicial}
          onFechar={fechar}
          onVerificado={aoVerificar}
        />
      )}
    </div>
  );
}

/** V2 · O seu processo (link do SMS, pelo código). */
export function Processo({ codigo }: { codigo: string }) {
  const { c, recarregar, tentarOutraVez } = usePublico<ProcessoPublico>(
    `/v1/public/processos/${encodeURIComponent(codigo)}`,
  );
  const [aEnviar, setAEnviar] = useState(false);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const p = c.dados;
  const token = p.requerimento_token;

  if (aEnviar && token) {
    return (
      <EnviarDocumento
        p={{ ...p, requerimento_token: token }}
        onVoltar={() => {
          setAEnviar(false);
          void recarregar();
        }}
      />
    );
  }

  const fechado = p.fase === "notificado" || p.fase === "arquivado";
  if (fechado && p.decisao) {
    return (
      <div className="flex w-full flex-col gap-6">
        <Topo direita={p.numero} />
        <Decisao p={p} />
        <LinhaDoTempo eventos={p.linha_do_tempo} />
      </div>
    );
  }

  const falta = p.documentos.em_falta;
  const prazo = textoPrazo(p.prazo);

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={p.municipio} />
      <Cabecalho meta={`Processo ${p.numero}`} titulo={p.assunto} sub={p.tipo} grande />

      {falta.length > 0 ? (
        <CartaoDestaque
          rotulo={falta.length === 1 ? "Falta 1 documento" : `Faltam ${falta.length} documentos`}
        >
          <ul className="flex flex-col gap-1.5">
            {falta.map((f) => (
              <li key={f.nome} className="font-display text-[20px] leading-[1.25] font-semibold">
                {f.nome}
                {f.prazo && (
                  <span className="block font-body text-[14px] font-normal text-white/85">
                    entregar até {dataLonga(f.prazo)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {token ? (
            <button
              type="button"
              onClick={() => setAEnviar(true)}
              className="mt-1 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-white text-[17px] font-bold text-terracota-escuro hover:bg-creme"
            >
              <Upload className="size-[18px]" aria-hidden />
              Enviar documento
            </button>
          ) : (
            <p className="text-[14px] text-white/90">
              Para entregar, ligue-nos ou escreva no chat.
            </p>
          )}
          <p className="text-[13px] leading-[1.4] text-white/85">
            {prazo ?? "O prazo da câmara só começa a contar quando o processo estiver completo."}
          </p>
        </CartaoDestaque>
      ) : (
        <section className="flex w-full flex-col gap-1.5 rounded-[20px_20px_20px_6px] bg-verde-suave p-[18px]">
          <p className="flex items-center gap-2 font-display text-[20px] font-bold text-verde">
            <CircleCheck className="size-5" aria-hidden />
            {fechado ? "Processo fechado." : "Não falta nada da sua parte."}
          </p>
          <p className="text-[15px] leading-[1.5] text-tinta">
            O seu processo {p.fase_em_palavras}.{prazo ? ` ${prazo}` : ""}
          </p>
        </section>
      )}

      <section className="flex w-full flex-col gap-3.5" aria-labelledby="ponto">
        <TituloSecao id="ponto">Em que ponto está</TituloSecao>
        <Trilho passos={passos(p)} />
      </section>

      <LinhaDoTempo eventos={p.linha_do_tempo} />

      <CartaoAjuda titulo="Dúvidas sobre o processo?" />
    </div>
  );
}
