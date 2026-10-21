"use client";

import { Check, FolderSync, Save, UserPlus } from "lucide-react";
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
  haQuanto,
  Interruptor,
  numero,
  quando,
  SemAcesso,
  useAcao,
  useDados,
  useEquipaInterna,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { useSessao, type Perfil } from "@/lib/sessao";

interface Membro {
  id: string;
  email: string;
  nome: string;
  perfil: Perfil;
  servico_id: string | null;
  servico: string | null;
  foto_url: string | null;
  ativo: boolean;
  ultimo_acesso_em: string | null;
  criado_em: string;
}

interface Rgpd {
  politicas: {
    objeto: string;
    guardar: string;
    acao: "apagar" | "anonimizar";
    origem: "municipio" | "omissao";
    ultima_execucao: { acao: string; dados: Record<string, unknown>; em: string } | null;
  }[];
  ultima_execucao_em: string | null;
}

interface ConfigGd {
  adaptador: "nenhum" | "simulado";
  taxa_falha: number;
  simulado: boolean;
  adaptadores_disponiveis: string[];
  atualizado_em: string | null;
}
interface EstadoGd {
  adaptador: string;
  sincronizados: number;
  por_sincronizar: number;
  com_erro: number;
  sem_mais_tentativas: number;
  ultima_sincronizacao_em: string | null;
  max_tentativas: number;
  ultimo_erro: { numero: string; mensagem: string; em: string } | null;
}

const PERFIS_CAMARA = ["atendimento", "tecnico", "chefe_divisao", "vereador"] as const;
type PerfilCamara = (typeof PERFIS_CAMARA)[number];

const PERFIL: Record<Perfil, { rotulo: string; classe: string }> = {
  chefe_divisao: { rotulo: "Chefe de divisão", classe: "bg-tinta text-white" },
  tecnico: { rotulo: "Técnico", classe: "bg-terracota-suave text-terracota-escuro" },
  atendimento: { rotulo: "Atendimento", classe: "bg-creme-2 text-tinta-2" },
  vereador: { rotulo: "Vereação", classe: "bg-verde-suave text-verde" },
  equipa_toucamara: { rotulo: "Equipa Tou, Câmara?", classe: "bg-terracota text-white" },
  admin: { rotulo: "Administração", classe: "bg-terracota text-white" },
};

/** O que cada perfil pode fazer (o mesmo que code/api/src/modules/auth/permissoes.ts). */
const MATRIZ: { rotulo: string; perfis: PerfilCamara[] }[] = [
  { rotulo: "Ver conversas e resumos", perfis: ["atendimento", "tecnico", "chefe_divisao"] },
  { rotulo: "Ouvir gravações", perfis: ["atendimento", "chefe_divisao"] },
  { rotulo: "Gerir processos", perfis: ["tecnico", "chefe_divisao"] },
  { rotulo: "Tratar ocorrências", perfis: ["tecnico", "chefe_divisao"] },
  { rotulo: "Publicar respostas do agente", perfis: ["chefe_divisao"] },
  { rotulo: "Ver indicadores e relatórios", perfis: ["tecnico", "chefe_divisao", "vereador"] },
  { rotulo: "Gerir a equipa", perfis: ["chefe_divisao"] },
  { rotulo: "Avisos por zona e agente", perfis: ["chefe_divisao"] },
];

const OBJETOS: Record<string, string> = {
  gravacoes: "Gravações das chamadas",
  transcricoes: "Transcrições e resumos",
  telefones_sem_processo: "Números de telemóvel sem processo",
  fotos_ocorrencias: "Fotos das ocorrências",
};

