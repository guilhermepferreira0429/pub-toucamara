import { Global, Module } from '@nestjs/common';
import { MunicipiosService } from './municipios.service.js';

@Global()
@Module({
  providers: [MunicipiosService],
  exports: [MunicipiosService],
})
export class MunicipiosModule {}
