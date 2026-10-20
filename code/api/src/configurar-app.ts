import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { FiltroErros } from './common/erros.js';

/**
 * Tudo o que a app precisa além dos módulos: o mesmo no `main.ts` e nos
 * testes ponta a ponta. A app tem de ser criada com `rawBody: true` (os
 * webhooks assinam o corpo tal como chegou).
 */
export function configurarApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  // O webhook de áudio do ElevenLabs traz a gravação inteira em base64.
  app.useBodyParser('json', { limit: '50mb' });

  // Atrás do nginx: o IP do cliente vem no X-Forwarded-For (auditoria).
  app.set('trust proxy', 'loopback, uniquelocal');
  // Tudo em /v1, menos o redirecionamento dos links curtos (/r/:codigo).
  app.setGlobalPrefix('v1', { exclude: ['r/:codigo'] });
  // Todos os erros como { erro: { codigo, mensagem, detalhes } }.
  app.useGlobalFilters(new FiltroErros());
  app.enableCors({
    origin: config.get<string[]>('app.origensPermitidas'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Municipio',
    ],
    credentials: true,
  });
}
