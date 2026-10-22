import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { hojeLisboa, somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { webhooksConfig } from '../../config/configuration.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { MIME_FOTOS } from '../ocorrencias/ocorrencias.regras.js';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service.js';
import { ProcessosService } from '../processos/processos.service.js';
import {
  type Buscar,
  MIME_AUDIO,
  MODELO_STT_POR_OMISSAO,
  transcrever,
} from './elevenlabs-stt.js';
import { planearDia } from './planeamento.js';
import {
  aplicarRespostas,
  checklistDe,
  checklistReinspecao,
  CONCLUSOES,
  type Conclusao,
  type ConfigFiscalizacao,
  conteudoIa,
  daIa,
  dataCurta,
  dataLimite,
  esquemaEstruturado,
  ESTADOS_VISITA,
  type EstadoVisita,
  formatarNumero,
  type ItemChecklist,
  lerConfig,
  naoConforme,
  NOMES_CONCLUSAO,
  NOMES_ESTADO,
  NOMES_TIPO,
  notaOcorrencia,
  notaProcesso,
  ORIGENS,
  type OrigemVisita,
  relatorioLivre,
  type RelatorioEstruturado,
  RESPOSTAS,
  SISTEMA_IA,
  TIPOS_VISITA,
  type TipoVisita,
} from './regras.js';
import { gerarPdfVistoria } from './relatorio-pdf.js';

// ---------------------------------------------------------------------
// Esquemas dos pedidos
// ---------------------------------------------------------------------

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

const esquemaItemNovo = z.object({
  rotulo: z.string().trim().min(3).max(300),
  conforme_se: z.enum(['sim', 'nao']).nullable().default('sim'),
  artigo: z.string().trim().max(120).nullable().default(null),
});

const comum = {
  tipo: z.enum(TIPOS_VISITA).optional(),
  motivo: z.string().trim().min(3).max(2000).optional(),
  fiscal_id: z.guid().nullable().optional(),
  dia: z.iso.date().nullable().optional(),
  janela_inicio: hora.nullable().optional(),
  janela_fim: hora.nullable().optional(),
  /** Substitui a checklist do tipo. */
  checklist: z.array(esquemaItemNovo).min(1).max(30).optional(),
};

const coordenadas = {
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
};

export const esquemaNovaVisita = z.discriminatedUnion('origem', [
  z.object({
    origem: z.literal('ocorrencia'),
    ocorrencia_id: z.guid(),
    ...comum,
  }),
  z.object({
    origem: z.literal('processo'),
    processo_id: z.guid(),
    /** Se o processo não tiver morada. */
    morada: z.string().trim().min(3).max(300).optional(),
    ...coordenadas,
    ...comum,
  }),
  z.object({
    origem: z.literal('manual'),
    ...comum,
    tipo: z.enum(TIPOS_VISITA).exclude(['reinspecao']),
    motivo: z.string().trim().min(3).max(2000),
    morada: z.string().trim().min(3).max(300),
    ...coordenadas,
  }),
]);

export const esquemaAlterarVisita = z
  .object({
    ...comum,
    morada: z.string().trim().min(3).max(300).optional(),
    ...coordenadas,
  })
  .refine(
    (a) => Object.values(a).some((v) => v !== undefined),
    'Nada para alterar.',
  );

export const esquemaFiltroVisitas = esquemaPaginacao.extend({
  estado: z.enum(ESTADOS_VISITA).optional(),
  abertas: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  fiscal_id: z.guid().optional(),
  dia: z.iso.date().optional(),
  origem: z.enum(ORIGENS).optional(),
  ocorrencia_id: z.guid().optional(),
  processo_id: z.guid().optional(),
});

export const esquemaPlano = z.object({
  dia: z.iso.date(),
  fiscal_id: z.guid().optional(),
  partida_lat: z.coerce.number().min(-90).max(90).optional(),
  partida_lng: z.coerce.number().min(-180).max(180).optional(),
  inicio: hora.optional(),
  regressar: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(true),
});

const esquemaResposta = z.object({
  chave: z.string().trim().min(1).max(80),
  resposta: z.enum(RESPOSTAS).nullable(),
  nota: z.string().trim().max(1000).nullable().optional(),
});

export const esquemaRelatorioTexto = z.object({
  /** O texto do ditado do telemóvel (ou escrito). */
  texto: z.string().trim().min(10).max(20_000),
  /** Respostas dadas à mão (ganham às da IA). */
  checklist: z.array(esquemaResposta).max(40).optional(),
});

export const esquemaCorrigirRelatorio = z
  .object({
    resumo: z.string().trim().max(2000).optional(),
    constatacoes: z
      .array(z.string().trim().min(1).max(1000))
      .max(50)
      .optional(),
    infracoes: z
      .array(
        z.object({
          descricao: z.string().trim().min(3).max(1000),
          artigo: z.string().trim().max(120).nullable().default(null),
        }),
      )
      .max(30)
      .optional(),
    medidas: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
    prazo_dias: z.number().int().min(1).max(365).nullable().optional(),
    prazo_data: z.iso.date().nullable().optional(),
    fotos_referidas: z
      .array(z.string().trim().min(1).max(500))
      .max(30)
      .optional(),
    conclusao: z.enum(CONCLUSOES).optional(),
    checklist: z.array(esquemaResposta).max(40).optional(),
  })
  .refine(
    (a) => Object.values(a).some((v) => v !== undefined),
    'Nada para alterar.',
  );

export const esquemaEnvioAudio = z.object({
  mime: z
    .string()
    .trim()
    .toLowerCase()
    .transform((m) => m.split(';')[0].trim())
    .refine((m) => m in MIME_AUDIO, {
      message: `Formatos aceites: ${Object.keys(MIME_AUDIO).join(', ')}.`,
    }),
});

export const esquemaEnvioFoto = z.object({
  mime: z
    .string()
    .trim()
    .toLowerCase()
    .refine((m) => m in MIME_FOTOS, {
      message: 'Só se aceitam fotografias (JPEG, PNG, WebP ou HEIC).',
    }),
  legenda: z.string().trim().max(300).optional(),
});

export const esquemaCancelar = z.object({
  motivo: z.string().trim().min(3).max(1000),
});

// ---------------------------------------------------------------------

interface LinhaVisita {
  id: string;
  numero: string;
  tipo: TipoVisita;
  origem: OrigemVisita;
  ocorrencia_id: string | null;
  processo_id: string | null;
  visita_anterior_id: string | null;
  estado: EstadoVisita;
  fiscal_id: string | null;
  fiscal_nome: string | null;
  dia: string | null;
  janela_inicio: string | null;
  janela_fim: string | null;
  morada: string;
  lat: number | null;
  lng: number | null;
  motivo: string;
  checklist: ItemChecklist[];
  prazo_correcao: string | null;
  feita_em: Date | null;
  cancelada_em: Date | null;
  motivo_cancelamento: string | null;
  criada_em: Date;
  atualizada_em: Date;
}

interface LinhaRelatorio {
  id: string;
  fonte: 'texto' | 'audio';
  audio_key: string | null;
  audio_mime: string | null;
  transcricao: string | null;
  transcrito_por: 'dispositivo' | 'elevenlabs' | null;
  estruturado: RelatorioEstruturado | null;
  estruturado_por: 'ia' | 'manual' | null;
  conclusao: Conclusao | null;
  prazo_correcao: string | null;
  fechado_em: Date | null;
  autor_id: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS_VISITA = `
  v.id, v.numero, v.tipo, v.origem, v.ocorrencia_id, v.processo_id, v.visita_anterior_id,
  v.estado, v.fiscal_id, f.nome AS fiscal_nome, to_char(v.dia, 'YYYY-MM-DD') AS dia,
  to_char(v.janela_inicio, 'HH24:MI') AS janela_inicio, to_char(v.janela_fim, 'HH24:MI') AS janela_fim,
  v.morada, v.lat, v.lng, v.motivo, v.checklist, to_char(v.prazo_correcao, 'YYYY-MM-DD') AS prazo_correcao,
  v.feita_em, v.cancelada_em, v.motivo_cancelamento, v.criada_em, v.atualizada_em`;

const ABERTAS: EstadoVisita[] = ['por_agendar', 'agendada'];

/** 'quarta-feira, 21 de outubro de 2026'. */
function porExtenso(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-PT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Fiscalização no terreno: visitas (a partir de ocorrências, processos ou à
 * mão), o plano do dia por proximidade, o relatório ditado por voz (texto
 * do telemóvel ou áudio transcrito pelo ElevenLabs, estruturado pela IA ou
 * em relatório livre) e o que acontece depois (ocorrência, processo, nova
 * visita por infração, SMS ao munícipe).
 */
@Injectable()
export class FiscalizacaoService {
  private readonly logger = new Logger(FiscalizacaoService.name);
  /** Substituível nos testes (pedido HTTP ao ElevenLabs). */
  buscar: Buscar = (url, init) => fetch(url, init);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly links: LinksCurtosService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly claude: ClaudeService,
    private readonly ocorrencias: OcorrenciasService,
    private readonly processos: ProcessosService,
    private readonly geo: GeocodificacaoService,
  ) {}

  /** A chave do ElevenLabs (substituível nos testes). */
  chaveElevenlabs = (): string => {
    return (
      this.config.get<ConfigType<typeof webhooksConfig>>('webhooks')
        ?.elevenlabsApiKey ?? ''
    );
  };

  // ------------------------------------------------------------------
  // Configuração e opções
  // ------------------------------------------------------------------

  async configDe(municipioId: string): Promise<ConfigFiscalizacao> {
    const [r] = await this.db.query<{ c: unknown }>(
      'SELECT fiscalizacao_config AS c FROM municipios WHERE id = $1',
      [municipioId],
    );
    return lerConfig(r?.c);
  }

  async guardarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    c: ConfigFiscalizacao,
  ) {
    await this.db.query(
      'UPDATE municipios SET fiscalizacao_config = $2 WHERE id = $1',
      [m.id, JSON.stringify(c)],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_config_fiscalizacao',
      objetoTipo: 'fiscalizacao_config',
      objetoId: m.id,
      dados: {
        ponto_partida: c.ponto_partida?.nome ?? null,
        velocidade_kmh: c.velocidade_kmh,
        demonstracao: c.demonstracao,
      },
    });
    return { config: c };
  }

  /** Tipos (com a checklist e a duração), fiscais, estados e a configuração. */
  async opcoes(m: Municipio) {
    const [config, fiscais] = await Promise.all([
      this.configDe(m.id),
      this.db.query(
        `SELECT id, nome, perfil FROM utilizadores
         WHERE municipio_id = $1 AND ativo AND perfil IN ('tecnico', 'chefe_divisao')
         ORDER BY nome`,
        [m.id],
      ),
    ]);
    return {
      tipos: TIPOS_VISITA.map((t) => ({
        tipo: t,
        nome: NOMES_TIPO[t],
        duracao_min: config.duracao_min[t],
        checklist: checklistDe(t),
      })),
      estados: ESTADOS_VISITA.map((e) => ({
        estado: e,
        nome: NOMES_ESTADO[e],
      })),
      fiscais,
      config,
      transcricao_audio: {
        armazenamento: this.armazenamento.disponivel,
        elevenlabs: !!this.chaveElevenlabs(),
      },
      ia: this.claude.disponivel,
      // Checklists, durações, velocidade e prazo: por confirmar com a câmara.
      demonstracao: true,
    };
  }

  // ------------------------------------------------------------------
  // Visitas
  // ------------------------------------------------------------------

  async criar(
    m: Municipio,
    u: UtilizadorPainel,
    b: z.output<typeof esquemaNovaVisita>,
  ) {
    const id = await this.db.transaction(async (tx) => {
      if (b.fiscal_id) await this.verificarFiscal(tx, m.id, b.fiscal_id);
      let dados: Omit<
        NovaVisita,
        'fiscal_id' | 'dia' | 'janela_inicio' | 'janela_fim' | 'checklist'
      >;
      if (b.origem === 'ocorrencia') {
        dados = await this.dadosOcorrencia(tx, m.id, b.ocorrencia_id, b);
      } else if (b.origem === 'processo') {
        dados = await this.dadosProcesso(tx, m.id, b.processo_id, b);
      } else {
        let { lat, lng } = b;
        if (lat == null || lng == null) {
          const c = await this.geo
            .geocodificar(b.morada, m.nome)
            .catch(() => null);
          lat = c?.lat ?? null;
          lng = c?.lng ?? null;
        }
        dados = {
          tipo: b.tipo,
          origem: 'manual',
          ocorrencia_id: null,
          processo_id: null,
          visita_anterior_id: null,
          morada: b.morada,
          lat: lat ?? null,
          lng: lng ?? null,
          motivo: b.motivo,
          prazo_correcao: null,
        };
      }
      const tipo = b.tipo ?? dados.tipo;
      const nova = await this.inserirVisita(tx, m, u, {
        ...dados,
        tipo,
        fiscal_id: b.fiscal_id ?? null,
        dia: b.dia ?? null,
        janela_inicio: b.janela_inicio ?? null,
        janela_fim: b.janela_fim ?? null,
        checklist: b.checklist ? deItensNovos(b.checklist) : checklistDe(tipo),
      });

      if (dados.ocorrencia_id) {
        await tx.query(
          `UPDATE ocorrencias SET estado = 'com_equipa' WHERE id = $1 AND estado = 'nova'`,
          [dados.ocorrencia_id],
        );
        await this.eventoOcorrencia(
          tx,
          dados.ocorrencia_id,
          u,
          'fiscalizacao',
          {
            visita_id: nova.id,
            numero: nova.numero,
            nota: 'Passada à fiscalização.',
          },
        );
      }
      if (dados.processo_id) {
        await this.eventoProcesso(
          tx,
          dados.processo_id,
          u,
          'vistoria_pedida',
          `Pedida ${NOMES_TIPO[tipo].toLowerCase()} (${nova.numero}).`,
          true,
          { visita_id: nova.id },
        );
        if (b.dia) await this.avisarVistoriaMarcada(tx, m, nova.id);
      }
      return nova.id;
    });
    return this.detalhe(m, id);
  }

  private async dadosOcorrencia(
    tx: Tx,
    municipioId: string,
    ocorrenciaId: string,
    b: { motivo?: string },
  ) {
    let [o] = await tx.query<{
      id: string;
      numero: string;
      estado: string;
      descricao: string;
      morada: string;
      lat: number | null;
      lng: number | null;
      duplicada_de: string | null;
      categoria: string;
    }>(
      `SELECT o.id, o.numero, o.estado, o.descricao, o.morada, o.lat, o.lng, o.duplicada_de, c.nome AS categoria
       FROM ocorrencias o JOIN categorias_ocorrencia c ON c.id = o.categoria_id
       WHERE o.id = $1 AND o.municipio_id = $2`,
      [ocorrenciaId, municipioId],
    );
    if (o?.duplicada_de) {
      // A visita é à original (é essa que a equipa trata).
      [o] = await tx.query(
        `SELECT o.id, o.numero, o.estado, o.descricao, o.morada, o.lat, o.lng, o.duplicada_de, c.nome AS categoria
         FROM ocorrencias o JOIN categorias_ocorrencia c ON c.id = o.categoria_id
         WHERE o.id = $1`,
        [o.duplicada_de],
      );
    }
    if (!o) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ocorrencia_nao_encontrada',
        'Ocorrência não encontrada.',
      );
    }
    if (o.estado === 'resolvida' || o.estado === 'rejeitada') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ocorrencia_fechada',
        `A ocorrência ${o.numero} já está fechada.`,
      );
    }
    const [aberta] = await tx.query<{ id: string; numero: string }>(
      `SELECT id, numero FROM fiscalizacao_visitas
       WHERE ocorrencia_id = $1 AND estado IN ('por_agendar', 'agendada')`,
      [o.id],
    );
    if (aberta) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'visita_ja_existe',
        `A ocorrência ${o.numero} já tem a visita ${aberta.numero} por fazer.`,
        { visita_id: aberta.id },
      );
    }
    return {
      tipo: 'ocorrencia' as TipoVisita,
      origem: 'ocorrencia' as const,
      ocorrencia_id: o.id,
      processo_id: null,
      visita_anterior_id: null,
      morada: o.morada,
      lat: o.lat,
      lng: o.lng,
      motivo: b.motivo ?? `${o.numero} · ${o.categoria}: ${o.descricao}`,
      prazo_correcao: null,
    };
  }

  private async dadosProcesso(
    tx: Tx,
    municipioId: string,
    processoId: string,
    b: {
      motivo?: string;
      morada?: string;
      lat?: number | null;
      lng?: number | null;
    },
  ) {
    const [p] = await tx.query<{
      id: string;
      numero: string;
      assunto: string;
      morada: string | null;
      lat: number | null;
      lng: number | null;
    }>(
      `SELECT id, numero, assunto, morada, lat, lng FROM processos
       WHERE id = $1 AND municipio_id = $2`,
      [processoId, municipioId],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'processo_nao_encontrado',
        'Processo não encontrado.',
      );
    }
    const morada = b.morada ?? p.morada;
    if (!morada) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'morada_em_falta',
        `O processo ${p.numero} não tem morada: indique a morada da vistoria.`,
      );
    }
    return {
      tipo: 'vistoria_utilizacao' as TipoVisita,
      origem: 'processo' as const,
      ocorrencia_id: null,
      processo_id: p.id,
      visita_anterior_id: null,
      morada,
      lat: b.lat ?? p.lat,
      lng: b.lng ?? p.lng,
      motivo: b.motivo ?? `Vistoria do processo ${p.numero}: ${p.assunto}`,
      prazo_correcao: null,
    };
  }

  private async inserirVisita(
    tx: Tx,
    m: Municipio,
    u: UtilizadorPainel,
    v: NovaVisita,
  ): Promise<{ id: string; numero: string }> {
    validarJanela(v.janela_inicio, v.janela_fim);
    const ano = Number(hojeLisboa().slice(0, 4));
    const n = await proximoNumero(tx, m.id, 'FIS', ano);
    const numero = formatarNumero(n, ano);
    const [r] = await tx.query<{ id: string }>(
      `INSERT INTO fiscalizacao_visitas
         (municipio_id, numero, tipo, origem, ocorrencia_id, processo_id, visita_anterior_id,
          estado, fiscal_id, dia, janela_inicio, janela_fim, morada, lat, lng, motivo,
          checklist, prazo_correcao, criada_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING id`,
      [
        m.id,
        numero,
        v.tipo,
        v.origem,
        v.ocorrencia_id,
        v.processo_id,
        v.visita_anterior_id,
        v.dia ? 'agendada' : 'por_agendar',
        v.fiscal_id,
        v.dia,
        v.janela_inicio,
        v.janela_fim,
        v.morada,
        v.lat,
        v.lng,
        v.motivo,
        JSON.stringify(v.checklist),
        v.prazo_correcao,
        u.id,
      ],
    );
    await this.auditoria.registar(
      {
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'criar',
        objetoTipo: 'visita_fiscalizacao',
        objetoId: r.id,
        dados: { numero, origem: v.origem, tipo: v.tipo, dia: v.dia },
      },
      tx,
    );
    return { id: r.id, numero };
  }

  async listar(m: Municipio, f: z.output<typeof esquemaFiltroVisitas>) {
    const linhas = await this.db.query<
      LinhaVisita & { tem_relatorio: boolean }
    >(
      `SELECT ${COLUNAS_VISITA},
              o.numero AS ocorrencia_numero, p.numero AS processo_numero,
              (r.id IS NOT NULL) AS tem_relatorio, r.conclusao
       FROM fiscalizacao_visitas v
       LEFT JOIN utilizadores f ON f.id = v.fiscal_id
       LEFT JOIN ocorrencias o ON o.id = v.ocorrencia_id
       LEFT JOIN processos p ON p.id = v.processo_id
       LEFT JOIN fiscalizacao_relatorios r ON r.visita_id = v.id
       WHERE v.municipio_id = $1
         AND ($2::text IS NULL OR v.estado = $2)
         AND ($3::boolean IS NULL OR (v.estado IN ('por_agendar', 'agendada')) = $3)
         AND ($4::uuid IS NULL OR v.fiscal_id = $4)
         AND ($5::date IS NULL OR v.dia = $5)
         AND ($6::text IS NULL OR v.origem = $6)
         AND ($7::uuid IS NULL OR v.ocorrencia_id = $7)
         AND ($8::uuid IS NULL OR v.processo_id = $8)
         AND ($9::timestamptz IS NULL OR (v.criada_em, v.id) < ($9, $10::uuid))
       ORDER BY v.criada_em DESC, v.id DESC
       LIMIT $11`,
      [
        m.id,
        f.estado ?? null,
        f.abertas ?? null,
        f.fiscal_id ?? null,
        f.dia ?? null,
        f.origem ?? null,
        f.ocorrencia_id ?? null,
        f.processo_id ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    const p = pagina(linhas, f.limite, (l) => ({ em: l.criada_em, id: l.id }));
    return {
      ...p,
      itens: p.itens.map(({ checklist, ...v }) => ({
        ...v,
        tipo_nome: NOMES_TIPO[v.tipo],
        estado_nome: NOMES_ESTADO[v.estado],
        por_responder: checklist.filter((i) => i.resposta == null).length,
      })),
    };
  }

  private async visita(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    id: string,
    trancar = false,
  ): Promise<LinhaVisita> {
    const [v] = await q.query<LinhaVisita>(
      `SELECT ${COLUNAS_VISITA}
       FROM fiscalizacao_visitas v LEFT JOIN utilizadores f ON f.id = v.fiscal_id
       WHERE v.id = $1 AND v.municipio_id = $2
       ${trancar ? 'FOR UPDATE OF v' : ''}`,
      [id, municipioId],
    );
    if (!v) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'visita_nao_encontrada',
        'Visita de fiscalização não encontrada.',
      );
    }
    return v;
  }

  private async relatorio(
    q: Pick<Tx, 'query'>,
    visitaId: string,
  ): Promise<LinhaRelatorio | null> {
    const [r] = await q.query<LinhaRelatorio>(
      `SELECT id, fonte, audio_key, audio_mime, transcricao, transcrito_por, estruturado,
              estruturado_por, conclusao, to_char(prazo_correcao, 'YYYY-MM-DD') AS prazo_correcao,
              fechado_em, autor_id, criado_em, atualizado_em
       FROM fiscalizacao_relatorios WHERE visita_id = $1`,
      [visitaId],
    );
    return r ?? null;
  }

  async detalhe(m: Municipio, id: string) {
    const v = await this.visita(this.db, m.id, id);
    const [r, fotos, ocorrencia, processo, seguintes, config] =
      await Promise.all([
        this.relatorio(this.db, id),
        this.db.query<{
          id: string;
          ficheiro_key: string;
          mime: string;
          legenda: string | null;
          criada_em: Date;
        }>(
          `SELECT id, ficheiro_key, mime, legenda, criada_em FROM fiscalizacao_fotos
         WHERE visita_id = $1 ORDER BY criada_em, id`,
          [id],
        ),
        v.ocorrencia_id
          ? this.db
              .query(
                `SELECT o.id, o.numero, o.estado, o.descricao, c.nome AS categoria,
                      o.prevista_para::text AS prevista_para
               FROM ocorrencias o JOIN categorias_ocorrencia c ON c.id = o.categoria_id
               WHERE o.id = $1`,
                [v.ocorrencia_id],
              )
              .then((l) => l[0] ?? null)
          : null,
        v.processo_id
          ? this.db
              .query(
                `SELECT id, numero, assunto, fase FROM processos WHERE id = $1`,
                [v.processo_id],
              )
              .then((l) => l[0] ?? null)
          : null,
        this.db.query(
          `SELECT id, numero, estado, to_char(dia, 'YYYY-MM-DD') AS dia
         FROM fiscalizacao_visitas WHERE visita_anterior_id = $1 ORDER BY criada_em`,
          [id],
        ),
        this.configDe(m.id),
      ]);
    const url = (chave: string) =>
      this.armazenamento.disponivel
        ? this.armazenamento.urlLeitura(chave, 15)
        : Promise.resolve(null);
    return {
      ...v,
      tipo_nome: NOMES_TIPO[v.tipo],
      estado_nome: NOMES_ESTADO[v.estado],
      duracao_min: config.duracao_min[v.tipo],
      ocorrencia,
      processo,
      novas_visitas: seguintes,
      relatorio: r
        ? {
            id: r.id,
            fonte: r.fonte,
            transcricao: r.transcricao,
            transcrito_por: r.transcrito_por,
            audio: r.audio_key
              ? { mime: r.audio_mime, url: await url(r.audio_key) }
              : null,
            estruturado: r.estruturado,
            estruturado_por: r.estruturado_por,
            conclusao: r.conclusao,
            conclusao_nome: r.conclusao ? NOMES_CONCLUSAO[r.conclusao] : null,
            prazo_correcao: r.prazo_correcao,
            fechado_em: r.fechado_em,
            atualizado_em: r.atualizado_em,
          }
        : null,
      fotos: await Promise.all(
        fotos.map(async (f) => ({
          id: f.id,
          mime: f.mime,
          legenda: f.legenda,
          criada_em: f.criada_em,
          url: await url(f.ficheiro_key),
        })),
      ),
      valores_demonstracao: config.demonstracao,
    };
  }

  async alterar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    a: z.output<typeof esquemaAlterarVisita>,
  ) {
    await this.db.transaction(async (tx) => {
      const v = await this.visita(tx, m.id, id, true);
      exigirAberta(v);
      if (a.fiscal_id) await this.verificarFiscal(tx, m.id, a.fiscal_id);
      const dia = a.dia !== undefined ? a.dia : v.dia;
      const janelaInicio =
        a.janela_inicio !== undefined ? a.janela_inicio : v.janela_inicio;
      const janelaFim =
        a.janela_fim !== undefined ? a.janela_fim : v.janela_fim;
      validarJanela(janelaInicio, janelaFim);
      const tipo = a.tipo ?? v.tipo;
      let checklist = v.checklist;
      if (a.checklist) checklist = deItensNovos(a.checklist);
      else if (a.tipo && a.tipo !== v.tipo && !(await this.relatorio(tx, id))) {
        checklist = checklistDe(a.tipo);
      }
      await tx.query(
        `UPDATE fiscalizacao_visitas SET
           tipo = $2, motivo = $3, fiscal_id = $4, dia = $5, janela_inicio = $6, janela_fim = $7,
           morada = $8, lat = $9, lng = $10, checklist = $11,
           estado = CASE WHEN $5::date IS NULL THEN 'por_agendar' ELSE 'agendada' END,
           atualizada_em = now()
         WHERE id = $1`,
        [
          id,
          tipo,
          a.motivo ?? v.motivo,
          a.fiscal_id !== undefined ? a.fiscal_id : v.fiscal_id,
          dia,
          janelaInicio,
          janelaFim,
          a.morada ?? v.morada,
          a.lat !== undefined ? a.lat : v.lat,
          a.lng !== undefined ? a.lng : v.lng,
          JSON.stringify(checklist),
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'atualizar',
          objetoTipo: 'visita_fiscalizacao',
          objetoId: id,
          dados: { antes: { dia: v.dia, fiscal_id: v.fiscal_id }, depois: a },
        },
        tx,
      );
      if (v.processo_id && dia && dia !== v.dia) {
        await this.avisarVistoriaMarcada(tx, m, id);
      }
    });
    return this.detalhe(m, id);
  }

  async cancelar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaCancelar>,
  ) {
    await this.db.transaction(async (tx) => {
      const v = await this.visita(tx, m.id, id, true);
      exigirAberta(v);
      await tx.query(
        `UPDATE fiscalizacao_visitas SET estado = 'cancelada', cancelada_em = now(),
           motivo_cancelamento = $2, atualizada_em = now()
         WHERE id = $1`,
        [id, b.motivo],
      );
      if (v.ocorrencia_id) {
        await this.eventoOcorrencia(
          tx,
          v.ocorrencia_id,
          u,
          'fiscalizacao_cancelada',
          {
            visita_id: id,
            numero: v.numero,
            motivo: b.motivo,
          },
        );
      }
      if (v.processo_id) {
        await this.eventoProcesso(
          tx,
          v.processo_id,
          u,
          'vistoria_cancelada',
          `Visita ${v.numero} cancelada: ${b.motivo}`,
          true,
          { visita_id: id },
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'cancelar_visita',
          objetoTipo: 'visita_fiscalizacao',
          objetoId: id,
          dados: { motivo: b.motivo },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  // ------------------------------------------------------------------
  // Plano do dia
  // ------------------------------------------------------------------

  async plano(
    m: Municipio,
    u: UtilizadorPainel,
    q: z.output<typeof esquemaPlano>,
  ) {
    const fiscalId = q.fiscal_id ?? u.id;
    const config = await this.configDe(m.id);
    const visitas = await this.db.query<LinhaVisita>(
      `SELECT ${COLUNAS_VISITA}
       FROM fiscalizacao_visitas v LEFT JOIN utilizadores f ON f.id = v.fiscal_id
       WHERE v.municipio_id = $1 AND v.fiscal_id = $2 AND v.dia = $3 AND v.estado = 'agendada'
       ORDER BY v.numero`,
      [m.id, fiscalId, q.dia],
    );
    const [fiscal] = await this.db.query<{ id: string; nome: string }>(
      'SELECT id, nome FROM utilizadores WHERE id = $1',
      [fiscalId],
    );

    const pedida =
      q.partida_lat != null && q.partida_lng != null
        ? { nome: 'Ponto indicado', lat: q.partida_lat, lng: q.partida_lng }
        : null;
    const partida = pedida ?? config.ponto_partida;
    const plano = planearDia(
      visitas.map((v) => ({
        id: v.id,
        lat: v.lat,
        lng: v.lng,
        duracao_min: config.duracao_min[v.tipo],
        janela_inicio: v.janela_inicio,
        janela_fim: v.janela_fim,
      })),
      {
        partida: partida ? { lat: partida.lat, lng: partida.lng } : null,
        hora_inicio: q.inicio ?? config.hora_inicio,
        hora_fim: config.hora_fim,
        velocidade_kmh: config.velocidade_kmh,
        fator_percurso: config.fator_percurso,
        regressar: q.regressar,
      },
    );
    const porId = new Map(visitas.map((v) => [v.id, v]));
    const resumo = (id: string) => {
      const v = porId.get(id)!;
      return {
        id: v.id,
        numero: v.numero,
        tipo: v.tipo,
        tipo_nome: NOMES_TIPO[v.tipo],
        morada: v.morada,
        lat: v.lat,
        lng: v.lng,
        motivo: v.motivo,
      };
    };
    const avisos: string[] = [];
    if (!partida) {
      avisos.push(
        'Sem ponto de partida configurado: o percurso começa na visita mais afastada. Configure o edifício da câmara em Fiscalização · Configuração.',
      );
    }
    if (plano.sem_localizacao.length) {
      avisos.push(
        `${plano.sem_localizacao.length} visita(s) sem coordenadas ficaram fora do percurso.`,
      );
    }
    if (plano.janelas_perdidas.length) {
      avisos.push(
        `${plano.janelas_perdidas.length} visita(s) com hora marcada já não cabem neste dia.`,
      );
    }
    if (plano.paragens.some((p) => p.depois_da_hora)) {
      avisos.push(
        `O dia passa das ${config.hora_fim}: considere passar visitas para outro dia.`,
      );
    }
    return {
      dia: q.dia,
      fiscal: fiscal ?? { id: fiscalId, nome: null },
      partida: partida
        ? { ...partida, origem: pedida ? 'pedido' : 'configuracao' }
        : null,
      parametros: {
        hora_inicio: q.inicio ?? config.hora_inicio,
        hora_fim: config.hora_fim,
        velocidade_kmh: config.velocidade_kmh,
        fator_percurso: config.fator_percurso,
        duracao_min: config.duracao_min,
      },
      paragens: plano.paragens.map((p) => ({ ...p, visita: resumo(p.id) })),
      regresso: plano.regresso,
      janelas_perdidas: plano.janelas_perdidas.map(resumo),
      sem_localizacao: plano.sem_localizacao.map(resumo),
      totais: plano.totais,
      avisos,
      valores_demonstracao: config.demonstracao,
    };
  }

  // ------------------------------------------------------------------
  // Relatório ditado
  // ------------------------------------------------------------------

  /** Texto já transcrito pelo telemóvel (ditado do sistema ou do browser). */
  async relatorioTexto(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaRelatorioTexto>,
  ) {
    const v = await this.visita(this.db, m.id, id);
    exigirAberta(v);
    const r = await this.relatorio(this.db, id);
    exigirRascunho(r);
    const aviso = await this.estruturarEGuardar(m, u, v, b.texto, {
      fonte: 'texto',
      transcritoPor: 'dispositivo',
      respostas: b.checklist ?? [],
    });
    return { ...(await this.detalhe(m, id)), aviso };
  }

  /** URL assinada para o telemóvel enviar o áudio (PUT direto ao S3). */
  async pedirEnvioAudio(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaEnvioAudio>,
  ) {
    const v = await this.visita(this.db, m.id, id);
    exigirAberta(v);
    exigirRascunho(await this.relatorio(this.db, id));
    if (!this.armazenamento.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'armazenamento_indisponivel',
        'Não há armazenamento de ficheiros configurado (S3_BUCKET): não é possível guardar o áudio. Dite o relatório com o teclado do telemóvel e envie o texto.',
      );
    }
    const chave = this.armazenamento.chave(
      m.slug,
      'gravacoes',
      MIME_AUDIO[b.mime],
    );
    const url = await this.armazenamento.urlEnvio(chave, b.mime);
    await this.db.query(
      `INSERT INTO fiscalizacao_relatorios (municipio_id, visita_id, fonte, audio_key, audio_mime, autor_id)
       VALUES ($1, $2, 'audio', $3, $4, $5)
       ON CONFLICT (visita_id) DO UPDATE SET fonte = 'audio', audio_key = $3, audio_mime = $4,
         autor_id = $5, atualizado_em = now()
       WHERE fiscalizacao_relatorios.fechado_em IS NULL`,
      [m.id, id, chave, b.mime, u.id],
    );
    return {
      url_envio: url,
      metodo: 'PUT',
      cabecalhos: { 'Content-Type': b.mime },
      expira_em_segundos: 600,
      a_seguir: `POST /v1/painel/fiscalizacao/visitas/${id}/relatorio/audio/transcrever`,
    };
  }

  /** Depois do envio: transcreve com o ElevenLabs e estrutura. */
  async transcreverAudio(m: Municipio, u: UtilizadorPainel, id: string) {
    const v = await this.visita(this.db, m.id, id);
    exigirAberta(v);
    const r = await this.relatorio(this.db, id);
    exigirRascunho(r);
    if (!r?.audio_key) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_audio',
        'Esta visita não tem áudio: peça primeiro o envio (relatorio/audio).',
      );
    }
    if (!this.armazenamento.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'armazenamento_indisponivel',
        'Não há armazenamento de ficheiros configurado (S3_BUCKET).',
      );
    }
    const apiKey = this.chaveElevenlabs();
    if (!apiKey) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'transcricao_indisponivel',
        'A transcrição automática do áudio não está ligada. O áudio ficou guardado; envie o texto ditado no telemóvel.',
      );
    }
    let audio: Buffer;
    try {
      audio = await this.armazenamento.ler(r.audio_key);
    } catch (e) {
      if (e instanceof ErroApi) throw e;
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'audio_por_enviar',
        'O áudio ainda não chegou ao armazenamento: envie-o para o URL indicado e tente de novo.',
      );
    }
    const t = await transcrever(this.buscar, {
      apiKey,
      modelo:
        this.config.get<string>('ELEVENLABS_STT_MODELO') ||
        MODELO_STT_POR_OMISSAO,
      audio,
      mime: r.audio_mime ?? 'audio/webm',
      nome: `ditado.${MIME_AUDIO[r.audio_mime ?? ''] ?? 'webm'}`,
    });
    if (!t.ok) {
      this.logger.warn(`Transcrição falhou (${v.numero}): ${t.erro}`);
      throw new ErroApi(
        HttpStatus.BAD_GATEWAY,
        'transcricao_falhou',
        'Não foi possível transcrever o áudio. Tente de novo ou envie o texto ditado no telemóvel.',
      );
    }
    const aviso = await this.estruturarEGuardar(m, u, v, t.texto, {
      fonte: 'audio',
      transcritoPor: 'elevenlabs',
      respostas: [],
    });
    return { ...(await this.detalhe(m, id)), aviso };
  }

  /**
   * Com IA: constatações, infrações, medidas, prazo, fotos e conclusão a
   * partir do ditado (e as respostas da checklist que o ditado dá). Sem IA
   * (ou se falhar): relatório livre, com a checklist preenchida à mão.
   */
  private async estruturarEGuardar(
    m: Municipio,
    u: UtilizadorPainel,
    v: LinhaVisita,
    texto: string,
    o: {
      fonte: 'texto' | 'audio';
      transcritoPor: 'dispositivo' | 'elevenlabs';
      respostas: z.output<typeof esquemaResposta>[];
    },
  ): Promise<string | null> {
    let checklist = aplicarRespostas(v.checklist, o.respostas, true);
    let estruturado: RelatorioEstruturado;
    let por: 'ia' | 'manual' = 'manual';
    let aviso: string | null = null;
    if (this.claude.disponivel) {
      try {
        const e = await this.claude.extrair(esquemaEstruturado, {
          tarefa: 'relatorio_vistoria',
          sistema: SISTEMA_IA,
          conteudo: conteudoIa(v.tipo, v.motivo, checklist, texto),
          esforco: 'medium',
          maxTokens: 4000,
        });
        checklist = aplicarRespostas(checklist, e.respostas_checklist);
        estruturado = daIa(e);
        // Uma desconformidade marcada à mão conta mesmo que a IA não a veja.
        if (
          checklist.some(naoConforme) &&
          estruturado.conclusao === 'conforme'
        ) {
          estruturado.conclusao = 'com_infracoes';
        }
        por = 'ia';
      } catch (e) {
        this.logger.warn(
          `IA falhou no relatório ${v.numero}: ${(e as Error).message}`,
        );
        estruturado = relatorioLivre(texto, checklist);
        aviso =
          'A IA não respondeu: ficou como relatório livre. Preencha a checklist à mão.';
      }
    } else {
      estruturado = relatorioLivre(texto, checklist);
      aviso = 'Sem IA: ficou como relatório livre. Preencha a checklist à mão.';
    }

    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO fiscalizacao_relatorios
           (municipio_id, visita_id, fonte, transcricao, transcrito_por, estruturado,
            estruturado_por, conclusao, autor_id)
         VALUES ($1, $2, 'texto', $4, $5, $6, $7, $8, $9)
         ON CONFLICT (visita_id) DO UPDATE SET
           -- O áudio já criou a linha (com audio_key); o texto pode ser o primeiro.
           fonte = $3::text, transcricao = $4, transcrito_por = $5, estruturado = $6,
           estruturado_por = $7, conclusao = $8, autor_id = $9, atualizado_em = now()
         WHERE fiscalizacao_relatorios.fechado_em IS NULL`,
        [
          m.id,
          v.id,
          o.fonte,
          texto,
          o.transcritoPor,
          JSON.stringify(estruturado),
          por,
          estruturado.conclusao,
          u.id,
        ],
      );
      await tx.query(
        `UPDATE fiscalizacao_visitas SET checklist = $2, atualizada_em = now() WHERE id = $1`,
        [v.id, JSON.stringify(checklist)],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'ditar_relatorio',
          objetoTipo: 'visita_fiscalizacao',
          objetoId: v.id,
          dados: {
            fonte: o.fonte,
            transcrito_por: o.transcritoPor,
            estruturado_por: por,
            conclusao: estruturado.conclusao,
          },
        },
        tx,
      );
    });
    return aviso;
  }

  /** O fiscal revê o que a IA (ou a checklist) deu antes de fechar. */
  async corrigirRelatorio(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaCorrigirRelatorio>,
  ) {
    await this.db.transaction(async (tx) => {
      const v = await this.visita(tx, m.id, id, true);
      exigirAberta(v);
      const r = await this.relatorio(tx, id);
      exigirRascunho(r);
      if (!r?.transcricao || !r.estruturado) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'sem_relatorio',
          'Esta visita ainda não tem relatório ditado.',
        );
      }
      const checklist = b.checklist
        ? aplicarRespostas(v.checklist, b.checklist, true)
        : v.checklist;
      let e: RelatorioEstruturado = { ...r.estruturado };
      // Relatório livre: a estrutura acompanha a checklist.
      if (e.livre && b.checklist) {
        const livre = relatorioLivre(r.transcricao, checklist);
        e = {
          ...e,
          constatacoes: livre.constatacoes,
          infracoes: livre.infracoes,
          conclusao: livre.conclusao,
          // O prazo dito só conta quando passa a haver infrações.
          prazo_dias: livre.prazo_dias,
        };
      }
      const { checklist: _c, ...campos } = b;
      void _c;
      for (const [k, valor] of Object.entries(campos)) {
        if (valor !== undefined)
          (e as unknown as Record<string, unknown>)[k] = valor;
      }
      if (b.infracoes && b.conclusao === undefined) {
        e.conclusao = b.infracoes.length
          ? 'com_infracoes'
          : conclusaoSemInfracoes(e.conclusao);
      }
      await tx.query(
        `UPDATE fiscalizacao_relatorios SET estruturado = $2, conclusao = $3, atualizado_em = now()
         WHERE visita_id = $1`,
        [id, JSON.stringify(e), e.conclusao],
      );
      await tx.query(
        `UPDATE fiscalizacao_visitas SET checklist = $2, atualizada_em = now() WHERE id = $1`,
        [id, JSON.stringify(checklist)],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'corrigir_relatorio',
          objetoTipo: 'visita_fiscalizacao',
          objetoId: id,
          dados: { campos: Object.keys(b), conclusao: e.conclusao },
        },
        tx,
      );
    });
    return this.detalhe(m, id);
  }

  /** Fotografia da visita: URL assinada para o telemóvel enviar (PUT ao S3). */
  async pedirEnvioFoto(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaEnvioFoto>,
  ) {
    const v = await this.visita(this.db, m.id, id);
    if (v.estado === 'cancelada') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'visita_cancelada',
        `A visita ${v.numero} foi cancelada.`,
      );
    }
    if (!this.armazenamento.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'armazenamento_indisponivel',
        'Não há armazenamento de ficheiros configurado (S3_BUCKET): não é possível juntar fotografias.',
      );
    }
    const chave = this.armazenamento.chave(
      m.slug,
      'documentos',
      MIME_FOTOS[b.mime],
    );
    const url = await this.armazenamento.urlEnvio(chave, b.mime);
    const [f] = await this.db.query<{ id: string }>(
      `INSERT INTO fiscalizacao_fotos (municipio_id, visita_id, ficheiro_key, mime, legenda, criada_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.id, id, chave, b.mime, b.legenda ?? null, u.id],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'acrescentar_foto_visita',
      objetoTipo: 'visita_fiscalizacao',
      objetoId: id,
      dados: { foto_id: f.id },
    });
    return {
      foto_id: f.id,
      url_envio: url,
      metodo: 'PUT',
      cabecalhos: { 'Content-Type': b.mime },
      expira_em_segundos: 600,
    };
  }

  // ------------------------------------------------------------------
  // Fechar o relatório: o que acontece depois
  // ------------------------------------------------------------------

  async concluir(m: Municipio, u: UtilizadorPainel, id: string) {
    const config = await this.configDe(m.id);
    const feriados = await this.municipios.feriados(m.id);
    let resolverOcorrencia: string | null = null;

    const efeitos = await this.db.transaction(async (tx) => {
      const v = await this.visita(tx, m.id, id, true);
      exigirAberta(v);
      const r = await this.relatorio(tx, id);
      exigirRascunho(r);
      if (!r || !r.transcricao || !r.estruturado || !r.conclusao) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          r?.audio_key && !r.transcricao
            ? 'relatorio_por_transcrever'
            : 'sem_relatorio',
          r?.audio_key && !r.transcricao
            ? 'O áudio ainda não foi transcrito: transcreva-o ou envie o texto ditado.'
            : 'Esta visita ainda não tem relatório ditado.',
        );
      }
      const hoje = hojeLisboa();
      const dia = v.dia && v.dia <= hoje ? v.dia : hoje;
      const conclusao = r.conclusao;
      let infracoes = r.estruturado.infracoes;
      if (conclusao === 'com_infracoes' && !infracoes.length) {
        infracoes = v.checklist.filter(naoConforme).map((i) => ({
          descricao: i.rotulo.replace(/\?$/, ''),
          artigo: i.artigo,
        }));
      }

      // A visita fica feita antes de marcar a nova (uma visita aberta de
      // cada vez por ocorrência).
      await tx.query(
        `UPDATE fiscalizacao_visitas SET estado = 'feita', feita_em = now(), dia = $2,
           atualizada_em = now()
         WHERE id = $1`,
        [id, dia],
      );

      let prazo: ReturnType<typeof dataLimite> | null = null;
      let reinspecao: {
        id: string;
        numero: string;
        dia: string;
        prazo_correcao: string;
      } | null = null;
      if (conclusao === 'com_infracoes') {
        prazo = dataLimite(dia, r.estruturado, config.prazo_correcao_dias);
        const diaNova = somarDiasUteis(prazo.data, 1, feriados);
        const nova = await this.inserirVisita(tx, m, u, {
          tipo: 'reinspecao',
          origem: 'reinspecao',
          ocorrencia_id: v.ocorrencia_id,
          processo_id: v.processo_id,
          visita_anterior_id: v.id,
          morada: v.morada,
          lat: v.lat,
          lng: v.lng,
          motivo: `Verificar as correções pedidas na ${v.numero} (prazo até ${dataCurta(prazo.data)}).`,
          prazo_correcao: prazo.data,
          fiscal_id: v.fiscal_id,
          dia: diaNova,
          janela_inicio: null,
          janela_fim: null,
          checklist: checklistReinspecao(infracoes),
        });
        reinspecao = { ...nova, dia: diaNova, prazo_correcao: prazo.data };
      }

      // O relatório fica fechado (já não se altera).
      await tx.query(
        `UPDATE fiscalizacao_relatorios SET fechado_em = now(), prazo_correcao = $2,
           estruturado = $3, atualizado_em = now()
         WHERE visita_id = $1`,
        [
          id,
          prazo?.data ?? null,
          JSON.stringify({ ...r.estruturado, infracoes }),
        ],
      );

      const efeitoOcorrencia = v.ocorrencia_id
        ? await this.efeitoOcorrencia(
            tx,
            m,
            u,
            v,
            conclusao,
            dia,
            prazo?.data ?? null,
          )
        : null;
      if (efeitoOcorrencia?.resolver) resolverOcorrencia = v.ocorrencia_id;
      const efeitoProcesso = v.processo_id
        ? await this.efeitoProcesso(
            tx,
            m,
            u,
            v,
            conclusao,
            dia,
            infracoes.length,
            prazo?.data ?? null,
          )
        : null;

      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'concluir_visita',
          objetoTipo: 'visita_fiscalizacao',
          objetoId: id,
          dados: {
            conclusao,
            infracoes: infracoes.length,
            prazo_correcao: prazo?.data ?? null,
            nova_visita_id: reinspecao?.id ?? null,
          },
        },
        tx,
      );
      return {
        conclusao,
        prazo_correcao: prazo
          ? {
              ...prazo,
              valor_de_demonstracao:
                !prazo.dito_pelo_fiscal && config.demonstracao,
            }
          : null,
        nova_visita: reinspecao,
        ocorrencia: efeitoOcorrencia
          ? {
              id: efeitoOcorrencia.id,
              numero: efeitoOcorrencia.numero,
              estado: efeitoOcorrencia.estado,
              nota_publica: efeitoOcorrencia.nota_publica,
              avisados: efeitoOcorrencia.avisados,
            }
          : null,
        processo: efeitoProcesso,
      };
    });

    // Sem desconformidades numa ocorrência: resolve-a pelo caminho de
    // sempre (SMS "foi resolvida" a todos os que a reportaram).
    if (resolverOcorrencia && efeitos.ocorrencia) {
      const o = await this.ocorrencias.alterar(m, u, resolverOcorrencia, {
        estado: 'resolvida',
      });
      efeitos.ocorrencia = {
        ...efeitos.ocorrencia,
        estado: 'resolvida',
        avisados: o.avisados,
      };
    }
    return { ...(await this.detalhe(m, id)), efeitos };
  }

  private async efeitoOcorrencia(
    tx: Tx,
    m: Municipio,
    u: UtilizadorPainel,
    v: LinhaVisita,
    conclusao: Conclusao,
    dia: string,
    prazo: string | null,
  ) {
    const ocorrenciaId = v.ocorrencia_id!;
    const [o] = await tx.query<{ numero: string; estado: string }>(
      'SELECT numero, estado FROM ocorrencias WHERE id = $1 FOR UPDATE',
      [ocorrenciaId],
    );
    const nota = notaOcorrencia(conclusao, dia, prazo);
    await this.eventoOcorrencia(tx, ocorrenciaId, u, 'fiscalizacao_relatorio', {
      visita_id: v.id,
      numero: v.numero,
      conclusao,
      prazo_correcao: prazo,
      nota_publica: nota,
    });
    const fechada = o.estado === 'resolvida' || o.estado === 'rejeitada';
    if (conclusao === 'conforme') {
      return {
        id: ocorrenciaId,
        numero: o.numero,
        estado: o.estado,
        nota_publica: nota,
        avisados: 0,
        resolver: !fechada,
      };
    }
    if (!fechada) {
      await tx.query(
        `UPDATE ocorrencias SET estado = 'com_equipa', prevista_para = coalesce($2::date, prevista_para)
         WHERE id = $1`,
        [ocorrenciaId, prazo],
      );
    }
    // Quem reportou (a original e os duplicados), uma vez por pessoa.
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
      [ocorrenciaId],
    );
    for (const q of quem) {
      const link = await this.links.criar(m.id, 'ocorrencia', q.ocorrencia_id, {
        tx,
      });
      await this.mensagens.sms(
        {
          municipioId: m.id,
          municipeId: q.municipe_id,
          destino: q.telefone,
          motivo: 'ocorrencia',
          corpo: `${m.nome}: ocorrência ${o.numero}. ${nota} Acompanhe: ${link.url}`,
          relacionado: { ocorrencia_id: q.ocorrencia_id, visita_id: v.id },
          chave: `fiscalizacao:${v.id}:${q.municipe_id}`,
        },
        tx,
      );
    }
    return {
      id: ocorrenciaId,
      numero: o.numero,
      estado: fechada ? o.estado : 'com_equipa',
      nota_publica: nota,
      avisados: quem.length,
      resolver: false,
    };
  }

  private async efeitoProcesso(
    tx: Tx,
    m: Municipio,
    u: UtilizadorPainel,
    v: LinhaVisita,
    conclusao: Conclusao,
    dia: string,
    infracoes: number,
    prazo: string | null,
  ) {
    const processoId = v.processo_id!;
    const [p] = await tx.query<{ numero: string; municipe_id: string | null }>(
      'SELECT numero, municipe_id FROM processos WHERE id = $1',
      [processoId],
    );
    const nota = notaProcesso(conclusao, dia, infracoes, prazo);
    await this.eventoProcesso(tx, processoId, u, 'vistoria', nota, false, {
      visita_id: v.id,
      numero: v.numero,
      conclusao,
      prazo_correcao: prazo,
    });
    await tx.query('UPDATE processos SET atualizado_em = now() WHERE id = $1', [
      processoId,
    ]);
    const telefone = await this.processos.telefoneDe(p.municipe_id, tx);
    let avisado = false;
    if (telefone) {
      const link = await this.processos.linkProcesso(m.id, processoId, tx);
      await this.mensagens.sms(
        {
          municipioId: m.id,
          municipeId: p.municipe_id,
          destino: telefone,
          motivo: 'processo',
          corpo: `${m.nome}: processo ${p.numero}. ${nota} Acompanhe: ${link}`,
          relacionado: { processo_id: processoId, visita_id: v.id },
          chave: `vistoria:${v.id}`,
        },
        tx,
      );
      avisado = true;
    }
    return { id: processoId, numero: p.numero, evento: nota, avisado };
  }

  /** Vistoria de um processo marcada: linha do tempo e SMS ao requerente. */
  private async avisarVistoriaMarcada(tx: Tx, m: Municipio, visitaId: string) {
    const v = await this.visita(tx, m.id, visitaId);
    if (!v.processo_id || !v.dia) return;
    const [p] = await tx.query<{ numero: string; municipe_id: string | null }>(
      'SELECT numero, municipe_id FROM processos WHERE id = $1',
      [v.processo_id],
    );
    const janela =
      v.janela_inicio && v.janela_fim
        ? `, entre as ${v.janela_inicio} e as ${v.janela_fim}`
        : v.janela_inicio
          ? `, a partir das ${v.janela_inicio}`
          : '';
    const texto = `Vistoria marcada para ${dataCurta(v.dia)}${janela}.`;
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, interno, dados)
       VALUES ($1, 'vistoria_marcada', $2, 'sistema', false, $3)`,
      [v.processo_id, texto, JSON.stringify({ visita_id: v.id, dia: v.dia })],
    );
    const telefone = await this.processos.telefoneDe(p.municipe_id, tx);
    if (!telefone) return;
    const link = await this.processos.linkProcesso(m.id, v.processo_id, tx);
    await this.mensagens.sms(
      {
        municipioId: m.id,
        municipeId: p.municipe_id,
        destino: telefone,
        motivo: 'processo',
        corpo: `${m.nome}: processo ${p.numero}. ${texto} Alguém tem de estar no local para abrir. Para mudar, responda ou ligue para a câmara. ${link}`,
        relacionado: { processo_id: v.processo_id, visita_id: v.id },
        chave: `vistoria_marcada:${v.id}:${v.dia}${v.janela_inicio ?? ''}`,
      },
      tx,
    );
  }

  // ------------------------------------------------------------------
  // PDF
  // ------------------------------------------------------------------

  async pdf(m: Municipio, id: string) {
    const d = await this.detalhe(m, id);
    const origem = d.ocorrencia
      ? `Ocorrência ${(d.ocorrencia as { numero: string }).numero}`
      : d.processo
        ? `Processo ${(d.processo as { numero: string }).numero}`
        : null;
    const r = d.relatorio;
    const pdf = await gerarPdfVistoria({
      municipio: m.nome,
      numero: d.numero,
      tipo: d.tipo_nome,
      morada: d.morada,
      dia: porExtenso(d.dia ?? hojeLisboa()),
      fiscal: d.fiscal_nome,
      motivo: d.motivo,
      origem,
      checklist: d.checklist,
      estruturado: r?.estruturado ?? null,
      conclusao: r?.conclusao ?? null,
      prazo: r?.prazo_correcao ? dataCurta(r.prazo_correcao) : null,
      transcricao: r?.transcricao ?? null,
      fotos: d.fotos.length,
      fechado: !!r?.fechado_em,
      valoresDemonstracao: d.valores_demonstracao,
    });
    return { nome: `vistoria-${d.numero.replace(/[^\w]+/g, '-')}.pdf`, pdf };
  }

  // ------------------------------------------------------------------

  private async verificarFiscal(tx: Tx, municipioId: string, fiscalId: string) {
    const [f] = await tx.query(
      `SELECT 1 FROM utilizadores WHERE id = $1 AND municipio_id = $2 AND ativo`,
      [fiscalId, municipioId],
    );
    if (!f) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'fiscal_invalido',
        'Esse fiscal não existe neste município.',
      );
    }
  }

  private async eventoOcorrencia(
    tx: Tx,
    ocorrenciaId: string,
    u: UtilizadorPainel,
    tipo: string,
    dados: Record<string, unknown>,
  ) {
    await tx.query(
      `INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, ator_id, dados)
       VALUES ($1, $2, 'utilizador', $3, $4)`,
      [ocorrenciaId, tipo, u.id, JSON.stringify(dados)],
    );
  }

  private async eventoProcesso(
    tx: Tx,
    processoId: string,
    u: UtilizadorPainel,
    tipo: string,
    descricao: string,
    interno: boolean,
    dados: Record<string, unknown>,
  ) {
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, interno, dados)
       VALUES ($1, $2, $3, 'utilizador', $4, $5, $6)`,
      [processoId, tipo, descricao, u.id, interno, JSON.stringify(dados)],
    );
  }
}

