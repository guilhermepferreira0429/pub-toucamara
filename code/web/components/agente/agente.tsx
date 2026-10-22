"use client";

import { Info, Pencil, PhoneOutgoing, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  Interruptor,
  Pilula,
  quando,
  SemAcesso,
  useAcao,
  useDados,
  useEquipaInterna,
} from "@/components/conhecimento/comum";
import type { Definicoes, Entidade } from "@/components/conhecimento/tipos";
import { useSessao } from "@/lib/sessao";

interface Config {
  nome: string;
  saudacao: string;
  trata_por: string;
  idiomas: string[];
  voz_id: string | null;
  voz_nome: string | null;
  ritmo: Ritmo;
  versao: string;
}
type Ritmo = "calmo" | "normal" | "rapido";
const RITMOS: Record<Ritmo, string> = { calmo: "calmo", normal: "normal", rapido: "rápido" };
interface Pronuncia {
  termo: string;
  como_se_diz: string;
}
interface Regra {
  id: string;
  assunto: string;
  entidade_id: string;
  entidade: string;
  contacto_id: string | null;
  contacto_rotulo: string | null;
  contacto_valor: string | null;
  passa_a_pessoa: string | null;
  prioridade: number;
  ativo: boolean;
}
interface Agente {
  config: Config | null;
  pronuncias: Pronuncia[];
  regras_encaminhamento: Regra[];
  pode_editar: boolean;
}
type Motivo = "processo_fase" | "pedido_documento" | "lembrete_prazo" | "manual" | "renovacao_licenca";
interface ConfigChamadas {
  ativo: boolean;
  motivos: Motivo[];
  numero_id: string | null;
  via: "twilio" | "sip_trunk";
  agente_configurado: boolean;
  elevenlabs_disponivel: boolean;
}

const IDIOMAS: { codigo: string; nome: string; nota?: string }[] = [
  { codigo: "pt-PT", nome: "Português de Portugal", nota: "sempre" },
  { codigo: "en", nome: "Inglês" },
  { codigo: "es", nome: "Espanhol" },
  { codigo: "fr", nome: "Francês" },
  { codigo: "uk", nome: "Ucraniano" },
];

const MOTIVOS: Record<Motivo, string> = {
  processo_fase: "Avisar quando o processo muda de fase",
  pedido_documento: "Pedir um documento em falta",
  lembrete_prazo: "Lembrar um prazo",
  manual: "Chamadas pedidas por um funcionário",
  renovacao_licenca: "Lembrar uma licença a expirar (a quem prefere telefone)",
};

