import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { pagina, type Cursor } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  mascararTelefone,
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { GeocodificacaoService } from './geocodificacao.js';
import {
  caixaEnvolvente,
  EstadoOcorrencia,
  estadoEmLinguagemSimples,
  formatarNumero,
  JANELA_DUPLICADO_DIAS,
  MAX_FOTOS,
  melhorCategoria,
  MIME_FOTOS,
  normalizarNumero,
  RAIO_DUPLICADO_M,
} from './ocorrencias.regras.js';

type AtorTipo = 'sistema' | 'agente' | 'utilizador' | 'municipe';

export interface Categoria {
  id: string;
  nome: string;
  icone: string | null;
  servico_id: string | null;
}

export interface FiltrosLista {
  bbox?: [number, number, number, number];
  estado?: EstadoOcorrencia;
  categoria_id?: string;
  desde?: Date;
  limite: number;
  cursor: Cursor | null;
}

export interface Alteracao {
  estado?: Exclude<EstadoOcorrencia, 'duplicada'>;
  servico_id?: string | null;
  prevista_para?: string | null;
}

/*
 * Numeração contínua 'OC-0381', sem ano no número: a série usa o ano 0 em
 * `numeracao` para não recomeçar em janeiro (o número é único por município).
 */
const SERIE_ANO = 0;

/** Pins por pedido: chega para o mapa de um concelho, sem rebentar o browser. */
const MAX_PINS = 2_000;

/** Distância haversine em SQL ($lat, $lng do ponto novo). */
const DISTANCIA_SQL = (lat: string, lng: string) =>
  `2 * 6371000 * asin(least(1, sqrt(
     power(sin(radians(o.lat - ${lat}) / 2), 2)
     + cos(radians(${lat})) * cos(radians(o.lat)) * power(sin(radians(o.lng - ${lng}) / 2), 2))))`;

/**
 * Ocorrências na via pública reportadas por voz: registo com geocodificação e
 * deteção de duplicados, link para juntar fotografia, mapa e resolução no
 * painel com SMS a todos os que reportaram.
 */
