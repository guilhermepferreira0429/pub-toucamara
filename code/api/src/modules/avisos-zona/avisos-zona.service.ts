import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import {
  DestinoLink,
  LinksCurtosService,
} from '../comunicacao/links-curtos.service.js';
import {
  MensagensService,
  MotivoMensagem,
} from '../comunicacao/mensagens.service.js';
import { mascararTelefone } from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import {
  Afetado,
  caixaDaZona,
  contarPorOrigem,
  deduplicar,
  dentroDaJanela,
  descreverZona,
  esquemaZona,
  EstadoAviso,
  ESTADOS_AVISO,
  Excluidos,
  Geometria,
  geometriaDaZona,
  JANELA_MORADAS_DIAS,
  mascararNome,
  MAX_DESTINATARIOS,
  MAX_SEGMENTOS,
  moradaAfetada,
  MoradaMunicipe,
  Origem,
  palavraChave,
  Ponto,
  proximaJanela,
  quandoEnviar,
  textoSms,
  TipoAviso,
  TIPOS_AVISO,
  VALIDADE_LINK_DIAS,
  Zona,
} from './avisos-zona.regras.js';

export const FILA_AVISOS = 'enviar_aviso_zona';
const LOTE = 200;
const AMOSTRA = 10;

const MOTIVO_AVISO: MotivoMensagem = 'aviso';
const LINK_AVISO: DestinoLink = 'aviso';

const esquemaDesde = z.coerce
  .date()
  .refine((d) => d.getTime() <= Date.now(), 'Não pode ser no futuro.')
  .optional();

export const esquemaPreVisualizar = z.object({
  zona: esquemaZona,
  desde: esquemaDesde,
});

export const esquemaNovoAviso = z.object({
  titulo: z.string().trim().min(3).max(120),
  mensagem: z.string().trim().min(3).max(480),
  tipo: z.enum(TIPOS_AVISO),
  zona: esquemaZona,
  desde: esquemaDesde,
  enviar_em: z.coerce.date().optional(),
});

export const esquemaEnviar = z.object({
  confirmo_destinatarios: z.number().int().min(0),
});

export const esquemaListaAvisos = esquemaPaginacao.extend({
  estado: z.enum(ESTADOS_AVISO).optional(),
});

interface LinhaAviso {
  id: string;
  municipio_id: string;
  titulo: string;
  mensagem: string;
  tipo: TipoAviso;
  zona: Zona;
  geometria: Geometria;
  zona_descricao: string;
  desde: Date;
  estado: EstadoAviso;
  destinatarios_previstos: number;
  enviar_em: Date | null;
  agendado_para: Date | null;
  criado_por: string | null;
  criado_em: Date;
  confirmado_por: string | null;
  confirmado_em: Date | null;
  terminado_em: Date | null;
  cancelado_por: string | null;
  cancelado_em: Date | null;
}

interface Contagens {
  destinatarios: number;
  por_enviar: number;
  enviados: number;
  entregues: number;
  falhados: number;
  /** Saíram dos avisos (ou foram anonimizados) entre a confirmação e o envio. */
  excluidos: number;
  cancelados: number;
}

const COLUNAS = `a.id, a.municipio_id, a.titulo, a.mensagem, a.tipo, a.zona, a.geometria,
  a.zona_descricao, a.desde, a.estado, a.destinatarios_previstos, a.enviar_em,
  a.agendado_para, a.criado_por, a.criado_em, a.confirmado_por, a.confirmado_em,
  a.terminado_em, a.cancelado_por, a.cancelado_em`;

/* Quantos destinatários em cada ponto (pelo estado da mensagem). */
const CONTAGENS = `
  SELECT count(*)::int AS destinatarios,
    count(*) FILTER (WHERE d.estado = 'por_enviar')::int AS por_enviar,
    count(*) FILTER (WHERE ms.estado IN ('enviada','entregue'))::int AS enviados,
    count(*) FILTER (WHERE ms.estado = 'entregue')::int AS entregues,
    count(*) FILTER (WHERE ms.estado = 'falhou')::int AS falhados,
    count(*) FILTER (WHERE d.estado = 'excluido')::int AS excluidos,
    count(*) FILTER (WHERE d.estado = 'cancelado')::int AS cancelados
  FROM avisos_zona_destinatarios d
  LEFT JOIN mensagens_saida ms ON ms.id = d.mensagem_id`;

