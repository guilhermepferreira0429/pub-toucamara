/*
 * Sistemas sem adaptador automático (outros fornecedores, telefone, email):
 * as respostas entram por `importar-respostas` (CSV `pergunta;resposta`).
 * Este adaptador existe só para a interface ser a mesma para todos.
 */
import {
  ErroAdaptador,
  type Adaptador,
  type RespostaSistema,
  type Sistema,
} from '../tipos.js';

export class AdaptadorManual implements Adaptador {
  readonly paralelo = 1;

  constructor(private readonly sistema: Pick<Sistema, 'nome'>) {}

  pausa(): number {
    return 0;
  }

  async perguntar(): Promise<RespostaSistema> {
    throw new ErroAdaptador(
      `"${this.sistema.nome}" é um sistema manual: as respostas entram com \`importar-respostas\`.`,
      true,
    );
  }
}
