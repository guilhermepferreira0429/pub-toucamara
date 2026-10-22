import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import type { Periodo } from '../painel/periodos.js';
import {
  indicadoresSatisfacao,
  ULTIMOS_COMENTARIOS,
} from './satisfacao.regras.js';

/** O que a página pública vê: nunca o comentário (o link pode passar de mão). */
export interface EstadoPublico {
  respondida: boolean;
  nota: number | null;
}

/**
 * Inquérito de satisfação no fim do atendimento: a pergunta está na página
 * do resumo (link do SMS do fim da chamada), por isso não custa um SMS a
 * mais. Uma resposta por conversa; o código do link é a autorização.
 */
@Injectable()
export class SatisfacaoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly links: LinksCurtosService,
  ) {}

  async estado(codigo: string): Promise<EstadoPublico> {
    const { destinoId } = await this.links.resolver(codigo, 'resumo');
    const [r] = await this.db.query<{ nota: number }>(
      'SELECT nota FROM satisfacao_respostas WHERE conversa_id = $1',
      [destinoId],
    );
    return { respondida: !!r, nota: r?.nota ?? null };
  }

  /**
   * Idempotente: a segunda resposta (duplo clique, outro separador) não
   * muda a primeira; devolve o que ficou guardado.
   */
  async responder(
    codigo: string,
    nota: number,
    comentario: string | null,
  ): Promise<EstadoPublico> {
    const { destinoId, municipioId } = await this.links.resolver(
      codigo,
      'resumo',
    );
    const [c] = await this.db.query<{ id: string }>(
      'SELECT id FROM conversas WHERE id = $1 AND municipio_id = $2',
      [destinoId, municipioId],
    );
    if (!c) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe ou já expirou.',
      );
    }
    await this.db.query(
      `INSERT INTO satisfacao_respostas (municipio_id, conversa_id, nota, comentario)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversa_id) DO NOTHING`,
      [municipioId, destinoId, nota, comentario],
    );
    return this.estado(codigo);
  }

  /**
   * Cartão "Satisfação" do painel: nota média, taxa de resposta (respostas /
   * conversas com link do resumo) e os últimos comentários, tudo pelas
   * conversas iniciadas no período (dias no fuso do município).
   */
  async painel(m: Municipio, p: Periodo, comComentarios: boolean) {
    const [conta] = await this.db.query<{
      respostas: number;
      soma: number;
      elegiveis: number;
      por_nota: number[];
    }>(
      `WITH conv AS (
         SELECT c.id FROM conversas c
         WHERE c.municipio_id = $1 AND c.oculto_em IS NULL
           AND (c.iniciada_em AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date)
       SELECT
         (SELECT count(*) FROM satisfacao_respostas s JOIN conv ON conv.id = s.conversa_id)::int AS respostas,
         (SELECT coalesce(sum(s.nota), 0) FROM satisfacao_respostas s JOIN conv ON conv.id = s.conversa_id)::int AS soma,
         (SELECT count(DISTINCT l.destino_id) FROM links_curtos l JOIN conv ON conv.id = l.destino_id
          WHERE l.municipio_id = $1 AND l.destino_tipo = 'resumo')::int AS elegiveis,
         ARRAY(SELECT (SELECT count(*) FROM satisfacao_respostas s JOIN conv ON conv.id = s.conversa_id
                       WHERE s.nota = n)::int
               FROM generate_series(1, 5) n ORDER BY n) AS por_nota`,
      [m.id, m.fuso, p.de, p.ate],
    );
    const comentarios = !comComentarios
      ? null
      : await this.db.query<{
          conversa_id: string;
          nota: number;
          comentario: string;
          respondida_em: Date;
        }>(
          `SELECT s.conversa_id, s.nota, s.comentario, s.respondida_em
       FROM satisfacao_respostas s JOIN conversas c ON c.id = s.conversa_id
       WHERE s.municipio_id = $1 AND s.comentario IS NOT NULL AND c.oculto_em IS NULL
         AND (c.iniciada_em AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
       ORDER BY s.respondida_em DESC
       LIMIT $5`,
          [m.id, m.fuso, p.de, p.ate, ULTIMOS_COMENTARIOS],
        );
    return {
      periodo: p,
      ...indicadoresSatisfacao(conta),
      comentarios,
    };
  }
}
