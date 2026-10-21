"use client";

import {
  BadgeCheck,
  Check,
  Code2,
  ExternalLink,
  FileText,
  MessageSquareText,
  Pencil,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  euros,
  Interruptor,
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
import { API_URL } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Licenças decididas na chamada. O agente verifica as regras
 * durante a chamada; aqui um funcionário vê o que foi verificado e aprova
 * com um clique. À direita, as regras em código, com os números da câmara.
 */

type Estado = "a_pagar" | "por_aprovar" | "para_tecnico" | "emitida" | "recusada";

interface Config {
  hora_inicio_min: string;
  hora_fim_max_semana: string;
  hora_fim_max_fds: string;
  musica_exterior_ate: string;
  antecedencia_min_dias_uteis: number;
  antecedencia_max_dias: number;
  duracao_max_horas: number;
  pessoas_max: number;
  taxa_cent: number;
  aprovacao: "funcionario" | "automatica";
  fonte: { titulo: string; url: string | null };
  demonstracao: boolean;
}

interface Licenca {
  id: string;
  numero: string;
  processo_id: string;
  estado: Estado;
  proposta: "aprovar" | "tecnico";
  dados: {
    atividade_texto: string;
    descricao: string;
    morada: string;
    hora_inicio: string;
    hora_fim: string;
    pessoas?: number;
    musica_amplificada?: boolean;
  };
  dia: string;
  avaliacao: { regras: { id: string; ok: boolean; texto: string }[]; condicoes: string[] };
  config_usada: { taxa_cent: number };
  taxa_cent: number;
  titular: string | null;
  telefone: string | null;
  conversa_id: string | null;
  pagamento: { estado: string; metodo: string | null; valor_cent: number; modo_teste: boolean } | null;
  codigo_verificacao: string | null;
  decidida_por_nome: string | null;
  decidida_em: string | null;
  motivo_recusa: string | null;
  criada_em: string;
}

interface Lista {
  licencas: Licenca[];
  contagens: Record<Estado, number>;
  config: Config;
}

const ESTADOS: Record<Estado, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" | "tinta" }> = {
  por_aprovar: { rotulo: "paga · por aprovar", tom: "terracota" },
  para_tecnico: { rotulo: "para técnico", tom: "ambar" },
  a_pagar: { rotulo: "à espera do pagamento", tom: "neutro" },
  emitida: { rotulo: "emitida", tom: "verde" },
  recusada: { rotulo: "recusada", tom: "neutro" },
};

const FILTROS: (Estado | "todas")[] = ["todas", "por_aprovar", "para_tecnico", "a_pagar", "emitida", "recusada"];

