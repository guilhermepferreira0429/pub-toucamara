"use client";

import { BookOpen, FileQuestion, FolderOpen, Mail } from "lucide-react";
import Link from "next/link";
import {
  Cartao,
  Estado,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useDados,
  useMais,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · "Cartas que os munícipes não perceberam": as cartas da câmara que
 * as pessoas mandaram ao agente para explicar. Em cima, os ofícios que mais
 * confundem (por modelo de ofício, ou pelo tipo de carta quando não há
 * processo), com o caminho para os reescrever em linguagem simples.
 */

export interface LinhaCarta {
  id: string;
  estado: "lida" | "ilegivel" | "respondida";
  canal: string;
  tipo: string | null;
  tipo_rotulo: string | null;
  assunto: string | null;
  da_camara: boolean | null;
  referencia: string | null;
  processo_id: string | null;
  processo_numero: string | null;
  modelo_nome: string | null;
  data_limite: string | null;
  prazo_estado: "calculado" | "sem_prazo" | "falta_data" | null;
  respostas: number;
  entregues: number;
  demonstracao: boolean;
  criado_em: string;
}

interface Confusoes {
  itens: {
    modelo_id: string | null;
    nome: string;
    por_modelo: boolean;
    tipo: string;
    total: number;
    ultimos_30_dias: number;
    sem_prazo: number;
    responderam: number;
    ultima_em: string;
  }[];
  total_cartas_camara: number;
  total_outras_entidades: number;
  nota: string;
}

interface Pagina<T> {
  itens: T[];
  proximo_cursor: string | null;
}

const CANAL: Record<string, string> = {
  chat: "chat",
  telefone: "telefone",
  app: "app",
  web: "site",
  demo: "demonstração",
  whatsapp: "WhatsApp",
};

export function EstadoCarta({ c }: { c: LinhaCarta }) {
  if (c.estado === "respondida")
    return <Pilula tom="verde">respondeu ({c.entregues})</Pilula>;
  if (c.estado === "ilegivel") return <Pilula tom="ambar">ilegível</Pilula>;
  if (c.respostas > 0) return <Pilula tom="neutro">rascunho por confirmar</Pilula>;
  return <Pilula tom="neutro">explicada</Pilula>;
}

export function PaginaCartas() {
  const { pode } = useSessao();
  const permitido = pode("processos");
  const confusoes = useDados<Confusoes>(permitido ? "/v1/painel/cartas/confusoes" : null);
  const base = permitido ? "/v1/painel/cartas?limite=30" : null;
  const lista = useDados<Pagina<LinhaCarta>>(base);
  const mais = useMais(base, lista);

  if (!permitido) return <SemAcesso />;
  const c = confusoes.dados;
  return (
    <div className="pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Cartas"]}
        titulo="Cartas que as pessoas não perceberam"
        descricao="Os ofícios e notificações que os munícipes mandaram ao agente para explicar. Os que mais confundem são os primeiros a reescrever em linguagem simples."
      />
      <div className="flex flex-col gap-6 px-10">
        <Cartao aria-labelledby="confundem">
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-4">
            <div>
              <h2 id="confundem" className="text-[17px] font-bold text-tinta">
                Os ofícios que mais confundem
              </h2>
              {c && (
                <p className="text-xs text-tinta-3">
                  {c.total_cartas_camara} cartas da câmara explicadas ·{" "}
                  {c.total_outras_entidades} eram de outras entidades
                </p>
              )}
            </div>
            <Link
              href="/painel/conhecimento/linguagem-simples"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-terracota-escuro hover:underline"
            >
              <BookOpen className="size-4" aria-hidden />
              Linguagem simples
            </Link>
          </div>
          <Estado
            aCarregar={confusoes.aCarregar}
            erro={confusoes.erro}
            vazio={!c?.itens.length}
            textoVazio="Ainda ninguém pediu ajuda com uma carta da câmara."
          >
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-linha text-left text-xs text-tinta-3">
                  <th className="px-5 py-2 font-semibold">Ofício</th>
                  <th className="px-3 py-2 text-right font-semibold">Pedidos de ajuda</th>
                  <th className="px-3 py-2 text-right font-semibold">Últimos 30 dias</th>
                  <th className="px-3 py-2 text-right font-semibold">Sem prazo claro</th>
                  <th className="px-5 py-2 text-right font-semibold">Responderam</th>
                </tr>
              </thead>
              <tbody>
                {c?.itens.map((i) => (
                  <tr key={`${i.modelo_id ?? ""}${i.tipo}`} className="border-b border-linha last:border-b-0">
                    <td className="px-5 py-2.5">
                      <span className="font-semibold text-tinta">{i.nome}</span>
                      <span className="block text-xs text-tinta-3">
                        {i.por_modelo ? "modelo de ofício" : "tipo de carta (sem modelo conhecido)"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-tinta">{i.total}</td>
                    <td className="px-3 py-2.5 text-right">{i.ultimos_30_dias}</td>
                    <td className="px-3 py-2.5 text-right">{i.sem_prazo}</td>
                    <td className="px-5 py-2.5 text-right">{i.responderam}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c?.nota && <p className="px-5 py-3 text-xs text-tinta-3">{c.nota}</p>}
          </Estado>
        </Cartao>

        <Cartao aria-labelledby="todas">
          <h2 id="todas" className="px-5 pt-4 text-[17px] font-bold text-tinta">
            Todas as cartas
          </h2>
          <Estado
            aCarregar={lista.aCarregar}
            erro={lista.erro}
            vazio={!lista.dados?.itens.length}
            textoVazio="Ainda não há cartas."
          >
            <ul className="pt-2">
              {lista.dados?.itens.map((x) => (
                <LinhaDeCarta key={x.id} c={x} />
              ))}
            </ul>
            {mais.haMais && (
              <div className="p-4">
                <Botao variante="secundario" disabled={mais.aCorrer} onClick={() => void mais.mais()}>
                  Ver mais
                </Botao>
              </div>
            )}
          </Estado>
        </Cartao>
      </div>
    </div>
  );
}

export function LinhaDeCarta({ c, semProcesso }: { c: LinhaCarta; semProcesso?: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-linha px-5 py-3 last:border-b-0">
      {c.da_camara === false ? (
        <Mail className="mt-0.5 size-4 shrink-0 text-tinta-3" aria-hidden />
      ) : (
        <FileQuestion className="mt-0.5 size-4 shrink-0 text-terracota-escuro" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-tinta">
          {c.da_camara === false ? "Carta de outra entidade" : (c.tipo_rotulo ?? "Carta")}
          {c.assunto ? <span className="font-normal text-tinta-2"> · {c.assunto}</span> : null}
        </p>
        <p className="text-xs text-tinta-3">
          {quando(c.criado_em)} · canal: {CANAL[c.canal] ?? c.canal}
          {c.modelo_nome ? ` · modelo «${c.modelo_nome}»` : ""}
          {c.prazo_estado === "calculado" && c.data_limite ? ` · prazo até ${c.data_limite.split("-").reverse().join("/")}` : ""}
          {c.prazo_estado && c.prazo_estado !== "calculado" ? " · prazo por esclarecer" : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {c.demonstracao && <Pilula tom="ambar">demonstração</Pilula>}
        <EstadoCarta c={c} />
        {!semProcesso && c.processo_id && (
          <Link
            href={`/painel/processos/${c.processo_id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-terracota-escuro hover:underline"
          >
            <FolderOpen className="size-3.5" aria-hidden />
            {c.processo_numero}
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * Na ficha do processo: "o munícipe pediu ajuda a perceber este ofício".
 * Sem cartas, não aparece.
 */
export function CartaoCartasProcesso({ processoId }: { processoId: string }) {
  const { pode } = useSessao();
  const lista = useDados<Pagina<LinhaCarta>>(
    pode("processos") ? `/v1/painel/cartas?processo_id=${processoId}&limite=5` : null,
  );
  if (!lista.erro && !lista.dados?.itens.length) return null;
  return (
    <Cartao aria-labelledby="cartas-processo">
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <h2 id="cartas-processo" className="flex items-center gap-2 text-[15px] font-bold text-tinta">
          <FileQuestion className="size-4 text-terracota-escuro" aria-hidden />
          Pediu ajuda a perceber um ofício
        </h2>
        <Link href="/painel/cartas" className="text-xs font-semibold text-terracota-escuro hover:underline">
          Ver todas
        </Link>
      </div>
      <Rotulo className="px-5 pt-1">O agente explicou a carta ao munícipe</Rotulo>
      <Estado aCarregar={lista.aCarregar} erro={lista.erro} vazio={false}>
        <ul className="pt-1">
          {lista.dados?.itens.map((c) => (
            <LinhaDeCarta key={c.id} c={c} semProcesso />
          ))}
        </ul>
      </Estado>
    </Cartao>
  );
}