const INTERNOS: readonly UtilizadorPainel['perfil'][] = [
  'admin',
  'equipa_toucamara',
];

export interface PreVisualizacao {
  destinatarios: number;
  por_origem: Record<Origem, number>;
  excluidos: Excluidos;
  /** Emergência: quem recusou avisos recebe na mesma. */
  ignora_recusas: boolean;
  amostra: {
    nome: string;
    telefone: string;
    rua: string | null;
    origens: Origem[];
  }[];
  zona: { descricao: string; ruas_sem_coordenadas: string[] };
  desde: string;
  limite: number;
}

/**
 * Avisos por zona: "corte de água na Rua X amanhã", só para quem é afetado,
 * e avisos de emergência em massa. Regras em avisos-zona.regras.ts.
 *
 * Fluxo: criar (rascunho, com a pré-visualização) → enviar com
 * `confirmo_destinatarios` igual ao número calculado (senão 409) → a lista
 * fica fixa e o job `enviar_aviso_zona` manda em lotes de 200 pela
 * `MensagensService.sms` (chave `aviso:<aviso>:<munícipe>`), cada SMS com o
 * link para a página pública do aviso (um por destinatário: o "deixar de
 * receber" sabe quem é).
 */
@Injectable()
export class AvisosZonaService {
  private readonly logger = new Logger(AvisosZonaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly geo: GeocodificacaoService,
    private readonly mensagens: MensagensService,
    private readonly links: LinksCurtosService,
    private readonly jobs: JobsService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------
  // Zona e afetados
  // -------------------------------------------------------------------

  /** A zona pedida → geometria (as ruas geocodificadas ao centro). */
  async resolverZona(m: Municipio, zona: Zona): Promise<Geometria> {
    const centros = new Map<string, Ponto | null>();
    if (zona.tipo === 'ruas') {
      // Em série: o Nominatim pede no máximo um pedido por segundo.
      for (const rua of zona.ruas) {
        const c = await this.geo.geocodificar(rua, m.nome);
        centros.set(rua, c ? { lat: c.lat, lng: c.lng } : null);
      }
    }
    return geometriaDaZona(zona, centros);
  }

  /**
   * Munícipes com uma morada na zona (processos, ocorrências, recolhas e
   * requerimentos desde `desde`). O SQL filtra pela caixa da zona e pela
   * palavra mais distintiva das ruas; o teste exato é em JS (regras).
   */
  async afetados(
    m: Municipio,
    g: Geometria,
    desde: Date,
    tipo: TipoAviso | null,
    q: Tx | DatabaseService = this.db,
  ): Promise<{ afetados: Afetado[]; excluidos: Excluidos }> {
    const caixa = caixaDaZona(g);
    const palavras = [
      ...new Set(
        g.ruas.map(palavraChave).filter((p): p is string => p !== null),
      ),
    ].map((p) => `%${p}%`);
    const linhas = await q.query<MoradaMunicipe>(
      `WITH moradas AS (
         SELECT 'processo' AS origem, municipe_id, morada, lat, lng FROM processos
          WHERE municipio_id = $1 AND criado_em >= $2 AND municipe_id IS NOT NULL
         UNION ALL
         SELECT 'ocorrencia', municipe_id, morada, lat, lng FROM ocorrencias
          WHERE municipio_id = $1 AND criada_em >= $2 AND municipe_id IS NOT NULL
         UNION ALL
         SELECT 'recolha', municipe_id, morada, NULL, NULL FROM recolhas
          WHERE municipio_id = $1 AND criada_em >= $2
         UNION ALL
         SELECT 'requerimento', municipe_id, dados->>'morada_obra', NULL, NULL FROM requerimentos
          WHERE municipio_id = $1 AND criado_em >= $2 AND municipe_id IS NOT NULL
            AND dados->>'morada_obra' IS NOT NULL
       )
       SELECT mo.origem, mo.municipe_id, mo.morada, mo.lat, mo.lng,
              mu.telefone_e164, mu.nome, mu.aceita_avisos,
              mu.anonimizado_em IS NOT NULL AS anonimizado
       FROM moradas mo
       JOIN municipes mu ON mu.id = mo.municipe_id AND mu.municipio_id = $1
       WHERE ($3::float8 IS NOT NULL AND mo.lat BETWEEN $3 AND $4 AND mo.lng BETWEEN $5 AND $6)
          OR (cardinality($7::text[]) > 0 AND mo.morada IS NOT NULL
              AND unaccent(lower(mo.morada)) LIKE ANY ($7::text[]))
       ORDER BY mo.municipe_id, mo.origem`,
      [
        m.id,
        desde,
        caixa?.minLat ?? null,
        caixa?.maxLat ?? null,
        caixa?.minLng ?? null,
        caixa?.maxLng ?? null,
        palavras,
      ],
    );
    return deduplicar(
      linhas.filter((l) => moradaAfetada(l, g)),
      { ignorarRecusa: tipo === 'emergencia' },
    );
  }

  private resumo(
    afetados: Afetado[],
    excluidos: Excluidos,
    zona: Zona,
    g: Geometria,
    desde: Date,
    tipo: TipoAviso | null,
  ): PreVisualizacao {
    return {
      destinatarios: afetados.length,
      por_origem: contarPorOrigem(afetados),
      excluidos,
      ignora_recusas: tipo === 'emergencia',
      amostra: afetados.slice(0, AMOSTRA).map((a) => ({
        nome: mascararNome(a.nome),
        telefone: mascararTelefone(a.telefone_e164),
        rua: a.rua,
        origens: a.origens,
      })),
      zona: {
        descricao: descreverZona(zona),
        ruas_sem_coordenadas: g.ruas_sem_coordenadas,
      },
      desde: desde.toISOString(),
      limite: MAX_DESTINATARIOS,
    };
  }

  private desdePorOmissao(desde: Date | undefined): Date {
    return desde ?? new Date(Date.now() - JANELA_MORADAS_DIAS * 86_400_000);
  }

  async preVisualizar(
    m: Municipio,
    e: z.output<typeof esquemaPreVisualizar>,
    tipo: TipoAviso | null = null,
  ): Promise<PreVisualizacao> {
    const g = await this.resolverZona(m, e.zona);
    const desde = this.desdePorOmissao(e.desde);
    const { afetados, excluidos } = await this.afetados(m, g, desde, tipo);
    return this.resumo(afetados, excluidos, e.zona, g, desde, tipo);
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  async criar(
    m: Municipio,
    u: UtilizadorPainel,
    e: z.output<typeof esquemaNovoAviso>,
  ) {
    // O link real tem o mesmo tamanho: conta-se com um código qualquer.
    const sms = textoSms({
      municipio: m.nome,
      titulo: e.titulo,
      mensagem: e.mensagem,
      url: `${this.webUrl()}/r/XXXXXX`,
      tipo: e.tipo,
    });
    if (sms.segmentos > MAX_SEGMENTOS) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'mensagem_demasiado_longa',
        `O SMS ficava com ${sms.segmentos} partes (máximo ${MAX_SEGMENTOS}). Encurte a mensagem${sms.codificacao === 'ucs2' ? ' ou tire os acentos' : ''}.`,
        { segmentos: sms.segmentos, codificacao: sms.codificacao },
      );
    }
    const g = await this.resolverZona(m, e.zona);
    const desde = this.desdePorOmissao(e.desde);
    const { afetados, excluidos } = await this.afetados(m, g, desde, e.tipo);
    const pre = this.resumo(afetados, excluidos, e.zona, g, desde, e.tipo);

    const id = await this.db.transaction(async (tx) => {
      const [a] = await tx.query<{ id: string }>(
        `INSERT INTO avisos_zona (municipio_id, titulo, mensagem, tipo, zona, geometria,
           zona_descricao, desde, destinatarios_previstos, enviar_em, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          m.id,
          e.titulo,
          e.mensagem,
          e.tipo,
          JSON.stringify(e.zona),
          JSON.stringify(g),
          pre.zona.descricao,
          desde,
          afetados.length,
          e.enviar_em ?? null,
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar_aviso_zona',
          objetoTipo: 'aviso_zona',
          objetoId: a.id,
          dados: { tipo: e.tipo, destinatarios_previstos: afetados.length },
        },
        tx,
      );
      return a.id;
    });
    return {
      ...(await this.detalhe(m, id)),
      pre_visualizacao: pre,
      sms: {
        exemplo: sms.texto,
        codificacao: sms.codificacao,
        segmentos: sms.segmentos,
      },
    };
  }

  /** O mesmo WEB_URL dos links curtos. */
  private webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  async listar(m: Municipio, f: z.output<typeof esquemaListaAvisos>) {
    const linhas = await this.db.query<LinhaAviso & Contagens>(
      `SELECT ${COLUNAS}, c.*
       FROM avisos_zona a
       CROSS JOIN LATERAL (${CONTAGENS} WHERE d.aviso_id = a.id) c
       WHERE a.municipio_id = $1
         AND ($2::text IS NULL OR a.estado = $2)
         AND ($3::timestamptz IS NULL OR (a.criado_em, a.id) < ($3, $4))
       ORDER BY a.criado_em DESC, a.id DESC
       LIMIT $5`,
      [
        m.id,
        f.estado ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    const p = pagina(linhas, f.limite, (l) => ({ em: l.criado_em, id: l.id }));
    return { ...p, itens: p.itens.map((l) => this.paraResposta(l, l)) };
  }

  async detalhe(m: Municipio, id: string) {
    const a = await this.obter(this.db, m.id, id);
    const [c] = await this.db.query<Contagens>(
      `${CONTAGENS} WHERE d.aviso_id = $1`,
      [id],
    );
    return this.paraResposta(a, c);
  }

  private paraResposta(a: LinhaAviso, c: Contagens) {
    return {
      id: a.id,
      titulo: a.titulo,
      mensagem: a.mensagem,
      tipo: a.tipo,
      zona: a.zona,
      zona_descricao: a.zona_descricao,
      ruas_sem_coordenadas: a.geometria.ruas_sem_coordenadas,
      desde: a.desde,
      estado: a.estado,
      destinatarios_previstos: a.destinatarios_previstos,
      enviar_em: a.enviar_em,
      agendado_para: a.agendado_para,
      criado_por: a.criado_por,
      criado_em: a.criado_em,
      confirmado_por: a.confirmado_por,
      confirmado_em: a.confirmado_em,
      terminado_em: a.terminado_em,
      cancelado_por: a.cancelado_por,
      cancelado_em: a.cancelado_em,
      contagens: {
        destinatarios: c.destinatarios,
        por_enviar: c.por_enviar,
        enviados: c.enviados,
        entregues: c.entregues,
        falhados: c.falhados,
        excluidos: c.excluidos,
        cancelados: c.cancelados,
      },
    };
  }

  private async obter(
    q: Tx | DatabaseService,
    municipioId: string,
    id: string,
    bloquear = false,
  ): Promise<LinhaAviso> {
    const [a] = await q.query<LinhaAviso>(
      `SELECT ${COLUNAS} FROM avisos_zona a WHERE a.id = $1 AND a.municipio_id = $2
       ${bloquear ? 'FOR UPDATE' : ''}`,
      [id, municipioId],
    );
    if (!a) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'aviso_nao_encontrado',
        'Este aviso não existe.',
      );
    }
    return a;
  }

  /**
   * Confirma e agenda. A lista recalcula-se agora (pode ter mudado desde a
   * pré-visualização) e tem de dar o número confirmado: senão 409 com o
   * número novo, para ninguém mandar a gente a mais.
   */
  async enviar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    e: z.output<typeof esquemaEnviar>,
  ) {
    const agendadoPara = await this.db.transaction(async (tx) => {
      const a = await this.obter(tx, m.id, id, true);
      if (a.estado !== 'rascunho') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          a.estado === 'cancelado'
            ? 'Este aviso foi cancelado.'
            : 'Este aviso já foi enviado ou está agendado.',
          { estado: a.estado },
        );
      }
      const { afetados } = await this.afetados(
        m,
        a.geometria,
        a.desde,
        a.tipo,
        tx,
      );
      if (e.confirmo_destinatarios !== afetados.length) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'confirmacao_diferente',
          `O aviso vai para ${afetados.length} pessoas, não ${e.confirmo_destinatarios}. Reveja e confirme o número certo.`,
          {
            destinatarios: afetados.length,
            confirmados: e.confirmo_destinatarios,
          },
        );
      }
      if (!afetados.length) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'sem_destinatarios',
          'Não há ninguém afetado nesta zona a quem enviar.',
        );
      }
      if (afetados.length > MAX_DESTINATARIOS && !INTERNOS.includes(u.perfil)) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'demasiados_destinatarios',
          `Mais de ${MAX_DESTINATARIOS} destinatários: peça à equipa Tou, Câmara? para enviar ou reduza a zona.`,
          { destinatarios: afetados.length, limite: MAX_DESTINATARIOS },
        );
      }
      const quando = quandoEnviar({
        tipo: a.tipo,
        pedido: a.enviar_em,
        agora: new Date(),
        fuso: m.fuso,
      });
      await tx.query(
        `INSERT INTO avisos_zona_destinatarios (aviso_id, municipe_id, telefone_e164, origens)
         SELECT $1, x.municipe_id, x.telefone_e164, x.origens
         FROM jsonb_to_recordset($2::jsonb) AS x(municipe_id uuid, telefone_e164 text, origens text[])`,
        [
          id,
          JSON.stringify(
            afetados.map((x) => ({
              municipe_id: x.municipe_id,
              telefone_e164: x.telefone_e164,
              origens: x.origens,
            })),
          ),
        ],
      );
      await tx.query(
        `UPDATE avisos_zona SET estado = 'agendado', agendado_para = $2,
           confirmado_por = $3, confirmado_em = now()
         WHERE id = $1`,
        [id, quando, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'enviar_aviso_zona',
          objetoTipo: 'aviso_zona',
          objetoId: id,
          dados: {
            tipo: a.tipo,
            destinatarios: afetados.length,
            agendado_para: quando.toISOString(),
            ignora_recusas: a.tipo === 'emergencia',
          },
        },
        tx,
      );
      return quando;
    });
    // Depois do COMMIT: o job vê a lista. (Se a fila falhar aqui, o cron
    // de cada minuto apanha o aviso.)
    await this.porNaFila(id, agendadoPara);
    return this.detalhe(m, id);
  }

  private async porNaFila(avisoId: string, em: Date): Promise<void> {
    try {
      await this.jobs.enviar(
        FILA_AVISOS,
        { avisoId },
        {
          startAfter: em.getTime() > Date.now() ? em : undefined,
          singletonKey: `${avisoId}:${em.getTime()}`,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Aviso ${avisoId} fica para o cron: ${(err as Error).message}`,
      );
    }
  }

  async cancelar(m: Municipio, u: UtilizadorPainel, id: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.obter(tx, m.id, id, true);
      if (!['rascunho', 'agendado', 'a_enviar'].includes(a.estado)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          a.estado === 'cancelado'
            ? 'Este aviso já estava cancelado.'
            : 'Este aviso já foi enviado.',
          { estado: a.estado },
        );
      }
      await tx.query(
        `UPDATE avisos_zona SET estado = 'cancelado', cancelado_por = $2, cancelado_em = now()
         WHERE id = $1`,
        [id, u.id],
      );
      const r = await tx.query<{ id: string }>(
        `UPDATE avisos_zona_destinatarios SET estado = 'cancelado'
         WHERE aviso_id = $1 AND estado = 'por_enviar' RETURNING id`,
        [id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'cancelar_aviso_zona',
          objetoTipo: 'aviso_zona',
          objetoId: id,
          dados: { estado_anterior: a.estado, por_enviar: r.length },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  // -------------------------------------------------------------------
  // Envio (job)
  // -------------------------------------------------------------------

  /**
   * O trabalho da fila: com `avisoId`, esse aviso; sem (cron de cada
   * minuto), todos os que já deviam ter saído e não acabaram.
   */
  async processar(avisoId?: string): Promise<void> {
    const ids = avisoId
      ? [avisoId]
      : (
          await this.db.query<{ id: string }>(
            `SELECT id FROM avisos_zona
             WHERE estado IN ('agendado','a_enviar') AND agendado_para <= now()
             ORDER BY agendado_para LIMIT 20`,
          )
        ).map((r) => r.id);
    for (const id of ids) await this.enviarAviso(id);
  }

  private async enviarAviso(id: string): Promise<void> {
    const [a] = await this.db.query<
      LinhaAviso & { municipio_nome: string; fuso: string }
    >(
      `SELECT ${COLUNAS}, mu.nome AS municipio_nome, mu.fuso
       FROM avisos_zona a JOIN municipios mu ON mu.id = a.municipio_id
       WHERE a.id = $1`,
      [id],
    );
    if (!a || !['agendado', 'a_enviar'].includes(a.estado)) return;
    const agora = new Date();
    if (a.agendado_para && a.agendado_para.getTime() > agora.getTime()) return;
    // Uma repetição da fila fora de horas não manda avisos não urgentes.
    if (a.tipo !== 'emergencia' && !dentroDaJanela(agora, a.fuso)) {
      const em = proximaJanela(agora, a.fuso);
      await this.db.query(
        `UPDATE avisos_zona SET agendado_para = $2 WHERE id = $1`,
        [id, em],
      );
      await this.porNaFila(id, em);
      return;
    }
    await this.db.query(
      `UPDATE avisos_zona SET estado = 'a_enviar' WHERE id = $1 AND estado = 'agendado'`,
      [id],
    );
    for (;;) {
      const feitos = await this.lote(a);
      if (feitos === null) return; // cancelado entretanto
      if (feitos < LOTE) break;
    }
    await this.db.query(
      `UPDATE avisos_zona SET estado = 'enviado', terminado_em = now()
       WHERE id = $1 AND estado = 'a_enviar'
         AND NOT EXISTS (SELECT 1 FROM avisos_zona_destinatarios
                         WHERE aviso_id = $1 AND estado = 'por_enviar')`,
      [id],
    );
  }

  /** Um lote numa transação: link + SMS por destinatário. */
  private async lote(
    a: LinhaAviso & { municipio_nome: string },
  ): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      const [estado] = await tx.query<{ estado: EstadoAviso }>(
        'SELECT estado FROM avisos_zona WHERE id = $1 FOR SHARE',
        [a.id],
      );
      if (estado?.estado !== 'a_enviar') return null;
      const lote = await tx.query<{
        id: string;
        municipe_id: string;
        telefone_e164: string;
        link_codigo: string | null;
        aceita_avisos: boolean;
        anonimizado: boolean;
      }>(
        `SELECT d.id, d.municipe_id, d.telefone_e164, d.link_codigo,
                mu.aceita_avisos, mu.anonimizado_em IS NOT NULL AS anonimizado
         FROM avisos_zona_destinatarios d JOIN municipes mu ON mu.id = d.municipe_id
         WHERE d.aviso_id = $1 AND d.estado = 'por_enviar'
         ORDER BY d.id LIMIT ${LOTE}
         FOR UPDATE OF d SKIP LOCKED`,
        [a.id],
      );
      for (const d of lote) {
        // Entre a confirmação e o envio: quem saiu (ou foi anonimizado) fica de fora.
        if (d.anonimizado || (!d.aceita_avisos && a.tipo !== 'emergencia')) {
          await tx.query(
            `UPDATE avisos_zona_destinatarios SET estado = 'excluido' WHERE id = $1`,
            [d.id],
          );
          continue;
        }
        const link = d.link_codigo
          ? {
              url: `${this.webUrl()}/r/${d.link_codigo}`,
              codigo: d.link_codigo,
            }
          : await this.links.criar(a.municipio_id, LINK_AVISO, d.id, {
              validadeDias: VALIDADE_LINK_DIAS,
              tx,
            });
        const { texto } = textoSms({
          municipio: a.municipio_nome,
          titulo: a.titulo,
          mensagem: a.mensagem,
          url: link.url,
          tipo: a.tipo,
        });
        const mensagemId = await this.mensagens.sms(
          {
            municipioId: a.municipio_id,
            municipeId: d.municipe_id,
            destino: d.telefone_e164,
            motivo: MOTIVO_AVISO,
            corpo: texto,
            relacionado: { aviso_zona_id: a.id },
            chave: `aviso:${a.id}:${d.municipe_id}`,
          },
          tx,
        );
        await tx.query(
          `UPDATE avisos_zona_destinatarios
           SET estado = 'enviado', mensagem_id = $2, link_codigo = $3 WHERE id = $1`,
          [d.id, mensagemId, link.codigo],
        );
      }
      return lote.length;
    });
  }

