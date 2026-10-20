"use client";

import { Plus, Search, UserCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import {
  Cartao,
  Dialogo,
  ErroLinha,
  Estado,
  numero,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "./comum";
import {
  FormularioResposta,
  linhas,
  usePodeEditarRespostas,
} from "./formulario-resposta";
import { EditorResposta } from "./resposta";
import type { Resposta, RespostaResumo, Revisoes } from "./tipos";

const FILTROS = [
  { id: "", rotulo: "Todas" },
  { id: "no_ar", rotulo: "No ar" },
  { id: "rascunho", rotulo: "Rascunhos" },
  { id: "a_rever", rotulo: "A rever" },
  { id: "arquivada", rotulo: "Arquivadas" },
] as const;

function Marca({ r }: { r: RespostaResumo }) {
  if (r.por_rever)
    return (
      <span className="rounded-xl bg-ambar-suave px-2.5 py-1 text-xs font-semibold text-ambar">
        a fonte mudou
      </span>
    );
  if (r.estado === "rascunho")
    return (
      <span className="rounded-xl bg-creme-2 px-2.5 py-1 text-xs font-semibold text-tinta-2">
        rascunho
      </span>
    );
  if (r.estado === "em_teste")
    return (
      <span className="rounded-xl bg-creme-2 px-2.5 py-1 text-xs font-semibold text-tinta-2">
        em teste
      </span>
    );
  if (r.estado === "arquivada")
    return (
      <span className="rounded-xl bg-creme-2 px-2.5 py-1 text-xs font-semibold text-tinta-3">
        arquivada
      </span>
    );
  return null;
}

/** Respostas curadas: lista à esquerda, editor da resposta escolhida à direita. */
export function Respostas() {
  const { pedido } = useSessao();
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const escolhida = params.get("id");
  const editar = usePodeEditarRespostas();

  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("");
  const [nova, setNova] = useState(false);
  const criar = useAcao();

  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const busca = new URLSearchParams({ limite: "50" });
  if (q) busca.set("q", q);
  if (filtro && filtro !== "a_rever") busca.set("estado", filtro);
  const base = `/v1/painel/conhecimento/respostas?${busca}`;
  const lista = useDados<Pagina<RespostaResumo>>(base);
  const mais = useMais(base, lista);
  const revisoes = useDados<Revisoes>(
    editar.interno ? "/v1/painel/conhecimento/revisoes" : null,
  );

  const itens = (lista.dados?.itens ?? []).filter((r) => filtro !== "a_rever" || r.por_rever);

  const abrir = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("id", id);
    else p.delete("id");
    router.replace(`${caminho}?${p}`, { scroll: false });
  };

  return (
    <div className="grid items-start gap-6 px-10 lg:grid-cols-[400px_minmax(0,1fr)]">
      <Cartao className="flex flex-col overflow-hidden" aria-label="Respostas">
        <div className="flex flex-col gap-2.5 border-b border-linha p-4">
          <div className="flex gap-2">
            <label className="flex h-[38px] flex-1 items-center gap-2 rounded-[10px] border border-linha bg-creme px-3">
              <Search className="size-4 text-tinta-3" aria-hidden />
              <input
                type="search"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Procurar nas respostas"
                aria-label="Procurar nas respostas"
                className="w-full bg-transparent text-[13px] text-tinta outline-none placeholder:text-tinta-3"
              />
            </label>
            {editar.pode && (
              <Botao
                icone={Plus}
                onClick={() => setNova(true)}
                aria-label="Nova resposta"
              >
                Nova
              </Botao>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filtro === f.id}
                onClick={() => setFiltro(f.id)}
                className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
                  filtro === f.id
                    ? "border-tinta bg-tinta text-white"
                    : "border-linha bg-creme text-tinta-2 hover:text-tinta"
                }`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        </div>

        {editar.interno && !!revisoes.dados?.itens.length && (
          <div className="flex flex-col gap-1.5 border-b border-linha bg-ambar-suave/50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-ambar">
              <UserCheck className="size-3.5" aria-hidden />
              {revisoes.dados.itens.length}{" "}
              {revisoes.dados.itens.length === 1
                ? "versão da câmara por rever"
                : "versões da câmara por rever"}
            </p>
            <ul className="flex flex-col gap-1">
              {revisoes.dados.itens.slice(0, 5).map((v) => (
                <li key={v.versao_id}>
                  <button
                    type="button"
                    onClick={() => abrir(v.resposta_id)}
                    className="text-left text-xs text-tinta underline-offset-2 hover:underline"
                  >
                    {v.pergunta_tipo} · v{v.numero}
                    {v.criada_por ? ` · ${v.criada_por}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Estado
          aCarregar={lista.aCarregar}
          erro={lista.erro}
          vazio={!itens.length}
          textoVazio={q ? "Nenhuma resposta com estas palavras." : "Ainda não há respostas aqui."}
        >
          <ul className="max-h-[calc(100dvh-260px)] overflow-y-auto">
            {itens.map((r) => {
              const ativo = r.id === escolhida;
              return (
                <li key={r.id} className="border-b border-linha last:border-b-0">
                  <button
                    type="button"
                    onClick={() => abrir(r.id)}
                    aria-current={ativo ? "true" : undefined}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left ${ativo ? "bg-creme" : "hover:bg-creme/60"}`}
                  >
                    <span className="text-sm font-semibold text-tinta">{r.pergunta_tipo}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-tinta-3">
                      {r.tema ?? "Sem tema"} · {numero(r.usos_30d)}×
                      <Marca r={r} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {mais.haMais && (
            <div className="border-t border-linha p-3">
              <Botao variante="discreto" tamanho="pequeno" onClick={mais.mais} disabled={mais.aCorrer}>
                {mais.aCorrer ? "A carregar…" : "Ver mais"}
              </Botao>
              <ErroLinha erro={mais.erro} className="mt-2" />
            </div>
          )}
        </Estado>
      </Cartao>

      {escolhida ? (
        <EditorResposta
          key={escolhida}
          id={escolhida}
          onMudou={() => {
            lista.recarregar();
            revisoes.recarregar();
          }}
        />
      ) : (
        <Cartao className="p-6 text-sm text-tinta-2">
          <p className="font-display text-lg font-bold text-tinta">Escolha uma resposta</p>
          <p className="mt-1">
            Veja o que o agente diz ao telefone, no chat e no SMS, de onde vem e as versões
            anteriores.
          </p>
          {!editar.pode && !editar.aCarregar && (
            <p className="mt-3 text-xs text-tinta-3">
              Neste município só a equipa Tou, Câmara? escreve e publica respostas.
            </p>
          )}
        </Cartao>
      )}

      <Dialogo titulo="Nova resposta" aberto={nova} onFechar={() => setNova(false)} largura="max-w-2xl">
        <FormularioResposta
          aCorrer={criar.aCorrer}
          erro={criar.erro}
          textoGuardar="Criar rascunho"
          onCancelar={() => setNova(false)}
          onGuardar={async (v) => {
            const r = await criar.executar(() =>
              pedido<Resposta>("/v1/painel/conhecimento/respostas", {
                corpo: {
                  pergunta_tipo: v.pergunta_tipo.trim(),
                  tema_id: v.tema_id,
                  texto_voz: v.texto_voz.trim(),
                  texto_sms: v.texto_sms.trim() || null,
                  passa_a_pessoa_quando: linhas(v.passa_a_pessoa_quando),
                  frases: linhas(v.frases),
                },
              }),
            );
            if (r) {
              setNova(false);
              lista.recarregar();
              abrir(r.id);
            }
          }}
        />
      </Dialogo>
    </div>
  );
}
