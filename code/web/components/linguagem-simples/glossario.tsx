"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Interruptor,
  Pilula,
  quando,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { FaixaDemonstracao } from "@/components/painel/faixa-demonstracao";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import type { Termo } from "./tipos";

interface ListaTermos {
  itens: Termo[];
  demonstracao: boolean;
}

interface Form {
  termo: string;
  variantes: string;
  explicacao: string;
  exemplo: string;
  fonte_legal: string;
  ativo: boolean;
  validado: boolean;
}

const VAZIO: Form = {
  termo: "",
  variantes: "",
  explicacao: "",
  exemplo: "",
  fonte_legal: "",
  ativo: true,
  validado: true,
};

function FormTermo({
  termo,
  onFeito,
  onCancelar,
}: {
  termo: Termo | null;
  onFeito: () => void;
  onCancelar: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [v, setV] = useState<Form>(
    termo
      ? {
          termo: termo.termo,
          variantes: termo.variantes.join(", "),
          explicacao: termo.explicacao,
          exemplo: termo.exemplo ?? "",
          fonte_legal: termo.fonte_legal ?? "",
          ativo: termo.ativo,
          validado: !termo.demonstracao,
        }
      : VAZIO,
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const corpo = {
          termo: v.termo.trim(),
          variantes: v.variantes
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x.length >= 2),
          explicacao: v.explicacao.trim(),
          exemplo: v.exemplo.trim() || null,
          fonte_legal: v.fonte_legal.trim() || null,
          ativo: v.ativo,
          ...(termo ? { demonstracao: !v.validado } : {}),
        };
        const r = await acao.executar(() =>
          termo
            ? pedido<Termo>(`/v1/painel/glossario/${termo.id}`, { metodo: "PUT", corpo })
            : pedido<Termo>("/v1/painel/glossario", { corpo }),
        );
        if (r) onFeito();
      }}
    >
      <Campo rotulo="Termo">
        <input
          className={classeEntrada}
          required
          minLength={2}
          maxLength={80}
          value={v.termo}
          onChange={(e) => setV({ ...v, termo: e.target.value })}
        />
      </Campo>
      <Campo rotulo="Outras formas" ajuda="Separadas por vírgulas: plurais, siglas, sinónimos (ex.: alvarás).">
        <input
          className={classeEntrada}
          value={v.variantes}
          onChange={(e) => setV({ ...v, variantes: e.target.value })}
        />
      </Campo>
      <Campo rotulo="Explicação simples" ajuda="Frases curtas, como se explicasse ao balcão.">
        <textarea
          className={`${classeEntrada} min-h-[90px]`}
          required
          minLength={10}
          maxLength={600}
          value={v.explicacao}
          onChange={(e) => setV({ ...v, explicacao: e.target.value })}
        />
      </Campo>
      <Campo rotulo="Exemplo (opcional)">
        <input
          className={classeEntrada}
          maxLength={400}
          value={v.exemplo}
          onChange={(e) => setV({ ...v, exemplo: e.target.value })}
        />
      </Campo>
      <Campo rotulo="Base legal (opcional)" ajuda="Ex.: Código do Procedimento Administrativo, art. 121.º">
        <input
          className={classeEntrada}
          maxLength={200}
          value={v.fonte_legal}
          onChange={(e) => setV({ ...v, fonte_legal: e.target.value })}
        />
      </Campo>
      <div className="flex flex-col gap-2.5 text-[13px] text-tinta">
        <span className="flex items-center gap-2.5">
          <Interruptor ligado={v.ativo} rotulo="Em uso" onMudar={(x) => setV({ ...v, ativo: x })} />
          Em uso (sublinhado nas páginas e usado pelo agente)
        </span>
        {termo?.demonstracao && (
          <span className="flex items-center gap-2.5">
            <Interruptor
              ligado={v.validado}
              rotulo="Validado pela câmara"
              onMudar={(x) => setV({ ...v, validado: x })}
            />
            Revi a explicação: deixa de ser valor de demonstração
          </span>
        )}
      </div>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end gap-2">
        <Botao variante="discreto" onClick={onCancelar}>
          Cancelar
        </Botao>
        <Botao type="submit" disabled={acao.aCorrer}>
          {termo ? "Guardar" : "Acrescentar"}
        </Botao>
      </div>
    </form>
  );
}

