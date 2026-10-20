"use client";

import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useSessao } from "@/lib/sessao";
import { useServicosEPessoas } from "./equipa";
import { mensagemErro } from "./formatos";
import type { PedidoEntrada } from "./tipos";

const campo =
  "h-10 w-full rounded-[10px] border border-linha bg-papel px-3 text-[13px] font-normal text-tinta";

/** Data e hora local do browser → ISO com fuso (o que a API pede). */
function isoComFuso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? "+" : "-";
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const m = String(Math.abs(off) % 60).padStart(2, "0");
  return `${local.length === 16 ? `${local}:00` : local}${s}${h}:${m}`;
}

/**
 * "Pedido de balcão": regista um atendimento presencial na Entrada (fica
 * também como conversa do canal balcão). Abre num diálogo.
 */
export function BotaoBalcao({ aoCriar }: { aoCriar: (p: PedidoEntrada) => void }) {
  const { pedido, pode } = useSessao();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [aberto, setAberto] = useState(false);
  const { servicos, disponivel } = useServicosEPessoas(aberto);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!pode("entrada")) return null;

  function abrir() {
    setErro(null);
    setAberto(true);
    dialogo.current?.showModal();
  }
  function fechar() {
    dialogo.current?.close();
    setAberto(false);
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const texto = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v || undefined;
    };
    setAEnviar(true);
    setErro(null);
    try {
      const p = await pedido<PedidoEntrada>("/v1/painel/entrada/balcao", {
        corpo: {
          nome: texto("nome"),
          telefone: texto("telefone"),
          nif: texto("nif"),
          assunto: texto("assunto"),
          descricao: texto("descricao"),
          servico_id: texto("servico_id"),
          urgente: f.get("urgente") === "on",
          prazo_resposta: isoComFuso(String(f.get("prazo") ?? "")),
        },
      });
      form.reset();
      fechar();
      aoCriar(p);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-tinta px-3.5 text-[13px] font-semibold text-white hover:bg-tinta/90"
      >
        <Plus className="size-[15px]" aria-hidden />
        Pedido de balcão
      </button>
      <dialog
        ref={dialogo}
        onClose={() => setAberto(false)}
        aria-labelledby="balcao-titulo"
        className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-linha bg-papel p-0 text-tinta backdrop:bg-tinta/40"
      >
        <form onSubmit={enviar} className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="balcao-titulo" className="font-display text-xl font-bold">
                Pedido de balcão
              </h2>
              <p className="text-[13px] text-tinta-2">
                Registe o atendimento presencial. Fica na Entrada, já encaminhado.
              </p>
            </div>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              className="rounded-md p-1 text-tinta-3 hover:bg-creme hover:text-tinta"
            >
              <X className="size-5" />
            </button>
          </div>

          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <legend className="sr-only">Munícipe</legend>
            <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2 sm:col-span-3">
              Nome
              <input name="nome" maxLength={200} autoComplete="off" className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2 sm:col-span-2">
              Telefone
              <input name="telefone" type="tel" maxLength={40} autoComplete="off" className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
              NIF
              <input
                name="nif"
                inputMode="numeric"
                pattern="\d{9}"
                title="NIF com 9 dígitos"
                autoComplete="off"
                className={campo}
              />
            </label>
          </fieldset>

          <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
            Assunto *
            <input name="assunto" required maxLength={300} className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
            O que pediu *
            <textarea
              name="descricao"
              required
              rows={4}
              maxLength={10000}
              className="w-full rounded-[10px] border border-linha bg-papel p-3 text-[13px] font-normal text-tinta"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
              Serviço
              <select name="servico_id" className={campo} defaultValue="">
                <option value="">
                  {disponivel ? "Encaminhar automaticamente" : "Encaminhamento automático"}
                </option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
              Responder até
              <input name="prazo" type="datetime-local" className={campo} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-tinta">
            <input name="urgente" type="checkbox" className="size-4 accent-terracota" />
            Urgente
          </label>

          {erro && (
            <p role="alert" className="text-[13px] text-terracota-escuro">
              {erro}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={fechar}
              className="h-10 rounded-full px-4 text-sm font-semibold text-tinta-2 hover:bg-creme"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={aEnviar}
              className="h-10 rounded-full bg-terracota px-5 text-sm font-semibold text-white hover:bg-terracota-escuro disabled:opacity-60"
            >
              {aEnviar ? "A registar…" : "Registar pedido"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
