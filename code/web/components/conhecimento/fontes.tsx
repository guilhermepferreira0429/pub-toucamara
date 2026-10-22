"use client";

import {
  BookOpen,
  Check,
  ClipboardPaste,
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
import { Botao } from "@/components/ui/botao";
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

  return (
    <div className="flex flex-col gap-5 px-10">
      <section className="flex flex-wrap items-center gap-4 rounded-2xl bg-tinta px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-[18px] bg-[#7FBF8A]/20">
          <RefreshCw className="size-4 text-[#9FD3A8]" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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

      <Estado aCarregar={fontes.aCarregar} erro={fontes.erro} vazio={!itens.length} textoVazio="Sem fontes neste filtro.">
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {itens.map((f) => {
            const t = TIPOS[f.tipo] ?? { rotulo: f.tipo, icone: FileText };
            const e = ESTADOS[f.estado];
            const Icone = t.icone;
            return (
              <li key={f.id} className={`flex flex-col gap-3 rounded-2xl border bg-papel p-5 ${e.borda}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-creme">
                      <Icone className="size-4 text-tinta-2" aria-hidden />
                    </span>
                    <span className="text-[10px] font-bold tracking-[0.4px] text-tinta-3 uppercase">{t.rotulo}</span>
                  </span>
                  <Pilula tom={e.tom} icone={e.icone}>
                    {e.rotulo}
                  </Pilula>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-[15px] font-bold text-tinta">{f.titulo}</p>
                  <p
                    className={`text-[13px] ${f.estado === "erro" ? "text-terracota-escuro" : f.estado === "mudou" ? "text-ambar" : "text-tinta-2"}`}
                  >
                    {f.estado === "erro"
                      ? (f.erro ?? "Não conseguimos ler a página")
                      : f.estado === "mudou"
                        ? `${f.alteracoes_por_rever} ${f.alteracoes_por_rever === 1 ? "alteração" : "alterações"} por rever`
                        : `${f.entidade} · lida ${quando(f.ultima_leitura_em)}`}
                  </p>
                  {f.arquivada_em ? (
                    <p className="text-xs text-tinta-3">Arquivada {quando(f.arquivada_em)}: já não é lida</p>
                  ) : !f.leitura_automatica ? (
                    <p className="text-xs text-tinta-3">Leitura manual (texto colado)</p>
                  ) : (
                    <p className="text-xs text-tinta-3">
                      {periodicidade(f.ler_a_cada_horas)} · próxima {proximaVez(f.proxima_leitura_em)}
                      {(f.falhas_seguidas ?? 0) > 1 && (
                        <span className="text-terracota-escuro"> · {f.falhas_seguidas} erros seguidos</span>
                      )}
                    </p>
                  )}
                  {f.site && <p className="text-xs text-tinta-3">Do site «{f.site}»</p>}
                  {(f.demonstracao || (f.lingua && f.lingua !== "pt")) && (
                    <span className="flex flex-wrap gap-1.5">
                      {f.lingua && f.lingua !== "pt" && <Pilula tom="neutro">{f.lingua.toUpperCase()}</Pilula>}
                      {f.demonstracao && <Pilula tom="ambar">valores de demonstração</Pilula>}
                    </span>
                  )}
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-linha pt-2.5">
                  <span className="text-xs font-semibold text-tinta">
                    {f.versoes} {f.versoes === 1 ? "versão" : "versões"}
                    {typeof f.respostas === "number" && (
                      <span className="font-normal text-tinta-2">
                        {" "}
                        · usada em {f.respostas} {f.respostas === 1 ? "resposta" : "respostas"}
                        {f.citacoes ? ` · citada ${f.citacoes}×` : ""}
                      </span>
                    )}
                  </span>
                  <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-tinta-3 hover:text-tinta">
                    {anfitriao(f.url)}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>
                {escrever && (
                  <div className="flex flex-wrap gap-3 text-xs font-semibold">
                    <button
                      type="button"
                      disabled={ler.aCorrer}
                      className="flex items-center gap-1 text-terracota-escuro hover:underline"
                      onClick={() => lerAgora(`/v1/painel/conhecimento/fontes/${f.id}/ler`, `Vamos ler «${f.titulo}» agora.`)}
                    >
                      <RefreshCw className="size-3" aria-hidden /> Ler agora
                    </button>
                    <button type="button" className="flex items-center gap-1 text-terracota-escuro hover:underline" onClick={() => setColar(f)}>
                      <ClipboardPaste className="size-3" aria-hidden /> Colar texto
                    </button>
                    <button type="button" className="flex items-center gap-1 text-terracota-escuro hover:underline" onClick={() => setEditar(f)}>
                      <Pencil className="size-3" aria-hidden /> Editar
                    </button>
                    <button type="button" className="flex items-center gap-1 text-terracota-escuro hover:underline" onClick={() => setHistorico(f)}>
                      <History className="size-3" aria-hidden /> Histórico
                    </button>
                    {f.estado === "mudou" && (
                      <Link href="/painel/conhecimento/alteracoes" className="text-ambar hover:underline">
                        Rever alterações
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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
