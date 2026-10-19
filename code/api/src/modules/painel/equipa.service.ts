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

const COLUNAS = `u.id, u.email, u.nome, u.perfil, u.servico_id, s.nome AS servico,
  u.foto_url, u.ativo, u.ultimo_acesso_em, u.criado_em`;

@Injectable()
export class EquipaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
  ) {}

  listar(m: Municipio) {
    return this.db.query(
      `SELECT ${COLUNAS} FROM utilizadores u
       LEFT JOIN servicos s ON s.id = u.servico_id
       WHERE u.municipio_id = $1
       ORDER BY u.ativo DESC, u.nome`,
      [m.id],
    );
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
