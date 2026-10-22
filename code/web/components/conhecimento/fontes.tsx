"use client";

import {
  BookOpen,
  Check,
  ClipboardPaste,
  Clock,
  ExternalLink,
  FileQuestion,
  FileText,
  Globe,
  History,
  Landmark,
  Map as IconeMapa,
  Phone,
  Plus,
  Pencil,
  RefreshCw,
  Scale,
  Table,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FaixaDemonstracao } from "@/components/painel/faixa-demonstracao";
import { Botao } from "@/components/ui/botao";
import { MenuAcoes, type AcaoMenu } from "@/components/ui/menu-acoes";
import { PainelTurismo } from "@/components/turismo/painel-turismo";
import { useSessao } from "@/lib/sessao";
import {
  Campo,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Interruptor,
  numero,
  Pilula,
  quando,
  useAcao,
  useDados,
} from "./comum";
import { EditarFonte, HistoricoLeituras, HoraRecolha, periodicidade, proximaVez, Sites } from "./recolha";
import type { Entidade, EstadoFonte, Fonte, Fontes as TFontes } from "./tipos";

const TIPOS: Record<string, { rotulo: string; icone: LucideIcon }> = {
  lei: { rotulo: "Lei", icone: Scale },
  regulamento: { rotulo: "Regulamento", icone: BookOpen },
  tabela: { rotulo: "Tabela", icone: Table },
  pagina: { rotulo: "Página", icone: Globe },
  formulario: { rotulo: "Formulário", icone: FileText },
  plano: { rotulo: "Plano", icone: IconeMapa },
  contactos: { rotulo: "Contactos", icone: Phone },
  turismo: { rotulo: "Turismo", icone: Landmark },
};

const ESTADOS: Record<EstadoFonte, { rotulo: string; tom: "verde" | "ambar" | "terracota"; icone: LucideIcon; borda: string }> = {
  em_dia: { rotulo: "Em dia", tom: "verde", icone: Check, borda: "border-linha" },
  mudou: { rotulo: "Mudou", tom: "ambar", icone: TriangleAlert, borda: "border-ambar/60" },
  erro: { rotulo: "Erro ao ler", tom: "terracota", icone: X, borda: "border-terracota/60" },
};

const POR_LER = { rotulo: "Por ler", tom: "neutro" as const, icone: Clock, borda: "border-linha" };

