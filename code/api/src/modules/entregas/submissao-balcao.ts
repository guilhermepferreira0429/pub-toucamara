import { HttpStatus } from '@nestjs/common';
import { proximoNumero } from '../../common/numeracao.js';
import { ErroApi } from '../../common/erros.js';
import type { Tx } from '../../database/database.service.js';
import { mascararNif, numeroEntradaDemo } from './regras.js';
import type { IdentidadeCidadao, ResumoPedido } from './regras.js';

/*
 * Submeter o pedido no balcão online em nome do munícipe. Um adaptador por
 * destino (como a gestão documental):
 *
 *  - `simulada` (por omissão): numera a entrada numa série própria com o
 *    prefixo DEMO e devolve o comprovativo, sem sair daqui.
 *  - `balcao`: o balcão online da câmara (ou o ePortugal). Esqueleto, por
 *    configurar: falta o acesso de submissão.
 */

export const MODOS_SUBMISSAO = ['simulada', 'balcao'] as const;
export type ModoSubmissao = (typeof MODOS_SUBMISSAO)[number];

export interface PedidoBalcao {
  /** O id da entrega: serve de chave de idempotência no destino. */
  referencia: string;
  municipioId: string;
  tipo: { codigo: string; nome: string };
  resumo: ResumoPedido;
  /** O nosso processo, quando já existe. */
  processoNumero: string | null;
}

export interface Comprovativo {
  numero_entrada: string;
  /** ISO 8601. */
  recebido_em: string;
  documentos: string[];
  /** Quem submeteu, em nome de quem (sem NIF em claro). */
  requerente: { nome: string | null; nif_mascarado: string | null };
  destino: string;
  simulado: boolean;
}

export interface SubmissaoBalcao {
  readonly modo: ModoSubmissao;
  readonly simulada: boolean;
  emFalta(): string[];
  submeter(
    pedido: PedidoBalcao,
    identidade: IdentidadeCidadao,
    tx: Tx,
  ): Promise<Comprovativo>;
}

/** Falha do destino (rede, recusa, falha de demonstração): fica 'falhou' e tenta-se de novo. */
export class ErroSubmissao extends Error {}

export class SubmissaoSimulada implements SubmissaoBalcao {
  readonly modo = 'simulada' as const;
  readonly simulada = true;

  constructor(
    /** Fração das submissões que falham de propósito (0 a 1), para se ver o "tentar de novo". */
    private readonly taxaFalha = 0,
    private readonly aleatorio: () => number = Math.random,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  emFalta(): string[] {
    return [];
  }

  async submeter(
    p: PedidoBalcao,
    id: IdentidadeCidadao,
    tx: Tx,
  ): Promise<Comprovativo> {
    if (this.taxaFalha > 0 && this.aleatorio() < this.taxaFalha) {
      throw new ErroSubmissao(
        'O balcão online (simulado) não respondeu: falha de demonstração.',
      );
    }
    const agora = this.agora();
    const ano = agora.getUTCFullYear();
    // Na transação da entrega: se ela voltar atrás, o número não se gasta.
    const n = await proximoNumero(tx, p.municipioId, 'DEMO-ENTREGA', ano);
    return {
      numero_entrada: numeroEntradaDemo(ano, n),
      recebido_em: agora.toISOString(),
      documentos: [
        `Requerimento — ${p.tipo.nome}`,
        ...p.resumo.documentos.entregues,
      ],
      requerente: { nome: id.nome, nif_mascarado: mascararNif(id.nif) },
      destino: 'Balcão online da câmara (simulado)',
      simulado: true,
    };
  }
}

export interface ConfigBalcao {
  url: string;
  credencial: string;
}

export function emFaltaBalcao(c: ConfigBalcao): string[] {
  const falta: string[] = [];
  if (!c.url) falta.push('BALCAO_URL');
  if (!c.credencial) falta.push('BALCAO_CREDENCIAL');
  return falta;
}

/**
 * Esqueleto da submissão real. O que estes balcões costumam pedir (a
 * confirmar com o fornecedor do balcão da câmara ou com a AMA, no caso do
 * ePortugal): um serviço web autenticado (chave, OAuth2 client credentials
 * ou certificado), o requerimento com a identidade autenticada do
 * requerente, os anexos, e uma referência externa (a nossa `referencia`)
 * para não criar duas entradas se a resposta se perder. Devolve o número
 * de entrada e a data/hora de receção.
 */
export class SubmissaoBalcaoOnline implements SubmissaoBalcao {
  readonly modo = 'balcao' as const;
  readonly simulada = false;

  constructor(private readonly cfg: ConfigBalcao) {}

  emFalta(): string[] {
    return emFaltaBalcao(this.cfg);
  }

  submeter(): Promise<Comprovativo> {
    const falta = this.emFalta();
    if (falta.length) {
      return Promise.reject(
        new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'submissao_por_configurar',
          'Submissão no balcão online por configurar — falta o acesso de submissão ao balcão da câmara.',
          { em_falta: falta },
        ),
      );
    }
    return Promise.reject(
      new ErroSubmissao(
        `Submissão ao balcão online por ligar (${this.cfg.url}): falta a documentação e o ambiente de testes do balcão.`,
      ),
    );
  }
}
