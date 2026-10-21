import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import { formatarEuros } from '../pagamentos/taxas.js';
import { gerarPdfLicenca } from './licenca-pdf.js';
import {
  ATIVIDADES,
  Atividade,
  Avaliacao,
  avaliarRuido,
  ConfigRuido,
  esquemaConfigRuido,
  lerConfigRuido,
} from './regras.js';

const hora = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3])[:h]([0-5]\d)?$/, 'Hora como 20:00.')
  .transform((h) => {
    const [a, b] = h.split(/[:h]/);
    return `${a.padStart(2, '0')}:${(b || '00').padStart(2, '0')}`;
  });

export const entradaPedirRuido = z.object({
  atividade: z
    .enum(Object.keys(ATIVIDADES) as [Atividade, ...Atividade[]])
    .describe(
      'festa_privada (aniversário, casamento…), evento (aberto ao público) ou obra (ruidosa, fora de horas).',
    ),
  descricao: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      'O que vai acontecer, numa frase (ex.: "festa de anos no quintal, com música").',
    ),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Onde: rua, número e freguesia.'),
  data: z.iso
    .date()
    .describe('O dia, AAAA-MM-DD (ex.: sábado 31 de outubro → 2026-10-31).'),
  hora_inicio: hora.describe('Hora a que começa, HH:MM.'),
  hora_fim: hora.describe(
    'Hora a que acaba, HH:MM (pode passar da meia-noite, ex.: 01:00).',
  ),
  pessoas: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .optional()
    .describe('Quantas pessoas, mais ou menos.'),
  musica_amplificada: z
    .boolean()
    .optional()
    .describe('Se vai haver colunas ou música alta.'),
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Nome do titular, para a licença.'),
  metodo: z
    .enum(['mbway', 'multibanco'])
    .optional()
    .describe(
      'Como quer pagar a taxa; por omissão MB WAY para o telemóvel de onde liga.',
    ),
});

export const esquemaRecusar = z.object({
  motivo: z.string().trim().min(5).max(500),
});

export type EstadoLicenca =
  'a_pagar' | 'por_aprovar' | 'para_tecnico' | 'emitida' | 'recusada';

interface Linha {
  id: string;
  municipio_id: string;
  processo_id: string;
  numero: string;
  tipo: 'ruido';
  municipe_id: string | null;
  conversa_id: string | null;
  dados: z.output<typeof entradaPedirRuido>;
  avaliacao: Avaliacao;
  config_usada: ConfigRuido;
  proposta: 'aprovar' | 'tecnico';
  estado: EstadoLicenca;
  taxa_cent: number;
  codigo_verificacao: string;
  decidida_por: string | null;
  decidida_por_nome: string | null;
  decidida_em: Date | null;
  motivo_recusa: string | null;
  criada_em: Date;
  telefone: string | null;
  titular: string | null;
  pagamento: {
    id: string;
    estado: string;
    metodo: string | null;
    valor_cent: number;
    pago_em: string | null;
    modo_teste: boolean;
  } | null;
}

const SELECT = `
  SELECT l.id, l.municipio_id, l.processo_id, p.numero, l.tipo, l.municipe_id, l.conversa_id,
         l.dados, l.avaliacao, l.config_usada, l.proposta, l.estado, l.taxa_cent,
         l.codigo_verificacao, l.decidida_por, u.nome AS decidida_por_nome, l.decidida_em,
         l.motivo_recusa, l.criada_em, mu.telefone_e164 AS telefone,
         coalesce(l.dados->>'nome', mu.nome) AS titular,
         (SELECT jsonb_build_object('id', pg.id, 'estado', pg.estado, 'metodo', pg.metodo,
                   'valor_cent', pg.valor_cent, 'pago_em', pg.pago_em, 'modo_teste', pg.modo_teste)
          FROM pagamentos pg WHERE pg.processo_id = l.processo_id
          ORDER BY (pg.estado = 'pago') DESC, pg.criado_em DESC LIMIT 1) AS pagamento
  FROM licencas l
  JOIN processos p ON p.id = l.processo_id
  LEFT JOIN municipes mu ON mu.id = l.municipe_id
  LEFT JOIN utilizadores u ON u.id = l.decidida_por`;

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Licenças decididas na chamada (começa pela licença especial de ruído):
 * as regras correm em código, a taxa paga-se em modo de teste e um
 * funcionário aprova com um clique (ou a câmara deixa emitir sozinha).
 */
