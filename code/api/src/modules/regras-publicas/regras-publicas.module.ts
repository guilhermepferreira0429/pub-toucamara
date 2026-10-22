import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LicencasModule } from '../licencas/licencas.module.js';
import { OrdenamentoModule } from '../ordenamento/ordenamento.module.js';
import { RegrasPublicasService } from './regras-publicas.service.js';

/** Um minuto no browser e nos proxies; a página serve-se velha até 5 min enquanto revalida. */
function emCache(res: Response) {
  res.setHeader(
    'Cache-Control',
    'public, max-age=60, stale-while-revalidate=300',
  );
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}

/**
 * Regras públicas e verificáveis (sem login): as regras em vigor das
 * licenças e das zonas do PDM, o histórico, o verificador e o export JSON.
 */
@Controller('public/regras')
export class RegrasPublicasController {
  constructor(private readonly regras: RegrasPublicasService) {}

  @Get(':municipio')
  async resumo(
    @Param('municipio') municipio: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.regras.resumo(municipio);
    emCache(res);
    return r;
  }

  /** Tudo, com o histórico, para descarregar e auditar. */
  @Get(':municipio/regras.json')
  async exportar(
    @Param('municipio') municipio: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.regras.exportar(municipio);
    emCache(res);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="regras-${r.municipio.slug}.json"`,
    );
    return r;
  }

  @Get(':municipio/licencas/:tipo')
  async licenca(
    @Param('municipio') municipio: string,
    @Param('tipo') tipo: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.regras.licenca(municipio, tipo);
    emCache(res);
    return r;
  }

  /** O verificador: os dados de um pedido hipotético → que regras passa e falha. Nada fica gravado. */
  @Post(':municipio/licencas/:tipo/verificar')
  @HttpCode(200)
  verificarLicenca(
    @Param('municipio') municipio: string,
    @Param('tipo') tipo: string,
    @Body() body: unknown,
  ) {
    return this.regras.verificarLicenca(municipio, tipo, body);
  }

  @Get(':municipio/zonas/:codigo')
  async zona(
    @Param('municipio') municipio: string,
    @Param('codigo') codigo: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.regras.zona(municipio, codigo);
    emCache(res);
    return r;
  }

  /** { obra, area_m2?, altura_m? } → o que é preciso nesta zona. */
  @Post(':municipio/zonas/:codigo/verificar')
  @HttpCode(200)
  verificarZona(
    @Param('municipio') municipio: string,
    @Param('codigo') codigo: string,
    @Body() body: unknown,
  ) {
    return this.regras.verificarZona(municipio, codigo, body);
  }
}

@Module({
  imports: [LicencasModule, OrdenamentoModule],
  controllers: [RegrasPublicasController],
  providers: [RegrasPublicasService],
})
export class RegrasPublicasModule {}
