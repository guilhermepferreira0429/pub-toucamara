import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { webhooksConfig } from '../../config/configuration.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { gerarPdfAta } from './ata-pdf.js';
import { DeliberacoesService } from './deliberacoes.service.js';
import { Buscar, transcrever } from './elevenlabs-stt.js';
import { conteudoAta, esquemaAtaIa, SISTEMA_ATA } from './ia.js';
import {
  completarResultados,
  DadosReuniao,
  dataPorExtenso,
  juntarAtaIa,
  montarAtaSemIa,
  verificarAta,
} from './regras.js';
import {
  BASE_LEGAL,
  ConteudoAta,
  CriarReuniao,
  esquemaAprovar,
  esquemaConteudoAta,
  esquemaEditarAta,
  esquemaMudarReuniao,
  EstadoReuniao,
  Membro,
  ORGAOS,
  Orgao,
  PontoOrdem,
  ESTADOS_REUNIAO,
  TipoReuniao,
} from './tipos.js';

export const FILA_TRANSCREVER = 'reunioes_transcrever';

export const esquemaListar = esquemaPaginacao.extend({
  orgao: z.enum(ORGAOS).optional(),
  estado: z.enum(ESTADOS_REUNIAO).optional(),
});

export const esquemaGravacao = z.object({
  mime: z
    .string()
    .trim()
    .regex(
      /^(audio\/[\w.+-]+|video\/(mp4|webm))$/,
      'Só áudio (ou vídeo mp4/webm).',
    ),
});

export const esquemaTranscricao = z.object({
  texto: z.string().trim().min(20).max(2_000_000),
});

export const esquemaRascunho = z.object({
  /** true = monta da ordem do dia mesmo com IA disponível. */
  sem_ia: z.boolean().default(false),
});

const EXTENSOES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

interface LinhaReuniao {
  id: string;
  municipio_id: string;
  orgao: Orgao;
  tipo: TipoReuniao;
  numero: string;
  data: string;
  hora: string | null;
  local: string;
  ordem_do_dia: PontoOrdem[];
  presencas: Membro[];
  estado: EstadoReuniao;
  gravacao_key: string | null;
  gravacao_mime: string | null;
  transcricao: string | null;
  transcricao_origem: 'texto' | 'elevenlabs' | null;
  transcricao_estado: 'sem' | 'a_transcrever' | 'pronta' | 'falhou';
  transcricao_erro: string | null;
  transcricao_em: Date | null;
  criada_em: Date;
  atualizada_em: Date;
}

interface LinhaAta {
  id: string;
  reuniao_id: string;
  versao: number;
  conteudo: ConteudoAta;
  origem: 'ia' | 'sem_ia';
  estado: 'rascunho' | 'aprovada' | 'publicada';
  aprovacao_modo: 'minuta' | 'reuniao_seguinte' | null;
  aprovada_na_reuniao_id: string | null;
  aprovada_na_data: string | null;
  aprovada_em: Date | null;
  publicada_em: Date | null;
  codigo_publico: string | null;
  demonstracao: boolean;
  atualizada_em: Date;
}

const COLUNAS_REUNIAO = `r.id, r.municipio_id, r.orgao, r.tipo, r.numero,
  to_char(r.data, 'YYYY-MM-DD') AS data, to_char(r.hora, 'HH24:MI') AS hora,
  r.local, r.ordem_do_dia, r.presencas, r.estado, r.gravacao_key, r.gravacao_mime,
  r.transcricao, r.transcricao_origem, r.transcricao_estado, r.transcricao_erro,
  r.transcricao_em, r.criada_em, r.atualizada_em`;

const COLUNAS_ATA = `a.id, a.reuniao_id, a.versao, a.conteudo, a.origem, a.estado,
  a.aprovacao_modo, a.aprovada_na_reuniao_id,
  (SELECT to_char(x.data, 'YYYY-MM-DD') FROM reunioes x WHERE x.id = a.aprovada_na_reuniao_id) AS aprovada_na_data,
  a.aprovada_em, a.publicada_em, a.codigo_publico, a.demonstracao, a.atualizada_em`;

