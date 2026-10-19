import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { agenteConfig } from '../../config/configuration.js';
import { segredoIgual } from '../agent-tools/agente.guard.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { textoDeHtml } from './emails.classificacao.js';
import { EmailsService } from './emails.service.js';

/** Endereços em "Nome <a@b.pt>" ou "a@b.pt", separados por vírgula. */
export function enderecos(v: string | string[] | undefined): string[] {
  const lista = Array.isArray(v) ? v : v ? v.split(',') : [];
  return lista
    .map((s) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+$/.test(s));
}

/**
 * Formato genérico do email reencaminhado (o encaminhador da caixa, ex.: um
 * Apps Script, Power Automate ou um inbound parse, converte para isto):
 *
 *   { "de": "Ana <ana@ex.pt>", "para": "geral@cm-x.pt" | ["..."],
 *     "assunto": "...", "texto": "...", "html": "...",
 *     "anexos": [{ "nome": "planta.pdf", "mime": "application/pdf", "tamanho": 12345 }],
 *     "mensagem_id": "<Message-ID>", "recebido_em": "2026-10-19T10:00:00Z" }
 *
 * `texto` ou `html` é obrigatório. Os anexos vêm só descritos (o conteúdo
 * fica na caixa). `mensagem_id` torna o webhook idempotente.
 */
const esquemaEntrada = z
  .object({
    de: z.string().trim().min(3).max(320),
    para: z
      .union([z.string().max(2000), z.array(z.string().max(320)).max(50)])
      .optional(),
    assunto: z.string().max(1000).optional(),
    texto: z.string().max(500_000).optional(),
    html: z.string().max(2_000_000).optional(),
    anexos: z
      .array(
        z.object({
          nome: z.string().max(500),
          mime: z.string().max(200),
          tamanho: z.number().int().min(0),
        }),
      )
      .max(100)
      .default([]),
    mensagem_id: z.string().trim().min(1).max(500).optional(),
    recebido_em: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((e) => !!(e.texto?.trim() || e.html?.trim()), {
    message: 'Falta o texto ou o html.',
    path: ['texto'],
  });

/**
 * Entrada do email geral. Autenticação por segredo partilhado no header
 * `X-Webhook-Segredo` (o mesmo AGENTE_SEGREDO das ferramentas). O município
 * vem do header `X-Municipio` (slug) ou do endereço "para" que bata com
 * `municipios.email_geral`.
 */
@Controller('webhooks/email')
export class EmailsWebhookController {
  private readonly logger = new Logger(EmailsWebhookController.name);

  constructor(
    private readonly emails: EmailsService,
    private readonly municipios: MunicipiosService,
    private readonly config: ConfigService,
  ) {}

  @Post('entrada')
  @HttpCode(202)
  async entrada(
    @Headers('x-webhook-segredo') segredoRecebido: string | undefined,
    @Headers('x-municipio') slug: string | undefined,
    @Body() body: unknown,
  ) {
    this.verificarSegredo(segredoRecebido);
    const e = validar(esquemaEntrada, body);

    const de = enderecos(e.de)[0];
    if (!de) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'remetente_invalido',
        'O remetente não é um endereço de email.',
      );
    }
    const para = enderecos(e.para);
    const municipioId = slug
      ? (await this.municipios.porSlug(slug)).id
      : await this.emails.municipioPorEndereco(para);
    if (!municipioId) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'municipio_desconhecido',
        'Nenhum município com este email geral (ou indicar X-Municipio).',
      );
    }

    const r = await this.emails.receber({
      municipioId,
      de,
      para: para[0] ?? null,
      assunto: e.assunto?.trim() || null,
      texto: e.texto?.trim() || textoDeHtml(e.html ?? ''),
      html: e.html ?? null,
      anexos: e.anexos,
      mensagemId: e.mensagem_id ?? null,
      recebidoEm: e.recebido_em ? new Date(e.recebido_em) : new Date(),
    });
    return { id: r.id, duplicado: r.duplicado };
  }

  private verificarSegredo(recebido: string | undefined) {
    const { segredo } =
      this.config.getOrThrow<ConfigType<typeof agenteConfig>>('agente');
    if (!segredo) {
      if (this.config.get<string>('app.ambiente') === 'production') {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'webhook_sem_segredo',
          'AGENTE_SEGREDO não está configurado.',
        );
      }
      this.logger.warn('AGENTE_SEGREDO vazio: webhook de email aberto (dev).');
      return;
    }
    if (!recebido || !segredoIgual(recebido, segredo)) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'nao_autenticado',
        'Segredo do webhook em falta ou errado.',
      );
    }
  }
}

const esquemaId = z.uuid('Id inválido.');

/** Entrada / email geral no painel (recurso 'entrada'). */
@Controller('painel/emails')
@Painel('entrada')
export class EmailsPainelController {
  constructor(private readonly emails: EmailsService) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const f = validar(
      esquemaPaginacao.extend({
        estado: z
          .enum(['nova', 'respondida', 'encaminhada', 'virou_processo'])
          .optional(),
        servico_id: z.uuid().optional(),
      }),
      query,
    );
    return this.emails.listar(m.id, f);
  }

  @Get(':id')
  obter(@MunicipioAtual() m: Municipio, @Param('id') id: string) {
    return this.emails.obter(m.id, validar(esquemaId, id));
  }

  @Post(':id/responder')
  @HttpCode(200)
  responder(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const { texto } = validar(
      z.object({ texto: z.string().trim().min(1).max(50_000) }),
      body,
    );
    return this.emails.responder(m.id, validar(esquemaId, id), texto, u, ip);
  }

  @Post(':id/encaminhar')
  @HttpCode(200)
  encaminhar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const { servico_id } = validar(z.object({ servico_id: z.uuid() }), body);
    return this.emails.encaminhar(
      m.id,
      validar(esquemaId, id),
      servico_id,
      u,
      ip,
    );
  }
}
