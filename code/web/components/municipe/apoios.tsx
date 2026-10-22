"use client";

import { CircleHelp, FileText, HandCoins, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/botao";
import { api } from "@/lib/api";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  ModoTeste,
  Nota,
  ROTA_CHAT,
  Rotulo,
  TituloSecao,
  Topo,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";

/*
 * "Apoios a que pode ter direito" (link do SMS): a lista que o agente
 * encontrou, com o que entregar para cada apoio e um botão para pedir
 * (cria o pedido na câmara, como se fosse feito ao telefone).
 */

interface Linha {
  apoio: string;
  nome: string;
  resultado: "tem_direito" | "talvez";
  porque: string[];
  falta_saber: string[];
  resumo: string | null;
  valor: string | null;
  quem_pode: string | null;
  documentos: string[];
  como_pedir: string | null;
  fonte: { titulo: string; url: string | null; ambito: string } | null;
  demonstracao: boolean;
  pedido: { numero: string; fase: string } | null;
  pode_pedir: boolean;
}

interface Pagina {
  municipio: string;
  criada_em: string;
  tem_direito: Linha[];
  talvez: Linha[];
  nao: { apoio: string; nome: string; porque: string[] }[];
  identificado: boolean;
  demonstracao: boolean;
}

export function PaginaApoios({ codigo }: { codigo: string }) {
  const caminho = `/v1/public/apoios/${encodeURIComponent(codigo)}`;
  const { c, definir, tentarOutraVez } = usePublico<Pagina>(caminho);
  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;
  const d = c.dados;
  const n = d.tem_direito.length;

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita="Os seus apoios" />
      <Cabecalho
        meta={`Câmara Municipal de ${d.municipio}`}
        titulo="Apoios a que pode ter direito"
        sub="Pelo que nos disse, estes são os apoios da câmara que pode pedir, e o que tem de entregar para cada um."
      />

      {n > 0 ? (
        <CartaoDestaque rotulo="Pode ter direito" tom="verde">
          <p className="font-display text-[26px] leading-tight font-bold">
            {n === 1 ? "1 apoio" : `${n} apoios`}
          </p>
          <p className="text-[15px] text-white/90">{d.tem_direito.map((x) => x.nome).join(", ")}</p>
        </CartaoDestaque>
      ) : (
        <Nota icone={HandCoins} tom="neutro">
          {d.talvez.length
            ? "Ainda não sabemos se tem direito: faltam alguns dados. Veja abaixo o que falta."
            : "Pelo que nos disse, não encontrámos nenhum apoio da câmara a que tenha direito. A ação social pode ver o seu caso com mais calma."}
        </Nota>
      )}

      {d.tem_direito.map((x) => (
        <CartaoApoio key={x.apoio} x={x} codigo={codigo} identificado={d.identificado} onPedido={definir} />
      ))}

      {d.talvez.length > 0 && (
        <section className="flex flex-col gap-4" aria-labelledby="talvez">
          <TituloSecao id="talvez">Talvez também</TituloSecao>
          {d.talvez.map((x) => (
            <CartaoApoio key={x.apoio} x={x} codigo={codigo} identificado={d.identificado} onPedido={definir} />
          ))}
        </section>
      )}

      {d.nao.length > 0 && (
        <details className="rounded-xl border border-linha bg-papel p-4">
          <summary className="cursor-pointer py-3 text-[15px] font-semibold text-tinta">
            Apoios a que não tem direito ({d.nao.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {d.nao.map((x) => (
              <li key={x.apoio} className="text-[14px] text-tinta-2">
                <span className="font-semibold text-tinta">{x.nome}:</span> {x.porque.join(" ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2">{d.demonstracao && <ModoTeste texto="valores de demonstração" />}</div>
      <MaisDuvidas nota="Esta lista é uma indicação, feita com o que nos disse. A decisão é sempre da câmara, com os documentos." />
    </div>
  );
}

function CartaoApoio({
  x,
  codigo,
  identificado,
  onPedido,
}: {
  x: Linha;
  codigo: string;
  identificado: boolean;
  onPedido: (p: Pagina) => void;
}) {
  const [aPedir, setAPedir] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pedir = async () => {
    setAPedir(true);
    setErro(null);
    try {
      onPedido(
        await api<Pagina>(`/v1/public/apoios/${encodeURIComponent(codigo)}/pedir`, {
          corpo: { apoio: x.apoio },
        }),
      );
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setAPedir(false);
    }
  };

  return (
    <article className="flex w-full flex-col gap-3 rounded-2xl border border-linha bg-papel p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[22px] leading-tight font-bold text-tinta">{x.nome}</h2>
        {x.valor && <p className="text-[15px] font-semibold text-terracota-escuro">{x.valor}</p>}
      </div>
      {x.resumo && <p className="text-[15px] leading-[1.45] text-tinta-2">{x.resumo}</p>}

      {x.porque.length > 0 && (
        <div>
          <Rotulo>Porque pode ter direito</Rotulo>
          <ul className="mt-1.5 flex flex-col gap-1 text-[14px] text-tinta">
            {x.porque.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {x.falta_saber.length > 0 && (
        <Nota icone={CircleHelp} tom="ambar">
          Falta saber: {x.falta_saber.join(" ")}
        </Nota>
      )}

      {x.documentos.length > 0 && (
        <div>
          <Rotulo>O que entregar</Rotulo>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {x.documentos.map((doc) => (
              <li key={doc} className="flex items-start gap-2 text-[14px] text-tinta">
                <FileText className="mt-0.5 size-4 shrink-0 text-tinta-3" aria-hidden />
                {doc}
              </li>
            ))}
          </ul>
        </div>
      )}

      {x.como_pedir && <p className="text-[13px] leading-[1.45] text-tinta-2">{x.como_pedir}</p>}

      {x.pedido ? (
        <Nota icone={Send} tom="verde" papel="status">
          Já fez o pedido: <strong>{x.pedido.numero}</strong>. Recebeu um SMS com o link para o acompanhar.
        </Nota>
      ) : x.pode_pedir ? (
        <Botao tamanho="grande" icone={Send} className="w-full" disabled={aPedir} onClick={pedir}>
          {aPedir ? "A pedir…" : "Pedir este apoio"}
        </Botao>
      ) : (
        !identificado && (
          <BotaoLink href={ROTA_CHAT} tamanho="grande" variante="secundario" icone={MessageCircle} className="w-full">
            Pedir com o agente
          </BotaoLink>
        )
      )}
      {erro && (
        <p role="alert" className="text-[14px] text-terracota-escuro">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-tinta-3">
        {x.demonstracao && <ModoTeste texto="valores de demonstração" />}
        {x.fonte && (
          <span>
            Base:{" "}
            {x.fonte.url ? (
              <a href={x.fonte.url} target="_blank" rel="noreferrer" className="underline">
                {x.fonte.titulo}
              </a>
            ) : (
              x.fonte.titulo
            )}
          </span>
        )}
      </div>
    </article>
  );
}
