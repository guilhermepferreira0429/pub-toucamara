"use client";

import { Lightbulb } from "lucide-react";
import Link from "next/link";
import { useSessao } from "@/lib/sessao";
import { CartaoNumero } from "./cartoes";
import { useDados } from "./dados";
import { decimal, diaCurto, iniciais, numero, pct } from "./formatos";
import type { Atrasado, Carga, OndeParam, Pagina, PrazoItem, Tempos, VisaoGeral } from "./tipos";
import { Cartao, ErroBloco, Esqueleto, Vazio } from "./ui";
import { textoPrazo } from "./visao-geral";

/** V2 · Indicadores (frame XijeY): processos, tempos, onde param e carga. */
export function IndicadoresProcessos({ visao }: { visao?: VisaoGeral }) {
  const { pode } = useSessao();
  const carga = useDados<Carga>("/v1/painel/gestao/carga");
  const tempos = useDados<Tempos>("/v1/painel/gestao/tempos");
  const onde = useDados<OndeParam>("/v1/painel/gestao/onde-param");
  const atrasados = useDados<Pagina<Atrasado>>(
    pode("visao_geral") ? null : "/v1/painel/gestao/atrasados?limite=6",
  );

  const c = carga.dados;
  const t = tempos.dados;
  const erros = [carga, tempos, onde].filter((x) => x.erro);

  return (
    <div className="flex flex-col gap-6">
      {erros.map((x, i) => (
        <ErroBloco key={i} mensagem={x.erro!} tentar={x.recarregar} />
      ))}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {c ? (
          <CartaoNumero
            valor={numero(c.totais.abertos)}
            rotulo="processos em curso"
            detalhe={`${numero(c.totais.aguarda_municipe)} à espera do munícipe`}
          />
        ) : (
          <Esqueleto className="h-[120px]" />
        )}
        {t ? (
          <CartaoNumero
            valor={
              t.total.media_dias_uteis === null
                ? "—"
                : `${decimal(t.total.media_dias_uteis, 0)} dias`
            }
            rotulo="tempo médio até à decisão"
            detalhe={
              t.total.decididos
                ? `dias úteis · mediana ${decimal(t.total.mediana_dias_uteis, 0)} · ${numero(t.total.decididos)} decididos em 90 dias`
                : "Ainda sem decisões nos últimos 90 dias"
            }
          />
        ) : (
          <Esqueleto className="h-[120px]" />
        )}
        {c ? (
          <CartaoNumero
            valor={numero(c.totais.atrasados)}
            rotulo="processos atrasados"
            detalhe={
              c.totais.a_terminar
                ? `${numero(c.totais.a_terminar)} terminam o prazo até ${diaCurto(c.a_terminar_ate, false)}`
                : "Nenhum prazo a terminar nos próximos dias"
            }
            corDetalhe={c.totais.a_terminar ? "text-terracota-escuro" : "text-verde"}
          />
        ) : (
          <Esqueleto className="h-[120px]" />
        )}
        {t ? (
          <CartaoNumero
            escuro
            valor={pct(t.total.dentro_do_prazo_pct)}
            rotulo="decididos dentro do prazo"
            detalhe={
              t.total.com_prazo
                ? `${numero(t.total.com_prazo)} decisões com prazo legal`
                : "Sem decisões com prazo nos últimos 90 dias"
            }
            corDetalhe="text-[#9FD3A8]"
          />
        ) : (
          <Esqueleto className="h-[120px]" />
        )}
      </div>

      <div className="flex flex-col gap-6 xl:flex-row">
        <Cartao
          id="onde-param"
          titulo="Onde os processos param"
          sub="Dias úteis, em média, que um processo passa em cada fase (decididos nos últimos 90 dias)"
          className="flex-1"
        >
          {!t && <Esqueleto className="h-48" />}
          {t && <Fases tempos={t} />}
          {onde.dados && (
            <p className="flex items-start gap-2 rounded-[10px] bg-terracota-suave px-3 py-2.5 text-xs font-medium text-terracota-escuro">
              <Lightbulb className="mt-px size-[15px] shrink-0" aria-hidden />
              {onde.dados.gargalo
                ? `O gargalo está na fase “${onde.dados.gargalo.rotulo}”: ${numero(onde.dados.gargalo.parados)} ${onde.dados.gargalo.parados === 1 ? "processo parado" : "processos parados"}, ${numero(onde.dados.gargalo.dias_parados)} dias úteis acumulados. ${numero(onde.dados.total_parados)} de ${numero(onde.dados.total_em_curso)} em curso estão parados.`
                : `Nenhum processo parado acima do normal (${numero(onde.dados.total_em_curso)} em curso).`}
            </p>
          )}
        </Cartao>

        <Cartao
          id="por-tipo"
          titulo="Tempo médio por tipo"
          sub="Até à decisão, em dias úteis"
          className="w-full shrink-0 xl:w-[380px]"
        >
          {!t && <Esqueleto className="h-48" />}
          {t && <PorTipo tempos={t} />}
        </Cartao>
      </div>

      <div className="flex flex-col gap-6 xl:flex-row">
        <Cartao id="carga" titulo="Carga por técnico" className="flex-1">
          {!c && <Esqueleto className="h-56" />}
          {c && <TabelaCarga carga={c} />}
        </Cartao>
        <Prazos
          itens={visao?.atencao.prazos_a_acabar.itens}
          atrasados={atrasados.dados?.itens}
          aCarregar={pode("visao_geral") ? !visao : atrasados.aCarregar}
        />
      </div>
    </div>
  );
}

