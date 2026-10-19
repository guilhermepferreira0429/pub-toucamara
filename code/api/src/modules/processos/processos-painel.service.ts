import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa, somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { mascararTelefone } from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { dadosComRotulos, Dados } from './formulario.js';
import { ProcessosService } from './processos.service.js';
import {
  Fase,
  FASE_ROTULO,
  FASES,
  FASES_FECHADAS,
  mascararNome,
} from './regras.js';
import { TiposProcessoService } from './tipos-processo.service.js';

export const esquemaListaProcessos = esquemaPaginacao.extend({
  fase: z.enum(FASES).optional(),
  /** 'eu' = os meus. */
  tecnico_id: z.union([z.uuid(), z.literal('eu')]).optional(),
  atrasados: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  texto: z.string().trim().min(1).max(100).optional(),
});

export const esquemaAtualizarProcesso = z
  .object({
    fase: z.enum(FASES).optional(),
    tecnico_id: z.uuid().nullable().optional(),
    decisao: z.enum(['admitido', 'indeferido']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nada para alterar.' });

export const esquemaNota = z.object({
  descricao: z.string().trim().min(1).max(4000),
  interno: z.boolean().default(true),
});

export const esquemaPedirDocumento = z
  .object({
    tipo_documento_id: z.uuid().optional(),
    nome: z.string().trim().min(2).max(200).optional(),
    nota: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.tipo_documento_id || b.nome, {
    message: 'Indique o documento (tipo_documento_id ou nome).',
  });

interface LinhaProcesso {
  id: string;
  numero: string;
  tipo_processo_id: string;
  tipo_codigo: string;
  tipo_nome: string;
  prazo_dias_uteis: number;
  assunto: string;
  morada: string | null;
  freguesia: string | null;
  fase: Fase;
  decisao: string | null;
  decidido_em: Date | null;
  tecnico_id: string | null;
  tecnico_nome: string | null;
  municipe_id: string | null;
  municipe_nome: string | null;
  prazo_inicio: string | null;
  prazo_fim: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const SELECT_PROCESSO = `
  SELECT p.id, p.numero, p.tipo_processo_id, t.codigo AS tipo_codigo, t.nome AS tipo_nome,
         t.prazo_dias_uteis, p.assunto, p.morada, p.freguesia, p.fase, p.decisao, p.decidido_em,
         p.tecnico_id, u.nome AS tecnico_nome, p.municipe_id, mu.nome AS municipe_nome,
         to_char(p.prazo_inicio, 'YYYY-MM-DD') AS prazo_inicio,
         to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim,
         p.criado_em, p.atualizado_em
  FROM processos p
  JOIN tipos_processo t ON t.id = p.tipo_processo_id
  LEFT JOIN utilizadores u ON u.id = p.tecnico_id
  LEFT JOIN municipes mu ON mu.id = p.municipe_id`;

/** O back-office dos processos (secção 5.7): lista, ficha e ações do técnico. */
@Injectable()
export class ProcessosPainelService {
  private readonly logger = new Logger(ProcessosPainelService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly processos: ProcessosService,
    private readonly tipos: TiposProcessoService,
    private readonly municipios: MunicipiosService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly mensagens: MensagensService,
  ) {}

  /**
   * Ordenada por prazo (o mais urgente primeiro; sem prazo no fim). O cursor
   * leva o prazo ('infinity' sem prazo) e o id.
   */
  async listar(
    municipio: Municipio,
    u: UtilizadorPainel,
    f: z.output<typeof esquemaListaProcessos>,
  ) {
    const tecnico = f.tecnico_id === 'eu' ? u.id : (f.tecnico_id ?? null);
    const ordem = `coalesce(p.prazo_fim, 'infinity'::date)`;
    const linhas = await this.db.query<LinhaProcesso>(
      `${SELECT_PROCESSO}
       WHERE p.municipio_id = $1
         AND ($2::fase_processo IS NULL OR p.fase = $2)
         AND ($3::uuid IS NULL OR p.tecnico_id = $3)
         AND (NOT $4::boolean OR (p.prazo_fim < $5::date AND p.fase NOT IN ('notificado', 'arquivado')))
         AND ($6::text IS NULL OR p.numero ILIKE '%' || $6 || '%' OR p.assunto ILIKE '%' || $6 || '%'
              OR p.morada ILIKE '%' || $6 || '%')
         AND ($7::date IS NULL OR (${ordem}, p.id) > ($7::date, $8::uuid))
       ORDER BY ${ordem}, p.id
       LIMIT $9`,
      [
        municipio.id,
        f.fase ?? null,
        tecnico,
        f.atrasados ?? false,
        hojeLisboa(),
        f.texto ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    const r = pagina(linhas, f.limite, (l) => ({
      em: l.prazo_fim ?? 'infinity',
      id: l.id,
    }));
    const hoje = hojeLisboa();
    return {
      itens: await Promise.all(
        r.itens.map(async (l) => ({
          id: l.id,
          numero: l.numero,
          tipo: { codigo: l.tipo_codigo, nome: l.tipo_nome },
          assunto: l.assunto,
          morada: l.morada,
          fase: l.fase,
          fase_rotulo: FASE_ROTULO[l.fase],
          decisao: l.decisao,
          tecnico: l.tecnico_id
            ? { id: l.tecnico_id, nome: l.tecnico_nome }
            : null,
          municipe: mascararNome(l.municipe_nome),
          prazo_fim: l.prazo_fim,
          dias_uteis_restantes: await this.processos.diasRestantes(
            municipio.id,
            l.prazo_fim,
            l.fase,
          ),
          atrasado:
            !!l.prazo_fim &&
            l.prazo_fim < hoje &&
            !FASES_FECHADAS.includes(l.fase),
          criado_em: l.criado_em,
        })),
      ),
      proximo_cursor: r.proximo_cursor,
    };
  }

  private async carregar(
    municipioId: string,
    id: string,
    q: Pick<Tx, 'query'> = this.db,
    bloquear = false,
  ) {
    const [p] = await q.query<LinhaProcesso>(
      `${SELECT_PROCESSO} WHERE p.id = $1 AND p.municipio_id = $2 ${bloquear ? 'FOR UPDATE OF p' : ''}`,
      [id, municipioId],
    );
    if (!p)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Processo não existe.',
      );
    return p;
  }

  /** A ficha completa (eventos internos incluídos). */
  async detalhe(municipio: Municipio, id: string) {
    const p = await this.carregar(municipio.id, id);
    const [eventos, documentos, docs, dias, requerimentos, municipe, tipo] =
      await Promise.all([
        this.db.query<Record<string, unknown>>(
          `SELECT e.id, e.tipo, e.descricao, e.interno, e.ator_tipo, e.ator_id,
                u.nome AS ator_nome, e.dados, e.em
         FROM processo_eventos e
         LEFT JOIN utilizadores u ON e.ator_tipo = 'utilizador' AND u.id = e.ator_id
         WHERE e.processo_id = $1 ORDER BY e.em, e.id`,
          [id],
        ),
        this.db.query<{
          id: string;
          tipo_documento_id: string | null;
          tipo_documento: string | null;
          ficheiro_key: string;
          mime: string;
          tamanho: number | null;
          origem: string;
          verificacao_estado: string;
          verificacao: unknown;
          emitido_em: string | null;
          recebido_em: Date;
        }>(
          `SELECT d.id, d.tipo_documento_id, td.nome AS tipo_documento, d.ficheiro_key, d.mime, d.tamanho,
                d.origem, d.verificacao_estado, d.verificacao,
                to_char(d.emitido_em, 'YYYY-MM-DD') AS emitido_em, d.recebido_em
         FROM documentos d
         LEFT JOIN tipo_processo_documentos td ON td.id = d.tipo_documento_id
         WHERE d.processo_id = $1 ORDER BY d.recebido_em`,
          [id],
        ),
        this.processos.emFalta(p),
        this.processos.diasRestantes(municipio.id, p.prazo_fim, p.fase),
        this.db.query<{
          id: string;
          estado: string;
          dados: Dados;
          assinatura: string | null;
          assinado_em: Date | null;
          pdf_key: string | null;
          conversa_id: string | null;
          criado_em: Date;
        }>(
          `SELECT id, estado, dados, assinatura, assinado_em, pdf_key, conversa_id, criado_em
         FROM requerimentos WHERE processo_id = $1 ORDER BY criado_em`,
          [id],
        ),
        p.municipe_id
          ? this.db.query<{
              nome: string | null;
              telefone_e164: string | null;
              email: string | null;
              tem_nif: boolean;
            }>(
              `SELECT nome, telefone_e164, email, nif_hash IS NOT NULL AS tem_nif
             FROM municipes WHERE id = $1`,
              [p.municipe_id],
            )
          : Promise.resolve([]),
        this.tipos.porId(municipio.id, p.tipo_processo_id),
      ]);

    const urlLeitura = async (chave: string | null) =>
      chave && this.armazenamento.disponivel
        ? this.armazenamento.urlLeitura(chave, 10)
        : null;
    const [req] = requerimentos;
    const m = municipe[0];

    return {
      id: p.id,
      numero: p.numero,
      tipo: {
        id: p.tipo_processo_id,
        codigo: p.tipo_codigo,
        nome: p.tipo_nome,
        prazo_dias_uteis: p.prazo_dias_uteis,
      },
      assunto: p.assunto,
      morada: p.morada,
      freguesia: p.freguesia,
      fase: p.fase,
      fase_rotulo: FASE_ROTULO[p.fase],
      decisao: p.decisao,
      decidido_em: p.decidido_em,
      tecnico: p.tecnico_id ? { id: p.tecnico_id, nome: p.tecnico_nome } : null,
      prazo: {
        inicio: p.prazo_inicio,
        fim: p.prazo_fim,
        dias_uteis_restantes: dias,
        atrasado: dias !== null && dias < 0,
      },
      municipe: m
        ? {
            id: p.municipe_id,
            nome: mascararNome(m.nome),
            telefone: m.telefone_e164
              ? mascararTelefone(m.telefone_e164)
              : null,
            tem_email: !!m.email,
            tem_nif: m.tem_nif,
          }
        : null,
      requerimento: req
        ? {
            id: req.id,
            estado: req.estado,
            conversa_id: req.conversa_id,
            dados: dadosComRotulos(tipo.formulario, req.dados),
            assinatura: req.assinatura,
            assinatura_simulada: req.assinatura === 'simulada',
            assinado_em: req.assinado_em,
            pdf_url: await urlLeitura(req.pdf_key),
            criado_em: req.criado_em,
          }
        : null,
      documentos: await Promise.all(
        documentos.map(async ({ ficheiro_key, ...d }) => ({
          ...d,
          url: await urlLeitura(ficheiro_key),
        })),
      ),
      documentos_resumo: docs,
      armazenamento_disponivel: this.armazenamento.disponivel,
      eventos,
      criado_em: p.criado_em,
      atualizado_em: p.atualizado_em,
    };
  }

  private async evento(
    tx: Tx,
    processoId: string,
    u: UtilizadorPainel,
    tipo: string,
    descricao: string,
    interno: boolean,
    dados: Record<string, unknown> = {},
  ): Promise<{ id: string; em: Date }> {
    const [e] = await tx.query<{ id: string; em: Date }>(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, interno, dados)
       VALUES ($1, $2, $3, 'utilizador', $4, $5, $6) RETURNING id, em`,
      [processoId, tipo, descricao, u.id, interno, JSON.stringify(dados)],
    );
    return e;
  }

  /**
   * Fase, técnico e decisão. Cada mudança fica na linha do tempo; a decisão,
   * ao chegar a 'decisao'/'notificado', vai por SMS ao munícipe (uma vez por
   * decisão). Sair de 'documentos' com o prazo por começar começa-o hoje.
   */
  async atualizar(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaAtualizarProcesso>,
  ) {
    await this.db.transaction(async (tx) => {
      const p = await this.carregar(municipio.id, id, tx, true);

      if (b.tecnico_id !== undefined && b.tecnico_id !== p.tecnico_id) {
        let nome: string | null = null;
        if (b.tecnico_id) {
          const [t] = await tx.query<{ nome: string }>(
            `SELECT nome FROM utilizadores
             WHERE id = $1 AND ativo AND (municipio_id = $2 OR municipio_id IS NULL)`,
            [b.tecnico_id, municipio.id],
          );
          if (!t) {
            throw new ErroApi(
              HttpStatus.BAD_REQUEST,
              'tecnico_invalido',
              'Esse técnico não existe nesta câmara.',
            );
          }
          nome = t.nome;
        }
        await tx.query('UPDATE processos SET tecnico_id = $2 WHERE id = $1', [
          id,
          b.tecnico_id,
        ]);
        await this.evento(
          tx,
          id,
          u,
          'atribuido',
          nome ? `Atribuído a ${nome}.` : 'Sem técnico atribuído.',
          true,
          {
            de: p.tecnico_id,
            para: b.tecnico_id,
          },
        );
        await this.auditoria.registar(
          {
            municipioId: municipio.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'reatribuir',
            objetoTipo: 'processo',
            objetoId: id,
            dados: { de: p.tecnico_id, para: b.tecnico_id },
          },
          tx,
        );
      }

      const fase = b.fase ?? p.fase;
      if (b.fase && b.fase !== p.fase) {
        await tx.query('UPDATE processos SET fase = $2 WHERE id = $1', [
          id,
          b.fase,
        ]);
        await this.evento(
          tx,
          id,
          u,
          'fase',
          `Fase: ${FASE_ROTULO[p.fase]} → ${FASE_ROTULO[b.fase]}.`,
          false,
          {
            de: p.fase,
            para: b.fase,
          },
        );
        // O prazo conta com o processo completo: começa quando sai de 'documentos'.
        if (!p.prazo_inicio && !['documentos', 'arquivado'].includes(b.fase)) {
          const hoje = hojeLisboa();
          const fim = somarDiasUteis(
            hoje,
            p.prazo_dias_uteis,
            await this.municipios.feriados(municipio.id),
          );
          await tx.query(
            'UPDATE processos SET prazo_inicio = $2, prazo_fim = $3 WHERE id = $1',
            [id, hoje, fim],
          );
          await this.evento(
            tx,
            id,
            u,
            'prazo',
            `Processo completo: o prazo de resposta termina a ${fim.split('-').reverse().join('/')}.`,
            false,
            {
              prazo_inicio: hoje,
              prazo_fim: fim,
            },
          );
        }
      }

      const decisao = b.decisao ?? p.decisao;
      if (b.decisao && b.decisao !== p.decisao) {
        await tx.query(
          'UPDATE processos SET decisao = $2, decidido_em = now() WHERE id = $1',
          [id, b.decisao],
        );
        await this.evento(
          tx,
          id,
          u,
          'decisao',
          `Decisão: ${b.decisao}.`,
          true,
          { decisao: b.decisao },
        );
        await this.auditoria.registar(
          {
            municipioId: municipio.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'decidir',
            objetoTipo: 'processo',
            objetoId: id,
            dados: { decisao: b.decisao },
          },
          tx,
        );
      }
      await tx.query(
        'UPDATE processos SET atualizado_em = now() WHERE id = $1',
        [id],
      );

      if (decisao && (fase === 'decisao' || fase === 'notificado')) {
        await this.smsDecisao(tx, municipio, p, decisao);
      }
    });
    return this.detalhe(municipio, id);
  }

  private async smsDecisao(
    tx: Tx,
    municipio: Municipio,
    p: LinhaProcesso,
    decisao: string,
  ) {
    const telefone = await this.processos.telefoneDe(p.municipe_id, tx);
    if (!telefone) {
      this.logger.warn(
        `Processo ${p.numero}: decisão sem telefone para avisar.`,
      );
      return;
    }
    const link = await this.processos.linkProcesso(municipio.id, p.id, tx);
    await this.mensagens.sms(
      {
        municipioId: municipio.id,
        municipeId: p.municipe_id,
        destino: telefone,
        motivo: 'processo',
        corpo:
          `${municipio.nome}: há decisão no processo ${p.numero}: ` +
          `${decisao === 'admitido' ? 'admitido' : 'indeferido'}. Veja os detalhes aqui: ${link}`,
        relacionado: { processo_id: p.id },
        chave: `processo_decisao:${p.id}:${decisao}`,
      },
      tx,
    );
  }

  async nota(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaNota>,
  ) {
    return this.db.transaction(async (tx) => {
      await this.carregar(municipio.id, id, tx);
      const e = await this.evento(
        tx,
        id,
        u,
        b.interno ? 'nota_interna' : 'nota',
        b.descricao,
        b.interno,
      );
      await tx.query(
        'UPDATE processos SET atualizado_em = now() WHERE id = $1',
        [id],
      );
      return { id: e.id, em: e.em, interno: b.interno };
    });
  }

  /** Evento visível 'documento_pedido' + SMS com o link do processo. */
  async pedirDocumento(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaPedirDocumento>,
  ) {
    return this.db.transaction(async (tx) => {
      const p = await this.carregar(municipio.id, id, tx, true);
      let nome = b.nome ?? null;
      if (b.tipo_documento_id) {
        const [d] = await tx.query<{ nome: string }>(
          'SELECT nome FROM tipo_processo_documentos WHERE id = $1 AND tipo_processo_id = $2',
          [b.tipo_documento_id, p.tipo_processo_id],
        );
        if (!d) {
          throw new ErroApi(
            HttpStatus.BAD_REQUEST,
            'documento_desconhecido',
            'Esse documento não é deste tipo de processo.',
          );
        }
        nome = nome ?? d.nome;
      }
      const e = await this.evento(
        tx,
        id,
        u,
        'documento_pedido',
        `Pedido ao munícipe: ${nome}${b.nota ? ` (${b.nota})` : ''}.`,
        false,
        {
          nome,
          tipo_documento_id: b.tipo_documento_id ?? null,
          nota: b.nota ?? null,
        },
      );
      await tx.query(
        'UPDATE processos SET atualizado_em = now() WHERE id = $1',
        [id],
      );

      const telefone = await this.processos.telefoneDe(p.municipe_id, tx);
      let smsId: string | null = null;
      if (telefone) {
        const link = await this.processos.linkProcesso(municipio.id, id, tx);
        smsId = await this.mensagens.sms(
          {
            municipioId: municipio.id,
            municipeId: p.municipe_id,
            destino: telefone,
            motivo: 'processo',
            corpo:
              `${municipio.nome}: no processo ${p.numero} precisamos de: ${nome}.` +
              `${b.nota ? ` ${b.nota}` : ''} Envie aqui: ${link}`,
            relacionado: { processo_id: id },
            chave: `processo_pedido:${e.id}`,
          },
          tx,
        );
      }
      return { evento_id: e.id, em: e.em, sms_enviado: smsId !== null };
    });
  }
}