function anfitriao(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function NovaFonte({ onCriada }: { onCriada: () => void }) {
  const { pedido } = useSessao();
  const entidades = useDados<{ itens: Entidade[] }>("/v1/painel/encaminhamento");
  const [v, setV] = useState({
    entidade_id: "",
    titulo: "",
    tipo: "pagina",
    url: "",
    ler_a_cada_horas: 24,
    leitura_automatica: true,
  });
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() =>
          pedido<Fonte>("/v1/painel/conhecimento/fontes", {
            corpo: { ...v, titulo: v.titulo.trim(), url: v.url.trim() },
          }),
        );
        if (r) onCriada();
      }}
    >
      <Campo rotulo="Entidade">
        <select
          className={classeEntrada}
          required
          value={v.entidade_id}
          onChange={(e) => setV({ ...v, entidade_id: e.target.value })}
        >
          <option value="">Escolha a entidade</option>
          {entidades.dados?.itens.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Título">
        <input className={classeEntrada} required maxLength={200} value={v.titulo} onChange={(e) => setV({ ...v, titulo: e.target.value })} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <select className={classeEntrada} value={v.tipo} onChange={(e) => setV({ ...v, tipo: e.target.value })}>
            {Object.entries(TIPOS).map(([k, t]) => (
              <option key={k} value={k}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Ler">
          <select
            className={classeEntrada}
            value={v.ler_a_cada_horas}
            onChange={(e) => setV({ ...v, ler_a_cada_horas: Number(e.target.value) })}
          >
            {[6, 12, 24, 168, 720].map((h) => (
              <option key={h} value={h}>
                {periodicidade(h)}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Endereço (https://…)">
        <input type="url" className={classeEntrada} required value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />
      </Campo>
      <div className="flex items-center gap-2.5 text-[13px] text-tinta">
        <Interruptor
          ligado={v.leitura_automatica}
          rotulo="Leitura automática"
          onMudar={(x) => setV({ ...v, leitura_automatica: x })}
        />
        Ler automaticamente (desligue para PDFs ou sites que bloqueiam: cola-se o texto à mão)
      </div>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={Plus} disabled={acao.aCorrer}>
          Adicionar fonte
        </Botao>
      </div>
    </form>
  );
}

function ColarTexto({ fonte, onFeito }: { fonte: Fonte; onFeito: (msg: string) => void }) {
  const { pedido } = useSessao();
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState("");
  const [ate, setAte] = useState("");
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() =>
          pedido<{ versao_id: string; mudou: boolean }>(
            `/v1/painel/conhecimento/fontes/${fonte.id}/texto`,
            { corpo: { texto, vigor_desde: desde || null, vigor_ate: ate || null } },
          ),
        );
        if (r)
          onFeito(
            r.mudou
              ? "Texto guardado. Mudou em relação à versão anterior: veja as alterações."
              : "Texto guardado. Igual à versão anterior.",
          );
      }}
    >
      <p className="text-sm text-tinta-2">
        Para PDFs ou sites que não deixam ler: cole o texto oficial. Passa pelo mesmo caminho da
        leitura automática (versões, alterações e respostas afetadas).
      </p>
      <Campo rotulo="Texto" ajuda={`${numero(texto.length)} caracteres (mínimo 80)`}>
        <textarea className={`${classeEntrada} min-h-48 font-mono text-xs`} required minLength={80} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Em vigor desde (opcional)">
          <input type="date" className={classeEntrada} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo rotulo="Em vigor até (opcional)">
          <input type="date" className={classeEntrada} value={ate} onChange={(e) => setAte(e.target.value)} />
        </Campo>
      </div>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={ClipboardPaste} disabled={acao.aCorrer || texto.length < 80}>
          {acao.aCorrer ? "A guardar…" : "Guardar texto"}
        </Botao>
      </div>
    </form>
  );
}

interface GrupoFonte {
  principal: Fonte;
  /** A mesma página noutras línguas (o turismo em pt, en, es, fr). */
  traducoes: Fonte[];
}

const LINGUAS = "pt|en|es|fr|de|it";

/**
 * A última marca de língua no caminho do endereço ("…-en", "/en/", "lang=en"),
 * nunca no domínio (o ".pt" de cm-guimaraes.pt não é uma língua).
 */
function marcaLingua(url: string, lingua = LINGUAS): { lingua: string; sem: string } | null {
  let base = url;
  let resto = "";
  try {
    const u = new URL(url);
    base = `${u.protocol}//${u.host}`;
    resto = url.slice(base.length);
  } catch {
    return null;
  }
  const re = new RegExp(`([-_/.=])(${lingua})(?=$|[/?#&.])`, "gi");
  let ultimo: RegExpExecArray | null = null;
  for (let m = re.exec(resto); m; m = re.exec(resto)) ultimo = m;
  if (!ultimo) return null;
  return {
    lingua: ultimo[2].toLowerCase(),
    sem: base + resto.slice(0, ultimo.index + 1) + resto.slice(ultimo.index + ultimo[0].length),
  };
}

/** A língua da fonte: a que vem da recolha ou, sem ela, a marca no endereço ("…-pt"). */
function linguaDe(f: Fonte): string | null {
  return f.lingua ?? marcaLingua(f.url)?.lingua ?? null;
}

/** A página sem a marca da língua, para juntar as traduções. */
function chaveTraducao(f: Fonte): string | null {
  const l = linguaDe(f);
  const m = l ? marcaLingua(f.url, l) : null;
  return m ? `${f.tipo}|${m.sem}` : null;
}

/** Junta as traduções de uma página por baixo da versão portuguesa (pela ordem da lista). */
function agruparTraducoes(itens: Fonte[]): GrupoFonte[] {
  const porChave = new Map<string, Fonte[]>();
  const ordem: (string | Fonte)[] = [];
  for (const f of itens) {
    const k = chaveTraducao(f);
    if (!k) {
      ordem.push(f);
      continue;
    }
    if (!porChave.has(k)) {
      porChave.set(k, []);
      ordem.push(k);
    }
    porChave.get(k)!.push(f);
  }
  return ordem.map((x) => {
    if (typeof x !== "string") return { principal: x, traducoes: [] };
    const fs = porChave.get(x)!;
    const principal = fs.find((f) => linguaDe(f) === "pt") ?? fs[0];
    return { principal, traducoes: fs.filter((f) => f !== principal) };
  });
}

/** O estado de leitura, com a frase por baixo do título. */
function estadoDe(f: Fonte) {
  // Nunca lida (acabada de criar ou descoberta num site): ainda não está "em dia".
  const porLer = f.estado === "em_dia" && !f.ultima_leitura_em;
  const e = porLer ? POR_LER : ESTADOS[f.estado];
  const frase =
    f.estado === "erro"
      ? (f.erro ?? "Não conseguimos ler a página")
      : f.estado === "mudou"
        ? `${f.alteracoes_por_rever} ${f.alteracoes_por_rever === 1 ? "alteração" : "alterações"} por rever`
        : porLer
          ? `${f.entidade} · à espera da primeira leitura`
          : `${f.entidade} · lida ${quando(f.ultima_leitura_em)}`;
  const cor = f.estado === "erro" ? "text-terracota-escuro" : f.estado === "mudou" ? "text-ambar" : "text-tinta-2";
  return { e, porLer, frase, cor };
}

function proximaLeitura(f: Fonte): string {
  if (f.arquivada_em) return `Arquivada ${quando(f.arquivada_em)}: já não é lida`;
  if (!f.leitura_automatica) return "Texto copiado à mão";
  return `${periodicidade(f.ler_a_cada_horas)} · próxima ${proximaVez(f.proxima_leitura_em)}${
    (f.falhas_seguidas ?? 0) > 1 ? ` · ${f.falhas_seguidas} erros seguidos` : ""
  }`;
}

function usoDe(f: Fonte): string {
  return `${f.versoes} ${f.versoes === 1 ? "versão" : "versões"}${
    typeof f.respostas === "number"
      ? ` · usada em ${f.respostas} ${f.respostas === 1 ? "resposta" : "respostas"}${f.citacoes ? ` · citada ${f.citacoes}×` : ""}`
      : ""
  }`;
}

function Linguas({ fontes }: { fontes: Fonte[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {fontes.map((t) => (
        <a key={t.id} href={t.url} target="_blank" rel="noreferrer" title={t.titulo}>
          <Pilula tom={t.estado === "erro" ? "terracota" : t.estado === "mudou" ? "ambar" : "neutro"}>
            {(linguaDe(t) ?? "?").toUpperCase()}
          </Pilula>
        </a>
      ))}
    </span>
  );
}

/** Telemóvel: o cartão de uma página, com as ações no menu "⋯". */
function CartaoFonte({ f, traducoes, acoes }: { f: Fonte; traducoes: Fonte[]; acoes: AcaoMenu[] }) {
  const t = TIPOS[f.tipo] ?? { rotulo: f.tipo, icone: FileText };
  const { e, frase, cor } = estadoDe(f);
  const Icone = t.icone;
  return (
    <li className={`flex flex-col gap-3 rounded-2xl border bg-papel p-5 ${e.borda}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-creme">
            <Icone className="size-4 text-tinta-2" aria-hidden />
          </span>
          <span className="text-[11px] font-bold tracking-[0.4px] text-tinta-3 uppercase">{t.rotulo}</span>
        </span>
        <span className="flex items-center gap-1">
          <Pilula tom={e.tom} icone={e.icone}>
            {e.rotulo}
          </Pilula>
          <MenuAcoes acoes={acoes} rotulo={`Ações · ${f.titulo}`} />
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-bold text-tinta">{f.titulo}</p>
        <p className={`text-[13px] ${cor}`}>{frase}</p>
        <p className="text-xs text-tinta-3">{proximaLeitura(f)}</p>
        {f.site && <p className="text-xs text-tinta-3">Do site «{f.site}»</p>}
        {traducoes.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-tinta-2">
            Também em <Linguas fontes={traducoes} />
          </span>
        )}
      </div>
      <p className="border-t border-linha pt-2.5 text-xs font-semibold text-tinta">{usoDe(f)}</p>
    </li>
  );
}

/** Computador: a tabela das fontes; as traduções de uma página abrem por baixo dela. */
function TabelaFontes({ grupos, acoesDe }: { grupos: GrupoFonte[]; acoesDe: (f: Fonte) => AcaoMenu[] }) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (id: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const linha = (f: Fonte, traducao: boolean, g?: GrupoFonte) => {
    const t = TIPOS[f.tipo] ?? { rotulo: f.tipo, icone: FileText };
    const { e, frase, cor } = estadoDe(f);
    const Icone = t.icone;
    return (
      <tr key={f.id} className={`border-b border-linha last:border-b-0 ${traducao ? "bg-creme/40" : ""}`}>
        <td className={`py-3 pr-3 ${traducao ? "pl-14" : "pl-5"}`}>
          <span className="flex items-start gap-3">
            {!traducao && (
              <span className="mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-creme" title={t.rotulo}>
                <Icone className="size-4 text-tinta-2" aria-hidden />
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-tinta">
                {traducao && <Pilula tom="neutro">{(linguaDe(f) ?? "?").toUpperCase()}</Pilula>}
                {f.titulo}
              </span>
              <span className={`text-[13px] ${cor}`}>{frase}</span>
              {g && g.traducoes.length > 0 && (
                <button
                  type="button"
                  aria-expanded={abertos.has(f.id)}
                  onClick={() => alternar(f.id)}
                  className="w-fit text-xs font-semibold text-terracota-escuro hover:underline"
                >
                  {abertos.has(f.id) ? "Esconder" : "+"} {g.traducoes.length}{" "}
                  {g.traducoes.length === 1 ? "tradução" : "traduções"} (
                  {g.traducoes.map((x) => (linguaDe(x) ?? "?").toUpperCase()).join(", ")})
                </button>
              )}
            </span>
          </span>
        </td>
        <td className="px-3 py-3">
          <Pilula tom={e.tom} icone={e.icone}>
            {e.rotulo}
          </Pilula>
        </td>
        <td className="px-3 py-3 text-[13px] text-tinta-2">{proximaLeitura(f)}</td>
        <td className="px-3 py-3 text-[13px] text-tinta-2">{usoDe(f)}</td>
        <td className="px-3 py-3 text-[13px]">
          <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-tinta-3 hover:text-tinta">
            {anfitriao(f.url)}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </td>
        <td className="py-3 pl-1 pr-3 text-right">
          <MenuAcoes acoes={acoesDe(f)} rotulo={`Ações · ${f.titulo}`} />
        </td>
      </tr>
    );
  };
  return (
    <div className="hidden overflow-visible rounded-2xl border border-linha bg-papel md:block">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Fontes de conhecimento</caption>
        <thead>
          <tr className="h-[42px] border-b border-linha bg-creme text-[11px] font-bold uppercase tracking-[0.6px] text-tinta-3">
            <th scope="col" className="pl-5 pr-3">Fonte</th>
            <th scope="col" className="w-[130px] px-3">Estado</th>
            <th scope="col" className="w-[220px] px-3">Leitura</th>
            <th scope="col" className="w-[220px] px-3">Uso</th>
            <th scope="col" className="w-[170px] px-3">Página</th>
            <th scope="col" className="w-[56px] pr-3">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {grupos.flatMap((g) => [
            linha(g.principal, false, g),
            ...(abertos.has(g.principal.id) ? g.traducoes.map((x) => linha(x, true)) : []),
          ])}
        </tbody>
      </table>
    </div>
  );
}

export function Fontes() {
  const { pedido, pode } = useSessao();
  const [filtro, setFiltro] = useState<"" | EstadoFonte | "arquivadas">("");
  const [nova, setNova] = useState(false);
  const [colar, setColar] = useState<Fonte | null>(null);
  const [editar, setEditar] = useState<Fonte | null>(null);
  const [historico, setHistorico] = useState<Fonte | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const fontes = useDados<TFontes>(
    `/v1/painel/conhecimento/fontes${filtro === "arquivadas" ? "?arquivadas=true" : filtro ? `?estado=${filtro}` : ""}`,
  );
  const ler = useAcao();
  const escrever = pode("conhecimento");
  const i = fontes.dados?.ultima_ingestao;
  const itens = fontes.dados?.itens ?? [];

  const lerAgora = async (caminho: string, msg: string) => {
    const r = await ler.executar(() => pedido<{ em_fila: boolean }>(caminho, { metodo: "POST" }));
    if (r) setAviso(r.em_fila ? msg : "Já há uma leitura em curso.");
  };
  const grupos = agruparTraducoes(itens);
  const acoesDe = (f: Fonte): AcaoMenu[] => [
    ...(escrever
      ? [
          {
            rotulo: "Ler agora",
            icone: RefreshCw,
            desativado: ler.aCorrer,
            onClick: () => void lerAgora(`/v1/painel/conhecimento/fontes/${f.id}/ler`, `Vamos ler «${f.titulo}» agora.`),
          },
          { rotulo: "Colar texto", icone: ClipboardPaste, onClick: () => setColar(f) },
          { rotulo: "Editar", icone: Pencil, onClick: () => setEditar(f) },
          { rotulo: "Histórico de leituras", icone: History, onClick: () => setHistorico(f) },
          ...(f.estado === "mudou"
            ? [{ rotulo: "Rever alterações", icone: TriangleAlert, href: "/painel/conhecimento/alteracoes", tom: "aviso" as const }]
            : []),
        ]
      : []),
    { rotulo: "Abrir a página", icone: ExternalLink, href: f.url, externo: true },
  ];

  return (
    <div className="flex flex-col gap-5 px-4 sm:px-10">
      <section className="flex flex-wrap items-center gap-4 rounded-2xl bg-tinta px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-[18px] bg-[#7FBF8A]/20">
          <RefreshCw className="size-4 text-[#9FD3A8]" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-0.5">
          <p className="text-[15px] font-bold text-white">Lemos o portal e os regulamentos automaticamente</p>
          <p className="text-[13px] text-white/70">
            {i
              ? `Última leitura: ${quando(i.iniciada_em)} · ${numero(i.fontes_lidas)} fontes · ${numero(i.mudancas)} ${i.mudancas === 1 ? "mudança" : "mudanças"} · ${numero(i.erros)} com erro de leitura`
              : "Ainda não houve leituras."}
          </p>
          <HoraRecolha escrever={escrever} onMudou={fontes.recarregar} />
        </div>
        {escrever && (
          <>
            <button
              type="button"
              disabled={ler.aCorrer}
              onClick={() => lerAgora("/v1/painel/conhecimento/fontes/ler", "Pedimos a leitura das fontes vencidas. Os resultados aparecem dentro de minutos.")}
              className="flex h-[38px] items-center gap-1.5 rounded-[10px] bg-white/10 px-3.5 text-[13px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
            >
              <RefreshCw className="size-4" aria-hidden />
              Ler agora
            </button>
            <Botao icone={Plus} onClick={() => setNova(true)}>
              Adicionar fonte
            </Botao>
          </>
        )}
      </section>
      {aviso && <p className="rounded-xl bg-verde-suave px-3 py-2 text-[13px] text-verde">{aviso}</p>}
      <ErroLinha erro={ler.erro} />
      <PainelTurismo aoCarregar={fontes.recarregar} />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar fontes">
        {(["", "mudou", "erro", "em_dia", "arquivadas"] as const).map((e) => (
          <button
            key={e}
            type="button"
            aria-pressed={filtro === e}
            onClick={() => setFiltro(e)}
            className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
              filtro === e ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta-2"
            }`}
          >
            {e === "arquivadas" ? "Arquivadas" : e ? ESTADOS[e].rotulo : "Todas"}
          </button>
        ))}
      </div>

      {itens.some((f) => f.demonstracao) && (
        <FaixaDemonstracao>
          {itens.filter((f) => f.demonstracao).length} destas fontes têm textos de exemplo, escritos para a
          demonstração; as outras são lidas dos sites oficiais.
        </FaixaDemonstracao>
      )}

      <Estado aCarregar={fontes.aCarregar} erro={fontes.erro} vazio={!itens.length} textoVazio="Sem fontes neste filtro.">
        {/* Telemóvel: um cartão por página (as traduções como pílulas). */}
        <ul className="grid grid-cols-1 gap-4 md:hidden">
          {grupos.map((g) => (
            <CartaoFonte key={g.principal.id} f={g.principal} traducoes={g.traducoes} acoes={acoesDe(g.principal)} />
          ))}
        </ul>
        {/* Computador: uma tabela, com as traduções recolhidas por baixo da página. */}
        <TabelaFontes grupos={grupos} acoesDe={acoesDe} />
      </Estado>

      <Sites escrever={escrever} tipos={TIPOS} onMudou={fontes.recarregar} />

      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-linha bg-creme-2 px-5 py-4">
        <FileQuestion className="size-5 text-tinta-2" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-bold text-tinta">Perguntas que as fontes não respondem</p>
          <p className="text-[13px] text-tinta-2">
            Veja as perguntas sem resposta e as melhorias que propomos ao portal.
          </p>
        </div>
        <Link
          href="/painel/conhecimento/sem-resposta"
          className="flex h-9 items-center rounded-[18px] border border-linha bg-papel px-3.5 text-[13px] font-semibold text-tinta hover:bg-creme"
        >
          Ver perguntas
        </Link>
      </section>

      <Dialogo titulo="Adicionar fonte" aberto={nova} onFechar={() => setNova(false)}>
        <NovaFonte
          onCriada={() => {
            setNova(false);
            fontes.recarregar();
          }}
        />
      </Dialogo>
      <Dialogo titulo={editar ? `Editar · ${editar.titulo}` : ""} aberto={!!editar} onFechar={() => setEditar(null)} largura="max-w-2xl">
        {editar && (
          <EditarFonte
            fonte={editar}
            tipos={TIPOS}
            onFeito={(msg) => {
              setEditar(null);
              setAviso(msg);
              fontes.recarregar();
            }}
          />
        )}
      </Dialogo>
      <Dialogo titulo={historico ? `Leituras · ${historico.titulo}` : ""} aberto={!!historico} onFechar={() => setHistorico(null)} largura="max-w-xl">
        {historico && <HistoricoLeituras fonte={historico} />}
      </Dialogo>
      <Dialogo titulo={colar ? `Colar texto · ${colar.titulo}` : ""} aberto={!!colar} onFechar={() => setColar(null)} largura="max-w-2xl">
        {colar && (
          <ColarTexto
            fonte={colar}
            onFeito={(msg) => {
              setColar(null);
              setAviso(msg);
              fontes.recarregar();
            }}
          />
        )}
      </Dialogo>
    </div>
  );
}
