"use client";

import { ExternalLink, FileSignature, MessageSquareText, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  classeEntrada,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { API_URL } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

/*
 * Painel da junta · Atestados (residência, agregado familiar, situação
 * económica) e prova de vida. O agente da junta (ou o da câmara, que
 * encaminha pela freguesia da morada) recolhe os dados, lê-os de volta e a
 * pessoa confirma; aqui o funcionário vê o texto que vai sair, emite (PDF
 * com QR e SMS com o link) ou recusa com o motivo, que segue por SMS.
 */

type EstadoAtestado = "pedido" | "emitido" | "recusado";
type TipoAtestado = "residencia" | "agregado_familiar" | "situacao_economica" | "prova_vida";

interface Atestado {
  id: string;
  numero: string;
  tipo: TipoAtestado;
  titulo: string;
  estado: EstadoAtestado;
  nome: string;
  morada: string;
  freguesia: string;
  finalidade: string | null;
  dados: {
    agregado?: { nome: string; parentesco: string | null }[];
    rendimento_mensal?: number | null;
    entidade_pensao?: string | null;
    pode_deslocar?: boolean | null;
  };
  canal: string;
  conversa_id: string | null;
  encaminhado_por: string | null;
  telefone: string | null;
  criado_em: string;
  emitido_em: string | null;
  emitido_por: string | null;
  motivo_recusa: string | null;
  codigo: string;
}

interface Lista {
  itens: Atestado[];
  contagens: Record<EstadoAtestado, number>;
}

interface Detalhe extends Atestado {
  texto: string[];
  requisitos: string[];
}

const ESTADOS: Record<EstadoAtestado, { rotulo: string; tom: "verde" | "terracota" | "neutro" }> = {
  pedido: { rotulo: "por emitir", tom: "terracota" },
  emitido: { rotulo: "emitido", tom: "verde" },
  recusado: { rotulo: "recusado", tom: "neutro" },
};

const CANAIS: Record<string, string> = {
  telefone: "telefone",
  chat: "chat",
  sms: "SMS",
  whatsapp: "WhatsApp",
  ia: "assistente de IA",
};

export function PaginaAtestados() {
  const { pode, eu } = useSessao();
  const [filtro, setFiltro] = useState<EstadoAtestado | "todos">("pedido");
  const [aberto, setAberto] = useState<string | null>(null);
  const junta = eu?.municipio.tipo === "junta";
  const caminho =
    pode("atestados") && junta
      ? `/v1/painel/atestados${filtro === "todos" ? "" : `?estado=${filtro}`}`
      : null;
  const d = useDados<Lista>(caminho);

  if (!pode("atestados") || (eu && !junta)) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Atestados"]} titulo="Atestados" />
        <SemAcesso
          texto={
            eu && !junta
              ? "Os atestados são passados pelas juntas de freguesia. Esta página existe no painel de cada junta."
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Atestados"]}
        titulo="Atestados"
        descricao="Atestados e prova de vida. O agente recolhe os dados ao telefone ou no chat, lê-os de volta e a pessoa confirma. Aqui verifica o texto, emite o atestado (PDF com QR) e a pessoa recebe o link por SMS."
      />
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-10 pb-5" role="group" aria-label="Estado">
        {(["pedido", "emitido", "recusado", "todos"] as const).map((f) => {
          const n = f === "todos" ? null : d.dados?.contagens[f];
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => setFiltro(f)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
                filtro === f ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
              }`}
            >
              {f === "todos" ? "Todos" : ESTADOS[f].rotulo}
              {n ? ` · ${n}` : ""}
            </button>
          );
        })}
        <Pilula tom="ambar" className="ml-auto">
          valores de demonstração
        </Pilula>
      </div>
      <div className="flex flex-col gap-4 px-4 sm:px-10">
        <Estado
          aCarregar={d.aCarregar}
          erro={d.erro}
          vazio={d.dados?.itens.length === 0}
          textoVazio="Não há pedidos neste estado. Ligue para a linha da junta (ou da câmara) e peça um atestado de residência."
        >
          {(d.dados?.itens ?? []).map((a) => (
            <CartaoAtestado
              key={a.id}
              a={a}
              aberto={aberto === a.id}
              alternar={() => setAberto((x) => (x === a.id ? null : a.id))}
              onMudou={d.recarregar}
            />
          ))}
        </Estado>
      </div>
    </div>
  );
}

function CartaoAtestado({
  a,
  aberto,
  alternar,
  onMudou,
}: {
  a: Atestado;
  aberto: boolean;
  alternar: () => void;
  onMudou: () => void;
}) {
  const e = ESTADOS[a.estado];
  return (
    <Cartao className={a.estado === "pedido" ? "border-terracota" : ""}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-5 py-4 text-left"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-tinta">{a.numero}</span>
            <Pilula tom="tinta">{a.titulo}</Pilula>
            <Pilula tom={e.tom}>{e.rotulo}</Pilula>
            {a.encaminhado_por && (
              <Pilula tom="neutro" icone={Share2}>
                encaminhado por {a.encaminhado_por}
              </Pilula>
            )}
          </div>
          <span className="font-display text-lg font-bold text-tinta">{a.nome}</span>
          <span className="text-[13px] text-tinta-2">
            {a.morada} · {a.freguesia}
            {a.finalidade ? ` · para ${a.finalidade}` : ""}
          </span>
          <span className="text-xs text-tinta-3">
            pedido {quando(a.criado_em)} por {CANAIS[a.canal] ?? a.canal}
            {a.telefone ? ` · ${a.telefone}` : ""} · dados confirmados pela pessoa
          </span>
        </div>
        <span className="text-[13px] font-semibold text-terracota">{aberto ? "Fechar" : "Ver"}</span>
      </button>
      {aberto && <DetalheAtestado id={a.id} onMudou={onMudou} />}
    </Cartao>
  );
}

function DetalheAtestado({ id, onMudou }: { id: string; onMudou: () => void }) {
  const { pedido } = useSessao();
  const d = useDados<Detalhe>(`/v1/painel/atestados/${id}`);
  const acao = useAcao();
  const [nota, setNota] = useState("");
  const [recusar, setRecusar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const a = d.dados;

  const decidir = async (caminho: string, corpo: object) => {
    const r = await acao.executar(() => pedido(caminho, { metodo: "POST", corpo }));
    if (r !== undefined) {
      d.recarregar();
      onMudou();
    }
  };

  if (!a) {
    return (
      <div className="border-t border-linha px-5 py-4">
        <Estado aCarregar={d.aCarregar} erro={d.erro}>
          {null}
        </Estado>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 border-t border-linha px-5 py-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-2">
          <Rotulo>{a.estado === "emitido" ? "Texto emitido" : "Texto que vai sair (modelo de demonstração)"}</Rotulo>
          <div className="flex flex-col gap-2 rounded-xl border border-linha bg-creme px-4 py-3 text-[13px] leading-relaxed text-tinta">
            {a.texto.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {a.dados.agregado && a.dados.agregado.length > 0 && (
            <div>
              <Rotulo>Agregado declarado</Rotulo>
              <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-tinta-2">
                {a.dados.agregado.map((p) => (
                  <li key={p.nome}>
                    {p.nome}
                    {p.parentesco ? ` (${p.parentesco})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.tipo === "prova_vida" && (
            <div>
              <Rotulo>Prova de vida</Rotulo>
              <p className="mt-1.5 text-[13px] text-tinta-2">
                {a.dados.entidade_pensao ? `Para ${a.dados.entidade_pensao}. ` : ""}
                {a.dados.pode_deslocar === false
                  ? "Não pode sair de casa: combinar a visita."
                  : "Vem à junta com o cartão de cidadão."}
              </p>
            </div>
          )}
          <div>
            <Rotulo>Verificar antes de emitir</Rotulo>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[13px] text-tinta-2">
              {a.requisitos.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linha px-5 py-3">
        <div className="flex flex-wrap gap-3 text-[13px] font-semibold">
          {a.conversa_id && (
            <Link
              href={`/painel/conversas/${a.conversa_id}`}
              className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta"
            >
              <MessageSquareText className="size-4" aria-hidden /> conversa
            </Link>
          )}
          <a
            href={`/atestado/${a.codigo}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-terracota"
          >
            <ExternalLink className="size-4" aria-hidden /> página do SMS
          </a>
          {a.estado === "emitido" && (
            <a
              href={`${API_URL}/v1/public/atestados/${a.codigo}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta"
            >
              PDF com QR
            </a>
          )}
        </div>
        {a.estado === "pedido" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${classeEntrada} w-64`}
              placeholder="Nota no atestado (opcional)"
              aria-label="Nota no atestado"
              value={nota}
              onChange={(ev) => setNota(ev.target.value)}
            />
            <Botao tamanho="pequeno" variante="discreto" onClick={() => setRecusar((x) => !x)}>
              Recusar
            </Botao>
            <Botao
              tamanho="pequeno"
              icone={FileSignature}
              disabled={acao.aCorrer}
              onClick={() => decidir(`/v1/painel/atestados/${id}/emitir`, nota.trim() ? { nota: nota.trim() } : {})}
            >
              Emitir e enviar SMS
            </Botao>
          </div>
        ) : (
          <span className="text-xs text-tinta-3">
            {a.estado === "emitido"
              ? `Emitido ${quando(a.emitido_em)}${a.emitido_por ? ` · ${a.emitido_por}` : ""}`
              : `Recusado: ${a.motivo_recusa}`}
          </span>
        )}
      </div>
      {recusar && a.estado === "pedido" && (
        <div className="flex flex-col gap-2 border-t border-linha px-5 py-3">
          <input
            className={classeEntrada}
            placeholder="Porquê (vai por SMS à pessoa)"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
          />
          <div className="flex justify-end">
            <Botao
              tamanho="pequeno"
              variante="secundario"
              disabled={acao.aCorrer || motivo.trim().length < 5}
              onClick={() => decidir(`/v1/painel/atestados/${id}/recusar`, { motivo: motivo.trim() })}
            >
              Recusar e avisar
            </Botao>
          </div>
        </div>
      )}
      <ErroLinha erro={acao.erro} className="mx-5 mb-4" />
    </>
  );
}
