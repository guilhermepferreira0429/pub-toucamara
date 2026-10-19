import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { validar } from '../../common/validacao.js';
import { ChatService } from './chat.service.js';
import { abrirSse } from './sse.js';

const esquemaToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,64}$/, 'Sessão inválida.');

/**
 * Chat no site e na app (secção 5.6 do plano). A sessão é anónima: o token
 * devolvido ao criar é o segredo da sessão e o browser guarda-o.
 */
@Controller('chat/sessoes')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(201)
  criar(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('x-agente-segredo') segredo: string | undefined,
  ) {
    const { municipio, idioma, sessao_anterior } = validar(
      z.object({
        municipio: z.string().trim().min(1).max(64),
        idioma: z
          .string()
          .trim()
          .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Idioma inválido (ex.: pt-PT).')
          .optional(),
        // Retomar: o token da sessão anterior que o browser guardou.
        sessao_anterior: esquemaToken.optional(),
      }),
      body,
    );
    return this.chat.criarSessao({
      municipio,
      idioma,
      // O avaliador (uma sessão por pergunta) identifica-se com o segredo do
      // agente e fica fora do limite de sessões por IP.
      ip: this.chat.eAvaliador(segredo) ? undefined : ip,
      sessaoAnterior: sessao_anterior,
    });
  }

  /**
   * Resposta em SSE: eventos `texto`, `ferramenta`, `cartao`, `fim` e `erro`.
   * Erros antes de começar (sessão, limite, IA desligada) saem em JSON.
   */
  @Post(':sessao/mensagens')
  async mensagem(
    @Param('sessao') sessaoBruta: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const token = validar(esquemaToken, sessaoBruta);
    const { texto } = validar(
      z.object({ texto: z.string().trim().min(1).max(2000) }),
      body,
    );
    const sessao = await this.chat.preparar(token);
    const sse = abrirSse(res);
    try {
      await this.chat.responder(
        sessao,
        texto,
        (s) => sse.enviar(s.evento, s.dados),
        sse.sinal,
      );
    } finally {
      sse.fechar();
    }
  }

  /** Pede um código por SMS para se identificar (ver os seus processos). */
  @Post(':sessao/identificar')
  @HttpCode(202)
  identificar(@Param('sessao') sessao: string, @Body() body: unknown) {
    const { telefone } = validar(
      z.object({ telefone: z.string().trim().min(6).max(25) }),
      body,
    );
    return this.chat.identificar(validar(esquemaToken, sessao), telefone);
  }

  @Post(':sessao/confirmar')
  @HttpCode(200)
  confirmar(@Param('sessao') sessao: string, @Body() body: unknown) {
    const { codigo } = validar(
      z.object({
        codigo: z
          .string()
          .trim()
          .regex(/^\d{6}$/, 'Código de 6 dígitos.'),
      }),
      body,
    );
    return this.chat.confirmar(validar(esquemaToken, sessao), codigo);
  }
}
