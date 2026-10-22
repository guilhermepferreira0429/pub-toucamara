import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { procurarTermo, TERMOS_DEMONSTRACAO } from './regras.js';

export interface Termo {
  id: string;
  termo: string;
  variantes: string[];
  explicacao: string;
  exemplo: string | null;
  fonte_legal: string | null;
  demonstracao: boolean;
  ativo: boolean;
  atualizado_em: string;
}

const COLUNAS = `id, termo, variantes, explicacao, exemplo, fonte_legal,
  demonstracao, ativo, atualizado_em`;

const variantes = z.array(z.string().trim().min(2).max(80)).max(12).default([]);

export const esquemaTermo = z.object({
  termo: z.string().trim().min(2).max(80),
  variantes,
  explicacao: z.string().trim().min(10).max(600),
  exemplo: z.string().trim().max(400).nullish(),
  fonte_legal: z.string().trim().max(200).nullish(),
  ativo: z.boolean().default(true),
});

export const esquemaEditarTermo = esquemaTermo.partial().extend({
  variantes: z.array(z.string().trim().min(2).max(80)).max(12).optional(),
  /** false = a câmara reviu e confirma a explicação (deixa de ser demonstração). */
  demonstracao: z.boolean().optional(),
  ativo: z.boolean().optional(),
});

/**
 * Glossário administrativo (CONC, ideia 5): termos com uma explicação
 * simples, editáveis pela câmara (recurso 'conhecimento'), usados nas
 * páginas públicas dos documentos e pelo agente (`explicar_termo`).
 */
