import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  diaLocal,
  diasSeguintes,
  dizerJanela,
  dizerQuando,
  escolherOpcoes,
  espalhar,
  gerarSlots,
  Horario,
  instanteLocal,
  Intervalo,
  slotNoHorario,
} from './vagas.js';

/** Quantos dias para a frente se procuram vagas quando não se diz o dia. */
export const DIAS_PROCURA = 21;
/** Não se marca para daqui a menos de uma hora (o serviço tem de saber). */
export const ANTECEDENCIA_MIN = 60;
/** Opções que o agente diz de cada vez. */
const OPCOES = 6;

export interface Agenda {
  id: string;
  municipio_id: string;
  nome: string;
  local: string | null;
  servico: string;
  duracao_min: number;
  horario: Horario;
}

export interface VagaDita {
  inicio: string;
  dito: string;
}

const COLUNAS_AGENDA = `a.id, a.municipio_id, a.nome, a.local, s.nome AS servico,
  (extract(epoch FROM a.duracao_slot) / 60)::int AS duracao_min, a.horario`;

/** Mesma decomposição em lexemas da pesquisa de conhecimento (fala → OU). */
const CONSULTA = `
  SELECT string_agg(DISTINCT quote_literal(lexeme), ' | ')::tsquery AS q
  FROM unnest(to_tsvector('pt_unaccent', $2))`;

interface LinhaMarcacao {
  id: string;
  agenda_id: string;
  municipe_id: string;
  inicio: Date;
  fim: Date;
  assunto: string | null;
  levar: string[] | null;
  estado: 'marcada' | 'cancelada' | 'realizada' | 'faltou';
  token_publico: string;
}

const COLUNAS_MARCACAO = `mc.id, mc.agenda_id, mc.municipe_id, lower(mc.periodo) AS inicio,
  upper(mc.periodo) AS fim, mc.assunto, mc.levar, mc.estado, mc.token_publico`;

function hojeEm(fuso: string): string {
  return diaLocal(new Date(), fuso);
}

function eSobreposicao(e: unknown): boolean {
  return (e as { code?: string }).code === '23P01';
}

/**
 * Marcações em agendas dos serviços. As vagas saem do horário da agenda
 * menos o que já está marcado; a constraint EXCLUDE da tabela é a garantia
 * final contra duas pessoas na mesma vaga (23P01 → 409 'vaga_ocupada').
 */
