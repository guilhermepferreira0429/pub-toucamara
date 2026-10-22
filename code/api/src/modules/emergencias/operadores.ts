import { HttpStatus } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { GeometriaEmergencia } from './emergencias.regras.js';
import {
  DIFUSAO_DEMONSTRACAO,
  EstadoDifusao,
  estadoDifusaoSimulada,
  estimarZona,
  falhaSimulada,
  paginaSimulada,
  referenciaDifusaoDemo,
  segmentos,
  ZonaEstimada,
} from './operadores.regras.js';

/*
 * A fonte externa dos avisos de emergência: os números de TODAS as pessoas
 * na zona (operadores móveis, pedidos através da ANEPC / proteção civil
 * municipal) e o cell broadcast (a mensagem vai para todos os telemóveis
 * ligados às antenas da zona, sem números). Um adaptador por modo, como a
 * entrega em nome do munícipe (modules/entregas/submissao-balcao.ts):
 *
 *  - `simulada` (por omissão): gera números FALSOS coerentes com a zona
 *    (operadores.regras.ts) e uma difusão de demonstração. Nada sai.
 *  - `operadores` / `cell_broadcast`: os reais. Esqueletos: sem configuração
 *    recusam com "por configurar — falta acordo com a ANEPC / operadores";
 *    com configuração recusam com "por ligar" até haver a especificação do
 *    serviço (vem com o acordo).
 *
 * Escolhidos por EMERGENCIAS_OPERADORES e EMERGENCIAS_CELL_BROADCAST (ver
 * code/api/.env.example e docs/CREDENCIAIS_EXTERNAS.md).
 */

export const MODOS_OPERADORES = ['simulada', 'operadores'] as const;
export type ModoOperadores = (typeof MODOS_OPERADORES)[number];
export const MODOS_CELL_BROADCAST = ['simulada', 'cell_broadcast'] as const;
export type ModoCellBroadcast = (typeof MODOS_CELL_BROADCAST)[number];

export const MENSAGEM_POR_CONFIGURAR_OPERADORES =
  'Fonte dos operadores por configurar — falta acordo com a ANEPC / operadores.';
export const MENSAGEM_POR_CONFIGURAR_CELL_BROADCAST =
  'Cell broadcast por configurar — falta acordo com a ANEPC / operadores.';

/** O que se pede: o município e a zona do aviso. */
export interface PedidoZona {
  municipioId: string;
  zona: GeometriaEmergencia;
}

export interface Estimativa {
  /** Pessoas estimadas na zona. */
  pessoas: number;
  /** Com telemóvel. */
  com_telemovel: number;
  /** Quantos números a fonte vai devolver (null se não souber antes). */
  a_devolver: number | null;
  por_zona: ZonaEstimada[];
  demonstracao: boolean;
  nota: string | null;
}

export interface DestinatarioOperador {
  telefone_e164: string;
  /** Freguesia ou zona aproximada da antena. */
  zona_aproximada: string | null;
  /** Ex.: 'operadores (simulado)'. */
  origem: string;
}

export interface PaginaOperadores {
  destinatarios: DestinatarioOperador[];
  /** Cursor da página seguinte; null no fim. */
  seguinte: string | null;
}

/** A fonte dos números de toda a gente na zona. */
export interface FonteOperadores {
  readonly modo: ModoOperadores;
  /** Números falsos: nunca podem sair para um fornecedor. */
  readonly simulada: boolean;
  /** Variáveis em falta (vazio = configurada). */
  emFalta(): string[];
  /** Quantos antes de buscar (para o plano: tempo e custo). */
  estimar(p: PedidoZona): Promise<Estimativa>;
  /** Uma página de números (cursor null = a primeira). */
  pagina(
    p: PedidoZona,
    cursor: string | null,
    tamanho: number,
  ): Promise<PaginaOperadores>;
}

export interface PedidoDifusao extends PedidoZona {
  /** O id da emergência: chave de idempotência no destino. */
  referencia: string;
  texto: string;
  validaAte: Date;
}

