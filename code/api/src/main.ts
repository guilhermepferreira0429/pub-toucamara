import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // rawBody: os webhooks (ElevenLabs, SMS, pagamentos) assinam o corpo tal como chegou.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // Atrás do nginx: o IP do cliente vem no X-Forwarded-For (auditoria).
  app.set('trust proxy', 'loopback, uniquelocal');
  // Tudo em /v1, menos o redirecionamento dos links curtos (/r/:codigo).
  app.setGlobalPrefix('v1', { exclude: ['r/:codigo'] });
  app.enableCors({
    origin: config.get<string[]>('app.origensPermitidas'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    credentials: true,
  });

  await app.listen(config.get<number>('app.port') ?? 3001);
}
void bootstrap();
