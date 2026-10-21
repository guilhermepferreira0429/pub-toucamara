import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { rrf } from '../conhecimento/rrf.js';
import {
  EmbeddingsService,
  paraVetor,
} from '../conhecimento/embeddings.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { ArquivoIaService } from './arquivo-ia.service.js';
import { excertos, termosDaPesquisa } from './excertos.js';
import {
  CAMPOS_METADADOS,
  chaveMorada,
  juntarMetadados,
  mesmaMorada,
  Metadados,
  metadadosDoTexto,
  NOMES_TIPO,
  semAcentos,
  termosProcura,
  textoPesquisa,
  TipoArquivo,
  TIPOS_ARQUIVO,
} from './metadados.js';
import { textoDoPdf, temCamadaTexto } from './pdf-texto.js';
import {
  ConfigArquivo,
  ESTADOS_DOCUMENTO,
  EstadoDocumento,
  EXTENSOES,
  lerConfig,
  MAX_BYTES,
  MAX_LOTE,
  MIMES_ARQUIVO,
  MimeArquivo,
  OrigemTexto,
  podeDocumentos,
} from './regras.js';

export const FILA_PROCESSAR = 'arquivo_processar';

// ------------------------------------------------------------------
// Entradas do painel
// ------------------------------------------------------------------

export const esquemaLote = z.object({
  nome: z.string().trim().min(2).max(200),
  ficheiros: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(200),
        mime: z.enum(MIMES_ARQUIVO, {
          error: 'Só PDF ou imagens (JPEG, PNG, WebP, TIFF).',
        }),
        tamanho: z.number().int().min(1).max(MAX_BYTES).optional(),
      }),
    )
    .min(1)
    .max(MAX_LOTE),
});

const texto = (max: number) => z.string().trim().min(1).max(max).nullable();

export const esquemaMetadados = z.object({
  numero_antigo: texto(40).optional(),
  ano: z.number().int().min(1800).max(2100).nullable().optional(),
  tipo: z.enum(TIPOS_ARQUIVO).nullable().optional(),
  requerente: texto(120).optional(),
  morada: texto(160).optional(),
  freguesia: texto(80).optional(),
  artigo_matricial: texto(30).optional(),
});

export const esquemaTranscrever = z.object({
  texto: z.string().trim().min(10).max(200_000),
});

export const esquemaLigar = z
  .object({
    municipe_id: z.guid().nullable().optional(),
    processos: z.array(z.guid()).max(50).optional(),
    retirar_processos: z.array(z.guid()).max(50).optional(),
  })
  .refine(
    (x) =>
      x.municipe_id !== undefined ||
      x.processos?.length ||
      x.retirar_processos?.length,
    { message: 'Indique o munícipe ou os processos a ligar.' },
  );

const vazioParaNull = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

export const esquemaPesquisa = z.object({
  q: z.preprocess(vazioParaNull, z.string().trim().max(300).optional()),
  ano: z.preprocess(
    vazioParaNull,
    z.coerce.number().int().min(1800).max(2100).optional(),
  ),
  ano_ate: z.preprocess(
    vazioParaNull,
    z.coerce.number().int().min(1800).max(2100).optional(),
  ),
  freguesia: z.preprocess(vazioParaNull, z.string().trim().max(80).optional()),
  tipo: z.preprocess(vazioParaNull, z.enum(TIPOS_ARQUIVO).optional()),
  morada: z.preprocess(vazioParaNull, z.string().trim().max(160).optional()),
  estado: z.preprocess(vazioParaNull, z.enum(ESTADOS_DOCUMENTO).optional()),
  por_transcrever: z.preprocess(
    vazioParaNull,
    z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  ),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});

// ------------------------------------------------------------------

interface LinhaDoc {
  id: string;
  municipio_id: string;
  lote_id: string | null;
  lote: string | null;
  nome_ficheiro: string;
  mime: MimeArquivo;
  ficheiro_key: string;
  paginas: number | null;
  estado: EstadoDocumento;
  texto: string | null;
  texto_origem: OrigemTexto | null;
  metadados_origem: 'ia' | 'regras' | 'manual' | null;
  numero_antigo: string | null;
  ano: number | null;
  tipo: TipoArquivo | null;
  requerente: string | null;
  morada: string | null;
  freguesia: string | null;
  artigo_matricial: string | null;
  morada_rua: string | null;
  morada_porta: string | null;
  erro: string | null;
  municipe_id: string | null;
  processado_em: Date | null;
  revisto_em: Date | null;
  revisto_por_nome: string | null;
  criado_em: Date;
  tem_embedding: boolean;
}

