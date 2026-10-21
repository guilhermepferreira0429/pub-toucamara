import { Global, Module } from '@nestjs/common';
import { AtendimentoModule } from '../atendimento/atendimento.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';
import { PainelGuard } from './painel.guard.js';

@Global()
@Module({
  // O horário do balcão em /painel/auth/eu.
  imports: [AtendimentoModule],
  controllers: [AuthController],
  providers: [AuthService, PainelGuard, OidcService],
  exports: [AuthService, PainelGuard],
})
export class AuthModule {}
