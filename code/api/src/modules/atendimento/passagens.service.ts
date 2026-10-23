import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { indiceTelefoneDemo } from '../demo/demo.regras.js';
import {
  mascararTelefone,
  MunicipesService,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { quandoPorExtenso } from './horario.js';
import { HorarioService } from './horario.service.js';

export type MotivoPassagem =
  'pedido' | 'sem_fonte' | 'juridico' | 'politica' | 'processo' | 'outro';
export type PreferenciaResposta = 'chat' | 'telefone' | 'sms' | 'email';
export type EstadoPassagem = 'aberta' | 'em_curso' | 'respondida' | 'fechada';

/** O que o agente diz ao passar o caso. */
export function frasePassagem(a: {
  foraDeHoras: boolean;
  quando: string;
  preferencia: PreferenciaResposta;
}): string {
  const inicio = a.foraDeHoras
    ? 'Os serviços estão fechados neste momento, mas já passei o seu caso a um colega, com tudo o que me disse.'
    : 'Passei o seu caso a um colega, com tudo o que me disse.';
  const fim =
    a.preferencia === 'telefone'
      ? `Ele liga-lhe até ${a.quando}.`
      : a.preferencia === 'chat'
        ? `Responde-lhe aqui até ${a.quando}.`
        : `Responde-lhe até ${a.quando}, por ${a.preferencia === 'email' ? 'email' : 'SMS'}.`;
  return `${inicio} ${fim}`;
}

/**
 * Chave do SMS/email de resposta: a mesma passagem com o mesmo texto não
 * sai duas vezes (duplo clique no painel); outro texto é outra mensagem.
 */
export function chaveResposta(passagemId: string, texto: string): string {
  const h = createHash('sha256').update(texto).digest('hex').slice(0, 16);
  return `passagem:${passagemId}:${h}`;
}

interface LinhaPassagem {
  id: string;
  conversa_id: string;
  motivo: MotivoPassagem;
  resumo: string;
  estado: EstadoPassagem;
  fora_de_horas: boolean;
  preferencia_resposta: PreferenciaResposta | null;
  responder_ate: Date | null;
  atrasada: boolean;
  criada_em: Date;
  respondida_em: Date | null;
  atribuida_a: { id: string; nome: string } | null;
  canal: string;
  municipe_id: string | null;
  municipe_nome: string | null;
  telefone_e164: string | null;
  email: string | null;
}

const SELECT_PASSAGEM = `
  SELECT p.id, p.conversa_id, p.motivo, p.resumo, p.estado, p.fora_de_horas,
         p.preferencia_resposta, p.responder_ate, p.criada_em, p.respondida_em,
         (p.estado IN ('aberta','em_curso') AND p.responder_ate < now()) AS atrasada,
         CASE WHEN u.id IS NULL THEN NULL
              ELSE jsonb_build_object('id', u.id, 'nome', u.nome) END AS atribuida_a,
         c.canal, m.id AS municipe_id, m.nome AS municipe_nome,
         m.telefone_e164, m.email
  FROM passagens_humano p
  JOIN conversas c ON c.id = p.conversa_id
  LEFT JOIN municipes m ON m.id = c.municipe_id
  LEFT JOIN utilizadores u ON u.id = p.atribuida_a`;

/** Para o painel: o munícipe mascarado, nunca o número nem o email inteiros. */
function paraPainel(l: LinhaPassagem) {
  const { municipe_id, municipe_nome, telefone_e164, email, ...resto } = l;
  return {
    ...resto,
    municipe: municipe_id
      ? {
          id: municipe_id,
          nome: municipe_nome,
          telefone: telefone_e164 ? mascararTelefone(telefone_e164) : null,
          cara_demo: indiceTelefoneDemo(telefone_e164),
          tem_telefone: !!telefone_e164,
          tem_email: !!email,
        }
      : null,
  };
}

/**
 * Passagens a funcionário: o agente cria-as durante a conversa com o caso
 * resumido; no painel, alguém pega nelas, responde por SMS ou email e fecha.
 */
@Injectable()
export class PassagensService {
  constructor(
    private readonly db: DatabaseService,
    private readonly horario: HorarioService,
    private readonly conversas: ConversasService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Muda o resultado da conversa; a emergência nunca é sobreposta. */
  private async resultado(
    conversaId: string,
    resultado: 'passada_funcionario' | 'emergencia',
    tx?: Tx,
  ) {
    await (tx ?? this.db).query(
      `UPDATE conversas SET resultado = $2::resultado_conv
       WHERE id = $1 AND resultado <> 'emergencia'`,
      [conversaId, resultado],
    );
  }

  // -------------------------------------------------------------------------
  // Ferramentas do agente
  // -------------------------------------------------------------------------

  async criar(
    ctx: ContextoFerramenta,
    dados: {
      motivo: MotivoPassagem;
      resumo: string;
      preferencia?: PreferenciaResposta;
      email?: string;
    },
    agora = new Date(),
  ) {
    const conversaId = ctx.conversaId;
    if (!conversaId) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'sem_conversa',
        'Sem conversa associada: não dá para passar a um funcionário.',
      );
    }
    const preferencia =
      dados.preferencia ?? (ctx.canal === 'chat' ? 'chat' : 'sms');
    const { foraDeHoras, responderAte, fuso } = await this.horario.paraPassagem(
      ctx.municipio.id,
      agora,
    );
    if (dados.email && ctx.municipeId) {
      await this.municipes.atualizar(ctx.municipeId, { email: dados.email });
    }

    const passagemId = await this.db.transaction(async (tx) => {
      // O modelo pode chamar duas vezes na mesma conversa: atualiza a aberta.
      const [aberta] = await tx.query<{ id: string }>(
        `SELECT id FROM passagens_humano
         WHERE conversa_id = $1 AND estado IN ('aberta','em_curso')
         ORDER BY criada_em DESC LIMIT 1 FOR UPDATE`,
        [conversaId],
      );
      let id: string;
      if (aberta) {
        await tx.query(
          `UPDATE passagens_humano
           SET motivo = $2, resumo = $3, preferencia_resposta = $4
           WHERE id = $1`,
          [aberta.id, dados.motivo, dados.resumo, preferencia],
        );
        id = aberta.id;
      } else {
        const [nova] = await tx.query<{ id: string }>(
          `INSERT INTO passagens_humano
             (conversa_id, motivo, resumo, fora_de_horas, preferencia_resposta, responder_ate)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            conversaId,
            dados.motivo,
            dados.resumo,
            foraDeHoras,
            preferencia,
            responderAte,
          ],
        );
        id = nova.id;
      }
      await this.resultado(conversaId, 'passada_funcionario', tx);
      await this.conversas.momento(
        conversaId,
        'passagem',
        { passagem_id: id, motivo: dados.motivo, fora_de_horas: foraDeHoras },
        tx,
      );
      return id;
    });

    const quando = quandoPorExtenso(responderAte, agora, fuso);
    return {
      passada: true,
      passagem_id: passagemId,
      fora_de_horas: foraDeHoras,
      responder_ate: responderAte.toISOString(),
      dizer: frasePassagem({ foraDeHoras, quando, preferencia }),
    };
  }

  /** Só regista: o agente já disse para ligar 112. */
  async emergencia(ctx: ContextoFerramenta, situacao?: string) {
    if (ctx.conversaId) {
      const conversaId = ctx.conversaId;
      await this.db.transaction(async (tx) => {
        await this.conversas.momento(
          conversaId,
          'emergencia',
          situacao ? { situacao } : {},
          tx,
        );
        await this.resultado(conversaId, 'emergencia', tx);
      });
    }
    return {
      registado: true,
      dizer: 'Ligue já para o 112.',
      instrucao:
        'Repete que deve desligar e ligar 112 agora. Não continues com outros assuntos.',
    };
  }

  // -------------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------------

  async listar(
    municipioId: string,
    filtros: {
      estados: EstadoPassagem[] | null;
      atribuidaA: string | null;
      semAtribuicao: boolean;
      limite: number;
      cursor: Cursor | null;
    },
  ) {
    const linhas = await this.db.query<LinhaPassagem>(
      `${SELECT_PASSAGEM}
       WHERE c.municipio_id = $1 AND c.oculto_em IS NULL
         AND ($2::text[] IS NULL OR p.estado = ANY($2))
         AND ($3::uuid IS NULL OR p.atribuida_a = $3)
         AND (NOT $4 OR p.atribuida_a IS NULL)
         AND ($5::timestamptz IS NULL OR (p.criada_em, p.id) < ($5, $6::uuid))
       ORDER BY p.criada_em DESC, p.id DESC
       LIMIT $7`,
      [
        municipioId,
        filtros.estados,
        filtros.atribuidaA,
        filtros.semAtribuicao,
        filtros.cursor?.em ?? null,
        filtros.cursor?.id ?? null,
        filtros.limite + 1,
      ],
    );
    const p = pagina(linhas, filtros.limite, (l) => ({
      em: l.criada_em,
      id: l.id,
    }));
    return { ...p, itens: p.itens.map(paraPainel) };
  }

  private async linha(
    municipioId: string,
    id: string,
    tx?: Tx,
  ): Promise<LinhaPassagem> {
    const [l] = await (tx ?? this.db).query<LinhaPassagem>(
      `${SELECT_PASSAGEM} WHERE p.id = $1 AND c.municipio_id = $2`,
      [id, municipioId],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Passagem não existe.',
      );
    }
    return l;
  }

  async obter(municipioId: string, id: string) {
    const l = await this.linha(municipioId, id);
    const [[conversa], respostas] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        `SELECT id, canal, iniciada_em, terminada_em, resumo, resultado
         FROM conversas WHERE id = $1`,
        [l.conversa_id],
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT id, canal, corpo, estado, enviar_em, enviada_em
         FROM mensagens_saida
         WHERE municipio_id = $1 AND relacionado->>'passagem_id' = $2
         ORDER BY enviar_em`,
        [municipioId, id],
      ),
    ]);
    return { ...paraPainel(l), conversa, respostas };
  }

  private fechada(l: LinhaPassagem) {
    if (l.estado === 'fechada') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'passagem_fechada',
        'Esta passagem já está fechada.',
      );
    }
  }

  /** Sem `utilizadorId`, fica para quem pede. */
  async atribuir(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    utilizadorId: string | undefined,
    ip: string | null,
  ) {
    const alvo = utilizadorId ?? u.id;
    await this.db.transaction(async (tx) => {
      const l = await this.linha(municipio.id, id, tx);
      this.fechada(l);
      const [valido] = await tx.query<{ id: string }>(
        `SELECT id FROM utilizadores
         WHERE id = $1 AND ativo AND (municipio_id = $2 OR municipio_id IS NULL)`,
        [alvo, municipio.id],
      );
      if (!valido) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'utilizador_invalido',
          'Esse utilizador não existe ou não é deste município.',
        );
      }
      await tx.query(
        `UPDATE passagens_humano SET atribuida_a = $2,
           estado = CASE WHEN estado = 'aberta' THEN 'em_curso' ELSE estado END
         WHERE id = $1`,
        [id, alvo],
      );
      const anterior = l.atribuida_a?.id ?? null;
      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: anterior && anterior !== alvo ? 'reatribuir' : 'atribuir',
          objetoTipo: 'passagem_humano',
          objetoId: id,
          dados: { de: anterior, para: alvo },
          ip,
        },
        tx,
      );
    });
    return this.obter(municipio.id, id);
  }

  /**
   * Responde ao munícipe e passa a 'respondida' (motivo 'passagem'). O
   * email não passa pela fila: sai já e fica registado em `mensagens_saida`
   * para aparecer no histórico da passagem.
   */
  async responder(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    dados: { texto: string; canal: 'sms' | 'email' },
    ip: string | null,
  ) {
    const l = await this.linha(municipio.id, id);
    this.fechada(l);
    const chave = chaveResposta(id, dados.texto);
    const relacionado = { conversa_id: l.conversa_id, passagem_id: id };
    let mensagemId: string;

    if (dados.canal === 'sms') {
      if (!l.telefone_e164) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'sem_telefone',
          'O munícipe não tem telefone: responda por email.',
        );
      }
      mensagemId = await this.mensagens.sms({
        municipioId: municipio.id,
        municipeId: l.municipe_id,
        destino: l.telefone_e164,
        motivo: 'passagem',
        corpo: dados.texto,
        relacionado,
        chave,
      });
    } else {
      if (!l.email) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'sem_email',
          'O munícipe não tem email: responda por SMS.',
        );
      }
      const [ja] = await this.db.query<{ id: string }>(
        'SELECT id FROM mensagens_saida WHERE chave_idempotencia = $1',
        [chave],
      );
      if (ja) {
        mensagemId = ja.id;
      } else {
        await this.mensagens.email({
          para: l.email,
          assunto: `Resposta ao seu pedido · ${municipio.nome}`,
          texto: dados.texto,
        });
        const [criada] = await this.db.query<{ id: string }>(
          `INSERT INTO mensagens_saida (municipio_id, municipe_id, canal, destino, motivo,
             corpo, relacionado, estado, enviada_em, chave_idempotencia)
           VALUES ($1, $2, 'email', $3, 'passagem', $4, $5, 'enviada', now(), $6)
           ON CONFLICT (chave_idempotencia) DO UPDATE SET chave_idempotencia = EXCLUDED.chave_idempotencia
           RETURNING id`,
          [
            municipio.id,
            l.municipe_id,
            l.email,
            dados.texto,
            JSON.stringify(relacionado),
            chave,
          ],
        );
        mensagemId = criada.id;
      }
    }

    await this.db.query(
      `UPDATE passagens_humano SET estado = 'respondida', respondida_em = now(),
         atribuida_a = coalesce(atribuida_a, $2)
       WHERE id = $1`,
      [id, u.id],
    );
    await this.auditoria.registar({
      municipioId: municipio.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'responder',
      objetoTipo: 'passagem_humano',
      objetoId: id,
      dados: { canal: dados.canal, mensagem_id: mensagemId },
      ip,
    });
    return { ...(await this.obter(municipio.id, id)), mensagem_id: mensagemId };
  }

  async fechar(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    ip: string | null,
  ) {
    const l = await this.linha(municipio.id, id);
    if (l.estado !== 'fechada') {
      await this.db.query(
        `UPDATE passagens_humano SET estado = 'fechada' WHERE id = $1`,
        [id],
      );
      await this.auditoria.registar({
        municipioId: municipio.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'fechar',
        objetoTipo: 'passagem_humano',
        objetoId: id,
        dados: { estado_anterior: l.estado },
        ip,
      });
    }
    return this.obter(municipio.id, id);
  }
}
