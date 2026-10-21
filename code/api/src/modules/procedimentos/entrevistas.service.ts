import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { pode } from '../auth/permissoes.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  conteudoEntrevista,
  conteudoRascunho,
  esquemaProximaPergunta,
  esquemaRascunhoIa,
  SISTEMA_ENTREVISTA,
  SISTEMA_RASCUNHO,
} from './ia.js';
import { ProcedimentosService } from './procedimentos.service.js';
import {
  CHAVES,
  Conteudo,
  esquemaConteudo,
  guiao,
  MAX_PERGUNTAS,
  montarRascunho,
  PerguntaGuiao,
  proximaDoGuiao,
} from './regras.js';

export const esquemaIniciar = z.object({
  area: z.string().trim().min(2).max(200),
  servico_id: z.uuid().nullable().optional(),
});

export const esquemaResponder = z.union([
  z.object({
    resposta: z.string().trim().min(1).max(6000),
    por_voz: z.boolean().optional(),
  }),
  z.object({ saltar: z.literal(true) }),
]);

export interface Entrevista {
  id: string;
  area: string;
  servico_id: string | null;
  entrevistado_id: string;
  entrevistado_nome: string;
  modo: 'ia' | 'guiao';
  estado: 'em_curso' | 'concluida' | 'cancelada';
  procedimento_id: string | null;
  criada_em: string;
  concluida_em: string | null;
}

export interface Turno {
  id: string;
  ordem: number;
  chave: string;
  pergunta: string;
  resposta: string | null;
  por_voz: boolean;
  respondida_em: string | null;
}

/**
 * Entrevista de quem se vai reformar: o assistente faz perguntas uma a uma
 * (o que faz, passo a passo, onde está cada coisa, a quem perguntar,
 * exceções, erros comuns), guarda as respostas e no fim escreve um rascunho
 * de procedimento para rever.
 *
 * Com IA, o Claude escolhe a pergunta seguinte (pode pedir pormenores) e
 * redige o rascunho. Sem IA (ou se a IA falhar), segue o guião fixo e o
 * rascunho é montado das respostas.
 */
@Injectable()
export class EntrevistasService {
  private readonly logger = new Logger(EntrevistasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly auditoria: AuditoriaService,
    private readonly procedimentos: ProcedimentosService,
  ) {}

  listar(m: Municipio) {
    return this.db
      .query(
        `SELECT e.id, e.area, e.modo, e.estado, e.procedimento_id, e.criada_em, e.concluida_em,
                e.entrevistado_id, u.nome AS entrevistado_nome,
                (SELECT count(*)::int FROM entrevista_turnos t
                 WHERE t.entrevista_id = e.id AND t.respondida_em IS NOT NULL) AS respondidas
         FROM entrevistas e JOIN utilizadores u ON u.id = e.entrevistado_id
         WHERE e.municipio_id = $1 AND e.estado <> 'cancelada'
         ORDER BY e.criada_em DESC, e.id DESC LIMIT 50`,
        [m.id],
      )
      .then((itens) => ({ itens }));
  }

