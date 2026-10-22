"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  History,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { Aviso } from "@/components/painel/cabecalho";
import { FonteOficial } from "@/components/ui/marca";
import { useSessao } from "@/lib/sessao";
import { ConversasPainel } from "./conversas-painel";
import { UsoIaDaConversa } from "./custo-ia";
import { useDados, useFuso } from "./dados";
import {
  canal,
  diaCurto,
  duracao,
  euros,
  FASES,
  iniciais,
  mensagemErro,
  MOTIVOS_PASSAGEM,
  quando,
  tempoAudio,
} from "./formatos";
import { LeitorGravacao, MOMENTOS, type Leitor } from "./leitor-gravacao";
import type { Citacao, ConversaDetalhe as Dados, Turno } from "./tipos";
import {
  AvatarAgente,
  ErroBloco,
  Esqueleto,
  EstadoResultado,
  LinhaFicha,
  Pilula,
  Rotulo,
} from "./ui";

/** Painel · Conversa (frame cyzNb): lista à esquerda e a conversa aberta. */
export function ConversaPagina() {
  const { pode } = useSessao();
  const { id } = useParams<{ id: string }>();
  if (!pode("conversas")) {
    return (
      <div className="pt-8">
        <Aviso titulo="Sem acesso">O seu perfil não tem acesso às conversas.</Aviso>
      </div>
    );
  }
  return (
    <div className="flex xl:h-dvh">
      <ConversasPainel ativa={id} />
      <div className="min-w-0 flex-1 xl:overflow-y-auto">
        <ConversaDetalhe id={id} />
      </div>
    </div>
  );
}

