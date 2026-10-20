import { Injectable, Logger } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import {
  CandidatoTecnico,
  conteudoServico,
  DESTINO,
  escolherTecnico,
  esquemaServico,
  OBJETO_AUDITORIA,
  SERVICO_JA_DEFINIDO,
  SISTEMA_SERVICO,
  TipoItem,
} from './entrada.regras.js';

type Q = Pick<Tx, 'query'>;

export interface ConfigEntrada {
  ativo: boolean;
  atribuir_tecnico: boolean;
}

/** O que o encaminhamento precisa de um item (linha de `entrada_itens`). */
interface ItemAEncaminhar {
  tipo: TipoItem;
  id: string;
  municipio_id: string;
  servico_id: string | null;
  tecnico_id: string | null;
  atribui_tecnico: boolean;
  servico_sugerido_id: string | null;
  servico_sugerido_motivo: string | null;
  texto: string;
}

export interface Encaminhamento {
  tipo: TipoItem;
  id: string;
  servico_id: string | null;
  tecnico_id: string | null;
  motivo: string;
}

// Itens por município em cada passagem do job (o resto fica para a próxima).
const POR_PASSAGEM = 50;

// Candidatos: sem serviço, ou de um tipo com técnico e ainda sem ele; nunca
// os que já têm uma decisão (automática ou manual) no registo.
const CANDIDATOS = `
  FROM entrada_itens i
  WHERE i.municipio_id = $1 AND i.pronto
    AND (i.servico_id IS NULL OR (i.atribui_tecnico AND i.tecnico_id IS NULL))
    AND NOT EXISTS (SELECT 1 FROM encaminhamentos e
                    WHERE e.item_tipo = i.tipo AND e.item_id = i.id)`;

const COLUNAS = `i.tipo, i.id, i.municipio_id, i.servico_id, i.tecnico_id,
  i.atribui_tecnico, i.servico_sugerido_id, i.servico_sugerido_motivo, i.texto`;

/**
 * Encaminhamento automático da caixa de entrada: para cada item novo sem
 * serviço ou sem técnico decide o serviço (regras primeiro: tipo de
 * processo, categoria, serviço já classificado do email; senão o Claude
 * escolhe entre os serviços do município; sem IA fica por atribuir) e o
 * técnico (o ativo desse serviço com menos carga). Cada decisão fica em
 * `encaminhamentos` (com o motivo) e na auditoria. Desligado por omissão.
 */