/** '30 days' → '30 dias', '12 mons' → '12 meses', '1 year' → '1 ano'. */
function prazo(intervalo: string): string {
  const m = intervalo.match(/^(\d+)\s*(day|days|mon|mons|month|months|year|years)$/i);
  if (!m) return intervalo;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u.startsWith("day")) return `${n} ${n === 1 ? "dia" : "dias"}`;
  if (u.startsWith("mon")) return `${n} ${n === 1 ? "mês" : "meses"}`;
  return `${n} ${n === 1 ? "ano" : "anos"}`;
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function Convite({
  servicos,
  onFeito,
}: {
  servicos: { id: string; nome: string }[];
  onFeito: () => void;
}) {
  const { pedido } = useSessao();
  const [v, setV] = useState({ nome: "", email: "", perfil: "atendimento" as PerfilCamara, servico_id: "" });
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() =>
          pedido<Membro>("/v1/painel/equipa", {
            corpo: { nome: v.nome.trim(), email: v.email.trim(), perfil: v.perfil, servico_id: v.servico_id || null },
          }),
        );
        if (r) onFeito();
      }}
    >
      <Campo rotulo="Nome">
        <input className={classeEntrada} required minLength={2} maxLength={120} value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} />
      </Campo>
      <Campo rotulo="Email" ajuda="Recebe um link para entrar no painel.">
        <input type="email" className={classeEntrada} required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Perfil">
          <select className={classeEntrada} value={v.perfil} onChange={(e) => setV({ ...v, perfil: e.target.value as PerfilCamara })}>
            {PERFIS_CAMARA.map((p) => (
              <option key={p} value={p}>
                {PERFIL[p].rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Serviço">
          <select className={classeEntrada} value={v.servico_id} onChange={(e) => setV({ ...v, servico_id: e.target.value })}>
            <option value="">Sem serviço</option>
            {servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={UserPlus} disabled={acao.aCorrer}>
          Convidar
        </Botao>
      </div>
    </form>
  );
}

function Alterar({
  membro,
  servicos,
  euId,
  onFeito,
}: {
  membro: Membro;
  servicos: { id: string; nome: string }[];
  euId: string | undefined;
  onFeito: (m: Membro) => void;
}) {
  const { pedido } = useSessao();
  const [v, setV] = useState({
    perfil: membro.perfil as PerfilCamara,
    servico_id: membro.servico_id ?? "",
    ativo: membro.ativo,
  });
  const acao = useAcao();
  const eu = membro.id === euId;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() =>
          pedido<Membro>(`/v1/painel/equipa/${membro.id}`, {
            metodo: "PATCH",
            corpo: { perfil: v.perfil, servico_id: v.servico_id || null, ativo: v.ativo },
          }),
        );
        if (r) onFeito(r);
      }}
    >
      <p className="text-sm text-tinta-2">{membro.email}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Perfil">
          <select className={classeEntrada} value={v.perfil} onChange={(e) => setV({ ...v, perfil: e.target.value as PerfilCamara })}>
            {PERFIS_CAMARA.map((p) => (
              <option key={p} value={p}>
                {PERFIL[p].rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Serviço">
          <select className={classeEntrada} value={v.servico_id} onChange={(e) => setV({ ...v, servico_id: e.target.value })}>
            <option value="">Sem serviço</option>
            {servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <label className="flex items-center gap-2.5 text-[13px] text-tinta">
        <Interruptor ligado={v.ativo} rotulo="Acesso ativo" desativado={eu} onMudar={(x) => setV({ ...v, ativo: x })} />
        {v.ativo ? "Tem acesso ao painel" : "Sem acesso ao painel"}
        {eu && <span className="text-xs text-tinta-3">(não pode desativar o seu próprio acesso)</span>}
      </label>
      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={Save} disabled={acao.aCorrer}>
          Gravar
        </Botao>
      </div>
    </form>
  );
}

function GestaoDocumental() {
  const { pedido } = useSessao();
  const interno = useEquipaInterna();
  const cfg = useDados<ConfigGd>("/v1/painel/integracoes/gestao-documental");
  const estado = useDados<EstadoGd>("/v1/painel/integracoes/gestao-documental/estado");
  const [taxa, setTaxa] = useState<string | null>(null);
  const acao = useAcao();
  const e = estado.dados;

  const guardar = async (adaptador: "nenhum" | "simulado", taxaFalha?: number) => {
    const r = await acao.executar(() =>
      pedido<ConfigGd>("/v1/painel/integracoes/gestao-documental", {
        metodo: "PUT",
        corpo: taxaFalha === undefined ? { adaptador } : { adaptador, taxa_falha: taxaFalha },
      }),
    );
    if (r) {
      cfg.mudar(() => r);
      setTaxa(null);
      estado.recarregar();
    }
  };

  return (
    <Cartao className="flex flex-col gap-3.5 p-6">
      <div className="flex items-start gap-3">
        <FolderSync className="mt-1 size-5 text-tinta-2" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[19px] font-bold text-tinta">Gestão documental</h2>
          <p className="text-[13px] text-tinta-2">
            Os processos abertos pelo agente seguem para o sistema de gestão documental da câmara.
          </p>
        </div>
      </div>
      <Estado aCarregar={cfg.aCarregar} erro={cfg.erro}>
        {cfg.dados && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2.5 text-[13px] text-tinta">
              <Interruptor
                ligado={cfg.dados.adaptador !== "nenhum"}
                rotulo="Integração ligada"
                desativado={!interno || acao.aCorrer}
                onMudar={(x) => guardar(x ? "simulado" : "nenhum")}
              />
              <span className="font-semibold">
                {cfg.dados.adaptador === "nenhum" ? "Desligada" : "Ligada (simulação)"}
              </span>
              {cfg.dados.atualizado_em && (
                <span className="text-[11px] text-tinta-3">· {quando(cfg.dados.atualizado_em)}</span>
              )}
            </label>
            {interno && cfg.dados.simulado && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  guardar("simulado", Math.max(0, Math.min(1, Number(taxa ?? cfg.dados!.taxa_falha * 100) / 100)));
                }}
              >
                <Campo rotulo="Falhas simuladas (%)" className="w-44">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={classeEntrada}
                    value={taxa ?? String(Math.round(cfg.dados.taxa_falha * 100))}
                    onChange={(ev) => setTaxa(ev.target.value)}
                  />
                </Campo>
                <Botao type="submit" variante="secundario" tamanho="pequeno" disabled={acao.aCorrer || taxa === null}>
                  Gravar
                </Botao>
              </form>
            )}
            {!interno && <p className="text-[11px] text-tinta-3">Só a equipa Tou, Câmara? liga ou desliga a integração.</p>}
          </div>
        )}
      </Estado>
      {e && e.adaptador !== "nenhum" && (
        <dl className="grid grid-cols-3 gap-2.5">
          {[
            ["sincronizados", e.sincronizados, "text-tinta"],
            ["por sincronizar", e.por_sincronizar, "text-tinta"],
            ["com erro", e.com_erro, e.com_erro ? "text-terracota-escuro" : "text-tinta"],
          ].map(([r, n, c]) => (
            <div key={r as string} className="flex flex-col rounded-xl bg-creme p-3">
              <dt className="order-2 text-xs text-tinta-2">{r}</dt>
              <dd className={`font-display text-2xl font-bold ${c}`}>{numero(n as number)}</dd>
            </div>
          ))}
        </dl>
      )}
      {e?.ultimo_erro && (
        <p className="text-xs text-tinta-2">
          Último erro ({e.ultimo_erro.numero}, {quando(e.ultimo_erro.em)}): {e.ultimo_erro.mensagem}
        </p>
      )}
      <ErroLinha erro={acao.erro ?? estado.erro} />
    </Cartao>
  );
}

