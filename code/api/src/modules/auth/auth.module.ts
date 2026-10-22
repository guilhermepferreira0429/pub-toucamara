import { Global, Module } from '@nestjs/common';
import { AtendimentoModule } from '../atendimento/atendimento.module.js';
import { AppEquipaController } from './app-equipa.controller.js';
import { AppEquipaService } from './app-equipa.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';
import { PainelGuard } from './painel.guard.js';

@Global()
@Module({
  // O horário do balcão em /painel/auth/eu.
  imports: [AtendimentoModule],
  // AppEquipaController: entrar na app da equipa de campo (código por email).
  controllers: [AuthController, AppEquipaController],
  providers: [AuthService, PainelGuard, OidcService, AppEquipaService],
  exports: [AuthService, PainelGuard],
})
export class AuthModule {}
