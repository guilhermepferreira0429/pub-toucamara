/*
 * Integração com a entidade gestora da água e saneamento (em Guimarães, a
 * Vimágua). A câmara não trata destes pedidos: o agente recolhe-os e
 * enviam-se por este adaptador. Hoje só há o adaptador SIMULADO
 * (vimagua-simulada.ts); um adaptador real (API ou email estruturado da
 * Vimágua) implementa a mesma interface quando houver acordo.
 */
import { HttpStatus } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';

export const TIPOS_PEDIDO_AGUA = [
  'leitura',
  'fatura',
  'avaria',
  'rotura',
  'falta_agua',
] as const;
export type TipoPedidoAgua = (typeof TIPOS_PEDIDO_AGUA)[number];

/** O que se envia à entidade gestora (sem ids internos). */
export interface PedidoParaVimagua {
  numero: string;
  tipo: TipoPedidoAgua;
  morada: string;
  numero_cliente: string | null;
  leitura_m3: number | null;
  descricao: string | null;
  urgente: boolean;
  nome: string | null;
  telefone: string | null;
  criado_em: string;
}

export interface IntegracaoVimagua {
  /** Nome a mostrar no painel ("Vimágua (simulada)"). */
  readonly nome: string;
  /** true = nada sai para a entidade gestora (demonstração). */
  readonly simulado: boolean;
  /** Envia o pedido; devolve a referência da entidade. Falha → ErroVimagua. */
  enviar(
    municipioId: string,
    p: PedidoParaVimagua,
  ): Promise<{ referencia: string }>;
}

/** Token de injeção (o módulo liga-o ao adaptador simulado). */
export const INTEGRACAO_VIMAGUA = Symbol('IntegracaoVimagua');

/** A entidade gestora não respondeu ou recusou: tenta-se outra vez mais tarde. */
export class ErroVimagua extends ErroApi {
  constructor(mensagem: string) {
    super(HttpStatus.BAD_GATEWAY, 'vimagua_indisponivel', mensagem);
  }
}
