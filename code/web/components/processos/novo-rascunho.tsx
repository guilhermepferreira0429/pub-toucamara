"use client";

import { Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import {
  TIPO_RASCUNHO_ROTULO,
  type Modelo,
  type Pagina,
  type ProcessoDetalhe,
  type Rascunho,
  type TipoProcesso,
  type TipoRascunho,
} from "./tipos";
import {
  ACarregar,
  AREA_TEXTO,
  BotaoPainel,
  CAMPO,
  Campo,
  ErroEmLinha,
  paraErro,
  usePedido,
} from "./ui";

/*
 * Pedir à IA um rascunho (POST /processos/:id/rascunhos): modelo aprovado
 * da câmara, documentos a pedir (pedido de elementos), prazo e instruções.
 */

type Pedido =
  | { tipo_documento_id: string; nome: string }
  | { texto: string; nome: string };

export function NovoRascunho({
  tipo,
  processo,
  onCriado,
  onCancelar,
}: {
  tipo: TipoRascunho;
  processo: ProcessoDetalhe;
  onCriado: (r: Rascunho) => void;
  onCancelar?: () => void;
}) {
  const { pedido } = useSessao();
  const canal = tipo === "notificacao_sms" ? "sms" : "oficio";
  const modelos = usePedido<Pagina<Modelo>>(
    `/v1/painel/modelos?canal=${canal}&estado=aprovado&limite=100`,
  );
  const tipos = usePedido<{ itens: TipoProcesso[] }>(
    tipo === "pedido_elementos" ? "/v1/painel/tipos-processo" : null,
  );
  const docsTipo = (
    tipos.dados?.itens.find((t) => t.id === processo.tipo.id)?.documentos ?? []
  ).filter((d) => !d.gerado_pelo_sistema);

  const [modeloId, setModeloId] = useState("");
  const [instrucoes, setInstrucoes] = useState("");
  const [prazo, setPrazo] = useState(10);
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null);
  const [livres, setLivres] = useState<string[]>([]);
  const [novoLivre, setNovoLivre] = useState("");
  const [aGerar, setAGerar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Por omissão, os documentos que faltam.
  const marcados =
    escolhidos ??
    docsTipo
      .filter((d) => processo.documentos_resumo.faltam.includes(d.nome))
      .map((d) => d.id);

  function alternar(id: string) {
    setEscolhidos(
      marcados.includes(id) ? marcados.filter((x) => x !== id) : [...marcados, id],
    );
  }

  async function gerar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    const corpo: Record<string, unknown> = { tipo };
    if (modeloId) corpo.modelo_id = modeloId;
    if (instrucoes.trim()) corpo.instrucoes = instrucoes.trim();
    if (tipo === "pedido_elementos") {
      const lista: Pedido[] = [
        ...docsTipo
          .filter((d) => marcados.includes(d.id))
          .map((d) => ({ tipo_documento_id: d.id, nome: d.nome })),
        ...livres.map((t) => ({ texto: t, nome: t })),
      ];
      if (!lista.length) {
        setErro("Escolha pelo menos um documento a pedir.");
        return;
      }
      corpo.documentos_pedidos = lista.map((x) =>
        "tipo_documento_id" in x
          ? { tipo_documento_id: x.tipo_documento_id }
          : { texto: x.texto },
      );
      corpo.prazo_dias_uteis = prazo;
    }
    setAGerar(true);
    try {
      const r = await pedido<Rascunho>(
        `/v1/painel/processos/${processo.id}/rascunhos`,
        { corpo },
      );
      onCriado(r);
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAGerar(false);
    }
  }

  const aprovados = modelos.dados?.itens ?? [];

  return (
    <form
      onSubmit={gerar}
      className="flex flex-col gap-4 rounded-2xl border border-linha bg-papel p-6"
      aria-busy={aGerar}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold text-tinta">
            Novo rascunho · {TIPO_RASCUNHO_ROTULO[tipo]}
          </h3>
          <p className="text-[13px] text-tinta-2">
            A IA escreve a partir do processo, do regulamento destacado e do
            modelo aprovado. Fica em rascunho até o aprovar.
          </p>
        </div>
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            aria-label="Fechar o novo rascunho"
            className="rounded-full p-1 text-tinta-3 hover:bg-creme-2 hover:text-tinta"
          >
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>

      <Campo
        rotulo="Modelo aprovado"
        ajuda={
          modelos.erro
            ? modelos.erro.message
            : aprovados.length === 0 && !modelos.aCarregar
              ? "Ainda não há modelos aprovados para este canal: a IA escreve sem modelo."
              : undefined
        }
      >
        {(id) => (
          <select
            id={id}
            value={modeloId}
            onChange={(e) => setModeloId(e.target.value)}
            className={CAMPO}
          >
            <option value="">O mais recente aprovado (automático)</option>
            {aprovados.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} · v{m.versao}
              </option>
            ))}
          </select>
        )}
      </Campo>

      {tipo === "pedido_elementos" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1.5 text-xs font-semibold text-tinta-2">
            Documentos a pedir
          </legend>
          {tipos.aCarregar && !tipos.dados ? (
            <ACarregar />
          ) : (
            docsTipo.map((d) => (
              <label key={d.id} className="flex items-center gap-2.5 text-[13px] text-tinta">
                <input
                  type="checkbox"
                  checked={marcados.includes(d.id)}
                  onChange={() => alternar(d.id)}
                  className="size-4 accent-terracota"
                />
                {d.nome}
                {processo.documentos_resumo.faltam.includes(d.nome) && (
                  <span className="text-xs text-ambar">em falta</span>
                )}
              </label>
            ))
          )}
          {livres.map((t) => (
            <span key={t} className="flex items-center gap-2 text-[13px] text-tinta">
              <input type="checkbox" checked readOnly className="size-4 accent-terracota" aria-label={t} />
              {t}
              <button
                type="button"
                onClick={() => setLivres(livres.filter((x) => x !== t))}
                aria-label={`Tirar ${t}`}
                className="text-tinta-3 hover:text-tinta"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          <div className="flex gap-2">
            <label htmlFor="outro-doc" className="sr-only">
              Outro documento a pedir
            </label>
            <input
              id="outro-doc"
              value={novoLivre}
              onChange={(e) => setNovoLivre(e.target.value)}
              placeholder="Outro elemento (texto livre)"
              maxLength={200}
              className={`${CAMPO} flex-1`}
            />
            <BotaoPainel
              icone={Plus}
              disabled={novoLivre.trim().length < 2}
              onClick={() => {
                const t = novoLivre.trim();
                if (t && !livres.includes(t)) setLivres([...livres, t]);
                setNovoLivre("");
              }}
            >
              Juntar
            </BotaoPainel>
          </div>
          <Campo rotulo="Prazo para entregar (dias úteis)" className="pt-1">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={120}
                value={prazo}
                onChange={(e) =>
                  setPrazo(Math.max(1, Math.min(120, Number(e.target.value) || 1)))
                }
                className={`${CAMPO} w-32`}
              />
            )}
          </Campo>
        </fieldset>
      )}

      <Campo
        rotulo="Instruções para a IA (opcional)"
        ajuda="Por exemplo: admitir, condicionado à confirmação de que a parede não é estrutural."
      >
        {(id) => (
          <textarea
            id={id}
            value={instrucoes}
            onChange={(e) => setInstrucoes(e.target.value)}
            rows={3}
            maxLength={2000}
            className={AREA_TEXTO}
          />
        )}
      </Campo>

      <ErroEmLinha erro={erro} />
      <div className="flex items-center gap-3">
        <BotaoPainel variante="principal" type="submit" icone={Sparkles} disabled={aGerar}>
          {aGerar ? "A escrever…" : "Gerar rascunho"}
        </BotaoPainel>
        {aGerar && (
          <ACarregar texto="A IA está a escrever o rascunho. Pode demorar até um minuto." />
        )}
      </div>
    </form>
  );
}