@Injectable()
export class GlossarioService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(municipioId: string) {
    const itens = await this.db.query<Termo>(
      `SELECT ${COLUNAS} FROM glossario_termos
       WHERE municipio_id = $1 ORDER BY lower(termo)`,
      [municipioId],
    );
    return { itens, demonstracao: itens.some((t) => t.demonstracao) };
  }

  /** Os termos em uso (para detetar no texto e para o agente). */
  ativos(municipioId: string) {
    return this.db.query<Termo>(
      `SELECT ${COLUNAS} FROM glossario_termos
       WHERE municipio_id = $1 AND ativo ORDER BY lower(termo)`,
      [municipioId],
    );
  }

  async criar(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaTermo>,
  ): Promise<Termo> {
    return this.db.transaction(async (tx) => {
      const [t] = await tx.query<Termo>(
        `INSERT INTO glossario_termos (municipio_id, termo, variantes, explicacao, exemplo,
                fonte_legal, ativo, criado_por, atualizado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT DO NOTHING
         RETURNING ${COLUNAS}`,
        [
          m.id,
          d.termo,
          limparVariantes(d.variantes, d.termo),
          d.explicacao,
          d.exemplo ?? null,
          d.fonte_legal ?? null,
          d.ativo,
          u.id,
        ],
      );
      if (!t) throw termoRepetido();
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar_termo_glossario',
          objetoTipo: 'termo_glossario',
          objetoId: t.id,
          dados: { termo: t.termo },
        },
        tx,
      );
      return t;
    });
  }

  async editar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaEditarTermo>,
  ): Promise<Termo> {
    return this.db.transaction(async (tx) => {
      const [antes] = await tx.query<Termo>(
        `SELECT ${COLUNAS} FROM glossario_termos WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [id, m.id],
      );
      if (!antes) throw naoEncontrado();
      const termo = d.termo ?? antes.termo;
      let t: Termo | undefined;
      try {
        [t] = await tx.query<Termo>(
          `UPDATE glossario_termos SET termo = $3, variantes = $4, explicacao = $5,
                  exemplo = $6, fonte_legal = $7, demonstracao = $8, ativo = $9,
                  atualizado_por = $10, atualizado_em = now()
           WHERE id = $1 AND municipio_id = $2
           RETURNING ${COLUNAS}`,
          [
            id,
            m.id,
            termo,
            limparVariantes(d.variantes ?? antes.variantes, termo),
            d.explicacao ?? antes.explicacao,
            d.exemplo !== undefined ? d.exemplo : antes.exemplo,
            d.fonte_legal !== undefined ? d.fonte_legal : antes.fonte_legal,
            d.demonstracao ?? antes.demonstracao,
            d.ativo ?? antes.ativo,
            u.id,
          ],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw termoRepetido();
        throw e;
      }
      const mudou = (Object.keys(d) as (keyof typeof d)[]).filter(
        (k) => d[k] !== undefined,
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'editar_termo_glossario',
          objetoTipo: 'termo_glossario',
          objetoId: id,
          dados: { termo, campos: mudou },
        },
        tx,
      );
      return t;
    });
  }

  async apagar(m: Municipio, u: UtilizadorPainel, id: string) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.query<{ termo: string }>(
        `DELETE FROM glossario_termos WHERE id = $1 AND municipio_id = $2 RETURNING termo`,
        [id, m.id],
      );
      if (!t) throw naoEncontrado();
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'apagar_termo_glossario',
          objetoTipo: 'termo_glossario',
          objetoId: id,
          dados: { termo: t.termo },
        },
        tx,
      );
    });
    return { apagado: true };
  }

  /** Os termos iniciais (de demonstração); os que já existem ficam como estão. */
  async carregarDemonstracao(m: Municipio, u: UtilizadorPainel) {
    const novos = await this.db.transaction(async (tx) => {
      let n = 0;
      for (const t of TERMOS_DEMONSTRACAO) {
        const r = await tx.query(
          `INSERT INTO glossario_termos (municipio_id, termo, variantes, explicacao, exemplo,
                  fonte_legal, demonstracao, criado_por, atualizado_por)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)
           ON CONFLICT DO NOTHING RETURNING id`,
          [
            m.id,
            t.termo,
            t.variantes,
            t.explicacao,
            t.exemplo ?? null,
            t.fonte_legal ?? null,
            u.id,
          ],
        );
        n += r.length;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'carregar_glossario_demonstracao',
          objetoTipo: 'glossario',
          objetoId: m.id,
          dados: { novos: n },
        },
        tx,
      );
      return n;
    });
    return { novos, ...(await this.listar(m.id)) };
  }

  /** Ferramenta `explicar_termo`: o termo pedido, em linguagem simples. */
  async explicar(municipioId: string, consulta: string) {
    const termos = await this.ativos(municipioId);
    const t = procurarTermo(termos, consulta);
    if (!t) {
      return {
        encontrado: false,
        dizer:
          'Não tenho esse termo no glossário da câmara. Procura nas fontes oficiais (procurar_conhecimento) e explica por palavras simples só o que lá estiver; se não houver, diz que não tens a explicação confirmada.',
      };
    }
    return {
      encontrado: true,
      termo: t.termo,
      explicacao: t.explicacao,
      exemplo: t.exemplo,
      fonte_legal: t.fonte_legal,
      valores_de_demonstracao: t.demonstracao,
      dizer:
        `"${t.termo}" quer dizer: ${t.explicacao}` +
        (t.exemplo ? ` Por exemplo: ${t.exemplo}` : '') +
        (t.demonstracao
          ? ' (Explicação de demonstração, ainda por validar pela câmara.)'
          : ''),
    };
  }
}

/** Sem repetidos, sem o próprio termo e sem vazios. */
function limparVariantes(lista: string[], termo: string): string[] {
  const vistos = new Set([termo.trim().toLowerCase()]);
  const fora: string[] = [];
  for (const v of lista) {
    const k = v.trim().toLowerCase();
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    fora.push(v.trim());
  }
  return fora;
}

function termoRepetido() {
  return new ErroApi(
    HttpStatus.CONFLICT,
    'termo_repetido',
    'Esse termo já está no glossário.',
  );
}

function naoEncontrado() {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'termo_nao_encontrado',
    'Termo não encontrado.',
  );
}
