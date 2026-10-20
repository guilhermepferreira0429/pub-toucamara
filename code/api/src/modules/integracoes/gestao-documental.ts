import { z } from 'zod';

/*
 * A integração com o sistema de gestão documental que a câmara já usa
 * (MyDoc, SmartDocs, WebDoc, ...). "Numa câmara com sistemas próprios
 * ligamo-nos aos dela": o processo continua a viver aqui, e cada processo,
 * documento e mudança de fase é registado também no sistema da câmara, com
 * o número que ele der.
 *
 * Um adaptador por sistema, todos com esta forma. O job
 * `sync_gestao_documental` só fala com a interface.
 */

/** O processo como vai para o sistema da câmara (registo de entrada). */
export interface ProcessoGd {
  id: string;
  numero: string;
  tipo_codigo: string;
  tipo_nome: string;
  assunto: string;
  morada: string | null;
  freguesia: string | null;
  fase: string;
  /** Nome do requerente (nunca o NIF: o sistema da câmara já o tem no requerimento). */
  requerente: string | null;
  criado_em: string;
}

export interface DocumentoGd {
  id: string;
  /** 'Certidão do registo predial'; null = documento sem tipo. */
  nome: string | null;
  ficheiro_key: string;
  mime: string;
  tamanho: number | null;
  origem: string;
  recebido_em: string;
}

export interface GestaoDocumental {
  /** Regista a entrada do processo; devolve o número no sistema da câmara. */
  registarProcesso(p: ProcessoGd): Promise<{ gd_id: string }>;
  /** Junta um documento ao registo; devolve a referência do anexo, se houver. */
  anexarDocumento(
    gdId: string,
    doc: DocumentoGd,
  ): Promise<{ referencia: string | null }>;
  /** A fase do processo mudou. */
  atualizarEstado(gdId: string, fase: string): Promise<void>;
}

/** O sistema da câmara falhou (rede, recusa, falha simulada). Reintenta-se. */
export class ErroGestaoDocumental extends Error {}

export const ADAPTADORES = ['nenhum', 'simulado'] as const;
export type Adaptador = (typeof ADAPTADORES)[number];

export interface ConfigGestaoDocumental {
  adaptador: Adaptador;
  /** Só no simulado: fração dos envios que falham (0 a 1). */
  taxa_falha: number;
}

export const esquemaConfigGd = z
  .object({
    adaptador: z.enum(ADAPTADORES),
    taxa_falha: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Tentativas antes de desistir (depois, só com "sincronizar já"). */
export const MAX_TENTATIVAS = 5;

/** O job corre a cada 15 minutos: a espera dobra a partir daí. */
const ESPERA_BASE_MS = 15 * 60_000;

/**
 * Espera até à próxima tentativa depois de `tentativas` falhas seguidas:
 * 15, 30, 60, 120 min; à quinta falha desiste (null).
 */
export function esperaAposFalha(tentativas: number): number | null {
  if (tentativas >= MAX_TENTATIVAS) return null;
  return ESPERA_BASE_MS * 2 ** Math.max(0, tentativas - 1);
}

/** '2026/E/012345': ano, livro de entrada e número de 6 dígitos. */
export function numeroGd(ano: number, n: number): string {
  return `${ano}/E/${String(n).padStart(6, '0')}`;
}

/** Erros vindos do sistema da câmara cabem numa linha do painel. */
export function mensagemErro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Erro desconhecido.';
}
