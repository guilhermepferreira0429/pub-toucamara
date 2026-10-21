import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { normalizarTelefone } from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import {
  avaliarObra,
  Controlo,
  CONTROLO_DITO,
  Obra,
  OBRAS,
  passos,
  Ponto,
  RegrasZona,
  ZONAS_DEMONSTRACAO,
  zonaDe,
} from './regras.js';

export const entradaOQuePossoFazer = z.object({
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('A morada do terreno ou da casa: rua, número e freguesia.'),
  obra: z
    .enum(Object.keys(OBRAS) as [Obra, ...Obra[]])
    .describe(
      'anexo (telheiro, arrumos), muro, piscina, ampliacao, fachada (porta, janela, cor) ou interior.',
    ),
  area_m2: z
    .number()
    .positive()
    .max(100_000)
    .optional()
    .describe(
      'Área em metros quadrados, se a pessoa disser (ou se vier em em_falta).',
    ),
  altura_m: z
    .number()
    .positive()
    .max(100)
    .optional()
    .describe('Altura em metros, se a pessoa disser (ou se vier em em_falta).'),
});

export interface Zona {
  id: string;
  codigo: string;
  nome: string;
  categoria: string;
  descricao: string | null;
  poligono: Ponto[];
  regras: RegrasZona;
  fonte: { titulo: string; artigo: string | null; url: string | null };
  demonstracao: boolean;
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * "Diga-me a morada e eu digo-lhe o que pode fazer": a morada no mapa, a
 * zona do PDM e o controlo que a obra precisa, com a página da planta e
 * dos passos por SMS.
 */
@Injectable()
export class OrdenamentoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly geo: GeocodificacaoService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async zonas(municipioId: string): Promise<Zona[]> {
    return this.db.query<Zona>(
      `SELECT id, codigo, nome, categoria, descricao, poligono, regras, fonte, demonstracao
       FROM zonas_pdm WHERE municipio_id = $1 ORDER BY codigo`,
      [municipioId],
    );
  }

  // ------------------------------------------------------------------
  // Ferramenta do agente
  // ------------------------------------------------------------------

