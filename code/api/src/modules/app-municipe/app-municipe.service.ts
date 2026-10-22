import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LimitePedidos } from '../chat/limite.js';
import { ChatService } from '../chat/chat.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { RetomarService } from '../conversas/retomar.service.js';
import { DEFS } from '../licencas/tipos.js';
import type { TipoLicenca } from '../licencas/tipos.js';
import { mascararTelefone } from '../municipes/municipes.service.js';
import {
  EstadoOcorrencia,
  estadoEmLinguagemSimples,
} from '../ocorrencias/ocorrencias.regras.js';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service.js';
import { ProcessosService } from '../processos/processos.service.js';
import { Fase, FASE_ROTULO } from '../processos/regras.js';
import {
  EstadoReclamacao,
  NOMES_ESTADO as NOMES_ESTADO_RECLAMACAO,
} from '../reclamacoes/regras.js';
import type { SessaoApp } from './app-sessao.service.js';

/** Quanto mostra cada lista da app (as mais recentes primeiro). */
const LIMITE_LISTA = 50;

const esquemaIdioma = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Idioma inválido (ex.: pt-PT).');

export const esquemaDispositivo = z.object({
  fcm_token: z.string().trim().min(20).max(4096),
  plataforma: z.literal('android').default('android'),
  idioma: esquemaIdioma.default('pt-PT'),
  versao_app: z.string().trim().max(40).optional(),
});

export const esquemaPreferencias = z
  .object({
    /** Os tipos de notificação (os urgentes não se desligam). */
    tipos: z
      .object({
        avisos: z.boolean().optional(),
        processos: z.boolean().optional(),
      })
      .optional(),
    /** A zona para os avisos; null apaga. */
    zona: z
      .object({
        freguesia: z.string().trim().max(120).nullish(),
        morada: z.string().trim().max(300).nullish(),
        lat: z.number().min(-90).max(90).nullish(),
        lng: z.number().min(-180).max(180).nullish(),
      })
      .refine(
        (z) => (z.lat == null) === (z.lng == null),
        'Latitude e longitude vão juntas.',
      )
      .nullable()
      .optional(),
  })
  .refine((p) => p.tipos !== undefined || p.zona !== undefined, {
    message: 'Nada para mudar.',
  });

