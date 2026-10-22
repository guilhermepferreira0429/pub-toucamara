"use client";

import {
  AlarmClock,
  BellRing,
  FileText,
  MessageSquareText,
  Phone,
  PhoneOutgoing,
  Play,
  Save,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  classeEntrada,
  dia,
  ErroLinha,
  Estado,
  Interruptor,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { FaixaDemonstracao } from "@/components/painel/faixa-demonstracao";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Filtro } from "@/components/painel/filtro";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Antecipações ("a câmara liga-lhe antes de o problema existir").
 * Os momentos dos próximos dias (prazo do munícipe, audiência prévia, prazo
 * da câmara, caducidade, taxa por pagar, licença a expirar), os contactos
 * feitos e o resultado, os alertas internos dos prazos da câmara e as
 * antecedências por tipo (a chefia muda-as; fica registado).
 */

export type TipoMomento =
  | "prazo_municipe"
  | "audiencia_previa"
  | "prazo_camara"
  | "caducidade_alvara"
  | "pagamento_a_vencer"
  | "licenca_expira";
type Gravidade = "alta" | "media" | "baixa";
type CanalConfig = "auto" | "chamada" | "notificacao";

export interface Contacto {
  id: string | null;
  canal: string;
  canal_previsto: string;
  em: string;
  chamada_id: string | null;
  resultado: string;
}

export interface Momento {
  chave: string;
  tipo: TipoMomento;
  rotulo: string;
  gravidade: Gravidade;
  data_alvo: string;
  contactar_em: string;
  faltam_dias_uteis: number;
  devido: boolean;
  processo: { id: string; numero: string; assunto: string } | null;
  descricao: string | null;
  titulo: string;
  o_agente_diz: string;
  o_que_pode_fazer: string;
  sms: string;
  alerta: string | null;
  fonte_legal: string | null;
  confirmar_jurista: boolean;
  demonstracao: boolean;
  gerido_em: string | null;
  contacto: Contacto | null;
}

export interface ContactoFeito {
  id: string;
  tipo: TipoMomento;
  destinatario: "municipe" | "chefia";
  gravidade: Gravidade;
  data_alvo: string;
  processo_id: string | null;
  processo_numero: string | null;
  municipe_nome: string | null;
  canal_previsto: string;
  canal: string;
  chamada_id: string | null;
  conversa_id: string | null;
  titulo: string;
  texto: string;
  dizer: string | null;
  demonstracao: boolean;
  criado_em: string;
  resultado: string;
}

interface ConfigLinha {
  tipo: TipoMomento;
  rotulo: string;
  ativo: boolean;
  antecedencia_dias_uteis: number;
  canal: CanalConfig;
  demonstracao: boolean;
  configuravel: boolean;
  gerido_em: string | null;
}

interface Painel {
  hoje: string;
  ate: string;
  dias: number;
  demo_ativa: boolean;
  resumo: Record<TipoMomento, Record<Gravidade, number>>;
  momentos: Momento[];
  contactos: ContactoFeito[];
  alertas: {
    id: string;
    processo_id: string | null;
    processo_numero: string | null;
    data_alvo: string;
    texto: string;
    em: string;
  }[];
  prazos_camara: {
    processo_id: string | null;
    processo_numero: string | null;
    data_alvo: string;
    faltam_dias_uteis: number;
    alerta: string | null;
  }[];
  config: ConfigLinha[];
}

export const ROTULO_TIPO: Record<TipoMomento, string> = {
  prazo_municipe: "Prazo do munícipe",
  audiencia_previa: "Audiência prévia",
  prazo_camara: "Prazo da câmara",
  caducidade_alvara: "Obra a caducar",
  pagamento_a_vencer: "Taxa por pagar",
  licenca_expira: "Licença a expirar",
};

export const TOM_GRAVIDADE: Record<Gravidade, "terracota" | "ambar" | "neutro"> = {
  alta: "terracota",
  media: "ambar",
  baixa: "neutro",
};

const ROTULO_CANAL: Record<string, string> = {
  chamada: "chamada do agente",
  push: "notificação na app",
  sms: "SMS",
  interno: "alerta interno",
  ja_avisado: "já avisado",
  sem_contacto: "sem contacto",
  notificacao: "push ou SMS",
};

