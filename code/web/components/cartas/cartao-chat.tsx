"use client";

import { CalendarClock, FileQuestion, FolderOpen, Mail, PenLine } from "lucide-react";

/*
 * Cartão do chat de "Não percebi esta carta" (ferramentas ler_carta e
 * preparar_resposta_carta): o tipo de carta, o prazo calculado, o processo
 * e o link da página com a explicação e o rascunho.
 */

type Dados = Record<string, unknown>;
const txt = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const obj = (v: unknown): Dados =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Dados) : {};

const ROTULOS: Record<string, string> = {
  pronuncia: "Responder por escrito",
  prorrogacao: "Pedir mais tempo",
  elementos: "Enviar os documentos",
  pagamento: "Pagar",
};

const CAIXA =
  "flex w-full flex-col gap-2.5 rounded-[4px_18px_18px_18px] border border-linha bg-papel p-4";

function Abrir({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-terracota px-3 text-[14px] font-semibold text-white transition-colors hover:bg-terracota-escuro"
    >
      {children}
    </a>
  );
}

export function CartaoChatCarta({
  ferramenta,
  dados,
  enviar,
  ocupado,
}: {
  ferramenta: string;
  dados: Dados;
  enviar: (t: string) => void;
  ocupado: boolean;
}) {
  const link = txt(dados.link);

  if (ferramenta === "preparar_resposta_carta") {
    const r = obj(dados.resposta);
    return (
      <div className={CAIXA}>
        <span className="text-[10px] font-bold uppercase tracking-[1px] text-tinta-3">
          Rascunho da resposta · por confirmar
        </span>
        <p className="flex items-center gap-2 text-[15px] font-bold text-tinta">
          <PenLine className="size-4 text-terracota" aria-hidden />
          {txt(r.rotulo) ?? "Resposta"}
        </p>
        <p className="line-clamp-4 whitespace-pre-line text-[13px] leading-[1.45] text-tinta-2">
          {txt(r.texto)}
        </p>
        <p className="text-xs text-tinta-3">
          Nada é entregue sem a sua confirmação na página.
        </p>
        {link && <Abrir href={link}>Rever e confirmar</Abrir>}
      </div>
    );
  }

  if (dados.a_espera_da_carta === true) {
    return dados.sms_enviado === true ? (
      <div className={CAIXA}>
        <p className="flex items-center gap-2 text-[14px] font-semibold text-tinta">
          <Mail className="size-4 text-terracota" aria-hidden />
          Enviámos o link por SMS para fotografar a carta.
        </p>
      </div>
    ) : null;
  }

  if (dados.da_camara === false) {
    return (
      <div className={CAIXA}>
        <span className="text-[10px] font-bold uppercase tracking-[1px] text-tinta-3">
          Esta carta não é da câmara
        </span>
        <p className="text-[15px] font-bold text-tinta">
          {txt(dados.entidade) ?? "Outra entidade"}
        </p>
        <p className="text-[13px] text-tinta-2">
          Só quem mandou a carta pode tratar dela.
        </p>
      </div>
    );
  }

  const prazo = obj(dados.prazo);
  const faltam = num(prazo.faltam_dias_uteis);
  const respostas = Array.isArray(dados.respostas_possiveis)
    ? dados.respostas_possiveis.filter((x): x is string => typeof x === "string")
    : [];
  const processo = obj(dados.processo);
  return (
    <div className={CAIXA}>
      <span className="text-[10px] font-bold uppercase tracking-[1px] text-tinta-3">
        A sua carta, explicada
      </span>
      <p className="flex items-start gap-2 text-[15px] font-bold text-tinta">
        <FileQuestion className="mt-0.5 size-4 shrink-0 text-terracota" aria-hidden />
        {txt(dados.tipo_rotulo) ?? "Carta da câmara"}
      </p>
      {prazo.estado === "calculado" && txt(prazo.data_limite_dita) ? (
        <div className="flex items-center gap-2.5 rounded-[14px] bg-terracota px-3.5 py-2.5 text-white">
          <CalendarClock className="size-5 shrink-0" aria-hidden />
          <span className="text-[14px] leading-tight">
            {prazo.terminou === true ? (
              <>O prazo terminou a <b>{txt(prazo.data_limite_dita)}</b></>
            ) : (
              <>
                Até <b>{txt(prazo.data_limite_dita)}</b>
                {faltam !== null &&
                  ` · faltam ${faltam} ${faltam === 1 ? "dia útil" : "dias úteis"}`}
              </>
            )}
          </span>
        </div>
      ) : (
        <p className="rounded-[14px] bg-ambar-suave px-3.5 py-2.5 text-[13px] text-tinta">
          {prazo.estado === "falta_data"
            ? "Para calcular o prazo, diga em que dia recebeu a carta."
            : "Não encontrámos um prazo escrito na carta."}
        </p>
      )}
      {txt(processo.numero) && (
        <p className="flex items-center gap-2 text-[13px] text-tinta-2">
          <FolderOpen className="size-4 shrink-0" aria-hidden />
          Processo {txt(processo.numero)}: {txt(processo.fase)}
        </p>
      )}
      {dados.demonstracao === true && (
        <p className="text-[11px] font-semibold text-ambar">
          Leitura de demonstração.
        </p>
      )}
      {respostas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {respostas.map((t) => (
            <button
              key={t}
              type="button"
              disabled={ocupado}
              onClick={() => enviar(`Quero ${(ROTULOS[t] ?? t).toLowerCase()}.`)}
              className="inline-flex min-h-10 items-center rounded-full border-[1.5px] border-tinta px-3.5 text-[13px] font-semibold text-tinta hover:bg-tinta/5 disabled:opacity-50"
            >
              {ROTULOS[t] ?? t}
            </button>
          ))}
        </div>
      )}
      {link && <Abrir href={link}>Ver a explicação completa</Abrir>}
    </div>
  );
}
