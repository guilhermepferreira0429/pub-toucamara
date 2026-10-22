import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { AvaliacaoService } from './avaliacao.service.js';

/**
 * A avaliação à vista de todos (sem login): a taxa de acerto do assistente,
 * por tema, e cada pergunta de teste com a resposta dada, a resposta certa,
 * a fonte e o veredicto do juiz. Ao lado, as mesmas perguntas feitas à
 * assistente do site da câmara, sem o nome.
 */
@Controller('public/avaliacao')
export class AvaliacaoPublicaController {
  constructor(
    private readonly avaliacao: AvaliacaoService,
    private readonly municipios: MunicipiosService,
  ) {}

  @Get(':municipio')
  async publica(
    @Param('municipio') slug: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const m = await this.municipios.porSlug(slug);
    const r = await this.avaliacao.publica(m);
    // Um minuto no browser e nos proxies; serve-se velha até 5 min enquanto revalida.
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300',
    );
    return r;
  }
}