const COLUNAS = `d.id, d.municipio_id, d.lote_id, l.nome AS lote, d.nome_ficheiro, d.mime,
  d.ficheiro_key, d.paginas, d.estado, d.texto, d.texto_origem, d.metadados_origem,
  d.numero_antigo, d.ano, d.tipo, d.requerente, d.morada, d.freguesia, d.artigo_matricial,
  d.morada_rua, d.morada_porta, d.erro, d.municipe_id, d.processado_em, d.revisto_em,
  ur.nome AS revisto_por_nome, d.criado_em, d.embedding IS NOT NULL AS tem_embedding`;

const FROM = `FROM arquivo_documentos d
  LEFT JOIN arquivo_lotes l ON l.id = d.lote_id
  LEFT JOIN utilizadores ur ON ur.id = d.revisto_por`;

function metadadosDe(l: Metadados): Metadados {
  return {
    numero_antigo: l.numero_antigo,
    ano: l.ano,
    tipo: l.tipo,
    requerente: l.requerente,
    morada: l.morada,
    freguesia: l.freguesia,
    artigo_matricial: l.artigo_matricial,
  };
}

/** Para o embedding: os metadados e o início do texto. */
function textoParaVetor(texto: string | null, m: Metadados): string {
  return [
    m.tipo ? NOMES_TIPO[m.tipo] : null,
    m.numero_antigo && `Processo ${m.numero_antigo}`,
    m.ano && `Ano ${m.ano}`,
    m.morada,
    m.freguesia && `Freguesia ${m.freguesia}`,
    texto?.slice(0, 3000),
  ]
    .filter(Boolean)
    .join('\n');
}

export function erroSemArmazenamento(): ErroApi {
  return new ErroApi(
    HttpStatus.SERVICE_UNAVAILABLE,
    'armazenamento_indisponivel',
    'O arquivo digital precisa do armazenamento de ficheiros (S3) configurado: sem ele não se guardam as digitalizações. Configure S3_BUCKET e tente outra vez.',
  );
}

function semPermissaoDocumentos(): ErroApi {
  return new ErroApi(
    HttpStatus.FORBIDDEN,
    'sem_permissao',
    'Pesquisar e carregar documentos do arquivo é dos técnicos e da chefia. O seu perfil trata os pedidos de consulta.',
    { recurso: 'arquivo' },
  );
}

export function exigirDocumentos(u: UtilizadorPainel): void {
  if (!podeDocumentos(u.perfil)) throw semPermissaoDocumentos();
}

function naoExiste(): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'documento_desconhecido',
    'Este documento não existe no arquivo.',
  );
}

/**
 * Arquivo antigo digitalizado: lotes de PDFs e imagens em S3, texto (camada
 * do PDF, OCR com IA ou à mão), metadados (IA ou regras) que um funcionário
 * revê, pesquisa por texto e metadados (e por semelhança, com embeddings) e
 * "processos na mesma morada". Cada consulta de um documento fica no
 * registo de acessos (é dado pessoal).
 */
@Injectable()
export class ArquivoService {
  private readonly logger = new Logger(ArquivoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly embeddings: EmbeddingsService,
    private readonly ia: ArquivoIaService,
  ) {}

  // ------------------------------------------------------------------
  // Configuração
  // ------------------------------------------------------------------

  async configDe(municipioId: string): Promise<ConfigArquivo> {
    const [r] = await this.db.query<{ c: unknown }>(
      'SELECT arquivo_config AS c FROM municipios WHERE id = $1',
      [municipioId],
    );
    return lerConfig(r?.c);
  }

