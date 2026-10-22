import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { esquemaVerificacao } from '../requerimentos/verificacao-documentos.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { Formulario, lerFormulario } from './formulario.js';
import { CandidatoTipo, DocumentoExigido, escolherTipo } from './regras.js';

export interface TipoProcesso {
  id: string;
  codigo: string;
  nome: string;
  prazo_dias_uteis: number;
  frase_do_agente: string | null;
  ativo: boolean;
  formulario: Formulario;
}

export interface TipoDocumento {
  id: string;
  nome: string;
  obrigatorio: boolean;
  ordem: number;
  gerado_pelo_sistema: boolean;
}

const camposTipo = {
  nome: z.string().trim().min(3).max(160),
  prazo_dias_uteis: z.number().int().min(1).max(365),
  servico_id: z.uuid().nullable().optional(),
  frase_do_agente: z.string().trim().max(500).nullable().optional(),
};

export const esquemaTipoNovo = z.object({
  codigo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, 'Código de 2 a 6 letras (ex.: CP).'),
  ...camposTipo,
});

export const esquemaTipoAlterar = z
  .object({
    ...camposTipo,
    nome: camposTipo.nome.optional(),
    prazo_dias_uteis: camposTipo.prazo_dias_uteis.optional(),
    ativo: z.boolean().optional(),
  })
  .refine((a) => Object.keys(a).length > 0, 'Nada para alterar.');

export const esquemaDocumentoTipo = z.object({
  nome: z.string().trim().min(3).max(200),
  obrigatorio: z.boolean().default(true),
  verificacoes: z.array(esquemaVerificacao).max(5).default([]),
  gerado_pelo_sistema: z.boolean().default(false),
});

export const esquemaDocumentoAlterar = esquemaDocumentoTipo
  .partial()
  .refine((a) => Object.keys(a).length > 0, 'Nada para alterar.');

/** Onde procurar os documentos já entregues: o requerimento e/ou o processo. */
export interface AlvoDocumentos {
  requerimentoId?: string | null;
  processoId?: string | null;
}

type Q = Pick<Tx, 'query'>;

const COLUNAS = `id, codigo, nome, prazo_dias_uteis, frase_do_agente, ativo, formulario`;

/*
 * O que a pessoa diz ("obras de alteração", "abrir uma porta") contra o nome
 * e a frase de cada tipo: lexemas em OU (como no conhecimento) mais
 * trigramas do nome, que apanham palavras cortadas e erros da transcrição.
 */
const PESQUISA = `
  WITH c AS (
    SELECT string_agg(DISTINCT quote_literal(lexeme), ' | ')::tsquery AS q
    FROM unnest(to_tsvector('pt_unaccent', $2))
  )
  SELECT t.id, t.codigo, t.nome,
         (coalesce(ts_rank_cd(to_tsvector('pt_unaccent', t.nome || ' ' || coalesce(t.frase_do_agente, '')), c.q, 32), 0)
          + similarity(unaccent(lower(t.nome)), unaccent(lower($2))))::float8 AS pontuacao
  FROM tipos_processo t, c
  WHERE t.municipio_id = $1 AND t.ativo
  ORDER BY pontuacao DESC, t.codigo
  LIMIT 8`;

