/*
 * Escolas (V4 #3): as regras em código, sem BD, para testar à parte.
 *
 * Valores de demonstração até a câmara confirmar os do ano letivo:
 * - preço da refeição no pré-escolar e no 1.º ciclo e redução por escalão
 *   da ação social escolar (escalão A gratuito, B paga metade), como no
 *   Despacho n.º 8452-A/2015 e seguintes;
 * - distância mínima de casa à escola para o transporte escolar (3 km), como
 *   no Decreto-Lei n.º 299/84;
 * - limite para marcar/desmarcar uma refeição (até às 10h do dia anterior).
 */

export type Escalao = 'A' | 'B' | 'sem';
export type Ano = 'pre' | '1' | '2' | '3' | '4';

export const REGRAS_ESCOLAS = {
  demonstracao: true,
  preco_refeicao_cent: 146,
  /** Fração do preço que cada escalão paga. */
  fracao_escalao: { A: 0, B: 0.5, sem: 1 } as Record<Escalao, number>,
  distancia_minima_km: 3,
  hora_limite_alteracao: 10,
  fontes: [
    'Despacho n.º 8452-A/2015 (ação social escolar: escalões e preço das refeições)',
    'Decreto-Lei n.º 299/84 (transportes escolares)',
  ],
  nota: 'Valores de demonstração, a confirmar pela câmara para o ano letivo.',
} as const;

export const ROTULO_ESCALAO: Record<Escalao, string> = {
  A: 'escalão A',
  B: 'escalão B',
  sem: 'sem escalão',
};

export const ROTULO_ANO: Record<Ano, string> = {
  pre: 'pré-escolar',
  '1': '1.º ano',
  '2': '2.º ano',
  '3': '3.º ano',
  '4': '4.º ano',
};

/** O escalão da ação social escolar pelo escalão do abono de família. */
export function escalaoDoAbono(abono: number | null | undefined): Escalao {
  if (abono === 1) return 'A';
  if (abono === 2) return 'B';
  return 'sem';
}

export function precoRefeicao(escalao: Escalao): number {
  return Math.round(
    REGRAS_ESCOLAS.preco_refeicao_cent * REGRAS_ESCOLAS.fracao_escalao[escalao],
  );
}