function dados(r: LinhaReuniao): DadosReuniao {
  return {
    orgao: r.orgao,
    tipo: r.tipo,
    numero: r.numero,
    data: r.data,
    hora: r.hora,
    local: r.local,
    ordem_do_dia: r.ordem_do_dia,
    presencas: r.presencas,
  };
}

/** "aprovada em minuta no final da reunião" (para a ata e para o PDF). */
function textoAprovacao(a: LinhaAta): string | null {
  if (a.aprovacao_modo === 'minuta') {
    return 'aprovada em minuta no final da reunião, para produzir efeitos imediatos (Lei n.º 75/2013, Anexo I, art. 57.º, n.º 3; a confirmar com os serviços)';
  }
  if (a.aprovacao_modo === 'reuniao_seguinte') {
    return a.aprovada_na_data
      ? `lida e aprovada na reunião de ${dataPorExtenso(a.aprovada_na_data)}`
      : 'lida e aprovada na reunião seguinte';
  }
  return null;
}

/**
 * Reuniões de câmara e sessões da assembleia: da gravação (ou do texto) à
 * ata, a aprovação (em minuta ou na reunião seguinte) e a publicação, que
 * põe as deliberações no índice pesquisável.
 */
@Injectable()
export class ReunioesService {
  private readonly logger = new Logger(ReunioesService.name);
  /** O fetch do pedido ao ElevenLabs (substituível nos testes). */
  buscar: Buscar = (url, init) => fetch(url, init);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly claude: ClaudeService,
    private readonly jobs: JobsService,
    private readonly deliberacoes: DeliberacoesService,
  ) {}

  private get apiKeyElevenlabs(): string {
    return (
      this.config.get<ConfigType<typeof webhooksConfig>>('webhooks')
        ?.elevenlabsApiKey ?? ''
    );
  }

  private get apiUrl(): string {
    return this.config.get<string>('app.apiUrl') ?? '';
  }

  urlPdfPublico(codigo: string): string {
    return `${this.apiUrl}/v1/public/atas/${codigo}/pdf`;
  }

  // -------------------------------------------------------------------------
  // Reuniões
  // -------------------------------------------------------------------------

  async listar(m: Municipio, f: z.infer<typeof esquemaListar>) {
    const linhas = await this.db.query<
      LinhaReuniao & { ata_estado: string | null; ata_versao: number | null }
    >(
      `SELECT ${COLUNAS_REUNIAO}, a.estado AS ata_estado, a.versao AS ata_versao
       FROM reunioes r LEFT JOIN atas a ON a.reuniao_id = r.id
       WHERE r.municipio_id = $1
         AND ($2::text IS NULL OR r.orgao = $2)
         AND ($3::text IS NULL OR r.estado = $3)
         AND ($4::date IS NULL OR (r.data, r.id) < ($4::date, $5::uuid))
       ORDER BY r.data DESC, r.id DESC
       LIMIT $6`,
      [
        m.id,
        f.orgao ?? null,
        f.estado ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    const p = pagina(linhas, f.limite, (l) => ({ em: l.data, id: l.id }));
    return {
      ...p,
      itens: p.itens.map((r) => ({
        id: r.id,
        orgao: r.orgao,
        tipo: r.tipo,
        numero: r.numero,
        data: r.data,
        hora: r.hora,
        local: r.local,
        estado: r.estado,
        pontos: r.ordem_do_dia.length,
        transcricao_estado: r.transcricao_estado,
        ata: r.ata_estado
          ? { estado: r.ata_estado, versao: r.ata_versao }
          : null,
      })),
    };
  }

  async criar(m: Municipio, u: UtilizadorPainel, d: CriarReuniao) {
    const id = await this.db.transaction(async (tx) => {
      const ano = Number(d.data.slice(0, 4));
      const seq = await proximoNumero(
        tx,
        m.id,
        d.orgao === 'camara' ? 'RC' : 'SAM',
        ano,
      );
      const [r] = await tx.query<{ id: string }>(
        `INSERT INTO reunioes (municipio_id, orgao, tipo, numero, data, hora, local,
           ordem_do_dia, presencas, criada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          m.id,
          d.orgao,
          d.tipo,
          `${seq}/${ano}`,
          d.data,
          d.hora,
          d.local,
          JSON.stringify(d.ordem_do_dia),
          JSON.stringify(d.presencas),
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar',
          objetoTipo: 'reuniao',
          objetoId: r.id,
          dados: { orgao: d.orgao, data: d.data },
        },
        tx,
      );
      return r.id;
    });
    return this.detalhe(m, id);
  }

  private async reuniao(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    id: string,
    bloquear = false,
  ): Promise<LinhaReuniao> {
    const [r] = await q.query<LinhaReuniao>(
      `SELECT ${COLUNAS_REUNIAO} FROM reunioes r
       WHERE r.id = $1 AND r.municipio_id = $2${bloquear ? ' FOR UPDATE' : ''}`,
      [id, municipioId],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'reuniao_nao_encontrada',
        'Reunião não encontrada.',
      );
    }
    return r;
  }

  private async ataDe(
    q: Pick<Tx, 'query'>,
    reuniaoId: string,
    bloquear = false,
  ): Promise<LinhaAta | null> {
    const [a] = await q.query<LinhaAta>(
      `SELECT ${COLUNAS_ATA} FROM atas a WHERE a.reuniao_id = $1${bloquear ? ' FOR UPDATE' : ''}`,
      [reuniaoId],
    );
    return a ?? null;
  }

  async detalhe(m: Municipio, id: string) {
    const r = await this.reuniao(this.db, m.id, id);
    const a = await this.ataDe(this.db, id);
    return {
      id: r.id,
      orgao: r.orgao,
      tipo: r.tipo,
      numero: r.numero,
      data: r.data,
      hora: r.hora,
      local: r.local,
      estado: r.estado,
      ordem_do_dia: r.ordem_do_dia,
      presencas: r.presencas,
      gravacao: r.gravacao_key ? { mime: r.gravacao_mime } : null,
      transcricao: {
        estado: r.transcricao_estado,
        origem: r.transcricao_origem,
        erro: r.transcricao_erro,
        em: r.transcricao_em,
        texto: r.transcricao,
      },
      ata: a ? this.vistaAta(a) : null,
      pode_transcrever_audio:
        this.armazenamento.disponivel && !!this.apiKeyElevenlabs,
      ia_disponivel: this.claude.disponivel,
    };
  }

  /** Dados, ordem do dia e presenças: só enquanto a ata não está aprovada. */
  async mudar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.infer<typeof esquemaMudarReuniao>,
  ) {
    await this.db.transaction(async (tx) => {
      const r = await this.reuniao(tx, m.id, id, true);
      if (['ata_aprovada', 'publicada'].includes(r.estado)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ata_ja_aprovada',
          'A ata já foi aprovada: a reunião não se altera.',
        );
      }
      if (d.estado && r.estado !== 'agendada') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'Só uma reunião agendada passa a realizada.',
        );
      }
      await tx.query(
        `UPDATE reunioes SET
           tipo = coalesce($2, tipo), data = coalesce($3::date, data),
           hora = CASE WHEN $4::boolean THEN $5::time ELSE hora END,
           local = coalesce($6, local),
           ordem_do_dia = coalesce($7::jsonb, ordem_do_dia),
           presencas = coalesce($8::jsonb, presencas),
           estado = coalesce($9, estado), atualizada_em = now()
         WHERE id = $1`,
        [
          id,
          d.tipo ?? null,
          d.data ?? null,
          d.hora !== undefined,
          d.hora ?? null,
          d.local ?? null,
          d.ordem_do_dia ? JSON.stringify(d.ordem_do_dia) : null,
          d.presencas ? JSON.stringify(d.presencas) : null,
          d.estado ?? null,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'atualizar',
          objetoTipo: 'reuniao',
          objetoId: id,
          dados: { campos: Object.keys(d) },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  // -------------------------------------------------------------------------
  // Gravação e transcrição
  // -------------------------------------------------------------------------

  /** URL para o browser enviar a gravação (PUT) diretamente para o S3. */
  async urlEnvioGravacao(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    mime: string,
  ) {
    if (!this.armazenamento.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'armazenamento_indisponivel',
        'Armazenamento de ficheiros por configurar (S3_BUCKET): envie a transcrição em texto.',
      );
    }
    const r = await this.reuniao(this.db, m.id, id);
    if (['ata_aprovada', 'publicada'].includes(r.estado)) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ata_ja_aprovada',
        'A ata já foi aprovada.',
      );
    }
    const chave = this.armazenamento.chave(
      m.slug,
      'gravacoes',
      EXTENSOES[mime] ?? 'bin',
    );
    const url = await this.armazenamento.urlEnvio(chave, mime);
    await this.db.query(
      `UPDATE reunioes SET gravacao_key = $2, gravacao_mime = $3, atualizada_em = now()
       WHERE id = $1`,
      [id, chave, mime],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'enviar_gravacao_reuniao',
      objetoTipo: 'reuniao',
      objetoId: id,
      dados: { mime },
    });
    return { url_envio: url, metodo: 'PUT', mime, validade_minutos: 10 };
  }

  /** Ouvir a gravação (URL assinada de 5 minutos, fica no registo de acessos). */
  async urlGravacao(m: Municipio, u: UtilizadorPainel, id: string) {
    const r = await this.reuniao(this.db, m.id, id);
    if (!r.gravacao_key) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_gravacao',
        'Esta reunião não tem gravação.',
      );
    }
    const url = await this.armazenamento.urlLeitura(r.gravacao_key);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'ouvir_gravacao',
      objetoTipo: 'reuniao',
      objetoId: id,
    });
    return { url, validade_minutos: 5 };
  }

  /** Põe a transcrição da gravação na fila (ElevenLabs speech-to-text). */
  async pedirTranscricao(m: Municipio, u: UtilizadorPainel, id: string) {
    if (!this.armazenamento.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'armazenamento_indisponivel',
        'Armazenamento de ficheiros por configurar (S3_BUCKET): envie a transcrição em texto.',
      );
    }
    if (!this.apiKeyElevenlabs) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'transcricao_indisponivel',
        'A transcrição automática não está ligada: envie a transcrição em texto.',
      );
    }
    const r = await this.reuniao(this.db, m.id, id);
    if (!r.gravacao_key) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_gravacao',
        'Envie primeiro a gravação.',
      );
    }
    await this.db.query(
      `UPDATE reunioes SET transcricao_estado = 'a_transcrever', transcricao_erro = NULL,
         gravacao_pedida_em = now(), atualizada_em = now()
       WHERE id = $1`,
      [id],
    );
    await this.jobs.enviar(
      FILA_TRANSCREVER,
      { reuniao_id: id },
      { singletonKey: id, retryLimit: 1 },
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'transcrever_reuniao',
      objetoTipo: 'reuniao',
      objetoId: id,
    });
    return { transcricao_estado: 'a_transcrever' as const };
  }

  /** Job: pede a transcrição ao ElevenLabs e guarda-a. */
  async transcreverGravacao(reuniaoId: string): Promise<void> {
    const [r] = await this.db.query<{
      municipio_id: string;
      gravacao_key: string | null;
    }>(`SELECT municipio_id, gravacao_key FROM reunioes WHERE id = $1`, [
      reuniaoId,
    ]);
    if (!r?.gravacao_key) return;
    const falhou = async (erro: string) => {
      this.logger.warn(`Transcrição da reunião ${reuniaoId}: ${erro}`);
      await this.db.query(
        `UPDATE reunioes SET transcricao_estado = 'falhou', transcricao_erro = $2,
           atualizada_em = now() WHERE id = $1`,
        [reuniaoId, erro.slice(0, 500)],
      );
    };
    if (!this.apiKeyElevenlabs || !this.armazenamento.disponivel) {
      await falhou('Sem ELEVENLABS_API_KEY ou sem S3.');
      return;
    }
    const url = await this.armazenamento.urlLeitura(r.gravacao_key, 60);
    const t = await transcrever(this.buscar, {
      apiKey: this.apiKeyElevenlabs,
      urlGravacao: url,
    });
    if (!t.ok) {
      await falhou(t.erro);
      return;
    }
    await this.guardarTranscricao(
      r.municipio_id,
      reuniaoId,
      t.texto,
      'elevenlabs',
    );
    await this.auditoria.registar({
      municipioId: r.municipio_id,
      atorTipo: 'sistema',
      acao: 'gravar_transcricao_reuniao',
      objetoTipo: 'reuniao',
      objetoId: reuniaoId,
      dados: { origem: 'elevenlabs', caracteres: t.texto.length },
    });
  }

  private async guardarTranscricao(
    municipioId: string,
    id: string,
    texto: string,
    origem: 'texto' | 'elevenlabs',
  ) {
    await this.db.query(
      `UPDATE reunioes SET transcricao = $3, transcricao_origem = $4,
         transcricao_estado = 'pronta', transcricao_erro = NULL, transcricao_em = now(),
         estado = CASE WHEN estado = 'agendada' THEN 'realizada' ELSE estado END,
         atualizada_em = now()
       WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId, texto, origem],
    );
  }

  /** A transcrição em texto (com "Nome: ..." para marcar quem fala, opcional). */
  async gravarTranscricao(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    texto: string,
  ) {
    const r = await this.reuniao(this.db, m.id, id);
    if (['ata_aprovada', 'publicada'].includes(r.estado)) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ata_ja_aprovada',
        'A ata já foi aprovada.',
      );
    }
    await this.guardarTranscricao(m.id, id, texto, 'texto');
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'gravar_transcricao_reuniao',
      objetoTipo: 'reuniao',
      objetoId: id,
      dados: { origem: 'texto', caracteres: texto.length },
    });
    return this.detalhe(m, id);
  }

  // -------------------------------------------------------------------------
  // Ata
  // -------------------------------------------------------------------------

  private vistaAta(a: LinhaAta) {
    const v = verificarAta(a.conteudo);
    return {
      id: a.id,
      versao: a.versao,
      origem: a.origem,
      estado: a.estado,
      conteudo: a.conteudo,
      pendentes: v.pendentes,
      avisos: v.avisos,
      aprovacao: a.aprovacao_modo
        ? {
            modo: a.aprovacao_modo,
            reuniao_id: a.aprovada_na_reuniao_id,
            em: a.aprovada_em,
            texto: textoAprovacao(a),
          }
        : null,
      publicada_em: a.publicada_em,
      url_pdf_publico: a.codigo_publico
        ? this.urlPdfPublico(a.codigo_publico)
        : null,
      base_legal: BASE_LEGAL,
      demonstracao: a.demonstracao,
    };
  }

  async ata(m: Municipio, id: string) {
    await this.reuniao(this.db, m.id, id);
    const a = await this.ataDe(this.db, id);
    if (!a) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_ata',
        'Esta reunião ainda não tem ata.',
      );
    }
    return this.vistaAta(a);
  }

  /**
   * O rascunho da ata: com IA (se houver chave e transcrição) ou montado da
   * ordem do dia. Se já houver rascunho, fica como nova versão.
   */
  async gerarRascunho(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    o: z.infer<typeof esquemaRascunho>,
  ) {
    const r = await this.reuniao(this.db, m.id, id);
    if (['ata_aprovada', 'publicada'].includes(r.estado)) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ata_ja_aprovada',
        'A ata já foi aprovada: o rascunho não se refaz.',
      );
    }
    if (!r.ordem_do_dia.length) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_ordem_do_dia',
        'A reunião não tem ordem do dia.',
      );
    }
    let conteudo: ConteudoAta;
    let origem: 'ia' | 'sem_ia' = 'sem_ia';
    let erroIa: string | null = null;
    if (!o.sem_ia && this.claude.disponivel && r.transcricao) {
      try {
        const ia = await this.claude.extrair(esquemaAtaIa, {
          tarefa: 'ata_reuniao',
          sistema: SISTEMA_ATA,
          conteudo: conteudoAta(dados(r), r.transcricao),
          esforco: 'high',
          maxTokens: 32000,
        });
        conteudo = juntarAtaIa(dados(r), ia, r.transcricao);
        origem = 'ia';
      } catch (e) {
        erroIa = (e as Error).message;
        this.logger.warn(`Ata com IA falhou (${id}): ${erroIa}`);
        conteudo = montarAtaSemIa(dados(r), r.transcricao);
        conteudo.notas.unshift(
          `A IA falhou (${erroIa}): rascunho montado sem IA.`,
        );
      }
    } else {
      conteudo = montarAtaSemIa(dados(r), r.transcricao);
      if (!o.sem_ia && !this.claude.disponivel && r.transcricao) {
        conteudo.notas.push(
          'O assistente de IA não está ligado: as notas foram montadas sem ele.',
        );
      }
    }
    conteudo = esquemaConteudoAta.parse(conteudo);

    await this.db.transaction(async (tx) => {
      await this.reuniao(tx, m.id, id, true);
      const atual = await this.ataDe(tx, id, true);
      let ataId: string;
      let versao: number;
      if (atual) {
        if (atual.estado !== 'rascunho') {
          throw new ErroApi(
            HttpStatus.CONFLICT,
            'ata_ja_aprovada',
            'A ata já foi aprovada.',
          );
        }
        versao = atual.versao + 1;
        ataId = atual.id;
        await tx.query(
          `UPDATE atas SET conteudo = $2, origem = $3, versao = $4, atualizada_em = now()
           WHERE id = $1`,
          [ataId, JSON.stringify(conteudo), origem, versao],
        );
      } else {
        versao = 1;
        const [a] = await tx.query<{ id: string }>(
          `INSERT INTO atas (municipio_id, reuniao_id, conteudo, origem)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [m.id, id, JSON.stringify(conteudo), origem],
        );
        ataId = a.id;
      }
      await tx.query(
        `INSERT INTO ata_versoes (municipio_id, ata_id, versao, origem, conteudo, alterado_por, nota)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          m.id,
          ataId,
          versao,
          origem,
          JSON.stringify(conteudo),
          u.id,
          origem === 'ia'
            ? 'Rascunho com IA'
            : 'Rascunho montado da ordem do dia',
        ],
      );
      await tx.query(
        `UPDATE reunioes SET estado = 'ata_rascunho', atualizada_em = now() WHERE id = $1`,
        [id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'gerar_rascunho_ata',
          objetoTipo: 'ata',
          objetoId: ataId,
          dados: { reuniao_id: id, origem, versao },
        },
        tx,
      );
    });
    return { ...(await this.ata(m, id)), ia_falhou: erroIa !== null };
  }

  /** Grava uma edição do rascunho como versão nova. */
  async editarAta(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.infer<typeof esquemaEditarAta>,
  ) {
    const conteudo = completarResultados(d.conteudo);
    await this.db.transaction(async (tx) => {
      await this.reuniao(tx, m.id, id, true);
      const a = await this.ataDe(tx, id, true);
      if (!a) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'sem_ata',
          'Esta reunião ainda não tem ata.',
        );
      }
      if (a.estado !== 'rascunho') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ata_ja_aprovada',
          'A ata já foi aprovada: não se edita.',
        );
      }
      if (a.versao !== d.versao) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'versao_desatualizada',
          `Entretanto houve outra versão (${a.versao}): recarregue antes de gravar.`,
          { versao_atual: a.versao },
        );
      }
      const versao = a.versao + 1;
      await tx.query(
        `UPDATE atas SET conteudo = $2, versao = $3, atualizada_em = now() WHERE id = $1`,
        [a.id, JSON.stringify(conteudo), versao],
      );
      await tx.query(
        `INSERT INTO ata_versoes (municipio_id, ata_id, versao, origem, conteudo, alterado_por, nota)
         VALUES ($1, $2, $3, 'edicao', $4, $5, $6)`,
        [m.id, a.id, versao, JSON.stringify(conteudo), u.id, d.nota],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'editar_ata',
          objetoTipo: 'ata',
          objetoId: a.id,
          dados: { reuniao_id: id, versao },
        },
        tx,
      );
    });
    return this.ata(m, id);
  }

  async versoes(m: Municipio, id: string) {
    await this.reuniao(this.db, m.id, id);
    const itens = await this.db.query(
      `SELECT v.versao, v.origem, v.nota, v.criado_em, ut.nome AS alterado_por
       FROM ata_versoes v
       JOIN atas a ON a.id = v.ata_id
       LEFT JOIN utilizadores ut ON ut.id = v.alterado_por
       WHERE a.reuniao_id = $1 AND a.municipio_id = $2
       ORDER BY v.versao DESC`,
      [id, m.id],
    );
    return { itens };
  }

  async versao(m: Municipio, id: string, versao: number) {
    await this.reuniao(this.db, m.id, id);
    const [v] = await this.db.query(
      `SELECT v.versao, v.origem, v.nota, v.criado_em, v.conteudo
       FROM ata_versoes v JOIN atas a ON a.id = v.ata_id
       WHERE a.reuniao_id = $1 AND a.municipio_id = $2 AND v.versao = $3`,
      [id, m.id, versao],
    );
    if (!v) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'versao_nao_encontrada',
        'Versão não encontrada.',
      );
    }
    return v;
  }

  /** Aprovar: em minuta (no fim da própria reunião) ou na reunião seguinte. */
  async aprovar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.infer<typeof esquemaAprovar>,
  ) {
    await this.db.transaction(async (tx) => {
      const r = await this.reuniao(tx, m.id, id, true);
      const a = await this.ataDe(tx, id, true);
      if (!a) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'sem_ata',
          'Esta reunião ainda não tem ata.',
        );
      }
      if (a.estado !== 'rascunho') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ata_ja_aprovada',
          'A ata já foi aprovada.',
        );
      }
      const v = verificarAta(a.conteudo);
      if (v.pendentes.length) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ata_incompleta',
          `A ata ainda tem ${v.pendentes.length} ${v.pendentes.length === 1 ? 'coisa' : 'coisas'} por preencher.`,
          { pendentes: v.pendentes },
        );
      }
      if (d.modo === 'reuniao_seguinte') {
        const [s] = await tx.query<{ orgao: string; data: string }>(
          `SELECT orgao, to_char(data, 'YYYY-MM-DD') AS data FROM reunioes
           WHERE id = $1 AND municipio_id = $2`,
          [d.reuniao_id, m.id],
        );
        if (!s || s.orgao !== r.orgao || s.data <= r.data) {
          throw new ErroApi(
            HttpStatus.BAD_REQUEST,
            'reuniao_aprovacao_invalida',
            'A reunião da aprovação tem de ser do mesmo órgão e posterior a esta.',
          );
        }
      }
      await tx.query(
        `UPDATE atas SET estado = 'aprovada', aprovacao_modo = $2, aprovada_na_reuniao_id = $3,
           aprovada_em = now(), aprovada_por = $4, atualizada_em = now()
         WHERE id = $1`,
        [
          a.id,
          d.modo,
          d.modo === 'reuniao_seguinte' ? d.reuniao_id : null,
          u.id,
        ],
      );
      await tx.query(
        `UPDATE reunioes SET estado = 'ata_aprovada', atualizada_em = now() WHERE id = $1`,
        [id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'aprovar_ata',
          objetoTipo: 'ata',
          objetoId: a.id,
          dados: { reuniao_id: id, modo: d.modo, versao: a.versao },
        },
        tx,
      );
    });
    return this.ata(m, id);
  }

  /**
   * Publicar: a ata fica com um código público (o PDF) e as deliberações
   * entram no índice pesquisável (painel, página pública e agente).
   */
  async publicar(m: Municipio, u: UtilizadorPainel, id: string) {
    const ids = await this.db.transaction(async (tx) => {
      const r = await this.reuniao(tx, m.id, id, true);
      const a = await this.ataDe(tx, id, true);
      if (!a || a.estado === 'rascunho') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ata_por_aprovar',
          'Só se publica uma ata aprovada.',
        );
      }
      if (a.estado === 'publicada') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ata_ja_publicada',
          'A ata já está publicada.',
        );
      }
      const codigo = randomBytes(9).toString('base64url');
      await tx.query(
        `UPDATE atas SET estado = 'publicada', publicada_em = now(), publicada_por = $2,
           codigo_publico = $3, atualizada_em = now()
         WHERE id = $1`,
        [a.id, u.id, codigo],
      );
      await tx.query(
        `UPDATE reunioes SET estado = 'publicada', atualizada_em = now() WHERE id = $1`,
        [id],
      );
      const novos = await this.deliberacoes.indexar(tx, {
        municipioId: m.id,
        reuniaoId: id,
        ataId: a.id,
        orgao: r.orgao,
        data: r.data,
        conteudo: a.conteudo,
      });
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'publicar_ata',
          objetoTipo: 'ata',
          objetoId: a.id,
          dados: { reuniao_id: id, deliberacoes: novos.length },
        },
        tx,
      );
      return novos;
    });
    // Fora da transação: sem embeddings (ou se falharem) fica só o texto.
    await this.deliberacoes.vetorizar(ids);
    return { ...(await this.ata(m, id)), deliberacoes_indexadas: ids.length };
  }

  // -------------------------------------------------------------------------
  // PDF e página pública
  // -------------------------------------------------------------------------

  async pdfPainel(m: Municipio, id: string) {
    const r = await this.reuniao(this.db, m.id, id);
    const a = await this.ataDe(this.db, id);
    if (!a) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_ata',
        'Esta reunião ainda não tem ata.',
      );
    }
    return this.pdf(m.nome, r, a);
  }

  private async pdf(municipio: string, r: LinhaReuniao, a: LinhaAta) {
    const pdf = await gerarPdfAta({
      municipio,
      conteudo: a.conteudo,
      estado: a.estado,
      versao: a.versao,
      aprovacao: textoAprovacao(a),
      url: a.codigo_publico ? this.urlPdfPublico(a.codigo_publico) : null,
    });
    const nome = `ata-${r.orgao}-${r.numero.replace('/', '-')}${a.estado === 'rascunho' ? '-rascunho' : ''}.pdf`;
    return { nome, pdf };
  }

  private async publicada(codigo: string) {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(codigo)) return null;
    const [l] = await this.db.query<{
      reuniao_id: string;
      municipio: string;
      municipio_id: string;
    }>(
      `SELECT a.reuniao_id, mu.nome AS municipio, mu.id AS municipio_id
       FROM atas a JOIN municipios mu ON mu.id = a.municipio_id
       WHERE a.codigo_publico = $1 AND a.estado = 'publicada'`,
      [codigo],
    );
    if (!l) return null;
    const r = await this.reuniao(this.db, l.municipio_id, l.reuniao_id);
    const a = (await this.ataDe(this.db, l.reuniao_id))!;
    return { municipio: l.municipio, r, a };
  }

  private naoPublicada(): never {
    throw new ErroApi(
      HttpStatus.NOT_FOUND,
      'ata_nao_encontrada',
      'Ata não encontrada ou ainda não publicada.',
    );
  }

  async pdfPublico(codigo: string) {
    const p = await this.publicada(codigo);
    if (!p) this.naoPublicada();
    return this.pdf(p.municipio, p.r, p.a);
  }

  /** A ata publicada, para a página pública (sem a transcrição). */
  async ataPublica(codigo: string) {
    const p = await this.publicada(codigo);
    if (!p) this.naoPublicada();
    const { r, a } = p;
    return {
      municipio: p.municipio,
      orgao: r.orgao,
      tipo: r.tipo,
      numero: r.numero,
      data: r.data,
      local: r.local,
      aprovacao: textoAprovacao(a),
      publicada_em: a.publicada_em,
      url_pdf: this.urlPdfPublico(codigo),
      deliberacoes: await this.deliberacoes.daAta(a.id),
      base_legal: BASE_LEGAL,
    };
  }
}
