import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { hojeNoFuso } from './periodos.js';

/** Na v1 só a nossa equipa mexe no agente; a câmara vê (V2: chefe de divisão). */
export function podeEditarAgente(perfil: UtilizadorPainel['perfil']): boolean {
  return perfil === 'admin' || perfil === 'equipa_toucamara';
}

/**
 * Versão do agente: dia + contador ('2026-10-19.3'). Muda a cada gravação e
 * liga evals e conversas (`conversas.agente_versao`) ao que estava no ar.
 */
export function proximaVersao(atual: string | null, hoje: string): string {
  const m = atual?.match(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/);
  if (m && m[1] === hoje) return `${hoje}.${Number(m[2]) + 1}`;
  return `${hoje}.1`;
}

export interface ConfigAgente {
  nome: string;
  saudacao: string;
  trata_por: string;
  idiomas: string[];
  voz_id?: string | null;
  voz_nome?: string | null;
  ritmo?: 'calmo' | 'normal' | 'rapido';
}

export interface Pronuncia {
  termo: string;
  como_se_diz: string;
}

export interface RegraEncaminhamento {
  assunto: string;
  entidade_id: string;
  contacto_id?: string | null;
  passa_a_pessoa?: string | null;
  prioridade?: number;
  ativo?: boolean;
}

const COLUNAS_REGRA = `r.id, r.assunto, r.entidade_id, e.nome AS entidade, r.contacto_id,
  ec.rotulo AS contacto_rotulo, ec.valor AS contacto_valor, r.passa_a_pessoa,
  r.prioridade, r.ativo`;

