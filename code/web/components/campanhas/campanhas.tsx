"use client";

import { Phone, Plus, Trash2, UserPlus, Users } from "lucide-react";
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
import { useSessao } from "@/lib/sessao";
import {
  contactadas,
  TIPOS,
  total,
  type CampanhaLista,
  type Contactos,
  type Preset,
} from "./tipos";

/*
 * Painel · Ação social: "Onda de calor, ligar a todos". A câmara escolhe o
 * tipo, revê o que o agente vai dizer e liga a todas as pessoas inscritas.
 * Só se liga a quem deu autorização (RGPD): a lista fica no separador
 * "Pessoas inscritas".
 */

export function PaginaCampanhas() {
  const { pode } = useSessao();
  const [separador, setSeparador] = useState<"campanhas" | "pessoas">("campanhas");
  const [preset, setPreset] = useState<Preset | null>(null);
  const permitido = pode("acao_social");
  const lista = useDados<{ campanhas: CampanhaLista[] }>(permitido ? "/v1/painel/campanhas" : null);
  const contactos = useDados<Contactos>(permitido ? "/v1/painel/campanhas/contactos" : null);

  if (!permitido) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Atendimento", "Ação social"]} titulo="Ação social" />
        <SemAcesso />
      </div>
    );
  }

  const presets = contactos.dados?.presets ?? [];
  const inscritas = contactos.dados?.contactos.length ?? 0;

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Atendimento", "Ação social"]}
        titulo="Ação social"
        descricao="Em ondas de calor, frio ou cortes de água, o agente liga a todas as pessoas inscritas e pergunta se estão bem. Quem precisa de ajuda ou não atende aparece logo aqui."
      />

      <div className="grid gap-4 px-10 md:grid-cols-2 xl:grid-cols-4">
        {presets.map((p) => {
          const t = TIPOS[p.tipo];
          const Icone = t.icone;
          const destaque = p.tipo === "onda_calor";
          return (
            <button
              key={p.tipo}
              type="button"
              onClick={() => setPreset(p)}
              disabled={inscritas === 0}
              className={`group flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                destaque
                  ? "border-terracota bg-terracota text-white hover:bg-terracota-escuro"
                  : "border-linha bg-papel text-tinta hover:border-terracota"
              }`}
            >
              <span
                className={`flex size-10 items-center justify-center rounded-[12px] ${
                  destaque ? "bg-white/15" : "bg-terracota-suave text-terracota-escuro"
                }`}
              >
                <Icone className="size-5" aria-hidden />
              </span>
              <span className="font-display text-lg leading-tight font-bold">{t.acao}</span>
              <span className={`text-[13px] ${destaque ? "text-white/80" : "text-tinta-3"}`}>
                <Phone className="mr-1 inline size-3.5" aria-hidden />
                {numero(inscritas)} pessoas inscritas
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex gap-1 border-b border-linha px-10" role="tablist">
        {(
          [
            ["campanhas", "Campanhas"],
            ["pessoas", `Pessoas inscritas · ${numero(inscritas)}`],
          ] as const
        ).map(([k, r]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={separador === k}
            onClick={() => setSeparador(k)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold ${
              separador === k ? "border-terracota text-terracota-escuro" : "border-transparent text-tinta-3"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="px-10 pt-6">
        {separador === "campanhas" ? (
          <Cartao>
            <Estado
              aCarregar={lista.aCarregar}
              erro={lista.erro}
              vazio={lista.dados?.campanhas.length === 0}
              textoVazio={
                inscritas === 0
                  ? "Primeiro inscreva as pessoas que aceitam ser contactadas, no separador ao lado."
                  : "Ainda não houve campanhas. Escolha uma em cima para ligar a todos."
              }
            >
              <ul className="divide-y divide-linha">
                {(lista.dados?.campanhas ?? []).map((c) => (
                  <LinhaCampanha key={c.id} c={c} />
                ))}
              </ul>
            </Estado>
          </Cartao>
        ) : (
          <Pessoas dados={contactos.dados} aCarregar={contactos.aCarregar} onMudou={contactos.recarregar} />
        )}
      </div>

      <Dialogo
        titulo={preset ? TIPOS[preset.tipo].acao : ""}
        aberto={!!preset}
        onFechar={() => setPreset(null)}
        largura="max-w-2xl"
      >
        {preset && (
          <NovaCampanha
            preset={preset}
            freguesias={contactos.dados?.freguesias ?? []}
            onCancelar={() => setPreset(null)}
          />
        )}
      </Dialogo>
    </div>
  );
}

function LinhaCampanha({ c }: { c: CampanhaLista }) {
  const t = TIPOS[c.tipo];
  const Icone = t.icone;
  const n = total(c.contagens);
  const feitas = contactadas(c.contagens);
  const semResposta =
    c.contagens.nao_atendeu + c.contagens.sem_ligacao + c.contagens.recusou + c.contagens.atendeu;
  return (
    <li>
      <Link href={`/painel/campanhas/${c.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-creme">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-terracota-suave text-terracota-escuro">
          <Icone className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-tinta">{c.titulo}</span>
            {c.estado === "a_ligar" ? (
              <Pilula tom="ambar">a ligar</Pilula>
            ) : c.estado === "cancelada" ? (
              <Pilula tom="neutro">cancelada</Pilula>
            ) : (
              <Pilula tom="verde">terminada</Pilula>
            )}
          </div>
          <span className="text-xs text-tinta-3">
            {quando(c.criada_em)}
            {c.criada_por_nome ? ` · ${c.criada_por_nome}` : ""} · {numero(feitas)} de {numero(n)} contactadas
          </span>
        </div>
        <div className="flex items-center gap-2">
          {c.contagens.precisa_ajuda > 0 && (
            <Pilula tom="terracota">
              {numero(c.contagens.precisa_ajuda)}{" "}
              {c.contagens.precisa_ajuda === 1 ? "precisa" : "precisam"} de ajuda
            </Pilula>
          )}
          {semResposta > 0 && (
            <Pilula tom="ambar">
              {numero(semResposta)} sem resposta
            </Pilula>
          )}
          <Pilula tom="verde">{numero(c.contagens.bem)} bem</Pilula>
        </div>
      </Link>
    </li>
  );
}

interface Previa {
  destinatarios: number;
  a_ligar: number;
  sem_telefone: number;
  recusam_chamadas: number;
  minutos_estimados: number;
}

function NovaCampanha({
  preset,
  freguesias,
  onCancelar,
}: {
  preset: Preset;
  freguesias: { nome: string; pessoas: number }[];
  onCancelar: () => void;
}) {
  const { pedido } = useSessao();
  const router = useRouter();
  const [titulo, setTitulo] = useState(preset.titulo);
  const [mensagem, setMensagem] = useState(preset.mensagem);
  const [perguntas, setPerguntas] = useState(preset.perguntas.join("\n"));
  const [sms, setSms] = useState(preset.sms_recurso);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [ja, setJa] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const ver = useAcao();
  const lancar = useAcao();

  const alternar = (f: string) => {
    setPrevia(null);
    setEscolhidas((a) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]));
  };
  const corpoFreguesias = escolhidas.length ? escolhidas : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Campo rotulo="Título">
        <input className={classeEntrada} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </Campo>
      <Campo rotulo="O que o agente diz primeiro">
        <textarea
          rows={3}
          className={classeEntrada}
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Perguntas (uma por linha)" ajuda="O agente faz uma de cada vez e regista a resposta.">
        <textarea
          rows={3}
          className={classeEntrada}
          value={perguntas}
          onChange={(e) => setPerguntas(e.target.value)}
        />
      </Campo>
      <Campo rotulo="SMS para quem não atender" ajuda={`${sms.length} caracteres`}>
        <textarea rows={2} className={classeEntrada} value={sms} onChange={(e) => setSms(e.target.value)} />
      </Campo>
      {freguesias.length > 0 && (
        <div className="flex flex-col gap-2">
          <Rotulo>Freguesias (nenhuma escolhida = todas)</Rotulo>
          <div className="flex flex-wrap gap-2">
            {freguesias.map((f) => (
              <button
                key={f.nome}
                type="button"
                aria-pressed={escolhidas.includes(f.nome)}
                onClick={() => alternar(f.nome)}
                className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${
                  escolhidas.includes(f.nome)
                    ? "border-terracota bg-terracota-suave text-terracota-escuro"
                    : "border-linha text-tinta-2"
                }`}
              >
                {f.nome} · {f.pessoas}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="flex items-center justify-between gap-3 rounded-[12px] bg-creme px-4 py-3">
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-tinta">Emergência: ligar já, a qualquer hora</span>
          <span className="text-xs text-tinta-3">Por omissão o agente só liga das 9h às 21h.</span>
        </span>
        <Interruptor ligado={ja} onMudar={setJa} rotulo="Ligar já" />
      </label>

      {previa && (
        <div className="grid grid-cols-2 gap-3 rounded-[12px] border border-linha p-4 text-sm sm:grid-cols-4">
          <Num rotulo="pessoas" valor={previa.destinatarios} />
          <Num rotulo="vão ser ligadas" valor={previa.a_ligar} />
          <Num rotulo="recusam chamadas (SMS)" valor={previa.recusam_chamadas} />
          <Num rotulo="minutos para ligar a todos" valor={previa.minutos_estimados} />
        </div>
      )}
      <ErroLinha erro={ver.erro ?? lancar.erro} />
      <div className="flex justify-end gap-2">
        <Botao variante="discreto" onClick={onCancelar}>
          Cancelar
        </Botao>
        {!previa ? (
          <Botao
            variante="secundario"
            icone={Users}
            disabled={ver.aCorrer}
            onClick={async () => {
              const r = await ver.executar(() =>
                pedido<Previa>("/v1/painel/campanhas/pre-visualizar", {
                  corpo: { freguesias: corpoFreguesias },
                }),
              );
              if (r) setPrevia(r);
            }}
          >
            Ver quem vai ser ligado
          </Botao>
        ) : (
          <Botao
            icone={Phone}
            disabled={lancar.aCorrer || previa.destinatarios === 0}
            onClick={async () => {
              const r = await lancar.executar(() =>
                pedido<{ id: string }>("/v1/painel/campanhas", {
                  corpo: {
                    tipo: preset.tipo,
                    titulo: titulo.trim(),
                    mensagem: mensagem.trim(),
                    perguntas: perguntas
                      .split("\n")
                      .map((p) => p.trim())
                      .filter(Boolean),
                    sms_recurso: sms.trim(),
                    freguesias: corpoFreguesias,
                    ignorar_horario: ja,
                  },
                }),
              );
              if (r) router.push(`/painel/campanhas/${r.id}`);
            }}
          >
            Ligar a {numero(previa.destinatarios)} pessoas
          </Botao>
        )}
      </div>
    </div>
  );
}

function Num({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-2xl font-bold text-tinta">{numero(valor)}</span>
      <span className="text-xs text-tinta-3">{rotulo}</span>
    </div>
  );
}

const VAZIO = { nome: "", telefone: "", morada: "", freguesia: "", notas: "" };

function Pessoas({
  dados,
  aCarregar,
  onMudou,
}: {
  dados: Contactos | undefined;
  aCarregar: boolean;
  onMudou: () => void;
}) {
  const { pedido } = useSessao();
  const [f, setF] = useState(VAZIO);
  const [consentiu, setConsentiu] = useState(false);
  const [aberto, setAberto] = useState(false);
  const acao = useAcao();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-tinta-2">
          Só se liga a quem aceitou ser contactado pela câmara nestas situações. Cada inscrição
          guarda a data e a origem da autorização.
        </p>
        <Botao icone={UserPlus} onClick={() => setAberto(true)}>
          Inscrever pessoa
        </Botao>
      </div>
      <Cartao>
        <Estado
          aCarregar={aCarregar}
          vazio={dados?.contactos.length === 0}
          textoVazio="Ainda não há pessoas inscritas."
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold tracking-[0.4px] text-tinta-3 uppercase">
                <th className="px-5 py-2.5">Nome</th>
                <th className="px-3 py-2.5">Telefone</th>
                <th className="px-3 py-2.5">Freguesia</th>
                <th className="px-3 py-2.5">Notas</th>
                <th className="px-3 py-2.5">Autorização</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {(dados?.contactos ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-3 font-semibold text-tinta">{c.nome}</td>
                  <td className="px-3 py-3">
                    {c.telefone ?? "—"}
                    {!c.ligavel && (
                      <Pilula tom="ambar" className="ml-2">
                        só SMS
                      </Pilula>
                    )}
                  </td>
                  <td className="px-3 py-3">{c.freguesia ?? "—"}</td>
                  <td className="px-3 py-3 text-tinta-2">{c.notas ?? ""}</td>
                  <td className="px-3 py-3 text-xs text-tinta-3">{quando(c.consentimento_em)}</td>
                  <td className="px-5 py-3 text-right">
                    <Botao
                      tamanho="pequeno"
                      variante="discreto"
                      icone={Trash2}
                      aria-label={`Retirar ${c.nome}`}
                      onClick={async () => {
                        if (!window.confirm(`Retirar ${c.nome} da lista?`)) return;
                        const r = await acao.executar(() =>
                          pedido(`/v1/painel/campanhas/contactos/${c.id}`, { metodo: "DELETE" }),
                        );
                        if (r !== undefined) onMudou();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>

      <Dialogo titulo="Inscrever pessoa" aberto={aberto} onFechar={() => setAberto(false)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await acao.executar(() =>
              pedido("/v1/painel/campanhas/contactos", {
                corpo: {
                  nome: f.nome.trim(),
                  telefone: f.telefone.trim(),
                  morada: f.morada.trim() || undefined,
                  freguesia: f.freguesia.trim() || undefined,
                  notas: f.notas.trim() || undefined,
                  consentimento_origem: "acao_social",
                },
              }),
            );
            if (r !== undefined) {
              setF(VAZIO);
              setConsentiu(false);
              setAberto(false);
              onMudou();
            }
          }}
        >
          {(
            [
              ["nome", "Nome"],
              ["telefone", "Telefone"],
              ["morada", "Morada"],
              ["freguesia", "Freguesia"],
              ["notas", "Notas (ex.: vive sozinha)"],
            ] as const
          ).map(([k, r]) => (
            <Campo key={k} rotulo={r}>
              <input
                className={classeEntrada}
                value={f[k]}
                list={k === "freguesia" ? "freguesias" : undefined}
                onChange={(e) => setF((a) => ({ ...a, [k]: e.target.value }))}
              />
            </Campo>
          ))}
          <datalist id="freguesias">
            {(dados?.freguesias ?? []).map((x) => (
              <option key={x.nome} value={x.nome} />
            ))}
          </datalist>
          <label className="flex items-start gap-2 text-sm text-tinta">
            <input
              type="checkbox"
              className="mt-1"
              checked={consentiu}
              onChange={(e) => setConsentiu(e.target.checked)}
            />
            A pessoa autorizou a câmara a ligar-lhe em situações de risco (calor, frio, cortes de água).
          </label>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao
              type="submit"
              icone={Plus}
              disabled={!consentiu || !f.nome.trim() || !f.telefone.trim() || acao.aCorrer}
            >
              Inscrever
            </Botao>
          </div>
        </form>
      </Dialogo>
    </div>
  );
}
