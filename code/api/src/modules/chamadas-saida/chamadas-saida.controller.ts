import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  ChamadasSaidaService,
  esquemaCancelar,
  esquemaLigar,
  esquemaListaChamadas,
} from './chamadas-saida.service.js';
import { esquemaConfigChamadas } from './regras.js';

@Controller('painel/chamadas-saida')
@Painel('processos')
export class ChamadasSaidaController {
  constructor(private readonly chamadas: ChamadasSaidaService) {}

  /** ?estado=&motivo=&limite=&cursor= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.chamadas.listar(m, validar(esquemaListaChamadas, query));
  }

  /** O que o agente pode ligar neste município (por motivo). */
  @Get('config')
  @Painel('agente')
  config(@MunicipioAtual() m: Municipio) {
    return this.chamadas.obterConfig(m);
  }

  /** { ativo, motivos[], numero_id, via } */
  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.chamadas.guardarConfig(
      m,
      u,
      validar(esquemaConfigChamadas, body),
    );
  }

  /** { enviar_sms? } (por omissão o SMS de recurso vai na mesma). */
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.chamadas.cancelar(
      m,
      u,
      id,
      validar(esquemaCancelar, body ?? {}),
    );
  }
}

/** "Ligar agora" na ficha do processo. */
@Controller('painel/processos')
@Painel('processos')
export class LigarProcessoController {
  constructor(private readonly chamadas: ChamadasSaidaService) {}

  /** { motivo?, nota?, forcar_horario? } */
  @Post(':id/ligar')
  @HttpCode(200)
  ligar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.chamadas.ligarManual(
      m,
      u,
      id,
      validar(esquemaLigar, body ?? {}),
    );
  }
}
