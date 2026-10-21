import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContextoMunicipioInterceptor } from './contexto-municipio.interceptor.js';
import { DatabaseService } from './database.service.js';
import { MigrationsService } from './migrations.service.js';

@Global()
@Module({
  providers: [
    DatabaseService,
    MigrationsService,
    { provide: APP_INTERCEPTOR, useClass: ContextoMunicipioInterceptor },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
