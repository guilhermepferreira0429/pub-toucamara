import type { DiaSemana, HorarioBalcao } from "@/lib/sessao";
import { numero, variacaoPct } from "./formatos";
import type { TemaTop } from "./tipos";

/*
 * Gráficos simples (sem bibliotecas): barras por hora, mapa de calor 7 × 24
 * e a lista de temas com barra. Cada um tem também o texto para leitores de
 * ecrã (tabela escondida ou rótulos).
 */

/**
 * Horário do balcão por omissão (o mesmo da API sem horário configurado):
 * dias úteis, das 9h às 17h. O real vem em `eu.municipio.horario_balcao`.
 */
export const HORARIO_BALCAO = { inicio: 9, fim: 17 };

/** Segunda primeiro (0 = segunda, como o mapa de calor). */
const DIAS_BALCAO: DiaSemana[] = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Se o balcão está aberto no início desta hora. Sem `diaSemana`: aberto em
 * algum dia útil. Sem horário (ainda a carregar), dias úteis das 9h às 17h.
 */
export function balcaoAberto(
  hora: number,
  diaSemana?: number,
  horario?: HorarioBalcao | null,
) {
  if (!horario) {
    const util = diaSemana === undefined || diaSemana < 5;
    return util && hora >= HORARIO_BALCAO.inicio && hora < HORARIO_BALCAO.fim;
  }
  if (horario.sempre) return true;
  const dias = diaSemana === undefined ? DIAS_BALCAO.slice(0, 5) : [DIAS_BALCAO[diaSemana]];
  const m = hora * 60;
  return dias.some((d) =>
    (horario.dias[d] ?? []).some(([i, f]) => m >= minutos(i) && m < minutos(f)),
  );
}

const ROTULO_DIA: Record<DiaSemana, string> = {
  seg: "segunda",
  ter: "terça",
  qua: "quarta",
  qui: "quinta",
  sex: "sexta",
  sab: "sábado",
  dom: "domingo",
};

/** "segunda: 09:00–17:00; …" para leitores de ecrã. */
export function textoHorarioBalcao(horario?: HorarioBalcao | null): string {
  if (!horario) {
    return `dias úteis das ${HORARIO_BALCAO.inicio}h às ${HORARIO_BALCAO.fim}h`;
  }
  if (horario.sempre) return "sempre aberto";
  const partes = DIAS_BALCAO.filter((d) => (horario.dias[d] ?? []).length).map(
    (d) => `${ROTULO_DIA[d]}: ${horario.dias[d].map(([i, f]) => `${i}–${f}`).join(", ")}`,
  );
  return partes.length ? partes.join("; ") : "fechado";
}

/** Totais por hora (somando os 7 dias do mapa de calor). */
export function porHora(celulas: number[][]): number[] {
  return Array.from({ length: 24 }, (_, h) =>
    celulas.reduce((s, dia) => s + (dia[h] ?? 0), 0),
  );
}

export function horaDePico(horas: number[]): number | null {
  let max = 0;
  let h: number | null = null;
  horas.forEach((v, i) => {
    if (v > max) {
      max = v;
      h = i;
    }
  });
  return h;
}

