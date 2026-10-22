"use client";

import {
  Bot,
  Check,
  Copy,
  Eye,
  KeyRound,
  Radio,
  Unplug,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Cartao,
  ErroLinha,
  Estado,
  haQuanto,
  numero,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { copiar, urlApi } from "./url";

/*
 * Painel · Porta para as IAs: os assistentes das pessoas (Claude, ChatGPT…)
 * a falar com a câmara pelas mesmas ferramentas do telefone. O feed atualiza
 * a cada 3 segundos (na demo, a ocorrência pedida no Claude aparece aqui).
 */

interface Resumo {
  ligacoes_ativas: number;
  pedidos_hoje: number;
  pedidos_7d: number;
  acoes_7d: number;
  publicos_7d: number;
  por_ferramenta: { ferramenta: string; titulo: string; pedidos: number }[];
  por_cliente: { cliente: string; pedidos: number }[];
  caminho_publico: string;
}

interface PedidoIa {
  id: string;
  criado_em: string;
  ferramenta: string;
  titulo: string;
  acao: boolean;
  ok: boolean;
  erro_codigo: string | null;
  resumo: string | null;
  cliente: string | null;
  conversa_id: string | null;
  duracao_ms: number;
  ligacao: { id: string; assistente: string | null; telefone: string } | null;
}

interface LigacaoIa {
  id: string;
  assistente: string;
  chave_fim: string;
  pedidos: number;
  ultimo_uso_em: string | null;
  criada_em: string;
  ativa: boolean;
  revogada_em: string | null;
  revogada_por: "municipe" | "camara" | null;
  municipe: { nome: string | null; telefone: string };
}

const INTERVALO_MS = 3000;

/** Nome do cliente MCP como as pessoas o conhecem. */
function nomeCliente(c: string | null): string {
  if (!c) return "sem nome";
  const n = c.toLowerCase();
  if (n.includes("claude")) return "Claude";
  if (n.includes("openai") || n.includes("chatgpt")) return "ChatGPT";
  if (n.includes("gemini")) return "Gemini";
  if (n.includes("copilot") || n.includes("vscode")) return "Copilot";
  return c;
}

export function PainelIas() {
  const { pode } = useSessao();
  const resumo = useDados<Resumo>(pode("conversas") ? "/v1/painel/ias/resumo" : null);
  const feed = useDados<{ pedidos: PedidoIa[] }>(
    pode("conversas") ? "/v1/painel/ias/atividade" : null,
  );
  const ligacoes = useDados<{ ligacoes: LigacaoIa[] }>(
    pode("conversas") ? "/v1/painel/ias/ligacoes" : null,
  );

  // Ao vivo: o feed e os totais voltam a pedir enquanto a página está aberta.
  const { recarregar: recFeed } = feed;
  const { recarregar: recResumo } = resumo;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      recFeed();
      recResumo();
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [recFeed, recResumo]);

  if (!pode("conversas")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Atendimento", "Porta para as IAs"]} titulo="Porta para as IAs" />
        <SemAcesso />
      </div>
    );
  }

  const r = resumo.dados;
  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Atendimento", "Porta para as IAs"]}
        titulo="Porta para as IAs"
        descricao="Os assistentes das pessoas tratam com a câmara pelas mesmas ferramentas do telefone, com a mesma informação oficial. Só agem em nome de alguém com autorização dada por SMS."
        acoes={
          <Pilula tom="verde" icone={Radio}>
            ao vivo
          </Pilula>
        }
      />

      <div className="grid grid-cols-2 gap-4 px-10 lg:grid-cols-4">
        <Numero rotulo="Assistentes ligados" valor={r?.ligacoes_ativas} icone={KeyRound} />
        <Numero rotulo="Pedidos hoje" valor={r?.pedidos_hoje} icone={Bot} />
        <Numero
          rotulo="Ações em 7 dias"
          valor={r?.acoes_7d}
          icone={Zap}
          nota="ocorrências, marcações, requerimentos…"
        />
        <Numero
          rotulo="Consultas anónimas"
          valor={r?.publicos_7d}
          icone={Eye}
          nota="só informação pública, 7 dias"
        />
      </div>

      <div className="mt-6 grid gap-6 px-10 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Cartao className="min-w-0">
          <div className="flex items-center justify-between border-b border-linha px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-bold text-tinta">O que os assistentes pediram</h2>
              <p className="text-[13px] text-tinta-3">Atualiza sozinho a cada 3 segundos.</p>
            </div>
          </div>
          <Estado
            aCarregar={feed.aCarregar}
            erro={feed.erro}
            vazio={feed.dados?.pedidos.length === 0}
            textoVazio="Ainda nenhum assistente falou com a câmara. Quando alguém ligar o seu assistente na página de autorização, os pedidos aparecem aqui."
          >
            {feed.dados && <Feed pedidos={feed.dados.pedidos} />}
          </Estado>
        </Cartao>

        <div className="flex min-w-0 flex-col gap-6">
          <EnderecoPublico caminho={r?.caminho_publico} />
          <Cartao className="p-5">
            <Rotulo>Mais pedidas · 7 dias</Rotulo>
            <Barras
              linhas={(r?.por_ferramenta ?? []).map((f) => ({ rotulo: f.titulo, valor: f.pedidos }))}
            />
          </Cartao>
          <Cartao className="p-5">
            <Rotulo>Por assistente · 7 dias</Rotulo>
            <Barras
              linhas={(r?.por_cliente ?? []).map((c) => ({
                rotulo: nomeCliente(c.cliente === "desconhecido" ? null : c.cliente),
                valor: c.pedidos,
              }))}
            />
          </Cartao>
        </div>
      </div>

      <div className="mt-6 px-10">
        <Ligacoes
          ligacoes={ligacoes.dados?.ligacoes}
          aCarregar={ligacoes.aCarregar}
          erro={ligacoes.erro}
          onMudou={ligacoes.recarregar}
        />
      </div>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  icone: Icone,
  nota,
}: {
  rotulo: string;
  valor: number | undefined;
  icone: LucideIcon;
  nota?: string;
}) {
  return (
    <Cartao className="flex flex-col gap-2 p-5">
      <div className="flex items-center gap-2 text-tinta-3">
        <Icone className="size-4" aria-hidden />
        <span className="text-[13px] font-semibold">{rotulo}</span>
      </div>
      <span className="font-display text-[34px] leading-none font-bold text-tinta">
        {valor === undefined ? "—" : numero(valor)}
      </span>
      {nota && <span className="text-xs text-tinta-3">{nota}</span>}
    </Cartao>
  );
}

