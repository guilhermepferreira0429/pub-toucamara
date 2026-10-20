"use client";

import { ArrowLeft, Check, CircleHelp, Inbox, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Aviso } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { BotaoBalcao } from "./balcao";
import { Caixa, EtiquetaCaixa, LinhaCaixa, PreviaVazia, TopoCaixa } from "./caixa";
import { query, useFuso, useLista } from "./dados";
import { ESTADOS_EMAIL, EmailPrevia } from "./email-previa";
import { quando } from "./formatos";
import type { EmailLista } from "./tipos";
import { CarregarMais, ErroBloco, Esqueleto, Separadores, Vazio } from "./ui";

type Filtro = "nova" | "respondida" | "encaminhada" | "virou_processo" | "todos";

const SEPARADORES: { valor: Filtro; rotulo: string }[] = [
  { valor: "nova", rotulo: "Por tratar" },
  { valor: "respondida", rotulo: "Respondidos" },
  { valor: "encaminhada", rotulo: "Encaminhados" },
  { valor: "virou_processo", rotulo: "Viraram processo" },
  { valor: "todos", rotulo: "Todos" },
];

/** Painel · Email geral (frame j69Tq): lista e pré-visualização (/painel/emails/:id). */
export function Emails() {
  const { pode } = useSessao();
  const fuso = useFuso();
  const router = useRouter();
  const params = useSearchParams();
  const { id } = useParams<{ id?: string }>();
  const estado = (params.get("estado") as Filtro | null) ?? "nova";
  const filtro = SEPARADORES.some((s) => s.valor === estado) ? estado : "nova";
  const sufixo = filtro === "nova" ? "" : `?estado=${filtro}`;

  const lista = useLista<EmailLista>(
    pode("entrada")
      ? `/v1/painel/emails${query({ limite: 40, estado: filtro === "todos" ? null : filtro })}`
      : null,
  );

  if (!pode("entrada")) {
    return (
      <div className="pt-8">
        <Aviso titulo="Sem acesso">O seu perfil não tem acesso ao email geral.</Aviso>
      </div>
    );
  }

  const listaUi = (
    <>
      <TopoCaixa
        titulo="Email geral"
        sub="Classificado e com resposta redigida. Só tem de rever."
        acao={<BotaoBalcao aoCriar={() => router.push("/painel/entrada")} />}
      >
        <Separadores
          rotulo="Estado"
          opcoes={SEPARADORES}
          valor={filtro}
          mudar={(v) =>
            router.replace(
              `/painel/emails${id ? `/${id}` : ""}${v === "nova" ? "" : `?estado=${v}`}`,
              { scroll: false },
            )
          }
        />
      </TopoCaixa>
      <div aria-busy={lista.aCarregar}>
        {lista.erro && <ErroBloco className="m-6" mensagem={lista.erro} tentar={lista.recarregar} />}
        {lista.aCarregar && <Esqueleto className="m-6 h-72" />}
        {!lista.aCarregar && !lista.erro && lista.itens.length === 0 && (
          <Vazio
            icone={Inbox}
            titulo={filtro === "nova" ? "Nenhum email por tratar." : "Nenhum email aqui."}
          >
            Os emails enviados para o endereço geral da câmara aparecem aqui,
            já classificados e com a resposta redigida.
          </Vazio>
        )}
        <ul>
          {lista.itens.map((e) => (
            <LinhaCaixa
              key={e.id}
              href={`/painel/emails/${e.id}${sufixo}`}
              selecionada={e.id === id}
              icone={Mail}
              rotuloIcone="Email"
              quem={e.de}
              hora={quando(e.recebido_em, fuso).toLowerCase()}
              assunto={e.assunto || "(sem assunto)"}
              resumo={e.excerto}
              etiquetas={
                <>
                  <EtiquetaCaixa>{e.servico ?? "por atribuir"}</EtiquetaCaixa>
                  {e.estado !== "nova" ? (
                    <EtiquetaCaixa tom="creme" icone={Check}>
                      {ESTADOS_EMAIL[e.estado]}
                    </EtiquetaCaixa>
                  ) : e.tem_rascunho ? (
                    <EtiquetaCaixa tom="verde" icone={Sparkles}>
                      Resposta pronta
                    </EtiquetaCaixa>
                  ) : (
                    <EtiquetaCaixa tom="ambar" icone={CircleHelp}>
                      Sem resposta redigida
                    </EtiquetaCaixa>
                  )}
                </>
              }
            />
          ))}
        </ul>
        <CarregarMais
          ha={!!lista.proximo}
          aCarregar={lista.aCarregarMais}
          erro={lista.maisErro}
          carregar={lista.carregarMais}
        />
      </div>
    </>
  );

  return (
    <Caixa
      previaAberta={!!id}
      lista={listaUi}
      previa={
        id ? (
          <>
            <Link
              href={`/painel/emails${sufixo}`}
              className="mx-8 mt-6 flex w-fit items-center gap-1.5 text-[13px] font-semibold text-tinta-2 hover:text-tinta lg:hidden"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Voltar à lista
            </Link>
            <EmailPrevia key={id} id={id} aoMudar={lista.recarregar} />
          </>
        ) : (
          <PreviaVazia texto="Escolha um email para ver a resposta redigida." />
        )
      }
    />
  );
}
