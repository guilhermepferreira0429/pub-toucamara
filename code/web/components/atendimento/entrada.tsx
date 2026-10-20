"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  CircleCheck,
  Clock,
  FolderOpen,
  Inbox,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Phone,
  Store,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Aviso } from "@/components/painel/cabecalho";
import { useSessao } from "@/lib/sessao";
import { CriarProcesso, MudarEncaminhamento } from "./acoes-entrada";
import { BotaoBalcao } from "./balcao";
import { BotaoAcao, Caixa, EtiquetaCaixa, Ficha, LinhaCaixa, PreviaVazia, TopoCaixa } from "./caixa";
import { query, useDados, useFuso, useLista } from "./dados";
import { EmailPrevia } from "./email-previa";
import { mensagemErro, quando, type Tom } from "./formatos";
import { PassagemDetalhe } from "./passagem";
import type { ItemEntrada, PedidoEntrada, ResumoEntrada, TipoItem } from "./tipos";
import { CarregarMais, ErroBloco, Esqueleto, LinhaFicha, Pilula, Separadores, Vazio } from "./ui";

const ICONES_CANAL: Record<string, { icone: LucideIcon; rotulo: string }> = {
  telefone: { icone: Phone, rotulo: "Telefone" },
  chat: { icone: MessageCircle, rotulo: "Chat" },
  email: { icone: Mail, rotulo: "Email" },
  balcao: { icone: Store, rotulo: "Balcão" },
};

const TIPOS: Record<TipoItem, { rotulo: string; tom: Tom; icone: LucideIcon }> = {
  passagem: { rotulo: "Passagem a funcionário", tom: "terracota", icone: UserRound },
  email: { rotulo: "Email", tom: "neutro", icone: Mail },
  processo: { rotulo: "Processo novo", tom: "verde", icone: FolderOpen },
  ocorrencia: { rotulo: "Ocorrência", tom: "ambar", icone: MapPin },
  pedido: { rotulo: "Pedido de balcão", tom: "creme", icone: Store },
};

type Canal = "todos" | "telefone" | "chat" | "email" | "balcao";

