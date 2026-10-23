"use client";

import {
  Building2,
  Check,
  CornerUpRight,
  FileText,
  GitCompareArrows,
  Landmark,
  Loader,
  MapPin,
  Moon,
  Send,
  Siren,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Cartao, Estado, numero, pct, quando, useDados, type Pagina } from "./comum";
import type { AvaliacaoMapa, Contradicao, Entidade, Fontes, Mapa, MedidaAvaliacao, Qualidade, TemaMapa } from "./tipos";

/** Anel de percentagem (destaque escuro do mapa). */
function Anel({ valor, rotulo }: { valor: number | null; rotulo: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const v = valor === null ? 0 : Math.max(0, Math.min(100, valor));
  return (
    <div className="flex w-24 flex-col items-center gap-2.5 justify-self-center">
      <div className="relative size-24">
        <svg viewBox="0 0 96 96" className="size-24 -rotate-90" aria-hidden>
          <circle cx="48" cy="48" r={r} fill="none" strokeWidth="8" className="stroke-white/15" />
          <circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
            className={v >= 80 ? "stroke-[#7FBF8A]" : "stroke-[#E8B04B]"}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-[22px] font-bold text-white">
          {pct(valor)}
        </span>
      </div>
      <span className="text-center text-xs font-semibold text-white/80">{rotulo}</span>
    </div>
  );
}

/** Parte das respostas do tema que está no ar (0–100), ou null sem respostas. */
function parteNoAr(t: TemaMapa): number | null {
  return t.respostas_total ? Math.round((t.respostas_no_ar / t.respostas_total) * 100) : null;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** A medida da avaliação para o tema (a categoria das perguntas com o mesmo nome). */
function medidaDoTema(t: TemaMapa, a: AvaliacaoMapa | null | undefined): MedidaAvaliacao | null {
  if (!a) return null;
  const n = normalizar(t.nome);
  const chave = Object.keys(a.por_categoria).find((k) => normalizar(k) === n);
  return chave ? a.por_categoria[chave] : null;
}

/**
 * Quanto o agente sabe responder neste tema (0–100): com avaliação, a parte
 * das perguntas do tema com resposta certa ou maioritariamente certa; sem
 * avaliação para o tema, a parte das respostas preparadas que está no ar.
 */
function sabeResponder(t: TemaMapa, a: AvaliacaoMapa | null | undefined): number | null {
  const m = medidaDoTema(t, a);
  if (m && m.total) return Math.round((m.certas / m.total) * 100);
  return parteNoAr(t);
}

function corDoTema(p: number | null) {
  if (p === null || p < 50) return { fundo: "bg-terracota", texto: "text-white", sub: "text-white/80" };
  if (p < 80) return { fundo: "bg-ambar-suave", texto: "text-ambar", sub: "text-tinta-2" };
  if (p < 95) return { fundo: "bg-[#9CC2A1]", texto: "text-tinta", sub: "text-tinta-2" };
  return { fundo: "bg-verde", texto: "text-white", sub: "text-white/80" };
}

const LEGENDA = [
  { rotulo: "95–100%", cor: "bg-verde" },
  { rotulo: "80–94%", cor: "bg-[#9CC2A1]" },
  { rotulo: "50–79%", cor: "bg-ambar-suave border border-ambar/30" },
  { rotulo: "menos de 50%", cor: "bg-terracota" },
];

function Mosaico({ temas, avaliacao }: { temas: TemaMapa[]; avaliacao?: AvaliacaoMapa | null }) {
  const visiveis = temas.filter((t) => t.conversas_30d > 0 || t.respostas_total > 0).slice(0, 14);
  if (!visiveis.length) {
    return (
      <p className="text-sm text-tinta-3">
        Ainda não há temas com conversas nos últimos 30 dias.
      </p>
    );
  }
  return (
    // Telemóvel (abaixo de `sm`): uma lista, um tema por linha. A partir de
    // `sm`: o mosaico de 6 colunas, com o tamanho a seguir as conversas.
    <ul className="flex flex-col gap-1.5 sm:grid sm:grid-flow-row-dense sm:auto-rows-[minmax(104px,auto)] sm:grid-cols-6">
      {visiveis.map((t, i) => {
        const p = sabeResponder(t, avaliacao);
        const cor = corDoTema(p);
        const grande = i === 0;
        const medio = i > 0 && i < 3;
        const span = grande
          ? "sm:col-span-2 sm:row-span-3"
          : medio
            ? "sm:col-span-2 sm:row-span-2"
            : i < 7
              ? "sm:col-span-2"
              : "sm:col-span-1";
        const destaque = grande || medio;
        // Sem respostas, o mosaico leva a criar a primeira (não há nada para ver).
        const href =
          p === null
            ? `/painel/conhecimento/respostas?tema=${t.tema_id}&nova=1`
            : `/painel/conhecimento/respostas?tema=${t.tema_id}`;
        return (
          <li key={t.tema_id} className={span}>
            <Link
              href={href}
              title={
                p === null ? `Criar a primeira resposta de ${t.nome}` : `Ver as respostas de ${t.nome}`
              }
              className={`flex h-full items-center justify-between gap-3 overflow-hidden rounded-[14px] px-4 py-3 transition-opacity hover:opacity-90 sm:flex-col sm:items-stretch ${destaque ? "sm:p-5" : "sm:p-3.5"} ${cor.fundo}`}
            >
              <div className="min-w-0">
                <p
                  className={`font-display font-bold leading-tight ${cor.texto} text-base ${destaque ? "sm:text-2xl" : "sm:text-[15px]"}`}
                >
                  {t.nome}
                </p>
                <p className={`mt-0.5 text-xs ${destaque ? "sm:text-[13px]" : "sm:text-[11px]"} ${cor.sub}`}>
                  {numero(t.conversas_30d)} {t.conversas_30d === 1 ? "conversa" : "conversas"}
                </p>
              </div>
              {p === null ? (
                <div className="flex shrink-0 flex-col items-end sm:items-start">
                  <p
                    className={`font-display font-extrabold leading-none ${cor.texto} text-[22px] ${destaque ? "sm:text-[40px]" : ""}`}
                    aria-hidden
                  >
                    —
                  </p>
                  <p className={`mt-1 truncate text-xs font-semibold ${cor.sub}`}>
                    Sem resposta · Criar →
                  </p>
                </div>
              ) : (
                <p
                  className={`shrink-0 font-display font-extrabold ${cor.texto} text-[22px] ${destaque ? "sm:text-[40px] sm:leading-none" : ""}`}
                >
                  {pct(p)}
                </p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const ICONE_ENTIDADE: Record<string, LucideIcon> = {
  emergencia: Siren,
  camara: Landmark,
  empresa_municipal: Building2,
  junta: MapPin,
  nacional: CornerUpRight,
  outra: Building2,
};

export function MapaConhecimento() {
  const mapa = useDados<Mapa>("/v1/painel/conhecimento/mapa");
  const qualidade = useDados<Qualidade>("/v1/painel/conhecimento/qualidade");
  const fontes = useDados<Fontes>("/v1/painel/conhecimento/fontes");
  const entidades = useDados<{ itens: Entidade[] }>("/v1/painel/encaminhamento");
  const contradicoes = useDados<Pagina<Contradicao>>(
    "/v1/painel/conhecimento/contradicoes?estado=aberta&limite=1",
  );

  if (mapa.erro || (mapa.aCarregar && !mapa.dados)) {
    return (
      <div className="px-4 sm:px-10">
        <Cartao>
          <Estado aCarregar={mapa.aCarregar} erro={mapa.erro} />
        </Cartao>
      </div>
    );
  }
  const m = mapa.dados!;
  const totalConversas = m.temas.reduce((s, t) => s + t.conversas_30d, 0);
  const comResposta = m.temas
    .filter((t) => t.respostas_no_ar > 0)
    .reduce((s, t) => s + t.conversas_30d, 0);
  const coberturaRespostas = totalConversas ? Math.round((comResposta / totalConversas) * 100) : null;

  // Com avaliação: medido. "Sabe responder" = respostas certas ou maioritariamente
  // certas em todas as perguntas do teste; "Cobertura" = parte das perguntas a que
  // respondeu; "Qualidade" = das que respondeu, as certas ou maioritariamente certas.
  const av = m.avaliacao;
  // A mesma conta da página pública e do separador Qualidade: certas ou maioritariamente certas / todas
  // as perguntas do teste (sem pesar pelos temas), com uma casa decimal.
  const sabe = av ? Math.round((av.total.certas / av.total.total) * 1000) / 10 : coberturaRespostas;
  const cobertura = av ? Math.round((av.total.respondidas / av.total.total) * 100) : coberturaRespostas;
  const qualidadeMedida = av && av.total.respondidas
    ? Math.round((av.total.certas / av.total.respondidas) * 100)
    : null;

  const lista = fontes.dados?.itens ?? [];
  // Fontes em dia: as que leem sem erro (em dia ou com alteração detetada), sobre as ativas (as
  // arquivadas ficam de fora). Contagens de todas as fontes, não só da primeira página da lista.
  const cont = fontes.dados?.contagens;
  const ativas = cont ? cont.em_dia + cont.mudou + cont.erro : 0;
  const emDia = cont
    ? ativas ? Math.round(((cont.em_dia + cont.mudou) / ativas) * 100) : null
    : lista.length
      ? Math.round((lista.filter((f) => f.estado !== "erro").length / lista.length) * 100)
      : null;
  const porEntidade = new Map<string, number>();
  for (const f of lista) porEntidade.set(f.entidade, (porEntidade.get(f.entidade) ?? 0) + 1);
  const entidadesComFontes = [...porEntidade.entries()].sort((a, b) => b[1] - a[1]);
  const maxFontes = entidadesComFontes[0]?.[1] ?? 1;
  const ingestao = fontes.dados?.ultima_ingestao;

  const todas = entidades.dados?.itens.filter((e) => e.ativo) ?? [];
  const locais = todas.filter((e) => e.tipo !== "nacional");
  const nacionais = todas.filter((e) => e.tipo === "nacional");
  const contradicao = contradicoes.dados?.itens[0];

  return (
    <div className="flex flex-col gap-5 px-4 sm:px-10">
      {/* Destaque */}
      <section className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-tinta px-5 py-6 sm:gap-10 sm:px-8 sm:py-7">
        <div className="flex max-w-[664px] flex-col gap-1.5">
          <p className="text-[11px] font-bold tracking-[0.4px] text-white/60">
            O AGENTE SABE RESPONDER A
          </p>
          <div className="flex items-center gap-3.5">
            <span className="font-display text-[56px] leading-none font-extrabold text-white sm:text-[80px]">
              {pct(sabe, av ? 1 : 0)}
            </span>
            <span className="font-display text-lg leading-tight font-semibold whitespace-pre-line text-white/80 sm:text-[22px]">
              {"do que os munícipes\nlhe perguntam"}
            </span>
          </div>
          <p className="text-[13px] text-white/60">
            {av
              ? `Medido no teste de ${numero(av.total.total)} perguntas${av.medida_em ? ` (${quando(av.medida_em)})` : ""}, julgadas às cegas · `
              : `${plural(m.resumo.respostas_no_ar, "resposta", "respostas")} no ar · `}
            {plural(m.resumo.fontes, "fonte", "fontes")} de{" "}
            {plural(porEntidade.size, "entidade", "entidades")} do concelho
            {ingestao ? ` · lidas ${quando(ingestao.iniciada_em)}` : ""}
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-3 sm:flex sm:w-auto sm:gap-7">
          <Anel valor={cobertura} rotulo="Cobertura" />
          <Anel valor={qualidadeMedida ?? qualidade.dados?.ultima?.taxa ?? null} rotulo="Certas quando responde" />
          <Anel valor={emDia} rotulo="Fontes em dia" />
        </div>
      </section>

      {/* Mapa dos temas */}
      <Cartao className="flex flex-col gap-3.5 rounded-[20px] p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-bold text-tinta">
              O que perguntam, e se sabemos responder
            </h2>
            <p className="text-[13px] text-tinta-2">
              O tamanho segue o número de conversas dos últimos 30 dias.{" "}
              {m.avaliacao
                ? "A cor é a parte das perguntas de teste do tema com resposta certa ou maioritariamente certa."
                : "A cor é a parte das respostas do tema que está no ar."}
            </p>
          </div>
          <ul className="flex flex-wrap gap-3.5" aria-label="Legenda">
            {LEGENDA.map((l) => (
              <li key={l.rotulo} className="flex items-center gap-1.5 text-xs text-tinta-2">
                <span className={`size-2.5 rounded-[3px] ${l.cor}`} aria-hidden />
                {l.rotulo}
              </li>
            ))}
          </ul>
        </div>
        <Mosaico temas={m.temas} avaliacao={m.avaliacao} />
      </Cartao>

      {/* Fontes e esta noite */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,672fr)_minmax(0,420fr)]">
        <Cartao className="flex flex-col gap-3 rounded-[20px] p-4 sm:p-6">
          <h2 className="font-display text-lg font-bold text-tinta">Fontes por entidade</h2>
          <Estado
            aCarregar={fontes.aCarregar}
            erro={fontes.erro}
            vazio={!entidadesComFontes.length}
            textoVazio="Ainda não há fontes."
          >
            <ul className="flex flex-col gap-3">
              {entidadesComFontes.slice(0, 6).map(([nome, n]) => (
                <li key={nome} className="flex items-center gap-3">
                  <FileText className="size-4 shrink-0 text-verde" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-tinta">{nome}</span>
                  <span className="h-2 w-[120px] overflow-hidden rounded bg-creme-2" aria-hidden>
                    <span
                      className="block h-full rounded bg-verde"
                      style={{ width: `${(n / maxFontes) * 100}%` }}
                    />
                  </span>
                  <span className="w-16 text-right text-xs font-bold text-tinta">
                    {n} {n === 1 ? "fonte" : "fontes"}
                  </span>
                </li>
              ))}
            </ul>
          </Estado>
        </Cartao>

        <section className="flex flex-col gap-3 rounded-[20px] bg-terracota-suave p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Moon className="size-[18px] text-terracota-escuro" aria-hidden />
            <h2 className="font-display text-lg font-bold text-terracota-escuro">
              {ingestao ? `Última leitura: ${quando(ingestao.iniciada_em)}` : "Leitura das fontes"}
            </h2>
          </div>
          <p className="text-sm text-tinta">
            {ingestao
              ? `Lemos ${numero(ingestao.fontes_lidas)} ${ingestao.fontes_lidas === 1 ? "fonte" : "fontes"}. Encontrámos ${numero(ingestao.mudancas)} ${ingestao.mudancas === 1 ? "alteração" : "alterações"}${ingestao.erros ? ` e ${numero(ingestao.erros)} ${ingestao.erros === 1 ? "erro" : "erros"} de leitura` : ""}.`
              : "Ainda não houve nenhuma leitura automática das fontes."}
          </p>
          <Link
            href="/painel/conhecimento/alteracoes"
            className="flex w-fit items-center gap-2 rounded-[10px] bg-papel px-3 py-2 text-xs font-semibold text-tinta-2 hover:text-tinta"
          >
            <Loader className="size-3.5" aria-hidden />
            {m.resumo.alteracoes_por_rever
              ? `${m.resumo.alteracoes_por_rever} ${m.resumo.alteracoes_por_rever === 1 ? "alteração" : "alterações"} por rever`
              : "Nada por rever"}
          </Link>
        </section>
      </div>

      {/* Concelho e contradições */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,652fr)_minmax(0,440fr)]">
        <Cartao className="flex flex-col gap-3.5 rounded-[20px] p-4 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-bold text-tinta">
              O concelho inteiro, não só o site da câmara
            </h2>
            <p className="text-[13px] text-tinta-2">
              {plural(m.resumo.fontes, "fonte lida", "fontes lidas")} automaticamente. O munícipe só precisa de um
              número.
            </p>
          </div>
          <Estado
            aCarregar={entidades.aCarregar}
            erro={entidades.erro}
            vazio={!locais.length}
            textoVazio="Ainda não há entidades configuradas."
          >
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {locais.slice(0, 8).map((e) => {
                const Icone = ICONE_ENTIDADE[e.tipo] ?? Building2;
                return (
                  <li key={e.id} className="flex items-center gap-2.5 rounded-xl bg-creme px-3 py-2.5">
                    <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-tinta">
                      <Icone className="size-4 text-white" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-bold text-tinta">{e.nome}</span>
                      <span className="truncate text-[11px] text-tinta-3">
                        {e.descricao ?? `${e.regras.length} ${e.regras.length === 1 ? "assunto" : "assuntos"}`}
                      </span>
                    </span>
                    <span className="text-xs font-bold text-tinta-2">
                      {porEntidade.get(e.nome) ?? 0}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Estado>
          {nacionais.length > 0 && (
            <p className="flex w-fit items-center gap-2 rounded-[10px] bg-creme-2 px-3 py-2 text-xs text-tinta-2">
              <CornerUpRight className="size-3.5" aria-hidden />
              Só para encaminhar: {nacionais.map((e) => e.nome).join(", ")}
            </p>
          )}
        </Cartao>

        <Cartao className="flex flex-col gap-3 rounded-[20px] p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="size-[18px] text-ambar" aria-hidden />
            <h2 className="font-display text-[17px] font-bold text-ambar">
              {contradicao ? "Encontrámos informação contraditória" : "Sem informação contraditória"}
            </h2>
          </div>
          <Estado aCarregar={contradicoes.aCarregar} erro={contradicoes.erro}>
            {contradicao ? (
              <>
                <p className="text-[13px] font-bold text-tinta">{contradicao.assunto}</p>
                {(["a", "b"] as const).map((l) => {
                  const lado = contradicao[l];
                  const usar = contradicao.usar === l;
                  const valor = l === "a" ? contradicao.valor_a : contradicao.valor_b;
                  return (
                    <div
                      key={l}
                      className={`flex flex-col gap-0.5 rounded-[10px] px-3 py-2.5 ${usar ? "bg-verde-suave" : "bg-terracota-suave/50"}`}
                    >
                      <span
                        className={`flex items-center gap-1.5 text-[11px] font-bold ${usar ? "text-verde" : "text-terracota-escuro"}`}
                      >
                        {usar ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                        {lado.entidade} · {lado.fonte}
                      </span>
                      <span className="text-[13px] text-tinta">{valor}</span>
                    </div>
                  );
                })}
                <p className="text-xs text-tinta-2">
                  {contradicao.usar
                    ? "O agente já responde com a fonte marcada. Falta corrigir a outra."
                    : "Escolha qual das fontes o agente deve usar."}
                </p>
                <Link
                  href="/painel/conhecimento/alteracoes#contradicoes"
                  className="flex h-[34px] w-fit items-center gap-1.5 rounded-[17px] bg-tinta px-3 text-xs font-semibold text-white hover:bg-tinta/90"
                >
                  <Send className="size-3.5" aria-hidden />
                  Ver contradições
                </Link>
              </>
            ) : (
              <p className="text-[13px] text-tinta-2">
                As fontes do concelho dizem o mesmo sobre contactos, horários e valores.
              </p>
            )}
          </Estado>
        </Cartao>
      </div>
    </div>
  );
}

/** "1 fonte" / "3 fontes" (números formatados como no resto do ecrã). */
function plural(n: number, um: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? um : varios}`;
}
