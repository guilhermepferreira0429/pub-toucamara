/**
 * Armazenamento de ficheiros (Wasabi ou outro S3 compatível).
 *   npm run armazenamento -- verificar   envia, lê e apaga um ficheiro de
 *                                        teste, também por URL assinado
 *   npm run armazenamento -- cors        deixa a web (WEB_URL e
 *                                        ALLOWED_ORIGINS) enviar e ler
 */
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ArmazenamentoService } from '../modules/armazenamento/armazenamento.service.js';

async function main() {
  const comando = process.argv[2];
  if (comando !== 'verificar' && comando !== 'cors') {
    throw new Error('Uso: npm run armazenamento -- verificar | cors');
  }
  process.env.MIGRACOES_NO_ARRANQUE = 'false';
  process.env.JOBS_WORKERS = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const arm = app.get(ArmazenamentoService);
    if (!arm.disponivel) throw new Error('S3_BUCKET por configurar.');

    if (comando === 'cors') {
      const config = app.get(ConfigService);
      const origens = [
        ...new Set([
          config.get<string>('app.webUrl') ?? '',
          ...(config.get<string[]>('app.origensPermitidas') ?? []),
        ]),
      ].filter(Boolean);
      await arm.configurarCors(origens);
      console.log(`CORS configurado para: ${origens.join(', ')}`);
      return;
    }

    const chave = `verificacao/${Date.now()}.txt`;
    const texto = `Tou, Câmara? ${new Date().toISOString()}`;
    await arm.guardar(chave, Buffer.from(texto), 'text/plain');
    console.log('✓ guardar a partir da API');
    if ((await arm.ler(chave)).toString() !== texto) {
      throw new Error('O que se leu não é o que se guardou.');
    }
    console.log('✓ ler a partir da API');
    const envio = await fetch(await arm.urlEnvio(chave, 'text/plain'), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: texto,
    });
    if (!envio.ok) throw new Error(`URL de envio: HTTP ${envio.status}`);
    console.log('✓ enviar por URL assinado (como o browser)');
    const leitura = await fetch(await arm.urlLeitura(chave));
    if (!leitura.ok) throw new Error(`URL de leitura: HTTP ${leitura.status}`);
    console.log('✓ ler por URL assinado');
    const apagadas = await arm.apagar([chave]);
    if (!apagadas.includes(chave)) throw new Error('Não apagou.');
    console.log('✓ apagar');
    console.log(
      'Tudo certo. Falta só o CORS para o browser: npm run armazenamento -- cors',
    );
  } finally {
    await app.close();
  }
}

main().catch((e: Error) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
