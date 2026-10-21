import { ACOES_DADOS_PESSOAIS, frase, ligacao } from './acessos.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { Municipio } from '../municipios/municipios.service.js';

/** Perfis que a câmara pode dar. admin e equipa_toucamara só por nós. */
export const PERFIS_DA_CAMARA = [
  'atendimento',
  'tecnico',
  'chefe_divisao',
  'vereador',
] as const;
export type PerfilDaCamara = (typeof PERFIS_DA_CAMARA)[number];

export interface Convite {
  email: string;
  nome: string;
  perfil: PerfilDaCamara;
  servico_id?: string | null;
}

export interface AlteracaoMembro {
  perfil?: PerfilDaCamara;
  ativo?: boolean;
  servico_id?: string | null;
}

/**
 * Regras de "Equipa e acessos" (puras): ninguém se desativa a si próprio
 * (ficava sem acesso e a câmara sem quem gere a equipa).
 */
export function validarAlteracao(
  quem: Pick<UtilizadorPainel, 'id'>,
  alvoId: string,
  a: AlteracaoMembro,
): void {
  if (alvoId === quem.id && a.ativo === false) {
    throw new ErroApi(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'nao_pode_desativar_se',
      'Não pode desativar o seu próprio acesso.',
    );
  }
}

export interface MembroServico {
  id: string;
  nome: string;
  perfil: string;
  foto_url: string | null;
  servico_id: string | null;
}

export interface ServicoComEquipa {
  id: string;
  nome: string;
  entidade: string | null;
  email: string | null;
  telefone: string | null;
  tecnicos: Omit<MembroServico, 'servico_id'>[];
}

/**
 * Serviços com os membros ativos de cada um (pela ordem dada); os que não
 * têm serviço ficam em `sem_servico`. Puro, para testar à parte.
 */
export function agruparPorServico(
  servicos: Omit<ServicoComEquipa, 'tecnicos'>[],
  membros: MembroServico[],
): { itens: ServicoComEquipa[]; sem_servico: ServicoComEquipa['tecnicos'] } {
  const porServico = new Map<string, ServicoComEquipa['tecnicos']>();
  const sem: ServicoComEquipa['tecnicos'] = [];
  const ids = new Set(servicos.map((s) => s.id));
  for (const { servico_id, ...m } of membros) {
    if (servico_id && ids.has(servico_id)) {
      const l = porServico.get(servico_id) ?? [];
      l.push(m);
      porServico.set(servico_id, l);
    } else {
      sem.push(m);
    }
  }
  return {
    itens: servicos.map((s) => ({
      ...s,
      tecnicos: porServico.get(s.id) ?? [],
    })),
    sem_servico: sem,
  };
}

const COLUNAS = `u.id, u.email, u.nome, u.perfil, u.servico_id, s.nome AS servico,
  u.foto_url, u.ativo, u.ultimo_acesso_em, u.criado_em`;