export function PaginaLicencas() {
  const { pode } = useSessao();
  const [filtro, setFiltro] = useState<Estado | "todas">("todas");
  const caminho = pode("processos")
    ? `/v1/painel/licencas${filtro === "todas" ? "" : `?estado=${filtro}`}`
    : null;
  const d = useDados<Lista>(caminho);

  if (!pode("processos")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Licenças"]} titulo="Licenças" />
        <SemAcesso />
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Licenças"]}
        titulo="Licenças decididas na chamada"
        descricao="O agente verifica as regras enquanto a pessoa está ao telefone. Dentro das regras, a taxa paga-se logo e aqui só falta um clique. Fora das regras, chega ao técnico já analisado."
      />
      <div className="flex flex-wrap gap-2 px-10 pb-5">
        {FILTROS.map((f) => {
          const n = f === "todas" ? null : d.dados?.contagens[f];
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
              {f === "todas" ? "Todas" : ESTADOS[f].rotulo}
              {n ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>
      <div className="grid gap-6 px-10 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Estado
            aCarregar={d.aCarregar}
            erro={d.erro}
            vazio={d.dados?.licencas.length === 0}
            textoVazio="Ainda não há pedidos. Ligue para a linha e peça uma licença de ruído para uma festa."
          >
            {(d.dados?.licencas ?? []).map((l) => (
              <CartaoLicenca key={l.id} l={l} onMudou={d.recarregar} />
            ))}
          </Estado>
        </div>
        {d.dados && <Regras config={d.dados.config} onMudou={d.recarregar} />}
      </div>
    </div>
  );
}

function CartaoLicenca({ l, onMudou }: { l: Licenca; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [recusar, setRecusar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const e = ESTADOS[l.estado];
  const decidir = async (caminho: string, corpo?: object) => {
    const r = await acao.executar(() => pedido(caminho, { metodo: "POST", corpo }));
    if (r !== undefined) {
      setRecusar(false);
      onMudou();
    }
  };

  return (
    <Cartao className={l.estado === "por_aprovar" ? "border-terracota" : ""}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-linha px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-tinta">{l.numero}</span>
            <Pilula tom={e.tom}>{e.rotulo}</Pilula>
            {l.proposta === "aprovar" ? (
              <Pilula tom="verde" icone={Check}>
                cumpre as regras
              </Pilula>
            ) : (
              <Pilula tom="ambar" icone={X}>
                fora das regras
              </Pilula>
            )}
          </div>
          <span className="font-display text-lg font-bold text-tinta">{l.dados.descricao}</span>
          <span className="text-[13px] text-tinta-2">
            <span className="first-letter:uppercase">{l.dia}</span>, das {l.dados.hora_inicio} às {l.dados.hora_fim} ·{" "}
            {l.dados.morada}
            {l.dados.pessoas ? ` · ${numero(l.dados.pessoas)} pessoas` : ""}
          </span>
          <span className="text-xs text-tinta-3">
            {l.titular ?? "Sem nome"}
            {l.telefone ? ` · ${l.telefone}` : ""} · pedido {quando(l.criada_em)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {l.estado === "para_tecnico" ? (
            <span className="text-xs text-tinta-3">
              taxa de {euros(l.config_usada.taxa_cent)}
              <br />
              se o técnico aprovar
            </span>
          ) : (
            <span className="font-display text-xl font-bold text-tinta">{euros(l.taxa_cent)}</span>
          )}
          {l.pagamento && (
            <span className="text-xs text-tinta-3">
              {l.pagamento.estado === "pago" ? "pago" : "por pagar"}
              {l.pagamento.metodo ? ` · ${l.pagamento.metodo === "mbway" ? "MB WAY" : "Multibanco"}` : ""}
              {l.pagamento.modo_teste ? " · teste" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
        <div>
          <Rotulo>Verificado pelo agente</Rotulo>
          <ul className="mt-2 flex flex-col gap-1.5">
            {l.avaliacao.regras.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[13px] text-tinta">
                {r.ok ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-verde" aria-label="cumpre" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-terracota" aria-label="não cumpre" />
                )}
                {r.texto}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Rotulo>Condições na licença</Rotulo>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[13px] text-tinta-2">
            {l.avaliacao.condicoes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linha px-5 py-3">
        <div className="flex flex-wrap gap-3 text-[13px] font-semibold">
          <Link href={`/painel/processos/${l.processo_id}`} className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta">
            <FileText className="size-4" aria-hidden /> processo
          </Link>
          {l.conversa_id && (
            <Link href={`/painel/conversas/${l.conversa_id}`} className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta">
              <MessageSquareText className="size-4" aria-hidden /> conversa
            </Link>
          )}
          {l.codigo_verificacao && (
            <>
              <a href={`/licenca/${l.codigo_verificacao}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-terracota">
                <ExternalLink className="size-4" aria-hidden /> licença com QR
              </a>
              <a
                href={`${API_URL}/v1/public/licencas/${l.codigo_verificacao}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-tinta-2 hover:text-tinta"
              >
                PDF
              </a>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {l.estado === "emitida" && (
            <span className="text-xs text-tinta-3">
              Emitida {quando(l.decidida_em)}
              {l.decidida_por_nome ? ` · ${l.decidida_por_nome}` : " · automática"}
            </span>
          )}
          {l.estado === "recusada" && <span className="text-xs text-tinta-3">Recusada: {l.motivo_recusa}</span>}
          {(l.estado === "por_aprovar" || l.estado === "para_tecnico") && (
            <>
              <Botao tamanho="pequeno" variante="discreto" onClick={() => setRecusar((x) => !x)}>
                Recusar
              </Botao>
              <Botao
                tamanho="pequeno"
                icone={BadgeCheck}
                disabled={acao.aCorrer}
                onClick={() => decidir(`/v1/painel/licencas/${l.id}/aprovar`)}
              >
                {l.estado === "por_aprovar" ? "Aprovar e emitir" : "Aprovar mesmo assim"}
              </Botao>
            </>
          )}
        </div>
      </div>
      {recusar && (
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
              onClick={() => decidir(`/v1/painel/licencas/${l.id}/recusar`, { motivo: motivo.trim() })}
            >
              Recusar e avisar
            </Botao>
          </div>
        </div>
      )}
      <ErroLinha erro={acao.erro} className="mx-5 mb-4" />
    </Cartao>
  );
}

/** As regras em código, como o agente as aplica. */
function Regras({ config, onMudou }: { config: Config; onMudou: () => void }) {
  const { pode } = useSessao();
  const [editar, setEditar] = useState(false);
  const linhas: [string, string][] = [
    ["Começa a partir das", config.hora_inicio_min],
    ["Acaba até (dom. a qui.)", config.hora_fim_max_semana],
    ["Acaba até (sex., sáb., véspera de feriado)", config.hora_fim_max_fds],
    ["Música no exterior até", config.musica_exterior_ate],
    ["Antecedência mínima", `${config.antecedencia_min_dias_uteis} dias úteis`],
    ["Duração máxima", `${config.duracao_max_horas} h`],
    ["Pessoas (sem análise)", `até ${numero(config.pessoas_max)}`],
    ["Taxa", euros(config.taxa_cent)],
    ["Depois de pago", config.aprovacao === "automatica" ? "emite sozinha" : "um funcionário aprova"],
  ];
  return (
    <Cartao className="flex h-fit flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-terracota" aria-hidden />
          <Rotulo>Regras em código · licença de ruído</Rotulo>
        </div>
        {pode("agente") && (
          <Botao tamanho="pequeno" variante="discreto" icone={Pencil} onClick={() => setEditar(true)}>
            Mudar
          </Botao>
        )}
      </div>
      <dl className="flex flex-col divide-y divide-linha text-sm">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-2">
            <dt className="text-tinta-2">{k}</dt>
            <dd className="font-mono font-semibold text-tinta">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-tinta-3">Base: {config.fonte.titulo}.</p>
      {config.demonstracao && (
        <Pilula tom="ambar">valores de demonstração · confirmar com o regulamento</Pilula>
      )}
      <p className="text-xs text-tinta-3">
        Fora destas regras o pedido não é recusado: vai para um técnico, com o que falhou à vista.
      </p>
      <Dialogo titulo="Regras da licença de ruído" aberto={editar} onFechar={() => setEditar(false)}>
        <EditarRegras
          inicial={config}
          onGuardado={() => {
            setEditar(false);
            onMudou();
          }}
        />
      </Dialogo>
    </Cartao>
  );
}

function EditarRegras({ inicial, onGuardado }: { inicial: Config; onGuardado: () => void }) {
  const { pedido } = useSessao();
  const [c, setC] = useState(inicial);
  const acao = useAcao();
  const muda = (x: Partial<Config>) => setC((a) => ({ ...a, ...x }));
  const horaCampo = (k: keyof Config, rotulo: string) => (
    <Campo rotulo={rotulo}>
      <input type="time" className={classeEntrada} value={c[k] as string} onChange={(e) => muda({ [k]: e.target.value })} />
    </Campo>
  );
  const numCampo = (k: keyof Config, rotulo: string, fator = 1) => (
    <Campo rotulo={rotulo}>
      <input
        type="number"
        min={0}
        className={classeEntrada}
        value={(c[k] as number) / fator}
        onChange={(e) => muda({ [k]: Math.round(Number(e.target.value) * fator) })}
      />
    </Campo>
  );
  return (
    <form
      className="grid grid-cols-2 gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() => pedido("/v1/painel/licencas/regras", { metodo: "PUT", corpo: c }));
        if (r !== undefined) onGuardado();
      }}
    >
      {horaCampo("hora_inicio_min", "Começa a partir das")}
      {horaCampo("musica_exterior_ate", "Música no exterior até")}
      {horaCampo("hora_fim_max_semana", "Acaba até (dom. a qui.)")}
      {horaCampo("hora_fim_max_fds", "Acaba até (sex., sáb.)")}
      {numCampo("antecedencia_min_dias_uteis", "Antecedência (dias úteis)")}
      {numCampo("duracao_max_horas", "Duração máxima (h)")}
      {numCampo("pessoas_max", "Pessoas sem análise")}
      {numCampo("taxa_cent", "Taxa (€)", 100)}
      <label className="col-span-2 flex items-center justify-between rounded-[12px] bg-creme px-4 py-3">
        <span className="text-sm font-semibold text-tinta">Emitir sozinha depois de pago</span>
        <Interruptor
          ligado={c.aprovacao === "automatica"}
          onMudar={(v) => muda({ aprovacao: v ? "automatica" : "funcionario" })}
          rotulo="Emitir sozinha"
        />
      </label>
      <label className="col-span-2 flex items-center justify-between rounded-[12px] bg-creme px-4 py-3">
        <span className="text-sm font-semibold text-tinta">Valores de demonstração (por confirmar)</span>
        <Interruptor ligado={c.demonstracao} onMudar={(v) => muda({ demonstracao: v })} rotulo="Demonstração" />
      </label>
      <div className="col-span-2">
        <ErroLinha erro={acao.erro} />
      </div>
      <div className="col-span-2 flex justify-end">
        <Botao type="submit" disabled={acao.aCorrer}>
          Guardar
        </Botao>
      </div>
    </form>
  );
}