const ROTULO_CANAL_CONFIG: Record<CanalConfig, string> = {
  auto: "Automático (liga nos importantes e a quem não tem a app)",
  chamada: "Sempre chamada do agente",
  notificacao: "Sempre push ou SMS",
};

export function faltam(n: number): string {
  if (n <= 0) return "hoje";
  return n === 1 ? "falta 1 dia útil" : `faltam ${n} dias úteis`;
}

export function PaginaAntecipacoes() {
  const { pode, pedido } = useSessao();
  const permitido = pode("processos");
  const [dias, setDias] = useState("14");
  const [tipo, setTipo] = useState<TipoMomento | "">("");
  const correr = useAcao();
  const [corrida, setCorrida] = useState<string | null>(null);
  const lista = useDados<Painel>(permitido ? `/v1/painel/antecipacoes?dias=${dias}` : null);

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Processos", "Antecipações"]} titulo="Antecipações" />
        <SemAcesso />
      </div>
    );
  }

  const d = lista.dados;
  const momentos = (d?.momentos ?? []).filter((m) => !tipo || m.tipo === tipo);
  const demonstracao = d?.config.some((c) => c.demonstracao) ?? false;

  const correrAgora = async () => {
    setCorrida(null);
    const r = await correr.executar(() =>
      pedido<{ devidos: number; contactos: number; alertas: number }>(
        "/v1/painel/antecipacoes/correr",
        { metodo: "POST", corpo: {} },
      ),
    );
    if (r) {
      setCorrida(
        `${r.devidos} momento(s) devido(s) hoje: ${r.contactos} contacto(s) novo(s) e ${r.alertas} alerta(s) à chefia. Um momento só gera um contacto.`,
      );
      lista.recarregar();
    }
  };

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Processos", "Antecipações"]}
        titulo="Antecipações"
        descricao="A câmara contacta o munícipe antes de um prazo o prejudicar: o agente liga nos casos importantes e a quem não tem a app; os outros recebem uma notificação ou SMS. A chefia é avisada quando o prazo da câmara está a acabar."
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {d?.demo_ativa && pode("agente") && (
              <Botao tamanho="pequeno" icone={Play} disabled={correr.aCorrer} onClick={correrAgora}>
                Correr agora
              </Botao>
            )}
          </div>
        }
      />
      <div className="flex flex-col gap-3 px-4 sm:px-10 pb-5">
        {demonstracao && (
          <FaixaDemonstracao>
            Os prazos e as antecedências de cada aviso são de exemplo, a confirmar pelo jurista da câmara. O que
            precisa mesmo dessa confirmação antes de agir vem marcado em cada momento.
          </FaixaDemonstracao>
        )}
        <Filtro
          rotulo="Próximos"
          valor={dias}
          onMudar={setDias}
          opcoes={[
            { v: "7", t: "7 dias" },
            { v: "14", t: "14 dias" },
            { v: "30", t: "30 dias" },
          ]}
        />
        <Filtro
          rotulo="Tipo"
          valor={tipo}
          onMudar={setTipo}
          opcoes={[
            { v: "", t: "Todos" },
            ...(Object.keys(ROTULO_TIPO) as TipoMomento[]).map((t) => ({ v: t, t: ROTULO_TIPO[t] })),
          ]}
        />
        <ErroLinha erro={correr.erro} />
        {corrida && (
          <p role="status" className="rounded-[10px] bg-verde-suave px-3 py-2 text-[13px] text-verde">
            {corrida}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-6 px-4 sm:px-10">
        <Estado aCarregar={lista.aCarregar} erro={lista.erro} vazio={!d}>
          {d && (
            <>
              <Resumo resumo={d.resumo} />
              <Alertas painel={d} />
              <section className="flex flex-col gap-3">
                <Rotulo>
                  Momentos de {dia(d.hoje)} a {dia(d.ate)} ({momentos.length})
                </Rotulo>
                <Cartao>
                  {momentos.length === 0 ? (
                    <p className="p-5 text-sm text-tinta-3">
                      Nenhum prazo nem data importante nestes dias.
                    </p>
                  ) : (
                    <ul className="divide-y divide-linha">
                      {momentos.map((m) => (
                        <LinhaMomento key={m.chave} m={m} />
                      ))}
                    </ul>
                  )}
                </Cartao>
                <ChamadaWeb />
              </section>
              <Contactos contactos={d.contactos} />
              <Configuracao
                config={d.config}
                podeEditar={pode("agente")}
                onGuardado={lista.recarregar}
              />
            </>
          )}
        </Estado>
      </div>
    </div>
  );
}

