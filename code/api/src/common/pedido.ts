import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import type { Municipio } from '../modules/municipios/municipios.service.js';

/** Utilizador do painel autenticado (ver modules/auth). */
export interface UtilizadorPainel {
  id: string;
  nome: string;
  email: string;
  perfil:
    | 'atendimento'
    | 'tecnico'
    | 'chefe_divisao'
    | 'vereador'
    | 'equipa_toucamara'
    | 'admin';
  /** NULL = equipa interna, escolhe o município pelo header X-Municipio. */
  municipioId: string | null;
  servicoId: string | null;
}

/** Pedido depois dos guards: o município e o utilizador já resolvidos. */
export interface Pedido extends Request {
  municipio?: Municipio;
  utilizador?: UtilizadorPainel;
}

/** O município do pedido (MunicipioGuard, PainelGuard ou token público). */
export const MunicipioAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Municipio => {
    const municipio = ctx.switchToHttp().getRequest<Pedido>().municipio;
    if (!municipio) throw new Error('Rota sem guard que resolva o município.');
    return municipio;
  },
);

/** O utilizador do painel (só em rotas com @Painel()). */
export const UtilizadorAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UtilizadorPainel => {
    const u = ctx.switchToHttp().getRequest<Pedido>().utilizador;
    if (!u) throw new Error('Rota sem @Painel().');
    return u;
  },
);
