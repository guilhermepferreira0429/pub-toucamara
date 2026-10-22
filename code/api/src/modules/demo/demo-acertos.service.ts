import { Injectable, Logger } from '@nestjs/common';
import { proximoNumero } from '../../common/numeracao.js';
import { DatabaseService } from '../../database/database.service.js';
import { diaLocal } from '../marcacoes/vagas.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { SITE_VIMAGUA, URL_REGULAMENTO_ANTIGO } from './demo.conhecimento.js';
import {
  NOMES_ANTIGOS,
  REGULAMENTO,
  TEMAS,
  TEXTOS_ANTIGOS,
} from './demo.conteudo.js';
import { numeracaoContinua, trocarNomes } from './demo.regras.js';

/** Tabelas (com `municipio_id` e `id`) onde a demonstração escreve nomes. */
const TABELAS_COM_NOMES = [
  'municipes',
  'conversas',
  'processos',
  'licencas',
  'reservas',
  'reclamacoes',
  'estacionamento_defesas',
  'estacionamento_lugares_pedidos',
  'escolas_alunos',
  'mensagens_saida',
  'passagens_humano',
  'ocorrencias',
  'pagamentos',
  'habitacao_candidaturas',
  'habitacao_contratos',
];

const PADRAO_ANTIGO = [...NOMES_ANTIGOS, ...TEXTOS_ANTIGOS]
  .map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const TROCAS = [...NOMES_ANTIGOS, ...TEXTOS_ANTIGOS];

/**
 * Acertos que correm em cada "Preparar demo", para que uma câmara preparada
 * com uma versão antiga fique coerente sem se apagar nada: nomes de teste,
 * a entidade da água, a numeração dos processos, as datas que ficaram em
 * "agora" e a licença de esplanada emitida como exceção. Idempotentes.
 */
@Injectable()
export class DemoAcertosService {
  private readonly logger = new Logger(DemoAcertosService.name);

  constructor(private readonly db: DatabaseService) {}

  async acertar(m: Municipio, base: boolean): Promise<Record<string, number>> {
    const r: Record<string, number> = {};
    r.nomes = await this.nomes(m);
    r.processos_renumerados = await this.numeracao(m);
    r.datas = await this.datas(m);
    r.licencas = await this.licencaEsplanada(m);
    r.documentos = await this.documentos(m);
    r.fontes = await this.fontes(m);
    // A leitura desta noite leu as fontes todas (as de turismo vêm depois).
    await this.db.query(
      `UPDATE ingestoes i SET fontes_lidas = (SELECT count(*)::int FROM fontes f
         WHERE f.municipio_id = $1 AND f.arquivada_em IS NULL)
       FROM demo_registos d
       WHERE d.municipio_id = $1 AND d.chave = 'ingestao:noite' AND d.objeto_id = i.id`,
      [m.id],
    );
    if (base) r.base = await this.base(m);
    return r;
  }

  // -------------------------------------------------------------------
  // Nomes e textos antigos
  // -------------------------------------------------------------------

