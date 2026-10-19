import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
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
  constructor(private readonly db: DatabaseService) {}

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
              t.formulario, s.nome AS servico,
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
