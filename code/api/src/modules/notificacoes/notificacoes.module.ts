import { Global, Module } from '@nestjs/common';
import {
  CANAIS_NOTIFICACAO,
  CanalNotificacao,
  CanalSms,
  NotificacoesService,
} from './notificacoes.service.js';

/**
 * Notificações ao munícipe (SMS hoje; push na app a seguir). Para juntar o
 * push: um provider novo (ex.: CanalPush) e pô-lo à frente do SMS em
 * `CANAIS_NOTIFICACAO`.
 */
@Global()
@Module({
  providers: [
    CanalSms,
    {
      provide: CANAIS_NOTIFICACAO,
      useFactory: (sms: CanalSms): CanalNotificacao[] => [sms],
      inject: [CanalSms],
    },
    NotificacoesService,
  ],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
