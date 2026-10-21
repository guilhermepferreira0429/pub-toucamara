import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { pode } from '../auth/permissoes.js';
import { CONSULTA_OU } from '../conhecimento/sql.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  CAMPOS_CONTEUDO,
  Conteudo,
  esquemaConteudo,
  termosPesquisa,
  textoPesquisa,
  trechosRelevantes,
  TrechoProcedimento,
} from './regras.js';

export const ESTADOS = ['rascunho', 'publicado', 'arquivado'] as const;
export type EstadoProcedimento = (typeof ESTADOS)[number];

export const esquemaGuardar = esquemaConteudo.extend({
  nota: z.string().trim().max(300).optional(),
});

export const esquemaListar = z.object({
  estado: z.enum(ESTADOS).optional(),
  q: z.string().trim().max(200).optional(),
});

export interface Linha extends Conteudo {
  id: string;
  estado: EstadoProcedimento;
  versao: number;
  origem: string;
  entrevista_id: string | null;
  autor_id: string | null;
  autor_nome: string | null;
  servico_nome: string | null;
  publicado_em: string | null;
  publicado_por_nome: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Encontrado {
  id: string;
  titulo: string;
  area: string;
  versao: number;
  estado: EstadoProcedimento;
  autor_id: string | null;
  autor_nome: string | null;
  publicado_em: string | null;
  pontuacao: number;
  conteudo: Conteudo;
  trechos: TrechoProcedimento[];
}

const COLUNAS = `p.id, p.titulo, p.area, p.servico_id, p.resumo, p.passos, p.onde_esta,
  p.contactos, p.excecoes, p.erros_comuns, p.notas, p.estado, p.versao, p.origem,
  p.entrevista_id, p.autor_id, a.nome AS autor_nome, s.nome AS servico_nome,
  p.publicado_em, pp.nome AS publicado_por_nome, p.criado_em, p.atualizado_em`;

const JUNCOES = `LEFT JOIN utilizadores a ON a.id = p.autor_id
  LEFT JOIN utilizadores pp ON pp.id = p.publicado_por
  LEFT JOIN servicos s ON s.id = p.servico_id`;

export function conteudoDe(l: Conteudo): Conteudo {
  return Object.fromEntries(CAMPOS_CONTEUDO.map((c) => [c, l[c]])) as Conteudo;
}

/**
 * Procedimentos internos: o "como se faz" da câmara, só para funcionários
 * (nunca saem para o munícipe nem entram na pesquisa do agente).
 *
 * Quem pode: todos os perfis do painel leem e escrevem rascunhos seus; quem
 * tem `procedimentos` (chefe de divisão) altera qualquer um, publica e
 * arquiva. Cada gravação fica como versão.
 */
@Injectable()
export class ProcedimentosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(m: Municipio, f: z.output<typeof esquemaListar>) {
    if (f.q) {
      const r = await this.procurar(
        m.id,
        f.q,
        30,
        f.estado ? [f.estado] : ['rascunho', 'publicado'],
      );
      return {
        itens: r.map(({ conteudo, ...x }) => ({
          ...x,
          passos: conteudo.passos.length,
        })),
      };
    }
    const itens = await this.db.query<Linha>(
      `SELECT ${COLUNAS} FROM procedimentos p ${JUNCOES}
       WHERE p.municipio_id = $1
         AND ($2::text IS NULL OR p.estado = $2)
         AND ($2::text IS NOT NULL OR p.estado <> 'arquivado')
       ORDER BY p.atualizado_em DESC, p.id DESC LIMIT 200`,
      [m.id, f.estado ?? null],
    );
    const [contagens] = await this.db.query<Record<EstadoProcedimento, number>>(
      `SELECT count(*) FILTER (WHERE estado = 'rascunho')::int AS rascunho,
              count(*) FILTER (WHERE estado = 'publicado')::int AS publicado,
              count(*) FILTER (WHERE estado = 'arquivado')::int AS arquivado
       FROM procedimentos WHERE municipio_id = $1`,
      [m.id],
    );
    return {
      itens: itens.map((l) => ({
        id: l.id,
        titulo: l.titulo,
        area: l.area,
        estado: l.estado,
        versao: l.versao,
        origem: l.origem,
        autor_id: l.autor_id,
        autor_nome: l.autor_nome,
        servico_nome: l.servico_nome,
        passos: l.passos.length,
        publicado_em: l.publicado_em,
        atualizado_em: l.atualizado_em,
      })),
      contagens,
    };
  }