function Identidade({
  config,
  podeEditar,
  onGuardado,
}: {
  config: Config | null;
  podeEditar: boolean;
  onGuardado: (c: Config) => void;
}) {
  const { pedido } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState({
    nome: config?.nome ?? "",
    saudacao: config?.saudacao ?? "",
    trata_por: config?.trata_por ?? "você",
    voz_id: config?.voz_id ?? "",
    voz_nome: config?.voz_nome ?? "",
    ritmo: config?.ritmo ?? ("normal" as Ritmo),
  });
  const acao = useAcao();

  return (
    <section className="flex flex-col gap-3.5 rounded-[18px] bg-tinta p-[22px]">
      <div className="flex items-center gap-4">
        <span
          className="flex size-16 shrink-0 items-center justify-center rounded-[32px_32px_32px_8px] bg-terracota font-display text-4xl font-extrabold text-white"
          aria-hidden
        >
          ?
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[11px] font-bold tracking-[0.4px] text-white/60">
            O NOME QUE O MUNÍCIPE OUVE
          </p>
          <p className="font-display text-[34px] leading-tight font-extrabold text-white">
            {config?.nome ?? "Por configurar"}
          </p>
          <p className="text-xs text-white/70">
            Escolhido pela câmara. O serviço chama-se Tou, Câmara?
            {config?.versao ? ` · versão ${config.versao}` : ""}
          </p>
        </div>
        {podeEditar && (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="flex items-center gap-1.5 self-start rounded-[10px] bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15"
          >
            <Pencil className="size-3.5" aria-hidden />
            Editar
          </button>
        )}
      </div>
      {config && (
        <>
          <p className="rounded-[14px] bg-white/[0.08] p-3.5 text-sm text-white">“{config.saudacao}”</p>
          <dl className="grid gap-2.5 sm:grid-cols-3">
            {[
              ["Voz", config.voz_nome ?? (config.voz_id ? "voz escolhida" : "a voz por omissão")],
              ["Trata as pessoas por", config.trata_por],
              ["Ritmo", RITMOS[config.ritmo] ?? config.ritmo],
            ].map(([r, x]) => (
              <div key={r} className="flex flex-col gap-[3px] rounded-[10px] bg-white/[0.06] px-3 py-2.5">
                <dt className="text-[11px] text-white/60">{r}</dt>
                <dd className="truncate text-[13px] font-bold text-white">{x}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <Dialogo titulo="O agente" aberto={aberto} onFechar={() => setAberto(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await acao.executar(() =>
              pedido<Config>("/v1/painel/agente", {
                metodo: "PUT",
                corpo: {
                  nome: v.nome.trim(),
                  saudacao: v.saudacao.trim(),
                  trata_por: v.trata_por.trim(),
                  idiomas: config?.idiomas.length ? config.idiomas : ["pt-PT"],
                  voz_id: v.voz_id.trim() || null,
                  voz_nome: v.voz_nome.trim() || null,
                  ritmo: v.ritmo,
                },
              }),
            );
            if (r) {
              onGuardado(r);
              setAberto(false);
            }
          }}
        >
          <Campo rotulo="Nome">
            <input className={classeEntrada} required maxLength={60} value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} />
          </Campo>
          <Campo rotulo="Saudação" ajuda="Diga que a chamada é gravada.">
            <textarea className={`${classeEntrada} min-h-20`} required maxLength={500} value={v.saudacao} onChange={(e) => setV({ ...v, saudacao: e.target.value })} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Trata as pessoas por">
              <input className={classeEntrada} required maxLength={40} value={v.trata_por} onChange={(e) => setV({ ...v, trata_por: e.target.value })} />
            </Campo>
            <Campo rotulo="Ritmo da fala">
              <select className={classeEntrada} value={v.ritmo} onChange={(e) => setV({ ...v, ritmo: e.target.value as Ritmo })}>
                {Object.entries(RITMOS).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Nome da voz" ajuda="O que a câmara vê, ex.: Minho · sotaque do norte.">
              <input className={classeEntrada} maxLength={80} value={v.voz_nome} onChange={(e) => setV({ ...v, voz_nome: e.target.value })} />
            </Campo>
            <Campo rotulo="Voz (identificador ElevenLabs)">
              <input className={classeEntrada} maxLength={100} value={v.voz_id} onChange={(e) => setV({ ...v, voz_id: e.target.value })} />
            </Campo>
          </div>
          <p className="text-xs text-tinta-3">Gravar cria uma versão nova do agente: as respostas voltam a precisar de avaliação para publicar.</p>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end">
            <Botao type="submit" icone={Save} disabled={acao.aCorrer}>
              Gravar
            </Botao>
          </div>
        </form>
      </Dialogo>
    </section>
  );
}

function Pronuncias({
  itens,
  podeEditar,
  onGuardado,
}: {
  itens: Pronuncia[];
  podeEditar: boolean;
  onGuardado: (p: Pronuncia[]) => void;
}) {
  const { pedido } = useSessao();
  const [rascunho, setRascunho] = useState<Pronuncia[] | null>(null);
  const acao = useAcao();
  const lista = rascunho ?? itens;

  return (
    <Cartao className="flex flex-col gap-3.5 rounded-[18px] p-[22px]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-[3px]">
          <h2 className="font-display text-lg font-bold text-tinta">Como se diz</h2>
          <p className="text-xs text-tinta-2">
            Nomes do concelho escritos como se dizem, para o agente não tropeçar.
          </p>
        </div>
        {podeEditar && !rascunho && (
          <button type="button" onClick={() => setRascunho(itens.map((x) => ({ ...x })))} className="flex items-center gap-1 text-xs font-bold text-terracota-escuro hover:underline">
            <Pencil className="size-3" aria-hidden /> Editar
          </button>
        )}
      </div>
      {rascunho ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const limpos = rascunho
              .map((p) => ({ termo: p.termo.trim(), como_se_diz: p.como_se_diz.trim() }))
              .filter((p) => p.termo && p.como_se_diz);
            const r = await acao.executar(() =>
              pedido<{ itens: Pronuncia[] }>("/v1/painel/agente/pronuncias", { metodo: "PUT", corpo: { itens: limpos } }),
            );
            if (r) {
              onGuardado(r.itens);
              setRascunho(null);
            }
          }}
        >
          {rascunho.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label="Termo"
                className={classeEntrada}
                value={p.termo}
                onChange={(e) => setRascunho(rascunho.map((x, j) => (j === i ? { ...x, termo: e.target.value } : x)))}
                placeholder="Paço dos Duques"
              />
              <input
                aria-label="Como se diz"
                className={classeEntrada}
                value={p.como_se_diz}
                onChange={(e) => setRascunho(rascunho.map((x, j) => (j === i ? { ...x, como_se_diz: e.target.value } : x)))}
                placeholder="pa-ço dos du-ques"
              />
              <button type="button" aria-label="Tirar" onClick={() => setRascunho(rascunho.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-tinta-3 hover:bg-creme hover:text-tinta">
                <X className="size-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setRascunho([...rascunho, { termo: "", como_se_diz: "" }])} className="flex w-fit items-center gap-1 text-xs font-bold text-terracota-escuro hover:underline">
            <Plus className="size-3" aria-hidden /> Juntar
          </button>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" tamanho="pequeno" onClick={() => setRascunho(null)}>
              Cancelar
            </Botao>
            <Botao type="submit" tamanho="pequeno" icone={Save} disabled={acao.aCorrer}>
              Gravar
            </Botao>
          </div>
        </form>
      ) : lista.length ? (
        <ul>
          {lista.map((p) => (
            <li key={p.termo} className="flex items-center gap-2.5 border-t border-linha py-2 first:border-t-0">
              <span className="flex-1 text-[13px] font-semibold text-tinta">{p.termo}</span>
              <span className="font-mono text-xs text-tinta-3">{p.como_se_diz}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-tinta-3">Ainda sem pronúncias.</p>
      )}
    </Cartao>
  );
}

function FormRegra({
  inicial,
  entidades,
  onGuardar,
  aCorrer,
  erro,
}: {
  inicial: Partial<Regra>;
  entidades: Entidade[];
  onGuardar: (r: Record<string, unknown>) => void;
  aCorrer: boolean;
  erro: ReturnType<typeof useAcao>["erro"];
}) {
  const [v, setV] = useState({
    assunto: inicial.assunto ?? "",
    entidade_id: inicial.entidade_id ?? "",
    contacto_id: inicial.contacto_id ?? "",
    passa_a_pessoa: inicial.passa_a_pessoa ?? "",
    prioridade: inicial.prioridade ?? 100,
    ativo: inicial.ativo ?? true,
  });
  const contactos = entidades.find((e) => e.id === v.entidade_id)?.contactos ?? [];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar({
          assunto: v.assunto.trim(),
          entidade_id: v.entidade_id,
          contacto_id: v.contacto_id || null,
          passa_a_pessoa: v.passa_a_pessoa.trim() || null,
          prioridade: v.prioridade,
          ativo: v.ativo,
        });
      }}
    >
      <Campo rotulo="Assunto">
        <input className={classeEntrada} required minLength={2} maxLength={200} value={v.assunto} onChange={(e) => setV({ ...v, assunto: e.target.value })} placeholder="Falta de água, roturas" />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Quem trata">
          <select className={classeEntrada} required value={v.entidade_id} onChange={(e) => setV({ ...v, entidade_id: e.target.value, contacto_id: "" })}>
            <option value="">Escolha a entidade</option>
            {entidades.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Contacto">
          <select className={classeEntrada} value={v.contacto_id} onChange={(e) => setV({ ...v, contacto_id: e.target.value })}>
            <option value="">O principal da entidade</option>
            {contactos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo ? `${c.rotulo}: ` : ""}
                {c.valor}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Passa a pessoa quando (opcional)">
        <input className={classeEntrada} maxLength={300} value={v.passa_a_pessoa} onChange={(e) => setV({ ...v, passa_a_pessoa: e.target.value })} placeholder="se for na via pública" />
      </Campo>
      <div className="flex items-end gap-4">
        <Campo rotulo="Prioridade (menor primeiro)" className="w-48">
          <input type="number" min={0} max={1000} className={classeEntrada} value={v.prioridade} onChange={(e) => setV({ ...v, prioridade: Number(e.target.value) || 0 })} />
        </Campo>
        <span className="flex items-center gap-2 pb-2.5 text-[13px] text-tinta">
          <Interruptor ligado={v.ativo} rotulo="Regra ativa" onMudar={(x) => setV({ ...v, ativo: x })} />
          Ativa
        </span>
      </div>
      <ErroLinha erro={erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={Save} disabled={aCorrer}>
          Gravar regra
        </Botao>
      </div>
    </form>
  );
}

function QuemTrata({
  regras,
  podeEditar,
  onMudou,
}: {
  regras: Regra[];
  podeEditar: boolean;
  onMudou: () => void;
}) {
  const { pedido, pode } = useSessao();
  const entidades = useDados<{ itens: Entidade[] }>(pode("conhecimento_ver") ? "/v1/painel/encaminhamento" : null);
  const [aberta, setAberta] = useState<Partial<Regra> | null>(null);
  const acao = useAcao();
  const horario = (r: Regra) => {
    const e = entidades.dados?.itens.find((x) => x.id === r.entidade_id);
    const c = e?.contactos.find((x) => x.id === r.contacto_id) ?? e?.contactos[0];
    return c?.horario_texto ?? "—";
  };

  return (
    <Cartao className="flex flex-col rounded-[18px] p-[22px]">
      <div className="flex items-start justify-between gap-2 pb-3">
        <div className="flex flex-col gap-[3px]">
          <h2 className="font-display text-lg font-bold text-tinta">Quem trata de quê</h2>
          <p className="text-xs text-tinta-2">
            Para onde o agente encaminha cada assunto, com o número e o horário certos.
          </p>
        </div>
        {podeEditar && (
          <button type="button" onClick={() => setAberta({})} className="flex items-center gap-1 text-xs font-bold text-terracota-escuro hover:underline">
            <Plus className="size-3.5" aria-hidden /> Nova regra
          </button>
        )}
      </div>
      <ErroLinha erro={acao.erro} className="mb-2" />
      {regras.length ? (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Regras de encaminhamento">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-y border-linha text-[11px] font-bold text-tinta-3">
                <th scope="col" className="py-2 font-bold">ASSUNTO</th>
                <th scope="col" className="py-2 font-bold">QUEM TRATA</th>
                <th scope="col" className="py-2 font-bold">CONTACTO</th>
                <th scope="col" className="py-2 font-bold">HORÁRIO</th>
                <th scope="col" className="py-2 font-bold">PASSA A PESSOA</th>
                {podeEditar && <th scope="col" className="py-2"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {regras.map((r) => (
                <tr key={r.id} className={`border-b border-linha ${r.ativo ? "" : "opacity-50"}`}>
                  <td className="py-[11px] pr-3 text-[13px] font-semibold text-tinta">{r.assunto}</td>
                  <td className="py-[11px] pr-3 text-[13px] text-tinta">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full bg-terracota" aria-hidden />
                      {r.entidade}
                    </span>
                  </td>
                  <td className="py-[11px] pr-3 font-mono text-xs text-tinta-2">{r.contacto_valor ?? "—"}</td>
                  <td className="py-[11px] pr-3 text-xs text-tinta-2">{horario(r)}</td>
                  <td className="py-[11px] pr-3 text-xs text-tinta-2">{r.passa_a_pessoa ?? "não"}</td>
                  {podeEditar && (
                    <td className="py-[11px] text-right whitespace-nowrap">
                      <button type="button" aria-label={`Editar ${r.assunto}`} onClick={() => setAberta(r)} className="rounded-md p-1 text-tinta-3 hover:bg-creme hover:text-tinta">
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Apagar ${r.assunto}`}
                        disabled={acao.aCorrer}
                        onClick={async () => {
                          if (!window.confirm(`Apagar a regra «${r.assunto}»?`)) return;
                          const ok = await acao.executar(() =>
                            pedido<void>(`/v1/painel/agente/regras/${r.id}`, { metodo: "DELETE" }).then(() => true),
                          );
                          if (ok) onMudou();
                        }}
                        className="rounded-md p-1 text-tinta-3 hover:bg-creme hover:text-terracota-escuro"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-tinta-3">Ainda sem regras de encaminhamento.</p>
      )}
      <p className="flex items-center gap-2 pt-2.5 text-[11px] text-tinta-3">
        <Info className="size-3.5" aria-hidden />
        Os contactos e horários vêm das entidades do concelho, lidos das fontes oficiais.
      </p>
      <Dialogo titulo={aberta?.id ? "Alterar regra" : "Nova regra"} aberto={!!aberta} onFechar={() => setAberta(null)}>
        {aberta && (
          <FormRegra
            inicial={aberta}
            entidades={entidades.dados?.itens ?? []}
            aCorrer={acao.aCorrer}
            erro={acao.erro}
            onGuardar={async (corpo) => {
              const r = await acao.executar(() =>
                aberta.id
                  ? pedido<Regra>(`/v1/painel/agente/regras/${aberta.id}`, { metodo: "PATCH", corpo })
                  : pedido<Regra>("/v1/painel/agente/regras", { corpo }),
              );
              if (r) {
                setAberta(null);
                onMudou();
              }
            }}
          />
        )}
      </Dialogo>
    </Cartao>
  );
}

function Linguas({
  config,
  podeEditar,
  onGuardado,
}: {
  config: Config | null;
  podeEditar: boolean;
  onGuardado: (c: Config) => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const idiomas = config?.idiomas ?? ["pt-PT"];
  const extra = idiomas.filter((i) => !IDIOMAS.some((x) => x.codigo === i));
  const mudar = async (codigo: string, ligar: boolean) => {
    if (!config) return;
    const novos = ligar ? [...idiomas, codigo] : idiomas.filter((i) => i !== codigo);
    const r = await acao.executar(() =>
      pedido<Config>("/v1/painel/agente", {
        metodo: "PUT",
        corpo: {
          nome: config.nome,
          saudacao: config.saudacao,
          trata_por: config.trata_por,
          voz_id: config.voz_id,
          voz_nome: config.voz_nome,
          ritmo: config.ritmo,
          idiomas: novos,
        },
      }),
    );
    if (r) onGuardado(r);
  };
  return (
    <Cartao className="flex flex-col gap-3.5 rounded-[18px] p-[22px]">
      <div className="flex flex-col gap-[3px]">
        <h2 className="font-display text-lg font-bold text-tinta">Línguas</h2>
        <p className="text-xs text-tinta-2">Atendimento igual para todos, tenha ou não smartphone.</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {[...IDIOMAS, ...extra.map((c) => ({ codigo: c, nome: c, nota: undefined }))].map((l) => {
          const ligado = idiomas.includes(l.codigo);
          const fixo = l.codigo === "pt-PT";
          return (
            <li key={l.codigo} className="flex items-center gap-2.5">
              <Interruptor
                ligado={ligado}
                rotulo={l.nome}
                desativado={!podeEditar || fixo || acao.aCorrer || !config}
                onMudar={(x) => mudar(l.codigo, x)}
              />
              <span className="flex-1 text-[13px] text-tinta">{l.nome}</span>
              {l.nota && <span className="text-[11px] text-tinta-3">{l.nota}</span>}
            </li>
          );
        })}
      </ul>
      <ErroLinha erro={acao.erro} />
    </Cartao>
  );
}

type Veredicto = "certa" | "passada_bem" | "errada" | "sem_resposta";
interface PerguntasDaCamara {
  total: number;
  avaliadas: number;
  certas_pct: number | null;
  a_corrigir: number;
  itens: { id: string; texto: string; comportamento: string; veredicto: Veredicto | null }[];
}

const VEREDICTO: Record<Veredicto, { rotulo: string; tom: "verde" | "terracota" | "ambar" }> = {
  certa: { rotulo: "certa", tom: "verde" },
  passada_bem: { rotulo: "passou bem", tom: "verde" },
  errada: { rotulo: "a corrigir", tom: "terracota" },
  sem_resposta: { rotulo: "sem resposta", tom: "ambar" },
};

/**
 * "As perguntas da câmara": além das perguntas base, as que a câmara mais
 * recebe. O avaliador corre-as antes de cada publicação.
 */
function PerguntasCamara() {
  const { pedido } = useSessao();
  const p = useDados<PerguntasDaCamara>("/v1/painel/agente/perguntas");
  const [texto, setTexto] = useState("");
  const acao = useAcao();
  const d = p.dados;

  const mudar = async (f: () => Promise<PerguntasDaCamara>) => {
    const r = await acao.executar(f);
    if (r) {
      p.mudar(() => r);
      return true;
    }
    return false;
  };

  return (
    <Cartao className="flex flex-col gap-3.5 rounded-[18px] p-[22px]">
      <div className="flex flex-col gap-[3px]">
        <h2 className="font-display text-lg font-bold text-tinta">As perguntas da câmara</h2>
        <p className="text-xs text-tinta-2">
          Além das perguntas de base, o agente só vai para o ar se passar nas perguntas que vocês mais recebem.
        </p>
      </div>
      {d && (
        <dl className="grid grid-cols-3 gap-2">
          {[
            [String(d.total), "perguntas da câmara"],
            [d.certas_pct === null ? "—" : `${d.certas_pct}%`, d.avaliadas ? "certas" : "ainda sem teste"],
            [String(d.a_corrigir), "a corrigir"],
          ].map(([n, r]) => (
            <div key={r} className="flex flex-col gap-0.5 rounded-xl bg-creme p-3">
              <dt className="order-2 text-xs text-tinta-2">{r}</dt>
              <dd className="font-display text-2xl font-extrabold text-tinta">{n}</dd>
            </div>
          ))}
        </dl>
      )}
      <Estado aCarregar={p.aCarregar} erro={p.erro} vazio={false}>
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {d?.itens.map((x) => (
            <li key={x.id} className="group flex items-start gap-2 text-[13px] text-tinta">
              <span className="flex-1">“{x.texto}”</span>
              {x.veredicto && <Pilula tom={VEREDICTO[x.veredicto].tom}>{VEREDICTO[x.veredicto].rotulo}</Pilula>}
              <button
                type="button"
                aria-label={`Tirar “${x.texto}”`}
                disabled={acao.aCorrer}
                onClick={() =>
                  mudar(() => pedido<PerguntasDaCamara>(`/v1/painel/agente/perguntas/${x.id}`, { metodo: "DELETE" }))
                }
                className="text-tinta-3 opacity-0 group-hover:opacity-100 hover:text-terracota focus:opacity-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Estado>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await mudar(() =>
            pedido<PerguntasDaCamara>("/v1/painel/agente/perguntas", {
              metodo: "POST",
              corpo: { texto: texto.trim() },
            }),
          );
          if (ok) setTexto("");
        }}
      >
        <input
          className={`${classeEntrada} flex-1`}
          minLength={5}
          maxLength={500}
          required
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Uma pergunta que recebem muito"
          aria-label="Nova pergunta da câmara"
        />
        <Botao type="submit" icone={Plus} disabled={acao.aCorrer || texto.trim().length < 5}>
          Juntar
        </Botao>
      </form>
      <ErroLinha erro={acao.erro} />
    </Cartao>
  );
}

function ChamadasSaida() {
  const { pedido, pode } = useSessao();
  const c = useDados<ConfigChamadas>("/v1/painel/chamadas-saida/config");
  const [rascunho, setRascunho] = useState<ConfigChamadas | null>(null);
  const acao = useAcao();
  const escrever = pode("agente");
  const v = rascunho ?? c.dados;

  return (
    <Cartao className="flex flex-col gap-3.5 rounded-[18px] p-[22px]">
      <div className="flex items-start gap-3">
        <PhoneOutgoing className="mt-1 size-5 text-terracota" aria-hidden />
        <div className="flex flex-1 flex-col gap-[3px]">
          <h2 className="font-display text-lg font-bold text-tinta">Chamadas do agente para os munícipes</h2>
          <p className="text-xs text-tinta-2">
            O agente pode ligar a avisar de uma fase do processo, a pedir um documento ou a lembrar um
            prazo. Se ninguém atender, segue um SMS.
          </p>
        </div>
      </div>
      <Estado aCarregar={c.aCarregar} erro={c.erro}>
        {v && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await acao.executar(() =>
                pedido<ConfigChamadas>("/v1/painel/chamadas-saida/config", {
                  metodo: "PUT",
                  corpo: { ativo: v.ativo, motivos: v.motivos, numero_id: v.numero_id?.trim() || null, via: v.via },
                }),
              );
              if (r) {
                c.mudar(() => r);
                setRascunho(null);
              }
            }}
          >
            {(!v.agente_configurado || !v.elevenlabs_disponivel) && (
              <p className="rounded-xl bg-ambar-suave px-3 py-2 text-xs text-ambar">
                {!v.agente_configurado
                  ? "O agente de voz deste município ainda não está ligado: as chamadas não saem."
                  : "O serviço de voz não está configurado no servidor: as chamadas não saem."}
              </p>
            )}
            <label className="flex items-center gap-2.5 text-[13px] font-semibold text-tinta">
              <Interruptor
                ligado={v.ativo}
                rotulo="Chamadas de saída ligadas"
                desativado={!escrever}
                onMudar={(x) => setRascunho({ ...v, ativo: x })}
              />
              {v.ativo ? "Ligadas" : "Desligadas"}
            </label>
            <fieldset className="flex flex-col gap-1.5" disabled={!escrever}>
              <legend className="mb-1 text-[13px] font-semibold text-tinta">Pode ligar para</legend>
              {(Object.keys(MOTIVOS) as Motivo[]).map((m) => (
                <label key={m} className="flex items-center gap-2 text-[13px] text-tinta">
                  <input
                    type="checkbox"
                    className="accent-terracota"
                    checked={v.motivos.includes(m)}
                    onChange={(e) =>
                      setRascunho({
                        ...v,
                        motivos: e.target.checked ? [...v.motivos, m] : v.motivos.filter((x) => x !== m),
                      })
                    }
                  />
                  {MOTIVOS[m]}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Número de saída (identificador)">
                <input
                  className={classeEntrada}
                  disabled={!escrever}
                  value={v.numero_id ?? ""}
                  onChange={(e) => setRascunho({ ...v, numero_id: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Via">
                <select
                  className={classeEntrada}
                  disabled={!escrever}
                  value={v.via}
                  onChange={(e) => setRascunho({ ...v, via: e.target.value as ConfigChamadas["via"] })}
                >
                  <option value="twilio">Twilio</option>
                  <option value="sip_trunk">Linha SIP da câmara</option>
                </select>
              </Campo>
            </div>
            <ErroLinha erro={acao.erro} />
            {escrever && rascunho && (
              <div className="flex justify-end gap-2">
                <Botao variante="discreto" tamanho="pequeno" onClick={() => setRascunho(null)}>
                  Cancelar
                </Botao>
                <Botao type="submit" tamanho="pequeno" icone={Save} disabled={acao.aCorrer}>
                  Gravar
                </Botao>
              </div>
            )}
          </form>
        )}
      </Estado>
    </Cartao>
  );
}

function EdicaoPelaCamara() {
  const { pedido, pode } = useSessao();
  const interno = useEquipaInterna();
  const d = useDados<Definicoes>(pode("conhecimento_ver") ? "/v1/painel/conhecimento/definicoes" : null);
  const acao = useAcao();
  if (!pode("conhecimento_ver")) return null;
  return (
    <Cartao className="flex flex-col gap-3 rounded-[18px] p-[22px]">
      <div className="flex flex-col gap-[3px]">
        <h2 className="font-display text-lg font-bold text-tinta">A câmara edita as respostas</h2>
        <p className="text-xs text-tinta-2">
          Com isto ligado, o chefe de divisão escreve e publica respostas. Mudanças em números,
          prazos ou contactos passam pela equipa Tou, Câmara? ou por uma avaliação nova do agente.
        </p>
      </div>
      <Estado aCarregar={d.aCarregar} erro={d.erro}>
        {d.dados && (
          <div className="flex items-center gap-2.5 text-[13px] text-tinta">
            <Interruptor
              ligado={d.dados.camara_edita_respostas}
              rotulo="A câmara edita as respostas"
              desativado={!interno || acao.aCorrer}
              onMudar={async (x) => {
                const r = await acao.executar(() =>
                  pedido<Definicoes>("/v1/painel/conhecimento/definicoes", {
                    metodo: "PATCH",
                    corpo: { camara_edita_respostas: x },
                  }),
                );
                if (r) d.mudar(() => r);
              }}
            />
            <span className="flex-1 font-semibold">{d.dados.camara_edita_respostas ? "Ligada" : "Desligada"}</span>
            {d.dados.atualizado_em && (
              <span className="text-[11px] text-tinta-3">
                {d.dados.atualizado_por ? `${d.dados.atualizado_por}, ` : ""}
                {quando(d.dados.atualizado_em)}
              </span>
            )}
          </div>
        )}
      </Estado>
      {!interno && <p className="text-[11px] text-tinta-3">Só a equipa Tou, Câmara? muda esta definição.</p>}
      <ErroLinha erro={acao.erro} />
    </Cartao>
  );
}

/** "O seu agente" (frame V2 · Agente). A câmara vê; grava só a equipa interna. */
export function PaginaAgente() {
  const { eu, pode } = useSessao();
  const a = useDados<Agente>(pode("agente") ? "/v1/painel/agente" : null);

  if (!pode("agente")) {
    return (
      <>
        <CabecalhoPagina titulo="O seu agente" />
        <SemAcesso />
      </>
    );
  }
  const d = a.dados;
  const mudarConfig = (c: Config) => a.mudar((x) => ({ ...x, config: c }));

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={[`Feito para ${eu?.municipio.nome ?? ""}`]}
        titulo="O seu agente"
        descricao="Nome, voz, quem trata de quê e as perguntas da câmara. Nenhuma alteração vai para o ar sem passar no teste."
        acoes={!d?.pode_editar && d ? <Pilula>Só a equipa Tou, Câmara? altera</Pilula> : undefined}
      />
      {!d ? (
        <div className="px-10">
          <Cartao>
            <Estado aCarregar={a.aCarregar} erro={a.erro} />
          </Cartao>
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-10">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,692fr)_minmax(0,400fr)]">
            <Identidade key={d.config?.versao ?? "x"} config={d.config} podeEditar={d.pode_editar} onGuardado={mudarConfig} />
            <Pronuncias
              itens={d.pronuncias}
              podeEditar={d.pode_editar}
              onGuardado={(p) => a.mudar((x) => ({ ...x, pronuncias: p }))}
            />
          </div>
          <QuemTrata regras={d.regras_encaminhamento} podeEditar={d.pode_editar} onMudou={a.recarregar} />
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,692fr)_minmax(0,400fr)]">
            <ChamadasSaida />
            <div className="flex flex-col gap-5">
              <PerguntasCamara />
              <Linguas config={d.config} podeEditar={d.pode_editar} onGuardado={mudarConfig} />
              <EdicaoPelaCamara />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