function ConversaDetalhe({ id }: { id: string }) {
  const { pode } = useSessao();
  const fuso = useFuso();
  const c = useDados<Dados>(`/v1/painel/conversas/${id}`);
  const leitor = useRef<Leitor>(null);
  const d = c.dados;

  if (c.erro) {
    return (
      <div className="flex flex-col gap-4 px-8 pt-7">
        <VoltarLista />
        <ErroBloco
          mensagem={c.erro}
          tentar={c.codigo === "conversa_nao_encontrada" ? undefined : c.recarregar}
        />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="flex flex-col gap-6 px-8 pt-7" aria-busy>
        <Esqueleto className="h-20" />
        <Esqueleto className="h-24" />
        <Esqueleto className="h-96" />
      </div>
    );
  }

  const ca = canal(d.canal);
  const comAudio = d.tem_gravacao && pode("gravacoes");
  const consentimento =
    d.consentimento_em !== null
      ? new Date(d.consentimento_em).getTime() - new Date(d.iniciada_em).getTime()
      : null;
  const momentosPorTurno = new Map<string, string[]>();
  for (const m of d.momentos) {
    if (!m.turno_id) continue;
    momentosPorTurno.set(m.turno_id, [
      ...(momentosPorTurno.get(m.turno_id) ?? []),
      MOMENTOS[m.tipo] ?? m.tipo,
    ]);
  }
  const citacoesPorTurno = new Map<string, Citacao[]>();
  for (const ci of d.citacoes) {
    citacoesPorTurno.set(ci.turno_id, [...(citacoesPorTurno.get(ci.turno_id) ?? []), ci]);
  }
  const semFontePorTurno = new Map(
    (d.numeros_sem_fonte ?? []).map((n) => [n.turno_id, n.numeros.map((x) => x.texto)]),
  );
  const titulo = d.tema?.nome ?? `Conversa por ${ca.rotulo.toLowerCase()}`;
  const meta = [
    ca.rotulo,
    d.municipe?.telefone ?? d.municipe?.nome,
    quando(d.iniciada_em, fuso).replace(/^Hoje/, "hoje").replace(/^Ontem/, "ontem"),
    d.duracao_s ? duracao(d.duracao_s) : null,
  ].filter(Boolean);

  return (
    <article className="flex flex-col gap-6 px-8 pb-8 pt-7" aria-labelledby="conversa-titulo">
      <div className="xl:hidden">
        <VoltarLista />
      </div>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            id="conversa-titulo"
            className="font-display text-[28px] font-bold tracking-[-0.6px] text-tinta"
          >
            {titulo}
          </h1>
          <EstadoResultado valor={d.resultado} />
        </div>
        <p className="text-[13px] text-tinta-2">{meta.join(" · ")}</p>
        <div className="flex flex-wrap gap-1.5">
          {d.tema?.nome && (
            <span className="rounded-xl bg-terracota-suave px-2.5 py-1 text-xs font-semibold text-terracota-escuro">
              {d.tema.nome}
            </span>
          )}
          {d.fora_de_horas && (
            <span className="rounded-xl bg-creme-2 px-2.5 py-1 text-xs font-semibold text-tinta-2">
              Com o balcão fechado
            </span>
          )}
          {d.municipe && d.municipe.conversas_anteriores > 0 && (
            <span className="rounded-xl bg-creme-2 px-2.5 py-1 text-xs font-semibold text-tinta-2">
              {d.municipe.conversas_anteriores + 1}.ª conversa desta pessoa
            </span>
          )}
          {d.idioma && !d.idioma.startsWith("pt") && (
            <span className="rounded-xl bg-creme-2 px-2.5 py-1 text-xs font-semibold text-tinta-2">
              Idioma: {d.idioma}
            </span>
          )}
        </div>
      </header>

      {(comAudio || d.momentos.some((m) => m.em_ms !== null)) && (
        <LeitorGravacao
          ref={leitor}
          conversaId={d.id}
          duracaoS={d.duracao_s}
          turnos={d.turnos}
          momentos={d.momentos}
          comAudio={comAudio}
          semAudio={
            d.tem_gravacao
              ? "O seu perfil não pode ouvir gravações."
              : d.canal === "telefone"
                ? "Sem gravação (sem consentimento ou já apagada)."
                : undefined
          }
        />
      )}

      <div className="flex flex-col gap-6 min-[1360px]:flex-row">
        <section aria-labelledby="transcricao" className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="transcricao" className="text-[11px] font-bold uppercase tracking-[1px] text-tinta-3">
              {d.canal === "telefone" ? "Transcrição" : "Mensagens"}
            </h2>
            {d.canal === "telefone" &&
              (consentimento !== null ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-verde">
                  <ShieldCheck className="size-[13px]" aria-hidden />
                  Gravação aceite aos {tempoAudio(Math.max(0, consentimento))}
                </span>
              ) : (
                <span className="text-xs text-tinta-3">Sem consentimento para gravar</span>
              ))}
          </div>
          {d.turnos.length === 0 && (
            <p className="rounded-xl bg-creme-2 px-4 py-3 text-[13px] text-tinta-2">
              {d.resultado === "em_curso"
                ? "A conversa ainda está a decorrer."
                : "Sem transcrição (já apagada pela retenção de dados ou ainda por chegar)."}
            </p>
          )}
          {d.turnos.map((t) => (
            <Fala
              key={t.id}
              turno={t}
              momentos={momentosPorTurno.get(t.id) ?? []}
              citacoes={citacoesPorTurno.get(t.id) ?? []}
              semFonte={semFontePorTurno.get(t.id) ?? []}
              irPara={comAudio ? (ms) => leitor.current?.irPara(ms) : undefined}
            />
          ))}
        </section>

        <Lateral dados={d} onRevisto={(r) => c.definir((x) => x && { ...x, revisao: r })} />
      </div>
    </article>
  );
}

function VoltarLista() {
  return (
    <Link
      href="/painel/conversas"
      className="flex w-fit items-center gap-1.5 text-[13px] font-semibold text-tinta-2 hover:text-tinta"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Todas as conversas
    </Link>
  );
}