  // -------------------------------------------------------------------
  // Público e opt-out
  // -------------------------------------------------------------------

  private async doLink(codigo: string) {
    const { destinoId } = await this.links.resolver(codigo, LINK_AVISO);
    const [r] = await this.db.query<{
      destinatario_id: string;
      municipe_id: string;
      municipio_id: string;
      aceita_avisos: boolean;
      titulo: string;
      mensagem: string;
      tipo: TipoAviso;
      zona_descricao: string;
      estado: EstadoAviso;
      agendado_para: Date | null;
      terminado_em: Date | null;
      municipio: string;
    }>(
      `SELECT d.id AS destinatario_id, d.municipe_id, a.municipio_id, mu.aceita_avisos,
              a.titulo, a.mensagem, a.tipo, a.zona_descricao, a.estado,
              a.agendado_para, a.terminado_em, m.nome AS municipio
       FROM avisos_zona_destinatarios d
       JOIN avisos_zona a ON a.id = d.aviso_id
       JOIN municipes mu ON mu.id = d.municipe_id
       JOIN municipios m ON m.id = a.municipio_id
       WHERE d.id = $1`,
      [destinoId],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe ou já expirou.',
      );
    }
    return r;
  }

  /** A página do link do SMS: o aviso, sem dados pessoais. */
  async publico(codigo: string) {
    const r = await this.doLink(codigo);
    return {
      municipio: r.municipio,
      titulo: r.titulo,
      mensagem: r.mensagem,
      tipo: r.tipo,
      emergencia: r.tipo === 'emergencia',
      zona: r.zona_descricao,
      enviado_em: r.agendado_para,
      cancelado: r.estado === 'cancelado',
      recebe_avisos: r.aceita_avisos,
      sair: {
        metodo: 'POST',
        caminho: `/v1/public/avisos/${codigo.toUpperCase()}/sair`,
        nota: 'Deixa de receber avisos de obras, água, lixo e trânsito. Os avisos de emergência continuam a chegar, por segurança.',
      },
    };
  }

  /** "Deixar de receber avisos" na página do aviso. */
  async sair(codigo: string) {
    const r = await this.doLink(codigo);
    await this.optOut(r.municipio_id, r.municipe_id, {
      via: 'pagina_aviso',
      destinatario_id: r.destinatario_id,
    });
    return {
      gravado: true,
      recebe_avisos: false,
      mensagem:
        'Já não vai receber avisos de obras, água, lixo e trânsito. Os avisos de emergência continuam a chegar, por segurança.',
    };
  }

  /** A ferramenta `nao_quero_avisos`. */
  async naoQueroAvisos(ctx: ContextoFerramenta) {
    let municipeId = ctx.municipeId;
    if (!municipeId && ctx.telefone) {
      const [mu] = await this.db.query<{ id: string }>(
        `SELECT id FROM municipes
         WHERE municipio_id = $1 AND telefone_e164 = $2 AND anonimizado_em IS NULL
         ORDER BY criado_em LIMIT 1`,
        [ctx.municipio.id, ctx.telefone],
      );
      municipeId = mu?.id ?? null;
    }
    if (!municipeId) {
      return {
        gravado: false,
        instrucao:
          'Não sei quem é a pessoa (número desconhecido ou anónimo). Diz que pode deixar de receber pelo link que vem em cada aviso, ou pedir ao balcão da câmara.',
      };
    }
    await this.optOut(ctx.municipio.id, municipeId, {
      via: ctx.canal,
      conversa_id: ctx.conversaId,
    });
    return {
      gravado: true,
      dizer:
        'Fica registado: deixa de receber avisos por SMS sobre obras, cortes de água, recolha do lixo e trânsito na sua zona. Os avisos de emergência, como incêndios ou cheias, continuam a chegar, por segurança.',
    };
  }

  private async optOut(
    municipioId: string,
    municipeId: string,
    dados: Record<string, unknown>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE municipes SET aceita_avisos = false WHERE id = $1 AND municipio_id = $2`,
        [municipeId, municipioId],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'municipe',
          atorId: municipeId,
          acao: 'recusar_avisos',
          objetoTipo: 'municipe',
          objetoId: municipeId,
          dados,
        },
        tx,
      );
    });
  }
}
