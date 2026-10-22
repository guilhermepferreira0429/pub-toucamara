import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { PushService } from '../app-municipe/push.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AvisosZonaService } from '../avisos-zona/avisos-zona.service.js';
import {
  AlvoCampanha,
  CampanhasService,
} from '../campanhas/campanhas.service.js';
import type { TipoCampanha } from '../campanhas/regras.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import {
  mascararTelefone,
  MunicipesService,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import {
  AJUDAS,
  AMOSTRA,
  aLigar,
  AVISO_COBERTURA,
  AVISO_COBERTURA_SIMULADA,
  contarResultados,
  descreverZonaEmergencia,
  Destinatario,
  esquemaGuiao,
  esquemaListaManual,
  esquemaZona,
  EstadoEmergencia,
  estimarEnvioSms,
  fonteAtual,
  FONTES,
  geometriaEmergencia,
  GeometriaEmergencia,
  Gravidade,
  GRAVIDADES,
  Guiao,
  GUIOES,
  IdFonte,
  instanteDoEnvio,
  juntarFontes,
  lerCsvTelefones,
  LinhaLista,
  mascararNome,
  MAX_DESTINATARIOS,
  MAX_LISTA,
  MAX_SEGMENTOS,
  necessidadesCampanha,
  planear,
  PoliticaChamadas,
  politicaPorGravidade,
  POLITICAS_CHAMADAS,
  Resultado,
  resultadoDe,
  ResultadoFonte,
  RITMO_OMISSAO,
  Ritmo,
  textoSmsEmergencia,
  TipoEmergencia,
  TIPOS_EMERGENCIA,
  ZonaEmergencia,
} from './emergencias.regras.js';
import {
  FonteCuidado,
  FonteDestinatarios,
  FonteLista,
  FonteMunicipes,
  FonteOperadoresZona,
} from './fontes.js';
import {
  CellBroadcast,
  CellBroadcastSimulado,
  cellBroadcastDoAmbiente,
  EstadoDaDifusao,
  FonteOperadores,
  fonteOperadoresDoAmbiente,
  MENSAGEM_POR_CONFIGURAR_CELL_BROADCAST,
} from './operadores.js';
import type { EstadoDifusao } from './operadores.regras.js';

export const FILA_EMERGENCIAS = 'emergencias_seguimento';

/** Moradas dos munícipes conhecidos: dos últimos 3 anos. */
const JANELA_MORADAS_DIAS = 3 * 365;
const MAX_LISTA_PAINEL = 500;

export const esquemaNovaEmergencia = z
  .object({
    tipo: z.enum(TIPOS_EMERGENCIA),
    gravidade: z.enum(GRAVIDADES),
    titulo: z.string().trim().min(3).max(120),
    mensagem_sms: z.string().trim().min(10).max(300),
    guiao: esquemaGuiao.optional(),
    instrucoes: z.string().trim().min(3).max(300).optional(),
    numero_emergencia: z
      .string()
      .trim()
      .regex(/^[\d +]{3,20}$/)
      .default('112'),
    zona: esquemaZona,
    /** Até quando vale o aviso (por omissão, 24 h). */
    valida_ate: z.coerce
      .date()
      .refine((d) => d.getTime() > Date.now(), 'Tem de ser no futuro.')
      .optional(),
    /** A quem liga o agente; por omissão, conforme a gravidade. */
    chamadas: z.enum(POLITICAS_CHAMADAS).optional(),
    /**
     * De onde vêm os números. 'operadores' (todas as pessoas na zona) só
     * quando pedido: é simulada até haver acordo com a ANEPC / operadores.
     * ('externa' é o nome antigo de 'operadores'.)
     */
    fontes: z
      .array(z.preprocess(fonteAtual, z.enum(FONTES)))
      .max(FONTES.length)
      .default(['municipes', 'cuidado', 'lista'])
      .transform((x) => [...new Set(x)]),
    /** Pedir também o cell broadcast (área + texto, sem números). */
    cell_broadcast: z.boolean().default(false),
    /** A lista carregada à mão: já lida, ou o CSV como texto. */
    lista_manual: esquemaListaManual.optional(),
    lista_csv: z.string().max(200_000).optional(),
    /** Faz tudo sem gravar nem enviar nada e devolve o plano. */
    simular: z.boolean().default(false),
  })
  .strict()
  .refine((e) => e.fontes.length > 0 || e.cell_broadcast, {
    message: 'Escolha pelo menos uma fonte de números ou o cell broadcast.',
    path: ['fontes'],
  });
export type NovaEmergencia = z.output<typeof esquemaNovaEmergencia>;

export const esquemaEnviar = z
  .object({
    simular: z.boolean().default(false),
    confirmo_destinatarios: z.number().int().min(0).optional(),
    /** Segunda confirmação: escrever ENVIAR. */
    confirmo_texto: z.string().trim().optional(),
  })
  .strict();

export const esquemaEncerrar = z
  .object({ nota: z.string().trim().max(500).optional() })
  .strict();

export const esquemaTratar = z
  .object({ nota: z.string().trim().max(500).optional() })
  .strict();

export const esquemaConfig = z
  .object({
    protecao_civil_nome: z.string().trim().max(120).nullable().optional(),
    protecao_civil_email: z.string().trim().email().nullable().optional(),
    sms_por_minuto: z.number().int().min(1).max(6_000),
    chamadas_por_minuto: z.number().int().min(1).max(600),
  })
  .strict();

export const entradaResposta = z.object({
  estado: z
    .enum(['em_seguranca', 'precisa_ajuda'])
    .describe('precisa_ajuda também se ficaste preocupado.'),
  ajuda: z
    .array(z.enum(AJUDAS))
    .max(AJUDAS.length)
    .default([])
    .describe('Que ajuda precisa.'),
  nota: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('O que a pessoa disse, em poucas palavras.'),
});

export interface ConfigEmergencias extends Ritmo {
  protecao_civil_nome: string | null;
  protecao_civil_email: string | null;
  demonstracao: boolean;
}

interface LinhaEmergencia {
  id: string;
  municipio_id: string;
  tipo: TipoEmergencia;
  gravidade: Gravidade;
  titulo: string;
  mensagem_sms: string;
  guiao: Guiao;
  instrucoes: string;
  numero_emergencia: string;
  zona: ZonaEmergencia;
  geometria: GeometriaEmergencia;
  zona_descricao: string;
  valida_ate: Date;
  chamadas: PoliticaChamadas;
  fontes: IdFonte[];
  cell_broadcast: boolean;
  lista_manual: LinhaLista[];
  estado: EstadoEmergencia;
  destinatarios_previstos: number;
  campanha_id: string | null;
  criada_por: string | null;
  criada_por_nome: string | null;
  criada_em: Date;
  enviada_em: Date | null;
  enviada_por_nome: string | null;
  encerrada_em: Date | null;
  encerrada_nota: string | null;
}

const COLUNAS = `e.id, e.municipio_id, e.tipo, e.gravidade, e.titulo, e.mensagem_sms, e.guiao,
  e.instrucoes, e.numero_emergencia, e.zona, e.geometria, e.zona_descricao, e.valida_ate,
  e.chamadas, e.fontes, e.cell_broadcast, e.lista_manual, e.estado, e.destinatarios_previstos, e.campanha_id,
  e.criada_por, uc.nome AS criada_por_nome, e.criada_em, e.enviada_em, ue.nome AS enviada_por_nome,
  e.encerrada_em, e.encerrada_nota`;
const DE = `FROM emergencias e
  LEFT JOIN utilizadores uc ON uc.id = e.criada_por
  LEFT JOIN utilizadores ue ON ue.id = e.enviada_por`;

/** O tipo da campanha de chamadas (módulo campanhas) para cada emergência. */
const TIPO_CAMPANHA: Record<TipoEmergencia, TipoCampanha> = {
  cheia: 'outro',
  incendio: 'outro',
  corte_agua: 'corte_agua',
  calor_extremo: 'onda_calor',
  outro: 'outro',
};

