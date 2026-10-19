import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { IndexacaoService } from './indexacao.service.js';
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
}

interface FonteLinha {
  id: string;
  municipio_id: string;
  slug: string;
  titulo: string;
  url: string;
  ultimo_hash: string | null;
  hash_original: string | null;
}

const USER_AGENT =
  'TouCamara/1.0 (leitura de fontes oficiais do concelho; +https://toucamara.pt)';
const TIMEOUT_DOWNLOAD_MS = 20_000;
const MAX_BYTES = 15 * 1024 * 1024;
/** Menos texto do que isto: página vazia, só com JavaScript ou bloqueada. */
const MIN_CARACTERES = 80;
export const ERRO_PDF = 'PDF: colar texto pelo painel';

/** Erro de uma fonte: fica em `fontes.erro` e não para as outras. */
class ErroFonte extends Error {}

/**
 * Leitura das fontes (secção 6.2). Por fonte vencida
 * (`ultima_leitura_em + ler_a_cada < now()`): descarregar → texto limpo →
 * hash do texto (não do HTML: menus e tokens mudam a cada pedido) → igual?
 * só `ultima_leitura_em` → diferente: nova `fonte_versoes`, `trechos`,
 * embeddings, `alteracoes` com diff e respostas afetadas (proposta pela IA
 * no job `propor_respostas`) → no fim, `detetar_contradicoes`.
 *
 * As datas `vigor_*` são a vigência legal e não se tocam ao ler uma versão
 * nova; a versão atual de cada fonte é a lida mais recentemente entre as
 * que estão em vigor (ver `VERSAO_ATUAL`).
 *
 * PDF: não há leitor. Marca-se `estado='erro'` até alguém colar o texto
 * pelo painel (`registarTexto`, o mesmo caminho). Se o PDF não mudar
 * (`hash_original`), o texto colado continua válido e não volta a erro.
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
  ) {}

  /** Job `ingestao_fontes` (03:00 e "Ler agora"). */
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
         AND ($3::boolean OR (fo.leitura_automatica AND (
               fo.ultima_leitura_em IS NULL OR fo.ultima_leitura_em + fo.ler_a_cada < now())))
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

    for (const f of fontes) {
      try {
        if (await this.lerFonte(f)) mudancas++;
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
        if (!(e instanceof ErroFonte)) {
          this.logger.warn(`Fonte ${f.id} (${f.url}): ${erro}`);
        }
      }
    }

    await this.db.query(
      `UPDATE ingestoes SET terminada_em = now(), fontes_lidas = $2, mudancas = $3,
              erros = $4, detalhes = $5
       WHERE id = $1`,
      [ing.id, fontes.length, mudancas, erros.length, JSON.stringify(erros)],
    );
    this.logger.log(
      `Ingestão ${municipioId}: ${fontes.length} lidas, ${mudancas} mudaram, ${erros.length} erros.`,
    );
    if (mudancas > 0 && this.claude.disponivel) {
      await this.jobs.enviar(
        JOB_CONTRADICOES,
        { municipio_id: municipioId },
        { singletonKey: `contradicoes:${municipioId}` },
      );
    }
  }

  /** Lê uma fonte. true = há versão nova. Lança `ErroFonte` com a mensagem para o painel. */
  private async lerFonte(f: FonteLinha): Promise<boolean> {
    const { bytes, tipo } = await descarregar(f.url);
    const hashOriginal = hashTexto(bytes);

    if (ePdf(bytes, tipo, f.url)) {
      if (f.hash_original === hashOriginal && f.ultimo_hash) {
        // O PDF não mudou desde que se colou o texto: continua válido.
        await this.marcarLida(f.id, hashOriginal);
        return false;
      }
      await this.db.query(
        `UPDATE fontes SET hash_original = $2 WHERE id = $1`,
        [f.id, hashOriginal],
      );
      throw new ErroFonte(ERRO_PDF);
    }

    const bruto = descodificarBytes(bytes, tipo);
    const texto = /text\/plain/i.test(tipo)
      ? normalizarTexto(bruto)
      : htmlParaTexto(bruto);
    if (texto.length < MIN_CARACTERES) {
      throw new ErroFonte(
        'Página sem texto (só com JavaScript ou bloqueada): colar texto pelo painel',
      );
    }

    const r = await this.registarTexto(f.id, texto, {
      original: { bytes, tipo, hash: hashOriginal },
    });
    return r.mudou;
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
  fo.ultimo_hash, fo.hash_original`;

async function descarregar(
  url: string,
): Promise<{ bytes: Buffer; tipo: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5',
        'Accept-Language': 'pt-PT,pt;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS),
    });
  } catch (e) {
    const nome = (e as Error).name;
    throw new ErroFonte(
      nome === 'TimeoutError' || nome === 'AbortError'
        ? `Sem resposta em ${TIMEOUT_DOWNLOAD_MS / 1000} s`
        : `Não foi possível ligar: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new ErroFonte(
      res.status === 403 || res.status === 429
        ? `O site bloqueou a leitura (HTTP ${res.status}): colar texto pelo painel`
        : `HTTP ${res.status}`,
    );
  }
  const tamanho = Number(res.headers.get('content-length') ?? 0);
  if (tamanho > MAX_BYTES) {
    throw new ErroFonte(
      `Ficheiro demasiado grande (${Math.round(tamanho / 1e6)} MB)`,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    throw new ErroFonte(
      `Ficheiro demasiado grande (${Math.round(bytes.length / 1e6)} MB)`,
    );
  }
  return { bytes, tipo: res.headers.get('content-type') ?? '' };
}
