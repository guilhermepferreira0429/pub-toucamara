import { Global, Module } from '@nestjs/common';
import {
  CANAIS_NOTIFICACAO,
  CanalNotificacao,
  CanalPush,
  CanalSms,
  NotificacoesService,
} from './notificacoes.service.js';

/**
 * Notificações ao munícipe: push na app primeiro, SMS quando a pessoa não
 * tem a app (ordem em `CANAIS_NOTIFICACAO`).
 */
@Global()
@Module({
  providers: [
    CanalPush,
    CanalSms,
    {
      provide: CANAIS_NOTIFICACAO,
      useFactory: (push: CanalPush, sms: CanalSms): CanalNotificacao[] => [
        push,
        sms,
      ],
      inject: [CanalPush, CanalSms],
    },
    NotificacoesService,
  ],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
