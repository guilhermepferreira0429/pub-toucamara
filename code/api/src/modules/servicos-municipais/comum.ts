/*
 * Peças comuns às áreas do catálogo de serviços que registam pedidos
 * (cemitérios, animais, água): quem pede (munícipe e telemóvel), o canal,
 * a resposta "precisa de identificação" e datas ditas.
 */
import type { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import {
  type MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';

export interface QuemPede {
  municipeId: string | null;
  telefone: string | null;
}

/** O canal guardado nos pedidos (o do contexto da ferramenta). */
export function canalDe(ctx: ContextoFerramenta): string {
  return ctx.canal;
}

/**
 * O munícipe e o telemóvel desta conversa. Sem munícipe e sem número
 * (chat anónimo, chamada sem número) → null: o pedido não tem para onde
 * mandar a resposta.
 */
export async function quemPede(
  db: DatabaseService | Tx,
  municipes: MunicipesService,
  ctx: ContextoFerramenta,
  tx?: Tx,
): Promise<QuemPede | null> {
  const tel = normalizarTelefone(ctx.telefone);
  if (ctx.municipeId) {
    if (tel) return { municipeId: ctx.municipeId, telefone: tel };
    const [m] = await db.query<{ t: string | null }>(
      'SELECT telefone_e164 AS t FROM municipes WHERE id = $1',
      [ctx.municipeId],
    );
    return { municipeId: ctx.municipeId, telefone: m?.t ?? null };
  }
  if (!tel) return null;
  const m = await municipes.porTelefone(ctx.municipio.id, tel, tx);
  return { municipeId: m?.id ?? null, telefone: tel };
}

/**
 * A categoria de ocorrência com este nome (cria-a se o município não a
 * tiver): os casos urgentes destas áreas (animal ferido na via, rotura de
 * água) entram nas ocorrências da câmara pelo OcorrenciasService.
 */
export async function garantirCategoria(
  db: DatabaseService,
  municipioId: string,
  nome: string,
  icone: string,
): Promise<string> {
  await db.query(
    `INSERT INTO categorias_ocorrencia (municipio_id, nome, icone)
     VALUES ($1, $2, $3) ON CONFLICT (municipio_id, nome) DO NOTHING`,
    [municipioId, nome, icone],
  );
  return nome;
}

/** O resultado quando falta saber quem é a pessoa (regras gerais). */
export function precisaIdentificacao(ctx: ContextoFerramenta, para: string) {
  return {
    feito: false,
    precisa_identificacao: true,
    instrucao:
      ctx.canal === 'chat'
        ? `Para ${para} a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.`
        : `Para ${para} preciso de um contacto: pede o número de telemóvel ou o NIF e usa identificar_municipe; depois chama outra vez.`,
  };
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const DIAS_SEMANA = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/** "12 de março de 2031" a partir de AAAA-MM-DD (ou Date). */
export function dataDita(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const s = typeof d === 'string' ? d.slice(0, 10) : dataIso(d);
  const [a, m, dia] = s.split('-').map(Number);
  if (!a || !m || !dia) return null;
  return `${dia} de ${MESES[m - 1]} de ${a}`;
}

/** "sexta-feira, 14 de novembro" (sem ano: é para os próximos dias). */
export function diaDito(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const sem = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS_SEMANA[sem]}, ${d} de ${MESES[m - 1]}`;
}

/** AAAA-MM-DD de um Date (UTC; as datas da BD chegam à meia-noite local). */
export function dataIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Dias de calendário de `de` a `ate` (AAAA-MM-DD). */
export function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** AAAA-MM-DD somando `n` dias. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "12,50 €" a partir de cêntimos. */
export function eurosDitos(cent: number): string {
  const e = cent / 100;
  return `${e.toLocaleString('pt-PT', {
    minimumFractionDigits: Number.isInteger(e) ? 0 : 2,
    maximumFractionDigits: 2,
  })} €`;
}

/** Numeração "CM-2026-0007". */
export function formatarNumero(prefixo: string, ano: number, n: number) {
  return `${prefixo}-${ano}-${String(n).padStart(4, '0')}`;
}
