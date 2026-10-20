import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { infoSms } from '../comunicacao/sms.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { ProcessosService } from '../processos/processos.service.js';
import {
  analisarCorpo,
  CanalModelo,
  CORPO_SMS_MAX,
  dataCurta,
  dataPorExtenso,
  EstadoModelo,
  juntarLista,
  podeTransitar,
  preencher,
  transicoesDe,
  Valores,
  VARIAVEIS,
} from './modelos.js';

export interface LinhaModelo {
  id: string;
  familia_id: string;
  canal: CanalModelo;
  nome: string;
  corpo: string;
  estado: EstadoModelo;
  versao: number;
  atualizado_em: Date;
}

const COLUNAS = `m.id, m.familia_id, m.canal, m.nome, m.corpo, m.estado, m.versao,
  m.aprovado_por, ua.nome AS aprovado_por_nome, m.aprovado_em,
  m.criado_por, uc.nome AS criado_por_nome, m.criado_em,
  m.atualizado_por, uu.nome AS atualizado_por_nome, m.atualizado_em, m.substituido_em`;
const JUNTAR = `LEFT JOIN utilizadores ua ON ua.id = m.aprovado_por
  LEFT JOIN utilizadores uc ON uc.id = m.criado_por
  LEFT JOIN utilizadores uu ON uu.id = m.atualizado_por`;

export interface NovoModelo {
  canal: CanalModelo;
  nome: string;
  corpo: string;
}

export interface MudancaModelo {
  nome?: string;
  corpo?: string;
  estado?: EstadoModelo;
}

/**
 * Modelos de resposta da câmara (ofícios, emails, SMS): versões, aprovação e
 * pré-visualização com os dados de um processo. Os rascunhos do técnico
 * (`processos-apoio`) usam o aprovado mais recente do canal.
 */
