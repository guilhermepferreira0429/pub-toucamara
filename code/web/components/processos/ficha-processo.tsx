"use client";

import {
  Check,
  Clock4,
  CloudOff,
  Loader,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { CartaoAntecipacoes } from "@/components/antecipacoes/cartao-processo";
import { CartaoEntregaEmNome } from "@/components/entregas/cartao-entrega";
import { CartaoCartasProcesso } from "@/components/cartas/painel-cartas";
import { useSessao } from "@/lib/sessao";
import { DialogoLigar, DialogoPedirDocumento } from "./dialogos-processo";
import { capitalizar, diaCurto, diaHora, textoDiasUteis } from "./formatos";
import {
  CartaoDocumentos,
  CartaoGerir,
  CartaoLocalizacao,
  CartaoPedidos,
  CartaoPrazo,
  CartaoRequerente,
  CartaoSincronizacao,
  estadoSync,
  NotaFicha,
} from "./lateral-processo";
import { LinhaDoTempo } from "./linha-do-tempo";
import type { ProcessoDetalhe, ResultadoSincronizacao } from "./tipos";
import {
  ACarregar,
  BotaoPainel,
  Chip,
  LinkPainel,
  paraErro,
  usePedido,
} from "./ui";

/*
 * V2 · Processo (C950r) e V2 · Processo · Sincronização falhou (P8hffg):
 * cabeçalho com etiquetas e ações, estado em 5 passos, linha do tempo com
 * nota interna e a coluna da direita.
 */

type Mensagem = { tom: "verde" | "ambar" | "erro"; texto: string };

function passoAtual(fase: string): number {
  switch (fase) {
    case "entrada":
      return 0;
    case "documentos":
      return 1;
    case "apreciacao":
    case "pareceres_externos":
      return 2;
    case "decisao":
      return 3;
    default:
      return 5;
  }
}

function Passos({ p }: { p: ProcessoDetalhe }) {
  const atual = passoAtual(p.fase);
  const emFase = (para: string) =>
    p.eventos.find(
      (e) => e.tipo === "fase" && (e.dados as { para?: string } | null)?.para === para,
    )?.em ?? null;
  const criado = p.eventos.find((e) => e.tipo === "criado")?.em ?? p.criado_em;
  // "Documentos completos" só quando não falta nenhum (a fase pode ir à
  // frente: um pedido do técnico a meio da apreciação volta a abrir o passo).
  const faltam = p.documentos_resumo.em_falta.length;

  const passos: { titulo: string; data: string; pendente?: boolean }[] = [
    { titulo: "Entrada", data: diaCurto(criado) },
    {
      titulo: atual === 1 || faltam ? "Documentos" : "Documentos completos",
      data: faltam
        ? `${faltam === 1 ? "falta 1" : `faltam ${faltam}`} · à espera do munícipe`
        : atual === 1
          ? "à espera do munícipe"
          : p.prazo.inicio
            ? diaCurto(p.prazo.inicio)
            : "",
      pendente: faltam > 0 && atual > 1,
    },
    {
      titulo: "Apreciação técnica",
      data: atual === 2 ? "em curso" : diaCurto(emFase("apreciacao")),
    },
    {
      titulo: "Decisão",
      data: p.decidido_em
        ? diaCurto(p.decidido_em)
        : p.prazo.fim
          ? `até ${diaCurto(p.prazo.fim)}`
          : "",
    },
    {
      titulo: "Munícipe avisado",
      data: emFase("notificado") ? diaCurto(emFase("notificado")) : "SMS automático",
    },
  ];
  if (p.fase === "arquivado") passos[4] = { titulo: "Arquivado", data: diaCurto(emFase("arquivado")) };

  return (
    <section aria-label="Estado do processo" className="rounded-2xl border border-linha bg-papel px-6 py-[18px]">
      <ol className="flex flex-wrap items-center gap-3.5">
        {passos.map((s, i) => {
          const feito = i < atual && !s.pendente;
          const corrente = i === atual || !!s.pendente;
          return (
            <li key={s.titulo} className="flex items-center gap-3.5">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`h-0.5 w-[50px] rounded-[1px] xl:w-[70px] ${i <= atual ? "bg-verde" : "bg-linha"}`}
                />
              )}
              <span className="flex items-center gap-2.5" aria-current={corrente ? "step" : undefined}>
                <span
                  className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                    feito
                      ? "bg-verde text-white"
                      : corrente
                        ? "bg-terracota text-white"
                        : "border border-linha bg-creme text-tinta-3"
                  }`}
                >
                  {feito ? <Check className="size-[15px]" aria-label="feito" /> : i + 1}
                </span>
                <span className="flex flex-col gap-px">
                  <span
                    className={`text-[13px] ${
                      corrente ? "font-bold text-tinta" : feito ? "font-semibold text-tinta" : "font-semibold text-tinta-3"
                    }`}
                  >
                    {s.titulo}
                  </span>
                  {s.data && (
                    <span className={`text-[11px] ${corrente ? "text-terracota-escuro" : "text-tinta-3"}`}>
                      {s.data}
                    </span>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ChipPrazo({ p }: { p: ProcessoDetalhe }) {
  const d = p.prazo.dias_uteis_restantes;
  if (p.fase === "notificado" || p.fase === "arquivado") {
    return p.decisao ? (
      <Chip tom={p.decisao === "admitido" ? "verde" : "erro"} icone={Check}>
        {capitalizar(p.decisao)}
      </Chip>
    ) : null;
  }
  if (d === null) return <Chip tom="neutro" icone={Clock4}>Prazo por começar</Chip>;
  const tom = p.prazo.atrasado ? "erro" : d <= 3 ? "ambar" : "verde";
  return (
    <Chip tom={tom} icone={Clock4}>
      {capitalizar(textoDiasUteis(d))}
    </Chip>
  );
}

export function FichaProcesso() {
  const { id } = useParams<{ id: string }>();
  const { pode, pedido } = useSessao();
  const ficha = usePedido<ProcessoDetalhe>(
    pode("processos") ? `/v1/painel/processos/${id}` : null,
  );
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const [pedirAberto, setPedirAberto] = useState(false);
  const [ligarAberto, setLigarAberto] = useState(false);
  const [sync, setSync] = useState<ResultadoSincronizacao | null>(null);
  const [aSincronizar, setASincronizar] = useState(false);
  const [verDetalhes, setVerDetalhes] = useState(false);

  if (!pode("processos")) {
    return (
      <div className="pt-10">
        <Aviso titulo="Sem acesso aos processos.">
          O seu perfil não inclui os processos. Peça acesso à chefia.
        </Aviso>
      </div>
    );
  }

  const p = ficha.dados;
  if (ficha.erro && !p) {
    return (
      <div className="pt-10">
        <Aviso
          titulo={
            ficha.erro.codigo === "nao_encontrado"
              ? "Este processo não existe."
              : "Não foi possível abrir o processo."
          }
          tom="erro"
        >
          {ficha.erro.message}{" "}
          <button type="button" onClick={ficha.recarregar} className="font-semibold underline">
            Tentar outra vez
          </button>
        </Aviso>
      </div>
    );
  }
  if (!p) return <ACarregar className="px-4 pt-10 sm:px-10" texto="A abrir o processo…" />;

  const gd = estadoSync(p, sync);

  async function sincronizar() {
    setASincronizar(true);
    try {
      const r = await pedido<ResultadoSincronizacao>(
        `/v1/painel/processos/${id}/sincronizar`,
        { corpo: {} },
      );
      setSync(r);
      setMensagem(
        r.gd_estado === "sincronizado"
          ? { tom: "verde", texto: "Enviado para a gestão documental." }
          : {
              tom: "erro",
              texto: `O envio falhou outra vez${r.erro ? `: ${r.erro}` : "."}`,
            },
      );
      ficha.recarregar();
    } catch (e) {
      setMensagem({ tom: "erro", texto: paraErro(e).message });
    } finally {
      setASincronizar(false);
    }
  }

  const titulo = p.morada ? `${p.assunto} · ${p.morada}` : p.assunto;
  const fechado = p.fase === "notificado" || p.fase === "arquivado";

  return (
    <div className="pb-10">
      {gd?.erro && (
        <div className="px-4 pt-7 sm:px-10">
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3.5 rounded-[14px] bg-[#F8DCD6] px-[18px] py-3.5"
          >
            <CloudOff className="size-5 shrink-0 text-[#C62F1F]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#8E2216]">
                O processo não chegou à gestão documental
              </p>
              <p className="text-[13px] text-tinta-2">
                O sistema da câmara não respondeu
                {gd.em ? ` (${diaHora(gd.em)})` : ""}.
                {gd.tentativa
                  ? ` Tentámos ${gd.tentativa} ${gd.tentativa === 1 ? "vez" : "vezes"}.`
                  : ""}{" "}
                Está tudo guardado aqui e nada se perdeu.
              </p>
              {verDetalhes && gd.detalhe && (
                <p className="mt-1 font-mono text-xs text-[#8E2216]">{gd.detalhe}</p>
              )}
            </div>
            <button
              type="button"
              onClick={sincronizar}
              disabled={aSincronizar}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#C62F1F] px-3.5 text-[13px] font-semibold text-white hover:bg-[#8E2216] disabled:opacity-60"
            >
              <RefreshCw className={`size-3.5 ${aSincronizar ? "animate-spin" : ""}`} aria-hidden />
              {aSincronizar ? "A enviar…" : "Tentar outra vez"}
            </button>
            {gd.detalhe && (
              <button
                type="button"
                onClick={() => setVerDetalhes((v) => !v)}
                aria-expanded={verDetalhes}
                className="h-9 rounded-[10px] px-3 text-[13px] font-semibold text-[#8E2216] hover:bg-black/5"
              >
                {verDetalhes ? "Esconder detalhes" : "Ver detalhes"}
              </button>
            )}
          </div>
        </div>
      )}

      <CabecalhoPagina
        migalhas={["Processos", p.tipo.nome, p.numero]}
        titulo={titulo}
        descricao={
          <div className="flex flex-wrap gap-2 pt-1.5">
            <Chip tom="tinta">{p.numero}</Chip>
            <Chip tom="neutro">{p.tipo.nome}</Chip>
            <Chip tom={fechado ? "papel" : "terracota"} icone={fechado ? Check : Loader}>
              {p.fase === "apreciacao" ? "Em apreciação" : p.fase_rotulo}
            </Chip>
            <ChipPrazo p={p} />
            {p.tecnico?.nome && <Chip tom="papel">Técnico: {p.tecnico.nome}</Chip>}
          </div>
        }
        acoes={
          <>
            <BotaoPainel
              icone={Phone}
              onClick={() => setLigarAberto(true)}
              disabled={!p.municipe}
            >
              Ligar ao munícipe
            </BotaoPainel>
            {/* O principal depende da fase: à espera de documentos, pedi-los;
                em análise, o apoio ao técnico; decidido, nenhum. */}
            {!fechado && (
              <BotaoPainel
                variante={p.fase === "documentos" ? "principal" : "contorno"}
                icone={Send}
                onClick={() => setPedirAberto(true)}
                disabled={!p.municipe}
              >
                Pedir documento
              </BotaoPainel>
            )}
            <LinkPainel
              variante={!fechado && p.fase !== "documentos" ? "principal" : "contorno"}
              href={`/painel/processos/${p.id}/apoio`}
              icone={Sparkles}
            >
              {fechado ? "Ver o apoio ao técnico" : "Abrir apoio ao técnico"}
            </LinkPainel>
          </>
        }
      />

      <div className="flex flex-col gap-6 px-4 sm:px-10">
        <NotaFicha mensagem={mensagem} onFechar={() => setMensagem(null)} />
        <Passos p={p} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <LinhaDoTempo
            processoId={p.id}
            eventos={p.eventos}
            onNota={ficha.recarregar}
          />
          <div className="flex flex-col gap-4">
            <CartaoPrazo p={p} />
            <CartaoAntecipacoes
              processoId={p.id}
              aberto={!p.decisao && !["notificado", "arquivado"].includes(p.fase)}
              onMudou={ficha.recarregar}
            />
            <CartaoGerir
              key={p.atualizado_em}
              p={p}
              onAtualizado={(d, texto) => {
                ficha.definir(d);
                setMensagem({ tom: "verde", texto });
              }}
            />
            <CartaoLocalizacao p={p} onPlanta={ficha.recarregar} />
            <CartaoDocumentos p={p} />
            <CartaoPedidos p={p} />
            <CartaoRequerente p={p} />
            <CartaoEntregaEmNome processoId={p.id} />
            <CartaoCartasProcesso processoId={p.id} />
            {(sync || p.gestao_documental?.estado !== "nao_aplicavel") && (
              <CartaoSincronizacao
                estado={gd}
                aSincronizar={aSincronizar}
                onSincronizar={sincronizar}
              />
            )}
          </div>
        </div>
      </div>

      <DialogoPedirDocumento
        aberto={pedirAberto}
        onFechar={() => setPedirAberto(false)}
        processoId={p.id}
        tipoId={p.tipo.id}
        emFalta={p.documentos_resumo.faltam}
        onFeito={(texto) => {
          setMensagem({ tom: "verde", texto });
          ficha.recarregar();
        }}
      />
      <DialogoLigar
        aberto={ligarAberto}
        onFechar={() => setLigarAberto(false)}
        processoId={p.id}
        numero={p.numero}
        telefone={p.municipe?.telefone ?? null}
        onFeito={(texto) => {
          setMensagem({ tom: texto.startsWith("A chamada não") ? "erro" : "verde", texto });
          ficha.recarregar();
        }}
      />
    </div>
  );
}
