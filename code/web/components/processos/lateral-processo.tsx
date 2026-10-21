"use client";

import {
  Check,
  CloudOff,
  ExternalLink,
  Eye,
  FileCheck,
  FileClock,
  FileX,
  Map as MapaIcone,
  RefreshCw,
  Save,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { Botao } from "@/components/ui/botao";
import { membrosDe, type ServicosEquipa } from "@/components/atendimento/equipa";
import { useSessao } from "@/lib/sessao";
import { diaCurto, diaHora, diaLongo, textoDiasUteis } from "./formatos";
import {
  FASE_ROTULO,
  FASES,
  type DocumentoProcesso,
  type Fase,
  type ProcessoDetalhe,
  type ResultadoSincronizacao,
} from "./tipos";
import {
  Cartao,
  Chip,
  CAMPO_CREME,
  Campo,
  ErroEmLinha,
  Nota,
  paraErro,
  RotuloSeccao,
  usePedido,
} from "./ui";

/*
 * Coluna da direita da ficha (frames C950r / P8hffg): prazo, gerir (fase,
 * técnico, decisão), localização e planta, documentos com a verificação,
 * pedidos ao munícipe, requerente e gestão documental.
 */

export function CartaoPrazo({ p }: { p: ProcessoDetalhe }) {
  const total = p.tipo.prazo_dias_uteis;
  const fechado = p.fase === "notificado" || p.fase === "arquivado";
  const restantes = p.prazo.dias_uteis_restantes;
  const dia =
    restantes === null ? null : Math.max(0, Math.min(total, total - restantes));
  const pct = dia === null ? 0 : Math.round((dia / total) * 100);
  const alerta = Math.min(100, Math.round((3 / total) * 100));

  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <RotuloSeccao>Prazo de apreciação</RotuloSeccao>
        {dia !== null && !fechado && (
          <span className="text-xs font-bold text-tinta">
            dia {dia} de {total}
          </span>
        )}
      </div>
      {dia !== null && !fechado && (
        <div
          role="progressbar"
          aria-label="Prazo de apreciação usado"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={dia}
          aria-valuetext={`dia ${dia} de ${total} dias úteis`}
          className="relative h-2.5 overflow-hidden rounded-[5px] bg-creme"
        >
          <span
            className="absolute inset-y-0 right-0 bg-ambar-suave"
            style={{ width: `${alerta}%` }}
          />
          <span
            className={`absolute inset-y-0 left-0 rounded-[5px] ${
              p.prazo.atrasado ? "bg-terracota-escuro" : "bg-terracota"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="text-xs text-tinta-2">
        {fechado
          ? `Processo ${p.fase_rotulo.toLowerCase()}${
              p.decisao ? ` · decisão: ${p.decisao}` : ""
            }${p.decidido_em ? ` a ${diaLongo(p.decidido_em)}` : ""}.`
          : p.prazo.fim
            ? `${p.prazo.atrasado ? `Passou o prazo (${textoDiasUteis(restantes)}): terminou` : "Termina"} a ${diaLongo(p.prazo.fim)}. ${
                p.prazo.atrasado ? "" : "Avisamos o técnico e a chefia 3 dias antes."
              }`
            : `Os ${total} dias úteis começam a contar quando o processo estiver completo.`}
      </p>
    </Cartao>
  );
}

// ---------------------------------------------------------------------------

export function CartaoGerir({
  p,
  onAtualizado,
}: {
  p: ProcessoDetalhe;
  onAtualizado: (d: ProcessoDetalhe, mensagem: string) => void;
}) {
  const { pedido, pode, eu } = useSessao();
  const equipa = usePedido<ServicosEquipa>(
    pode("visao_geral") ? "/v1/painel/servicos" : null,
  );
  const [fase, setFase] = useState<Fase>(p.fase);
  const [tecnico, setTecnico] = useState(p.tecnico?.id ?? "");
  const [decisao, setDecisao] = useState(p.decisao ?? "");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Quem pode escolher: a equipa (com permissão), senão o atual e "eu".
  const opcoesTecnico = new Map<string, string>();
  for (const m of membrosDe(equipa.dados, ["tecnico", "chefe_divisao"])) {
    opcoesTecnico.set(m.id, m.nome);
  }
  if (p.tecnico) opcoesTecnico.set(p.tecnico.id, p.tecnico.nome ?? "Técnico");
  if (eu) opcoesTecnico.set(eu.utilizador.id, `${eu.utilizador.nome} (eu)`);

  const mudancas: Record<string, unknown> = {};
  if (fase !== p.fase) mudancas.fase = fase;
  if (tecnico !== (p.tecnico?.id ?? "")) mudancas.tecnico_id = tecnico || null;
  if (decisao && decisao !== p.decisao) mudancas.decisao = decisao;
  const haMudancas = Object.keys(mudancas).length > 0;
  const avisaDecisao =
    !!(decisao || p.decisao) && (fase === "decisao" || fase === "notificado");

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!haMudancas) return;
    setAGuardar(true);
    setErro(null);
    try {
      const d = await pedido<ProcessoDetalhe>(`/v1/painel/processos/${p.id}`, {
        metodo: "PATCH",
        corpo: mudancas,
      });
      onAtualizado(d, "Alterações guardadas na linha do tempo.");
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <Cartao>
      <form onSubmit={guardar} className="flex flex-col gap-3 p-5">
        <RotuloSeccao>Gerir o processo</RotuloSeccao>
        <Campo rotulo="Fase">
          {(id) => (
            <select
              id={id}
              value={fase}
              onChange={(e) => setFase(e.target.value as Fase)}
              className={CAMPO_CREME}
            >
              {FASES.map((f) => (
                <option key={f} value={f}>
                  {FASE_ROTULO[f]}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo rotulo="Técnico">
          {(id) => (
            <select
              id={id}
              value={tecnico}
              onChange={(e) => setTecnico(e.target.value)}
              className={CAMPO_CREME}
            >
              <option value="">Sem técnico</option>
              {[...opcoesTecnico].map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo rotulo="Decisão">
          {(id) => (
            <select
              id={id}
              value={decisao}
              onChange={(e) => setDecisao(e.target.value)}
              className={CAMPO_CREME}
            >
              <option value="">Ainda sem decisão</option>
              <option value="admitido">Admitido</option>
              <option value="indeferido">Indeferido</option>
            </select>
          )}
        </Campo>
        {avisaDecisao && haMudancas && (
          <p className="rounded-lg bg-ambar-suave px-3 py-2 text-xs text-ambar">
            Com a fase Decisão ou Notificado, a decisão segue por SMS ao
            munícipe (uma vez por decisão).
          </p>
        )}
        <ErroEmLinha erro={erro} />
        <Botao
          type="submit"
          icone={Save}
          tamanho="pequeno"
          disabled={!haMudancas || aGuardar}
          className="self-start"
        >
          {aGuardar ? "A guardar…" : "Guardar"}
        </Botao>
      </form>
    </Cartao>
  );
}

// ---------------------------------------------------------------------------

const VERIFICACAO: Record<
  DocumentoProcesso["verificacao_estado"],
  { icone: typeof FileCheck; cor: string; rotulo: string }
> = {
  valido: { icone: FileCheck, cor: "text-verde", rotulo: "verificado" },
  por_verificar: { icone: FileClock, cor: "text-tinta-3", rotulo: "por verificar" },
  fora_de_prazo: { icone: FileX, cor: "text-ambar", rotulo: "fora de validade" },
  documento_errado: { icone: FileX, cor: "text-terracota-escuro", rotulo: "documento errado" },
  ilegivel: { icone: FileX, cor: "text-terracota-escuro", rotulo: "ilegível" },
};

export function CartaoDocumentos({ p }: { p: ProcessoDetalhe }) {
  const exigidos = p.documentos_resumo.tem.length + p.documentos_resumo.faltam.length;
  const validos = p.documentos.filter((d) => d.verificacao_estado === "valido").length;
  const faltam = p.documentos_resumo.em_falta;

  return (
    <Cartao className="p-5">
      <div className="flex items-center justify-between gap-2 pb-2">
        <RotuloSeccao>Documentos</RotuloSeccao>
        {exigidos > 0 &&
          (faltam.length === 0 ? (
            <Chip tom="verde" icone={Check}>
              {p.documentos_resumo.tem.length} de {exigidos} · pré-validados
            </Chip>
          ) : (
            <Chip tom="ambar" icone={FileX}>
              {faltam.length === 1 ? "falta 1" : `faltam ${faltam.length}`}
            </Chip>
          ))}
      </div>
      {p.documentos.length === 0 && faltam.length === 0 ? (
        <p className="py-2 text-[13px] text-tinta-3">Sem documentos.</p>
      ) : (
        <ul>
          {p.documentos.map((d) => {
            const v = VERIFICACAO[d.verificacao_estado] ?? VERIFICACAO.por_verificar;
            const Icone = v.icone;
            const falhas = (d.verificacao ?? []).filter((r) => !r.ok);
            const nome =
              d.tipo_documento ?? (d.origem === "gerado" ? "Documento gerado" : "Documento");
            return (
              <li
                key={d.id}
                className="flex items-start gap-2.5 border-b border-linha py-2 last:border-b-0"
              >
                <Icone className={`mt-0.5 size-[15px] shrink-0 ${v.cor}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-tinta">{nome}</p>
                  <p className={`text-[11px] ${v.cor}`}>
                    {v.rotulo}
                    {d.emitido_em ? ` · emitido a ${diaCurto(d.emitido_em)}` : ""}
                    {d.origem === "gerado" ? " · gerado pelo sistema" : ""}
                  </p>
                  {falhas.map((f) => (
                    <p key={f.regra} className="text-[11px] text-tinta-2">
                      {f.detalhe}
                    </p>
                  ))}
                </div>
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Abrir ${nome} (nova janela)`}
                    className="rounded p-0.5 text-tinta-3 hover:text-tinta"
                  >
                    <Eye className="size-[15px]" aria-hidden />
                  </a>
                ) : null}
              </li>
            );
          })}
          {faltam.map((f) => (
            <li
              key={`falta-${f.nome}`}
              className="flex items-start gap-2.5 border-b border-linha py-2 last:border-b-0"
            >
              <FileX className="mt-0.5 size-[15px] shrink-0 text-ambar" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-tinta">{f.nome}</p>
                <p className="text-[11px] text-ambar">
                  em falta{f.prazo ? ` · pedido até ${diaCurto(f.prazo)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!p.armazenamento_disponivel && p.documentos.length > 0 && (
        <p className="pt-2 text-[11px] text-tinta-3">
          Sem armazenamento configurado: os ficheiros não se podem abrir aqui.
        </p>
      )}
      <p className="sr-only">
        {validos} documentos verificados de {p.documentos.length} entregues.
      </p>
    </Cartao>
  );
}

export function CartaoPedidos({ p }: { p: ProcessoDetalhe }) {
  if (p.pedidos.length === 0) return null;
  return (
    <Cartao className="p-5">
      <RotuloSeccao className="pb-2">Pedidos ao munícipe</RotuloSeccao>
      <ul>
        {p.pedidos.map((x) => (
          <li
            key={x.id}
            className="flex items-start justify-between gap-3 border-b border-linha py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-[13px] text-tinta">{x.descricao}</p>
              <p className="text-[11px] text-tinta-3">
                pedido a {diaCurto(x.pedido_em)} · prazo {diaCurto(x.prazo)}
                {x.lembrete_enviado_em ? " · lembrete enviado" : ""}
              </p>
            </div>
            {x.estado === "respondido" ? (
              <Chip tom="verde" pequeno icone={Check}>
                respondido
              </Chip>
            ) : x.estado === "fora_de_prazo" ? (
              <Chip tom="erro" pequeno>
                fora de prazo
              </Chip>
            ) : (
              <Chip tom="ambar" pequeno>
                {textoDiasUteis(x.dias_uteis_restantes)}
              </Chip>
            )}
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

export function CartaoRequerente({ p }: { p: ProcessoDetalhe }) {
  const m = p.municipe;
  const r = p.requerimento;
  return (
    <Cartao className="flex flex-col gap-2 p-5">
      <RotuloSeccao>Requerente</RotuloSeccao>
      {m ? (
        <>
          <p className="text-[15px] font-bold text-tinta">{m.nome ?? "Sem nome"}</p>
          <p className="text-[13px] text-tinta-2">
            {[
              m.telefone,
              m.tem_email ? "tem email" : null,
              m.tem_nif ? "NIF registado" : "sem NIF",
              m.canal_preferido ? `prefere ${m.canal_preferido === "sms" ? "SMS" : m.canal_preferido}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </>
      ) : (
        <p className="text-[13px] text-tinta-3">Sem munícipe associado.</p>
      )}
      {r && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs">
          {r.pdf_url && (
            <a
              href={r.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-terracota-escuro hover:underline"
            >
              Requerimento assinado (PDF)
            </a>
          )}
          {r.conversa_id && (
            <Link
              href={`/painel/conversas/${r.conversa_id}`}
              className="font-semibold text-terracota-escuro hover:underline"
            >
              {m && m.conversas > 1 ? `${m.conversas} conversas com o agente` : "Ver a conversa"}
            </Link>
          )}
          {r.assinatura_simulada && (
            <span className="text-tinta-3">assinatura simulada</span>
          )}
        </div>
      )}
    </Cartao>
  );
}

// ---------------------------------------------------------------------------

const MapaProcesso = dynamic(() => import("./mapa-processo"), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center bg-creme-2 text-xs text-tinta-3">
      A carregar o mapa…
    </div>
  ),
});

/** Planta de localização: JSON com o documento, ou o PDF sem guardar. */
export function CartaoLocalizacao({
  p,
  onPlanta,
}: {
  p: ProcessoDetalhe;
  onPlanta: () => void;
}) {
  const { pedidoFicheiro } = useSessao();
  const [aGerar, setAGerar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const planta = p.documentos.find(
    (d) => d.origem === "gerado" && /planta/i.test(d.tipo_documento ?? ""),
  );
  const local = [p.morada, p.freguesia].filter(Boolean).join(", ");

  async function gerar() {
    setAGerar(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await pedidoFicheiro<{ url: string | null; geocodificada: boolean }>(
        `/v1/painel/processos/${p.id}/planta`,
        { corpo: {} },
      );
      if (r.tipo === "ficheiro") {
        const url = URL.createObjectURL(r.blob);
        window.open(url, "_blank", "noopener");
        setAviso(
          "Sem armazenamento configurado: a planta abriu numa janela nova e não ficou guardada no processo.",
        );
      } else {
        const j = r.dados;
        if (j.url) window.open(j.url, "_blank", "noopener");
        setAviso(
          j.geocodificada
            ? "Planta gerada a partir da morada e guardada nos documentos."
            : "Planta gerada e guardada nos documentos.",
        );
        onPlanta();
      }
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGerar(false);
    }
  }

  return (
    <Cartao className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center justify-between">
        <RotuloSeccao>Localização</RotuloSeccao>
        {local && (
          <a
            href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(local)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-terracota-escuro hover:underline"
          >
            Abrir no mapa
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(nova janela)</span>
          </a>
        )}
      </div>
      <p className="text-[13px] text-tinta">{local || "Sem morada registada."}</p>
      {p.zona_pdm && (
        <div className="flex flex-wrap gap-1.5">
          <Chip tom="neutro" pequeno>
            PDM · {p.zona_pdm.nome}
          </Chip>
          {p.zona_pdm.categoria !== "protecao" && (
            <Chip tom="neutro" pequeno>
              Fora de zona de proteção
            </Chip>
          )}
          {p.zona_pdm.demonstracao && (
            <Chip tom="ambar" pequeno>
              zonas de demonstração
            </Chip>
          )}
        </div>
      )}
      {typeof p.lat === "number" && typeof p.lng === "number" && (
        <div className="h-[160px] overflow-hidden rounded-xl border border-linha">
          <MapaProcesso lat={p.lat} lng={p.lng} rotulo={local || p.numero} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {planta ? (
          <>
            <Chip tom="neutro" pequeno>
              Planta gerada · {diaCurto(planta.recebido_em)}
            </Chip>
            {planta.url && (
              <a
                href={planta.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-terracota-escuro hover:underline"
              >
                Abrir planta
              </a>
            )}
          </>
        ) : null}
      </div>
      <Botao
        variante="secundario"
        tamanho="pequeno"
        icone={MapaIcone}
        onClick={gerar}
        disabled={aGerar}
        className="self-start"
      >
        {aGerar ? "A gerar…" : planta ? "Gerar outra planta" : "Gerar planta de localização"}
      </Botao>
      {aviso && <p className="text-xs text-verde" role="status">{aviso}</p>}
      <ErroEmLinha erro={erro} />
    </Cartao>
  );
}

// ---------------------------------------------------------------------------

export interface EstadoSync {
  erro: boolean;
  texto: string;
  detalhe: string | null;
  em: string | null;
  tentativa: number | null;
}

/**
 * O estado da gestão documental deste processo: o resultado do "sincronizar
 * já" desta visita, senão `gestao_documental` da ficha (o último evento
 * 'sync_erro' só dá a hora do erro quando a API não a traz).
 */
export function estadoSync(
  p: ProcessoDetalhe,
  local: ResultadoSincronizacao | null,
): EstadoSync | null {
  if (local) {
    if (local.gd_estado === "sincronizado") {
      return {
        erro: false,
        texto: `Na gestão documental${local.gd_id ? `: n.º ${local.gd_id}` : ""}`,
        detalhe: null,
        em: null,
        tentativa: null,
      };
    }
    if (local.gd_estado === "erro") {
      return {
        erro: true,
        texto: `Gestão documental: por sincronizar · ${local.gd_tentativas} ${
          local.gd_tentativas === 1 ? "tentativa" : "tentativas"
        }`,
        detalhe: local.erro,
        em: new Date().toISOString(),
        tentativa: local.gd_tentativas,
      };
    }
    return null;
  }
  const ultimo = [...p.eventos].reverse().find((e) => e.tipo === "sync_erro");
  const g = p.gestao_documental;
  if (g) {
    if (g.estado === "erro") {
      const n = g.tentativas;
      return {
        erro: true,
        texto: `Gestão documental: por sincronizar${
          n ? ` · ${n} ${n === 1 ? "tentativa" : "tentativas"}` : ""
        }`,
        detalhe: g.ultimo_erro,
        em: g.ultimo_erro_em ?? ultimo?.em ?? null,
        tentativa: n || null,
      };
    }
    if (g.estado === "sincronizado") {
      return {
        erro: false,
        texto: `Na gestão documental${g.gd_id ? `: n.º ${g.gd_id}` : ""}`,
        detalhe: null,
        em: null,
        tentativa: null,
      };
    }
    if (g.estado === "por_sincronizar") {
      return {
        erro: false,
        texto: "Gestão documental: por sincronizar",
        detalhe: null,
        em: null,
        tentativa: null,
      };
    }
    return null;
  }
  if (!ultimo) return null;
  const dados = (ultimo.dados ?? {}) as { tentativa?: number; erro?: string };
  return {
    erro: true,
    texto: `Gestão documental: por sincronizar${
      dados.tentativa ? ` · ${dados.tentativa} ${dados.tentativa === 1 ? "tentativa" : "tentativas"}` : ""
    }`,
    detalhe: dados.erro ?? null,
    em: ultimo.em,
    tentativa: dados.tentativa ?? null,
  };
}

export function CartaoSincronizacao({
  estado,
  aSincronizar,
  onSincronizar,
}: {
  estado: EstadoSync | null;
  aSincronizar: boolean;
  onSincronizar: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs ${
        estado?.erro ? "bg-[#F8DCD6] font-semibold text-[#8E2216]" : "bg-creme-2 text-tinta-2"
      }`}
    >
      {estado?.erro ? (
        <CloudOff className="size-3.5 shrink-0 text-[#C62F1F]" aria-hidden />
      ) : (
        <RefreshCw className="size-3.5 shrink-0 text-tinta-2" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        {estado?.texto ?? "Gestão documental: sem erros de envio"}
        {estado?.em && estado.erro && (
          <span className="block font-normal">último erro a {diaHora(estado.em)}</span>
        )}
      </span>
      <button
        type="button"
        onClick={onSincronizar}
        disabled={aSincronizar}
        className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
      >
        {aSincronizar ? "A enviar…" : "Sincronizar já"}
      </button>
    </div>
  );
}

export function NotaFicha({
  mensagem,
  onFechar,
}: {
  mensagem: { tom: "verde" | "ambar" | "erro"; texto: string } | null;
  onFechar: () => void;
}) {
  if (!mensagem) return null;
  return (
    <Nota tom={mensagem.tom} onFechar={onFechar}>
      {mensagem.texto}
    </Nota>
  );
}
