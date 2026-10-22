"use client";

import { Check, ExternalLink, FilePen, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Cartao,
  Campo,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  TIPOS_DOCUMENTO,
  type Documento,
  type EstadoDocumento,
  type ItemLista,
  type Lista,
  type TipoDocumento,
} from "./tipos";

export const ESTADOS: Record<
  EstadoDocumento,
  { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }
> = {
  sem_versao: { rotulo: "Sem versão simples", tom: "neutro" },
  rascunho: { rotulo: "Rascunho por rever", tom: "ambar" },
  publicada: { rotulo: "Publicada", tom: "verde" },
  desatualizada: { rotulo: "Desatualizada", tom: "terracota" },
};

/** O tipo de documento mais provável para o tipo da fonte. */
function tipoSugerido(fonteTipo: string): TipoDocumento {
  if (fonteTipo === "regulamento" || fonteTipo === "lei") return fonteTipo;
  return "edital";
}

function Comecar({ item, onFechar }: { item: ItemLista; onFechar: () => void }) {
  const { pedido } = useSessao();
  const router = useRouter();
  const acao = useAcao();
  const [tipo, setTipo] = useState<TipoDocumento>(tipoSugerido(item.fonte_tipo));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = await acao.executar(() =>
          pedido<Documento>("/v1/painel/linguagem-simples", {
            corpo: { fonte_id: item.fonte_id, tipo },
          }),
        );
        if (d) router.push(`/painel/conhecimento/linguagem-simples/${d.id}`);
      }}
    >
      <p className="text-sm text-tinta-2">
        A versão simples fica presa ao texto oficial que está hoje na fonte. Se a fonte mudar,
        fica marcada como desatualizada.
      </p>
      <Campo rotulo="Que documento é">
        <select
          className={classeEntrada}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoDocumento)}
        >
          {Object.entries(TIPOS_DOCUMENTO).map(([k, r]) => (
            <option key={k} value={k}>
              {r}
            </option>
          ))}
        </select>
      </Campo>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end gap-2">
        <Botao variante="discreto" onClick={onFechar}>
          Cancelar
        </Botao>
        <Botao type="submit" disabled={acao.aCorrer}>
          Começar
        </Botao>
      </div>
    </form>
  );
}

/** Lista das fontes com o estado da versão simples (Conhecimento · Linguagem simples). */
export function Documentos() {
  const { pode } = useSessao();
  const lista = useDados<Lista>("/v1/painel/linguagem-simples");
  const [comecar, setComecar] = useState<ItemLista | null>(null);
  const [escolhido, setFiltro] = useState<"todos" | "com" | "atencao" | null>(null);
  const escrever = pode("conhecimento");
  const r = lista.dados?.resumo;
  const precisaAtencao = (i: ItemLista) => i.estado === "desatualizada" || i.estado === "rascunho";
  // Abre no que precisa de atenção; se não houver nada, em todas.
  const filtro = escolhido ?? ((lista.dados?.itens ?? []).some(precisaAtencao) ? "atencao" : "todos");

  const itens = (lista.dados?.itens ?? []).filter((i) =>
    filtro === "todos"
      ? true
      : filtro === "com"
        ? i.documento_id !== null
        : precisaAtencao(i),
  );

  return (
    <div className="flex flex-col gap-5 px-4 sm:px-10">
      <Cartao className="flex flex-col gap-3 p-5">
        <p className="text-sm text-tinta-2">
          Editais, regulamentos e avisos reescritos em português claro, com o texto oficial
          completo ao lado. Nada chega ao munícipe sem ser revisto e publicado aqui. Cada frase
          simples aponta para o artigo de onde vem.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Pilula tom="verde" icone={Check}>
            {r?.publicadas ?? "—"} publicadas
          </Pilula>
          <Pilula tom="terracota" icone={TriangleAlert}>
            {r?.desatualizadas ?? "—"} desatualizadas
          </Pilula>
          <Pilula tom="ambar" icone={FilePen}>
            {r?.rascunhos ?? "—"} rascunhos por rever
          </Pilula>
          <div className="ml-auto flex gap-1 rounded-xl bg-creme-2 p-1" role="group" aria-label="Filtrar">
            {(
              [
                ["todos", "Todas as fontes"],
                ["com", "Com versão simples"],
                ["atencao", "A precisar de atenção"],
              ] as const
            ).map(([k, rot]) => (
              <button
                key={k}
                type="button"
                aria-pressed={filtro === k}
                onClick={() => setFiltro(k)}
                className={`rounded-[9px] px-3 py-1.5 text-[13px] ${
                  filtro === k ? "bg-papel font-bold text-tinta shadow-sm" : "text-tinta-2"
                }`}
              >
                {rot}
              </button>
            ))}
          </div>
        </div>
      </Cartao>

      <Cartao>
        <Estado
          aCarregar={lista.aCarregar}
          erro={lista.erro}
          vazio={itens.length === 0}
          textoVazio="Não há fontes neste filtro."
        >
          <ul className="divide-y divide-linha">
            {itens.map((i) => {
              const e = ESTADOS[i.estado];
              return (
                <li key={i.fonte_id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-sm font-semibold text-tinta">{i.titulo}</p>
                    <p className="text-xs text-tinta-3">
                      {i.entidade}
                      {i.tipo ? ` · ${TIPOS_DOCUMENTO[i.tipo]}` : ""}
                      {i.publicada ? ` · publicada ${quando(i.publicada.publicada_em)}` : ""}
                      {i.rascunho ? ` · rascunho ${quando(i.rascunho.criada_em)}` : ""}
                    </p>
                  </div>
                  <Pilula tom={e.tom}>{e.rotulo}</Pilula>
                  {i.link && (
                    <a
                      href={i.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] font-semibold text-terracota-escuro hover:underline"
                    >
                      Página pública <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                  {i.documento_id ? (
                    <Link
                      href={`/painel/conhecimento/linguagem-simples/${i.documento_id}`}
                      className="rounded-full border-[1.5px] border-tinta px-3 py-1 text-[13px] font-semibold text-tinta hover:bg-tinta/5"
                    >
                      Abrir
                    </Link>
                  ) : escrever ? (
                    <Botao
                      tamanho="pequeno"
                      variante="secundario"
                      icone={Plus}
                      disabled={!i.tem_texto}
                      title={i.tem_texto ? undefined : "A fonte ainda não tem texto lido."}
                      onClick={() => setComecar(i)}
                    >
                      Versão simples
                    </Botao>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Estado>
      </Cartao>

      <Dialogo
        titulo={comecar ? `Versão simples: ${comecar.titulo}` : ""}
        aberto={comecar !== null}
        onFechar={() => setComecar(null)}
      >
        {comecar && <Comecar item={comecar} onFechar={() => setComecar(null)} />}
      </Dialogo>
    </div>
  );
}
