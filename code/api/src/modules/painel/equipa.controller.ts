import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { esquemaPaginacao } from '../../common/paginacao.js';
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

  /** ?so_dados_pessoais=true&limite=&cursor= */
  @Get('equipa/acessos')
  @Painel('equipa')
  acessos(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.equipa.acessos(
      m,
      validar(
        esquemaPaginacao.extend({
          so_dados_pessoais: z
            .enum(['true', 'false'])
            .default('false')
            .transform((v) => v === 'true'),
        }),
        query,
      ),
    );
  }

  /**
   * Serviços com os técnicos ativos (id, nome, perfil, foto_url), para os
   * seletores de serviço e técnico. Qualquer perfil do painel.
   */
  @Get('servicos')
  @Painel('visao_geral')
  servicos(@MunicipioAtual() m: Municipio) {
    return this.equipa.servicosComEquipa(m);
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
