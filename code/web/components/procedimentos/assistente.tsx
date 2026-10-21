"use client";

import { BookOpen, Check, ClipboardList, ExternalLink, GraduationCap, HelpCircle, PenLine, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Cartao,
  classeEntrada,
  ErroLinha,
  Estado,
  haQuanto,
  Pilula,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { AvisoInterno } from "./procedimentos";

/*
 * Painel · Assistente interno para quem chega à câmara: pergunta-se como a
 * um colega com experiência e a resposta vem dos procedimentos internos e
 * das regras oficiais, sempre com a fonte. O que fica sem resposta vai para
 * a lista de procedimentos em falta.
 */

interface Fonte {
  tipo: "procedimento" | "conhecimento" | "resposta_curada";
  etiqueta: string;
  citada: boolean;
  titulo: string;
  procedimento_id?: string;
  area?: string;
  versao?: number;
  autor_nome?: string | null;
  trechos?: { nome_seccao: string; texto: string }[];
  referencia?: string | null;
  entidade?: string;
  url?: string;
  texto?: string;
}

interface Quem {
  utilizador_id: string | null;
  nome: string;
  motivo: string;
}

interface Resposta {
  id: string;
  pergunta: string;
  modo: "ia" | "sem_ia";
  motivo_sem_ia?: string | null;
  estado: "respondida" | "sem_resposta" | "tratada";
  resposta: string | null;
  fontes: Fonte[];
  perguntar_a: Quem[] | null;
  criada_em: string;
}

interface Lacuna {
  id: string;
  pergunta: string;
  perguntou_nome: string | null;
  perguntar_a: Quem[] | null;
  criada_em: string;
}

const SUGESTOES = [
  "Como trato um pedido de ocupação da via pública?",
  "O que faço quando falta um documento num pedido?",
  "A quem peço uma planta de localização?",
];

export function PaginaAssistente() {
  const { pode, pedido } = useSessao();
  const router = useRouter();
  const ver = pode("procedimentos_ver");
  const historico = useDados<{ itens: Resposta[] }>(ver ? "/v1/painel/assistente/historico" : null);
  const lacunas = useDados<{ itens: Lacuna[] }>(ver ? "/v1/painel/assistente/lacunas" : null);
  const [novas, setNovas] = useState<Resposta[]>([]);
  const [pergunta, setPergunta] = useState("");
  const acao = useAcao();
  const acaoLacuna = useAcao();

  if (!ver) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Gestão", "Assistente interno"]} titulo="Assistente interno" />
        <SemAcesso />
      </div>
    );
  }

  const perguntar = async (texto: string) => {
    const t = texto.trim();
    if (t.length < 3) return;
    const r = await acao.executar(() =>
      pedido<Resposta>("/v1/painel/assistente/perguntar", { metodo: "POST", corpo: { pergunta: t } }),
    );
    if (r) {
      setNovas((n) => [...n, r]);
      setPergunta("");
      if (r.estado === "sem_resposta") lacunas.recarregar();
    }
  };

  const escrever = async (id: string) => {
    const r = await acaoLacuna.executar(() =>
      pedido<{ procedimento_id: string }>(`/v1/painel/assistente/lacunas/${id}/escrever`, { metodo: "POST" }),
    );
    if (r) router.push(`/painel/procedimentos/${r.procedimento_id}?editar=1`);
  };

  const tratar = async (id: string) => {
    const r = await acaoLacuna.executar(() =>
      pedido(`/v1/painel/assistente/lacunas/${id}/tratar`, { metodo: "POST", corpo: {} }),
    );
    if (r) lacunas.recarregar();
  };

  // O histórico vem do mais recente para o mais antigo; a conversa lê-se ao contrário.
  const conversa = [...(historico.dados?.itens ?? [])].reverse().filter((h) => !novas.some((n) => n.id === h.id));

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Gestão", "Assistente interno"]}
        titulo="Assistente interno"
        descricao="Pergunte como se faz, como perguntaria a um colega com anos de casa. A resposta vem dos procedimentos internos publicados e das regras oficiais, sempre com a fonte."
      />
      <AvisoInterno />

      <div className="grid gap-6 px-10 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Estado aCarregar={historico.aCarregar} erro={historico.erro} vazio={false}>
            {conversa.length + novas.length === 0 && (
              <Cartao className="flex flex-col gap-3 p-5">
                <p className="flex items-center gap-2 text-sm font-semibold text-tinta">
                  <GraduationCap className="size-4 text-terracota" aria-hidden /> Experimente perguntar:
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGESTOES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void perguntar(s)}
                      className="rounded-full border border-linha px-3 py-1.5 text-[13px] text-tinta-2 hover:bg-creme"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Cartao>
            )}
            <ol className="flex flex-col gap-4">
              {[...conversa, ...novas].map((r) => (
                <li key={r.id} className="flex flex-col gap-2">
                  <p className="max-w-[85%] self-end rounded-2xl rounded-tr-sm bg-tinta px-4 py-2.5 text-sm text-white">
                    {r.pergunta}
                  </p>
                  <CartaoResposta r={r} />
                </li>
              ))}
            </ol>
          </Estado>

          <form
            className="sticky bottom-4 flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-3 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void perguntar(pergunta);
            }}
          >
            <label htmlFor="pergunta-assistente" className="sr-only">
              A sua pergunta
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="pergunta-assistente"
                className={`${classeEntrada} min-h-12`}
                rows={2}
                placeholder="Como trato um pedido de…?"
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void perguntar(pergunta);
                  }
                }}
              />
              <Botao type="submit" icone={Send} disabled={acao.aCorrer || pergunta.trim().length < 3}>
                {acao.aCorrer ? "A procurar…" : "Perguntar"}
              </Botao>
            </div>
            <ErroLinha erro={acao.erro} />
          </form>
        </div>

        <aside className="flex flex-col gap-4">
          <Cartao className="p-5">
            <Rotulo>Procedimentos em falta</Rotulo>
            <p className="mt-1 text-xs text-tinta-3">
              Perguntas a que o assistente não soube responder. Quem sabe pode escrever o procedimento.
            </p>
            <ErroLinha erro={acaoLacuna.erro} className="mt-3" />
            <Estado
              aCarregar={lacunas.aCarregar}
              erro={lacunas.erro}
              vazio={!lacunas.dados?.itens.length}
              textoVazio="Nenhuma por agora."
            >
              <ul className="mt-3 flex flex-col gap-3">
                {lacunas.dados?.itens.map((l) => (
                  <li key={l.id} className="rounded-xl border border-linha p-3">
                    <p className="text-sm font-semibold text-tinta">{l.pergunta}</p>
                    <p className="text-xs text-tinta-3">
                      {l.perguntou_nome ?? "—"} · {haQuanto(l.criada_em)}
                    </p>
                    {!!l.perguntar_a?.length && (
                      <p className="mt-1 text-xs text-tinta-2">
                        Perguntar a: {l.perguntar_a.map((q) => q.nome).join(", ")}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Botao
                        tamanho="pequeno"
                        variante="secundario"
                        icone={PenLine}
                        onClick={() => void escrever(l.id)}
                        disabled={acaoLacuna.aCorrer}
                      >
                        Escrever o procedimento
                      </Botao>
                      {pode("procedimentos") && (
                        <Botao
                          tamanho="pequeno"
                          variante="discreto"
                          icone={Check}
                          onClick={() => void tratar(l.id)}
                          disabled={acaoLacuna.aCorrer}
                        >
                          Já está tratada
                        </Botao>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Estado>
          </Cartao>
        </aside>
      </div>
    </div>
  );
}

function CartaoResposta({ r }: { r: Resposta }) {
  const semResposta = r.estado === "sem_resposta";
  const citadas = r.fontes.filter((f) => f.citada);
  const fontes = r.resposta && citadas.length ? citadas : r.fontes;
  return (
    <Cartao className="flex max-w-[92%] flex-col gap-3 p-4">
      {r.resposta && <p className="whitespace-pre-line text-sm text-tinta">{r.resposta}</p>}
      {!r.resposta && !semResposta && (
        <p className="text-sm text-tinta-2">
          {r.motivo_sem_ia ?? "Encontrei isto nos procedimentos e nas regras:"}
        </p>
      )}
      {semResposta && (
        <div className="flex items-start gap-2 rounded-xl bg-ambar-suave px-3 py-2.5 text-sm text-tinta">
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-ambar" aria-hidden />
          <div>
            <p className="font-semibold">Não sei responder a isto com segurança.</p>
            {!!r.perguntar_a?.length && (
              <ul className="mt-1 text-[13px] text-tinta-2">
                {r.perguntar_a.map((q, i) => (
                  <li key={i}>
                    Pergunte a <span className="font-semibold text-tinta">{q.nome}</span> ({q.motivo}).
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-tinta-3">A pergunta ficou na lista de procedimentos em falta.</p>
          </div>
        </div>
      )}
      {fontes.length > 0 && (
        <div className="flex flex-col gap-2">
          <Rotulo>De onde vem</Rotulo>
          {fontes.map((f) => (
            <FonteCartao key={f.etiqueta} f={f} />
          ))}
        </div>
      )}
      <p className="text-[11px] text-tinta-3">
        {r.modo === "ia" ? "Resposta escrita com IA a partir das fontes." : "Sem IA: procedimentos e trechos encontrados."}
      </p>
    </Cartao>
  );
}

function FonteCartao({ f }: { f: Fonte }) {
  if (f.tipo === "procedimento") {
    return (
      <div className="rounded-xl border border-linha p-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Pilula tom="tinta">{f.etiqueta}</Pilula>
          <ClipboardList className="size-4 text-tinta-3" aria-hidden />
          <Link href={`/painel/procedimentos/${f.procedimento_id}`} className="font-semibold text-tinta underline">
            {f.titulo}
          </Link>
          <span className="text-xs text-tinta-3">
            procedimento interno{f.versao ? ` · v${f.versao}` : ""}
            {f.autor_nome ? ` · por ${f.autor_nome}` : ""}
          </span>
        </p>
        {f.trechos?.map((t, i) => (
          <p key={i} className="mt-1.5 text-[13px] text-tinta-2">
            <span className="font-semibold">{t.nome_seccao}:</span> {t.texto}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-linha p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Pilula>{f.etiqueta}</Pilula>
        <BookOpen className="size-4 text-tinta-3" aria-hidden />
        <span className="font-semibold text-tinta">{f.titulo}</span>
        {f.referencia && <span className="text-xs text-tinta-2">{f.referencia}</span>}
        <span className="text-xs text-tinta-3">
          {f.tipo === "resposta_curada" ? "resposta aprovada da câmara" : (f.entidade ?? "conhecimento oficial")}
        </span>
        {f.url && (
          <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-terracota underline">
            abrir <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </p>
      {f.texto && <p className="mt-1.5 text-[13px] text-tinta-2">{f.texto}</p>}
    </div>
  );
}