  private async nomes(m: Municipio): Promise<number> {
    let n = 0;
    for (const tabela of TABELAS_COM_NOMES) {
      const colunas = await this.db.query<{ coluna: string; tipo: string }>(
        `SELECT c.column_name AS coluna, c.data_type AS tipo
         FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = $1
           AND c.data_type IN ('text', 'jsonb', 'USER-DEFINED')
           AND (c.data_type <> 'USER-DEFINED' OR c.udt_name = 'citext')
           AND EXISTS (SELECT 1 FROM information_schema.columns x
                       WHERE x.table_schema = 'public' AND x.table_name = $1
                         AND x.column_name = 'municipio_id')`,
        [tabela],
      );
      for (const { coluna, tipo } of colunas) {
        const linhas = await this.db.query<{ id: string; v: string }>(
          `SELECT id::text, "${coluna}"::text AS v FROM "${tabela}"
           WHERE municipio_id = $1 AND "${coluna}"::text ~ $2`,
          [m.id, PADRAO_ANTIGO],
        );
        for (const l of linhas) {
          const novo = trocarNomes(l.v, TROCAS);
          if (novo === l.v) continue;
          const cast = tipo === 'jsonb' ? '::jsonb' : '';
          await this.db.query(
            `UPDATE "${tabela}" SET "${coluna}" = $2${cast} WHERE id::text = $1`,
            [l.id, novo],
          );
          n++;
        }
      }
    }
    // As falas das conversas de demonstração (sem municipio_id na tabela).
    const turnos = await this.db.query<{ id: string; v: string }>(
      `SELECT t.id::text, t.texto AS v FROM conversa_turnos t
       JOIN demo_registos d ON d.objeto_id = t.conversa_id AND d.municipio_id = $1
       WHERE t.texto ~ $2`,
      [m.id, PADRAO_ANTIGO],
    );
    for (const t of turnos) {
      await this.db.query(
        'UPDATE conversa_turnos SET texto = $2 WHERE id = $1::bigint',
        [t.id, trocarNomes(t.v, TROCAS)],
      );
      n++;
    }
    // As conversas de queixa do "Pergunte ao concelho" foram respondidas.
    const concelho = await this.db.query(
      `UPDATE conversas c SET resultado = 'resolvida'
       FROM demo_registos d
       WHERE d.municipio_id = $1 AND d.objeto_id = c.id AND d.chave LIKE 'conversa:concelho_%'
         AND c.resultado = 'sem_resposta'
       RETURNING c.id`,
      [m.id],
    );
    // A pergunta da piscina passou do tema "Eventos" para "Desporto".
    const piscina = await this.db.query(
      `UPDATE conversas c SET tema_id = t.id
       FROM demo_registos d, temas t
       WHERE d.municipio_id = $1 AND d.objeto_id = c.id AND d.tipo = 'conversa'
         AND t.municipio_id = $1 AND t.nome = $2
         AND c.resumo ILIKE '%piscina municipal%' AND c.tema_id IS DISTINCT FROM t.id
       RETURNING c.id`,
      [m.id, TEMAS.desporto],
    );
    return n + concelho.length + piscina.length;
  }

  // -------------------------------------------------------------------
  // Numeração dos processos de comunicação prévia
  // -------------------------------------------------------------------