@Injectable()
export class LicencasService {
  private readonly logger = new Logger(LicencasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly pagamentos: PagamentosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Regras (painel)
  // ------------------------------------------------------------------

  async configRuido(municipioId: string): Promise<ConfigRuido> {
    const [r] = await this.db.query<{ config: unknown }>(
      `SELECT config FROM licenca_regras WHERE municipio_id = $1 AND tipo = 'ruido'`,
      [municipioId],
    );
    return lerConfigRuido(r?.config);
  }

  async guardarConfig(m: Municipio, u: UtilizadorPainel, c: ConfigRuido) {
    await this.db.query(
      `INSERT INTO licenca_regras (municipio_id, tipo, config, atualizado_por)
       VALUES ($1, 'ruido', $2, $3)
       ON CONFLICT (municipio_id, tipo) DO UPDATE
         SET config = EXCLUDED.config, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [m.id, JSON.stringify(c), u.id],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_regras_licenca',
      objetoTipo: 'licenca_regras',
      objetoId: m.id,
      dados: { tipo: 'ruido' },
    });
    return { config: c };
  }

  // ------------------------------------------------------------------
  // Ferramenta do agente
  // ------------------------------------------------------------------

  async pedirRuido(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPedirRuido>,
  ) {
    const m = ctx.municipio;
    const telefone = normalizarTelefone(ctx.telefone);
    if (!ctx.municipeId && !telefone) {
      return {
        pedida: false,
        motivo: 'precisa_identificacao',
        instrucao:
          ctx.canal === 'chat'
            ? 'Para pedir a licença a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.'
            : 'Não há um número para onde mandar a licença. Pede o número de telemóvel e usa identificar_municipe, ou passa a um funcionário.',
      };
    }
    const config = await this.configRuido(m.id);
    const feriados = await this.municipios.feriados(m.id);
    const avaliacao = avaliarRuido(e, config, hojeLisboa(), feriados);
    const aprovar = avaliacao.proposta === 'aprovar';
    const comTaxa = aprovar && config.taxa_cent > 0;

    const r = await this.db.transaction(async (tx) => {
      const municipeId =
        ctx.municipeId ??
        (await this.municipes.porTelefone(m.id, telefone, tx))?.id ??
        null;
      if (municipeId && e.nome) {
        await tx.query(
          'UPDATE municipes SET nome = coalesce(nome, $2) WHERE id = $1',
          [municipeId, e.nome],
        );
      }
      const tipoId = await this.tipoLer(tx, m.id);
      const ano = new Date().getFullYear();
      const numero = `LER ${await proximoNumero(tx, m.id, 'LER', ano)}/${ano}`;
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, conversa_origem_id,
           assunto, morada, fase, prazo_inicio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'apreciacao', $8) RETURNING id`,
        [
          m.id,
          numero,
          tipoId,
          municipeId,
          ctx.conversaId,
          `${e.descricao} · ${diaCurto(e.data)}`,
          e.morada,
          hojeLisboa(),
        ],
      );
      const falhadas = avaliacao.regras.filter((x) => !x.ok);
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados)
         VALUES ($1, 'criado', $2, 'agente', $3)`,
        [
          p.id,
          aprovar
            ? `Pedido de licença de ruído verificado pelas regras: cumpre todas (${avaliacao.regras.length}). Proposta: aprovar.`
            : `Pedido de licença de ruído verificado pelas regras: ${falhadas.length} por cumprir. Vai para um técnico.`,
          JSON.stringify({ avaliacao }),
        ],
      );
      const codigo = Array.from(
        { length: 10 },
        () => ALFABETO[randomInt(ALFABETO.length)],
      ).join('');
      const estado: EstadoLicenca = !aprovar
        ? 'para_tecnico'
        : comTaxa
          ? 'a_pagar'
          : 'por_aprovar';
      const [l] = await tx.query<{ id: string }>(
        `INSERT INTO licencas (municipio_id, processo_id, tipo, municipe_id, conversa_id, dados,
           avaliacao, config_usada, proposta, estado, taxa_cent, codigo_verificacao)
         VALUES ($1, $2, 'ruido', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          m.id,
          p.id,
          municipeId,
          ctx.conversaId,
          JSON.stringify(e),
          JSON.stringify(avaliacao),
          JSON.stringify(config),
          avaliacao.proposta,
          estado,
          aprovar ? config.taxa_cent : 0,
          codigo,
        ],
      );
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { licenca_id: l.id, numero, proposta: avaliacao.proposta },
        tx,
      );
      if (!aprovar && telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId,
            destino: telefone,
            motivo: 'processo',
            corpo: `${m.nome}: recebemos o pedido de licença de ruído ${numero}. Precisa de ser visto por um técnico (${falhadas[0]?.texto ?? 'fora das regras'}). Damos resposta por SMS.`,
            relacionado: { processo_id: p.id, licenca_id: l.id },
            chave: `licenca_tecnico:${l.id}`,
          },
          tx,
        );
      }
      return { licencaId: l.id, processoId: p.id, numero };
    });

    let pagamento: Awaited<ReturnType<PagamentosService['criar']>> | null =
      null;
    if (comTaxa) {
      pagamento = await this.pagamentos.criar(
        ctx,
        {
          processo_id: r.processoId,
          metodo:
            e.metodo ??
            (telefone?.startsWith('+3519') ? 'mbway' : 'multibanco'),
        },
        {
          linhas: [
            {
              codigo: 'LER',
              descricao: 'Licença especial de ruído',
              unidade: 'fixo',
              quantidade: 1,
              valor_unitario_cent: config.taxa_cent,
              valor_cent: config.taxa_cent,
            },
          ],
          total_cent: config.taxa_cent,
        },
      );
    }

    const regrasDitas = avaliacao.regras.map(
      (x) => `${x.ok ? '✓' : '✗'} ${x.texto}`,
    );
    return {
      pedida: true,
      numero: r.numero,
      proposta: avaliacao.proposta,
      regras: regrasDitas,
      condicoes: avaliacao.condicoes,
      taxa: aprovar ? formatarEuros(config.taxa_cent) : null,
      pagamento,
      regras_de_demonstracao: config.demonstracao,
      fonte: config.fonte.titulo,
      dizer: aprovar
        ? `Verifiquei as regras e o seu pedido cumpre todas. ` +
          (comTaxa
            ? `A taxa é de ${formatarEuros(config.taxa_cent)}. ${pagamento?.dizer ?? ''} `
            : '') +
          (config.aprovacao === 'automatica'
            ? 'Assim que estiver paga, a licença segue por SMS, com um código QR.'
            : 'Assim que estiver paga, um funcionário confirma e a licença segue por SMS, com um código QR.')
        : `O pedido ficou registado com o número ${r.numero}, mas não cabe nas regras automáticas: ${avaliacao.regras
            .filter((x) => !x.ok)
            .map((x) => x.texto)
            .join(
              ' ',
            )} Vai ser visto por um técnico e recebe a resposta por SMS.`,
    };
  }

  // ------------------------------------------------------------------
  // Depois do pagamento
  // ------------------------------------------------------------------

  /**
   * Licenças pagas passam a 'por_aprovar'; se a câmara deixou emitir
   * sozinho, ou se um técnico já aprovou antes do pagamento, emite-se.
   * Corre no job (a cada minuto) e antes de cada leitura do painel.
   */
  async sincronizar(municipioId?: string): Promise<number> {
    const pagas = await this.db.query<{
      id: string;
      municipio_id: string;
      automatica: boolean;
      decidida_por: string | null;
    }>(
      `SELECT l.id, l.municipio_id, (l.config_usada->>'aprovacao') = 'automatica' AS automatica,
              l.decidida_por
       FROM licencas l
       WHERE l.estado = 'a_pagar' AND ($1::uuid IS NULL OR l.municipio_id = $1)
         AND EXISTS (SELECT 1 FROM pagamentos pg WHERE pg.processo_id = l.processo_id AND pg.estado = 'pago')`,
      [municipioId ?? null],
    );
    for (const l of pagas) {
      await this.db.transaction(async (tx) => {
        const [mudou] = await tx.query<{ id: string }>(
          `UPDATE licencas SET estado = 'por_aprovar' WHERE id = $1 AND estado = 'a_pagar' RETURNING id`,
          [l.id],
        );
        if (!mudou) return;
        if (l.automatica || l.decidida_por) {
          await this.emitir(
            tx,
            l.id,
            l.decidida_por,
            l.decidida_por ? null : 'regras',
          );
        }
      });
    }
    return pagas.length;
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async listar(m: Municipio, estado?: EstadoLicenca) {
    await this.sincronizar(m.id);
    const linhas = await this.db.query<Linha>(
      `${SELECT} WHERE l.municipio_id = $1 AND ($2::text IS NULL OR l.estado = $2)
       ORDER BY CASE l.estado WHEN 'por_aprovar' THEN 0 WHEN 'para_tecnico' THEN 1
                  WHEN 'a_pagar' THEN 2 ELSE 3 END, l.criada_em DESC
       LIMIT 100`,
      [m.id, estado ?? null],
    );
    const [contagens] = await this.db.query<Record<EstadoLicenca, number>>(
      `SELECT count(*) FILTER (WHERE estado = 'a_pagar')::int AS a_pagar,
              count(*) FILTER (WHERE estado = 'por_aprovar')::int AS por_aprovar,
              count(*) FILTER (WHERE estado = 'para_tecnico')::int AS para_tecnico,
              count(*) FILTER (WHERE estado = 'emitida')::int AS emitida,
              count(*) FILTER (WHERE estado = 'recusada')::int AS recusada
       FROM licencas WHERE municipio_id = $1`,
      [m.id],
    );
    return {
      licencas: linhas.map((l) => this.paraPainel(l)),
      contagens,
      config: await this.configRuido(m.id),
    };
  }

  async detalhe(m: Municipio, id: string) {
    await this.sincronizar(m.id);
    return this.paraPainel(await this.porId(this.db, m.id, id));
  }

  /**
   * "Aprovar e emitir": por aprovar → emitida (SMS com a licença). Para
   * técnico → o técnico aprova; se houver taxa, falta pagar e emite-se
   * quando chegar o pagamento.
   */
  async aprovar(m: Municipio, u: UtilizadorPainel, id: string) {
    const r = await this.db.transaction(async (tx) => {
      const l = await this.porId(tx, m.id, id, true);
      if (l.estado === 'por_aprovar') {
        await this.emitir(tx, l.id, u.id, null);
        return { estado: 'emitida' as const, criarPagamento: false, l };
      }
      if (l.estado !== 'para_tecnico') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          l.estado === 'a_pagar'
            ? 'A taxa ainda não está paga.'
            : 'Esta licença já foi decidida.',
        );
      }
      const taxa = l.config_usada.taxa_cent;
      await tx.query(
        `UPDATE licencas SET decidida_por = $2, decidida_em = now(), taxa_cent = $3,
           estado = CASE WHEN $3 > 0 THEN 'a_pagar' ELSE estado END
         WHERE id = $1`,
        [l.id, u.id, taxa],
      );
      await this.evento(
        tx,
        l.processo_id,
        u.id,
        'O técnico aprovou o pedido fora das regras automáticas.',
      );
      if (taxa <= 0) {
        await this.emitir(tx, l.id, u.id, null);
        return { estado: 'emitida' as const, criarPagamento: false, l };
      }
      return { estado: 'a_pagar' as const, criarPagamento: true, l };
    });
    if (r.criarPagamento) {
      const ctx: ContextoFerramenta = {
        municipio: m,
        canal: 'telefone',
        conversaId: r.l.conversa_id,
        municipeId: r.l.municipe_id,
        telefone: r.l.telefone,
      };
      await this.pagamentos.criar(
        ctx,
        { processo_id: r.l.processo_id, metodo: 'multibanco' },
        {
          linhas: [
            {
              codigo: 'LER',
              descricao: 'Licença especial de ruído',
              unidade: 'fixo',
              quantidade: 1,
              valor_unitario_cent: r.l.config_usada.taxa_cent,
              valor_cent: r.l.config_usada.taxa_cent,
            },
          ],
          total_cent: r.l.config_usada.taxa_cent,
        },
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'aprovar_licenca',
      objetoTipo: 'licenca',
      objetoId: id,
    });
    return this.detalhe(m, id);
  }

  async recusar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaRecusar>,
  ) {
    await this.db.transaction(async (tx) => {
      const l = await this.porId(tx, m.id, id, true);
      if (l.estado === 'emitida' || l.estado === 'recusada') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'Esta licença já foi decidida.',
        );
      }
      await tx.query(
        `UPDATE licencas SET estado = 'recusada', decidida_por = $2, decidida_em = now(),
           motivo_recusa = $3 WHERE id = $1`,
        [l.id, u.id, d.motivo],
      );
      await tx.query(
        `UPDATE processos SET fase = 'notificado', decisao = 'indeferido', decidido_em = now(),
           atualizado_em = now() WHERE id = $1`,
        [l.processo_id],
      );
      await tx.query(
        `UPDATE pagamentos SET estado = 'cancelado' WHERE processo_id = $1 AND estado = 'pendente'`,
        [l.processo_id],
      );
      await this.evento(
        tx,
        l.processo_id,
        u.id,
        `Licença recusada: ${d.motivo}`,
      );
      if (l.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: l.municipe_id,
            destino: l.telefone,
            motivo: 'processo',
            corpo: `${m.nome}: a licença de ruído ${l.numero} não foi concedida. ${d.motivo}`,
            relacionado: { processo_id: l.processo_id, licenca_id: l.id },
            chave: `licenca_recusada:${l.id}`,
          },
          tx,
        );
      }
    });
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'recusar_licenca',
      objetoTipo: 'licenca',
      objetoId: id,
    });
    return this.detalhe(m, id);
  }

  // ------------------------------------------------------------------
  // Público (a página do QR)
  // ------------------------------------------------------------------

  async publico(codigo: string) {
    const l = await this.porCodigo(codigo);
    const municipio = await this.municipios.porId(l.municipio_id);
    const hoje = hojeLisboa();
    return {
      numero: l.numero,
      municipio: municipio.nome,
      estado: l.estado,
      valida: l.estado === 'emitida' && l.dados.data >= hoje,
      expirada: l.estado === 'emitida' && l.dados.data < hoje,
      titular: abreviarNome(l.titular),
      atividade: ATIVIDADES[l.dados.atividade],
      descricao: l.dados.descricao,
      morada: l.dados.morada,
      dia: diaPorExtenso(l.dados.data),
      horario: `${l.dados.hora_inicio} às ${l.dados.hora_fim}`,
      condicoes: l.avaliacao.condicoes,
      emitida_em:
        l.estado === 'emitida' ? (l.decidida_em?.toISOString() ?? null) : null,
      fonte: l.config_usada.fonte.titulo,
      modo_teste: l.pagamento?.modo_teste ?? true,
      regras_de_demonstracao: l.config_usada.demonstracao,
      pdf: l.estado === 'emitida',
    };
  }

  async pdf(codigo: string): Promise<{ nome: string; pdf: Buffer }> {
    const l = await this.porCodigo(codigo);
    if (l.estado !== 'emitida' || !l.decidida_em) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'licenca_por_emitir',
        'Esta licença ainda não foi emitida.',
      );
    }
    const municipio = await this.municipios.porId(l.municipio_id);
    const pdf = await gerarPdfLicenca({
      municipio: `Câmara Municipal de ${municipio.nome}`,
      numero: l.numero,
      titulo: 'Licença especial de ruído',
      titular: l.titular,
      atividade: `${ATIVIDADES[l.dados.atividade]}: ${l.dados.descricao}`,
      morada: l.dados.morada,
      dia: diaPorExtenso(l.dados.data),
      horario: `das ${l.dados.hora_inicio} às ${l.dados.hora_fim}`,
      condicoes: l.avaliacao.condicoes,
      fonte: l.config_usada.fonte.titulo,
      emitida: {
        por: l.decidida_por_nome ?? 'regras automáticas da câmara',
        em: l.decidida_em,
      },
      urlVerificacao: this.urlVerificacao(l.codigo_verificacao),
      codigo: l.codigo_verificacao,
      modoTeste: l.pagamento?.modo_teste ?? true,
      regrasDemonstracao: l.config_usada.demonstracao,
    });
    return { nome: `licenca-${l.numero.replace(/\W+/g, '-')}.pdf`, pdf };
  }

  // ------------------------------------------------------------------

  private async emitir(
    tx: Tx,
    id: string,
    utilizadorId: string | null,
    origem: 'regras' | null,
  ) {
    const [l] = await tx.query<{
      processo_id: string;
      municipio_id: string;
      municipe_id: string | null;
      codigo_verificacao: string;
      numero: string;
      telefone: string | null;
      data: string;
    }>(
      `UPDATE licencas l SET estado = 'emitida', decidida_em = coalesce(l.decidida_em, now()),
         decidida_por = coalesce(l.decidida_por, $2)
       FROM processos p
       WHERE l.id = $1 AND p.id = l.processo_id
       RETURNING l.processo_id, l.municipio_id, l.municipe_id, l.codigo_verificacao, p.numero,
         (SELECT telefone_e164 FROM municipes WHERE id = l.municipe_id) AS telefone,
         l.dados->>'data' AS data`,
      [id, utilizadorId],
    );
    await tx.query(
      `UPDATE processos SET fase = 'notificado', decisao = 'admitido', decidido_em = now(),
         atualizado_em = now() WHERE id = $1`,
      [l.processo_id],
    );
    await this.evento(
      tx,
      l.processo_id,
      utilizadorId,
      origem === 'regras'
        ? 'Licença emitida automaticamente depois do pagamento (regras da câmara).'
        : 'Licença aprovada e emitida.',
    );
    if (l.telefone) {
      const municipio = await this.municipios.porId(l.municipio_id);
      await this.mensagens.sms(
        {
          municipioId: l.municipio_id,
          municipeId: l.municipe_id,
          destino: l.telefone,
          motivo: 'processo',
          corpo: `${municipio.nome}: a sua licença de ruído ${l.numero} para ${diaCurto(l.data)} está emitida. Licença e QR: ${this.urlVerificacao(l.codigo_verificacao)}`,
          relacionado: { processo_id: l.processo_id, licenca_id: id },
          chave: `licenca_emitida:${id}`,
        },
        tx,
      );
    }
  }

  private async evento(
    tx: Tx,
    processoId: string,
    utilizadorId: string | null,
    descricao: string,
  ) {
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id)
       VALUES ($1, 'decisao', $2, $3, $4)`,
      [
        processoId,
        descricao,
        utilizadorId ? 'utilizador' : 'sistema',
        utilizadorId,
      ],
    );
  }

  private urlVerificacao(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/licenca/${codigo}`;
  }

  /** O tipo de processo 'LER' do município (cria-o na primeira licença). */
  private async tipoLer(tx: Tx, municipioId: string): Promise<string> {
    const [t] = await tx.query<{ id: string }>(
      `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, formulario, frase_do_agente)
       VALUES ($1, 'LER', 'Licença especial de ruído', 5, '[]',
         'Verifico as regras durante a chamada; se cumprir, paga a taxa e a licença chega por SMS.')
       ON CONFLICT (municipio_id, codigo) DO UPDATE SET codigo = EXCLUDED.codigo
       RETURNING id`,
      [municipioId],
    );
    return t.id;
  }

  private async porId(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    id: string,
    bloquear = false,
  ): Promise<Linha> {
    if (bloquear) {
      await q.query('SELECT 1 FROM licencas WHERE id = $1 FOR UPDATE', [id]);
    }
    const [l] = await q.query<Linha>(
      `${SELECT} WHERE l.id = $1 AND l.municipio_id = $2`,
      [id, municipioId],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'licenca_desconhecida',
        'Esta licença não existe.',
      );
    }
    return l;
  }

  private async porCodigo(codigo: string): Promise<Linha> {
    const c = codigo.trim().toUpperCase();
    const [l] = /^[A-Z0-9]{10}$/.test(c)
      ? await this.db.query<Linha>(
          `${SELECT} WHERE l.codigo_verificacao = $1`,
          [c],
        )
      : [];
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'licenca_desconhecida',
        'Não há nenhuma licença com este código.',
      );
    }
    return l;
  }

  private paraPainel(l: Linha) {
    return {
      id: l.id,
      numero: l.numero,
      processo_id: l.processo_id,
      tipo: l.tipo,
      estado: l.estado,
      proposta: l.proposta,
      dados: { ...l.dados, atividade_texto: ATIVIDADES[l.dados.atividade] },
      dia: diaPorExtenso(l.dados.data),
      avaliacao: l.avaliacao,
      config_usada: l.config_usada,
      taxa_cent: l.taxa_cent,
      titular: l.titular,
      telefone: l.telefone,
      conversa_id: l.conversa_id,
      pagamento: l.pagamento,
      codigo_verificacao: l.estado === 'emitida' ? l.codigo_verificacao : null,
      decidida_por_nome: l.decidida_por_nome,
      decidida_em: l.decidida_em?.toISOString() ?? null,
      motivo_recusa: l.motivo_recusa,
      criada_em: l.criada_em.toISOString(),
    };
  }
}

export { esquemaConfigRuido };

function diaPorExtenso(dia: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${dia}T12:00:00Z`));
}

function diaCurto(dia: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dia}T12:00:00Z`));
}

/** "Maria Silva" → "Maria S." (a página do QR é pública). */
function abreviarNome(nome: string | null): string | null {
  if (!nome) return null;
  const p = nome.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
}