const NOMES_TIPO: Record<TipoEmergencia, string> = {
  cheia: 'Cheia',
  incendio: 'Incêndio',
  corte_agua: 'Corte prolongado de água',
  calor_extremo: 'Calor extremo',
  outro: 'Emergência',
};

interface Calculo {
  fontes: ResultadoFonte[];
  destinatarios: Destinatario[];
  por_fonte: Record<IdFonte, number>;
  so_desta_fonte: Record<IdFonte, number>;
  em_varias_fontes: number;
  sem_contacto_possivel: number;
  simulados: number;
}

interface LinhaDifusao {
  id: string;
  modo: 'simulada' | 'cell_broadcast';
  simulado: boolean;
  estado: EstadoDifusao;
  zona_descricao: string;
  texto: string;
  pessoas_estimadas: number | null;
  referencia_externa: string | null;
  pedida_em: Date | null;
  iniciada_em: Date | null;
  concluida_em: Date | null;
  erro: string | null;
}

/**
 * Avisos de emergência em massa: cheia, incêndio, corte prolongado de água,
 * calor extremo. Regras em emergencias.regras.ts, fontes em fontes.ts.
 *
 * Fluxo: criar (rascunho, com a simulação) → simular quantas vezes for
 * preciso (`simular: true`, nada sai) → enviar com dupla confirmação (o
 * número de pessoas e "ENVIAR"): a lista fica fixa, os SMS ficam na fila ao
 * ritmo configurado e, conforme a gravidade, o agente liga aos vulneráveis
 * ou a todos (uma campanha do módulo campanhas, sem janela de horário) →
 * acompanhar → encerrar. Quem responde "precisa de ajuda" aparece em
 * destaque e gera um email às chefias e à proteção civil municipal.
 */
@Injectable()
export class EmergenciasService {
  private readonly logger = new Logger(EmergenciasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly avisos: AvisosZonaService,
    private readonly geo: GeocodificacaoService,
    private readonly campanhas: CampanhasService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
    // Push urgente na app de quem a tem (opcional nos testes feitos à mão).
    @Optional() private readonly push?: PushService,
  ) {}

  // -------------------------------------------------------------------
  // Fontes e plano
  // -------------------------------------------------------------------

  private env(nome: string): string {
    return (this.config.get<string>(nome) ?? '').trim();
  }

  /** A fonte dos operadores (EMERGENCIAS_OPERADORES; simulada por omissão). */
  operadores(): FonteOperadores {
    return fonteOperadoresDoAmbiente((n) => this.env(n));
  }

  /** O cell broadcast (EMERGENCIAS_CELL_BROADCAST; simulado por omissão). */
  cellBroadcast(): CellBroadcast {
    return cellBroadcastDoAmbiente((n) => this.env(n));
  }

  /** Os adaptadores, um por fonte. */
  fontes(q: Pick<Tx, 'query'> = this.db): Record<IdFonte, FonteDestinatarios> {
    return {
      municipes: new FonteMunicipes(q, this.avisos),
      cuidado: new FonteCuidado(q, this.geo),
      lista: new FonteLista(),
      operadores: new FonteOperadoresZona(this.operadores()),
    };
  }

  /** O modo de cada fonte externa e o que falta para ser real (painel). */
  fonteExterna() {
    const o = this.operadores();
    const c = this.cellBroadcast();
    const falta =
      'Para ser real: acordo com a ANEPC / operadores (base legal e acordo de tratamento de dados), o serviço deles e as credenciais, que a equipa Tou, Câmara? configura.';
    return {
      operadores: {
        modo: o.modo,
        simulada: o.simulada,
        configurada: o.emFalta().length === 0,
        em_falta: o.emFalta(),
        nota: o.simulada
          ? `Simulada: números gerados para demonstração, que nunca saem. ${falta}`
          : o.emFalta().length
            ? `Real, por configurar — falta acordo com a ANEPC / operadores.`
            : 'Real.',
      },
      cell_broadcast: {
        modo: c.modo,
        simulada: c.simulada,
        configurada: c.emFalta().length === 0,
        em_falta: c.emFalta(),
        nota: c.simulada
          ? `Simulado: a difusão é de demonstração, nada sai. ${falta}`
          : c.emFalta().length
            ? MENSAGEM_POR_CONFIGURAR_CELL_BROADCAST
            : 'Real.',
      },
    };
  }

  private async calcular(
    m: Municipio,
    e: {
      geometria: GeometriaEmergencia;
      fontes: readonly IdFonte[];
      lista: readonly LinhaLista[];
    },
    q: Pick<Tx, 'query'> = this.db,
  ): Promise<Calculo> {
    const adaptadores = this.fontes(q);
    const desde = new Date(Date.now() - JANELA_MORADAS_DIAS * 86_400_000);
    const resultados: ResultadoFonte[] = [];
    // Em série: a geocodificação pede no máximo um pedido por segundo.
    for (const f of FONTES) {
      if (!e.fontes.includes(f)) continue;
      resultados.push(
        await adaptadores[f].procurar({
          municipio: m,
          zona: e.geometria,
          lista: e.lista,
          desde,
        }),
      );
    }
    return { fontes: resultados, ...juntarFontes(resultados) };
  }

  async obterConfig(m: Municipio): Promise<ConfigEmergencias> {
    const [c] = await this.db.query<Omit<ConfigEmergencias, 'demonstracao'>>(
      `SELECT protecao_civil_nome, protecao_civil_email, sms_por_minuto, chamadas_por_minuto
       FROM emergencias_config WHERE municipio_id = $1`,
      [m.id],
    );
    if (!c) {
      return {
        protecao_civil_nome: null,
        protecao_civil_email: null,
        sms_por_minuto: RITMO_OMISSAO.sms_por_minuto,
        chamadas_por_minuto: RITMO_OMISSAO.chamadas_por_minuto,
        demonstracao: true,
      };
    }
    return { ...c, demonstracao: false };
  }

