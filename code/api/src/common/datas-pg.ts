import { types } from 'pg';

/*
 * O Postgres guarda microssegundos e o Date do JavaScript só milissegundos.
 * Para os cursores da paginação isso perde linhas: duas linhas no mesmo
 * milissegundo e a de baixo nunca aparece. Cada Date lido de um
 * `timestamptz` fica com o texto original do Postgres ao lado (WeakMap: não
 * muda o Date nem o JSON), e o cursor usa esse texto.
 */
const TIMESTAMPTZ = 1184;
const original = new WeakMap<Date, string>();
let instalado = false;

/** Chamado uma vez pelo DatabaseService, antes de qualquer query. */
export function instalarParserDatas(): void {
  if (instalado) return;
  instalado = true;
  const base = types.getTypeParser(TIMESTAMPTZ) as (s: string) => Date;
  types.setTypeParser(TIMESTAMPTZ, (texto: string) => {
    const d = base(texto);
    if (d instanceof Date) original.set(d, texto);
    return d;
  });
}

/** O texto exato do Postgres (com microssegundos), se este Date veio da BD. */
export function textoDoPg(d: Date): string | undefined {
  return original.get(d);
}