function Resumo({ resumo }: { resumo: Painel["resumo"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {(Object.keys(ROTULO_TIPO) as TipoMomento[]).map((t) => {
        const r = resumo[t] ?? { alta: 0, media: 0, baixa: 0 };
        const total = r.alta + r.media + r.baixa;
        return (
          <Cartao key={t} className="flex flex-col gap-1.5 p-4">
            <p className="text-[13px] font-semibold text-tinta-2">{ROTULO_TIPO[t]}</p>
            <p className="font-display text-2xl font-bold text-tinta">{total}</p>
            <div className="flex flex-wrap gap-1">
              {r.alta > 0 && <Pilula tom="terracota">{r.alta} alta</Pilula>}
              {r.media > 0 && <Pilula tom="ambar">{r.media} média</Pilula>}
              {r.baixa > 0 && <Pilula>{r.baixa} baixa</Pilula>}
            </div>
          </Cartao>
        );
      })}
    </div>
  );
}

function Alertas({ painel }: { painel: Painel }) {
  if (!painel.alertas.length && !painel.prazos_camara.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <Rotulo>Alertas de gestão · prazos da câmara</Rotulo>
      <Cartao className="flex flex-col gap-3 border-terracota/40 p-5">
        <p className="flex items-start gap-2 text-sm text-tinta-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-terracota" aria-hidden />
          Processos em que o prazo legal da câmara está a acabar sem decisão. O efeito legal (por
          exemplo, o deferimento tácito) é um valor de demonstração e tem de ser confirmado pelo
          jurista da câmara.
        </p>
        <ul className="flex flex-col gap-2">
          {painel.prazos_camara.map((p) => (
            <li key={`${p.processo_id}-${p.data_alvo}`} className="flex flex-wrap items-center gap-2 text-sm">
              <Pilula tom={p.faltam_dias_uteis <= 1 ? "terracota" : "ambar"}>
                {faltam(p.faltam_dias_uteis)}
              </Pilula>
              {p.processo_id && (
                <Link
                  href={`/painel/processos/${p.processo_id}`}
                  className="font-mono text-xs font-semibold text-terracota hover:underline"
                >
                  {p.processo_numero}
                </Link>
              )}
              <span className="text-tinta">{p.alerta}</span>
              {painel.alertas.some((a) => a.processo_id === p.processo_id && a.data_alvo === p.data_alvo) && (
                <Pilula tom="tinta">alerta enviado</Pilula>
              )}
            </li>
          ))}
          {painel.alertas
            .filter((a) => !painel.prazos_camara.some((p) => p.processo_id === a.processo_id && p.data_alvo === a.data_alvo))
            .map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm text-tinta-2">
                <Pilula>{quando(a.em)}</Pilula>
                <span>{a.texto}</span>
              </li>
            ))}
        </ul>
      </Cartao>
    </section>
  );
}