  async detalhe(m: Municipio, id: string) {
    const p = await this.linha(m.id, id);
    const versoes = await this.db.query<{
      versao: number;
      estado: string;
      nota: string | null;
      alterado_por_nome: string | null;
      criado_em: string;
    }>(
      `SELECT v.versao, v.estado, v.nota, u.nome AS alterado_por_nome, v.criado_em
       FROM procedimento_versoes v LEFT JOIN utilizadores u ON u.id = v.alterado_por
       WHERE v.procedimento_id = $1 ORDER BY v.versao DESC`,
      [id],
    );
    return { ...p, versoes };
  }

  async versao(m: Municipio, id: string, versao: number) {
    await this.linha(m.id, id);
    const [v] = await this.db.query<{
      versao: number;
      estado: string;
      conteudo: Conteudo;
      criado_em: string;
    }>(
      `SELECT versao, estado, conteudo, criado_em FROM procedimento_versoes
       WHERE procedimento_id = $1 AND versao = $2`,
      [id, versao],
    );
    if (!v)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Essa versão não existe.',
      );
    return v;
  }

  /** Um rascunho novo (à mão, de uma entrevista ou de uma pergunta sem resposta). */
  async criar(
    m: Municipio,
    u: UtilizadorPainel,
    c: Conteudo,
    o: {
      origem?: 'manual' | 'entrevista' | 'lacuna';
      entrevistaId?: string | null;
      autorId?: string;
      nota?: string;
    } = {},
    tx?: Tx,
  ): Promise<{ id: string; estado: EstadoProcedimento; versao: number }> {
    const fazer = async (t: Tx) => {
      await this.validarServico(t, m.id, c.servico_id);
      const [p] = await t.query<{ id: string }>(
        `INSERT INTO procedimentos (municipio_id, titulo, area, servico_id, resumo, passos,
           onde_esta, contactos, excecoes, erros_comuns, notas, autor_id, origem,
           entrevista_id, texto_pesquisa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [
          m.id,
          c.titulo,
          c.area,
          c.servico_id,
          c.resumo,
          JSON.stringify(c.passos),
          JSON.stringify(c.onde_esta),
          JSON.stringify(c.contactos),
          JSON.stringify(c.excecoes),
          JSON.stringify(c.erros_comuns),
          c.notas,
          o.autorId ?? u.id,
          o.origem ?? 'manual',
          o.entrevistaId ?? null,
          textoPesquisa(c),
        ],
      );
      await this.gravarVersao(t, p.id, 1, 'rascunho', c, u.id, o.nota ?? null);
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar',
          objetoTipo: 'procedimento',
          objetoId: p.id,
          dados: { origem: o.origem ?? 'manual', titulo: c.titulo },
        },
        t,
      );
      return { id: p.id, estado: 'rascunho' as const, versao: 1 };
    };
    return tx ? fazer(tx) : this.db.transaction(fazer);
  }

  async atualizar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaGuardar>,
  ) {
    const { nota, ...c } = d;
    return this.db.transaction(async (tx) => {
      const p = await this.linha(m.id, id, tx, true);
      this.verificarEdicao(u, p);
      await this.validarServico(tx, m.id, c.servico_id);
      const versao = p.versao + 1;
      await tx.query(
        `UPDATE procedimentos SET titulo = $2, area = $3, servico_id = $4, resumo = $5,
           passos = $6, onde_esta = $7, contactos = $8, excecoes = $9, erros_comuns = $10,
           notas = $11, texto_pesquisa = $12, versao = $13, atualizado_em = now()
         WHERE id = $1`,
        [
          id,
          c.titulo,
          c.area,
          c.servico_id,
          c.resumo,
          JSON.stringify(c.passos),
          JSON.stringify(c.onde_esta),
          JSON.stringify(c.contactos),
          JSON.stringify(c.excecoes),
          JSON.stringify(c.erros_comuns),
          c.notas,
          textoPesquisa(c),
          versao,
        ],
      );
      await this.gravarVersao(tx, id, versao, p.estado, c, u.id, nota ?? null);
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'atualizar',
          objetoTipo: 'procedimento',
          objetoId: id,
          dados: { versao, estado: p.estado },
        },
        tx,
      );
      return { id, estado: p.estado, versao };
    });
  }

  /** Publicar (ou voltar a publicar um arquivado): passa a valer para todos. */
  publicar(m: Municipio, u: UtilizadorPainel, id: string) {
    return this.mudarEstado(m, u, id, 'publicado', 'publicar');
  }

  arquivar(m: Municipio, u: UtilizadorPainel, id: string) {
    return this.mudarEstado(m, u, id, 'arquivado', 'arquivar');
  }

  private async mudarEstado(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    estado: EstadoProcedimento,
    acao: string,
  ) {
    return this.db.transaction(async (tx) => {
      const p = await this.linha(m.id, id, tx, true);
      if (p.estado === estado) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          `O procedimento já está ${estado}.`,
        );
      }
      const versao = p.versao + 1;
      await tx.query(
        `UPDATE procedimentos SET estado = $2, versao = $3, atualizado_em = now(),
           publicado_em = CASE WHEN $2 = 'publicado' THEN now() ELSE publicado_em END,
           publicado_por = CASE WHEN $2 = 'publicado' THEN $4::uuid ELSE publicado_por END
         WHERE id = $1`,
        [id, estado, versao, u.id],
      );
      await this.gravarVersao(
        tx,
        id,
        versao,
        estado,
        conteudoDe(p),
        u.id,
        null,
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao,
          objetoTipo: 'procedimento',
          objetoId: id,
          dados: { versao },
        },
        tx,
      );
      return { id, estado, versao };
    });
  }

  /**
   * Pesquisa por texto (português, sem acentos, qualquer palavra) nos
   * procedimentos; com os trechos que mais tocam na pergunta. O assistente
   * só usa os publicados.
   */
  async procurar(
    municipioId: string,
    pergunta: string,
    limite = 3,
    estados: EstadoProcedimento[] = ['publicado'],
  ): Promise<Encontrado[]> {
    const termos = termosPesquisa(pergunta);
    if (!termos) return [];
    const linhas = await this.db.query<Linha & { pontuacao: number }>(
      `WITH c AS (${CONSULTA_OU(2)})
       SELECT ${COLUNAS}, ts_rank_cd(p.tsv, c.q, 32)::float8 AS pontuacao
       FROM c, procedimentos p ${JUNCOES}
       WHERE p.municipio_id = $1 AND p.estado = ANY($3::text[]) AND p.tsv @@ c.q
       ORDER BY pontuacao DESC, p.atualizado_em DESC
       LIMIT $4`,
      [municipioId, termos, estados, limite],
    );
    return linhas.map((l) => {
      const conteudo = conteudoDe(l);
      return {
        id: l.id,
        titulo: l.titulo,
        area: l.area,
        versao: l.versao,
        estado: l.estado,
        autor_id: l.autor_id,
        autor_nome: l.autor_nome,
        publicado_em: l.publicado_em,
        pontuacao: Math.round(l.pontuacao * 1000) / 1000,
        conteudo,
        trechos: trechosRelevantes(conteudo, pergunta),
      };
    });
  }

  private verificarEdicao(u: UtilizadorPainel, p: Linha) {
    if (pode(u.perfil, 'procedimentos')) return;
    if (p.estado === 'rascunho' && p.autor_id === u.id) return;
    throw new ErroApi(
      HttpStatus.FORBIDDEN,
      'sem_permissao',
      p.estado === 'rascunho'
        ? 'Só quem escreveu o rascunho ou a chefia o pode alterar.'
        : 'Só a chefia altera um procedimento publicado.',
      { recurso: 'procedimentos' },
    );
  }

  private async validarServico(
    tx: Tx,
    municipioId: string,
    servicoId: string | null,
  ) {
    if (!servicoId) return;
    const [s] = await tx.query(
      `SELECT 1 FROM servicos WHERE id = $1 AND municipio_id = $2`,
      [servicoId, municipioId],
    );
    if (!s)
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'servico_invalido',
        'Esse serviço não existe.',
      );
  }

  private async gravarVersao(
    tx: Tx,
    id: string,
    versao: number,
    estado: string,
    c: Conteudo,
    por: string,
    nota: string | null,
  ) {
    await tx.query(
      `INSERT INTO procedimento_versoes (procedimento_id, versao, estado, conteudo, alterado_por, nota)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, versao, estado, JSON.stringify(conteudoDe(c)), por, nota],
    );
  }

  private async linha(
    municipioId: string,
    id: string,
    tx?: Tx,
    bloquear = false,
  ): Promise<Linha> {
    const [p] = await (tx ?? this.db).query<Linha>(
      `SELECT ${COLUNAS} FROM procedimentos p ${JUNCOES}
       WHERE p.id = $1 AND p.municipio_id = $2 ${bloquear ? 'FOR UPDATE OF p' : ''}`,
      [id, municipioId],
    );
    if (!p)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Procedimento não existe.',
      );
    return p;
  }
}