interface NovaVisita {
  tipo: TipoVisita;
  origem: OrigemVisita;
  ocorrencia_id: string | null;
  processo_id: string | null;
  visita_anterior_id: string | null;
  morada: string;
  lat: number | null;
  lng: number | null;
  motivo: string;
  prazo_correcao: string | null;
  fiscal_id: string | null;
  dia: string | null;
  janela_inicio: string | null;
  janela_fim: string | null;
  checklist: ItemChecklist[];
}

function deItensNovos(
  itens: z.output<typeof esquemaItemNovo>[],
): ItemChecklist[] {
  return itens.map((i, n) => ({
    chave: `ponto_${n + 1}`,
    rotulo: i.rotulo,
    conforme_se: i.conforme_se,
    artigo: i.artigo,
    resposta: null,
    nota: null,
  }));
}

function validarJanela(inicio: string | null, fim: string | null) {
  if (inicio && fim && inicio >= fim) {
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      'janela_invalida',
      'A hora de início da janela tem de ser antes da hora de fim.',
    );
  }
}

function exigirAberta(v: LinhaVisita) {
  if (!ABERTAS.includes(v.estado)) {
    throw new ErroApi(
      HttpStatus.CONFLICT,
      'visita_fechada',
      `A visita ${v.numero} já está ${NOMES_ESTADO[v.estado].toLowerCase()}.`,
    );
  }
}

function exigirRascunho(r: LinhaRelatorio | null) {
  if (r?.fechado_em) {
    throw new ErroApi(
      HttpStatus.CONFLICT,
      'relatorio_fechado',
      'O relatório já foi fechado e não se altera.',
    );
  }
}

function conclusaoSemInfracoes(c: Conclusao): Conclusao {
  return c === 'com_infracoes' ? 'conforme' : c;
}
