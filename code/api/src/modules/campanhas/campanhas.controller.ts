import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  CampanhasService,
  esquemaCampanha,
  esquemaContacto,
  esquemaPreVisualizar,
  esquemaTratar,
} from './campanhas.service.js';

/** Painel · Ação social: pessoas inscritas e campanhas de contacto. */
@Controller('painel/campanhas')
@Painel('acao_social')
export class CampanhasController {
  constructor(private readonly campanhas: CampanhasService) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio) {
    return this.campanhas.listar(m);
  }

  @Get('contactos')
  contactos(@MunicipioAtual() m: Municipio) {
    return this.campanhas.contactos(m);
  }

  /** { nome, telefone, morada?, freguesia?, notas?, consentimento_origem } */
  @Post('contactos')
  @HttpCode(201)
  criarContacto(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.campanhas.criarContacto(m, u, validar(esquemaContacto, body));
  }

  @Delete('contactos/:id')
  removerContacto(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campanhas.removerContacto(m, u, id);
  }

  /** { freguesias? } → quantas pessoas e quanto tempo. */
  @Post('pre-visualizar')
  @HttpCode(200)
  preVisualizar(@MunicipioAtual() m: Municipio, @Body() body: unknown) {
    return this.campanhas.preVisualizar(
      m,
      validar(esquemaPreVisualizar, body ?? {}),
    );
  }

  /** Lança a campanha: agenda uma chamada a cada pessoa inscrita. */
  @Post()
  @HttpCode(201)
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.campanhas.criar(m, u, validar(esquemaCampanha, body));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campanhas.detalhe(m, id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campanhas.cancelar(m, u, id);
  }

  /** { nota?, estado? }: a ação social tratou desta pessoa. */
  @Patch('destinatarios/:id')
  tratar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.campanhas.tratar(m, u, id, validar(esquemaTratar, body ?? {}));
  }
}