@Injectable()
export class ModelosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly processos: ProcessosService,
  ) {}

  /** Por atualização (mais recentes primeiro); os substituídos só a pedido. */
  async listar(
    municipioId: string,
    f: {
      canal?: CanalModelo;
      estado?: EstadoModelo;
      q?: string;
    },
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<LinhaModelo>(
      `SELECT ${COLUNAS}
       FROM modelos_resposta m ${JUNTAR}
       WHERE m.municipio_id = $1
         AND ($2::text IS NULL OR m.canal = $2)
         AND (CASE WHEN $3::text IS NULL THEN m.estado <> 'substituido' ELSE m.estado = $3 END)
         AND ($4::text IS NULL OR m.nome ILIKE '%' || $4 || '%')
         AND ($5::timestamptz IS NULL OR (m.atualizado_em, m.id) < ($5::timestamptz, $6::uuid))
       ORDER BY m.atualizado_em DESC, m.id DESC
       LIMIT $7`,
      [
        municipioId,
        f.canal ?? null,
        f.estado ?? null,
        f.q ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    const p = pagina(linhas, limite, (l) => ({
      em: l.atualizado_em,
      id: l.id,
    }));
    return { ...p, itens: p.itens.map((l) => comAnalise(l)) };
  }

  /** Um modelo, com a análise das variáveis e todas as versões da família. */
  async ver(municipioId: string, id: string) {
    const m = await this.carregar(this.db, municipioId, id);
    const versoes = await this.db.query(
      `SELECT m.id, m.versao, m.estado, m.nome, m.corpo, m.aprovado_em,
              ua.nome AS aprovado_por_nome, m.criado_em, uc.nome AS criado_por_nome,
              m.atualizado_em, m.substituido_em
       FROM modelos_resposta m ${JUNTAR}
       WHERE m.familia_id = $1 AND m.municipio_id = $2
       ORDER BY m.versao DESC`,
      [m.familia_id, municipioId],
    );
    return {
      ...comAnalise(m),
      transicoes: transicoesDe(m.estado),
      versoes,
    };
  }

  async criar(municipioId: string, u: UtilizadorPainel, d: NovoModelo) {
    exigirCorpoValido(d.corpo, d.canal);
    const id = await this.db.transaction(async (tx) => {
      const [m] = await tx.query<{ id: string }>(
        `INSERT INTO modelos_resposta (municipio_id, canal, nome, corpo, criado_por, atualizado_por)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [municipioId, d.canal, d.nome, d.corpo, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar',
          objetoTipo: 'modelo_resposta',
          objetoId: m.id,
          dados: { canal: d.canal, nome: d.nome },
        },
        tx,
      );
      return m.id;
    });
    return this.ver(municipioId, id);
  }

  /**
   * Editar e mudar de estado. Num aprovado, mudar nome ou corpo cria a versão
   * seguinte em rascunho (devolvida com `nova_versao: true`); a aprovada
   * continua em uso até a nova ser aprovada. Aprovar exige 'a_rever' e passa
   * a aprovada anterior da família a 'substituido'.
   */
  async atualizar(
    municipioId: string,
    u: UtilizadorPainel,
    id: string,
    d: MudancaModelo,
  ) {
    const r = await this.db.transaction(async (tx) => {
      const atual = await this.carregar(tx, municipioId, id, true);
      if (atual.estado === 'substituido') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'modelo_substituido',
          'Esta versão já foi substituída: edite a versão mais recente.',
        );
      }
      const nome = d.nome ?? atual.nome;
      const corpo = d.corpo ?? atual.corpo;
      const mudaTexto = nome !== atual.nome || corpo !== atual.corpo;
      if (mudaTexto) exigirCorpoValido(corpo, atual.canal);

      let alvo = atual;
      let novaVersao = false;
      if (mudaTexto && atual.estado === 'aprovado') {
        const [emCurso] = await tx.query<{ id: string }>(
          `SELECT id FROM modelos_resposta
           WHERE familia_id = $1 AND estado IN ('rascunho', 'a_rever')`,
          [atual.familia_id],
        );
        if (emCurso) {
          throw new ErroApi(
            HttpStatus.CONFLICT,
            'modelo_tem_versao_em_curso',
            'Já há uma versão nova deste modelo em curso: edite essa.',
            { modelo_id: emCurso.id },
          );
        }
        const [nova] = await tx.query<{ id: string }>(
          `INSERT INTO modelos_resposta (municipio_id, familia_id, canal, nome, corpo, versao, criado_por, atualizado_por)
           SELECT $1, $2, $3, $4, $5, max(versao) + 1, $6, $6
           FROM modelos_resposta WHERE familia_id = $2
           RETURNING id`,
          [municipioId, atual.familia_id, atual.canal, nome, corpo, u.id],
        );
        alvo = await this.carregar(tx, municipioId, nova.id, true);
        novaVersao = true;
      } else if (mudaTexto) {
        await tx.query(
          `UPDATE modelos_resposta SET nome = $2, corpo = $3, atualizado_por = $4, atualizado_em = now()
           WHERE id = $1`,
          [id, nome, corpo, u.id],
        );
      }

      const para = d.estado ?? alvo.estado;
      if (!podeTransitar(alvo.estado, para)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'transicao_invalida',
          novaVersao
            ? 'A versão nova começa em rascunho: passe-a a "a rever" antes de a aprovar.'
            : `Um modelo em '${alvo.estado}' não pode passar a '${para}'.`,
          { de: alvo.estado, para, permitidas: transicoesDe(alvo.estado) },
        );
      }
      if (para !== alvo.estado) {
        if (para === 'aprovado') exigirCorpoValido(corpo, alvo.canal);
        await tx.query(
          `UPDATE modelos_resposta SET estado = $2, atualizado_por = $3, atualizado_em = now(),
                  aprovado_por = CASE WHEN $2 = 'aprovado' THEN $3::uuid END,
                  aprovado_em = CASE WHEN $2 = 'aprovado' THEN now() END
           WHERE id = $1`,
          [alvo.id, para, u.id],
        );
        if (para === 'aprovado') {
          await tx.query(
            `UPDATE modelos_resposta SET estado = 'substituido', substituido_em = now()
             WHERE familia_id = $1 AND id <> $2 AND estado = 'aprovado'`,
            [alvo.familia_id, alvo.id],
          );
        }
      }
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao:
            para === 'aprovado' && alvo.estado !== 'aprovado'
              ? 'aprovar'
              : novaVersao
                ? 'nova_versao'
                : 'atualizar',
          objetoTipo: 'modelo_resposta',
          objetoId: alvo.id,
          dados: {
            de: alvo.estado,
            para,
            versao: alvo.versao,
            muda_texto: mudaTexto,
            ...(novaVersao ? { versao_anterior_id: atual.id } : {}),
          },
        },
        tx,
      );
      return { id: alvo.id, novaVersao };
    });
    return {
      ...(await this.ver(municipioId, r.id)),
      nova_versao: r.novaVersao,
    };
  }

  /**
   * O texto do modelo com os dados reais de um processo (qualquer estado do
   * modelo, para rever antes de aprovar). Só lê: sem link válido do
   * processo, `{link}` fica por completar.
   */
  async preVisualizar(municipio: Municipio, id: string, processoId: string) {
    const m = await this.carregar(this.db, municipio.id, id);
    const [p] = await this.db.query<{
      id: string;
      tipo_processo_id: string;
      numero: string;
      tipo: string;
      morada: string | null;
      nome: string | null;
      prazo_fim: string | null;
    }>(
      `SELECT p.id, p.tipo_processo_id, p.numero, tp.nome AS tipo, p.morada,
              mu.nome, to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim
       FROM processos p
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       LEFT JOIN municipes mu ON mu.id = p.municipe_id
       WHERE p.id = $1 AND p.municipio_id = $2`,
      [processoId, municipio.id],
    );
    if (!p) throw naoEncontrado('o processo');
    const [docs, [link]] = await Promise.all([
      this.processos.emFalta(p),
      this.db.query<{ codigo: string }>(
        `SELECT codigo FROM links_curtos
         WHERE destino_tipo = 'processo' AND destino_id = $1 AND municipio_id = $2
           AND expira_em > now()
         ORDER BY expira_em DESC LIMIT 1`,
        [p.id, municipio.id],
      ),
    ]);
    // O prazo do pedido em aberto mais próximo; sem pedidos, o do processo.
    const prazos = docs.em_falta
      .map((x) => x.prazo)
      .filter((x): x is string => !!x)
      .sort();
    const valores: Valores = {
      nome: p.nome,
      numero_processo: p.numero,
      tipo_processo: p.tipo,
      morada: p.morada,
      prazo: dataCurta(prazos[0] ?? p.prazo_fim),
      documentos_em_falta: juntarLista(docs.faltam),
      link: link
        ? `${this.config.get<string>('app.webUrl') ?? ''}/r/${link.codigo}`
        : null,
      data: dataPorExtenso(new Date(), municipio.fuso),
      municipio: municipio.nome,
    };
    const { texto, em_falta } = preencher(m.corpo, valores);
    const usadas = analisarCorpo(m.corpo).variaveis;
    return {
      modelo_id: m.id,
      processo_id: p.id,
      canal: m.canal,
      estado: m.estado,
      texto,
      valores: Object.fromEntries(usadas.map((v) => [v, valores[v] ?? null])),
      em_falta,
      sms: m.canal === 'sms' ? infoSms(texto) : null,
    };
  }

  private async carregar(
    q: Tx | DatabaseService,
    municipioId: string,
    id: string,
    bloquear = false,
  ) {
    const [m] = await q.query<
      LinhaModelo & {
        aprovado_por: string | null;
        aprovado_em: Date | null;
      }
    >(
      `SELECT ${COLUNAS}
       FROM modelos_resposta m ${JUNTAR}
       WHERE m.id = $1 AND m.municipio_id = $2
       ${bloquear ? 'FOR UPDATE OF m' : ''}`,
      [id, municipioId],
    );
    if (!m) throw naoEncontrado('o modelo');
    return m;
  }
}

/** A linha com as variáveis usadas e, num SMS, caracteres e partes. */
function comAnalise<T extends { canal: CanalModelo; corpo: string }>(m: T) {
  const a = analisarCorpo(m.corpo);
  return {
    ...m,
    variaveis: a.variaveis,
    variaveis_invalidas: a.desconhecidas,
    // Com as variáveis por preencher: o SMS real é o da pré-visualização.
    sms: m.canal === 'sms' ? infoSms(m.corpo) : null,
  };
}

function exigirCorpoValido(corpo: string, canal: CanalModelo): void {
  if (canal === 'sms' && corpo.length > CORPO_SMS_MAX) {
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      'sms_demasiado_longo',
      `Um modelo de SMS tem no máximo ${CORPO_SMS_MAX} caracteres.`,
      { caracteres: corpo.length, maximo: CORPO_SMS_MAX },
    );
  }
  const a = analisarCorpo(corpo);
  if (a.valido) return;
  throw new ErroApi(
    HttpStatus.BAD_REQUEST,
    'variaveis_invalidas',
    a.desconhecidas.length
      ? `O modelo usa variáveis que não existem: ${a.desconhecidas.join(', ')}.`
      : 'O modelo tem chavetas sem par.',
    {
      desconhecidas: a.desconhecidas,
      chavetas_soltas: a.chavetas_soltas,
      suportadas: Object.entries(VARIAVEIS).map(([nome, v]) => ({
        nome: `{${nome}}`,
        descricao: v.descricao,
      })),
    },
  );
}

function naoEncontrado(o_que: string): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'nao_encontrado',
    `Não encontrei ${o_que}.`,
  );
}
