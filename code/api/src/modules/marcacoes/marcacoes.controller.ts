import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { Pedido, UtilizadorPainel } from '../../common/pedido.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MarcacoesService } from './marcacoes.service.js';

const esquemaRemarcar = z.object({
  inicio: z.iso.datetime({ offset: true }),
});

/** Página do link do SMS (pelo token público da marcação). */
@Controller('public/marcacoes')
export class MarcacoesPublicoController {
  constructor(private readonly marcacoes: MarcacoesService) {}

  @Get(':token')
  ver(@Param('token') token: string) {
    return this.marcacoes.publico(token);
  }

  /** Vagas da mesma agenda, para escolher a nova hora. */
  @Get(':token/vagas')
  vagas(@Param('token') token: string, @Query() query: unknown) {
    const { dia } = validar(z.object({ dia: z.iso.date().optional() }), query);
    return this.marcacoes.vagasPublico(token, dia);
  }

  @Post(':token/cancelar')
  @HttpCode(200)
  cancelar(@Param('token') token: string) {
    return this.marcacoes.cancelarPublico(token);
  }

  @Post(':token/remarcar')
  @HttpCode(200)
  remarcar(@Param('token') token: string, @Body() body: unknown) {
    const { inicio } = validar(esquemaRemarcar, body);
    return this.marcacoes.remarcarPublico(token, inicio);
  }
}

const filtrosDia = z.object({
  dia: z.iso.date().optional(),
  agenda_id: z.uuid().optional(),
});

const esquemaEstado = z.object({
  estado: z.enum(['realizada', 'faltou', 'cancelada']),
});

@Controller('painel')
@Painel('conversas')
export class MarcacoesPainelController {
  constructor(private readonly marcacoes: MarcacoesService) {}

  /** A agenda do dia (por defeito hoje, no fuso do município). */
  @Get('marcacoes')
  doDia(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { dia, agenda_id } = validar(filtrosDia, query);
    return this.marcacoes.doDia(m, dia, agenda_id);
  }

  @Get('agendas')
  async agendas(@MunicipioAtual() m: Municipio) {
    return { itens: await this.marcacoes.agendas(m.id) };
  }

  @Patch('marcacoes/:id')
  mudarEstado(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Pedido,
  ) {
    const { estado } = validar(esquemaEstado, body);
    return this.marcacoes.mudarEstado(m, u, id, estado, req.ip ?? null);
  }
}