  async iniciar(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaIniciar>,
  ) {
    const modo = this.claude.disponivel ? 'ia' : 'guiao';
    const primeira = guiao(d.area)[0];
    const id = await this.db.transaction(async (tx) => {
      if (d.servico_id) {
        const [s] = await tx.query(
          `SELECT 1 FROM servicos WHERE id = $1 AND municipio_id = $2`,
          [d.servico_id, m.id],
        );
        if (!s)
          throw new ErroApi(
            HttpStatus.BAD_REQUEST,
            'servico_invalido',
            'Esse serviço não existe.',
          );
      }
      const [e] = await tx.query<{ id: string }>(
        `INSERT INTO entrevistas (municipio_id, area, servico_id, entrevistado_id, modo)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [m.id, d.area, d.servico_id ?? null, u.id, modo],
      );
      await this.novoTurno(tx, e.id, 1, primeira);
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'iniciar_entrevista',
          objetoTipo: 'entrevista',
          objetoId: e.id,
          dados: { area: d.area, modo },
        },
        tx,
      );
      return e.id;
    });
    return this.detalhe(m, id);
  }

  async detalhe(m: Municipio, id: string) {
    const e = await this.entrevista(m.id, id);
    const turnos = await this.turnos(this.db, id);
    const atual = turnos.find((t) => !t.respondida_em) ?? null;
    return {
      ...e,
      guiao_total: guiao(e.area).length,
      max_perguntas: MAX_PERGUNTAS,
      turnos,
      pergunta_atual: e.estado === 'em_curso' ? atual : null,
      pode_concluir: e.estado === 'em_curso' && turnos.some((t) => t.resposta),
    };
  }

  /** Grava a resposta à pergunta atual e faz a seguinte (ou diz que acabou). */
  async responder(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaResponder>,
  ) {
    const e = await this.entrevista(m.id, id);
    this.verificarQuem(u, e);
    this.verificarEmCurso(e);

    const turnos = await this.db.transaction(async (tx) => {
      const ts = await this.turnos(tx, id, true);
      const atual = ts.find((t) => !t.respondida_em);
      if (!atual) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'sem_pergunta',
          'Já não há perguntas: conclua a entrevista.',
        );
      }
      const resposta = 'resposta' in d ? d.resposta : null;
      const porVoz = 'resposta' in d ? !!d.por_voz : false;
      await tx.query(
        `UPDATE entrevista_turnos SET resposta = $2, por_voz = $3, respondida_em = now() WHERE id = $1`,
        [atual.id, resposta, porVoz],
      );
      atual.resposta = resposta;
      atual.respondida_em = new Date().toISOString();
      return ts;
    });

    // A seguinte fora da transação (a IA pode demorar).
    const seguinte = await this.seguinte(e, turnos);
    if (seguinte) {
      await this.db.transaction((tx) =>
        this.novoTurno(tx, id, turnos.length + 1, seguinte),
      );
    }
    return this.detalhe(m, id);
  }

  /** Fecha a entrevista e escreve o rascunho de procedimento (autor: o entrevistado). */
  async concluir(m: Municipio, u: UtilizadorPainel, id: string) {
    const e = await this.entrevista(m.id, id);
    this.verificarQuem(u, e);
    this.verificarEmCurso(e);
    const turnos = (await this.turnos(this.db, id)).filter((t) => t.resposta);
    if (!turnos.length) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_respostas',
        'Responda pelo menos a uma pergunta antes de concluir.',
      );
    }

    const semIa = montarRascunho(e.area, turnos, e.servico_id);
    let conteudo: Conteudo = semIa;
    let ia = false;
    let motivoSemIa: string | null = null;
    if (e.modo === 'ia' && this.claude.disponivel) {
      try {
        const r = await this.claude.extrair(esquemaRascunhoIa, {
          sistema: SISTEMA_RASCUNHO,
          conteudo: conteudoRascunho(e.area, e.entrevistado_nome, turnos),
          esforco: 'high',
          maxTokens: 8000,
        });
        const v = esquemaConteudo.safeParse({
          ...r,
          area: e.area,
          servico_id: e.servico_id,
        });
        if (v.success) {
          conteudo = v.data;
          ia = true;
        } else {
          motivoSemIa =
            'O rascunho da IA não veio no formato certo: foi montado das respostas.';
        }
      } catch (err) {
        this.logger.warn(
          `Rascunho da entrevista ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        motivoSemIa =
          'Não foi possível escrever o rascunho com IA agora: foi montado das respostas.';
      }
    } else {
      motivoSemIa =
        'O assistente de IA não está configurado: o rascunho foi montado das respostas.';
    }

    const p = await this.db.transaction(async (tx) => {
      const [ainda] = await tx.query<{ estado: string }>(
        `SELECT estado FROM entrevistas WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (ainda?.estado !== 'em_curso') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'A entrevista já foi concluída.',
        );
      }
      const novo = await this.procedimentos.criar(
        m,
        u,
        conteudo,
        {
          origem: 'entrevista',
          entrevistaId: id,
          autorId: e.entrevistado_id,
          nota: ia
            ? 'Rascunho escrito com IA a partir da entrevista.'
            : 'Rascunho montado das respostas da entrevista.',
        },
        tx,
      );
      await tx.query(
        `UPDATE entrevistas SET estado = 'concluida', concluida_em = now(), procedimento_id = $2 WHERE id = $1`,
        [id, novo.id],
      );
      // Perguntas por responder ficam de fora.
      await tx.query(
        `DELETE FROM entrevista_turnos WHERE entrevista_id = $1 AND respondida_em IS NULL`,
        [id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'concluir_entrevista',
          objetoTipo: 'entrevista',
          objetoId: id,
          dados: { procedimento_id: novo.id, ia },
        },
        tx,
      );
      return novo;
    });
    return {
      procedimento_id: p.id,
      ia,
      motivo_sem_ia: motivoSemIa,
      rascunho: conteudo,
    };
  }

  async cancelar(m: Municipio, u: UtilizadorPainel, id: string) {
    const e = await this.entrevista(m.id, id);
    this.verificarQuem(u, e);
    this.verificarEmCurso(e);
    await this.db.query(
      `UPDATE entrevistas SET estado = 'cancelada' WHERE id = $1`,
      [id],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'cancelar_entrevista',
      objetoTipo: 'entrevista',
      objetoId: id,
    });
    return { id, estado: 'cancelada' };
  }

  /** A pergunta seguinte: da IA (com seguimentos) ou do guião. null = acabou. */
  private async seguinte(
    e: Entrevista,
    turnos: Turno[],
  ): Promise<PerguntaGuiao | null> {
    if (turnos.length >= MAX_PERGUNTAS) return null;
    const feitas = turnos.map((t) => t.chave);
    const doGuiao = proximaDoGuiao(e.area, feitas);
    if (e.modo !== 'ia' || !this.claude.disponivel) return doGuiao;
    try {
      const porCobrir = CHAVES.filter((c) => !feitas.includes(c));
      const r = await this.claude.extrair(esquemaProximaPergunta, {
        sistema: SISTEMA_ENTREVISTA,
        conteudo: conteudoEntrevista(
          e.area,
          turnos,
          porCobrir,
          MAX_PERGUNTAS - turnos.length,
        ),
        esforco: 'low',
        maxTokens: 1500,
      });
      if (r.terminar || !r.pergunta.trim())
        return porCobrir.length ? doGuiao : null;
      return { chave: r.chave, pergunta: r.pergunta.trim().slice(0, 600) };
    } catch (err) {
      this.logger.warn(
        `Pergunta seguinte da entrevista ${e.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return doGuiao;
    }
  }

  private async novoTurno(tx: Tx, id: string, ordem: number, p: PerguntaGuiao) {
    await tx.query(
      `INSERT INTO entrevista_turnos (entrevista_id, ordem, chave, pergunta) VALUES ($1, $2, $3, $4)`,
      [id, ordem, p.chave, p.pergunta],
    );
  }

  private verificarQuem(u: UtilizadorPainel, e: Entrevista) {
    if (e.entrevistado_id === u.id || pode(u.perfil, 'procedimentos')) return;
    throw new ErroApi(
      HttpStatus.FORBIDDEN,
      'sem_permissao',
      'Só quem está a ser entrevistado (ou a chefia) responde.',
      {
        recurso: 'procedimentos',
      },
    );
  }

  private verificarEmCurso(e: Entrevista) {
    if (e.estado !== 'em_curso') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'estado_invalido',
        'A entrevista já não está em curso.',
      );
    }
  }

  private turnos(db: Pick<Tx, 'query'>, id: string, bloquear = false) {
    return db.query<Turno>(
      `SELECT id, ordem, chave, pergunta, resposta, por_voz, respondida_em
       FROM entrevista_turnos WHERE entrevista_id = $1 ORDER BY ordem ${bloquear ? 'FOR UPDATE' : ''}`,
      [id],
    );
  }

  private async entrevista(
    municipioId: string,
    id: string,
  ): Promise<Entrevista> {
    const [e] = await this.db.query<Entrevista>(
      `SELECT e.id, e.area, e.servico_id, e.entrevistado_id, u.nome AS entrevistado_nome, e.modo,
              e.estado, e.procedimento_id, e.criada_em, e.concluida_em
       FROM entrevistas e JOIN utilizadores u ON u.id = e.entrevistado_id
       WHERE e.id = $1 AND e.municipio_id = $2`,
      [id, municipioId],
    );
    if (!e)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Entrevista não existe.',
      );
    return e;
  }
}
