import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { DemoService } from './demo.service.js';

const esquemaPreparar = z.object({
  /** Esconder do painel as conversas e ocorrências dos testes (reversível). */
  limpar_testes: z.boolean().optional(),
  /** Sem `true` é só um ensaio: diz o que faria e não muda nada. */
  confirmar: z.boolean().optional(),
});

/**
 * Painel · Preparar demo (administração e chefia). Desligado em produção
 * salvo DEMO_ATIVA=true; o estado responde sempre (`ativa: false`), para a
 * barra lateral saber se mostra o item.
 */
@Controller('painel/demo')
@Painel('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get('estado')
  estado(@MunicipioAtual() m: Municipio) {
    return this.demo.estado(m);
  }

  @Post('preparar')
  @HttpCode(200)
  preparar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.demo.preparar(m, u, validar(esquemaPreparar, body ?? {}));
  }

  @Post('repor-ocultos')
  @HttpCode(200)
  repor(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.demo.reporOcultos(m, u);
  }
}

/** A câmara de demonstração pronta com um botão (e `npm run demo:preparar`). */
@Module({
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