@Injectable()
export class MarcacoesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly conversas: ConversasService,
    private readonly links: LinksCurtosService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async agenda(municipioId: string, id: string): Promise<Agenda> {
    const [a] = await this.db.query<Agenda>(
      `SELECT ${COLUNAS_AGENDA} FROM agendas a JOIN servicos s ON s.id = a.servico_id
       WHERE a.id = $1 AND a.municipio_id = $2`,
      [id, municipioId],
    );
    if (!a) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'agenda_desconhecida',
        'Essa agenda não existe.',
      );
    }
    return a;
  }

  async agendas(municipioId: string): Promise<Agenda[]> {
    return this.db.query<Agenda>(
      `SELECT ${COLUNAS_AGENDA} FROM agendas a JOIN servicos s ON s.id = a.servico_id
       WHERE a.municipio_id = $1 ORDER BY a.nome`,
      [municipioId],
    );
  }

  /** Agendas cujo nome, serviço ou entidade batem com o assunto dito. */
  async procurarAgendas(municipioId: string, texto: string): Promise<Agenda[]> {
    return this.db.query<Agenda>(
      `WITH c AS (${CONSULTA}),
       a AS (
         SELECT ${COLUNAS_AGENDA},
                to_tsvector('pt_unaccent', a.nome || ' ' || s.nome || ' ' || e.nome || ' ' ||
                  coalesce(e.descricao, '')) AS tsv
         FROM agendas a
         JOIN servicos s ON s.id = a.servico_id
         JOIN entidades e ON e.id = s.entidade_id
         WHERE a.municipio_id = $1
       )
       SELECT a.id, a.municipio_id, a.nome, a.local, a.servico, a.duracao_min, a.horario
       FROM a, c
       WHERE a.tsv @@ c.q
       ORDER BY ts_rank_cd(a.tsv, c.q, 32) DESC, a.nome
       LIMIT 5`,
      [municipioId, texto],
    );
  }

  /** As vagas livres de uma agenda nestes dias. */
  async vagasLivres(
    municipio: Municipio,
    agenda: Agenda,
    dias: string[],
  ): Promise<Intervalo[]> {
    const de = instanteLocal(dias[0], '00:00', municipio.fuso);
    const ate = instanteLocal(
      diasSeguintes(dias[dias.length - 1], 2)[1],
      '00:00',
      municipio.fuso,
    );
    const [ocupados, feriados] = await Promise.all([
      this.db.query<Intervalo>(
        `SELECT lower(periodo) AS inicio, upper(periodo) AS fim FROM marcacoes
         WHERE agenda_id = $1 AND estado = 'marcada' AND periodo && tstzrange($2, $3)`,
        [agenda.id, de, ate],
      ),
      this.municipios.feriados(municipio.id),
    ]);
    return gerarSlots({
      horario: agenda.horario,
      duracaoMin: agenda.duracao_min,
      dias,
      fuso: municipio.fuso,
      feriados,
      agora: new Date(),
      antecedenciaMin: ANTECEDENCIA_MIN,
      ocupados,
    });
  }

  /** Poucas opções fáceis de dizer: o dia pedido espalhado, ou os próximos dias. */
  async opcoes(
    municipio: Municipio,
    agenda: Agenda,
    dia?: string,
    limite = OPCOES,
  ): Promise<VagaDita[]> {
    const dias = dia
      ? [dia]
      : diasSeguintes(hojeEm(municipio.fuso), DIAS_PROCURA);
    const livres = await this.vagasLivres(municipio, agenda, dias);
    const escolhidas = dia
      ? espalhar(livres, limite)
      : escolherOpcoes(livres, municipio.fuso, limite);
    return escolhidas.map((s) => ({
      inicio: s.inicio.toISOString(),
      dito: dizerQuando(s.inicio, municipio.fuso),
    }));
  }

  /** Ferramenta `ver_vagas`. */
  async verVagas(
    ctx: ContextoFerramenta,
    e: { agenda_id?: string; servico?: string; dia?: string; limite?: number },
  ) {
    const m = ctx.municipio;
    let agenda: Agenda;
    let outras: string[] = [];
    if (e.agenda_id) {
      agenda = await this.agenda(m.id, e.agenda_id);
    } else {
      const candidatas = e.servico
        ? await this.procurarAgendas(m.id, e.servico)
        : [];
      const todas = candidatas.length ? candidatas : await this.agendas(m.id);
      if (todas.length === 0) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'sem_agendas',
          'Este município ainda não tem agendas de atendimento marcável.',
        );
      }
      // Sem correspondência e várias agendas: o agente pergunta qual.
      if (!candidatas.length && todas.length > 1) {
        return {
          precisa_escolher: true,
          agendas: todas.map((a) => ({
            agenda_id: a.id,
            nome: a.nome,
            servico: a.servico,
          })),
        };
      }
      agenda = todas[0];
      outras = candidatas.slice(1).map((a) => a.nome);
    }
    if (e.dia && e.dia < hojeEm(m.fuso)) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'dia_passado',
        'Esse dia já passou.',
      );
    }
    const vagas = await this.opcoes(m, agenda, e.dia, e.limite);
    return {
      agenda: { agenda_id: agenda.id, nome: agenda.nome, local: agenda.local },
      vagas,
      sem_vagas: vagas.length === 0,
      ...(vagas.length === 0 && {
        mensagem: e.dia
          ? 'Não há vagas nesse dia. Proponha outro dia.'
          : `Não há vagas nos próximos ${DIAS_PROCURA} dias.`,
      }),
      ...(outras.length && { outras_agendas: outras }),
    };
  }

  /**
   * O munícipe da conversa: o já ligado, ou pelo número (o dito ou o de
   * quem liga). Sem nenhum, não há a quem confirmar por SMS.
   */
  async municipeDoContexto(ctx: ContextoFerramenta, telefoneDito?: string) {
    const dito = normalizarTelefone(telefoneDito);
    if (telefoneDito && !dito) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'Esse número de telemóvel não é válido.',
      );
    }
    const telefone = dito ?? ctx.telefone;
    if (ctx.municipeId) {
      const m = await this.municipes.porId(ctx.municipeId);
      if (m) return { municipe: m, telefone: telefone ?? m.telefone_e164 };
    }
    const m = await this.municipes.porTelefone(ctx.municipio.id, telefone);
    if (!m) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'falta_telefone',
        'Preciso de um número de telemóvel para confirmar por SMS. Pergunte-o e tente outra vez.',
      );
    }
    if (ctx.conversaId)
      await this.conversas.ligarMunicipe(ctx.conversaId, m.id);
    return { municipe: m, telefone: telefone ?? m.telefone_e164 };
  }

  /**
   * Link novo para cada SMS (lembrete, remarcação): os anteriores continuam
   * válidos e todos abrem pelo mesmo token público, que nunca muda.
   */
  linkDaMarcacao(municipioId: string, marcacaoId: string, tx?: Tx) {
    return this.links.criar(municipioId, 'marcacao', marcacaoId, { tx });
  }

  /** Vagas perto da hora pedida: as desse dia, ou as dos próximos dias. */
  private async alternativas(
    municipio: Municipio,
    agenda: Agenda,
    inicio: Date,
  ): Promise<VagaDita[]> {
    const dia = diaLocal(inicio, municipio.fuso);
    const doDia =
      dia >= hojeEm(municipio.fuso)
        ? await this.opcoes(municipio, agenda, dia)
        : [];
    return doDia.length ? doDia : this.opcoes(municipio, agenda);
  }

  private async vagaValida(
    municipio: Municipio,
    agenda: Agenda,
    inicio: Date,
  ): Promise<Intervalo> {
    const feriados = await this.municipios.feriados(municipio.id);
    const slot = slotNoHorario(inicio, {
      horario: agenda.horario,
      duracaoMin: agenda.duracao_min,
      fuso: municipio.fuso,
      feriados,
      agora: new Date(),
      antecedenciaMin: ANTECEDENCIA_MIN,
    });
    if (!slot) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'fora_do_horario',
        'Essa hora não é uma vaga desta agenda. Ofereça uma das vagas_alternativas.',
        {
          vagas_alternativas: await this.alternativas(
            municipio,
            agenda,
            inicio,
          ),
        },
      );
    }
    return slot;
  }

  private async vagaOcupada(
    municipio: Municipio,
    agenda: Agenda,
    inicio: Date,
  ): Promise<ErroApi> {
    return new ErroApi(
      HttpStatus.CONFLICT,
      'vaga_ocupada',
      'Essa vaga acabou de ser ocupada. Ofereça uma das vagas_alternativas.',
      {
        vagas_alternativas: await this.alternativas(municipio, agenda, inicio),
      },
    );
  }

  /** Ferramenta `marcar`. */
  async marcar(
    ctx: ContextoFerramenta,
    e: {
      agenda_id: string;
      inicio: string;
      assunto: string;
      levar?: string[];
      telefone?: string;
    },
  ) {
    const m = ctx.municipio;
    const agenda = await this.agenda(m.id, e.agenda_id);
    const slot = await this.vagaValida(m, agenda, new Date(e.inicio));
    const { municipe, telefone } = await this.municipeDoContexto(
      ctx,
      e.telefone,
    );

    // A mesma marcação repetida (o agente voltou a chamar): devolve-se a que há.
    const [existente] = await this.db.query<LinhaMarcacao>(
      `SELECT ${COLUNAS_MARCACAO} FROM marcacoes mc
       WHERE mc.agenda_id = $1 AND mc.municipe_id = $2 AND lower(mc.periodo) = $3
         AND mc.estado = 'marcada'`,
      [agenda.id, municipe.id, slot.inicio],
    );
    if (existente) {
      return this.resumoMarcacao(m, agenda, existente, null, true, !!telefone);
    }

    let criada: { mc: LinhaMarcacao; link: string };
    try {
      criada = await this.db.transaction(async (tx) => {
        const [mc] = await tx.query<LinhaMarcacao>(
          `INSERT INTO marcacoes AS mc (agenda_id, municipe_id, conversa_id, periodo, assunto, levar)
           VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6, $7)
           RETURNING ${COLUNAS_MARCACAO}`,
          [
            agenda.id,
            municipe.id,
            ctx.conversaId,
            slot.inicio,
            slot.fim,
            e.assunto,
            e.levar?.length ? e.levar : null,
          ],
        );
        const link = await this.links.criar(m.id, 'marcacao', mc.id, { tx });
        if (telefone) {
          await this.mensagens.sms(
            {
              municipioId: m.id,
              municipeId: municipe.id,
              destino: telefone,
              motivo: 'marcacao',
              corpo: this.textoMarcacao(m, agenda, mc, link.url),
              relacionado: {
                marcacao_id: mc.id,
                ...(ctx.conversaId && { conversa_id: ctx.conversaId }),
              },
              chave: `marcacao:${mc.id}`,
            },
            tx,
          );
        }
        await this.conversas.momento(
          ctx.conversaId,
          'marcacao',
          {
            marcacao_id: mc.id,
            agenda_id: agenda.id,
            inicio: slot.inicio.toISOString(),
          },
          tx,
        );
        return { mc, link: link.url };
      });
    } catch (erro) {
      if (eSobreposicao(erro))
        throw await this.vagaOcupada(m, agenda, slot.inicio);
      throw erro;
    }
    return this.resumoMarcacao(
      m,
      agenda,
      criada.mc,
      criada.link,
      false,
      !!telefone,
    );
  }

  private textoMarcacao(
    m: Municipio,
    agenda: Agenda,
    mc: Pick<LinhaMarcacao, 'inicio' | 'levar'>,
    url: string,
  ): string {
    const levar = mc.levar?.length ? ` Leve: ${mc.levar.join(', ')}.` : '';
    const local = agenda.local ? `, ${agenda.local}` : '';
    return (
      `${m.nome}: marcação confirmada. ${agenda.nome}${local}, ` +
      `${dizerQuando(mc.inicio, m.fuso)}.${levar} Remarcar ou cancelar: ${url}`
    );
  }

  private resumoMarcacao(
    m: Municipio,
    agenda: Agenda,
    mc: LinhaMarcacao,
    link: string | null,
    jaExistia: boolean,
    smsEnviado: boolean,
  ) {
    return {
      marcacao_id: mc.id,
      ja_existia: jaExistia,
      agenda: agenda.nome,
      local: agenda.local,
      inicio: mc.inicio.toISOString(),
      quando: dizerQuando(mc.inicio, m.fuso),
      levar: mc.levar ?? [],
      sms_enviado: smsEnviado,
      link,
    };
  }

  /** Marcações e recolhas futuras do munícipe (para cancelar). */
  async futurasDoMunicipe(municipeId: string, fuso: string) {
    const linhas = await this.db.query<{
      id: string;
      tipo: 'marcacao' | 'recolha';
      inicio: Date;
      o_que: string;
    }>(
      `SELECT mc.id, 'marcacao' AS tipo, lower(mc.periodo) AS inicio,
              a.nome || coalesce(' · ' || mc.assunto, '') AS o_que
       FROM marcacoes mc JOIN agendas a ON a.id = mc.agenda_id
       WHERE mc.municipe_id = $1 AND mc.estado = 'marcada' AND lower(mc.periodo) > now()
       UNION ALL
       SELECT r.id, 'recolha', lower(r.janela), 'Recolha de monos · ' || r.morada
       FROM recolhas r
       WHERE r.municipe_id = $1 AND r.estado = 'marcada' AND lower(r.janela) > now()
       ORDER BY inicio`,
      [municipeId],
    );
    return linhas.map((l) => ({
      ...l,
      quando:
        l.tipo === 'recolha'
          ? dizerJanela(l.inicio, fuso)
          : dizerQuando(l.inicio, fuso),
    }));
  }

  /** Ferramenta `cancelar_marcacao`. */
  async cancelarDoContexto(ctx: ContextoFerramenta, id?: string) {
    const m = ctx.municipio;
    const { municipe, telefone } = await this.municipeDoContexto(ctx);
    const futuras = await this.futurasDoMunicipe(municipe.id, m.fuso);
    const lista = futuras.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      quando: f.quando,
      o_que: f.o_que,
    }));
    if (id) {
      const alvo = futuras.find((f) => f.id === id);
      if (!alvo) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'marcacao_nao_encontrada',
          'Essa marcação não existe ou já não está ativa.',
          { marcacoes: lista },
        );
      }
      return this.cancelar(m, alvo, municipe.id, telefone, ctx.conversaId);
    }
    if (futuras.length === 0) {
      return { cancelada: false, mensagem: 'Não tem marcações futuras.' };
    }
    if (futuras.length > 1) {
      return {
        cancelada: false,
        precisa_escolher: true,
        mensagem:
          'Tem várias marcações: pergunte qual e chame outra vez com o id.',
        marcacoes: lista,
      };
    }
    return this.cancelar(m, futuras[0], municipe.id, telefone, ctx.conversaId);
  }

  private async cancelar(
    m: Municipio,
    alvo: {
      id: string;
      tipo: 'marcacao' | 'recolha';
      quando: string;
      o_que: string;
    },
    municipeId: string,
    telefone: string | null,
    conversaId: string | null,
  ) {
    await this.db.transaction(async (tx) => {
      const tabela = alvo.tipo === 'marcacao' ? 'marcacoes' : 'recolhas';
      await tx.query(
        `UPDATE ${tabela} SET estado = 'cancelada' WHERE id = $1 AND estado = 'marcada'`,
        [alvo.id],
      );
      if (telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId,
            destino: telefone,
            motivo: alvo.tipo,
            corpo: `${m.nome}: cancelámos ${alvo.tipo === 'marcacao' ? 'a sua marcação' : 'a recolha'} de ${alvo.quando} (${alvo.o_que}).`,
            relacionado: { [`${alvo.tipo}_id`]: alvo.id },
            chave: `cancelada:${alvo.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        conversaId,
        alvo.tipo,
        { [`${alvo.tipo}_id`]: alvo.id, acao: 'cancelada' },
        tx,
      );
    });
    return {
      cancelada: true,
      tipo: alvo.tipo,
      quando: alvo.quando,
      o_que: alvo.o_que,
    };
  }

  // ---------------------------------------------------------------- público

  private async porToken(token: string) {
    const [r] = await this.db.query<
      LinhaMarcacao & {
        municipio_id: string;
        municipio_nome: string;
        fuso: string;
        telefone: string | null;
      }
    >(
      `SELECT ${COLUNAS_MARCACAO}, a.municipio_id, mun.nome AS municipio_nome, mun.fuso,
              mu.telefone_e164 AS telefone
       FROM marcacoes mc
       JOIN agendas a ON a.id = mc.agenda_id
       JOIN municipios mun ON mun.id = a.municipio_id
       JOIN municipes mu ON mu.id = mc.municipe_id
       WHERE mc.token_publico = $1`,
      [token],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'marcacao_nao_encontrada',
        'Esta marcação não existe.',
      );
    }
    const municipio: Municipio = {
      id: r.municipio_id,
      slug: '',
      nome: r.municipio_nome,
      fuso: r.fuso,
    };
    const agenda = await this.agenda(r.municipio_id, r.agenda_id);
    return { mc: r, municipio, agenda };
  }

  /** Página do link do SMS. Sem dados pessoais. */
  async publico(token: string) {
    const { mc, municipio, agenda } = await this.porToken(token);
    return {
      municipio: municipio.nome,
      agenda: agenda.nome,
      local: agenda.local,
      inicio: mc.inicio,
      fim: mc.fim,
      quando: dizerQuando(mc.inicio, municipio.fuso),
      assunto: mc.assunto,
      levar: mc.levar ?? [],
      estado: mc.estado,
      pode_alterar: mc.estado === 'marcada' && mc.inicio > new Date(),
    };
  }

  async cancelarPublico(token: string) {
    const { mc, municipio } = await this.porToken(token);
    if (mc.estado === 'cancelada') return this.publico(token);
    if (mc.estado !== 'marcada' || mc.inicio <= new Date()) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'nao_pode_alterar',
        'Esta marcação já não pode ser alterada.',
      );
    }
    const agenda = await this.agenda(municipio.id, mc.agenda_id);
    await this.cancelar(
      municipio,
      {
        id: mc.id,
        tipo: 'marcacao',
        quando: dizerQuando(mc.inicio, municipio.fuso),
        o_que: agenda.nome,
      },
      mc.municipe_id,
      mc.telefone,
      null,
    );
    return this.publico(token);
  }

  /** Muda a hora, mantém o token (o link do SMS continua a servir). */
  async remarcarPublico(token: string, inicio: string) {
    const { mc, municipio, agenda } = await this.porToken(token);
    if (mc.estado !== 'marcada' || mc.inicio <= new Date()) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'nao_pode_alterar',
        'Esta marcação já não pode ser alterada.',
      );
    }
    const slot = await this.vagaValida(municipio, agenda, new Date(inicio));
    if (slot.inicio.getTime() === mc.inicio.getTime())
      return this.publico(token);
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE marcacoes SET periodo = tstzrange($2, $3, '[)'), lembrete_enviado_em = NULL
           WHERE id = $1 AND estado = 'marcada'`,
          [mc.id, slot.inicio, slot.fim],
        );
        if (mc.telefone) {
          const link = await this.linkDaMarcacao(municipio.id, mc.id, tx);
          await this.mensagens.sms(
            {
              municipioId: municipio.id,
              municipeId: mc.municipe_id,
              destino: mc.telefone,
              motivo: 'marcacao',
              corpo: this.textoMarcacao(
                municipio,
                agenda,
                { inicio: slot.inicio, levar: mc.levar },
                link.url,
              ),
              relacionado: { marcacao_id: mc.id },
              chave: `remarcada:${mc.id}:${slot.inicio.toISOString()}`,
            },
            tx,
          );
        }
      });
    } catch (erro) {
      if (eSobreposicao(erro)) {
        throw await this.vagaOcupada(municipio, agenda, slot.inicio);
      }
      throw erro;
    }
    return this.publico(token);
  }

  /** Vagas para a página de remarcar (o mesmo cálculo do agente). */
  async vagasPublico(token: string, dia?: string) {
    const { municipio, agenda } = await this.porToken(token);
    return { vagas: await this.opcoes(municipio, agenda, dia, dia ? 20 : 10) };
  }

  // ----------------------------------------------------------------- painel

  async doDia(municipio: Municipio, dia?: string, agendaId?: string) {
    const d = dia ?? hojeEm(municipio.fuso);
    const de = instanteLocal(d, '00:00', municipio.fuso);
    const ate = instanteLocal(diasSeguintes(d, 2)[1], '00:00', municipio.fuso);
    const itens = await this.db.query(
      `SELECT mc.id, mc.agenda_id, a.nome AS agenda, lower(mc.periodo) AS inicio,
              upper(mc.periodo) AS fim, mc.assunto, mc.levar, mc.estado, mc.conversa_id,
              mc.criada_em, mc.lembrete_enviado_em,
              jsonb_build_object('id', mu.id, 'nome', mu.nome, 'telefone', mu.telefone_e164) AS municipe
       FROM marcacoes mc
       JOIN agendas a ON a.id = mc.agenda_id
       JOIN municipes mu ON mu.id = mc.municipe_id
       WHERE a.municipio_id = $1
         AND ($2::uuid IS NULL OR mc.agenda_id = $2::uuid)
         AND lower(mc.periodo) >= $3 AND lower(mc.periodo) < $4
       ORDER BY lower(mc.periodo), a.nome`,
      [municipio.id, agendaId ?? null, de, ate],
    );
    return { dia: d, itens };
  }

  async mudarEstado(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    estado: 'realizada' | 'faltou' | 'cancelada',
    ip: string | null,
  ) {
    const [antes] = await this.db.query<
      LinhaMarcacao & { telefone: string | null }
    >(
      `SELECT ${COLUNAS_MARCACAO}, mu.telefone_e164 AS telefone
       FROM marcacoes mc
       JOIN agendas a ON a.id = mc.agenda_id
       JOIN municipes mu ON mu.id = mc.municipe_id
       WHERE mc.id = $1 AND a.municipio_id = $2`,
      [id, municipio.id],
    );
    if (!antes) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'marcacao_nao_encontrada',
        'Esta marcação não existe.',
      );
    }
    if (antes.estado === estado) return { id, estado, alterado: false };
    // Uma vaga libertada não pode voltar a 'marcada' por aqui (podia já estar ocupada).
    if (antes.estado === 'cancelada') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'marcacao_cancelada',
        'Esta marcação foi cancelada.',
      );
    }
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE marcacoes SET estado = $2 WHERE id = $1', [
        id,
        estado,
      ]);
      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'marcacao_estado',
          objetoTipo: 'marcacao',
          objetoId: id,
          dados: { de: antes.estado, para: estado },
          ip,
        },
        tx,
      );
      // Cancelada pelos serviços antes da hora: o munícipe tem de saber.
      if (
        estado === 'cancelada' &&
        antes.inicio > new Date() &&
        antes.telefone
      ) {
        const agenda = await this.agenda(municipio.id, antes.agenda_id);
        await this.mensagens.sms(
          {
            municipioId: municipio.id,
            municipeId: antes.municipe_id,
            destino: antes.telefone,
            motivo: 'marcacao',
            corpo:
              `${municipio.nome}: a sua marcação de ${dizerQuando(antes.inicio, municipio.fuso)} ` +
              `(${agenda.nome}) foi cancelada pelos serviços. Para nova marcação, ligue-nos.`,
            relacionado: { marcacao_id: id },
            chave: `cancelada:${id}`,
          },
          tx,
        );
      }
    });
    return { id, estado, alterado: true };
  }
}