export function LinhaMomento({ m, semProcesso = false }: { m: Momento; semProcesso?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <AlarmClock className="size-4 text-terracota" aria-hidden />
        <span className="text-[15px] font-semibold text-tinta">{m.rotulo}</span>
        <Pilula tom={TOM_GRAVIDADE[m.gravidade]}>{m.gravidade === "media" ? "média" : m.gravidade}</Pilula>
        <Pilula tom="tinta">
          {dia(m.data_alvo)} · {faltam(m.faltam_dias_uteis)}
        </Pilula>
        {m.confirmar_jurista && <Pilula tom="ambar">a confirmar pelo jurista</Pilula>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-tinta-2">
        {!semProcesso && m.processo && (
          <Link
            href={`/painel/processos/${m.processo.id}`}
            className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-terracota hover:underline"
          >
            <FileText className="size-3.5" aria-hidden />
            {m.processo.numero}
          </Link>
        )}
        {!semProcesso && m.processo && <span>{m.processo.assunto}</span>}
        {m.descricao && <span className="text-tinta-3">{m.descricao}</span>}
      </div>
      <p className="text-[13px] text-tinta-2">
        {m.contacto ? (
          <>
            <strong className="text-tinta">Contactado</strong> {quando(m.contacto.em)} por{" "}
            {ROTULO_CANAL[m.contacto.canal] ?? m.contacto.canal}. {m.contacto.resultado}
          </>
        ) : m.gerido_em ? (
          <>
            Avisado pelos avisos de validade das licenças (
            <Link href={m.gerido_em} className="font-semibold text-terracota hover:underline">
              configurar
            </Link>
            ).
          </>
        ) : m.devido ? (
          <>
            <strong className="text-tinta">Contacto devido hoje</strong>: vai na próxima verificação diária.
          </>
        ) : (
          <>Contacto previsto a {dia(m.contactar_em)}.</>
        )}
      </p>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="self-start text-xs font-semibold text-terracota hover:underline"
      >
        {aberto ? "Esconder" : "O que o agente vai dizer"}
      </button>
      {aberto && (
        <div className="flex flex-col gap-2 rounded-[12px] bg-creme px-4 py-3 text-[13px] text-tinta">
          <p>
            <span className="font-semibold">O agente diz:</span> «{m.o_agente_diz}»
          </p>
          <p>
            <span className="font-semibold">E sugere:</span> {m.o_que_pode_fazer}
          </p>
          <p className="text-tinta-2">
            <span className="font-semibold">SMS se não atender:</span> {m.sms}
          </p>
          {m.alerta && (
            <p className="text-tinta-2">
              <span className="font-semibold">Alerta à chefia:</span> {m.alerta}
            </p>
          )}
          {m.fonte_legal && (
            <p className="text-xs text-tinta-3">
              Fonte: {m.fonte_legal}
              {m.confirmar_jurista ? " (a confirmar pelo jurista da câmara)" : ""}.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Na demonstração não há chamadas reais: a chamada pelo browser faz de telefone. */
function ChamadaWeb() {
  return (
    <p className="flex items-start gap-2 rounded-[12px] border border-linha bg-papel px-4 py-3 text-[13px] text-tinta-2">
      <Phone className="mt-0.5 size-4 shrink-0 text-terracota" aria-hidden />
      <span>
        Experimentar a chamada: abra{" "}
        <Link href="/ligar" className="font-semibold text-terracota hover:underline">
          a chamada pelo browser
        </Link>
        , indique o telemóvel do munícipe e diga que recebeu um aviso. O agente explica o prazo e o que a
        pessoa pode fazer.
      </span>
    </p>
  );
}

function Contactos({ contactos }: { contactos: ContactoFeito[] }) {
  return (
    <section className="flex flex-col gap-3">
      <Rotulo>Contactos feitos ({contactos.length})</Rotulo>
      <Cartao>
        {contactos.length === 0 ? (
          <p className="p-5 text-sm text-tinta-3">Ainda não houve contactos antecipados.</p>
        ) : (
          <ul className="divide-y divide-linha">
            {contactos.map((c) => {
              const Icone = c.canal === "chamada" ? PhoneOutgoing : c.canal === "sms" ? MessageSquareText : BellRing;
              return (
                <li key={c.id} className="flex flex-col gap-1.5 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icone className="size-4 text-terracota" aria-hidden />
                    <span className="text-[15px] font-semibold text-tinta">{ROTULO_TIPO[c.tipo] ?? c.tipo}</span>
                    <Pilula tom={c.canal === "sem_contacto" ? "terracota" : "neutro"}>
                      {ROTULO_CANAL[c.canal] ?? c.canal}
                    </Pilula>
                    <Pilula tom="tinta">alvo {dia(c.data_alvo)}</Pilula>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-tinta-2">
                    <span className="font-semibold text-tinta">{c.municipe_nome ?? "Munícipe"}</span>
                    {c.processo_id && (
                      <Link
                        href={`/painel/processos/${c.processo_id}`}
                        className="font-mono text-xs font-semibold text-terracota hover:underline"
                      >
                        {c.processo_numero}
                      </Link>
                    )}
                    {c.chamada_id && (
                      <Link href="/painel/chamadas" className="text-xs font-semibold text-terracota hover:underline">
                        ver chamada
                      </Link>
                    )}
                    {c.conversa_id && (
                      <Link
                        href={`/painel/conversas/${c.conversa_id}`}
                        className="text-xs font-semibold text-tinta-2 hover:text-tinta"
                      >
                        conversa
                      </Link>
                    )}
                    <span className="text-xs text-tinta-3">{quando(c.criado_em)}</span>
                  </div>
                  <p className="text-[13px] text-tinta-2">{c.resultado}</p>
                  {c.dizer && <p className="text-xs text-tinta-3">O agente diz: «{c.dizer}»</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </section>
  );
}

function Configuracao({
  config,
  podeEditar,
  onGuardado,
}: {
  config: ConfigLinha[];
  podeEditar: boolean;
  onGuardado: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [v, setV] = useState<ConfigLinha[]>(config);
  const [guardado, setGuardado] = useState(false);
  const mudar = (t: TipoMomento, campos: Partial<ConfigLinha>) => {
    setGuardado(false);
    setV((x) => x.map((c) => (c.tipo === t ? { ...c, ...campos } : c)));
  };
  const guardar = async () => {
    const r = await acao.executar(() =>
      pedido("/v1/painel/antecipacoes/config", {
        metodo: "PUT",
        corpo: {
          tipos: v
            .filter((c) => c.configuravel)
            .map((c) => ({
              tipo: c.tipo,
              ativo: c.ativo,
              antecedencia_dias_uteis: c.antecedencia_dias_uteis,
              canal: c.canal,
            })),
        },
      }),
    );
    if (r !== undefined) {
      setGuardado(true);
      onGuardado();
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <Rotulo>Antecedência por tipo</Rotulo>
      <Cartao className="flex flex-col gap-4 p-5">
        <p className="text-[13px] text-tinta-2">
          Quantos dias úteis antes da data se contacta o munícipe (sábados, domingos e feriados do
          município não contam). Os valores por omissão são de demonstração; as alterações ficam no
          registo de acessos.
        </p>
        <ul className="flex flex-col divide-y divide-linha">
          {v.map((c) => (
            <li key={c.tipo} className="grid items-center gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto_120px_minmax(0,280px)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-tinta">{c.rotulo}</span>
              </div>
              {c.configuravel ? (
                <>
                  <Interruptor
                    ligado={c.ativo}
                    rotulo={`Ativo: ${c.rotulo}`}
                    desativado={!podeEditar}
                    onMudar={(ativo) => mudar(c.tipo, { ativo })}
                  />
                  <label className="flex items-center gap-2 text-xs text-tinta-2">
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={c.antecedencia_dias_uteis}
                      disabled={!podeEditar}
                      aria-label={`Antecedência em dias úteis: ${c.rotulo}`}
                      onChange={(e) =>
                        mudar(c.tipo, {
                          antecedencia_dias_uteis: Math.max(0, Math.min(60, Number(e.target.value) || 0)),
                        })
                      }
                      className={`${classeEntrada} w-16 py-1.5`}
                    />
                    dias úteis
                  </label>
                  <select
                    value={c.canal}
                    disabled={!podeEditar}
                    aria-label={`Canal: ${c.rotulo}`}
                    onChange={(e) => mudar(c.tipo, { canal: e.target.value as CanalConfig })}
                    className={`${classeEntrada} py-1.5`}
                  >
                    {(Object.keys(ROTULO_CANAL_CONFIG) as CanalConfig[]).map((k) => (
                      <option key={k} value={k}>
                        {ROTULO_CANAL_CONFIG[k]}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-xs text-tinta-3 md:col-span-3">
                  Configura-se nos avisos de validade das{" "}
                  <Link href={c.gerido_em ?? "/painel/licencas"} className="font-semibold text-terracota hover:underline">
                    licenças
                  </Link>{" "}
                  (aqui só se mostra, para não avisar duas vezes).
                </p>
              )}
            </li>
          ))}
        </ul>
        <ErroLinha erro={acao.erro} />
        {podeEditar ? (
          <div className="flex items-center justify-end gap-3">
            {guardado && <span className="text-xs text-verde">Guardado.</span>}
            <Botao tamanho="pequeno" icone={Save} disabled={acao.aCorrer} onClick={guardar}>
              Guardar antecedências
            </Botao>
          </div>
        ) : (
          <p className="text-xs text-tinta-3">Só a chefia muda as antecedências.</p>
        )}
      </Cartao>
    </section>
  );
}
