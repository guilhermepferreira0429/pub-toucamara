import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AvaliacaoService, EstadoPublicacao } from './avaliacao.service.js';
import {
  diffFrases,
  estadoVersao,
  GateAtual,
  interno,
  Origem,
  precisaDe,
  Revisao,
} from './edicao.js';

/** O gate do avaliador agora, e o início da execução que deixa publicar. */
export interface Gate {
  estado: EstadoPublicacao;
  atual: GateAtual;
}

export interface LinhaVersao {
  id: string;
  numero: number;
  texto_voz: string;
  texto_sms: string | null;
  passa_a_pessoa_quando: string[];
  origem: Origem;
  criada_por: { id: string; nome: string; perfil: string } | null;
  criada_em: Date;
  publicada_em: Date | null;
  eval_execucao_id: string | null;
  no_ar: boolean;
  base_versao_id: string | null;
  base_numero: number | null;
  factos: unknown;
  muda_factos: boolean;
  reverte_de: string | null;
  reverte_de_numero: number | null;
  revisao: Revisao | null;
  revista_por: { id: string; nome: string } | null;
  revista_em: Date | null;
  revisao_nota: string | null;
}

/**
 * Edição das respostas pela câmara (regras em `edicao.ts`): a definição por
 * município, o gate com o início da execução, o histórico com diferenças por
 * frase, a fila de revisão e a revisão da equipa interna.
 */
