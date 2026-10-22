import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { pode } from '../auth/permissoes.js';
import { FiscalizacaoService } from '../fiscalizacao/fiscalizacao.service.js';
import { NOMES_ESTADO, NOMES_TIPO } from '../fiscalizacao/regras.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MIME_FOTOS } from '../ocorrencias/ocorrencias.regras.js';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service.js';
import { ordenarPorProximidade } from './regras.js';

/** Fotografias "do depois" por ocorrência (as do munícipe têm o seu limite). */
export const MAX_FOTOS_EQUIPA = 5;

export const esquemaHoje = z.object({
  dia: z.iso.date().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/** Fotografia tirada no telemóvel: tipo, legenda, GPS e hora. */
export const esquemaFotoCampo = z.object({
  mime: z
    .string()
    .trim()
    .toLowerCase()
    .refine((m) => m in MIME_FOTOS, {
      message: 'Só se aceitam fotografias (JPEG, PNG, WebP ou HEIC).',
    }),
  legenda: z.string().trim().max(300).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  tirada_em: z.iso.datetime({ offset: true }).optional(),
});

export const esquemaFecharOcorrencia = z.object({
  nota: z.string().trim().min(3).max(1000),
  /** As fotografias "do depois" já enviadas (POST .../fotos). */
  foto_ids: z.array(z.guid()).max(MAX_FOTOS_EQUIPA).default([]),
});

interface LinhaTarefa {
  id: string;
  numero: string;
  lat: number | null;
  lng: number | null;
  morada: string | null;
  estado: string;
}

/**
 * App da equipa de campo: as tarefas do dia, as fotografias tiradas no
 * terreno (com GPS e hora) e fechar uma ocorrência com a foto do depois e
 * uma nota. O resto (relatório ditado, concluir a visita, mudar o estado)
 * são as rotas do painel de sempre.
 */
@Injectable()
export class EquipaCampoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly fiscalizacao: FiscalizacaoService,
    private readonly ocorrencias: OcorrenciasService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * As minhas visitas de hoje (e as agendadas que ficaram para trás) e as
   * ocorrências abertas do meu serviço, por proximidade a onde estou.
   */
  async hoje(
    m: Municipio,
    u: UtilizadorPainel,
    q: z.output<typeof esquemaHoje>,
  ) {
    const dia = q.dia ?? hojeLisboa();
    const origem =
      q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null;
    const veVisitas = pode(u.perfil, 'fiscalizacao');
    const veOcorrencias = pode(u.perfil, 'ocorrencias') && !!u.servicoId;

    const visitas = veVisitas
      ? await this.db.query<
          LinhaTarefa & {
            tipo: keyof typeof NOMES_TIPO;
            dia: string;
            janela_inicio: string | null;
            janela_fim: string | null;
            motivo: string;
            ocorrencia_numero: string | null;
            processo_numero: string | null;
          }
        >(
          `SELECT v.id, v.numero, v.tipo, v.estado, v.morada, v.lat, v.lng, v.motivo,
                  to_char(v.dia, 'YYYY-MM-DD') AS dia,
                  to_char(v.janela_inicio, 'HH24:MI') AS janela_inicio,
                  to_char(v.janela_fim, 'HH24:MI') AS janela_fim,
                  o.numero AS ocorrencia_numero, p.numero AS processo_numero
           FROM fiscalizacao_visitas v
           LEFT JOIN ocorrencias o ON o.id = v.ocorrencia_id
           LEFT JOIN processos p ON p.id = v.processo_id
           WHERE v.municipio_id = $1 AND v.fiscal_id = $2
             AND ((v.dia = $3 AND v.estado IN ('agendada', 'feita'))
               OR (v.dia < $3 AND v.estado = 'agendada'))
           ORDER BY v.numero`,
          [m.id, u.id, dia],
        )
      : [];

    const ocorrencias = veOcorrencias
      ? await this.db.query<
          LinhaTarefa & {
            categoria: string;
            icone: string | null;
            descricao: string;
            prevista_para: string | null;
            reportes: number;
            fotos: number;
          }
        >(
          `SELECT o.id, o.numero, o.estado::text AS estado, o.morada, o.lat, o.lng, o.descricao,
                  c.nome AS categoria, c.icone, o.prevista_para::text AS prevista_para,
                  (SELECT 1 + count(*)::int FROM ocorrencias d WHERE d.duplicada_de = o.id) AS reportes,
                  (SELECT count(*)::int FROM ocorrencia_fotos f WHERE f.ocorrencia_id = o.id) AS fotos
           FROM ocorrencias o
           JOIN categorias_ocorrencia c ON c.id = o.categoria_id
           WHERE o.municipio_id = $1 AND o.servico_id = $2 AND o.duplicada_de IS NULL
             AND (o.estado IN ('nova', 'com_equipa')
               OR (o.estado = 'resolvida'
                   AND (o.resolvida_em AT TIME ZONE 'Europe/Lisbon')::date = $3::date))
           ORDER BY o.criada_em`,
          [m.id, u.servicoId, dia],
        )
      : [];

    const tarefas = [
      ...visitas.map((v) => ({
        tipo: 'visita' as const,
        id: v.id,
        numero: v.numero,
        titulo: NOMES_TIPO[v.tipo],
        resumo: v.motivo,
        morada: v.morada,
        lat: v.lat,
        lng: v.lng,
        estado: v.estado,
        estado_nome: NOMES_ESTADO[v.estado as keyof typeof NOMES_ESTADO],
        feita: v.estado === 'feita',
        atrasada: v.dia < dia,
        dia: v.dia,
        janela:
          v.janela_inicio && v.janela_fim
            ? `${v.janela_inicio}–${v.janela_fim}`
            : null,
        referencia: v.ocorrencia_numero ?? v.processo_numero,
      })),
      ...ocorrencias.map((o) => ({
        tipo: 'ocorrencia' as const,
        id: o.id,
        numero: o.numero,
        titulo: o.categoria,
        resumo: o.descricao,
        morada: o.morada,
        lat: o.lat,
        lng: o.lng,
        estado: o.estado,
        estado_nome: NOMES_ESTADO_OCORRENCIA[o.estado] ?? o.estado,
        feita: o.estado === 'resolvida',
        atrasada: !!o.prevista_para && o.prevista_para < dia,
        dia: o.prevista_para,
        janela: null,
        referencia: null,
        icone: o.icone,
        reportes: o.reportes,
        fotos: o.fotos,
      })),
    ];

    return {
      dia,
      origem,
      utilizador: { id: u.id, nome: u.nome, servico_id: u.servicoId },
      mostra: { visitas: veVisitas, ocorrencias: veOcorrencias },
      tarefas: ordenarPorProximidade(tarefas, origem),
      por_fazer: tarefas.filter((t) => !t.feita).length,
    };
  }

  /** Fotografia da visita com GPS e hora (URL assinada, como no painel). */
  async fotoVisita(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaFotoCampo>,
  ) {
    const r = await this.fiscalizacao.pedirEnvioFoto(m, u, id, {
      mime: b.mime,
      legenda: b.legenda,
    });
    await this.db.query(
      `UPDATE fiscalizacao_fotos SET lat = $2, lng = $3, tirada_em = $4
       WHERE id = $1 AND municipio_id = $5`,
      [r.foto_id, b.lat ?? null, b.lng ?? null, b.tirada_em ?? null, m.id],
    );
    return r;
  }

  /** A fotografia "do depois": junta-se às do munícipe, marcada 'equipa'. */
  async fotoOcorrencia(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaFotoCampo>,
  ) {
    const o = await this.ocorrencia(m, id);
    if (o.estado === 'rejeitada') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ocorrencia_rejeitada',
        `A ocorrência ${o.numero} foi rejeitada.`,
      );
    }
    const chave = this.armazenamento.chave(
      m.slug,
      'fotos-ocorrencias',
      MIME_FOTOS[b.mime],
    );
    // Antes de gravar: sem armazenamento responde 503 e não fica foto fantasma.
    const url = await this.armazenamento.urlEnvio(chave, b.mime);
    const foto = await this.db.transaction(async (tx) => {
      await tx.query('SELECT 1 FROM ocorrencias WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      const [{ total }] = await tx.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ocorrencia_fotos
         WHERE ocorrencia_id = $1 AND origem = 'equipa'`,
        [id],
      );
      if (total >= MAX_FOTOS_EQUIPA) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'limite_fotos',
          `Esta ocorrência já tem ${MAX_FOTOS_EQUIPA} fotografias da equipa.`,
        );
      }
      const [f] = await tx.query<{ id: string }>(
        `INSERT INTO ocorrencia_fotos
           (ocorrencia_id, ficheiro_key, origem, enviada_por, legenda, lat, lng, tirada_em)
         VALUES ($1, $2, 'equipa', $3, $4, $5, $6, $7) RETURNING id`,
        [
          id,
          chave,
          u.id,
          b.legenda ?? null,
          b.lat ?? null,
          b.lng ?? null,
          b.tirada_em ?? null,
        ],
      );
      await tx.query(
        `INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, ator_id, dados)
         VALUES ($1, 'foto', 'utilizador', $2, $3)`,
        [id, u.id, JSON.stringify({ foto_id: f.id, origem: 'equipa' })],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'acrescentar_foto_ocorrencia',
          objetoTipo: 'ocorrencia',
          objetoId: id,
          dados: { foto_id: f.id },
        },
        tx,
      );
      return f;
    });
    return {
      foto_id: foto.id,
      url_envio: url,
      metodo: 'PUT',
      cabecalhos: { 'Content-Type': b.mime },
      expira_em_segundos: 600,
    };
  }

  /**
   * Fechar no terreno: a nota (e as fotos do depois) ficam no histórico e a
   * ocorrência passa a resolvida pelo caminho do painel, que avisa por SMS
   * quem a reportou (uma vez por pessoa). Repetir não volta a avisar.
   */
  async fecharOcorrencia(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaFecharOcorrencia>,
  ) {
    const o = await this.ocorrencia(m, id);
    if (o.estado === 'rejeitada') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ocorrencia_rejeitada',
        `A ocorrência ${o.numero} foi rejeitada.`,
      );
    }
    if (b.foto_ids.length) {
      const [{ n }] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ocorrencia_fotos
         WHERE ocorrencia_id = $1 AND origem = 'equipa' AND id = ANY($2::uuid[])`,
        [id, b.foto_ids],
      );
      if (n !== new Set(b.foto_ids).size) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'foto_invalida',
          'Há fotografias que não são desta ocorrência.',
        );
      }
    }
    const r = await this.ocorrencias.alterar(m, u, id, { estado: 'resolvida' });
    await this.db.query(
      `INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, ator_id, dados)
       VALUES ($1, 'nota', 'utilizador', $2, $3)`,
      [
        id,
        u.id,
        JSON.stringify({ texto: b.nota, fotos: b.foto_ids, no_terreno: true }),
      ],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'fechar_ocorrencia_terreno',
      objetoTipo: 'ocorrencia',
      objetoId: id,
      dados: { fotos: b.foto_ids.length },
    });
    return {
      ...(await this.ocorrencias.detalhe(m.id, id)),
      avisados: r.avisados,
    };
  }

  private async ocorrencia(m: Municipio, id: string) {
    const [o] = await this.db.query<{ numero: string; estado: string }>(
      'SELECT numero, estado::text AS estado FROM ocorrencias WHERE id = $1 AND municipio_id = $2',
      [id, m.id],
    );
    if (!o) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ocorrencia_nao_encontrada',
        'Ocorrência não encontrada.',
      );
    }
    return o;
  }
}

const NOMES_ESTADO_OCORRENCIA: Record<string, string> = {
  nova: 'Nova',
  com_equipa: 'Com a equipa',
  resolvida: 'Resolvida',
  rejeitada: 'Rejeitada',
  duplicada: 'Duplicada',
};
