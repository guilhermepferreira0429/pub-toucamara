import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import {
  MunicipiosService,
  type Municipio,
} from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { coordenadasValidas, grelhaMosaicos } from './mapa.js';
import { MosaicosOsmService } from './mosaicos-osm.service.js';
import { gerarPdfPlanta } from './planta-pdf.js';

export const esquemaPlanta = z
  .object({
    // 17 ≈ 1:2 500 em A4 (o bairro); 18 ≈ 1:1 300 (a rua).
    zoom: z.union([z.literal(17), z.literal(18)]).default(17),
  })
  .strict();

/** Tentativas da geração automática por processo, de 6 em 6 horas. */
const MAX_TENTATIVAS_AUTO = 3;

export interface DocumentoPlanta {
  id: string;
  processo_id: string;
  tipo_documento_id: string | null;
  mime: string;
  tamanho: number;
  origem: 'gerado';
  verificacao_estado: 'valido';
  emitido_em: string;
  recebido_em: Date;
}

export interface ResultadoPlanta {
  pdf: Buffer;
  numero: string;
  lat: number;
  lng: number;
  geocodificada: boolean;
  zoom: number;
  /** null = sem armazenamento: o PDF vai na resposta e não fica guardado. */
  documento: DocumentoPlanta | null;
}

/**
 * Planta de localização do processo: coordenadas (do processo ou
 * geocodificadas a partir da morada), 3×3 mosaicos do OpenStreetMap à volta
 * do ponto e um PDF A4 guardado como documento do processo.
 *
 * Escritas fora do módulo, mínimas e só em SQL: `processos.lat/lng` quando
 * se geocodifica (só se estavam vazias) e a linha em `documentos` (origem
 * 'gerado', 'valido', do tipo com gerado_pelo_sistema). Sem mapa não há
 * planta: 503 `mapa_indisponivel`, nunca um mapa falso.
 */
