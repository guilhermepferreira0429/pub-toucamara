"use client";

import {
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
  MessageSquareHeart,
  Quote,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
  type Pagina,
} from "@/components/conhecimento/comum";
import { variacaoCurta } from "@/components/atendimento/formatos";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · "O que sentem os munícipes" (Pergunte ao concelho). A chefia
 * pergunta em linguagem normal e recebe a resposta lida nas conversas
 * reais: temas com o suporte (as conversas, para quem as pode ver),
 * irritação, frases anónimas, sugestões, mapa por freguesia e evolução
 * semanal. Os números são sempre contados pela câmara, não pela IA.
 */

// ---------------------------------------------------------------------------
// Tipos (as respostas da API /v1/painel/concelho)
// ---------------------------------------------------------------------------

interface Filtros {
  de?: string;
  ate?: string;
  freguesias?: string[];
  canais?: string[];
  tema_ids?: string[];
  faixa?: "lista_cuidado" | null;
  texto?: string | null;
}

interface Opcoes {
  freguesias: string[];
  temas: { id: string; nome: string }[];
  canais: { valor: string; rotulo: string }[];
  faixas: { valor: "lista_cuidado"; rotulo: string; explicacao: string }[];
  escala_irritacao: { nivel: number; rotulo: string; descricao: string }[];
  ia_disponivel: boolean;
  limites: { conversas_lidas: number; poucos_dados: number };
}

interface Sinal {
  texto: string;
  pergunta: string;
  filtros: Filtros;
}

interface Suporte {
  conversas_n: number;
  conversas: string[] | null;
}

interface Contagem {
  chave: string;
  rotulo: string;
  n: number;
  anterior: number;
  diferenca: number;
  variacao: number | null;
  pct: number | null;
}

interface Citacao {
  texto: string;
  tema: string | null;
  dia: string;
  canal: string;
  freguesia: string | null;
  conversa_id: string | null;
}

interface Analise {
  id: string;
  pergunta: string;
  filtros: {
    periodo: { de: string; ate: string };
    descricao: string;
    deduzidos: string[];
    freguesias: string[];
  };
  anterior: { de: string; ate: string };
  conversas: { total: number; lidas: number; anterior_total: number; variacao: number | null };
  amostragem: string;
  poucos_dados: boolean;
  avisos: string[];
  ia: boolean;
  motivo_sem_ia: string | null;
  escala_irritacao: Opcoes["escala_irritacao"];
  analise: {
    sintese: string;
    temas: (Suporte & {
      tema: string;
      descricao: string;
      pct_lidas: number | null;
      irritacao_media: number | null;
      irritacao_rotulo: string | null;
      causas: (Suporte & { texto: string })[];
    })[];
    irritacao: {
      media: number | null;
      rotulo: string | null;
      conversas_classificadas: number;
      distribuicao: { nivel: number; rotulo: string; n: number; pct: number | null }[];
    };
    citacoes: Citacao[];
    sugestoes: (Suporte & { texto: string; tema: string })[];
    texto_verificado: boolean;
  } | null;
  citacoes: Citacao[];
  palavras: { palavra: string; n: number }[];
  contagens: {
    total: number;
    anterior_total: number;
    temas: Contagem[];
    freguesias: Contagem[];
    sem_freguesia: number;
    resultados: Contagem[];
    canais: Contagem[];
    semanas: { semana: string; n: number; atual: boolean }[];
  };
  comparacao: string[];
  pode_ver_conversas: boolean;
  titulo: string | null;
  guardada_em: string | null;
  criada_em: string;
}

interface ItemLista {
  id: string;
  pergunta: string;
  titulo: string | null;
  ia: boolean;
  conversas_total: number;
  descricao: string | null;
  guardada_por: string | null;
  criada_em: string;
}

const CANAIS: Record<string, string> = {
  telefone: "Telefone",
  chat: "Chat",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
  balcao: "Balcão",
};

