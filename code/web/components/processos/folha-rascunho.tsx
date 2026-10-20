"use client";

import {
  BadgeCheck,
  Check,
  FileText,
  History,
  Pencil,
  PenLine,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import {
  contarSms,
  diaHora,
  diaLongo,
  semAcentos,
  textoSms,
} from "./formatos";
import type { ProcessoDetalhe, Rascunho } from "./tipos";
import {
  BotaoPainel,
  Chip,
  ErroEmLinha,
  paraErro,
  RotuloSeccao,
} from "./ui";

/*
 * O rascunho na folha (frames tjX6g, uc2Hf e IbPF4): ofício e pedido de
 * elementos em papel com letra serifada; SMS num telemóvel com a contagem
 * de partes. Editar cria uma versão nova; as anteriores ficam à vista.
 */

const AVISO_CANAL: Record<string, string> = {
  sms: "O munícipe foi avisado por SMS.",
  email: "O munícipe foi avisado por email.",
  chamada: "O agente vai ligar ao munícipe a avisar.",
  sem_contacto: "O munícipe não tem contacto: avise-o por outra via.",
};

function Assinatura({ r }: { r: Rascunho }) {
  if (!r.assinado_em) return null;
  return (
    <div className="flex flex-col gap-1.5 pt-2.5">
      <p className="flex items-center gap-2.5 font-serif text-xs text-tinta-2">
        <BadgeCheck className="size-4 shrink-0 text-verde" aria-hidden />
        {r.assinatura_simulada ? "Assinatura simulada" : "Assinado"} por{" "}
        {r.assinado_por?.nome ?? "—"} · {diaHora(r.assinado_em)}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {r.pdf_url && (
          <a
            href={r.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-terracota-escuro hover:underline"
          >
            Abrir o PDF
          </a>
        )}
        {r.pdf_aviso && <span className="text-ambar">{r.pdf_aviso}</span>}
        {r.aviso && AVISO_CANAL[r.aviso] && (
          <span className="text-tinta-2">{AVISO_CANAL[r.aviso]}</span>
        )}
      </div>
    </div>
  );
}

function EstadoChip({ r }: { r: Rascunho }) {
  if (r.estado === "rascunho")
    return (
      <Chip tom="terracota" icone={Sparkles}>
        {r.versoes[r.versoes.length - 1]?.origem === "ia" || r.versao === 1
          ? "Rascunho gerado. Reveja antes de assinar."
          : `Rascunho editado (versão ${r.versao}). Reveja antes de assinar.`}
      </Chip>
    );
  if (r.estado === "descartado")
    return (
      <Chip tom="neutro" icone={Trash2}>
        Descartado{r.descartado_em ? ` a ${diaLongo(r.descartado_em)}` : ""}
      </Chip>
    );
  return (
    <Chip tom="verde" icone={Check}>
      Aprovado
    </Chip>
  );
}

function TelemovelSms({ texto }: { texto: string }) {
  return (
    <div className="flex w-[280px] shrink-0 flex-col gap-2.5 rounded-[36px] border border-linha bg-white px-3 pb-5 pt-3.5 shadow-sm">
      <div className="flex flex-col items-center gap-1 pb-1.5 pt-1">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-full bg-terracota font-display text-xl font-extrabold text-white"
        >
          ?
        </span>
        <span className="text-[11px] font-medium text-[#111111]">TouCamara</span>
      </div>
      <p className="whitespace-pre-wrap rounded-[16px_16px_16px_4px] bg-[#E9E9EB] px-3 py-[9px] text-[13px] text-[#111111]">
        {texto}
      </p>
    </div>
  );
}

export function FolhaRascunho({
  r,
  processo,
  onAtualizado,
  onAssinar,
}: {
  r: Rascunho;
  processo: ProcessoDetalhe;
  onAtualizado: (r: Rascunho, mensagem?: string) => void;
  onAssinar: (r: Rascunho) => void;
}) {
  const { pedido } = useSessao();
  const [aEditar, setAEditar] = useState(false);
  const [texto, setTexto] = useState(r.corpo);
  const [versaoVista, setVersaoVista] = useState<number | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const aberto = r.estado === "rascunho";
  const antiga =
    versaoVista !== null && versaoVista !== r.versao
      ? r.versoes.find((v) => v.versao === versaoVista)
      : null;
  const corpo = antiga ? antiga.corpo : r.corpo;
  const eSms = r.tipo === "notificacao_sms";

  async function guardar() {
    setAGuardar(true);
    setErro(null);
    try {
      const novo = await pedido<Rascunho>(`/v1/painel/rascunhos/${r.id}`, {
        metodo: "PATCH",
        corpo: { corpo: texto },
      });
      setAEditar(false);
      setVersaoVista(null);
      onAtualizado(
        novo,
        novo.versao === r.versao
          ? "Sem alterações ao texto."
          : `Guardada a versão ${novo.versao}. A anterior continua no histórico.`,
      );
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGuardar(false);
    }
  }

  async function descartar() {
    if (!window.confirm("Descartar este rascunho? Continua no histórico, mas já não se pode aprovar.")) return;
    setAGuardar(true);
    setErro(null);
    try {
      const novo = await pedido<Rascunho>(
        `/v1/painel/rascunhos/${r.id}/descartar`,
        { corpo: {} },
      );
      onAtualizado(novo, "Rascunho descartado.");
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGuardar(false);
    }
  }

  const barraVersoes = r.versoes.length > 1 && !aEditar && (
    <label className="flex items-center gap-2 text-xs font-semibold text-tinta-2">
      <History className="size-3.5" aria-hidden />
      <span>Versão</span>
      <select
        value={versaoVista ?? r.versao}
        onChange={(e) => setVersaoVista(Number(e.target.value))}
        className="rounded-md border border-linha bg-papel px-2 py-1 text-xs"
      >
        {[...r.versoes].reverse().map((v) => (
          <option key={v.versao} value={v.versao}>
            {v.versao} · {v.origem === "ia" ? "IA" : (v.autor ?? "técnico")} ·{" "}
            {diaHora(v.em)}
            {v.versao === r.versao ? " (atual)" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  const acoes = (
    <div className="flex flex-wrap items-center gap-2">
      {aberto && !aEditar && (
        <>
          <BotaoPainel
            pequeno
            icone={Pencil}
            onClick={() => {
              setTexto(r.corpo);
              setVersaoVista(null);
              setAEditar(true);
            }}
          >
            Editar
          </BotaoPainel>
          <BotaoPainel
            pequeno
            variante="texto"
            icone={Trash2}
            onClick={descartar}
            disabled={aGuardar}
          >
            Descartar
          </BotaoPainel>
          <BotaoPainel
            pequeno
            variante="principal"
            icone={PenLine}
            onClick={() => onAssinar(r)}
          >
            Aprovar e assinar
          </BotaoPainel>
        </>
      )}
      {aEditar && (
        <>
          <BotaoPainel
            pequeno
            variante="texto"
            onClick={() => setAEditar(false)}
            disabled={aGuardar}
          >
            Cancelar
          </BotaoPainel>
          <BotaoPainel
            pequeno
            variante="tinta"
            icone={Check}
            onClick={guardar}
            disabled={aGuardar || !texto.trim()}
          >
            {aGuardar ? "A guardar…" : `Guardar como versão ${r.versao + 1}`}
          </BotaoPainel>
        </>
      )}
    </div>
  );

  const editor = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`corpo-${r.id}`} className="sr-only">
        Texto do {r.tipo_rotulo.toLowerCase()}
      </label>
      <textarea
        id={`corpo-${r.id}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={eSms ? 6 : 18}
        maxLength={20000}
        className="w-full rounded-md border border-linha bg-white p-3 font-serif text-[15px] leading-relaxed text-tinta"
      />
      {eSms && (
        <p className="text-xs text-tinta-3">{textoSms(contarSms(texto))}</p>
      )}
    </div>
  );

  if (eSms) {
    const c = contarSms(corpo);
    const s = contarSms(semAcentos(corpo));
    const m = processo.municipe;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-8 rounded-2xl border border-linha bg-papel px-9 py-8">
          <TelemovelSms texto={aEditar ? texto : corpo} />
          <div className="flex min-w-[260px] flex-1 flex-col gap-4">
            <h3 className="font-display text-xl font-bold text-tinta">
              Aviso ao munícipe
            </h3>
            <EstadoChip r={r} />
            <div className="flex flex-col gap-1.5">
              <RotuloSeccao as="p" className="text-[10px]">
                Contagem
              </RotuloSeccao>
              <div className="flex flex-wrap gap-2">
                <Chip tom={c.segmentos > 1 ? "ambar" : "verde"} pequeno icone={Check}>
                  {textoSms(c)}
                  {c.codificacao === "ucs2" ? " por causa dos acentos" : ""}
                </Chip>
                {c.codificacao === "ucs2" && (
                  <Chip tom="neutro" pequeno>
                    Sem acentos: {s.segmentos} SMS
                  </Chip>
                )}
              </div>
              <p className="text-xs text-tinta-3">
                Ao enviar, junta-se o link do processo no fim.
              </p>
            </div>
            <div className="flex items-center gap-2.5 rounded-[10px] bg-creme-2 p-3 text-[13px] text-tinta">
              <UserRound className="size-[15px] shrink-0 text-tinta-2" aria-hidden />
              {m
                ? `${m.nome ?? "Munícipe"}${m.telefone ? ` · ${m.telefone}` : " · sem telefone"}`
                : "Processo sem munícipe associado"}
            </div>
            {aEditar && editor}
            {barraVersoes}
            <Assinatura r={r} />
            <ErroEmLinha erro={erro} />
            {acoes}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <article className="flex flex-col gap-3.5 rounded-md bg-white px-11 py-9 shadow-[0_1px_3px_rgba(21,38,59,0.08)]">
        <EstadoChip r={r} />
        <header className="flex flex-col gap-1.5">
          <h3 className="font-serif text-lg font-bold uppercase text-tinta">
            {r.tipo_rotulo}
          </h3>
          <p className="font-serif text-sm text-tinta-2">
            Processo {processo.numero} · {processo.tipo.nome}
            <br />
            {processo.municipe?.nome ? `Requerente: ${processo.municipe.nome}` : ""}
            {processo.morada
              ? `${processo.municipe?.nome ? " · " : ""}Local: ${processo.morada}`
              : ""}
          </p>
        </header>
        {antiga && (
          <p className="rounded-md bg-creme-2 px-2.5 py-1.5 text-xs text-tinta-2">
            A ver a versão {antiga.versao} (
            {antiga.origem === "ia" ? "gerada pela IA" : `de ${antiga.autor ?? "um técnico"}`}
            ). A atual é a {r.versao}.
          </p>
        )}
        {aEditar ? (
          editor
        ) : (
          <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-tinta">
            {corpo}
          </div>
        )}
        {r.documentos_pedidos && r.documentos_pedidos.length > 0 && (
          <div className="flex flex-col gap-1 rounded-[10px] bg-creme p-3.5">
            <RotuloSeccao as="p" className="text-[10px]">
              Documentos pedidos
              {r.prazo_dias_uteis ? ` · prazo de ${r.prazo_dias_uteis} dias úteis` : ""}
            </RotuloSeccao>
            <ul className="list-inside list-disc text-[13px] text-tinta">
              {r.documentos_pedidos.map((d) => (
                <li key={d.nome}>{d.nome}</li>
              ))}
            </ul>
          </div>
        )}
        {r.artigos_citados.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-tinta-3">Cita:</span>
            {r.artigos_citados.map((a) => (
              <Chip key={`${a.referencia}-${a.fonte}`} tom="verde" pequeno icone={FileText} title={a.fonte}>
                {a.referencia}
              </Chip>
            ))}
          </div>
        )}
        <Assinatura r={r} />
      </article>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {barraVersoes || <span />}
        {acoes}
      </div>
      <ErroEmLinha erro={erro} />
    </div>
  );
}
