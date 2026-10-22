"use client";

import { Hand, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ATENDIMENTO_LGP,
  type ConteudoLgp,
  conteudoDoCaminho,
  videoLgp,
} from "@/lib/acessibilidade";

/*
 * Língua Gestual Portuguesa (LGP).
 *
 * - <VideoLgp>: o vídeo em LGP desta página, quando a câmara o gravou e o
 *   configurou (NEXT_PUBLIC_LGP_VIDEOS). Sem vídeo, não mostra nada.
 * - <PedirLgp>: "Pedir atendimento em Língua Gestual", com o que existe de
 *   verdade: a videochamada com intérprete, se a câmara a tiver
 *   (NEXT_PUBLIC_LGP_VIDEOCHAMADA_*); senão, diz que ainda não há e dá as
 *   alternativas escritas (chat e SMS).
 */

export function VideoLgp({ tipo }: { tipo?: ConteudoLgp }) {
  const caminho = usePathname();
  const t = tipo ?? conteudoDoCaminho(caminho);
  const v = t ? videoLgp(t) : null;
  if (!v) return null;
  const ficheiro = /\.(mp4|webm|ogg)(\?|$)/i.test(v.url);
  return (
    <section
      aria-label="Esta página em Língua Gestual Portuguesa"
      data-nao-ler
      className="flex w-full flex-col gap-2 pb-4"
    >
      <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta">
        <Hand className="size-5" aria-hidden />
        Esta página em Língua Gestual Portuguesa
      </p>
      {ficheiro ? (
        <video
          controls
          preload="metadata"
          playsInline
          className="w-full rounded-2xl bg-tinta"
        >
          <source src={v.url} />
          {v.legendas && (
            <track kind="captions" src={v.legendas} srcLang="pt-PT" label="Português" default />
          )}
          <a href={v.url}>Abrir o vídeo em Língua Gestual Portuguesa</a>
        </video>
      ) : (
        <a
          href={v.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 font-semibold text-terracota-escuro underline"
        >
          <Video className="size-5" aria-hidden />
          Ver o vídeo em Língua Gestual Portuguesa
        </a>
      )}
    </section>
  );
}

export function PedirLgp() {
  const { url, nome, horario } = ATENDIMENTO_LGP;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta">
        <Hand className="size-5" aria-hidden />
        Atendimento em Língua Gestual Portuguesa
      </p>
      {url ? (
        <>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 font-semibold text-terracota-escuro underline"
          >
            <Video className="size-5" aria-hidden />
            Pedir atendimento em Língua Gestual
            {nome ? ` (${nome})` : ""}
          </a>
          <p className="text-[14px] leading-[1.45] text-tinta-2">
            Videochamada com intérprete de Língua Gestual Portuguesa
            {horario ? `, ${horario}` : ""}.
          </p>
        </>
      ) : (
        <p className="text-[14px] leading-[1.45] text-tinta-2">
          Ainda não temos atendimento por videochamada com intérprete. Pode
          tratar de tudo por escrito, no{" "}
          <Link href="/chat" className="font-semibold text-terracota-escuro underline">
            chat
          </Link>
          , a qualquer hora.
        </p>
      )}
    </div>
  );
}