export interface EstadoDaDifusao {
  estado: EstadoDifusao;
  referencia_externa: string | null;
  iniciada_em: Date | null;
  concluida_em: Date | null;
  erro: string | null;
}

/** Cell broadcast: área + texto + estado da difusão (sem números). */
export interface CellBroadcast {
  readonly modo: ModoCellBroadcast;
  readonly simulada: boolean;
  emFalta(): string[];
  estimar(p: PedidoZona): Promise<Estimativa>;
  pedir(p: PedidoDifusao, agora?: Date): Promise<EstadoDaDifusao>;
  consultar(
    d: { referencia_externa: string | null; pedida_em: Date },
    agora?: Date,
  ): Promise<EstadoDaDifusao>;
  cancelar(d: { referencia_externa: string | null }): Promise<void>;
}

/** Falha passageira da fonte (a página volta a ser pedida). */
export class ErroFonteOperadores extends Error {}

function porConfigurar(
  codigo: 'operadores_por_configurar' | 'cell_broadcast_por_configurar',
  mensagem: string,
  falta: string[],
): ErroApi {
  return new ErroApi(HttpStatus.SERVICE_UNAVAILABLE, codigo, mensagem, {
    em_falta: falta,
  });
}

const esperar = (ms: number) =>
  ms > 0 ? new Promise((ok) => setTimeout(ok, ms)) : Promise.resolve();

// ---------------------------------------------------------------------
// Simuladas
// ---------------------------------------------------------------------

export interface OpcoesSimulada {
  /** Fração dos telemóveis estimados que se geram (0 a 1). */
  escala: number;
  /** Atraso de cada página, em ms. */
  latenciaMs: number;
  /** Fração das páginas que falham de propósito (0 a 1), para mostrar o reenvio. */
  taxaErro: number;
}

/**
 * Operadores simulados: números falsos (+351 9X 99N NNNN), proporcionais à
 * população de demonstração da zona, sempre os mesmos para a mesma zona.
 */
export class FonteOperadoresSimulada implements FonteOperadores {
  readonly modo = 'simulada' as const;
  readonly simulada = true;

  constructor(private readonly o: OpcoesSimulada) {}

  emFalta(): string[] {
    return [];
  }

  estimar(p: PedidoZona): Promise<Estimativa> {
    const e = estimarZona(p.zona);
    const segs = segmentos(p.municipioId, p.zona, this.o.escala);
    return Promise.resolve({
      pessoas: e.pessoas,
      com_telemovel: e.com_telemovel,
      a_devolver: segs.reduce((s, x) => s + x.total, 0),
      por_zona: e.por_zona,
      demonstracao: true,
      nota: `Simulação: gera ${Math.round(this.o.escala * 1000) / 10}% dos ${e.com_telemovel} telemóveis estimados (EMERGENCIAS_SIMULADA_ESCALA). ${e.fonte}`,
    });
  }

  /** Tentativas por página (as falhas de demonstração são determinísticas). */
  private readonly tentativas = new Map<string, number>();

  async pagina(
    p: PedidoZona,
    cursor: string | null,
    tamanho: number,
  ): Promise<PaginaOperadores> {
    await esperar(this.o.latenciaMs);
    const inicio = cursor ? Number(cursor) : 0;
    const segs = segmentos(p.municipioId, p.zona, this.o.escala);
    const seed = segs.map((x) => x.seed).join('|');
    const chave = `${seed}#${inicio}`;
    const tentativa = (this.tentativas.get(chave) ?? 0) + 1;
    this.tentativas.set(chave, tentativa);
    if (falhaSimulada(seed, inicio, tentativa, this.o.taxaErro)) {
      throw new ErroFonteOperadores(
        'O operador (simulado) não respondeu: falha de demonstração (EMERGENCIAS_SIMULADA_TAXA_ERRO).',
      );
    }
    const r = paginaSimulada(segs, inicio, tamanho);
    return {
      destinatarios: r.numeros.map((n) => ({
        telefone_e164: n.telefone_e164,
        zona_aproximada: n.zona_aproximada,
        origem: 'operadores (simulado)',
      })),
      seguinte: r.seguinte === null ? null : String(r.seguinte),
    };
  }
}