function Fala({
  turno,
  momentos,
  citacoes,
  semFonte,
  irPara,
}: {
  turno: Turno;
  momentos: string[];
  citacoes: Citacao[];
  semFonte: string[];
  irPara?: (ms: number) => void;
}) {
  if (turno.papel === "sistema") {
    return (
      <p className="px-12 text-center text-xs italic text-tinta-3">{turno.texto}</p>
    );
  }
  const agente = turno.papel === "agente";
  const nome = agente ? "Agente" : turno.papel === "funcionario" ? "Funcionário" : "Munícipe";
  const tempo =
    turno.inicio_ms !== null ? (
      irPara ? (
        <button
          type="button"
          onClick={() => irPara(turno.inicio_ms ?? 0)}
          className="text-xs text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
          aria-label={`Ouvir a partir de ${tempoAudio(turno.inicio_ms)}`}
        >
          {tempoAudio(turno.inicio_ms)}
        </button>
      ) : (
        <span className="text-xs text-tinta-3">{tempoAudio(turno.inicio_ms)}</span>
      )
    ) : null;

  return (
    <div className="flex gap-3">
      {agente ? (
        <AvatarAgente />
      ) : turno.papel === "funcionario" ? (
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-tinta text-[11px] font-bold text-white">
          {iniciais(nome)}
        </span>
      ) : (
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-creme-2">
          <UserRound className="size-[15px] text-tinta-2" aria-hidden />
        </span>
      )}
      <div
        className={`flex min-w-0 flex-1 flex-col gap-2.5 rounded-[4px_14px_14px_14px] border px-4 py-3 ${
          agente || turno.papel === "funcionario"
            ? "border-linha bg-papel"
            : "border-transparent"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-xs font-bold ${agente ? "text-terracota-escuro" : "text-tinta-2"}`}
          >
            {nome}
          </span>
          {tempo}
          {momentos.map((m) => (
            <span
              key={m}
              className="rounded-[10px] bg-tinta px-2 py-0.5 text-[10px] font-bold text-white"
            >
              {m}
            </span>
          ))}
        </div>
        <p
          className={`text-sm leading-normal whitespace-pre-line ${
            agente ? "text-tinta" : "text-tinta-2"
          }`}
        >
          {turno.texto}
        </p>
        {semFonte.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-lg bg-ambar-suave px-2.5 py-1.5 text-xs text-tinta">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-ambar" aria-hidden />
            <span>
              {semFonte.length === 1 ? "Número que não está na fonte citada: " : "Números que não estão na fonte citada: "}
              <b>{semFonte.join(", ")}</b>. Confirme antes de marcar a resposta como certa.
            </span>
          </p>
        )}
        {citacoes.map((ci) => (
          <FonteOficial
            key={ci.trecho_id}
            documento={[ci.fonte, ci.referencia].filter(Boolean).join(", ")}
            data={
              ci.lida_em
                ? `${ci.entidade} · verificada a ${diaCurto(ci.lida_em.slice(0, 10))}`
                : ci.entidade
            }
            url={ci.url}
          />
        ))}
      </div>
    </div>
  );
}

