import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { EquipaService, PERFIS_DA_CAMARA } from './equipa.service.js';
import { RgpdService } from './rgpd.service.js';

const esquemaConvite = z.object({
  email: z.email().toLowerCase(),
  nome: z.string().trim().min(2).max(120),
  perfil: z.enum(PERFIS_DA_CAMARA),
  servico_id: z.uuid().nullish(),
});

const esquemaAlteracao = z
  .object({
    perfil: z.enum(PERFIS_DA_CAMARA).optional(),
    ativo: z.boolean().optional(),
    servico_id: z.uuid().nullable().optional(),
  })
  .refine((a) => Object.keys(a).length > 0, 'Nada para alterar.');

/** "Equipa e acessos" e o separador RGPD. */
@Controller('painel')
export class EquipaController {
  constructor(
    private readonly equipa: EquipaService,
    private readonly rgpd: RgpdService,
  ) {}

  @Get('equipa')
  @Painel('equipa')
  listar(@MunicipioAtual() m: Municipio) {
    return this.equipa.listar(m).then((itens) => ({ itens }));
  }

  /** Convidar: cria o utilizador e manda-lhe o link mágico. */
  @Post('equipa')
  @Painel('equipa')
  convidar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.equipa.convidar(m, u, validar(esquemaConvite, body), ip);
  }

  @Patch('equipa/:id')
  @Painel('equipa')
  alterar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.equipa.alterar(m, u, id, validar(esquemaAlteracao, body), ip);
  }

  /** Políticas de retenção e o último resultado do job retencao_rgpd. */
  @Get('rgpd')
  @Painel('equipa')
  verRgpd(@MunicipioAtual() m: Municipio) {
    return this.rgpd.ver(m);
  }
}
