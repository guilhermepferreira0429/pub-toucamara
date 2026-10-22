import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { proximoNumero } from '../../common/numeracao.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  ErroVimagua,
  type IntegracaoVimagua,
  type PedidoParaVimagua,
} from './integracao-vimagua.js';

/** "VIM-SIM-2026-000042": o SIM diz que a referência não é da Vimágua. */
export function referenciaSimulada(ano: number, n: number): string {
  return `VIM-SIM-${ano}-${String(n).padStart(6, '0')}`;
}

/**
 * ADAPTADOR SIMULADO da Vimágua (demonstração): nada sai para a entidade
 * gestora. Dá uma referência numerada por município e ano (série
 * 'VIMSIM' em `numeracao`) e, com VIMAGUA_SIMULADA_TAXA_FALHA (0 a 1),
 * falha de propósito uma fração dos envios para se ver o reenvio no painel.
 * O painel e a API mostram `simulado: true`.
 */
@Injectable()
export class VimaguaSimulada implements IntegracaoVimagua {
  readonly nome = 'Vimágua (simulada)';
  readonly simulado = true;
  readonly taxaFalha: number;
  /** Para os testes: o sorteio da falha. */
  aleatorio: () => number = Math.random;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService,
  ) {
    const t = Number(config.get<string>('VIMAGUA_SIMULADA_TAXA_FALHA') ?? 0);
    this.taxaFalha = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  }

  async enviar(
    municipioId: string,
    p: PedidoParaVimagua,
  ): Promise<{ referencia: string }> {
    if (this.taxaFalha > 0 && this.aleatorio() < this.taxaFalha) {
      throw new ErroVimagua(
        `Vimágua (simulada) não respondeu ao pedido ${p.numero}: falha de demonstração.`,
      );
    }
    const ano = new Date().getFullYear();
    const n = await proximoNumero(this.db, municipioId, 'VIMSIM', ano);
    return { referencia: referenciaSimulada(ano, n) };
  }
}
