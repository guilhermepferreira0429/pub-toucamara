import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../common/erros.js';
import { validar } from '../common/validacao.js';
import { ContextoFerramenta, Ferramenta } from './ferramenta.js';

export interface EntradaCatalogo {
  nome: string;
  descricao: string;
  metodo: 'POST';
  caminho: string;
  entrada: Record<string, unknown>;
}

/**
 * Todas as ferramentas do agente. Cada módulo de domínio regista as suas no
 * `onModuleInit`; o controller /v1/agent/tools e o chat só falam com isto.
 */
@Injectable()
export class RegistoFerramentas {
  private readonly ferramentas = new Map<string, Ferramenta>();

  registar(...lista: Ferramenta[]): void {
    for (const f of lista) {
      if (this.ferramentas.has(f.nome)) {
        throw new Error(`Ferramenta registada duas vezes: ${f.nome}`);
      }
      this.ferramentas.set(f.nome, f);
    }
  }

  todas(): Ferramenta[] {
    return [...this.ferramentas.values()].sort((a, b) =>
      a.nome.localeCompare(b.nome),
    );
  }

  obter(nome: string): Ferramenta {
    const f = this.ferramentas.get(nome);
    if (!f) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ferramenta_desconhecida',
        `Não há a ferramenta "${nome}".`,
      );
    }
    return f;
  }

  /** Valida a entrada e corre. Erros saem como ErroApi (o modelo lê o código). */
  async executar(
    nome: string,
    ctx: ContextoFerramenta,
    entrada: unknown,
  ): Promise<unknown> {
    const f = this.obter(nome);
    return f.executar(ctx, validar(f.entrada, entrada ?? {}));
  }

  /** O catálogo em JSON Schema, como o ElevenLabs e a API do Claude o pedem. */
  catalogo(): EntradaCatalogo[] {
    return this.todas().map((f) => ({
      nome: f.nome,
      descricao: f.descricao,
      metodo: 'POST',
      caminho: `/v1/agent/tools/${f.nome}`,
      entrada: z.toJSONSchema(f.entrada, { io: 'input' }),
    }));
  }
}
