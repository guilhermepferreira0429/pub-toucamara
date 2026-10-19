import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { AuthService } from './auth.service.js';
import { Painel } from './painel.guard.js';
import { permissoesDe } from './permissoes.js';

@Controller('painel/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Manda o link mágico. Responde 204 exista ou não o email. */
  @Post('link')
  @HttpCode(204)
  async link(@Body() body: unknown) {
    const { email } = validar(
      z.object({ email: z.email().toLowerCase() }),
      body,
    );
    await this.auth.pedirLink(email);
  }

  @Post('entrar')
  @HttpCode(200)
  entrar(@Body() body: unknown, @Ip() ip: string) {
    const { token } = validar(z.object({ token: z.string().min(10) }), body);
    return this.auth.entrar(token, ip);
  }

  /** Quem sou, de que município e o que posso ver (barra lateral). */
  @Get('eu')
  @Painel()
  async eu(
    @UtilizadorAtual() u: UtilizadorPainel,
    @MunicipioAtual() municipio: Municipio,
  ) {
    const perfil = await this.auth.perfil(u.id);
    return {
      utilizador: { ...u, foto_url: perfil?.foto_url ?? null },
      municipio,
      permissoes: permissoesDe(u.perfil),
    };
  }
}