@Injectable()
export class EncaminhamentoAutomaticoService {
  private readonly logger = new Logger(EncaminhamentoAutomaticoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async config(municipioId: string, q: Q = this.db): Promise<ConfigEntrada> {
    const [c] = await q.query<ConfigEntrada>(
      `SELECT ativo, atribuir_tecnico FROM entrada_config WHERE municipio_id = $1`,
      [municipioId],
    );
    return c ?? { ativo: false, atribuir_tecnico: true };
  }

  async guardarConfig(
    municipioId: string,
    utilizadorId: string,
    dados: Partial<ConfigEntrada>,
    ip: string | null,
  ): Promise<ConfigEntrada> {
    return this.db.transaction(async (tx) => {
      const antes = await this.config(municipioId, tx);
      const [c] = await tx.query<ConfigEntrada>(
        `INSERT INTO entrada_config (municipio_id, ativo, atribuir_tecnico, atualizado_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (municipio_id) DO UPDATE
           SET ativo = EXCLUDED.ativo, atribuir_tecnico = EXCLUDED.atribuir_tecnico,
               atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()
         RETURNING ativo, atribuir_tecnico`,
        [
          municipioId,
          dados.ativo ?? antes.ativo,
          dados.atribuir_tecnico ?? antes.atribuir_tecnico,
          utilizadorId,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: utilizadorId,
          acao: 'alterar_config',
          objetoTipo: 'entrada_config',
          objetoId: municipioId,
          dados: { antes, depois: c },
          ip,
        },
        tx,
      );
      return c;
    });
  }

  /** O job das 5 em 5 min: todos os municípios com o encaminhamento ligado. */
  async encaminharTodos(): Promise<number> {
    const municipios = await this.db.query<{ municipio_id: string }>(
      `SELECT municipio_id FROM entrada_config WHERE ativo`,
    );
    let total = 0;
    for (const { municipio_id } of municipios) {
      total += (await this.encaminharMunicipio(municipio_id)).length;
    }
    return total;
  }

  /** Os itens por encaminhar de um município (os mais antigos primeiro). */
  async encaminharMunicipio(municipioId: string): Promise<Encaminhamento[]> {
    const cfg = await this.config(municipioId);
    if (!cfg.ativo) return [];
    const itens = await this.db.query<ItemAEncaminhar>(
      `SELECT ${COLUNAS} ${CANDIDATOS} ORDER BY i.criado_em, i.id LIMIT ${POR_PASSAGEM}`,
      [municipioId],
    );
    const feitos: Encaminhamento[] = [];
    for (const item of itens) {
      const r = await this.encaminhar(item, cfg);
      if (r) feitos.push(r);
    }
    return feitos;
  }

  /**
   * Um item (ao criar um pedido de balcão ou ao converter em processo).
   * null: desligado, já decidido, nada a decidir ou sem decisão possível.
   */
  async encaminharItem(
    municipioId: string,
    tipo: TipoItem,
    id: string,
  ): Promise<Encaminhamento | null> {
    const cfg = await this.config(municipioId);
    if (!cfg.ativo) return null;
    const [item] = await this.db.query<ItemAEncaminhar>(
      `SELECT ${COLUNAS} ${CANDIDATOS} AND i.tipo = $2 AND i.id = $3`,
      [municipioId, tipo, id],
    );
    return item ? this.encaminhar(item, cfg) : null;
  }

  private async encaminhar(
    item: ItemAEncaminhar,
    cfg: ConfigEntrada,
  ): Promise<Encaminhamento | null> {
    const servico = await this.decidirServico(item);
    if (!servico) return null; // sem IA (ou IA em baixo): fica por atribuir
    const motivos = [servico.motivo];

    let tecnico: CandidatoTecnico | null = null;
    if (
      servico.id &&
      cfg.atribuir_tecnico &&
      item.atribui_tecnico &&
      !item.tecnico_id
    ) {
      const escolha = escolherTecnico(
        await this.candidatos(item.municipio_id, servico.id),
      );
      if (escolha) {
        tecnico = escolha.tecnico;
        motivos.push(escolha.motivo);
      } else {
        motivos.push('sem técnicos ativos no serviço');
      }
    }
    // Já tinha o serviço e não há técnico a pôr: nada a registar.
    if (servico.id && servico.id === item.servico_id && !tecnico) return null;

    return this.db.transaction(async (tx) => {
      // A automática é uma por item: quem chegar primeiro decide.
      const [reg] = await tx.query<{ id: string }>(
        `INSERT INTO encaminhamentos (municipio_id, item_tipo, item_id, servico_id, tecnico_id, motivo, automatico)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (item_tipo, item_id) WHERE automatico DO NOTHING
         RETURNING id`,
        [
          item.municipio_id,
          item.tipo,
          item.id,
          servico.id,
          tecnico?.id ?? null,
          motivos.join('; '),
        ],
      );
      if (!reg) return null;

      if (servico.id && !item.servico_id && DESTINO[item.tipo].servico) {
        await this.escreverServico(tx, item.tipo, item.id, servico.id);
      }
      let tecnicoId = tecnico?.id ?? null;
      if (
        tecnicoId &&
        !(await this.escreverTecnico(tx, item.tipo, item.id, tecnicoId))
      ) {
        // Alguém atribuiu entretanto: fica o que lá está.
        tecnicoId = null;
        motivos.push('técnico já atribuído entretanto');
        await tx.query(
          `UPDATE encaminhamentos SET tecnico_id = NULL, motivo = $2 WHERE id = $1`,
          [reg.id, motivos.join('; ')],
        );
      }
      const r: Encaminhamento = {
        tipo: item.tipo,
        id: item.id,
        servico_id: servico.id,
        tecnico_id: tecnicoId,
        motivo: motivos.join('; '),
      };
      await this.auditoria.registar(
        {
          municipioId: item.municipio_id,
          atorTipo: 'sistema',
          acao: 'encaminhar',
          objetoTipo: OBJETO_AUDITORIA[item.tipo],
          objetoId: item.id,
          dados: {
            encaminhamento_id: reg.id,
            servico_id: r.servico_id,
            tecnico_id: r.tecnico_id,
            motivo: r.motivo,
            automatico: true,
          },
        },
        tx,
      );
      return r;
    });
  }

  /**
   * Regras determinísticas primeiro; depois o Claude. null = não decidir
   * agora (sem IA ou IA indisponível: tenta-se na próxima passagem).
   * `{ id: null }` = a IA respondeu sem serviço (fica registado, por atribuir).
   */
  private async decidirServico(
    item: ItemAEncaminhar,
  ): Promise<{ id: string | null; motivo: string } | null> {
    if (item.servico_id) {
      return {
        id: item.servico_id,
        motivo:
          item.servico_sugerido_id === item.servico_id &&
          item.servico_sugerido_motivo
            ? item.servico_sugerido_motivo
            : SERVICO_JA_DEFINIDO[item.tipo],
      };
    }
    if (item.servico_sugerido_id && item.servico_sugerido_motivo) {
      return {
        id: item.servico_sugerido_id,
        motivo: item.servico_sugerido_motivo,
      };
    }
    if (!this.claude.disponivel) return null;

    const servicos = await this.db.query<{ id: string; nome: string }>(
      `SELECT id, nome FROM servicos WHERE municipio_id = $1 ORDER BY nome`,
      [item.municipio_id],
    );
    if (servicos.length === 0) return null;
    try {
      const r = await this.claude.extrair(esquemaServico, {
        sistema: SISTEMA_SERVICO,
        conteudo: conteudoServico(item.texto, servicos),
        esforco: 'low',
        maxTokens: 2000,
      });
      const escolhido = servicos.find((s) => s.id === r.servico_id);
      if (!escolhido) {
        return {
          id: null,
          motivo: `a IA não encontrou o serviço${r.motivo ? `: ${r.motivo}` : ''}`,
        };
      }
      return {
        id: escolhido.id,
        motivo: `classificado pela IA (${escolhido.nome})${r.motivo ? `: ${r.motivo}` : ''}`,
      };
    } catch (e) {
      const codigo = e instanceof ErroApi ? e.codigo : 'erro';
      this.logger.warn(
        `Classificação de ${item.tipo} ${item.id} falhou: ${(e as Error).message}`,
      );
      if (codigo === 'ia_indisponivel') return null;
      // Recusa ou resposta inválida: regista-se para não repetir a cada 5 min.
      return { id: null, motivo: `a IA não classificou (${codigo})` };
    }
  }

  /** Técnicos ativos do serviço, com a carga aberta e o prazo mais próximo. */
  async candidatos(
    municipioId: string,
    servicoId: string,
    q: Q = this.db,
  ): Promise<CandidatoTecnico[]> {
    return q.query<CandidatoTecnico>(
      `SELECT u.id, u.nome,
              ((SELECT count(*) FROM processos p
                 WHERE p.tecnico_id = u.id AND p.fase NOT IN ('notificado','arquivado'))
             + (SELECT count(*) FROM passagens_humano ph
                 WHERE ph.atribuida_a = u.id AND ph.estado IN ('aberta','em_curso'))
             + (SELECT count(*) FROM pedidos_entrada pe
                 WHERE pe.tecnico_id = u.id AND pe.estado = 'aberto'))::int AS abertos,
              (SELECT to_char(min(p.prazo_fim), 'YYYY-MM-DD') FROM processos p
                WHERE p.tecnico_id = u.id AND p.fase NOT IN ('notificado','arquivado')) AS prazo_mais_proximo
       FROM utilizadores u
       WHERE u.municipio_id = $1 AND u.servico_id = $2 AND u.ativo AND u.perfil = 'tecnico'`,
      [municipioId, servicoId],
    );
  }

  /** Só se ainda não tiver serviço. */
  private async escreverServico(
    tx: Tx,
    tipo: TipoItem,
    id: string,
    servicoId: string,
  ): Promise<void> {
    const tabela =
      tipo === 'email'
        ? 'emails_entrada'
        : tipo === 'ocorrencia'
          ? 'ocorrencias'
          : 'pedidos_entrada';
    await tx.query(
      `UPDATE ${tabela} SET servico_id = $2 WHERE id = $1 AND servico_id IS NULL`,
      [id, servicoId],
    );
  }

  /** Só se ainda não tiver técnico; false se alguém se adiantou. */
  private async escreverTecnico(
    tx: Tx,
    tipo: TipoItem,
    id: string,
    tecnicoId: string,
  ): Promise<boolean> {
    const sql =
      tipo === 'processo'
        ? `UPDATE processos SET tecnico_id = $2 WHERE id = $1 AND tecnico_id IS NULL RETURNING id`
        : tipo === 'passagem'
          ? `UPDATE passagens_humano SET atribuida_a = $2 WHERE id = $1 AND atribuida_a IS NULL RETURNING id`
          : tipo === 'pedido'
            ? `UPDATE pedidos_entrada SET tecnico_id = $2 WHERE id = $1 AND tecnico_id IS NULL RETURNING id`
            : null;
    if (!sql) return false;
    return (await tx.query(sql, [id, tecnicoId])).length > 0;
  }
}
