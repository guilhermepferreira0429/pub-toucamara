import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { MigrationsService } from './migrations.service.js';

@Global()
@Module({
  providers: [DatabaseService, MigrationsService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
