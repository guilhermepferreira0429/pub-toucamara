import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual } from '../common/pedido.js';
import { validar } from '../common/validacao.js';
import { Painel } from '../modules/auth/painel.guard.js';
import type { Municipio } from '../modules/municipios/municipios.service.js';
import { UsoIaService } from './uso-ia.service.js';

const dia = z.iso.date();

/** Últimos 30 dias, em AAAA-MM-DD. */
function periodoPorOmissao(): { desde: string; ate: string } {
  const ate = new Date();
  const desde = new Date(ate.getTime() - 29 * 86_400_000);
  return {
    desde: desde.toISOString().slice(0, 10),
    ate: ate.toISOString().slice(0, 10),
  };
}

/**
 * Painel · Uso da IA: o custo por atendimento (estimativa) e, para
 * transparência, onde a IA foi usada numa conversa, processo ou email.
 */
@Controller('painel/uso-ia')
export class UsoIaController {
  constructor(private readonly uso: UsoIaService) {}

  @Get('custos')
  @Painel('indicadores')
  custos(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const p = validar(
      z.object({ desde: dia.optional(), ate: dia.optional() }),
      q,
    );
    const omissao = periodoPorOmissao();
    return this.uso.custos(
      m.id,
      p.desde ?? omissao.desde,
      p.ate ?? omissao.ate,
    );
  }

  @Get('registo')
  @Painel('conversas')
  registo(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const p = validar(
      z.object({
        alvo_tipo: z.enum([
          'conversa',
          'processo',
          'email',
          'fonte',
          'ocorrencia',
          'reclamacao',
        ]),
        alvo_id: z.uuid(),
      }),
      q,
    );
    return this.uso.registoDe(m.id, p.alvo_tipo, p.alvo_id);
  }
}
