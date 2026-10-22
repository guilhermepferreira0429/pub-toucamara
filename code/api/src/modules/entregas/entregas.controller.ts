import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { EntregasService } from './entregas.service.js';
import { ESTADOS } from './regras.js';

const esquemaToken = z.string().min(16).max(64);

const esquemaAutenticar = z.object({
  consentimento: z.literal(true, {
    error: 'Tem de confirmar que autoriza a entrega em seu nome.',
  }),
});

const esquemaAutorizarSimulado = z.object({
  estado: z.string().min(16).max(128),
  telefone: z.string().trim().max(30).optional(),
  pin: z.string().trim().min(1).max(12),
  nif: z.string().trim().max(15).optional(),
});

const esquemaCancelar = z.object({
  motivo: z.string().trim().min(3).max(300),
});

function pdf(r: { nome: string; pdf: Buffer }) {
  return new StreamableFile(r.pdf, {
    type: 'application/pdf',
    disposition: `inline; filename="${r.nome}"`,
    length: r.pdf.length,
  });
}

/** Painel · Entregas em nome do munícipe (estado, comprovativo, modo). */
@Controller('painel/entregas')
@Painel('processos')
export class EntregasPainelController {
  constructor(private readonly entregas: EntregasService) {}

  /** ?estado=&processo_id=&requerimento_id= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.entregas.listar(
      m,
      validar(
        z.object({
          estado: z.enum(ESTADOS).optional(),
          processo_id: z.uuid().optional(),
          requerimento_id: z.uuid().optional(),
        }),
        query,
      ),
    );
  }

  /** O modo atual (simulado / real por configurar) e o que falta. */
  @Get('modo')
  modo() {
    return this.entregas.modo();
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.entregas.detalhe(m, id);
  }

  @Get(':id/comprovativo.pdf')
  async comprovativo(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return pdf(await this.entregas.pdfPainel(m, id));
  }

  /** Submete de novo uma entrega que falhou (a pessoa já tinha autorizado). */
  @Post(':id/tentar-de-novo')
  @HttpCode(200)
  tentarDeNovo(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.entregas.tentarDeNovo(m, u, id);
  }

  /** { motivo } */
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.entregas.cancelar(
      m,
      u,
      id,
      validar(esquemaCancelar, body).motivo,
    );
  }
}

/** A página do munícipe (link do SMS) e o regresso da autenticação. */
@Controller('public/entregas')
export class EntregasPublicoController {
  constructor(private readonly entregas: EntregasService) {}

  /**
   * Regresso do fornecedor de autenticação real (autenticacao.gov). Este é
   * o URL de retorno a registar na AMA: {API_URL}/v1/public/entregas/autenticacao/retorno.
   * Volta sempre para a página da entrega na web (com ?erro= se falhou).
   */
  @Get('autenticacao/retorno')
  async retorno(
    @Query() query: Record<string, string | undefined>,
    @Ip() ip: string,
    @Res() res: Response,
  ) {
    const web = this.entregas.urlWeb();
    try {
      const token = await this.entregas.retornoFornecedor(query, ip);
      res.redirect(302, `${web}/entrega/${token}`);
    } catch (e) {
      const codigo = e instanceof ErroApi ? e.codigo : 'erro';
      const token = await this.entregas
        .tokenDoState(query.state ?? query.RelayState ?? '')
        .catch(() => null);
      res.redirect(
        302,
        token
          ? `${web}/entrega/${token}?erro=${encodeURIComponent(codigo)}`
          : `${web}/expirado`,
      );
    }
  }

  @Get(':token')
  ver(@Param('token') token: string) {
    return this.entregas.publico(validar(esquemaToken, token));
  }

  /** { consentimento: true } → { url } para onde o browser vai autenticar-se. */
  @Post(':token/autenticar')
  @HttpCode(200)
  autenticar(
    @Param('token') token: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    validar(esquemaAutenticar, body);
    return this.entregas.autenticar(validar(esquemaToken, token), ip);
  }

  /** O passo "autorizar com Chave Móvel Digital" simulado: { estado, telefone, pin, nif? }. */
  @Post(':token/autorizar-simulado')
  @HttpCode(200)
  autorizarSimulado(
    @Param('token') token: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.entregas.autorizarSimulado(
      validar(esquemaToken, token),
      validar(esquemaAutorizarSimulado, body),
      ip,
    );
  }

  @Get(':token/comprovativo.pdf')
  async comprovativo(@Param('token') token: string) {
    return pdf(await this.entregas.pdfPublico(validar(esquemaToken, token)));
  }
}
