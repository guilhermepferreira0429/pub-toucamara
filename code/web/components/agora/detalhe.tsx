"use client";

import {
  ArrowLeft,
  CalendarClock,
  Check,
  ExternalLink,
  Landmark,
  MapPin,
  MessagesSquare,
  Phone,
  Share2,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/botao";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  MaisDuvidas,
  Rotulo,
  Topo,
} from "@/components/municipe/moldura";
import { usePublico } from "@/components/municipe/use-publico";
import {
  eEmergencia,
  eNovo,
  estiloDe,
  FONTE_DITA,
  inicioDito,
  ondeDito,
  type RespostaDetalhe,
} from "./tipos";

/*
 * Detalhe de um item do "o que se passa" (/agora/[municipio]/[tipo]/[id]),
 * o link dos SMS do feed e dos avisos "avise-me": o mapa pequeno com o
 * ponto ou a zona, o texto, as datas, de onde vem e "partilhar".
 */

const Mapa = dynamic(() => import("./mapa-agora"), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-2xl bg-creme-2" />,
});

/** O link do item quando aponta para outra página (consulta, site do evento). */
function linkProprio(link: string, slug: string): { href: string; interno: boolean } | null {
  try {
    const u = new URL(link, "http://x");
    if (u.pathname.startsWith(`/agora/${slug}`)) return null;
    if (u.pathname.startsWith("/consulta/")) return { href: u.pathname, interno: true };
    return /^https?:\/\//.test(link) ? { href: link, interno: false } : null;
  } catch {
    return null;
  }
}

function VoltarAoFeed({ slug }: { slug: string }) {
  return (
    <Link
      href={`/agora/${encodeURIComponent(slug)}`}
      className="inline-flex min-h-11 items-center gap-2 self-start text-[16px] font-semibold text-terracota-escuro underline underline-offset-2"
    >
      <ArrowLeft className="size-5" aria-hidden />
      Voltar ao que se passa
    </Link>
  );
}

function Partilhar({ titulo }: { titulo: string }) {
  const [estado, setEstado] = useState<"nada" | "copiado" | "falhou">("nada");
  async function partilhar() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: titulo, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setEstado("copiado");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setEstado("falhou");
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Botao
        variante="secundario"
        tamanho="grande"
        icone={estado === "copiado" ? Check : Share2}
        onClick={() => void partilhar()}
        className="w-full"
      >
        Partilhar
      </Botao>
      <p role="status" className="text-center text-[14px] text-tinta-2">
        {estado === "copiado" ? "Link copiado. Já o pode colar numa mensagem." : estado === "falhou" ? "Não foi possível partilhar. Copie o endereço da página." : ""}
      </p>
    </div>
  );
}