@Injectable()
export class OcorrenciasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly geo: GeocodificacaoService,
    private readonly municipes: MunicipesService,
    private readonly conversas: ConversasService,
    private readonly mensagens: MensagensService,
    private readonly links: LinksCurtosService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async categorias(municipioId: string): Promise<Categoria[]> {
    return this.db.query<Categoria>(
      `SELECT id, nome, icone, servico_id FROM categorias_ocorrencia
       WHERE municipio_id = $1 ORDER BY nome`,
      [municipioId],
    );
  }

  // ------------------------------------------------------------------
  // Ferramentas do agente
  // ------------------------------------------------------------------

  async registar(
    ctx: ContextoFerramenta,
    entrada: {
      categoria: string;
      descricao: string;
      morada: string;
      ponto_referencia?: string;
    },
    /**
     * A app do munícipe: as coordenadas do GPS (sem geocodificar a morada)
     * e sem o SMS com o link da fotografia (a app envia-a logo).
     */
    opcoes: {
      coords?: { lat: number; lng: number; encontrada?: string };
      semSms?: boolean;
    } = {},
  ) {
    const m = ctx.municipio;
    const categorias = await this.categorias(m.id);
    const categoria = melhorCategoria(entrada.categoria, categorias);
    if (!categoria) {
      return {
        registada: false,
        motivo: 'categoria_por_identificar',
        categorias: categorias.map((c) => c.nome),
        dizer:
          'Não percebi em que tipo de problema se encaixa. Pergunte qual destas categorias é a certa e volte a chamar com o nome dela.',
      };
    }

    // Fora da transação: é a parte lenta e não pode prender ligações.
    const coords =
      opcoes.coords ?? (await this.geo.geocodificar(entrada.morada, m.nome));
    const morada = entrada.ponto_referencia?.trim()
      ? `${entrada.morada.trim()} (${entrada.ponto_referencia.trim()})`
      : entrada.morada.trim();

    const r = await this.db.transaction(async (tx) => {
      const municipe = ctx.municipeId
        ? await this.municipes.porId(ctx.municipeId)
        : await this.municipes.porTelefone(m.id, ctx.telefone, tx);
      const telefone =
        municipe?.telefone_e164 ?? normalizarTelefone(ctx.telefone);

      const original = await this.procurarOriginal(tx, {
        municipioId: m.id,
        categoriaId: categoria.id,
        coords,
        morada,
      });
      const numero = formatarNumero(
        await proximoNumero(tx, m.id, 'OC', SERIE_ANO),
      );
      const [nova] = await tx.query<{ id: string }>(
        `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng,
           estado, servico_id, municipe_id, conversa_id, duplicada_de)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::estado_ocorr, $9, $10, $11, $12)
         RETURNING id`,
        [
          m.id,
          numero,
          categoria.id,
          entrada.descricao.trim(),
          morada,
          coords?.lat ?? null,
          coords?.lng ?? null,
          original ? 'duplicada' : 'nova',
          categoria.servico_id,
          municipe?.id ?? null,
          ctx.conversaId,
          original?.id ?? null,
        ],
      );
      await this.evento(tx, nova.id, 'registada', 'agente', null, {
        canal: ctx.canal,
        conversa_id: ctx.conversaId,
        localizada: !!coords,
        encontrada: coords?.encontrada,
      });
      if (original) {
        await this.evento(
          tx,
          original.id,
          'duplicado_juntado',
          'agente',
          null,
          {
            ocorrencia_id: nova.id,
            numero,
          },
        );
      }

      // As fotos dos duplicados vão para o original: é lá que a equipa olha.
      const alvoId = original?.id ?? nova.id;
      const numeroVisivel = original?.numero ?? numero;
      const link = await this.links.criar(m.id, 'ocorrencia', alvoId, { tx });
      let smsEnviado = false;
      if (telefone && !opcoes.semSms) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: municipe?.id ?? null,
            destino: telefone,
            motivo: 'ocorrencia',
            corpo: original
              ? `${m.nome}: o problema já estava reportado (${numeroVisivel}, ${categoria.nome}). Juntámos o seu aviso e vamos avisá-lo quando estiver resolvido. Pode juntar uma fotografia: ${link.url}`
              : `${m.nome}: registámos a ocorrência ${numeroVisivel} (${categoria.nome}). Se puder, junte uma fotografia: ${link.url}`,
            relacionado: {
              ocorrencia_id: nova.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `ocorrencia:${nova.id}`,
          },
          tx,
        );
        smsEnviado = true;
      }
      await this.conversas.momento(
        ctx.conversaId,
        'ocorrencia',
        {
          ocorrencia_id: nova.id,
          numero,
          categoria: categoria.nome,
          duplicada_de: original?.id ?? null,
        },
        tx,
      );
      return { numero, numeroVisivel, original, link, smsEnviado };
    });

    const comoJuntarFoto = r.smsEnviado
      ? 'Vai receber um SMS com um link para juntar uma fotografia, se puder.'
      : ctx.canal !== 'telefone'
        ? `Pode juntar uma fotografia neste link: ${r.link.url}`
        : 'Não há um número de telemóvel para enviar o link da fotografia.';
    return {
      registada: true,
      numero: r.numeroVisivel,
      categoria: categoria.nome,
      duplicada: !!r.original,
      localizada_no_mapa: !!coords,
      sms_enviado: r.smsEnviado,
      ...(ctx.canal !== 'telefone' ? { link_foto: r.link.url } : {}),
      dizer: r.original
        ? `Esse problema já está reportado, com o número ${r.numeroVisivel}. Juntámos o seu aviso e vai ser avisado quando estiver resolvido. ${comoJuntarFoto}`
        : `Fica registada com o número ${r.numeroVisivel}. ${comoJuntarFoto}`,
    };
  }

  /**
   * O original a que este aviso se junta: mesma categoria, ainda aberto, nos
   * últimos dias e a menos de 50 m. Sem coordenadas de um dos lados, só se a
   * morada for igual (uma rua comprida não é um sítio).
   */
  private async procurarOriginal(
    tx: Tx,
    a: {
      municipioId: string;
      categoriaId: string;
      coords: { lat: number; lng: number } | null;
      morada: string;
    },
  ): Promise<{ id: string; numero: string } | null> {
    const caixa = a.coords ? caixaEnvolvente(a.coords, RAIO_DUPLICADO_M) : null;
    const [o] = await tx.query<{ id: string; numero: string }>(
      `SELECT o.id, o.numero FROM ocorrencias o
       WHERE o.municipio_id = $1 AND o.categoria_id = $2
         AND o.duplicada_de IS NULL AND o.oculto_em IS NULL
         AND o.estado IN ('nova', 'com_equipa')
         AND o.criada_em > now() - make_interval(days => $3)
         AND (
           ($4::float8 IS NOT NULL AND o.lat IS NOT NULL
             AND o.lat BETWEEN $6 AND $7 AND o.lng BETWEEN $8 AND $9
             AND ${DISTANCIA_SQL('$4', '$5')} <= $10)
           OR (($4::float8 IS NULL OR o.lat IS NULL)
             AND lower(btrim(o.morada)) = lower(btrim($11)))
         )
       ORDER BY o.criada_em
       LIMIT 1`,
      [
        a.municipioId,
        a.categoriaId,
        JANELA_DUPLICADO_DIAS,
        a.coords?.lat ?? null,
        a.coords?.lng ?? null,
        caixa?.minLat ?? null,
        caixa?.maxLat ?? null,
        caixa?.minLng ?? null,
        caixa?.maxLng ?? null,
        RAIO_DUPLICADO_M,
        a.morada,
      ],
    );
    return o ?? null;
  }

  async estado(ctx: ContextoFerramenta, numero?: string) {
    const m = ctx.municipio;
    let linhas: LinhaEstado[];
    if (numero) {
      const n = normalizarNumero(numero);
      if (!n) {
        return {
          encontradas: 0,
          dizer:
            'Esse número não parece de uma ocorrência. Peça o número que vem no SMS, começa por OC.',
        };
      }
      linhas = await this.db.query<LinhaEstado>(
        `${SQL_ESTADO} WHERE o.municipio_id = $1 AND o.numero = $3 LIMIT 1`,
        [m.id, m.fuso, n],
      );
    } else {
      const tel = normalizarTelefone(ctx.telefone);
      if (!ctx.municipeId && !tel) {
        return {
          encontradas: 0,
          dizer:
            'Sem o número da ocorrência não consigo procurar. Peça o número que vem no SMS, começa por OC.',
        };
      }
      linhas = await this.db.query<LinhaEstado>(
        `${SQL_ESTADO}
         WHERE o.municipio_id = $1
           AND (o.municipe_id = $3 OR o.municipe_id IN (
             SELECT id FROM municipes WHERE municipio_id = $1 AND telefone_e164 = $4))
         ORDER BY o.criada_em DESC LIMIT 5`,
        [m.id, m.fuso, ctx.municipeId, tel],
      );
    }
    if (!linhas.length) {
      return {
        encontradas: 0,
        dizer: numero
          ? 'Não encontro nenhuma ocorrência com esse número neste concelho. Confirme o número.'
          : 'Não encontro ocorrências reportadas a partir deste número de telefone. Peça o número que vem no SMS.',
      };
    }
    return {
      encontradas: linhas.length,
      ocorrencias: linhas.map((l) => ({
        numero: l.numero,
        categoria: l.categoria,
        morada: l.morada,
        reportada_em: l.reportada_em,
        estado: l.estado,
        estado_explicado: estadoEmLinguagemSimples({
          estado: l.estado,
          prevista_para: l.prevista_para,
          resolvida_em: l.resolvida_dia,
        }),
        prevista_para: l.prevista_para,
        reportada_por: l.reportes,
      })),
    };
  }

  // ------------------------------------------------------------------
  // Público (página do link do SMS)
  // ------------------------------------------------------------------

  /** O id que a página mostra: o original, se o token for de um duplicado. */
  private async porToken(
    token: string,
  ): Promise<{ id: string; slug: string; estado: EstadoOcorrencia }> {
    const [o] = await this.db.query<{
      id: string;
      slug: string;
      estado: EstadoOcorrencia;
    }>(
      `SELECT coalesce(orig.id, o.id) AS id, mu.slug, coalesce(orig.estado, o.estado) AS estado
       FROM ocorrencias o
       LEFT JOIN ocorrencias orig ON orig.id = o.duplicada_de
       JOIN municipios mu ON mu.id = o.municipio_id
       WHERE o.token_publico = $1`,
      [token],
    );
    if (!o) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ocorrencia_nao_encontrada',
        'Esta ocorrência não existe.',
      );
    }
    return o;
  }

  /** Sem dados de quem reportou: só o problema, o sítio e o estado. */
  async publica(token: string) {
    const { id } = await this.porToken(token);
    const [o] = await this.db.query<{
      numero: string;
      categoria: string;
      icone: string | null;
      descricao: string;
      morada: string;
      estado: EstadoOcorrencia;
      prevista_para: string | null;
      criada_em: Date;
      resolvida_em: Date | null;
      resolvida_dia: string | null;
      municipio: string;
    }>(
      `SELECT o.numero, c.nome AS categoria, c.icone, o.descricao, o.morada, o.estado,
              o.prevista_para::text AS prevista_para, o.criada_em, o.resolvida_em,
              to_char(o.resolvida_em AT TIME ZONE mu.fuso, 'YYYY-MM-DD') AS resolvida_dia,
              mu.nome AS municipio
       FROM ocorrencias o
       JOIN categorias_ocorrencia c ON c.id = o.categoria_id
       JOIN municipios mu ON mu.id = o.municipio_id
       WHERE o.id = $1`,
      [id],
    );
    const fotos = await this.fotos(id);
    const { resolvida_dia, ...resto } = o;
    return {
      ...resto,
      estado_explicado: estadoEmLinguagemSimples({
        estado: o.estado,
        prevista_para: o.prevista_para,
        resolvida_em: resolvida_dia,
      }),
      fotos,
      // O limite é das fotografias do munícipe (as "do depois" da equipa não contam).
      pode_juntar_fotos:
        fotos.filter((f) => f.origem === 'municipe').length < MAX_FOTOS &&
        aceitaFotos(o.estado),
      max_fotos: MAX_FOTOS,
    };
  }

  /** URL assinada para o browser enviar a fotografia (PUT direto ao S3). */
  async novaFoto(token: string, mime: string) {
    const extensao = MIME_FOTOS[mime.toLowerCase()];
    if (!extensao) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'mime_invalido',
        'Só se aceitam fotografias (JPEG, PNG, WebP ou HEIC).',
        { aceites: Object.keys(MIME_FOTOS) },
      );
    }
    const alvo = await this.porToken(token);
    if (!aceitaFotos(alvo.estado)) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ocorrencia_fechada',
        'Esta ocorrência já está fechada e não recebe fotografias.',
      );
    }
    const chave = this.armazenamento.chave(
      alvo.slug,
      'fotos-ocorrencias',
      extensao,
    );
    // Antes de gravar: sem armazenamento responde 503 e não fica foto fantasma.
    const url = await this.armazenamento.urlEnvio(chave, mime.toLowerCase());

    const foto = await this.db.transaction(async (tx) => {
      // Trancar a ocorrência para dois envios ao mesmo tempo não passarem o limite.
      await tx.query('SELECT 1 FROM ocorrencias WHERE id = $1 FOR UPDATE', [
        alvo.id,
      ]);
      const [{ total }] = await tx.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ocorrencia_fotos
         WHERE ocorrencia_id = $1 AND origem = 'municipe'`,
        [alvo.id],
      );
      if (total >= MAX_FOTOS) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'limite_fotos',
          `Esta ocorrência já tem ${MAX_FOTOS} fotografias.`,
        );
      }
      const [f] = await tx.query<{ id: string }>(
        `INSERT INTO ocorrencia_fotos (ocorrencia_id, ficheiro_key) VALUES ($1, $2) RETURNING id`,
        [alvo.id, chave],
      );
      await this.evento(tx, alvo.id, 'foto', 'municipe', null, {
        foto_id: f.id,
      });
      return { id: f.id, restantes: MAX_FOTOS - total - 1 };
    });
    return {
      foto_id: foto.id,
      url_envio: url,
      metodo: 'PUT',
      cabecalhos: { 'Content-Type': mime.toLowerCase() },
      expira_em_segundos: 600,
      fotos_restantes: foto.restantes,
    };
  }

  private async fotos(ocorrenciaId: string) {
    const linhas = await this.db.query<{
      id: string;
      ficheiro_key: string;
      enviada_em: Date;
      origem: 'municipe' | 'equipa';
      legenda: string | null;
    }>(
      `SELECT id, ficheiro_key, enviada_em, origem, legenda FROM ocorrencia_fotos
       WHERE ocorrencia_id = $1 ORDER BY enviada_em`,
      [ocorrenciaId],
    );
    return Promise.all(
      linhas.map(async (f) => ({
        id: f.id,
        enviada_em: f.enviada_em,
        // 'equipa': a fotografia "do depois" tirada ao fechar (app de campo).
        origem: f.origem,
        legenda: f.legenda,
        url: this.armazenamento.disponivel
          ? await this.armazenamento.urlLeitura(f.ficheiro_key, 15)
          : null,
      })),
    );
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  /**
   * Com bbox: pins para o mapa (sem paginar, até MAX_PINS). Sem bbox: lista
   * paginada. Os duplicados não aparecem como pins: contam no original.
   */
  async lista(municipioId: string, f: FiltrosLista) {
    const filtros = `o.municipio_id = $1 AND o.oculto_em IS NULL
      AND ($2::estado_ocorr IS NULL OR o.estado = $2)
      AND ($2::estado_ocorr = 'duplicada' OR o.duplicada_de IS NULL)
      AND ($3::uuid IS NULL OR o.categoria_id = $3)
      AND ($4::timestamptz IS NULL OR o.criada_em >= $4)`;
    const base = [
      municipioId,
      f.estado ?? null,
      f.categoria_id ?? null,
      f.desde ?? null,
    ];
    const duplicados = `(SELECT count(*)::int FROM ocorrencias d WHERE d.duplicada_de = o.id) AS duplicados`;
    // Por onde chegou: o canal da conversa de origem (null se não há).
    const canal = `(SELECT cv.canal::text FROM conversas cv WHERE cv.id = o.conversa_id) AS canal`;

    if (f.bbox) {
      const [minLng, minLat, maxLng, maxLat] = f.bbox;
      const linhas = await this.db.query<{ id: string }>(
        `SELECT o.id, o.numero, o.lat, o.lng, o.estado, o.categoria_id,
                c.nome AS categoria, c.icone, o.criada_em, ${duplicados}, ${canal}
         FROM ocorrencias o
         JOIN categorias_ocorrencia c ON c.id = o.categoria_id
         WHERE ${filtros} AND o.lat IS NOT NULL
           AND o.lat BETWEEN $6 AND $8 AND o.lng BETWEEN $5 AND $7
         ORDER BY o.criada_em DESC
         LIMIT $9`,
        [...base, minLng, minLat, maxLng, maxLat, MAX_PINS + 1],
      );
      return {
        itens: linhas.slice(0, MAX_PINS),
        truncado: linhas.length > MAX_PINS,
      };
    }

    const linhas = await this.db.query<{ id: string; criada_em: Date }>(
      `SELECT o.id, o.numero, o.estado, o.categoria_id, c.nome AS categoria, c.icone,
              o.descricao, o.morada, o.lat, o.lng, o.servico_id, s.nome AS servico,
              o.prevista_para::text AS prevista_para, o.criada_em, o.resolvida_em,
              o.duplicada_de, ${duplicados}, ${canal},
              (SELECT count(*)::int FROM ocorrencia_fotos fo WHERE fo.ocorrencia_id = o.id) AS fotos
       FROM ocorrencias o
       JOIN categorias_ocorrencia c ON c.id = o.categoria_id
       LEFT JOIN servicos s ON s.id = o.servico_id
       WHERE ${filtros}
         AND ($5::timestamptz IS NULL OR (o.criada_em, o.id) < ($5, $6::uuid))
       ORDER BY o.criada_em DESC, o.id DESC
       LIMIT $7`,
      [...base, f.cursor?.em ?? null, f.cursor?.id ?? null, f.limite + 1],
    );
    return pagina(linhas, f.limite, (l) => ({ em: l.criada_em, id: l.id }));
  }

  async detalhe(municipioId: string, id: string) {
    const [o] = await this.db.query<{
      id: string;
      municipe_telefone: string | null;
      duplicada_de: string | null;
    }>(
      `SELECT o.id, o.numero, o.estado, o.descricao, o.morada, o.lat, o.lng,
              o.categoria_id, c.nome AS categoria, c.icone,
              o.servico_id, s.nome AS servico,
              o.prevista_para::text AS prevista_para, o.criada_em, o.resolvida_em,
              o.conversa_id, o.duplicada_de, orig.numero AS duplicada_de_numero,
              o.municipe_id, mu.nome AS municipe_nome, mu.telefone_e164 AS municipe_telefone
       FROM ocorrencias o
       JOIN categorias_ocorrencia c ON c.id = o.categoria_id
       LEFT JOIN servicos s ON s.id = o.servico_id
       LEFT JOIN ocorrencias orig ON orig.id = o.duplicada_de
       LEFT JOIN municipes mu ON mu.id = o.municipe_id
       WHERE o.id = $1 AND o.municipio_id = $2`,
      [id, municipioId],
    );
    if (!o) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ocorrencia_nao_encontrada',
        'Ocorrência não encontrada.',
      );
    }
    const [eventos, fotos, duplicados] = await Promise.all([
      this.db.query(
        `SELECT e.id, e.tipo, e.ator_tipo, e.ator_id, u.nome AS ator_nome, e.dados, e.em
         FROM ocorrencia_eventos e
         LEFT JOIN utilizadores u ON u.id = e.ator_id AND e.ator_tipo = 'utilizador'
         WHERE e.ocorrencia_id = $1 ORDER BY e.em, e.id`,
        [id],
      ),
      this.fotos(id),
      this.db.query<{ municipe_telefone: string | null }>(
        `SELECT d.id, d.numero, d.descricao, d.morada, d.criada_em, d.conversa_id,
                mu.telefone_e164 AS municipe_telefone
         FROM ocorrencias d LEFT JOIN municipes mu ON mu.id = d.municipe_id
         WHERE d.duplicada_de = $1 ORDER BY d.criada_em`,
        [id],
      ),
    ]);
    const { municipe_telefone, ...resto } = o;
    return {
      ...resto,
      municipe_telefone: municipe_telefone
        ? mascararTelefone(municipe_telefone)
        : null,
      reportes: 1 + duplicados.length,
      eventos,
      fotos,
      duplicados: duplicados.map(({ municipe_telefone: t, ...d }) => ({
        ...d,
        municipe_telefone: t ? mascararTelefone(t) : null,
      })),
    };
  }

  /**
   * Atribuir, prever e mudar o estado. Ao passar a resolvida avisa por SMS
   * todos os que reportaram (o original e os duplicados), uma vez por
   * munícipe: reabrir e voltar a resolver não repete o SMS (mesma chave).
   */
  async alterar(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    a: Alteracao,
  ) {
    const avisados = await this.db.transaction(async (tx) => {
      const [antes] = await tx.query<{
        numero: string;
        estado: EstadoOcorrencia;
        servico_id: string | null;
        prevista_para: string | null;
        duplicada_de: string | null;
        duplicada_de_numero: string | null;
        categoria: string;
        morada: string;
      }>(
        `SELECT o.numero, o.estado, o.servico_id, o.prevista_para::text AS prevista_para,
                o.duplicada_de, orig.numero AS duplicada_de_numero, c.nome AS categoria, o.morada
         FROM ocorrencias o
         JOIN categorias_ocorrencia c ON c.id = o.categoria_id
         LEFT JOIN ocorrencias orig ON orig.id = o.duplicada_de
         WHERE o.id = $1 AND o.municipio_id = $2
         FOR UPDATE OF o`,
        [id, municipio.id],
      );
      if (!antes) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'ocorrencia_nao_encontrada',
          'Ocorrência não encontrada.',
        );
      }
      if (antes.duplicada_de) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ocorrencia_duplicada',
          `Esta ocorrência está junta à ${antes.duplicada_de_numero}: altere a original.`,
          { original_id: antes.duplicada_de },
        );
      }
      if (a.servico_id) {
        const [s] = await tx.query(
          'SELECT 1 FROM servicos WHERE id = $1 AND municipio_id = $2',
          [a.servico_id, municipio.id],
        );
        if (!s) {
          throw new ErroApi(
            HttpStatus.BAD_REQUEST,
            'servico_invalido',
            'Esse serviço não existe neste município.',
          );
        }
      }

      await tx.query(
        `UPDATE ocorrencias SET
           estado = coalesce($2::estado_ocorr, estado),
           servico_id = CASE WHEN $3 THEN $4::uuid ELSE servico_id END,
           prevista_para = CASE WHEN $5 THEN $6::date ELSE prevista_para END,
           resolvida_em = CASE
             WHEN $2::estado_ocorr = 'resolvida' THEN coalesce(resolvida_em, now())
             WHEN $2::estado_ocorr IS NOT NULL THEN NULL
             ELSE resolvida_em END
         WHERE id = $1`,
        [
          id,
          a.estado ?? null,
          a.servico_id !== undefined,
          a.servico_id ?? null,
          a.prevista_para !== undefined,
          a.prevista_para ?? null,
        ],
      );

      const ator = (tipo: string, dados: Record<string, unknown>) =>
        this.evento(tx, id, tipo, 'utilizador', u.id, dados);
      if (a.servico_id !== undefined && a.servico_id !== antes.servico_id) {
        await ator('atribuida', { de: antes.servico_id, para: a.servico_id });
      }
      if (
        a.prevista_para !== undefined &&
        a.prevista_para !== antes.prevista_para
      ) {
        await ator('prevista', {
          de: antes.prevista_para,
          para: a.prevista_para,
        });
      }
      const resolveuAgora =
        a.estado === 'resolvida' && antes.estado !== 'resolvida';
      if (a.estado && a.estado !== antes.estado) {
        await ator(resolveuAgora ? 'resolvida' : 'estado', {
          de: antes.estado,
          para: a.estado,
        });
      }

      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'alterar',
          objetoTipo: 'ocorrencia',
          objetoId: id,
          dados: {
            antes: {
              estado: antes.estado,
              servico_id: antes.servico_id,
              prevista_para: antes.prevista_para,
            },
            depois: a,
          },
        },
        tx,
      );

      if (!resolveuAgora) return 0;
      await tx.query(
        `UPDATE ocorrencias SET resolvida_em = coalesce(resolvida_em, now())
         WHERE duplicada_de = $1`,
        [id],
      );
      return this.avisarResolvida(tx, municipio, id, antes);
    });
    return { ...(await this.detalhe(municipio.id, id)), avisados };
  }

  /** "O mesmo buraco, reportado por cinco pessoas": um SMS a cada uma. */
  private async avisarResolvida(
    tx: Tx,
    municipio: Municipio,
    id: string,
    o: { numero: string; categoria: string; morada: string },
  ): Promise<number> {
    const quem = await tx.query<{
      ocorrencia_id: string;
      municipe_id: string;
      telefone: string;
    }>(
      `SELECT DISTINCT ON (mu.id) o.id AS ocorrencia_id, mu.id AS municipe_id,
              mu.telefone_e164 AS telefone
       FROM ocorrencias o JOIN municipes mu ON mu.id = o.municipe_id
       WHERE (o.id = $1 OR o.duplicada_de = $1)
         AND mu.telefone_e164 IS NOT NULL AND mu.anonimizado_em IS NULL
       ORDER BY mu.id, o.criada_em`,
      [id],
    );
    const [{ reportes }] = await tx.query<{ reportes: number }>(
      'SELECT count(*)::int AS reportes FROM ocorrencias WHERE id = $1 OR duplicada_de = $1',
      [id],
    );
    const varios =
      reportes > 1 ? ` Foi reportada por ${reportes} pessoas.` : '';
    for (const q of quem) {
      const mensagemId = await this.mensagens.sms(
        {
          municipioId: municipio.id,
          municipeId: q.municipe_id,
          destino: q.telefone,
          motivo: 'ocorrencia',
          corpo: `${municipio.nome}: a ocorrência ${o.numero} (${o.categoria}, ${o.morada}) foi resolvida.${varios} Obrigado por ter avisado.`,
          relacionado: { ocorrencia_id: q.ocorrencia_id },
          chave: `ocorrencia_resolvida:${id}:${q.municipe_id}`,
        },
        tx,
      );
      await this.evento(tx, q.ocorrencia_id, 'avisado_sms', 'sistema', null, {
        mensagem_id: mensagemId,
        motivo: 'resolvida',
      });
    }
    return quem.length;
  }

  async categoriasPainel(municipioId: string) {
    return this.db.query(
      `SELECT c.id, c.nome, c.icone, c.servico_id, s.nome AS servico,
              (SELECT count(*)::int FROM ocorrencias o
               WHERE o.categoria_id = c.id AND o.duplicada_de IS NULL
                 AND o.estado IN ('nova', 'com_equipa')) AS abertas
       FROM categorias_ocorrencia c
       LEFT JOIN servicos s ON s.id = c.servico_id
       WHERE c.municipio_id = $1
       ORDER BY c.nome`,
      [municipioId],
    );
  }

  /** Para a visão geral: últimos 30 dias. Contam os originais; os avisos todos em `reportes`. */
  async resumo(municipioId: string) {
    const [totais, porEstado, porCategoria] = await Promise.all([
      this.db.query<Record<string, number | null>>(
        `SELECT count(*) FILTER (WHERE duplicada_de IS NULL)::int AS ocorrencias,
                count(*)::int AS reportes,
                count(*) FILTER (WHERE duplicada_de IS NULL AND estado IN ('nova', 'com_equipa'))::int AS abertas,
                count(*) FILTER (WHERE duplicada_de IS NULL AND estado = 'resolvida')::int AS resolvidas,
                count(*) FILTER (WHERE duplicada_de IS NULL AND lat IS NULL)::int AS sem_localizacao,
                round(avg(extract(epoch FROM resolvida_em - criada_em) / 3600)
                  FILTER (WHERE duplicada_de IS NULL AND estado = 'resolvida'))::int AS horas_media_resolucao
         FROM ocorrencias
         WHERE municipio_id = $1 AND oculto_em IS NULL AND criada_em > now() - interval '30 days'`,
        [municipioId],
      ),
      this.db.query(
        `SELECT estado, count(*)::int AS total FROM ocorrencias
         WHERE municipio_id = $1 AND oculto_em IS NULL AND criada_em > now() - interval '30 days'
           AND duplicada_de IS NULL
         GROUP BY estado ORDER BY total DESC`,
        [municipioId],
      ),
      this.db.query(
        `SELECT c.id AS categoria_id, c.nome, c.icone,
                count(o.id) FILTER (WHERE o.duplicada_de IS NULL)::int AS total,
                count(o.id) FILTER (WHERE o.duplicada_de IS NULL AND o.estado IN ('nova', 'com_equipa'))::int AS abertas,
                count(o.id)::int AS reportes
         FROM categorias_ocorrencia c
         LEFT JOIN ocorrencias o ON o.categoria_id = c.id AND o.oculto_em IS NULL
           AND o.criada_em > now() - interval '30 days'
         WHERE c.municipio_id = $1
         GROUP BY c.id
         ORDER BY total DESC, c.nome`,
        [municipioId],
      ),
    ]);
    return {
      dias: 30,
      ...totais[0],
      por_estado: porEstado,
      por_categoria: porCategoria,
    };
  }

  private async evento(
    tx: Tx,
    ocorrenciaId: string,
    tipo: string,
    atorTipo: AtorTipo,
    atorId: string | null,
    dados: Record<string, unknown>,
  ) {
    await tx.query(
      `INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, ator_id, dados)
       VALUES ($1, $2, $3, $4, $5)`,
      [ocorrenciaId, tipo, atorTipo, atorId, JSON.stringify(dados)],
    );
  }
}

interface LinhaEstado {
  numero: string;
  categoria: string;
  morada: string;
  estado: EstadoOcorrencia;
  prevista_para: string | null;
  resolvida_dia: string | null;
  reportada_em: string;
  reportes: number;
}

/*
 * Um duplicado responde com o estado do original (é esse que a equipa mexe).
 * Datas já no fuso do município ($2) para o agente as dizer certas.
 */
const SQL_ESTADO = `
  SELECT coalesce(orig.numero, o.numero) AS numero, c.nome AS categoria, o.morada,
         coalesce(orig.estado, o.estado) AS estado,
         coalesce(orig.prevista_para, o.prevista_para)::text AS prevista_para,
         to_char(coalesce(orig.resolvida_em, o.resolvida_em) AT TIME ZONE $2, 'YYYY-MM-DD') AS resolvida_dia,
         to_char(o.criada_em AT TIME ZONE $2, 'YYYY-MM-DD') AS reportada_em,
         (SELECT 1 + count(*)::int FROM ocorrencias d
          WHERE d.duplicada_de = coalesce(orig.id, o.id)) AS reportes
  FROM ocorrencias o
  JOIN categorias_ocorrencia c ON c.id = o.categoria_id
  LEFT JOIN ocorrencias orig ON orig.id = o.duplicada_de`;

function aceitaFotos(estado: EstadoOcorrencia): boolean {
  return estado === 'nova' || estado === 'com_equipa';
}