@Injectable()
export class EquipaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** "Registo de acessos": quem viu e alterou o quê (só se acrescenta). */
  async acessos(
    m: Municipio,
    f: { limite: number; cursor: Cursor | null; so_dados_pessoais: boolean },
  ) {
    const linhas = await this.db.query<{
      id: string;
      em: Date;
      ator_tipo: string;
      ator_nome: string | null;
      acao: string;
      objeto_tipo: string;
      objeto_id: string;
      ip: string | null;
    }>(
      `SELECT a.id::text AS id, a.em, a.ator_tipo::text AS ator_tipo, u.nome AS ator_nome,
              a.acao, a.objeto_tipo, a.objeto_id, host(a.ip) AS ip
       FROM audit_log a
       LEFT JOIN utilizadores u ON a.ator_tipo = 'utilizador' AND u.id::text = a.ator_id::text
       WHERE a.municipio_id = $1
         AND (NOT $2::boolean OR a.acao = ANY($3::text[]))
         AND ($4::timestamptz IS NULL OR (a.em, a.id) < ($4::timestamptz, $5::bigint))
       ORDER BY a.em DESC, a.id DESC
       LIMIT $6`,
      [
        m.id,
        f.so_dados_pessoais,
        ACOES_DADOS_PESSOAIS,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    const p = pagina(linhas, f.limite, (l) => ({ em: l.em, id: l.id }));
    return {
      ...p,
      itens: p.itens.map((l) => ({
        id: l.id,
        em: l.em.toISOString(),
        quem:
          l.ator_tipo === 'utilizador'
            ? (l.ator_nome ?? 'Utilizador removido')
            : l.ator_tipo === 'municipe'
              ? 'Munícipe'
              : l.ator_tipo === 'agente'
                ? 'Agente'
                : 'Sistema',
        ator_tipo: l.ator_tipo,
        acao: l.acao,
        frase: frase(l.acao, l.objeto_tipo),
        dados_pessoais: (ACOES_DADOS_PESSOAIS as readonly string[]).includes(
          l.acao,
        ),
        ligacao: ligacao(l.objeto_tipo, l.objeto_id),
        ip: l.ip,
      })),
    };
  }

  listar(m: Municipio) {
    return this.db.query(
      `SELECT ${COLUNAS} FROM utilizadores u
       LEFT JOIN servicos s ON s.id = u.servico_id
       WHERE u.municipio_id = $1
       ORDER BY u.ativo DESC, u.nome`,
      [m.id],
    );
  }

  /**
   * Para os seletores de serviço e técnico (Entrada, Processos, Ocorrências):
   * os serviços do município com os membros ativos de cada um (todos os
   * perfis; quem chama filtra pelo `perfil`).
   */
  async servicosComEquipa(m: Municipio) {
    const [servicos, membros] = await Promise.all([
      this.db.query<Omit<ServicoComEquipa, 'tecnicos'>>(
        `SELECT s.id, s.nome, e.nome AS entidade, s.email::text AS email, s.telefone
         FROM servicos s LEFT JOIN entidades e ON e.id = s.entidade_id
         WHERE s.municipio_id = $1
         ORDER BY s.nome, s.id`,
        [m.id],
      ),
      this.db.query<MembroServico>(
        `SELECT u.id, u.nome, u.perfil::text AS perfil, u.foto_url, u.servico_id
         FROM utilizadores u
         WHERE u.municipio_id = $1 AND u.ativo
         ORDER BY u.nome, u.id`,
        [m.id],
      ),
    ]);
    return agruparPorServico(servicos, membros);
  }

  /** Convidar = criar o utilizador e mandar-lhe o link mágico. */
  async convidar(
    m: Municipio,
    quem: UtilizadorPainel,
    c: Convite,
    ip?: string,
  ) {
    await this.verificarServico(m, c.servico_id);
    const [novo] = await this.db.query<{ id: string }>(
      `INSERT INTO utilizadores (municipio_id, email, nome, perfil, servico_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [m.id, c.email, c.nome, c.perfil, c.servico_id ?? null],
    );
    if (!novo) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'email_ja_existe',
        'Já existe um utilizador com este email.',
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: quem.id,
      acao: 'convidar',
      objetoTipo: 'utilizador',
      objetoId: novo.id,
      dados: {
        email: c.email,
        perfil: c.perfil,
        servico_id: c.servico_id ?? null,
      },
      ip,
    });
    await this.auth.pedirLink(c.email);
    return this.obter(m, novo.id);
  }

  async alterar(
    m: Municipio,
    quem: UtilizadorPainel,
    id: string,
    a: AlteracaoMembro,
    ip?: string,
  ) {
    validarAlteracao(quem, id, a);
    const antes = await this.obter(m, id);
    if (a.servico_id !== undefined)
      await this.verificarServico(m, a.servico_id);
    await this.db.query(
      `UPDATE utilizadores SET
         perfil = coalesce($3::perfil, perfil),
         ativo = coalesce($4::boolean, ativo),
         servico_id = CASE WHEN $5::boolean THEN $6::uuid ELSE servico_id END
       WHERE id = $1 AND municipio_id = $2`,
      [
        id,
        m.id,
        a.perfil ?? null,
        a.ativo ?? null,
        a.servico_id !== undefined,
        a.servico_id ?? null,
      ],
    );
    const depois = await this.obter(m, id);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: quem.id,
      acao: 'alterar_acesso',
      objetoTipo: 'utilizador',
      objetoId: id,
      dados: {
        antes: {
          perfil: antes.perfil,
          ativo: antes.ativo,
          servico_id: antes.servico_id,
        },
        depois: {
          perfil: depois.perfil,
          ativo: depois.ativo,
          servico_id: depois.servico_id,
        },
      },
      ip,
    });
    return depois;
  }

  private async obter(m: Municipio, id: string) {
    const [u] = await this.db.query<{
      id: string;
      perfil: string;
      ativo: boolean;
      servico_id: string | null;
    }>(
      `SELECT ${COLUNAS} FROM utilizadores u
       LEFT JOIN servicos s ON s.id = u.servico_id
       WHERE u.id = $1 AND u.municipio_id = $2`,
      [id, m.id],
    );
    if (!u) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'utilizador_nao_encontrado',
        'Este utilizador não existe nesta câmara.',
      );
    }
    return u;
  }

  private async verificarServico(m: Municipio, servicoId?: string | null) {
    if (!servicoId) return;
    const [s] = await this.db.query(
      'SELECT 1 FROM servicos WHERE id = $1 AND municipio_id = $2',
      [servicoId, m.id],
    );
    if (!s) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'servico_desconhecido',
        'Esse serviço não existe nesta câmara.',
      );
    }
  }
}
