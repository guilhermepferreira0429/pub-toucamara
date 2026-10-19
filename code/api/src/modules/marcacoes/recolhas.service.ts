import { HttpStatus, Injectable } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { MarcacoesService } from './marcacoes.service.js';
import {
  diaLocal,
  dizerDia,
  dizerJanela,
  dizerPeriodo,
  instanteLocal,
  JANELAS,
  Periodo,
  proximaJanela,
} from './vagas.js';

export interface ItemRecolha {
  item: string;
  qtd: number;
}

/*
 * Quem recolhe os monos, por esta ordem (nada de nomes no código):
 * 1. a regra de "Quem trata de quê" (regras_encaminhamento) ativa cujo
 *    assunto fale de monos / monstros / volumosos / recolha, a de menor
 *    prioridade primeiro;
 * 2. senão, a empresa municipal cujo nome ou descrição fale de resíduos,
 *    lixo, recolha ou monos.
 * Só entidades ativas. Sem nenhuma: 422 e o agente passa a um funcionário.
 */
const ENTIDADE_RECOLHA = `
  SELECT e.id, e.nome FROM (
    SELECT re.entidade_id AS id, 0 AS ordem, re.prioridade
    FROM regras_encaminhamento re
    WHERE re.municipio_id = $1 AND re.ativo
      AND unaccent(lower(re.assunto)) ~ '(mono|monstro|volumos|recolha)'
    UNION ALL
    SELECT e.id, 1, 100 FROM entidades e
    WHERE e.municipio_id = $1 AND e.tipo = 'empresa_municipal'
      AND unaccent(lower(e.nome || ' ' || coalesce(e.descricao, ''))) ~ '(residuo|lixo|recolha|mono)'
  ) c
  JOIN entidades e ON e.id = c.id AND e.ativo
  ORDER BY c.ordem, c.prioridade, e.nome
  LIMIT 1`;

/** 'sofá (1), colchão (2)'. */
export function listarItens(itens: ItemRecolha[]): string {
  return itens.map((i) => `${i.item} (${i.qtd})`).join(', ');
}

/** Recolha de monos ao domicílio, com a empresa de resíduos do município. */
@Injectable()
export class RecolhasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
    private readonly marcacoes: MarcacoesService,
    private readonly conversas: ConversasService,
    private readonly mensagens: MensagensService,
  ) {}

  /** Ferramenta `agendar_recolha`. */
  async agendar(
    ctx: ContextoFerramenta,
    e: {
      itens: ItemRecolha[];
      morada: string;
      preferencia?: Periodo;
      telefone?: string;
    },
  ) {
    const m = ctx.municipio;
    const [entidade] = await this.db.query<{ id: string; nome: string }>(
      ENTIDADE_RECOLHA,
      [m.id],
    );
    if (!entidade) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'sem_entidade_recolha',
        'Não sei que entidade faz a recolha de monos neste concelho. Passe a um funcionário.',
      );
    }
    const { municipe, telefone } = await this.marcacoes.municipeDoContexto(
      ctx,
      e.telefone,
    );

    // Repetida (mesma morada, ainda por fazer): devolve-se a que há.
    const [existente] = await this.db.query<{
      id: string;
      inicio: Date;
      morada: string;
      itens: ItemRecolha[];
    }>(
      `SELECT id, lower(janela) AS inicio, morada, itens FROM recolhas
       WHERE municipe_id = $1 AND estado = 'marcada' AND lower(janela) > now()
         AND lower(btrim(morada)) = lower(btrim($2))
       ORDER BY lower(janela) LIMIT 1`,
      [municipe.id, e.morada],
    );
    if (existente) {
      return {
        recolha_id: existente.id,
        ja_existia: true,
        entidade: entidade.nome,
        quando: dizerJanela(existente.inicio, m.fuso),
        morada: existente.morada,
        itens: existente.itens,
        sms_enviado: !!telefone,
      };
    }

    const ocupacao = await this.db.query<{
      dia: string;
      periodo: Periodo;
      n: number;
    }>(
      `SELECT to_char(lower(janela) AT TIME ZONE $2, 'YYYY-MM-DD') AS dia,
              CASE WHEN extract(hour FROM lower(janela) AT TIME ZONE $2) < 12
                   THEN 'manha' ELSE 'tarde' END AS periodo,
              count(*)::int AS n
       FROM recolhas
       WHERE entidade_id = $1 AND estado = 'marcada' AND lower(janela) > now()
       GROUP BY 1, 2`,
      [entidade.id, m.fuso],
    );
    const janela = proximaJanela({
      hoje: diaLocal(new Date(), m.fuso),
      feriados: await this.municipios.feriados(m.id),
      preferencia: e.preferencia,
      ocupacao: new Map(ocupacao.map((o) => [`${o.dia}|${o.periodo}`, o.n])),
    });
    if (!janela) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'sem_janela',
        'Não há janelas de recolha livres nas próximas semanas. Passe a um funcionário.',
      );
    }
    const [de, ate] = JANELAS[janela.periodo].map((h) =>
      instanteLocal(janela.dia, h, m.fuso),
    );
    const quando = `${dizerDia(janela.dia)}, ${dizerPeriodo(janela.periodo)}`;

    const id = await this.db.transaction(async (tx) => {
      const [r] = await tx.query<{ id: string }>(
        `INSERT INTO recolhas (municipio_id, entidade_id, municipe_id, conversa_id, morada, itens, janela)
         VALUES ($1, $2, $3, $4, $5, $6, tstzrange($7, $8, '[)'))
         RETURNING id`,
        [
          m.id,
          entidade.id,
          municipe.id,
          ctx.conversaId,
          e.morada,
          JSON.stringify(e.itens),
          de,
          ate,
        ],
      );
      if (telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: municipe.id,
            destino: telefone,
            motivo: 'recolha',
            corpo:
              `${m.nome}: recolha de monos marcada com ${entidade.nome}, ${quando}, ` +
              `em ${e.morada}. Itens: ${listarItens(e.itens)}.`,
            relacionado: {
              recolha_id: r.id,
              ...(ctx.conversaId && { conversa_id: ctx.conversaId }),
            },
            chave: `recolha:${r.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'recolha',
        { recolha_id: r.id, entidade_id: entidade.id, janela: janela },
        tx,
      );
      return r.id;
    });

    return {
      recolha_id: id,
      ja_existia: false,
      entidade: entidade.nome,
      quando,
      morada: e.morada,
      itens: e.itens,
      sms_enviado: !!telefone,
    };
  }
}
