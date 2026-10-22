import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa, somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { mascararTelefone } from '../municipes/municipes.service.js';
import { zonaDe } from '../ordenamento/regras.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { PREFIXO_DEMONSTRACAO } from './projeto-demonstracao-pdf.js';
import { HASH_PROCESSO, HASH_REGULAMENTO } from './apoio.js';
import { avisoPedido, PRAZO_PEDIDO_DIAS_UTEIS } from './avisos.js';
import { dadosComRotulos, Dados } from './formulario.js';
import { ProcessosAvisosService } from './processos-avisos.service.js';
import { ProcessosService } from './processos.service.js';
import {
  Fase,
  FASE_ROTULO,
  FASES,
  FASES_FECHADAS,
  limiteATerminar,
  mascararNome,
} from './regras.js';
import { TiposProcessoService } from './tipos-processo.service.js';

const verdadeiro = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/** Filtros comuns à lista e ao resumo (totais por separador). */
const filtrosProcessos = {
  fase: z.enum(FASES).optional(),
  texto: z.string().trim().min(1).max(100).optional(),
  tipo_processo_id: z.guid().optional(),
  /** O serviço do tipo de processo. */
  servico_id: z.guid().optional(),
  freguesia: z.string().trim().min(1).max(120).optional(),
};

export const esquemaResumoProcessos = z.object(filtrosProcessos);

