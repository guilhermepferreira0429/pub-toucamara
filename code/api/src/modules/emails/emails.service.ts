import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConhecimentoService } from '../conhecimento/conhecimento.service.js';
import {
  conteudoClassificacao,
  DadosClassificacao,
  esquemaClassificacao,
  normalizarClassificacao,
  Opcao,
  SISTEMA_CLASSIFICAR,
} from './emails.classificacao.js';

export const FILA_CLASSIFICAR = 'classificar_email';

export type EstadoEmail =
  'nova' | 'respondida' | 'encaminhada' | 'virou_processo';

export interface NovoEmailEntrada {
  municipioId: string;
  de: string;
  para: string | null;
  assunto: string | null;
  texto: string;
  html: string | null;
  anexos: { nome: string; mime: string; tamanho: number }[];
  mensagemId: string | null;
  recebidoEm: Date;
}

interface LinhaLista {
  id: string;
  de: string;
  assunto: string | null;
  excerto: string;
  recebido_em: Date;
  estado: EstadoEmail;
  servico_id: string | null;
  servico: string | null;
  entidade: string | null;
  tema: string | null;
  confianca: string | null;
  tem_rascunho: boolean;
  num_anexos: number;
}

/**
 * Email geral: entra pelo webhook, é classificado por IA (serviço, entidade,
 * tema e rascunho com fontes) e respondido ou encaminhado no painel.
 */
@Injectable()
export class EmailsService implements OnModuleInit {
  private readonly logger = new Logger(EmailsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly claude: ClaudeService,
    private readonly conhecimento: ConhecimentoService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar<{ emailId: string }>(FILA_CLASSIFICAR, ({ emailId }) =>
      this.classificar(emailId),
    );
  }

  /** O município pelo endereço do email geral (um dos destinatários). */
  async municipioPorEndereco(enderecos: string[]): Promise<string | null> {
    if (enderecos.length === 0) return null;
    const [m] = await this.db.query<{ id: string }>(
      `SELECT id FROM municipios WHERE email_geral = ANY($1::citext[]) LIMIT 1`,
      [enderecos],
    );
    return m?.id ?? null;
  }

