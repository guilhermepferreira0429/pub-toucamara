import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { textoDoPdf } from '../arquivo/pdf-texto.js';
import { AvaliacaoService } from './avaliacao.service.js';
import { DescarregadorService } from './descarregador.service.js';
import { IndexacaoService } from './indexacao.service.js';
import { aplicarSeletor, ErroFonte, lerPagina } from './recolha.js';
import { EM_VIGOR } from './sql.js';
import {
  descodificarBytes,
  diffLinhas,
  ePdf,
  hashTexto,
  htmlParaTexto,
  normalizarTexto,
  partirEmTrechos,
  resumoDiff,
} from './texto.js';

export const JOB_INGESTAO = 'ingestao_fontes';
export const JOB_PROPOR = 'propor_respostas';
export const JOB_CONTRADICOES = 'detetar_contradicoes';
/** De 5 em 5 minutos: põe na fila os municípios com fontes vencidas e os sites a descobrir. */
export const JOB_RECOLHA_TICK = 'recolha_tick';

export interface DadosIngestao {
  /** Só este município (por defeito todos os que têm fontes). */
  municipio_id?: string;
  /** Só esta fonte ("Ler agora" no painel). */
  fonte_id?: string;
  /** Lê mesmo que não esteja vencida nem seja de leitura automática. */
  forcar?: boolean;
}

export interface ResultadoTexto {
  mudou: boolean;
  versao_id: string;
  alteracao_id: string | null;
  trechos: number;
  respostas_afetadas: number;
  /** O texto novo tem menos de metade do anterior (página partida? seletor errado?). */
  encolheu?: boolean;
}

/** Como correu a leitura de uma fonte (fica em `fonte_leituras`). */
interface Leitura {
  resultado: 'mudou' | 'igual' | 'nao_modificado';
  http: number | null;
  bytes: number | null;
  aviso: string | null;
}

interface FonteLinha {
  id: string;
  municipio_id: string;
  slug: string;
  titulo: string;
  url: string;
  ultimo_hash: string | null;
  hash_original: string | null;
  etag: string | null;
  ultima_modificacao: string | null;
  seletor: string | null;
  ignorar_robots: boolean;
  titulo_automatico: boolean;
}

/** Menos texto do que isto: página vazia, só com JavaScript ou bloqueada. */
const MIN_CARACTERES = 80;
/** Fontes lidas ao mesmo tempo num município (o descarregador espaça os pedidos ao mesmo site). */
const EM_PARALELO = 4;
/** O PDF não tem texto (digitalizado): só colando. */
export const ERRO_PDF =
  'PDF sem texto (digitalizado?): colar texto pelo painel';

/**
 * A próxima leitura, contada a partir de `base` (por defeito, agora):
 * intervalos de um dia ou mais caem à hora de recolha do município (no fuso
 * dele); os mais curtos contam a partir da leitura. Precisa de `fo` (fontes)
 * e `m` (municipios).
 */
export function proximaLeitura(base = 'now()'): string {
  return `CASE WHEN fo.ler_a_cada < interval '1 day'
  THEN ${base} + fo.ler_a_cada
  ELSE (date_trunc('day', (${base} + fo.ler_a_cada) AT TIME ZONE m.fuso) + m.hora_recolha) AT TIME ZONE m.fuso END`;
}

/** Fonte vencida: leitura automática, não arquivada e a data já passou (ou nunca foi lida). */
export const VENCIDA = `fo.leitura_automatica AND fo.arquivada_em IS NULL
  AND coalesce(fo.proxima_leitura_em, '-infinity') <= now()`;

/**
 * Leitura das fontes (secção 6.2). Por fonte vencida
 * (`proxima_leitura_em <= now()`, ver `proximaLeitura`): descarregar (ver
 * DescarregadorService: robots.txt, pausa por site, 304) → texto limpo (só o
 * `seletor`, se a fonte tiver um) →
 * hash do texto (não do HTML: menus e tokens mudam a cada pedido) → igual?
 * só `ultima_leitura_em` → diferente: nova `fonte_versoes`, `trechos`,
 * embeddings, `alteracoes` com diff e respostas afetadas (proposta pela IA
 * no job `propor_respostas`) → no fim, `detetar_contradicoes`.
 *
 * As datas `vigor_*` são a vigência legal e não se tocam ao ler uma versão
 * nova; a versão atual de cada fonte é a lida mais recentemente entre as
 * que estão em vigor (ver `VERSAO_ATUAL`).
 *
 * PDF: lê-se a camada de texto. Sem ela (digitalizado) marca-se
 * `estado='erro'` até alguém colar o texto pelo painel (`registarTexto`, o
 * mesmo caminho). Se o PDF não mudar (`hash_original`), o texto que está
 * (lido ou colado) continua válido e não volta a erro.
 *
 * Cada leitura fica em `fonte_leituras`; `falhas_seguidas` conta os erros
 * desde a última leitura boa.
 */
