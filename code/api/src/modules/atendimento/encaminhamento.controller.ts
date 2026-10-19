import { Controller, Get } from '@nestjs/common';
import { MunicipioAtual } from '../../common/pedido.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { EncaminhamentoService } from './encaminhamento.service.js';

/** "Quem trata de quê": entidades do concelho, contactos e regras do agente. */
@Controller('painel/encaminhamento')
@Painel('conhecimento_ver')
export class EncaminhamentoController {
  constructor(private readonly encaminhamento: EncaminhamentoService) {}

  @Get()
  listar(@MunicipioAtual() municipio: Municipio) {
    return this.encaminhamento.listar(municipio.id);
  }
}
