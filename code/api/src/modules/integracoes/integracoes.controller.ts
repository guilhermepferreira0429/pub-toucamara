import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { esquemaConfigGd } from './gestao-documental.js';
import { GestaoDocumentalService } from './gestao-documental.service.js';
import { esquemaPlanta, PlantaService } from './planta.service.js';

/**
 * Configuração e estado da integração com a gestão documental da câmara.
 * Ver: 'equipa'; alterar: só a equipa interna (403 so_equipa_interna).
 */
@Controller('painel/integracoes/gestao-documental')
@Painel('equipa')
export class GestaoDocumentalController {
  constructor(private readonly gd: GestaoDocumentalService) {}

  /** { adaptador, taxa_falha, simulado, adaptadores_disponiveis, atualizado_em } */
  @Get()
  config(@MunicipioAtual() m: Municipio) {
    return this.gd.config(m);
  }

  /** { adaptador: 'nenhum'|'simulado', taxa_falha?: 0..1 } */
  @Put()
  guardar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.gd.guardarConfig(m, u, validar(esquemaConfigGd, body));
  }

  /** Sincronizados, por sincronizar, com erro e o último erro. */
  @Get('estado')
  estado(@MunicipioAtual() m: Municipio) {
    return this.gd.estado(m);
  }
}

@Controller('painel/processos')
@Painel('processos')
export class IntegracoesProcessosController {
  constructor(
    private readonly gd: GestaoDocumentalService,
    private readonly plantas: PlantaService,
  ) {}

  /** Envia já para a gestão documental (tentativas a zero). */
  @Post(':id/sincronizar')
  @HttpCode(200)
  sincronizar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.gd.sincronizarJa(m, u, id);
  }

  /**
   * Gera a planta de localização ({ zoom?: 17|18 }). Com armazenamento:
   * 201 com o documento criado e uma URL de leitura. Sem armazenamento:
   * 200 com o PDF (application/pdf), sem guardar.
   */
  @Post(':id/planta')
  async planta(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.plantas.gerar(
      m,
      id,
      validar(esquemaPlanta, body ?? {}),
      u,
    );
    const resumo = {
      lat: r.lat,
      lng: r.lng,
      geocodificada: r.geocodificada,
      zoom: r.zoom,
    };
    if (!r.documento) {
      res.status(200);
      res.setHeader('X-Planta-Guardada', 'false');
      return new StreamableFile(r.pdf, {
        type: 'application/pdf',
        disposition: `inline; filename="planta-${r.numero.replace(/[^\w-]+/g, '-')}.pdf"`,
        length: r.pdf.length,
      });
    }
    return {
      documento: r.documento,
      url: await this.plantas.urlLeitura(r.documento.id),
      ...resumo,
    };
  }
}