  /**
   * CP 1, 2, 3… pela data de entrada, com o ano da entrada. Só quando todos
   * os processos CP da câmara são de demonstração; senão só se trocam os
   * números do design (CP 412 a 415) e os de ano errado pelo próximo livre.
   */
  async numeracao(m: Municipio): Promise<number> {
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      criado_em: Date;
      demonstracao: boolean;
      registado: boolean;
    }>(
      `SELECT p.id, p.numero, p.criado_em, p.demonstracao,
              EXISTS (SELECT 1 FROM demo_registos d
                      WHERE d.municipio_id = p.municipio_id AND d.objeto_id = p.id) AS registado
       FROM processos p JOIN tipos_processo t ON t.id = p.tipo_processo_id
       WHERE p.municipio_id = $1 AND t.codigo = 'CP'
       ORDER BY p.criado_em, p.numero`,
      [m.id],
    );
    if (!linhas.length) return 0;
    const todos = linhas.every((l) => l.demonstracao);
    const novos = numeracaoContinua(
      linhas.map((l) => ({
        id: l.id,
        numero: l.numero,
        dia: diaLocal(l.criado_em, m.fuso),
        registado: l.registado,
      })),
      todos,
    );
    if (!novos.length) return 0;
    await this.db.transaction(async (tx) => {
      if (todos) {
        // Dois passos: a numeração nova pode trocar números entre processos.
        await tx.query(
          `UPDATE processos SET numero = 'TMP-' || id::text WHERE id = ANY($1::uuid[])`,
          [novos.map((x) => x.id)],
        );
        for (const x of novos) {
          await tx.query('UPDATE processos SET numero = $2 WHERE id = $1', [
            x.id,
            x.numero,
          ]);
        }
        const ultimos = new Map<number, number>();
        for (const l of linhas) {
          const novo = novos.find((x) => x.id === l.id)?.numero ?? l.numero;
          const mm = /^CP (\d+)\/(\d{4})$/.exec(novo);
          if (mm) {
            const ano = Number(mm[2]);
            ultimos.set(ano, Math.max(ultimos.get(ano) ?? 0, Number(mm[1])));
          }
        }
        for (const [ano, ultimo] of ultimos) {
          await tx.query(
            `INSERT INTO numeracao (municipio_id, prefixo, ano, ultimo) VALUES ($1, 'CP', $2, $3)
             ON CONFLICT (municipio_id, prefixo, ano) DO UPDATE
             SET ultimo = greatest(numeracao.ultimo, EXCLUDED.ultimo)`,
            [m.id, ano, ultimo],
          );
        }
      } else {
        for (const x of novos) {
          const ano = Number(x.numero.slice(-4));
          const n = await proximoNumero(tx, m.id, 'CP', ano);
          await tx.query('UPDATE processos SET numero = $2 WHERE id = $1', [
            x.id,
            `CP ${n}/${ano}`,
          ]);
        }
      }
    });
    // O texto "Processo CP x/ano aberto" na linha do tempo (o painel não
    // reescreve o histórico: com o RLS do painel isto falha e fica).
    try {
      await this.db.query(
        `UPDATE processo_eventos e SET descricao = regexp_replace(e.descricao,
           'Processo CP [^ ]+ aberto', 'Processo ' || p.numero || ' aberto')
         FROM processos p
         WHERE p.id = e.processo_id AND p.municipio_id = $1 AND p.demonstracao
           AND e.tipo = 'criado' AND e.descricao ~ 'Processo CP [^ ]+ aberto'
           AND position(p.numero in e.descricao) = 0`,
        [m.id],
      );
    } catch {
      /* sem permissão no pedido do painel: só o texto antigo da linha do tempo */
    }
    return novos.length;
  }

  // -------------------------------------------------------------------
  // Datas que ficaram em "agora"
  // -------------------------------------------------------------------

  private async datas(m: Municipio): Promise<number> {
    // Licenças: o processo e o pagamento acompanham o pedido (não "agora").
    const a = await this.db.query(
      `UPDATE processos p SET
         prazo_inicio = (l.criada_em AT TIME ZONE $2)::date,
         decidido_em = CASE WHEN p.decidido_em IS NULL THEN NULL ELSE coalesce(l.decidida_em, p.decidido_em) END,
         atualizado_em = greatest(l.criada_em, coalesce(l.decidida_em, l.criada_em))
       FROM licencas l JOIN demo_registos d ON d.objeto_id = l.id AND d.municipio_id = $1
       WHERE p.id = l.processo_id
         AND (p.prazo_inicio IS DISTINCT FROM (l.criada_em AT TIME ZONE $2)::date
              OR (p.decidido_em IS NOT NULL AND l.decidida_em IS NOT NULL AND p.decidido_em <> l.decidida_em))
       RETURNING p.id`,
      [m.id, m.fuso],
    );
    const b = await this.db.query(
      `UPDATE pagamentos pg SET criado_em = l.criada_em + interval '3 minutes',
         pago_em = CASE WHEN pg.pago_em IS NULL THEN NULL ELSE l.criada_em + interval '6 minutes' END
       FROM licencas l JOIN demo_registos d ON d.objeto_id = l.id AND d.municipio_id = $1
       WHERE pg.processo_id = l.processo_id AND pg.criado_em > l.criada_em + interval '1 hour'
       RETURNING pg.id`,
      [m.id],
    );
    // A taxa da marquise: a guia saiu com a decisão.
    const c = await this.db.query(
      `UPDATE pagamentos pg SET criado_em = p.decidido_em + interval '5 minutes'
       FROM demo_registos d JOIN processos p ON p.id = d.objeto_id
       WHERE d.municipio_id = $1 AND d.chave = 'processo:marquise'
         AND pg.processo_id = p.id AND p.decidido_em IS NOT NULL
         AND pg.criado_em > p.decidido_em + interval '1 hour'
       RETURNING pg.id`,
      [m.id],
    );
    return a.length + b.length + c.length;
  }

  // -------------------------------------------------------------------
  // Documentos dos processos que já passaram da fase de documentos
  // -------------------------------------------------------------------

  /**
   * Um processo de demonstração em apreciação ou decidido sem nenhum
   * documento contradiz a fase: recebe os documentos exigidos pelo tipo,
   * verificados, com a data do início do prazo.
   */
  private async documentos(m: Municipio): Promise<number> {
    const r = await this.db.query(
      `INSERT INTO documentos (municipio_id, processo_id, tipo_documento_id, ficheiro_key, mime,
         origem, verificacao_estado, recebido_em)
       SELECT p.municipio_id, p.id, td.id,
              $2 || '/documentos/demonstracao/' || p.id || '-' || td.id || '.pdf',
              'application/pdf', 'upload', 'valido',
              coalesce(p.prazo_inicio::timestamptz + interval '10 hours', p.criado_em)
       FROM processos p
       JOIN tipos_processo t ON t.id = p.tipo_processo_id AND t.codigo = 'CP'
       JOIN tipo_processo_documentos td ON td.tipo_processo_id = t.id
       WHERE p.municipio_id = $1 AND p.demonstracao
         AND p.fase NOT IN ('entrada', 'documentos')
         AND EXISTS (SELECT 1 FROM demo_registos d
                     WHERE d.municipio_id = $1 AND d.objeto_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM documentos x WHERE x.processo_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM processo_pedidos pp WHERE pp.processo_id = p.id)
       RETURNING id`,
      [m.id, m.slug],
    );
    return r.length;
  }

  // -------------------------------------------------------------------
  // A licença de esplanada: cumpre as regras (não é exceção)
  // -------------------------------------------------------------------

  private async licencaEsplanada(m: Municipio): Promise<number> {
    const r = await this.db.query(
      `UPDATE licencas l SET
         dados = l.dados || '{"estrado": false, "centro_historico": false}',
         excecao = NULL, decisao = 'automatica', decidida_por = NULL
       FROM demo_registos d
       WHERE d.municipio_id = $1 AND d.chave = 'licenca:esplanada' AND d.objeto_id = l.id
         AND l.estado = 'emitida' AND l.decisao = 'excecao'
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(l.excecao, '[]')) x
                         WHERE x->>'tipo' = 'regra')
       RETURNING l.id`,
      [m.id],
    );
    return r.length;
  }

  // -------------------------------------------------------------------
  // Fontes e entidades
  // -------------------------------------------------------------------

  private async fontes(m: Municipio): Promise<number> {
    const r = await this.db.query(
      `UPDATE fontes SET url = $3, demonstracao = true
       WHERE municipio_id = $1 AND url = $2
         AND NOT EXISTS (SELECT 1 FROM fontes f WHERE f.municipio_id = $1 AND f.url = $3)
       RETURNING id`,
      [m.id, URL_REGULAMENTO_ANTIGO, REGULAMENTO.url],
    );
    return r.length;
  }

  /**
   * Os dados de base com nomes de teste (os do seed): a entidade da água
   * passa a Vimágua, com o site e sem o número fictício; a chefia "Chefe
   * Teste" ganha um nome. Fora dos testes automáticos (que contam com o
   * seed), por isso só com `base`.
   */
  private async base(m: Municipio): Promise<number> {
    let n = 0;
    const agua = await this.db.query<{ id: string }>(
      `UPDATE entidades SET nome = 'Vimágua', site_url = $2,
         descricao = 'Água e saneamento no concelho'
       WHERE municipio_id = $1 AND nome = 'Águas do Concelho'
         AND NOT EXISTS (SELECT 1 FROM entidades e WHERE e.municipio_id = $1 AND e.nome = 'Vimágua')
       RETURNING id`,
      [m.id, SITE_VIMAGUA],
    );
    n += agua.length;
    const contactos = await this.db.query(
      `UPDATE entidade_contactos c SET tipo = 'site', valor = 'www.vimagua.pt',
         rotulo = 'Avarias e contactos', horario = NULL
       FROM entidades e
       WHERE e.id = c.entidade_id AND e.municipio_id = $1 AND e.nome = 'Vimágua'
         AND regexp_replace(c.valor, '\\s', '', 'g') = '800000000'
       RETURNING c.id`,
      [m.id],
    );
    n += contactos.length;
    const chefe = await this.db.query(
      `UPDATE utilizadores SET nome = 'Margarida Freitas'
       WHERE municipio_id = $1 AND nome = 'Chefe Teste'
       RETURNING id`,
      [m.id],
    );
    n += chefe.length;
    if (n) this.logger.log(`Demo · base de ${m.slug}: ${n} acertos.`);
    return n;
  }
}