/** "Agente": configuração, pronúncias e "Quem trata de quê". */
@Injectable()
export class AgenteService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async obter(m: Municipio, u: UtilizadorPainel) {
    const [[config], pronuncias, regras] = await Promise.all([
      this.db.query(
        `SELECT nome, voz_id, voz_nome, ritmo, saudacao, trata_por, idiomas, versao
         FROM agente_config WHERE municipio_id = $1`,
        [m.id],
      ),
      this.pronuncias(m),
      this.regras(m),
    ]);
    return {
      config: config ?? null,
      pronuncias,
      regras_encaminhamento: regras,
      pode_editar: podeEditarAgente(u.perfil),
    };
  }

  async gravarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    c: ConfigAgente,
    ip?: string,
  ) {
    this.exigirEdicao(u);
    const versao = await this.db.transaction(async (tx) => {
      const [atual] = await tx.query<{ versao: string }>(
        'SELECT versao FROM agente_config WHERE municipio_id = $1 FOR UPDATE',
        [m.id],
      );
      const versao = proximaVersao(atual?.versao ?? null, hojeNoFuso(m.fuso));
      await tx.query(
        `INSERT INTO agente_config (municipio_id, nome, voz_id, saudacao, trata_por, idiomas, versao,
                                    voz_nome, ritmo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (municipio_id) DO UPDATE SET
           nome = EXCLUDED.nome, voz_id = EXCLUDED.voz_id, saudacao = EXCLUDED.saudacao,
           trata_por = EXCLUDED.trata_por, idiomas = EXCLUDED.idiomas, versao = EXCLUDED.versao,
           voz_nome = EXCLUDED.voz_nome, ritmo = EXCLUDED.ritmo`,
        [
          m.id,
          c.nome,
          c.voz_id ?? null,
          c.saudacao,
          c.trata_por,
          c.idiomas,
          versao,
          c.voz_nome ?? null,
          c.ritmo ?? 'normal',
        ],
      );
      await this.auditar(
        tx,
        m,
        u,
        'alterar_agente',
        'agente_config',
        m.id,
        {
          versao_anterior: atual?.versao ?? null,
          versao,
        },
        ip,
      );
      return versao;
    });
    return {
      ...c,
      voz_id: c.voz_id ?? null,
      voz_nome: c.voz_nome ?? null,
      ritmo: c.ritmo ?? 'normal',
      versao,
    };
  }

  pronuncias(m: Municipio) {
    return this.db.query<Pronuncia>(
      'SELECT termo, como_se_diz FROM pronuncias WHERE municipio_id = $1 ORDER BY termo',
      [m.id],
    );
  }

  /** Substitui a lista inteira. */
  async gravarPronuncias(
    m: Municipio,
    u: UtilizadorPainel,
    itens: Pronuncia[],
    ip?: string,
  ) {
    this.exigirEdicao(u);
    const termos = new Set<string>();
    for (const p of itens) {
      const k = p.termo.toLocaleLowerCase('pt');
      if (termos.has(k)) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'termo_repetido',
          `O termo "${p.termo}" aparece duas vezes.`,
        );
      }
      termos.add(k);
    }
    await this.db.transaction(async (tx) => {
      await tx.query('DELETE FROM pronuncias WHERE municipio_id = $1', [m.id]);
      if (itens.length) {
        await tx.query(
          `INSERT INTO pronuncias (municipio_id, termo, como_se_diz)
           SELECT $1, t, c FROM unnest($2::text[], $3::text[]) AS x(t, c)`,
          [m.id, itens.map((p) => p.termo), itens.map((p) => p.como_se_diz)],
        );
      }
      const versao = await this.subirVersao(tx, m);
      await this.auditar(
        tx,
        m,
        u,
        'alterar_pronuncias',
        'agente_config',
        m.id,
        {
          total: itens.length,
          versao,
        },
        ip,
      );
    });
    return this.pronuncias(m);
  }

  regras(m: Municipio) {
    return this.db.query(
      `SELECT ${COLUNAS_REGRA} FROM regras_encaminhamento r
       JOIN entidades e ON e.id = r.entidade_id
       LEFT JOIN entidade_contactos ec ON ec.id = r.contacto_id
       WHERE r.municipio_id = $1
       ORDER BY r.prioridade, r.assunto`,
      [m.id],
    );
  }

  async criarRegra(
    m: Municipio,
    u: UtilizadorPainel,
    r: RegraEncaminhamento,
    ip?: string,
  ) {
    this.exigirEdicao(u);
    await this.verificarEntidade(m, r.entidade_id, r.contacto_id);
    const id = await this.db.transaction(async (tx) => {
      const [nova] = await tx.query<{ id: string }>(
        `INSERT INTO regras_encaminhamento
           (municipio_id, assunto, entidade_id, contacto_id, passa_a_pessoa, prioridade, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          m.id,
          r.assunto,
          r.entidade_id,
          r.contacto_id ?? null,
          r.passa_a_pessoa ?? null,
          r.prioridade ?? 100,
          r.ativo ?? true,
        ],
      );
      const versao = await this.subirVersao(tx, m);
      await this.auditar(
        tx,
        m,
        u,
        'criar_regra',
        'regra_encaminhamento',
        nova.id,
        {
          assunto: r.assunto,
          versao,
        },
        ip,
      );
      return nova.id;
    });
    return this.regra(m, id);
  }

  async alterarRegra(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    r: Partial<RegraEncaminhamento>,
    ip?: string,
  ) {
    this.exigirEdicao(u);
    const antes = await this.regra(m, id);
    const entidadeId = r.entidade_id ?? antes.entidade_id;
    const contactoId =
      r.contacto_id !== undefined
        ? r.contacto_id
        : r.entidade_id && r.entidade_id !== antes.entidade_id
          ? null // contacto da entidade antiga já não serve
          : antes.contacto_id;
    await this.verificarEntidade(m, entidadeId, contactoId);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE regras_encaminhamento SET
           assunto = $3, entidade_id = $4, contacto_id = $5, passa_a_pessoa = $6,
           prioridade = $7, ativo = $8
         WHERE id = $1 AND municipio_id = $2`,
        [
          id,
          m.id,
          r.assunto ?? antes.assunto,
          entidadeId,
          contactoId,
          r.passa_a_pessoa !== undefined
            ? r.passa_a_pessoa
            : antes.passa_a_pessoa,
          r.prioridade ?? antes.prioridade,
          r.ativo ?? antes.ativo,
        ],
      );
      const versao = await this.subirVersao(tx, m);
      await this.auditar(
        tx,
        m,
        u,
        'alterar_regra',
        'regra_encaminhamento',
        id,
        {
          alteracoes: r,
          versao,
        },
        ip,
      );
    });
    return this.regra(m, id);
  }

  async apagarRegra(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    ip?: string,
  ) {
    this.exigirEdicao(u);
    const antes = await this.regra(m, id);
    await this.db.transaction(async (tx) => {
      await tx.query(
        'DELETE FROM regras_encaminhamento WHERE id = $1 AND municipio_id = $2',
        [id, m.id],
      );
      const versao = await this.subirVersao(tx, m);
      await this.auditar(
        tx,
        m,
        u,
        'apagar_regra',
        'regra_encaminhamento',
        id,
        {
          assunto: antes.assunto,
          versao,
        },
        ip,
      );
    });
  }

  private async regra(m: Municipio, id: string) {
    const [r] = await this.db.query<{
      id: string;
      assunto: string;
      entidade_id: string;
      contacto_id: string | null;
      passa_a_pessoa: string | null;
      prioridade: number;
      ativo: boolean;
    }>(
      `SELECT ${COLUNAS_REGRA} FROM regras_encaminhamento r
       JOIN entidades e ON e.id = r.entidade_id
       LEFT JOIN entidade_contactos ec ON ec.id = r.contacto_id
       WHERE r.id = $1 AND r.municipio_id = $2`,
      [id, m.id],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'regra_nao_encontrada',
        'Esta regra não existe.',
      );
    }
    return r;
  }

  private async verificarEntidade(
    m: Municipio,
    entidadeId: string,
    contactoId?: string | null,
  ) {
    const [e] = await this.db.query<{ contacto_ok: boolean }>(
      `SELECT ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM entidade_contactos c WHERE c.id = $3 AND c.entidade_id = e.id
              )) AS contacto_ok
       FROM entidades e WHERE e.id = $1 AND e.municipio_id = $2`,
      [entidadeId, m.id, contactoId ?? null],
    );
    if (!e) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'entidade_desconhecida',
        'Essa entidade não existe neste município.',
      );
    }
    if (!e.contacto_ok) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'contacto_desconhecido',
        'Esse contacto não é desta entidade.',
      );
    }
  }

  /** Pronúncias e regras também mudam o agente: nova versão (se já há config). */
  private async subirVersao(tx: Tx, m: Municipio): Promise<string | null> {
    const [atual] = await tx.query<{ versao: string }>(
      'SELECT versao FROM agente_config WHERE municipio_id = $1 FOR UPDATE',
      [m.id],
    );
    if (!atual) return null;
    const versao = proximaVersao(atual.versao, hojeNoFuso(m.fuso));
    await tx.query(
      'UPDATE agente_config SET versao = $2 WHERE municipio_id = $1',
      [m.id, versao],
    );
    return versao;
  }

  private exigirEdicao(u: UtilizadorPainel) {
    if (!podeEditarAgente(u.perfil)) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'so_equipa_interna',
        'Nesta versão só a equipa Tou, Câmara? altera o agente. Peça-nos a alteração.',
      );
    }
  }

  private auditar(
    tx: Tx,
    m: Municipio,
    u: UtilizadorPainel,
    acao: string,
    objetoTipo: string,
    objetoId: string,
    dados: Record<string, unknown>,
    ip?: string,
  ) {
    return this.auditoria.registar(
      {
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao,
        objetoTipo,
        objetoId,
        dados,
        ip,
      },
      tx,
    );
  }
}