  async guardarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaConfig>,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO emergencias_config (municipio_id, protecao_civil_nome, protecao_civil_email,
           sms_por_minuto, chamadas_por_minuto, atualizado_por, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (municipio_id) DO UPDATE SET
           protecao_civil_nome = EXCLUDED.protecao_civil_nome,
           protecao_civil_email = EXCLUDED.protecao_civil_email,
           sms_por_minuto = EXCLUDED.sms_por_minuto,
           chamadas_por_minuto = EXCLUDED.chamadas_por_minuto,
           atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
        [
          m.id,
          d.protecao_civil_nome ?? null,
          d.protecao_civil_email ?? null,
          d.sms_por_minuto,
          d.chamadas_por_minuto,
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'mudar_config_emergencias',
          objetoTipo: 'emergencias_config',
          objetoId: m.id,
          dados: {
            sms_por_minuto: d.sms_por_minuto,
            chamadas_por_minuto: d.chamadas_por_minuto,
            protecao_civil: !!d.protecao_civil_email,
          },
        },
        tx,
      );
    });
    return this.obterConfig(m);
  }

  /** O texto do SMS e o guião, prontos (com os valores por omissão do tipo). */
  private textos(m: Municipio, e: NovaEmergencia) {
    const base = GUIOES[e.tipo];
    const instrucoes = e.instrucoes ?? base.instrucoes;
    const guiao = e.guiao ?? { dizer: base.dizer, perguntas: base.perguntas };
    const sms = textoSmsEmergencia({
      municipio: m.nome,
      gravidade: e.gravidade,
      mensagem: e.mensagem_sms,
      instrucoes,
      numero: e.numero_emergencia,
    });
    if (sms.segmentos > MAX_SEGMENTOS) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'mensagem_demasiado_longa',
        `O SMS ficava com ${sms.segmentos} partes (máximo ${MAX_SEGMENTOS}). Encurte a mensagem ou as instruções.`,
        { segmentos: sms.segmentos },
      );
    }
    return { instrucoes, guiao, sms };
  }

  private lista(e: NovaEmergencia): {
    lista: LinhaLista[];
    csv: {
      invalidas: { linha: number; texto: string }[];
      repetidas: number;
    } | null;
  } {
    if (e.lista_csv) {
      const r = lerCsvTelefones(e.lista_csv);
      if (r.linhas.length > MAX_LISTA) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'lista_demasiado_grande',
          `A lista tem ${r.linhas.length} números (máximo ${MAX_LISTA}).`,
        );
      }
      return {
        lista: [...(e.lista_manual ?? []), ...r.linhas],
        csv: { invalidas: r.invalidas.slice(0, 20), repetidas: r.repetidas },
      };
    }
    return { lista: e.lista_manual ?? [], csv: null };
  }

  /** A resposta da simulação: o plano, sem enviar nada. */
  private async plano(
    m: Municipio,
    e: {
      gravidade: Gravidade;
      politica: PoliticaChamadas;
      geometria: GeometriaEmergencia;
      zona_descricao: string;
      fontes: readonly IdFonte[];
      cell_broadcast: boolean;
      lista: readonly LinhaLista[];
      sms: { texto: string; segmentos: number; codificacao: string };
      guiao: Guiao;
    },
    q: Pick<Tx, 'query'> = this.db,
  ) {
    const calc = await this.calcular(m, e, q);
    const config = await this.obterConfig(m);
    const plano = planear({
      destinatarios: calc.destinatarios,
      politica: e.politica,
      segmentosPorSms: e.sms.segmentos,
      ritmo: {
        sms_por_minuto: config.sms_por_minuto,
        chamadas_por_minuto: config.chamadas_por_minuto,
      },
      ritmoDemonstracao: config.demonstracao,
    });
    const ligar = aLigar(calc.destinatarios, e.politica);
    const op = calc.fontes.find((f) => f.fonte === 'operadores');
    const externa = this.fonteExterna();
    // A fonte dos operadores à escala real (a simulação só gera uma parte):
    // quanto tempo e quanto custaria mandar SMS a todos os telemóveis da zona.
    const operadores = op
      ? {
          ...externa.operadores,
          estado: op.estado,
          estimativa: op.estimativa ?? null,
          encontrados: op.candidatos.length,
          // O que acrescenta (os conhecidos têm prioridade e contam na fonte deles).
          novos: calc.so_desta_fonte.operadores,
          ja_conhecidos:
            calc.por_fonte.operadores - calc.so_desta_fonte.operadores,
          escala_real: op.estimativa
            ? estimarEnvioSms(
                op.estimativa.com_telemovel,
                e.sms.segmentos,
                config.sms_por_minuto,
              )
            : null,
        }
      : null;
    const cellBroadcast = e.cell_broadcast
      ? await this.planoDifusao(m, e.geometria)
      : null;
    return {
      calc,
      resposta: {
        simulacao: true,
        nada_enviado: true,
        zona: e.zona_descricao,
        aviso_cobertura: AVISO_COBERTURA,
        aviso_simulado: calc.simulados ? AVISO_COBERTURA_SIMULADA : null,
        fonte_externa: externa,
        fontes: calc.fontes.map((f) => ({
          fonte: f.fonte,
          nome: f.nome,
          estado: f.estado,
          encontrados: f.candidatos.length,
          nota: f.nota,
          simulada: !!f.simulada,
        })),
        operadores,
        cell_broadcast: cellBroadcast,
        destinatarios: {
          total: calc.destinatarios.length,
          por_fonte: calc.por_fonte,
          so_desta_fonte: calc.so_desta_fonte,
          simulados: calc.simulados,
          reais: calc.destinatarios.length - calc.simulados,
          em_varias_fontes: calc.em_varias_fontes,
          vulneraveis: calc.destinatarios.filter((d) => d.vulneravel).length,
          so_telefone_fixo: calc.destinatarios.filter((d) => !d.sms).length,
          sem_contacto_possivel: calc.sem_contacto_possivel,
          limite: MAX_DESTINATARIOS,
        },
        sms: {
          ...plano.sms,
          texto: e.sms.texto,
          codificacao: e.sms.codificacao,
          ignora_recusas: true,
          ignora_horario: true,
        },
        chamadas: {
          ...plano.chamadas,
          vulneraveis: ligar.filter((d) => d.vulneravel).length,
          ignora_horario: true,
          guiao: e.guiao,
        },
        ritmo: plano.ritmo,
        tempo: plano.tempo,
        custo: plano.custo,
        amostra: calc.destinatarios.slice(0, AMOSTRA).map((d) => ({
          nome: mascararNome(d.nome),
          telefone: mascararTelefone(d.telefone_e164),
          fontes: d.fontes,
          vulneravel: d.vulneravel,
          simulado: d.simulado,
          zona_aproximada: d.zona_aproximada,
          sms: d.sms,
          ligado: ligar.includes(d),
        })),
      },
    };
  }

  /** O cell broadcast no plano: o modo, quantas pessoas na área, o que falta. */
  private async planoDifusao(m: Municipio, geometria: GeometriaEmergencia) {
    const cb = this.cellBroadcast();
    const base = this.fonteExterna().cell_broadcast;
    try {
      const e = await cb.estimar({ municipioId: m.id, zona: geometria });
      return {
        ...base,
        estado: 'ok' as const,
        pessoas_estimadas: e.com_telemovel,
        demonstracao: e.demonstracao,
        nota_estimativa: e.nota,
        // Sem preço de fonte certa: a confirmar no acordo.
        custo: null,
        custo_nota:
          'Custo do cell broadcast: a confirmar no acordo com a ANEPC / operadores.',
      };
    } catch (x) {
      return {
        ...base,
        estado: 'nao_configurada' as const,
        pessoas_estimadas: null,
        demonstracao: false,
        nota_estimativa: (x as Error).message,
        custo: null,
        custo_nota:
          'Custo do cell broadcast: a confirmar no acordo com a ANEPC / operadores.',
      };
    }
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  /** Cria o rascunho (ou, com `simular: true`, só devolve o plano). */
  async criar(m: Municipio, u: UtilizadorPainel, e: NovaEmergencia) {
    const { instrucoes, guiao, sms } = this.textos(m, e);
    const { lista, csv } = this.lista(e);
    const geometria = geometriaEmergencia(e.zona);
    const zonaDescricao = descreverZonaEmergencia(e.zona);
    const politica = e.chamadas ?? politicaPorGravidade(e.gravidade);
    const { calc, resposta } = await this.plano(m, {
      gravidade: e.gravidade,
      politica,
      geometria,
      zona_descricao: zonaDescricao,
      fontes: e.fontes,
      cell_broadcast: e.cell_broadcast,
      lista,
      sms,
      guiao,
    });
    const simulacao = { ...resposta, lista_csv: csv };
    if (e.simular) {
      await this.auditoria.registar({
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'simular_emergencia',
        objetoTipo: 'emergencias_config',
        objetoId: m.id,
        dados: {
          tipo: e.tipo,
          gravidade: e.gravidade,
          destinatarios: calc.destinatarios.length,
          simulados: calc.simulados,
          cell_broadcast: e.cell_broadcast,
          guardada: false,
        },
      });
      return simulacao;
    }
    const valida = e.valida_ate ?? new Date(Date.now() + 24 * 3_600_000);
    const id = await this.db.transaction(async (tx) => {
      const [r] = await tx.query<{ id: string }>(
        `INSERT INTO emergencias (municipio_id, tipo, gravidade, titulo, mensagem_sms, guiao,
           instrucoes, numero_emergencia, zona, geometria, zona_descricao, valida_ate, chamadas,
           fontes, lista_manual, destinatarios_previstos, criada_por, cell_broadcast)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          m.id,
          e.tipo,
          e.gravidade,
          e.titulo,
          e.mensagem_sms,
          JSON.stringify(guiao),
          instrucoes,
          e.numero_emergencia,
          JSON.stringify(e.zona),
          JSON.stringify(geometria),
          zonaDescricao,
          valida,
          politica,
          e.fontes,
          JSON.stringify(lista),
          calc.destinatarios.length,
          u.id,
          e.cell_broadcast,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar_emergencia',
          objetoTipo: 'emergencia',
          objetoId: r.id,
          dados: {
            tipo: e.tipo,
            gravidade: e.gravidade,
            destinatarios_previstos: calc.destinatarios.length,
            simulados: calc.simulados,
            cell_broadcast: e.cell_broadcast,
          },
        },
        tx,
      );
      return r.id;
    });
    return { ...(await this.detalhe(m, id)), simulacao };
  }

  private async obter(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    id: string,
    bloquear = false,
  ): Promise<LinhaEmergencia> {
    const [e] = await q.query<LinhaEmergencia>(
      `SELECT ${COLUNAS} ${DE} WHERE e.id = $1 AND e.municipio_id = $2
       ${bloquear ? 'FOR UPDATE OF e' : ''}`,
      [id, municipioId],
    );
    if (!e) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'emergencia_desconhecida',
        'Este aviso de emergência não existe.',
      );
    }
    return e;
  }

  private dadosDaLinha(m: Municipio, e: LinhaEmergencia) {
    const sms = textoSmsEmergencia({
      municipio: m.nome,
      gravidade: e.gravidade,
      mensagem: e.mensagem_sms,
      instrucoes: e.instrucoes,
      numero: e.numero_emergencia,
    });
    return {
      gravidade: e.gravidade,
      politica: e.chamadas,
      geometria: e.geometria,
      zona_descricao: e.zona_descricao,
      fontes: [
        ...new Set(
          e.fontes
            .map(fonteAtual)
            .filter((f): f is IdFonte =>
              (FONTES as readonly string[]).includes(f),
            ),
        ),
      ],
      cell_broadcast: e.cell_broadcast,
      lista: e.lista_manual,
      sms,
      guiao: e.guiao,
    };
  }

  async listar(m: Municipio) {
    await this.sincronizar(m.id);
    const linhas = await this.db.query<
      LinhaEmergencia & {
        total: number;
        precisa_ajuda: number;
        em_seguranca: number;
        por_tratar: number;
        simulados: number;
      }
    >(
      `SELECT ${COLUNAS},
         (SELECT count(*)::int FROM emergencia_destinatarios d WHERE d.emergencia_id = e.id) AS total,
         (SELECT count(*)::int FROM emergencia_destinatarios d WHERE d.emergencia_id = e.id AND d.resposta = 'precisa_ajuda') AS precisa_ajuda,
         (SELECT count(*)::int FROM emergencia_destinatarios d WHERE d.emergencia_id = e.id AND d.resposta = 'em_seguranca') AS em_seguranca,
         (SELECT count(*)::int FROM emergencia_destinatarios d WHERE d.emergencia_id = e.id AND d.resposta = 'precisa_ajuda' AND d.tratado_em IS NULL) AS por_tratar,
         (SELECT count(*)::int FROM emergencia_destinatarios d WHERE d.emergencia_id = e.id AND d.simulado) AS simulados
       ${DE} WHERE e.municipio_id = $1
       ORDER BY (e.estado = 'ativa') DESC, e.criada_em DESC LIMIT 50`,
      [m.id],
    );
    return {
      aviso_cobertura: AVISO_COBERTURA,
      emergencias: linhas.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        gravidade: l.gravidade,
        titulo: l.titulo,
        zona_descricao: l.zona_descricao,
        estado: l.estado,
        chamadas: l.chamadas,
        fontes: l.fontes.map(fonteAtual),
        cell_broadcast: l.cell_broadcast,
        destinatarios_previstos: l.destinatarios_previstos,
        criada_em: l.criada_em,
        enviada_em: l.enviada_em,
        encerrada_em: l.encerrada_em,
        valida_ate: l.valida_ate,
        resumo: {
          total: l.total,
          precisa_ajuda: l.precisa_ajuda,
          em_seguranca: l.em_seguranca,
          por_tratar: l.por_tratar,
          simulados: l.simulados,
        },
      })),
    };
  }

  /** O acompanhamento: contagens, quem precisa de ajuda, de onde veio cada número. */
  async detalhe(m: Municipio, id: string) {
    await this.sincronizar(m.id);
    const e = await this.obter(this.db, m.id, id);
    const dest = await this.db.query<{
      id: string;
      telefone_e164: string;
      nome: string | null;
      fontes: IdFonte[];
      vulneravel: boolean;
      simulado: boolean;
      zona_aproximada: string | null;
      sms_estado: string | null;
      sms_simulado: boolean | null;
      sms_fornecedor: string | null;
      sms_em: Date | null;
      chamada_estado: string | null;
      chamada_simulada: boolean;
      chamada_em: Date | null;
      resposta: 'em_seguranca' | 'precisa_ajuda' | null;
      ajuda: string[];
      nota: string | null;
      respondido_em: Date | null;
      alertado_em: Date | null;
      tratado_em: Date | null;
      tratado_nota: string | null;
      tratado_por_nome: string | null;
    }>(
      `SELECT d.id, d.telefone_e164, d.nome, d.fontes, d.vulneravel, d.simulado, d.zona_aproximada,
              ms.estado::text AS sms_estado, ms.simulado AS sms_simulado, ms.provider_id AS sms_fornecedor, d.sms_em,
              cd.estado AS chamada_estado, d.chamada_simulada, d.chamada_em,
              d.resposta, d.ajuda, coalesce(d.nota, cd.nota) AS nota, d.respondido_em,
              d.alertado_em, d.tratado_em, d.tratado_nota, ut.nome AS tratado_por_nome
       FROM emergencia_destinatarios d
       LEFT JOIN mensagens_saida ms ON ms.id = d.sms_id
       LEFT JOIN campanha_destinatarios cd ON cd.id = d.campanha_destinatario_id
       LEFT JOIN utilizadores ut ON ut.id = d.tratado_por
       WHERE d.emergencia_id = $1
       ORDER BY (d.resposta = 'precisa_ajuda') DESC NULLS LAST, d.tratado_em NULLS FIRST,
                d.vulneravel DESC, d.nome NULLS LAST, d.telefone_e164`,
      [id],
    );
    const comResultado = dest.map((d) => ({
      ...d,
      resultado: resultadoDe({
        resposta: d.resposta,
        chamada: d.chamada_estado,
        sms: d.sms_estado,
      }),
    }));
    const porFonte = Object.fromEntries(FONTES.map((f) => [f, 0])) as Record<
      IdFonte,
      number
    >;
    const resultadosPorFonte = Object.fromEntries(
      FONTES.map((f) => [f, [] as Resultado[]]),
    ) as Record<IdFonte, Resultado[]>;
    for (const d of comResultado) {
      for (const f0 of d.fontes) {
        const f = fonteAtual(f0) as IdFonte;
        if (!(f in porFonte)) continue;
        porFonte[f]++;
        resultadosPorFonte[f].push(d.resultado);
      }
    }
    const simulados = comResultado.filter((d) => d.simulado);
    const ajuda = comResultado.filter((d) => d.resultado === 'precisa_ajuda');
    const difusao = await this.difusao(m.id, id);
    return {
      id: e.id,
      tipo: e.tipo,
      tipo_nome: NOMES_TIPO[e.tipo],
      gravidade: e.gravidade,
      titulo: e.titulo,
      mensagem_sms: e.mensagem_sms,
      sms_texto: this.dadosDaLinha(m, e).sms.texto,
      guiao: e.guiao,
      instrucoes: e.instrucoes,
      numero_emergencia: e.numero_emergencia,
      zona: e.zona,
      zona_descricao: e.zona_descricao,
      valida_ate: e.valida_ate,
      chamadas: e.chamadas,
      fontes: e.fontes.map(fonteAtual),
      cell_broadcast: e.cell_broadcast,
      lista_manual: e.lista_manual.length,
      estado: e.estado,
      destinatarios_previstos: e.destinatarios_previstos,
      campanha_id: e.campanha_id,
      criada_por_nome: e.criada_por_nome,
      criada_em: e.criada_em,
      enviada_em: e.enviada_em,
      enviada_por_nome: e.enviada_por_nome,
      encerrada_em: e.encerrada_em,
      encerrada_nota: e.encerrada_nota,
      aviso_cobertura: AVISO_COBERTURA,
      aviso_simulado: simulados.length ? AVISO_COBERTURA_SIMULADA : null,
      fonte_externa: this.fonteExterna(),
      contagens: contarResultados(comResultado.map((d) => d.resultado)),
      por_fonte: porFonte,
      // Contagens por fonte e por estado (um número em duas fontes conta nas duas).
      por_fonte_estado: Object.fromEntries(
        FONTES.map((f) => [f, contarResultados(resultadosPorFonte[f])]),
      ) as Record<IdFonte, ReturnType<typeof contarResultados>>,
      // Os números simulados: gravados como enviados (simulado), nunca enviados.
      simulados: {
        total: simulados.length,
        sms_enviados_simulado: simulados.filter(
          (d) => d.sms_simulado && d.sms_estado === 'enviada',
        ).length,
        sms_por_sair: simulados.filter(
          (d) => d.sms_estado === 'agendada' || d.sms_estado === 'pendente',
        ).length,
        chamadas_simuladas: simulados.filter((d) => d.chamada_simulada).length,
        // Tem de ser sempre 0 (a BD também o garante, migração 0072).
        enviados_ao_fornecedor: simulados.filter(
          (d) => d.sms_fornecedor && d.sms_fornecedor !== 'simulado',
        ).length,
      },
      cell_broadcast_difusao: difusao,
      // Quem precisa de ajuda: o número inteiro, para a câmara ligar de volta.
      precisa_ajuda: ajuda.map((d) => ({
        id: d.id,
        nome: d.nome,
        telefone: d.telefone_e164,
        fontes: d.fontes,
        vulneravel: d.vulneravel,
        ajuda: d.ajuda,
        nota: d.nota,
        respondido_em: d.respondido_em,
        alertado_em: d.alertado_em,
        tratado_em: d.tratado_em,
        tratado_nota: d.tratado_nota,
        tratado_por_nome: d.tratado_por_nome,
      })),
      destinatarios: comResultado.slice(0, MAX_LISTA_PAINEL).map((d) => ({
        id: d.id,
        nome: mascararNome(d.nome),
        telefone: mascararTelefone(d.telefone_e164),
        fontes: d.fontes.map(fonteAtual),
        vulneravel: d.vulneravel,
        simulado: d.simulado,
        zona_aproximada: d.zona_aproximada,
        chamada_simulada: d.chamada_simulada,
        resultado: d.resultado,
        sms_em: d.sms_em,
        chamada_em: d.chamada_em,
      })),
      destinatarios_total: dest.length,
    };
  }

  /**
   * `simular: true` → o plano (nada sai). Senão envia, com dupla
   * confirmação: `confirmo_destinatarios` igual ao número calculado agora e
   * `confirmo_texto` = "ENVIAR".
   */
  async enviar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaEnviar>,
  ) {
    if (b.simular) {
      const e = await this.obter(this.db, m.id, id);
      const { calc, resposta } = await this.plano(m, this.dadosDaLinha(m, e));
      await this.auditoria.registar({
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'simular_emergencia',
        objetoTipo: 'emergencia',
        objetoId: id,
        dados: { destinatarios: calc.destinatarios.length, guardada: true },
      });
      return resposta;
    }
    if (
      b.confirmo_destinatarios === undefined ||
      b.confirmo_texto !== 'ENVIAR'
    ) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'falta_confirmacao',
        'Para enviar confirme o número de pessoas e escreva ENVIAR.',
      );
    }
    const config = await this.obterConfig(m);
    const cb = this.cellBroadcast();
    await this.db.transaction(async (tx) => {
      const e = await this.obter(tx, m.id, id, true);
      if (e.cell_broadcast && cb.emFalta().length) {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'cell_broadcast_por_configurar',
          `${MENSAGEM_POR_CONFIGURAR_CELL_BROADCAST} Tire o cell broadcast para enviar só pelos números.`,
          { em_falta: cb.emFalta() },
        );
      }
      if (e.estado !== 'rascunho') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'Este aviso de emergência já foi enviado ou encerrado.',
          { estado: e.estado },
        );
      }
      const dados = this.dadosDaLinha(m, e);
      const calc = await this.calcular(m, dados, tx);
      const n = calc.destinatarios.length;
      if (b.confirmo_destinatarios !== n) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'confirmacao_diferente',
          `O aviso vai para ${n} números, não ${b.confirmo_destinatarios}. Reveja e confirme o número certo.`,
          { destinatarios: n, confirmados: b.confirmo_destinatarios },
        );
      }
      if (!n && !e.cell_broadcast) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'sem_destinatarios',
          'Não há nenhum número conhecido nesta zona a quem avisar.',
        );
      }
      if (n > MAX_DESTINATARIOS) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'demasiados_destinatarios',
          `Mais de ${MAX_DESTINATARIOS} números: peça à equipa Tou, Câmara? para enviar.`,
        );
      }
      const inicio = new Date();
      // 1. A lista fica fixa, com a fonte de cada número e a marca dos simulados.
      const inseridos = await tx.query<{ id: string; telefone_e164: string }>(
        `INSERT INTO emergencia_destinatarios (emergencia_id, telefone_e164, municipe_id, nome, fontes,
           vulneravel, simulado, zona_aproximada)
         SELECT $1, x.telefone_e164, x.municipe_id, x.nome, x.fontes, x.vulneravel, x.simulado,
                x.zona_aproximada
         FROM jsonb_to_recordset($2::jsonb)
           AS x(telefone_e164 text, municipe_id uuid, nome text, fontes text[], vulneravel boolean,
                simulado boolean, zona_aproximada text)
         RETURNING id, telefone_e164`,
        [
          id,
          JSON.stringify(
            calc.destinatarios.map((d) => ({
              telefone_e164: d.telefone_e164,
              municipe_id: d.simulado ? null : d.municipe_id,
              nome: d.simulado ? null : d.nome,
              fontes: d.fontes,
              vulneravel: d.vulneravel,
              simulado: d.simulado,
              zona_aproximada: d.zona_aproximada,
            })),
          ),
        ],
      );
      const idDe = new Map(inseridos.map((r) => [r.telefone_e164, r.id]));

      // 2. SMS a todos com telemóvel, ao ritmo configurado (ignora o opt-out e o horário).
      // Os simulados vão no fim, marcados: ficam gravados, nunca saem.
      const comSms = calc.destinatarios.filter((d) => d.sms);
      for (const [i, d] of comSms.entries()) {
        const em = instanteDoEnvio(i, config.sms_por_minuto, inicio);
        const smsId = await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: d.simulado ? null : d.municipe_id,
            destino: d.telefone_e164,
            motivo: 'aviso',
            corpo: dados.sms.texto,
            relacionado: d.simulado
              ? { emergencia_id: id, simulado: 'true' }
              : { emergencia_id: id },
            chave: `emergencia:${id}:${d.telefone_e164}`,
            enviarEm: em.getTime() > inicio.getTime() ? em : undefined,
            simulado: d.simulado,
          },
          tx,
        );
        await tx.query(
          `UPDATE emergencia_destinatarios SET sms_id = $2, sms_em = $3 WHERE id = $1`,
          [idDe.get(d.telefone_e164), smsId, em],
        );
      }

      // 3. Chamadas do agente (campanha sem janela de horário), ao ritmo configurado.
      // Os números simulados NUNCA entram na campanha (nem viram munícipes):
      // a chamada fica só registada (chamada_simulada), no fim da fila.
      const todosALigar = aLigar(calc.destinatarios, e.chamadas);
      const ligar = todosALigar.filter((d) => !d.simulado);
      const ligarSimulados = todosALigar.filter((d) => d.simulado);
      let campanhaId: string | null = null;
      if (ligarSimulados.length) {
        await tx.query(
          `UPDATE emergencia_destinatarios ed SET chamada_simulada = true, chamada_em = x.em
           FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, em timestamptz)
           WHERE ed.id = x.id AND ed.emergencia_id = $1 AND ed.simulado`,
          [
            id,
            JSON.stringify(
              ligarSimulados.map((d, j) => ({
                id: idDe.get(d.telefone_e164),
                em: instanteDoEnvio(
                  ligar.length + j,
                  config.chamadas_por_minuto,
                  inicio,
                ).toISOString(),
              })),
            ),
          ],
        );
      }
      if (ligar.length) {
        const alvo: AlvoCampanha[] = [];
        for (const d of ligar) {
          const municipeId =
            d.municipe_id ??
            (await this.municipes.porTelefone(m.id, d.telefone_e164, tx))?.id;
          if (!municipeId) continue;
          d.municipe_id = municipeId;
          alvo.push({
            contacto_id: null,
            municipe_id: municipeId,
            telefone: d.telefone_e164,
            aceita_chamadas: true,
            nota: `AVISO DE EMERGÊNCIA (${e.gravidade}): ${e.titulo}. O que fazer: ${e.instrucoes} Se a pessoa estiver em perigo imediato, diz para ligar já ${e.numero_emergencia}. No fim, grava com resposta_emergencia (em_seguranca ou precisa_ajuda).`,
          });
        }
        const c = await this.campanhas.lancar(
          tx,
          m,
          u,
          {
            tipo: TIPO_CAMPANHA[e.tipo],
            titulo: `Emergência: ${e.titulo}`.slice(0, 120),
            mensagem: `${e.guiao.dizer}`.slice(0, 600),
            perguntas: e.guiao.perguntas,
            sms_recurso:
              `CM ${m.nome}: ligamos por causa do aviso de emergencia "${e.titulo}". Se precisar de ajuda responda a esta mensagem ou ligue ${e.numero_emergencia}.`.slice(
                0,
                320,
              ),
            freguesias: undefined,
            ignorar_horario: true,
          },
          alvo,
          inicio,
        );
        campanhaId = c.id;
        const cds = await tx.query<{
          id: string;
          municipe_id: string;
          chamada_saida_id: string | null;
        }>(
          `SELECT id, municipe_id, chamada_saida_id FROM campanha_destinatarios WHERE campanha_id = $1`,
          [c.id],
        );
        const porMunicipe = new Map(cds.map((x) => [x.municipe_id, x]));
        const horarios: { id: string; em: string }[] = [];
        for (const [i, d] of ligar.entries()) {
          const cd = d.municipe_id ? porMunicipe.get(d.municipe_id) : undefined;
          if (!cd) continue;
          const em = instanteDoEnvio(i, config.chamadas_por_minuto, inicio);
          await tx.query(
            `UPDATE emergencia_destinatarios
             SET campanha_destinatario_id = $2, chamada_em = $3,
                 municipe_id = coalesce(municipe_id, $4)
             WHERE id = $1`,
            [idDe.get(d.telefone_e164), cd.id, em, d.municipe_id],
          );
          if (cd.chamada_saida_id)
            horarios.push({ id: cd.chamada_saida_id, em: em.toISOString() });
        }
        await tx.query(
          `UPDATE chamadas_saida cs SET agendada_para = x.em
           FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, em timestamptz)
           WHERE cs.id = x.id`,
          [JSON.stringify(horarios)],
        );
      }

      await tx.query(
        `UPDATE emergencias SET estado = 'ativa', enviada_por = $2, enviada_em = now(),
           campanha_id = $3, destinatarios_previstos = $4
         WHERE id = $1`,
        [id, u.id, campanhaId, n],
      );

      // 4. Cell broadcast: a área e o texto (o pedido sai depois do COMMIT).
      if (e.cell_broadcast) {
        const est = await cb
          .estimar({ municipioId: m.id, zona: e.geometria })
          .catch(() => null);
        await tx.query(
          `INSERT INTO emergencia_difusoes (municipio_id, emergencia_id, modo, simulado, area,
             zona_descricao, texto, pessoas_estimadas)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            m.id,
            id,
            cb.modo,
            cb.simulada,
            JSON.stringify(e.geometria),
            e.zona_descricao,
            dados.sms.texto,
            est?.com_telemovel ?? null,
          ],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'enviar_emergencia',
          objetoTipo: 'emergencia',
          objetoId: id,
          dados: {
            gravidade: e.gravidade,
            destinatarios: n,
            sms: comSms.length,
            chamadas: todosALigar.length,
            por_fonte: calc.por_fonte,
            simulados: {
              destinatarios: calc.simulados,
              sms: comSms.filter((d) => d.simulado).length,
              chamadas: ligarSimulados.length,
            },
            cell_broadcast: e.cell_broadcast
              ? { modo: cb.modo, simulado: cb.simulada }
              : null,
            campanha_id: campanhaId,
            ignora_recusas: true,
            ignora_horario: true,
          },
        },
        tx,
      );
    });
    await this.avisarNaApp(m, id);
    await this.pedirDifusao(m, u, id, cb);
    return this.detalhe(m, id);
  }

  /** Depois do COMMIT: pede o cell broadcast (se a emergência o tiver). */
  private async pedirDifusao(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    cb: CellBroadcast,
  ): Promise<void> {
    const [d] = await this.db.query<
      LinhaDifusao & { valida_ate: Date; geometria: GeometriaEmergencia }
    >(
      `SELECT d.id, d.modo, d.simulado, d.estado, d.texto, e.valida_ate, e.geometria
       FROM emergencia_difusoes d JOIN emergencias e ON e.id = d.emergencia_id
       WHERE d.emergencia_id = $1 AND d.municipio_id = $2 AND d.estado = 'por_pedir'`,
      [id, m.id],
    );
    if (!d) return;
    let r: EstadoDaDifusao;
    try {
      r = await cb.pedir({
        municipioId: m.id,
        zona: d.geometria,
        referencia: id,
        texto: d.texto,
        validaAte: d.valida_ate,
      });
    } catch (x) {
      r = {
        estado: 'erro',
        referencia_externa: null,
        iniciada_em: null,
        concluida_em: null,
        erro: (x as Error).message.slice(0, 500),
      };
    }
    await this.db.query(
      `UPDATE emergencia_difusoes SET estado = $2, referencia_externa = $3, pedida_em = now(),
         iniciada_em = $4, concluida_em = $5, erro = $6, atualizada_em = now()
       WHERE id = $1`,
      [
        d.id,
        r.estado,
        r.referencia_externa,
        r.iniciada_em,
        r.concluida_em,
        r.erro,
      ],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'pedir_cell_broadcast',
      objetoTipo: 'emergencia',
      objetoId: id,
      dados: {
        modo: d.modo,
        simulado: d.simulado,
        estado: r.estado,
        referencia: r.referencia_externa,
      },
    });
  }

  /** O adaptador da difusão guardada (a simulada fica sempre simulada). */
  private adaptadorDifusao(d: Pick<LinhaDifusao, 'modo'>): CellBroadcast {
    return d.modo === 'simulada'
      ? new CellBroadcastSimulado()
      : this.cellBroadcast();
  }

  /** A difusão (cell broadcast) da emergência, com o estado atualizado. */
  private async difusao(municipioId: string, id: string) {
    const [d] = await this.db.query<LinhaDifusao>(
      `SELECT id, modo, simulado, estado, zona_descricao, texto, pessoas_estimadas,
              referencia_externa, pedida_em, iniciada_em, concluida_em, erro
       FROM emergencia_difusoes WHERE emergencia_id = $1 AND municipio_id = $2`,
      [id, municipioId],
    );
    if (!d) return null;
    if ((d.estado === 'pedida' || d.estado === 'em_difusao') && d.pedida_em) {
      try {
        const r = await this.adaptadorDifusao(d).consultar({
          referencia_externa: d.referencia_externa,
          pedida_em: d.pedida_em,
        });
        if (r.estado !== d.estado) {
          await this.db.query(
            `UPDATE emergencia_difusoes SET estado = $2, iniciada_em = $3, concluida_em = $4,
               atualizada_em = now() WHERE id = $1`,
            [d.id, r.estado, r.iniciada_em, r.concluida_em],
          );
          Object.assign(d, {
            estado: r.estado,
            iniciada_em: r.iniciada_em,
            concluida_em: r.concluida_em,
          });
        }
      } catch (x) {
        this.logger.warn(
          `Estado do cell broadcast ${d.id}: ${(x as Error).message}`,
        );
      }
    }
    return { ...d, demonstracao: d.simulado };
  }

  /**
   * Depois do COMMIT do envio: push imediato (canal urgente) para quem está
   * na lista e tem a app. Não espera pelo ritmo dos SMS.
   */
  private async avisarNaApp(m: Municipio, id: string): Promise<void> {
    if (!this.push) return;
    const [e] = await this.db.query<{
      titulo: string;
      mensagem_sms: string;
      instrucoes: string;
      numero_emergencia: string;
    }>(
      `SELECT titulo, mensagem_sms, instrucoes, numero_emergencia
       FROM emergencias WHERE id = $1 AND municipio_id = $2`,
      [id, m.id],
    );
    if (!e) return;
    const ids = await this.db.query<{ municipe_id: string }>(
      `SELECT DISTINCT municipe_id FROM emergencia_destinatarios
       WHERE emergencia_id = $1 AND municipe_id IS NOT NULL`,
      [id],
    );
    const pontuar = (t: string) => {
      const x = t.trim();
      return x && !/[.!?]$/.test(x) ? `${x}.` : x;
    };
    await this.push.enfileirar(
      ids.map((r) => r.municipe_id),
      {
        tipo: 'urgente',
        titulo: `Emergência: ${e.titulo}`,
        corpo: [
          pontuar(e.mensagem_sms),
          e.instrucoes ? pontuar(e.instrucoes) : '',
          `Perigo imediato: ligue ${e.numero_emergencia}.`,
        ]
          .filter(Boolean)
          .join(' '),
        link: '/avisos',
        id,
        origem: 'emergencia',
        chave: `emergencia:${id}`,
      },
    );
  }

  /**
   * Encerrar: a emergência acabou. Cancela as chamadas que ainda não tocaram
   * e os SMS que ainda não saíram. Um rascunho fica 'cancelada'.
   */
  async encerrar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaEncerrar>,
  ) {
    const e = await this.obter(this.db, m.id, id);
    if (e.estado !== 'rascunho' && e.estado !== 'ativa') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'estado_invalido',
        'Este aviso de emergência já está encerrado.',
        { estado: e.estado },
      );
    }
    let chamadas = 0;
    if (e.campanha_id) {
      const r = await this.campanhas.cancelar(m, u, e.campanha_id);
      chamadas = ('chamadas_canceladas' in r ? r.chamadas_canceladas : 0) ?? 0;
    }
    await this.db.transaction(async (tx) => {
      const sms = await tx.query<{ id: string }>(
        `UPDATE mensagens_saida SET estado = 'falhou', erro = 'Emergência encerrada antes do envio.'
         WHERE estado = 'agendada' AND relacionado->>'emergencia_id' = $1 RETURNING id`,
        [id],
      );
      const difusoes = await tx.query<{ id: string }>(
        `UPDATE emergencia_difusoes SET estado = 'cancelada', atualizada_em = now()
         WHERE emergencia_id = $1 AND estado IN ('por_pedir','pedida','em_difusao') AND simulado
         RETURNING id`,
        [id],
      );
      await tx.query(
        `UPDATE emergencias SET estado = $2, encerrada_por = $3, encerrada_em = now(), encerrada_nota = $4
         WHERE id = $1`,
        [
          id,
          e.estado === 'rascunho' ? 'cancelada' : 'encerrada',
          u.id,
          b.nota ?? null,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'encerrar_emergencia',
          objetoTipo: 'emergencia',
          objetoId: id,
          dados: {
            estado_anterior: e.estado,
            chamadas_canceladas: chamadas,
            sms_cancelados: sms.length,
            cell_broadcast_cancelado: difusoes.length > 0,
          },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  /** A câmara tratou um pedido de ajuda. */
  async tratar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    destId: string,
    b: z.output<typeof esquemaTratar>,
  ) {
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE emergencia_destinatarios d
       SET tratado_em = now(), tratado_por = $4, tratado_nota = $5
       FROM emergencias e
       WHERE d.id = $1 AND d.emergencia_id = $2 AND e.id = d.emergencia_id AND e.municipio_id = $3
       RETURNING d.id`,
      [destId, id, m.id, u.id, b.nota ?? null],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'destinatario_desconhecido',
        'Esta pessoa não está neste aviso.',
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'tratar_pedido_ajuda_emergencia',
      objetoTipo: 'emergencia',
      objetoId: id,
      dados: { destinatario_id: destId },
    });
    return { tratado: true };
  }

  // -------------------------------------------------------------------
  // Ferramenta do agente
  // -------------------------------------------------------------------

  /**
   * `resposta_emergencia`: numa chamada do aviso (pela conversa) ou, se a
   * pessoa ligou ou escreveu ela própria, pelo telefone/munícipe numa
   * emergência ativa. Grava, atualiza a campanha e alerta já.
   */
  async resposta(ctx: ContextoFerramenta, e: z.output<typeof entradaResposta>) {
    const m = ctx.municipio;
    let [d] = ctx.conversaId
      ? await this.db.query<{
          id: string;
          cd: string | null;
          emergencia_id: string;
        }>(
          `SELECT ed.id, ed.campanha_destinatario_id AS cd, ed.emergencia_id
           FROM emergencia_destinatarios ed
           JOIN emergencias em ON em.id = ed.emergencia_id
           JOIN campanha_destinatarios cd ON cd.id = ed.campanha_destinatario_id
           JOIN chamadas_saida cs ON cs.id = cd.chamada_saida_id
           JOIN conversas cv ON cv.provider_id = cs.provider_conversa_ref
           WHERE cv.id = $1 AND em.municipio_id = $2`,
          [ctx.conversaId, m.id],
        )
      : [];
    if (!d && (ctx.telefone || ctx.municipeId)) {
      [d] = await this.db.query<{
        id: string;
        cd: string | null;
        emergencia_id: string;
      }>(
        `SELECT ed.id, ed.campanha_destinatario_id AS cd, ed.emergencia_id
         FROM emergencia_destinatarios ed JOIN emergencias em ON em.id = ed.emergencia_id
         WHERE em.municipio_id = $1 AND em.estado = 'ativa'
           AND (ed.telefone_e164 = $2 OR ed.municipe_id = $3)
         ORDER BY em.enviada_em DESC LIMIT 1`,
        [m.id, ctx.telefone, ctx.municipeId],
      );
    }
    if (!d) {
      return {
        gravado: false,
        instrucao:
          'Não há nenhum aviso de emergência ativo para esta pessoa. Se estiver em perigo, diz para ligar já 112; senão segue o atendimento normal.',
      };
    }
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE emergencia_destinatarios
         SET resposta = $2, ajuda = $3, nota = $4, respondido_em = now()
         WHERE id = $1`,
        [d.id, e.estado, e.ajuda, e.nota ?? null],
      );
      if (d.cd) {
        await tx.query(
          `UPDATE campanha_destinatarios
           SET estado = $2, necessidades = $3, nota = $4, respondido_em = now()
           WHERE id = $1`,
          [
            d.cd,
            e.estado === 'precisa_ajuda' ? 'precisa_ajuda' : 'bem',
            necessidadesCampanha(e.ajuda),
            e.nota ?? null,
          ],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          atorId: null,
          acao: 'responder_emergencia',
          objetoTipo: 'emergencia',
          objetoId: d.emergencia_id,
          dados: { destinatario_id: d.id, estado: e.estado, canal: ctx.canal },
        },
        tx,
      );
    });
    if (e.estado === 'precisa_ajuda') await this.alertarPendentes(m.id);
    return {
      gravado: true,
      dizer:
        e.estado === 'precisa_ajuda'
          ? 'Já passei o seu pedido à câmara e à proteção civil municipal: vão contactá-lo o mais depressa possível. Se estiver em perigo imediato, ligue já 112.'
          : 'Ainda bem que está em segurança. Siga as indicações das autoridades e, se precisar de ajuda, ligue 112.',
    };
  }

  // -------------------------------------------------------------------
  // Seguimento (job a cada minuto, e cada vez que o painel abre)
  // -------------------------------------------------------------------

  /**
   * Traz as respostas dadas pela ferramenta da campanha (resposta_campanha)
   * e o resultado das chamadas, alerta quem precisa de ajuda e encerra as
   * emergências fora de validade.
   */
  async sincronizar(municipioId: string): Promise<void> {
    await this.campanhas.sincronizar(municipioId);
    await this.db.query(
      `UPDATE emergencia_destinatarios ed
       SET resposta = CASE cd.estado WHEN 'bem' THEN 'em_seguranca' ELSE 'precisa_ajuda' END,
           nota = coalesce(ed.nota, cd.nota),
           respondido_em = coalesce(cd.respondido_em, now())
       FROM campanha_destinatarios cd, emergencias e
       WHERE cd.id = ed.campanha_destinatario_id AND e.id = ed.emergencia_id
         AND e.municipio_id = $1 AND ed.resposta IS NULL
         AND cd.estado IN ('bem','precisa_ajuda')`,
      [municipioId],
    );
    await this.alertarPendentes(municipioId);
    const expiradas = await this.db.query<{ id: string }>(
      `UPDATE emergencias SET estado = 'encerrada', encerrada_em = now(),
         encerrada_nota = 'Encerrada automaticamente: passou a validade.'
       WHERE municipio_id = $1 AND estado = 'ativa' AND valida_ate < now() RETURNING id`,
      [municipioId],
    );
    for (const x of expiradas) {
      await this.auditoria.registar({
        municipioId,
        atorTipo: 'sistema',
        atorId: null,
        acao: 'encerrar_emergencia',
        objetoTipo: 'emergencia',
        objetoId: x.id,
        dados: { motivo: 'validade' },
      });
    }
  }

  /** O job: todos os municípios com emergências ativas. */
  async processar(): Promise<void> {
    const ms = await this.db.query<{ municipio_id: string }>(
      `SELECT DISTINCT municipio_id FROM emergencias WHERE estado = 'ativa'`,
    );
    for (const { municipio_id } of ms) {
      try {
        await this.sincronizar(municipio_id);
      } catch (e) {
        this.logger.error(
          `Seguimento das emergências (${municipio_id}): ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * "Precisa de ajuda" ainda sem alerta: um email às chefias (chefes de
   * divisão ativos) e à proteção civil municipal configurada. Uma vez por
   * pessoa (`alertado_em`); fica registado em `mensagens_saida`.
   */
  async alertarPendentes(municipioId: string): Promise<number> {
    const pendentes = await this.db.query<{
      id: string;
      emergencia_id: string;
      titulo: string;
      zona_descricao: string;
      nome: string | null;
      telefone_e164: string;
      ajuda: string[];
      nota: string | null;
      municipio: string;
    }>(
      `UPDATE emergencia_destinatarios ed SET alertado_em = now()
       FROM emergencias e, municipios mu
       WHERE e.id = ed.emergencia_id AND mu.id = e.municipio_id AND e.municipio_id = $1
         AND ed.resposta = 'precisa_ajuda' AND ed.alertado_em IS NULL
       RETURNING ed.id, ed.emergencia_id, e.titulo, e.zona_descricao, ed.nome, ed.telefone_e164,
                 ed.ajuda, ed.nota, mu.nome AS municipio`,
      [municipioId],
    );
    if (!pendentes.length) return 0;
    const [cfg] = await this.db.query<{
      protecao_civil_email: string | null;
      protecao_civil_nome: string | null;
    }>(
      `SELECT protecao_civil_email, protecao_civil_nome FROM emergencias_config WHERE municipio_id = $1`,
      [municipioId],
    );
    const destinos = await this.db.query<{ email: string; nome: string }>(
      `SELECT email::text AS email, nome FROM utilizadores
       WHERE municipio_id = $1 AND ativo AND perfil = 'chefe_divisao'`,
      [municipioId],
    );
    if (cfg?.protecao_civil_email) {
      destinos.push({
        email: cfg.protecao_civil_email,
        nome: cfg.protecao_civil_nome ?? 'Proteção Civil municipal',
      });
    }
    const web = this.config.get<string>('app.webUrl') ?? '';
    for (const p of pendentes) {
      const assunto = `URGENTE: pedido de ajuda — ${p.titulo}`;
      const texto = [
        `Numa chamada do aviso de emergência "${p.titulo}" (${p.zona_descricao}), uma pessoa disse que precisa de ajuda:`,
        '',
        `Nome: ${p.nome ?? 'não sabemos'}`,
        `Telefone: ${p.telefone_e164}`,
        p.ajuda.length ? `Ajuda: ${p.ajuda.join(', ').replace(/_/g, ' ')}` : '',
        p.nota ? `O que disse: ${p.nota}` : '',
        '',
        `Ver no painel: ${web}/painel/emergencias?id=${p.emergencia_id}`,
      ]
        .filter((x, i, a) => x || a[i - 1])
        .join('\n');
      for (const d of destinos) {
        await this.email(
          municipioId,
          d.email,
          `emergencia_alerta:${p.id}:${d.email.toLowerCase()}`,
          { emergencia_id: p.emergencia_id, emergencia_destinatario_id: p.id },
          assunto,
          `Olá ${d.nome},\n\n${texto}`,
        );
      }
      await this.auditoria.registar({
        municipioId,
        atorTipo: 'sistema',
        atorId: null,
        acao: 'alertar_pedido_ajuda_emergencia',
        objetoTipo: 'emergencia',
        objetoId: p.emergencia_id,
        dados: { destinatario_id: p.id, emails: destinos.length },
      });
    }
    return pendentes.length;
  }

  private async email(
    municipioId: string,
    para: string,
    chave: string,
    relacionado: Record<string, string>,
    assunto: string,
    texto: string,
  ): Promise<void> {
    const [msg] = await this.db.query<{ id: string; estado: string }>(
      `INSERT INTO mensagens_saida (municipio_id, canal, destino, motivo, corpo, relacionado, chave_idempotencia)
       VALUES ($1, 'email', $2, 'aviso', $3, $4, $5)
       ON CONFLICT (chave_idempotencia) DO UPDATE SET chave_idempotencia = EXCLUDED.chave_idempotencia
       RETURNING id, estado::text AS estado`,
      [municipioId, para, texto, JSON.stringify(relacionado), chave],
    );
    if (msg.estado === 'enviada' || msg.estado === 'entregue') return;
    try {
      await this.mensagens.email({ para, assunto, texto });
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'enviada', enviada_em = now(), erro = NULL WHERE id = $1`,
        [msg.id],
      );
    } catch (e) {
      await this.db.query(
        `UPDATE mensagens_saida SET estado = 'falhou', erro = $2 WHERE id = $1`,
        [msg.id, (e as Error).message],
      );
      this.logger.error(`Alerta de emergência falhou: ${(e as Error).message}`);
    }
  }
}
