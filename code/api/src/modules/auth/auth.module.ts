import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PainelGuard } from './painel.guard.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, PainelGuard],
  exports: [AuthService, PainelGuard],
})
export class AuthModule {}