/** Cell broadcast simulado: pedida → em difusão → concluída, sem sair daqui. */
export class CellBroadcastSimulado implements CellBroadcast {
  readonly modo = 'simulada' as const;
  readonly simulada = true;

  emFalta(): string[] {
    return [];
  }

  estimar(p: PedidoZona): Promise<Estimativa> {
    const e = estimarZona(p.zona);
    return Promise.resolve({
      pessoas: e.pessoas,
      com_telemovel: e.com_telemovel,
      a_devolver: null,
      por_zona: e.por_zona,
      demonstracao: true,
      nota: `Simulação: a mensagem iria para os telemóveis ligados às antenas da zona (estimativa de demonstração). Difusão de demonstração: começa ${DIFUSAO_DEMONSTRACAO.segundos_ate_difundir} s depois do pedido e dura ${DIFUSAO_DEMONSTRACAO.minutos_em_difusao} min.`,
    });
  }

  pedir(p: PedidoDifusao, agora = new Date()): Promise<EstadoDaDifusao> {
    return Promise.resolve({
      ...estadoDifusaoSimulada(agora, agora),
      referencia_externa: referenciaDifusaoDemo(p.referencia),
      erro: null,
    });
  }

  consultar(
    d: { referencia_externa: string | null; pedida_em: Date },
    agora = new Date(),
  ): Promise<EstadoDaDifusao> {
    return Promise.resolve({
      ...estadoDifusaoSimulada(d.pedida_em, agora),
      referencia_externa: d.referencia_externa,
      erro: null,
    });
  }

  cancelar(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------
// Reais (esqueletos, por configurar)
// ---------------------------------------------------------------------

export interface ConfigServicoExterno {
  url: string;
  credencial: string;
}

export function emFaltaOperadores(c: ConfigServicoExterno): string[] {
  const falta: string[] = [];
  if (!c.url) falta.push('OPERADORES_URL');
  if (!c.credencial) falta.push('OPERADORES_CREDENCIAL');
  return falta;
}

export function emFaltaCellBroadcast(c: ConfigServicoExterno): string[] {
  const falta: string[] = [];
  if (!c.url) falta.push('CELL_BROADCAST_URL');
  if (!c.credencial) falta.push('CELL_BROADCAST_CREDENCIAL');
  return falta;
}

/**
 * Esqueleto da fonte real. O que se espera do serviço (a confirmar no acordo
 * com a ANEPC / operadores): um pedido autenticado com a área (freguesias,
 * polígono ou ponto + raio) e o motivo; uma contagem antes de entregar os
 * números; os números por páginas (E.164, com a zona aproximada da antena),
 * com um cursor; registo do pedido para auditoria (base legal: aviso à
 * população em emergência). O modo como os números chegam (API, ficheiro,
 * envio feito pelo próprio operador) também está por decidir.
 */
export class FonteOperadoresReal implements FonteOperadores {
  readonly modo = 'operadores' as const;
  readonly simulada = false;

  constructor(private readonly cfg: ConfigServicoExterno) {}

  emFalta(): string[] {
    return emFaltaOperadores(this.cfg);
  }

  private recusar(): Promise<never> {
    const falta = this.emFalta();
    if (falta.length) {
      return Promise.reject(
        porConfigurar(
          'operadores_por_configurar',
          MENSAGEM_POR_CONFIGURAR_OPERADORES,
          falta,
        ),
      );
    }
    return Promise.reject(
      new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'operadores_por_ligar',
        `Fonte dos operadores por ligar (${this.cfg.url}): falta a especificação do serviço, que vem com o acordo com a ANEPC / operadores.`,
      ),
    );
  }

  estimar(): Promise<Estimativa> {
    return this.recusar();
  }

  pagina(): Promise<PaginaOperadores> {
    return this.recusar();
  }
}

/**
 * Esqueleto do cell broadcast real. Em Portugal o alerta para telemóveis é
 * acionado pela ANEPC junto dos operadores; aqui seria o pedido (área, texto,
 * validade, referência) e a consulta do estado da difusão. Interface e
 * prazos: a confirmar no acordo.
 */
export class CellBroadcastReal implements CellBroadcast {
  readonly modo = 'cell_broadcast' as const;
  readonly simulada = false;

