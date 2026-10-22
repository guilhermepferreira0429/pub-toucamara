"use client";

import { Check, Link2, ListRestart, Share2 } from "lucide-react";
import { useState } from "react";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  TituloSecao,
  Topo,
} from "@/components/municipe/moldura";
import { usePublico } from "@/components/municipe/use-publico";
import { Botao, BotaoLink } from "@/components/ui/botao";
import { CalendarioEmpresa, ListaEmpresa, MarcaDemonstracao } from "./lista";
import type { PaginaLista } from "./tipos";

/*
 * A lista personalizada de uma empresa (link do SMS ou do /empresas, que se
 * pode partilhar): o que tratar, onde, até quando e quanto custa, e o
 * calendário de obrigações com "Adicionar ao calendário" (.ics). O
 * calendário de uma empresa identificada (tipo "obrigacoes") mostra as
 * licenças que já tem.
 */

function Partilhar({ link, titulo }: { link: string; titulo: string }) {
  const [feito, setFeito] = useState(false);
  async function partilhar() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: titulo, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setFeito(true);
    } catch {
      // A pessoa cancelou a partilha: nada a fazer.
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Botao variante="secundario" tamanho="grande" icone={feito ? Check : Share2} onClick={partilhar} className="w-full">
        {feito ? "Link copiado" : "Partilhar ou guardar o link"}
      </Botao>
      <p className="sr-only" aria-live="polite">
        {feito ? "O link foi copiado." : ""}
      </p>
    </div>
  );
}

export function PaginaListaEmpresa({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<PaginaLista>(
    `/v1/public/empresas/listas/${encodeURIComponent(codigo)}`,
  );
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const d = c.dados;
  const obrigacoes = d.tipo === "obrigacoes";
  const itens = d.lista?.itens ?? [];
  const titulo = obrigacoes ? "As suas obrigações" : "O que a sua empresa precisa";

  return (
    <div className="flex w-full flex-col gap-7">
      <Topo direita={obrigacoes ? "Calendário" : "Empresas"} />
      <Cabecalho
        meta={`Câmara Municipal de ${d.municipio}`}
        titulo={titulo}
        sub={obrigacoes ? "Renovações e prazos das licenças que já tem, com as datas reais." : (d.atividade ?? undefined)}
      />

      {!obrigacoes && d.lista && (
        <CartaoDestaque rotulo="A sua lista" tom="tinta">
          <p className="font-display text-[26px] leading-tight font-bold">
            {itens.length} {itens.length === 1 ? "coisa a tratar" : "coisas a tratar"}
          </p>
          <p className="text-[15px] text-white/85">
            {d.lista.na_camara} na câmara e {d.lista.fora_da_camara} noutros serviços. Os pedidos da câmara pode fazê-los com
            o agente, no chat ou ao telefone.
          </p>
        </CartaoDestaque>
      )}

      {d.valores_de_demonstracao && (
        <div className="flex flex-col gap-2">
          <MarcaDemonstracao />
          <p className="text-[14px] leading-[1.45] text-tinta-2">
            Os prazos, as condições e algumas taxas são de demonstração: o regime legal está indicado em cada ponto,
            mas a câmara ainda tem de os confirmar.
          </p>
        </div>
      )}

      {itens.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="o-que-tratar">
          <TituloSecao id="o-que-tratar">O que tratar</TituloSecao>
          <ListaEmpresa itens={itens} />
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="calendario">
        <TituloSecao id="calendario">Calendário de obrigações</TituloSecao>
        <CalendarioEmpresa calendario={d.calendario} ics={d.ics} />
      </section>

      <section className="flex flex-col gap-2" aria-label="Partilhar">
        <Partilhar link={d.link} titulo={titulo} />
        {!obrigacoes && (
          <BotaoLink href="/empresas" variante="discreto" tamanho="grande" icone={ListRestart} className="w-full">
            Fazer outra lista
          </BotaoLink>
        )}
        <p className="flex items-center justify-center gap-1.5 text-[13px] text-tinta-2">
          <Link2 className="size-3.5" aria-hidden />
          Código <span className="font-mono font-semibold">{d.codigo}</span>
        </p>
      </section>

      <MaisDuvidas nota="Esta lista é uma orientação. A decisão final é sempre da câmara." />
    </div>
  );
}