const fmt = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });
const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmt.format(v));
// Com poucos casos, a diferença em número ("+7") em vez de "+350%" (ver variacaoCurta).
const variacao = (atual: number, anterior: number, v: number | null) => variacaoCurta(atual, anterior, v) ?? "";
const diaCurto = (d: string) =>
  new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00`));

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function PaginaConcelho() {
  const { pode, pedido } = useSessao();
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const permitido = pode("indicadores");
  const analiseId = params.get("analise");

  const opcoes = useDados<Opcoes>(permitido ? "/v1/painel/concelho/opcoes" : null);
  const sinais = useDados<{ sinais: Sinal[]; exemplos: string[] }>(
    permitido ? "/v1/painel/concelho/sinais" : null,
  );
  const guardada = useDados<Analise>(
    permitido && analiseId ? `/v1/painel/concelho/analises/${analiseId}` : null,
  );
  const minhas = useDados<Pagina<ItemLista>>(permitido ? "/v1/painel/concelho/analises?limite=8" : null);
  const partilhadas = useDados<Pagina<ItemLista>>(
    permitido ? "/v1/painel/concelho/analises?guardadas=true&limite=8" : null,
  );

  const [pergunta, setPergunta] = useState("");
  const [filtros, setFiltros] = useState<Filtros>({});
  const [verFiltros, setVerFiltros] = useState(false);
  const [resultado, setResultado] = useState<Analise | null>(null);
  const acao = useAcao();

  if (!permitido) {
    return (
      <>
        <CabecalhoPagina migalhas={["Gestão"]} titulo="O que sentem os munícipes" />
        <SemAcesso texto="Esta área é das chefias e de quem vê os indicadores." />
      </>
    );
  }

  const abrir = (id: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (id) q.set("analise", id);
    else q.delete("analise");
    const s = q.toString();
    router.replace(s ? `${caminho}?${s}` : caminho, { scroll: false });
  };

  async function analisar(texto: string, f: Filtros = filtros) {
    const q = texto.trim();
    if (q.length < 3) return;
    setPergunta(q);
    const corpo: { pergunta: string; filtros?: Filtros } = { pergunta: q };
    const limpos = limparFiltros(f);
    if (Object.keys(limpos).length) corpo.filtros = limpos;
    const r = await acao.executar(() =>
      pedido<Analise>("/v1/painel/concelho/analisar", { metodo: "POST", corpo }),
    );
    if (r) {
      setResultado(r);
      abrir(r.id);
      minhas.recarregar();
    }
  }

  // A análise mostrada: a acabada de fazer ou a aberta pelo link.
  const atual = resultado && resultado.id === analiseId ? resultado : (guardada.dados ?? null);
  const o = opcoes.dados;

  return (
    <div className="pb-12">
      <CabecalhoPagina
        migalhas={["Gestão", "Pergunte ao concelho"]}
        titulo="O que sentem os munícipes"
        descricao="Pergunte em linguagem normal. A resposta é lida nas conversas reais, sem dados pessoais, e os números são contados pela câmara."
        acoes={
          o && (
            <Pilula tom={o.ia_disponivel ? "verde" : "ambar"} icone={Sparkles}>
              {o.ia_disponivel ? "Análise por IA ligada" : "Números contados, não estimados"}
            </Pilula>
          )
        }
      />

      <div className="flex flex-col gap-6 px-4 sm:px-10">
        <section
          aria-labelledby="concelho-pergunta"
          className="flex flex-col gap-4 rounded-2xl bg-tinta p-6 text-white"
        >
          <h2 id="concelho-pergunta" className="flex items-center gap-2 font-display text-xl font-bold">
            <MessageSquareHeart className="size-[18px] text-[#E07A55]" aria-hidden />
            Pergunte ao concelho
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void analisar(pergunta);
            }}
            className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-5 pr-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#E07A55]"
          >
            <label htmlFor="pergunta-concelho" className="sr-only">
              A sua pergunta
            </label>
            <input
              id="pergunta-concelho"
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              maxLength={500}
              placeholder="Ex.: O que mais irrita as pessoas em Azurém este mês?"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-tinta outline-none placeholder:text-tinta-3"
            />
            <button
              type="button"
              onClick={() => setVerFiltros((v) => !v)}
              aria-expanded={verFiltros}
              aria-controls="filtros-concelho"
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Filtros
              {Object.keys(limparFiltros(filtros)).length > 0 && (
                <span className="rounded-full bg-terracota px-1.5 text-[11px] text-white">
                  {Object.keys(limparFiltros(filtros)).length}
                </span>
              )}
            </button>
            <button
              type="submit"
              disabled={acao.aCorrer || pergunta.trim().length < 3}
              aria-label="Perguntar"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-terracota text-white hover:bg-terracota-escuro disabled:opacity-50"
            >
              {acao.aCorrer ? (
                <LoaderCircle className="size-[18px] animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="size-[18px]" aria-hidden />
              )}
            </button>
          </form>

          {verFiltros && o && (
            <PainelFiltros id="filtros-concelho" opcoes={o} filtros={filtros} mudar={setFiltros} />
          )}

          <SinaisEExemplos
            sinais={sinais.dados?.sinais ?? []}
            exemplos={sinais.dados?.exemplos ?? []}
            escolher={(p, f) => {
              if (f) setFiltros(f);
              void analisar(p, f ?? filtros);
            }}
          />
          {acao.aCorrer && (
            <p className="flex items-center gap-2 text-[13px] text-white/80" aria-live="polite">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />A filtrar as conversas e a ler a amostra…
            </p>
          )}
          <ErroLinha erro={acao.erro} />
        </section>

        {analiseId && !atual && <Estado aCarregar={guardada.aCarregar} erro={guardada.erro} />}
        {atual && (
          <Resposta
            a={atual}
            aoGuardar={(g) => {
              setResultado(g);
              partilhadas.recarregar();
            }}
          />
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <ListaAnalises
            titulo="Análises guardadas da câmara"
            vazio="Ainda ninguém guardou uma análise."
            lista={partilhadas}
            abrir={abrir}
          />
          <ListaAnalises
            titulo="As minhas perguntas"
            vazio="Ainda não fez perguntas."
            lista={minhas}
            abrir={abrir}
          />
        </div>
      </div>
    </div>
  );
}

function limparFiltros(f: Filtros): Filtros {
  const r: Filtros = {};
  if (f.de) r.de = f.de;
  if (f.ate) r.ate = f.ate;
  if (f.freguesias?.length) r.freguesias = f.freguesias;
  if (f.canais?.length) r.canais = f.canais;
  if (f.tema_ids?.length) r.tema_ids = f.tema_ids;
  if (f.faixa) r.faixa = f.faixa;
  if (f.texto && f.texto.trim().length >= 3) r.texto = f.texto.trim();
  return r;
}

// ---------------------------------------------------------------------------
// Filtros, sinais e exemplos
// ---------------------------------------------------------------------------

function PainelFiltros({
  id,
  opcoes,
  filtros,
  mudar,
}: {
  id: string;
  opcoes: Opcoes;
  filtros: Filtros;
  mudar: (f: Filtros) => void;
}) {
  const um = (v: string) => (v ? [v] : undefined);
  return (
    <div id={id} className="grid gap-3 rounded-xl bg-papel p-4 text-tinta md:grid-cols-3 lg:grid-cols-6">
      <Campo rotulo="De">
        <input
          type="date"
          className={classeEntrada}
          value={filtros.de ?? ""}
          onChange={(e) => mudar({ ...filtros, de: e.target.value || undefined })}
        />
      </Campo>
      <Campo rotulo="Até">
        <input
          type="date"
          className={classeEntrada}
          value={filtros.ate ?? ""}
          onChange={(e) => mudar({ ...filtros, ate: e.target.value || undefined })}
        />
      </Campo>
      <Campo rotulo="Freguesia">
        <select
          className={classeEntrada}
          value={filtros.freguesias?.[0] ?? ""}
          onChange={(e) => mudar({ ...filtros, freguesias: um(e.target.value) })}
        >
          <option value="">Da pergunta ou todas</option>
          {opcoes.freguesias.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Canal">
        <select
          className={classeEntrada}
          value={filtros.canais?.[0] ?? ""}
          onChange={(e) => mudar({ ...filtros, canais: um(e.target.value) })}
        >
          <option value="">Todos</option>
          {opcoes.canais.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Tema">
        <select
          className={classeEntrada}
          value={filtros.tema_ids?.[0] ?? ""}
          onChange={(e) => mudar({ ...filtros, tema_ids: um(e.target.value) })}
        >
          <option value="">Da pergunta ou todos</option>
          {opcoes.temas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Fala de (rua, palavra)">
        <input
          className={classeEntrada}
          value={filtros.texto ?? ""}
          maxLength={80}
          placeholder="Ex.: Rua da Universidade"
          onChange={(e) => mudar({ ...filtros, texto: e.target.value || undefined })}
        />
      </Campo>
      {opcoes.faixas.map((f) => (
        <label key={f.valor} className="flex items-start gap-2 text-[13px] md:col-span-3 lg:col-span-6">
          <input
            type="checkbox"
            className="mt-0.5 accent-terracota"
            checked={filtros.faixa === f.valor}
            onChange={(e) => mudar({ ...filtros, faixa: e.target.checked ? f.valor : undefined })}
          />
          <span>
            <span className="font-semibold">Só {f.rotulo.toLowerCase()}.</span>{" "}
            <span className="text-tinta-2">{f.explicacao}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-tinta-3 md:col-span-3 lg:col-span-6">
        O que escolher aqui ganha ao que se deduz da pergunta. Sem período, são os últimos 30 dias.
      </p>
    </div>
  );
}

function SinaisEExemplos({
  sinais,
  exemplos,
  escolher,
}: {
  sinais: Sinal[];
  exemplos: string[];
  escolher: (pergunta: string, filtros?: Filtros) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {sinais.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-bold tracking-[1px] text-white/60">O QUE MUDOU NOS ÚLTIMOS 7 DIAS</p>
          <ul className="flex flex-wrap gap-2">
            {sinais.map((s) => (
              <li key={s.texto}>
                <button
                  type="button"
                  onClick={() => escolher(s.pergunta, s.filtros)}
                  className="flex items-center gap-1.5 rounded-2xl bg-[#E07A55]/20 px-3 py-1.5 text-left text-xs font-semibold text-white hover:bg-[#E07A55]/35"
                >
                  <TrendingUp className="size-3.5 shrink-0 text-[#F2B49B]" aria-hidden />
                  {s.texto}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {exemplos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Perguntas exemplo">
          {exemplos.map((e) => (
            <li key={e}>
              <button
                type="button"
                onClick={() => escolher(e)}
                className="rounded-2xl border border-white/20 px-3 py-1.5 text-left text-xs text-white/85 hover:border-white/50 hover:bg-white/5"
              >
                {e}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

function Resposta({ a, aoGuardar }: { a: Analise; aoGuardar: (a: Analise) => void }) {
  const ia = a.analise;
  const citacoes = ia ? ia.citacoes : a.citacoes;
  const c = a.contagens;
  return (
    <article aria-labelledby="resposta-concelho" className="flex flex-col gap-5">
      <Cartao className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {a.titulo && <Rotulo>Guardada · {a.titulo}</Rotulo>}
            <h2 id="resposta-concelho" className="font-display text-2xl font-bold text-tinta">
              “{a.pergunta}”
            </h2>
            <p className="text-[13px] text-tinta-2">{a.filtros.descricao}</p>
          </div>
          <Guardar a={a} aoGuardar={aoGuardar} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Pilula tom="tinta">
            Lidas {n(a.conversas.lidas)} de {n(a.conversas.total)} conversas
          </Pilula>
          <Pilula tom={(a.conversas.variacao ?? 0) > 0 ? "terracota" : "neutro"}>
            Período anterior: {n(a.conversas.anterior_total)}
            {a.conversas.anterior_total > 0 &&
              ` (${variacao(a.conversas.total, a.conversas.anterior_total, a.conversas.variacao)})`}
          </Pilula>
          {a.poucos_dados && (
            <Pilula tom="ambar" icone={TriangleAlert}>
              Poucos dados
            </Pilula>
          )}
          <Pilula tom={a.ia ? "verde" : "ambar"} icone={Sparkles}>
            {a.ia ? "Lido pela IA, contado pela câmara" : "Só contagens (sem IA)"}
          </Pilula>
        </div>

        {a.avisos.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {a.avisos.map((x) => (
              <li key={x} className="flex items-start gap-2 rounded-[10px] bg-ambar-suave px-3 py-2 text-[13px] text-ambar">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        )}

        {ia ? (
          <p className="text-base leading-relaxed text-tinta">{ia.sintese}</p>
        ) : (
          a.motivo_sem_ia && <p className="text-sm text-tinta-2">{a.motivo_sem_ia}</p>
        )}
        {ia && !ia.texto_verificado && (
          <p className="flex items-center gap-1.5 text-xs text-ambar">
            <TriangleAlert className="size-3.5" aria-hidden />
            Retirámos do texto da IA números que não são nossos, dados pessoais ou afirmações sem
            conversas que as suportem.
          </p>
        )}
      </Cartao>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Cartao className="flex flex-col gap-4 p-6">
          <Rotulo>{ia ? "Temas (nas conversas lidas)" : "Temas (todas as conversas)"}</Rotulo>
          {ia ? (
            <TemasIa temas={ia.temas} lidas={a.conversas.lidas} />
          ) : (
            <Barras itens={c.temas.slice(0, 8)} vazio="Sem temas neste período." />
          )}
        </Cartao>
        <div className="flex flex-col gap-5">
          {ia && <Irritacao a={a} />}
          <Cartao className="flex flex-col gap-3 p-6">
            <Rotulo>Comparação com o período anterior</Rotulo>
            <p className="text-xs text-tinta-3">
              {diaCurto(a.anterior.de)} a {diaCurto(a.anterior.ate)}, contado em todas as conversas
            </p>
            <ul className="flex flex-col gap-2 text-sm text-tinta">
              {a.comparacao.map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-terracota" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </Cartao>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MapaFreguesias c={c} />
        <EvolucaoSemanal semanas={c.semanas} />
      </div>

      {citacoes.length > 0 && <Citacoes lista={citacoes} />}

      {ia && ia.sugestoes.length > 0 && (
        <Cartao className="flex flex-col gap-3 p-6">
          <Rotulo>O que a câmara pode fazer</Rotulo>
          <ul className="flex flex-col gap-3">
            {ia.sugestoes.map((s) => (
              <li key={s.texto} className="flex flex-col gap-1 rounded-xl bg-creme/60 p-4">
                <p className="text-[15px] font-semibold text-tinta">{s.texto}</p>
                <p className="text-xs text-tinta-2">
                  {s.tema} · <SuporteLinks s={s} />
                </p>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {!ia && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Cartao className="flex flex-col gap-3 p-6">
            <Rotulo>Palavras mais repetidas pelos munícipes</Rotulo>
            {a.palavras.length ? (
              <ul className="flex flex-wrap gap-2">
                {a.palavras.map((p) => (
                  <li key={p.palavra} className="rounded-xl bg-creme-2 px-2.5 py-1 text-[13px] text-tinta">
                    {p.palavra} <span className="text-tinta-3">· {p.n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-tinta-3">Sem palavras suficientes.</p>
            )}
          </Cartao>
          <Cartao className="flex flex-col gap-3 p-6">
            <Rotulo>Como acabaram</Rotulo>
            <Barras itens={c.resultados} vazio="—" />
          </Cartao>
          <Cartao className="flex flex-col gap-3 p-6">
            <Rotulo>Por canal</Rotulo>
            <Barras itens={c.canais} vazio="—" />
          </Cartao>
        </div>
      )}

      <p className="text-xs text-tinta-3">
        {a.amostragem} Frases sem nomes, contactos, NIF, matrículas nem números de porta.{" "}
        {!a.pode_ver_conversas && "O seu perfil vê quantas conversas suportam cada afirmação, mas não quais."}
      </p>
    </article>
  );
}

function SuporteLinks({ s }: { s: Suporte }) {
  const rotulo = `${n(s.conversas_n)} ${s.conversas_n === 1 ? "conversa" : "conversas"}`;
  if (!s.conversas?.length) return <span>{rotulo}</span>;
  const mostrar = s.conversas.slice(0, 6);
  return (
    <span>
      {rotulo}:{" "}
      {mostrar.map((id, i) => (
        <span key={id}>
          {i > 0 && " "}
          <Link
            href={`/painel/conversas/${id}`}
            className="font-semibold text-terracota-escuro underline-offset-2 hover:underline"
            aria-label={`Abrir a conversa ${i + 1} de suporte`}
          >
            {i + 1}
          </Link>
        </span>
      ))}
      {s.conversas.length > mostrar.length && " …"}
    </span>
  );
}

function TemasIa({ temas, lidas }: { temas: NonNullable<Analise["analise"]>["temas"]; lidas: number }) {
  if (!temas.length) return <p className="text-sm text-tinta-3">A IA não encontrou temas com suporte.</p>;
  const max = Math.max(1, ...temas.map((t) => t.conversas_n));
  return (
    <ul className="flex flex-col gap-5">
      {temas.map((t, i) => (
        <li key={t.tema} className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="w-[200px] shrink-0 text-sm font-semibold text-tinta">{t.tema}</span>
            <span className="h-2.5 flex-1 rounded-[5px] bg-creme" aria-hidden>
              <span
                className={`block h-2.5 rounded-[5px] ${i === 0 ? "bg-terracota" : "bg-terracota-suave"}`}
                style={{ width: `${(t.conversas_n / max) * 100}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-sm font-bold text-tinta">
              {n(t.conversas_n)}/{n(lidas)}{" "}
              <span className="text-xs font-normal text-tinta-3">({n(t.pct_lidas)}%)</span>
            </span>
          </div>
          <p className="text-[13px] text-tinta-2">
            {t.descricao}{" "}
            {t.irritacao_rotulo && (
              <Pilula tom={(t.irritacao_media ?? 0) >= 2 ? "terracota" : "neutro"} className="ml-1">
                {t.irritacao_rotulo} · {n(t.irritacao_media)}/3
              </Pilula>
            )}
          </p>
          {t.causas.length > 0 && (
            <ul className="flex flex-col gap-1 border-l-2 border-linha pl-3">
              {t.causas.map((c) => (
                <li key={c.texto} className="text-[13px] text-tinta">
                  {c.texto} <span className="text-xs text-tinta-3">· <SuporteLinks s={c} /></span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-tinta-3">
            Suporte: <SuporteLinks s={t} />
          </p>
        </li>
      ))}
    </ul>
  );
}

