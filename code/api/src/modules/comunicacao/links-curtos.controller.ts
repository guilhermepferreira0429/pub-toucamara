import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LinksCurtosService } from './links-curtos.service.js';

/** Fora de /v1 (ver main.ts): é o endereço que vai no SMS. */
@Controller('r')
export class LinksCurtosController {
  constructor(private readonly links: LinksCurtosService) {}

  @Get(':codigo')
  async abrir(@Param('codigo') codigo: string, @Res() res: Response) {
    res.redirect(302, await this.links.abrir(codigo));
  }
}
