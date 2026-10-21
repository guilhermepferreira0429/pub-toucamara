import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';

/** O nome do conjunto do município no avaliador (`--conjunto "Perguntas da câmara"`). */
export const NOME_PERGUNTAS_CAMARA = 'Perguntas da câmara';

export const COMPORTAMENTOS = [
  'responder',
  'encaminhar',
  'ocorrencia',
  'perguntar',
  'passar_humano',
  'emergencia',
  'fora_ambito',
  'outra_lingua',
] as const;

const MAXIMO = 200;

export interface PerguntaCamara {
  id: string;
  ordem: number;
  texto: string;
  comportamento: string;
  nota: string | null;
  veredicto: 'certa' | 'passada_bem' | 'errada' | 'sem_resposta' | null;
  avaliada_em: Date | null;
}

/**
 * "As perguntas da câmara" (V2 · Agente): além das perguntas base, as que a
 * câmara mais recebe. Ficam no esquema avaliacao como um conjunto do
 * município; o avaliador corre-as e o resultado aparece aqui. Como no
 * avaliador, um conjunto não se altera: acrescentar ou tirar cria a versão
 * seguinte (com o gabarito das perguntas que ficam), e as execuções antigas
 * continuam a apontar para as perguntas que foram feitas.
 */
@Injectable()
export class PerguntasCamaraService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(m: Municipio) {
    // O veredicto mais recente do nosso sistema para o mesmo texto, em
    // qualquer versão do conjunto (as perguntas mudam de id a cada versão).
    const itens = await this.db.query<PerguntaCamara>(
      `WITH atual AS (
         SELECT id FROM avaliacao.conjuntos
         WHERE nome = $1 AND municipio_id = $2
         ORDER BY versao DESC LIMIT 1
       )
       SELECT p.id, p.ordem, p.texto, p.comportamento, p.nota,
              u.veredicto, u.avaliada_em
       FROM avaliacao.perguntas p
       JOIN atual ON atual.id = p.conjunto_id
       LEFT JOIN LATERAL (
         SELECT f.veredicto, f.criada_em AS avaliada_em
         FROM avaliacao.perguntas p2
         JOIN avaliacao.conjuntos c2 ON c2.id = p2.conjunto_id
         JOIN avaliacao.respostas r ON r.pergunta_id = p2.id
         JOIN avaliacao.execucoes e ON e.id = r.execucao_id
         JOIN avaliacao.sistemas s ON s.id = e.sistema_id AND s.nosso
         JOIN avaliacao.avaliacao_final f ON f.resposta_id = r.id
         WHERE c2.nome = $1 AND c2.municipio_id = $2 AND p2.texto = p.texto
         ORDER BY r.respondida_em DESC
         LIMIT 1
       ) u ON true
       ORDER BY p.ordem`,
      [NOME_PERGUNTAS_CAMARA, m.id],
    );
    const avaliadas = itens.filter((i) => i.veredicto);
    const certas = avaliadas.filter(
      (i) => i.veredicto === 'certa' || i.veredicto === 'passada_bem',
    ).length;
    return {
      conjunto: NOME_PERGUNTAS_CAMARA,
      total: itens.length,
      avaliadas: avaliadas.length,
      certas,
      certas_pct: avaliadas.length
        ? Math.round((certas / avaliadas.length) * 100)
        : null,
      a_corrigir: avaliadas.length - certas,
      itens,
    };
  }

  async acrescentar(
    m: Municipio,
    u: UtilizadorPainel,
    p: { texto: string; comportamento: string; nota?: string | null },
  ) {
    await this.novaVersao(m, u, (atuais) => {
      const texto = p.texto.trim();
      if (atuais.some((a) => a.texto.toLowerCase() === texto.toLowerCase())) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'pergunta_repetida',
          'Essa pergunta já está na lista.',
        );
      }
      if (atuais.length >= MAXIMO) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'demasiadas_perguntas',
          `No máximo ${MAXIMO} perguntas da câmara.`,
        );
      }
      return [
        ...atuais,
        {
          id: null,
          texto,
          comportamento: p.comportamento,
          nota: p.nota ?? null,
        },
      ];
    });
    return this.listar(m);
  }

  async remover(m: Municipio, u: UtilizadorPainel, id: string) {
    await this.novaVersao(m, u, (atuais) => {
      if (!atuais.some((a) => a.id === id)) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrada',
          'Essa pergunta não está na lista atual.',
        );
      }
      return atuais.filter((a) => a.id !== id);
    });
    return this.listar(m);
  }

  private async novaVersao(
    m: Municipio,
    u: UtilizadorPainel,
    mudar: (
      atuais: {
        id: string | null;
        texto: string;
        comportamento: string;
        nota: string | null;
      }[],
    ) => {
      id: string | null;
      texto: string;
      comportamento: string;
      nota: string | null;
    }[],
  ) {
    await this.db.transaction(async (tx) => {
      // A mesma chave do `perguntas importar` do avaliador.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `avaliacao.conjuntos:${NOME_PERGUNTAS_CAMARA}:${m.id}`,
      ]);
      const [anterior] = await tx.query<{ id: string; versao: number }>(
        `SELECT id, versao FROM avaliacao.conjuntos
         WHERE nome = $1 AND municipio_id = $2 ORDER BY versao DESC LIMIT 1`,
        [NOME_PERGUNTAS_CAMARA, m.id],
      );
      const atuais = anterior
        ? await tx.query<{
            id: string;
            texto: string;
            comportamento: string;
            nota: string | null;
          }>(
            `SELECT id, texto, comportamento, nota FROM avaliacao.perguntas
             WHERE conjunto_id = $1 ORDER BY ordem`,
            [anterior.id],
          )
        : [];
      const novas = mudar(atuais);
      const [c] = await tx.query<{ id: string; versao: number }>(
        `INSERT INTO avaliacao.conjuntos (nome, versao, municipio_id)
         VALUES ($1, $2, $3) RETURNING id, versao`,
        [NOME_PERGUNTAS_CAMARA, (anterior?.versao ?? 0) + 1, m.id],
      );
      for (const [i, p] of novas.entries()) {
        const [nova] = await tx.query<{ id: string }>(
          `INSERT INTO avaliacao.perguntas
             (conjunto_id, ordem, categoria, texto, comportamento, nota)
           VALUES ($1, $2, 'camara', $3, $4, $5) RETURNING id`,
          [c.id, i + 1, p.texto, p.comportamento, p.nota],
        );
        if (p.id) await this.copiarGabarito(tx, p.id, nova.id);
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'alterar_perguntas_camara',
          objetoTipo: 'perguntas_camara',
          objetoId: c.id,
          dados: {
            versao: c.versao,
            antes: atuais.length,
            depois: novas.length,
          },
        },
        tx,
      );
    });
  }

  private async copiarGabarito(tx: Tx, de: string, para: string) {
    await tx.query(
      `INSERT INTO avaliacao.gabarito
         (pergunta_id, municipio_id, versao, resposta, factos_obrigatorios,
          factos_proibidos, fontes, estado, proposto_por, aprovado_por, aprovado_em)
       SELECT $2, municipio_id, versao, resposta, factos_obrigatorios,
              factos_proibidos, fontes, estado, proposto_por, aprovado_por, aprovado_em
       FROM avaliacao.gabarito WHERE pergunta_id = $1`,
      [de, para],
    );
  }
}