  constructor(private readonly cfg: ConfigServicoExterno) {}

  emFalta(): string[] {
    return emFaltaCellBroadcast(this.cfg);
  }

  private recusar(): Promise<never> {
    const falta = this.emFalta();
    if (falta.length) {
      return Promise.reject(
        porConfigurar(
          'cell_broadcast_por_configurar',
          MENSAGEM_POR_CONFIGURAR_CELL_BROADCAST,
          falta,
        ),
      );
    }
    return Promise.reject(
      new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'cell_broadcast_por_ligar',
        `Cell broadcast por ligar (${this.cfg.url}): falta a especificação do serviço, que vem com o acordo com a ANEPC / operadores.`,
      ),
    );
  }

  estimar(): Promise<Estimativa> {
    return this.recusar();
  }

  pedir(): Promise<EstadoDaDifusao> {
    return this.recusar();
  }

  consultar(): Promise<EstadoDaDifusao> {
    return this.recusar();
  }

  cancelar(): Promise<void> {
    return this.recusar();
  }
}

// ---------------------------------------------------------------------
// Escolha pelo ambiente
// ---------------------------------------------------------------------

/** Lê uma variável (vazia = ''). */
export type LerVariavel = (nome: string) => string;

function numeroEntre(
  v: string,
  omissao: number,
  min: number,
  max: number,
): number {
  if (!v.trim()) return omissao;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : omissao;
}

export function opcoesSimulada(ler: LerVariavel): OpcoesSimulada {
  return {
    escala: numeroEntre(ler('EMERGENCIAS_SIMULADA_ESCALA'), 0.02, 0, 1),
    latenciaMs: numeroEntre(
      ler('EMERGENCIAS_SIMULADA_LATENCIA_MS'),
      200,
      0,
      10_000,
    ),
    taxaErro: numeroEntre(ler('EMERGENCIAS_SIMULADA_TAXA_ERRO'), 0, 0, 1),
  };
}

/** EMERGENCIAS_OPERADORES: simulada (por omissão) | operadores. */
export function fonteOperadoresDoAmbiente(ler: LerVariavel): FonteOperadores {
  const modo = ler('EMERGENCIAS_OPERADORES') || 'simulada';
  if (modo === 'operadores') {
    return new FonteOperadoresReal({
      url: ler('OPERADORES_URL'),
      credencial: ler('OPERADORES_CREDENCIAL'),
    });
  }
  if (modo !== 'simulada') {
    // Valor desconhecido: a real sem configuração (recusa), nunca a simulada
    // às escondidas.
    return new FonteOperadoresReal({ url: '', credencial: '' });
  }
  return new FonteOperadoresSimulada(opcoesSimulada(ler));
}

/** EMERGENCIAS_CELL_BROADCAST: simulada (por omissão) | cell_broadcast. */
export function cellBroadcastDoAmbiente(ler: LerVariavel): CellBroadcast {
  const modo = ler('EMERGENCIAS_CELL_BROADCAST') || 'simulada';
  if (modo === 'cell_broadcast') {
    return new CellBroadcastReal({
      url: ler('CELL_BROADCAST_URL'),
      credencial: ler('CELL_BROADCAST_CREDENCIAL'),
    });
  }
  if (modo !== 'simulada') {
    return new CellBroadcastReal({ url: '', credencial: '' });
  }
  return new CellBroadcastSimulado();
}