@Injectable()
export class EdicaoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly avaliacao: AvaliacaoService,
  ) {}

  async definicoes(municipioId: string, tx?: Tx) {
    const [d] = await (tx ?? this.db).query<{
      camara_edita_respostas: boolean;
      atualizado_por: string | null;
      atualizado_em: Date | null;
    }>(
      `SELECT d.camara_edita_respostas, u.nome AS atualizado_por, d.atualizado_em
       FROM conhecimento_definicoes d LEFT JOIN utilizadores u ON u.id = d.atualizado_por
       WHERE d.municipio_id = $1`,
      [municipioId],
    );
    return (
      d ?? {
        camara_edita_respostas: false,
        atualizado_por: null,
        atualizado_em: null,
      }
    );
  }

  /** Só a equipa interna liga ou desliga a edição pela câmara. */
  async alterarDefinicoes(
    municipioId: string,
    u: UtilizadorPainel,
    camaraEdita: boolean,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO conhecimento_definicoes (municipio_id, camara_edita_respostas, atualizado_por)
         VALUES ($1, $2, $3)
         ON CONFLICT (municipio_id) DO UPDATE SET
           camara_edita_respostas = EXCLUDED.camara_edita_respostas,
           atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
        [municipioId, camaraEdita, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'definicoes',
          objetoTipo: 'conhecimento_definicoes',
          objetoId: municipioId,
          dados: { camara_edita_respostas: camaraEdita },
        },
        tx,
      );
    });
    return this.definicoes(municipioId);
  }

  /**
   * Escrever respostas: a equipa interna sempre; a câmara (recurso
   * 'conhecimento', verificado no guard) só com a edição ligada no município.
   */
  async exigirEdicao(
    municipioId: string,
    u: UtilizadorPainel,
    tx?: Tx,
  ): Promise<void> {
    if (interno(u.perfil)) return;
    const d = await this.definicoes(municipioId, tx);
    if (!d.camara_edita_respostas) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'so_equipa_interna',
        'Neste município só a equipa Tou, Câmara? edita e publica respostas.',
      );
    }
  }

  async gate(municipioId: string, tx?: Tx): Promise<Gate> {
    const estado = await this.avaliacao.estadoPublicacao(municipioId, tx);
    const d = estado.decisao;
    let iniciada: Date | null = null;
    if (d.permitir) {
      const [e] = await (tx ?? this.db).query<{ iniciada_em: Date }>(
        'SELECT iniciada_em FROM avaliacao.execucoes WHERE id = $1',
        [d.execucao_id],
      );
      iniciada = e?.iniciada_em ?? null;
    }
    return {
      estado,
      atual: { permitir: d.permitir, execucao_iniciada_em: iniciada },
    };
  }

  /**
   * Histórico de uma resposta, da mais recente para a mais antiga: quem e
   * quando, estado, o que falta para publicar e as diferenças por frase face
   * à versão anterior.
   */
  async historico(municipioId: string, respostaId: string) {
    const [r] = await this.db.query<{ versao_no_ar_id: string | null }>(
      'SELECT versao_no_ar_id FROM respostas WHERE id = $1 AND municipio_id = $2',
      [respostaId, municipioId],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Não encontrei resposta.',
      );
    }
    const [linhas, gate] = await Promise.all([
      this.db.query<LinhaVersao>(
        `SELECT rv.id, rv.numero, rv.texto_voz, rv.texto_sms, rv.passa_a_pessoa_quando,
                rv.origem, rv.criada_em, rv.publicada_em, rv.eval_execucao_id,
                rv.id = r.versao_no_ar_id AS no_ar,
                rv.base_versao_id, b.numero AS base_numero, rv.factos, rv.muda_factos,
                rv.reverte_de, rr.numero AS reverte_de_numero,
                rv.revisao, rv.revista_em, rv.revisao_nota,
                CASE WHEN u.id IS NOT NULL THEN
                  jsonb_build_object('id', u.id, 'nome', u.nome, 'perfil', u.perfil::text) END AS criada_por,
                CASE WHEN ur.id IS NOT NULL THEN
                  jsonb_build_object('id', ur.id, 'nome', ur.nome) END AS revista_por
         FROM resposta_versoes rv
         JOIN respostas r ON r.id = rv.resposta_id
         LEFT JOIN resposta_versoes b ON b.id = rv.base_versao_id
         LEFT JOIN resposta_versoes rr ON rr.id = rv.reverte_de
         LEFT JOIN utilizadores u ON u.id = rv.criada_por
         LEFT JOIN utilizadores ur ON ur.id = rv.revista_por
         WHERE rv.resposta_id = $1
         ORDER BY rv.numero`,
        [respostaId],
      ),
      this.gate(municipioId),
    ]);
    const versoes = linhas.map((v, i) => {
      const ant = i > 0 ? linhas[i - 1] : null;
      return {
        ...this.comEstado(v, gate),
        diff: {
          anterior_numero: ant?.numero ?? null,
          texto_voz: diffFrases(ant?.texto_voz, v.texto_voz),
          texto_sms: diffFrases(ant?.texto_sms, v.texto_sms),
          passa_a_pessoa_quando: {
            adicionados: v.passa_a_pessoa_quando.filter(
              (x) => !(ant?.passa_a_pessoa_quando ?? []).includes(x),
            ),
            removidos: (ant?.passa_a_pessoa_quando ?? []).filter(
              (x) => !v.passa_a_pessoa_quando.includes(x),
            ),
          },
        },
      };
    });
    return {
      resposta_id: respostaId,
      versao_no_ar_id: r.versao_no_ar_id,
      versoes: versoes.reverse(),
    };
  }

  /**
   * Fila da equipa interna: a última versão de cada resposta escrita pela
   * câmara, por publicar e não rejeitada, com o que lhe falta.
   */
  async revisoes(municipioId: string) {
    const [linhas, gate] = await Promise.all([
      this.db.query<{
        origem: Origem;
        muda_factos: boolean;
        revisao: Revisao | null;
        criada_em: Date;
        publicada_em: Date | null;
      }>(
        `SELECT rv.id AS versao_id, rv.resposta_id, r.pergunta_tipo, r.estado AS estado_resposta,
                rv.numero, rv.origem, rv.criada_em, rv.publicada_em, u.nome AS criada_por,
                rv.muda_factos, rv.factos, rv.revisao, rv.revista_em
         FROM resposta_versoes rv
         JOIN respostas r ON r.id = rv.resposta_id
         LEFT JOIN utilizadores u ON u.id = rv.criada_por
         WHERE r.municipio_id = $1 AND rv.origem = 'camara' AND rv.publicada_em IS NULL
           AND rv.revisao IS DISTINCT FROM 'rejeitada'
           AND rv.numero = (SELECT max(x.numero) FROM resposta_versoes x WHERE x.resposta_id = rv.resposta_id)
         ORDER BY rv.criada_em DESC
         LIMIT 200`,
        [municipioId],
      ),
      this.gate(municipioId),
    ]);
    return {
      pode_publicar_agora: gate.atual.permitir,
      itens: linhas.map((l) => ({
        ...l,
        estado: estadoVersao(l, false),
        precisa_de: precisaDe(l, gate.atual),
      })),
    };
  }

  /**
   * Revisão da equipa interna de uma versão por publicar: aprovar tira o
   * 'revisao_interna' do caminho (o gate continua); rejeitar impede a câmara
   * de a publicar.
   */
  async rever(
    municipioId: string,
    u: UtilizadorPainel,
    respostaId: string,
    versaoId: string,
    decisao: 'aprovar' | 'rejeitar',
    nota: string | null,
  ) {
    const revisao: Revisao = decisao === 'aprovar' ? 'aprovada' : 'rejeitada';
    await this.db.transaction(async (tx) => {
      const [v] = await tx.query<{ publicada_em: Date | null }>(
        `SELECT rv.publicada_em FROM resposta_versoes rv JOIN respostas r ON r.id = rv.resposta_id
         WHERE rv.id = $1 AND rv.resposta_id = $2 AND r.municipio_id = $3
         FOR UPDATE OF rv`,
        [versaoId, respostaId, municipioId],
      );
      if (!v) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Não encontrei versão.',
        );
      }
      if (v.publicada_em) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'versao_ja_publicada',
          'Esta versão já foi publicada.',
        );
      }
      await tx.query(
        `UPDATE resposta_versoes SET revisao = $2, revista_por = $3, revista_em = now(), revisao_nota = $4
         WHERE id = $1`,
        [versaoId, revisao, u.id, nota],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'rever',
          objetoTipo: 'resposta',
          objetoId: respostaId,
          dados: { versao_id: versaoId, revisao, nota },
        },
        tx,
      );
    });
  }

  /** Versão com estado e, se ainda não foi publicada, o que lhe falta. */
  comEstado<
    V extends {
      origem: Origem;
      muda_factos: boolean;
      revisao: Revisao | null;
      criada_em: Date | string;
      publicada_em: Date | string | null;
      no_ar: boolean;
    },
  >(v: V, gate: Gate) {
    return {
      ...v,
      estado: estadoVersao(v, v.no_ar),
      precisa_de: v.publicada_em ? [] : precisaDe(v, gate.atual),
    };
  }
}