  async guardarConfig(m: Municipio, u: UtilizadorPainel, c: ConfigArquivo) {
    await this.db.query(
      'UPDATE municipios SET arquivo_config = $2 WHERE id = $1',
      [m.id, JSON.stringify(c)],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_regras_arquivo',
      objetoTipo: 'arquivo_config',
      objetoId: m.id,
      dados: { demonstracao: c.demonstracao },
    });
    return { config: c };
  }

  // ------------------------------------------------------------------
  // Carregar (lotes)
  // ------------------------------------------------------------------

  /**
   * Um lote de digitalizações: cria os documentos e devolve, para cada um,
   * o URL assinado para o browser enviar o ficheiro (PUT). Depois do envio,
   * `processarLote` põe-nos na fila.
   */
  async criarLote(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaLote>,
  ) {
    exigirDocumentos(u);
    if (!this.armazenamento.disponivel) throw erroSemArmazenamento();
    const chaves = d.ficheiros.map((f) =>
      this.armazenamento.chave(m.slug, 'documentos', EXTENSOES[f.mime]),
    );
    const urls = await Promise.all(
      d.ficheiros.map((f, i) => this.armazenamento.urlEnvio(chaves[i], f.mime)),
    );
    const r = await this.db.transaction(async (tx) => {
      const [lote] = await tx.query<{ id: string; criado_em: Date }>(
        `INSERT INTO arquivo_lotes (municipio_id, nome, criado_por)
         VALUES ($1, $2, $3) RETURNING id, criado_em`,
        [m.id, d.nome, u.id],
      );
      const docs: { id: string; nome: string; chave: string; url: string }[] =
        [];
      for (const [i, f] of d.ficheiros.entries()) {
        const [doc] = await tx.query<{ id: string }>(
          `INSERT INTO arquivo_documentos (municipio_id, lote_id, nome_ficheiro, mime, ficheiro_key, criado_por)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [m.id, lote.id, f.nome, f.mime, chaves[i], u.id],
        );
        docs.push({ id: doc.id, nome: f.nome, chave: chaves[i], url: urls[i] });
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'carregar_arquivo',
          objetoTipo: 'arquivo_lote',
          objetoId: lote.id,
          dados: { nome: d.nome, ficheiros: d.ficheiros.length },
        },
        tx,
      );
      return { lote, docs };
    });
    return {
      lote: {
        id: r.lote.id,
        nome: d.nome,
        criado_em: r.lote.criado_em.toISOString(),
      },
      documentos: r.docs.map((x) => ({
        id: x.id,
        nome_ficheiro: x.nome,
        ficheiro_key: x.chave,
        url_envio: x.url,
      })),
      proximo_passo:
        'Envie cada ficheiro para o seu url_envio (PUT, válido 10 minutos) e depois chame POST /painel/arquivo/lotes/{id}/processar.',
    };
  }

  /** Põe na fila os documentos do lote que ainda estão por processar. */
  async processarLote(m: Municipio, u: UtilizadorPainel, loteId: string) {
    exigirDocumentos(u);
    if (!this.armazenamento.disponivel) throw erroSemArmazenamento();
    const docs = await this.db.query<{ id: string }>(
      `SELECT id FROM arquivo_documentos
       WHERE municipio_id = $1 AND lote_id = $2 AND estado = 'por_processar'`,
      [m.id, loteId],
    );
    const [lote] = await this.db.query<{ id: string }>(
      'SELECT id FROM arquivo_lotes WHERE municipio_id = $1 AND id = $2',
      [m.id, loteId],
    );
    if (!lote) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'lote_desconhecido',
        'Este lote não existe.',
      );
    }
    for (const d of docs) {
      await this.jobs.enviar(
        FILA_PROCESSAR,
        { documento_id: d.id },
        { singletonKey: `arquivo:${d.id}` },
      );
    }
    return { lote_id: loteId, em_fila: docs.length };
  }

  async lotes(m: Municipio, u: UtilizadorPainel) {
    exigirDocumentos(u);
    const linhas = await this.db.query<{
      id: string;
      nome: string;
      criado_em: Date;
      criado_por: string | null;
      total: number;
      por_processar: number;
      por_transcrever: number;
      revistos: number;
    }>(
      `SELECT l.id, l.nome, l.criado_em, u.nome AS criado_por,
              count(d.id)::int AS total,
              count(d.id) FILTER (WHERE d.estado = 'por_processar')::int AS por_processar,
              count(d.id) FILTER (WHERE d.estado <> 'por_processar' AND d.texto IS NULL)::int AS por_transcrever,
              count(d.id) FILTER (WHERE d.estado = 'revisto')::int AS revistos
       FROM arquivo_lotes l
       LEFT JOIN utilizadores u ON u.id = l.criado_por
       LEFT JOIN arquivo_documentos d ON d.lote_id = l.id
       WHERE l.municipio_id = $1
       GROUP BY l.id, u.nome
       ORDER BY l.criado_em DESC
       LIMIT 100`,
      [m.id],
    );
    return {
      lotes: linhas.map((l) => ({
        ...l,
        criado_em: l.criado_em.toISOString(),
      })),
      armazenamento: this.armazenamento.disponivel,
      ia: this.ia.disponivel,
    };
  }

  // ------------------------------------------------------------------
  // Processar: texto + metadados (+ embedding)
  // ------------------------------------------------------------------

  /**
   * Lê o ficheiro do S3 e tira o texto: camada de texto do PDF; senão OCR
   * com a IA (se houver e o formato o permitir); senão fica por transcrever
   * (a digitalização está guardada). Depois os metadados: IA, completados
   * pelas regras (ou só regras, sem IA). Um documento revisto não volta
   * atrás: os metadados confirmados mantêm-se.
   */
  async processar(documentoId: string): Promise<void> {
    const [d] = await this.db.query<LinhaDoc>(
      `SELECT ${COLUNAS} ${FROM} WHERE d.id = $1`,
      [documentoId],
    );
    if (!d) return;
    if (!this.armazenamento.disponivel) throw erroSemArmazenamento();
    let ficheiro: Buffer;
    try {
      ficheiro = await this.armazenamento.ler(d.ficheiro_key);
    } catch (e) {
      await this.marcarErro(
        d.id,
        'O ficheiro ainda não foi enviado ou não se lê no armazenamento.',
      );
      throw e;
    }

    let texto: string | null = null;
    let origem: OrigemTexto | null = null;
    let paginas: number | null = null;
    let erro: string | null = null;
    if (d.mime === 'application/pdf') {
      const pdf = textoDoPdf(ficheiro);
      paginas = pdf.paginas || null;
      if (temCamadaTexto(pdf.texto)) {
        texto = pdf.texto;
        origem = 'camada_texto';
      }
    }
    if (!texto && this.ia.disponivel && this.ia.podeLer(d.mime)) {
      const ocr = await this.ia.transcrever(ficheiro, d.mime);
      if (ocr.trim()) {
        texto = ocr;
        origem = 'ocr_ia';
      }
    }
    if (!texto) {
      erro = this.ia.disponivel
        ? this.ia.podeLer(d.mime)
          ? 'A IA não leu texto nesta digitalização: transcrever à mão.'
          : 'Formato que a IA não lê (TIFF): transcrever à mão ou carregar em PDF.'
        : 'Sem camada de texto e sem IA: fica por transcrever (a digitalização está guardada).';
    }
    await this.guardarTexto(d, texto, origem, paginas, erro);
  }

  /** Texto (de onde vier) → metadados, pesquisa e embedding. */
  private async guardarTexto(
    d: LinhaDoc,
    texto: string | null,
    origem: OrigemTexto | null,
    paginas: number | null,
    erro: string | null,
  ) {
    let meta: Metadados = metadadosDe(d);
    let metaOrigem = d.metadados_origem;
    if (d.estado !== 'revisto' && texto) {
      const regras = metadadosDoTexto(texto);
      let ia: Metadados | null = null;
      if (this.ia.disponivel) {
        ia = await this.ia.metadados(texto).catch((e: Error) => {
          this.logger.warn(`Metadados pela IA falharam: ${e.message}`);
          return null;
        });
      }
      meta = ia ? juntarMetadados(ia, regras) : regras;
      metaOrigem = ia ? 'ia' : 'regras';
    }
    const chave = chaveMorada(meta.morada);
    let vetor: string | null = null;
    if (texto && this.embeddings.disponivel) {
      try {
        const [v] = await this.embeddings.varios(
          [textoParaVetor(texto, meta)],
          'document',
        );
        vetor = v ? paraVetor(v) : null;
      } catch (e) {
        this.logger.warn(
          `Embedding do documento falhou: ${(e as Error).message}`,
        );
      }
    }
    await this.db.query(
      `UPDATE arquivo_documentos SET
         texto = $2, texto_origem = $3, paginas = coalesce($4, paginas),
         estado = CASE WHEN estado = 'revisto' THEN 'revisto' ELSE 'processado' END,
         metadados_origem = $5, numero_antigo = $6, ano = $7, tipo = $8, requerente = $9,
         morada = $10, freguesia = $11, artigo_matricial = $12,
         morada_rua = $13, morada_porta = $14, pesquisa = $15,
         embedding = coalesce($16::vector, CASE WHEN $2::text IS NULL THEN NULL ELSE embedding END),
         erro = $17, processado_em = now(), atualizado_em = now()
       WHERE id = $1`,
      [
        d.id,
        texto,
        origem,
        paginas,
        metaOrigem,
        meta.numero_antigo,
        meta.ano,
        meta.tipo,
        meta.requerente,
        meta.morada,
        meta.freguesia,
        meta.artigo_matricial,
        chave?.rua ?? null,
        chave?.porta ?? null,
        textoPesquisa(texto, meta),
        vetor,
        erro,
      ],
    );
  }

  private async marcarErro(id: string, erro: string) {
    await this.db.query(
      'UPDATE arquivo_documentos SET erro = $2, atualizado_em = now() WHERE id = $1',
      [id, erro],
    );
  }

  /** "Processar agora" no painel (o mesmo do trabalho da fila). */
  async processarAgora(m: Municipio, u: UtilizadorPainel, id: string) {
    exigirDocumentos(u);
    await this.porId(m.id, id);
    await this.processar(id);
    return this.detalhe(m, u, id, { auditar: false });
  }

  /** Transcrição à mão (documentos sem texto ou com OCR mau). */
  async transcrever(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    t: z.output<typeof esquemaTranscrever>,
  ) {
    exigirDocumentos(u);
    const d = await this.porId(m.id, id);
    await this.guardarTexto(d, t.texto, 'manual', null, null);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'transcrever_documento_arquivo',
      objetoTipo: 'documento_arquivo',
      objetoId: id,
      dados: { caracteres: t.texto.length },
    });
    return this.detalhe(m, u, id, { auditar: false });
  }

  /** O funcionário confirma (e corrige) os metadados: fica 'revisto'. */
  async rever(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    alteracoes: z.output<typeof esquemaMetadados>,
  ) {
    exigirDocumentos(u);
    const d = await this.porId(m.id, id);
    if (d.estado === 'por_processar') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'por_processar',
        'Este documento ainda não foi processado.',
      );
    }
    const atual = metadadosDe(d);
    const novo: Metadados = { ...atual };
    const mudou: string[] = [];
    for (const c of CAMPOS_METADADOS) {
      const v = alteracoes[c];
      if (v === undefined) continue;
      if (v !== atual[c]) mudou.push(c);
      (novo as unknown as Record<string, unknown>)[c] = v;
    }
    const chave = chaveMorada(novo.morada);
    await this.db.query(
      `UPDATE arquivo_documentos SET
         numero_antigo = $2, ano = $3, tipo = $4, requerente = $5, morada = $6,
         freguesia = $7, artigo_matricial = $8, morada_rua = $9, morada_porta = $10,
         pesquisa = $11, estado = 'revisto',
         metadados_origem = CASE WHEN $12 THEN 'manual' ELSE metadados_origem END,
         revisto_em = now(), revisto_por = $13, atualizado_em = now()
       WHERE id = $1`,
      [
        id,
        novo.numero_antigo,
        novo.ano,
        novo.tipo,
        novo.requerente,
        novo.morada,
        novo.freguesia,
        novo.artigo_matricial,
        chave?.rua ?? null,
        chave?.porta ?? null,
        textoPesquisa(d.texto, novo),
        mudou.length > 0,
        u.id,
      ],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'rever_documento_arquivo',
      objetoTipo: 'documento_arquivo',
      objetoId: id,
      dados: { campos_corrigidos: mudou },
    });
    return this.detalhe(m, u, id, { auditar: false });
  }

  /** Liga a um munícipe atual e/ou a processos novos (a mesma obra). */
  async ligar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    l: z.output<typeof esquemaLigar>,
  ) {
    exigirDocumentos(u);
    await this.porId(m.id, id);
    await this.db.transaction(async (tx) => {
      if (l.municipe_id !== undefined) {
        if (l.municipe_id) {
          const [mu] = await tx.query(
            'SELECT 1 FROM municipes WHERE id = $1 AND municipio_id = $2 AND anonimizado_em IS NULL',
            [l.municipe_id, m.id],
          );
          if (!mu) {
            throw new ErroApi(
              HttpStatus.BAD_REQUEST,
              'municipe_desconhecido',
              'Este munícipe não existe nesta câmara.',
            );
          }
        }
        await tx.query(
          'UPDATE arquivo_documentos SET municipe_id = $2, atualizado_em = now() WHERE id = $1',
          [id, l.municipe_id],
        );
      }
      for (const p of l.processos ?? []) {
        const [existe] = await tx.query(
          'SELECT 1 FROM processos WHERE id = $1 AND municipio_id = $2',
          [p, m.id],
        );
        if (!existe) {
          throw new ErroApi(
            HttpStatus.BAD_REQUEST,
            'processo_desconhecido',
            'Um dos processos não existe nesta câmara.',
          );
        }
        await tx.query(
          `INSERT INTO arquivo_documento_processos (municipio_id, documento_id, processo_id, criado_por)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [m.id, id, p, u.id],
        );
      }
      if (l.retirar_processos?.length) {
        await tx.query(
          'DELETE FROM arquivo_documento_processos WHERE documento_id = $1 AND processo_id = ANY($2::uuid[])',
          [id, l.retirar_processos],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'ligar_documento_arquivo',
          objetoTipo: 'documento_arquivo',
          objetoId: id,
          dados: {
            municipe_id: l.municipe_id ?? null,
            processos: l.processos ?? [],
            retirar_processos: l.retirar_processos ?? [],
          },
        },
        tx,
      );
    });
    return this.detalhe(m, u, id, { auditar: false });
  }

  // ------------------------------------------------------------------
  // Consultar um documento (fica no registo de acessos)
  // ------------------------------------------------------------------

  async detalhe(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    o: { auditar?: boolean } = {},
  ) {
    exigirDocumentos(u);
    const d = await this.porId(m.id, id);
    const [ligados, municipe] = await Promise.all([
      this.db.query<{
        id: string;
        numero: string;
        morada: string | null;
        fase: string;
      }>(
        `SELECT p.id, p.numero, p.morada, p.fase::text AS fase
         FROM arquivo_documento_processos x JOIN processos p ON p.id = x.processo_id
         WHERE x.documento_id = $1 ORDER BY p.criado_em DESC`,
        [id],
      ),
      d.municipe_id
        ? this.db
            .query<{ id: string; nome: string | null }>(
              'SELECT id, nome FROM municipes WHERE id = $1 AND anonimizado_em IS NULL',
              [d.municipe_id],
            )
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);
    const sugeridos = (await this.processosNaMorada(m.id, d.morada)).filter(
      (p) => !ligados.some((l) => l.id === p.id),
    );
    if (o.auditar !== false) {
      await this.auditoria.registar({
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'ver',
        objetoTipo: 'documento_arquivo',
        objetoId: id,
        dados: { numero_antigo: d.numero_antigo },
      });
    }
    return {
      ...this.resumo(d),
      texto: d.texto,
      erro: d.erro,
      revisto_em: d.revisto_em?.toISOString() ?? null,
      revisto_por: d.revisto_por_nome,
      municipe,
      processos_ligados: ligados,
      processos_mesma_morada: sugeridos,
    };
  }

  /** URL assinado (5 min) para ver a digitalização. Também fica no registo. */
  async ficheiro(m: Municipio, u: UtilizadorPainel, id: string) {
    exigirDocumentos(u);
    const d = await this.porId(m.id, id);
    if (!this.armazenamento.disponivel) throw erroSemArmazenamento();
    const url = await this.armazenamento.urlLeitura(d.ficheiro_key, 5);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'ver',
      objetoTipo: 'documento_arquivo',
      objetoId: id,
      dados: { ficheiro: true },
    });
    return { url, mime: d.mime, valido_minutos: 5 };
  }

  // ------------------------------------------------------------------
  // Pesquisa
  // ------------------------------------------------------------------

  async pesquisar(
    m: Municipio,
    u: UtilizadorPainel,
    f: z.output<typeof esquemaPesquisa>,
  ) {
    exigirDocumentos(u);
    const q = f.q?.trim() || null;
    const termos = q ? termosDaPesquisa(q).map((t) => `%${t}%`) : [];
    const moradaRua = f.morada
      ? (chaveMorada(f.morada)?.rua ?? semAcentos(f.morada))
      : null;
    const filtros = [
      f.ano ?? null,
      f.ano_ate ?? null,
      f.tipo ?? null,
      f.freguesia ? semAcentos(f.freguesia) : null,
      moradaRua,
      f.estado ?? null,
      f.por_transcrever ?? null,
    ];
    const ONDE = `d.municipio_id = $1
      AND ($2::int IS NULL OR (CASE WHEN $3::int IS NULL THEN d.ano = $2 ELSE d.ano BETWEEN $2 AND $3 END))
      AND ($4::text IS NULL OR d.tipo = $4)
      AND ($5::text IS NULL OR lower(unaccent(coalesce(d.freguesia, ''))) LIKE '%' || $5 || '%')
      AND ($6::text IS NULL OR d.morada_rua LIKE '%' || $6 || '%' OR d.pesquisa LIKE '%' || $6 || '%')
      AND ($7::text IS NULL OR d.estado = $7)
      AND ($8::boolean IS NULL OR ((d.texto IS NULL AND d.estado <> 'por_processar') = $8))`;

    const porTexto = await this.db.query<LinhaDoc & { pontuacao: number }>(
      `WITH c AS (SELECT CASE WHEN $9::text IS NULL THEN NULL
                         ELSE websearch_to_tsquery('pt_unaccent', $9) END AS q)
       SELECT ${COLUNAS},
              CASE WHEN c.q IS NULL THEN 0 ELSE ts_rank_cd(d.tsv, c.q, 32) END::float8 AS pontuacao
       ${FROM}, c
       WHERE ${ONDE}
         AND ($9::text IS NULL
              OR d.tsv @@ c.q
              OR (cardinality($10::text[]) > 0 AND d.pesquisa LIKE ALL ($10::text[])))
       ORDER BY pontuacao DESC, d.ano NULLS LAST, d.criado_em DESC
       LIMIT $11`,
      [m.id, ...filtros, q, termos, f.limite],
    );

    let porSemelhanca: (LinhaDoc & { distancia: number })[] = [];
    if (q && this.embeddings.disponivel) {
      const v = await this.embeddings.pergunta(q, 1000);
      if (v) {
        porSemelhanca = await this.db.query<LinhaDoc & { distancia: number }>(
          `SELECT ${COLUNAS}, (d.embedding <=> $9::vector)::float8 AS distancia
           ${FROM}
           WHERE ${ONDE} AND d.embedding IS NOT NULL
           ORDER BY d.embedding <=> $9::vector
           LIMIT $10`,
          [m.id, ...filtros, paraVetor(v), Math.min(f.limite, 20)],
        );
        // Longe demais não é "semelhante".
        porSemelhanca = porSemelhanca.filter((x) => x.distancia < 0.6);
      }
    }

    const doTexto = new Set(porTexto.map((x) => x.id));
    const doVetor = new Set(porSemelhanca.map((x) => x.id));
    const fundidos = porSemelhanca.length
      ? rrf<LinhaDoc>([porTexto, porSemelhanca], (x) => x.id).map((x) => x.item)
      : porTexto;
    const itens = fundidos.slice(0, f.limite).map((d) => ({
      ...this.resumo(d),
      excertos: q ? excertos(d.texto, q) : excertos(d.texto, '', { max: 1 }),
      encontrado_por: [
        ...(doTexto.has(d.id) ? ['texto'] : []),
        ...(doVetor.has(d.id) ? ['semelhanca'] : []),
      ],
    }));

    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'pesquisar_arquivo',
      objetoTipo: 'arquivo',
      objetoId: m.id,
      dados: {
        q,
        ano: f.ano ?? null,
        tipo: f.tipo ?? null,
        freguesia: f.freguesia ?? null,
        morada: f.morada ?? null,
        resultados: itens.length,
      },
    });
    return {
      itens,
      total: itens.length,
      semelhanca: this.embeddings.disponivel,
      tipos: TIPOS_ARQUIVO.map((t) => ({ id: t, nome: NOMES_TIPO[t] })),
    };
  }

  /**
   * Para o técnico que analisa um processo novo: o que o arquivo tem na
   * mesma morada (pela chave da morada) e o que já está ligado ao processo.
   */
  async mesmaMoradaDoProcesso(
    m: Municipio,
    u: UtilizadorPainel,
    processoId: string,
  ) {
    exigirDocumentos(u);
    const [p] = await this.db.query<{
      id: string;
      numero: string;
      morada: string | null;
      freguesia: string | null;
    }>(
      'SELECT id, numero, morada, freguesia FROM processos WHERE id = $1 AND municipio_id = $2',
      [processoId, m.id],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'processo_desconhecido',
        'Este processo não existe.',
      );
    }
    const chave = chaveMorada(p.morada);
    const linhas = await this.db.query<LinhaDoc & { ligado: boolean }>(
      `SELECT ${COLUNAS},
              EXISTS (SELECT 1 FROM arquivo_documento_processos x
                      WHERE x.documento_id = d.id AND x.processo_id = $2) AS ligado
       ${FROM}
       WHERE d.municipio_id = $1
         AND (EXISTS (SELECT 1 FROM arquivo_documento_processos x
                      WHERE x.documento_id = d.id AND x.processo_id = $2)
              OR ($3::text IS NOT NULL AND d.morada_rua = $3
                  AND ($4::text IS NULL OR d.morada_porta IS NULL OR d.morada_porta = $4)))
       ORDER BY ligado DESC, d.ano NULLS LAST, d.criado_em
       LIMIT 100`,
      [m.id, p.id, chave?.rua ?? null, chave?.porta ?? null],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'pesquisar_arquivo',
      objetoTipo: 'arquivo',
      objetoId: p.id,
      dados: {
        mesma_morada: true,
        processo_id: p.id,
        resultados: linhas.length,
      },
    });
    return {
      processo: { id: p.id, numero: p.numero, morada: p.morada },
      chave_morada: chave,
      documentos: linhas.map((d) => ({
        ...this.resumo(d),
        ligado: d.ligado,
        mesma_porta: !!chave?.porta && d.morada_porta === chave.porta,
      })),
      nota: chave
        ? null
        : 'O processo não tem uma morada que se perceba: só aparecem os documentos ligados à mão.',
    };
  }

  /**
   * Pelo agente: quantos documentos prováveis para o que a pessoa disse.
   * Devolve os ids (para o pedido) e nunca o conteúdo.
   */
  async provaveis(
    municipioId: string,
    e: {
      morada?: string | null;
      requerente?: string | null;
      numero_antigo?: string | null;
      ano?: number | null;
    },
  ): Promise<string[]> {
    const termos = termosProcura(e).map((t) => `%${t}%`);
    if (!termos.length && !e.ano) return [];
    const linhas = await this.db.query<{ id: string }>(
      `SELECT d.id FROM arquivo_documentos d
       WHERE d.municipio_id = $1 AND d.estado <> 'por_processar'
         AND (cardinality($2::text[]) = 0 OR d.pesquisa LIKE ALL ($2::text[]))
         AND ($3::int IS NULL OR d.ano BETWEEN $3 - 2 AND $3 + 2
              OR (d.ano IS NULL AND d.pesquisa LIKE '%' || $3::text || '%'))
       ORDER BY d.ano NULLS LAST
       LIMIT 50`,
      [municipioId, termos, e.ano ?? null],
    );
    return linhas.map((l) => l.id);
  }

  /** Para o pedido no painel: o mínimo de cada documento provável. */
  async resumosDe(municipioId: string, ids: string[]) {
    if (!ids.length) return [];
    const linhas = await this.db.query<LinhaDoc>(
      `SELECT ${COLUNAS} ${FROM} WHERE d.municipio_id = $1 AND d.id = ANY($2::uuid[])
       ORDER BY d.ano NULLS LAST`,
      [municipioId, ids],
    );
    return linhas.map((d) => this.resumo(d));
  }

  // ------------------------------------------------------------------

  private async processosNaMorada(municipioId: string, morada: string | null) {
    const chave = chaveMorada(morada);
    if (!chave) return [];
    const palavra = chave.rua
      .split(' ')
      .filter((p) => p.length >= 3)
      .sort((a, b) => b.length - a.length)[0];
    if (!palavra) return [];
    const candidatos = await this.db.query<{
      id: string;
      numero: string;
      morada: string | null;
      fase: string;
    }>(
      `SELECT id, numero, morada, fase::text AS fase FROM processos
       WHERE municipio_id = $1 AND morada IS NOT NULL
         AND lower(unaccent(morada)) LIKE '%' || $2 || '%'
       ORDER BY criado_em DESC LIMIT 200`,
      [municipioId, palavra],
    );
    return candidatos
      .filter((p) => mesmaMorada(chaveMorada(p.morada), chave))
      .slice(0, 20);
  }

  private async porId(municipioId: string, id: string): Promise<LinhaDoc> {
    const [d] = await this.db.query<LinhaDoc>(
      `SELECT ${COLUNAS} ${FROM} WHERE d.municipio_id = $1 AND d.id = $2`,
      [municipioId, id],
    );
    if (!d) throw naoExiste();
    return d;
  }

  private resumo(d: LinhaDoc) {
    return {
      id: d.id,
      lote_id: d.lote_id,
      lote: d.lote,
      nome_ficheiro: d.nome_ficheiro,
      mime: d.mime,
      paginas: d.paginas,
      estado: d.estado,
      por_transcrever: d.estado !== 'por_processar' && d.texto === null,
      texto_origem: d.texto_origem,
      metadados_origem: d.metadados_origem,
      metadados: metadadosDe(d),
      tipo_nome: d.tipo ? NOMES_TIPO[d.tipo] : null,
      tem_embedding: d.tem_embedding,
      criado_em: d.criado_em.toISOString(),
      processado_em: d.processado_em?.toISOString() ?? null,
    };
  }
}
