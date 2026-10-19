import { Global, Module } from '@nestjs/common';
import { MunicipesService } from './municipes.service.js';

@Global()
@Module({
  providers: [MunicipesService],
  exports: [MunicipesService],
})
export class MunicipesModule {}
