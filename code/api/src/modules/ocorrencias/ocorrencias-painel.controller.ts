import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { IdempotenciaInterceptor } from '../../common/idempotencia.interceptor.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { ESTADOS_OCORRENCIA } from './ocorrencias.regras.js';
import { OcorrenciasService } from './ocorrencias.service.js';

/** 'minLng,minLat,maxLng,maxLat', como o Leaflet/MapLibre dão a caixa visível. */
export const esquemaBbox = z
  .string()
  .transform((s) => s.split(',').map((x) => Number(x.trim())))
  .refine(
    (v) =>
      v.length === 4 &&
      v.every(Number.isFinite) &&
      v[0] < v[2] &&
      v[1] < v[3] &&
      Math.abs(v[1]) <= 90 &&
      Math.abs(v[3]) <= 90,
    'bbox: minLng,minLat,maxLng,maxLat',
  )
  .transform((v) => v as [number, number, number, number]);

const esquemaLista = esquemaPaginacao.extend({
  bbox: esquemaBbox.optional(),
  estado: z.enum(ESTADOS_OCORRENCIA).optional(),
  categoria_id: z.guid().optional(),
  desde: z.coerce.date().optional(),
});

const esquemaAlteracao = z
  .object({
    // 'duplicada' só a deteção automática põe.
    estado: z.enum(['nova', 'com_equipa', 'resolvida', 'rejeitada']).optional(),
    servico_id: z.guid().nullable().optional(),
    prevista_para: z.iso.date().nullable().optional(),
  })
  .refine(
    (a) => Object.values(a).some((v) => v !== undefined),
    'Nada para alterar.',
  );

const esquemaId = z.guid();

@Controller('painel/ocorrencias')
// A app da equipa de campo reenvia o que guardou sem rede com Idempotency-Key.
@UseInterceptors(IdempotenciaInterceptor)
export class OcorrenciasPainelController {
  constructor(private readonly ocorrencias: OcorrenciasService) {}

  // As rotas fixas antes de ':id'.
  @Get('categorias')
  @Painel('ocorrencias_ver')
  categorias(@MunicipioAtual() m: Municipio) {
    return this.ocorrencias.categoriasPainel(m.id);
  }

  @Get('resumo')
  @Painel('ocorrencias_ver')
  resumo(@MunicipioAtual() m: Municipio) {
    return this.ocorrencias.resumo(m.id);
  }

  @Get()
  @Painel('ocorrencias_ver')
  lista(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.ocorrencias.lista(m.id, validar(esquemaLista, query));
  }

  @Get(':id')
  @Painel('ocorrencias_ver')
  detalhe(@MunicipioAtual() m: Municipio, @Param('id') id: string) {
    return this.ocorrencias.detalhe(m.id, validar(esquemaId, id));
  }

  @Patch(':id')
  @Painel('ocorrencias')
  alterar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.ocorrencias.alterar(
      m,
      u,
      validar(esquemaId, id),
      validar(esquemaAlteracao, body),
    );
  }
}