function deIso(s: string): Date {
  return new Date(`${s}T12:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function somarDias(dia: string, n: number): string {
  const d = deIso(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Há aulas (e cantina) neste dia? Sem sábados, domingos nem feriados. */
export function diaDeAulas(
  dia: string,
  feriados: ReadonlySet<string>,
): boolean {
  const s = deIso(dia).getUTCDay();
  return s !== 0 && s !== 6 && !feriados.has(dia);
}

/** Os dias de aulas do mês 'AAAA-MM'. */
export function diasDeAulasDoMes(
  mes: string,
  feriados: ReadonlySet<string>,
): string[] {
  const dias: string[] = [];
  let d = `${mes}-01`;
  while (d.startsWith(mes)) {
    if (diaDeAulas(d, feriados)) dias.push(d);
    d = somarDias(d, 1);
  }
  return dias;
}

/** Dia e hora em Lisboa. */
export function agoraLisboa(agora = new Date()): { dia: string; hora: number } {
  const dia = agora.toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
  const hora = Number(
    agora.toLocaleString('en-GB', {
      timeZone: 'Europe/Lisbon',
      hour: '2-digit',
      hour12: false,
    }),
  );
  return { dia, hora: hora === 24 ? 0 : hora };
}

export type Alteracao =
  | { ok: true }
  | {
      ok: false;
      motivo: 'dia_passado' | 'sem_aulas' | 'fora_de_prazo';
      dizer: string;
    };

/** Pode marcar/desmarcar a refeição deste dia agora? */
export function podeAlterarRefeicao(
  dia: string,
  feriados: ReadonlySet<string>,
  agora = new Date(),
): Alteracao {
  const { dia: hoje, hora } = agoraLisboa(agora);
  if (dia <= hoje) {
    return {
      ok: false,
      motivo: 'dia_passado',
      dizer:
        'Esse dia já não se pode mudar: as refeições alteram-se até às 10 horas do dia anterior.',
    };
  }
  if (!diaDeAulas(dia, feriados)) {
    return {
      ok: false,
      motivo: 'sem_aulas',
      dizer: 'Nesse dia não há aulas nem cantina (fim de semana ou feriado).',
    };
  }
  if (
    dia === somarDias(hoje, 1) &&
    hora >= REGRAS_ESCOLAS.hora_limite_alteracao
  ) {
    return {
      ok: false,
      motivo: 'fora_de_prazo',
      dizer:
        'Para amanhã já passou da hora: as refeições alteram-se até às 10 horas do dia anterior. Fale diretamente com a escola.',
    };
  }
  return { ok: true };
}

/**
 * A conta de refeições de um mês: os dias de aulas desde a inscrição na
 * cantina, menos os desmarcados, mais os marcados à parte.
 */
export function contaDoMes(p: {
  mes: string;
  /** Inscrito na cantina desde (AAAA-MM-DD), ou null. */
  desde: string | null;
  escalao: Escalao;
  excecoes: ReadonlyMap<string, boolean>;
  feriados: ReadonlySet<string>;
}): {
  refeicoes: number;
  preco_cent: number;
  total_cent: number;
  dias: string[];
} {
  const dias = diasDeAulasDoMes(p.mes, p.feriados).filter((d) => {
    const exc = p.excecoes.get(d);
    if (exc !== undefined) return exc;
    return p.desde !== null && d >= p.desde;
  });
  const preco = precoRefeicao(p.escalao);
  return {
    refeicoes: dias.length,
    preco_cent: preco,
    total_cent: dias.length * preco,
    dias,
  };
}

export type PropostaTransporte = 'cumpre' | 'nao_cumpre' | 'por_medir';

/** O que as regras propõem para o transporte escolar, pela distância. */
export function avaliarTransporte(distanciaKm: number | null | undefined): {
  proposta: PropostaTransporte;
  porque: string;
} {
  const min = REGRAS_ESCOLAS.distancia_minima_km;
  if (distanciaKm === null || distanciaKm === undefined) {
    return {
      proposta: 'por_medir',
      porque: `A câmara vai medir a distância de casa à escola (o transporte é para quem mora a ${min} km ou mais).`,
    };
  }
  if (distanciaKm >= min) {
    return {
      proposta: 'cumpre',
      porque: `Mora a ${distanciaKm} km da escola, a partir de ${min} km tem direito a transporte.`,
    };
  }
  return {
    proposta: 'nao_cumpre',
    porque: `Mora a ${distanciaKm} km da escola; o transporte é para quem mora a ${min} km ou mais. Fica registado e a câmara confirma a distância.`,
  };
}

/** Texto sem acentos, minúsculas e espaços simples (para comparar nomes). */
export function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const VAZIAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'a',
  'o',
  'n',
  'no',
  'eb',
  'escola',
  'basica',
  'jardim',
  'infancia',
]);

/**
 * Escolhe pelo nome dito ("a escola de Azurém", "o Tomás"): igual, ou todas
 * as palavras com significado do que foi dito aparecem no nome.
 */
export function escolherPorNome<T extends { nome: string }>(
  lista: readonly T[],
  dito: string,
): { um: T } | { varios: T[] } | { nenhum: true } {
  const d = normalizar(dito);
  const iguais = lista.filter((x) => normalizar(x.nome) === d);
  if (iguais.length === 1) return { um: iguais[0] };
  const palavras = d.split(' ').filter((p) => p && !VAZIAS.has(p));
  const usar = palavras.length ? palavras : d.split(' ').filter(Boolean);
  const achados = lista.filter((x) => {
    const n = ` ${normalizar(x.nome)} `;
    return usar.every((p) => n.includes(` ${p} `) || n.includes(` ${p}`));
  });
  if (achados.length === 1) return { um: achados[0] };
  if (achados.length > 1) return { varios: achados };
  return { nenhum: true };
}

/** "1,46 €" */
export function eurosTexto(cent: number): string {
  return `${(cent / 100).toFixed(2).replace('.', ',')} €`;
}