  /** Grava (idempotente pelo Message-ID) e põe na fila de classificação. */
  async receber(
    e: NovoEmailEntrada,
  ): Promise<{ id: string; duplicado: boolean }> {
    const [criado] = await this.db.query<{ id: string }>(
      `INSERT INTO emails_entrada (municipio_id, de, para, assunto, corpo, html,
         anexos, recebido_em, mensagem_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (municipio_id, mensagem_id) WHERE mensagem_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        e.municipioId,
        e.de,
        e.para,
        e.assunto,
        e.texto,
        e.html,
        JSON.stringify(e.anexos),
        e.recebidoEm,
        e.mensagemId,
      ],
    );
    if (!criado) {
      const [existente] = await this.db.query<{ id: string }>(
        `SELECT id FROM emails_entrada WHERE municipio_id = $1 AND mensagem_id = $2`,
        [e.municipioId, e.mensagemId],
      );
      return { id: existente.id, duplicado: true };
    }
    await this.jobs.enviar(
      FILA_CLASSIFICAR,
      { emailId: criado.id },
      { singletonKey: criado.id },
    );
    return { id: criado.id, duplicado: false };
  }

  /**
   * O trabalho `classificar_email`. Sem IA fica 'nova' sem classificação (o
   * painel trata-o à mão). Só classifica uma vez e só se ainda estiver 'nova'.
   */
  async classificar(emailId: string): Promise<void> {
    const [email] = await this.db.query<{
      municipio_id: string;
      de: string;
      assunto: string | null;
      corpo: string;
      anexos: { nome?: string }[];
      estado: EstadoEmail;
      classificado_em: Date | null;
    }>(
      `SELECT municipio_id, de, assunto, corpo, anexos, estado, classificado_em
       FROM emails_entrada WHERE id = $1`,
      [emailId],
    );
    if (!email || email.estado !== 'nova' || email.classificado_em) return;
    if (!this.claude.disponivel) {
      this.logger.warn(`Sem IA: email ${emailId} fica por classificar.`);
      return;
    }

    const m = email.municipio_id;
    const pergunta = `${email.assunto ?? ''} ${email.corpo.slice(0, 400)}`
      .replace(/\s+/g, ' ')
      .trim();
    const [servicos, entidades, temas, pesquisa] = await Promise.all([
      this.db.query<Opcao>(
        `SELECT s.id, s.nome, e.nome AS extra FROM servicos s
         JOIN entidades e ON e.id = s.entidade_id
         WHERE s.municipio_id = $1 ORDER BY s.nome`,
        [m],
      ),
      this.db.query<Opcao>(
        `SELECT id, nome, tipo AS extra FROM entidades
         WHERE municipio_id = $1 AND ativo ORDER BY nome`,
        [m],
      ),
      this.db.query<Opcao>(
        'SELECT id, nome FROM temas WHERE municipio_id = $1 ORDER BY nome',
        [m],
      ),
      pergunta.length >= 2
        ? this.conhecimento.procurar(m, pergunta, 5)
        : Promise.resolve(null),
    ]);

    const dados: DadosClassificacao = {
      de: email.de,
      assunto: email.assunto,
      corpo: email.corpo,
      anexos: email.anexos,
      servicos,
      entidades,
      temas,
      trechos: pesquisa?.trechos ?? [],
    };
    const resposta = await this.claude.extrair(esquemaClassificacao, {
      sistema: SISTEMA_CLASSIFICAR,
      conteudo: conteudoClassificacao(dados),
      esforco: 'low',
      maxTokens: 8000,
    });
    const c = normalizarClassificacao(resposta, dados);

    await this.db.query(
      `UPDATE emails_entrada SET
         servico_id = $2, entidade_id = $3, tema_id = $4, tema = $5,
         confianca = $6, rascunho_resposta = $7, trechos_citados = $8::uuid[],
         classificado_em = now()
       WHERE id = $1 AND estado = 'nova' AND classificado_em IS NULL`,
      [
        emailId,
        c.servico_id,
        c.entidade_id,
        c.tema_id,
        c.tema,
        c.confianca,
        c.rascunho_resposta,
        c.trechos_citados,
      ],
    );
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async listar(
    municipioId: string,
    f: {
      estado?: EstadoEmail;
      servico_id?: string;
      limite: number;
      cursor: Cursor | null;
    },
  ) {
    const linhas = await this.db.query<LinhaLista>(
      `SELECT ee.id, ee.de, ee.assunto, left(ee.corpo, 200) AS excerto,
              ee.recebido_em, ee.estado, ee.servico_id, s.nome AS servico,
              en.nome AS entidade, coalesce(t.nome, ee.tema) AS tema,
              ee.confianca, ee.rascunho_resposta IS NOT NULL AS tem_rascunho,
              jsonb_array_length(ee.anexos) AS num_anexos
       FROM emails_entrada ee
       LEFT JOIN servicos s ON s.id = ee.servico_id
       LEFT JOIN entidades en ON en.id = ee.entidade_id
       LEFT JOIN temas t ON t.id = ee.tema_id
       WHERE ee.municipio_id = $1
         AND ($2::text IS NULL OR ee.estado = $2)
         AND ($3::uuid IS NULL OR ee.servico_id = $3)
         AND ($4::timestamptz IS NULL OR (ee.recebido_em, ee.id) < ($4, $5::uuid))
       ORDER BY ee.recebido_em DESC, ee.id DESC
       LIMIT $6`,
      [
        municipioId,
        f.estado ?? null,
        f.servico_id ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    return pagina(
      linhas.map((l) => ({ ...l, confianca: numero(l.confianca) })),
      f.limite,
      (l) => ({ em: l.recebido_em, id: l.id }),
    );
  }

  async obter(municipioId: string, id: string) {
    const [e] = await this.db.query<Record<string, unknown>>(
      `SELECT ee.id, ee.de, ee.para, ee.assunto, ee.corpo AS texto, ee.html,
              ee.anexos, ee.recebido_em, ee.estado,
              ee.servico_id, s.nome AS servico, s.email AS servico_email,
              ee.entidade_id, en.nome AS entidade,
              ee.tema_id, coalesce(t.nome, ee.tema) AS tema,
              ee.confianca, ee.rascunho_resposta, ee.classificado_em,
              ee.resposta, ee.respondido_em, ee.respondido_por,
              u.nome AS respondido_por_nome, ee.encaminhado_em, ee.processo_id,
              coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'trecho_id', tr.id, 'referencia', tr.referencia,
                  'titulo', fo.titulo, 'url', fo.url, 'entidade', fe.nome))
                FROM trechos tr
                JOIN fonte_versoes fv ON fv.id = tr.fonte_versao_id
                JOIN fontes fo ON fo.id = fv.fonte_id
                JOIN entidades fe ON fe.id = fo.entidade_id
                WHERE tr.id = ANY(ee.trechos_citados)
              ), '[]') AS fontes
       FROM emails_entrada ee
       LEFT JOIN servicos s ON s.id = ee.servico_id
       LEFT JOIN entidades en ON en.id = ee.entidade_id
       LEFT JOIN temas t ON t.id = ee.tema_id
       LEFT JOIN utilizadores u ON u.id = ee.respondido_por
       WHERE ee.municipio_id = $1 AND ee.id = $2`,
      [municipioId, id],
    );
    if (!e) throw naoEncontrado();
    return { ...e, confianca: numero(e.confianca as string | null) };
  }

  /** Responde ao remetente por email e fecha o email como 'respondida'. */
  async responder(
    municipioId: string,
    id: string,
    texto: string,
    u: UtilizadorPainel,
    ip?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [e] = await tx.query<{
        de: string;
        assunto: string | null;
        estado: EstadoEmail;
      }>(
        `SELECT de, assunto, estado FROM emails_entrada
         WHERE municipio_id = $1 AND id = $2 FOR UPDATE`,
        [municipioId, id],
      );
      if (!e) throw naoEncontrado();
      if (e.estado === 'respondida') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ja_respondida',
          'Este email já foi respondido.',
        );
      }
      // Envia antes de gravar: se o SMTP falhar, nada muda.
      await this.mensagens.email({
        para: e.de,
        assunto: assuntoResposta(e.assunto),
        texto,
      });
      const [r] = await tx.query<{ respondido_em: Date }>(
        `UPDATE emails_entrada SET estado = 'respondida', resposta = $3,
           respondido_por = $4, respondido_em = now()
         WHERE municipio_id = $1 AND id = $2
         RETURNING respondido_em`,
        [municipioId, id, texto, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'responder',
          objetoTipo: 'email_entrada',
          objetoId: id,
          ip,
        },
        tx,
      );
      return { id, estado: 'respondida', respondido_em: r.respondido_em };
    });
  }

  /** Passa o email a um serviço (e manda-lho, se o serviço tiver email). */
  async encaminhar(
    municipioId: string,
    id: string,
    servicoId: string,
    u: UtilizadorPainel,
    ip?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [e] = await tx.query<{
        de: string;
        assunto: string | null;
        corpo: string;
        recebido_em: Date;
        estado: EstadoEmail;
      }>(
        `SELECT de, assunto, corpo, recebido_em, estado FROM emails_entrada
         WHERE municipio_id = $1 AND id = $2 FOR UPDATE`,
        [municipioId, id],
      );
      if (!e) throw naoEncontrado();
      if (e.estado === 'respondida' || e.estado === 'virou_processo') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'Este email já está fechado.',
          { estado: e.estado },
        );
      }
      const [s] = await tx.query<{ nome: string; email: string | null }>(
        'SELECT nome, email FROM servicos WHERE municipio_id = $1 AND id = $2',
        [municipioId, servicoId],
      );
      if (!s) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'servico_desconhecido',
          'Serviço não existe neste município.',
        );
      }
      if (s.email) {
        await this.mensagens.email({
          para: s.email,
          assunto: `Encaminhado: ${e.assunto ?? '(sem assunto)'}`,
          texto: [
            `Email geral encaminhado por ${u.nome} para ${s.nome}.`,
            '',
            `De: ${e.de}`,
            `Recebido em: ${e.recebido_em.toISOString()}`,
            `Assunto: ${e.assunto ?? '(sem assunto)'}`,
            '',
            e.corpo,
          ].join('\n'),
        });
      }
      await tx.query(
        `UPDATE emails_entrada SET estado = 'encaminhada', servico_id = $3,
           encaminhado_em = now()
         WHERE municipio_id = $1 AND id = $2`,
        [municipioId, id, servicoId],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'encaminhar',
          objetoTipo: 'email_entrada',
          objetoId: id,
          dados: { servico_id: servicoId, email_enviado: !!s.email },
          ip,
        },
        tx,
      );
      return {
        id,
        estado: 'encaminhada',
        servico_id: servicoId,
        email_enviado: !!s.email,
      };
    });
  }
}

/** 'Re: Assunto' sem repetir o 'Re:'. */
export function assuntoResposta(assunto: string | null): string {
  const a = (assunto ?? '').trim();
  if (!a) return 'Resposta da Câmara Municipal';
  return /^re:/i.test(a) ? a : `Re: ${a}`;
}

/** numeric chega do pg como texto. */
function numero(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function naoEncontrado(): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'nao_encontrado',
    'Email não existe.',
  );
}