/** V2 · Entrada (frame ZRWWs): tudo o que chega, num só sítio. */
export function Entrada() {
  const { pode } = useSessao();
  const fuso = useFuso();
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const { id: pedidoId } = useParams<{ id?: string }>();

  const canal = (params.get("canal") ?? "todos") as Canal;
  const tipo = params.get("tipo") as TipoItem | null;
  const meus = params.get("meus") === "1";
  const porAtribuir = params.get("por_atribuir") === "1";
  const item = params.get("item") ?? (pedidoId ? `pedido:${pedidoId}` : null);
  const [tipoSel, idSel] = item?.split(":") ?? [];

  const permitido = pode("entrada");
  const resumo = useDados<ResumoEntrada>(
    permitido ? `/v1/painel/entrada/resumo${meus ? "?meus=true" : ""}` : null,
  );
  const lista = useLista<ItemEntrada>(
    permitido
      ? `/v1/painel/entrada${query({
          limite: 40,
          canal: canal === "todos" ? null : canal,
          tipo,
          meus: meus || null,
          por_atribuir: porAtribuir || null,
        })}`
      : null,
  );

  if (!permitido) {
    return (
      <div className="pt-8">
        <Aviso titulo="Sem acesso">O seu perfil não tem acesso à Entrada.</Aviso>
      </div>
    );
  }

  function ligacao(mudancas: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    const base = pedidoId ? "/painel/entrada" : caminho;
    return s ? `${base}?${s}` : base;
  }
  const mudar = (m: Record<string, string | null>) =>
    router.replace(ligacao(m), { scroll: false });

  const atualizar = () => {
    lista.recarregar();
    resumo.recarregar();
  };

  const r = resumo.dados;
  const selecionado = lista.itens.find((i) => i.tipo === tipoSel && i.id === idSel);

  const listaUi = (
    <>
      <TopoCaixa
        titulo="Entrada"
        sub="Tudo o que chega, num só sítio. Já encaminhado."
        acao={
          <BotaoBalcao
            aoCriar={(p) => {
              atualizar();
              router.replace(ligacao({ item: `pedido:${p.id}` }), { scroll: false });
            }}
          />
        }
      >
        <Separadores
          rotulo="Canal"
          valor={canal}
          mudar={(v) => mudar({ canal: v === "todos" ? null : v })}
          opcoes={[
            { valor: "todos", rotulo: "Todos", n: r?.total },
            { valor: "telefone", rotulo: "Telefone", n: r?.por_canal.telefone },
            { valor: "chat", rotulo: "Chat", n: r?.por_canal.chat },
            { valor: "email", rotulo: "Email", n: r?.por_canal.email },
            { valor: "balcao", rotulo: "Balcão", n: r?.por_canal.balcao },
          ]}
        />
      </TopoCaixa>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-linha px-7 py-3">
        <label className="sr-only" htmlFor="entrada-tipo">
          Tipo
        </label>
        <select
          id="entrada-tipo"
          value={tipo ?? ""}
          onChange={(e) => mudar({ tipo: e.target.value || null })}
          className="h-8 rounded-[14px] border border-linha bg-creme px-2.5 text-xs font-semibold text-tinta-2"
        >
          <option value="">Todos os tipos</option>
          {(Object.keys(TIPOS) as TipoItem[]).map((t) => (
            <option key={t} value={t}>
              {TIPOS[t].rotulo}
              {r ? ` (${r.por_tipo[t] ?? 0})` : ""}
            </option>
          ))}
        </select>
        {[
          { chave: "meus", ativo: meus, rotulo: "Meus e do meu serviço" },
          {
            chave: "por_atribuir",
            ativo: porAtribuir,
            rotulo: `Por atribuir${r?.por_atribuir ? ` (${r.por_atribuir})` : ""}`,
          },
        ].map((f) => (
          <button
            key={f.chave}
            type="button"
            aria-pressed={f.ativo}
            onClick={() => mudar({ [f.chave]: f.ativo ? null : "1" })}
            className={`h-8 rounded-[14px] border px-2.5 text-xs font-semibold ${
              f.ativo
                ? "border-tinta bg-tinta text-white"
                : "border-linha bg-creme text-tinta-2 hover:text-tinta"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
        {r && r.urgentes > 0 && (
          <Pilula tom="terracota" className="ml-auto">
            {r.urgentes} {r.urgentes === 1 ? "urgente" : "urgentes"}
          </Pilula>
        )}
      </div>

      <div aria-busy={lista.aCarregar}>
        {lista.erro && <ErroBloco className="m-6" mensagem={lista.erro} tentar={lista.recarregar} />}
        {lista.aCarregar && <Esqueleto className="m-6 h-72" />}
        {!lista.aCarregar && !lista.erro && lista.itens.length === 0 && (
          <Vazio icone={Inbox} titulo="Nada à espera aqui.">
            Passagens a funcionário, emails, processos novos, ocorrências e
            pedidos de balcão aparecem aqui, já encaminhados.
          </Vazio>
        )}
        <ul>
          {lista.itens.map((i) => {
            const c = ICONES_CANAL[i.canal] ?? { icone: Inbox, rotulo: i.canal };
            const t = TIPOS[i.tipo];
            const destino = [i.servico?.nome, i.tecnico?.nome].filter(Boolean).join(" · ");
            return (
              <LinhaCaixa
                key={`${i.tipo}:${i.id}`}
                href={ligacao({ item: `${i.tipo}:${i.id}` })}
                selecionada={i.tipo === tipoSel && i.id === idSel}
                icone={c.icone}
                rotuloIcone={c.rotulo}
                quem={i.municipe ?? "Munícipe não identificado"}
                hora={quando(i.criado_em, fuso).toLowerCase()}
                assunto={i.assunto}
                resumo={i.resumo}
                urgente={i.urgente}
                etiquetas={
                  <>
                    <EtiquetaCaixa>{destino || "por atribuir"}</EtiquetaCaixa>
                    <EtiquetaCaixa tom={t.tom} icone={t.icone}>
                      {t.rotulo}
                    </EtiquetaCaixa>
                    {i.prazo_resposta && (
                      <EtiquetaCaixa tom="ambar" icone={Clock}>
                        até {quando(i.prazo_resposta, fuso).toLowerCase()}
                      </EtiquetaCaixa>
                    )}
                  </>
                }
              />
            );
          })}
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

  let previa: React.ReactNode = (
    <PreviaVazia texto="Escolha um item para ver o que o agente percebeu e o que falta fazer." />
  );
  if (tipoSel && idSel) {
    const chave = `${tipoSel}:${idSel}`;
    previa = (
      <>
        <Link
          href={ligacao({ item: null })}
          className="mx-8 mt-6 flex w-fit items-center gap-1.5 text-[13px] font-semibold text-tinta-2 hover:text-tinta lg:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar à lista
        </Link>
        {tipoSel === "passagem" ? (
          <PassagemDetalhe key={chave} id={idSel} aoMudar={atualizar} />
        ) : tipoSel === "email" ? (
          <EmailPrevia key={chave} id={idSel} aoMudar={atualizar} />
        ) : tipoSel === "pedido" ? (
          <PedidoPrevia key={chave} id={idSel} aoMudar={atualizar} />
        ) : (
          <ItemPrevia key={chave} tipo={tipoSel as TipoItem} id={idSel} item={selecionado} aoMudar={atualizar} />
        )}
      </>
    );
  }

  return <Caixa previaAberta={!!(tipoSel && idSel)} lista={listaUi} previa={previa} />;
}

/** Processo novo ou ocorrência: o resumo da lista e o caminho para o ecrã próprio. */
function ItemPrevia({
  tipo,
  id,
  item,
  aoMudar,
}: {
  tipo: TipoItem;
  id: string;
  item?: ItemEntrada;
  aoMudar: () => void;
}) {
  const fuso = useFuso();
  const t = TIPOS[tipo] ?? TIPOS.processo;
  const href = item?.link_painel ?? `/painel/${tipo === "ocorrencia" ? "ocorrencias" : "processos"}/${id}`;
  return (
    <article className="flex flex-col gap-5 px-8 py-7" aria-labelledby="item-titulo">
      <header className="flex flex-col gap-2.5">
        {item && (
          <p className="text-xs text-tinta-3">
            {t.rotulo} · {(ICONES_CANAL[item.canal]?.rotulo ?? item.canal).toLowerCase()} ·{" "}
            {quando(item.criado_em, fuso).toLowerCase()}
          </p>
        )}
        <h1 id="item-titulo" className="font-display text-[26px] font-bold tracking-[-0.5px] text-tinta">
          {item?.assunto ?? t.rotulo}
        </h1>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={href}
            className="flex h-10 items-center gap-2 rounded-[10px] bg-terracota px-4 text-[13px] font-semibold text-white hover:bg-terracota-escuro"
          >
            <ArrowUpRight className="size-4" aria-hidden />
            {tipo === "ocorrencia" ? "Abrir a ocorrência" : "Abrir o processo"}
          </Link>
          <MudarEncaminhamento
            tipo={tipo}
            id={id}
            servicoId={item?.servico?.id}
            tecnicoId={item?.tecnico?.id}
            aoMudar={aoMudar}
          />
        </div>
      </header>
      {item?.resumo && (
        <p className="rounded-[14px] bg-creme-2 p-4 text-sm leading-normal text-tinta">{item.resumo}</p>
      )}
      {item && (
        <Ficha titulo="Encaminhamento" extra={item.encaminhamento?.automatico ? <Pilula tom="verde">automático</Pilula> : undefined}>
          <LinhaFicha campo="Serviço" largura="w-[90px]">
            {item.servico?.nome ?? "Por atribuir"}
          </LinhaFicha>
          <LinhaFicha campo="Técnico" largura="w-[90px]">
            {item.tecnico?.nome ?? "Por atribuir"}
            {item.encaminhamento && (
              <span className="text-tinta-3"> · {item.encaminhamento.motivo}</span>
            )}
          </LinhaFicha>
          <LinhaFicha campo="Estado" largura="w-[90px]">
            {item.estado.replace(/_/g, " ")}
          </LinhaFicha>
          <LinhaFicha campo="Munícipe" largura="w-[90px]">
            {item.municipe ?? "Não identificado"}
          </LinhaFicha>
        </Ficha>
      )}
    </article>
  );
}

/** Pedido de balcão. */
function PedidoPrevia({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const { pedido } = useSessao();
  const fuso = useFuso();
  const p = useDados<PedidoEntrada>(`/v1/painel/entrada/pedidos/${id}`);
  const [aFechar, setAFechar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const d = p.dados;

  if (p.erro) return <ErroBloco className="m-8" mensagem={p.erro} tentar={p.recarregar} />;
  if (!d) {
    return (
      <div className="flex flex-col gap-5 px-8 py-7" aria-busy>
        <Esqueleto className="h-20" />
        <Esqueleto className="h-40" />
      </div>
    );
  }
  const aberto = d.estado === "aberto";

  async function fechar() {
    setAFechar(true);
    setErro(null);
    try {
      await pedido(`/v1/painel/entrada/pedidos/${id}/fechar`, { metodo: "POST" });
      p.recarregar();
      aoMudar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAFechar(false);
    }
  }

  return (
    <article className="flex flex-col gap-5 px-8 py-7" aria-labelledby="pedido-titulo">
      <header className="flex flex-col gap-2.5">
        <p className="flex items-center gap-2 text-xs text-tinta-3">
          <Store className="size-3.5" aria-hidden />
          Pedido de balcão · {quando(d.criado_em, fuso).toLowerCase()}
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 id="pedido-titulo" className="font-display text-[26px] font-bold tracking-[-0.5px] text-tinta">
            {d.assunto}
          </h1>
          {d.urgente && <Pilula tom="terracota">Urgente</Pilula>}
          {!aberto && <Pilula tom="neutro">{d.processo_id ? "Virou processo" : "Fechado"}</Pilula>}
        </div>
        {aberto && (
          <div className="flex flex-wrap items-start gap-2 pt-1">
            <CriarProcesso tipo="pedido" id={d.id} assunto={d.assunto} aoCriar={() => { p.recarregar(); aoMudar(); }} />
            <MudarEncaminhamento
              tipo="pedido"
              id={d.id}
              servicoId={d.servico?.id}
              tecnicoId={d.tecnico?.id}
              aoMudar={() => {
                p.recarregar();
                aoMudar();
              }}
            />
            <BotaoAcao icone={CircleCheck} onClick={fechar} disabled={aFechar}>
              {aFechar ? "A fechar…" : "Tratado, fechar"}
            </BotaoAcao>
          </div>
        )}
        {erro && (
          <p role="alert" className="text-[13px] text-terracota-escuro">
            {erro}
          </p>
        )}
      </header>

      <section className="rounded-[14px] bg-creme-2 p-4">
        <p className="pb-1.5 text-[11px] font-bold tracking-[1px] text-tinta-3">O QUE PEDIU</p>
        <p className="text-sm leading-normal whitespace-pre-line text-tinta">{d.descricao}</p>
      </section>

      <Ficha titulo="Encaminhamento">
        <LinhaFicha campo="Munícipe" largura="w-[90px]">
          {d.municipe ?? "Não identificado"}
        </LinhaFicha>
        <LinhaFicha campo="Serviço" largura="w-[90px]">
          {d.servico?.nome ?? "Por atribuir"}
        </LinhaFicha>
        <LinhaFicha campo="Técnico" largura="w-[90px]">
          {d.tecnico?.nome ?? "Por atribuir"}
        </LinhaFicha>
        <LinhaFicha campo="Responder até" largura="w-[90px]">
          {d.prazo_resposta ? quando(d.prazo_resposta, fuso) : "Sem prazo"}
        </LinhaFicha>
      </Ficha>

      <div className="flex flex-wrap gap-4 text-[13px] font-semibold">
        {d.conversa_id && (
          <Link href={`/painel/conversas/${d.conversa_id}`} className="flex items-center gap-1.5 text-terracota-escuro hover:underline">
            <MessagesSquare className="size-4" aria-hidden />
            Ver o registo da conversa
          </Link>
        )}
        {d.processo_id && (
          <Link href={`/painel/processos/${d.processo_id}`} className="flex items-center gap-1.5 text-terracota-escuro hover:underline">
            <FolderOpen className="size-4" aria-hidden />
            Abrir o processo
          </Link>
        )}
      </div>
    </article>
  );
}
