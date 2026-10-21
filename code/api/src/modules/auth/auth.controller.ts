import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { DatabaseService } from '../../database/database.service.js';
import { HorarioService } from '../atendimento/horario.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';
import { Painel } from './painel.guard.js';
import { permissoesDe } from './permissoes.js';

@Controller('painel/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly horario: HorarioService,
    private readonly db: DatabaseService,
    private readonly oidc: OidcService,
  ) {}

  /** Botões "Entrar com a conta da câmara" (um por município com OIDC). */
  @Get('oidc')
  fornecedoresOidc() {
    return this.oidc.fornecedores();
  }

  /** O browser vai para o fornecedor de identidade da câmara. */
  @Get('oidc/:municipio/iniciar')
  @Redirect()
  async iniciarOidc(@Param('municipio') slug: string) {
    return { url: await this.oidc.iniciar(slug), statusCode: 302 };
  }

  /** Volta do fornecedor: segue para a web com o token de entrada (ou o erro). */
  @Get('oidc/retorno')
  @Redirect()
  async retornoOidc(@Query() q: Record<string, string | undefined>) {
    return {
      url: await this.oidc.retorno({
        code: q['code'],
        state: q['state'],
        error: q['error'],
      }),
      statusCode: 302,
    };
  }

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
    const [perfil, [linha], horario] = await Promise.all([
      this.auth.perfil(u.id),
      this.db.query<{ telefone_linha: string | null }>(
        'SELECT telefone_linha FROM municipios WHERE id = $1',
        [municipio.id],
      ),
      this.horario.balcaoSimples(municipio.id),
    ]);
    return {
      utilizador: { ...u, foto_url: perfil?.foto_url ?? null },
      municipio: {
        ...municipio,
        // A linha do Tou, Câmara? e o horário do balcão (sem horário
        // configurado: dias úteis 9h-17h, como o agente conta).
        telefone_linha: linha?.telefone_linha ?? null,
        horario_balcao: horario,
      },
      permissoes: permissoesDe(u.perfil),
    };
  }
}
