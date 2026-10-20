"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Aviso } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { PassagemDetalhe } from "./passagem";

/** /painel/passagens/:id (o link_painel das passagens na Entrada e na Visão geral). */
export function PassagemPagina() {
  const { pode } = useSessao();
  const { id } = useParams<{ id: string }>();
  if (!pode("conversas")) {
    return (
      <div className="pt-8">
        <Aviso titulo="Sem acesso">O seu perfil não tem acesso às passagens a funcionário.</Aviso>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[860px] pt-4">
      <Link
        href={pode("entrada") ? `/painel/entrada?item=passagem:${id}` : "/painel"}
        className="mx-8 mt-4 flex w-fit items-center gap-1.5 text-[13px] font-semibold text-tinta-2 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {pode("entrada") ? "Ver na Entrada" : "Voltar à visão geral"}
      </Link>
      <PassagemDetalhe id={id} />
    </div>
  );
}
