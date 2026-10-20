"use client";

import {
  ArrowLeft,
  CalendarPlus,
  CalendarSync,
  Check,
  Info,
  ListChecks,
  MapPin,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api, ErroApi } from "@/lib/api";
import { Botao } from "@/components/ui/botao";
import { descarregarCalendario, hora, mesEDia } from "./formatar";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  Nota,
  Topo,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";

interface MarcacaoPublica {
  municipio: string;
  agenda: string;
  local: string | null;
  inicio: string;
  fim: string;
  quando: string;
  assunto: string | null;
  levar: string[];
  estado: "marcada" | "cancelada" | "realizada" | "faltou";
  pode_alterar: boolean;
}

interface Vaga {
  inicio: string;
  dito: string;
}

function comMaiuscula(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function hojeEmLisboa() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
}

/** O cartão da marcação (estilo do "15 SMS · Lembrete" e do cartão do 05). */
function CartaoMarcacao({ m }: { m: MarcacaoPublica }) {
  const { mes, dia } = mesEDia(m.inicio);
  const ativa = m.estado === "marcada";
  return (
    <section
      aria-label="A sua marcação"
      className="flex w-full flex-col gap-4 rounded-[20px] border border-linha bg-papel p-5"
    >
      <div className="flex w-full items-center gap-4">
        <div
          aria-hidden
          className={`flex w-[64px] shrink-0 flex-col overflow-hidden rounded-xl border border-linha ${ativa ? "" : "opacity-60"}`}
        >
          <span className="bg-terracota py-[3px] text-center text-[12px] font-bold tracking-[0.8px] text-white">
            {mes}
          </span>
          <span className="bg-white pt-1 pb-1.5 text-center font-display text-[26px] font-bold text-tinta">
            {dia}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[18px] font-bold text-tinta">{comMaiuscula(m.quando)}</p>
          <p className="text-[14px] text-tinta-2">
            das {hora(m.inicio)} às {hora(m.fim)}
          </p>
        </div>
      </div>
      {m.local && (
        <p className="flex items-start gap-2 text-[15px] leading-[1.4] text-tinta">
          <MapPin className="mt-0.5 size-[18px] shrink-0 text-terracota" aria-hidden />
          {m.local}
        </p>
      )}
      {m.assunto && (
        <p className="text-[15px] leading-[1.45] text-tinta-2">
          <span className="font-semibold text-tinta">Assunto: </span>
          {m.assunto}
        </p>
      )}
      {m.levar.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-linha pt-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta">
            <ListChecks className="size-[18px] text-terracota" aria-hidden />
            Leve consigo
          </p>
          <ul className="flex flex-col gap-1 pl-[26px]">
            {m.levar.map((l) => (
              <li key={l} className="list-disc text-[15px] leading-[1.45] text-tinta-2 marker:text-terracota">
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Remarcar({
  token,
  atual,
  onFeito,
  onVoltar,
}: {
  token: string;
  atual: MarcacaoPublica;
  onFeito: (m: MarcacaoPublica) => void;
  onVoltar: () => void;
}) {
  const base = `/v1/public/marcacoes/${encodeURIComponent(token)}`;
  const [dia, setDia] = useState("");
  const [vagas, setVagas] = useState<Vaga[] | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const idDia = useId();
  const grupo = useId();

  useEffect(() => {
    let ativo = true;
    api<{ vagas: Vaga[] }>(`${base}/vagas${dia ? `?dia=${dia}` : ""}`)
      .then((r) => {
        if (!ativo) return;
        setVagas(r.vagas.filter((v) => v.inicio !== atual.inicio));
        setEscolhida(null);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(mensagemDe(e));
      });
    return () => {
      ativo = false;
    };
  }, [base, dia, atual.inicio]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  async function confirmar() {
    if (!escolhida) return;
    setOcupado(true);
    setErro(null);
    try {
      onFeito(
        await api<MarcacaoPublica>(`${base}/remarcar`, { corpo: { inicio: escolhida } }),
      );
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === "vaga_ocupada") {
        const alt = (e.detalhes as { vagas_alternativas?: Vaga[] } | undefined)
          ?.vagas_alternativas;
        setErro("Essa hora acabou de ser ocupada por outra pessoa. Escolha outra.");
        if (alt?.length) setVagas(alt);
        setEscolhida(null);
      } else {
        setErro(mensagemDe(e));
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <nav className="flex w-full items-center justify-between">
        <button
          type="button"
          onClick={onVoltar}
          className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-[16px] font-semibold text-tinta hover:bg-creme-2"
        >
          <ArrowLeft className="size-6" aria-hidden />
          Voltar
        </button>
        <span className="text-[14px] font-medium text-tinta-3">{atual.agenda}</span>
      </nav>
      <Cabecalho
        titulo="Escolha a nova hora"
        sub={`Agora está marcado para ${atual.quando}.`}
      />

      <fieldset className="flex w-full flex-col gap-2" aria-busy={vagas === null}>
        <legend className="pb-2 text-[16px] font-semibold text-tinta">
          {dia ? "Vagas nesse dia" : "Próximas vagas"}
        </legend>
        {vagas === null && !erro && (
          <p role="status" className="text-[15px] text-tinta-2">
            A procurar vagas…
          </p>
        )}
        {vagas?.length === 0 && (
          <p className="text-[15px] text-tinta-2">
            Não há vagas {dia ? "nesse dia" : "nos próximos dias"}. Escolha outro dia em baixo.
          </p>
        )}
        {vagas?.map((v) => (
          <label
            key={v.inicio}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border bg-papel px-4 py-3 ${escolhida === v.inicio ? "border-terracota" : "border-linha"}`}
          >
            <input
              type="radio"
              name={grupo}
              value={v.inicio}
              checked={escolhida === v.inicio}
              onChange={() => setEscolhida(v.inicio)}
              className="size-5 shrink-0 accent-terracota"
            />
            <span className="text-[17px] font-semibold text-tinta">{comMaiuscula(v.dito)}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={idDia} className="text-[15px] font-semibold text-tinta">
          Prefere outro dia?
        </label>
        <input
          id={idDia}
          type="date"
          min={hojeEmLisboa()}
          value={dia}
          onChange={(e) => {
            setDia(e.target.value);
            setVagas(null);
            setErro(null);
          }}
          className="h-12 w-full rounded-xl border border-linha bg-papel px-3 text-[17px] text-tinta focus:border-terracota focus:outline-none"
        />
      </div>

      {erro && (
        <Nota icone={Info} tom="terracota" papel="alert">
          {erro}
        </Nota>
      )}

      <Botao
        tamanho="grande"
        icone={Check}
        className="w-full"
        disabled={!escolhida || ocupado}
        onClick={() => void confirmar()}
      >
        {ocupado ? "A mudar…" : "Confirmar nova hora"}
      </Botao>
    </div>
  );
}

/** Marcação (link do SMS do lembrete, pelo token): ver, remarcar, cancelar. */
export function Marcacao({ token }: { token: string }) {
  const base = `/v1/public/marcacoes/${encodeURIComponent(token)}`;
  const { c, definir, tentarOutraVez } = usePublico<MarcacaoPublica>(base);
  const [vista, setVista] = useState<"ver" | "remarcar" | "cancelar">("ver");
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const m = c.dados;

  if (vista === "remarcar" && m.pode_alterar) {
    return (
      <Remarcar
        token={token}
        atual={m}
        onVoltar={() => setVista("ver")}
        onFeito={(nova) => {
          definir(nova);
          setFeito(`Mudámos a sua marcação para ${nova.quando}. Vai receber um SMS a confirmar.`);
          setVista("ver");
        }}
      />
    );
  }

  async function cancelar() {
    setOcupado(true);
    setErro(null);
    try {
      definir(await api<MarcacaoPublica>(`${base}/cancelar`, { metodo: "POST" }));
      setFeito("A marcação foi cancelada. A vaga fica livre para outra pessoa.");
      setVista("ver");
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setOcupado(false);
    }
  }

  const titulos: Record<MarcacaoPublica["estado"], string> = {
    marcada: "Está marcado.",
    cancelada: "Esta marcação foi cancelada.",
    realizada: "Esta marcação já foi feita.",
    faltou: "Esta marcação já passou.",
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={m.municipio} />
      <Cabecalho meta={`A sua marcação · ${m.agenda}`} titulo={titulos[m.estado]} />

      {feito && (
        <Nota icone={Check} tom="verde" papel="status">
          {feito}
        </Nota>
      )}

      <CartaoMarcacao m={m} />

      {m.estado === "marcada" && (
        <Botao
          variante="secundario"
          icone={CalendarPlus}
          className="h-12 w-full text-[16px]"
          onClick={() =>
            descarregarCalendario({
              titulo: `${m.agenda} · ${m.municipio}`,
              inicio: m.inicio,
              fim: m.fim,
              local: m.local,
              notas: m.levar.length ? `Levar: ${m.levar.join(", ")}` : null,
            })
          }
        >
          Pôr no calendário
        </Botao>
      )}

      {m.pode_alterar && vista === "ver" && (
        <section className="flex w-full flex-col gap-3" aria-label="Mudar a marcação">
          <p className="text-[16px] text-tinta-2">Não pode ir nesta hora?</p>
          <Botao
            tamanho="grande"
            icone={CalendarSync}
            className="w-full"
            onClick={() => {
              setFeito(null);
              setVista("remarcar");
            }}
          >
            Escolher outra hora
          </Botao>
          <Botao
            tamanho="grande"
            variante="discreto"
            icone={X}
            className="w-full"
            onClick={() => {
              setFeito(null);
              setVista("cancelar");
            }}
          >
            Cancelar a marcação
          </Botao>
        </section>
      )}

      {m.pode_alterar && vista === "cancelar" && (
        <section
          role="alertdialog"
          aria-labelledby="cancelar-t"
          aria-describedby="cancelar-d"
          className="flex w-full flex-col gap-3 rounded-[20px] border border-terracota/40 bg-terracota-suave/50 p-5"
        >
          <p id="cancelar-t" className="font-display text-[22px] font-bold text-tinta">
            Quer mesmo cancelar?
          </p>
          <p id="cancelar-d" className="text-[15px] leading-[1.45] text-tinta-2">
            A vaga de {m.quando} fica livre para outra pessoa. Se precisar, pode marcar de novo
            pelo telefone ou no chat.
          </p>
          {erro && (
            <Nota icone={Info} tom="terracota" papel="alert">
              {erro}
            </Nota>
          )}
          <Botao
            tamanho="grande"
            className="w-full"
            disabled={ocupado}
            onClick={() => void cancelar()}
          >
            {ocupado ? "A cancelar…" : "Sim, cancelar"}
          </Botao>
          <Botao
            tamanho="grande"
            variante="secundario"
            className="w-full"
            autoFocus
            onClick={() => setVista("ver")}
          >
            Não, manter a marcação
          </Botao>
        </section>
      )}

      {!m.pode_alterar && m.estado === "marcada" && (
        <p className="text-[14px] text-tinta-3">
          Já não dá para mudar por aqui. Se precisar, ligue-nos ou escreva no chat.
        </p>
      )}

      <MaisDuvidas nota={null} />
    </div>
  );
}