export const esquemaListaProcessos = esquemaPaginacao.extend({
  ...filtrosProcessos,
  /** Abertos com o prazo nos próximos DIAS_A_TERMINAR dias úteis. */
  a_terminar: verdadeiro,
  /** 'eu' = os meus. */
  tecnico_id: z.union([z.uuid(), z.literal('eu')]).optional(),
  atrasados: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Em 'documentos' ou com um pedido ao munícipe por responder. */
  aguarda_municipe: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const esquemaAtualizarProcesso = z
  .object({
    fase: z.enum(FASES).optional(),
    tecnico_id: z.uuid().nullable().optional(),
    decisao: z.enum(['admitido', 'indeferido']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nada para alterar.' });

export const esquemaNota = z.object({
  descricao: z.string().trim().min(1).max(4000),
  interno: z.boolean().default(true),
});

export const esquemaPedirDocumento = z
  .object({
    tipo_documento_id: z.uuid().optional(),
    nome: z.string().trim().min(2).max(200).optional(),
    nota: z.string().trim().max(500).optional(),
    /** Prazo do munícipe para responder; por omissão 10 dias úteis (CPA). */
    prazo_dias_uteis: z
      .number()
      .int()
      .min(1)
      .max(120)
      .default(PRAZO_PEDIDO_DIAS_UTEIS),
  })
  .refine((b) => b.tipo_documento_id || b.nome, {
    message: 'Indique o documento (tipo_documento_id ou nome).',
  });

interface LinhaProcesso {
  id: string;
  numero: string;
  tipo_processo_id: string;
  tipo_codigo: string;
  tipo_nome: string;
  prazo_dias_uteis: number;
  assunto: string;
  morada: string | null;
  freguesia: string | null;
  fase: Fase;
  decisao: string | null;
  decidido_em: Date | null;
  tecnico_id: string | null;
  tecnico_nome: string | null;
  municipe_id: string | null;
  municipe_nome: string | null;
  prazo_inicio: string | null;
  prazo_fim: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS_PROCESSO = `
  p.id, p.numero, p.tipo_processo_id, t.codigo AS tipo_codigo, t.nome AS tipo_nome,
         t.prazo_dias_uteis, p.assunto, p.morada, p.freguesia, p.fase, p.decisao, p.decidido_em,
         p.tecnico_id, u.nome AS tecnico_nome, p.municipe_id, mu.nome AS municipe_nome,
         to_char(p.prazo_inicio, 'YYYY-MM-DD') AS prazo_inicio,
         to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim,
         p.criado_em, p.atualizado_em`;

const DE_PROCESSO = `
  FROM processos p
  JOIN tipos_processo t ON t.id = p.tipo_processo_id
  LEFT JOIN utilizadores u ON u.id = p.tecnico_id
  LEFT JOIN municipes mu ON mu.id = p.municipe_id`;

const SELECT_PROCESSO = `SELECT ${COLUNAS_PROCESSO} ${DE_PROCESSO}`;

/** O prazo mais próximo dos pedidos ao munícipe ainda por responder. */
const PRAZO_MUNICIPE = `(
  SELECT to_char(min(pe.prazo), 'YYYY-MM-DD') FROM processo_pedidos_estado pe
  WHERE pe.processo_id = p.id AND pe.respondido_em IS NULL)`;

/** Os documentos obrigatórios (os que o munícipe entrega) e quantos já há válidos. */
const DOCUMENTOS_CONTAGEM = `(
  SELECT json_build_object(
    'exigidos', count(*)::int,
    'entregues', (count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM documentos x
      WHERE x.tipo_documento_id = d.id AND x.processo_id = p.id
        AND x.verificacao_estado NOT IN ('documento_errado', 'ilegivel', 'fora_de_prazo'))))::int)
  FROM tipo_processo_documentos d
  WHERE d.tipo_processo_id = p.tipo_processo_id
    AND d.obrigatorio AND NOT d.gerado_pelo_sistema)`;

/** Aberto: nem notificado nem arquivado. */
const ABERTO = `p.fase NOT IN ('notificado', 'arquivado')`;

/** À espera do munícipe: em 'documentos' ou com um pedido por responder. */
const AGUARDA_MUNICIPE = `(${ABERTO} AND (p.fase = 'documentos' OR ${PRAZO_MUNICIPE} IS NOT NULL))`;

/**
 * Filtros comuns (lista e resumo), com os parâmetros a partir de `$n`:
 * município, fase, texto, tipo, serviço e freguesia (6 parâmetros).
 */
function filtrosSql(n: number): string {
  const $ = (i: number) => `$${n + i}`;
  return `p.municipio_id = ${$(0)}
         AND (${$(1)}::fase_processo IS NULL OR p.fase = ${$(1)})
         AND (${$(2)}::text IS NULL OR p.numero ILIKE '%' || ${$(2)} || '%' OR p.assunto ILIKE '%' || ${$(2)} || '%'
              OR p.morada ILIKE '%' || ${$(2)} || '%'
              OR EXISTS (SELECT 1 FROM municipes mu WHERE mu.id = p.municipe_id
                         AND mu.nome ILIKE '%' || ${$(2)} || '%'))
         AND (${$(3)}::uuid IS NULL OR p.tipo_processo_id = ${$(3)})
         AND (${$(4)}::uuid IS NULL OR t.servico_id = ${$(4)})
         AND (${$(5)}::text IS NULL OR lower(p.freguesia) = lower(${$(5)}))`;
}

function paramsFiltros(
  municipio: Municipio,
  f: z.output<typeof esquemaResumoProcessos>,
): unknown[] {
  return [
    municipio.id,
    f.fase ?? null,
    f.texto ?? null,
    f.tipo_processo_id ?? null,
    f.servico_id ?? null,
    f.freguesia ?? null,
  ];
}

/** O back-office dos processos (secção 5.7): lista, ficha e ações do técnico. */
@Injectable()
export class ProcessosPainelService {
  private readonly logger = new Logger(ProcessosPainelService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly processos: ProcessosService,
    private readonly tipos: TiposProcessoService,
    private readonly municipios: MunicipiosService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly mensagens: MensagensService,
    private readonly avisos: ProcessosAvisosService,
  ) {}

  /**
   * Ordenada por prazo (o mais urgente primeiro; sem prazo no fim). O cursor
   * leva o prazo ('infinity' sem prazo) e o id.
   */
  async listar(
    municipio: Municipio,
    u: UtilizadorPainel,
    f: z.output<typeof esquemaListaProcessos>,
  ) {
    const tecnico = f.tecnico_id === 'eu' ? u.id : (f.tecnico_id ?? null);
    const ordem = `coalesce(p.prazo_fim, 'infinity'::date)`;
    const hoje = hojeLisboa();
    const limite = f.a_terminar
      ? limiteATerminar(hoje, await this.municipios.feriados(municipio.id))
      : null;
    const linhas = await this.db.query<
      LinhaProcesso & {
        prazo_municipe: string | null;
        documentos: { entregues: number; exigidos: number };
      }
    >(
      `SELECT ${COLUNAS_PROCESSO}, ${PRAZO_MUNICIPE} AS prazo_municipe,
              ${DOCUMENTOS_CONTAGEM} AS documentos
       ${DE_PROCESSO}
       WHERE ${filtrosSql(1)}
         AND ($7::uuid IS NULL OR p.tecnico_id = $7)
         AND (NOT $8::boolean OR (p.prazo_fim < $9::date AND ${ABERTO}))
         AND (NOT $10::boolean OR ${AGUARDA_MUNICIPE})
         AND ($11::date IS NULL OR (${ABERTO} AND p.prazo_fim BETWEEN $9::date AND $11::date))
         AND ($12::date IS NULL OR (${ordem}, p.id) > ($12::date, $13::uuid))
       ORDER BY ${ordem}, p.id
       LIMIT $14`,
      [
        ...paramsFiltros(municipio, f),
        tecnico,
        f.atrasados ?? false,
        hoje,
        f.aguarda_municipe ?? false,
        limite,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    const r = pagina(linhas, f.limite, (l) => ({
      em: l.prazo_fim ?? 'infinity',
      id: l.id,
    }));
    return {
      itens: await Promise.all(
        r.itens.map(async (l) => ({
          id: l.id,
          numero: l.numero,
          tipo: { codigo: l.tipo_codigo, nome: l.tipo_nome },
          assunto: l.assunto,
          morada: l.morada,
          fase: l.fase,
          fase_rotulo: FASE_ROTULO[l.fase],
          decisao: l.decisao,
          tecnico: l.tecnico_id
            ? { id: l.tecnico_id, nome: l.tecnico_nome }
            : null,
          municipe: mascararNome(l.municipe_nome),
          prazo_fim: l.prazo_fim,
          dias_uteis_restantes: await this.processos.diasRestantes(
            municipio.id,
            l.prazo_fim,
            l.fase,
          ),
          atrasado:
            !!l.prazo_fim &&
            l.prazo_fim < hoje &&
            !FASES_FECHADAS.includes(l.fase),
          aguarda_municipe:
            !FASES_FECHADAS.includes(l.fase) &&
            (l.fase === 'documentos' || l.prazo_municipe !== null),
          prazo_municipe: l.prazo_municipe,
          // Documentos obrigatórios entregues (válidos) de quantos exigidos.
          documentos: l.documentos,
          freguesia: l.freguesia,
          criado_em: l.criado_em,
        })),
      ),
      proximo_cursor: r.proximo_cursor,
    };
  }

  /**
   * Totais por separador da lista, com os mesmos filtros (fase, texto, tipo,
   * serviço, freguesia): todos, os meus, atrasados, à espera do munícipe e a
   * terminar (abertos com prazo nos próximos DIAS_A_TERMINAR dias úteis).
   */
  async resumo(
    municipio: Municipio,
    u: UtilizadorPainel,
    f: z.output<typeof esquemaResumoProcessos>,
  ) {
    const hoje = hojeLisboa();
    const limite = limiteATerminar(
      hoje,
      await this.municipios.feriados(municipio.id),
    );
    const [r] = await this.db.query<{
      todos: number;
      meus: number;
      atrasados: number;
      aguarda_municipe: number;
      a_terminar: number;
    }>(
      `SELECT count(*)::int AS todos,
              count(*) FILTER (WHERE p.tecnico_id = $7)::int AS meus,
              count(*) FILTER (WHERE p.prazo_fim < $8::date AND ${ABERTO})::int AS atrasados,
              count(*) FILTER (WHERE ${AGUARDA_MUNICIPE})::int AS aguarda_municipe,
              count(*) FILTER (WHERE ${ABERTO} AND p.prazo_fim BETWEEN $8::date AND $9::date)::int AS a_terminar
       FROM processos p
       JOIN tipos_processo t ON t.id = p.tipo_processo_id
       WHERE ${filtrosSql(1)}`,
      [...paramsFiltros(municipio, f), u.id, hoje, limite],
    );
    // As freguesias com processos (para o filtro), sem os outros filtros.
    const freguesias = await this.db.query<{ freguesia: string }>(
      `SELECT DISTINCT freguesia FROM processos
       WHERE municipio_id = $1 AND freguesia IS NOT NULL ORDER BY freguesia LIMIT 100`,
      [municipio.id],
    );
    return {
      ...r,
      a_terminar_ate: limite,
      freguesias: freguesias.map((x) => x.freguesia),
    };
  }

  private async zonaPdm(
    municipioId: string,
    lat: number | null,
    lng: number | null,
  ) {
    if (lat === null || lng === null) return null;
    const zonas = await this.db.query<{
      codigo: string;
      nome: string;
      categoria: string;
      demonstracao: boolean;
      poligono: [number, number][];
    }>(
      `SELECT codigo, nome, categoria, demonstracao, poligono FROM zonas_pdm WHERE municipio_id = $1`,
      [municipioId],
    );
    const z = zonaDe([lat, lng], zonas);
    return z
      ? {
          codigo: z.codigo,
          nome: z.nome,
          categoria: z.categoria,
          demonstracao: z.demonstracao,
        }
      : null;
  }

  async carregar(
    municipioId: string,
    id: string,
    q: Pick<Tx, 'query'> = this.db,
    bloquear = false,
  ) {
    const [p] = await q.query<LinhaProcesso>(
      `${SELECT_PROCESSO} WHERE p.id = $1 AND p.municipio_id = $2 ${bloquear ? 'FOR UPDATE OF p' : ''}`,
      [id, municipioId],
    );
    if (!p)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Processo não existe.',
      );
    return p;
  }

  /** A ficha completa (eventos internos incluídos). */
  async detalhe(municipio: Municipio, id: string) {
    const p = await this.carregar(municipio.id, id);
    const [
      eventos,
      documentos,
      docs,
      dias,
      requerimentos,
      municipe,
      tipo,
      pedidos,
      apoio,
      [extra],
    ] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        `SELECT e.id, e.tipo, e.descricao, e.interno, e.ator_tipo, e.ator_id,
                u.nome AS ator_nome, e.dados, e.em
         FROM processo_eventos e
         LEFT JOIN utilizadores u ON e.ator_tipo = 'utilizador' AND u.id = e.ator_id
         WHERE e.processo_id = $1 ORDER BY e.em, e.id`,
        [id],
      ),
      this.db.query<{
        id: string;
        tipo_documento_id: string | null;
        tipo_documento: string | null;
        ficheiro_key: string;
        mime: string;
        tamanho: number | null;
        origem: string;
        verificacao_estado: string;
        verificacao: unknown;
        emitido_em: string | null;
        recebido_em: Date;
      }>(
        `SELECT d.id, d.tipo_documento_id, coalesce(td.nome, d.descricao) AS tipo_documento,
                d.ficheiro_key, d.mime, d.tamanho,
                d.origem, d.verificacao_estado, d.verificacao,
                to_char(d.emitido_em, 'YYYY-MM-DD') AS emitido_em, d.recebido_em
         FROM documentos d
         LEFT JOIN tipo_processo_documentos td ON td.id = d.tipo_documento_id
         WHERE d.processo_id = $1 ORDER BY d.recebido_em`,
        [id],
      ),
      this.processos.emFalta(p),
      this.processos.diasRestantes(municipio.id, p.prazo_fim, p.fase),
      this.db.query<{
        id: string;
        estado: string;
        dados: Dados;
        assinatura: string | null;
        assinado_em: Date | null;
        pdf_key: string | null;
        conversa_id: string | null;
        criado_em: Date;
      }>(
        `SELECT id, estado, dados, assinatura, assinado_em, pdf_key, conversa_id, criado_em
         FROM requerimentos WHERE processo_id = $1 ORDER BY criado_em`,
        [id],
      ),
      p.municipe_id
        ? this.db.query<{
            nome: string | null;
            telefone_e164: string | null;
            email: string | null;
            tem_nif: boolean;
            canal_preferido: string | null;
            conversas: number;
          }>(
            `SELECT nome, telefone_e164, email, nif_hash IS NOT NULL AS tem_nif, canal_preferido,
                    (SELECT count(*)::int FROM conversas c WHERE c.municipe_id = municipes.id) AS conversas
             FROM municipes WHERE id = $1`,
            [p.municipe_id],
          )
        : Promise.resolve([]),
      this.tipos.porId(municipio.id, p.tipo_processo_id),
      this.processos.pedidos(municipio.id, id),
      this.estadoApoio(id),
      this.db.query<{
        lat: number | null;
        lng: number | null;
        demonstracao: boolean;
        gd_estado: string;
        gd_tentativas: number;
        gd_id: string | null;
        ultimo_erro: string | null;
        ultimo_erro_em: Date | null;
      }>(
        `SELECT p.lat, p.lng, p.demonstracao, p.gd_estado, p.gd_tentativas, p.gd_id, s.ultimo_erro,
                s.ultimo_erro_em
         FROM processos p LEFT JOIN gd_sincronizacoes s ON s.processo_id = p.id
         WHERE p.id = $1`,
        [id],
      ),
    ]);

    const urlLeitura = async (chave: string | null) =>
      chave && this.armazenamento.disponivel
        ? this.armazenamento.urlLeitura(chave, 10)
        : null;
    const [req] = requerimentos;
    const m = municipe[0];

    return {
      id: p.id,
      numero: p.numero,
      tipo: {
        id: p.tipo_processo_id,
        codigo: p.tipo_codigo,
        nome: p.tipo_nome,
        prazo_dias_uteis: p.prazo_dias_uteis,
      },
      assunto: p.assunto,
      morada: p.morada,
      freguesia: p.freguesia,
      lat: extra?.lat ?? null,
      lng: extra?.lng ?? null,
      // Processo de demonstração (dados fictícios, POST painel/processos/demonstracao).
      demonstracao: extra?.demonstracao ?? false,
      fase: p.fase,
      fase_rotulo: FASE_ROTULO[p.fase],
      decisao: p.decisao,
      decidido_em: p.decidido_em,
      // Sincronização com a gestão documental (V2): nao_aplicavel |
      // por_sincronizar | sincronizado | erro.
      gestao_documental: {
        estado: extra?.gd_estado ?? 'nao_aplicavel',
        tentativas: extra?.gd_tentativas ?? 0,
        gd_id: extra?.gd_id ?? null,
        ultimo_erro: extra?.ultimo_erro ?? null,
        ultimo_erro_em: extra?.ultimo_erro_em ?? null,
      },
      tecnico: p.tecnico_id ? { id: p.tecnico_id, nome: p.tecnico_nome } : null,
      prazo: {
        inicio: p.prazo_inicio,
        fim: p.prazo_fim,
        dias_uteis_restantes: dias,
        atrasado: dias !== null && dias < 0,
      },
      municipe: m
        ? {
            id: p.municipe_id,
            nome: mascararNome(m.nome),
            telefone: m.telefone_e164
              ? mascararTelefone(m.telefone_e164)
              : null,
            tem_email: !!m.email,
            tem_nif: m.tem_nif,
            canal_preferido: m.canal_preferido,
            conversas: m.conversas,
          }
        : null,
      // A zona do PDM onde fica a morada (se houver zonas carregadas).
      zona_pdm: await this.zonaPdm(
        municipio.id,
        extra?.lat ?? null,
        extra?.lng ?? null,
      ),
      requerimento: req
        ? {
            id: req.id,
            estado: req.estado,
            conversa_id: req.conversa_id,
            dados: dadosComRotulos(tipo.formulario, req.dados),
            assinatura: req.assinatura,
            assinatura_simulada: req.assinatura === 'simulada',
            assinado_em: req.assinado_em,
            pdf_url: await urlLeitura(req.pdf_key),
            criado_em: req.criado_em,
          }
        : null,
      documentos: await Promise.all(
        documentos.map(async ({ ficheiro_key, ...d }) => ({
          ...d,
          // Os de demonstração não estão no armazenamento: abrem-se pela API.
          url: ficheiro_key.startsWith(PREFIXO_DEMONSTRACAO)
            ? null
            : await urlLeitura(ficheiro_key),
        })),
      ),
      documentos_resumo: docs,
      // Pedidos ao munícipe: prazo, estado (por_responder | respondido |
      // fora_de_prazo), dias úteis que faltam e se já levou lembrete.
      pedidos,
      armazenamento_disponivel: this.armazenamento.disponivel,
      eventos,
      // Resumo, regulamento destacado e rascunhos: se existem e se o resumo
      // em cache ainda corresponde ao processo. Não gera nada.
      apoio,
      criado_em: p.criado_em,
      atualizado_em: p.atualizado_em,
    };
  }

  /** O que há de apoio ao técnico para o processo (só leitura, sem IA). */
  async estadoApoio(processoId: string) {
    const [r] = await this.db.query<{
      resumo: { gerado_em: string; atualizado: boolean } | null;
      regulamento: { gerado_em: string; atualizado: boolean } | null;
      rascunhos: {
        total: number;
        rascunho: number;
        aprovado: number;
        descartado: number;
      };
    }>(
      `SELECT
         (SELECT json_build_object('gerado_em', ap.gerado_em, 'atualizado', ap.estado_hash = ${HASH_PROCESSO})
          FROM processo_apoio ap WHERE ap.processo_id = p.id AND ap.tipo = 'resumo') AS resumo,
         (SELECT json_build_object('gerado_em', ap.gerado_em, 'atualizado', ap.estado_hash = ${HASH_REGULAMENTO})
          FROM processo_apoio ap WHERE ap.processo_id = p.id AND ap.tipo = 'regulamento') AS regulamento,
         (SELECT json_build_object(
            'total', count(*),
            'rascunho', count(*) FILTER (WHERE g.estado = 'rascunho'),
            'aprovado', count(*) FILTER (WHERE g.estado IN ('aprovado', 'assinado', 'enviado')),
            'descartado', count(*) FILTER (WHERE g.estado = 'descartado'))
          FROM documentos_gerados g WHERE g.processo_id = p.id) AS rascunhos
       FROM processos p WHERE p.id = $1`,
      [processoId],
    );
    return r;
  }

  async evento(
    tx: Tx,
    processoId: string,
    u: UtilizadorPainel,
    tipo: string,
    descricao: string,
    interno: boolean,
    dados: Record<string, unknown> = {},
  ): Promise<{ id: string; em: Date }> {
    const [e] = await tx.query<{ id: string; em: Date }>(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, interno, dados)
       VALUES ($1, $2, $3, 'utilizador', $4, $5, $6) RETURNING id, em`,
      [processoId, tipo, descricao, u.id, interno, JSON.stringify(dados)],
    );
    return e;
  }

  /**
   * Fase, técnico e decisão. Cada mudança fica na linha do tempo; a decisão,
   * ao chegar a 'decisao'/'notificado', vai por SMS ao munícipe (uma vez por
   * decisão). Sair de 'documentos' com o prazo por começar começa-o hoje.
   * Entrar numa fase que o munícipe percebe (documentos, apreciação,
   * pareceres externos) avisa-o uma vez por fase (ProcessosAvisosService).
   * Mudar de técnico ou escrever notas não avisa ninguém.
   */
  async atualizar(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaAtualizarProcesso>,
  ) {
    // Atribuída dentro da transação (o TS não segue a atribuição no callback).
    let novaFase = null as Fase | null;
    await this.db.transaction(async (tx) => {
      const p = await this.carregar(municipio.id, id, tx, true);

      if (b.tecnico_id !== undefined && b.tecnico_id !== p.tecnico_id) {
        let nome: string | null = null;
        if (b.tecnico_id) {
          const [t] = await tx.query<{ nome: string }>(
            `SELECT nome FROM utilizadores
             WHERE id = $1 AND ativo AND (municipio_id = $2 OR municipio_id IS NULL)`,
            [b.tecnico_id, municipio.id],
          );
          if (!t) {
            throw new ErroApi(
              HttpStatus.BAD_REQUEST,
              'tecnico_invalido',
              'Esse técnico não existe nesta câmara.',
            );
          }
          nome = t.nome;
        }
        await tx.query('UPDATE processos SET tecnico_id = $2 WHERE id = $1', [
          id,
          b.tecnico_id,
        ]);
        await this.evento(
          tx,
          id,
          u,
          'atribuido',
          nome ? `Atribuído a ${nome}.` : 'Sem técnico atribuído.',
          true,
          {
            de: p.tecnico_id,
            para: b.tecnico_id,
          },
        );
        await this.auditoria.registar(
          {
            municipioId: municipio.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'reatribuir',
            objetoTipo: 'processo',
            objetoId: id,
            dados: { de: p.tecnico_id, para: b.tecnico_id },
          },
          tx,
        );
      }

      const fase = b.fase ?? p.fase;
      if (b.fase && b.fase !== p.fase) {
        novaFase = b.fase;
        await tx.query('UPDATE processos SET fase = $2 WHERE id = $1', [
          id,
          b.fase,
        ]);
        await this.evento(
          tx,
          id,
          u,
          'fase',
          `Fase: ${FASE_ROTULO[p.fase]} → ${FASE_ROTULO[b.fase]}.`,
          false,
          {
            de: p.fase,
            para: b.fase,
          },
        );
        // O prazo conta com o processo completo: começa quando sai de 'documentos'.
        if (!p.prazo_inicio && !['documentos', 'arquivado'].includes(b.fase)) {
          const hoje = hojeLisboa();
          const fim = somarDiasUteis(
            hoje,
            p.prazo_dias_uteis,
            await this.municipios.feriados(municipio.id),
          );
          await tx.query(
            'UPDATE processos SET prazo_inicio = $2, prazo_fim = $3 WHERE id = $1',
            [id, hoje, fim],
          );
          await this.evento(
            tx,
            id,
            u,
            'prazo',
            `Processo completo: o prazo de resposta termina a ${fim.split('-').reverse().join('/')}.`,
            false,
            {
              prazo_inicio: hoje,
              prazo_fim: fim,
            },
          );
        }
      }

      const decisao = b.decisao ?? p.decisao;
      if (b.decisao && b.decisao !== p.decisao) {
        await tx.query(
          'UPDATE processos SET decisao = $2, decidido_em = now() WHERE id = $1',
          [id, b.decisao],
        );
        await this.evento(
          tx,
          id,
          u,
          'decisao',
          `Decisão: ${b.decisao}.`,
          true,
          { decisao: b.decisao },
        );
        await this.auditoria.registar(
          {
            municipioId: municipio.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'decidir',
            objetoTipo: 'processo',
            objetoId: id,
            dados: { decisao: b.decisao },
          },
          tx,
        );
      }
      await tx.query(
        'UPDATE processos SET atualizado_em = now() WHERE id = $1',
        [id],
      );

      if (decisao && (fase === 'decisao' || fase === 'notificado')) {
        await this.smsDecisao(tx, municipio, p, decisao);
      }
    });
    // Depois do COMMIT: o prazo novo já está gravado e uma falha no aviso
    // não desfaz a mudança de fase.
    if (novaFase) {
      try {
        await this.avisos.avisarFase(municipio, id, novaFase);
      } catch (e) {
        this.logger.warn(
          `Processo ${id}: aviso da fase ${novaFase} falhou: ${(e as Error).message}`,
        );
      }
    }
    return this.detalhe(municipio, id);
  }

  private async smsDecisao(
    tx: Tx,
    municipio: Municipio,
    p: LinhaProcesso,
    decisao: string,
  ) {
    const telefone = await this.processos.telefoneDe(p.municipe_id, tx);
    if (!telefone) {
      this.logger.warn(
        `Processo ${p.numero}: decisão sem telefone para avisar.`,
      );
      return;
    }
    const link = await this.processos.linkProcesso(municipio.id, p.id, tx);
    await this.mensagens.sms(
      {
        municipioId: municipio.id,
        municipeId: p.municipe_id,
        destino: telefone,
        motivo: 'processo',
        corpo:
          `${municipio.nome}: há decisão no processo ${p.numero}: ` +
          `${decisao === 'admitido' ? 'admitido' : 'indeferido'}. Veja os detalhes aqui: ${link}`,
        relacionado: { processo_id: p.id },
        chave: `processo_decisao:${p.id}:${decisao}`,
      },
      tx,
    );
  }

  async nota(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaNota>,
  ) {
    return this.db.transaction(async (tx) => {
      await this.carregar(municipio.id, id, tx);
      const e = await this.evento(
        tx,
        id,
        u,
        b.interno ? 'nota_interna' : 'nota',
        b.descricao,
        b.interno,
      );
      await tx.query(
        'UPDATE processos SET atualizado_em = now() WHERE id = $1',
        [id],
      );
      return { id: e.id, em: e.em, interno: b.interno };
    });
  }

  /**
   * Evento visível 'documento_pedido', o pedido com o prazo do munícipe
   * (`processo_pedidos`, por omissão PRAZO_PEDIDO_DIAS_UTEIS dias úteis) e o
   * aviso com o prazo e o link do processo (SMS, ou email se o preferir).
   */
  async pedirDocumento(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaPedirDocumento>,
  ) {
    return this.db.transaction(async (tx) => {
      const p = await this.carregar(municipio.id, id, tx, true);
      const r = await this.registarPedido(tx, municipio, u, p, b);
      const canal = await this.avisarPedido(tx, municipio, p, {
        nome: r.nome,
        nota: b.nota ?? null,
        prazo: r.prazo,
        chave: `processo_pedido:${r.evento_id}`,
        pedidoId: r.pedido_id,
      });
      return {
        evento_id: r.evento_id,
        em: r.em,
        pedido_id: r.pedido_id,
        prazo: r.prazo,
        aviso: canal,
        sms_enviado: canal === 'sms',
      };
    });
  }

  /**
   * O pedido sem o aviso, dentro da transação de quem chama (com o processo
   * já bloqueado): evento visível 'documento_pedido' e linha em
   * `processo_pedidos`. Também o usa a aprovação de um pedido de elementos,
   * que avisa uma só vez por todos os documentos.
   */
  async registarPedido(
    tx: Tx,
    municipio: Municipio,
    u: UtilizadorPainel,
    p: { id: string; tipo_processo_id: string },
    b: {
      tipo_documento_id?: string;
      nome?: string;
      nota?: string;
      prazo_dias_uteis: number;
    },
  ) {
    const id = p.id;
    let nome = b.nome ?? null;
    if (b.tipo_documento_id) {
      const [d] = await tx.query<{ nome: string }>(
        'SELECT nome FROM tipo_processo_documentos WHERE id = $1 AND tipo_processo_id = $2',
        [b.tipo_documento_id, p.tipo_processo_id],
      );
      if (!d) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'documento_desconhecido',
          'Esse documento não é deste tipo de processo.',
        );
      }
      nome = nome ?? d.nome;
    }
    const descricao = nome!;
    const prazo = somarDiasUteis(
      hojeLisboa(),
      b.prazo_dias_uteis,
      await this.municipios.feriados(municipio.id),
    );
    const e = await this.evento(
      tx,
      id,
      u,
      'documento_pedido',
      `Pedido ao munícipe: ${descricao}${b.nota ? ` (${b.nota})` : ''}, até ${prazo.split('-').reverse().join('/')}.`,
      false,
      {
        nome: descricao,
        tipo_documento_id: b.tipo_documento_id ?? null,
        nota: b.nota ?? null,
        prazo,
      },
    );
    const [pedido] = await tx.query<{ id: string }>(
      `INSERT INTO processo_pedidos (processo_id, evento_id, descricao, tipo_documento_id, nota,
         pedido_em, prazo, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        id,
        e.id,
        descricao,
        b.tipo_documento_id ?? null,
        b.nota ?? null,
        e.em,
        prazo,
        u.id,
      ],
    );
    await tx.query('UPDATE processos SET atualizado_em = now() WHERE id = $1', [
      id,
    ]);
    return {
      evento_id: e.id,
      em: e.em,
      pedido_id: pedido.id,
      nome: descricao,
      prazo,
    };
  }

  /** O aviso do pedido (SMS, ou email se o munícipe o preferir), com o prazo e o link. */
  async avisarPedido(
    tx: Tx,
    municipio: Municipio,
    p: { id: string; numero: string; municipe_id: string | null },
    a: {
      nome: string;
      nota: string | null;
      prazo: string;
      chave: string;
      pedidoId: string;
    },
  ) {
    const link = await this.processos.linkProcesso(municipio.id, p.id, tx);
    return this.avisos.enviar(tx, {
      municipioId: municipio.id,
      municipeId: p.municipe_id,
      aviso: avisoPedido({
        municipio: municipio.nome,
        numero: p.numero,
        link,
        nome: a.nome,
        nota: a.nota,
        prazo: a.prazo,
      }),
      motivo: 'processo',
      chave: a.chave,
      relacionado: { processo_id: p.id, pedido_id: a.pedidoId },
    });
  }
}