@Injectable()
export class IngestaoService {
  private readonly logger = new Logger(IngestaoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly claude: ClaudeService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly indexacao: IndexacaoService,
    @Optional() private readonly avaliacao?: AvaliacaoService,
    @Optional()
    private readonly descarregador: DescarregadorService = new DescarregadorService(),
  ) {}

  /** Job `recolha_tick`: os municípios com fontes vencidas vão para a fila (um lote de cada vez por município). */
  async tick(): Promise<void> {
    const ms = await this.db.query<{ municipio_id: string }>(
      `SELECT DISTINCT fo.municipio_id FROM fontes fo WHERE ${VENCIDA}`,
    );
    for (const { municipio_id } of ms) {
      await this.jobs.enviar(
        JOB_INGESTAO,
        { municipio_id },
        { singletonKey: `ingestao:${municipio_id}` },
      );
    }
    await this.db.query(
      `DELETE FROM fonte_leituras WHERE iniciada_em < now() - interval '90 days'`,
    );
  }

  /** Job `ingestao_fontes` (do tick e de "Ler agora"). */
  async correr(d: DadosIngestao = {}): Promise<void> {
    const municipios = d.municipio_id
      ? [d.municipio_id]
      : (
          await this.db.query<{ municipio_id: string }>(
            `SELECT DISTINCT municipio_id FROM fontes`,
          )
        ).map((m) => m.municipio_id);
    for (const m of municipios) await this.correrMunicipio(m, d);
  }

  private async correrMunicipio(
    municipioId: string,
    d: DadosIngestao,
  ): Promise<void> {
    const fontes = await this.db.query<FonteLinha>(
      `SELECT ${FONTE_COLUNAS}
       FROM fontes fo JOIN municipios m ON m.id = fo.municipio_id
       WHERE fo.municipio_id = $1
         AND ($2::uuid IS NULL OR fo.id = $2)
         AND ($3::boolean OR (${VENCIDA}))
       ORDER BY fo.ultima_leitura_em NULLS FIRST`,
      [municipioId, d.fonte_id ?? null, d.forcar === true],
    );
    if (!fontes.length) return;

    const [ing] = await this.db.query<{ id: string }>(
      `INSERT INTO ingestoes (municipio_id) VALUES ($1) RETURNING id`,
      [municipioId],
    );
    let mudancas = 0;
    const erros: { fonte_id: string; titulo: string; erro: string }[] = [];

    await emParalelo(fontes, EM_PARALELO, async (f) => {
      const inicio = Date.now();
      try {
        const l = await this.lerFonte(f, d.forcar === true);
        if (l.resultado === 'mudou') mudancas++;
        await this.registarLeitura(f.id, inicio, l, null);
      } catch (e) {
        const erro =
          e instanceof ErroFonte
            ? e.message
            : `Falha ao ler: ${(e as Error).message}`.slice(0, 500);
        erros.push({ fonte_id: f.id, titulo: f.titulo, erro });
        await this.db
          .query(
            `UPDATE fontes SET estado = 'erro', erro = $2, ultima_leitura_em = now() WHERE id = $1`,
            [f.id, erro],
          )
          .catch((e2: Error) => this.logger.error(e2.message));
        await this.registarLeitura(f.id, inicio, null, {
          codigo: e instanceof ErroFonte ? e.codigo : null,
          erro,
        }).catch((e2: Error) => this.logger.error(e2.message));
        if (!(e instanceof ErroFonte)) {
          this.logger.warn(`Fonte ${f.id} (${f.url}): ${erro}`);
        }
      }
    });

    await this.db.query(
      `UPDATE ingestoes SET terminada_em = now(), fontes_lidas = $2, mudancas = $3,
              erros = $4, detalhes = $5
       WHERE id = $1`,
      [ing.id, fontes.length, mudancas, erros.length, JSON.stringify(erros)],
    );
    this.logger.log(
      `Ingestão ${municipioId}: ${fontes.length} lidas, ${mudancas} mudaram, ${erros.length} erros.`,
    );
    // Fontes mudaram: o agente pode responder diferente. Amostra, para ser
    // rápido; a avaliação completa fica para antes de publicar.
    if (mudancas > 0) {
      await this.avaliacao
        ?.pedirAvaliacao(municipioId, 'ingestao', { amostra: true })
        .catch((e: Error) =>
          this.logger.warn(`Pedido de avaliação por fazer: ${e.message}`),
        );
    }
    if (mudancas > 0 && this.claude.disponivel) {
      await this.jobs.enviar(
        JOB_CONTRADICOES,
        { municipio_id: municipioId },
        { singletonKey: `contradicoes:${municipioId}` },
      );
    }
  }

