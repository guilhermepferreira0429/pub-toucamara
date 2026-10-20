import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { GestaoService } from './gestao.service.js';
import { hojeNoFuso, lerPeriodo, somarDias } from './periodos.js';

/** Sem `de`, os tempos olham para os últimos 90 dias (7 dão poucas decisões). */
const DIAS_TEMPOS = 90;

const esquemaTempos = z.object({
  de: z.string().optional(),
  ate: z.string().optional(),
});

// z.guid: os ids do seed de testes não são UUID RFC 9562.
const esquemaAtrasados = esquemaPaginacao.extend({
  tecnico_id: z.guid().optional(),
  servico_id: z.guid().optional(),
  tipo_id: z.guid().optional(),
});

/** Gestão e indicadores (V2): carga, tempos, onde param e atrasados. */
@Controller('painel/gestao')
export class GestaoController {
  constructor(private readonly gestao: GestaoService) {}

  /** Carga por serviço e por técnico, ordenada pela carga ponderada. */
  @Get('carga')
  @Painel('indicadores')
  carga(@MunicipioAtual() m: Municipio) {
    return this.gestao.carga(m);
  }

  /** Tempos por tipo de processo e por fase (`?de=&ate=`, data da decisão). */
  @Get('tempos')
  @Painel('indicadores')
  tempos(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const q = validar(esquemaTempos, query ?? {});
    const hoje = hojeNoFuso(m.fuso);
    // Primeiro valida o `ate`; depois o período inteiro (máx. 400 dias).
    const { ate } = lerPeriodo({ ate: q.ate }, hoje);
    const { de } = lerPeriodo(
      { de: q.de ?? somarDias(ate, 1 - DIAS_TEMPOS), ate },
      hoje,
    );
    return this.gestao.tempos(m, { de, ate });
  }

  /** Onde os processos ficam parados: por fase, os 20 mais parados e o gargalo. */
  @Get('onde-param')
  @Painel('indicadores')
  ondeParam(@MunicipioAtual() m: Municipio) {
    return this.gestao.ondeParam(m);
  }

  /** Processos atrasados, o mais atrasado primeiro, e de quem é a vez. */
  @Get('atrasados')
  @Painel('indicadores')
  atrasados(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const q = validar(esquemaAtrasados, query ?? {});
    return this.gestao.atrasados(m, q);
  }
}