@Injectable()
export class PlantaService {
  private readonly logger = new Logger(PlantaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly geo: GeocodificacaoService,
    private readonly mosaicos: MosaicosOsmService,
    private readonly municipios: MunicipiosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async gerar(
    m: Municipio,
    processoId: string,
    opcoes: z.output<typeof esquemaPlanta>,
    u?: UtilizadorPainel,
  ): Promise<ResultadoPlanta> {
    const [p] = await this.db.query<{
      id: string;
      numero: string;
      assunto: string;
      morada: string | null;
      freguesia: string | null;
      lat: number | null;
      lng: number | null;
      tipo_documento_id: string | null;
    }>(
      `SELECT p.id, p.numero, p.assunto, p.morada, p.freguesia, p.lat, p.lng,
              (SELECT td.id FROM tipo_processo_documentos td
               WHERE td.tipo_processo_id = p.tipo_processo_id AND td.gerado_pelo_sistema
               ORDER BY td.ordem LIMIT 1) AS tipo_documento_id
       FROM processos p WHERE p.id = $1 AND p.municipio_id = $2`,
      [processoId, m.id],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Processo não existe.',
      );
    }

    // 1) Coordenadas.
    let lat = p.lat;
    let lng = p.lng;
    let geocodificada = false;
    if (lat === null || lng === null) {
      if (!p.morada?.trim()) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'processo_sem_morada',
          'O processo não tem morada nem coordenadas: não há onde pôr o marcador.',
        );
      }
      const c = await this.geo.geocodificar(p.morada, m.nome);
      if (!c || !coordenadasValidas(c.lat, c.lng)) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'morada_nao_encontrada',
          'Não foi possível localizar a morada do processo no mapa. Corrija a morada ou marque o local.',
          { morada: p.morada },
        );
      }
      lat = c.lat;
      lng = c.lng;
      geocodificada = true;
      // Só se continuarem vazias: não se pisa um ponto marcado entretanto.
      await this.db.query(
        `UPDATE processos SET lat = $2, lng = $3
         WHERE id = $1 AND (lat IS NULL OR lng IS NULL)`,
        [p.id, lat, lng],
      );
    }
    if (!coordenadasValidas(lat, lng)) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'coordenadas_invalidas',
        'As coordenadas do processo não são válidas.',
        { lat, lng },
      );
    }

    // 2) Mosaicos, um a um (política de uso do OSM).
    const grelha = grelhaMosaicos(lat, lng, opcoes.zoom);
    const pngs: Buffer[] = [];
    try {
      for (const t of grelha.mosaicos) {
        pngs.push(await this.mosaicos.obter(t.z, t.x, t.y));
      }
    } catch (e) {
      this.logger.warn(
        `Planta do processo ${p.numero}: mapa indisponível (${(e as Error).message})`,
      );
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'mapa_indisponivel',
        'Não foi possível obter o mapa do OpenStreetMap. Tente daqui a pouco.',
      );
    }

    // 3) PDF.
    const hoje = hojeLisboa();
    const pdf = await gerarPdfPlanta({
      municipio: m.nome,
      numeroProcesso: p.numero,
      assunto: p.assunto,
      morada: p.morada,
      freguesia: p.freguesia,
      lat,
      lng,
      geocodificada,
      data: hoje,
      grelha,
      mosaicos: pngs,
    });

    // 4) Guardar (se houver onde).
    let documento: DocumentoPlanta | null = null;
    if (this.armazenamento.disponivel) {
      const chave = this.armazenamento.chave(m.slug, 'documentos', 'pdf');
      await this.armazenamento.guardar(chave, pdf, 'application/pdf');
      [documento] = await this.db.query<DocumentoPlanta>(
        `INSERT INTO documentos (municipio_id, processo_id, tipo_documento_id, ficheiro_key, mime,
           tamanho, origem, verificacao_estado, emitido_em)
         VALUES ($1, $2, $3, $4, 'application/pdf', $5, 'gerado', 'valido', $6::date)
         RETURNING id, processo_id, tipo_documento_id, mime, tamanho, origem, verificacao_estado,
                   emitido_em::text AS emitido_em, recebido_em`,
        [m.id, p.id, p.tipo_documento_id, chave, pdf.length, hoje],
      );
    }
    if (u) {
      await this.auditoria.registar({
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'gerar_planta',
        objetoTipo: 'processo',
        objetoId: p.id,
        dados: {
          documento_id: documento?.id ?? null,
          geocodificada,
          zoom: opcoes.zoom,
        },
      });
    }
    return {
      pdf,
      numero: p.numero,
      lat,
      lng,
      geocodificada,
      zoom: opcoes.zoom,
      documento,
    };
  }

  /** URL de leitura do documento guardado (5 min); null se falhar. */
  async urlLeitura(documentoId: string): Promise<string | null> {
    const [d] = await this.db.query<{ ficheiro_key: string }>(
      'SELECT ficheiro_key FROM documentos WHERE id = $1',
      [documentoId],
    );
    if (!d) return null;
    try {
      return await this.armazenamento.urlLeitura(d.ficheiro_key);
    } catch {
      return null;
    }
  }

  /**
   * O job `plantas_localizacao`: processos abertos cujo tipo pede um
   * documento gerado pelo sistema que ainda não têm. Poucos de cada vez
   * (cada planta são 9 mosaicos) e no máximo 3 tentativas por processo, de
   * 6 em 6 horas. Sem armazenamento não faz nada: uma planta que não fica
   * guardada não serve ao processo.
   */
  async gerarEmFalta(limite = 3) {
    if (!this.armazenamento.disponivel) {
      return { geradas: 0, falharam: 0, sem_armazenamento: true };
    }
    const candidatos = await this.db.query<{
      id: string;
      municipio_id: string;
    }>(
      `SELECT DISTINCT ON (p.criado_em, p.id) p.id, p.municipio_id
       FROM processos p
       JOIN tipo_processo_documentos td
         ON td.tipo_processo_id = p.tipo_processo_id AND td.gerado_pelo_sistema
       LEFT JOIN planta_tentativas t ON t.processo_id = p.id
       WHERE p.fase <> 'arquivado'
         AND (nullif(trim(p.morada), '') IS NOT NULL OR (p.lat IS NOT NULL AND p.lng IS NOT NULL))
         AND NOT EXISTS (SELECT 1 FROM documentos d
                         WHERE d.processo_id = p.id AND d.tipo_documento_id = td.id)
         AND (t.processo_id IS NULL
              OR (t.tentativas < $2 AND t.ultima_em < now() - interval '6 hours'))
       ORDER BY p.criado_em, p.id
       LIMIT $1`,
      [limite, MAX_TENTATIVAS_AUTO],
    );
    const resumo = { geradas: 0, falharam: 0, sem_armazenamento: false };
    for (const c of candidatos) {
      try {
        const m = await this.municipios.porId(c.municipio_id);
        await this.gerar(m, c.id, { zoom: 17 });
        await this.db.query(
          'DELETE FROM planta_tentativas WHERE processo_id = $1',
          [c.id],
        );
        resumo.geradas++;
      } catch (e) {
        resumo.falharam++;
        const erro = (e as Error).message.slice(0, 500);
        this.logger.warn(`Planta automática de ${c.id}: ${erro}`);
        await this.db.query(
          `INSERT INTO planta_tentativas (processo_id, tentativas, ultima_em, erro)
           VALUES ($1, 1, now(), $2)
           ON CONFLICT (processo_id) DO UPDATE
             SET tentativas = planta_tentativas.tentativas + 1, ultima_em = now(), erro = $2`,
          [c.id, erro],
        );
      }
    }
    return resumo;
  }
}
