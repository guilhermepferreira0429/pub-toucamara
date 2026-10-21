import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErroApi } from '../../common/erros.js';
import { OpenApiService } from './openapi.service.js';

/**
 * GET /v1/docs: o OpenAPI da API (JSON). Em produção só com
 * OPENAPI_PUBLICO=true (lista as rotas internas do painel).
 */
@Controller('docs')
export class DocsController {
  constructor(
    private readonly openapi: OpenApiService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  documento() {
    const producao = this.config.get<string>('app.ambiente') === 'production';
    if (producao && !this.config.get<boolean>('app.openapiPublico')) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'O OpenAPI não está publicado neste servidor.',
      );
    }
    return this.openapi.documento();
  }
}