function DadosPessoais() {
  const r = useDados<Rgpd>("/v1/painel/rgpd");
  return (
    <section className="flex flex-col rounded-2xl bg-tinta p-6">
      <div className="flex flex-col gap-1 pb-3.5">
        <h2 className="font-display text-[19px] font-bold text-white">Dados pessoais · RGPD</h2>
        <p className="text-[13px] text-white/65">Guardados só o tempo necessário, na União Europeia</p>
      </div>
      {r.erro ? (
        <ErroLinha erro={r.erro} />
      ) : !r.dados ? (
        <p className="text-sm text-white/60">A carregar…</p>
      ) : (
        <ul>
          {r.dados.politicas.map((p) => (
            <li key={p.objeto} className="flex flex-col gap-0.5 border-t border-white/10 py-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-white/80">{OBJETOS[p.objeto] ?? p.objeto}</span>
                <span className="text-right text-[13px] font-semibold text-white">
                  {prazo(p.guardar)}, depois {p.acao === "apagar" ? "apagados" : "anonimizados"}
                </span>
              </div>
              {p.ultima_execucao && (
                <span className="text-[11px] text-white/50">
                  Última limpeza: {quando(p.ultima_execucao.em)}
                </span>
              )}
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 border-t border-white/10 py-[11px]">
            <span className="text-[13px] text-white/80">Processos</span>
            <span className="text-[13px] font-semibold text-white">pelo prazo legal de arquivo</span>
          </li>
          <li className="flex items-center justify-between gap-3 border-t border-white/10 py-[11px]">
            <span className="text-[13px] text-white/80">Onde ficam os dados</span>
            <span className="text-[13px] font-semibold text-white">Servidores na União Europeia</span>
          </li>
        </ul>
      )}
      {r.dados?.ultima_execucao_em && (
        <p className="pt-2 text-[11px] text-white/50">
          A limpeza automática correu {quando(r.dados.ultima_execucao_em)}.
        </p>
      )}
    </section>
  );
}

interface Acesso {
  id: string;
  em: string;
  quem: string;
  ator_tipo: string;
  acao: string;
  frase: string;
  dados_pessoais: boolean;
  ligacao: string | null;
  ip: string | null;
}

/** "Registo de acessos": quem viu e alterou o quê (só se acrescenta). */
function RegistoAcessos() {
  const [soPessoais, setSoPessoais] = useState(true);
  const base = `/v1/painel/equipa/acessos?limite=20&so_dados_pessoais=${soPessoais}`;
  const r = useDados<Pagina<Acesso>>(base);
  const mais = useMais(base, r);
  return (
    <Cartao className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha px-6 py-4">
        <div>
          <h2 className="font-display text-[19px] font-bold text-tinta">Registo de acessos</h2>
          <p className="text-[13px] text-tinta-3">
            Cada vez que alguém ouve uma gravação, vê dados de uma pessoa ou muda alguma coisa, fica aqui. Não se apaga.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-tinta">
          Só dados pessoais
          <Interruptor ligado={soPessoais} onMudar={setSoPessoais} rotulo="Só dados pessoais" />
        </label>
      </div>
      <Estado aCarregar={r.aCarregar} erro={r.erro} vazio={r.dados?.itens.length === 0} textoVazio="Ainda não há acessos registados.">
        <ul className="divide-y divide-linha">
          {(r.dados?.itens ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2.5 text-[13px]">
              <span className="w-28 shrink-0 text-tinta-3">{quando(a.em)}</span>
              <span className="font-semibold text-tinta">{a.quem}</span>
              <span className="text-tinta-2">
                {a.ligacao ? (
                  <a href={a.ligacao} className="hover:underline">
                    {a.frase}
                  </a>
                ) : (
                  a.frase
                )}
              </span>
              {a.dados_pessoais && (
                <span className="rounded-full bg-terracota-suave px-2 py-0.5 text-[11px] font-bold text-terracota-escuro">
                  dados pessoais
                </span>
              )}
              {a.ip && <span className="ml-auto font-mono text-[11px] text-tinta-3">{a.ip}</span>}
            </li>
          ))}
        </ul>
        {mais.haMais && (
          <div className="border-t border-linha px-6 py-3">
            <Botao variante="discreto" tamanho="pequeno" disabled={mais.aCorrer} onClick={mais.mais}>
              Ver mais
            </Botao>
          </div>
        )}
      </Estado>
    </Cartao>
  );
}

/** "Equipa e acessos" (frame V2): equipa, permissões, gestão documental e RGPD. */
export function PaginaEquipa() {
  const { eu, pode } = useSessao();
  const lista = useDados<{ itens: Membro[] }>(pode("equipa") ? "/v1/painel/equipa" : null);
  const [convidar, setConvidar] = useState(false);
  const [aberto, setAberto] = useState<Membro | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (!pode("equipa")) {
    return (
      <>
        <CabecalhoPagina titulo="Equipa e acessos" />
        <SemAcesso />
      </>
    );
  }
  const membros = lista.dados?.itens ?? [];
  const servicos = [
    ...new Map(
      membros.filter((m) => m.servico_id).map((m) => [m.servico_id!, { id: m.servico_id!, nome: m.servico ?? "" }]),
    ).values(),
  ].sort((a, b) => a.nome.localeCompare(b.nome, "pt"));

  return (
    <div className="pb-10">
      <CabecalhoPagina
        titulo="Equipa e acessos"
        descricao="Quem vê o quê. Tudo fica registado."
        acoes={
          <button
            type="button"
            onClick={() => setConvidar(true)}
            className="flex h-10 items-center gap-2 rounded-[10px] bg-tinta px-4 text-[13px] font-semibold text-white hover:bg-tinta/90"
          >
            <UserPlus className="size-4" aria-hidden />
            Convidar pessoa
          </button>
        }
      />
      {aviso && (
        <p className="mx-10 mb-4 rounded-xl bg-verde-suave px-3 py-2 text-[13px] text-verde" role="status">
          {aviso}
        </p>
      )}
      <div className="flex flex-col gap-6 px-10">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,568fr)_minmax(0,520fr)]">
          <Cartao className="flex flex-col p-6">
            <div className="flex flex-col gap-1 pb-3.5">
              <h2 className="font-display text-[19px] font-bold text-tinta">Equipa</h2>
              <p className="text-[13px] text-tinta-2">Entram com o link enviado por email.</p>
            </div>
            <Estado aCarregar={lista.aCarregar} erro={lista.erro} vazio={!membros.length} textoVazio="Ainda não há ninguém na equipa.">
              <ul>
                {membros.map((m) => {
                  const p = PERFIL[m.perfil];
                  const editavel = (PERFIS_CAMARA as readonly string[]).includes(m.perfil);
                  const corpo = (
                    <>
                      {m.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.foto_url} alt="" className="size-[30px] rounded-full border border-linha object-cover" />
                      ) : (
                        <span className="flex size-[30px] items-center justify-center rounded-full border border-linha bg-creme-2 text-[11px] font-bold text-tinta-2">
                          {iniciais(m.nome)}
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="truncate text-[13px] font-semibold text-tinta">{m.nome}</span>
                        <span className="truncate text-xs text-tinta-3">{m.servico ?? m.email}</span>
                      </span>
                      <span className={`rounded-[10px] px-[9px] py-[3px] text-[11px] font-semibold ${p.classe}`}>{p.rotulo}</span>
                      <span className="w-20 text-right text-xs text-tinta-3">
                        {m.ativo ? (m.ultimo_acesso_em ? haQuanto(m.ultimo_acesso_em) : "nunca entrou") : "sem acesso"}
                      </span>
                    </>
                  );
                  return (
                    <li key={m.id} className={`border-t border-linha first:border-t-0 ${m.ativo ? "" : "opacity-55"}`}>
                      {editavel ? (
                        <button
                          type="button"
                          onClick={() => setAberto(m)}
                          className="flex min-h-[50px] w-full items-center gap-3 py-2 text-left hover:bg-creme/60"
                          aria-label={`Alterar o acesso de ${m.nome}`}
                        >
                          {corpo}
                        </button>
                      ) : (
                        <div className="flex min-h-[50px] items-center gap-3 py-2">{corpo}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Estado>
          </Cartao>

          <Cartao className="flex flex-col p-6">
            <h2 className="pb-3.5 font-display text-[19px] font-bold text-tinta">O que cada perfil pode fazer</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px]">
                <thead>
                  <tr className="text-[11px] font-bold text-tinta-2">
                    <th scope="col" className="pb-2.5 text-left">
                      <span className="sr-only">Permissão</span>
                    </th>
                    {["Atend.", "Técnico", "Chefe", "Vereador"].map((c) => (
                      <th key={c} scope="col" className="w-[66px] pb-2.5 font-bold">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MATRIZ.map((l) => (
                    <tr key={l.rotulo} className="border-t border-linha">
                      <th scope="row" className="h-10 text-left text-[13px] font-normal text-tinta">
                        {l.rotulo}
                      </th>
                      {PERFIS_CAMARA.map((p) => (
                        <td key={p} className="text-center">
                          {l.perfis.includes(p) ? (
                            <Check className="mx-auto size-4 text-verde" aria-label="Sim" />
                          ) : (
                            <span className="text-tinta-3" aria-label="Não">
                              —
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,568fr)_minmax(0,520fr)]">
          <GestaoDocumental />
          <DadosPessoais />
        </div>

        <RegistoAcessos />
      </div>

      <Dialogo titulo="Convidar pessoa" aberto={convidar} onFechar={() => setConvidar(false)}>
        <Convite
          servicos={servicos}
          onFeito={() => {
            setConvidar(false);
            setAviso("Convite enviado por email.");
            lista.recarregar();
          }}
        />
      </Dialogo>
      <Dialogo titulo={aberto?.nome ?? ""} aberto={!!aberto} onFechar={() => setAberto(null)}>
        {aberto && (
          <Alterar
            membro={aberto}
            servicos={servicos}
            euId={eu?.utilizador.id}
            onFeito={(m) => {
              setAberto(null);
              lista.mudar((d) => ({ itens: d.itens.map((x) => (x.id === m.id ? { ...x, ...m } : x)) }));
            }}
          />
        )}
      </Dialogo>
    </div>
  );
}
