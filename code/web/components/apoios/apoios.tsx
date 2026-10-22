"use client";

import { HandCoins, Pencil, PhoneOutgoing, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
  Pilula,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { FaixaDemonstracao } from "@/components/painel/faixa-demonstracao";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Apoios ("a câmara que liga primeiro"): o catálogo de apoios que o
 * agente usa para dizer "tem direito a isto", quantas pessoas tinham direito
 * e não pediram, e "Ligar a quem pode ter direito" (uma campanha).
 * Não há rendimentos na BD: as listas vêm do que as pessoas disseram ao
 * agente ou da lista da ação social, e o ecrã di-lo.
 */

interface Criterios {
  idade_min: number | null;
  idade_max: number | null;
  agregado_min: number | null;
  rendimento_per_capita_max: number | null;
  filho_idade: { min: number; max: number } | null;
  inquilino: boolean;
  residente_concelho: boolean;
}

interface Apoio {
  id: string;
  codigo: string;
  nome: string;
  resumo: string;
  valor: string | null;
  quem_pode: string;
  criterios: Criterios;
  documentos: string[];
  como_pedir: string;
  fonte: { titulo: string; url: string | null; ambito: "nacional" | "municipal" };
  demonstracao: boolean;
  ativo: boolean;
  atualizado_em: string;
  atualizado_por_nome: string | null;
  numeros: {
    tem_direito: number;
    talvez: number;
    pedidos: number;
    sem_pedido: number;
    sem_pedido_contactaveis: number;
  };
}

interface Dados {
  apoios: Apoio[];
  /** A demonstração está ligada neste servidor (mostra "Carregar apoios de demonstração"). */
  demo_ativa?: boolean;
  totais: { consultas: number; pessoas: number; com_direito_sem_pedido: number; pedidos: number };
  consultas: {
    id: string;
    canal: string;
    criada_em: string;
    atualizada_em: string;
    conversa_id: string | null;
    quem: string;
    telefone: string;
    aceita_contacto: boolean;
    perfil: string;
    tem_direito: string[];
    talvez: string[];
    sem_pedido: string[];
    pedidos: string[];
  }[];
  campanhas: {
    id: string;
    titulo: string;
    estado: string;
    criada_em: string;
    origem: Origem;
    apoio: string | null;
    destinatarios: number;
  }[];
  fontes_da_lista: { consultas: string; contactos_cuidado: string; nota: string };
}

type Origem = "consultas" | "contactos_cuidado";

const CANAL: Record<string, string> = {
  telefone: "telefone",
  chat: "chat",
  ia: "assistente de IA",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

function criteriosCurtos(c: Criterios): string[] {
  const l: string[] = [];
  if (c.residente_concelho) l.push("mora no concelho");
  if (c.idade_min !== null && c.idade_max !== null) l.push(`${c.idade_min} a ${c.idade_max} anos`);
  else if (c.idade_min !== null) l.push(`${c.idade_min} anos ou mais`);
  else if (c.idade_max !== null) l.push(`até ${c.idade_max} anos`);
  if (c.filho_idade)
    l.push(
      c.filho_idade.max === 0
        ? "bebé com menos de 1 ano"
        : `filho entre ${c.filho_idade.min} e ${c.filho_idade.max} anos`,
    );
  if (c.inquilino) l.push("casa arrendada");
  if (c.agregado_min !== null) l.push(`${c.agregado_min}+ pessoas em casa`);
  if (c.rendimento_per_capita_max !== null)
    l.push(`até ${numero(c.rendimento_per_capita_max)} € por pessoa/mês`);
  return l;
}

export function PaginaApoios() {
  const { pode, pedido } = useSessao();
  const d = useDados<Dados>(pode("acao_social") ? "/v1/painel/apoios" : null);
  const carregar = useAcao();
  const [editar, setEditar] = useState<Apoio | null>(null);
  const [ligar, setLigar] = useState<Apoio | null>(null);

  if (!pode("acao_social")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Ação social", "Apoios"]} titulo="Apoios" />
        <SemAcesso />
      </div>
    );
  }

  const dados = d.dados;
  const demonstracao = dados?.apoios.some((a) => a.demonstracao);
  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Ação social", "Apoios"]}
        titulo="Tem direito e ainda não pediu"
        descricao="O agente faz duas ou três perguntas, diz a que apoios a pessoa pode ter direito, manda a lista por SMS e faz o pedido logo ali. Aqui vê quem tinha direito e não pediu, e pode pedir ao agente para lhes ligar."
      />
      <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={false}>
        {dados && dados.apoios.length === 0 ? (
          <Cartao className="mx-10 flex flex-col items-start gap-3 p-6">
            <HandCoins className="size-6 text-terracota" aria-hidden />
            <p className="font-display text-lg font-bold text-tinta">Ainda não há apoios no catálogo.</p>
            <p className="max-w-2xl text-sm text-tinta-2">
              Sem apoios, o agente não diz a ninguém que tem direito a nada: procura nas fontes ou passa à ação
              social.
              {dados.demo_ativa &&
                " Para a demonstração há cinco apoios (tarifa social da água, apoio à renda, cheque bebé, cartão do idoso e material escolar), com critérios de exemplo marcados como tal."}
            </p>
            <ErroLinha erro={carregar.erro} />
            {!dados.demo_ativa ? null : pode("agente") ? (
              <Botao
                icone={Upload}
                disabled={carregar.aCorrer}
                onClick={async () => {
                  const r = await carregar.executar(() =>
                    pedido("/v1/painel/apoios/demonstracao", { metodo: "POST" }),
                  );
                  if (r !== undefined) d.recarregar();
                }}
              >
                Carregar apoios de demonstração
              </Botao>
            ) : (
              <p className="text-xs text-tinta-3">Só quem gere o agente pode carregar o catálogo.</p>
            )}
          </Cartao>
        ) : (
          dados && (
            <div className="flex flex-col gap-6 px-10">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Numero rotulo="Consultas ao agente" valor={dados.totais.consultas} />
                <Numero rotulo="Pessoas diferentes" valor={dados.totais.pessoas} />
                <Numero
                  rotulo="Tinham direito e não pediram"
                  valor={dados.totais.com_direito_sem_pedido}
                  destaque
                />
                <Numero rotulo="Pedidos feitos" valor={dados.totais.pedidos} />
              </div>

              {demonstracao && (
                <FaixaDemonstracao>
                  Os critérios e os valores dos apoios são de exemplo: confirme-os com a ação social antes de pedir ao
                  agente para ligar.
                </FaixaDemonstracao>
              )}

              <p className="rounded-xl bg-creme-2 px-4 py-3 text-[13px] leading-[1.5] text-tinta-2">
                {dados.fontes_da_lista.nota}
              </p>

              <section className="flex flex-col gap-3" aria-labelledby="catalogo">
                <h2 id="catalogo" className="font-display text-xl font-bold text-tinta">
                  Catálogo
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {dados.apoios.map((a) => (
                    <CartaoApoio
                      key={a.id}
                      a={a}
                      podeEditar={pode("agente")}
                      onEditar={() => setEditar(a)}
                      onLigar={() => setLigar(a)}
                    />
                  ))}
                </div>
              </section>

              {dados.campanhas.length > 0 && (
                <Cartao className="p-5">
                  <Rotulo>Chamadas a quem pode ter direito</Rotulo>
                  <ul className="mt-3 flex flex-col divide-y divide-linha">
                    {dados.campanhas.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <Link href={`/painel/campanhas/${c.id}`} className="font-semibold text-tinta hover:underline">
                          {c.titulo}
                        </Link>
                        <span className="flex items-center gap-2 text-xs text-tinta-2">
                          <Pilula>{c.origem === "consultas" ? "de quem perguntou" : "lista da ação social"}</Pilula>
                          {numero(c.destinatarios)} pessoas · {c.estado.replace("_", " ")} · {haQuanto(c.criada_em)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Cartao>
              )}

              <Cartao className="overflow-hidden">
                <div className="flex items-center justify-between px-5 pt-5">
                  <Rotulo>Quem perguntou</Rotulo>
                  <span className="text-xs text-tinta-3">últimas {dados.consultas.length}</span>
                </div>
                <Estado vazio={dados.consultas.length === 0} textoVazio="Ainda ninguém perguntou ao agente pelos apoios.">
                  <div className="overflow-x-auto" tabIndex={0}>
                    <table className="mt-3 w-full min-w-[820px] text-left text-[13px]">
                      <thead className="border-b border-linha text-[11px] tracking-[0.4px] text-tinta-3 uppercase">
                        <tr>
                          <th className="px-5 py-2 font-bold">Quando</th>
                          <th className="px-2 py-2 font-bold">Quem</th>
                          <th className="px-2 py-2 font-bold">O que disse</th>
                          <th className="px-2 py-2 font-bold">Tem direito</th>
                          <th className="px-2 py-2 font-bold">Ainda não pediu</th>
                          <th className="px-5 py-2 font-bold">Voltar a ligar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-linha">
                        {dados.consultas.map((c) => (
                          <tr key={c.id} className="align-top">
                            <td className="px-5 py-2.5 text-tinta-2">
                              {haQuanto(c.atualizada_em)}
                              <span className="block text-xs text-tinta-3">{CANAL[c.canal] ?? c.canal}</span>
                            </td>
                            <td className="px-2 py-2.5 text-tinta">
                              {c.conversa_id ? (
                                <Link href={`/painel/conversas/${c.conversa_id}`} className="hover:underline">
                                  {c.quem}
                                </Link>
                              ) : (
                                c.quem
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-tinta-2">{c.perfil || "—"}</td>
                            <td className="px-2 py-2.5 text-tinta">
                              {c.tem_direito.join(", ") || "—"}
                              {c.talvez.length > 0 && (
                                <span className="block text-xs text-tinta-3">talvez: {c.talvez.join(", ")}</span>
                              )}
                            </td>
                            <td className="px-2 py-2.5">
                              {c.sem_pedido.length ? (
                                <span className="font-semibold text-terracota-escuro">{c.sem_pedido.join(", ")}</span>
                              ) : (
                                <span className="text-tinta-3">—</span>
                              )}
                              {c.pedidos.length > 0 && (
                                <span className="block text-xs text-verde">pediu: {c.pedidos.join(", ")}</span>
                              )}
                            </td>
                            <td className="px-5 py-2.5">
                              {c.aceita_contacto ? <Pilula tom="verde">aceitou</Pilula> : <Pilula>não</Pilula>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Estado>
              </Cartao>
            </div>
          )
        )}
      </Estado>

      {editar && (
        <DialogoEditar
          apoio={editar}
          onFechar={() => setEditar(null)}
          onGuardado={() => {
            setEditar(null);
            d.recarregar();
          }}
        />
      )}
      {ligar && dados && (
        <DialogoLigar apoio={ligar} fontes={dados.fontes_da_lista} onFechar={() => setLigar(null)} />
      )}
    </div>
  );
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <Cartao className="p-4">
      <Rotulo>{rotulo}</Rotulo>
      <p className={`mt-1 font-display text-3xl font-bold ${destaque ? "text-terracota-escuro" : "text-tinta"}`}>
        {numero(valor)}
      </p>
    </Cartao>
  );
}

function CartaoApoio({
  a,
  podeEditar,
  onEditar,
  onLigar,
}: {
  a: Apoio;
  podeEditar: boolean;
  onEditar: () => void;
  onLigar: () => void;
}) {
  const n = a.numeros;
  return (
    <Cartao className={`flex flex-col gap-3 p-5 ${a.ativo ? "" : "border-dashed"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-lg font-bold text-tinta">{a.nome}</p>
          {a.valor && <p className="text-[13px] text-tinta-2">{a.valor}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!a.ativo && <Pilula tom="tinta">desligado</Pilula>}
          <Pilula>{a.fonte.ambito === "nacional" ? "regra nacional" : "regulamento municipal"}</Pilula>
        </div>
      </div>
      <p className="text-sm text-tinta-2">{a.quem_pode}</p>
      <div className="flex flex-wrap gap-1.5">
        {criteriosCurtos(a.criterios).map((c) => (
          <span key={c} className="rounded-lg bg-creme-2 px-2 py-0.5 text-xs text-tinta">
            {c}
          </span>
        ))}
      </div>
      <dl className="grid grid-cols-4 gap-2 rounded-xl bg-creme px-3 py-2.5 text-center">
        {(
          [
            ["tem direito", n.tem_direito],
            ["talvez", n.talvez],
            ["pediram", n.pedidos],
            ["não pediram", n.sem_pedido],
          ] as const
        ).map(([r, v]) => (
          <div key={r}>
            <dt className="text-[11px] text-tinta-3">{r}</dt>
            <dd
              className={`font-display text-xl font-bold ${r === "não pediram" && v > 0 ? "text-terracota-escuro" : "text-tinta"}`}
            >
              {numero(v)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-tinta-3">
        Base: {a.fonte.titulo}
        {a.atualizado_por_nome ? ` · alterado por ${a.atualizado_por_nome} ${haQuanto(a.atualizado_em)}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Botao tamanho="pequeno" icone={PhoneOutgoing} onClick={onLigar} disabled={!a.ativo}>
          Ligar a quem pode ter direito
        </Botao>
        {podeEditar && (
          <Botao tamanho="pequeno" variante="secundario" icone={Pencil} onClick={onEditar}>
            Editar critérios
          </Botao>
        )}
      </div>
    </Cartao>
  );
}

const nulo = (s: string): number | null => (s.trim() === "" ? null : Number(s));

function DialogoEditar({
  apoio,
  onFechar,
  onGuardado,
}: {
  apoio: Apoio;
  onFechar: () => void;
  onGuardado: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const c = apoio.criterios;
  const [f, setF] = useState({
    nome: apoio.nome,
    resumo: apoio.resumo,
    valor: apoio.valor ?? "",
    quem_pode: apoio.quem_pode,
    como_pedir: apoio.como_pedir,
    documentos: apoio.documentos.join("\n"),
    idade_min: c.idade_min?.toString() ?? "",
    idade_max: c.idade_max?.toString() ?? "",
    agregado_min: c.agregado_min?.toString() ?? "",
    rendimento: c.rendimento_per_capita_max?.toString() ?? "",
    filho_min: c.filho_idade?.min.toString() ?? "",
    filho_max: c.filho_idade?.max.toString() ?? "",
    inquilino: c.inquilino,
    residente: c.residente_concelho,
    demonstracao: apoio.demonstracao,
    ativo: apoio.ativo,
  });
  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const guardar = async () => {
    const corpo = {
      nome: f.nome,
      resumo: f.resumo,
      valor: f.valor.trim() || null,
      quem_pode: f.quem_pode,
      como_pedir: f.como_pedir,
      documentos: f.documentos
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
      criterios: {
        idade_min: nulo(f.idade_min),
        idade_max: nulo(f.idade_max),
        agregado_min: nulo(f.agregado_min),
        rendimento_per_capita_max: nulo(f.rendimento),
        filho_idade:
          f.filho_min.trim() || f.filho_max.trim()
            ? { min: nulo(f.filho_min) ?? 0, max: nulo(f.filho_max) ?? 30 }
            : null,
        inquilino: f.inquilino,
        residente_concelho: f.residente,
      },
      fonte: apoio.fonte,
      demonstracao: f.demonstracao,
      ativo: f.ativo,
    };
    const r = await acao.executar(() => pedido(`/v1/painel/apoios/${apoio.id}`, { metodo: "PUT", corpo }));
    if (r !== undefined) onGuardado();
  };

  const numeroCampo = (k: keyof typeof f, rotulo: string, ajuda?: string) => (
    <Campo rotulo={rotulo} ajuda={ajuda}>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        className={classeEntrada}
        value={f[k] as string}
        onChange={muda(k)}
        placeholder="sem limite"
      />
    </Campo>
  );

  return (
    <Dialogo titulo={`Critérios · ${apoio.nome}`} aberto onFechar={onFechar} largura="max-w-2xl">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-tinta-2">
          O agente aplica estes critérios logo na próxima pergunta. Campo vazio = sem limite.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {numeroCampo("idade_min", "Idade mínima")}
          {numeroCampo("idade_max", "Idade máxima")}
          {numeroCampo("agregado_min", "Pessoas em casa (mín.)")}
          {numeroCampo("rendimento", "Rendimento por pessoa (máx.)", "euros por mês")}
          {numeroCampo("filho_min", "Filho com idade de", "anos (0 = bebé)")}
          {numeroCampo("filho_max", "até", "anos")}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-tinta">
          {(
            [
              ["residente", "Tem de morar no concelho"],
              ["inquilino", "Tem de viver em casa arrendada"],
              ["demonstracao", "Valores de demonstração"],
              ["ativo", "Ligado (o agente usa-o)"],
            ] as const
          ).map(([k, r]) => (
            <span key={k} className="flex items-center gap-2">
              <Interruptor rotulo={r} ligado={f[k]} onMudar={(v) => setF((x) => ({ ...x, [k]: v }))} />
              {r}
            </span>
          ))}
        </div>
        <Campo rotulo="Quem pode (o que a pessoa lê)">
          <textarea rows={2} className={classeEntrada} value={f.quem_pode} onChange={muda("quem_pode")} />
        </Campo>
        <Campo rotulo="O que dá">
          <input className={classeEntrada} value={f.valor} onChange={muda("valor")} />
        </Campo>
        <Campo rotulo="Documentos a entregar" ajuda="Um por linha.">
          <textarea rows={4} className={classeEntrada} value={f.documentos} onChange={muda("documentos")} />
        </Campo>
        <Campo rotulo="Como pedir">
          <textarea rows={2} className={classeEntrada} value={f.como_pedir} onChange={muda("como_pedir")} />
        </Campo>
        <ErroLinha erro={acao.erro} />
        <div className="flex justify-end gap-2">
          <Botao variante="discreto" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao disabled={acao.aCorrer} onClick={guardar}>
            Guardar
          </Botao>
        </div>
      </div>
    </Dialogo>
  );
}

interface PreVisualizacao {
  destinatarios: number;
  a_ligar: number;
  minutos_estimados: number;
  mensagem: string;
  perguntas: string[];
  sms_recurso: string;
}

function DialogoLigar({
  apoio,
  fontes,
  onFechar,
}: {
  apoio: Apoio;
  fontes: Dados["fontes_da_lista"];
  onFechar: () => void;
}) {
  const { pedido } = useSessao();
  const router = useRouter();
  const [origem, setOrigem] = useState<Origem>("consultas");
  const [ignorarHorario, setIgnorarHorario] = useState(false);
  const [previa, setPrevia] = useState<Record<Origem, PreVisualizacao | undefined>>({
    consultas: undefined,
    contactos_cuidado: undefined,
  });
  const ver = useAcao();
  const lancar = useAcao();

  const escolher = async (o: Origem) => {
    setOrigem(o);
    if (previa[o]) return;
    const r = await ver.executar(() =>
      pedido<PreVisualizacao>(`/v1/painel/apoios/${apoio.id}/pre-visualizar-campanha`, {
        metodo: "POST",
        corpo: { origem: o },
      }),
    );
    if (r) setPrevia((x) => ({ ...x, [o]: r }));
  };
  const p = previa[origem];

  return (
    <Dialogo titulo={`Ligar a quem pode ter direito · ${apoio.nome}`} aberto onFechar={onFechar} largura="max-w-xl">
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-tinta">A quem ligar</legend>
          {(
            [
              ["consultas", "Quem perguntou e tinha direito, mas não pediu", fontes.consultas],
              ["contactos_cuidado", "A lista de pessoas inscritas na ação social", fontes.contactos_cuidado],
            ] as const
          ).map(([o, titulo, texto]) => (
            <label
              key={o}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${origem === o ? "border-terracota bg-terracota-suave/30" : "border-linha"}`}
            >
              <input
                type="radio"
                name="origem"
                checked={origem === o}
                onChange={() => void escolher(o)}
                className="mt-1 accent-terracota"
              />
              <span>
                <span className="block text-sm font-semibold text-tinta">{titulo}</span>
                <span className="block text-xs text-tinta-2">De onde vem a lista: {texto}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {!p && !ver.aCorrer && (
          <Botao variante="secundario" tamanho="pequeno" onClick={() => void escolher(origem)}>
            Ver quantas pessoas
          </Botao>
        )}
        {ver.aCorrer && <p className="text-sm text-tinta-3">A contar…</p>}
        <ErroLinha erro={ver.erro} />
        {p && (
          <div className="flex flex-col gap-3 rounded-xl bg-creme p-4 text-sm">
            <p className="text-tinta">
              <strong>{numero(p.a_ligar)}</strong> pessoas a ligar
              {p.destinatarios > p.a_ligar ? ` (de ${numero(p.destinatarios)}; as outras recebem SMS)` : ""} · cerca de{" "}
              {numero(p.minutos_estimados)} min
            </p>
            <div>
              <Rotulo>O agente começa por dizer</Rotulo>
              <p className="mt-1 text-tinta-2">{p.mensagem}</p>
            </div>
            <div>
              <Rotulo>E pergunta</Rotulo>
              <ul className="mt-1 list-disc pl-5 text-tinta-2">
                {p.perguntas.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <Rotulo>A quem não atender, SMS</Rotulo>
              <p className="mt-1 text-tinta-2">{p.sms_recurso}</p>
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-tinta">
          <Interruptor rotulo="Ligar já, fora do horário" ligado={ignorarHorario} onMudar={setIgnorarHorario} />
          Ligar já (por omissão, só das 9h às 21h)
        </label>
        <ErroLinha erro={lancar.erro} />
        <div className="flex justify-end gap-2">
          <Botao variante="discreto" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao
            icone={PhoneOutgoing}
            disabled={lancar.aCorrer || !p || p.destinatarios === 0}
            onClick={async () => {
              const r = await lancar.executar(() =>
                pedido<{ campanha_id: string }>(`/v1/painel/apoios/${apoio.id}/campanha`, {
                  metodo: "POST",
                  corpo: { origem, ignorar_horario: ignorarHorario },
                }),
              );
              if (r) router.push(`/painel/campanhas/${r.campanha_id}`);
            }}
          >
            {p ? `Ligar a ${numero(p.destinatarios)} pessoas` : "Ligar"}
          </Botao>
        </div>
      </div>
    </Dialogo>
  );
}