function Lateral({
  dados: d,
  onRevisto,
}: {
  dados: Dados;
  onRevisto: (r: Dados["revisao"]) => void;
}) {
  const fuso = useFuso();
  const fontes = [...new Set(d.citacoes.map((c) => [c.fonte, c.referencia].filter(Boolean).join(", ")))];
  const cr = d.criado;
  const encaminhado = cr.passagens.length
    ? cr.passagens.map((p) => MOTIVOS_PASSAGEM[p.motivo] ?? p.motivo).join("; ")
    : d.resultado === "resolvida"
      ? "Não, resolvida pelo agente"
      : "Não";

  return (
    <div className="flex w-full shrink-0 flex-col gap-4 min-[1360px]:w-[300px]">
      <section className="flex flex-col gap-2.5 rounded-[16px_16px_16px_4px] bg-terracota p-5 text-white">
        <h2 className="text-[11px] font-bold uppercase tracking-[1px] text-white/90">Resumo</h2>
        <p className="text-sm leading-normal">
          {d.resumo ?? (d.resumida_em ? "Sem resumo." : "O resumo ainda está a ser feito.")}
        </p>
        {d.proximos_passos.length > 0 && (
          <>
            <h3 className="pt-1 text-[11px] font-bold tracking-[1px] text-white/70">
              PRÓXIMOS PASSOS
            </h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-[1.45]">
              {d.proximos_passos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-linha bg-papel p-5">
        <h2 className="pb-2 text-[11px] font-bold tracking-[1px] text-tinta-3">
          FICHA DA CONVERSA
        </h2>
        <dl>
          <LinhaFicha campo="Tema">{d.tema?.nome ?? "—"}</LinhaFicha>
          <LinhaFicha campo="Encaminhado">
            {cr.passagens.length ? (
              <span className="flex flex-col gap-1">
                {cr.passagens.map((p) => (
                  <Link
                    key={p.id}
                    href={`/painel/passagens/${p.id}`}
                    className="text-terracota-escuro underline"
                  >
                    {MOTIVOS_PASSAGEM[p.motivo] ?? p.motivo}
                  </Link>
                ))}
              </span>
            ) : (
              encaminhado
            )}
          </LinhaFicha>
          {d.municipe && (
            <LinhaFicha campo="Munícipe">
              {[d.municipe.nome, d.municipe.telefone].filter(Boolean).join(" · ") || "Sem nome"}
            </LinhaFicha>
          )}
          {cr.requerimentos.map((r) => (
            <LinhaFicha key={r.id} campo="Requerimento">
              {r.tipo}{" "}
              <span className="text-tinta-3">
                ({r.estado.replace(/_/g, " ")}
                {r.campos_em_falta.length ? `, falta: ${r.campos_em_falta.join(", ")}` : ""})
              </span>
            </LinhaFicha>
          ))}
          {cr.processos.map((p) => (
            <LinhaFicha key={p.id} campo="Processo">
              <Link href={`/painel/processos/${p.id}`} className="text-terracota-escuro underline">
                {p.numero}
              </Link>{" "}
              · {p.assunto} <span className="text-tinta-3">({FASES[p.fase] ?? p.fase})</span>
            </LinhaFicha>
          ))}
          {cr.ocorrencias.map((o) => (
            <LinhaFicha key={o.id} campo="Ocorrência">
              <Link href={`/painel/ocorrencias/${o.id}`} className="text-terracota-escuro underline">
                {o.numero}
              </Link>{" "}
              · {o.categoria}, {o.morada}
            </LinhaFicha>
          ))}
          {cr.marcacoes.map((m) => (
            <LinhaFicha key={m.id} campo="Marcação">
              {m.agenda}, {quando(m.inicio, fuso).replace(/^Hoje/, "hoje")}
              {m.levar?.length ? (
                <span className="text-tinta-3"> · levar: {m.levar.join(", ")}</span>
              ) : null}
            </LinhaFicha>
          ))}
          {cr.recolhas.map((r) => (
            <LinhaFicha key={r.id} campo="Recolha">
              Monos, {quando(r.janela_inicio, fuso, false).replace(/^Hoje/, "hoje")}
            </LinhaFicha>
          ))}
          {cr.pagamentos.map((p) => (
            <LinhaFicha key={p.id} campo="Pagamento">
              {euros(p.valor_cent)} <span className="text-tinta-3">({p.estado})</span>
              {p.modo_teste && (
                <Pilula tom="ambar" className="ml-1.5">
                  modo de teste
                </Pilula>
              )}
            </LinhaFicha>
          ))}
          <LinhaFicha campo="Fontes">
            {fontes.length ? fontes.join("; ") : <span className="text-tinta-3">Nenhuma citada</span>}
          </LinhaFicha>
        </dl>
      </section>

      <Revisao dados={d} onRevisto={onRevisto} />

      {d.resumo_sms && (
        <section className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5">
          <Rotulo>SMS ao munícipe</Rotulo>
          <p className="rounded-[14px_14px_14px_4px] bg-[#E9E9EB] px-3 py-2.5 text-xs leading-[1.45] text-[#111111]">
            {d.resumo_sms}
          </p>
        </section>
      )}

      {d.historico_municipe.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-5">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold tracking-[1px] text-tinta-3">
            <History className="size-3.5" aria-hidden />
            CONVERSAS ANTERIORES
          </h2>
          <ul className="flex flex-col">
            {d.historico_municipe.map((h) => (
              <li key={h.id} className="border-t border-linha first:border-t-0">
                <Link
                  href={`/painel/conversas/${h.id}`}
                  className="flex items-start gap-2 py-2.5 hover:text-terracota-escuro"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-xs text-tinta-3">
                      {quando(h.iniciada_em, fuso)} · {canal(h.canal).rotulo}
                      {h.continuada_por_esta && " · continuada nesta"}
                    </span>
                    <span className="line-clamp-2 text-[13px] text-tinta">
                      {h.resumo ?? h.tema?.nome ?? "Sem resumo"}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-tinta-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <UsoIaDaConversa conversaId={d.id} />
    </div>
  );
}

function Revisao({
  dados: d,
  onRevisto,
}: {
  dados: Dados;
  onRevisto: (r: Dados["revisao"]) => void;
}) {
  const { pedido } = useSessao();
  const fuso = useFuso();
  const [nota, setNota] = useState("");
  const [aEscrever, setAEscrever] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const valor = d.revisao.valor;

  async function rever(revisao: "certa" | "errada") {
    setAGuardar(true);
    setErro(null);
    try {
      const r = await pedido<Dados["revisao"] & { revisao: "certa" | "errada" }>(
        `/v1/painel/conversas/${d.id}/revisao`,
        { corpo: { revisao, nota: nota.trim() || undefined } },
      );
      onRevisto({ valor: r.revisao, nota: r.nota, por: r.por, em: r.em });
      setAEscrever(false);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAGuardar(false);
    }
  }

  const botao = "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[20px] border text-[13px] font-semibold disabled:opacity-60";
  return (
    <section
      aria-labelledby="rever-titulo"
      className="flex flex-col gap-3 rounded-2xl bg-creme-2 p-5"
    >
      <Rotulo>Rever a resposta</Rotulo>
      <h2 id="rever-titulo" className="font-display text-[17px] font-bold text-tinta">
        O agente respondeu bem?
      </h2>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => rever("certa")}
          disabled={aGuardar}
          aria-pressed={valor === "certa"}
          className={`${botao} ${
            valor === "certa"
              ? "border-verde bg-verde text-white"
              : "border-linha bg-papel text-verde hover:border-verde"
          }`}
        >
          <Check className="size-[15px]" aria-hidden />
          Certa
        </button>
        <button
          type="button"
          onClick={() => (valor === "errada" ? undefined : setAEscrever(true))}
          disabled={aGuardar}
          aria-pressed={valor === "errada"}
          aria-expanded={aEscrever}
          className={`${botao} ${
            valor === "errada"
              ? "border-terracota bg-terracota text-white"
              : "border-linha bg-papel text-terracota-escuro hover:border-terracota"
          }`}
        >
          <X className="size-[15px]" aria-hidden />
          Errada
        </button>
      </div>
      {aEscrever && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
            O que estava errado? (opcional)
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              maxLength={2000}
              className="rounded-[10px] border border-linha bg-papel p-2.5 text-[13px] font-normal text-tinta"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => rever("errada")}
              disabled={aGuardar}
              className="h-9 rounded-full bg-terracota px-4 text-[13px] font-semibold text-white hover:bg-terracota-escuro disabled:opacity-60"
            >
              {aGuardar ? "A guardar…" : "Marcar como errada"}
            </button>
            <button
              type="button"
              onClick={() => setAEscrever(false)}
              className="h-9 rounded-full px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-xs text-terracota-escuro">
          {erro}
        </p>
      )}
      {valor && d.revisao.em ? (
        <p className="text-xs leading-[1.45] text-tinta-2" role="status">
          Marcada como {valor} {d.revisao.por ? `por ${d.revisao.por.nome}` : ""},{" "}
          {quando(d.revisao.em, fuso).toLowerCase()}.
          {d.revisao.nota && <> Nota: “{d.revisao.nota}”</>}
        </p>
      ) : (
        <p className="text-xs leading-[1.45] text-tinta-2">
          Se marcar como errada, a resposta é corrigida e entra no teste de qualidade.
        </p>
      )}
    </section>
  );
}