export function DetalheAgora({ slug, tipo, id }: { slug: string; tipo: string; id: string }) {
  const { c, tentarOutraVez } = usePublico<RespostaDetalhe>(
    `/v1/public/agora/${encodeURIComponent(slug)}/${encodeURIComponent(tipo)}/${encodeURIComponent(id)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;
  if (c.estado === "invalido") {
    return (
      <div className="flex w-full flex-col gap-6">
        <Topo direita="O que se passa" />
        <Cabecalho
          titulo="Isto já não está na lista."
          sub="Pode já ter terminado ou ter sido retirado pela câmara. Veja o que se passa agora no concelho."
        />
        <BotaoLink href={`/agora/${encodeURIComponent(slug)}`} tamanho="grande" icone={ArrowLeft} className="w-full">
          Ver o que se passa
        </BotaoLink>
      </div>
    );
  }

  const d = c.dados;
  const i = d.item;
  const e = estiloDe(i);
  const Icone = e.icone;
  const emergencia = eEmergencia(i);
  const onde = ondeDito(i);
  const link = linkProprio(i.link, slug);
  const temMapa = (i.lat !== null && i.lng !== null) || !!i.poligono?.length;
  const texto = d.texto?.trim() || i.resumo;
  const paragrafos = texto.split(/\n{2,}|\r\n\r\n/).filter((p) => p.trim());

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="O que se passa" />
      <VoltarAoFeed slug={slug} />

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-[18px_18px_18px_6px] text-white"
          style={{ background: e.cor }}
        >
          <Icone className="size-6" />
        </span>
        <Cabecalho
          meta={
            <>
              {i.etiqueta}
              {eNovo(i) && <span className="ml-2 rounded-full bg-terracota px-2 py-0.5 text-[11px] text-white normal-case">Novo</span>}
            </>
          }
          titulo={i.titulo}
        />
      </div>

      {emergencia && (
        <a
          href="tel:112"
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full px-5 text-[17px] font-bold text-white"
          style={{ background: e.cor }}
        >
          <Phone className="size-5" aria-hidden />
          Em perigo? Ligue 112
        </a>
      )}

      <dl className="flex w-full flex-col gap-3 rounded-2xl border border-linha bg-papel p-4">
        {d.quando && (
          <div className="grid grid-cols-[20px_1fr] gap-x-3 gap-y-0.5">
            <dt className="col-span-2 flex items-center gap-3 text-[12px] font-bold tracking-[0.8px] text-tinta-3 uppercase">
              <CalendarClock className="size-5 shrink-0" aria-hidden />
              Quando
            </dt>
            <dd className="col-start-2 text-[16px] font-semibold text-tinta first-letter:uppercase">{d.quando}</dd>
            {(i.inicio || i.fim) && (
              <dd className="col-start-2 text-[14px] text-tinta-2">
                {i.inicio && <>Início: {inicioDito(i.inicio)}. </>}
                {i.fim && <>Fim: {inicioDito(i.fim)}.</>}
              </dd>
            )}
          </div>
        )}
        {onde && (
          <div className="grid grid-cols-[20px_1fr] gap-x-3 gap-y-0.5">
            <dt className="col-span-2 flex items-center gap-3 text-[12px] font-bold tracking-[0.8px] text-tinta-3 uppercase">
              <MapPin className="size-5 shrink-0" aria-hidden />
              Onde
            </dt>
            <dd className="col-start-2 text-[16px] font-semibold text-tinta">{onde}</dd>
          </div>
        )}
        <div className="grid grid-cols-[20px_1fr] gap-x-3 gap-y-0.5">
          <dt className="col-span-2 flex items-center gap-3 text-[12px] font-bold tracking-[0.8px] text-tinta-3 uppercase">
            <Landmark className="size-5 shrink-0" aria-hidden />
            De onde vem
          </dt>
          <dd className="col-start-2 text-[16px] text-tinta">
            {FONTE_DITA[i.fonte] ?? "Câmara municipal"} · Câmara Municipal de {d.municipio.nome}
          </dd>
        </div>
      </dl>

      {temMapa && (
        <section aria-labelledby="no-mapa" className="flex flex-col gap-2">
          <Rotulo id="no-mapa">No mapa</Rotulo>
          <div className="overflow-hidden rounded-2xl border border-linha">
            <Mapa itens={[i]} slug={slug} zona className="h-56 w-full" />
          </div>
          {i.fonte === "ocorrencia" && (
            <p className="text-[13px] text-tinta-3">O ponto é aproximado (cerca de 100 m), para proteger quem vive ali.</p>
          )}
        </section>
      )}

      <section aria-label="O que diz" className="flex flex-col gap-3">
        {paragrafos.map((p, n) => (
          <p key={n} className="text-[17px] leading-[1.55] whitespace-pre-line text-tinta">
            {p}
          </p>
        ))}
      </section>

      {link &&
        (link.interno ? (
          <BotaoLink href={link.href} tamanho="grande" icone={MessagesSquare} className="w-full">
            {i.tipo === "consultas" ? "Ver a consulta e dar a opinião" : "Ver mais"}
          </BotaoLink>
        ) : (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-terracota px-6 text-[17px] font-semibold text-white hover:bg-terracota-escuro"
          >
            <ExternalLink className="size-[1.15em]" aria-hidden />
            Mais informação
            <span className="sr-only"> (abre noutra janela)</span>
          </a>
        ))}

      <Partilhar titulo={i.titulo} />
      <VoltarAoFeed slug={slug} />

      <MaisDuvidas titulo="Quer saber mais?" nota="Pergunte ao assistente da câmara: sabe o que se passa na sua rua." />
    </div>
  );
}
