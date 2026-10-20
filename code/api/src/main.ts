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
  const porta = config.get<number>('app.port') ?? 3001;
  // HOST=127.0.0.1 quando está atrás de um proxy (VPS); sem ele, todas.
  if (process.env.HOST) await app.listen(porta, process.env.HOST);
  else await app.listen(porta);
}
void bootstrap();