/**
 * As linhas que chegam com a página aberta piscam a terracota durante uns
 * segundos. As que já lá estavam na primeira leitura não.
 */
function Feed({ pedidos }: { pedidos: PedidoIa[] }) {
  const vistos = useRef<Set<string> | null>(null);
  const [novos, setNovos] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const ids = pedidos.map((p) => p.id);
    if (vistos.current === null) {
      vistos.current = new Set(ids);
      return;
    }
    const conhecidos = vistos.current;
    const chegaram = ids.filter((id) => !conhecidos.has(id));
    if (chegaram.length === 0) return;
    chegaram.forEach((id) => conhecidos.add(id));
    const t1 = setTimeout(() => setNovos(new Set(chegaram)), 0);
    const t2 = setTimeout(() => setNovos(new Set()), 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pedidos]);

  return (
    <ul className="divide-y divide-linha">
      {pedidos.map((p) => {
        const Icone = p.acao ? Zap : Eye;
        return (
          <li
            key={p.id}
            className={`flex items-start gap-3 px-5 py-3.5 transition-colors duration-700 ${
              novos.has(p.id) ? "bg-terracota-suave" : ""
            }`}
          >
            <span
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] ${
                p.acao ? "bg-terracota text-white" : "bg-creme-2 text-tinta-2"
              }`}
            >
              <Icone className="size-4" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-tinta">{p.titulo}</span>
                {!p.ok && <Pilula tom="terracota">falhou</Pilula>}
                {p.ligacao ? (
                  <Pilula tom="neutro" icone={KeyRound}>
                    {p.ligacao.assistente ?? nomeCliente(p.cliente)} · {p.ligacao.telefone}
                  </Pilula>
                ) : (
                  <Pilula tom="neutro">anónima</Pilula>
                )}
              </div>
              {p.resumo && <p className="text-[13px] text-tinta-2">{p.resumo}</p>}
              <p className="text-xs text-tinta-3">
                {nomeCliente(p.cliente)} · {haQuanto(p.criado_em)} · {p.duracao_ms} ms
                {p.conversa_id && (
                  <>
                    {" · "}
                    <Link
                      href={`/painel/conversas/${p.conversa_id}`}
                      className="font-semibold text-terracota hover:underline"
                    >
                      ver conversa
                    </Link>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ehLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  } catch {
    return true;
  }
}

function EnderecoPublico({ caminho }: { caminho?: string }) {
  const [copiado, setCopiado] = useState(false);
  const completo = caminho ? urlApi(caminho) : "";
  // Um endereço local (localhost, 127.0.0.1) não serve a ninguém fora deste
  // computador: mostra-se "por publicar" em vez dele.
  const url = completo && !ehLocal(completo) ? completo : "";
  return (
    <Cartao className="flex flex-col gap-3 p-5">
      <Rotulo>Endereço público da câmara</Rotulo>
      <p className="text-[13px] text-tinta-2">
        Qualquer assistente pode consultar a informação oficial por aqui. Para
        agir em nome de alguém, a pessoa autoriza na página de autorização.
      </p>
      {url ? (
        <code className="rounded-[10px] bg-creme px-3 py-2 font-mono text-xs break-all text-tinta">{url}</code>
      ) : (
        <p className="rounded-[10px] bg-creme px-3 py-2 text-[13px] text-tinta-2">
          <span className="font-semibold text-tinta">Por publicar.</span> O endereço aparece aqui quando
          o serviço estiver no ar, no domínio da câmara.
        </p>
      )}
      <div className="flex gap-2">
        <Botao
          tamanho="pequeno"
          variante="secundario"
          icone={copiado ? Check : Copy}
          disabled={!url}
          onClick={async () => {
            if (await copiar(url)) {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            }
          }}
        >
          {copiado ? "Copiado" : "Copiar"}
        </Botao>
        <a
          href="/ia"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme-2"
        >
          Abrir a página de autorização
        </a>
      </div>
    </Cartao>
  );
}

function Barras({ linhas }: { linhas: { rotulo: string; valor: number }[] }) {
  if (linhas.length === 0) return <p className="mt-3 text-sm text-tinta-3">Sem pedidos.</p>;
  const max = Math.max(...linhas.map((l) => l.valor), 1);
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {linhas.map((l) => (
        <li key={l.rotulo} className="flex flex-col gap-1">
          <div className="flex justify-between text-[13px]">
            <span className="truncate text-tinta">{l.rotulo}</span>
            <span className="font-semibold text-tinta-2">{numero(l.valor)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-creme-2">
            <div
              className="h-1.5 rounded-full bg-terracota"
              style={{ width: `${Math.max(4, (l.valor / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Ligacoes({
  ligacoes,
  aCarregar,
  erro,
  onMudou,
}: {
  ligacoes: LigacaoIa[] | undefined;
  aCarregar: boolean;
  erro: Parameters<typeof Estado>[0]["erro"];
  onMudou: () => void;
}) {
  const { pode, pedido } = useSessao();
  const acao = useAcao();
  return (
    <Cartao>
      <div className="border-b border-linha px-5 py-4">
        <h2 className="font-display text-lg font-bold text-tinta">Assistentes autorizados</h2>
        <p className="text-[13px] text-tinta-3">
          Cada pessoa autorizou o seu assistente com um código por SMS. A câmara
          pode desligar qualquer um.
        </p>
      </div>
      <ErroLinha erro={acao.erro} className="m-4" />
      <Estado
        aCarregar={aCarregar}
        erro={erro}
        vazio={ligacoes?.length === 0}
        textoVazio="Ainda ninguém ligou o seu assistente."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold tracking-[0.4px] text-tinta-3 uppercase">
              <th className="px-5 py-2.5">Assistente</th>
              <th className="px-3 py-2.5">Munícipe</th>
              <th className="px-3 py-2.5">Pedidos</th>
              <th className="px-3 py-2.5">Último uso</th>
              <th className="px-3 py-2.5">Estado</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-linha">
            {(ligacoes ?? []).map((l) => (
              <tr key={l.id} className={l.ativa ? "" : "text-tinta-3"}>
                <td className="px-5 py-3">
                  <span className="font-semibold text-tinta">{l.assistente}</span>
                  <span className="ml-2 font-mono text-xs text-tinta-3">…{l.chave_fim}</span>
                </td>
                <td className="px-3 py-3">
                  {l.municipe.nome ? `${l.municipe.nome} · ` : ""}
                  {l.municipe.telefone}
                </td>
                <td className="px-3 py-3">{numero(l.pedidos)}</td>
                <td className="px-3 py-3">{quando(l.ultimo_uso_em)}</td>
                <td className="px-3 py-3">
                  {l.ativa ? (
                    <Pilula tom="verde">ligado</Pilula>
                  ) : (
                    <Pilula tom="neutro">
                      desligado {l.revogada_por === "camara" ? "pela câmara" : "pela pessoa"}
                    </Pilula>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {l.ativa && pode("agente") && (
                    <Botao
                      tamanho="pequeno"
                      variante="discreto"
                      icone={Unplug}
                      disabled={acao.aCorrer}
                      onClick={async () => {
                        if (!window.confirm(`Desligar o ${l.assistente} desta pessoa?`)) return;
                        const ok = await acao.executar(() =>
                          pedido(`/v1/painel/ias/ligacoes/${l.id}/revogar`, { metodo: "POST" }),
                        );
                        if (ok !== undefined) onMudou();
                      }}
                    >
                      Desligar
                    </Botao>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
    </Cartao>
  );
}