  /** Lê uma fonte. Lança `ErroFonte` com a mensagem para o painel. */
  private async lerFonte(f: FonteLinha, forcar: boolean): Promise<Leitura> {
    // "Ler agora" (forcar) descarrega sempre: sem pedido condicional.
    const d = await this.descarregador.obter(f.url, {
      etag: forcar ? null : f.etag,
      ultimaModificacao: forcar ? null : f.ultima_modificacao,
      ignorarRobots: f.ignorar_robots,
    });
    if (d.estado === 'nao_modificado') {
      await this.marcarLida(f.id, null);
      return {
        resultado: 'nao_modificado',
        http: 304,
        bytes: null,
        aviso: null,
      };
    }
    const { bytes, tipo } = d;
    const hashOriginal = hashTexto(bytes);
    await this.db.query(
      `UPDATE fontes SET etag = $2, ultima_modificacao = $3 WHERE id = $1`,
      [f.id, d.etag, d.ultimaModificacao],
    );
    const leitura = (r: ResultadoTexto | null): Leitura => ({
      resultado: r?.mudou ? 'mudou' : 'igual',
      http: d.http,
      bytes: bytes.length,
      aviso: r?.encolheu
        ? 'O texto novo tem menos de metade do anterior: confirmar a alteração'
        : null,
    });

    if (ePdf(bytes, tipo, f.url)) {
      if (f.hash_original === hashOriginal && f.ultimo_hash) {
        // O PDF não mudou: o texto que está (lido ou colado) continua válido.
        await this.marcarLida(f.id, hashOriginal);
        return leitura(null);
      }
      const { texto } = textoDoPdf(bytes);
      if (normalizarTexto(texto).length < MIN_CARACTERES) {
        await this.db.query(
          `UPDATE fontes SET hash_original = $2 WHERE id = $1`,
          [f.id, hashOriginal],
        );
        throw new ErroFonte(ERRO_PDF, 'pdf');
      }
      return leitura(
        await this.registarTexto(f.id, texto, {
          original: { bytes, tipo, hash: hashOriginal },
        }),
      );
    }

    const bruto = descodificarBytes(bytes, tipo);
    const html = !/text\/plain/i.test(tipo);
    if (html && f.titulo_automatico) {
      const { titulo } = lerPagina(bruto, f.url);
      if (titulo) {
        await this.db.query(
          `UPDATE fontes SET titulo = $2, titulo_automatico = false WHERE id = $1`,
          [f.id, titulo],
        );
      }
    }
    let parte = bruto;
    if (html && f.seletor) {
      const sel = aplicarSeletor(bruto, f.seletor);
      if (!sel) {
        throw new ErroFonte(
          `O seletor "${f.seletor}" já não encontra nada na página: o site mudou de estrutura?`,
          'seletor',
        );
      }
      parte = `<main>${sel}</main>`;
    }
    const texto = html ? htmlParaTexto(parte) : normalizarTexto(bruto);
    if (texto.length < MIN_CARACTERES) {
      throw new ErroFonte(
        'Página sem texto (só com JavaScript ou bloqueada): colar texto pelo painel',
        'vazio',
      );
    }

    return leitura(
      await this.registarTexto(f.id, texto, {
        original: { bytes, tipo, hash: hashOriginal },
      }),
    );
  }

