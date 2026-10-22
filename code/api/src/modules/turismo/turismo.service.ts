import { Injectable, Logger, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { esquemaFeed, type ItemAgora } from '../agora/agora.regras.js';
import { AgoraService } from '../agora/agora.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PainelConhecimentoService } from '../conhecimento/painel-conhecimento.service.js';
import { VERSAO_ATUAL } from '../conhecimento/sql.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { PONTOS_DEMO, TEMAS_DEMO, urlFonteDemo } from './turismo.conteudo.js';
import {
  esquemaMetaTurismo,
  INTERESSES,
  Interesse,
  Lingua,
  LINGUAS,
  linguaDe,
  linkMapa,
  MetaTurismo,
  normalizar,
  PedidoRoteiro,
  Ponto,
  ROTEIROS_PRONTOS,
  Roteiro,
  seccoes,
  sugerirRoteiro,
} from './turismo.regras.js';

/** O que se diz sempre sobre o conteúdo de demonstração. */
const AVISO_DEMO =
  'Conteúdo de demonstração, a confirmar com o turismo da câmara: tempos de visita, acessibilidade e coordenadas são estimativas; horários e preços consultam-se no local ou no site oficial.';

/** Dias de eventos que entram em "o que ver" e no roteiro. */
const DIAS_EVENTOS = 3;

export const entradaOQueVisitar = z.object({
  minutos: z
    .number()
    .int()
    .min(30)
    .max(720)
    .optional()
    .describe('Minutos que tem (meio dia = 240); se não disser, 180.'),
  interesses: z
    .array(z.enum(INTERESSES))
    .max(5)
    .optional()
    .describe('Vazio = um pouco de tudo.'),
  mobilidade_reduzida: z
    .boolean()
    .optional()
    .describe('Dificuldade a andar, cadeira de rodas ou carrinho.'),
  lingua: z.enum(LINGUAS).optional().describe('A língua da conversa.'),
});

interface LinhaFonte {
  id: string;
  titulo: string;
  url: string;
  lingua: string;
  demonstracao: boolean;
  turismo: unknown;
  entidade: string;
  texto: string | null;
  lida_em: Date | null;
}

interface Tema {
  tema: string;
  ordem: number;
  fonte_id: string;
  titulo: string;
  lingua: string;
  url: string;
  entidade: string;
  demonstracao: boolean;
  lida_em: Date | null;
  seccoes: { titulo: string | null; texto: string; ponto: string | null }[];
  pontos: Ponto[];
}

/**
 * Turismo: o conteúdo turístico são fontes do conhecimento (tipo 'turismo',
 * uma por tema e língua). Este serviço carrega as de demonstração, monta a
 * página pública /visitar (texto atual das fontes + pontos do mapa +
 * roteiros) e corre a ferramenta o_que_visitar.
 */
@Injectable()
export class TurismoService {
  private readonly logger = new Logger(TurismoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ref: ModuleRef,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly municipios: MunicipiosService,
  ) {}

  private svc<T>(tipo: Type<T>): T {
    return this.ref.get(tipo, { strict: false });
  }

  private webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  // -------------------------------------------------------------------
  // Demonstração
  // -------------------------------------------------------------------

  /** A entidade do turismo (a de demonstração, se a câmara não tiver uma). */
  private async entidade(m: Municipio): Promise<string> {
    const [e] = await this.db.query<{ id: string }>(
      `SELECT id FROM entidades
       WHERE municipio_id = $1 AND ativo AND nome ILIKE '%turismo%'
       ORDER BY nome LIMIT 1`,
      [m.id],
    );
    if (e) return e.id;
    const [n] = await this.db.query<{ id: string }>(
      `INSERT INTO entidades (municipio_id, nome, tipo, descricao)
       VALUES ($1, $2, 'camara', $3)
       ON CONFLICT (municipio_id, nome) DO UPDATE SET ativo = entidades.ativo
       RETURNING id`,
      [
        m.id,
        'Turismo da Câmara Municipal',
        'Posto de turismo e informação turística. Entidade de demonstração: confirmar com a câmara quem gere o turismo.',
      ],
    );
    return n.id;
  }

  /**
   * Carrega as fontes de turismo de demonstração (9 temas × PT/EN/ES/FR).
   * Idempotente: uma fonte que já existe (pelo endereço) não se cria outra
   * vez e o texto que a câmara entretanto editou não é substituído; só se
   * cola o texto a uma fonte que ainda não tem nenhuma versão.
   */
  async carregarDemonstracao(m: Municipio, u: UtilizadorPainel) {
    const conh = this.svc(PainelConhecimentoService);
    const entidadeId = await this.entidade(m);
    let criadas = 0;
    let comTexto = 0;
    for (const t of TEMAS_DEMO) {
      for (const lingua of LINGUAS) {
        const meta: MetaTurismo = {
          tema: t.tema,
          ordem: t.ordem,
          pontos: (t.pontos ?? []).map((chave) => {
            const p = PONTOS_DEMO.find((x) => x.chave === chave)!;
            return { ...p, nome: p.nome[lingua] };
          }),
        };
        const url = urlFonteDemo(t.tema, lingua);
        const [nova] = await this.db.query<{ id: string }>(
          `INSERT INTO fontes (municipio_id, entidade_id, titulo, tipo, url, ler_a_cada,
                               leitura_automatica, lingua, demonstracao, turismo)
           VALUES ($1, $2, $3, 'turismo', $4, interval '365 days', false, $5, true, $6)
           ON CONFLICT (municipio_id, url) DO NOTHING
           RETURNING id`,
          [
            m.id,
            entidadeId,
            t.titulo[lingua],
            url,
            lingua,
            JSON.stringify(meta),
          ],
        );
        let id: string | undefined = nova?.id;
        if (nova) {
          criadas++;
        } else {
          const [ja] = await this.db.query<{ id: string; versoes: number }>(
            `UPDATE fontes SET turismo = coalesce(turismo, $3::jsonb)
             WHERE municipio_id = $1 AND url = $2
             RETURNING id, (SELECT count(*)::int FROM fonte_versoes v WHERE v.fonte_id = fontes.id) AS versoes`,
            [m.id, url, JSON.stringify(meta)],
          );
          id = ja && ja.versoes === 0 ? ja.id : undefined;
        }
        if (id) {
          await conh.colarTexto(m.id, u, id, { texto: t.texto[lingua] });
          comTexto++;
        }
      }
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'carregar_turismo_demonstracao',
      objetoTipo: 'turismo',
      objetoId: m.id,
      dados: { criadas, com_texto: comTexto },
    });
    return {
      criadas,
      com_texto: comTexto,
      total: TEMAS_DEMO.length * LINGUAS.length,
      demonstracao: true,
      aviso: AVISO_DEMO,
    };
  }

  // -------------------------------------------------------------------
  // Leitura (pública e ferramenta)
  // -------------------------------------------------------------------

  /** As fontes de turismo com o texto atual, por tema, na língua pedida (senão PT). */
  async temas(municipioId: string, lingua: Lingua): Promise<Tema[]> {
    const linhas = await this.db.query<LinhaFonte>(
      `SELECT fo.id, fo.titulo, fo.url, fo.lingua, fo.demonstracao, fo.turismo,
              e.nome AS entidade, fv.texto, fv.lida_em
       FROM fontes fo
       JOIN entidades e ON e.id = fo.entidade_id
       LEFT JOIN fonte_versoes fv ON ${VERSAO_ATUAL}
       WHERE fo.municipio_id = $1 AND fo.tipo = 'turismo' AND e.ativo
         AND fo.turismo IS NOT NULL`,
      [municipioId],
    );
    const porTema = new Map<string, { meta: MetaTurismo; l: LinhaFonte }[]>();
    for (const l of linhas) {
      const meta = esquemaMetaTurismo.safeParse(l.turismo);
      if (!meta.success || !l.texto) continue;
      const lista = porTema.get(meta.data.tema) ?? [];
      lista.push({ meta: meta.data, l });
      porTema.set(meta.data.tema, lista);
    }
    const temas: Tema[] = [];
    for (const lista of porTema.values()) {
      const escolha =
        lista.find((x) => x.l.lingua === lingua) ??
        lista.find((x) => x.l.lingua === 'pt') ??
        lista[0];
      const { meta, l } = escolha;
      const nomes = new Map(meta.pontos.map((p) => [normalizar(p.nome), p]));
      temas.push({
        tema: meta.tema,
        ordem: meta.ordem,
        fonte_id: l.id,
        titulo: l.titulo,
        lingua: l.lingua,
        url: l.url,
        entidade: l.entidade,
        demonstracao: l.demonstracao,
        lida_em: l.lida_em,
        seccoes: seccoes(l.texto ?? '').map((s) => ({
          ...s,
          ponto: s.titulo
            ? (nomes.get(normalizar(s.titulo))?.chave ?? null)
            : null,
        })),
        pontos: meta.pontos,
      });
    }
    return temas.sort((a, b) => a.ordem - b.ordem);
  }

  private pontosDe(temas: Tema[]) {
    return temas.flatMap((t) =>
      t.pontos.map((p) => ({
        ...p,
        tema: t.tema,
        descricao: t.seccoes.find((s) => s.ponto === p.chave)?.texto ?? null,
        mapa: linkMapa(p.lat, p.lng),
      })),
    );
  }

  /** Eventos publicados dos próximos dias (do /agora). */
  private async eventos(slug: string, dias = DIAS_EVENTOS) {
    const agora = new Date();
    let itens: ItemAgora[];
    try {
      const r = await this.svc(AgoraService).feed(
        slug,
        esquemaFeed.parse({
          tipos: 'eventos',
          de: agora.toISOString(),
          ate: new Date(agora.getTime() + dias * 86_400_000).toISOString(),
          limite: 10,
        }),
      );
      itens = r.itens;
    } catch (e) {
      // Sem eventos a página e o roteiro continuam a servir.
      this.logger.warn(`Eventos do /agora: ${(e as Error).message}`);
      return [];
    }
    return itens.map((i) => ({
      id: i.id,
      titulo: i.titulo,
      resumo: i.resumo,
      inicio: i.inicio,
      fim: i.fim,
      lat: i.lat,
      lng: i.lng,
      rua: i.rua,
      link: i.link,
    }));
  }

  private linkVisitar(
    slug: string,
    lingua: Lingua,
    pedido?: PedidoRoteiro,
  ): string {
    const q = new URLSearchParams({ lingua });
    if (pedido) {
      q.set('minutos', String(pedido.minutos));
      if (pedido.interesses.length)
        q.set('interesses', pedido.interesses.join(','));
      if (pedido.mobilidade_reduzida) q.set('mobilidade', '1');
    }
    return `${this.webUrl()}/visitar/${encodeURIComponent(slug)}?${q.toString()}${pedido ? '#roteiro' : ''}`;
  }

  /** GET /public/turismo/:municipio — a página /visitar numa língua. */
  async publico(slug: string, linguaPedida: string | undefined) {
    const m = await this.municipios.porSlug(slug);
    const lingua = linguaDe(linguaPedida) ?? 'pt';
    const temas = await this.temas(m.id, lingua);
    const pontos = this.pontosDe(temas);
    const eventos = await this.eventos(m.slug, 7);
    const [{ linguas } = { linguas: [] }] = await this.db.query<{
      linguas: string[];
    }>(
      `SELECT coalesce(array_agg(DISTINCT lingua ORDER BY lingua), '{}') AS linguas
       FROM fontes WHERE municipio_id = $1 AND tipo = 'turismo'`,
      [m.id],
    );
    return {
      municipio: { slug: m.slug, nome: m.nome },
      lingua,
      linguas_disponiveis: linguas,
      demonstracao: temas.some((t) => t.demonstracao),
      aviso: temas.some((t) => t.demonstracao) ? AVISO_DEMO : null,
      temas: temas.map(({ pontos: _p, ...t }) => {
        void _p;
        return t;
      }),
      pontos,
      eventos,
      roteiros: ROTEIROS_PRONTOS.map((r) => ({
        chave: r.chave,
        pedido: r.pedido,
        ...this.resumirRoteiro(sugerirRoteiro(pontos, r.pedido)),
      })),
      links: {
        agora: `${this.webUrl()}/agora/${encodeURIComponent(m.slug)}`,
      },
    };
  }

  /** GET /public/turismo/:municipio/roteiro — um roteiro à medida. */
  async roteiroPublico(
    slug: string,
    linguaPedida: string | undefined,
    pedido: PedidoRoteiro,
  ) {
    const m = await this.municipios.porSlug(slug);
    const lingua = linguaDe(linguaPedida) ?? 'pt';
    const pontos = this.pontosDe(await this.temas(m.id, lingua));
    return {
      lingua,
      pedido,
      demonstracao: true,
      ...this.resumirRoteiro(sugerirRoteiro(pontos, pedido)),
    };
  }

  private resumirRoteiro(r: Roteiro) {
    return {
      paragens: r.paragens.map((p) => ({
        chave: p.chave,
        nome: p.nome,
        minutos: p.minutos,
        chegada_min: p.chegada_min,
        acessibilidade: p.acessibilidade,
        fora_do_centro: !!p.fora_do_centro,
        lat: p.lat,
        lng: p.lng,
      })),
      minutos_total: r.minutos_total,
      sobra_min: r.sobra_min,
      excluidos_mobilidade: r.excluidos_mobilidade,
    };
  }

  // -------------------------------------------------------------------
  // Ferramenta o_que_visitar
  // -------------------------------------------------------------------

  async oQueVisitar(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaOQueVisitar>,
  ) {
    let lingua = e.lingua ?? null;
    if (!lingua && ctx.conversaId) {
      const [c] = await this.db.query<{ idioma: string | null }>(
        'SELECT idioma FROM conversas WHERE id = $1',
        [ctx.conversaId],
      );
      lingua = linguaDe(c?.idioma);
    }
    const l: Lingua = lingua ?? 'pt';
    const temas = await this.temas(ctx.municipio.id, l);
    const pontos = this.pontosDe(temas);
    if (!pontos.length) {
      return {
        sem_conteudo: true,
        dizer:
          'Ainda não há conteúdo turístico carregado. Procura nas fontes (procurar_conhecimento); se não houver, diz que não tens essa informação confirmada.',
      };
    }
    const interesses: Interesse[] = e.interesses ?? [];
    const pedido: PedidoRoteiro = {
      minutos: e.minutos ?? 180,
      interesses,
      mobilidade_reduzida: !!e.mobilidade_reduzida,
    };
    const r = sugerirRoteiro(pontos, pedido);
    const eventos = await this.eventos(ctx.municipio.slug);
    const conversas = this.svc(ConversasService);
    await conversas
      .momento(ctx.conversaId, 'idioma', { lingua: l, turismo: true })
      .catch(() => undefined);

    const descricao = new Map(pontos.map((p) => [p.chave, p.descricao]));
    const nomes = r.paragens.map((p) => p.nome);
    const fontes = temas
      .filter((t) => t.pontos.some((p) => nomes.includes(p.nome)))
      .map((t) => ({ titulo: t.titulo, url: t.url, entidade: t.entidade }));
    return {
      demonstracao: true,
      lingua: l,
      aviso: AVISO_DEMO,
      roteiro: r.paragens.map((p) => ({
        nome: p.nome,
        minutos: p.minutos,
        chegada_min: p.chegada_min,
        acessibilidade: p.acessibilidade,
        sobre: (descricao.get(p.chave) ?? '').split('\n')[0] || null,
        mapa: linkMapa(p.lat, p.lng),
      })),
      minutos_total: r.minutos_total,
      excluidos_mobilidade: r.excluidos_mobilidade,
      eventos_proximos_dias: eventos.slice(0, 3).map((ev) => ({
        titulo: ev.titulo,
        inicio: ev.inicio,
        onde: ev.rua,
        link: ev.link,
      })),
      fontes,
      link: this.linkVisitar(ctx.municipio.slug, l, pedido),
      dizer:
        (r.paragens.length
          ? `Sugestão de percurso (cerca de ${Math.round(r.minutos_total / 15) * 15} minutos): ${nomes.join(', ')}.`
          : 'Com esse tempo não cabe nenhuma visita completa; sugere um passeio pelo centro histórico.') +
        (eventos.length
          ? ` Nos próximos dias há ${eventos.length === 1 ? 'um evento' : `${eventos.length} eventos`}: ${eventos
              .slice(0, 2)
              .map((x) => x.titulo)
              .join('; ')}.`
          : '') +
        ' Diz na língua da pessoa; os tempos são estimativas de demonstração e horários e preços confirmam-se no local ou no site oficial. O mapa e o roteiro estão no link.',
    };
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  /**
   * Indicador simples: conversas dos últimos 30 dias por língua (a do
   * browser ou da chamada) e quantas usaram as fontes de turismo ou o
   * o_que_visitar.
   */
  async resumo(m: Municipio) {
    const [fontes, linguas] = await Promise.all([
      this.db.query<{ lingua: string; fontes: number; demonstracao: number }>(
        `SELECT lingua, count(*)::int AS fontes,
                count(*) FILTER (WHERE demonstracao)::int AS demonstracao
         FROM fontes WHERE municipio_id = $1 AND tipo = 'turismo'
         GROUP BY lingua ORDER BY lingua`,
        [m.id],
      ),
      this.db.query<{ lingua: string; conversas: number; turismo: number }>(
        `SELECT split_part(lower(coalesce(c.idioma, 'pt')), '-', 1) AS lingua,
                count(*)::int AS conversas,
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM conversa_momentos cm
                  WHERE cm.conversa_id = c.id AND cm.tipo = 'idioma'
                    AND cm.dados->>'turismo' = 'true')
                  OR EXISTS (
                  SELECT 1 FROM conversa_momentos cm
                  CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(cm.dados->'trechos') = 'array'
                         THEN cm.dados->'trechos' ELSE '[]'::jsonb END) AS x(trecho)
                  JOIN trechos t ON t.id::text = x.trecho
                  JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
                  JOIN fontes fo ON fo.id = fv.fonte_id AND fo.tipo = 'turismo'
                  WHERE cm.conversa_id = c.id AND cm.tipo = 'resposta_com_fonte'))::int AS turismo
         FROM conversas c
         WHERE c.municipio_id = $1 AND c.oculto_em IS NULL
           AND c.iniciada_em > now() - interval '30 days'
         GROUP BY 1 ORDER BY 2 DESC`,
        [m.id],
      ),
    ]);
    return {
      fontes,
      total_fontes: fontes.reduce((s, f) => s + f.fontes, 0),
      demonstracao: fontes.some((f) => f.demonstracao > 0),
      conversas_30d: linguas,
      noutra_lingua_30d: linguas
        .filter((x) => x.lingua !== 'pt')
        .reduce((s, x) => s + x.conversas, 0),
      com_turismo_30d: linguas.reduce((s, x) => s + x.turismo, 0),
    };
  }
}