export const esquemaNovaOcorrencia = z.object({
  categoria: z.string().trim().min(2).max(120),
  descricao: z.string().trim().min(3).max(1000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** O que a pessoa escrever do sítio (opcional: o GPS chega). */
  morada: z.string().trim().min(3).max(300).optional(),
  ponto_referencia: z.string().trim().max(200).optional(),
  /** Para receber logo a URL assinada da fotografia (PUT direto). */
  foto_mime: z.string().trim().min(3).max(100).optional(),
});

export const esquemaSessaoChat = z.object({
  idioma: esquemaIdioma.optional(),
});

/**
 * O que a app lê e faz em nome da pessoa: só os dados dela (sempre filtrado
 * pelo munícipe da sessão e pelo município). Reaproveita os serviços de
 * cada módulo (página "O seu processo", registo de ocorrências com deteção
 * de duplicados, sessões de chat).
 */
@Injectable()
export class AppMunicipeService {
  // 20 sessões de chat / 10 min e 10 ocorrências / hora por pessoa.
  private readonly limiteChat = new LimitePedidos(20, 10 * 60_000);
  private readonly limiteOcorrencias = new LimitePedidos(10, 60 * 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly processos: ProcessosService,
    private readonly ocorrencias: OcorrenciasService,
    private readonly chat: ChatService,
    private readonly conversas: ConversasService,
    private readonly retomar: RetomarService,
    private readonly links: LinksCurtosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  // ------------------------------------------------------------------
  // A pessoa
  // ------------------------------------------------------------------

  async eu(s: SessaoApp) {
    const [m] = await this.db.query<{
      nome: string | null;
      telefone_e164: string | null;
      email: string | null;
      avisos: boolean | null;
      processos: boolean | null;
      freguesia: string | null;
      morada: string | null;
      lat: number | null;
      lng: number | null;
      sugestao_morada: string | null;
      sugestao_freguesia: string | null;
    }>(
      `SELECT m.nome, m.telefone_e164, m.email::text AS email,
              pr.avisos, pr.processos, pr.freguesia, pr.morada, pr.lat, pr.lng,
              ult.morada AS sugestao_morada, ult.freguesia AS sugestao_freguesia
       FROM municipes m
       LEFT JOIN app_preferencias pr ON pr.municipe_id = m.id
       LEFT JOIN LATERAL (
         SELECT p.morada, p.freguesia FROM processos p
         WHERE p.municipe_id = m.id AND p.morada IS NOT NULL
         ORDER BY p.criado_em DESC LIMIT 1) ult ON true
       WHERE m.id = $1`,
      [s.municipeId],
    );
    const temZona = !!(m.freguesia || m.morada || m.lat != null);
    return {
      nome: m.nome,
      telefone: mascararTelefone(m.telefone_e164),
      tem_email: !!m.email,
      municipio: { slug: s.municipio.slug, nome: s.municipio.nome },
      preferencias: {
        tipos: {
          urgente: true,
          avisos: m.avisos ?? true,
          processos: m.processos ?? true,
        },
        zona: temZona
          ? {
              freguesia: m.freguesia,
              morada: m.morada,
              lat: m.lat,
              lng: m.lng,
            }
          : null,
      },
      // Sem zona escolhida: a morada do último processo, para a app sugerir.
      sugestao_zona:
        !temZona && (m.sugestao_morada || m.sugestao_freguesia)
          ? { morada: m.sugestao_morada, freguesia: m.sugestao_freguesia }
          : null,
    };
  }

  async preferencias(s: SessaoApp, p: z.output<typeof esquemaPreferencias>) {
    const zona = p.zona === undefined ? undefined : p.zona;
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO app_preferencias (municipe_id, municipio_id) VALUES ($1, $2)
         ON CONFLICT (municipe_id) DO NOTHING`,
        [s.municipeId, s.municipio.id],
      );
      await tx.query(
        `UPDATE app_preferencias SET
           avisos = coalesce($2, avisos),
           processos = coalesce($3, processos),
           freguesia = CASE WHEN $4 THEN $5 ELSE freguesia END,
           morada = CASE WHEN $4 THEN $6 ELSE morada END,
           lat = CASE WHEN $4 THEN $7::float8 ELSE lat END,
           lng = CASE WHEN $4 THEN $8::float8 ELSE lng END,
           atualizado_em = now()
         WHERE municipe_id = $1`,
        [
          s.municipeId,
          p.tipos?.avisos ?? null,
          p.tipos?.processos ?? null,
          zona !== undefined,
          zona?.freguesia || null,
          zona?.morada || null,
          zona?.lat ?? null,
          zona?.lng ?? null,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: s.municipio.id,
          atorTipo: 'municipe',
          atorId: s.municipeId,
          acao: 'mudar_preferencias_app',
          objetoTipo: 'municipe',
          objetoId: s.municipeId,
          dados: { tipos: p.tipos ?? null, zona: zona !== undefined },
        },
        tx,
      );
    });
    return (await this.eu(s)).preferencias;
  }

  // ------------------------------------------------------------------
  // Dispositivos (push)
  // ------------------------------------------------------------------

  /**
   * Regista o telemóvel para o push. O token FCM é único: se já existir
   * (renovado, outra sessão, outra pessoa no mesmo telemóvel) passa para
   * esta sessão e volta a ficar ativo.
   */
  async registarDispositivo(
    s: SessaoApp,
    d: z.output<typeof esquemaDispositivo>,
  ) {
    const [r] = await this.db.query<{
      id: string;
      criado: boolean;
      ativo: boolean;
    }>(
      `INSERT INTO app_dispositivos (municipio_id, municipe_id, sessao_id, fcm_token, plataforma, idioma, versao_app)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (fcm_token) DO UPDATE SET
         municipio_id = EXCLUDED.municipio_id, municipe_id = EXCLUDED.municipe_id,
         sessao_id = EXCLUDED.sessao_id, plataforma = EXCLUDED.plataforma,
         idioma = EXCLUDED.idioma, versao_app = EXCLUDED.versao_app,
         ativo = true, desativado_em = NULL, motivo_desativacao = NULL,
         atualizado_em = now()
       RETURNING id, (xmax = 0) AS criado, ativo`,
      [
        s.municipio.id,
        s.municipeId,
        s.id,
        d.fcm_token,
        d.plataforma,
        d.idioma,
        d.versao_app ?? null,
      ],
    );
    // A mesma sessão com um token novo: o antigo deixa de servir.
    await this.db.query(
      `UPDATE app_dispositivos SET ativo = false, desativado_em = now(),
         motivo_desativacao = 'removido', atualizado_em = now()
       WHERE sessao_id = $1 AND id <> $2 AND ativo`,
      [s.id, r.id],
    );
    return { id: r.id, novo: r.criado, ativo: r.ativo };
  }

  async removerDispositivo(s: SessaoApp, id: string) {
    const r = await this.db.query<{ id: string }>(
      `UPDATE app_dispositivos SET ativo = false, desativado_em = now(),
         motivo_desativacao = 'removido', atualizado_em = now()
       WHERE id = $1 AND municipe_id = $2 RETURNING id`,
      [id, s.municipeId],
    );
    if (!r.length) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'dispositivo_desconhecido',
        'Este telemóvel não está registado.',
      );
    }
    return { removido: true };
  }

  // ------------------------------------------------------------------
  // Processos
  // ------------------------------------------------------------------

  async listaProcessos(s: SessaoApp) {
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      tipo: string;
      assunto: string;
      fase: Fase;
      decisao: string | null;
      prazo_fim: string | null;
      criado_em: Date;
      atualizado_em: Date;
      ultimo_evento: { descricao: string; em: string } | null;
    }>(
      `SELECT p.id, p.numero, t.nome AS tipo, p.assunto, p.fase, p.decisao,
              to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim, p.criado_em, p.atualizado_em,
              (SELECT jsonb_build_object('descricao', e.descricao, 'em', e.em)
               FROM processo_eventos e
               WHERE e.processo_id = p.id AND NOT e.interno
               ORDER BY e.em DESC, e.id DESC LIMIT 1) AS ultimo_evento
       FROM processos p JOIN tipos_processo t ON t.id = p.tipo_processo_id
       WHERE p.municipio_id = $1 AND p.municipe_id = $2
       ORDER BY p.criado_em DESC LIMIT ${LIMITE_LISTA}`,
      [s.municipio.id, s.municipeId],
    );
    return {
      processos: linhas.map((l) => ({
        ...l,
        fase_rotulo: FASE_ROTULO[l.fase],
      })),
    };
  }

  /** A página "O seu processo", só se o processo for da pessoa. */
  async processo(s: SessaoApp, id: string) {
    const [p] = await this.db.query<{ id: string }>(
      `SELECT id FROM processos WHERE id = $1 AND municipio_id = $2 AND municipe_id = $3`,
      [id, s.municipio.id, s.municipeId],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Processo não existe.',
      );
    }
    const [dados, link] = await Promise.all([
      this.processos.publicoPorId(s.municipio.id, p.id),
      this.processos.linkProcesso(s.municipio.id, p.id),
    ]);
    // O link curto serve às rotas públicas (documentos, PDF da decisão, avaliação).
    return { id: p.id, ...dados, link, codigo: codigoDe(link) };
  }

  // ------------------------------------------------------------------
  // Ocorrências
  // ------------------------------------------------------------------

  async listaOcorrencias(s: SessaoApp) {
    const linhas = await this.db.query<{
      numero: string;
      numero_original: string | null;
      categoria: string;
      descricao: string;
      morada: string;
      lat: number | null;
      lng: number | null;
      estado: EstadoOcorrencia;
      prevista_para: string | null;
      resolvida_dia: string | null;
      criada_em: Date;
      token_publico: string;
    }>(
      `SELECT o.numero, orig.numero AS numero_original, c.nome AS categoria, o.descricao,
              o.morada, o.lat, o.lng,
              coalesce(orig.estado, o.estado) AS estado,
              coalesce(orig.prevista_para, o.prevista_para)::text AS prevista_para,
              to_char(coalesce(orig.resolvida_em, o.resolvida_em) AT TIME ZONE $3, 'YYYY-MM-DD') AS resolvida_dia,
              o.criada_em, o.token_publico
       FROM ocorrencias o
       JOIN categorias_ocorrencia c ON c.id = o.categoria_id
       LEFT JOIN ocorrencias orig ON orig.id = o.duplicada_de
       WHERE o.municipio_id = $1 AND o.municipe_id = $2
       ORDER BY o.criada_em DESC LIMIT ${LIMITE_LISTA}`,
      [s.municipio.id, s.municipeId, s.municipio.fuso],
    );
    return {
      ocorrencias: linhas.map((l) => ({
        // O número que a câmara segue (o original, se se juntou a outro aviso).
        numero: l.numero_original ?? l.numero,
        juntada_a_outra: !!l.numero_original,
        categoria: l.categoria,
        descricao: l.descricao,
        morada: l.morada,
        lat: l.lat,
        lng: l.lng,
        estado: l.estado === 'duplicada' ? 'nova' : l.estado,
        estado_explicado: estadoEmLinguagemSimples({
          estado: l.estado,
          prevista_para: l.prevista_para,
          resolvida_em: l.resolvida_dia,
        }),
        prevista_para: l.prevista_para,
        criada_em: l.criada_em,
        token: l.token_publico,
        link: `${this.webUrl()}/ocorrencia/${l.token_publico}`,
      })),
    };
  }

  /**
   * Reportar a partir da app: as coordenadas do GPS, o mesmo registo do
   * agente (categoria, duplicados a 50 m, numeração) e, se pedir, logo a
   * URL assinada para a fotografia.
   */
  async novaOcorrencia(
    s: SessaoApp,
    e: z.output<typeof esquemaNovaOcorrencia>,
  ) {
    if (!this.limiteOcorrencias.permitir(s.municipeId)) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiados_pedidos',
        'Já reportou várias ocorrências seguidas. Tente daqui a pouco.',
      );
    }
    const ctx = this.contexto(s, null);
    const morada =
      e.morada ?? `Localização GPS (${e.lat.toFixed(5)}, ${e.lng.toFixed(5)})`;
    const r = (await this.ocorrencias.registar(
      ctx,
      {
        categoria: e.categoria,
        descricao: e.descricao,
        morada,
        ponto_referencia: e.ponto_referencia,
      },
      {
        coords: { lat: e.lat, lng: e.lng, encontrada: 'GPS da app' },
        semSms: true,
      },
    )) as {
      registada: boolean;
      numero?: string;
      categoria?: string;
      duplicada?: boolean;
      categorias?: string[];
    };
    if (!r.registada) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'categoria_por_identificar',
        'Escolha uma das categorias.',
        { categorias: r.categorias ?? [] },
      );
    }
    const [o] = await this.db.query<{ token_publico: string }>(
      'SELECT token_publico FROM ocorrencias WHERE municipio_id = $1 AND numero = $2',
      [s.municipio.id, r.numero],
    );
    // A ocorrência já ficou registada: uma falha na fotografia (sem
    // armazenamento, tipo de ficheiro) não a desfaz. A app pode tentar outra
    // vez por POST /v1/public/ocorrencias/:token/fotos.
    let foto: unknown = null;
    if (e.foto_mime) {
      try {
        foto = await this.ocorrencias.novaFoto(o.token_publico, e.foto_mime);
      } catch (erro) {
        if (!(erro instanceof ErroApi)) throw erro;
        foto = { erro: erro.codigo, mensagem: erro.message };
      }
    }
    return {
      numero: r.numero,
      categoria: r.categoria,
      duplicada: !!r.duplicada,
      mensagem: r.duplicada
        ? `Esse problema já estava reportado (${r.numero}). Juntámos o seu aviso e vai ser avisado quando estiver resolvido.`
        : `Fica registada com o número ${r.numero}. Obrigado!`,
      token: o.token_publico,
      link: `${this.webUrl()}/ocorrencia/${o.token_publico}`,
      foto,
    };
  }

  /** As categorias para o formulário da app. */
  async categoriasOcorrencia(s: SessaoApp) {
    const c = await this.ocorrencias.categorias(s.municipio.id);
    return {
      categorias: c.map((x) => ({ id: x.id, nome: x.nome, icone: x.icone })),
    };
  }

  // ------------------------------------------------------------------
  // Marcações, pagamentos, licenças, reclamações, conversas, avisos
  // ------------------------------------------------------------------

  async marcacoes(s: SessaoApp) {
    const [marcacoes, recolhas] = await Promise.all([
      this.db.query<{
        id: string;
        servico: string;
        local: string | null;
        inicio: Date;
        fim: Date;
        assunto: string | null;
        levar: string[] | null;
        estado: string;
        token_publico: string;
      }>(
        `SELECT mc.id, a.nome AS servico, a.local, lower(mc.periodo) AS inicio,
                upper(mc.periodo) AS fim, mc.assunto, mc.levar, mc.estado, mc.token_publico
         FROM marcacoes mc JOIN agendas a ON a.id = mc.agenda_id
         WHERE a.municipio_id = $1 AND mc.municipe_id = $2
         ORDER BY (mc.estado = 'marcada' AND upper(mc.periodo) > now()) DESC,
                  lower(mc.periodo) DESC
         LIMIT ${LIMITE_LISTA}`,
        [s.municipio.id, s.municipeId],
      ),
      this.db.query<{
        id: string;
        morada: string;
        itens: unknown;
        inicio: Date;
        fim: Date;
        estado: string;
      }>(
        `SELECT id, morada, itens, lower(janela) AS inicio, upper(janela) AS fim, estado
         FROM recolhas WHERE municipio_id = $1 AND municipe_id = $2
         ORDER BY lower(janela) DESC LIMIT ${LIMITE_LISTA}`,
        [s.municipio.id, s.municipeId],
      ),
    ]);
    return {
      marcacoes: marcacoes.map(({ token_publico, ...m }) => ({
        ...m,
        futura: m.estado === 'marcada' && m.fim.getTime() > Date.now(),
        token: token_publico,
        link: `${this.webUrl()}/marcacao/${token_publico}`,
      })),
      recolhas,
    };
  }

  async pagamentos(s: SessaoApp) {
    const linhas = await this.db.query<{
      id: string;
      estado: string;
      valor_cent: number;
      guia_numero: string | null;
      metodo: string | null;
      mb_entidade: string | null;
      mb_referencia: string | null;
      pagar_ate: string | null;
      pago_em: Date | null;
      criado_em: Date;
      modo_teste: boolean;
      processo_numero: string | null;
      processo_id: string | null;
    }>(
      `SELECT pg.id, pg.estado::text AS estado, pg.valor_cent, pg.guia_numero,
              pg.metodo::text AS metodo, pg.mb_entidade, pg.mb_referencia,
              to_char(pg.pagar_ate, 'YYYY-MM-DD') AS pagar_ate, pg.pago_em, pg.criado_em,
              pg.modo_teste, p.numero AS processo_numero, p.id AS processo_id
       FROM pagamentos pg
       LEFT JOIN requerimentos r ON r.id = pg.requerimento_id
       LEFT JOIN processos p ON p.id = coalesce(pg.processo_id, r.processo_id)
       WHERE pg.municipio_id = $1
         AND (p.municipe_id = $2 OR r.municipe_id = $2)
       ORDER BY (pg.estado = 'pendente') DESC, pg.criado_em DESC
       LIMIT ${LIMITE_LISTA}`,
      [s.municipio.id, s.municipeId],
    );
    const pagamentos: ((typeof linhas)[number] & { link: string | null })[] =
      [];
    for (const l of linhas) {
      let link: string | null = null;
      if (l.estado === 'pendente') {
        const codigo = await this.codigoPagamento(s.municipio.id, l.id);
        link = `${this.webUrl()}/pagamento/${codigo}`;
      }
      pagamentos.push({ ...l, link });
    }
    return { pagamentos };
  }

  /** O código do link de pagar: reaproveita um válido, senão cria. */
  private async codigoPagamento(
    municipioId: string,
    id: string,
  ): Promise<string> {
    const [l] = await this.db.query<{ codigo: string }>(
      `SELECT codigo FROM links_curtos
       WHERE destino_tipo = 'pagamento' AND destino_id = $1 AND expira_em > now()
       ORDER BY expira_em DESC LIMIT 1`,
      [id],
    );
    return (
      l?.codigo ?? (await this.links.criar(municipioId, 'pagamento', id)).codigo
    );
  }

  async licencas(s: SessaoApp) {
    const linhas = await this.db.query<{
      id: string;
      tipo: TipoLicenca;
      estado: string;
      taxa_cent: number;
      codigo_verificacao: string;
      criada_em: Date;
      decidida_em: Date | null;
      valida_ate: string | null;
      motivo_recusa: string | null;
      processo_numero: string;
      data: string | null;
      morada: string | null;
    }>(
      `SELECT l.id, l.tipo, l.estado, l.taxa_cent, l.codigo_verificacao, l.criada_em,
              l.decidida_em, to_char(l.valida_ate, 'YYYY-MM-DD') AS valida_ate,
              l.motivo_recusa, p.numero AS processo_numero,
              l.dados->>'data' AS data, l.dados->>'morada' AS morada
       FROM licencas l JOIN processos p ON p.id = l.processo_id
       WHERE l.municipio_id = $1 AND l.municipe_id = $2
       ORDER BY l.criada_em DESC LIMIT ${LIMITE_LISTA}`,
      [s.municipio.id, s.municipeId],
    );
    return {
      licencas: linhas.map(({ codigo_verificacao, ...l }) => ({
        ...l,
        tipo_nome: DEFS[l.tipo]?.nome ?? l.tipo,
        codigo: codigo_verificacao,
        link: `${this.webUrl()}/licenca/${codigo_verificacao}`,
      })),
    };
  }

  async reclamacoes(s: SessaoApp) {
    const linhas = await this.db.query<{
      numero: string;
      codigo_publico: string;
      estado: EstadoReclamacao;
      servico_visado: string | null;
      descricao: string;
      recebida_em: string;
      responder_ate: string;
      resposta: string | null;
      respondida_em: Date | null;
    }>(
      `SELECT numero, codigo_publico, estado, servico_visado, descricao,
              to_char(recebida_em, 'YYYY-MM-DD') AS recebida_em,
              to_char(responder_ate, 'YYYY-MM-DD') AS responder_ate,
              CASE WHEN estado IN ('respondida','encerrada') THEN resposta END AS resposta,
              respondida_em
       FROM reclamacoes
       WHERE municipio_id = $1 AND municipe_id = $2
       ORDER BY criada_em DESC LIMIT ${LIMITE_LISTA}`,
      [s.municipio.id, s.municipeId],
    );
    return {
      reclamacoes: linhas.map(({ codigo_publico, ...r }) => ({
        ...r,
        estado_rotulo: NOMES_ESTADO_RECLAMACAO[r.estado] ?? r.estado,
        codigo: codigo_publico,
        link: `${this.webUrl()}/reclamacao/${codigo_publico}`,
      })),
    };
  }

  /** O histórico com o agente (telefone, chat, app...), com o resumo de cada uma. */
  async listaConversas(s: SessaoApp) {
    const linhas = await this.db.query<{
      id: string;
      canal: string;
      iniciada_em: Date;
      duracao_s: number | null;
      resultado: string;
      resumo: string | null;
      proximos_passos: unknown;
      tema: string | null;
    }>(
      `SELECT c.id, c.canal::text AS canal, c.iniciada_em, c.duracao_s,
              c.resultado::text AS resultado, c.resumo, c.proximos_passos, t.nome AS tema
       FROM conversas c LEFT JOIN temas t ON t.id = c.tema_id
       WHERE c.municipio_id = $1 AND c.municipe_id = $2
         AND EXISTS (SELECT 1 FROM conversa_turnos ct
                     WHERE ct.conversa_id = c.id AND ct.papel = 'municipe')
       ORDER BY c.iniciada_em DESC LIMIT ${LIMITE_LISTA}`,
      [s.municipio.id, s.municipeId],
    );
    return { conversas: linhas };
  }

  /** Os avisos que a pessoa recebeu (por zona e de emergência). */
  async avisos(s: SessaoApp) {
    const linhas = await this.db.query<{
      id: string;
      origem: 'aviso_zona' | 'emergencia';
      tipo: string;
      titulo: string;
      mensagem: string;
      instrucoes: string | null;
      zona: string;
      em: Date;
      urgente: boolean;
      ativo: boolean;
      link_codigo: string | null;
    }>(
      `SELECT * FROM (
         SELECT a.id, 'aviso_zona' AS origem, a.tipo, a.titulo, a.mensagem,
                NULL::text AS instrucoes, a.zona_descricao AS zona,
                coalesce(a.confirmado_em, a.criado_em) AS em,
                a.tipo = 'emergencia' AS urgente, a.estado <> 'cancelado' AS ativo,
                d.link_codigo
         FROM avisos_zona_destinatarios d JOIN avisos_zona a ON a.id = d.aviso_id
         WHERE a.municipio_id = $1 AND d.municipe_id = $2 AND d.estado = 'enviado'
         UNION ALL
         SELECT e.id, 'emergencia', e.tipo, e.titulo, e.mensagem_sms, e.instrucoes,
                e.zona_descricao, e.enviada_em, true, e.estado = 'ativa', NULL
         FROM emergencia_destinatarios d JOIN emergencias e ON e.id = d.emergencia_id
         WHERE e.municipio_id = $1 AND d.municipe_id = $2 AND e.enviada_em IS NOT NULL
       ) x
       ORDER BY em DESC LIMIT ${LIMITE_LISTA}`,
      [s.municipio.id, s.municipeId],
    );
    return {
      avisos: linhas.map(({ link_codigo, ...a }) => ({
        ...a,
        link: link_codigo ? `${this.webUrl()}/r/${link_codigo}` : null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // Chat com o agente
  // ------------------------------------------------------------------

  /**
   * Uma sessão de chat já identificada: a mesma do site (POST
   * /v1/chat/sessoes), ligada ao munícipe como no fim da identificação por
   * SMS (e à última conversa dele, para retomar). A app usa depois as rotas
   * do chat com o token devolvido.
   */
  async criarSessaoChat(s: SessaoApp, e: z.output<typeof esquemaSessaoChat>) {
    if (!this.limiteChat.permitir(s.municipeId)) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiados_pedidos',
        'Demasiadas conversas novas. Tente daqui a pouco.',
      );
    }
    const nova = await this.chat.criarSessao({
      municipio: s.municipio.slug,
      idioma: e.idioma,
    });
    const { conversaId } = await this.chat.sessao(nova.sessao);
    const retomada = await this.db.transaction(async (tx) => {
      await this.conversas.ligarMunicipe(conversaId, s.municipeId, tx);
      return this.retomar.ligarUltimaDoMunicipe(conversaId, tx);
    });
    return {
      ...nova,
      identificado: true,
      telefone: mascararTelefone(s.telefone),
      retomada: nova.retomada || retomada,
      caminhos: {
        mensagens: `/v1/chat/sessoes/${nova.sessao}/mensagens`,
      },
    };
  }

  // ------------------------------------------------------------------

  private contexto(
    s: SessaoApp,
    conversaId: string | null,
  ): ContextoFerramenta {
    return {
      municipio: s.municipio,
      canal: 'chat',
      conversaId,
      municipeId: s.municipeId,
      telefone: s.telefone,
    };
  }
}

/** 'https://…/r/8K2F9Q' → '8K2F9Q'. */
function codigoDe(url: string): string | null {
  return /\/r\/([A-Z0-9]+)$/i.exec(url)?.[1] ?? null;
}
