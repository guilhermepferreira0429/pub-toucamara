import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configurarApp } from './configurar-app.js';

async function bootstrap() {
  // rawBody: os webhooks (ElevenLabs, SMS, pagamentos) assinam o corpo tal como chegou.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  configurarApp(app);
  const config = app.get(ConfigService);
  await app.listen(config.get<number>('app.port') ?? 3001);
}
void bootstrap();