function Barras({ itens, vazio }: { itens: Contagem[]; vazio: string }) {
  const visiveis = itens.filter((x) => x.n > 0);
  if (!visiveis.length) return <p className="text-sm text-tinta-3">{vazio}</p>;
  const max = Math.max(1, ...visiveis.map((x) => x.n));
  return (
    <ul className="flex flex-col gap-3">
      {visiveis.map((x, i) => (
        <li key={x.chave} className="flex items-center gap-3 text-sm">
          <span className="w-[150px] shrink-0 truncate font-medium text-tinta">{x.rotulo}</span>
          <span className="h-2.5 flex-1 rounded-[5px] bg-creme" aria-hidden>
            <span
              className={`block h-2.5 rounded-[5px] ${i === 0 ? "bg-terracota" : "bg-terracota-suave"}`}
              style={{ width: `${(x.n / max) * 100}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right font-bold text-tinta">{n(x.n)}</span>
          <span
            className={`w-12 shrink-0 text-xs font-semibold ${x.diferenca > 0 ? "text-terracota-escuro" : "text-tinta-3"}`}
          >
            {x.anterior > 0 || x.n > 0 ? variacao(x.n, x.anterior, x.variacao) : ""}
            <span className="sr-only"> face ao período anterior</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Irritacao({ a }: { a: Analise }) {
  const i = a.analise!.irritacao;
  const cores = ["bg-verde-suave", "bg-ambar-suave", "bg-terracota-suave", "bg-terracota"];
  return (
    <Cartao className="flex flex-col gap-3 p-6">
      <div className="flex items-baseline justify-between gap-2">
        <Rotulo>Irritação</Rotulo>
        {i.rotulo && (
          <span className="text-sm font-bold text-tinta">
            {i.rotulo} <span className="font-normal text-tinta-3">· média {n(i.media)} em 3</span>
          </span>
        )}
      </div>
      <div className="flex h-3 overflow-hidden rounded-[5px] bg-creme" aria-hidden>
        {i.distribuicao.map((d) => (
          <span key={d.nivel} className={cores[d.nivel]} style={{ width: `${d.pct ?? 0}%` }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-tinta-2">
        {i.distribuicao.map((d) => (
          <li key={d.nivel} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${cores[d.nivel]}`} aria-hidden />
            {d.rotulo}: {n(d.n)} ({n(d.pct)}%)
          </li>
        ))}
      </ul>
      <details className="group text-xs text-tinta-2">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-tinta">
          Como se mede
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <p className="mt-2">
          A IA põe cada conversa lida num nível (0 a 3); as contas são nossas, em{" "}
          {n(i.conversas_classificadas)} conversas.
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {a.escala_irritacao.map((e) => (
            <li key={e.nivel}>
              <span className="font-semibold">
                {e.nivel} · {e.rotulo}:
              </span>{" "}
              {e.descricao}
            </li>
          ))}
        </ul>
      </details>
    </Cartao>
  );
}

function MapaFreguesias({ c }: { c: Analise["contagens"] }) {
  const fs = c.freguesias.filter((f) => f.n > 0 || f.anterior > 0);
  const max = Math.max(1, ...fs.map((f) => f.n));
  return (
    <Cartao className="flex flex-col gap-3 p-6">
      <Rotulo>Por freguesia</Rotulo>
      {fs.length === 0 ? (
        <p className="text-sm text-tinta-3">As conversas destes filtros não têm freguesia conhecida.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {fs.map((f) => {
            const forca = f.n / max;
            return (
              <li
                key={f.chave}
                className="flex min-h-[86px] flex-col justify-between rounded-xl border border-linha p-3"
                style={{ backgroundColor: `rgba(184, 74, 36, ${0.06 + forca * 0.5})` }}
              >
                <span className={`text-[13px] font-semibold leading-tight ${forca > 0.6 ? "text-white" : "text-tinta"}`}>
                  {f.rotulo}
                </span>
                <span className={`flex items-baseline gap-1.5 ${forca > 0.6 ? "text-white" : "text-tinta"}`}>
                  <span className="font-display text-2xl font-bold">{n(f.n)}</span>
                  <span className="text-xs font-semibold">{variacao(f.n, f.anterior, f.variacao)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {c.sem_freguesia > 0 && (
        <p className="text-xs text-tinta-3">
          {n(c.sem_freguesia)} {c.sem_freguesia === 1 ? "conversa" : "conversas"} sem freguesia conhecida.
        </p>
      )}
    </Cartao>
  );
}

function EvolucaoSemanal({ semanas }: { semanas: Analise["contagens"]["semanas"] }) {
  const max = Math.max(1, ...semanas.map((s) => s.n));
  return (
    <Cartao className="flex flex-col gap-3 p-6">
      <Rotulo>Evolução semanal</Rotulo>
      <ol className="flex h-44 items-end gap-1.5" aria-label="Conversas por semana">
        {semanas.map((s) => (
          <li key={s.semana} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] font-semibold text-tinta">{s.n > 0 ? n(s.n) : ""}</span>
            <span
              className={`w-full max-w-10 rounded-t-[4px] ${s.atual ? "bg-terracota" : "bg-creme-2"}`}
              style={{ height: `${Math.max(2, (s.n / max) * 100)}%` }}
              title={`Semana de ${diaCurto(s.semana)}: ${s.n}`}
            />
            <span className="text-[10px] whitespace-nowrap text-tinta-3">{diaCurto(s.semana)}</span>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-3 text-xs text-tinta-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-terracota" aria-hidden /> período pedido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-creme-2" aria-hidden /> período anterior
        </span>
      </p>
    </Cartao>
  );
}

function Citacoes({ lista }: { lista: Citacao[] }) {
  return (
    <Cartao className="flex flex-col gap-3 p-6">
      <Rotulo>O que dizem (frases anónimas)</Rotulo>
      <ul className="grid gap-3 md:grid-cols-2">
        {lista.map((c) => (
          <li key={c.texto} className="flex flex-col gap-2 rounded-xl bg-creme/60 p-4">
            <p className="flex gap-2 text-[15px] leading-snug text-tinta">
              <Quote className="mt-0.5 size-4 shrink-0 text-terracota" aria-hidden />
              {c.texto}
            </p>
            <p className="text-xs text-tinta-3">
              {[c.tema, c.freguesia, CANAIS[c.canal] ?? c.canal, diaCurto(c.dia)].filter(Boolean).join(" · ")}
              {c.conversa_id && (
                <>
                  {" · "}
                  <Link
                    href={`/painel/conversas/${c.conversa_id}`}
                    className="font-semibold text-terracota-escuro hover:underline"
                  >
                    ver conversa
                  </Link>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

// ---------------------------------------------------------------------------
// Guardar / partilhar e listas
// ---------------------------------------------------------------------------

function Guardar({ a, aoGuardar }: { a: Analise; aoGuardar: (a: Analise) => void }) {
  const { pedido } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState(a.titulo ?? a.pergunta.slice(0, 120));
  const [copiado, setCopiado] = useState(false);
  const acao = useAcao();

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/painel/concelho?analise=${a.id}`);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <>
      <div className="flex gap-2">
        {a.titulo && (
          <Botao variante="secundario" tamanho="pequeno" icone={copiado ? Check : Copy} onClick={copiar}>
            {copiado ? "Link copiado" : "Copiar link"}
          </Botao>
        )}
        <Botao variante="principal" tamanho="pequeno" icone={Bookmark} onClick={() => setAberto(true)}>
          {a.titulo ? "Mudar título" : "Guardar e partilhar"}
        </Botao>
      </div>
      <Dialogo titulo="Guardar como relatório" aberto={aberto} onFechar={() => setAberto(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await acao.executar(() =>
              pedido<Analise>(`/v1/painel/concelho/analises/${a.id}/guardar`, {
                metodo: "POST",
                corpo: { titulo },
              }),
            );
            if (r) {
              aoGuardar(r);
              setAberto(false);
            }
          }}
        >
          <Campo
            rotulo="Título"
            ajuda="Fica na lista das análises guardadas, para quem vê os indicadores. A análise não se volta a calcular: o link mostra sempre esta."
          >
            <input
              className={classeEntrada}
              value={titulo}
              minLength={3}
              maxLength={140}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </Campo>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={acao.aCorrer || titulo.trim().length < 3}>
              Guardar
            </Botao>
          </div>
        </form>
      </Dialogo>
    </>
  );
}

function ListaAnalises({
  titulo,
  vazio,
  lista,
  abrir,
}: {
  titulo: string;
  vazio: string;
  lista: { dados?: Pagina<ItemLista>; aCarregar: boolean; erro?: import("@/lib/api").ErroApi };
  abrir: (id: string) => void;
}) {
  const itens = lista.dados?.itens ?? [];
  return (
    <Cartao className="flex flex-col">
      <div className="border-b border-linha px-5 py-4">
        <Rotulo>{titulo}</Rotulo>
      </div>
      <Estado aCarregar={lista.aCarregar} erro={lista.erro} vazio={itens.length === 0} textoVazio={vazio}>
        <ul className="divide-y divide-linha">
          {itens.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => abrir(x.id)}
                className="flex w-full flex-col gap-0.5 px-5 py-3 text-left hover:bg-creme/50"
              >
                <span className="text-sm font-semibold text-tinta">{x.titulo ?? x.pergunta}</span>
                <span className="text-xs text-tinta-3">
                  {quando(x.criada_em)} · {n(x.conversas_total)} conversas · {x.ia ? "com IA" : "só contagens"}
                  {x.guardada_por && ` · guardada por ${x.guardada_por}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Estado>
    </Cartao>
  );
}
