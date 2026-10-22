"use client";

import {
  ArrowLeft,
  Check,
  CircleAlert,
  MessageSquareText,
  Phone,
  PhoneMissed,
  Radio,
  Smile,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Cartao,
  classeEntrada,
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
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { contactadas, NECESSIDADES, TIPOS, type Campanha, type Destinatario } from "./tipos";

/*
 * Uma campanha a correr: quantas pessoas já foram contactadas e, por esta
 * ordem, quem precisa de ajuda, quem não atendeu e quem está bem. Atualiza
 * sozinha enquanto há chamadas por fazer.
 */

const INTERVALO_MS = 4000;

export function DetalheCampanha() {
  const { id } = useParams<{ id: string }>();
  const { pode } = useSessao();
  const c = useDados<Campanha>(pode("acao_social") ? `/v1/painel/campanhas/${id}` : null);
  const cancelar = useAcao();
  const { pedido } = useSessao();

  const aLigar = c.dados?.estado === "a_ligar";
  const { recarregar } = c;
  useEffect(() => {
    if (!aLigar) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") recarregar();
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [aLigar, recarregar]);

  if (!pode("acao_social")) return <div className="py-10"><SemAcesso /></div>;
  if (!c.dados) {
    return (
      <div className="p-10">
        <Estado aCarregar={c.aCarregar} erro={c.erro} />
      </div>
    );
  }

  const d = c.dados;
  const t = TIPOS[d.tipo];
  const Icone = t.icone;
  const feitas = contactadas(d.contagens);
  const pct = d.total ? Math.round((feitas / d.total) * 100) : 0;
  const grupos = {
    ajuda: d.destinatarios.filter((x) => x.estado === "precisa_ajuda"),
    falta: d.destinatarios.filter((x) =>
      ["nao_atendeu", "sem_ligacao", "atendeu", "recusou"].includes(x.estado),
    ),
    bem: d.destinatarios.filter((x) => x.estado === "bem"),
    porLigar: d.destinatarios.filter((x) => ["a_ligar", "por_ligar"].includes(x.estado)),
  };

  return (
    <div className="flex flex-col gap-6 px-4 sm:px-10 pt-8 pb-12">
      <Link
        href="/painel/campanhas"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-tinta-2 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden /> Ação social
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex size-14 items-center justify-center rounded-[16px] bg-terracota text-white">
            <Icone className="size-7" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[32px] leading-tight font-bold text-tinta">{d.titulo}</h1>
              {aLigar ? (
                <Pilula tom="ambar" icone={Radio}>
                  a ligar
                </Pilula>
              ) : d.estado === "cancelada" ? (
                <Pilula tom="neutro">cancelada</Pilula>
              ) : (
                <Pilula tom="verde">terminada</Pilula>
              )}
            </div>
            <p className="text-sm text-tinta-2">
              Lançada {quando(d.criada_em)}
              {d.criada_por_nome ? ` por ${d.criada_por_nome}` : ""}
              {d.freguesias?.length ? ` · ${d.freguesias.join(", ")}` : " · todas as freguesias"}
              {d.ignorar_horario ? " · emergência (a qualquer hora)" : ""}
            </p>
          </div>
        </div>
        {aLigar && (
          <Botao
            variante="secundario"
            icone={XCircle}
            disabled={cancelar.aCorrer}
            onClick={async () => {
              if (!window.confirm("Cancelar as chamadas que ainda não foram feitas?")) return;
              const r = await cancelar.executar(() =>
                pedido(`/v1/painel/campanhas/${d.id}/cancelar`, { metodo: "POST" }),
              );
              if (r !== undefined) recarregar();
            }}
          >
            Cancelar campanha
          </Botao>
        )}
      </header>
      <ErroLinha erro={cancelar.erro} />

      <Cartao className="flex flex-col gap-4 p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Rotulo>Contactadas</Rotulo>
            <p className="font-display text-[44px] leading-none font-bold text-tinta">
              {numero(feitas)} <span className="text-2xl text-tinta-3">de {numero(d.total)}</span>
            </p>
          </div>
          <span className="font-display text-3xl font-bold text-terracota">{pct}%</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-creme-2" aria-hidden>
          <Barra n={d.contagens.precisa_ajuda} total={d.total} cor="bg-terracota" />
          <Barra n={d.contagens.nao_atendeu + d.contagens.sem_ligacao + d.contagens.atendeu + d.contagens.recusou} total={d.total} cor="bg-ambar" />
          <Barra n={d.contagens.bem} total={d.total} cor="bg-verde" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Contador icone={CircleAlert} rotulo="Precisam de ajuda" n={d.contagens.precisa_ajuda} tom="text-terracota" />
          <Contador
            icone={PhoneMissed}
            rotulo="Não atenderam (SMS enviado)"
            n={d.contagens.nao_atendeu + d.contagens.sem_ligacao + d.contagens.recusou}
            tom="text-ambar"
          />
          <Contador icone={Smile} rotulo="Estão bem" n={d.contagens.bem} tom="text-verde" />
          <Contador icone={Phone} rotulo="Ainda por ligar" n={d.contagens.a_ligar + d.contagens.por_ligar} tom="text-tinta-2" />
        </div>
      </Cartao>

      <Seccao
        titulo="Precisam de ajuda"
        vazio="Ninguém pediu ajuda até agora."
        pessoas={grupos.ajuda}
        onMudou={recarregar}
        destaque
      />
      <Seccao
        titulo="Não atenderam ou não foi possível ligar"
        vazio="Todos atenderam."
        pessoas={grupos.falta}
        onMudou={recarregar}
      />
      {grupos.porLigar.length > 0 && (
        <Seccao titulo="Ainda por ligar" vazio="" pessoas={grupos.porLigar} onMudou={recarregar} simples />
      )}
      <Seccao titulo="Estão bem" vazio="Ainda ninguém respondeu." pessoas={grupos.bem} onMudou={recarregar} simples />

      <Cartao className="flex flex-col gap-3 p-6">
        <Rotulo>O que o agente diz</Rotulo>
        <p className="text-sm text-tinta">{d.mensagem}</p>
        <ol className="list-decimal pl-5 text-sm text-tinta-2">
          {d.perguntas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        <Rotulo className="pt-2">SMS a quem não atender</Rotulo>
        <p className="text-sm text-tinta-2">{d.sms_recurso}</p>
      </Cartao>
    </div>
  );
}

function Barra({ n, total, cor }: { n: number; total: number; cor: string }) {
  if (!n || !total) return null;
  return <div className={`${cor} transition-all duration-700`} style={{ width: `${(n / total) * 100}%` }} />;
}

function Contador({
  icone: Icone,
  rotulo,
  n,
  tom,
}: {
  icone: LucideIcon;
  rotulo: string;
  n: number;
  tom: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icone className={`size-5 ${tom}`} aria-hidden />
      <div>
        <p className="font-display text-2xl leading-none font-bold text-tinta">{numero(n)}</p>
        <p className="text-xs text-tinta-3">{rotulo}</p>
      </div>
    </div>
  );
}

const ESTADO_TEXTO: Record<string, string> = {
  nao_atendeu: "Não atendeu (2 tentativas) · SMS enviado",
  sem_ligacao: "Não foi possível ligar · SMS enviado",
  atendeu: "Atendeu, mas não ficou registada a resposta",
  recusou: "Não aceita chamadas · SMS enviado",
  a_ligar: "A ligar",
  por_ligar: "Por ligar",
  bem: "Está bem",
  precisa_ajuda: "Precisa de ajuda",
};

function Seccao({
  titulo,
  vazio,
  pessoas,
  onMudou,
  destaque = false,
  simples = false,
}: {
  titulo: string;
  vazio: string;
  pessoas: Destinatario[];
  onMudou: () => void;
  destaque?: boolean;
  simples?: boolean;
}) {
  return (
    <Cartao className={destaque && pessoas.length ? "border-terracota" : ""}>
      <div className="flex items-center justify-between border-b border-linha px-5 py-4">
        <h2 className="font-display text-lg font-bold text-tinta">{titulo}</h2>
        <Pilula tom={destaque && pessoas.length ? "terracota" : "neutro"}>{numero(pessoas.length)}</Pilula>
      </div>
      {pessoas.length === 0 ? (
        <p className="p-5 text-sm text-tinta-3">{vazio}</p>
      ) : (
        <ul className="divide-y divide-linha">
          {pessoas.map((p) => (
            <Pessoa key={p.id} p={p} onMudou={onMudou} simples={simples} />
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function Pessoa({ p, onMudou, simples }: { p: Destinatario; onMudou: () => void; simples: boolean }) {
  const { pedido } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState("");
  const acao = useAcao();
  const tratar = async (estado?: "bem" | "precisa_ajuda") => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/campanhas/destinatarios/${p.id}`, {
        metodo: "PATCH",
        corpo: { nota: nota.trim() || undefined, estado },
      }),
    );
    if (r !== undefined) {
      setAberto(false);
      setNota("");
      onMudou();
    }
  };

  if (simples) {
    return (
      <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
        <span className="font-semibold text-tinta">{p.nome}</span>
        <span className="text-tinta-3">{p.freguesia ?? ""}</span>
        <span className="text-tinta-3">{ESTADO_TEXTO[p.estado] ?? p.estado}</span>
        {p.respondido_em && <span className="text-xs text-tinta-3">{haQuanto(p.respondido_em)}</span>}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-tinta">{p.nome}</span>
            {p.tratado_em && (
              <Pilula tom="verde" icone={Check}>
                tratado {haQuanto(p.tratado_em)}
                {p.tratado_por_nome ? ` · ${p.tratado_por_nome}` : ""}
              </Pilula>
            )}
          </div>
          <span className="text-[13px] text-tinta-2">
            {[p.morada, p.freguesia].filter(Boolean).join(" · ") || "Sem morada"}
            {p.notas ? ` · ${p.notas}` : ""}
          </span>
          <span className="text-xs text-tinta-3">
            {ESTADO_TEXTO[p.estado] ?? p.estado}
            {p.respondido_em ? ` · ${haQuanto(p.respondido_em)}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {p.telefone && (
            <a
              href={`tel:${p.telefone}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border-[1.5px] border-tinta px-3 text-[13px] font-semibold text-tinta hover:bg-tinta/5"
            >
              <Phone className="size-3.5" aria-hidden /> {p.telefone}
            </a>
          )}
          {p.conversa_id && (
            <Link
              href={`/painel/conversas/${p.conversa_id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme-2"
            >
              <MessageSquareText className="size-3.5" aria-hidden /> conversa
            </Link>
          )}
          {!p.tratado_em && (
            <Botao tamanho="pequeno" onClick={() => setAberto((a) => !a)}>
              {p.estado === "precisa_ajuda" ? "Marcar como tratado" : "Falei com a pessoa"}
            </Botao>
          )}
        </div>
      </div>
      {(p.necessidades.length > 0 || p.nota) && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-terracota-suave/50 px-3 py-2">
          {p.necessidades.map((n) => (
            <Pilula key={n} tom="terracota">
              {NECESSIDADES[n] ?? n}
            </Pilula>
          ))}
          {p.nota && <span className="text-[13px] text-tinta">«{p.nota}»</span>}
        </div>
      )}
      {p.tratado_nota && <p className="text-[13px] text-tinta-2">Ação social: {p.tratado_nota}</p>}
      {aberto && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-linha p-3">
          <input
            className={classeEntrada}
            placeholder={p.estado === "precisa_ajuda" ? "O que foi feito (ex.: levámos água às 15h)" : "O que a pessoa disse"}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
          <ErroLinha erro={acao.erro} />
          <div className="flex flex-wrap justify-end gap-2">
            {p.estado === "precisa_ajuda" ? (
              <Botao tamanho="pequeno" icone={Check} disabled={acao.aCorrer} onClick={() => tratar()}>
                Tratado
              </Botao>
            ) : (
              <>
                <Botao tamanho="pequeno" variante="secundario" disabled={acao.aCorrer} onClick={() => tratar("precisa_ajuda")}>
                  Precisa de ajuda
                </Botao>
                <Botao tamanho="pequeno" icone={Smile} disabled={acao.aCorrer} onClick={() => tratar("bem")}>
                  Está bem
                </Botao>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
