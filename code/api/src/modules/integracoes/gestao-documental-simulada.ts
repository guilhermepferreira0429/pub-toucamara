import type { Tx } from '../../database/database.service.js';
import {
  DocumentoGd,
  ErroGestaoDocumental,
  GestaoDocumental,
  numeroGd,
  ProcessoGd,
} from './gestao-documental.js';

/**
 * O "sistema de gestão documental da câmara" da demonstração: grava o que
 * lhe foi enviado em `gd_simulado_registos` e numera as entradas como os
 * sistemas reais ('2026/E/012345', série por município e ano). Falha de
 * propósito numa fração dos envios (`taxa_falha`) para se ver o reintento,
 * o evento 'sync_erro' e o estado no painel. Simulado à vista: o painel
 * mostra `simulado: true`.
 *
 * Usa uma ligação própria (não a transação do job): o que "chegou" ao
 * sistema da câmara fica lá mesmo que o nosso lado volte atrás, como num
 * sistema real.
 */
export class GestaoDocumentalSimulada implements GestaoDocumental {
  constructor(
    private readonly db: Pick<Tx, 'query'>,
    private readonly municipioId: string,
    private readonly taxaFalha: number,
    private readonly aleatorio: () => number = Math.random,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async registarProcesso(p: ProcessoGd): Promise<{ gd_id: string }> {
    this.talvezFalhar('registar o processo');
    const ano = this.agora().getUTCFullYear();
    const [c] = await this.db.query<{ ultimo: number }>(
      `INSERT INTO gd_simulado_contadores (municipio_id, ano, ultimo) VALUES ($1, $2, 1)
       ON CONFLICT (municipio_id, ano) DO UPDATE SET ultimo = gd_simulado_contadores.ultimo + 1
       RETURNING ultimo`,
      [this.municipioId, ano],
    );
    const gdId = numeroGd(ano, c.ultimo);
    await this.registo(gdId, 'registar', p);
    return { gd_id: gdId };
  }

  async anexarDocumento(
    gdId: string,
    doc: DocumentoGd,
  ): Promise<{ referencia: string | null }> {
    this.talvezFalhar('anexar o documento');
    const id = await this.registo(gdId, 'anexar', doc);
    return { referencia: `${gdId}/A${id}` };
  }

  async atualizarEstado(gdId: string, fase: string): Promise<void> {
    this.talvezFalhar('atualizar o estado');
    await this.registo(gdId, 'estado', { fase });
  }

  private talvezFalhar(o: string) {
    if (this.taxaFalha > 0 && this.aleatorio() < this.taxaFalha) {
      throw new ErroGestaoDocumental(
        `Gestão documental (simulada) não respondeu ao ${o}: falha de demonstração.`,
      );
    }
  }

  private async registo(
    gdId: string,
    operacao: 'registar' | 'anexar' | 'estado',
    conteudo: object,
  ): Promise<string> {
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO gd_simulado_registos (municipio_id, gd_id, operacao, conteudo)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [this.municipioId, gdId, operacao, JSON.stringify(conteudo)],
    );
    return r.id;
  }
}