/** Tipos de processo (formulário + documentos exigidos) de cada município. */
@Injectable()
export class TiposProcessoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private ler(
    linha: Omit<TipoProcesso, 'formulario'> & { formulario: unknown },
  ): TipoProcesso {
    return {
      ...linha,
      formulario: lerFormulario(linha.formulario, linha.codigo),
    };
  }

  async porId(municipioId: string, id: string, tx?: Tx): Promise<TipoProcesso> {
    const [t] = await (tx ?? this.db).query<TipoProcesso>(
      `SELECT ${COLUNAS} FROM tipos_processo WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId],
    );
    if (!t) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'tipo_processo_desconhecido',
        'Tipo de processo não existe.',
      );
    }
    return this.ler(t);
  }

  /**
   * 'CP' (código exato) ou uma descrição livre → o tipo, ou as opções para o
   * agente perguntar se for ambíguo. Sem nada parecido → todos os ativos.
   */
  async resolver(
    municipioId: string,
    texto: string,
  ): Promise<
    { tipo: TipoProcesso } | { opcoes: { codigo: string; nome: string }[] }
  > {
    const [exato] = await this.db.query<TipoProcesso>(
      `SELECT ${COLUNAS} FROM tipos_processo
       WHERE municipio_id = $1 AND ativo AND upper(codigo) = upper($2)`,
      [municipioId, texto.trim()],
    );
    if (exato) return { tipo: this.ler(exato) };

    const candidatos = await this.db.query<CandidatoTipo>(PESQUISA, [
      municipioId,
      texto,
    ]);
    const r = escolherTipo(candidatos);
    if ('tipo' in r) return { tipo: await this.porId(municipioId, r.tipo.id) };
    const opcoes = r.opcoes.length ? r.opcoes : candidatos;
    return { opcoes: opcoes.map((c) => ({ codigo: c.codigo, nome: c.nome })) };
  }

  /** Para o painel: todos, com formulário e documentos. */
  async listar(municipioId: string) {
    const linhas = await this.db.query<
      TipoProcesso & { formulario: unknown; documentos: TipoDocumento[] }
    >(
      `SELECT t.id, t.codigo, t.nome, t.prazo_dias_uteis, t.frase_do_agente, t.ativo,
              t.formulario, s.nome AS servico, t.servico_id,
              (SELECT count(*)::int FROM processos p WHERE p.tipo_processo_id = t.id
                 AND p.criado_em >= date_trunc('year', now())) AS usado_este_ano,
              coalesce((
                SELECT jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome,
                         'obrigatorio', d.obrigatorio, 'ordem', d.ordem,
                         'gerado_pelo_sistema', d.gerado_pelo_sistema,
                         'verificacoes', d.verificacoes) ORDER BY d.ordem)
                FROM tipo_processo_documentos d WHERE d.tipo_processo_id = t.id
              ), '[]') AS documentos
       FROM tipos_processo t
       LEFT JOIN servicos s ON s.id = t.servico_id
       WHERE t.municipio_id = $1
       ORDER BY t.ativo DESC, t.codigo`,
      [municipioId],
    );
    return linhas.map((l) => this.ler(l));
  }

  // ------------------------------------------------------------------
  // Edição (V2 · Tipos e documentos)
  // ------------------------------------------------------------------

  async criar(
    municipioId: string,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaTipoNovo>,
  ) {
    await this.servicoValido(municipioId, d.servico_id);
    const [t] = await this.db.query<{ id: string }>(
      `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario, frase_do_agente)
       VALUES ($1, $2, $3, $4, $5, '[]', $6)
       ON CONFLICT (municipio_id, codigo) DO NOTHING RETURNING id`,
      [
        municipioId,
        d.codigo,
        d.nome,
        d.prazo_dias_uteis,
        d.servico_id ?? null,
        d.frase_do_agente ?? null,
      ],
    );
    if (!t) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'codigo_em_uso',
        `Já existe um tipo com o código ${d.codigo}.`,
      );
    }
    await this.registar(municipioId, u, 'criar', t.id, { codigo: d.codigo });
    return this.doPainel(municipioId, t.id);
  }

  async alterar(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaTipoAlterar>,
  ) {
    await this.porId(municipioId, id);
    if (d.servico_id !== undefined)
      await this.servicoValido(municipioId, d.servico_id);
    await this.db.query(
      `UPDATE tipos_processo SET
         nome = coalesce($3, nome),
         prazo_dias_uteis = coalesce($4, prazo_dias_uteis),
         servico_id = CASE WHEN $5::boolean THEN $6::uuid ELSE servico_id END,
         frase_do_agente = CASE WHEN $7::boolean THEN $8 ELSE frase_do_agente END,
         ativo = coalesce($9, ativo)
       WHERE id = $1 AND municipio_id = $2`,
      [
        id,
        municipioId,
        d.nome ?? null,
        d.prazo_dias_uteis ?? null,
        d.servico_id !== undefined,
        d.servico_id ?? null,
        d.frase_do_agente !== undefined,
        d.frase_do_agente ?? null,
        d.ativo ?? null,
      ],
    );
    await this.registar(municipioId, u, 'atualizar', id, {
      campos: Object.keys(d),
    });
    return this.doPainel(municipioId, id);
  }

  async criarDocumento(
    municipioId: string,
    u: UtilizadorPainel,
    tipoId: string,
    d: z.output<typeof esquemaDocumentoTipo>,
  ) {
    await this.porId(municipioId, tipoId);
    await this.db.query(
      `INSERT INTO tipo_processo_documentos (tipo_processo_id, nome, obrigatorio, ordem, verificacoes, gerado_pelo_sistema)
       VALUES ($1, $2, $3,
         (SELECT coalesce(max(ordem), 0) + 1 FROM tipo_processo_documentos WHERE tipo_processo_id = $1),
         $4, $5)`,
      [
        tipoId,
        d.nome,
        d.obrigatorio,
        JSON.stringify(d.verificacoes),
        d.gerado_pelo_sistema,
      ],
    );
    await this.registar(municipioId, u, 'acrescentar_documento', tipoId, {
      nome: d.nome,
    });
    return this.doPainel(municipioId, tipoId);
  }

  async alterarDocumento(
    municipioId: string,
    u: UtilizadorPainel,
    tipoId: string,
    docId: string,
    d: z.output<typeof esquemaDocumentoAlterar>,
  ) {
    await this.porId(municipioId, tipoId);
    const [x] = await this.db.query<{ id: string }>(
      `UPDATE tipo_processo_documentos SET
         nome = coalesce($3, nome),
         obrigatorio = coalesce($4, obrigatorio),
         verificacoes = coalesce($5::jsonb, verificacoes),
         gerado_pelo_sistema = coalesce($6, gerado_pelo_sistema)
       WHERE id = $1 AND tipo_processo_id = $2 RETURNING id`,
      [
        docId,
        tipoId,
        d.nome ?? null,
        d.obrigatorio ?? null,
        d.verificacoes ? JSON.stringify(d.verificacoes) : null,
        d.gerado_pelo_sistema ?? null,
      ],
    );
    if (!x) throw this.documentoDesconhecido();
    await this.registar(municipioId, u, 'alterar_documento', tipoId, {
      documento_id: docId,
    });
    return this.doPainel(municipioId, tipoId);
  }

  /** Só se nenhum processo o usou; senão passa a opcional (o histórico fica). */
  async removerDocumento(
    municipioId: string,
    u: UtilizadorPainel,
    tipoId: string,
    docId: string,
  ) {
    await this.porId(municipioId, tipoId);
    const [uso] = await this.db.query<{ usado: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM documentos WHERE tipo_documento_id = $1)
           OR EXISTS (SELECT 1 FROM processo_pedidos WHERE tipo_documento_id = $1) AS usado`,
      [docId],
    );
    if (uso?.usado) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'documento_em_uso',
        'Este documento já foi entregue ou pedido em processos. Marque-o como opcional em vez de o remover.',
      );
    }
    const [x] = await this.db.query<{ id: string }>(
      'DELETE FROM tipo_processo_documentos WHERE id = $1 AND tipo_processo_id = $2 RETURNING id',
      [docId, tipoId],
    );
    if (!x) throw this.documentoDesconhecido();
    await this.registar(municipioId, u, 'remover_documento', tipoId, {
      documento_id: docId,
    });
    return this.doPainel(municipioId, tipoId);
  }

  private async doPainel(municipioId: string, id: string) {
    const t = (await this.listar(municipioId)).find((x) => x.id === id);
    if (!t) throw new Error('Tipo desaparecido.');
    return t;
  }

  private async servicoValido(
    municipioId: string,
    servicoId: string | null | undefined,
  ) {
    if (!servicoId) return;
    const [s] = await this.db.query(
      'SELECT 1 FROM servicos WHERE id = $1 AND municipio_id = $2',
      [servicoId, municipioId],
    );
    if (!s) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'servico_invalido',
        'Esse serviço não existe.',
      );
    }
  }

  private documentoDesconhecido() {
    return new ErroApi(
      HttpStatus.NOT_FOUND,
      'documento_desconhecido',
      'Esse documento não é deste tipo de processo.',
    );
  }

  private registar(
    municipioId: string,
    u: UtilizadorPainel,
    acao: string,
    tipoId: string,
    dados: Record<string, unknown>,
  ) {
    return this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao,
      objetoTipo: 'tipo_processo',
      objetoId: tipoId,
      dados,
    });
  }

  /**
   * Documentos exigidos pelo tipo e se já chegaram (no requerimento ou no
   * processo). Um documento rejeitado na verificação conta como em falta.
   */
  async documentos(
    tipoId: string,
    alvo: AlvoDocumentos,
    q: Q = this.db,
  ): Promise<DocumentoExigido[]> {
    return q.query<DocumentoExigido>(
      `SELECT d.id, d.nome, d.obrigatorio, d.gerado_pelo_sistema,
              EXISTS (
                SELECT 1 FROM documentos x
                WHERE x.tipo_documento_id = d.id
                  AND (x.requerimento_id = $2 OR x.processo_id = $3)
                  AND x.verificacao_estado NOT IN ('documento_errado', 'ilegivel', 'fora_de_prazo')
              ) AS tem
       FROM tipo_processo_documentos d
       WHERE d.tipo_processo_id = $1
       ORDER BY d.ordem`,
      [tipoId, alvo.requerimentoId ?? null, alvo.processoId ?? null],
    );
  }
}
