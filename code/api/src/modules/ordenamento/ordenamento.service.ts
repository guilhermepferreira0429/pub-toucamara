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
import type { PedidoAntigo } from '../licencas/simulacao.js';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { gerarConsultasDemonstracao } from './consultas-demonstracao.js';
import { alteracoesZona, ConfigZona } from './explicar-zona.js';
import {
  invalidarRegras,
  RegrasVersoesService,
} from '../regras-publicas/versoes.service.js';
import {
  ConsultaAntiga,
  esquemaRegrasZona,
  simularZona,
} from './simulacao-pdm.js';

/** PUT das regras de uma zona: as regras e, se vierem, os dados da zona. */
export const esquemaMudarZona = z.object({
  regras: esquemaRegrasZona,
  nome: z.string().trim().min(2).max(120).optional(),
  descricao: z.string().trim().max(1000).nullable().optional(),
  fonte: z
    .object({
      titulo: z.string().trim().min(2).max(300),
      artigo: z.string().trim().max(120).nullable().default(null),
      url: z.string().trim().url().max(500).nullable().default(null),
    })
    .optional(),
  /** Desligar quando os valores passam a ser os do PDM em vigor. */
  demonstracao: z.boolean().optional(),
});

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
    private readonly versoes: RegrasVersoesService,
  ) {}

  /** As regras de uma zona como ficam no histórico público. */
  static configZona(z: Zona): ConfigZona {
    return {
      nome: z.nome,
      descricao: z.descricao,
      regras: z.regras,
      fonte: z.fonte,
      demonstracao: z.demonstracao,
    };
  }

  /** Desde quando vale a zona como foi carregada. */
  async criadaEm(zonaId: string): Promise<Date> {
    const [r] = await this.db.query<{ criada_em: Date }>(
      'SELECT criada_em FROM zonas_pdm WHERE id = $1',
      [zonaId],
    );
    return r?.criada_em ?? new Date(0);
  }

  async zona(municipioId: string, zonaId: string): Promise<Zona> {
    const [zona] = await this.db.query<Zona>(
      `SELECT id, codigo, nome, categoria, descricao, poligono, regras, fonte, demonstracao
       FROM zonas_pdm WHERE id = $1 AND municipio_id = $2`,
      [zonaId, municipioId],
    );
    if (!zona) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'zona_desconhecida',
        'Esta zona não existe.',
      );
    }
    return zona;
  }

  async zonas(municipioId: string): Promise<Zona[]> {
    return this.db.query<Zona>(
      `SELECT id, codigo, nome, categoria, descricao, poligono, regras, fonte, demonstracao
       FROM zonas_pdm WHERE municipio_id = $1 ORDER BY codigo`,
      [municipioId],
    );
  }

  /**
   * O motor do PDM: a obra, com estas medidas, nesta zona. É o que a
   * ferramenta usa e o que o verificador público usa.
   */
  avaliarNaZona(
    zona: Pick<Zona, 'regras'>,
    obra: Obra,
    medidas: { area_m2?: number; altura_m?: number },
  ) {
    return avaliarObra(zona.regras[obra], medidas);
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
      ? this.avaliarNaZona(zona, e.obra, {
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
    const [zonas, consultas, porObra, perguntas] = await Promise.all([
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
        demonstracao: boolean;
      }>(
        `SELECT q.id, q.morada, q.lat, q.lng, q.obra, q.resultado->>'controlo' AS controlo,
                z.nome AS zona, q.criada_em,
                coalesce((q.resultado->>'demonstracao')::boolean, false) AS demonstracao
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
      // As perguntas de cada zona que a simulação usa (últimos 5 anos).
      this.db.query<{ zona_id: string; total: number; demonstracao: number }>(
        `SELECT zona_id, count(*)::int AS total,
                count(*) FILTER (WHERE resultado->>'demonstracao' = 'true')::int AS demonstracao
         FROM consultas_pdm
         WHERE municipio_id = $1 AND zona_id IS NOT NULL AND criada_em >= now() - interval '5 years'
         GROUP BY 1`,
        [m.id],
      ),
    ]);
    const porZona = new Map(perguntas.map((p) => [p.zona_id, p]));
    return {
      zonas: zonas.map((z) => ({
        ...z,
        perguntas: {
          total: porZona.get(z.id)?.total ?? 0,
          demonstracao: porZona.get(z.id)?.demonstracao ?? 0,
        },
      })),
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

  /**
   * "Testar uma lei antes de a aprovar": as regras propostas para uma zona
   * (sem gravar) contra as perguntas já feitas nessa zona nos últimos 5 anos.
   */
  async simularZona(m: Municipio, zonaId: string, propostas: RegrasZona) {
    const zona = await this.zona(m.id, zonaId);
    const consultas = await this.db.query<PedidoAntigo<ConsultaAntiga>>(
      `SELECT id, codigo AS referencia,
              to_char((criada_em AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS pedido_em,
              jsonb_build_object('obra', obra, 'medidas', coalesce(resultado->'medidas', '{}'::jsonb)) AS dados,
              coalesce((resultado->>'demonstracao')::boolean, false) AS demonstracao
       FROM consultas_pdm
       WHERE municipio_id = $1 AND zona_id = $2 AND criada_em >= now() - interval '5 years'
       ORDER BY criada_em`,
      [m.id, zona.id],
    );
    return {
      zona: {
        id: zona.id,
        codigo: zona.codigo,
        nome: zona.nome,
        demonstracao: zona.demonstracao,
      },
      ...simularZona(zona.regras, propostas, consultas),
      nota: 'Aqui "aprovado" quer dizer que se resolve sem licença (isento ou comunicação prévia). As perguntas são as que as pessoas fizeram ao agente nesta zona.',
    };
  }

  /**
   * Grava as regras de uma zona (e, se vierem, o nome, a descrição, a fonte
   * e a marca de demonstração). O agente usa-as logo na pergunta seguinte.
   */
  async gravarRegras(
    m: Municipio,
    u: UtilizadorPainel,
    zonaId: string,
    e: z.output<typeof esquemaMudarZona>,
  ): Promise<Zona> {
    const antes = await this.zona(m.id, zonaId);
    const depois: Zona = {
      ...antes,
      regras: e.regras,
      nome: e.nome ?? antes.nome,
      descricao: e.descricao !== undefined ? e.descricao : antes.descricao,
      fonte: e.fonte ?? antes.fonte,
      demonstracao: e.demonstracao ?? antes.demonstracao,
    };
    // Na auditoria: as regras sempre, o resto só se mudou.
    const campos = ['nome', 'descricao', 'fonte', 'demonstracao'] as const;
    const mudou = campos.filter(
      (k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]),
    );
    const parte = (z: Zona) =>
      Object.fromEntries([
        ['regras', z.regras],
        ...mudou.map((k) => [k, z[k]]),
      ]) as Record<string, unknown>;
    const inicialDesde = await this.criadaEm(antes.id);
    const alteracoes = alteracoesZona(
      OrdenamentoService.configZona(antes),
      OrdenamentoService.configZona(depois),
    );
    await this.db.transaction(async (tx) => {
      // O histórico público: o que mudou, quando e o cargo de quem mudou.
      await this.versoes.registar(tx, {
        municipioId: m.id,
        ambito: 'zona',
        chave: antes.codigo,
        antes: OrdenamentoService.configZona(antes),
        depois: OrdenamentoService.configZona(depois),
        alteracoes,
        utilizador: u,
        inicialDesde,
      });
      await tx.query(
        `UPDATE zonas_pdm SET regras = $3, nome = $4, descricao = $5, fonte = $6, demonstracao = $7
         WHERE id = $1 AND municipio_id = $2`,
        [
          antes.id,
          m.id,
          JSON.stringify(depois.regras),
          depois.nome,
          depois.descricao,
          JSON.stringify(depois.fonte),
          depois.demonstracao,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'mudar_regras_zona',
          objetoTipo: 'zona_pdm',
          objetoId: antes.id,
          dados: {
            codigo: antes.codigo,
            antes: parte(antes),
            depois: parte(depois),
          },
        },
        tx,
      );
    });
    return depois;
  }

  /**
   * Carrega perguntas antigas de demonstração (moradas dentro das zonas),
   * só se ainda não houver: para a simulação ter com que trabalhar. A
   * resposta guardada é a das regras em vigor de cada zona.
   */
  async carregarConsultasDemonstracao(m: Municipio, u: UtilizadorPainel) {
    const zonas = await this.zonas(m.id);
    if (zonas.length === 0) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_zonas',
        'Carregue primeiro as zonas do PDM.',
      );
    }
    const [ja] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM consultas_pdm
       WHERE municipio_id = $1 AND resultado->>'demonstracao' = 'true'`,
      [m.id],
    );
    if (ja.n > 0) return { criadas: 0, ja_havia: ja.n };

    const linhas = gerarConsultasDemonstracao(hojeLisboa()).flatMap((c) => {
      const zona = zonaDe([c.lat, c.lng], zonas);
      if (!zona) return [];
      const a = avaliarObra(zona.regras[c.obra], c.medidas);
      const controlo: Controlo | null = a.em_falta.length ? null : a.controlo;
      return [
        {
          morada: c.morada,
          lat: c.lat,
          lng: c.lng,
          zona_id: zona.id,
          obra: c.obra,
          criada_em: c.criada_em,
          codigo: Array.from(
            { length: 8 },
            () => ALFABETO[randomInt(ALFABETO.length)],
          ).join(''),
          resultado: {
            controlo,
            controlo_dito: controlo ? CONTROLO_DITO[controlo] : null,
            limites: a.limites,
            notas: a.notas,
            passos: controlo ? passos(controlo) : [],
            dizer: controlo
              ? `A morada fica em ${zona.nome}: para ${OBRAS[c.obra].toLowerCase()}, ${CONTROLO_DITO[controlo]}. (Pergunta de demonstração.)`
              : `A morada fica em ${zona.nome}. Um técnico tem de ver o caso. (Pergunta de demonstração.)`,
            zona: {
              codigo: zona.codigo,
              nome: zona.nome,
              categoria: zona.categoria,
              demonstracao: zona.demonstracao,
              fonte: zona.fonte,
            },
            medidas: c.medidas,
            demonstracao: true,
          },
        },
      ];
    });
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO consultas_pdm (municipio_id, morada, lat, lng, zona_id, obra, resultado, codigo, criada_em)
         SELECT $1, x.morada, x.lat, x.lng, x.zona_id, x.obra, x.resultado, x.codigo, x.criada_em
         FROM jsonb_to_recordset($2::jsonb) AS x(morada text, lat double precision, lng double precision,
           zona_id uuid, obra text, resultado jsonb, codigo text, criada_em timestamptz)`,
        [m.id, JSON.stringify(linhas)],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'carregar_consultas_pdm_demonstracao',
          objetoTipo: 'zonas_pdm',
          objetoId: m.id,
          dados: { perguntas: linhas.length },
        },
        tx,
      );
    });
    return { criadas: linhas.length, ja_havia: 0 };
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
    invalidarRegras();
    return this.painel(m);
  }

  private url(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/zona/${codigo}`;
  }
}