function Fases({ tempos }: { tempos: Tempos }) {
  const fases = tempos.total.fases;
  const max = Math.max(0, ...fases.map((f) => f.media_dias_uteis ?? 0));
  if (!fases.some((f) => f.processos > 0)) {
    return <Vazio titulo="Ainda sem processos decididos com história de fases." />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {fases.map((f) => {
        const v = f.media_dias_uteis ?? 0;
        return (
          <li key={f.fase} className="flex items-center gap-3.5">
            <span className="w-[220px] shrink-0 text-[13px] font-medium text-tinta">{f.rotulo}</span>
            <span className="flex h-[22px] flex-1 items-center" aria-hidden>
              <span
                className={`h-[22px] rounded-md ${v === max && max > 0 ? "bg-terracota" : "bg-terracota-suave"}`}
                style={{ width: `${max ? Math.max(2, (v / max) * 100) : 0}%` }}
              />
            </span>
            <span className="w-[52px] shrink-0 text-[13px] font-bold text-tinta">
              {f.media_dias_uteis === null ? "—" : `${decimal(f.media_dias_uteis, 1)} d`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PorTipo({ tempos }: { tempos: Tempos }) {
  const tipos = tempos.tipos.filter((t) => t.decididos > 0);
  if (!tipos.length) return <Vazio titulo="Ainda sem decisões nos últimos 90 dias." />;
  return (
    <ul className="flex flex-col">
      {tipos.map((t, i) => {
        const dentro = t.media_dias_uteis !== null && t.media_dias_uteis <= t.prazo_legal_dias_uteis;
        return (
          <li
            key={t.tipo_id}
            className={`flex items-center gap-2.5 text-[13px] ${i ? "border-t border-linha pt-2.5" : ""} pb-2.5`}
          >
            <span className="flex-1 text-tinta">{t.nome}</span>
            <span className="font-bold text-tinta">
              {t.media_dias_uteis === null ? "—" : `${decimal(t.media_dias_uteis, 0)} d`}
            </span>
            <span
              className={`w-[76px] text-right text-xs font-semibold ${dentro ? "text-verde" : "text-terracota-escuro"}`}
              title="Prazo legal"
            >
              prazo {t.prazo_legal_dias_uteis} d
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TabelaCarga({ carga }: { carga: Carga }) {
  const tecnicos = carga.tecnicos.filter((t) => t.abertos || t.atrasados || t.passagens_em_curso);
  if (!tecnicos.length) return <Vazio titulo="Nenhum processo em curso." />;
  const max = Math.max(1, ...tecnicos.map((t) => t.abertos));
  const th = "pb-2 text-left text-[10px] font-bold tracking-[0.8px] text-tinta-3";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr className="border-b border-linha">
            <th scope="col" className={`${th} w-[190px]`}>
              TÉCNICO
            </th>
            <th scope="col" className={th}>
              PROCESSOS ABERTOS
            </th>
            <th scope="col" className={`${th} w-20`}>
              ATRASADOS
            </th>
            <th scope="col" className={`${th} w-[90px]`}>
              A TERMINAR
            </th>
          </tr>
        </thead>
        <tbody>
          {tecnicos.map((t) => (
            <tr key={t.tecnico_id ?? "sem"} className="h-11 border-b border-linha">
              <td>
                <span className="flex items-center gap-2">
                  <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-creme-2 text-[10px] font-bold text-tinta-2">
                    {iniciais(t.tecnico)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold text-tinta">{t.tecnico}</span>
                    {t.servico && <span className="truncate text-[11px] text-tinta-3">{t.servico}</span>}
                  </span>
                </span>
              </td>
              <td className="pr-4">
                <span className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 rounded-[5px] bg-tinta-3"
                    style={{ width: `${(t.abertos / max) * 70}%` }}
                    aria-hidden
                  />
                  <span className="text-[13px] font-semibold text-tinta">{numero(t.abertos)}</span>
                </span>
              </td>
              <td className={`text-[13px] font-bold ${t.atrasados ? "text-ambar" : "text-tinta-3"}`}>
                {numero(t.atrasados)}
              </td>
              <td className="text-[13px] text-tinta">{numero(t.a_terminar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Prazos({
  itens,
  atrasados,
  aCarregar,
}: {
  itens?: PrazoItem[];
  atrasados?: Atrasado[];
  aCarregar: boolean;
}) {
  const linhas =
    itens?.map((p) => ({
      id: p.id,
      titulo: `${p.numero} · ${p.assunto}`,
      tecnico: p.tecnico,
      prazo: textoPrazo(p.dias_uteis_restantes),
      atrasado: p.atrasado,
    })) ??
    atrasados?.map((a) => ({
      id: a.id,
      titulo: `${a.numero} · ${a.assunto}`,
      tecnico: a.tecnico,
      prazo: textoPrazo(-a.dias_atraso),
      atrasado: true,
    })) ??
    [];
  return (
    <Cartao
      id="prazos"
      titulo="Prazo a terminar"
      className="w-full shrink-0 xl:w-[440px]"
      acao={
        <Link
          href="/painel/processos"
          className="shrink-0 text-[13px] font-semibold text-terracota-escuro hover:underline"
        >
          Ver processos
        </Link>
      }
    >
      {aCarregar && <Esqueleto className="h-48" />}
      {!aCarregar && linhas.length === 0 && <Vazio titulo="Nenhum prazo a terminar." />}
      <ul className="flex flex-col">
        {linhas.slice(0, 6).map((l) => (
          <li key={l.id} className="flex items-center gap-3 border-t border-linha py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] font-semibold text-tinta">{l.titulo}</span>
              <span className="text-xs">
                <span className="text-tinta-2">{l.tecnico ?? "Sem técnico"}</span>{" "}
                <span className={`font-semibold ${l.atrasado ? "text-terracota-escuro" : "text-ambar"}`}>
                  · {l.prazo}
                </span>
              </span>
            </span>
            <Link
              href={`/painel/processos/${l.id}`}
              aria-label={`Reatribuir ${l.titulo}`}
              className="flex h-[30px] shrink-0 items-center rounded-[15px] border border-tinta px-3 text-xs font-semibold text-tinta hover:bg-tinta/5"
            >
              Reatribuir
            </Link>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