  /** Histórico da leitura, próxima data e falhas seguidas. */
  private async registarLeitura(
    fonteId: string,
    inicio: number,
    l: Leitura | null,
    falha: { codigo: string | null; erro: string } | null,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO fonte_leituras (fonte_id, iniciada_em, duracao_ms, http_estado, bytes,
         resultado, codigo_erro, erro, aviso)
       VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8, $9)`,
      [
        fonteId,
        inicio,
        Date.now() - inicio,
        l?.http ?? null,
        l?.bytes ?? null,
        l?.resultado ?? 'erro',
        falha?.codigo ?? null,
        falha?.erro ?? null,
        l?.aviso ?? null,
      ],
    );
    await this.db.query(
      `UPDATE fontes fo SET proxima_leitura_em = ${proximaLeitura()},
              falhas_seguidas = CASE WHEN $2 THEN fo.falhas_seguidas + 1 ELSE 0 END
       FROM municipios m WHERE m.id = fo.municipio_id AND fo.id = $1`,
      [fonteId, falha !== null],
    );
  }

  /**
   * Texto novo de uma fonte, venha da leitura ou colado no painel (PDFs e
   * sites que bloqueiam). Igual ao atual: só marca a leitura. Diferente:
   * versão nova, trechos, alteração com diff e respostas afetadas.
   */
  async registarTexto(
    fonteId: string,
    textoBruto: string,
    opcoes: {
      vigorDesde?: string | null;
      vigorAte?: string | null;
      original?: { bytes: Buffer; tipo: string; hash: string };
    } = {},
  ): Promise<ResultadoTexto> {
    const texto = normalizarTexto(textoBruto);
    if (texto.length < MIN_CARACTERES) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'texto_curto',
        'O texto da fonte é demasiado curto.',
      );
    }
    const hash = hashTexto(texto);
    const hashOriginal = opcoes.original?.hash ?? null;
    const temVigor = opcoes.vigorDesde != null || opcoes.vigorAte != null;

    const [f] = await this.db.query<FonteLinha>(
      `SELECT ${FONTE_COLUNAS} FROM fontes fo JOIN municipios m ON m.id = fo.municipio_id WHERE fo.id = $1`,
      [fonteId],
    );
    if (!f) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'fonte_nao_encontrada',
        'Fonte não encontrada.',
      );
    }

    // O original (HTML) em S3, só quando o texto mudou e há onde guardar.
    let conteudoKey: string | null = null;
    if (
      opcoes.original &&
      f.ultimo_hash !== hash &&
      this.armazenamento.disponivel
    ) {
      try {
        conteudoKey = this.armazenamento.chave(f.slug, 'fontes', 'html');
        await this.armazenamento.guardar(
          conteudoKey,
          opcoes.original.bytes,
          opcoes.original.tipo || 'text/html',
        );
      } catch (e) {
        conteudoKey = null;
        this.logger.warn(
          `Original da fonte ${f.id} não guardado: ${(e as Error).message}`,
        );
      }
    }

    const r = await this.db.transaction(async (tx) => {
      // Uma leitura de cada vez por fonte (job noturno vs. "Ler agora" vs. colar).
      await tx.query(`SELECT 1 FROM fontes WHERE id = $1 FOR UPDATE`, [f.id]);
      const [atual] = await tx.query<{
        id: string;
        hash: string;
        texto: string;
      }>(
        `SELECT v.id, v.hash, v.texto FROM fonte_versoes v
         WHERE v.fonte_id = $1 AND ${EM_VIGOR('v')}
         ORDER BY v.lida_em DESC LIMIT 1`,
        [f.id],
      );

      if (atual?.hash === hash && !temVigor) {
        await this.marcarLida(f.id, hashOriginal, tx);
        return {
          mudou: false,
          versao_id: atual.id,
          alteracao_id: null,
          trechos: 0,
          respostas_afetadas: 0,
          novos: [] as string[],
        };
      }

      // Volta a um texto que já teve (ou só mudam as datas de vigência):
      // reaproveita a versão e os trechos. clock_timestamp() e não now():
      // a versão atual é a de lida_em maior, mesmo dentro da mesma transação.
      const [existente] = await tx.query<{ id: string }>(
        `UPDATE fonte_versoes SET lida_em = clock_timestamp(),
                vigor_desde = CASE WHEN $3 THEN $4::date ELSE vigor_desde END,
                vigor_ate = CASE WHEN $3 THEN $5::date ELSE vigor_ate END
         WHERE fonte_id = $1 AND hash = $2 RETURNING id`,
        [
          f.id,
          hash,
          temVigor,
          opcoes.vigorDesde ?? null,
          opcoes.vigorAte ?? null,
        ],
      );
      let versaoId: string;
      let novos: string[] = [];
      if (existente) {
        versaoId = existente.id;
      } else {
        const [v] = await tx.query<{ id: string }>(
          `INSERT INTO fonte_versoes (fonte_id, hash, conteudo_key, texto, vigor_desde, vigor_ate, lida_em)
           VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) RETURNING id`,
          [
            f.id,
            hash,
            conteudoKey,
            texto,
            opcoes.vigorDesde ?? null,
            opcoes.vigorAte ?? null,
          ],
        );
        versaoId = v.id;
        const partes = partirEmTrechos(texto);
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO trechos (fonte_versao_id, ordem, referencia, texto)
           SELECT $1, x.ordem, x.referencia, x.texto
           FROM unnest($2::int[], $3::text[], $4::text[]) AS x(ordem, referencia, texto)
           RETURNING id`,
          [
            versaoId,
            partes.map((p) => p.ordem),
            partes.map((p) => p.referencia),
            partes.map((p) => p.texto),
          ],
        );
        novos = ins.map((t) => t.id);
      }

      let alteracaoId: string | null = null;
      let afetadas = 0;
      const mudouTexto = !!atual && atual.hash !== hash;
      if (mudouTexto) {
        const diff = diffLinhas(atual.texto, texto);
        const [a] = await tx.query<{ id: string }>(
          `INSERT INTO alteracoes (fonte_id, versao_anterior_id, versao_nova_id, resumo, diff)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [f.id, atual.id, versaoId, resumoDiff(diff), JSON.stringify(diff)],
        );
        alteracaoId = a.id;
        // Afetadas: respostas cuja versão no ar (ou, sem ela, a última) cita
        // trechos desta fonte que não são da versão nova.
        const rs = await tx.query(
          `INSERT INTO alteracao_respostas (alteracao_id, resposta_id)
           SELECT DISTINCT $1::uuid, r.id
           FROM respostas r
           JOIN resposta_fontes rf ON rf.resposta_versao_id = coalesce(r.versao_no_ar_id,
             (SELECT id FROM resposta_versoes WHERE resposta_id = r.id ORDER BY numero DESC LIMIT 1))
           JOIN trechos t ON t.id = rf.trecho_id
           JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
           WHERE r.municipio_id = $2 AND r.estado <> 'arquivada'
             AND fv.fonte_id = $3 AND fv.id <> $4
           RETURNING resposta_id`,
          [alteracaoId, f.municipio_id, f.id, versaoId],
        );
        afetadas = rs.length;
      }

      await tx.query(
        `UPDATE fontes SET ultimo_hash = $2, ultima_leitura_em = now(), erro = NULL,
                hash_original = coalesce($3, hash_original),
                estado = CASE WHEN $4 OR EXISTS (
                  SELECT 1 FROM alteracoes WHERE fonte_id = $1 AND estado = 'por_rever')
                  THEN 'mudou' ELSE 'em_dia' END
         WHERE id = $1`,
        [f.id, hash, hashOriginal, mudouTexto],
      );
      return {
        mudou: mudouTexto || !atual,
        versao_id: versaoId,
        alteracao_id: alteracaoId,
        trechos: novos.length,
        respostas_afetadas: afetadas,
        encolheu: mudouTexto && texto.length < atual.texto.length / 2,
        novos,
      };
    });

    await this.indexacao.tentar(
      () => this.indexacao.vetorizarTrechos(r.novos),
      `${r.novos.length} trechos da fonte ${f.id}`,
    );
    if (r.alteracao_id && r.respostas_afetadas > 0 && this.claude.disponivel) {
      await this.jobs.enviar(
        JOB_PROPOR,
        { alteracao_id: r.alteracao_id },
        { singletonKey: `propor:${r.alteracao_id}` },
      );
    }
    return {
      mudou: r.mudou,
      versao_id: r.versao_id,
      alteracao_id: r.alteracao_id,
      trechos: r.trechos,
      respostas_afetadas: r.respostas_afetadas,
      encolheu: r.encolheu,
    };
  }

  /** Leitura sem mudanças: data, erro limpo e estado coerente com as alterações por rever. */
  private async marcarLida(
    fonteId: string,
    hashOriginal: string | null,
    tx?: Tx,
  ): Promise<void> {
    await (tx ?? this.db).query(
      `UPDATE fontes SET ultima_leitura_em = now(), erro = NULL,
              hash_original = coalesce($2, hash_original),
              estado = CASE WHEN EXISTS (
                SELECT 1 FROM alteracoes WHERE fonte_id = $1 AND estado = 'por_rever')
                THEN 'mudou' ELSE 'em_dia' END
       WHERE id = $1`,
      [fonteId, hashOriginal],
    );
  }
}

const FONTE_COLUNAS = `fo.id, fo.municipio_id, m.slug, fo.titulo, fo.url,
  fo.ultimo_hash, fo.hash_original, fo.etag, fo.ultima_modificacao, fo.seletor,
  fo.ignorar_robots, fo.titulo_automatico`;

/** Corre `fn` sobre os itens, no máximo `n` de cada vez. */
async function emParalelo<T>(
  itens: T[],
  n: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const trabalhador = async () => {
    while (i < itens.length) await fn(itens[i++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, trabalhador),
  );
}