/** Glossário administrativo (Conhecimento · Glossário). */
export function Glossario() {
  const { pedido, pode } = useSessao();
  const lista = useDados<ListaTermos>("/v1/painel/glossario");
  const acao = useAcao();
  const escrever = pode("conhecimento");
  const [editar, setEditar] = useState<Termo | "novo" | null>(null);
  const [apagar, setApagar] = useState<Termo | null>(null);
  const itens = lista.dados?.itens ?? [];

  return (
    <div className="flex flex-col gap-5 px-4 sm:px-10">
      <Cartao className="flex flex-wrap items-center gap-3 p-5">
        <p className="min-w-0 flex-1 text-sm text-tinta-2">
          Palavras da linguagem administrativa explicadas por palavras simples. Aparecem
          sublinhadas nos documentos públicos (a explicação abre ao tocar) e o agente usa-as
          quando alguém pergunta &ldquo;o que é…?&rdquo;.
        </p>
        {escrever && (
          <>
            <Botao
              variante="secundario"
              disabled={acao.aCorrer}
              onClick={async () => {
                const r = await acao.executar(() =>
                  pedido<ListaTermos>("/v1/painel/glossario/demonstracao", { corpo: {} }),
                );
                if (r) lista.mudar(() => r);
              }}
            >
              Carregar termos iniciais
            </Botao>
            <Botao icone={Plus} onClick={() => setEditar("novo")}>
              Novo termo
            </Botao>
          </>
        )}
      </Cartao>
      {(lista.dados?.demonstracao || itens.some((t) => t.demonstracao)) && (
        <FaixaDemonstracao>
          As explicações marcadas «por validar» são exemplos escritos para a demonstração: a câmara confirma-as
          antes de aparecerem nos documentos públicos.
        </FaixaDemonstracao>
      )}
      <ErroLinha erro={acao.erro} />

      <Cartao>
        <Estado
          aCarregar={lista.aCarregar}
          erro={lista.erro}
          vazio={itens.length === 0}
          textoVazio="Ainda não há termos. Carregue os termos iniciais (de demonstração) ou acrescente um."
        >
          <ul className="divide-y divide-linha">
            {itens.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-tinta">
                    {t.termo}
                    {!t.ativo && <Pilula>fora de uso</Pilula>}
                  </p>
                  <p className="text-sm text-tinta-2">{t.explicacao}</p>
                  <p className="text-xs text-tinta-3">
                    {t.variantes.length > 0 && `Também: ${t.variantes.join(", ")} · `}
                    {t.fonte_legal && `${t.fonte_legal} · `}
                    {t.demonstracao && "por validar · "}
                    atualizado {quando(t.atualizado_em)}
                  </p>
                </div>
                {escrever && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Editar ${t.termo}`}
                      onClick={() => setEditar(t)}
                      className="flex size-9 items-center justify-center rounded-full text-tinta-2 hover:bg-creme-2"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Apagar ${t.termo}`}
                      onClick={() => setApagar(t)}
                      className="flex size-9 items-center justify-center rounded-full text-tinta-2 hover:bg-creme-2 hover:text-terracota-escuro"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Estado>
      </Cartao>

      <Dialogo
        titulo={editar === "novo" ? "Novo termo" : "Editar termo"}
        aberto={editar !== null}
        onFechar={() => setEditar(null)}
      >
        {editar !== null && (
          <FormTermo
            termo={editar === "novo" ? null : editar}
            onCancelar={() => setEditar(null)}
            onFeito={() => {
              setEditar(null);
              lista.recarregar();
            }}
          />
        )}
      </Dialogo>

      <Dialogo titulo="Apagar termo" aberto={apagar !== null} onFechar={() => setApagar(null)}>
        <p className="text-sm text-tinta-2">
          Apagar &ldquo;{apagar?.termo}&rdquo;? Deixa de aparecer nas páginas e de ser usado pelo
          agente. Para o guardar sem o usar, edite-o e desligue &ldquo;Em uso&rdquo;.
        </p>
        <ErroLinha erro={acao.erro} className="mt-3" />
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="discreto" onClick={() => setApagar(null)}>
            Cancelar
          </Botao>
          <Botao
            icone={Trash2}
            disabled={acao.aCorrer}
            onClick={async () => {
              if (!apagar) return;
              const r = await acao.executar(() =>
                pedido(`/v1/painel/glossario/${apagar.id}`, { metodo: "DELETE" }),
              );
              if (r) {
                setApagar(null);
                lista.recarregar();
              }
            }}
          >
            Apagar
          </Botao>
        </div>
      </Dialogo>
    </div>
  );
}