/** "Quando ligam e escrevem": 24 barras, terracota com o balcão fechado. */
export function BarrasPorHora({
  horas,
  horario,
}: {
  horas: number[];
  horario?: HorarioBalcao | null;
}) {
  const max = Math.max(1, ...horas);
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex h-[220px] gap-1.5" aria-hidden>
        {horas.map((v, h) => (
          <div key={h} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 flex-col justify-end">
              <div
                className={`w-full rounded-t ${
                  balcaoAberto(h, undefined, horario) ? "bg-tinta-3" : "bg-terracota"
                }`}
                style={{ height: `${v ? Math.max(2, (v / max) * 100) : 0}%` }}
                title={`${String(h).padStart(2, "0")}h: ${numero(v)}`}
              />
            </div>
            <span className="h-3.5 text-[11px] leading-none text-tinta-3">
              {h % 3 === 0 ? `${String(h).padStart(2, "0")}h` : ""}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>Conversas por hora do dia</caption>
          <tbody>
            {horas.map((v, h) => (
              <tr key={h}>
                <th scope="row">{h}h</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

const NIVEIS = [
  "bg-creme-2",
  "bg-[#F2D8CB]",
  "bg-[#E0A487]",
  "bg-[#C4532B]",
  "bg-[#8E3517]",
] as const;

function nivel(v: number, max: number) {
  if (!v || !max) return 0;
  return Math.min(4, Math.max(1, Math.ceil((v / max) * 4)));
}

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** "Quando procuram a câmara": 7 × 24, com o horário do balcão tracejado. */
export function MapaCalor({
  celulas,
  maximo,
}: {
  celulas: number[][];
  maximo: number;
}) {
  return (
    // tabIndex: com scroll lateral, tem de dar para o percorrer com o teclado.
    <figure className="flex flex-col gap-4 overflow-x-auto" tabIndex={0} aria-label="Mapa de calor das chamadas por dia e hora">
      <div className="relative w-fit" aria-hidden>
        <div className="flex flex-col gap-[3px]">
          {DIAS.map((d, i) => (
            <div key={d} className="flex items-center gap-[3px]">
              <span className="w-[30px] text-[11px] text-tinta-3">{d}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const v = celulas[i]?.[h] ?? 0;
                return (
                  <span
                    key={h}
                    title={`${d}, ${h}h: ${numero(v)}`}
                    className={`size-[22px] rounded ${NIVEIS[nivel(v, maximo)]}`}
                  />
                );
              })}
            </div>
          ))}
          <div className="flex gap-[3px]">
            <span className="w-[30px]" />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="w-[22px] text-[10px] text-tinta-3">
                {h % 6 === 0 ? `${h}h` : ""}
              </span>
            ))}
          </div>
        </div>
        {/* Seg–Sex, 9h–17h: 33 px de rótulo + 25 px por célula. */}
        <span className="pointer-events-none absolute left-[256px] top-[-2px] h-[126px] w-[201px] rounded-md border-[1.5px] border-dashed border-tinta" />
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-tinta-3" aria-hidden>
        Menos
        {NIVEIS.map((c) => (
          <span key={c} className={`size-3.5 rounded-[3px] ${c}`} />
        ))}
        Mais
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>Conversas por dia da semana e hora</caption>
          <thead>
            <tr>
              <th>Dia</th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h}>{h}h</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DIAS.map((d, i) => (
              <tr key={d}>
                <th scope="row">{d}</th>
                {Array.from({ length: 24 }, (_, h) => (
                  <td key={h}>{celulas[i]?.[h] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

/** Lista de temas com barra, número e variação (Visão geral e Indicadores). */
export function ListaTemas({
  temas,
  tamanho = "14",
}: {
  temas: TemaTop[];
  tamanho?: "13" | "14";
}) {
  const max = Math.max(1, ...temas.map((t) => t.total));
  const letra = tamanho === "14" ? "text-sm" : "text-[13px]";
  return (
    <ul className="flex flex-col gap-3.5">
      {temas.map((t, i) => {
        const v = t.novo ? "novo" : variacaoPct(t.variacao);
        const sobe = t.novo || (t.variacao ?? 0) > 0;
        return (
          <li key={t.tema_id} className="flex items-center gap-3.5">
            <span className={`w-[170px] shrink-0 truncate font-medium text-tinta ${letra}`}>
              {t.tema}
            </span>
            <span className="h-2.5 flex-1 rounded-[5px] bg-creme" aria-hidden>
              <span
                className={`block h-2.5 rounded-[5px] ${
                  i === 0 ? "bg-terracota" : "bg-terracota-suave"
                }`}
                style={{ width: `${(t.total / max) * 100}%` }}
              />
            </span>
            <span className={`w-10 shrink-0 font-bold text-tinta ${letra}`}>
              {numero(t.total)}
            </span>
            <span
              className={`w-11 shrink-0 text-xs font-semibold ${
                sobe ? "text-verde" : "text-tinta-3"
              }`}
            >
              {v ?? ""}
              {v && (
                <span className="sr-only"> face ao período anterior</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
