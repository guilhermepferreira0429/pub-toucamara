import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PainelRecolhaService } from './painel-recolha.service.js';

const uuid = new ParseUUIDPipe();
const texto = (max: number) => z.string().trim().min(1).max(max);
const url = z.url({ protocol: /^https?$/ });
const TIPOS_FONTE = [
  'lei',
  'regulamento',
  'tabela',
  'pagina',
  'formulario',
  'plano',
  'contactos',
  'turismo',
] as const;
/** Prefixos de caminho: começam por "/". */
const prefixos = z.array(z.string().trim().regex(/^\//).max(300)).max(50);
const horas = z
  .number()
  .int()
  .min(1)
  .max(24 * 365);

const esquemaSite = z.object({
  entidade_id: z.uuid(),
  titulo: texto(200),
  url_inicial: url,
  sitemap_url: url.nullish(),
  incluir: prefixos.default([]),
  excluir: prefixos.default([]),
  profundidade: z.number().int().min(0).max(5).default(2),
  max_paginas: z.number().int().min(1).max(2000).default(100),
  tipo_fontes: z.enum(TIPOS_FONTE).default('pagina'),
  ler_a_cada_horas: horas.default(24),
  descobrir_a_cada_dias: z.number().int().min(1).max(365).default(7),
});

/** Painel · Conhecimento · Recolha das fontes (hora diária, edição, histórico, sites). */
@Controller('painel/conhecimento')
export class PainelRecolhaController {
  constructor(private readonly svc: PainelRecolhaService) {}

  @Get('recolha')
  @Painel('conhecimento_ver')
  recolha(@MunicipioAtual() m: Municipio) {
    return this.svc.recolha(m.id);
  }

  /** A hora a que se leem as fontes diárias (ou mais espaçadas), no fuso do município. */
  @Put('recolha')
  @Painel('conhecimento')
  definirHora(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    const d = validar(
      z.object({
        hora_recolha: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      }),
      body,
    );
    return this.svc.definirHora(m.id, u, d.hora_recolha);
  }

  @Patch('fontes/:id')
  @Painel('conhecimento')
  editarFonte(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const d = validar(
      z.object({
        titulo: texto(200).optional(),
        url: url.optional(),
        tipo: z.enum(TIPOS_FONTE).optional(),
        ler_a_cada_horas: horas.optional(),
        leitura_automatica: z.boolean().optional(),
        seletor: z.string().trim().max(300).nullish(),
        ignorar_robots: z.boolean().optional(),
        arquivada: z.boolean().optional(),
      }),
      body,
    );
    return this.svc.editarFonte(m.id, u, id, d);
  }

  @Get('fontes/:id/leituras')
  @Painel('conhecimento_ver')
  leituras(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.svc.leituras(m.id, id);
  }

  @Get('sites')
  @Painel('conhecimento_ver')
  sites(@MunicipioAtual() m: Municipio) {
    return this.svc.sites(m.id);
  }

  @Post('sites')
  @Painel('conhecimento')
  criarSite(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.svc.criarSite(m.id, u, validar(esquemaSite, body));
  }

  @Patch('sites/:id')
  @Painel('conhecimento')
  editarSite(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const d = validar(
      esquemaSite
        .omit({ entidade_id: true })
        .partial()
        .extend({ ativo: z.boolean().optional() }),
      body,
    );
    return this.svc.editarSite(m.id, u, id, d);
  }

  @Post('sites/:id/descobrir')
  @HttpCode(202)
  @Painel('conhecimento')
  descobrir(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.svc.descobrir(m.id, id);
  }
}