  async oQuePossoFazer(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaOQuePossoFazer>,
  ) {
    const m = ctx.municipio;
    const zonas = await this.zonas(m.id);
    if (zonas.length === 0) {
      return {
        respondido: false,
        motivo: 'sem_pdm',
        dizer:
          'Ainda não tenho o plano diretor municipal carregado. Procure a regra com procurar_conhecimento ou passe a um funcionário.',
      };
    }
    const c = await this.geo.geocodificar(e.morada, m.nome);
    if (!c) {
      return {
        respondido: false,
        motivo: 'morada_nao_encontrada',
        dizer:
          'Não encontrei essa morada no mapa. Peça a rua e o número outra vez, ou uma referência perto (uma igreja, uma escola).',
      };
    }
    const ponto: Ponto = [c.lat, c.lng];
    const zona = zonaDe(ponto, zonas);
    const a = zona
      ? avaliarObra(zona.regras[e.obra], {
          area_m2: e.area_m2,
          altura_m: e.altura_m,
        })
      : null;

    if (a && a.em_falta.length) {
      return {
        respondido: false,
        motivo: 'faltam_medidas',
        zona: zona!.nome,
        em_falta: a.em_falta,
        dizer: `A morada fica em ${zona!.nome}. Para lhe dizer o que precisa, diga-me ${a.em_falta
          .map((x) =>
            x === 'area_m2'
              ? 'a área, em metros quadrados'
              : 'a altura, em metros',
          )
          .join(' e ')}.`,
      };
    }

    const controlo: Controlo | null = a?.controlo ?? null;
    const resultado = {
      controlo,
      controlo_dito: controlo ? CONTROLO_DITO[controlo] : null,
      limites: a?.limites ?? [],
      notas: a?.notas ?? [],
      passos: controlo ? passos(controlo) : [],
      dizer: !zona
        ? 'Essa morada fica fora das zonas do plano que tenho. Um técnico tem de ver o seu caso.'
        : !controlo
          ? `A morada fica em ${zona.nome}, mas não tenho regra para essa obra. Um técnico tem de ver o seu caso.`
          : `A morada fica em ${zona.nome}: para ${OBRAS[e.obra].toLowerCase()}, ${CONTROLO_DITO[controlo]}. ` +
            (zona.demonstracao ? '(Regras de demonstração.) ' : ''),
      zona: zona
        ? {
            codigo: zona.codigo,
            nome: zona.nome,
            categoria: zona.categoria,
            demonstracao: zona.demonstracao,
            fonte: zona.fonte,
          }
        : null,
    };

    const codigo = Array.from(
      { length: 8 },
      () => ALFABETO[randomInt(ALFABETO.length)],
    ).join('');
    const telefone = normalizarTelefone(ctx.telefone);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO consultas_pdm (municipio_id, conversa_id, municipe_id, morada, lat, lng, zona_id,
           obra, resultado, codigo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          m.id,
          ctx.conversaId,
          ctx.municipeId,
          e.morada,
          c.lat,
          c.lng,
          zona?.id ?? null,
          e.obra,
          JSON.stringify({
            ...resultado,
            medidas: { area_m2: e.area_m2, altura_m: e.altura_m },
          }),
          codigo,
        ],
      );
      if (telefone && zona && controlo) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: ctx.municipeId,
            destino: telefone,
            motivo: 'fim_chamada',
            corpo: `${m.nome}: ${OBRAS[e.obra]} em ${e.morada}: ${CONTROLO_DITO[controlo]}. Planta, regras e passos: ${this.url(codigo)}`,
            relacionado: ctx.conversaId ? { conversa_id: ctx.conversaId } : {},
            chave: `consulta_pdm:${codigo}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'resposta_com_fonte',
        { consulta_pdm: codigo, zona: zona?.codigo ?? null, controlo },
        tx,
      );
    });

    return {
      respondido: !!controlo,
      ...resultado,
      link: this.url(codigo),
      sms_enviado: !!(telefone && zona && controlo),
    };
  }

  // ------------------------------------------------------------------
  // Público (o link do SMS)
  // ------------------------------------------------------------------

  async publico(codigo: string) {
    const c = codigo.trim().toUpperCase();
    const [r] = /^[A-Z0-9]{8}$/.test(c)
      ? await this.db.query<{
          morada: string;
          lat: number | null;
          lng: number | null;
          obra: Obra;
          resultado: Record<string, unknown>;
          criada_em: Date;
          municipio: string;
          zona: Pick<
            Zona,
            | 'codigo'
            | 'nome'
            | 'categoria'
            | 'descricao'
            | 'poligono'
            | 'demonstracao'
            | 'fonte'
          > | null;
        }>(
          `SELECT q.morada, q.lat, q.lng, q.obra, q.resultado, q.criada_em, m.nome AS municipio,
                  CASE WHEN z.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'codigo', z.codigo, 'nome', z.nome, 'categoria', z.categoria,
                    'descricao', z.descricao, 'poligono', z.poligono,
                    'demonstracao', z.demonstracao, 'fonte', z.fonte) END AS zona
           FROM consultas_pdm q JOIN municipios m ON m.id = q.municipio_id
           LEFT JOIN zonas_pdm z ON z.id = q.zona_id
           WHERE q.codigo = $1`,
          [c],
        )
      : [];
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe ou já expirou.',
      );
    }
    return {
      ...r,
      obra_texto: OBRAS[r.obra],
      criada_em: r.criada_em.toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async painel(m: Municipio) {
    const [zonas, consultas, porObra] = await Promise.all([
      this.zonas(m.id),
      this.db.query<{
        id: string;
        morada: string;
        lat: number | null;
        lng: number | null;
        obra: Obra;
        controlo: Controlo | null;
        zona: string | null;
        criada_em: Date;
      }>(
        `SELECT q.id, q.morada, q.lat, q.lng, q.obra, q.resultado->>'controlo' AS controlo,
                z.nome AS zona, q.criada_em
         FROM consultas_pdm q LEFT JOIN zonas_pdm z ON z.id = q.zona_id
         WHERE q.municipio_id = $1 ORDER BY q.criada_em DESC LIMIT 200`,
        [m.id],
      ),
      this.db.query<{ obra: Obra; controlo: string | null; n: number }>(
        `SELECT obra, resultado->>'controlo' AS controlo, count(*)::int AS n
         FROM consultas_pdm WHERE municipio_id = $1 AND criada_em > now() - interval '30 days'
         GROUP BY 1, 2 ORDER BY n DESC`,
        [m.id],
      ),
    ]);
    return {
      zonas,
      consultas: consultas.map((q) => ({
        ...q,
        obra_texto: OBRAS[q.obra],
        criada_em: q.criada_em.toISOString(),
      })),
      por_obra: porObra.map((x) => ({ ...x, obra_texto: OBRAS[x.obra] })),
      obras: OBRAS,
      controlos: CONTROLO_DITO,
    };
  }

  /** Carrega as zonas de demonstração (só se o município ainda não tiver zonas). */
  async carregarDemonstracao(m: Municipio, u: UtilizadorPainel) {
    const existentes = await this.zonas(m.id);
    if (existentes.length) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ja_tem_zonas',
        'Este município já tem zonas do PDM carregadas.',
      );
    }
    await this.db.transaction(async (tx) => {
      for (const z of ZONAS_DEMONSTRACAO) {
        await tx.query(
          `INSERT INTO zonas_pdm (municipio_id, codigo, nome, categoria, descricao, poligono, regras, fonte, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
          [
            m.id,
            z.codigo,
            z.nome,
            z.categoria,
            z.descricao,
            JSON.stringify(z.poligono),
            JSON.stringify(z.regras),
            JSON.stringify(z.fonte),
          ],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'carregar_zonas_demonstracao',
          objetoTipo: 'zonas_pdm',
          objetoId: m.id,
        },
        tx,
      );
    });
    return this.painel(m);
  }

  private url(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/zona/${codigo}`;
  }
}
